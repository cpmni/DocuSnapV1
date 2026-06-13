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

const ENFORCE_KEY = 'license_enforcement_enabled';
const ENFORCE_ENV = 'DOCUSNAP_LICENSE_ENFORCEMENT'; // dev/staging override; wins over the setting
const HWM_KEY = 'license_time_hwm'; // monotonic time high-water mark (ms), in settings (outside token cache)

// A dev/staging env override for enforcement so it can be flipped WITHOUT editing
// the DB — and so dev can always force it OFF (the escape hatch if a machine ever
// gets locked). Returns true/false when set, or null to defer to the setting.
function envEnforcementOverride() {
  const v = String(process.env[ENFORCE_ENV] || '').trim().toLowerCase();
  if (v === 'off' || v === '0' || v === 'false' || v === 'no')  return false;
  if (v === 'on'  || v === '1' || v === 'true'  || v === 'yes') return true;
  return null;
}

// Effective enforcement, in priority order:
//   1. env override (DOCUSNAP_LICENSE_ENFORCEMENT) — dev/staging escape hatch;
//   2. explicit persisted setting ('true'/'false') — admin choice;
//   3. unset (e.g. a fresh install): DEFAULT ON for packaged/installed builds so a
//      clean profile must activate, OFF in dev so `npm start` stays frictionless.
// A valid cached trial/seat token still passes the gate, so legitimately trialed
// or activated users open normally; only the "never gated" bypass is closed.
function enforcementActive(db) {
  const o = envEnforcementOverride();
  if (o !== null) return o;
  const v = getSetting(db, ENFORCE_KEY);
  if (v === 'true')  return true;
  if (v === 'false') return false;
  return !!(_ctx && _ctx.app && _ctx.app.isPackaged); // unset -> enforce in installed builds
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
function audit(db, action, targetId, details) {
  try {
    addAuditEntry(db, { user_id: null, action, target_type: 'license',
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
        return { ok: false, code };
      }
      return persistAndReturn(db, fpHash, res.body);
    } catch (e) { return offlineFallback(db, fpHash, 'license-start-trial', e); }
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
        audit(db, 'license.activated', res.body.seat_id || fpHash,
          `seats=${res.body.seats_used}/${res.body.seats_total}`);
        return { ok: true, ...readable(res.body) };
      }
      const code = (res && res.body && res.body.error && res.body.error.code) || 'activation_failed';
      audit(db, 'license.activate_failed', fpHash, code);
      return { ok: false, code };
    } catch (e) {
      audit(db, 'license.activate_failed', fpHash || 'unknown', 'offline: ' + e.message);
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
      audit(db, 'license.test_activate', null, `status=${status} ok=${!!ok}`);
      if (ok) {
        const b = res.body;
        return { ok: true, status, state: b.state || 'active',
                 seats_used: b.seats_used, seats_total: b.seats_total };
      }
      const err = res && res.body && res.body.error;
      return { ok: false, status, code: (err && err.code) || 'activation_failed',
               message: (err && err.message) || null };
    } catch (e) {
      audit(db, 'license.test_activate', null, 'offline: ' + e.message);
      return { ok: false, offline: true, code: 'offline', message: e.message };
    }
  });

  // Enforcement state for the admin Settings toggle (staged rollout control).
  // Reports the persisted setting, the effective value, and whether a dev/staging
  // env override is currently forcing it (so the UI can explain a mismatch).
  ipcMain.handle('license-get-enforcement', () => {
    const db = getDb();
    const envForced = envEnforcementOverride();
    const setting = getSetting(db, ENFORCE_KEY) === 'true';
    return { setting, effective: enforcementActive(db), envOverride: envForced };
  });

  // Toggle the persisted enforcement setting. Admin-only (the Settings window is
  // already admin-gated; this is defence in depth). The env override, if present,
  // still takes precedence over whatever is stored here.
  ipcMain.handle('license-set-enforcement', (_e, on) => {
    if (!authHandler.hasRole('admin')) return { ok: false, code: 'forbidden' };
    const db = getDb();
    const want = !!on;
    setSetting(db, ENFORCE_KEY, want ? 'true' : 'false');
    audit(db, want ? 'license.enforcement_enabled' : 'license.enforcement_disabled', null, 'via settings');
    const envForced = envEnforcementOverride();
    return { ok: true, setting: want, effective: envForced !== null ? envForced : want, envOverride: envForced };
  });

  // Read-only license diagnostic for Settings → Activation ("License Status").
  // Reports exactly what the gate sees on THIS device WITHOUT any network call or
  // state change: effective enforcement (+ why), and the cached trial/seat token's
  // kind/state/expiry/days-left plus the OFFLINE gate decision that token yields.
  // This is the answer to "is it seeing a license?" — never exposes the JWS, the
  // raw fingerprint, or secrets.
  ipcMain.handle('license-get-diagnostics', () => {
    const db = getDb();
    const envForced = envEnforcementOverride();
    const setting = getSetting(db, ENFORCE_KEY) === 'true';
    const effective = enforcementActive(db);

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
        audit(db, 'license.revoked', fpHash, `seats=${res.body.seats_used}/${res.body.seats_total}`);
        return { ok: true, ...readable(res.body) };
      }
      const code = (res && res.body && res.body.error && res.body.error.code) || 'revoke_failed';
      audit(db, 'license.revoke_failed', fpHash, code);
      return { ok: false, code };
    } catch (e) {
      audit(db, 'license.revoke_failed', fpHash || 'unknown', 'offline: ' + e.message);
      return { ok: false, offline: true, code: 'offline' };
    }
  });
}

