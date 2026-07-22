'use strict';
// Pins the P3 identity-scoping invariant: an armed teardown closes ONLY the
// specific window instances it captured, never whatever currently occupies a
// windows[] slot — so a stale 12s timer can never destroy a NEWER wizard that
// reused the slot (the "first-run wizard closes itself" bug).
const assert = require('assert');
const { closeCoverWindows, scheduleCoverTeardown } = require('./coverTeardown');

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log('  OK  ' + msg); }
  else { failed++; console.log('  XX  ' + msg); }
}

function fakeWin() {
  return {
    _allowClose: false,
    _closed: false,
    isDestroyed() { return this._closed; },
    close() { this._closed = true; },
  };
}

// 1. every LIVE captured instance is force-closed (real destroy: _allowClose + close())
{
  const a = fakeWin(), b = fakeWin();
  closeCoverWindows([a, b]);
  ok(a._allowClose === true && a._closed === true, 'live instance A is force-closed');
  ok(b._allowClose === true && b._closed === true, 'live instance B is force-closed');
}

// 2. an already-destroyed instance is skipped (no double-close, no throw)
{
  const a = fakeWin(); a._closed = true; a._allowClose = false;
  closeCoverWindows([a]);
  ok(a._allowClose === false, 'destroyed instance is left untouched (not re-closed)');
}

// 3. null / undefined slots are tolerated (login+license absent on a re-run)
{
  let threw = false;
  try { closeCoverWindows([null, undefined]); } catch { threw = true; }
  ok(!threw, 'null/undefined covers do not throw');
}

// 4. THE INVARIANT: only the captured instances are closed. A NEWER window that
//    reused the slot but was NOT captured is never touched (the self-close fix).
{
  const oldWizard = fakeWin();
  const newWizard = fakeWin();      // created later; reused windows['onboarding']; NOT captured
  closeCoverWindows([oldWizard]);   // a stale timer only holds the OLD instance
  ok(oldWizard._closed === true, 'the captured (old) wizard is closed');
  ok(newWizard._closed === false && newWizard._allowClose === false,
     'the newer wizard that reused the slot is NOT closed (identity-scoped)');
}

// 5. no-arg and empty-array are safe no-ops
{
  let threw = false;
  try { closeCoverWindows(); closeCoverWindows([]); } catch { threw = true; }
  ok(!threw, 'no-arg and empty-array are safe no-ops');
}

// ── scheduleCoverTeardown: the arm/cancel timer wiring (fake main + spy timers) ──
function fakeMain() {
  const h = {};
  const m = {
    _destroyed: false,
    isDestroyed() { return m._destroyed; },
    once(evt, cb) { (h[evt] = h[evt] || []).push(cb); },
    removeListener(evt, cb) { if (h[evt]) h[evt] = h[evt].filter((x) => x !== cb); },
    emit(evt) { const list = h[evt] || []; h[evt] = []; list.forEach((cb) => cb()); },   // 'once' semantics
    listenerCount(evt) { return (h[evt] || []).length; },
  };
  return m;
}
function spyTimers() {
  const s = { armed: 0, cleared: 0, _fn: null };
  s.setTimeoutFn = (fn) => { s.armed++; s._fn = fn; return { fn }; };
  s.clearTimeoutFn = () => { s.cleared++; };
  s.fire = () => { if (s._fn) s._fn(); };
  return s;
}

// A. REUSE (mainExisted): teardown runs synchronously, no timer armed
{
  const main = fakeMain(), tm = spyTimers(); let tore = 0;
  scheduleCoverTeardown({ main, mainExisted: true, teardown: () => tore++, setTimeoutFn: tm.setTimeoutFn, clearTimeoutFn: tm.clearTimeoutFn });
  ok(tore === 1, 'reuse: teardown runs synchronously');
  ok(tm.armed === 0, 'reuse: no backstop timer armed');
}

// B. FRESH, ready-to-show wins: armed at open; teardown once + timer cleared + closed hook dropped
{
  const main = fakeMain(), tm = spyTimers(); let tore = 0;
  scheduleCoverTeardown({ main, mainExisted: false, teardown: () => tore++, setTimeoutFn: tm.setTimeoutFn, clearTimeoutFn: tm.clearTimeoutFn });
  ok(tore === 0 && tm.armed === 1, 'fresh: teardown deferred, backstop timer armed');
  main.emit('ready-to-show');
  ok(tore === 1, 'fresh: ready-to-show runs teardown once');
  ok(tm.cleared === 1, 'fresh: ready-to-show clears the backstop timer');
  ok(main.listenerCount('closed') === 0, 'fresh: the closed hook is dropped once ready-to-show wins (no retained closure)');
  main.emit('closed');
  ok(tore === 1, 'fresh: a later closed does not re-run teardown');
}

// C. FRESH, closed BEFORE paint: timer cleared, teardown never runs (covers left up, not zero-window)
{
  const main = fakeMain(), tm = spyTimers(); let tore = 0;
  scheduleCoverTeardown({ main, mainExisted: false, teardown: () => tore++, setTimeoutFn: tm.setTimeoutFn, clearTimeoutFn: tm.clearTimeoutFn });
  main.emit('closed');
  ok(tm.cleared === 1, 'fresh→closed-before-paint: backstop timer cleared');
  ok(tore === 0, 'fresh→closed-before-paint: teardown never runs');
}

// D. WEDGED renderer: ready-to-show never fires → the backstop timer tears the covers down
{
  const main = fakeMain(), tm = spyTimers(); let tore = 0;
  scheduleCoverTeardown({ main, mainExisted: false, teardown: () => tore++, setTimeoutFn: tm.setTimeoutFn, clearTimeoutFn: tm.clearTimeoutFn });
  tm.fire();
  ok(tore === 1, 'wedged renderer: the 12s backstop tears the covers down');
}

// E. absent / destroyed main: teardown runs synchronously (the guard)
{
  const tm = spyTimers(); let tore = 0;
  scheduleCoverTeardown({ main: null, mainExisted: false, teardown: () => tore++, setTimeoutFn: tm.setTimeoutFn, clearTimeoutFn: tm.clearTimeoutFn });
  ok(tore === 1, 'null main: teardown runs synchronously');
  const dead = fakeMain(); dead._destroyed = true; let tore2 = 0;
  scheduleCoverTeardown({ main: dead, mainExisted: false, teardown: () => tore2++, setTimeoutFn: tm.setTimeoutFn, clearTimeoutFn: tm.clearTimeoutFn });
  ok(tore2 === 1, 'destroyed main: teardown runs synchronously');
}

console.log();
if (failed) { console.log(`coverTeardown: ${passed} passed, ${failed} failed`); process.exit(1); }
console.log(`coverTeardown: ${passed} passed, 0 failed`);
