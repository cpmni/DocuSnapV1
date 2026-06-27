'use strict';

/**
 * src/modules/licensing/handler.js — licensing IPC + gate brain.
 *
 * Phase 1: read-only status/trial-start IPC (unchanged renderer behavior).
 * Phase 2: adds decideAccess() — the effective-state decision consumed by the
 * gate in main.js (enterMainApp). The MAIN process is the sole decider; the
 * renderer can only SIGNAL intent (license-enter-app), never self-grant.
 *
 * Enforcement is controlled by the `license_enforcement_enabled` setting
 * (default false → behaves exactly as Phase 0/1: always 'allow'). Only when it
 * is 'true' can the gate deny entry. The raw fingerprint is computed/hashed in
 * this (main) process and never exposed to the renderer.
 */

const fingerprintLib = require('../../lib/license/fingerprint');
const token = require('../../lib/license/token');
const { createClient } = require('../../lib/license/client');
const licensing = require('../../../database/modules/licensing');
const { getSetting, setSetting } = require('../../../database/modules/learning');
const { addAuditEntry } = require('../../../database/modules/auth');
const authHandler = require('../auth/handler'); // for admin-role guard on enforcement toggle

const HWM_KEY = 'license_time_hwm'; // monotonic time high-water mark (ms), in settings (outside token cache)

// Licensing enforcement is ALWAYS ON and cannot be disabled — not by an
// environment variable, not by a persisted setting, and not by running an
// unpackaged/dev build. This is intentional: a "start with licensing turned
// off" path is a single, obvious bypass of the payment/entitlement checks, so
// no such path is allowed to exist. A valid cached trial/seat token still
// passes the gate, so legitimately trialed or activated users open normally.
// Dev ergonomics: developers run against a REAL backend trial/seat for their
// machine's fingerprint (see CLAUDE.md → Licensing & activation) — never a
// bypass flag. The `db` arg is kept so existing call sites are unchanged.
function enforcementActive(_db) {
  return true;
}

let _ctx = null;
let _config = null;

function loadConfig(ctx) {
  if (_config) return _config;
  const cfgPath = ctx.resourcePath('config', 'license.json');
  _config = JSON.parse(ctx.fs.readFileSync(cfgPath, 'utf8'));
  return _config;
}

function readHwm(db) {
  const n = Number(getSetting(db, HWM_KEY));
  return Number.isFinite(n) ? n : 0;
}
function bumpHwm(db, t) {
  const next = Math.max(readHwm(db), Number(t) || 0);
  setSetting(db, HWM_KEY, String(next));
  return next;
}

// Store a JWS returned by the backend into the read-only cache.
function cacheFromResponse(db, fpHash, body) {
  if (!body || !body.token) return;
  const c = token.decodeUnverifiedClaims(body.token) || {};
  licensing.cacheToken(db, {
    kind: c.kind || 'trial',
    subject: c.subject || ('trial:' + fpHash),
    jws: body.token,
    state: c.state || body.state || 'unknown',
    notAfter: c.not_after || null,
    graceUntil: c.grace_until || null,
  });
  // Phase 1: cache the per-feature detached-client capacity the backend returned
  // (search/workflow seat counts ride the JSON response, NOT the signed token) so the
  // core enforces them offline; refreshed on every online validate — the backend stays
  // the source of truth. entitlementService reads these settings.
  if (body.features && typeof body.features === 'object') {
    try {
      const learning = require('../../../database/modules/learning');
      const n = (v) => String(Math.max(0, parseInt(v, 10) || 0));
      learning.setSetting(db, 'detached_search_seats', n(body.features.search));
      learning.setSetting(db, 'detached_workflow_seats', n(body.features.workflow));
    } catch { /* settings/learning unavailable — non-fatal */ }
  }
}

// Phase 2: when the cached token VERIFIED and carries SIGNED per-feature counts
// (schema_version >= 2), sync them into the detached-client settings, OVERRIDING any
// unsigned JSON-cached values written by cacheFromResponse — so the effective
// search/workflow caps come from the tamper-proof, offline-verified token, and a
// tampered JSON response cannot grant more. Called from decideAccess AFTER the token is
// verified (online refresh AND offline startup), NOT from the per-IPC guard. An OLD
// token (no features claim) returns null and leaves the Phase 1 JSON values in place.
function _syncSignedFeatures(db, claims) {
  try {
    const feats = token.featuresOf(claims);
    if (!feats) return;
    const learning = require('../../../database/modules/learning');
    const n = (v) => String(Math.max(0, parseInt(v, 10) || 0));
    if (feats.search   != null) learning.setSetting(db, 'detached_search_seats',   n(feats.search));
    if (feats.workflow != null) learning.setSetting(db, 'detached_workflow_seats', n(feats.workflow));
    learning.setSetting(db, 'detached_features_signed', 'true');
  } catch { /* non-fatal — falls back to the cached values */ }
}

