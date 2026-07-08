'use strict';

/**
 * modules/api/handler.js
 * ----------------------
 * Detached-client read-only API. Stage 2 stood up the read seam; Stage 3 adds the
 * PARALLEL AUTH BOUNDARY in front of it — local-account login + optional TOTP MFA
 * issuing an opaque bearer token (sessionService), which the API maps back to a
 * { userId, username, role } on every request and uses to drive the SAME shared
 * services the IPC handlers use. The in-process Electron `requireRole` checks are
 * never touched or relaxed.
 *
 * SAFETY (still pre-LAN-hardening):
 *  - OFF BY DEFAULT (SCANFINDER_API=1) and LOOPBACK ONLY by default; a non-loopback
 *    peer is refused. TLS is supported (SCANFINDER_API_TLS_CERT/KEY) for when this
 *    is deliberately exposed on the LAN — never serve plaintext off-host.
 *  - Read/preview routes REQUIRE a valid session token (401 otherwise). The role
 *    comes from the authenticated session — admin/edit can see uncommitted, readonly
 *    cannot — exactly as the internal search rule, enforced in searchService.
 *  - Every response body is projected by services/dto.js (no fs paths / raw OCR).
 *
 * createServer()/createRequestListener() are exported so the conformance + auth
 * tests can drive the real stack on an ephemeral port without app bootstrap.
 */

const http  = require('http');
const https = require('https');
const { URL } = require('url');

const searchService  = require('../../services/searchService');
const previewService = require('../../services/previewService');
const documents      = require('../../../database/modules/documents');
const doctypes       = require('../../../database/modules/document_types');
const reviewService  = require('../../services/reviewService');
const dto            = require('../../services/dto');
const sessionService    = require('../../services/sessionService');
const authService       = require('../../services/authService');
const workflowService   = require('../../services/workflowService');
const entitlementService = require('../../services/entitlementService');
const totp              = require('../../lib/totp');
const certService       = require('../../services/certService');
const path              = require('path');

// Map a workflowService error code to an HTTP status.
const WF_HTTP = { FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409 };
const wfStatus = (code) => WF_HTTP[code] || 400;

const API_CONTRACT_VERSION = '1.1.0';   // NB: ADDING endpoints (e.g. recycle bin) needs no bump — the
                                        // handshake checks MAJOR only. Keep server + client in lockstep.
const API_PREFIX = '/v1';
const CLIENT_CONTRACT_HEADER = 'x-scanfinder-client-contract';

