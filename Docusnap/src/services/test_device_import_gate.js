'use strict';
// PIN — Settings backup device-import gate (Chris card 7; security review 2026-09-15).
//
// Proves the anti-trial-stacking anchor is a signature-verified paid SEAT, never the
// untrusted device_fp embedded in the backup file. See src/lib/deviceImportGate.js.
//
// Discovery: lives in src/services (run-pins covers src/services depth 0; src/lib is NOT a
// run-pins location, so the pin sits here beside the other service pins and requires the lib).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { deviceImportAllowed } = require('../lib/deviceImportGate');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' — ' + (e && e.message)); }
}

// ── The predicate: a verified paid seat is the ONLY thing that authorises ────────────
t('verified paid seat → allowed (licensed machine restores own OR foreign backup)', () => {
  assert.strictEqual(deviceImportAllowed({ decision: 'allow', claims: { kind: 'seat' } }).allowed, true);
});
t('verified TRIAL → refused (a trial must never unlock import)', () => {
  assert.strictEqual(deviceImportAllowed({ decision: 'allow', claims: { kind: 'trial' } }).allowed, false);
});
t('locked (expired) → refused', () => {
  assert.strictEqual(deviceImportAllowed({ decision: 'locked', reason: 'expired' }).allowed, false);
});
t('locked_needs_online → refused', () => {
  assert.strictEqual(deviceImportAllowed({ decision: 'locked_needs_online' }).allowed, false);
});
t('allow but NO claims → refused (fail closed)', () => {
  assert.strictEqual(deviceImportAllowed({ decision: 'allow' }).allowed, false);
});
t('null / undefined access → refused (fail closed)', () => {
  assert.strictEqual(deviceImportAllowed(null).allowed, false);
  assert.strictEqual(deviceImportAllowed(undefined).allowed, false);
});

// ── The load-bearing trade-off pin: device_fp cannot be smuggled back in ──────────────
// The predicate takes exactly ONE argument (the evaluated access) — NOT the backup meta.
// A future dev cannot re-add "same machine == embedded fp equals mine" through this door.
t('predicate arity is 1 — device_fp is not a parameter (no same-machine equality)', () => {
  assert.strictEqual(deviceImportAllowed.length, 1);
});
t('a forged-to-match device_fp does NOT authorise without a seat', () => {
  // Even if a caller tried to pass a meta whose device_fp equals this machine's fp, the
  // predicate ignores extra args and refuses on a non-seat access.
  const forged = { device_fp: 'whatever-this-machines-fp-is' };
  assert.strictEqual(deviceImportAllowed({ decision: 'locked' }, forged).allowed, false);
  assert.strictEqual(deviceImportAllowed(null, forged).allowed, false);
});

// ── Source-contract: the handler's same-machine allow is GATED behind the switch ──────
const handlerSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'settings', 'handler.js'), 'utf8');
t('handler no longer has an UNGATED same-machine embedded-fp allow', () => {
  // The vulnerable historical line was: if (backupFp && backupFp === curFp) return { allowed: true };
  // It must now be guarded by the seatOnly switch. Assert no ungated form survives.
  const ungated = /if\s*\(\s*backupFp\s*&&\s*backupFp\s*===\s*curFp\s*\)\s*return\s*\{\s*allowed:\s*true/;
  const gated = /if\s*\(\s*!seatOnly\s*&&\s*backupFp\s*&&\s*backupFp\s*===\s*curFp\s*\)/;
  assert.ok(gated.test(handlerSrc), 'expected the seatOnly-gated same-machine branch');
  assert.ok(!ungated.test(handlerSrc), 'found an UNGATED same-machine allow — the card-7 hole is reopened');
});
t('handler reads the backup_import_seat_only switch and routes the seat check through the predicate', () => {
  assert.ok(/backup_import_seat_only/.test(handlerSrc), 'expected the DARK switch read');
  assert.ok(/deviceImportGate/.test(handlerSrc), 'expected the seat decision routed through deviceImportGate');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