// Mask an activation key for display only — keep the leading group + last 4 chars, hide the
// rest. We NEVER persist the full key (it's a credential); the mask just lets an operator
// recognise which key is registered on this device.
function maskActivationKey(k) {
  k = String(k || '').trim();
  if (!k) return '';
  if (k.length <= 10) return '••••';
  return k.slice(0, 7) + '…' + k.slice(-4);
}

// Renderer-facing status never includes the raw JWS or fingerprint.
function readable(body) {
  if (!body) return { state: 'unknown' };
  const { token: _t, ...rest } = body;
  return rest;
}

// Enrich a status result with seat counts from the cached seat token (display).
function withSeatInfo(db, fpHash, result) {
  if (!fpHash) return result;
  const t = licensing.getActiveToken(db, fpHash);
  if (t && t.token_blob) {
    const c = token.decodeUnverifiedClaims(t.token_blob);
    if (c && c.kind === 'seat') {
      return { ...result, kind: 'seat', seats_total: c.seats_total, seats_used: c.seats_used,
               state: (result && result.state) || 'active' };
    }
  }
  return result;
}

// Local audit mirror (brand-neutral action names). Never throws.
// outcome is success|failure|denied so the admin Audit view can filter on it;
// action_category is pinned to 'licensing' (categoryFor also infers it from the
// 'license.' prefix, but being explicit keeps it robust to renames).
function audit(db, action, outcome, targetId, details) {
  try {
    addAuditEntry(db, { user_id: null, action, action_category: 'licensing',
      outcome: outcome || null, target_type: 'license',
      target_id: targetId != null ? String(targetId) : null, details });
  } catch { /* audit is best-effort */ }
}

