#!/usr/bin/env node
'use strict';

/**
 * src/modules/review/test_validation_patterns_merge.js
 * ----------------------------------------------------
 * Pins `get-validation-patterns` — the RENDERER's copy of `validation_patterns`, which is what
 * warns an operator on blur that a value they typed is the wrong format.
 *
 * WHY THIS EXISTS (Oracle C4 / G3, 2026-08-10). `vat_eu_formats` has to widen BOTH the pipeline
 * and this surface, or the app tells an operator their correctly-typed Irish VAT number is wrong
 * while extraction happily accepts it — the `iban` defect of 2026-08-08. The Python side re-reads
 * the setting at EVERY extraction spawn, so if this handler caches the MERGED patterns, flipping
 * the toggle widens extraction immediately and leaves the warning narrow until the app restarts:
 * a live, transient reinstatement of the exact disagreement the widening exists to remove.
 *
 * The existing Python pin (test_vat_eu_formats.py check 8) asserts only that the STRINGS
 * 'vat_eu_formats' and 'vat_eu' appear in this file. That would pass over a logically broken
 * merge, and it would pass over a stale cache. This one is BEHAVIOURAL: it calls the registered
 * handler, flips the setting through the REAL learning.setSetting, and calls it again IN THE SAME
 * PROCESS.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/review/test_validation_patterns_merge.js
 */

const path = require('path');
const Database = require('better-sqlite3');

let fails = 0;
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`);
  if (!cond) fails++;
};

// ── Stub the auth gate BEFORE review/handler requires it ─────────────────────
// Every IPC handler opens with requireLogin(); there is no test hook to seat a session, so the
// module is pre-seeded into require.cache. Nothing else about auth is exercised here.
const authPath = require.resolve('../auth/handler');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true, exports: {
    register: () => {}, getCurrentUser: () => ({ id: 1, username: 't', role: 'admin' }),
    hasRole: () => true, requireRole: () => {}, requireLogin: () => {}, logAudit: () => {},
  },
};

// ── A real DB, so the setting is read through the REAL learning module ───────
const { runMigrations, runJsMigrations } = require('../../../database/index');
const db = new Database(':memory:');
runMigrations(db);
try { runJsMigrations(db); } catch { /* not needed for a settings read */ }
const learning = require('../../../database/modules/learning');

// ── Capture the handler out of register() with a stub ipcMain ────────────────
const handlers = new Map();
const ctx = {
  ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} },
  getDb: () => db,
  fs: require('fs'),
  path,
  // The real resolver picks resourcesPath when packaged; in-repo this is the same file every
  // other consumer reads, which is the point — the pin must not diverge onto a fixture config.
  resourcePath: (...p) => path.join(__dirname, '..', '..', '..', ...p),
  logger: { warn: () => {}, info: () => {}, error: () => {} },
  spawn: () => {}, pythonExe: () => 'py', pythonArgs: () => [], tesseractPath: () => '',
  notifyMainWindow: () => {},
};

try {
  require('./handler').register(ctx);
} catch (e) {
  check('review/handler.js register() completed against the stub ctx', false, e.message);
  console.log('\n1 FAILED');
  process.exit(1);
}

const fn = handlers.get('get-validation-patterns');
check('get-validation-patterns is registered', typeof fn === 'function');
if (typeof fn !== 'function') { console.log('\n1 FAILED'); process.exit(1); }

// ── 1. OFF is the shipped, UK-only state ─────────────────────────────────────
learning.setSetting(db, 'vat_eu_formats', 'false');
const off = fn();
const gbOff = (off.vat_gb || []).length;
check('flag OFF: vat_gb is the shipped UK-only list', gbOff === 3, `len=${gbOff}`);
check('flag OFF: the EU list is present but NOT merged in',
      Array.isArray(off.vat_eu) && off.vat_eu.length > 0
      && !off.vat_eu.some(p => (off.vat_gb || []).includes(p)));

// ── 2. THE CACHE PIN: a flip is visible WITHOUT a restart ────────────────────
// Same process, same registered handler, no re-require. This is the check that fails if the
// MERGED result is ever cached again (only the raw file read may be cached).
learning.setSetting(db, 'vat_eu_formats', 'true');
const on = fn();
const gbOn = (on.vat_gb || []).length;
check('flipping the setting widens vat_gb IN THE SAME PROCESS (no restart)', gbOn > gbOff,
      `off=${gbOff} on=${gbOn}`);
check('every EU pattern is actually merged into vat_gb when armed',
      (on.vat_eu || []).every(p => on.vat_gb.includes(p)));
check('the UK patterns are still present and FIRST when armed',
      (off.vat_gb || []).every((p, i) => on.vat_gb[i] === p));

// ── 3. And back again — the widening is not one-way ──────────────────────────
learning.setSetting(db, 'vat_eu_formats', 'false');
const off2 = fn();
check('flipping back narrows it again in the same process',
      (off2.vat_gb || []).length === gbOff, `len=${(off2.vat_gb || []).length}`);

// ── 4. An armed call must not mutate the cached raw config ───────────────────
// If the merge ever happened in place, check 3 above could not have come back narrow. Asserted
// directly as well, so the REASON is recorded rather than inferred from a downstream symptom.
check('an armed call does not mutate the cached raw patterns',
      off2.vat_gb !== on.vat_gb && (off2.vat_gb || []).length < gbOn);

// ── 5. THE ACTUAL DEFECT, end to end ─────────────────────────────────────────
// A correct German VAT number must be accepted by the renderer's own patterns once armed — the
// operator-facing half of the widening. Compiled exactly as the renderer compiles them
// (IGNORECASE, review/renderer.js:95).
const deOk = (pats) => (pats.vat_gb || []).some(p => { try { return new RegExp(p, 'i').test('DE123456789'); } catch { return false; } });
check('OFF: the renderer would warn on a correct German VAT number (the defect)', !deOk(off));
learning.setSetting(db, 'vat_eu_formats', 'true');
check('ON: the renderer accepts it (the defect is fixed on the surface that shows the warning)',
      deOk(fn()));

// ── 6. CONTROL: the pin can tell the two states apart at all ─────────────────
// Without this, every check above could pass against a config with no vat_eu list.
check('CONTROL: the shipped config really does carry a non-empty vat_eu list',
      Array.isArray(off.vat_eu) && off.vat_eu.length >= 20, `len=${(off.vat_eu || []).length}`);

console.log(fails ? `\n${fails} FAILED` : '\nAll validation-pattern merge pins passed');
process.exit(fails ? 1 : 0);
