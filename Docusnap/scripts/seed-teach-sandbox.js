'use strict';
// Seed the TEACH-TEST sandbox (owner run, 2026-08-08).
//
// Builds on scripts/seed-chris-sandbox.js (fresh migrated DB + the machine-bound licence rows so
// the gate passes) and then does the two things this particular run needs:
//
//   1. MIRRORS THE LIVE SETTINGS, so the sandbox behaves like the owner's REAL app. A fresh DB has
//      every extraction switch at its default (OFF). The live install currently has ~33 of them ON.
//      Measuring the teach side on all-defaults would measure a configuration nobody runs, and any
//      failure inventory it produced would not be the one the customer sees.
//   2. Skips first-run/welcome and points output at the sandbox, so the run starts at "import and
//      teach" rather than at a setup wizard.
//
// Path-like settings are DELIBERATELY not copied — a sandbox that files into the live output folder
// or watches the live input folder is not a sandbox. They are overridden after the copy.
//
// Run:
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/seed-teach-sandbox.js <sandbox-root>
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));

const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: seed-teach-sandbox.js <sandbox-root>'); process.exit(1); }
const USERDATA = path.join(ROOT, 'userData');
const OUTPUT = path.join(ROOT, 'Output');
for (const d of [USERDATA, OUTPUT, path.join(ROOT, 'snapshots')]) fs.mkdirSync(d, { recursive: true });

// ── 1. fresh migrated DB + licence rows (reuse the proven seeder, don't re-implement it) ─────────
if (fs.existsSync(path.join(USERDATA, 'docusnap.db'))) {
  console.error(`refusing to overwrite an existing sandbox DB at ${USERDATA}\n` +
                `delete it first if you really want a fresh one`);
  process.exit(1);
}
execFileSync(process.execPath, [path.join(REPO, 'scripts', 'seed-chris-sandbox.js'), USERDATA],
             { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });

// ── 2. mirror the live SETTINGS (behaviour flags), minus paths and licensing ─────────────────────
const live = new Database(path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db'), { readonly: true });
const sand = new Database(path.join(USERDATA, 'docusnap.db'));

// Never copied: anything path-like (would point the sandbox at live folders), licensing (already
// seeded and machine-bound), and the first-run/legal stamps (set explicitly below).
const SKIP_EXACT = new Set(['output_folder', 'input_folder', 'watch_folder', 'first_run_completed',
                            'welcome_seen', 'terms_accepted', 'output_folder_pattern_preview']);
const SKIP_PREFIX = ['licens', 'detached_', 'update_info'];
let copied = 0, flagsOn = [];
for (const r of live.prepare('SELECT key, value FROM settings').all()) {
  if (SKIP_EXACT.has(r.key) || SKIP_PREFIX.some(p => r.key.startsWith(p))) continue;
  if (/folder|path|dir/i.test(r.key)) continue;              // belt and braces on path-like keys
  sand.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ' +
               'ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(r.key, r.value);
  copied++;
  if (r.value === 'true') flagsOn.push(r.key);
}

// ── 3. start at "import and teach", not at a setup wizard ───────────────────────────────────────
const put = (k, v) => sand.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ' +
                                   'ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
put('output_folder', OUTPUT);
put('first_run_completed', 'true');
put('welcome_seen', 'true');

console.log(`\nsandbox root : ${ROOT}`);
console.log(`  userData   : ${USERDATA}`);
console.log(`  output     : ${OUTPUT}`);
console.log(`settings copied from live: ${copied}  (${flagsOn.length} switches ON)`);
console.log(`  ON: ${flagsOn.sort().join(', ') || '(none)'}`);
console.log(`\nTerms are left UNACCEPTED on purpose — accept them once on first launch.`);
console.log(`\nLaunch it (PowerShell):`);
console.log(`  $env:DOCUSNAP_USERDATA = "${USERDATA}"`);
console.log(`  npm start`);
console.log(`\nUnset $env:DOCUSNAP_USERDATA (or use a new terminal) to get your real app back.`);
live.close(); sand.close();