// Lockstep gate (Stage 6): the server refuses a client whose contract MAJOR does
// not match. The client advertises its contract via CLIENT_CONTRACT_HEADER; an
// absent header is NOT enforced (older callers / health probing). /health stays
// open so a blocked client can still read the server version to explain itself.
function clientContractCompatible(headerVal) {
  if (!headerVal) return true;
  const m = String(headerVal).match(/^(\d+)\./);
  return !!m && m[1] === API_CONTRACT_VERSION.split('.')[0];
}
// Permanent purge: remove the filed file + the app-managed working copy. The path is
// resolved SERVER-SIDE from the document row only (never trusts a client-supplied path).
function _purgeDocFiles(db, id) {
  const fs = require('fs');
  const doc = documents.getById(db, id);
  if (!doc) return;
  for (const p of [documents.resolveFilePath(doc), doc.working_path]) {
    if (p && fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
  }
}
const TOTP_ISSUER = 'ScanFinder';
const MAX_BODY_BYTES = 1 * 1024 * 1024;
// Bound concurrent zone-OCR (correction targeting) so many reviewers/drags can't fan
// out unbounded Tesseract child processes on the host. Module-level (single process).
const OCR_MAX_INFLIGHT = 3;
let _ocrInFlight = 0;

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// Authoritative client IP from the CONNECTION (not the body) — used for seat leases
// and the login audit. Normalises an IPv4-mapped IPv6 address.
function clientIp(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return a.replace(/^::ffff:/, '');
}

// Claim/reuse a concurrent seat for an authenticated detached client. Returns null
// when the add-on is not entitled or no seat pool is wired (no enforcement); otherwise
// the seat-pool result (with the resolved clientKey attached on success). Seats are
// STICKY — a returning client (same client_id, else username@ip) reuses its seat; a new
// client is refused once the licensed seats are full, until an admin releases one.
function claimSeat(ctx, checkEntitlement, body, ip, host, user) {
  if (!ctx.seatPool) return null;
  let ent; try { ent = checkEntitlement(); } catch { return null; }
  if (!ent.entitled) return null;                       // unlicensed → feature routes 402; no seat held
  const clientKey = (body && body.client_id ? String(body.client_id).slice(0, 128) : '') || `${user.username}@${ip}`;
  try {
    const r = ctx.seatPool.claim({ clientKey, username: user.username, role: user.role, hostname: host, ip }, ent.seats);
    if (r.ok) r.clientKey = clientKey;
    return r;
  } catch { return null; }                              // seat-store error → fail OPEN (never 500 a login)
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * Build the request listener over an explicit dependency set. Exposed for tests.
 * deps: getDb (required), learning (stub-able), sessionStore, authenticator,
 * page-render collaborators, dbAuth (audit + totp persistence), logger.
 */
function createRequestListener(ctx) {
  const getDb = ctx.getDb;
  const log = ctx.logger?.log?.bind(ctx.logger) || (() => {});
  const learning = ctx.learning || require('../../../database/modules/learning');
  const dbAuth = ctx.dbAuth || require('../../../database/modules/auth');
  const sessions = ctx.sessionStore || sessionService.shared();
  const authenticator = ctx.authenticator || authService.createAuthenticator();

  const audit = (entry) => {
    try { dbAuth.addAuditEntry(getDb(), { source: 'client_api', ...entry }); }
    catch (e) { log(`[api] audit write failed: ${e && e.message}`); }
  };

  const workflow = ctx.workflowService || workflowService.createWorkflowService({ audit });
  const actorOf = (session) => ({ userId: session.userId, username: session.username, role: session.role });

  // The SAME transport-agnostic review orchestration the desktop uses (Phase 2). The API injects
  // its own hooks: file immediately (a client holds no host file handle), drain the original best-
  // effort, broadcast counts to the desktop badge when possible, and never teach (no template
  // promote). The atomic claim-before-file makes a client confirm race-safe vs the desktop + auto-file.
  const reviewSvc = ctx.reviewService || reviewService.createReviewService({
    audit: (_db, entry) => audit(entry),
    notifyCounts: (db) => {
      if (!ctx.notifyMainWindow) return;
      try {
        ctx.notifyMainWindow('review-count-changed',   documents.getReviewCount(db));
        ctx.notifyMainWindow('deferred-count-changed', documents.getDeferredCount(db));
      } catch { /* best-effort */ }
    },
    onScheduleSourceMove: ({ srcPath }) => {
      try { require('../filing/handler').removeSourceFile(ctx.fs || require('fs'), srcPath, ctx.logger).catch(() => {}); }
      catch { /* best-effort drain */ }
    },
    releaseDelayMs: 0,
  });

  // Belt-and-braces shape guards for the client-supplied field VALUES (filing/learning also
  // sanitise; this rejects an obviously malformed body early). VALUES only — never paths.
  const _isPlainObject = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const _isFlatValues = (o) => o == null || (_isPlainObject(o) &&
    Object.values(o).every(v => v == null || typeof v === 'string' || typeof v === 'number'));
  const _isCorrections = (o) => o == null || (_isPlainObject(o) &&
    Object.values(o).every(v => v == null || _isPlainObject(v)));

  // Multi-user review presence ("Currently being reviewed by <name>") — the SAME shared in-process
  // map the desktop publishes to. Advisory only; the atomic confirm is the authority. A viewerKey
  // is the client's seat key (or a per-user API fallback), so excludes-self works.
  const presence = ctx.presence || require('../../services/presenceService').shared();
  const viewerKeyOf = (s) => s.clientKey || `api:${s.userId}`;
  const viewerOf = (s) => ({
    key: viewerKeyOf(s), username: s.username,
    displayName: ((dbAuth.getUserById(getDb(), s.userId) || {}).display_name) || s.username,
  });

  // Detached-client add-on entitlement (ctx may override for tests/demo).
  const checkEntitlement = ctx.checkEntitlement || (() => entitlementService.checkClientEntitlement(getDb()));
  // Routes that expose the licensed feature itself (gated); auth/health/entitlement are not.
  // review + doc-types ride the SAME search/client entitlement (role supplies the privilege).
  const FEATURE_ROUTE = new RegExp(`^${API_PREFIX}/(search|documents|workflow|review|doc-types)(/|$)`);
  const WORKFLOW_ROUTE = new RegExp(`^${API_PREFIX}/workflow(/|$)`);   // gated on the workflow add-on, not just search

  const pageDeps = () => ({
    fs: ctx.fs || require('fs'),
    path: ctx.path || require('path'),
    spawn: ctx.spawn || require('child_process').spawn,
    pythonExe: ctx.pythonExe,
    pythonArgs: ctx.pythonArgs,
    renderScript: ctx.renderScript
      || (ctx.resourcePath && ctx.resourcePath('python_backend', 'render', 'pages.py')),
    log,
  });

  // Resolve + require a session; on failure writes 401 and returns null.
  const requireSession = (req, res) => {
    const session = sessions.verify(bearerToken(req));
    if (!session) { sendJson(res, 401, { error: 'unauthorized' }); return null; }
    // Heartbeat the seat lease (last-seen + current IP) on each authenticated request.
    if (session.clientKey && ctx.seatPool) ctx.seatPool.touch(session.clientKey, { ip: clientIp(req) });
    return session;
  };

  return async function listener(req, res) {
    try {
      if (!isLoopback(req.socket.remoteAddress) && !ctx.allowRemote) {
        return sendJson(res, 403, { error: 'forbidden' });
      }
      // HSTS only when actually served over TLS (harmless to omit on loopback http).
      if (req.socket.encrypted) res.setHeader('Strict-Transport-Security', 'max-age=31536000');

      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = url.pathname;

      // Lockstep handshake gate: refuse an incompatible client (health + CA bootstrap
      // stay open so a fresh/older client can enroll).
      if (pathname !== `${API_PREFIX}/health` && pathname !== `${API_PREFIX}/ca` && !clientContractCompatible(req.headers[CLIENT_CONTRACT_HEADER])) {
        return sendJson(res, 426, {
          error: 'Client version is incompatible with this server. Please update ScanFinder.',
          serverContract: API_CONTRACT_VERSION,
        });
      }

      // Add-on entitlement gate: the licensed feature surfaces (search/preview/
      // workflow) are blocked unless this install is entitled to the detached
      // client. Auth, health and the entitlement probe stay open so a client can
      // sign in and discover it is not licensed.
      if (FEATURE_ROUTE.test(pathname)) {
        const ent = checkEntitlement();
        const isWorkflow = WORKFLOW_ROUTE.test(pathname);
        // search/documents need the SEARCH entitlement; workflow needs the WORKFLOW add-on.
        // (Legacy/overridden ents without per-feature info still gate search via top-level.)
        const feat = isWorkflow ? ent.workflow : (ent.search || { entitled: ent.entitled, seats: ent.seats });
        if (!feat || !feat.entitled) {
          return sendJson(res, 402, {
            error: isWorkflow
              ? 'The workflow add-on is not licensed for this server.'
              : 'The ScanFinder search client is not licensed for this server.',
            code: 'FEATURE_NOT_LICENSED', feature: isWorkflow ? 'workflow' : ent.feature,
          });
        }
        // Workflow consumes a sub-seat ON the client's held search seat (workflow ≤ search,
        // capped independently). Resolve the session here so the claim keys on its seat.
        if (isWorkflow) {
          const session = requireSession(req, res); if (!session) return;
          if (ctx.seatPool && session.clientKey) {
            const w = ctx.seatPool.claimWorkflow(session.clientKey, feat.seats);
            if (!w.ok) {
              return sendJson(res, 402, {
                error: w.code === 'NO_SEAT'
                  ? 'A search seat is required before using workflow.'
                  : 'All workflow seats are in use.',
                code: w.code === 'NO_SEAT' ? 'NO_SEARCH_SEAT' : 'WORKFLOW_LIMIT', feature: 'workflow',
              });
            }
          }
        }
      }

      // ── Public: health ───────────────────────────────────────────────────────
      if (req.method === 'GET' && pathname === `${API_PREFIX}/health`) {
        return sendJson(res, 200, { ok: true, contract: 'v1', contractVersion: API_CONTRACT_VERSION });
      }

      // ── Public: CA bootstrap (lockstep-exempt). Returns the managed CA to pin.
      //    The client fetches this over an UNTRUSTED connection and MUST confirm the
      //    fingerprint out-of-band (TOFU); an optional pairing code gates harvesting. ─
      if (req.method === 'GET' && pathname === `${API_PREFIX}/ca`) {
        const pr = pairingOk(url, learning, getDb());
        if (!pr.ok) return sendJson(res, 403, { error: pr.reason === 'expired' ? 'pairing code expired' : 'pairing code required', code: 'PAIRING' });
        const prof = buildConnectionProfile(ctx);
        if (!prof.ok) return sendJson(res, 404, { error: 'no managed certificate', code: 'NO_MANAGED_CA' });
        return sendJson(res, 200, {
          caPem: prof.profile.caPem, caFingerprintSha256: prof.profile.caFingerprintSha256,
          host: prof.profile.host, port: prof.profile.port,
        });
      }

      // ── Auth-required: add-on entitlement probe (never gated, so a client can
      //    sign in and learn it is not licensed) ──────────────────────────────────
      if (req.method === 'GET' && pathname === `${API_PREFIX}/entitlement`) {
        const session = requireSession(req, res); if (!session) return;
        return sendJson(res, 200, checkEntitlement());
      }

      // ── Public: login ────────────────────────────────────────────────────────
      if (req.method === 'POST' && pathname === `${API_PREFIX}/auth/login`) {
        let body;
        try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const ip = clientIp(req);
        const host = (body && body.hostname ? String(body.hostname) : '').slice(0, 80) || null;
        const r = await authenticator.login(getDb(), body);
        if (!r.ok) {
          if (r.code === 'RATE_LIMITED') return sendJson(res, 429, { error: r.error, retryAfterMs: r.retryAfterMs });
          if (r.code === 'MFA_REQUIRED') return sendJson(res, 401, { error: r.error, mfaRequired: true });
          audit({ action: 'login_failure', action_category: 'auth', outcome: 'failure', details: r.code, metadata: { ip, hostname: host } });
          return sendJson(res, 401, { error: r.error });
        }
        // Concurrent sticky-seat enforcement (only when the add-on is licensed).
        const seat = claimSeat(ctx, checkEntitlement, body, ip, host, r.user);
        if (seat && !seat.ok) {
          audit({ user_id: r.user.id, action: 'license.seat_denied', action_category: 'license', outcome: 'denied',
                  actor_username: r.user.username, metadata: { ip, hostname: host, inUse: seat.inUse, cap: seat.cap } });
          return sendJson(res, 409, { error: 'All client seats are in use — an administrator must release one to free a license.',
                  code: 'SEAT_LIMIT', inUse: seat.inUse, cap: seat.cap });
        }
        const { token, expiresAt } = sessions.issue({ userId: r.user.id, username: r.user.username, role: r.user.role, clientKey: seat ? seat.clientKey : null });
        audit({ user_id: r.user.id, action: 'login_success', action_category: 'auth', outcome: 'success',
                actor_username: r.user.username, actor_role: r.user.role, metadata: { ip, hostname: host } });
        return sendJson(res, 200, {
          token, expiresAt,
          user: { username: r.user.username, displayName: r.user.displayName, role: r.user.role },
        });
      }

      // ── Public: enroll — credential + entitlement gated. Collapses CA-fetch +
      //    login into one step: returns the CA to pin AND a session token. ──────────
      if (req.method === 'POST' && pathname === `${API_PREFIX}/enroll`) {
        const pr = pairingOk(url, learning, getDb());
        if (!pr.ok) return sendJson(res, 403, { error: pr.reason === 'expired' ? 'pairing code expired' : 'pairing code required', code: 'PAIRING' });
        const ent = checkEntitlement();
        if (!ent.entitled) return sendJson(res, 402, {
          error: 'The ScanFinder search client is not licensed for this server.',
          code: 'FEATURE_NOT_LICENSED', feature: ent.feature,
        });
        let body; try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const ip = clientIp(req);
        const host = (body && body.hostname ? String(body.hostname) : '').slice(0, 80) || null;
        const r = await authenticator.login(getDb(), body);
        if (!r.ok) {
          if (r.code === 'RATE_LIMITED') return sendJson(res, 429, { error: r.error, retryAfterMs: r.retryAfterMs });
          if (r.code === 'MFA_REQUIRED') return sendJson(res, 401, { error: r.error, mfaRequired: true });
          audit({ action: 'enroll_failure', action_category: 'auth', outcome: 'failure', details: r.code, metadata: { ip, hostname: host } });
          return sendJson(res, 401, { error: r.error });
        }
        // Concurrent sticky-seat enforcement (enroll is already entitlement-gated above).
        const seat = claimSeat(ctx, checkEntitlement, body, ip, host, r.user);
        if (seat && !seat.ok) {
          audit({ user_id: r.user.id, action: 'license.seat_denied', action_category: 'license', outcome: 'denied',
                  actor_username: r.user.username, metadata: { ip, hostname: host, inUse: seat.inUse, cap: seat.cap } });
          return sendJson(res, 409, { error: 'All client seats are in use — an administrator must release one to free a license.',
                  code: 'SEAT_LIMIT', inUse: seat.inUse, cap: seat.cap });
        }
        const prof = buildConnectionProfile(ctx);
        if (!prof.ok) return sendJson(res, 409, { error: 'no managed certificate', code: 'NO_MANAGED_CA' });
        const { token, expiresAt } = sessions.issue({ userId: r.user.id, username: r.user.username, role: r.user.role, clientKey: seat ? seat.clientKey : null });
        audit({ user_id: r.user.id, action: 'enroll_success', action_category: 'auth', outcome: 'success',
                actor_username: r.user.username, actor_role: r.user.role, metadata: { ip, hostname: host } });
        return sendJson(res, 200, {
          caPem: prof.profile.caPem, caFingerprintSha256: prof.profile.caFingerprintSha256,
          host: prof.profile.host, port: prof.profile.port,
          token, expiresAt,
          user: { username: r.user.username, displayName: r.user.displayName, role: r.user.role },
        });
      }

      // ── Auth-required: logout ─────────────────────────────────────────────────
      if (req.method === 'POST' && pathname === `${API_PREFIX}/auth/logout`) {
        const tok = bearerToken(req);
        const session = sessions.verify(tok);
        if (session) {
          audit({ user_id: session.userId, action: 'logout', action_category: 'auth', outcome: 'success' });
          try { presence.releaseAll(viewerKeyOf(session)); } catch { /* advisory */ }
        }
        sessions.revoke(tok);
        return sendJson(res, 200, { ok: true });
      }

      // ── Auth-required: self-service password change (so a client user who signed
      //    in with an admin-issued TEMP password can set their own). Verifies the
      //    current password; same 8–128 policy as the desktop self-service change. ──
      if (req.method === 'POST' && pathname === `${API_PREFIX}/auth/change-password`) {
        const session = requireSession(req, res); if (!session) return;
        let body; try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const pwMod = require('../auth/password');
        const user  = dbAuth.getUserById(getDb(), session.userId);
        if (!user) return sendJson(res, 401, { error: 'Account no longer exists.' });
        const cur = String((body && body.currentPassword) || '');
        const nw  = String((body && body.newPassword) || '');
        const ok  = await pwMod.verifyPassword(user.password_hash, cur);
        if (!ok) {
          audit({ user_id: user.id, action: 'password_change', action_category: 'auth', outcome: 'failure',
                  actor_username: user.username, details: 'client_bad_current' });
          return sendJson(res, 400, { error: 'Current password is incorrect.' });
        }
        if (nw.length < 8 || nw.length > 128) return sendJson(res, 400, { error: 'New password must be 8–128 characters.' });
        if (nw === cur) return sendJson(res, 400, { error: 'New password must be different from your current password.' });
        dbAuth.setUserPassword(getDb(), user.id, await pwMod.hashPassword(nw), false);
        audit({ user_id: user.id, action: 'password_change', action_category: 'auth', outcome: 'success',
                actor_username: user.username, details: 'self_service_client' });
        return sendJson(res, 200, { ok: true });
      }

      // ── Auth-required: TOTP enrolment (setup → returns secret; confirm → enables) ─
      if (req.method === 'POST' && pathname === `${API_PREFIX}/auth/totp/setup`) {
        const session = requireSession(req, res); if (!session) return;
        const secret = totp.generateSecret();
        dbAuth.setTotpSecret(getDb(), session.userId, secret);
        audit({ user_id: session.userId, action: 'totp_setup', action_category: 'auth', outcome: 'success' });
        return sendJson(res, 200, {
          secret,
          otpauthUri: totp.otpauthUri({ secret, label: session.username, issuer: TOTP_ISSUER }),
        });
      }
      if (req.method === 'POST' && pathname === `${API_PREFIX}/auth/totp/confirm`) {
        const session = requireSession(req, res); if (!session) return;
        let body; try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const row = dbAuth.getTotpForUser(getDb(), session.userId);
        if (!row || !row.totp_secret || !totp.verify(body.totp, row.totp_secret)) {
          return sendJson(res, 400, { error: 'Invalid authentication code.' });
        }
        dbAuth.setTotpEnabled(getDb(), session.userId, 1);
        audit({ user_id: session.userId, action: 'totp_enabled', action_category: 'auth', outcome: 'success' });
        return sendJson(res, 200, { ok: true });
      }

      // ── Auth-required: search ─────────────────────────────────────────────────
      if (req.method === 'POST' && pathname === `${API_PREFIX}/search`) {
        const session = requireSession(req, res); if (!session) return;
        let params; try { params = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const result = searchService.searchDocuments({ db: getDb(), params, role: session.role });
        // Audit that a search happened (counts only — never the query terms, which
        // could be sensitive). Completes audit coverage for compliance review.
        audit({ user_id: session.userId, action: 'search', action_category: 'document', outcome: 'success',
                metadata: { confirmed: result.confirmed.length, uncommitted: result.uncommitted.length } });
        return sendJson(res, 200, dto.projectSearchResult(result));
      }

      // ── Auth-required: document detail ────────────────────────────────────────
      const detailMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)$`));
      if (req.method === 'GET' && detailMatch) {
        const session = requireSession(req, res); if (!session) return;
        const id = Number(detailMatch[1]);
        const doc = previewService.getDocumentDetail(getDb(), id, { learning });
        if (!doc) return sendJson(res, 404, { error: 'not found' });
        audit({ user_id: session.userId, action: 'document_open', action_category: 'document',
                outcome: 'success', document_id: id });
        return sendJson(res, 200, dto.projectDocumentDetail(doc));
      }

      // ── Auth-required: document pages ─────────────────────────────────────────
      const pagesMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/pages$`));
      if (req.method === 'GET' && pagesMatch) {
        const session = requireSession(req, res); if (!session) return;
        const id = Number(pagesMatch[1]);
        // SECURITY (F-02): the on-disk location is resolved SERVER-SIDE from the
        // document row ONLY — client-supplied folderPath/filename are NOT read here.
        // A detached client never sees filesystem paths; honouring them would let an
        // authenticated peer (any role, including readonly) read arbitrary host files
        // through the render path, defeating the dto.js path-hiding boundary. The
        // precedence mirrors the in-process preview: app-managed working copy →
        // filed copy → recorded source.
        let folderPath = null, filename = null;
        const P = ctx.path || require('path');
        const row = getDb().prepare(
          'SELECT working_path, stored_path, folder_path, original_filename FROM documents WHERE id = ?').get(id);
        if (row) {
          const pick = row.working_path || row.stored_path
            || (row.folder_path && row.original_filename ? P.join(row.folder_path, row.original_filename) : null);
          if (pick) { folderPath = P.dirname(pick); filename = P.basename(pick); }
        }
        const pages = await previewService.getDocumentPages(
          getDb(), { docId: id, folderPath, filename }, pageDeps());
        return sendJson(res, 200, { pages });
      }

      // ── Auth-required: single page-1 thumbnail (for list rows) ────────────────
      const thumbMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/thumbnail$`));
      if (req.method === 'GET' && thumbMatch) {
        const session = requireSession(req, res); if (!session) return;
        const id = Number(thumbMatch[1]);
        // Same server-side path resolution as /pages (F-02): never trust client paths.
        let folderPath = null, filename = null;
        const P = ctx.path || require('path');
        const row = getDb().prepare(
          'SELECT working_path, stored_path, folder_path, original_filename FROM documents WHERE id = ?').get(id);
        if (row) {
          const pick = row.working_path || row.stored_path
            || (row.folder_path && row.original_filename ? P.join(row.folder_path, row.original_filename) : null);
          if (pick) { folderPath = P.dirname(pick); filename = P.basename(pick); }
        }
        const thumbnail = await previewService.getThumbnail(
          getDb(), { docId: id, folderPath, filename }, pageDeps());
        return sendJson(res, 200, { thumbnail });
      }

      // ── Auth-required: RECYCLE BIN (soft delete / restore / purge) ────────────
      // Delete is recoverable (status='deleted', files kept) — Admin/Edit. Permanent
      // removal (purge) is Admin only. Every action is audited; the on-disk path is
      // resolved SERVER-SIDE only (never from the client) when purging.
      const isWriter = (s) => s.role === 'admin' || s.role === 'edit';

      // ── Auth-required (writer): CORRECTION-ONLY targeting — zone-OCR a client-cropped
      // region → return TEXT so the reviewer can fill a field without typing. The client
      // sends a small cropped PNG (a region of the page preview it already has); we run
      // the SAME python_backend/ocr/region.py the desktop ⊕ tool uses, UNCHANGED, and
      // return text ONLY. There is NO file resolution (the input is the client's pixels,
      // so there is no path to leak), NO learning, NO anchors/templates — it cannot touch
      // the extraction or learning pipeline. The doc id scopes the audit row only. Bounded
      // by the 1 MB body cap + an in-flight concurrency cap (429).
      const ocrRegionMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/ocr-region$`));
      if (req.method === 'POST' && ocrRegionMatch) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        if (_ocrInFlight >= OCR_MAX_INFLIGHT) return sendJson(res, 429, { error: 'too many OCR requests — retry' });
        let body; try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const b64 = (body && typeof body.imageBase64 === 'string') ? body.imageBase64 : '';
        if (!b64) return sendJson(res, 400, { error: 'imageBase64 (a small cropped PNG) is required' });
        const osMod = require('os'); const fsx = ctx.fs || require('fs'); const P = ctx.path || path;
        const tmp = P.join(osMod.tmpdir(), `ds_v1ocr_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
        try { fsx.writeFileSync(tmp, Buffer.from(b64, 'base64')); }
        catch { return sendJson(res, 400, { error: 'bad image data' }); }
        const script = ctx.resourcePath('python_backend', 'ocr', 'region.py');
        _ocrInFlight++;
        let done = false;
        const finish = (status, payload) => {
          if (done) return; done = true; _ocrInFlight--;
          try { fsx.unlinkSync(tmp); } catch {}
          sendJson(res, status, payload);
        };
        try {
          const proc = (ctx.spawn || require('child_process').spawn)(ctx.pythonExe(),
            ctx.pythonArgs(script, '--image-file', tmp, '--tesseract', ctx.tesseractPath()),
            { windowsHide: true });
          let out = '', err = '';
          proc.stdout.on('data', d => { out += d.toString(); });
          proc.stderr.on('data', d => { err += d.toString(); });
          proc.on('close', () => { if (err) { try { log('v1 ocr-region stderr: ' + err.trim()); } catch {} } finish(200, { text: out.trim() }); });
          proc.on('error', (e) => { try { log('v1 ocr-region spawn error: ' + e.message); } catch {} finish(500, { error: 'ocr failed' }); });
        } catch (e) { finish(500, { error: 'ocr failed' }); }
        try { audit({ user_id: session.userId, action: 'ocr_region', action_category: 'document',
                      outcome: 'success', document_id: Number(ocrRegionMatch[1]), metadata: { via: 'client' } }); } catch {}
        return;
      }

      if (req.method === 'GET' && pathname === `${API_PREFIX}/documents/deleted`) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const rows = documents.getDeletedQueue(getDb());
        return sendJson(res, 200, { deleted: dto.projectSearchResult({ confirmed: rows, uncommitted: [] }).confirmed });
      }

      const delMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/delete$`));
      if (req.method === 'POST' && delMatch) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const id = Number(delMatch[1]);
        documents.softDelete(getDb(), id);
        audit({ user_id: session.userId, action: 'document_deleted', action_category: 'document',
                outcome: 'success', document_id: id, metadata: { soft: true, via: 'client' } });
        return sendJson(res, 200, { ok: true });
      }

      const restoreMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/restore$`));
      if (req.method === 'POST' && restoreMatch) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const id = Number(restoreMatch[1]);
        documents.restoreDeleted(getDb(), id);
        audit({ user_id: session.userId, action: 'document_restored', action_category: 'document',
                outcome: 'success', document_id: id, metadata: { via: 'client' } });
        return sendJson(res, 200, { ok: true });
      }

      const purgeMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/purge$`));
      if (req.method === 'POST' && purgeMatch) {
        const session = requireSession(req, res); if (!session) return;
        if (session.role !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
        const id = Number(purgeMatch[1]);
        _purgeDocFiles(getDb(), id);
        documents.deleteDoc(getDb(), id);
        audit({ user_id: session.userId, action: 'document_purged', action_category: 'document',
                outcome: 'success', document_id: id, metadata: { via: 'client' } });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && pathname === `${API_PREFIX}/documents/purge-all`) {
        const session = requireSession(req, res); if (!session) return;
        if (session.role !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
        const ids = documents.getDeletedQueue(getDb()).map(d => d.id);
        for (const id of ids) { _purgeDocFiles(getDb(), id); documents.deleteDoc(getDb(), id); }
        audit({ user_id: session.userId, action: 'recycle_bin_emptied', action_category: 'document',
                outcome: 'success', metadata: { count: ids.length, via: 'client' } });
        return sendJson(res, 200, { purged: ids.length });
      }

      // ── Auth-required: mailbox / approval workflow ────────────────────────────
      const wfList = pathname.match(new RegExp(`^${API_PREFIX}/workflow/(inbox|sent|assigned|completed)$`));
      if (req.method === 'GET' && wfList) {
        const session = requireSession(req, res); if (!session) return;
        const rows = workflow[wfList[1]](getDb(), actorOf(session));
        return sendJson(res, 200, { routes: dto.projectRoutes(rows) });
      }

      // Assignable recipients (active users) — only roles that can route may list them.
      if (req.method === 'GET' && pathname === `${API_PREFIX}/workflow/recipients`) {
        const session = requireSession(req, res); if (!session) return;
        if (!(session.role === 'admin' || session.role === 'edit')) return sendJson(res, 403, { error: 'forbidden' });
        const users = (dbAuth.getAllUsers(getDb()) || [])
          .filter(u => u.is_active)
          .map(u => ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role }));
        return sendJson(res, 200, { recipients: users });
      }

      // Create a route (assign).
      if (req.method === 'POST' && pathname === `${API_PREFIX}/workflow/routes`) {
        const session = requireSession(req, res); if (!session) return;
        let body; try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const r = workflow.assign(getDb(), actorOf(session), body);
        return r.ok ? sendJson(res, 200, { route: dto.projectRoute(r.route) })
                    : sendJson(res, wfStatus(r.code), { error: r.error, code: r.code });
      }

      // Stamped-copy pages of a resolved decision, by route id. The stamped_path is
      // resolved SERVER-SIDE (never sent to the client, mirroring the doc-pages boundary);
      // only a party to the route (sender/recipient) or an admin may view it.
      const wfStamp = pathname.match(new RegExp(`^${API_PREFIX}/workflow/routes/(\\d+)/stamped$`));
      if (req.method === 'GET' && wfStamp) {
        const session = requireSession(req, res); if (!session) return;
        const route = require('../../../database/modules/workflow').getRoute(getDb(), Number(wfStamp[1]));
        if (!route || !route.stamped_path) return sendJson(res, 404, { error: 'no stamped copy' });
        if (!(session.userId === route.to_user_id || session.userId === route.from_user_id || session.role === 'admin')) {
          return sendJson(res, 403, { error: 'forbidden' });
        }
        const P = ctx.path || require('path');
        if (!require('fs').existsSync(route.stamped_path)) return sendJson(res, 404, { error: 'stamped copy missing' });
        const pages = await previewService.getDocumentPages(getDb(), {
          docId: route.document_id, folderPath: P.dirname(route.stamped_path),
          filename: P.basename(route.stamped_path), exact: true,
        }, pageDeps());
        return sendJson(res, 200, { pages });
      }

      // Transition a route: claim | resolve | recall.
      const wfAct = pathname.match(new RegExp(`^${API_PREFIX}/workflow/routes/(\\d+)/(claim|resolve|recall)$`));
      if (req.method === 'POST' && wfAct) {
        const session = requireSession(req, res); if (!session) return;
        const id = Number(wfAct[1]);
        let body; try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const actor = actorOf(session);
        let r;
        if (wfAct[2] === 'claim')   r = workflow.claim(getDb(), actor, id, body.version);
        else if (wfAct[2] === 'recall') r = workflow.recall(getDb(), actor, id, body.version);
        else r = workflow.resolve(getDb(), actor, id, { decision: body.decision, comment: body.comment, expectedVersion: body.version });
        return r.ok ? sendJson(res, 200, { route: dto.projectRoute(r.route) })
                    : sendJson(res, wfStatus(r.code), { error: r.error, code: r.code });
      }

      // ── Auth-required: REVIEW QUEUE + confirm / defer / undefer (Admin/Edit) ───
      // The detached client clears the SHARED needs_review queue. Role-gated server-side
      // (not UI-only); confirm resolves on-disk locations from the doc row (F-02) and routes
      // through the SAME race-safe reviewService the desktop uses (claim-before-file → the loser
      // of a race gets 409 ALREADY_FILED). Field VALUES travel in the body; paths never do.
      if (req.method === 'GET' && pathname === `${API_PREFIX}/review/queue`) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const rows = dto.projectReviewQueue(reviewSvc.queue(getDb()));
        const selfKey = viewerKeyOf(session);
        for (const r of rows) r.viewers = presence.viewers(r.id, selfKey);   // who else is in each doc
        return sendJson(res, 200, { queue: rows });
      }
      if (req.method === 'GET' && pathname === `${API_PREFIX}/review/deferred`) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const rows = dto.projectReviewQueue(reviewSvc.deferred(getDb()));
        const selfKey = viewerKeyOf(session);
        for (const r of rows) r.viewers = presence.viewers(r.id, selfKey);
        return sendJson(res, 200, { deferred: rows });
      }
      if (req.method === 'GET' && pathname === `${API_PREFIX}/review/counts`) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        return sendJson(res, 200, reviewSvc.counts(getDb()));
      }

      // Document types + field definitions (review type dropdown, required-field highlighting).
      if (req.method === 'GET' && pathname === `${API_PREFIX}/doc-types`) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        return sendJson(res, 200, { types: dto.projectDocTypes(doctypes.getAllWithFieldsAll(getDb())) });
      }

      // Confirm / file a reviewed document.
      const confirmMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/confirm$`));
      if (req.method === 'POST' && confirmMatch) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const id = Number(confirmMatch[1]);
        // Multi-point licensing enforcement (filing is a high-value write path).
        if (require('../licensing/handler').licenseDenied(getDb())) {
          return sendJson(res, 403, { error: 'A valid license is required to file documents.', code: 'LICENSE' });
        }
        // Workflow lock: a routed doc can't be reviewed/filed (admin override audited by the guard).
        const guard = workflowService.editGuard(getDb(), id, session.role);
        if (!guard.ok) return sendJson(res, 409, { error: guard.error, code: guard.code });
        let body; try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        if (!_isFlatValues(body.allValues) || !_isCorrections(body.corrections)) {
          return sendJson(res, 400, { error: 'invalid field values' });
        }
        // SECURITY (F-02): the on-disk source is resolved SERVER-SIDE from the doc row — the body
        // carries field VALUES only, never paths.
        const row = getDb().prepare('SELECT folder_path, original_filename FROM documents WHERE id = ?').get(id);
        if (!row) return sendJson(res, 404, { error: 'not found' });
        const slug = body.document_type_slug ? String(body.document_type_slug) : null;
        if (slug && !doctypes.getWithFields(getDb(), slug)) return sendJson(res, 400, { error: 'unknown document type' });
        const r = await reviewSvc.confirm(getDb(), actorOf(session), {
          document_id: id,
          folder_path: row.folder_path,
          original_filename: row.original_filename,
          corrections: body.corrections || {},
          allValues: body.allValues || {},
          supplier_name: body.supplier_name || null,
          document_type: body.document_type || null,
          document_type_slug: slug,
          taught_fields: [],   // the client never teaches
          bulk: false,
          // allowRefile deliberately OMITTED (server-decided, never client-supplied): the client
          // only ever confirms QUEUE items, so a confirm on an already-filed doc must lose the race
          // (ALREADY_FILED), not silently re-file/overwrite. A malicious body can't opt into re-file.
        });
        if (!r.ok) {
          const status = (r.code === 'ALREADY_FILED' || r.code === 'NO_OUTPUT') ? 409 : 400;
          return sendJson(res, status, { error: r.error, code: r.code || null, ...(r.confirmedBy ? { confirmedBy: r.confirmedBy } : {}) });
        }
        // DTO: filename only — never filePath/metadataPath/srcPath.
        return sendJson(res, 200, { success: true, filename: r.filename, isDuplicate: !!r.isDuplicate });
      }

      // Defer a reviewed document.
      const deferMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/defer$`));
      if (req.method === 'POST' && deferMatch) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const id = Number(deferMatch[1]);
        const guard = workflowService.editGuard(getDb(), id, session.role);
        if (!guard.ok) return sendJson(res, 409, { error: guard.error, code: guard.code });
        const r = reviewSvc.defer(getDb(), actorOf(session), id);
        return r.ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 409, { error: r.error, code: r.code });
      }

      // Restore a deferred document to the review queue (distinct from the recycle-bin /restore).
      const undeferMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/undefer$`));
      if (req.method === 'POST' && undeferMatch) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const id = Number(undeferMatch[1]);
        const guard = workflowService.editGuard(getDb(), id, session.role);
        if (!guard.ok) return sendJson(res, 409, { error: guard.error, code: guard.code });
        const r = reviewSvc.restore(getDb(), actorOf(session), id);
        return r.ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 409, { error: r.error, code: r.code });
      }

      // ── Presence: "I'm viewing this doc" heartbeat + release (advisory) ────────
      // Register/refresh the caller as a viewer and return the OTHER viewers for the banner.
      // The client beats this ~every 25s while a doc is open; a hard disconnect is reaped by TTL.
      const viewingMatch = pathname.match(new RegExp(`^${API_PREFIX}/review/(\\d+)/viewing$`));
      if (req.method === 'POST' && viewingMatch) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const id = Number(viewingMatch[1]);
        presence.heartbeat(id, viewerOf(session));
        return sendJson(res, 200, { viewers: presence.viewers(id, viewerKeyOf(session)) });
      }
      const releaseViewMatch = pathname.match(new RegExp(`^${API_PREFIX}/review/(\\d+)/release$`));
      if (req.method === 'POST' && releaseViewMatch) {
        const session = requireSession(req, res); if (!session) return;
        presence.release(Number(releaseViewMatch[1]), viewerKeyOf(session));
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      log(`[api] request error: ${e && e.message}`);
      return sendJson(res, 500, { error: 'internal error' });
    }
  };
}

/** Build (but do not start) an HTTP server over the request listener. */
function createServer(ctx) {
  return http.createServer(createRequestListener(ctx));
}

// Effective config: env overrides persisted settings. Enabled when EITHER the env
// flag or the `client_api_enabled` setting is on. Host/port/TLS likewise merge.
function resolveApiConfig(ctx) {
  let s = {};
  try {
    const learning = require('../../../database/modules/learning');
    const db = ctx.getDb();
    s = {
      enabled: learning.getSetting(db, 'client_api_enabled') === 'true',
      host: learning.getSetting(db, 'client_api_host'),
      port: parseInt(learning.getSetting(db, 'client_api_port'), 10),
      cert: learning.getSetting(db, 'client_api_tls_cert'),
      key: learning.getSetting(db, 'client_api_tls_key'),
    };
  } catch { /* DB not ready — fall back to env/defaults */ }
  return {
    enabled: process.env.SCANFINDER_API === '1' || !!s.enabled,
    host: process.env.SCANFINDER_API_HOST || s.host || '127.0.0.1',
    port: parseInt(process.env.SCANFINDER_API_PORT, 10) || s.port || 8765,
    certPath: process.env.SCANFINDER_API_TLS_CERT || s.cert || null,
    keyPath: process.env.SCANFINDER_API_TLS_KEY || s.key || null,
  };
}

function apiStatus(ctx) {
  const cfg = resolveApiConfig(ctx);
  return {
    running: !!(ctx._apiServer && ctx._apiServer.listening),
    enabled: cfg.enabled, host: cfg.host, port: cfg.port,
    tls: !!(cfg.certPath && cfg.keyPath),
  };
}

// Start the listener (idempotent). Refuses a non-loopback bind without TLS.
function startApiServer(ctx) {
  if (ctx._apiServer && ctx._apiServer.listening) return apiStatus(ctx);
  const cfg = resolveApiConfig(ctx);
  // When the admin deliberately binds a non-loopback host (LAN exposure, which
  // also requires TLS below), permit non-loopback peers — otherwise the listener's
  // defence-in-depth loopback guard would 403 every LAN client.
  ctx.allowRemote = (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost');
  const listener = createRequestListener(ctx);
  let server;
  if (cfg.certPath && cfg.keyPath) {
    const fs = ctx.fs || require('fs');
    server = https.createServer({ cert: fs.readFileSync(cfg.certPath), key: fs.readFileSync(cfg.keyPath) }, listener);
  } else {
    if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') {
      ctx.logger?.warn?.('[api] refusing to bind a non-loopback host without TLS — set a TLS cert/key first');
      return { ...apiStatus(ctx), error: 'tls_required_for_lan' };
    }
    server = http.createServer(listener);
  }
  server.on('error', (e) => ctx.logger?.warn?.(`[api] server error: ${e.message}`));
  server.listen(cfg.port, cfg.host, () => {
    ctx.logger?.log?.(`[api] detached-client API on ${cfg.certPath ? 'https' : 'http'}://${cfg.host}:${cfg.port}${API_PREFIX}`);
  });
  ctx._apiServer = server;
  return apiStatus(ctx);
}

