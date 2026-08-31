'use strict';

/**
 * certService.js
 * --------------
 * Core-app TLS certificate generation for the detached-client API — pure JS via
 * node-forge (no OpenSSL binary). This is the bundled, self-managed version of
 * the standalone cert-tool: the Certificate Wizard calls it when an admin enables
 * "Search client access" so the admin never hand-manages certs.
 *
 * Proven 2-tier shape (do NOT change the crypto): a CA cert (basicConstraints
 * CA:TRUE + keyCertSign) signs a server cert carrying the server's IP/DNS SANs
 * (extKeyUsage serverAuth). Clients PIN the CA (ca.crt) — a lone self-signed leaf
 * pinned as its own CA fails in Node (UNABLE_TO_VERIFY_LEAF_SIGNATURE).
 *
 * Reads/inspection use Node's built-in crypto.X509Certificate (no forge needed),
 * so fingerprint/SAN/expiry checks work even where forge isn't loaded. fs/os/forge
 * are injectable so the unit tests stay hermetic (temp dirs, stubbed interfaces).
 */

const path = require('path');
const nodeCrypto = require('crypto');

function getForge() { return require('node-forge'); }

/** Positive, random 16-byte serial as a hex string. */
function randomSerial(forge) {
  let hex = forge.util.bytesToHex(forge.random.getBytesSync(16));
  if (parseInt(hex[0], 16) >= 8) hex = '00' + hex; // keep high bit clear (positive)
  return hex;
}

function isIp(s) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || (s.includes(':') && /^[0-9a-fA-F:]+$/.test(s));
}

/** node-forge altNames: type 7 = IP, type 2 = DNS. */
function buildAltNames(addresses) {
  return addresses.map((a) => (isIp(a) ? { type: 7, ip: a } : { type: 2, value: a }));
}

function makeValidity(days) {
  const notBefore = new Date(); notBefore.setDate(notBefore.getDate() - 1); // clock-skew backdate
  const notAfter = new Date();  notAfter.setDate(notAfter.getDate() + days);
  return { notBefore, notAfter };
}

/**
 * Detect the LAN identities a client could connect to: external IPv4 addresses
 * and the hostname. `os` is injectable for tests.
 * @returns {{ ipv4: string[], hostname: string }}
 */
function detectLanIdentities({ os } = {}) {
  os = os || require('os');
  const ifaces = (typeof os.networkInterfaces === 'function' ? os.networkInterfaces() : {}) || {};
  const ipv4 = [];
  for (const name of Object.keys(ifaces)) {
    for (const ni of (ifaces[name] || [])) {
      const fam = ni && ni.family;
      if ((fam === 'IPv4' || fam === 4) && !ni.internal && ni.address && !ipv4.includes(ni.address)) {
        ipv4.push(ni.address);
      }
    }
  }
  let hostname = '';
  try { hostname = os.hostname() || ''; } catch { /* ignore */ }
  return { ipv4, hostname };
}

