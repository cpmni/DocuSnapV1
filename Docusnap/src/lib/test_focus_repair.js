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
const makeWin = (destroyed = false, osFocused = true) => {
  const calls = { blurWebView: 0, focusOnWebView: 0, blur: 0, focus: 0 };
  return { calls, isDestroyed: () => destroyed, isFocused: () => osFocused,
    blurWebView: () => calls.blurWebView++, focusOnWebView: () => calls.focusOnWebView++,
    blur: () => calls.blur++, focus: () => calls.focus++ };
};
const makeWc = (destroyed = false) => {
  const calls = { focus: 0 };
  return { calls, isDestroyed: () => destroyed, focus: () => calls.focus++ };
};

// 1. page-focus lost but NOT armed → NO edge (THE pin: pageHasFocus alone NEVER fires the edge —
//    the removed OR-fallback self-perpetuated the desync); pure wc.focus; forbidden calls NEVER.
{ const win = makeWin(), wc = makeWc();
  const r = repairKeyboardFocus(win, wc, { pageHasFocus: false });
  check('page-focus false, not armed → blurWebView NOT called (no self-perpetuating churn)', win.calls.blurWebView === 0);
  check('page-focus false, not armed → focusOnWebView NOT called', win.calls.focusOnWebView === 0);
  check('page-focus false, not armed → edgeRan false', r && r.edgeRan === false);
  check('lost focus → win.blur NEVER called', win.calls.blur === 0);
  check('lost focus → win.focus NEVER called', win.calls.focus === 0);
  check('lost focus → wc.focus still called', wc.calls.focus === 1); }

// 1b. forceEdge (the VERIFIED one-shot from the preload (C) block) → FULL edge:
//     blurWebView + focusOnWebView (the restore half — eric 2026-07-10 night: wc.focus() is
//     view-level and early-outs when aura focus never moved, so without focusOnWebView every
//     edge was a NET page-focus drop: the "no caret but typing works" stranded state).
{ const win = makeWin(), wc = makeWc();
  const r = repairKeyboardFocus(win, wc, { pageHasFocus: false, forceEdge: true });
  check('forceEdge → blurWebView called', win.calls.blurWebView === 1);
  check('forceEdge → focusOnWebView called (the restore half)', win.calls.focusOnWebView === 1);
  check('forceEdge → edgeRan true', r && r.edgeRan === true);
  check('forceEdge → no forbidden win.blur/win.focus', win.calls.blur === 0 && win.calls.focus === 0);
  check('forceEdge → wc.focus still called last', wc.calls.focus === 1); }

// 1c. edge on a BACKGROUND window (user alt-tabbed away) → SKIPPED: a proactive draw edge must
//     never stamp page focus onto an unfocused window. wc.focus still runs (today's behaviour).
{ const win = makeWin(false, false), wc = makeWc();
  const r = repairKeyboardFocus(win, wc, { suspect: true });
  check('unfocused window → edge skipped (no blurWebView)', win.calls.blurWebView === 0);
  check('unfocused window → edgeRan false', r && r.edgeRan === false);
  check('unfocused window → wc.focus still called', wc.calls.focus === 1); }

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

// 4. destroyed wc → wc.focus skipped (no throw); a valid win still repairs on a SUSPECT trigger.
{ const win = makeWin(), wc = makeWc(true);
  repairKeyboardFocus(win, wc, { suspect: true });
  check('destroyed wc → wc.focus NOT called', wc.calls.focus === 0);
  check('destroyed wc → blurWebView still runs (win valid, suspect)', win.calls.blurWebView === 1); }

// 5. missing info → treated as healthy (defensive), never blurs the view.
{ const win = makeWin(), wc = makeWc();
  repairKeyboardFocus(win, wc, undefined);
  check('undefined info → blurWebView NOT called', win.calls.blurWebView === 0);
  check('undefined info → wc.focus called', wc.calls.focus === 1); }

