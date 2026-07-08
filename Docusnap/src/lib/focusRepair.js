'use strict';

// Keyboard-focus repair after a native dialog (window.confirm/alert) or a child window close.
// Extracted from main.js's `ensure-window-focus` IPC handler so the delicate focus logic is
// unit-testable WITHOUT the Electron app lifecycle. Pure with respect to the passed win/wc.
//
// Background (eric review): returning from a native confirm() drops Blink's FRAME page-focus and
// leaves the RenderWidget's focus state stale-TRUE, so a bare `wc.focus()` is a no-op (no state
// change → Blink's FocusController never re-runs → no caret, typing refused). A real WIDGET blur is
// needed so the follow-on focus is a genuine transition. Do it with `win.blurWebView()` — the
// WEB-VIEW-level blur — NOT `win.blur()`/`win.focus()`: a window-level blur/focus is an OS
// activation cycle whose SetForegroundWindow can be denied after a dialog, leaving Windows flashing
// the title bar forever demanding activation (the "Review title bar flashing fast, cursor trapped"
// storm, reproduced on 2 PCs). blurWebView() delivers the same widget blur with ZERO OS activation.
//
// TRIGGER (eric): the blurWebView() transition runs when the widget focus is SUSPECT. The reliable
// signal is `info.suspect` — set main-side from win.on('blur') (the OS activation transition after a
// native dialog / app-switch / child window, i.e. exactly the "alt-tab out and back fixes it" case),
// NOT the renderer's document.hasFocus(), which reports stale-TRUE in the broken state and used to
// make the fix skip itself. `pageHasFocus === false` is kept as an OR-fallback so we never repair
// LESS than before. A healthy click (suspect false, pageHasFocus true) takes the pure wc.focus()
// path — no blur — so a normal click's caret is never disturbed.
// INVARIANT (guarded by test_focus_repair.js): this path must NEVER call win.blur()/win.focus().
function repairKeyboardFocus(win, wc, info) {
  try {
    if (win && !win.isDestroyed()) {
      if (info && (info.suspect === true || info.pageHasFocus === false)) win.blurWebView();
    }
    if (wc && !wc.isDestroyed()) wc.focus();
  } catch { /* focus repair must never throw into the IPC handler */ }
}

module.exports = { repairKeyboardFocus };
