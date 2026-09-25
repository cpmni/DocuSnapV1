#!/usr/bin/env node
'use strict';
/**
 * test_migration219_keyword_label_tail_bound.js — mig 219 seeds `keyword_label_tail_bound` OFF (2026-09-25;
 * Chris 09-24 card-4 class "letters offered as a reference"; Oracle C6, DARK).
 * Pins: stamped, seeded 'false', listed in TEST_SWITCH_KEYS (17 keys), single-key seed, no force-ON twin, a
 * later manual ON survives; the handler bridge is exactly ONE line inside _reconcileEnv (which _pipelineSpawnEnv
 * composes for every spawn) gated on the setting; the engine (keyword.py) carries the _label_tail_boundable
 * helper and the SCALAR elif block, inline env read, default OFF (byte-identical off).
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration219_keyword_label_tail_bound.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const KEY = 'keyword_label_tail_bound', ENV = 'KEYWORD_LABEL_TAIL_BOUND';
const norm = (s) => s.replace(/\r\n/g, '\n');

console.log('\n1. mig 219 seed');
const db = new Database(':memory:');
const logs = []; { const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db); console.log = o; }
const get = (d, k) => { const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 219 stamped', applied.has(219));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 219 applied/.test(l) && /seeded OFF/.test(l)));
check(`a fresh install has ${KEY} === 'false'`, get(db, KEY) === 'false');
check(`${KEY} is listed in TEST_SWITCH_KEYS`, TEST_SWITCH_KEYS.includes(KEY));
check('TEST_SWITCH_KEYS is 17 keys', TEST_SWITCH_KEYS.length === 17 && new Set(TEST_SWITCH_KEYS).size === 17);
const src = norm(fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8'));
check('single-key INSERT OR IGNORE seed of false', new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(src));
check('NO force-ON of the key anywhere in the migrations', !new RegExp(`VALUES \\('${KEY}', 'true'\\)`).test(src));
const setS = (d, k, v) => d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
setS(db, KEY, 'true');
{ const o = console.log; console.log = () => {}; runMigrations(db); console.log = o; }
check('a later manual ON survives the next start (the seed is INSERT OR IGNORE)', get(db, KEY) === 'true');
db.close();

console.log('\n2. the handler bridge (handler.js _reconcileEnv)');
const h = norm(fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8'));
check('exactly one bridge line for the env', (h.match(new RegExp(`env\\.${ENV} = '1'`, 'g')) || []).length === 1);
check('the bridge is gated on the setting', new RegExp(`learning\\.getSetting\\(db, '${KEY}', 'false'\\) === 'true'\\) env\\.${ENV} = '1';`).test(h));
check('the bridge lives inside _reconcileEnv, which _pipelineSpawnEnv composes for every Python spawn',
      h.indexOf('function _reconcileEnv(db)') < h.indexOf(`env.${ENV} = '1'`) && h.indexOf(`env.${ENV} = '1'`) < h.indexOf('function _pipelineSpawnEnv(db)'));
// functional: OFF omits the env (byte-identical spawn), ON sets it to '1'
const H = require(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'));
const fdb = new Database(':memory:'); { const o = console.log; console.log = () => {}; runMigrations(fdb); console.log = o; }
const setF = (k, v) => fdb.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
check('OFF: _reconcileEnv omits the env (byte-identical spawn)', H._reconcileEnv(fdb)[ENV] === undefined);
setF(KEY, 'true');
check(`ON: _reconcileEnv sets ${ENV} === '1'`, H._reconcileEnv(fdb)[ENV] === '1');
fdb.close();

console.log('\n3. the engine (keyword.py) shape');
const py = norm(fs.readFileSync(path.join(ROOT, 'python_backend', 'extraction', 'keyword.py'), 'utf8'));
check('the _label_tail_boundable helper is defined (multi-word, alphabetic last word)',
      /def _label_tail_boundable\(label: str\) -> bool:/.test(py)
      && /return len\(words\) > 1 and words\[-1\]\.isalpha\(\)/.test(py));
check('the SCALAR elif block applies the tail bound, inline env read, default OFF, gated on the helper + currency exclusion',
      new RegExp(`elif \\(\\(not collect\\) and os\\.environ\\.get\\('${ENV}', '0'\\) == '1'\\s*\\n\\s*and val_type != 'currency' and _label_tail_boundable\\(label\\)\\):\\s*\\n\\s*pattern = re\\.compile\\(pattern\\.pattern \\+ r'\\(\\?!\\[a-z\\]\\)'\\)`).test(py));
check('a money label (val_type currency) is EXCLUDED — the owner-727 census "Total DueGBP…" loss',
      /and val_type != 'currency' and _label_tail_boundable\(label\)/.test(py));
check('it is an ELIF of the LIST branch (scalar path only; the list path keeps its own bound)',
      /if collect and LIST_CAPTION_TAIL_BOUND:\s*\n\s*pattern = re\.compile\(pattern\.pattern \+ r'\(\?!\[a-z\]\)'\)\s*\n(?:\s*#[^\n]*\n)*\s*elif \(\(not collect\) and os\.environ\.get\('KEYWORD_LABEL_TAIL_BOUND'/.test(py));

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