/**
 * The gate's effective-state decision. Never throws.
 * Returns { decision: 'allow'|'locked'|'locked_needs_online'|'locked_invalid',
 *           reason, enforcement }.
 */
async function decideAccess() {
  const db = _ctx.getDb();

  // Enforcement switch — default OFF preserves Phase 0/1 behavior exactly.
  // Env override (DOCUSNAP_LICENSE_ENFORCEMENT) wins over the stored setting.
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
  let online = false, onlineGrant = false;
  try {
    const gate = createClient({ baseUrl: cfg.base_url, productId: cfg.product_id, transport: _ctx.licenseTransport, timeoutMs: 2500 });
    const res = await gate.validate(fpHash, null);
    online = true;
    if (res && res.body && res.body.token) { cacheFromResponse(db, fpHash, res.body); onlineGrant = true; }
  } catch { /* offline — fall back to cached token within grace */ }

  // A REACHABLE backend that returns no grant for this device (seat released or
  // revoked server-side, no trial — validate() responds {state:'none'} with no
  // token) is authoritative: drop the stale cached seat token so the release takes
  // effect on the next online check instead of riding out the 7-day grace. Offline
  // (no response) deliberately does NOT clear — that path still honors the cache.
  if (online && !onlineGrant) {
    licensing.clearSeatToken(db, fpHash);
  }

  // Monotonic high-water mark (rollback defense), persisted outside the cache.
  let hwm = readHwm(db);
  const cached = licensing.getActiveToken(db, fpHash);
  if (cached && cached.token_blob) {
    const c = token.decodeUnverifiedClaims(cached.token_blob);
    if (c && c.issued_at) hwm = Math.max(hwm, Date.parse(c.issued_at) || 0);
  }
  hwm = bumpHwm(db, Math.max(now, hwm));

  if (!cached || !cached.token_blob) {
    return { decision: 'locked_needs_online', reason: 'no_cached_token', enforcement: true };
  }

  const result = token.evaluate(cached.token_blob, {
    fpHash, productId: cfg.product_id, publicKeys: cfg.public_keys, now, highWaterMark: hwm,
  });
  return { ...result, enforcement: true };
}

module.exports = { register, decideAccess };