function register(ctx) {
  _ctx = ctx;
  const { ipcMain, getDb } = ctx;

  function build() {
    const cfg = loadConfig(ctx);
    // ctx.licenseTransport is a test-only seam; undefined in production -> the
    // client falls back to its default http/https transport.
    return {
      cfg,
      fpHash: fingerprintLib.computeFpHash(cfg.product_id), // hashed in main
      client: createClient({ baseUrl: cfg.base_url, productId: cfg.product_id, transport: ctx.licenseTransport }),
    };
  }

  function persistAndReturn(db, fpHash, body) {
    licensing.recordDevice(db, fpHash);
    cacheFromResponse(db, fpHash, body);
    return { ok: true, ...readable(body) };
  }

  function offlineFallback(db, fpHash, where, err) {
    if (ctx.logger && ctx.logger.warn) {
      ctx.logger.warn(`${where} (non-fatal, enforcement off): ${err.message}`);
    }
    const cached = fpHash && licensing.getActiveToken(db, fpHash);
    if (cached && cached.token_blob) {
      const c = token.decodeUnverifiedClaims(cached.token_blob) || {};
      return { ok: false, offline: true, cached: true, state: cached.state || c.state || 'unknown',
               trial_end: c.trial_end || null, days_remaining: undefined };
    }
    return { ok: false, offline: true, state: 'unknown' };
  }

  ipcMain.handle('license-get-status', async () => {
    const db = getDb();
    let fpHash = null;
    try {
      const b = build(); fpHash = b.fpHash;
      const res = await b.client.getStatus(fpHash);
      return withSeatInfo(db, fpHash, persistAndReturn(db, fpHash, res && res.body));
    } catch (e) { return withSeatInfo(db, fpHash, offlineFallback(db, fpHash, 'license-get-status', e)); }
  });

  // Trial start now CAPTURES the customer identity (customer/company name + user
  // name + email) before a trial can begin — trials are no longer anonymous. Main
  // validates (defence in depth; the backend validates authoritatively too) and
  // will not start a trial on incomplete capture, so the renderer cannot silently
  // proceed into the app. These are plain contact details; no secret is logged.
  ipcMain.handle('license-start-trial', async (_e, data) => {
    const db = getDb();
    const customerName = ((data && data.customerName) || '').trim();
    const contactName  = ((data && data.contactName)  || '').trim();
    const email        = ((data && data.email)        || '').trim();
    if (!customerName) return { ok: false, code: 'missing_fields' };
    if (customerName.length > 190 || contactName.length > 190 || email.length > 190) {
      return { ok: false, code: 'missing_fields' };
    }
    // Pragmatic email shape check (mirrors the backend's stricter validation).
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, code: 'invalid_email' };
    let fpHash = null;
    try {
      const b = build(); fpHash = b.fpHash;
      const res = await b.client.startTrial(fpHash, { customerName, contactName, email });
      // A backend rejection (e.g. validation) is not a grant — surface it, never
      // cache a token, never let the renderer enter the app.
      if (!res || res.status < 200 || res.status >= 300 || !res.body || !res.body.token) {
        const code = (res && res.body && res.body.error && res.body.error.code) || 'trial_failed';
        audit(db, 'license.trial_failed', 'failure', fpHash, code);
        return { ok: false, code };
      }
      audit(db, 'license.trial_started', 'success', fpHash, null);
      return persistAndReturn(db, fpHash, res.body);
    } catch (e) {
      audit(db, 'license.trial_failed', 'failure', fpHash || 'unknown', 'offline: ' + e.message);
      return offlineFallback(db, fpHash, 'license-start-trial', e);
    }
  });

  // Paid activation (Phase 3). The renderer may REQUEST activation, but MAIN
  // decides based on the backend response + the cached token the gate verifies.
  // account_key is forwarded to the backend over HTTPS; it is never validated in
  // the renderer and never echoed back.
  ipcMain.handle('license-activate', async (_e, data) => {
    const db = getDb();
    let fpHash = null;
    try {
      const b = build(); fpHash = b.fpHash;
      const accountKey = (data && data.accountKey) || '';
      const deviceLabel = (data && data.deviceLabel) || null;
      const res = await b.client.activate(fpHash, accountKey, deviceLabel);
      const ok = res && res.status >= 200 && res.status < 300 && res.body && res.body.token;
      if (ok) {
        licensing.recordDevice(db, fpHash);
        cacheFromResponse(db, fpHash, res.body);
        // Remember the device name + a MASKED key for display in Settings (full key never stored).
        try {
          if (deviceLabel) setSetting(db, 'license_device_label', String(deviceLabel));
          setSetting(db, 'license_key_masked', maskActivationKey(accountKey));
        } catch { /* settings unavailable — non-fatal */ }
        audit(db, 'license.activated', 'success', res.body.seat_id || fpHash,
          `seats=${res.body.seats_used}/${res.body.seats_total}`);
        return { ok: true, ...readable(res.body) };
      }
      const code = (res && res.body && res.body.error && res.body.error.code) || 'activation_failed';
      audit(db, 'license.activate_failed', 'failure', fpHash, code);
      return { ok: false, code };
    } catch (e) {
      audit(db, 'license.activate_failed', 'failure', fpHash || 'unknown', 'offline: ' + e.message);
      return { ok: false, offline: true, code: 'offline' };
    }
  });

  // Local activation TEST (admin tool: Settings → Activation Test). Unlike
  // license-activate this NEVER mutates real license state — no token cache, no
  // HWM, no seat persistence, no device record. It only round-trips the given
  // backend with the given credentials so an admin can confirm a local/staging
  // deployment + seeded credentials work. The account key is forwarded to the
  // backend over the wire for the request only; it is never persisted or logged
  // here (the audit line records status, never the key). Returns a sanitised
  // result with no token or fingerprint.
  ipcMain.handle('license-test-activate', async (_e, data) => {
    const db = getDb();
    const baseUrl   = ((data && data.baseUrl)   || '').trim();
    const productId = ((data && data.productId) || '').trim();
    const accountKey = (data && data.accountKey) || '';
    if (!baseUrl || !productId) return { ok: false, code: 'missing_fields', message: 'Backend URL and product ID are required.' };
    if (!accountKey)            return { ok: false, code: 'missing_fields', message: 'Activation key is required.' };
    try {
      const fpHash = fingerprintLib.computeFpHash(productId); // hashed in main
      const client = createClient({ baseUrl, productId, transport: ctx.licenseTransport });
      const res = await client.activate(fpHash, accountKey, 'activation-test');
      const status = res && res.status;
      const ok = res && status >= 200 && status < 300 && res.body && res.body.token;
      audit(db, 'license.test_activate', ok ? 'success' : 'failure', null, `status=${status} ok=${!!ok}`);
      if (ok) {
        const b = res.body;
        return { ok: true, status, state: b.state || 'active',
                 seats_used: b.seats_used, seats_total: b.seats_total };
      }
      const err = res && res.body && res.body.error;
      return { ok: false, status, code: (err && err.code) || 'activation_failed',
               message: (err && err.message) || null };
    } catch (e) {
      audit(db, 'license.test_activate', 'failure', null, 'offline: ' + e.message);
      return { ok: false, offline: true, code: 'offline', message: e.message };
    }
  });

  // Enforcement state for the admin Settings toggle (staged rollout control).
  // Reports the persisted setting, the effective value, and whether a dev/staging
  // env override is currently forcing it (so the UI can explain a mismatch).
  ipcMain.handle('license-get-enforcement', () => {
    // Enforcement is permanently ON; no env var or setting can relax it.
    return { setting: true, effective: true, envOverride: null, locked: true };
  });

  // Toggle the persisted enforcement setting. Admin-only (the Settings window is
  // already admin-gated; this is defence in depth). The env override, if present,
  // still takes precedence over whatever is stored here.
  ipcMain.handle('license-set-enforcement', () => {
    // Hard-gated: enforcement can NEVER be toggled off at runtime. Licensing
    // enforcement cannot be disabled by environment or settings — this is
    // intentional to avoid a bypass gate. This handler performs NO state change;
    // it is retained only so the existing Settings UI gets an honest response.
    if (!authHandler.hasRole('admin')) {
      audit(getDb(), 'license.enforcement_toggle_attempt', 'denied', null, 'non-admin');
      return { ok: false, code: 'forbidden' };
    }
    // Honest no-op, but a deliberate attempt to relax licensing is worth recording.
    audit(getDb(), 'license.enforcement_toggle_attempt', 'denied', null, 'enforcement_locked');
    return { ok: false, code: 'enforcement_locked', setting: true, effective: true, envOverride: null };
  });

  // Read-only license diagnostic for Settings → Activation ("License Status").
  // Reports exactly what the gate sees on THIS device WITHOUT any network call or
  // state change: effective enforcement (+ why), and the cached trial/seat token's
  // kind/state/expiry/days-left plus the OFFLINE gate decision that token yields.
  // This is the answer to "is it seeing a license?" — never exposes the JWS, the
  // raw fingerprint, or secrets.
  ipcMain.handle('license-get-diagnostics', () => {
    const db = getDb();
    // Enforcement is permanently ON and cannot be relaxed by env/setting.
    const envForced = null;
    const setting = true;
    const effective = true;

    let fpHash = null, cfg = null;
    try { cfg = loadConfig(_ctx); fpHash = fingerprintLib.computeFpHash(cfg.product_id); }
    catch (e) {
      return { enforcement: { setting, effective, envOverride: envForced },
               token: { hasToken: false }, localDecision: 'config_error', reason: 'config_error' };
    }

    const cached = fpHash && licensing.getActiveToken(db, fpHash);
    if (!cached || !cached.token_blob) {
      return { enforcement: { setting, effective, envOverride: envForced },
               token: { hasToken: false },
               localDecision: effective ? 'no_cached_token' : 'enforcement_off',
               reason: effective ? 'no_cached_token' : 'enforcement_off' };
    }

    const c = token.decodeUnverifiedClaims(cached.token_blob) || {};
    const now = Date.now();
    const hwm = Math.max(readHwm(db), now);
    const ev = token.evaluate(cached.token_blob,
      { fpHash, productId: cfg.product_id, publicKeys: cfg.public_keys, now, highWaterMark: hwm });
    const endStr = c.kind === 'trial' ? c.trial_end : c.expires_at;
    const endMs = endStr ? Date.parse(endStr) : NaN;
    const daysRemaining = Number.isFinite(endMs) ? Math.max(0, Math.ceil((endMs - now) / 86400000)) : null;

    return {
      enforcement: { setting, effective, envOverride: envForced },
      token: {
        hasToken: true,
        kind: c.kind || 'unknown',
        state: c.state || (cached.state || 'unknown'),
        not_after: c.not_after || null,
        grace_until: c.grace_until || null,
        entitlement_end: endStr || null,
        days_remaining: daysRemaining,
        seats_total: c.seats_total != null ? c.seats_total : null,
        seats_used: c.seats_used != null ? c.seats_used : null,
      },
      localDecision: ev.decision,
      reason: ev.reason,
    };
  });

  // Revoke (Phase 4): release THIS device's seat so it can be reactivated
  // elsewhere (reinstall / hardware swap = revoke then activate; no new
  // entitlement). On success the local seat token is dropped, so the gate stops
  // honoring it here. account_key is forwarded to the backend; never echoed.
  ipcMain.handle('license-revoke', async (_e, data) => {
    const db = getDb();
    let fpHash = null;
    try {
      const b = build(); fpHash = b.fpHash;
      const accountKey = (data && data.accountKey) || '';
      const res = await b.client.revoke(fpHash, accountKey);
      const ok = res && res.status >= 200 && res.status < 300 && res.body && res.body.released;
      if (ok) {
        licensing.clearSeatToken(db, fpHash);
        audit(db, 'license.revoked', 'success', fpHash, `seats=${res.body.seats_used}/${res.body.seats_total}`);
        return { ok: true, ...readable(res.body) };
      }
      const code = (res && res.body && res.body.error && res.body.error.code) || 'revoke_failed';
      audit(db, 'license.revoke_failed', 'failure', fpHash, code);
      return { ok: false, code };
    } catch (e) {
      audit(db, 'license.revoke_failed', 'failure', fpHash || 'unknown', 'offline: ' + e.message);
      return { ok: false, offline: true, code: 'offline' };
    }
  });
}

