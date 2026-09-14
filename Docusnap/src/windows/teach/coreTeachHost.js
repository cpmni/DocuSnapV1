'use strict';
// coreTeachHost.js — the CORE Teach window's CHROME adapter for the shared teach UI
// (src/windows/shared/teach-ui/teach.js).
//
// `window.TeachHost` carries the window-lifecycle + navigation calls (NOT data — those go through
// window.TeachTransport). On the core these are pure pass-throughs to the window.docusnap bridge. On the
// client (S1) the host adapter drives its own pop-out window: windowMinimise/windowClose act on the client
// teach window; openReviewWindow* are absent (the client has no Review window — the shared UI guards on
// typeof / the review cap). getTeachTarget/onTeachLoadDoc supply the doc the window was opened at. Loaded
// BEFORE the shared scripts so window.TeachHost exists when teach.js runs.
(function () {
  const d = window.docusnap;
  window.TeachHost = {
    windowMinimise:     (...a) => d.windowMinimise(...a),
    windowClose:        (...a) => d.windowClose(...a),
    openHelpWindow:     (...a) => d.openHelpWindow(...a),
    getTeachTarget:     (...a) => d.getTeachTarget(...a),
    onTeachLoadDoc:     (cb)   => d.onTeachLoadDoc(cb),
    openReviewWindow:   (...a) => d.openReviewWindow(...a),
    openReviewWindowAt: (...a) => d.openReviewWindowAt(...a),
  };
})();
