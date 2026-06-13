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

const ENFORCE_KEY = 'license_enforcement_enabled';
const HWM_KEY = 'license_time_hwm'; // monotonic time high-water mark (ms), in settings (outside token cache)

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

  ipcMain.handle('license-start-trial', async () => {
    const db = getDb();
    let fpHash = null;
    try {
      const b = build(); fpHash = b.fpHash;
      const res = await b.client.startTrial(fpHash);
      return persistAndReturn(db, fpHash, res && res.body);
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
  if (getSetting(db, ENFORCE_KEY) !== 'true') {
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
  try {
    const gate = createClient({ baseUrl: cfg.base_url, productId: cfg.product_id, transport: _ctx.licenseTransport, timeoutMs: 2500 });
    const res = await gate.validate(fpHash, null);
    if (res && res.body && res.body.token) cacheFromResponse(db, fpHash, res.body);
  } catch { /* offline — fall back to cached token */ }

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
