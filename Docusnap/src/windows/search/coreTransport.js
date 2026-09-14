'use strict';
// coreTransport.js — the CORE Search window's adapter for the shared search UI (src/windows/shared/search-ui/).
//
// The shared UI reaches IO ONLY through `window.SearchTransport`. On the core every call is an in-process
// IPC, so this adapter is a PURE PASS-THROUGH to the already-unwrapped `window.docusnap` bridge: same method
// names, same positional arity, no `.catch`, no envelope, no normalisation — a rejection rejects through
// exactly as before, so every error branch in the shared UI (e.g. a failed find → _clearMatches, a
// missing handler → the "restart to finish" pane) behaves byte-for-byte as it did when the UI called
// window.docusnap directly. Pinned by test_core_transport.js (source regex + a rejecting stub).
//
// caps: every capability is TRUE on the core (absent would also mean true — see _cap() in searchState.js).
// The client's adapter (client/renderer/search/) sets a cap false where the /v1 API can't back it, and the
// shared UI hides that control. Cap names (each gates ONE decision in the shared UI):
//   singlePage   getDocumentPage — lazy per-page render (page-1-first for PDFs)
//   pageCount    getDocumentPageCount — the cheap count probe when page_count is unknown
//   find         findInDocument — the Find cluster + list-term highlight
//   spreadsheet  getSpreadsheetGrid — the .xlsx cell grid
//   bin          the recycle bin: deleteDocument / restoreDocument / purgeDocument / getDeletedQueue / purgeAllDeleted
//   restoreAll   restoreAllDeleted (the bulk "Restore all")
//   sendBack     repairDeconfirm ("Send back to Review")
//   localFile    showDocumentInExplorer / openDocumentFile (desktop-local)
//   review       openReviewWindowAt ("Edit in Review")
//   print        printDocument / printAvailable
//   stamps       stamp.can + the Send/stamp popup (searchStamp.js)
//   settings     getSetting (the purge-dialog "originals not touched" suffix)
//   workflowHistory  workflow.docHistory (the decision-history rows)          ─┐ S4: the shared workflow /
//   docRoutes        workflow.docRoutes (open-route banners) + adminCancel      │ mailbox / stamp modules
//   adminCancel      workflow.adminCancel                                       │ (all true on the core;
//   stampCreate      stamp.typeCreate ("+ New stamp")                           │ the client hides what
//   stampedViewer    workflow.openStampedViewer (a desktop viewer window)      ─┘ /v1 cannot back)
// Loaded BEFORE the shared scripts (index.html) so window.SearchTransport exists when they run.
(function () {
  const d = window.docusnap;
  window.SearchTransport = {
    caps: {
      singlePage: true, pageCount: true, find: true, spreadsheet: true,
      outline: true,   // getDocumentOutline — the PDF's bookmarks (the Contents panel, 2026-09-14)
      pageInfo: true,  // getDocumentPageInfo — ONE process for the first paint + the read-ahead batch (2026-09-14)
      bin: true, restoreAll: true, sendBack: true, localFile: true, review: true, print: true,
      stamps: true, settings: true,
      workflowHistory: true, docRoutes: true, adminCancel: true, stampCreate: true, stampedViewer: true,
    },
    // list + bin
    searchDocuments:        (...a) => d.searchDocuments(...a),
    getDeletedQueue:        (...a) => d.getDeletedQueue(...a),
    restoreAllDeleted:      (...a) => d.restoreAllDeleted(...a),
    purgeAllDeleted:        (...a) => d.purgeAllDeleted(...a),
    deleteDocument:         (...a) => d.deleteDocument(...a),
    restoreDocument:        (...a) => d.restoreDocument(...a),
    purgeDocument:          (...a) => d.purgeDocument(...a),
    repairDeconfirm:        (...a) => d.repairDeconfirm(...a),
    // preview
    getDocumentDetail:      (...a) => d.getDocumentDetail(...a),
    getDocumentPages:       (...a) => d.getDocumentPages(...a),
    getDocumentPage:        (...a) => d.getDocumentPage(...a),
    getDocumentPageCount:   (...a) => d.getDocumentPageCount(...a),
    getDocumentOutline:     (...a) => d.getDocumentOutline(...a),
    getDocumentPageInfo:    (...a) => d.getDocumentPageInfo(...a),
    findInDocument:         (...a) => d.findInDocument(...a),
    getSpreadsheetGrid:     (...a) => d.getSpreadsheetGrid(...a),
    getDocumentThumbnail:   (...a) => d.getDocumentThumbnail(...a),
    // document actions (desktop-local)
    showDocumentInExplorer: (...a) => d.showDocumentInExplorer(...a),
    openDocumentFile:       (...a) => d.openDocumentFile(...a),
    openReviewWindowAt:     (...a) => d.openReviewWindowAt(...a),
    printDocument:          (...a) => d.printDocument(...a),
    printAvailable:         (...a) => d.printAvailable(...a),
    // bootstrap state
    getAllDocTypes:         (...a) => d.getAllDocTypes(...a),
    getEntitlement:         (...a) => d.getEntitlement(...a),
    authGetCurrentUser:     (...a) => d.authGetCurrentUser(...a),
    getSetting:             (...a) => d.getSetting(...a),
    // stamping (S4) — pass-throughs to the desktop stamp bridge
    stamp: {
      can:          (...a) => d.stamp.can(...a),
      types:        (...a) => d.stamp.types(...a),
      typeCreate:   (...a) => d.stamp.typeCreate(...a),
      place:        (...a) => d.stamp.place(...a),
      list:         (...a) => d.stamp.list(...a),
      currentPages: (...a) => d.stamp.currentPages(...a),
      grants:       (...a) => d.stamp.grants(...a),
    },
    // workflow (S4) — pass-throughs to the desktop workflow bridge
    workflow: {
      inbox:             (...a) => d.workflow.inbox(...a),
      sent:              (...a) => d.workflow.sent(...a),
      assigned:          (...a) => d.workflow.assigned(...a),
      completed:         (...a) => d.workflow.completed(...a),
      recipients:        (...a) => d.workflow.recipients(...a),
      assign:            (...a) => d.workflow.assign(...a),
      resolve:           (...a) => d.workflow.resolve(...a),
      recall:            (...a) => d.workflow.recall(...a),
      adminCancel:       (...a) => d.workflow.adminCancel(...a),
      docRoutes:         (...a) => d.workflow.docRoutes(...a),
      docHistory:        (...a) => d.workflow.docHistory(...a),
      openStampedViewer: (...a) => d.workflow.openStampedViewer(...a),
    },
    // push events (optional on a transport; the shared UI guards on typeof)
    onBinChanged:            (cb) => d.onBinChanged(cb),
    onWorkflowCountsChanged: (cb) => d.onWorkflowCountsChanged(cb),
  };
})();