/**
 * Network-free, read-only evaluation of the CACHED token against the rollback-proof
 * clock (effectiveNow = max(now, high-water mark)). Shared by decideAccess() (after
 * its online refresh) AND the per-workflow guard licenseDenied(). It NEVER makes a
 * network call and NEVER throws — a per-workflow caller must not be able to crash an
 * IPC handler, and on any unexpected error it fails CLOSED (locked). It only READS
 * the persisted high-water mark; decideAccess() still advances it.
 * Returns { decision: 'allow'|'locked'|'locked_needs_online'|'locked_invalid',
 *           reason, enforcement }.
 */
function evaluateCachedAccess(db, pre = null) {
  try {
    if (!enforcementActive(db)) {
      return { decision: 'allow', reason: 'enforcement_off', enforcement: false };
    }
    // Reuse the caller's already-computed config + fingerprint when provided, so a
    // single decideAccess() pass does not recompute the device fingerprint twice
    // (it computes them for the online refresh). A direct per-workflow caller passes
    // nothing and computes here. Identical values either way — behavior is unchanged.
    let cfg, fpHash;
    if (pre && pre.cfg && pre.fpHash) {
      ({ cfg, fpHash } = pre);
    } else {
      try {
        cfg = loadConfig(_ctx);
        fpHash = fingerprintLib.computeFpHash(cfg.product_id);
      } catch (e) {
        return { decision: 'locked_needs_online', reason: 'config_error', enforcement: true };
      }
    }
    const now = Date.now();
    let hwm = readHwm(db);
    const cached = licensing.getActiveToken(db, fpHash);
    if (cached && cached.token_blob) {
      const c = token.decodeUnverifiedClaims(cached.token_blob);
      if (c && c.issued_at) hwm = Math.max(hwm, Date.parse(c.issued_at) || 0);
    }
    if (!cached || !cached.token_blob) {
      return { decision: 'locked_needs_online', reason: 'no_cached_token', enforcement: true };
    }
    const result = token.evaluate(cached.token_blob, {
      fpHash, productId: cfg.product_id, publicKeys: cfg.public_keys,
      now, highWaterMark: Math.max(hwm, now),
    });
    return { ...result, enforcement: true };
  } catch (e) {
    // A per-workflow guard must never throw into a handler — fail CLOSED.
    return { decision: 'locked_invalid', reason: 'eval_error', enforcement: true };
  }
}

