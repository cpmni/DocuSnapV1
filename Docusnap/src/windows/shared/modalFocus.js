'use strict';

// repairModalInputFocus(input) — reliably give a CUSTOM in-page modal's auto-focused input a LIVE
// caret (the SFDEV dev-unlock box, the "type to confirm" erase dialog). These modals are opened by
// a keyboard shortcut / synchronous handler and focus their input in the SAME tick they append it
// to the DOM, INSIDE the event dispatch — so Chromium updates document.activeElement but never
// COMMITS focus to the input for key routing, leaving a dead caret until a real focus event (an
// alt-tab) makes Blink re-run its FocusController (eric diagnosis). NOTE: this is NOT the OS
// widget-lost-focus desync the pointerdown path (focusRepair.js) handles — the window already has
// keyboard focus here, so blurWebView() is the wrong tool and only races the re-focus.
//
// The fix is the same one the modal that ALREADY works (showTypedConfirmDialog) uses: defer the
// focus past the current event-dispatch turn AND one layout frame. Double-rAF (not single) because
// one rAF can still land inside the same input-event turn; two guarantees a fresh, laid-out frame.
// Pure renderer-side — no IPC, no blur — so it cannot affect dropdowns or normal clicks.

(function (root) {
  root.repairModalInputFocus = function (input) {
    if (!input) return;
    const raf = root.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
    raf(() => raf(() => {
      try { input.focus(); if (input.select) input.select(); } catch { /* never break a modal */ }
    }));
  };
})(typeof window !== 'undefined' ? window : this);
