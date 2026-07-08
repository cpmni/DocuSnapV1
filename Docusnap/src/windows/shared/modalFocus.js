'use strict';

// repairModalInputFocus(input) — route keyboard focus to a CUSTOM in-page modal's input when the
// modal auto-focuses it with NO user click (the SFDEV dev-unlock box, the "type to confirm" erase
// dialog). Those appear and focus their input programmatically, so the pointerdown-based focus
// repair never fires; if Blink's render widget is in the stale-TRUE focus state the caret is dead
// until you alt-tab out and back. This does the programmatic equivalent of that alt-tab: focus the
// input, ask main for a widget-level blurWebView()+focus transition (the ONLY thing that unsticks
// the stale widget focus — the same repair the pointerdown text-field path uses, and NEVER
// win.blur()/win.focus()), then re-assert the caret.
//
// Deliberately scoped to explicit modal-open calls only — NOT wired to blur/pointerdown — so it
// cannot recreate the "native <select> popup blurs the window → dropdown flashes shut" regression.
// A blur→refocus on a just-opened (usually empty) modal input is imperceptible, so it always runs.

(function (root) {
  root.repairModalInputFocus = function (input) {
    try {
      if (!input) return;
      input.focus();
      const bridge = root.docusnap;
      if (bridge && typeof bridge.repairModalFocus === 'function') {
        bridge.repairModalFocus()
          .then(() => { try { input.focus(); if (input.select) input.select(); } catch { /* */ } })
          .catch(() => { /* best-effort */ });
      }
    } catch { /* focus repair must never break a modal */ }
  };
})(typeof window !== 'undefined' ? window : this);
