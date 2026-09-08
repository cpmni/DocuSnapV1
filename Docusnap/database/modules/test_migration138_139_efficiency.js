#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration138_139_efficiency.js — the efficiency bundle's two migrations
 * (docs/designs/AUDIT_FIX_PLAN_2026-09-08.md §4 slices 3.1 + 3.3; Oracle C2/C7):
 *   mig 138 — `ocr_dpi` seeded 200 by INSERT OR IGNORE: a fresh install renders at 200 (the corpus-validated point;
 *             `_ocrDpiEnv` exports OCR_RENDER_DPI=200 — the old code default was a silent 300), an existing explicit
 *             row (300 chosen in Settings) is untouched, and the env + the RAM budget read the SAME resolver.
 *   mig 139 — `ocr_parallel_import_enabled` promoted ON by UPSERT (mig 127 seeded 'false' everywhere, so an
 *             INSERT OR IGNORE would be a dead guard), labelled @DEFAULT_FLIP, its SOLE writer, NOT a runtime-armed
 *             test switch (the release disarm must never un-promote it), a later manual OFF survives.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration138_139_efficiency.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
const H = require(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'));
const { scan } = require(path.join(ROOT, 'scripts', 'check-release-migrations'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const get = (db, k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const REL = { testBuild: false, buildRev: 'release-pin' };
const GiB = 1024 * 1024 * 1024;

// Fresh install.
const db = new Database(':memory:');
const logs = [];
{ const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db, { identity: REL }); console.log = o; }
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migrations 138 + 139 stamped', applied.has(138) && applied.has(139));
check("fresh install: ocr_dpi row = '200'", get(db, 'ocr_dpi') === '200');
check('fresh install: _ocrDpiEnv exports OCR_RENDER_DPI=200 (the old silent 300 default is gone)', JSON.stringify(H._ocrDpiEnv(db)) === JSON.stringify({ OCR_RENDER_DPI: '200' }));
check('fresh install: _resolveOcrDpi = 200 and the RAM budget follows it (1.5 GiB)', H._resolveOcrDpi(db) === 200 && H.perWorkerBudgetBytes(H._resolveOcrDpi(db)) === 1.5 * GiB);
check("fresh install: ocr_parallel_import_enabled = 'true' (mig 139 promotion)", get(db, 'ocr_parallel_import_enabled') === 'true');
check('the 139 console line names the promotion', logs.some(l => /migration 139 applied/.test(l) && /promoted ON/.test(l)));

// Existing explicit DPI row is untouched (INSERT OR IGNORE); the env + budget follow it.
const db300 = new Database(':memory:');
quiet(() => runMigrations(db300, { identity: REL }));
db300.prepare('DELETE FROM migrations WHERE version = 138').run();
db300.prepare("UPDATE settings SET value = '300' WHERE key = 'ocr_dpi'").run();
quiet(() => runMigrations(db300, { identity: REL }));
check("an existing explicit ocr_dpi=300 row survives mig 138 (INSERT OR IGNORE)", get(db300, 'ocr_dpi') === '300');
check('at 300: _ocrDpiEnv exports nothing (Python default) and the budget is 3.375 GiB — same resolver, no drift', Object.keys(H._ocrDpiEnv(db300)).length === 0 && H.perWorkerBudgetBytes(H._resolveOcrDpi(db300)) === 3.375 * GiB);
const dbNone = new Database(':memory:');
quiet(() => runMigrations(dbNone, { identity: REL }));
dbNone.prepare("DELETE FROM settings WHERE key = 'ocr_dpi'").run();
check('a rowless DB (harness/legacy) still resolves 300 = the Python code default (documented fallback)', H._resolveOcrDpi(dbNone) === 300);

// Oracle C7a (2026-09-08): a DB that already holds learned geometry (a template or a confirmed document) keeps the frame it
// was taught under — mig 138 writes an EXPLICIT '300' row there, and seeds 200 only on a fresh install.
function insertMinimalRow(db, table, overrides) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const row = {};
  for (const c of cols) {
    if (c.name in overrides) { row[c.name] = overrides[c.name]; continue; }
    if (c.pk || c.dflt_value != null || !c.notnull) continue;
    row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : 'x';
  }
  const names = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...names.map(k => row[k]));
}
for (const [label, seed] of [
  ['a confirmed document', (db) => insertMinimalRow(db, 'documents', { status: 'confirmed', original_filename: 'x.pdf' })],
  ['a template', (db) => insertMinimalRow(db, 'templates', {})],
]) {
  const dbTaught = new Database(':memory:');
  quiet(() => runMigrations(dbTaught, { identity: REL }));
  dbTaught.prepare('DELETE FROM migrations WHERE version = 138').run();
  dbTaught.prepare("DELETE FROM settings WHERE key = 'ocr_dpi'").run();
  let seeded = true; try { seed(dbTaught); } catch (e) { seeded = false; console.log(`  (fixture insert failed: ${e.message})`); }
  quiet(() => runMigrations(dbTaught, { identity: REL }));
  check(`C7a: a DB with ${label} and no ocr_dpi row gets an EXPLICIT '300' row (the frame its geometry was learned under)`, seeded && get(dbTaught, 'ocr_dpi') === '300');
  check(`C7a: … and the env then exports nothing (Python default 300) — unchanged behaviour for a taught install`, seeded && Object.keys(H._ocrDpiEnv(dbTaught)).length === 0);
}
check('C7a source: mig 138 counts templates + confirmed documents before choosing 200 vs 300', /applied\.has\(138\)[\s\S]{0,900}count\(\*\)[\s\S]{0,200}FROM templates[\s\S]{0,400}status = 'confirmed'[\s\S]{0,400}fresh \? '200' : '300'/.test(fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8')));

// mig 139: one-shot promotion, manual OFF survives, sole writer, not a test switch.
db.prepare("UPDATE settings SET value = 'false' WHERE key = 'ocr_parallel_import_enabled'").run();
quiet(() => runMigrations(db, { identity: REL }));
check('a later manual OFF of ocr_parallel_import_enabled survives the next start', get(db, 'ocr_parallel_import_enabled') === 'false');
check('ocr_parallel_import_enabled is NOT in TEST_SWITCH_KEYS (the release disarm cannot un-promote it)', !TEST_SWITCH_KEYS.includes('ocr_parallel_import_enabled'));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 139 is labelled @DEFAULT_FLIP 139 (the release gate requires the label)', /\/\/ @DEFAULT_FLIP 139 keys=ocr_parallel_import_enabled\r?\n\s*if \(!applied\.has\(139\)\)/.test(src));
check('mig 139 is the UPSERT shape (mig 127 seeded false everywhere; INSERT OR IGNORE would be dead)', /applied\.has\(139\)[\s\S]{0,400}VALUES \('ocr_parallel_import_enabled', 'true'\) ON CONFLICT\(key\) DO UPDATE SET value = 'true'/.test(src));
check("mig 139 is the key's SOLE 'true' writer in index.js", (src.match(/'ocr_parallel_import_enabled', 'true'/g) || []).length === 1);
check('mig 138 is an INSERT OR IGNORE seed (an explicit Settings choice survives), 200 or 300 by the C7a guard', /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('ocr_dpi', \?\)`\)\.run\(dpi\)/.test(src));
check('the release gate scan of index.js is still 0 hits (a labelled promotion of a non-test key)', scan({ indexSrc: src }).hits.length === 0);

// Oracle C7b: the Settings DPI control warns that a change after teaching re-reads every taught box.
check('C7b: the Settings DPI helper text warns of the one-time review wave', /Changing this after teaching re-reads every taught box[\s\S]{0,120}review wave/.test(fs.readFileSync(path.join(ROOT, 'src', 'windows', 'settings', 'index.html'), 'utf8')));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
