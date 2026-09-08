#!/usr/bin/env node
'use strict';
/**
 * scripts/arm-test-switches.js — the INTERIM/manual road to arm (or disarm) every DARK test switch on a DB
 * (2026-09-08; docs/designs/AUDIT_FIX_PLAN_2026-09-08.md §2 slice 1.4; Oracle C3). Writes the
 * `test_build_armed_rev` marker as `manual@<rev>` so the next RELEASE launch disarms the DB — the road a
 * hand-edit or a raw SQL UPDATE would silently skip (re-opening the "reference DB ON forever" seam).
 *
 * Needs the Electron ABI for better-sqlite3 (run as the pins do). CLOSE THE APP FIRST — a live WAL writer
 * and this script must not race.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/arm-test-switches.js <docusnap.db>          # arm
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/arm-test-switches.js <docusnap.db> --off    # disarm
 *   … --status   prints the marker + each key without writing
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
const arming = require(path.join(ROOT, 'database', 'build_arming'));

const args = process.argv.slice(2);
const dbPath = args.find(a => !a.startsWith('--'));
const off = args.includes('--off');
const status = args.includes('--status');
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('usage: arm-test-switches.js <path\\to\\docusnap.db> [--off | --status]');
  process.exit(2);
}
const db = new Database(dbPath, { readonly: status });
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : '<absent>'; };
const show = () => {
  console.log(`  ${arming.MARKER} = ${get(arming.MARKER)}`);
  for (const k of TEST_SWITCH_KEYS) console.log(`  ${k.padEnd(40)} ${get(k)}`);
};
if (status) { console.log(`[arm-test-switches] ${dbPath}`); show(); process.exit(0); }
const rev = 'manual@' + new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const r = off ? arming.disarmTestSwitches(db) : arming.armTestSwitches(db, { testBuild: true, buildRev: rev });
console.log(`[arm-test-switches] ${r.action} ${TEST_SWITCH_KEYS.length} switch(es) on ${dbPath}${off ? '' : ` (marker ${rev} — the next RELEASE launch disarms)`}`);
show();
