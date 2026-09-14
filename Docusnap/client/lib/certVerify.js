'use strict';
// certVerify.js — the PURE trust-decision helpers for the client's verified-connect + cert-change flow
// (Oracle C1/C2/C3, 2026-09-14). No IPC, no network: main.js does the fetch/pin, this decides. Testable in Node
// (test_cert_verify.js). The guarantee: pinned bytes ≡ hashed bytes ≡ compared value — a server-REPORTED
// fingerprint is never trusted for a decision, and an unreadable cert is a REFUSAL, never a pass.
const crypto = require('crypto');

// Normalise a SHA-256 fingerprint to hex-uppercase, separators stripped, for a stable comparison.
function normFp(s) { return String(s || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase(); }

// The fingerprint of the EXACT cert bytes. Throws → null; the caller treats null as unreadable → refuse.
function computeFingerprint(pem) {
  try { return new crypto.X509Certificate(pem).fingerprint256; } catch { return null; }
}

// Verify a fetched CA against an EXPECTED fingerprint (from a QR/profile). {ok, fingerprint, verified} on a match
// (or when no expectation is given → caller confirms), else {ok:false, reason:'unreadable'|'mismatch'}. NEVER
// trusts a server-reported value; an unreadable cert is a refusal.
function verifyExpected(fetchedPem, expectedFp) {
  const fp = computeFingerprint(fetchedPem);
  if (!fp) return { ok: false, reason: 'unreadable' };
  if (!expectedFp) return { ok: true, fingerprint: fp, verified: false };
  if (normFp(fp) !== normFp(expectedFp)) return { ok: false, reason: 'mismatch', fingerprint: fp };
  return { ok: true, fingerprint: fp, verified: true };
}

// Is this a TLS-VERIFICATION failure (a trust event, NOT unreachability)?
function isCertError(e) {
  const code = e && e.code;
  if (code && (/(_CERT_|^CERT_|_SSL_|_TLS_)/.test(code)
    || ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
        'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID'].includes(code))) return true;
  return /certificate|altname|self.signed|unable to verify|cert_/i.test((e && e.message) || '');
}

// An ALTNAME error = the cert doesn't cover the dialed address (a SAN gap), NOT necessarily a changed CA.
function isAltNameError(e) { return !!(e && (e.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || /altname/i.test((e && e.message) || ''))); }

// Classify a cert error against a SAVED server (Oracle C3): 'addr-mismatch' when the CA is the SAME (a SAN gap,
// so the ID has NOT changed) vs 'changed' when the CA fingerprint DIFFERS (a genuine identity change → the
// refuse-is-default re-accept). An unreadable fresh cert → 'unreadable' (leave it, never guess a change).
function classifyCertChange(pinnedPem, freshPem) {
  const a = computeFingerprint(pinnedPem), b = computeFingerprint(freshPem);
  if (!b) return { kind: 'unreadable' };
  if (a && normFp(a) === normFp(b)) return { kind: 'addr-mismatch', fingerprint: b };
  return { kind: 'changed', oldFingerprint: a, newFingerprint: b };
}

module.exports = { normFp, computeFingerprint, verifyExpected, isCertError, isAltNameError, classifyCertChange };
