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
// TRIGGER (eric, revised 2026-07-10, COMPLETED same night): the edge runs ONLY when armed —
// win.__focusSuspect (native dialog / post-Confirm advance / draw-OCR spawn / child-window
// close) OR info.forceEdge (the preload's VERIFIED one-shot: sent only after an invoke-ordered
// repair + double-rAF measured document.hasFocus() STILL false — a proven-stuck page, capped at
// one, unreachable from a healthy click whose rAF read is true). The earlier
// `|| pageHasFocus === false` OR-fallback stays REMOVED and pageHasFocus stays UNCONSULTED here
// (pinned): the capture-phase at-rest read misfired on healthy pages and self-perpetuated.
//
// THE RESTORE HALF (eric, 2026-07-10 night — the "no caret but typing works" cure): the edge was
// ASYMMETRIC. blurWebView() is WIDGET-level (RenderWidgetHost::Blur) and its focus-drop message
// ALWAYS lands; wc.focus() is VIEW-level and EARLY-OUTS with no renderer message when aura focus
// never moved (the window stayed OS-focused — true in every broken press per telemetry). So each
// edge was a NET page-focus DROP: Blink's focused_ bit stuck FALSE → no caret, no :focus,
// hasFocus()=false — while keys still route to the activeElement (typing works). That asymmetry
// both fuelled the original "broken everywhere" era and stranded the milder state after armed
// edges/unarmed triggers, healed only by alt-tab. focusOnWebView() is the documented WIDGET-level
// counterpart (RenderWidgetHost::Focus, ZERO OS activation): blur→focusOnWebView is a forced
// false→true page-focus transition that lands in BOTH stale polarities (renderer-lies-TRUE after
// dialogs; renderer-truthful-FALSE after child close). wc.focus() stays last for the genuinely
// view-displaced case. The edge is gated on win.isFocused() so a proactive draw edge can never
// stamp page focus onto a background window the user alt-tabbed away from.
// INVARIANT (guarded by test_focus_repair.js): this path must NEVER call win.blur()/win.focus().
// Returns { edgeRan } so the IPC reply / telemetry can report whether the edge actually fired.
function repairKeyboardFocus(win, wc, info) {
  let edgeRan = false;
  try {
    if (win && !win.isDestroyed()) {
      const armed = !!(info && (info.suspect === true || info.forceEdge === true));
      const osFocused = typeof win.isFocused === 'function' ? win.isFocused() : true;
      if (armed && osFocused) {
        win.blurWebView();
        if (typeof win.focusOnWebView === 'function') win.focusOnWebView();
        edgeRan = true;
      }
    }
    if (wc && !wc.isDestroyed()) wc.focus();
  } catch { /* focus repair must never throw into the IPC handler */ }
  return { edgeRan };
}

module.exports = { repairKeyboardFocus };