function stopApiServer(ctx) {
  if (ctx._apiServer) { try { ctx._apiServer.close(); } catch { /* ignore */ } ctx._apiServer = null; }
  return apiStatus(ctx);
}

// ── Managed TLS certificate (Certificate Wizard) ───────────────────────────────
// Self-managed certs so an admin never hand-manages TLS: detect the server's LAN
// identities, generate a CA + server cert into userData/certs (certService), and
// point the existing client_api_tls_cert/key settings at them. ctx.certsDir
// overrides the location (hermetic tests).

function certsDirFor(ctx) {
  if (ctx.certsDir) return ctx.certsDir;
  let base;
  try { base = (ctx.app || require('electron').app).getPath('userData'); }
  catch { base = require('os').tmpdir(); }
  return path.join(base, 'certs');
}

// Addresses a client could connect to: the configured host (if a real IP), every
// detected LAN IPv4, and the hostname. 0.0.0.0 / :: are bind wildcards, not SANs.
function managedSans(ctx, host) {
  const ids = certService.detectLanIdentities({});
  const out = [];
  const add = (v) => {
    v = String(v || '').trim();
    if (v && !['0.0.0.0', '::', '127.0.0.1', 'localhost'].includes(v) && !out.includes(v)) out.push(v);
  };
  add(host);
  ids.ipv4.forEach(add);
  add(ids.hostname);
  return out;
}