function makeCa(customer, days, forge) {
  const pki = forge.pki;
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial(forge);
  Object.assign(cert.validity, makeValidity(days));
  const subject = [{ name: 'commonName', value: `ScanFinder CA - ${customer}` }];
  cert.setSubject(subject);
  cert.setIssuer(subject); // self-signed root
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

function makeServerCert(cn, altNames, ca, days, forge) {
  const pki = forge.pki;
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial(forge);
  Object.assign(cert.validity, makeValidity(days));
  cert.setSubject([{ name: 'commonName', value: cn }]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
  ]);
  cert.sign(ca.key, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

/** SHA-256 fingerprint of a CA cert, e.g. "AB:CD:...". Pass `pem` or a `caCrtPath`. */
function readCaFingerprint({ caCrtPath, fs, pem } = {}) {
  fs = fs || require('fs');
  const data = pem || fs.readFileSync(caCrtPath, 'utf8');
  return new nodeCrypto.X509Certificate(data).fingerprint256;
}

/**
 * Generate (or rotate) the managed CA + server certificate set into `certsDir`.
 * Reuses an existing CA when present (reuseCa) so re-issuing the server cert does
 * NOT invalidate already-pinned clients.
 * @returns {{caCrtPath,caKeyPath,serverCrtPath,serverKeyPath,caReused,caFingerprintSha256,serverSans,notAfter}}
 */
// Encrypt-at-rest for the CA private key (audit H1). Default = PASSTHROUGH, so callers that
// pass no `secret` (and every existing test) write/read plaintext byte-identically. The real
// caller injects `require('../lib/secretStore')` unless CERT_KEY_ENCRYPT_DISABLED=1.
const _CA_KEY_PASSTHRU = { encrypt: (x) => x, decrypt: (x) => x, isEncrypted: () => false, available: () => false };

function generateServerCerts({ certsDir, sans, customer = 'ScanFinder', days = 825, caDays = 3650, reuseCa = true, fs, forge, secret = _CA_KEY_PASSTHRU } = {}) {
  fs = fs || require('fs');
  forge = forge || getForge();
  const pki = forge.pki;
  if (!certsDir) throw new Error('certsDir is required');
  const addr = (Array.isArray(sans) ? sans : [sans]).map((s) => String(s || '').trim()).filter(Boolean);
  if (!addr.length) throw new Error('at least one SAN (IP or hostname) is required');

  fs.mkdirSync(certsDir, { recursive: true });
  const f = {
    caCrt: path.join(certsDir, 'ca.crt'), caKey: path.join(certsDir, 'ca.key'),
    serverCrt: path.join(certsDir, 'server.crt'), serverKey: path.join(certsDir, 'server.key'),
  };
  const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

  let ca, caReused = false;
  if (reuseCa && exists(f.caCrt) && exists(f.caKey)) {
    const rawCaKey = fs.readFileSync(f.caKey, 'utf8');
    // FAIL-LOUD: if this ca.key is encrypted and cannot be decrypted (profile moved to a
    // different Windows user/machine, or corruption), secret.decrypt THROWS and the error
    // propagates — we must NOT fall through to the else branch and mint a NEW CA, which would
    // invalidate every already-pinned client. Recovery = delete the certs dir and re-issue.
    ca = { cert: pki.certificateFromPem(fs.readFileSync(f.caCrt, 'utf8')), key: pki.privateKeyFromPem(secret.decrypt(rawCaKey)) };
    caReused = true;
    // Opportunistic at-rest migration: a legacy PLAINTEXT ca.key is re-written encrypted once,
    // transparently, on the next reuse. Best-effort — never blocks issuance.
    try {
      if (secret.available() && !secret.isEncrypted(rawCaKey)) {
        fs.writeFileSync(f.caKey, secret.encrypt(pki.privateKeyToPem(ca.key)), { mode: 0o600 });
      }
    } catch { /* migration is best-effort; the plaintext key still works */ }
  } else {
    ca = makeCa(customer, caDays, forge);
    fs.writeFileSync(f.caCrt, pki.certificateToPem(ca.cert));
    fs.writeFileSync(f.caKey, secret.encrypt(pki.privateKeyToPem(ca.key)), { mode: 0o600 }); // private — never served; encrypt-at-rest (H1)
  }

  const srv = makeServerCert(addr[0], buildAltNames(addr), ca, days, forge);
  fs.writeFileSync(f.serverCrt, pki.certificateToPem(srv.cert));
  // ENCRYPT-AT-REST, matching ca.key on the line above (2026-08-09 NIGHT, pre-release audit).
  // The CA key was wrapped and the SERVER key was left as plaintext PEM beside it — and the server
  // key is what lets somebody impersonate this LAN service to clients that have already pinned the
  // CA. `secret.encrypt` is Windows DPAPI via Electron safeStorage, so the file is useless on any
  // other machine or user account. The `ENC1:` prefix makes the read side self-describing, so an
  // install that already holds a plaintext key keeps working and is re-wrapped on the next issue.
  fs.writeFileSync(f.serverKey, secret.encrypt(pki.privateKeyToPem(srv.key)), { mode: 0o600 });

  return {
    caCrtPath: f.caCrt, caKeyPath: f.caKey, serverCrtPath: f.serverCrt, serverKeyPath: f.serverKey,
    caReused,
    caFingerprintSha256: readCaFingerprint({ pem: pki.certificateToPem(ca.cert) }),
    serverSans: addr,
    notAfter: srv.cert.validity.notAfter,
  };
}

/**
 * Rotation primitive: does the existing server cert still cover all `addresses`
 * and remain unexpired? Drives "IP changed / near expiry → re-issue".
 * @returns {{valid,missingSans:string[],expired:boolean,notAfter:Date|null}}
 */
function certCoversAddresses({ serverCrtPath, addresses = [], now, fs, pem, expiryGraceDays = 30 } = {}) {
  fs = fs || require('fs');
  now = now || new Date();
  let x;
  try { x = new nodeCrypto.X509Certificate(pem || fs.readFileSync(serverCrtPath, 'utf8')); }
  catch (e) { return { valid: false, missingSans: addresses.slice(), expired: false, notAfter: null, error: e.message }; }

  const notAfter = new Date(x.validTo);
  const graceMs = expiryGraceDays * 24 * 60 * 60 * 1000;
  const expired = (now.getTime() + graceMs) > notAfter.getTime();

  const present = new Set();
  (x.subjectAltName || '').split(',').forEach((entry) => {
    const m = entry.trim().match(/^(?:IP Address|DNS):(.+)$/i);
    if (m) present.add(m[1].trim());
  });
  const missingSans = addresses.filter((a) => !present.has(a));
  return { valid: !expired && missingSans.length === 0, missingSans, expired, notAfter };
}

module.exports = { detectLanIdentities, generateServerCerts, readCaFingerprint, certCoversAddresses };
