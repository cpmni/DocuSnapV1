'use strict';

/**
 * src/lib/license/token.js — offline token verification (Phase 2).
 *
 * Hardened, verify-before-trust compact-JWS (alg=EdDSA / Ed25519) verification,
 * performed entirely OFFLINE against the kid-indexed public-key map shipped in
 * config/license.json. Order matters — nothing in the claims is trusted until
 * the signature is verified:
 *   1. reject unless header alg === "EdDSA"  (kills "none"/algorithm-confusion);
 *   2. resolve kid against the PINNED key map; unknown kid -> reject;
 *   3. verify the Ed25519 signature; failure -> reject ("no answer");
 *   4. only then read claims: product_id match, fingerprint binding, recognised
 *      state, well-formed timestamps.
 * Any failure throws TokenError -> the caller treats it as a HARD LOCK (no grace).
 *
 * evaluate() then applies the offline-grace / entitlement decision using a
 * rollback-proof clock: effectiveNow = max(now, highWaterMark), so winding the
 * system clock backwards can never extend entitlement or grace.
 */

const crypto = require('crypto');

class TokenError extends Error {
  constructor(reason) { super(reason); this.name = 'TokenError'; this.reason = reason; }
}

const VALID_STATES = new Set(['active', 'expired', 'revoked', 'seat_reassigned']);

function b64urlToBuf(s) {
  if (typeof s !== 'string' || s.length === 0) throw new TokenError('malformed');
  return Buffer.from(s, 'base64url');
}

function publicKeyFor(publicKeys, kid) {
  const entry = publicKeys && Object.prototype.hasOwnProperty.call(publicKeys, kid) ? publicKeys[kid] : null;
  if (!entry) throw new TokenError('unknown_kid');
  if (entry.alg !== 'EdDSA' || entry.format !== 'spki-der-b64') throw new TokenError('bad_key_entry');
  try {
    return crypto.createPublicKey({ key: Buffer.from(entry.key, 'base64'), format: 'der', type: 'spki' });
  } catch { throw new TokenError('bad_key_entry'); }
}

/** Decode claims WITHOUT verifying — for display/high-water-mark only. */
function decodeUnverifiedClaims(jws) {
  try {
    const p = String(jws).split('.');
    if (p.length !== 3) return null;
    return JSON.parse(b64urlToBuf(p[1]).toString('utf8'));
  } catch { return null; }
}

/** Strict verification. Throws TokenError on any hard failure. */
function verify(jws, { fpHash, productId, publicKeys }) {
  if (typeof jws !== 'string') throw new TokenError('malformed');
  const parts = jws.split('.');
  if (parts.length !== 3) throw new TokenError('malformed');
  const [h64, p64, s64] = parts;

  let header;
  try { header = JSON.parse(b64urlToBuf(h64).toString('utf8')); } catch { throw new TokenError('malformed_header'); }
  if (header.alg !== 'EdDSA') throw new TokenError('alg_rejected');     // 1. alg confusion
  if (!header.kid) throw new TokenError('unknown_kid');
  const pub = publicKeyFor(publicKeys, header.kid);                     // 2. pinned kid

  const signingInput = Buffer.from(h64 + '.' + p64, 'ascii');
  let ok = false;
  try { ok = crypto.verify(null, signingInput, pub, b64urlToBuf(s64)); } catch { ok = false; }
  if (!ok) throw new TokenError('bad_signature');                       // 3. signature

  let claims;
  try { claims = JSON.parse(b64urlToBuf(p64).toString('utf8')); } catch { throw new TokenError('malformed_claims'); }

  if (claims.product_id !== productId) throw new TokenError('product_mismatch');   // 4. claims
  if (!VALID_STATES.has(claims.state)) throw new TokenError('bad_state');
  if (claims.kind !== 'trial' && claims.kind !== 'seat') throw new TokenError('bad_kind');
  // Fingerprint binding: trial subject embeds the fp; seat tokens carry fp_hash.
  if (claims.kind === 'trial') {
    if (claims.subject !== 'trial:' + fpHash) throw new TokenError('subject_mismatch');
  } else if (claims.fp_hash !== fpHash) {
    throw new TokenError('subject_mismatch');
  }
  const ts = (v) => { const d = Date.parse(v); if (Number.isNaN(d)) throw new TokenError('bad_timestamp'); return d; };
  const _ts = { issued_at: ts(claims.issued_at), not_after: ts(claims.not_after), grace_until: ts(claims.grace_until) };
  return { kind: claims.kind, state: claims.state, claims: { ...claims, _ts } };
}

function entitlementEnd(claims) {
  const v = claims.kind === 'trial' ? claims.trial_end : claims.expires_at;
  if (v == null) return Infinity;
  const d = Date.parse(v);
  return Number.isNaN(d) ? Infinity : d;
}

/**
 * Full gate decision. Never throws.
 * @returns {{decision:'allow'|'locked'|'locked_needs_online'|'locked_invalid', reason:string, claims?:object}}
 */
function evaluate(jws, { fpHash, productId, publicKeys, now, highWaterMark }) {
  let v;
  try { v = verify(jws, { fpHash, productId, publicKeys }); }
  catch (e) { return { decision: 'locked_invalid', reason: (e && e.reason) || 'invalid' }; }

  const eff = Math.max(Number(now) || 0, Number(highWaterMark) || 0);   // rollback-proof clock
  const { not_after, grace_until } = v.claims._ts;
  const end = entitlementEnd(v.claims);

  if (v.state !== 'active') return { decision: 'locked', reason: v.state, claims: v.claims };
  if (eff >= end) return { decision: 'locked', reason: 'expired', claims: v.claims };
  if (eff < Math.min(not_after, grace_until)) return { decision: 'allow', reason: 'active', claims: v.claims };
  return { decision: 'locked_needs_online', reason: 'stale_past_grace', claims: v.claims };
}

/**
 * Phase 2: read the SIGNED per-feature seat capacity from a VERIFIED token's claims
 * (pass the claims object returned by verify()/evaluate(), NEVER
 * decodeUnverifiedClaims()). Returns a plain { feature: count } map (e.g.
 * { core, search, workflow }) when the token is a schema_version >= 2 token carrying a
 * well-formed features OBJECT; returns null for older tokens / trials (the caller then
 * falls back to the Phase 1 path). Counts are coerced to non-negative integers; any
 * malformed shape -> null, so a tampered/garbled claim can never grant access.
 */
function featuresOf(claims) {
  if (!claims || typeof claims !== 'object') return null;
  if (!(Number(claims.schema_version) >= 2)) return null;
  const f = claims.features;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return null;
  const out = {};
  for (const k of Object.keys(f)) {
    const n = Number(f[k]);
    if (Number.isFinite(n) && n >= 0) out[k] = Math.floor(n);
  }
  return out;
}

module.exports = { verify, evaluate, decodeUnverifiedClaims, featuresOf, TokenError };
