'use strict';
// clientTransport.js — the detached CLIENT's adapter for the shared search UI (client search parity S1,
// 2026-09-13; Oracle-vetted). The shared modules under ../shared/search-ui reach IO ONLY through
// `window.SearchTransport`; here every call goes over the client's preload bridge (window.scanfinder) to the
// client MAIN process, which talks to the core's /v1 API (the session token never enters this renderer).
//
// Semantics, mirrored from the core adapter so the shared UI's error branches behave identically:
//   • the bridge returns { status, json } envelopes → UNWRAP to the core's payload shapes;
//   • a non-200 REJECTS (the core's in-process bridge rejects on failure — the shared UI's honest-error
//     states were written against that), with the server's error text;
//   • a 401 = the session is gone → tell main (it closes this window + signs the main window out);
//   • a 404 / 426 / 402 on a capability endpoint flips that cap OFF + returns the graceful empty shape
//     (the shared UI then hides the control — never a dead button).
// caps (absent = true; see _cap() in the shared searchState.js): what the /v1 surface can back TODAY.
//   S1: list, detail, full-page render, thumbnails, recycle bin, entitlement, role. The lazy single-page /
//   page-count / find / spreadsheet reads are S2 (/v1 endpoints + contract 1.3.0) — their caps stay false until
//   BOTH this client has the method AND the server advertises ≥ 1.3.0. Desktop-local actions (Explorer /
//   Open File / Edit in Review / Print), Send-back and Restore-all have no /v1 backing → hidden.
(function () {
  const api = window.scanfinder;
  const S2_METHODS_PRESENT = true;    // S2 (2026-09-13): the single-page / page-count / find / grid reads are wired below

  function expired() { try { api.popoutSessionExpired(); } catch {} }
  // Unwrap an envelope or reject like the core bridge would.
  function unwrap(r, pick) {
    if (!r) throw new Error('No response from the server.');
    if (r.status === 401) { expired(); throw new Error('Your session has ended — please sign in again.'); }
    if (r.status === 402) throw new Error('Not licensed.');
    if (r.status === 403) throw new Error('You don’t have access to this document.');
    if (r.status === 404) throw new Error('Not found.');
    if (r.status !== 200) throw new Error((r.json && r.json.error) || ('The server replied ' + r.status + '.'));
    return pick ? pick(r.json || {}) : r.json;
  }
  // For a cap-gated read: a missing/unsupported endpoint flips the cap off and yields the empty shape.
  function capGated(name, empty, call, pick) {
    return async (...a) => {
      const r = await call(...a);
      if (r && (r.status === 404 || r.status === 426 || r.status === 402)) { T.caps[name] = false; return empty; }
      return unwrap(r, pick);
    };
  }
  // For the 1.4.0 PER-DOCUMENT reads: a 404 is ALSO "this document is hidden from you" (the core's accessService
  // answers 404 to hide existence — a purged-under-you or department-restricted doc), so it must NOT strip the cap
  // for the session (Oracle 2026-09-14 condition 2). The handshake already decided the cap; a 404 yields the empty
  // shape for THAT call only. 426 / 402 (a core without the route / no add-on) still flip it.
  function docRead(name, empty, call, pick) {
    return async (...a) => {
      const r = await call(...a);
      if (r && r.status === 404) return empty;
      if (r && (r.status === 426 || r.status === 402)) { T.caps[name] = false; return empty; }
      return unwrap(r, pick);
    };
  }

  // "View stamped copy" — the core opens its stamped-viewer WINDOW; the client shows the same page images in an
  // in-window overlay (mirrors the main window's viewStamped). The pages come from GET /v1/workflow/routes/:id/stamped:
  // party-or-admin gated on the core, rendered server-side, never a path. A refusal / missing copy is a toast.
  async function stampedOverlay(routeId) {
    const say = (m) => { try { if (window.SearchState && window.SearchState.toast) window.SearchState.toast(m); } catch {} };
    let pages = [];
    try { pages = unwrap(await api.workflow.stamped(routeId), (j) => (Array.isArray(j.pages) ? j.pages : [])); }
    catch (e) { say((e && e.message) || 'No stamped copy available.'); return; }
    if (!pages.length) { say('No stamped copy available.'); return; }
    const old = document.getElementById('stamped-overlay'); if (old) old.remove();
    const ov = document.createElement('div'); ov.id = 'stamped-overlay';
    const box = document.createElement('div'); box.className = 'stamped-view';
    const head = document.createElement('div'); head.className = 'stamped-head';
    const title = document.createElement('span'); title.textContent = 'Stamped copy';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'btn'; close.textContent = 'Close';
    head.append(title, close);
    const list = document.createElement('div'); list.className = 'stamped-pages';
    for (const src of pages) { const im = document.createElement('img'); im.src = src; im.alt = 'Stamped page'; list.appendChild(im); }
    box.append(head, list); ov.appendChild(box); document.body.appendChild(ov);
    const onKey = (e) => { if (e.key === 'Escape') done(); };
    const done = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    close.addEventListener('click', done);
    ov.addEventListener('click', (e) => { if (e.target === ov) done(); });
    document.addEventListener('keydown', onKey);
  }

  const T = {
    caps: {
      singlePage: false, pageCount: false, find: false, spreadsheet: false,   // S2 (version-gated below)
      bin: true, restoreAll: false, sendBack: false,
      localFile: false, review: false, print: false,
      stamps: true,                                                           // S4: the /v1 stamp routes
      settings: false,
      // S4 workflow: list/recipients/assign/resolve/recall + the stamp routes are wired below. The per-doc
      // history + open-routes reads, admin cancel and "+ New stamp" arrived with contract 1.4.0 (2026-09-14):
      // their caps flip ON in refreshCaps when BOTH this client and the core are ≥ 1.4.0 AND the signed-in role
      // may use them (reads: admin/edit; cancel + new stamp: admin — the core answers 403 otherwise, and a
      // hidden control beats a refused one). The stamped-copy viewer is an in-window overlay over the
      // long-standing GET /routes/:id/stamped read → always on.
      workflowHistory: false, docRoutes: false, adminCancel: false, stampCreate: false, stampedViewer: true,
    },
    // list + bin  (server: {confirmed, uncommitted} / {deleted} / 200 on the mutations)
    searchDocuments:      async (params) => unwrap(await api.search(params || {}), (j) => ({ confirmed: j.confirmed || [], uncommitted: j.uncommitted || [] })),
    getDeletedQueue:      async () => unwrap(await api.recycle.list(), (j) => j.deleted || []),
    restoreAllDeleted:    async () => { throw new Error('Restore all is not available from the search client.'); },   // caps.restoreAll=false — never shown
    purgeAllDeleted:      async () => unwrap(await api.recycle.purgeAll(), () => ({ ok: true })),
    deleteDocument:       async (id) => unwrap(await api.recycle.delete(id), () => ({ ok: true })),
    restoreDocument:      async (id) => unwrap(await api.recycle.restore(id), () => ({ ok: true })),
    purgeDocument:        async (id) => unwrap(await api.recycle.purge(id), () => ({ ok: true })),
    repairDeconfirm:      async () => { throw new Error('Send back to Review is not available from the search client.'); },   // caps.sendBack=false
    // preview  (server: the detail DTO / {pages:[dataUrl]} / {thumbnail})
    getDocumentDetail:    async (id) => unwrap(await api.getDocument(id)),
    getDocumentPages:     async (id) => unwrap(await api.getPages(id), (j) => j.pages || []),
    getDocumentThumbnail: async (id) => unwrap(await api.getThumbnail(id), (j) => j.thumbnail || null),
    // The S2 reads (contract 1.3.0): cap-gated — an older core (404) flips the cap off and the shared UI hides
    // the control; the shapes unwrap to exactly what the core bridge hands the shared UI.
    getDocumentPage:      capGated('singlePage', null, (id, index, scale) => api.getPage(id, index, scale), (j) => j.page || null),
    getDocumentPageCount: capGated('pageCount', null, (id) => api.getPageCount(id), (j) => (Number.isFinite(j.count) && j.count > 0 ? j.count : null)),
    // find: a status-0 envelope is the client's OWN timeout/error (never a lost connection) → the shared UI's
    // "took too long" state; a real non-200 rejects like the core bridge (→ _clearMatches, as today).
    findInDocument:       async (id, q) => {
      const r = await api.find(id, q);
      if (r && r.status === 0) return { kind: (r.json && r.json.kind) || 'error', pages: 0, matches: [] };
      if (r && (r.status === 404 || r.status === 426 || r.status === 402)) { T.caps.find = false; return { kind: 'none', pages: 0, matches: [] }; }
      return unwrap(r, (j) => ({ kind: j.kind || 'none', pages: j.pages || 0, matches: Array.isArray(j.matches) ? j.matches : [] }));
    },
    getSpreadsheetGrid:   capGated('spreadsheet', null, (id) => api.getSpreadsheet(id), (j) => j.grid || null),
    // desktop-local actions — no /v1 backing (caps false → hidden); defined so nothing can throw "not a function"
    showDocumentInExplorer: async () => ({ success: false, error: 'Not available from the search client.' }),
    openDocumentFile:       async () => ({ success: false, error: 'Not available from the search client.' }),
    openReviewWindowAt:     () => {},
    printDocument:          async () => ({ ok: false, reason: 'disabled' }),
    printAvailable:         async () => false,
    // bootstrap state  (server: {types:[…]} / {entitled, workflow:{entitled}} ; main: {role, username, displayName} | null)
    // /v1/doc-types is WRITER-gated (403 for a read-only user) — the type FILTER is optional, so a refusal
    // means "no dropdown entries", never a failed boot (the core's IPC never refuses, so its init is unguarded).
    getAllDocTypes:       async () => { const r = await api.review.docTypes(); if (r && r.status === 403) return []; return unwrap(r, (j) => j.types || []); },
    getEntitlement:       async () => unwrap(await api.entitlement()),
    authGetCurrentUser:   async () => (await api.currentUser()) || null,   // null = signed out → read-only
    getSetting:           async () => null,
    // stamping (S4) over the /v1 workflow stamp routes (workflow-add-on gated server-side: a 402 → the shared UI's
    // try/catch paths → no stamp button). Shapes unwrap to what the core bridge hands the shared UI.
    stamp: {
      can:          async () => unwrap(await api.workflow.canStamp(), (j) => ({ canStamp: !!j.canStamp })),
      types:        async () => unwrap(await api.workflow.stampTypes(), (j) => j.stampTypes || []),
      // 1.4.0: the popup's "+ New stamp" (admin; the core validates the word + colour and answers 400 with its reason)
      typeCreate:   async (p) => unwrap(await api.workflow.stampTypeCreate({ label: p && p.label, color: p && p.color }), (j) => ({ ok: true, id: j.id, key: j.key })),
      place:        async (p) => unwrap(await api.workflow.stampPlace(p.documentId, { stampTypeId: p.stampTypeId, box: p.box, page: p.page, note: p.note }), () => ({ ok: true })),
      list:         async (id) => unwrap(await api.workflow.stampList(id), (j) => j.stamps || []),
      currentPages: async (id) => unwrap(await api.workflow.stampedDoc(id), (j) => ({ ok: true, pages: j.pages || [] })),
      grants:       async () => { throw new Error('not available'); },   // the shared UI falls back to "any recipient"
    },
    // workflow (S4) over /v1/workflow/* ; the four boxes unwrap {routes}, recipients {recipients}
    workflow: {
      inbox:             async () => unwrap(await api.workflow.list('inbox'), (j) => j.routes || []),
      sent:              async () => unwrap(await api.workflow.list('sent'), (j) => j.routes || []),
      assigned:          async () => unwrap(await api.workflow.list('assigned'), (j) => j.routes || []),
      completed:         async () => unwrap(await api.workflow.list('completed'), (j) => j.routes || []),
      recipients:        async () => unwrap(await api.workflow.recipients(), (j) => j.recipients || []),
      assign:            async (documentId, toUserId, actionRequired, comment, resubmitOf) => unwrap(await api.workflow.assign(documentId, toUserId, actionRequired, comment, resubmitOf), () => ({ ok: true })),
      resolve:           async (id, decision, comment, version) => unwrap(await api.workflow.resolve(id, decision, comment, version), () => ({ ok: true })),
      recall:            async (id, version) => unwrap(await api.workflow.recall(id, version), () => ({ ok: true })),
      // 1.4.0: the per-document reads (cap-gated — an older core's 404 flips the cap off and the shared UI falls
      // back to the plain assign form / no history), the admin two-step cancel, and the stamped-copy overlay.
      adminCancel:       async (id, version, reason) => unwrap(await api.workflow.adminCancel(id, version, reason), (j) => ({ ok: true, route: j.route })),
      docRoutes:         docRead('docRoutes', [], (id) => api.workflow.docRoutes(id), (j) => j.routes || []),
      docHistory:        docRead('workflowHistory', [], (id) => api.workflow.docHistory(id), (j) => j.history || []),
      openStampedViewer: (routeId) => { stampedOverlay(routeId); },
    },
    // no push channel for bin changes over /v1 today — the shared UI's focus-refresh belt covers it
  };
  window.SearchTransport = T;

  // Capability gate from the server handshake: the S2 reads need BOTH this client's methods AND a server
  // that advertises them (contract ≥ 1.3.0). Also exposes "the client knows more than the server" so the
  // pop-out can show the one-line "newer ScanFinder needed on the core PC" hint (remediable drift only).
  function parseVer(v) { const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)/); return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null; }
  function atLeast(v, want) { const a = parseVer(v), b = parseVer(want); return !!(a && b && (a.major > b.major || (a.major === b.major && a.minor >= b.minor))); }
  T.capabilityInfo = { serverVersion: null, clientContract: null, serverBehind: false, ready: false };
  T.refreshCaps = async function refreshCaps() {
    let info = null;
    try { info = await api.serverInfo(); } catch { info = null; }
    const sv = info && info.serverVersion, cc = info && info.clientContract;
    const serverHasS2 = atLeast(sv, '1.3.0');
    const clientHasS2 = S2_METHODS_PRESENT && atLeast(cc, '1.3.0');
    const on = clientHasS2 && serverHasS2;
    T.caps.singlePage = on; T.caps.pageCount = on; T.caps.find = on; T.caps.spreadsheet = on;
    // 1.4.0: the pop-out's last workflow bits — version AND role gated (the core refuses the wrong role with a 403;
    // a hidden control beats a refused one). Role from main's login record (never a token).
    const serverHas14 = atLeast(sv, '1.4.0');
    const clientHas14 = atLeast(cc, '1.4.0');
    const role = (window.SearchState && window.SearchState.role) || null;   // set by the shared init from main's login record
    const on14 = clientHas14 && serverHas14, writer = role === 'admin' || role === 'edit', admin = role === 'admin';
    T.caps.docRoutes = on14 && writer; T.caps.workflowHistory = on14 && writer;
    T.caps.adminCancel = on14 && admin; T.caps.stampCreate = on14 && admin;
    const serverBehind = (clientHasS2 && !serverHasS2) || (clientHas14 && !serverHas14);
    T.capabilityInfo = { serverVersion: sv || null, clientContract: cc || null, serverBehind, ready: true };
    return T.capabilityInfo;
  };
})();
