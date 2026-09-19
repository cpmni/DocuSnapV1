'use strict';

/**
 * src/lib/license/client.js — HTTPS client to the licensing backend (Phase 1).
 *
 * Speaks the narrow, versioned /v1 contract. In Phase 1 only the read/identity
 * calls are wired: trial/start (resume-or-create) and status (display snapshot).
 * HTTPS transport is required in production but is NEVER the trust anchor — token
 * verification arrives in Phase 2 (src/lib/license/token.js).
 *
 * Privacy: ONLY product_id + fp_hash leave the device. The raw fingerprint is
 * never sent (see fingerprint.js). base_url + product_id come from
 * config/license.json, so a WAMP -> IONOS move is a config change, not code.
 *
 * The transport is injectable so the resume contract can be verified offline
 * (tests pass a fake transport); the default uses Node http/https.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ── DEV licensing-call monitor (2026-09-19) ─────────────────────────────────────────────────────
// A ring buffer of every call this process makes to the licensing website, so the dev app can SEE
// the volume, which endpoint, what it was for, who made it, how long it took and the outcome — the
// "is the site going down because we hammer it?" question. Recorded in-memory only, never persisted,
// never sent anywhere. The dev-inspector reads it over IPC (dev-only; inert on packaged builds).
const CALL_LOG_CAP = 1000;
const _callLog = [];
let _callSeq = 0;
function _recordCall(entry) {
  _callLog.push({ seq: ++_callSeq, ...entry });
  if (_callLog.length > CALL_LOG_CAP) _callLog.splice(0, _callLog.length - CALL_LOG_CAP);
}
function getCallLog() { return _callLog.slice(); }
function clearCallLog() { _callLog.length = 0; }
function callLogSummary() {
  const byEndpoint = {};
  let firstTs = null, lastTs = null;
  for (const c of _callLog) {
    const k = c.endpoint || '?';
    const b = byEndpoint[k] || (byEndpoint[k] = { count: 0, errors: 0, totalMs: 0 });
    b.count++; if (!c.ok) b.errors++; b.totalMs += (c.durationMs || 0);
    if (firstTs === null || c.ts < firstTs) firstTs = c.ts;
    if (lastTs === null || c.ts > lastTs) lastTs = c.ts;
  }
  for (const k of Object.keys(byEndpoint)) byEndpoint[k].avgMs = Math.round(byEndpoint[k].totalMs / Math.max(1, byEndpoint[k].count));
  return { total: _callLog.length, byEndpoint, firstTs, lastTs };
}

function defaultTransport(method, urlStr, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;
    const req = lib.request(
      u,
      {
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
          : {},
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let body = null;
          try { body = data ? JSON.parse(data) : null; } catch { /* leave null */ }
          resolve({ status: res.statusCode, body });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

function createClient({ baseUrl, productId, transport = defaultTransport, timeoutMs = 4000, source = 'unknown' }) {
  if (!baseUrl || !productId) throw new Error('license/client: baseUrl and productId are required');
  const base = String(baseUrl).replace(/\/+$/, '');

  // Every call funnels through here so the dev monitor sees ONE row per licensing request: which
  // endpoint, what part of the app asked for it (`source`), how long it took, and the outcome.
  // Timing + recording are the ONLY additions — the transport call is byte-identical to before.
  async function _call(endpoint, method, url, body) {
    const t0 = Date.now();
    let status = null, ok = false, error = null;
    try {
      const res = await transport(method, url, body, timeoutMs);
      status = res && res.status;
      ok = typeof status === 'number' && status >= 200 && status < 300;
      return res;
    } catch (e) {
      error = (e && e.message) || String(e);
      throw e;
    } finally {
      _recordCall({ ts: t0, endpoint, method, source, durationMs: Date.now() - t0, status, ok, error });
    }
  }

  // POST /v1/trial/start — resume-or-create. Sends product_id + fp_hash plus the
  // captured trial-customer identity (customer_name required; contact_name/email
  // optional). These are plain contact details, never the raw fingerprint or any
  // secret. Backend validates again and is the source of truth.
  function startTrial(fpHash, customer = {}) {
    return _call('trial/start', 'POST', base + '/trial/start', {
      product_id: productId,
      fp_hash: fpHash,
      customer_name: customer.customerName || '',
      contact_name:  customer.contactName  || '',
      email:         customer.email        || '',
    });
  }

  // GET /v1/status — read-only display snapshot.
  function getStatus(fpHash) {
    const u = base + '/status?product_id=' + encodeURIComponent(productId) +
              '&fp_hash=' + encodeURIComponent(fpHash);
    return _call('status', 'GET', u, null);
  }

  // POST /v1/validate — refresh/re-verify; returns a FRESH signed token whose
  // 7-day grace restarts from issue. Sends only product_id + fp_hash (+token_id).
  function validate(fpHash, tokenId) {
    return _call('validate', 'POST', base + '/validate',
      { product_id: productId, fp_hash: fpHash, token_id: tokenId || null });
  }

  // POST /v1/activate — bind a SEAT to this fingerprint. account_key travels over
  // HTTPS (hashed at rest server-side). Returns a signed seat token, or a 4xx
  // error (seat_limit_reached / unknown_account).
  function activate(fpHash, accountKey, deviceLabel) {
    return _call('activate', 'POST', base + '/activate',
      { product_id: productId, fp_hash: fpHash, account_key: accountKey, device_label: deviceLabel || null });
  }

  // POST /v1/revoke — release the seat bound to this fingerprint (freeing it for
  // reactivation elsewhere). Returns a confirmation, or not_bound.
  function revoke(fpHash, accountKey) {
    return _call('revoke', 'POST', base + '/revoke',
      { product_id: productId, fp_hash: fpHash, account_key: accountKey });
  }

  return { startTrial, getStatus, validate, activate, revoke };
}

module.exports = { createClient, defaultTransport, getCallLog, clearCallLog, callLogSummary };
