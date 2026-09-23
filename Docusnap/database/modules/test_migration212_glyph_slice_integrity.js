#!/usr/bin/env node
'use strict';
/**
 * test_migration212_glyph_slice_integrity.js — mig 212 seeds `glyph_slice_integrity` OFF (2026-09-23 night; Oracle
 * C2/C3 of the Paddle corroboration vet — S1 of Part A: the second reader's crop rect snapped to the page word boxes).
 * Pins (Electron-as-Node): stamped, seeded 'false', in TEST_SWITCH_KEYS, no force-ON twin, a later manual ON survives;
 * the env bridge GLYPH_SLICE_INTEGRITY mirrors the setting; the engine reads it ONLY inside the DARK hold; the module
 * is pure (no OCR import) and the hold abstains without the locate cache (C14).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration212_glyph_slice_integrity.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
const H = require(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const KEY = 'glyph_slice_integrity', ENV = 'GLYPH_SLICE_INTEGRITY';

console.log('\n1. mig 212 seed');
const db = new Database(':memory:');
const logs = []; { const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db); console.log = o; }
const get = (d, k) => { const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 212 stamped', applied.has(212));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 212 applied/.test(l) && /seeded OFF/.test(l)));
check(`a fresh install has ${KEY} === 'false'`, get(db, KEY) === 'false');
check(`${KEY} is listed in TEST_SWITCH_KEYS`, TEST_SWITCH_KEYS.includes(KEY));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('single-key INSERT OR IGNORE seed of false', new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(src));
check('NO numbered force-ON twin exists', !new RegExp(`VALUES \\('${KEY}', 'true'\\)`).test(src));
const setS = (d, k, v) => d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
setS(db, KEY, 'true'); quiet(() => runMigrations(db));
check("a later manual ON survives the next start", get(db, KEY) === 'true');

console.log('\n2. _reconcileEnv bridge');
setS(db, KEY, 'false'); let e = H._reconcileEnv(db); check('OFF → no env var', !(ENV in e));
setS(db, KEY, 'true'); e = H._reconcileEnv(db); check("ON → GLYPH_SLICE_INTEGRITY === '1'", e[ENV] === '1');

console.log('\n3. engine + module shape');
const eng = fs.readFileSync(path.join(ROOT, 'python_backend', 'extraction', 'engine.py'), 'utf8');
const body = eng.slice(eng.indexOf('def _glyph_disagreement_hold'), eng.indexOf('def _glyph_release_page_family_disagrees'));
check('the env is read only inside the DARK hold', (eng.match(/GLYPH_SLICE_INTEGRITY/g) || []).length >= 1 && body.includes("os.environ.get('GLYPH_SLICE_INTEGRITY'"));
check('the hold abstains from snapping without the locate cache (C14)', /_lc = getattr\(self, '_line_cache', None\)[\s\S]{0,200}if _lc is not None else None/.test(body));
check('a snapped rect never touches the value/note (the hold only reassigns `box`)', /box = _si\['rect'\]/.test(body) && !/_si\[[^\]]*\][\s\S]{0,80}validation_note/.test(body));
const mod = fs.readFileSync(path.join(ROOT, 'python_backend', 'extraction', 'slice_integrity.py'), 'utf8');
check('slice_integrity.py is pure geometry (no OCR / reader import)', !/pytesseract|glyph_reader|onnx|import PIL|from PIL/.test(mod));

console.log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} (${fails} bad)`);
process.exit(fails ? 1 : 0);
