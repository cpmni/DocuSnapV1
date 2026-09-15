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
const accessService      = require('../../services/accessService');
const totp              = require('../../lib/totp');
const certService       = require('../../services/certService');
const path              = require('path');

// Map a workflowService error code to an HTTP status.
const WF_HTTP = { FORBIDDEN: 403, STAMP_FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409 };
const wfStatus = (code) => WF_HTTP[code] || 400;

const API_CONTRACT_VERSION = '1.8.0';   // 1.8.0: + `intake` on the search-row DTO (Quick File Q-C2 — the search UI hides the Review dead-end for a typed doc; additive, no client gate needed). 1.7.0: + the teach-over-client READS (POST /documents/:id/{ocr-region-boxes,ocr-page-words,page-deskew} + GET /teach/config — teach-over-client S1, 2026-09-14; the client gates its teach cap on ≥ 1.7.0) + the WRITES POST /doc-types(/presets) + POST /teach/commit (S2/S3) + POST /teach/stage (S4 upload-to-teach, admin — adding these endpoints under the same MAJOR needs no bump). 1.6.0: + GET /documents/:id/page-info (ONE render process for the pop-out's first paint + its read-ahead batch; the client gates its pageInfo cap on ≥ 1.6.0). 1.5.0: + GET /documents/:id/outline (the PDF's bookmarks → the Contents panel) and the page read's optional fmt=auto|jpeg (2026-09-14; the client gates its Contents cap on ≥ 1.5.0). 1.4.0: + per-document open-routes / decision-history reads, admin route cancel, new stamp type (the search pop-out's last hidden workflow bits, 2026-09-14; the client gates those caps on ≥ 1.4.0). 1.3.0: + the four preview READS (page / page-count / find / spreadsheet — client search parity S2, 2026-09-13; the client gates its lazy-page/find/grid caps on ≥ 1.3.0). 1.2.0: + POST /v1/documents/intake (Quick File upload). NB: ADDING endpoints (e.g. recycle bin) needs no bump — the
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
// Permanent purge: remove EVERY app-owned file of the document — the app-managed working copy, the FILED
// copy in the output tree and its `.metadata` xml sidecar — through the SAME helper the desktop purge uses
// (review/handler.js purgeDocumentFiles). Chris 2026-09-14 card 1: this lane used to delete
// `[resolveFilePath(doc), working_path]` = the working copy only, so a client "Delete permanently" left the
// filed PDF + xml on disk while its warning said "and its file". Paths are resolved SERVER-SIDE from the
// document row only (never a client-supplied path).
function _purgeDocFiles(db, id, deps) {
  return require('../review/handler').purgeDocumentFiles(db, id, deps);
}
const TOTP_ISSUER = 'ScanFinder';
const MAX_BODY_BYTES = 1 * 1024 * 1024;
// Bound concurrent zone-OCR (correction targeting) so many reviewers/drags can't fan
// out unbounded Tesseract child processes on the host. Module-level (single process).
const OCR_MAX_INFLIGHT = 3;
let _ocrInFlight = 0;
// Teach-over-client S1 (2026-09-14, gary): `ocr-page-words` runs the pipeline's FULL-PAGE recipe (heavier than
// a cropped region — the same fan-out concern as /find), so it gets its OWN in-flight cap rather than sharing
// the region cap. `ocr-region-boxes` and `page-deskew` are single-crop/single-page spawns → they share
// _ocrInFlight with ocr-region.
const PAGEWORDS_MAX_INFLIGHT = 2;
let _pageWordsInFlight = 0;
// Client search parity S2 (2026-09-13, Oracle seams 8-9): the four preview READS the detached client's search
// pop-out needs for parity with the core Search window. `find` is the first OCR-bearing READ on /v1 (a scanned
// PDF OCRs its pages through pdf_find.py's fallback) → its OWN in-flight cap + a query-length floor (reject
// early, no spawn) + a tighter OCR page cap than the desktop (the pdf_find env hook; the desktop's 30 stays)
// so N clients cannot fan out N × a 30-page OCR on the host. The single-page read clamps scale/index server-side
// (a readonly user asking for scale 50 would be a memory DoS). The query is NEVER logged (mirrors /search).
const FIND_MAX_INFLIGHT = 2;
let _findInFlight = 0;
const FIND_Q_MIN = 2;
const FIND_Q_MAX = 200;
const FIND_OCR_PAGES_V1 = 12;          // PREVIEW_FIND_OCR_PAGES for the /v1 lane (desktop default 30)
const PAGE_SCALE_MIN = 1, PAGE_SCALE_MAX = 4, PAGE_SCALE_DEFAULT = 3;
const PAGE_INDEX_MAX = 5000;
const PAGE_INFO_ALSO_MAX_V1 = 4;   // /page-info: extra pages one request may rasterise beyond `page` (the pop-out's read-ahead asks for 3)

// Quick File UPLOAD (POST /v1/documents/intake) — the first body-bearing WRITE on /v1 (Oracle
// 2026-09-13, SIGN-OFF-W/COND). Its body may be large (a base64 file), so it does NOT reuse the 1 MB
// readJsonBody — a dedicated capped reader below, with the higher cap kept LOCAL. In-flight bounded so N
// clients can't fan out N × (base64 + decoded) buffers + filing I/O on the host.
const INTAKE_MAX_INFLIGHT = 2;
let _intakeInFlight = 0;
const INTAKE_MAX_MB_CEIL = 100;         // hard ceiling on the admin-settable direct_intake_max_mb for THIS lane
// Teach-over-client S3: the transactional commit spawns Python (landmarks/fingerprint), so ONE at a time —
// a remote trigger must not fan out CPU-heavy work on the host (Oracle C-S3-3).
const TEACH_COMMIT_MAX_INFLIGHT = 1;
let _teachCommitInFlight = 0;
// Teach-over-client S4 (upload-to-teach, 2026-09-14, Oracle SIGN-OFF-W/COND C8-C14): POST /v1/teach/stage
// uploads a document, runs the FULL core OCR import WITHOUT filing, and returns the review-queue docId to
// teach. It is the OCR-FLOOD surface, so it gets its OWN in-flight cap of 1 (C10 — released in a finally,
// separate from any worker watchdog), a stage-specific size cap, and a HARD page-count ceiling enforced by
// a cheap render/pages.py --count PRE-PROBE BEFORE the OCR spawn (C11). ADMIN-only (C13).
const TEACH_STAGE_MAX_INFLIGHT = 1;
let _teachStageInFlight = 0;
const TEACH_STAGE_MAX_MB_DEFAULT = 50;  // stage upload size cap (a multi-page scan); admin-settable teach_stage_max_mb
const TEACH_STAGE_MAX_MB_CEIL = 100;    // hard ceiling on the admin-settable value for THIS lane
const TEACH_STAGE_MAX_PAGES = 40;       // HARD page ceiling — a 500-page scan would tie up the one OCR slot

// Read a size-capped body (bytes) for the upload lane. Rejects past `maxBytes` mid-stream + destroys the
// socket. Returns the raw Buffer; the caller JSON-parses (the base64 rides inside the JSON envelope).
function readCappedBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('body too large')); try { req.destroy(); } catch {} return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

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

