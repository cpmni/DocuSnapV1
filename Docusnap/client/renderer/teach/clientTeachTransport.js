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
//   import  = TRUE (S4) — bring a LOCAL file to teach: stagePdfForTeach picks a PDF/image on THIS PC and
//             processFolder uploads it to the core (POST /v1/teach/stage) to OCR-import WITHOUT filing, so it
//             lands in the review queue to teach. The staged-thumbnail is OMITTED (the real page arrives from
//             /v1/documents/:id/page once the import completes).
//   review  = false — the client has no core Review window (the follow-up "Check in Review" is hidden).
//   settings= true  — the wizard's feature flags come from GET /v1/teach/config.
// S1 = the wizard runs from the queue up to the summary; SAVING (promote/mapping/confirm) is S3; doc-type
// CREATE is S2; upload-to-teach is S4. The dead desktop-only edit methods throw a clear "coming soon" so a
// stray call is honest, never a silent break.
(function () {
  const api = window.scanfinder;
  const docId = () => (window.TeachState && window.TeachState.docId) || 0;   // the currently-taught doc (set by teach.js)
  const soon = (m) => async () => { throw new Error(m || 'That isn’t available from the search client yet.'); };
  // S4: stagePdfForTeach picks the file (quick) and stashes its token; the shared wizard then calls
  // processFolder(folder) which uploads the stashed bytes (the ~30s core OCR read). The shared flow passes
  // only the folder string between the two calls, so the token rides here.
  let _pendingStage = null;   // { token, filename } set by stagePdfForTeach, consumed by processFolder

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
    // editType=false → the "Edit this type…" affordance (edit an EXISTING type mid-teach) is hidden: over /v1
    // the wizard can CREATE a type (S2) but editing an existing one's fields/roles/keywords is not exposed yet.
    // batchCommit=true (S3) → doCommit builds the WHOLE teaching into one payload and fires ONE transactional
    // POST /v1/teach/commit (commitTeach below) instead of the desktop's 6 separate calls, so a dropped socket
    // can never leave a half-born template. The core leaves batchCommit ABSENT → its 6-call path is unchanged.
    caps: { import: true, review: false, settings: true, editType: false, batchCommit: true },

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
    // getFieldPatterns / getLabelOverrides are consumed ONLY by the edit-EXISTING panel (mode:'edit'), which
    // is hidden on the client (caps.editType=false) — empties keep them inert if ever called.
    getFieldPatterns:   async () => ({}),
    getLabelOverrides:  async () => [],
    // ── S2 (doc-type CREATE + catalog) over /v1 — admin-only on the server ───────────────────────────────
    // A validation failure comes back 400 {error}: mirror the core's {success:false} so the editor/catalog
    // show it inline; a 401/402/403 throws (surfaced as a toast), same as any other write.
    getDoctypeCatalog:  async () => { const r = await api.teach.docTypeCatalog(); if (r && r.status === 403) return []; return unwrap(r, (j) => j.catalog || []); },
    createDocTypeWithFields: async (draft) => { const r = await api.teach.createDocType(draft); if (r && r.status === 400) return { success: false, error: (r.json && r.json.error) || 'Could not create the type.' }; return unwrap(r, (j) => j); },
    addDoctypePresets:  async (slugs) => { const r = await api.teach.addDocTypePresets(slugs); if (r && r.status === 400) return { success: false, error: (r.json && r.json.error) || 'Could not add the type.' }; return unwrap(r, (j) => j); },
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

    // ── EDIT an EXISTING type — OUT of v1 scope (the "Edit this type…" affordance is hidden by
    //    caps.editType=false); honest "coming soon" so a stray call is never a silent break ─────────────────
    addLabelOverrides:      soon('Editing document types from the search client is coming soon.'),
    deleteLabelOverride:    soon('Editing document types from the search client is coming soon.'),
    addField:               soon('Editing document types from the search client is coming soon.'),
    updateField:            soon('Editing document types from the search client is coming soon.'),
    deleteField:            soon('Editing document types from the search client is coming soon.'),
    updateDocumentType:     soon('Editing document types from the search client is coming soon.'),
    // ── S4 (upload-to-teach) over /v1 — bring a LOCAL file to teach ───────────────────────────────────────
    // stagePdfForTeach: pick a PDF/image on THIS PC (quick — no bytes read yet), stash the token, and return
    // the shared wizard's {folder, filename} shape (folder is a synthetic marker; the real bytes ride the
    // token). null = cancelled. The wizard then shows a provisional "Reading…" card and calls processFolder.
    stagePdfForTeach: async () => {
      const r = await api.teach.stagePick();
      if (!r || !r.ok || !r.token) return null;                       // cancelled
      _pendingStage = { token: r.token, filename: r.name || 'document' };
      return { folder: '__client_teach_stage__', filename: _pendingStage.filename };
    },
    // processFolder: upload the stashed file to POST /v1/teach/stage — the core OCR-imports it WITHOUT filing
    // (autoFile OFF server-side) and returns { docId, filename }. The shared wizard ignores the return and
    // re-picks the new needs_review row from the queue by filename (parity with the desktop). A 4xx/5xx throws
    // so the wizard shows "Import failed: …".
    processFolder: async (_folder, _opts) => {
      const p = _pendingStage; _pendingStage = null;
      if (!p || !p.token) throw new Error('Nothing was staged to import.');
      const res = await api.teach.stageSubmit(p.token);
      if (!res || !res.ok) throw new Error((res && res.error) || 'Reading the document failed.');
      return { success: true, docId: res.docId, filename: res.filename };
    },

    // ── S3 (the transactional commit) over /v1 ──────────────────────────────────────────────────────────
    // The client takes the caps.batchCommit path: doCommit builds one payload → commitTeach → POST
    // /v1/teach/commit (admin + entitlement + license + the teach_over_client_enabled switch, server-side). A
    // 4xx from a validation/ack/switch problem is returned as {ok:false,error} so doCommit shows it inline; a
    // 401/402/403 throws. The 6 desktop calls below are NEVER invoked on the client (the batch path replaces
    // them) — kept as honest "coming soon" only so a stray reference can't be "not a function".
    commitTeach: async (payload) => {
      const r = await api.teach.commit(payload);
      if (r && (r.status === 400 || r.status === 409)) return { ok: false, error: (r.json && r.json.error) || 'Could not save the taught document.', code: r.json && r.json.code };
      return unwrap(r, (j) => j);   // {ok, templateId, filename, landmarksWarn}
    },
    promoteToTemplate:      soon('Saving a taught document from the search client is coming soon.'),
    saveTemplateMapping:    soon('Saving a taught document from the search client is coming soon.'),
    setTemplateFieldFixed:  soon('Saving a taught document from the search client is coming soon.'),
    setTemplateHiddenField: soon('Saving a taught document from the search client is coming soon.'),
    teachListCaption:       soon('Saving a taught document from the search client is coming soon.'),
    confirmReview:          soon('Saving a taught document from the search client is coming soon.'),
  };
  window.TeachTransport = T;
})();
