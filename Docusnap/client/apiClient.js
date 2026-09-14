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
const CLIENT_CONTRACT = '1.7.0';   // keep in lockstep with the server's API_CONTRACT_VERSION (1.7.0: + teach-over-client reads — ocr-region-boxes / ocr-page-words / page-deskew / teach config; the client gates its teach cap on ≥ 1.7.0; 1.6.0: + page-info, one request for the first paint + the read-ahead; 1.5.0: + the outline read for the Contents panel + fmt=auto on the page read; 1.4.0: + per-doc routes/history, admin cancel, new stamp type; 1.3.0: + the four preview reads for the search pop-out; 1.2.0: + Quick File upload)

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

  function request(method, p, { body, withAuth, insecure, timeoutMs } = {}) {
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
      // Idle-timeout so an unreachable / non-responding server fails fast instead of hanging
      // on the OS TCP timeout (which left the client on a blank screen). It's an IDLE timeout,
      // so a working-but-slow response that keeps streaming bytes won't trip it. Generous
      // default for large previews; connect()/health passes a short one for snappy failure.
      req.setTimeout(timeoutMs || 20000, () => req.destroy(new Error('connection timed out')));
      if (data) req.write(data);
      req.end();
    });
  }

  /** Handshake: returns { ok, mode:'ok'|'warn'|'block', reason, serverVersion }. */
  async function connect() {
    let r;
    try { r = await request('GET', '/v1/health', { timeoutMs: 8000 }); }
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

  async function changePassword(currentPassword, newPassword) {
    const r = await request('POST', '/v1/auth/change-password',
                            { body: { currentPassword, newPassword }, withAuth: true });
    if (r.status === 200 && r.json && r.json.ok) return { ok: true };
    return { ok: false, error: (r.json && r.json.error) || 'Could not change your password.' };
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
  async function getThumbnail(id) {
    return request('GET', `/v1/documents/${encodeURIComponent(id)}/thumbnail`, { withAuth: true });
  }
  // The four preview READS (contract 1.3.0 — client search parity S2). An older core 404s them; the pop-out's
  // adapter then hides the matching controls. `find` may OCR a scanned document server-side (bounded there),
  // so it carries a LONG idle timeout — and the caller must NOT treat a timeout as a lost connection.
  async function getPage(id, index, scale, fmt) {
    const q = new URLSearchParams({ scale: String(scale || 3) });
    if (fmt === 'auto' || fmt === 'jpeg') q.set('fmt', fmt);   // 1.5.0: JPEG for scan pages (an older core ignores it)
    return request('GET', `/v1/documents/${encodeURIComponent(id)}/page/${Math.max(0, index | 0)}?${q}`, { withAuth: true, timeoutMs: 60000 });
  }
  async function getPageCount(id) {
    return request('GET', `/v1/documents/${encodeURIComponent(id)}/page-count`, { withAuth: true });
  }
  // 1.5.0: the PDF's bookmarks (table of contents) → the pop-out's Contents panel. An older core 404s it.
  async function getOutline(id) {
    return request('GET', `/v1/documents/${encodeURIComponent(id)}/outline`, { withAuth: true });
  }
  // 1.6.0: ONE request for the first paint (page + count + bookmarks) and for the read-ahead batch (`also` = the
  // next page indexes). Renders up to 5 pages server-side → a longer idle timeout than a single page.
  async function getPageInfo(id, page, also, scale, fmt) {
    const q = new URLSearchParams({ page: String(Math.max(0, page | 0)), scale: String(scale || 3) });
    const extra = (Array.isArray(also) ? also : []).map(n => Number(n)).filter(n => Number.isInteger(n) && n >= 0);
    if (extra.length) q.set('also', extra.join(','));
    if (fmt === 'auto' || fmt === 'jpeg') q.set('fmt', fmt);
    return request('GET', `/v1/documents/${encodeURIComponent(id)}/page-info?${q}`, { withAuth: true, timeoutMs: 90000 });
  }
  async function find(id, query) {
    const q = new URLSearchParams({ q: String(query || '') });
    return request('GET', `/v1/documents/${encodeURIComponent(id)}/find?${q}`, { withAuth: true, timeoutMs: 180000 });
  }
  async function getSpreadsheet(id) {
    return request('GET', `/v1/documents/${encodeURIComponent(id)}/spreadsheet`, { withAuth: true });
  }
  // Quick File (non-OCR upload) — the doc-type list + the upload. Upload is a larger body (base64 file),
  // so allow a generous idle timeout. Paths never cross here — client main reads the bytes.
  async function intakeDocTypes() {
    return request('GET', '/v1/documents/intake/doc-types', { withAuth: true });
  }
  async function intakeSubmit(body) {
    return request('POST', '/v1/documents/intake', { withAuth: true, body, timeoutMs: 120000 });
  }
  // Lightweight reachability probe (no auth). True if the server responds at all
  // (any status); false if the connection fails (server closed / unreachable) —
  // drives the client's connection-watch heartbeat.
  async function ping() {
    // Short timeout so the heartbeat + the connection-lost "Retry now" fail fast (8s) rather
    // than holding the spinner for the full default, matching connect()/health.
    try { await request('GET', '/v1/health', { timeoutMs: 8000 }); return true; }
    catch { return false; }
  }

  // ── Mailbox / approval workflow ───────────────────────────────────────────────
  const wfList    = (view) => request('GET', `/v1/workflow/${view}`, { withAuth: true });
  const wfCounts  = () => request('GET', '/v1/workflow/counts', { withAuth: true });   // badge poll (COUNTs only)
  const recipients = () => request('GET', '/v1/workflow/recipients', { withAuth: true });
  const assign = (documentId, toUserId, actionRequired, comment, resubmitOf) =>
    request('POST', '/v1/workflow/routes', { withAuth: true, body: { documentId, toUserId, actionRequired, comment, resubmitOf } });
  const claim   = (id, version) => request('POST', `/v1/workflow/routes/${id}/claim`, { withAuth: true, body: { version } });
  const resolve = (id, decision, comment, version) =>
    request('POST', `/v1/workflow/routes/${id}/resolve`, { withAuth: true, body: { decision, comment, version } });
  const recall  = (id, version) => request('POST', `/v1/workflow/routes/${id}/recall`, { withAuth: true, body: { version } });
  const wfStamped = (id) => request('GET', `/v1/workflow/routes/${id}/stamped`, { withAuth: true });   // stamped-copy pages
  // Contract 1.4.0 (2026-09-14): the search pop-out's per-document reads (open routes → the "Sent to <name>" banner;
  // closed routes → the decision history), the admin escape hatch, and "+ New stamp". Server-gated like their
  // desktop twins (admin/edit reads, admin writes); an older core answers 404 → the pop-out hides the control.
  const wfDocRoutes   = (documentId) => request('GET', `/v1/workflow/documents/${documentId}/routes`, { withAuth: true });
  const wfDocHistory  = (documentId) => request('GET', `/v1/workflow/documents/${documentId}/history`, { withAuth: true });
  const wfAdminCancel = (id, version, reason) => request('POST', `/v1/workflow/routes/${id}/cancel`, { withAuth: true, body: { version, reason } });
  const stampTypeCreate = (body) => request('POST', '/v1/workflow/stamp-types', { withAuth: true, body: body || {} });
  // Stamping (Workflow+Stamping redesign 2026-08-28) — all under /v1/workflow/* (entitlement-gated server-side).
  const stampTypes = () => request('GET', '/v1/workflow/stamp-types', { withAuth: true });
  const stampCan   = () => request('GET', '/v1/workflow/can-stamp', { withAuth: true });
  const stampList  = (documentId) => request('GET', `/v1/workflow/documents/${documentId}/stamps`, { withAuth: true });
  const stampPlace = (documentId, body) => request('POST', `/v1/workflow/documents/${documentId}/stamps`, { withAuth: true, body });
  const stampedDoc = (documentId) => request('GET', `/v1/workflow/documents/${documentId}/stamped`, { withAuth: true });

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

  // ── Recycle bin (soft delete / restore / permanent purge) ─────────────────────
  const binList    = () => request('GET',  '/v1/documents/deleted',        { withAuth: true });
  const binDelete  = (id) => request('POST', `/v1/documents/${id}/delete`,  { withAuth: true });
  const binRestore = (id) => request('POST', `/v1/documents/${id}/restore`, { withAuth: true });
  const binPurge   = (id) => request('POST', `/v1/documents/${id}/purge`,   { withAuth: true });
  const binPurgeAll= () => request('POST',  '/v1/documents/purge-all',      { withAuth: true });

  // ── Review (queue + confirm/defer + presence) ─────────────────────────────────
  const revQueue    = () => request('GET', '/v1/review/queue',    { withAuth: true });
  const revDeferred = () => request('GET', '/v1/review/deferred', { withAuth: true });
  const revCounts   = () => request('GET', '/v1/review/counts',   { withAuth: true });
  const docTypes    = () => request('GET', '/v1/doc-types',       { withAuth: true });
  const revConfirm  = (id, payload) => request('POST', `/v1/documents/${id}/confirm`, { withAuth: true, body: payload || {} });
  const revDefer    = (id) => request('POST', `/v1/documents/${id}/defer`,   { withAuth: true });
  const revUndefer  = (id) => request('POST', `/v1/documents/${id}/undefer`, { withAuth: true });
  const revViewing  = (id) => request('POST', `/v1/review/${id}/viewing`,    { withAuth: true });
  const revRelease  = (id) => request('POST', `/v1/review/${id}/release`,    { withAuth: true });
  // Correction-only targeting: send a small cropped PNG of a value region, get text back.
  const revOcrRegion = (id, imageBase64) => request('POST', `/v1/documents/${id}/ocr-region`, { withAuth: true, body: { imageBase64 } });

  // ── Teach-over-client S1 (contract 1.7.0): the wizard's OCR/geometry reads + its feature flags ─────
  // Each posts a client-cropped/rendered PNG; the full-page ones spawn OCR/deskew on the core → longer idle
  // timeouts. The text read reuses review.ocrRegion (same /v1/documents/:id/ocr-region route).
  const teachRegionBoxes = (id, imageBase64) => request('POST', `/v1/documents/${id}/ocr-region-boxes`, { withAuth: true, body: { imageBase64 }, timeoutMs: 90000 });
  const teachPageWords   = (id, imageBase64) => request('POST', `/v1/documents/${id}/ocr-page-words`,   { withAuth: true, body: { imageBase64 }, timeoutMs: 120000 });
  const teachPageDeskew  = (id, imageBase64, minAngle) => request('POST', `/v1/documents/${id}/page-deskew`, { withAuth: true, body: { imageBase64, minAngle }, timeoutMs: 120000 });
  const teachConfig      = () => request('GET', '/v1/teach/config', { withAuth: true });
  // Teach-over-client S2 (contract 1.7.0): create a document type / add catalog presets — ADMIN-only server-side.
  const teachCreateDocType = (draft) => request('POST', '/v1/doc-types', { withAuth: true, body: draft || {} });
  const teachDocTypeCatalog = () => request('GET', '/v1/doc-types/catalog', { withAuth: true });
  const teachAddPresets    = (slugs) => request('POST', '/v1/doc-types/presets', { withAuth: true, body: { slugs: Array.isArray(slugs) ? slugs : (slugs ? [slugs] : []) } });
  // Teach-over-client S3: the ONE transactional commit (create template + mappings + fixed + hidden + captions,
  // then file the exemplar). Admin + entitlement + license + the server switch, all server-side. Longer idle —
  // it spawns Python (landmarks/fingerprint) after the tx.
  const teachCommit        = (payload) => request('POST', '/v1/teach/commit', { withAuth: true, body: payload || {}, timeoutMs: 120000 });

  return {
    connect, login, logout, changePassword, entitlement, search, getDocument, getPages, getThumbnail, ping, fetchCa, enroll,
    getPage, getPageCount, find, getSpreadsheet, getOutline, getPageInfo,
    intakeDocTypes, intakeSubmit,
    workflow: { list: wfList, counts: wfCounts, recipients, assign, claim, resolve, recall, stamped: wfStamped,
                stampTypes, canStamp: stampCan, stampList, stampPlace, stampedDoc,
                docRoutes: wfDocRoutes, docHistory: wfDocHistory, adminCancel: wfAdminCancel, stampTypeCreate },
    recycle: { list: binList, delete: binDelete, restore: binRestore, purge: binPurge, purgeAll: binPurgeAll },
    review: { queue: revQueue, deferred: revDeferred, counts: revCounts, docTypes,
              confirm: revConfirm, defer: revDefer, undefer: revUndefer, viewing: revViewing, release: revRelease,
              ocrRegion: revOcrRegion },
    teach: { ocrRegion: revOcrRegion, ocrRegionBoxes: teachRegionBoxes, ocrPageWords: teachPageWords,
             pageDeskew: teachPageDeskew, config: teachConfig,
             createDocType: teachCreateDocType, docTypeCatalog: teachDocTypeCatalog, addDocTypePresets: teachAddPresets,
             commit: teachCommit },
    isAuthenticated: () => !!token,
    _setToken: (t) => { token = t; }, // test/diagnostic aid only
  };
}

module.exports = { createClient, compareContract, CLIENT_CONTRACT };