// Teach-over-client S1: the teach image reads (page-deskew / ocr-page-words / ocr-region-boxes) carry a
// rendered PAGE or a large crop as base64 JSON — bigger than the 1 MB default. A dedicated higher cap (still
// bounded: base64 of a scale-3/4 A4 render tops out a few MB) keeps the general JSON reader tight.
const TEACH_IMG_MAX_BYTES = 12 * 1024 * 1024;
function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('body too large')); req.destroy(); return; }
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

  const workflow = ctx.workflowService || workflowService.createWorkflowService({
    audit,
    // Slice 1: the SAME shared main.js sink as the desktop transport — a /v1 action by
    // another user must reach the SEARCH window's open mailbox and toast the desktop user
    // (eric: ctx.notifyMainWindow reaches main+review only and would starve it; pinned in
    // test_workflow_ipc.js). Best-effort; the service shields the action from a throw.
    notifyWorkflow: (ev) => { try { ctx.notifyWorkflowEvent && ctx.notifyWorkflowEvent(ev); } catch { /* best-effort */ } },
  });
  const actorOf = (session) => ({ userId: session.userId, username: session.username, role: session.role });
  // Stamping over /v1 (Workflow+Stamping redesign 2026-08-28) — the SAME transport-agnostic services the
  // desktop uses. Routes live under /v1/workflow/* so the WORKFLOW_ROUTE entitlement gate + workflow
  // sub-seat apply (Oracle gate 2). placeStamp gates permission + document access internally.
  const stampSvc  = ctx.stampService || require('../../services/stampService').createStampService();
  const stampPerm = ctx.stampPermission || require('../auth/stampPermission');
  const stampsDb  = require('../../../database/modules/stamps');

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
    // Q1 (2026-08-22): the keep-originals decision is made INSIDE reviewService.confirm (the one
    // gate) — this callback only runs when the service decided to remove. Do not re-check here.
    onScheduleSourceMove: ({ srcPath }) => {
      try { require('../filing/handler').removeSourceFile(ctx.fs || require('fs'), srcPath, ctx.logger).catch(() => {}); }
      catch { /* best-effort drain */ }
    },
    drainOriginal: (srcPath, destDir, originalFilename) => {
      try { return require('../processing/handler').drainOriginalToFolder(ctx.fs || require('fs'), require('path'), srcPath, destDir, originalFilename); }
      catch { return null; }
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
  // review + doc-types ride the SAME search/client entitlement (role supplies the privilege). teach-over-client
  // (S3): /v1/teach/* is entitlement-gated too (an unentitled install exposes no teach surface; Oracle C-S3-4).
  const FEATURE_ROUTE = new RegExp(`^${API_PREFIX}/(search|documents|workflow|review|doc-types|teach)(/|$)`);
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

  // A1 (2026-09-15): force a temp-password change over /v1. ENFORCED BY DEFAULT since mig 169 (owner flip
  // 2026-09-15) — a fresh/existing install seeds `v1_force_password_change` = '1' so a restricted session
  // is refused every route but change-password/logout. The switch doubles as the kill switch: set it '0'
  // to restore the historical (byte-identical) behaviour. Was DARK/default-OFF at build (2026-09-15 night).
  const v1ForcePasswordChange = () => {
    try { return learning.getSetting(getDb(), 'v1_force_password_change') === '1'; } catch { return false; }
  };
  // Resolve + require a session; on failure writes 401 and returns null.
  // opts.allowRestricted lets a must-change-password session through (change-password/logout only).
  const requireSession = (req, res, opts = {}) => {
    const session = sessions.verify(bearerToken(req));
    if (!session) { sendJson(res, 401, { error: 'unauthorized' }); return null; }
    // A restricted session (signed in with a never-changed temp password) may reach ONLY the
    // change-password door. Every data route resolves through this helper, so the gate is central.
    if (session.mustChange && !opts.allowRestricted && v1ForcePasswordChange()) {
      sendJson(res, 403, { error: 'You must change your temporary password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
      return null;
    }
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
        const { token, expiresAt } = sessions.issue({ userId: r.user.id, username: r.user.username, role: r.user.role, clientKey: seat ? seat.clientKey : null, mustChange: r.mustChangePassword });
        audit({ user_id: r.user.id, action: 'login_success', action_category: 'auth', outcome: 'success',
                actor_username: r.user.username, actor_role: r.user.role, metadata: { ip, hostname: host } });
        return sendJson(res, 200, {
          token, expiresAt,
          // A1: advertise the forced change only when it is actually being enforced (OFF = field absent = byte-identical).
          ...(r.mustChangePassword && v1ForcePasswordChange() ? { mustChangePassword: true } : {}),
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
        const { token, expiresAt } = sessions.issue({ userId: r.user.id, username: r.user.username, role: r.user.role, clientKey: seat ? seat.clientKey : null, mustChange: r.mustChangePassword });
        audit({ user_id: r.user.id, action: 'enroll_success', action_category: 'auth', outcome: 'success',
                actor_username: r.user.username, actor_role: r.user.role, metadata: { ip, hostname: host } });
        return sendJson(res, 200, {
          caPem: prof.profile.caPem, caFingerprintSha256: prof.profile.caFingerprintSha256,
          host: prof.profile.host, port: prof.profile.port,
          token, expiresAt,
          ...(r.mustChangePassword && v1ForcePasswordChange() ? { mustChangePassword: true } : {}),
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
        // allowRestricted: a must-change-password session MUST be able to reach this door to clear the flag.
        const session = requireSession(req, res, { allowRestricted: true }); if (!session) return;
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
        // M3: revoke EVERY existing session for this account so a stolen /v1 token can't
        // survive a self-service password change (the desktop change-password already does
        // this; the /v1 path silently didn't). Then re-issue a fresh token for the caller so
        // THIS client stays logged in — a client that ignores it simply re-logs-in.
        try { sessions.revokeUser(user.id); } catch { /* best-effort; the token below is still fresh */ }
        let reissued = null;
        try { reissued = sessions.issue({ userId: session.userId, username: session.username, role: session.role, clientKey: session.clientKey }); } catch { /* client will re-login */ }
        audit({ user_id: user.id, action: 'password_change', action_category: 'auth', outcome: 'success',
                actor_username: user.username, details: 'self_service_client' });
        return sendJson(res, 200, { ok: true, token: reissued ? reissued.token : null, expiresAt: reissued ? reissued.expiresAt : null });
      }

      // ── Auth-required: TOTP enrolment (setup → returns secret; confirm → enables) ─
      if (req.method === 'POST' && pathname === `${API_PREFIX}/auth/totp/setup`) {
        const session = requireSession(req, res); if (!session) return;
        // M2: re-enrolment must not silently disable an existing second factor. setTotpSecret
        // clears totp_enabled, so a bare setup call from a stolen token would turn a victim's
        // MFA OFF. If a factor is ALREADY enabled, require the current password AND a valid
        // current code before overwriting. First-time enrol (no existing factor) needs no extra
        // proof — you can't be locked out of what isn't set up yet.
        const totpState = dbAuth.getTotpForUser(getDb(), session.userId);
        if (totpState && totpState.totp_enabled) {
          let body; try { body = await readJsonBody(req); } catch { body = {}; }
          const user = dbAuth.getUserById(getDb(), session.userId);
          const pwMod = require('../auth/password');
          const pwOk   = !!user && await pwMod.verifyPassword(user.password_hash, String((body && body.currentPassword) || ''));
          const codeOk = !!totpState.totp_secret && totp.verify(String((body && body.totp) || ''), totpState.totp_secret);
          if (!pwOk || !codeOk) {
            audit({ user_id: session.userId, action: 'totp_setup', action_category: 'auth', outcome: 'failure',
                    actor_username: session.username, details: 'reenrol_reauth_failed' });
            return sendJson(res, 401, { error: 'To change your authenticator, enter your current password and a current code.' });
          }
        }
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
        const result = searchService.searchDocuments({ db: getDb(), params, role: session.role, userId: session.userId });
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
        // Per-document authorization (Slice 0). 404 hides existence on not_found; 403 on
        // authorized-but-denied. Kill-switchable (ACCESS_GATE_ENABLED, default ON).
        if (accessService.gateEnabled()) {
          const acc = accessService.canAccessDocument(getDb(), session, id);
          if (!acc.allow) return sendJson(res, acc.reason === 'not_found' ? 404 : 403, { error: acc.reason === 'not_found' ? 'not found' : 'forbidden' });
        }
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
        if (accessService.gateEnabled()) {
          const acc = accessService.canAccessDocument(getDb(), session, id);
          if (!acc.allow) return sendJson(res, acc.reason === 'not_found' ? 404 : 403, { error: acc.reason === 'not_found' ? 'not found' : 'forbidden' });
        }
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
        if (accessService.gateEnabled()) {
          const acc = accessService.canAccessDocument(getDb(), session, id);
          if (!acc.allow) return sendJson(res, acc.reason === 'not_found' ? 404 : 403, { error: acc.reason === 'not_found' ? 'not found' : 'forbidden' });
        }
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

      // ── Auth-required: the four preview READS (client search parity S2, contract 1.3.0) ──────────
      // Each mirrors /pages: requireSession → per-document access gate → SERVER-SIDE path resolution (F-02:
      // client paths are never read) → the transport-agnostic previewService fn → a path-free DTO. All fall
      // inside FEATURE_ROUTE (entitlement-gated). Reads only: no audit row (same as /pages and /thumbnail).
      const _resolveDocArgs = (id) => {
        const P = ctx.path || require('path');
        const row = getDb().prepare(
          'SELECT working_path, stored_path, folder_path, original_filename FROM documents WHERE id = ?').get(id);
        if (!row) return { folderPath: null, filename: null };
        const pick = row.working_path || row.stored_path
          || (row.folder_path && row.original_filename ? P.join(row.folder_path, row.original_filename) : null);
        return pick ? { folderPath: P.dirname(pick), filename: P.basename(pick) } : { folderPath: null, filename: null };
      };
      const _gateDoc = (session, id) => {
        if (!accessService.gateEnabled()) return true;
        const acc = accessService.canAccessDocument(getDb(), session, id);
        if (acc.allow) return true;
        sendJson(res, acc.reason === 'not_found' ? 404 : 403, { error: acc.reason === 'not_found' ? 'not found' : 'forbidden' });
        return false;
      };

      // GET /v1/documents/:id/page/:index?scale=  → { page: dataUrl|null }  (one rendered PDF page; lazy preview)
      const pageMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/page/(\\d+)$`));
      if (req.method === 'GET' && pageMatch) {
        const session = requireSession(req, res); if (!session) return;
        const id = Number(pageMatch[1]);
        if (!_gateDoc(session, id)) return;
        const index = Math.min(PAGE_INDEX_MAX, Math.max(0, Number(pageMatch[2]) | 0));
        const rawScale = Number(url.searchParams.get('scale'));
        const scale = Number.isFinite(rawScale) && rawScale > 0
          ? Math.min(PAGE_SCALE_MAX, Math.max(PAGE_SCALE_MIN, rawScale)) : PAGE_SCALE_DEFAULT;
        // fmt=auto|jpeg (1.5.0): JPEG for a scan page (6× smaller, ~25× faster to encode), PNG for a vector page;
        // anything else = PNG (unchanged). An older client never sends it; an older core ignores it.
        const fmtRaw = String(url.searchParams.get('fmt') || '').toLowerCase();
        const format = (fmtRaw === 'auto' || fmtRaw === 'jpeg') ? fmtRaw : undefined;
        const { folderPath, filename } = _resolveDocArgs(id);
        const page = (folderPath && filename)
          ? await previewService.getDocumentPage(getDb(), { docId: id, folderPath, filename, index, scale, format }, pageDeps())
          : null;
        return sendJson(res, 200, { page: page || null });
      }

      // GET /v1/documents/:id/page-info?page=&also=&scale=&fmt=  → { pages, outline, images:{"<i>": dataUrl} }
      // ONE render process for the pop-out's first paint (page + count + bookmarks) and for its read-ahead batch
      // (contract 1.6.0, 2026-09-14). `also` = up to PAGE_INFO_ALSO_MAX_V1 extra indexes (bounded work per request —
      // an authenticated LAN user must not be able to ask one request to rasterise a whole book). Same gates as /page.
      const infoMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/page-info$`));
      if (req.method === 'GET' && infoMatch) {
        const session = requireSession(req, res); if (!session) return;
        const id = Number(infoMatch[1]);
        if (!_gateDoc(session, id)) return;
        const page = Math.min(PAGE_INDEX_MAX, Math.max(0, Number(url.searchParams.get('page')) | 0));
        const also = [...new Set(String(url.searchParams.get('also') || '').split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s))
          .map(Number).filter(n => n >= 0 && n <= PAGE_INDEX_MAX && n !== page))].slice(0, PAGE_INFO_ALSO_MAX_V1);
        const rawScale = Number(url.searchParams.get('scale'));
        const scale = Number.isFinite(rawScale) && rawScale > 0
          ? Math.min(PAGE_SCALE_MAX, Math.max(PAGE_SCALE_MIN, rawScale)) : PAGE_SCALE_DEFAULT;
        const fmtRaw = String(url.searchParams.get('fmt') || '').toLowerCase();
        const format = (fmtRaw === 'auto' || fmtRaw === 'jpeg') ? fmtRaw : undefined;
        const { folderPath, filename } = _resolveDocArgs(id);
        const info = (folderPath && filename)
          ? await previewService.getDocumentPageInfo(getDb(), { docId: id, folderPath, filename, page, also, scale, format }, pageDeps())
          : null;
        return sendJson(res, 200, info ? { pages: info.pages, outline: info.outline, images: info.images } : { pages: null, outline: [], images: {} });
      }

      // GET /v1/documents/:id/outline → { outline: [{title, page, level}] }  (the PDF's bookmarks — the Contents
      // panel; no render; [] when none / non-PDF). Contract 1.5.0 (2026-09-14). Same gates as /page.
      const outlineMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/outline$`));
      if (req.method === 'GET' && outlineMatch) {
        const session = requireSession(req, res); if (!session) return;
        const id = Number(outlineMatch[1]);
        if (!_gateDoc(session, id)) return;
        const { folderPath, filename } = _resolveDocArgs(id);
        const outline = (folderPath && filename)
          ? await previewService.getDocumentOutline(getDb(), { docId: id, folderPath, filename }, pageDeps())
          : [];
        return sendJson(res, 200, { outline: Array.isArray(outline) ? outline : [] });
      }

      // GET /v1/documents/:id/page-count → { count: int|null }  (no render — sizes the lazy page array)
      const countMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/page-count$`));
      if (req.method === 'GET' && countMatch) {
        const session = requireSession(req, res); if (!session) return;
        const id = Number(countMatch[1]);
        if (!_gateDoc(session, id)) return;
        const { folderPath, filename } = _resolveDocArgs(id);
        const count = (folderPath && filename)
          ? await previewService.getDocumentPageCount(getDb(), { docId: id, folderPath, filename }, pageDeps())
          : null;
        return sendJson(res, 200, { count: Number.isFinite(count) && count > 0 ? count : null });
      }

      // GET /v1/documents/:id/find?q= → { kind, pages, matches:[{page,x0,y0,x1,y1}] }  (page-fraction boxes)
      const findMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/find$`));
      if (req.method === 'GET' && findMatch) {
        const session = requireSession(req, res); if (!session) return;
        const id = Number(findMatch[1]);
        if (!_gateDoc(session, id)) return;
        const q = String(url.searchParams.get('q') || '').trim();
        if (q.length < FIND_Q_MIN) return sendJson(res, 400, { error: `q must be at least ${FIND_Q_MIN} characters` });   // no spawn
        if (q.length > FIND_Q_MAX) return sendJson(res, 400, { error: `q must be at most ${FIND_Q_MAX} characters` });
        if (_findInFlight >= FIND_MAX_INFLIGHT) return sendJson(res, 429, { error: 'too many find requests — retry' });
        const { folderPath, filename } = _resolveDocArgs(id);
        if (!folderPath || !filename) return sendJson(res, 200, { kind: 'none', pages: 0, matches: [] });
        _findInFlight++;
        try {
          const deps = pageDeps();
          const result = await previewService.findInDocument(getDb(), { docId: id, folderPath, filename, query: q }, {
            ...deps,
            findScript: ctx.findScript || (ctx.resourcePath && ctx.resourcePath('python_backend', 'render', 'pdf_find.py')),
            tesseract: typeof ctx.tesseractPath === 'function' ? ctx.tesseractPath() : (ctx.tesseractPath || null),
            // The /v1 lane OCRs fewer pages than the desktop (the rest report as partial) — a slow scanned
            // find must not hold a client for minutes nor fan out on the host.
            env: { ...process.env, PREVIEW_FIND_OCR_PAGES: String(FIND_OCR_PAGES_V1) },
          });
          const matches = (result && Array.isArray(result.matches)) ? result.matches
            .filter(m => m && Number.isFinite(m.page)).map(m => ({ page: m.page, x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1 })) : [];
          return sendJson(res, 200, { kind: (result && result.kind) || 'none', pages: (result && result.pages) || 0, matches });
        } finally { _findInFlight--; }
      }

      // GET /v1/documents/:id/spreadsheet → { grid: {sheets:[{name,rows}], truncated} | null }  (values only)
      const gridMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/spreadsheet$`));
      if (req.method === 'GET' && gridMatch) {
        const session = requireSession(req, res); if (!session) return;
        const id = Number(gridMatch[1]);
        if (!_gateDoc(session, id)) return;
        const { folderPath, filename } = _resolveDocArgs(id);
        const grid = (folderPath && filename)
          ? previewService.getSpreadsheetGrid(getDb(), { docId: id, folderPath, filename }, { fs: ctx.fs || require('fs'), path: ctx.path || require('path'), log })
          : null;
        return sendJson(res, 200, { grid: grid || null });
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

      // ── Teach-over-client S1 (2026-09-14, contract 1.7.0): three OCR/geometry READS the client teach
      // wizard needs. Each takes a client-cropped/rendered PNG in the body (NO doc file resolved server-side —
      // the client already fetched the page via /v1/page, which IS access-gated; the docId is for the audit),
      // mirrors the ocr-region spawn, is isWriter-gated + in-flight capped + audited, and mints+cleans its own
      // temp. See docs/designs/TEACH_OVER_CLIENT_2026-09-14.md. ──────────────────────────────────────────────

      // POST /v1/documents/:id/ocr-region-boxes → {text, box:[l,t,w,h], words, lines}  (⊕/teach auto-label)
      const ocrBoxesMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/ocr-region-boxes$`));
      if (req.method === 'POST' && ocrBoxesMatch) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        if (_ocrInFlight >= OCR_MAX_INFLIGHT) return sendJson(res, 429, { error: 'too many OCR requests — retry' });
        let body; try { body = await readJsonBody(req, TEACH_IMG_MAX_BYTES); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const b64 = (body && typeof body.imageBase64 === 'string') ? body.imageBase64 : '';
        if (!b64) return sendJson(res, 400, { error: 'imageBase64 (a cropped PNG) is required' });
        const osMod = require('os'); const fsx = ctx.fs || require('fs'); const P = ctx.path || path;
        const tmp = P.join(osMod.tmpdir(), `ds_v1boxes_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
        try { fsx.writeFileSync(tmp, Buffer.from(b64, 'base64')); } catch { return sendJson(res, 400, { error: 'bad image data' }); }
        const script = ctx.resourcePath('python_backend', 'ocr', 'region.py');
        _ocrInFlight++;
        let done = false;
        const finish = (status, payload) => { if (done) return; done = true; _ocrInFlight--; try { fsx.unlinkSync(tmp); } catch {} sendJson(res, status, payload); };
        try {
          const proc = (ctx.spawn || require('child_process').spawn)(ctx.pythonExe(),
            ctx.pythonArgs(script, '--image-file', tmp, '--tesseract', ctx.tesseractPath(), '--boxes'), { windowsHide: true });
          let out = '', err = '';
          proc.stdout.on('data', d => { out += d.toString(); });
          proc.stderr.on('data', d => { err += d.toString(); });
          proc.on('close', () => { if (err) { try { log('v1 ocr-region-boxes stderr: ' + err.trim()); } catch {} }
            try { finish(200, JSON.parse(out.trim())); } catch { finish(200, { text: out.trim(), box: null, words: [], lines: [] }); } });
          proc.on('error', (e) => { try { log('v1 ocr-region-boxes spawn error: ' + e.message); } catch {} finish(500, { error: 'ocr failed' }); });
        } catch (e) { finish(500, { error: 'ocr failed' }); }
        try { audit({ user_id: session.userId, action: 'ocr_region', action_category: 'document',
                      outcome: 'success', document_id: Number(ocrBoxesMatch[1]), metadata: { via: 'client', mode: 'boxes' } }); } catch {}
        return;
      }

      // POST /v1/documents/:id/ocr-page-words → {w, h, words:[{t,b:[l,t,w,h],c}]}  (typed-value locate)
      const pageWordsMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/ocr-page-words$`));
      if (req.method === 'POST' && pageWordsMatch) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        if (_pageWordsInFlight >= PAGEWORDS_MAX_INFLIGHT) return sendJson(res, 429, { error: 'too many OCR requests — retry' });
        let body; try { body = await readJsonBody(req, TEACH_IMG_MAX_BYTES); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const b64 = (body && typeof body.imageBase64 === 'string') ? body.imageBase64 : '';
        if (!b64) return sendJson(res, 400, { error: 'imageBase64 (a full-page PNG) is required' });
        const osMod = require('os'); const fsx = ctx.fs || require('fs'); const P = ctx.path || path;
        const tmp = P.join(osMod.tmpdir(), `ds_v1pw_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
        try { fsx.writeFileSync(tmp, Buffer.from(b64, 'base64')); } catch { return sendJson(res, 400, { error: 'bad image data' }); }
        const script = ctx.resourcePath('python_backend', 'ocr', 'region.py');
        // Pipeline recipe env (render DPI + reconcile incl. light-text) so the read matches the pipeline (gary).
        let pwEnv = {}; try { pwEnv = (typeof ctx.pipelineOcrEnv === 'function') ? ctx.pipelineOcrEnv(getDb()) : {}; } catch { pwEnv = {}; }
        _pageWordsInFlight++;
        let done = false;
        const finish = (status, payload) => { if (done) return; done = true; _pageWordsInFlight--; try { fsx.unlinkSync(tmp); } catch {} sendJson(res, status, payload); };
        try {
          const proc = (ctx.spawn || require('child_process').spawn)(ctx.pythonExe(),
            ctx.pythonArgs(script, '--image-file', tmp, '--tesseract', ctx.tesseractPath(), '--page-words'),
            { windowsHide: true, env: { ...process.env, ...pwEnv } });
          let out = '', err = '';
          proc.stdout.on('data', d => { out += d.toString(); });
          proc.stderr.on('data', d => { err += d.toString(); });
          proc.on('close', () => { if (err) { try { log('v1 ocr-page-words stderr: ' + err.trim()); } catch {} }
            try { finish(200, JSON.parse(out.trim())); } catch { finish(200, { w: 0, h: 0, words: [] }); } });
          proc.on('error', (e) => { try { log('v1 ocr-page-words spawn error: ' + e.message); } catch {} finish(200, { w: 0, h: 0, words: [] }); });
        } catch (e) { finish(200, { w: 0, h: 0, words: [] }); }
        try { audit({ user_id: session.userId, action: 'ocr_page_words', action_category: 'document',
                      outcome: 'success', document_id: Number(pageWordsMatch[1]), metadata: { via: 'client' } }); } catch {}
        return;
      }

      // POST /v1/documents/:id/page-deskew → {angle, image(base64 PNG, SAME dims — region.py expand=False), measured}
      // Oracle C3: reuses region.py --deskew (expand=False + the same detect params as the desktop get-page-deskew),
      // so the straightened FRAME the client draws on is identical → normalized box coords map the same.
      const deskewMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/page-deskew$`));
      if (req.method === 'POST' && deskewMatch) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        if (_ocrInFlight >= OCR_MAX_INFLIGHT) return sendJson(res, 429, { error: 'too many OCR requests — retry' });
        let body; try { body = await readJsonBody(req, TEACH_IMG_MAX_BYTES); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const b64 = (body && typeof body.imageBase64 === 'string') ? body.imageBase64 : '';
        if (!b64) return sendJson(res, 400, { error: 'imageBase64 (a full-page PNG) is required' });
        const minAngle = Math.max(0.2, Math.min(5.0, Number(body.minAngle) || 0.2));
        const osMod = require('os'); const fsx = ctx.fs || require('fs'); const P = ctx.path || path;
        const tmp = P.join(osMod.tmpdir(), `ds_v1deskew_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);
        try { fsx.writeFileSync(tmp, Buffer.from(b64, 'base64')); } catch { return sendJson(res, 400, { error: 'bad image data' }); }
        const script = ctx.resourcePath('python_backend', 'ocr', 'region.py');
        _ocrInFlight++;
        let done = false;
        const finish = (status, payload) => { if (done) return; done = true; _ocrInFlight--; try { fsx.unlinkSync(tmp); } catch {} sendJson(res, status, payload); };
        try {
          const proc = (ctx.spawn || require('child_process').spawn)(ctx.pythonExe(),
            ctx.pythonArgs(script, '--image-file', tmp, '--tesseract', ctx.tesseractPath(), '--deskew', '--min-angle', String(minAngle)), { windowsHide: true });
          let out = '', err = '';
          proc.stdout.on('data', d => { out += d.toString(); });
          proc.stderr.on('data', d => { err += d.toString(); });
          // `measured`: a PARSED result means the detector RAN (a level page = {angle:0,image:null,measured:true});
          // a parse/spawn failure is measured:false, so a 0 from a failure is never taken as "level".
          proc.on('close', () => { if (err) { try { log('v1 page-deskew stderr: ' + err.trim()); } catch {} }
            try { finish(200, { measured: true, ...JSON.parse(out.trim()) }); } catch { finish(200, { angle: 0, image: null, measured: false }); } });
          proc.on('error', (e) => { try { log('v1 page-deskew spawn error: ' + e.message); } catch {} finish(200, { angle: 0, image: null, measured: false }); });
        } catch (e) { finish(200, { angle: 0, image: null, measured: false }); }
        try { audit({ user_id: session.userId, action: 'page_deskew', action_category: 'document',
                      outcome: 'success', document_id: Number(deskewMatch[1]), metadata: { via: 'client' } }); } catch {}
        return;
      }

      // GET /v1/teach/config → the teach wizard's feature flags (the client teach reads these via getSetting).
      // A small FIXED allowlist, never a general settings read; isWriter (teach is admin/edit). Contract 1.7.0.
      if (req.method === 'GET' && pathname === `${API_PREFIX}/teach/config`) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const db = getDb();
        const g = (k, d) => { try { const v = learning.getSetting(db, k, d); return v == null ? d : String(v); } catch { return d; } };
        return sendJson(res, 200, {
          teach_typed_value_locate: g('teach_typed_value_locate', 'true'),
          teach_box_word_snap:      g('teach_box_word_snap', 'true'),
          list_field_scan:          g('list_field_scan', 'false'),
          barcode_field:            g('barcode_field', 'false'),
        });
      }

      // ── Teach-over-client S3: the ONE transactional teach commit (create template + mappings + fixed +
      //    hidden + captions, then file the exemplar). ADMIN-only + license re-check + the operator opt-in
      //    switch (default OFF) + an in-flight cap of 1. The whole learning/schema write lives in
      //    reviewHandler.teachCommit (this route is a thin guard + one call — the source-contract pin). F-02:
      //    the exemplar's on-disk path is resolved SERVER-SIDE inside teachCommit from the doc row, never the
      //    body. Contract 1.7.0. (Oracle SIGN-OFF-W/COND C-S3-1..6, 2026-09-14.)
      if (req.method === 'POST' && pathname === `${API_PREFIX}/teach/commit`) {
        const session = requireSession(req, res); if (!session) return;
        if (session.role !== 'admin') return sendJson(res, 403, { error: 'only an admin can teach a document from the search client' });
        const db = getDb();
        if (require('../licensing/handler').licenseDenied(db)) return sendJson(res, 403, { error: 'A valid license is required to teach documents.', code: 'LICENSE' });
        if (String(learning.getSetting(db, 'teach_over_client_enabled', 'false')) !== 'true') {
          return sendJson(res, 409, { code: 'FEATURE_DISABLED', error: "Teaching from the search client isn't enabled on this server." });
        }
        if (_teachCommitInFlight >= TEACH_COMMIT_MAX_INFLIGHT) return sendJson(res, 429, { error: 'a teach is already in progress — retry' });
        _teachCommitInFlight++;
        try {
          let body; try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
          const r = await require('../review/handler').teachCommit(ctx, db, body, actorOf(session), reviewSvc);
          if (!r || !r.ok) {
            const map = { BAD_REQUEST: 400, NOT_FOUND: 404, NOT_TEACHABLE: 400, ALREADY_FILED: 409,
                          TYPE_SPLIT: 409, ISSUER_NEAR_MATCH: 409, COMMIT_FAILED: 500, FILE_FAILED: 500 };
            return sendJson(res, (r && map[r.code]) || 400, { ok: false, error: (r && r.error) || 'teach failed', code: (r && r.code) || null, ...(r && r.templateId ? { templateId: r.templateId } : {}) });
          }
          try { audit({ user_id: session.userId, action: 'teach_commit', action_category: 'learning', outcome: 'success',
                        document_id: Number(body && body.document_id) || null,
                        metadata: { via: 'client', ip: clientIp(req), template_id: r.templateId, created: !!r.created } }); } catch {}
          return sendJson(res, 200, { ok: true, templateId: r.templateId, filename: r.filename, isDuplicate: !!r.isDuplicate, landmarksWarn: !!r.landmarksWarn });
        } catch (e) { log('[api] teach-commit: ' + (e && e.message)); return sendJson(res, 500, { error: 'teach failed' }); }
        finally { _teachCommitInFlight--; }
      }

      // ── Teach-over-client S4: UPLOAD-TO-TEACH (POST /v1/teach/stage) ───────────────────────────────────
      //    Upload a PDF/image, run the FULL core OCR import WITHOUT filing, return the review-queue docId to
      //    teach (then S1-S3 teach it exactly as a queue doc). base64-in-JSON body {filename, contentBase64}.
      //    Guards (order): session → ADMIN-only (C13; the OCR-flood surface + edit-only stage is a dead-end
      //    half-capability) → license re-check (F-01) → the teach_over_client_enabled switch (409) → its OWN
      //    in-flight cap of 1 (C10) → Content-Length pre-check → capped read → decode → SAFE-subset ext
      //    (PDF+image only, isUploadIntake ∩ isOcr) → temp FOLDER minted server-side → page-count HARD cap via
      //    a render/pages.py --count PRE-PROBE BEFORE any OCR (C11) → the SHARED batch import with autoFile
      //    OFF (C8; even a graduated supplier+type lands needs_review) → docId captured from the import (C9) →
      //    temp cleaned + in-flight released on EVERY path → audit (C13). Contract 1.7.0 (adding an endpoint
      //    needs no bump). Entitlement (402) is handled centrally by the FEATURE_ROUTE gate above.
      if (req.method === 'POST' && pathname === `${API_PREFIX}/teach/stage`) {
        const session = requireSession(req, res); if (!session) return;
        if (session.role !== 'admin') return sendJson(res, 403, { error: 'only an admin can teach a document from the search client' });
        const db = getDb();
        if (require('../licensing/handler').licenseDenied(db)) return sendJson(res, 403, { error: 'A valid license is required to teach documents.', code: 'LICENSE' });
        if (String(learning.getSetting(db, 'teach_over_client_enabled', 'false')) !== 'true') {
          return sendJson(res, 409, { code: 'FEATURE_DISABLED', error: "Teaching from the search client isn't enabled on this server." });
        }
        if (_teachStageInFlight >= TEACH_STAGE_MAX_INFLIGHT) return sendJson(res, 429, { error: 'a document is already being read for teaching — retry' });
        const fileKinds = require('../../lib/fileKinds');
        const maxMb = Math.min(TEACH_STAGE_MAX_MB_CEIL, Number(learning.getSetting(db, 'teach_stage_max_mb', TEACH_STAGE_MAX_MB_DEFAULT)) || TEACH_STAGE_MAX_MB_DEFAULT);
        const maxJsonBytes = Math.ceil(maxMb * 1024 * 1024 * 4 / 3) + 4096;
        const clen = Number(req.headers['content-length'] || 0);
        if (clen && clen > maxJsonBytes) return sendJson(res, 413, { code: 'TOO_LARGE', error: `file exceeds ${maxMb} MB` });

        _teachStageInFlight++;
        let done = false; let tmpDir = null;
        const fsx = ctx.fs || require('fs'); const P = ctx.path || path; const osMod = require('os');
        const finish = (status, payload) => {
          if (done) return; done = true; _teachStageInFlight--;   // in-flight released here (C10)
          // Clean the whole minted temp FOLDER AFTER the import (working copy is already in userData/inbox).
          if (tmpDir) { try { fsx.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
          sendJson(res, status, payload);
        };
        // A client abort/socket error must release the slot + temp (no leak) — C10.
        req.on('aborted', () => finish(400, { error: 'aborted' }));
        req.on('error', () => finish(400, { error: 'request error' }));
        try {
          let buf; try { buf = await readCappedBody(req, maxJsonBytes); }
          catch { return finish(413, { code: 'TOO_LARGE', error: `file exceeds ${maxMb} MB` }); }
          let body; try { body = JSON.parse(buf.toString('utf8') || '{}'); }
          catch { return finish(400, { error: 'invalid JSON body' }); }
          const b64 = (body && typeof body.contentBase64 === 'string') ? body.contentBase64 : '';
          const rawName = (body && typeof body.filename === 'string') ? body.filename : '';
          if (!b64 || !rawName) return finish(400, { error: 'filename and contentBase64 are required' });
          // SAFE-subset ext: the network upload subset AND an OCR-able format (PDF + image only) — a .docx/.txt
          // passes isUploadIntake but the OCR pipeline can't read it, so it is not teachable. Sanitize to basename.
          const baseName = P.basename(String(rawName));
          const ext = fileKinds.normExt(baseName);
          if (!(fileKinds.isUploadIntake(ext) && fileKinds.isOcr(ext))) return finish(415, { code: 'UNSUPPORTED_TYPE', error: 'only a PDF or image can be taught' });
          let bytes; try { bytes = Buffer.from(b64, 'base64'); } catch { return finish(400, { error: 'bad file data' }); }
          if (!bytes.length) return finish(400, { error: 'empty file' });
          if (bytes.length > maxMb * 1024 * 1024) return finish(413, { code: 'TOO_LARGE', error: `file exceeds ${maxMb} MB` });
          // Mint a PRIVATE temp FOLDER holding exactly one file (the batch import reads a folder). The file
          // name inside becomes the doc's original_filename; the client-supplied path is reduced to a basename.
          tmpDir = P.join(osMod.tmpdir(), `ds_v1teachstage_${Date.now()}_${Math.random().toString(36).slice(2)}`);
          const tmpFile = P.join(tmpDir, baseName);
          try { fsx.mkdirSync(tmpDir, { recursive: true }); fsx.writeFileSync(tmpFile, bytes); }
          catch { return finish(500, { error: 'could not stage the upload' }); }

          // C11: HARD page-count cap via a cheap render/pages.py --count PRE-PROBE, BEFORE any OCR spawn. A
          // null probe (non-PDF, or pdfium couldn't open it → the import fails fast anyway) is allowed through.
          const probePages = ctx.stageProbePages || ((filePath, fileExt) => new Promise((resolve) => {
            if (fileExt !== '.pdf') return resolve(1);   // probe PDFs only; images/tiff count as one for the cap
            const d = pageDeps();
            let proc; try { proc = d.spawn(d.pythonExe(), d.pythonArgs(d.renderScript, '--file', filePath, '--count'), { windowsHide: true }); }
            catch { return resolve(null); }
            let out = ''; proc.stdout.on('data', c => { out += c.toString(); });
            proc.on('error', () => resolve(null));
            proc.on('close', () => { try { const n = JSON.parse(out).pages; resolve(Number.isFinite(n) && n > 0 ? n : null); } catch { resolve(null); } });
          }));
          let pages = null; try { pages = await probePages(tmpFile, ext); } catch { pages = null; }
          if (Number.isFinite(pages) && pages > TEACH_STAGE_MAX_PAGES) {
            return finish(413, { code: 'TOO_MANY_PAGES', error: `that document has ${pages} pages — the limit for teaching is ${TEACH_STAGE_MAX_PAGES}` });
          }

          // C8: the SHARED batch import path with autoFile OFF (even a graduated supplier+type lands
          // needs_review). C9: the return carries the docId captured from _handleFileMessage msg.db_id.
          const stageImport = ctx.stageImport || ((folder, opts) => require('../processing/handler').stageImportSingle(folder, opts));
          let r; try { r = await stageImport(tmpDir, { autoFile: false }); }
          catch (e) { log('[api] teach-stage import: ' + (e && e.message)); return finish(500, { error: 'reading the document failed' }); }
          if (!r || !r.ok || r.docId == null) return finish(500, { ok: false, error: (r && r.error) || 'reading the document failed' });
          try { audit({ user_id: session.userId, action: 'teach_stage', action_category: 'learning', outcome: 'success',
                        document_id: Number(r.docId) || null,
                        metadata: { via: 'client', ip: clientIp(req), filename: baseName, pages: Number.isFinite(pages) ? pages : null } }); } catch {}
          return finish(200, { ok: true, docId: r.docId, filename: baseName });
        } catch (e) { log('[api] teach-stage: ' + (e && e.message)); return finish(500, { error: 'reading the document failed' }); }
      }

      if (req.method === 'GET' && pathname === `${API_PREFIX}/documents/deleted`) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const rows = documents.getDeletedQueue(getDb());
        return sendJson(res, 200, { deleted: dto.projectSearchResult({ confirmed: rows, uncommitted: [] }).confirmed });
      }

      // ── Quick File (non-OCR direct intake) over /v1 — the doc-type list + the enabled probe ──────
      if (req.method === 'GET' && pathname === `${API_PREFIX}/documents/intake/doc-types`) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const db = getDb();
        const svc = require('../../services/directIntakeService');
        const installed = doctypes.getAllWithFieldsAll(db)
          .filter(t => String(t.reading_mode || 'read') === 'none')
          .map(t => ({ id: t.id, name: t.name, slug: t.slug }));
        const presets = (doctypes.getPresetCatalog(db) || [])
          .filter(p => p.quick_file)
          .map(p => ({ name: p.name, slug: p.slug, already_present: p.already_present }));
        return sendJson(res, 200, { enabled: svc.enabled(db), installed, presets });
      }

      // ── Quick File UPLOAD — the first body-bearing WRITE on /v1 (Oracle SIGN-OFF-W/COND 2026-09-13).
      //    base64-in-JSON body {documentTypeId, filename, contentBase64, party, date, title, reference,
      //    notes}. Order of guards BEFORE buffering: session → writer → feature-enabled → in-flight cap →
      //    Content-Length pre-check → capped read → decode → SAFE-subset ext → temp → submit → temp cleanup.
      if (req.method === 'POST' && pathname === `${API_PREFIX}/documents/intake`) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const db = getDb();
        const svc = require('../../services/directIntakeService');
        const fileKinds = require('../../lib/fileKinds');
        if (!svc.enabled(db)) return sendJson(res, 409, { code: 'FEATURE_DISABLED', error: "Quick File isn't enabled on this server." });
        if (_intakeInFlight >= INTAKE_MAX_INFLIGHT) return sendJson(res, 429, { error: 'too many uploads — retry' });
        // Size cap (settings, clamped to the lane ceiling) → the max JSON envelope (base64 ~4/3 + slack).
        const maxMb = Math.min(INTAKE_MAX_MB_CEIL, Number(learning.getSetting(db, 'direct_intake_max_mb', 50)) || 50);
        const maxJsonBytes = Math.ceil(maxMb * 1024 * 1024 * 4 / 3) + 4096;
        const clen = Number(req.headers['content-length'] || 0);
        if (clen && clen > maxJsonBytes) return sendJson(res, 413, { code: 'TOO_LARGE', error: `file exceeds ${maxMb} MB` });

        _intakeInFlight++;
        let done = false; let tmp = null;
        const fsx = ctx.fs || require('fs'); const P = ctx.path || path;
        const finish = (status, payload) => {
          if (done) return; done = true; _intakeInFlight--;
          if (tmp) { try { fsx.unlinkSync(tmp); } catch {} }
          sendJson(res, status, payload);
        };
        // A client abort/socket error must release the in-flight slot (no slot leak).
        req.on('aborted', () => finish(400, { error: 'aborted' }));
        req.on('error', () => finish(400, { error: 'request error' }));
        try {
          let buf; try { buf = await readCappedBody(req, maxJsonBytes); }
          catch { return finish(413, { code: 'TOO_LARGE', error: `file exceeds ${maxMb} MB` }); }
          let body; try { body = JSON.parse(buf.toString('utf8') || '{}'); }
          catch { return finish(400, { error: 'invalid JSON body' }); }
          const b64 = (body && typeof body.contentBase64 === 'string') ? body.contentBase64 : '';
          const rawName = (body && typeof body.filename === 'string') ? body.filename : '';
          if (!b64 || !rawName) return finish(400, { error: 'filename and contentBase64 are required' });
          if (!body.documentTypeId) return finish(400, { error: 'documentTypeId is required' });
          // A "new:<slug>" type = a catalog PRESET set up on first use — the same create-on-first-use the core's
          // Quick File pane does (Chris 2026-09-14 card 3: the client could only pick INSTALLED types, so a fresh
          // install offered nothing). ADMIN only (the desktop's direct-intake-add-type is admin-gated too);
          // idempotent — an already-present preset resolves to its existing id.
          if (typeof body.documentTypeId === 'string' && /^new:/.test(body.documentTypeId)) {
            if (session.role !== 'admin') return finish(403, { error: 'only an admin can add a document type' });
            const slug = String(body.documentTypeId.slice(4) || '').trim();
            const added = (doctypes.addPresetTypes(db, [slug]) || []).find(r => r.status === 'added' || r.status === 'already_present');
            const t = added && db.prepare('SELECT id FROM document_types WHERE slug = ?').get(added.slug);
            if (!t) return finish(400, { error: 'unknown_type' });
            body.documentTypeId = t.id;
          }
          // SAFE-subset ext (drop macro/OLE formats for the upload lane). Sanitize name to a basename.
          const baseName = P.basename(String(rawName));
          const ext = fileKinds.normExt(baseName);
          if (!fileKinds.isUploadIntake(ext)) return finish(415, { code: 'UNSUPPORTED_TYPE', error: 'that file type cannot be uploaded' });
          let bytes; try { bytes = Buffer.from(b64, 'base64'); } catch { return finish(400, { error: 'bad file data' }); }
          if (!bytes.length) return finish(400, { error: 'empty file' });
          if (bytes.length > maxMb * 1024 * 1024) return finish(413, { code: 'TOO_LARGE', error: `file exceeds ${maxMb} MB` });
          // Write the bytes to a MINTED temp under userData (never the client-supplied name).
          const osMod = require('os');
          tmp = P.join(osMod.tmpdir(), `ds_v1intake_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
          try { fsx.writeFileSync(tmp, bytes); } catch { return finish(500, { error: 'could not stage the upload' }); }

          const filing = require('../filing/handler');
          const processing = require('../processing/handler');
          const appMod = ctx.app || require('electron').app;
          const deps = {
            fs: fsx, path: P,
            outputRoot: learning.getSetting(db, 'output_folder', null),
            inboxDir: P.join(appMod.getPath('userData'), 'inbox'),
            commitDocument: ctx.commitDocument || filing.commitDocument,
            normaliseDate: ctx.normaliseDate || filing.normaliseDate,
            ensureWorkingCopy: ctx.ensureWorkingCopy || processing.ensureWorkingCopy,
            maxMb,
            logAudit: (d, action, m) => { try { audit({ user_id: session.userId, action, action_category: 'document', outcome: 'success', ...(m || {}) }); } catch {} },
          };
          const input = {
            srcPath: tmp, ext, size: bytes.length,
            documentTypeId: body.documentTypeId,
            party: body.party, date: body.date, title: body.title || baseName,
            reference: body.reference, notes: body.notes,
          };
          let r; try { r = await svc.submit(db, actorOf(session), input, deps); }
          catch (e) { log('[api] intake submit: ' + (e && e.message)); return finish(500, { error: 'filing failed' }); }
          if (r && r.ok) {
            try { audit({ user_id: session.userId, action: 'document_direct_intake', action_category: 'document',
                          outcome: 'success', document_id: r.docId, metadata: { via: 'client', ip: clientIp(req), type: body.documentTypeId } }); } catch {}
            return finish(200, { ok: true, docId: r.docId });
          }
          const map = { disabled: 409, forbidden: 403, unsupported_type: 415, too_large: 413, bad_date: 400, bad_request: 400, unknown_type: 400 };
          return finish(map[r && r.error] || 500, { ok: false, error: (r && r.error) || 'failed' });
        } catch (e) { return finish(500, { error: 'upload failed' }); }
      }

      const delMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/delete$`));
      if (req.method === 'POST' && delMatch) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const id = Number(delMatch[1]);
        // Workflow lock (FYI slice, Oracle C1): this door had NO guard — a remote edit-role user
        // could delete an approval-locked doc the desktop would refuse (authz asymmetry + the
        // stranded-route hole). Same semantics as the desktop door: approval-locked ⇒ 409 for a
        // non-admin writer; admin override proceeds (audited) and the route-close below leaves
        // the honest tombstone. An open FYI route never blocks.
        const guard = workflowService.editGuard(getDb(), id, session.role);
        if (!guard.ok) return sendJson(res, 409, { error: guard.error, code: guard.code });
        if (guard.overridden) {
          audit({ user_id: session.userId, action: 'workflow_lock_overridden', action_category: 'workflow',
                  outcome: 'success', document_id: id, metadata: { action: 'delete', via: 'client' } });
        }
        documents.softDelete(getDb(), id);
        try { ctx.notifyBinChanged && ctx.notifyBinChanged(); } catch {}   // a remote client mutated the bin
        const closed = workflowService.closeOpenRoutesForDeletedDoc(getDb(),
          { documentId: id, deletedByName: session.username }).closed;
        if (closed.length) {
          audit({ user_id: session.userId, action: 'workflow_route_closed_on_delete', action_category: 'workflow',
                  outcome: 'success', document_id: id, metadata: { routes: closed.map(r => r.id), via: 'client' } });
          try { ctx.notifyWorkflowEvent && ctx.notifyWorkflowEvent({ event: 'auto_closed' }); } catch { /* badge-ping only (unknown event ⇒ no toast) */ }
        }
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
        try { ctx.notifyBinChanged && ctx.notifyBinChanged(); } catch {}
        audit({ user_id: session.userId, action: 'document_restored', action_category: 'document',
                outcome: 'success', document_id: id, metadata: { via: 'client' } });
        return sendJson(res, 200, { ok: true });
      }

      const purgeMatch = pathname.match(new RegExp(`^${API_PREFIX}/documents/(\\d+)/purge$`));
      if (req.method === 'POST' && purgeMatch) {
        const session = requireSession(req, res); if (!session) return;
        if (session.role !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
        const id = Number(purgeMatch[1]);
        _purgeDocFiles(getDb(), id, { fs: ctx.fs || require('fs'), path: ctx.path || path });
        documents.deleteDoc(getDb(), id);
        try { ctx.notifyBinChanged && ctx.notifyBinChanged(); } catch {}
        audit({ user_id: session.userId, action: 'document_purged', action_category: 'document',
                outcome: 'success', document_id: id, metadata: { via: 'client' } });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && pathname === `${API_PREFIX}/documents/purge-all`) {
        const session = requireSession(req, res); if (!session) return;
        if (session.role !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
        const ids = documents.getDeletedQueue(getDb()).map(d => d.id);
        for (const id of ids) { _purgeDocFiles(getDb(), id, { fs: ctx.fs || require('fs'), path: ctx.path || path }); documents.deleteDoc(getDb(), id); }
        try { ctx.notifyBinChanged && ctx.notifyBinChanged(); } catch {}   // once for the whole empty-bin
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

      // Per-user box counts (Slice 1 badge poll) — COUNTs only, so the client's 60s poll
      // costs ONE cheap request instead of four full list fetches, and never touches
      // myOpenRoutes semantics (the full lists stay on view-load/action). Auto-gated by
      // the WORKFLOW_ROUTE prefix (entitlement + workflow sub-seat) like every
      // /v1/workflow path; contract is MAJOR-only so this addition needs no bump.
      if (req.method === 'GET' && pathname === `${API_PREFIX}/workflow/counts`) {
        const session = requireSession(req, res); if (!session) return;
        const dbwf = require('../../../database/modules/workflow');
        const uid = session.userId;
        return sendJson(res, 200, { counts: {
          inbox:     dbwf.countInbox(getDb(), uid),
          sent:      dbwf.countSent(getDb(), uid),
          assigned:  dbwf.countAssigned(getDb(), uid),
          completed: dbwf.countCompleted(getDb(), uid),
        } });
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

      // ── STAMPING (Workflow+Stamping redesign 2026-08-28). All under /v1/workflow/* → the WORKFLOW_ROUTE
      //    entitlement gate + workflow sub-seat already applied above. Path-free DTOs; the placer is the
      //    authenticated actor (never a body field); read + write gate on canAccessDocument (Oracle C2). ──
      const _canAccess = (db, session, docId) =>
        require('../../services/accessService').canAccessDocument(db, { userId: session.userId, role: session.role }, docId).allow;

      if (req.method === 'GET' && pathname === `${API_PREFIX}/workflow/stamp-types`) {
        const session = requireSession(req, res); if (!session) return;
        return sendJson(res, 200, { stampTypes: stampsDb.listStampTypes(getDb()) });
      }
      if (req.method === 'GET' && pathname === `${API_PREFIX}/workflow/can-stamp`) {
        const session = requireSession(req, res); if (!session) return;
        return sendJson(res, 200, { canStamp: stampPerm.canStamp(getDb(), session.userId) });
      }
      const wfStampDoc = pathname.match(new RegExp(`^${API_PREFIX}/workflow/documents/(\\d+)/stamps$`));
      if (wfStampDoc && (req.method === 'GET' || req.method === 'POST')) {
        const session = requireSession(req, res); if (!session) return;
        const db = getDb(), docId = Number(wfStampDoc[1]);
        if (!_canAccess(db, session, docId)) return sendJson(res, 404, { error: 'not found' });   // hide existence
        if (req.method === 'GET') return sendJson(res, 200, { stamps: stampSvc.stampsForDocument(db, docId) });
        let body; try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const r = await stampSvc.placeStamp(db, actorOf(session),
          { documentId: docId, stampTypeId: body.stampTypeId, box: body.box, page: body.page, note: body.note });
        return r.ok ? sendJson(res, 200, { ok: true, stampEventId: r.stampEventId })
                    : sendJson(res, wfStatus(r.code), { error: r.error, code: r.code });
      }
      const wfStampedDoc = pathname.match(new RegExp(`^${API_PREFIX}/workflow/documents/(\\d+)/stamped$`));
      if (req.method === 'GET' && wfStampedDoc) {
        const session = requireSession(req, res); if (!session) return;
        const db = getDb(), docId = Number(wfStampedDoc[1]);
        if (!_canAccess(db, session, docId)) return sendJson(res, 404, { error: 'not found' });
        const cur = stampSvc.currentArtifact(db, docId);
        if (!cur) return sendJson(res, 404, { error: 'no stamp' });
        const P = ctx.path || require('path');
        const pages = await previewService.getDocumentPages(db, {
          docId, folderPath: P.dirname(cur.path), filename: P.basename(cur.path), exact: true, scale: 6,
        }, pageDeps());
        return sendJson(res, 200, { pages, count: cur.count });
      }

      // ── Contract 1.4.0 (2026-09-14): the four workflow bits the search POP-OUT lacked (client search parity
      //    follow-up — pendingfeatures "workflow bits still HIDDEN"). Each MIRRORS its desktop IPC twin in
      //    src/modules/workflow/handler.js one-to-one: the same role gate, the same accessService gate on a NEW by-id
      //    read seam (SEC-03), the same PROJECTED shape (no stamped_path, no sender comment — Oracle OC4), the same
      //    service call. All under /v1/workflow/* → the WORKFLOW_ROUTE entitlement gate + sub-seat applied above. ──
      const dbwfRoutes = () => require('../../../database/modules/workflow');
      // OPEN routes for one document (the "Sent to <name> — awaiting …" banner). admin/edit read.
      const wfDocRoutes = pathname.match(new RegExp(`^${API_PREFIX}/workflow/documents/(\\d+)/routes$`));
      if (req.method === 'GET' && wfDocRoutes) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const db = getDb(), docId = Number(wfDocRoutes[1]);
        if (!_canAccess(db, session, docId)) return sendJson(res, 404, { error: 'not found' });   // hide existence
        const routes = dbwfRoutes().listOpenRoutesForDocument(db, docId)
          .map(r => ({ id: r.id, to_username: r.to_username, from_username: r.from_username,
                       action_required: r.action_required, state: r.state, created_at: r.created_at, version: r.version }));
        return sendJson(res, 200, { routes });
      }
      // DECISION HISTORY (closed routes) for one document — projected in the SQL: has_stamped + the route id feed
      // the stamped-copy read, never a path; resolution_comment ships BY DESIGN (it is the decision record).
      const wfDocHistory = pathname.match(new RegExp(`^${API_PREFIX}/workflow/documents/(\\d+)/history$`));
      if (req.method === 'GET' && wfDocHistory) {
        const session = requireSession(req, res); if (!session) return;
        if (!isWriter(session)) return sendJson(res, 403, { error: 'forbidden' });
        const db = getDb(), docId = Number(wfDocHistory[1]);
        if (!_canAccess(db, session, docId)) return sendJson(res, 404, { error: 'not found' });
        return sendJson(res, 200, { history: dbwfRoutes().listClosedRoutesForDocument(db, docId) });
      }
      // ADMIN CANCEL (E1's escape hatch for routes recall can't reach) — admin at the route AND inside the service;
      // CAS on the version (a stale cancel is a truthful 409). The reason is a short free text, never required.
      const wfCancel = pathname.match(new RegExp(`^${API_PREFIX}/workflow/routes/(\\d+)/cancel$`));
      if (req.method === 'POST' && wfCancel) {
        const session = requireSession(req, res); if (!session) return;
        if (session.role !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
        let body; try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : undefined;
        const r = workflow.adminCancelRoute(getDb(), { ...actorOf(session), displayName: viewerOf(session).displayName },
                                            Number(wfCancel[1]), { reason, expectedVersion: body.version });
        return r.ok ? sendJson(res, 200, { route: dto.projectRoute(r.route) })
                    : sendJson(res, wfStatus(r.code), { error: r.error, code: r.code });
      }
      // NEW STAMP TYPE ("+ New stamp" in the popup) — admin only like the desktop 'stamp-type-create'; the catalog
      // module validates the word (≤16 chars, not a built-in, not a duplicate) and the colour (#rrggbb).
      if (req.method === 'POST' && pathname === `${API_PREFIX}/workflow/stamp-types`) {
        const session = requireSession(req, res); if (!session) return;
        if (session.role !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
        let body; try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const r = stampsDb.createStampType(getDb(), { label: body.label, color: body.color,
          category: typeof body.category === 'string' ? body.category.slice(0, 64) : null, createdBy: session.userId });
        return r.ok ? sendJson(res, 200, { ok: true, id: Number(r.id), key: r.key })
                    : sendJson(res, 400, { error: r.error, code: r.code });
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

      // ── Teach-over-client S2: create a document type from the client teach wizard (contract 1.7.0) ──────
      // The wizard's "create a new type" and "Add from catalog" paths. ADMIN-only (mirrors the desktop
      // create-doc-type-with-fields / get-doctype-catalog / add-doctype-presets, all requireRole('admin')); the
      // /doc-types feature route already carries the detached-client entitlement gate. SCHEMA only — no
      // template/learning write here (the template teach = mappings/fixed/hidden is S3's transactional commit).
      // A validation failure returns 400 {error} so the wizard shows it inline exactly as on the core.
      if (req.method === 'POST' && pathname === `${API_PREFIX}/doc-types`) {
        const session = requireSession(req, res); if (!session) return;
        if (session.role !== 'admin') return sendJson(res, 403, { error: 'only an admin can create a document type' });
        let body; try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const r = doctypes.createTypeWithFields(getDb(), {
          name: body && body.name, fields: body && body.fields,
          ref_field_key: body && body.ref_field_key, date_field_key: body && body.date_field_key,
          title_aliases: body && body.title_aliases,
        });
        if (!r.success) return sendJson(res, 400, { error: r.error });
        try { audit({ user_id: session.userId, action: 'doc_type_create', action_category: 'admin', outcome: 'success',
                      metadata: { via: 'client', ip: clientIp(req), type_id: r.id, name: String((body && body.name) || '').trim() } }); } catch {}
        return sendJson(res, 200, { success: true, id: r.id, type: r.type, notices: r.notices || [] });
      }

      // The ready-made preset catalog + whether each is already installed (the wizard's "Add from catalog").
      if (req.method === 'GET' && pathname === `${API_PREFIX}/doc-types/catalog`) {
        const session = requireSession(req, res); if (!session) return;
        if (session.role !== 'admin') return sendJson(res, 403, { error: 'forbidden' });
        return sendJson(res, 200, { catalog: doctypes.getPresetCatalog(getDb()) });
      }

      // Add the ticked catalog presets (create type + fields + roles + label seeds, per slug).
      if (req.method === 'POST' && pathname === `${API_PREFIX}/doc-types/presets`) {
        const session = requireSession(req, res); if (!session) return;
        if (session.role !== 'admin') return sendJson(res, 403, { error: 'only an admin can add a document type' });
        let body; try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
        const slugs = Array.isArray(body && body.slugs) ? body.slugs : (body && body.slugs ? [body.slugs] : []);
        if (!slugs.length) return sendJson(res, 400, { error: 'Select at least one document type to add.' });
        let results; try { results = doctypes.addPresetTypes(getDb(), slugs); } catch (e) { return sendJson(res, 500, { error: e.message }); }
        try { audit({ user_id: session.userId, action: 'doc_type_presets_add', action_category: 'admin', outcome: 'success',
                      metadata: { via: 'client', ip: clientIp(req), slugs } }); } catch {}
        return sendJson(res, 200, { success: true, results });
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
    // The private key is stored DPAPI-wrapped (certService writes it with the `ENC1:` prefix), so
    // it is unwrapped here, in memory, at listen time — never written back in the clear. The
    // helper passes a plain PEM straight through, so an install whose key predates the change, or
    // one where the operator pointed the setting at their own certificate, keeps working unchanged.
    server = https.createServer({
      cert: fs.readFileSync(cfg.certPath),
      key: require('../../lib/secretStore').decryptAtRest(fs.readFileSync(cfg.keyPath, 'utf8')),
    }, listener);
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

  // H1: encrypt the CA private key at rest (Electron safeStorage / DPAPI). Kill switch
  // CERT_KEY_ENCRYPT_DISABLED=1 restores plaintext (passthrough). Backward-compatible: a legacy
  // plaintext ca.key reads fine and is migrated to encrypted on this reuse.
  const secret = process.env.CERT_KEY_ENCRYPT_DISABLED === '1' ? undefined : require('../../lib/secretStore');
  const r = certService.generateServerCerts({ certsDir: certsDirFor(ctx), sans, reuseCa: true, fs, secret });
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
// Generate a short pairing code — Oracle C4: >=8 UNAMBIGUOUS alphanumerics (no 0/O/1/I/L) so it's readable off
// a screen yet large enough (32^8 ~ 1.1e12) that brute-forcing /v1/ca in the code's short lifetime is impractical.
function _genPairingCode(len = 8) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 30 chars, no 0/O/1/I/L
  const crypto = require('crypto');
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

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
  // Pairing code — the "Connect a client" verification aid (Oracle C4). Setting a code makes /v1/ca + /v1/enroll
  // require a matching ?code= (pairingOk); it is NOT the access control (that stays credentials + entitlement +
  // seat) and is NEVER mandatory-by-default. Admin-only; the code is shown to the admin so they can read/QR it.
  ipcMain.handle('client-api-pairing-generate', (_e, opts) => {
    requireRole('admin');
    const mins = Math.min(60, Math.max(1, Number(opts && opts.minutes) || 10));
    const code = _genPairingCode();
    const expires = Date.now() + mins * 60000;
    learning.setSetting(getDb(), 'client_api_pairing_code', code);
    learning.setSetting(getDb(), 'client_api_pairing_expires', String(expires));
    return { ok: true, code, expires };
  });
  ipcMain.handle('client-api-pairing-clear', () => {
    requireRole('admin');
    learning.setSetting(getDb(), 'client_api_pairing_code', '');
    learning.setSetting(getDb(), 'client_api_pairing_expires', '');
    return { ok: true };
  });
  ipcMain.handle('client-api-pairing-status', () => {
    requireRole('admin');
    const db = getDb();
    const code = learning.getSetting(db, 'client_api_pairing_code') || '';
    const exp = Number(learning.getSetting(db, 'client_api_pairing_expires') || 0);
    const active = !!code && (!exp || Date.now() < exp);
    return { active, code: active ? code : '', expires: active ? exp : 0 };
  });
  // The "Connect a client" QR — generated in MAIN (Oracle/eric): a small JSON of {host,port,tls,fingerprint,code}
  // ONLY, NEVER the CA PEM (the profile FILE carries the PEM; the QR carries the verifier). Fingerprint-only keeps
  // the QR sparse enough to photograph off a screen.
  ipcMain.handle('client-api-connect-qr', async () => {
    requireRole('admin');
    const st = apiStatus(ctx);
    const cs = managedCertStatus(ctx);
    const db = getDb();
    const code = learning.getSetting(db, 'client_api_pairing_code') || '';
    const exp = Number(learning.getSetting(db, 'client_api_pairing_expires') || 0);
    const active = !!code && (!exp || Date.now() < exp);
    const payload = JSON.stringify({
      v: 1, host: st.host, port: st.port, tls: !!st.tls,
      fp: (cs && cs.caFingerprint) || null, code: active ? code : undefined,
    });
    try {
      const QR = require('qrcode');
      const dataUrl = await QR.toDataURL(payload, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
      return { ok: true, dataUrl };
    } catch (e) { return { ok: false, error: (e && e.message) || 'QR unavailable' }; }
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
  _genPairingCode,   // exported for test_pairing_code.js (Oracle C4)
  API_CONTRACT_VERSION, API_PREFIX,
};
