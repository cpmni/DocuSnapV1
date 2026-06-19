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
const dto            = require('../../services/dto');
const sessionService    = require('../../services/sessionService');
const authService       = require('../../services/authService');
const workflowService   = require('../../services/workflowService');
const entitlementService = require('../../services/entitlementService');
const totp              = require('../../lib/totp');

// Map a workflowService error code to an HTTP status.
const WF_HTTP = { FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409 };
const wfStatus = (code) => WF_HTTP[code] || 400;

const API_CONTRACT_VERSION = '1.0.0';
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
const TOTP_ISSUER = 'ScanFinder';
const MAX_BODY_BYTES = 1 * 1024 * 1024;

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
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
  const sessions = ctx.sessionStore || sessionService.createSessionStore();
  const authenticator = ctx.authenticator || authService.createAuthenticator();

  const audit = (entry) => {
    try { dbAuth.addAuditEntry(getDb(), { source: 'client_api', ...entry }); }
    catch (e) { log(`[api] audit write failed: ${e && e.message}`); }
  };

  const workflow = ctx.workflowService || workflowService.createWorkflowService({ audit });
  const actorOf = (session) => ({ userId: session.userId, username: session.username, role: session.role });

  // Detached-client add-on entitlement (ctx may override for tests/demo).
  const checkEntitlement = ctx.checkEntitlement || (() => entitlementService.checkClientEntitlement(getDb()));
  // Routes that expose the licensed feature itself (gated); auth/health/entitlement are not.
  const FEATURE_ROUTE = new RegExp(`^${API_PREFIX}/(search|documents|workflow)(/|$)`);

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

      // Lockstep handshake gate: refuse an incompatible client (health stays open).
      if (pathname !== `${API_PREFIX}/health` && !clientContractCompatible(req.headers[CLIENT_CONTRACT_HEADER])) {
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
        if (!ent.entitled) {
          return sendJson(res, 402, {
            error: 'The ScanFinder search client is not licensed for this server.',
            code: 'FEATURE_NOT_LICENSED', feature: ent.feature,
          });
        }
      }

      // ── Public: health ───────────────────────────────────────────────────────
      if (req.method === 'GET' && pathname === `${API_PREFIX}/health`) {
        return sendJson(res, 200, { ok: true, contract: 'v1', contractVersion: API_CONTRACT_VERSION });
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
        const r = await authenticator.login(getDb(), body);
        if (!r.ok) {
          if (r.code === 'RATE_LIMITED') return sendJson(res, 429, { error: r.error, retryAfterMs: r.retryAfterMs });
          if (r.code === 'MFA_REQUIRED') return sendJson(res, 401, { error: r.error, mfaRequired: true });
          audit({ action: 'login_failure', action_category: 'auth', outcome: 'failure', details: r.code });
          return sendJson(res, 401, { error: r.error });
        }
        const { token, expiresAt } = sessions.issue({ userId: r.user.id, username: r.user.username, role: r.user.role });
        audit({ user_id: r.user.id, action: 'login_success', action_category: 'auth', outcome: 'success',
                actor_username: r.user.username, actor_role: r.user.role });
        return sendJson(res, 200, {
          token, expiresAt,
          user: { username: r.user.username, displayName: r.user.displayName, role: r.user.role },
        });
      }

      // ── Auth-required: logout ─────────────────────────────────────────────────
      if (req.method === 'POST' && pathname === `${API_PREFIX}/auth/logout`) {
        const tok = bearerToken(req);
        const session = sessions.verify(tok);
        if (session) audit({ user_id: session.userId, action: 'logout', action_category: 'auth', outcome: 'success' });
        sessions.revoke(tok);
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
        let folderPath = url.searchParams.get('folderPath');
        let filename   = url.searchParams.get('filename');
        // A detached client never sees filesystem paths, so it can't pass them.
        // Resolve a usable location SERVER-SIDE from the document row (preferring
        // the app-managed working copy, then the filed copy, then the source).
        if (!folderPath || !filename) {
          const P = ctx.path || require('path');
          const row = getDb().prepare(
            'SELECT working_path, stored_path, folder_path, original_filename FROM documents WHERE id = ?').get(id);
          if (row) {
            const pick = row.working_path || row.stored_path
              || (row.folder_path && row.original_filename ? P.join(row.folder_path, row.original_filename) : null);
            if (pick) { folderPath = folderPath || P.dirname(pick); filename = filename || P.basename(pick); }
          }
        }
        const pages = await previewService.getDocumentPages(
          getDb(), { docId: id, folderPath, filename }, pageDeps());
        return sendJson(res, 200, { pages });
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

/**
 * App entry point. Inert unless SCANFINDER_API=1. Loopback by default; uses HTTPS
 * when SCANFINDER_API_TLS_CERT/KEY are provided (required before any LAN exposure).
 */
function register(ctx) {
  if (process.env.SCANFINDER_API !== '1') return;

  const port = parseInt(process.env.SCANFINDER_API_PORT, 10) || 8765;
  const host = process.env.SCANFINDER_API_HOST || '127.0.0.1';
  const listener = createRequestListener(ctx);

  const certPath = process.env.SCANFINDER_API_TLS_CERT;
  const keyPath  = process.env.SCANFINDER_API_TLS_KEY;
  let server;
  if (certPath && keyPath) {
    const fs = ctx.fs || require('fs');
    server = https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, listener);
  } else {
    if (host !== '127.0.0.1' && host !== 'localhost') {
      ctx.logger?.warn?.('[api] refusing to bind a non-loopback host without TLS — set SCANFINDER_API_TLS_CERT/KEY');
      return;
    }
    server = http.createServer(listener);
  }

  server.listen(port, host, () => {
    ctx.logger?.log?.(`[api] detached-client API on ${certPath ? 'https' : 'http'}://${host}:${port}${API_PREFIX}`);
  });
  server.on('error', (e) => ctx.logger?.warn?.(`[api] server error: ${e.message}`));
  ctx._apiServer = server;
}

module.exports = { register, createServer, createRequestListener, API_CONTRACT_VERSION, API_PREFIX };
