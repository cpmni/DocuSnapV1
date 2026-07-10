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

// 6. SUSPECT flag (main-side, from win.on('blur')) forces the repair EVEN WHEN the renderer
//    self-reports healthy — the residual-bug fix: document.hasFocus() lies TRUE post-dialog.
{ const win = makeWin(), wc = makeWc();
  repairKeyboardFocus(win, wc, { pageHasFocus: true, suspect: true });
  check('suspect + hasFocus-true → blurWebView STILL called', win.calls.blurWebView === 1);
  check('suspect → no forbidden win.blur/win.focus', win.calls.blur === 0 && win.calls.focus === 0);
  check('suspect → wc.focus called', wc.calls.focus === 1); }

// 7. NOT suspect + healthy → pure wc.focus path, no blur (a normal click's caret is untouched).
{ const win = makeWin(), wc = makeWc();
  repairKeyboardFocus(win, wc, { pageHasFocus: true, suspect: false });
  check('healthy + not suspect → blurWebView NOT called', win.calls.blurWebView === 0);
  check('healthy + not suspect → wc.focus called', wc.calls.focus === 1); }

// 8. SOURCE PINS (eric, 2026-07-10 — the post-Confirm dead-caret fix). The repair can
//    only run when something ARMS the suspect flag: document.hasFocus() reports
//    stale-TRUE in the broken state, so a dialog-free Confirm & File desync was
//    unrepairable by click (the user's "click the taskbar and back" ritual). Pin that
//    (a) the Review confirm handler arms the flag after advancing, and (b) the two
//    prior focus regressions stay out (no win.on('blur') suspect flag; no win.blur()/
//    win.focus() in the repair).
{
  const fs = require('fs'), path = require('path');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'windows', 'review', 'renderer.js'), 'utf8');
  const confirmHandler = renderer.slice(renderer.indexOf("getElementById('btn-confirm')"));
  const advanceAt = confirmHandler.indexOf('advanceAfterAction(');
  const markAt    = confirmHandler.indexOf('markFocusSuspect');
  check('confirm handler arms the focus-suspect flag', markAt !== -1);
  check('... AFTER advanceAfterAction (covers the post-advance desync)',
        advanceAt !== -1 && markAt > advanceAt);

  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  check("regression pin: no win.on('blur') suspect flag (the dropdown open/shut storm)",
        !/win\.on\(['"]blur['"][\s\S]{0,120}__focusSuspect/.test(mainSrc));
  // Strip line comments first — the file's own documentation NAMES the forbidden calls.
  const repairSrc = fs.readFileSync(path.join(__dirname, 'focusRepair.js'), 'utf8')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  check('regression pin: repair never calls win.blur()/win.focus()',
        !/win\.blur\(\)|win\.focus\(\)/.test(repairSrc));
}

console.log(fails ? `\n${fails} FAILED` : '\nAll focus-repair checks passed');
process.exit(fails ? 1 : 0);
