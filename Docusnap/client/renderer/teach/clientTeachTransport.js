'use strict';
// clientTeachTransport.js — the detached CLIENT's DATA adapter for the shared teach wizard (teach-over-client
// S1, 2026-09-14; the clientTransport.js twin). The shared wizard (../shared/teach-ui/teach.js) reaches IO
// ONLY through window.TeachTransport; here every call goes over the client preload bridge (window.scanfinder)
// to the client MAIN process → the core's /v1 API. The session token never enters this renderer.
// window.TeachHost (window/navigation chrome) is provided by popout.js.
//
// Semantics mirror the search adapter so the wizard's error branches behave as on the core: the bridge returns
// { status, json } envelopes → UNWRAP to the core payload shapes; a non-200 REJECTS with the server's text; a
// 401 tells main (it closes this window + signs out). The doc being taught comes from window.TeachState.docId
// (the wizard passes only the image to the OCR calls — the /v1 routes are doc-scoped).
//
// caps (absent = true; see _cap() in the shared teach.js):
//   import  = false — no local-file import; teach the core's review queue (the wizard hides the "Import a PDF"
//             control + the empty state points at the main PC, Oracle C7).
//   review  = false — the client has no core Review window (the follow-up "Check in Review" is hidden).
//   settings= true  — the wizard's feature flags come from GET /v1/teach/config.
// S1 = the wizard runs from the queue up to the summary; SAVING (promote/mapping/confirm) is S3 and doc-type
// CREATE/EDIT is S2 — those methods throw a clear "coming soon" so a stray call is honest, never a silent break.
(function () {
  const api = window.scanfinder;
  const docId = () => (window.TeachState && window.TeachState.docId) || 0;   // the currently-taught doc (set by teach.js)
  const soon = (m) => async () => { throw new Error(m || 'That isn’t available from the search client yet.'); };

  function expired() { try { api.popoutSessionExpired(); } catch {} }
  function unwrap(r, pick) {
    if (!r) throw new Error('No response from the server.');
    if (r.status === 401) { expired(); throw new Error('Your session has ended — please sign in again.'); }
    if (r.status === 402) throw new Error('Not licensed.');
    if (r.status === 403) throw new Error('You don’t have permission for that.');
    if (r.status === 404) throw new Error('Not found.');
    if (r.status !== 200) throw new Error((r.json && r.json.error) || ('The server replied ' + r.status + '.'));
    return pick ? pick(r.json || {}) : r.json;
  }

  // GET /v1/teach/config once (promise-cached — the wizard reads 4 flags at load); getSetting maps a key to it.
  let _cfgP = null;
  function config() { if (!_cfgP) _cfgP = (async () => { try { return unwrap(await api.teach.config()); } catch { return {}; } })(); return _cfgP; }

  const T = {
    caps: { import: false, review: false, settings: true },

    // ── real S1 reads over /v1 ────────────────────────────────────────────────────────────────────────
    getReviewQueue:   async () => unwrap(await api.review.queue(), (j) => j.queue || []),
    getDocumentPages: async (id) => unwrap(await api.getPages(id != null ? id : docId()), (j) => j.pages || []),
    getSetting:       async (key) => { const c = await config(); return (c && Object.prototype.hasOwnProperty.call(c, key)) ? c[key] : null; },
    getAllDocTypes:   async () => { const r = await api.review.docTypes(); if (r && r.status === 403) return []; return unwrap(r, (j) => j.types || []); },
    getAllDocTypesAll:async () => { const r = await api.review.docTypes(); if (r && r.status === 403) return []; return unwrap(r, (j) => j.types || []); },
    // OCR read-back + straighten — the image is client-cropped/rendered; the doc id rides window.TeachState.
    ocrRegion:        async (b64) => unwrap(await api.teach.ocrRegion(docId(), b64), (j) => (typeof j === 'string' ? j : (j && j.text) || '')),
    ocrRegionBoxes:   async (b64) => unwrap(await api.teach.ocrRegionBoxes(docId(), b64), (j) => j),
    ocrPageWords:     async (b64) => unwrap(await api.teach.ocrPageWords(docId(), b64), (j) => j),
    getPageDeskew:    async (b64, minAngle) => unwrap(await api.teach.pageDeskew(docId(), b64, minAngle), (j) => j),

    // ── benign reads (kept graceful so the flow never crashes) ──────────────────────────────────────────
    // The doc-type EDITOR/CATALOG reads (S2 over /v1) return empties so the panel mounts; its WRITES throw.
    getFieldPatterns:   async () => ({}),
    getLabelOverrides:  async () => [],
    getDoctypeCatalog:  async () => [],
    // advisory checks (S3): checkIssuerRead is called at the issuer step behind try/catch → a benign default.
    // The others are call-site-guarded in the wizard, but defined here so a call can never be "not a function".
    checkIssuerRead:        async () => ({ implausible: false }),
    checkIdentityNearMatch: async () => null,
    checkTypeSplit:         async () => ({ split: false }),
    getTemplateDetail:      async () => ({ landmarks: [] }),
    getTeachFollowup:       async () => ({ ok: false }),
    // import (caps.import=false → hidden): defined as inert so nothing throws "not a function".
    getStagedTeachThumbnail: async () => null,
    onProgress:              () => {},
    removeProgress:          () => {},

    // ── S2 (doc-type create/edit) — not over /v1 yet: honest "coming soon" ──────────────────────────────
    addLabelOverrides:      soon('Editing document types from the search client is coming soon.'),
    deleteLabelOverride:    soon('Editing document types from the search client is coming soon.'),
    addField:               soon('Editing document types from the search client is coming soon.'),
    updateField:            soon('Editing document types from the search client is coming soon.'),
    deleteField:            soon('Editing document types from the search client is coming soon.'),
    updateDocumentType:     soon('Editing document types from the search client is coming soon.'),
    createDocTypeWithFields:soon('Creating a document type from the search client is coming soon.'),
    addDoctypePresets:      soon('Adding catalog types from the search client is coming soon.'),
    stagePdfForTeach:       soon('Importing a file to teach from the search client is coming soon.'),
    processFolder:          soon('Importing a file to teach from the search client is coming soon.'),

    // ── S3 (the transactional commit) — not over /v1 yet: honest "coming soon" ──────────────────────────
    promoteToTemplate:      soon('Saving a taught document from the search client is coming soon.'),
    saveTemplateMapping:    soon('Saving a taught document from the search client is coming soon.'),
    setTemplateFieldFixed:  soon('Saving a taught document from the search client is coming soon.'),
    setTemplateHiddenField: soon('Saving a taught document from the search client is coming soon.'),
    teachListCaption:       soon('Saving a taught document from the search client is coming soon.'),
    confirmReview:          soon('Saving a taught document from the search client is coming soon.'),
  };
  window.TeachTransport = T;
})();