function managedCertStatus(ctx) {
  const cfg = resolveApiConfig(ctx);
  const fs = ctx.fs || require('fs');
  const certsDir = certsDirFor(ctx);
  const sans = managedSans(ctx, cfg.host);
  const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };
  const loopback = (cfg.host === '127.0.0.1' || cfg.host === 'localhost');
  const hasCert = exists(cfg.certPath);
  let cover = { valid: false, missingSans: sans, expired: false, notAfter: null };
  if (hasCert) cover = certService.certCoversAddresses({ serverCrtPath: cfg.certPath, addresses: sans, fs });
  let caFingerprint = null;
  try { const caCrt = path.join(certsDir, 'ca.crt'); if (exists(caCrt)) caFingerprint = certService.readCaFingerprint({ caCrtPath: caCrt, fs }); }
  catch { /* ignore */ }
  return {
    loopback, host: cfg.host, port: cfg.port, hasCert,
    valid: cover.valid, missingSans: cover.missingSans, expired: cover.expired,
    notAfter: cover.notAfter ? new Date(cover.notAfter).toISOString() : null,
    sans, caFingerprint, certsDir,
  };
}

// Ensure a valid managed cert exists for the current LAN host and the TLS settings
// point at it (generate/rotate as needed). No-op for a loopback host.
function ensureManagedCert(ctx, { force = false } = {}) {
  const cfg = resolveApiConfig(ctx);
  if (cfg.host === '127.0.0.1' || cfg.host === 'localhost') return { managed: false, reason: 'loopback', ...managedCertStatus(ctx) };
  const fs = ctx.fs || require('fs');
  const sans = managedSans(ctx, cfg.host);
  if (!sans.length) return { managed: false, reason: 'no_addresses', ...managedCertStatus(ctx) };

  const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };
  const rp = (p) => { try { return p ? path.resolve(p) : null; } catch { return null; } };
  const managedCrt = path.join(certsDirFor(ctx), 'server.crt');

  // Respect an admin's own (Advanced) certificate living outside the managed dir —
  // only the explicit "Generate / re-issue" button (force) ever overrides it.
  const isManual = cfg.certPath && rp(cfg.certPath) !== rp(managedCrt) && exists(cfg.certPath);
  if (!force && isManual) return { managed: false, reason: 'manual', ...managedCertStatus(ctx) };

  // Managed cert already present, pointed at, and still covering → nothing to do.
  const covering = exists(managedCrt) && certService.certCoversAddresses({ serverCrtPath: managedCrt, addresses: sans, fs }).valid;
  if (!force && covering && rp(cfg.certPath) === rp(managedCrt)) return { managed: true, regenerated: false, ...managedCertStatus(ctx) };

  const r = certService.generateServerCerts({ certsDir: certsDirFor(ctx), sans, reuseCa: true, fs });
  const db = ctx.getDb();
  const learning = require('../../../database/modules/learning');
  learning.setSetting(db, 'client_api_tls_cert', r.serverCrtPath);
  learning.setSetting(db, 'client_api_tls_key', r.serverKeyPath);
  learning.setSetting(db, 'client_api_ca_fingerprint', r.caFingerprintSha256);
  learning.setSetting(db, 'client_api_cert_sans', r.serverSans.join(','));
  ctx.logger?.log?.(`[api] managed certificate ${r.caReused ? 're-issued' : 'created'} — SANs: ${r.serverSans.join(', ')}`);
  return { managed: true, regenerated: true, ...managedCertStatus(ctx) };
}

