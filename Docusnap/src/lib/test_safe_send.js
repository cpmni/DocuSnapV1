'use strict';
// Unit test for safeSend (src/lib/safe-send.js) — the crash guard for the
// "Object has been destroyed" main-process crash (a Python-stdout closure sending
// to a webContents whose window has closed). Pure JS, no Electron/native deps:
//   node src/lib/test_safe_send.js
const { makeSafeSend } = require('./safe-send');

let fails = 0;
function ok(cond, name) {
  if (cond) { console.log(`  OK  ${name}`); }
  else { console.log(`  FAIL ${name}`); fails++; }
}

// A fake logger that records warn() calls (mirrors the real logger's shape).
function fakeLogger() {
  const warns = [];
  return { warn: (m) => warns.push(m), warns };
}

// 1. Destroyed webContents: must NOT send and must NOT throw (the crash repro).
{
  const log = fakeLogger();
  const safeSend = makeSafeSend(log);
  let sent = 0;
  const destroyed = { isDestroyed: () => true, send: () => { sent++; } };
  let threw = false;
  try { safeSend(destroyed, 'process-progress', { type: 'log' }); } catch { threw = true; }
  ok(!threw, 'destroyed wc → no throw');
  ok(sent === 0, 'destroyed wc → send NOT called');
  ok(log.warns.length === 0, 'destroyed wc → no warn (expected, not an error)');
}

// 2. Live webContents: sends exactly once, forwarding channel + all args.
{
  const safeSend = makeSafeSend(fakeLogger());
  const calls = [];
  const live = { isDestroyed: () => false, send: (...a) => calls.push(a) };
  safeSend(live, 'reprocess-progress', { type: 'file_done' }, 42);
  ok(calls.length === 1, 'live wc → send called once');
  ok(calls[0][0] === 'reprocess-progress', 'live wc → channel forwarded');
  ok(calls[0][1] && calls[0][1].type === 'file_done' && calls[0][2] === 42, 'live wc → args forwarded');
}

// 3. TOCTOU race: not-destroyed at check time but send() throws (window torn down
//    mid-callback). Must swallow AND warn (so a real bad payload stays visible).
{
  const log = fakeLogger();
  const safeSend = makeSafeSend(log);
  const racing = { isDestroyed: () => false, send: () => { throw new Error('Object has been destroyed'); } };
  let threw = false;
  try { safeSend(racing, 'process-progress', { type: 'log' }); } catch { threw = true; }
  ok(!threw, 'send() throws → swallowed (no throw to caller)');
  ok(log.warns.length === 1, 'send() throws → warned once');
  ok(/dropped 'process-progress'/.test(log.warns[0] || ''), 'warn names the dropped channel');
}

// 4. Null / undefined / missing-webContents targets: no throw (guards the
//    `windows['x']?.webContents` case where the window or its wc is gone).
{
  const safeSend = makeSafeSend(fakeLogger());
  let threw = false;
  try {
    safeSend(null, 'c', 1);
    safeSend(undefined, 'c', 1);
  } catch { threw = true; }
  ok(!threw, 'null/undefined wc → no throw');
}

// 5. No logger injected: must still be crash-safe (logger?. optional chaining).
{
  const safeSend = makeSafeSend(undefined);
  const racing = { isDestroyed: () => false, send: () => { throw new Error('boom'); } };
  let threw = false;
  try { safeSend(racing, 'c', 1); } catch { threw = true; }
  ok(!threw, 'no logger + throwing send → still no throw');
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nAll safeSend checks passed.');
