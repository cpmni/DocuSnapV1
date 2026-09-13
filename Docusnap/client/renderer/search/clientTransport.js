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
  const S2_METHODS_PRESENT = false;   // flipped to true by S2 when the single-page/page-count/find/grid methods land

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
  function capGated(name, empty, call) {
    return async (...a) => {
      let r;
      try { r = await call(...a); } catch (e) { throw e; }
      if (r && (r.status === 404 || r.status === 426 || r.status === 402)) { T.caps[name] = false; return empty; }
      return unwrap(r);
    };
  }

  const T = {
    caps: {
      singlePage: false, pageCount: false, find: false, spreadsheet: false,   // S2 (version-gated below)
      bin: true, restoreAll: false, sendBack: false,
      localFile: false, review: false, print: false,
      stamps: false,                                                          // S4
      settings: false,
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
    // S2 placeholders — caps are false so the shared UI never calls these in S1; they exist so a flipped cap
    // can never hit "not a function". S2 replaces them with the real /v1 reads (capGated).
    getDocumentPage:      async () => null,
    getDocumentPageCount: async () => null,
    findInDocument:       async () => ({ kind: 'none', pages: 0, matches: [] }),
    getSpreadsheetGrid:   async () => null,
    // desktop-local actions — no /v1 backing (caps false → hidden); defined so nothing can throw "not a function"
    showDocumentInExplorer: async () => ({ success: false, error: 'Not available from the search client.' }),
    openDocumentFile:       async () => ({ success: false, error: 'Not available from the search client.' }),
    openReviewWindowAt:     () => {},
    printDocument:          async () => ({ ok: false, reason: 'disabled' }),
    printAvailable:         async () => false,
    // bootstrap state  (server: {types:[…]} / {entitled, workflow:{entitled}} ; main: {role, username, displayName} | null)
    getAllDocTypes:       async () => unwrap(await api.review.docTypes(), (j) => j.types || []),
    getEntitlement:       async () => unwrap(await api.entitlement()),
    authGetCurrentUser:   async () => (await api.currentUser()) || null,   // null = signed out → read-only
    stamp:                { can: async () => ({ canStamp: false }) },       // S4
    getSetting:           async () => null,
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
    T.capabilityInfo = { serverVersion: sv || null, clientContract: cc || null, serverBehind: clientHasS2 && !serverHasS2, ready: true };
    return T.capabilityInfo;
  };
})();