// A connectable host for the profile: the configured host if it's a real address,
// else the first detected LAN IPv4 (0.0.0.0 is a bind wildcard, not connectable).
function connectionProfileHost(cfg) {
  if (cfg.host && !['0.0.0.0', '::', '127.0.0.1', 'localhost'].includes(cfg.host)) return cfg.host;
  const ids = certService.detectLanIdentities({});
  return ids.ipv4[0] || ids.hostname || cfg.host;
}

// Build a one-click connection profile (host + port + CA to pin) for clients.
// Uses the managed CA (certsDir/ca.crt); a purely manual setup distributes its own CA.
function buildConnectionProfile(ctx) {
  const cfg = resolveApiConfig(ctx);
  const fs = ctx.fs || require('fs');
  const caCrt = path.join(certsDirFor(ctx), 'ca.crt');
  const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };
  if (!exists(caCrt)) return { ok: false, error: 'no_managed_ca' };
  const caPem = fs.readFileSync(caCrt, 'utf8');
  return {
    ok: true,
    profile: {
      v: 1,
      host: connectionProfileHost(cfg),
      port: cfg.port,
      tls: true,
      caFingerprintSha256: certService.readCaFingerprint({ pem: caPem }),
      caPem,
    },
  };
}

// Optional pairing-code gate for the CA-bootstrap/enroll endpoints. When a code is
// configured (client_api_pairing_code), callers must present a matching ?code= and
// the code must not be expired; otherwise the gate is open (a CA cert is public).
function pairingOk(url, learning, db) {
  let code = null, exp = null;
  try { code = learning.getSetting(db, 'client_api_pairing_code'); } catch { /* ignore */ }
  if (!code) return { ok: true };
  try { exp = learning.getSetting(db, 'client_api_pairing_expires'); } catch { /* ignore */ }
  if (exp && Date.now() > Number(exp)) return { ok: false, reason: 'expired' };
  // Constant-time compare of the pairing code (no early-exit timing side-channel). The
  // length pre-check both guards timingSafeEqual (which throws on unequal lengths) and is a
  // negligible leak for a short-lived pairing secret.
  const provided = url.searchParams.get('code') || '';
  let match = false;
  try {
    const a = Buffer.from(provided), b = Buffer.from(String(code));
    match = a.length === b.length && require('crypto').timingSafeEqual(a, b);
  } catch { match = false; }
  return match ? { ok: true } : { ok: false, reason: 'bad_code' };
}

