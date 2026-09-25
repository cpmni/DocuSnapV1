'use strict';
// coreTeachTransport.js — the CORE Teach window's DATA adapter for the shared teach UI
// (src/windows/shared/teach-ui/teach.js).
//
// The shared wizard reaches IO ONLY through `window.TeachTransport` (data) + `window.TeachHost` (chrome).
// On the core every call is an in-process IPC, so this adapter is a PURE PASS-THROUGH to the already-unwrapped
// `window.docusnap` bridge: same method names, same positional arity, no `.catch`, no envelope — a rejection
// rejects through exactly as before, so every error branch in the shared UI behaves byte-for-byte as it did
// when the wizard called window.docusnap directly. Loaded BEFORE the shared scripts (index.html) so
// window.TeachTransport exists when teach.js runs. Pinned by test_core_teach_transport.js (source regex +
// a rejecting stub).
//
// caps: every capability is TRUE on the core (absent would also mean true). The client's adapter
// (client/renderer/teach/, S1) sets a cap false where the /v1 API can't back it, and the shared UI hides that
// control (never a dead button, never a throw). Cap names (each gates ONE decision in the shared UI):
//   import   stagePdfForTeach / processFolder / onProgress / getStagedTeachThumbnail — bring a LOCAL file to
//            teach (A: false on the client → teach from the /v1 review queue; B/S4: true via /v1/teach/stage)
//   settings getSetting — the list-field / barcode feature flags (client backs it via a scoped /v1 read)
(function () {
  const d = window.docusnap;
  window.TeachTransport = {
    caps: { import: true, settings: true },
    // exemplar + page render
    getReviewQueue:          (...a) => d.getReviewQueue(...a),
    getDocumentPages:        (...a) => d.getDocumentPages(...a),
    getPageDeskew:           (...a) => d.getPageDeskew(...a),
    getSetting:              (...a) => d.getSetting(...a),
    getDocumentWithExtractions: (...a) => d.getDocumentWithExtractions(...a),   // SUGGESTED-TEACH (mig 220): the import keyword reads per field
    // OCR read-back (client-cropped image bytes — no path)
    ocrRegion:               (...a) => d.ocrRegion(...a),
    ocrRegionBoxes:          (...a) => d.ocrRegionBoxes(...a),
    ocrPageWords:            (...a) => d.ocrPageWords(...a),
    // local-file import to teach (import cap)
    stagePdfForTeach:        (...a) => d.stagePdfForTeach(...a),
    getStagedTeachThumbnail: (...a) => d.getStagedTeachThumbnail(...a),
    processFolder:           (...a) => d.processFolder(...a),
    onProgress:              (cb)   => d.onProgress(cb),
    removeProgress:          (...a) => d.removeProgress(...a),
    // doc types (the shared DocTypeEditor + DocTypeCatalog receive this object as `api`)
    getAllDocTypes:          (...a) => d.getAllDocTypes(...a),
    getAllDocTypesAll:       (...a) => d.getAllDocTypesAll(...a),
    getFieldPatterns:        (...a) => d.getFieldPatterns(...a),
    getLabelOverrides:       (...a) => d.getLabelOverrides(...a),
    addLabelOverrides:       (...a) => d.addLabelOverrides(...a),
    deleteLabelOverride:     (...a) => d.deleteLabelOverride(...a),
    addField:                (...a) => d.addField(...a),
    updateField:             (...a) => d.updateField(...a),
    deleteField:             (...a) => d.deleteField(...a),
    updateDocumentType:      (...a) => d.updateDocumentType(...a),
    createDocTypeWithFields:  (...a) => d.createDocTypeWithFields(...a),
    getDoctypeCatalog:       (...a) => d.getDoctypeCatalog(...a),
    addDoctypePresets:       (...a) => d.addDoctypePresets(...a),
    // advisory checks (fail-open reads)
    checkIssuerRead:         (...a) => d.checkIssuerRead(...a),
    checkIdentityNearMatch:  (...a) => d.checkIdentityNearMatch(...a),
    checkTypeSplit:          (...a) => d.checkTypeSplit(...a),
    getTeachFollowup:        (...a) => d.getTeachFollowup(...a),
    getTemplateDetail:       (...a) => d.getTemplateDetail(...a),
    // the commit sequence — the CORE runs these 6 in order (caps.batchCommit is absent here). The client sets
    // caps.batchCommit=true and takes the single-call commitTeach path instead; commitTeach is defined here only
    // to satisfy the transport contract (the core never calls it) — invoking it would be a wiring bug.
    commitTeach:             () => { throw new Error('commitTeach is the client batch path; the core commits via the 6 calls'); },
    promoteToTemplate:       (...a) => d.promoteToTemplate(...a),
    saveTemplateMapping:     (...a) => d.saveTemplateMapping(...a),
    setTemplateFieldFixed:   (...a) => d.setTemplateFieldFixed(...a),
    setTemplateHiddenField:  (...a) => d.setTemplateHiddenField(...a),
    teachListCaption:        (...a) => d.teachListCaption(...a),
    confirmReview:           (...a) => d.confirmReview(...a),
  };
})();
