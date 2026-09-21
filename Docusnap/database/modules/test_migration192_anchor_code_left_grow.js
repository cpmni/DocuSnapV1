#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration192_anchor_code_left_grow.js — mig 192 seeds `anchor_code_left_grow` OFF,
 * mig 193 GRADUATES it to a customer default ON (2026-09-21; 007+gary → Oracle SIGN-OFF-W/COND; gate met:
 * safety census M=0 + the efficacy injection fires + adversarial abstains). The Stage-2 taught-crop left-clip
 * recovery: on a ref crop disagreement, re-read the taught box with the mig-161 left-slack window; on
 * INDEPENDENT convergence with the full-page read, commit the correct value CLEAN (no needless "please verify"
 * click). Pins: mig 192 seeded 'false' (source), mig 193 is the @DEFAULT_FLIP UPSERT-true graduation, final
 * value 'true', DELISTED from TEST_SWITCH_KEYS, handler env-wiring present, and (mig 193 runs once) a
 * post-graduation operator OFF is respected.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration192_anchor_code_left_grow.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const db = new Database(':memory:');
const logs = []; const origLog = console.log; console.log = (m) => { logs.push(String(m)); };
runMigrations(db);
console.log = origLog;
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 192 stamped', applied.has(192));
check('migration 193 stamped (the graduation)', applied.has(193));
check('the mig-192 seed line still says seeded OFF (DARK)', logs.some(l => /migration 192 applied/.test(l) && /seeded OFF/.test(l)));
check("a fresh install ends with anchor_code_left_grow === 'true' (GRADUATED by mig 193)", get('anchor_code_left_grow') === 'true');
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 192 is still an INSERT OR IGNORE seed of false (the DARK seed)',
  /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('anchor_code_left_grow', 'false'\)/.test(src));
check('mig 193 is a @DEFAULT_FLIP UPSERT-true graduation',
  /@DEFAULT_FLIP 193/.test(src) && /INSERT INTO settings \(key, value\) VALUES \('anchor_code_left_grow', 'true'\) ON CONFLICT\(key\) DO UPDATE SET value = 'true'/.test(src));
check('anchor_code_left_grow is DELISTED from TEST_SWITCH_KEYS (customer default)', !TEST_SWITCH_KEYS.includes('anchor_code_left_grow'));
const handler = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('handler wires the setting to env.ANCHOR_CODE_LEFT_GROW',
  /getSetting\(db, 'anchor_code_left_grow'[\s\S]{0,80}env\.ANCHOR_CODE_LEFT_GROW = '1'/.test(handler));
// mig 193 is stamped, so it does NOT re-run — an operator who turns it OFF after the graduation is respected.
db.prepare("UPDATE settings SET value = 'false' WHERE key = 'anchor_code_left_grow'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check('a post-graduation operator OFF survives the next start (mig 193 already applied)', get('anchor_code_left_grow') === 'false');
console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
