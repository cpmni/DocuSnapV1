'use strict';

/**
 * lib/totp.js
 * -----------
 * Dependency-free RFC 6238 TOTP (time-based one-time password), a JS port of the
 * same dependency-free TOTP approach used by the PHP licensing backend
 * (licensing-backend/lib/admin_auth.php). Pure crypto — no external packages — so
 * it can back the detached client's second factor without adding dependencies and
 * is trivially unit-testable.
 *
 * Defaults: SHA-1, 6 digits, 30-second period (what Google Authenticator / Authy
 * / 1Password expect).
 */

const crypto = require('crypto');

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// HOTP (RFC 4226): one code for a specific counter.
function hotp(keyBuf, counter, digits) {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter (safe up to 2^53 via two 32-bit halves).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', keyBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24)
            | ((hmac[offset + 1] & 0xff) << 16)
            | ((hmac[offset + 2] & 0xff) << 8)
            | (hmac[offset + 3] & 0xff);
  return String(bin % (10 ** digits)).padStart(digits, '0');
}

function counterFor({ time, period, t0 }) {
  const seconds = time != null ? time : Math.floor(Date.now() / 1000);
  return Math.floor((seconds - (t0 || 0)) / (period || 30));
}

/** Generate the current TOTP for a base32 secret. opts: {time, period, digits, t0} */
function generate(secretBase32, opts = {}) {
  const digits = opts.digits || 6;
  const key = base32Decode(secretBase32);
  return hotp(key, counterFor({ time: opts.time, period: opts.period || 30, t0: opts.t0 }), digits);
}

/**
 * Verify a user-supplied token against a secret, accepting a small +/- window of
 * time steps to tolerate clock skew (default 1 step each way). Uses a
 * length-checked constant-time compare. opts: {time, period, digits, window, t0}
 */
function verify(token, secretBase32, opts = {}) {
  const digits = opts.digits || 6;
  const period = opts.period || 30;
  const window = opts.window != null ? opts.window : 1;
  const clean = String(token || '').replace(/\s/g, '');
  if (!/^\d+$/.test(clean) || clean.length !== digits) return false;

  let key;
  try { key = base32Decode(secretBase32); } catch { return false; }
  const base = counterFor({ time: opts.time, period, t0: opts.t0 });
  for (let w = -window; w <= window; w++) {
    const candidate = hotp(key, base + w, digits);
    if (candidate.length === clean.length
        && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(clean))) {
      return true;
    }
  }
  return false;
}

/** New random base32 secret (default 20 bytes / 160 bits, the RFC-recommended size). */
function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/** otpauth:// provisioning URI for QR enrolment in an authenticator app. */
function otpauthUri({ secret, label, issuer, digits = 6, period = 30 }) {
  const enc = encodeURIComponent;
  const accountLabel = issuer ? `${enc(issuer)}:${enc(label)}` : enc(label);
  const params = new URLSearchParams({
    secret, algorithm: 'SHA1', digits: String(digits), period: String(period),
  });
  if (issuer) params.set('issuer', issuer);
  return `otpauth://totp/${accountLabel}?${params.toString()}`;
}

module.exports = { generate, verify, generateSecret, otpauthUri, base32Encode, base32Decode };
