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

function createClient({ baseUrl, productId, transport = defaultTransport, timeoutMs = 4000 }) {
  if (!baseUrl || !productId) throw new Error('license/client: baseUrl and productId are required');
  const base = String(baseUrl).replace(/\/+$/, '');

  // POST /v1/trial/start — resume-or-create. Sends product_id + fp_hash plus the
  // captured trial-customer identity (customer_name required; contact_name/email
  // optional). These are plain contact details, never the raw fingerprint or any
  // secret. Backend validates again and is the source of truth.
  function startTrial(fpHash, customer = {}) {
    return transport('POST', base + '/trial/start', {
      product_id: productId,
      fp_hash: fpHash,
      customer_name: customer.customerName || '',
      contact_name:  customer.contactName  || '',
      email:         customer.email        || '',
    }, timeoutMs);
  }

  // GET /v1/status — read-only display snapshot.
  function getStatus(fpHash) {
    const u = base + '/status?product_id=' + encodeURIComponent(productId) +
              '&fp_hash=' + encodeURIComponent(fpHash);
    return transport('GET', u, null, timeoutMs);
  }

  // POST /v1/validate — refresh/re-verify; returns a FRESH signed token whose
  // 7-day grace restarts from issue. Sends only product_id + fp_hash (+token_id).
  function validate(fpHash, tokenId) {
    return transport('POST', base + '/validate',
      { product_id: productId, fp_hash: fpHash, token_id: tokenId || null }, timeoutMs);
  }

  // POST /v1/activate — bind a SEAT to this fingerprint. account_key travels over
  // HTTPS (hashed at rest server-side). Returns a signed seat token, or a 4xx
  // error (seat_limit_reached / unknown_account).
  function activate(fpHash, accountKey, deviceLabel) {
    return transport('POST', base + '/activate',
      { product_id: productId, fp_hash: fpHash, account_key: accountKey, device_label: deviceLabel || null },
      timeoutMs);
  }

  // POST /v1/revoke — release the seat bound to this fingerprint (freeing it for
  // reactivation elsewhere). Returns a confirmation, or not_bound.
  function revoke(fpHash, accountKey) {
    return transport('POST', base + '/revoke',
      { product_id: productId, fp_hash: fpHash, account_key: accountKey }, timeoutMs);
  }

  return { startTrial, getStatus, validate, activate, revoke };
}

module.exports = { createClient, defaultTransport };
