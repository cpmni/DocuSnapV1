'use strict';
/*
 * shared/dialogFocus.js — keyboard-focus repair for PROGRAMMATIC focus + native dialogs.
 *
 * The Windows render-widget focus desync (a native confirm()/alert(), or a Python-spawn stall,
 * drops Blink's keyboard focus while the window still reports focused → the next text field shows
 * no caret until you alt-tab out and back). Two cures live here so any window can load ONE script:
 *
 *  (a) focusField(el) — repair a PROGRAMMATIC focus. The preload `pointerdown` chokepoint heals
 *      every user PRESS, but it can't fire when code calls el.focus() with no press. This drives
 *      the real widget-focus edge (ensure-window-focus) and THEN focuses on the next frames, so
 *      the caret lands. Forward convention (owner rule 2026-08-02): a new field or dialog ships
 *      wired to the focus repair — route programmatic input focus through focusField.
 *
 *  (b) auto-instrument confirm()/alert() — flag this window "focus suspect" after a native dialog
 *      so the next press does the real repair. Same wrapper as the inline IIFEs already in
 *      review/settings; load THIS in windows that lack one (Search/Main/Teach). The guard below
 *      makes it idempotent, so a window that also has the inline copy never double-wraps.
 */

// (a) Programmatic-focus repair. Global (plain-script windows share one scope); async but safe to
// call fire-and-forget — the caller doesn't await.
async function focusField(el) {
  if (!el) return;
  try { await window.docusnap?.ensureWindowFocusAsync?.(); } catch { /* stale-main / no bridge → still focus */ }
  requestAnimationFrame(() => requestAnimationFrame(() => { try { el.focus(); } catch {} }));
}

// (b) Native-dialog instrumentation — one point, idempotent, never breaks a dialog.
(function instrumentNativeDialogsForFocusRepair() {
  if (window.__dsDialogFocusInstrumented) return;   // an inline copy (review/settings) or a repeat load
  window.__dsDialogFocusInstrumented = true;
  const mark = () => { try { window.docusnap?.markFocusSuspect?.(); } catch {} };
  const _confirm = window.confirm.bind(window);
  const _alert = window.alert.bind(window);
  window.confirm = (...a) => { try { return _confirm(...a); } finally { mark(); } };
  window.alert = (...a) => { try { return _alert(...a); } finally { mark(); } };
})();
