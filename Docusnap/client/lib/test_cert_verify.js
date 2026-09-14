#!/usr/bin/env node
'use strict';
/**
 * test_cert_verify.js — the client verified-connect + cert-change trust decisions (Oracle C1/C2/C3, T1/T2).
 * These are the security-critical pins for the simpler-connection design. Plain Node (certVerify uses only
 * `crypto`); two throwaway self-signed CAs are minted with node-forge to exercise real X509 fingerprints.
 *   node client/lib/test_cert_verify.js
 */
const forge = require('node-forge');
const cv = require('./certVerify');
let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

function makeCertPem(cn) {
  const keys = forge.pki.rsa.generateKeyPair(1024);   // throwaway; small for test speed
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = String(Math.floor(Math.random() * 1e9) + 1);
  cert.validity.notBefore = new Date(Date.now() - 3600e3);
  cert.validity.notAfter = new Date(Date.now() + 86400e3);
  const attrs = [{ name: 'commonName', value: cn }];
  cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

const caA = makeCertPem('ScanFinder CA A');
const caB = makeCertPem('ScanFinder CA B');
const fpA = cv.computeFingerprint(caA);
const fpB = cv.computeFingerprint(caB);

console.log('0 fingerprints');
check('computeFingerprint returns a hex SHA-256 for a real cert', /^[0-9A-F:]+$/i.test(fpA) && fpA.replace(/[^0-9a-f]/gi, '').length === 64);
check('two distinct certs → distinct fingerprints', cv.normFp(fpA) !== cv.normFp(fpB));
check('an unreadable PEM → null (refuse, not a lucky pass)', cv.computeFingerprint('-----BEGIN CERTIFICATE-----\nnot a cert\n-----END CERTIFICATE-----') === null);

console.log('1 verifyExpected (T1 — the MITM cases)');
// T1: a MITM serves attackerCA but LIES the fingerprint = the victim's. Compare uses the LOCAL hash of the served
// bytes → mismatch → REFUSE (the attacker CA is never pinned).
check('served attackerCA + expected=victimFp → REFUSE (mismatch)', cv.verifyExpected(caB, fpA).ok === false && cv.verifyExpected(caB, fpA).reason === 'mismatch');
check('served genuine CA + expected=its own fp → OK + verified', (() => { const r = cv.verifyExpected(caA, fpA); return r.ok === true && r.verified === true && cv.normFp(r.fingerprint) === cv.normFp(fpA); })());
check('a lied server-reported fingerprint is IRRELEVANT — only the served bytes are hashed', cv.verifyExpected(caB, fpA).ok === false);   // (there is no path that trusts a reported value)
check('malformed PEM + any expected fp → REFUSE (unreadable)', cv.verifyExpected('garbage', fpA).ok === false && cv.verifyExpected('garbage', fpA).reason === 'unreadable');
check('no expectation → ok but NOT verified (caller must confirm)', (() => { const r = cv.verifyExpected(caA, null); return r.ok === true && r.verified === false; })());

console.log('2 isCertError / isAltNameError (T2 classification)');
check('ERR_TLS_CERT_ALTNAME_INVALID is a cert error', cv.isCertError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }));
check('UNABLE_TO_VERIFY_LEAF_SIGNATURE is a cert error', cv.isCertError({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }));
check('SELF_SIGNED_CERT_IN_CHAIN is a cert error', cv.isCertError({ code: 'SELF_SIGNED_CERT_IN_CHAIN' }));
check('a network error (ECONNREFUSED) is NOT a cert error', !cv.isCertError({ code: 'ECONNREFUSED' }));
check('ALTNAME is flagged by isAltNameError; a leaf-verify error is not', cv.isAltNameError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }) && !cv.isAltNameError({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }));

console.log('3 classifyCertChange (T2 — SAN gap vs identity change)');
check('same CA (a SAN/address gap) → addr-mismatch, NOT a change', cv.classifyCertChange(caA, caA).kind === 'addr-mismatch');
check('different CA fingerprint → changed (the refuse-default re-accept)', (() => { const r = cv.classifyCertChange(caA, caB); return r.kind === 'changed' && cv.normFp(r.newFingerprint) === cv.normFp(fpB); })());
check('an unreadable fresh cert → unreadable (never guess a change)', cv.classifyCertChange(caA, 'garbage').kind === 'unreadable');

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
process.exit(fail ? 1 : 0);
