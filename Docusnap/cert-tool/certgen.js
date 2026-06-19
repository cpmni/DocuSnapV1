'use strict';

/**
 * certgen.js
 * ----------
 * Per-customer TLS certificate generation for the ScanFinder detached-client API,
 * implemented in PURE JavaScript via node-forge (MIT) — no OpenSSL binary to ship.
 *
 * Model (one isolated CA per customer):
 *   ca.crt / ca.key   the customer's own CA. Clients PIN ca.crt; you keep ca.key
 *                     to re-issue the server cert without re-pinning clients.
 *   server.crt        server cert signed by that CA, carrying the customer's
 *   server.key        IP / hostname SANs. Loaded by the core app's TLS listener.
 *
 * The CA carries basicConstraints CA:TRUE + keyCertSign; the server cert carries
 * the SANs (IP and/or DNS) + serverAuth. This is the structure Node's TLS verifies
 * when a client pins the CA — the reason a single self-signed leaf does NOT work.
 */

const fs = require('fs');
const path = require('path');
const forge = require('node-forge');
const pki = forge.pki;

/** A positive, random 16-byte serial as a hex string. */
function randomSerial() {
  let hex = forge.util.bytesToHex(forge.random.getBytesSync(16));
  if (parseInt(hex[0], 16) >= 8) hex = '00' + hex; // keep it positive (high bit clear)
  return hex;
}

function isIp(s) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || (s.includes(':') && /^[0-9a-fA-F:]+$/.test(s));
}

/** Turn ['192.168.0.5','host.local'] into node-forge altNames (type 7 = IP, 2 = DNS). */
function buildAltNames(addresses) {
  return addresses.map((a) => (isIp(a) ? { type: 7, ip: a } : { type: 2, value: a }));
}

function fileSafe(s) {
  return String(s).trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'customer';
}

function makeValidity(days) {
  const notBefore = new Date();
  notBefore.setDate(notBefore.getDate() - 1); // 1-day backdate for clock skew
  const notAfter = new Date();
  notAfter.setDate(notAfter.getDate() + days);
  return { notBefore, notAfter };
}

/** Create a self-signed CA for a customer. */
function makeCa(customer, days = 3650) {
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  Object.assign(cert.validity, makeValidity(days));
  const subject = [{ name: 'commonName', value: `ScanFinder CA - ${customer}` }];
  cert.setSubject(subject);
  cert.setIssuer(subject); // self-signed
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert, key: keys.privateKey };
}

/** Create a server cert (with SANs) signed by the customer's CA. */
function makeServerCert(cn, altNames, ca, days = 825) {
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
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

/**
 * Generate (or rotate) a customer's certificate set.
 * @param {object} o
 * @param {string} o.customer   customer name/slug
 * @param {string[]|string} o.addresses  IP(s)/hostname(s); first is the CN
 * @param {string} o.outDir     base output directory
 * @param {number} [o.days=825] server cert validity
 * @param {boolean} [o.reuseCa=true] reuse an existing CA in the folder (rotation)
 * @returns {{dir,caReused,cn,sans,files}}
 */
function generateCustomerCerts({ customer, addresses, outDir, days = 825, reuseCa = true }) {
  if (!customer || !String(customer).trim()) throw new Error('Customer name is required.');
  if (!outDir || !String(outDir).trim()) throw new Error('Output folder is required.');
  const addrList = (Array.isArray(addresses) ? addresses : String(addresses).split(/[, \n]+/))
    .map((s) => String(s).trim()).filter(Boolean);
  if (!addrList.length) throw new Error('At least one address (IP or hostname) is required.');

  const dir = path.join(outDir, fileSafe(customer));
  fs.mkdirSync(dir, { recursive: true });
  const f = {
    caCrt: path.join(dir, 'ca.crt'), caKey: path.join(dir, 'ca.key'),
    serverCrt: path.join(dir, 'server.crt'), serverKey: path.join(dir, 'server.key'),
  };

  let ca; let caReused = false;
  if (reuseCa && fs.existsSync(f.caCrt) && fs.existsSync(f.caKey)) {
    ca = {
      cert: pki.certificateFromPem(fs.readFileSync(f.caCrt, 'utf8')),
      key: pki.privateKeyFromPem(fs.readFileSync(f.caKey, 'utf8')),
    };
    caReused = true;
  } else {
    ca = makeCa(String(customer).trim());
    fs.writeFileSync(f.caCrt, pki.certificateToPem(ca.cert));
    fs.writeFileSync(f.caKey, pki.privateKeyToPem(ca.key));
  }

  const srv = makeServerCert(addrList[0], buildAltNames(addrList), ca, days);
  fs.writeFileSync(f.serverCrt, pki.certificateToPem(srv.cert));
  fs.writeFileSync(f.serverKey, pki.privateKeyToPem(srv.key));

  return { dir, caReused, cn: addrList[0], sans: addrList, files: f };
}

module.exports = { generateCustomerCerts };