/**
 * Thin MULTI-POINT guard (F-01) for high-value workflow entry points. Returns null
 * when access is allowed, otherwise a small structured denial the IPC handler
 * spreads into its own response shape: { code:'license_required', reason }.
 * Network-free; safe to call synchronously inside an IPC handler. Spreading these
 * checks across the high-value flows means a single patched branch no longer
 * silently re-enables the product.
 */
function licenseDenied(db) {
  const r = evaluateCachedAccess(db);
  return r.decision === 'allow' ? null : { code: 'license_required', reason: r.reason };
}

/**
 * The gate's effective-state decision. Never throws.
 * Returns { decision: 'allow'|'locked'|'locked_needs_online'|'locked_invalid',
 *           reason, enforcement }.
 */
async function decideAccess() {
  const db = _ctx.getDb();

  // Enforcement is permanently ON (see enforcementActive); kept for symmetry.
  if (!enforcementActive(db)) {
    return { decision: 'allow', reason: 'enforcement_off', enforcement: false };
  }

  let cfg, fpHash;
  try {
    cfg = loadConfig(_ctx);
    fpHash = fingerprintLib.computeFpHash(cfg.product_id);
  } catch (e) {
    return { decision: 'locked_needs_online', reason: 'config_error', enforcement: true };
  }

  const now = Date.now();

  // Best-effort online refresh: a fresh signed token restarts the 7-day grace.
  // Short timeout so app startup never blocks on a slow/unreachable backend; a
  // failure here is non-fatal (we fall back to the cached token within grace).
  let online = false, onlineSeatGrant = false, returnedToken = false;
  try {
    const gate = createClient({ baseUrl: cfg.base_url, productId: cfg.product_id, transport: _ctx.licenseTransport, timeoutMs: 2500 });
    const res = await gate.validate(fpHash, null);
    online = true;
    if (res && res.body && res.body.token) {
      returnedToken = true;
      cacheFromResponse(db, fpHash, res.body);
      // A returned token only KEEPS this device's seat if it's an ACTIVE SEAT grant.
      const c = token.decodeUnverifiedClaims(res.body.token) || {};
      onlineSeatGrant = c.kind === 'seat' && c.state === 'active';
    }
  } catch { /* offline — fall back to cached token within grace */ }

  // A REACHABLE backend that did NOT affirm an active SEAT for this device is
  // authoritative: drop the stale cached seat token so a server-side revoke takes effect
  // NOW instead of riding out the 7-day grace. This covers BOTH no-token ({state:'none'})
  // AND the seat->trial fallback: when the device ALSO has a trial record, validate returns
  // a TRIAL token (even an EXPIRED one) instead of {state:'none'} — which previously looked
  // like a grant and let the stale 365-day seat token keep winning (seat > trial in
  // getActiveToken). The trial token, if any, was just cached and is honored on its own
  // merits (an expired trial locks). Offline (no response) deliberately does NOT clear.
  if (online && !onlineSeatGrant) {
    licensing.clearSeatToken(db, fpHash);
    // The backend returned NO token at all ({state:'none'}) → no grant of ANY kind (no seat,
    // no trial). Drop the stale cached TRIAL token too, so a trial deleted/expired
    // server-side can't keep showing "N days left" on the device (the persistent app DB
    // survives reinstalls). A real active trial returns a trial TOKEN (returnedToken=true),
    // which was just refreshed above, so it is preserved.
    if (!returnedToken) licensing.clearCachedToken(db, fpHash);
  }

  // Advance the persisted monotonic high-water mark (rollback defense) exactly as
  // before, then delegate the verdict to the shared, network-free evaluator.
  let hwm = readHwm(db);
  const cached = licensing.getActiveToken(db, fpHash);
  if (cached && cached.token_blob) {
    const c = token.decodeUnverifiedClaims(cached.token_blob);
    if (c && c.issued_at) hwm = Math.max(hwm, Date.parse(c.issued_at) || 0);
  }
  bumpHwm(db, Math.max(now, hwm));

  // Delegate the verdict to the shared evaluator, handing it the config + fingerprint
  // already computed above so the fingerprint is not derived a second time.
  const decision = evaluateCachedAccess(db, { cfg, fpHash });
  // Phase 2: refresh the SIGNED per-feature caps from the just-verified token (online
  // or offline), overriding any unsigned JSON. Done here (not in the per-IPC evaluator)
  // so it runs once per access decision.
  if (decision && decision.claims) _syncSignedFeatures(db, decision.claims);
  return decision;
}

module.exports = { register, decideAccess, evaluateCachedAccess, licenseDenied };