/**
 * App entry point. The API is OFF by default; it starts when the env flag
 * SCANFINDER_API=1 OR the admin `client_api_enabled` setting is on. Admin IPC lets
 * the Settings window start/stop it at runtime. Loopback-only unless TLS is set.
 */
function register(ctx) {
  const { ipcMain, getDb } = ctx;
  const learning = require('../../../database/modules/learning');
  const { requireRole } = require('../auth/handler');

  ipcMain.handle('client-api-get-status', () => { requireRole('admin'); return apiStatus(ctx); });
  ipcMain.handle('client-api-set-enabled', (_e, on) => {
    requireRole('admin');
    learning.setSetting(getDb(), 'client_api_enabled', on ? 'true' : 'false');
    if (!on) return stopApiServer(ctx);
    // Certificate Wizard: auto-provision a managed TLS cert when exposing on the LAN.
    const cfg = resolveApiConfig(ctx);
    if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') ensureManagedCert(ctx);
    return startApiServer(ctx);
  });
  ipcMain.handle('client-api-cert-status', () => { requireRole('admin'); return managedCertStatus(ctx); });
  ipcMain.handle('client-api-cert-generate', () => {
    requireRole('admin');
    const res = ensureManagedCert(ctx, { force: true });
    if (ctx._apiServer && ctx._apiServer.listening) { stopApiServer(ctx); startApiServer(ctx); } // reload cert
    return res;
  });
  ipcMain.handle('client-api-cert-export', async () => {
    requireRole('admin');
    const r = buildConnectionProfile(ctx);
    if (!r.ok) return r;
    const { dialog } = require('electron');
    const res = await dialog.showSaveDialog({
      title: 'Export connection profile',
      defaultPath: 'scanfinder-profile.json',
      filters: [{ name: 'ScanFinder profile', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    (ctx.fs || require('fs')).writeFileSync(res.filePath, JSON.stringify(r.profile, null, 2));
    return { ok: true, path: res.filePath, caFingerprintSha256: r.profile.caFingerprintSha256 };
  });

  // ── Concurrent client-seat pool (admin) ────────────────────────────────────────
  // Licensed seat count + the active (sticky) leases in use, and an admin release.
  ipcMain.handle('license-seats-status', () => {
    requireRole('admin');
    const ent = entitlementService.checkClientEntitlement(getDb());
    const leases = ctx.seatPool ? ctx.seatPool.list() : [];
    const wfInUse  = leases.filter(l => l.workflowEnabled).length;
    const search   = ent.search   || { entitled: ent.entitled, seats: ent.seats };
    const workflow = ent.workflow || { entitled: false, seats: 0 };
    return {
      entitled: ent.entitled, feature: ent.feature, seats: ent.seats,
      inUse: leases.length, free: Math.max(0, ent.seats - leases.length),
      // Per-feature (Stage 2 display): search = the base concurrent seat pool;
      // workflow = the add-on sub-seats held ON a search seat (workflow <= search).
      search:   { seats: search.seats,   inUse: leases.length, free: Math.max(0, search.seats - leases.length) },
      workflow: { seats: workflow.seats, inUse: wfInUse,        free: Math.max(0, workflow.seats - wfInUse) },
      leases,
    };
  });
  ipcMain.handle('license-seat-release', (_e, seatId) => {
    requireRole('admin');
    const ok = ctx.seatPool ? ctx.seatPool.release(seatId) : false;
    try {
      require('../../../database/modules/auth').addAuditEntry(getDb(), {
        source: 'desktop', action: 'license.seat_released', action_category: 'license',
        outcome: ok ? 'success' : 'failure', target_type: 'seat', target_id: String(seatId),
        user_id: require('../auth/handler').getCurrentUser()?.id ?? null,
      });
    } catch { /* audit best-effort */ }
    return { ok };
  });

  // Startup: self-heal the managed cert (e.g. a DHCP IP change across a reboot) then start.
  if (resolveApiConfig(ctx).enabled) {
    const cfg = resolveApiConfig(ctx);
    if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost') ensureManagedCert(ctx);
    startApiServer(ctx);
  }
}

module.exports = {
  register, createServer, createRequestListener,
  startApiServer, stopApiServer, apiStatus,
  ensureManagedCert, managedCertStatus, buildConnectionProfile,
  API_CONTRACT_VERSION, API_PREFIX,
};
