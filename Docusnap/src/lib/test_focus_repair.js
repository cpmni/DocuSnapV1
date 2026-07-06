'use strict';
// Guards src/lib/focusRepair.js — the keyboard-focus repair after a native dialog. The CRITICAL
// invariant (eric review): this path must use win.blurWebView() and must NEVER call win.blur() or
// win.focus() — the window-level activation cycle is what caused the Review title-bar-flash /
// cursor-trap storm on Windows. Runs off the Electron lifecycle (pure logic on stubbed win/wc).
//
//   node src/lib/test_focus_repair.js
const { repairKeyboardFocus } = require('./focusRepair');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const makeWin = (destroyed = false) => {
  const calls = { blurWebView: 0, blur: 0, focus: 0 };
  return { calls, isDestroyed: () => destroyed,
    blurWebView: () => calls.blurWebView++, blur: () => calls.blur++, focus: () => calls.focus++ };
};
const makeWc = (destroyed = false) => {
  const calls = { focus: 0 };
  return { calls, isDestroyed: () => destroyed, focus: () => calls.focus++ };
};

// 1. page-focus LOST → blurWebView once, wc.focus, and the FORBIDDEN win.blur/win.focus NEVER.
{ const win = makeWin(), wc = makeWc();
  repairKeyboardFocus(win, wc, { pageHasFocus: false });
  check('lost focus → blurWebView called once', win.calls.blurWebView === 1);
  check('lost focus → win.blur NEVER called', win.calls.blur === 0);
  check('lost focus → win.focus NEVER called', win.calls.focus === 0);
  check('lost focus → wc.focus called', wc.calls.focus === 1); }

// 2. page focus healthy → no blurWebView, wc.focus still keeps the widget routed.
{ const win = makeWin(), wc = makeWc();
  repairKeyboardFocus(win, wc, { pageHasFocus: true });
  check('healthy → blurWebView NOT called', win.calls.blurWebView === 0);
  check('healthy → no win.blur/win.focus', win.calls.blur === 0 && win.calls.focus === 0);
  check('healthy → wc.focus called', wc.calls.focus === 1); }

// 3. destroyed / null window → no blurWebView, no throw, wc.focus still runs.
{ const win = makeWin(true), wc = makeWc();
  repairKeyboardFocus(win, wc, { pageHasFocus: false });
  check('destroyed win → blurWebView NOT called', win.calls.blurWebView === 0);
  check('destroyed win → wc.focus still called', wc.calls.focus === 1); }
{ const wc = makeWc();
  repairKeyboardFocus(null, wc, { pageHasFocus: false });
  check('null win → no throw, wc.focus called', wc.calls.focus === 1); }

// 4. destroyed wc → wc.focus skipped (no throw); a valid win still repairs.
{ const win = makeWin(), wc = makeWc(true);
  repairKeyboardFocus(win, wc, { pageHasFocus: false });
  check('destroyed wc → wc.focus NOT called', wc.calls.focus === 0);
  check('destroyed wc → blurWebView still runs (win valid)', win.calls.blurWebView === 1); }

// 5. missing info → treated as healthy (defensive), never blurs the view.
{ const win = makeWin(), wc = makeWc();
  repairKeyboardFocus(win, wc, undefined);
  check('undefined info → blurWebView NOT called', win.calls.blurWebView === 0);
  check('undefined info → wc.focus called', wc.calls.focus === 1); }

console.log(fails ? `\n${fails} FAILED` : '\nAll focus-repair checks passed');
process.exit(fails ? 1 : 0);
