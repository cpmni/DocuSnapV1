'use strict';

/**
 * client/apiClient.js
 * -------------------
 * The detached client's transport to the core app's /v1 API. Pure Node http/https
 * (no Electron, no deps) so it is unit-testable against the real server and can be
 * driven from the client's MAIN process — keeping the session token OUT of the
 * renderer (the renderer calls IPC, main calls this).
 *
 * VERSION HANDSHAKE (lockstep): connect() reads /v1/health and compares the
 * server's contract version against the version this client was built for. The
 * client and core ship together, so:
 *   - different MAJOR  -> block (incompatible; upgrade required),
 *   - different MINOR  -> warn  (drift; proceed degraded),
 *   - otherwise        -> ok.
 * Stage 6 finalises how the UI enforces 'block'/'warn'; this returns the verdict.
 */

const http  = require('http');
const https = require('https');
const { URL } = require('url');

// The contract version this client build targets — keep in lockstep with the
// server's API_CONTRACT_VERSION (src/modules/api/handler.js).
const CLIENT_CONTRACT = '1.0.0';

function parseVer(v) {
  const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

/** Compare a server contract version to what the client expects. */
function compareContract(serverVersion, expected = CLIENT_CONTRACT) {
  const s = parseVer(serverVersion);
  const e = parseVer(expected);
  if (!s) return { mode: 'block', reason: 'server did not advertise a contract version' };
  if (s.major !== e.major) {
    return { mode: 'block', reason: `incompatible API (server v${serverVersion}, client expects v${e.major}.x)` };
  }
  if (s.minor !== e.minor) {
    return { mode: 'warn', reason: `minor API drift (server v${serverVersion}, client v${expected})` };
  }
  return { mode: 'ok', reason: null };
}

function createClient(opts = {}) {
  const baseUrl = String(opts.baseUrl || '').replace(/\/+$/, '');
  const expectedContract = opts.expectedContract || CLIENT_CONTRACT;
  const allowSelfSigned = !!opts.allowSelfSigned; // dev-only escape hatch (env), not the UI
  const ca = opts.ca || null;                     // pinned server cert/CA (PEM) — verification stays ON
  const clientId = opts.clientId || null;         // stable per-install id → sticky seat survives a DHCP/IP change
  const hostname = opts.hostname || null;         // display-only client identity (never used for enforcement)
  let token = null;

  // Reuse one keep-alive TLS connection for the pinned-CA path (search / detail /
  // pages all hit the same host) instead of a fresh TCP+TLS handshake per request.
  // CA verification stays FULLY ON — the pinned `ca` + rejectUnauthorized live on
  // the agent. Insecure one-shot bootstrap calls (fetchCa/enroll) and the dev
  // self-signed escape do NOT pool — they keep their per-request override below.
  const secureAgent = (ca && !allowSelfSigned)
    ? new https.Agent({ keepAlive: true, ca, rejectUnauthorized: true })
    : null;

  function request(method, p, { body, withAuth, insecure } = {}) {
    return new Promise((resolve, reject) => {
      let u;
      try { u = new URL(baseUrl + p); } catch (e) { return reject(e); }
      const lib = u.protocol === 'https:' ? https : http;
      const data = body != null ? JSON.stringify(body) : null;
      const headers = { 'Accept': 'application/json', 'X-ScanFinder-Client-Contract': expectedContract };
      if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
      if (withAuth && token) headers['Authorization'] = `Bearer ${token}`;
      const reqOpts = {
        method, headers, hostname: u.hostname, port: u.port,
        path: u.pathname + u.search,
      };
      if (u.protocol === 'https:') {
        if (insecure || allowSelfSigned) {
          reqOpts.rejectUnauthorized = false;   // one-shot CA bootstrap / dev escape — no pooling
        } else if (secureAgent) {
          reqOpts.agent = secureAgent;          // pinned-CA keep-alive (ca + verification on the agent)
        } else if (ca) {
          reqOpts.ca = ca;                       // pinned CA without a pooled agent (fallback)
        }
      }
      const req = lib.request(reqOpts, (res) => {
        let out = '';
        res.on('data', d => { out += d; });
        res.on('end', () => {
          let json = null;
          try { json = out ? JSON.parse(out) : null; } catch { /* leave null */ }
          resolve({ status: res.statusCode, json });
        });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  /** Handshake: returns { ok, mode:'ok'|'warn'|'block', reason, serverVersion }. */
  async function connect() {
    let r;
    try { r = await request('GET', '/v1/health'); }
    catch (e) { return { ok: false, mode: 'block', reason: `cannot reach server: ${e.message}`, serverVersion: null }; }
    if (r.status !== 200 || !r.json) {
      return { ok: false, mode: 'block', reason: `unexpected health response (${r.status})`, serverVersion: null };
    }
    const cmp = compareContract(r.json.contractVersion, expectedContract);
    return { ok: cmp.mode !== 'block', mode: cmp.mode, reason: cmp.reason, serverVersion: r.json.contractVersion };
  }

  async function login(username, password, totp) {
    const r = await request('POST', '/v1/auth/login', { body: { username, password, totp, client_id: clientId, hostname } });
    if (r.status === 200 && r.json && r.json.token) {
      token = r.json.token;
      return { ok: true, user: r.json.user, expiresAt: r.json.expiresAt };
    }
    return {
      ok: false, status: r.status,
      mfaRequired: !!(r.json && r.json.mfaRequired),
      error: (r.json && r.json.error) || 'Login failed.',
      retryAfterMs: r.json && r.json.retryAfterMs,
    };
  }

  async function logout() {
    if (token) { try { await request('POST', '/v1/auth/logout', { withAuth: true }); } catch { /* best effort */ } }
    token = null;
    return { ok: true };
  }

  async function entitlement() {
    return request('GET', '/v1/entitlement', { withAuth: true });
  }

  async function search(params) {
    const r = await request('POST', '/v1/search', { body: params || {}, withAuth: true });
    return r;
  }
  async function getDocument(id) {
    return request('GET', `/v1/documents/${encodeURIComponent(id)}`, { withAuth: true });
  }
  async function getPages(id, folderPath, filename) {
    const q = new URLSearchParams({ folderPath: folderPath || '', filename: filename || '' });
    return request('GET', `/v1/documents/${encodeURIComponent(id)}/pages?${q}`, { withAuth: true });
  }
  // Lightweight reachability probe (no auth). True if the server responds at all
  // (any status); false if the connection fails (server closed / unreachable) —
  // drives the client's connection-watch heartbeat.
  async function ping() {
    try { await request('GET', '/v1/health'); return true; }
    catch { return false; }
  }

  // ── Mailbox / approval workflow ───────────────────────────────────────────────
  const wfList    = (view) => request('GET', `/v1/workflow/${view}`, { withAuth: true });
  const recipients = () => request('GET', '/v1/workflow/recipients', { withAuth: true });
  const assign = (documentId, toUserId, actionRequired, comment) =>
    request('POST', '/v1/workflow/routes', { withAuth: true, body: { documentId, toUserId, actionRequired, comment } });
  const claim   = (id, version) => request('POST', `/v1/workflow/routes/${id}/claim`, { withAuth: true, body: { version } });
  const resolve = (id, decision, comment, version) =>
    request('POST', `/v1/workflow/routes/${id}/resolve`, { withAuth: true, body: { decision, comment, version } });
  const recall  = (id, version) => request('POST', `/v1/workflow/routes/${id}/recall`, { withAuth: true, body: { version } });

  // One-shot CA bootstrap over an UNTRUSTED connection (no CA pinned yet). The caller
  // MUST confirm the returned fingerprint out-of-band before pinning it.
  async function fetchCa(code) {
    const q = code ? `?code=${encodeURIComponent(code)}` : '';
    let r;
    try { r = await request('GET', `/v1/ca${q}`, { insecure: true }); }
    catch (e) { return { ok: false, error: `cannot reach server: ${e.message}` }; }
    if (r.status !== 200 || !r.json || !r.json.caPem) {
      return { ok: false, status: r.status, error: (r.json && r.json.error) || `certificate fetch failed (${r.status})` };
    }
    let fingerprint = r.json.caFingerprintSha256;
    try { fingerprint = new (require('crypto').X509Certificate)(r.json.caPem).fingerprint256; } catch { /* keep server-reported */ }
    return { ok: true, caPem: r.json.caPem, fingerprint, serverReported: r.json.caFingerprintSha256, host: r.json.host, port: r.json.port };
  }

  // Credential + entitlement-gated enrollment: returns the CA to pin AND a session
  // token in one step (sets the token on success). Bootstrap (insecure) fetch.
  async function enroll(username, password, totpCode, code) {
    const q = code ? `?code=${encodeURIComponent(code)}` : '';
    const r = await request('POST', `/v1/enroll${q}`, { body: { username, password, totp: totpCode, client_id: clientId, hostname }, insecure: true });
    if (r.status === 200 && r.json && r.json.token) {
      token = r.json.token;
      return { ok: true, caPem: r.json.caPem, caFingerprint: r.json.caFingerprintSha256, user: r.json.user, expiresAt: r.json.expiresAt };
    }
    return { ok: false, status: r.status, mfaRequired: !!(r.json && r.json.mfaRequired), code: r.json && r.json.code, error: (r.json && r.json.error) || 'Enrollment failed.' };
  }

  return {
    connect, login, logout, entitlement, search, getDocument, getPages, ping, fetchCa, enroll,
    workflow: { list: wfList, recipients, assign, claim, resolve, recall },
    isAuthenticated: () => !!token,
    _setToken: (t) => { token = t; }, // test/diagnostic aid only
  };
}

module.exports = { createClient, compareContract, CLIENT_CONTRACT };