// 6. SUSPECT flag forces the repair EVEN WHEN the renderer self-reports healthy — the
//    stale-TRUE polarity: document.hasFocus() lies TRUE post-dialog.
{ const win = makeWin(), wc = makeWc();
  const r = repairKeyboardFocus(win, wc, { pageHasFocus: true, suspect: true });
  check('suspect + hasFocus-true → blurWebView STILL called', win.calls.blurWebView === 1);
  check('suspect → focusOnWebView called (restore half rides every edge)', win.calls.focusOnWebView === 1);
  check('suspect → edgeRan true', r && r.edgeRan === true);
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
  const confirmHandler = renderer.slice(renderer.indexOf("getElementById('btn-confirm').addEventListener('click'"));
  const advanceAt = confirmHandler.indexOf('advanceAfterAction(');
  const markAt    = confirmHandler.indexOf('markFocusSuspect');
  check('confirm handler arms the focus-suspect flag', markAt !== -1);
  check('... AFTER advanceAfterAction (covers the post-advance desync)',
        advanceAt !== -1 && markAt > advanceAt);

  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  check("regression pin: no win.on('blur') suspect flag (the dropdown open/shut storm)",
        !/win\.on\(['"]blur['"][\s\S]{0,120}__focusSuspect/.test(mainSrc));
  // Strip line comments first — the file's own documentation NAMES the forbidden calls.
  // (Normalise CRLF before anchoring: `.` doesn't consume `\r`, so `$` never matched
  // on CRLF files and the strip silently no-opped.)
  const repairSrc = fs.readFileSync(path.join(__dirname, 'focusRepair.js'), 'utf8')
    .replace(/\r/g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  check('regression pin: repair never calls win.blur()/win.focus()',
        !/win\.blur\(\)|win\.focus\(\)/.test(repairSrc));

  // Draw/zone-OCR focus fix (eric, 2026-07-10): the hidden-Python-spawn desync leaves the
  // widget stale so the user's next click gets no caret. runZoneOcr must, after filling the
  // field, deterministically re-establish focus: sync input.focus() (so the input is the
  // activeElement when the page-focus edge runs) + the proactive ensureWindowFocus bridge +
  // the double-rAF caret belt. Pinned so a "cleanup" can't quietly drop the cure.
  // Scan the WHOLE runZoneOcr body (bounded at the next function), not a fixed 3000-char
  // window — the function has since grown past that, pushing its focus cure out of view and
  // reporting false failures even though the cure (input.focus + ensureWindowFocus +
  // markFocusSuspect + repairModalInputFocus) is intact ~78 lines in.
  const _zoneStart = renderer.indexOf('async function runZoneOcr');
  const _zoneEnd   = renderer.indexOf('async function ', _zoneStart + 25);
  const zoneFill = renderer.slice(_zoneStart, _zoneEnd > _zoneStart ? _zoneEnd : _zoneStart + 8000);
  check('runZoneOcr focuses the filled input', /input\.focus\(\)/.test(zoneFill));
  check('runZoneOcr drives the proactive focus transition (ensureWindowFocus)',
        /ensureWindowFocus/.test(zoneFill));
  check('runZoneOcr ARMS focus-suspect so the proactive edge does the real repair (post OR-fallback removal)',
        /markFocusSuspect/.test(zoneFill));
  check('runZoneOcr re-asserts the caret via the double-rAF belt (repairModalInputFocus)',
        /repairModalInputFocus/.test(zoneFill));

  // Quick-check (batch-audit) modal focus cure (eric, 2026-08-31): _baOpen was the ONLY focus-sensitive
  // modal that armed no repair on open, so on Electron 44 its native <select> popups stayed dead until an
  // OS activation (the user's Start-menu round-trip). It must arm the proactive widget edge
  // (markFocusSuspect + ensureWindowFocus) AT OPEN — pinned so a cleanup can't quietly drop it. It must
  // NOT use win.blur/win.focus or fire on a <select> pointerdown (those are the storm/flash-open-shut
  // regressions guarded above). Scan the _baOpen body (bounded at the Master-render marker after it).
  const _baStart = renderer.indexOf('async function _baOpen');
  const _baEnd   = renderer.indexOf('// Master render', _baStart);
  const baBody   = renderer.slice(_baStart, _baEnd > _baStart ? _baEnd : _baStart + 2000);
  check('_baOpen (Quick check) drives the proactive focus transition on open (ensureWindowFocus)',
        /ensureWindowFocus/.test(baBody));
  check('_baOpen ARMS focus-suspect so the edge does the real repair (markFocusSuspect)',
        /markFocusSuspect/.test(baBody));
  check("... and it arms AFTER the overlay is shown (ov.classList.add('open')), so no popup is open yet",
        baBody.indexOf("classList.add('open')") !== -1
        && baBody.indexOf('markFocusSuspect') > baBody.indexOf("classList.add('open')"));

  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  check('preload exposes the ensureWindowFocus bridge',
        /ensureWindowFocus\s*:/.test(preload));

  // SYSTEMIC cure (eric, 2026-07-10; REVISED same day) — the pointerdown chokepoint still invokes the
  // repair, but blurWebView now fires ONLY on an ARMED trigger (native dialog / post-Confirm / draw-OCR
  // — see focusRepair.js; the pageHasFocus OR-fallback was removed as self-perpetuating). Pin the
  // load-bearing pieces (the invoke plumbing + the pre-focus/re-assert shape stay):
  check('main registers BOTH ipcMain.on AND ipcMain.handle for ensure-window-focus',
        /ipcMain\.on\(['"]ensure-window-focus['"]/.test(mainSrc)
        && /ipcMain\.handle\(['"]ensure-window-focus['"]/.test(mainSrc));
  check('main routes both through one shared body (runEnsureFocus)',
        /runEnsureFocus/.test(mainSrc));
  const pd = preload.slice(preload.indexOf("addEventListener('pointerdown'"));
  check('pointerdown path uses invoke (ordered), not only send',
        /ipcRenderer\.invoke\(['"]ensure-window-focus['"]/.test(pd));
  check('pointerdown pre-focuses the target in the desynced state, gated on !pageHasFocus',
        /!pageHasFocus\s*&&\s*document\.activeElement\s*!==\s*el/.test(pd));
  check('pointerdown re-asserts via a double rAF after the edge',
        /requestAnimationFrame\(\(\)\s*=>\s*requestAnimationFrame/.test(pd));
  check('pointerdown has the one-shot blind-spot re-issue (!document.hasFocus())',
        /!document\.hasFocus\(\)/.test(pd));

  // forceEdge plumbing (eric FIX 2, 2026-07-10 night): the VERIFIED one-shot is the ONLY sender
  // of forceEdge — the first-pass payload must never carry it (an at-rest gate is the pinned
  // self-perpetuation bug), and the (C) block must.
  const pdCode = pd.replace(/\r/g, '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  const cBlock = pdCode.slice(pdCode.indexOf('!document.hasFocus()'));
  check('the (C) one-shot re-issue sends forceEdge:true', /forceEdge:\s*true/.test(cBlock));
  const firstPass = pdCode.slice(0, pdCode.indexOf('!document.hasFocus()'));
  check('the FIRST-pass invoke payload does NOT carry forceEdge', !/forceEdge/.test(firstPass));
  check('focusRepair source carries the restore half (focusOnWebView)',
        /focusOnWebView/.test(repairSrc));
  // Child-close arming (eric Q4'): closing any child window arms the PARENT's suspect flag —
  // the known unarmed trigger behind the "no caret but typing works" runs. Pinned alongside
  // the standing NO-win.on('blur') pin above (dropdown popups are not BrowserWindows).
  check("main arms the parent's suspect flag on child window 'close'",
        /win\.on\(['"]close['"][\s\S]{0,400}getParentWindow[\s\S]{0,200}__focusSuspect\s*=\s*true/.test(mainSrc));
  check('main handle returns the repair result (edgeRan reply)',
        /ipcMain\.handle\(['"]ensure-window-focus['"][^\n]*runEnsureFocus/.test(mainSrc));

  // Programmatic-focus sweep (slice 1, 2026-08-02) — the pointerdown chokepoint can't fire on a
  // code-driven el.focus(), so a shared focusField() drives the widget edge first. Pin the plumbing
  // + the first converted live site (the workflow Reject note) + the newly-armed dialog windows.
  const win = f => fs.readFileSync(path.join(__dirname, '..', 'windows', f), 'utf8');
  check('preload exposes the awaitable ensureWindowFocusAsync (invoke) variant',
        /ensureWindowFocusAsync\s*:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]ensure-window-focus['"]/.test(preload));
  const dialogFocus = win('shared/dialogFocus.js');
  check('shared/dialogFocus defines focusField (programmatic-focus repair)',
        /async function focusField/.test(dialogFocus) && /ensureWindowFocusAsync/.test(dialogFocus));
  check('shared/dialogFocus arms native confirm()/alert() idempotently',
        /window\.confirm\s*=/.test(dialogFocus) && /window\.alert\s*=/.test(dialogFocus) && /__dsDialogFocusInstrumented/.test(dialogFocus));
  check('the workflow Reject note routes programmatic focus through focusField (not bare .focus())',
        /focusField\(note\)/.test(win('search/search-workflow.js')));
  check('previously-unarmed dialog windows now load shared/dialogFocus.js (search/main/teach)',
        /shared\/dialogFocus\.js/.test(win('search/index.html'))
        && /shared\/dialogFocus\.js/.test(win('main/index.html'))
        && /shared\/dialogFocus\.js/.test(win('teach/index.html')));
}

console.log(fails ? `\n${fails} FAILED` : '\nAll focus-repair checks passed');
process.exit(fails ? 1 : 0);
