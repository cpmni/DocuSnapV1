#!/usr/bin/env node
'use strict';
/**
 * test_migration213_name_value_label_flag.js — mig 213 seeds `name_value_label_flag` OFF (2026-09-24; Chris 09-23
 * teach round card 1 — a taught customer_name box drifted onto the label line and "Customer" auto-filed as the
 * customer's name; gary → Oracle SIGN-OFF-W/COND C5-C8).
 * Pins (Electron-as-Node): stamped, seeded 'false', in TEST_SWITCH_KEYS, no force-ON twin, a later manual ON survives;
 * the env bridge NAME_VALUE_LABEL_FLAG mirrors the setting; the engine reads it ONLY in the Stage-4.5 guard and reuses
 * the mig-156 `+nonname_flag` sentinel (so trust.js needs no change); the predicate lives in value_quality (pure).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration213_name_value_label_flag.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
const H = require(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'));
const trust = require(path.join(ROOT, 'database', 'modules', 'trust.js'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const KEY = 'name_value_label_flag', ENV = 'NAME_VALUE_LABEL_FLAG';

console.log('\n1. mig 213 seed');
const db = new Database(':memory:');
const logs = []; { const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db); console.log = o; }
const get = (d, k) => { const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 213 stamped', applied.has(213));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 213 applied/.test(l) && /seeded OFF/.test(l)));
check(`a fresh install has ${KEY} === 'true' (GRADUATED by the 215 batch, 2026-09-24 evening; the mig-213 seed 'false' is UPSERT-flipped)`, get(db, KEY) === 'true');
check(`${KEY} is DELISTED from TEST_SWITCH_KEYS (graduated — the mig-137 reset can never un-promote it)`, !TEST_SWITCH_KEYS.includes(KEY));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('single-key INSERT OR IGNORE seed of false', new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(src));
check('the ONLY force-ON is the labelled @DEFAULT_FLIP 215 batch (no unlabelled twin)', (src.match(new RegExp(`VALUES \\('${KEY}', 'true'\\)`, 'g')) || []).length === 1 && /@DEFAULT_FLIP 215/.test(src));
const setS = (d, k, v) => d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
setS(db, KEY, 'true'); quiet(() => runMigrations(db));
check('a later manual ON survives the next start', get(db, KEY) === 'true');

console.log('\n2. _reconcileEnv bridge');
setS(db, KEY, 'false'); let e = H._reconcileEnv(db); check('OFF → no env var', !(ENV in e));
setS(db, KEY, 'true'); e = H._reconcileEnv(db); check("ON → NAME_VALUE_LABEL_FLAG === '1'", e[ENV] === '1');

console.log('\n3. engine shape + the shared sentinel');
const eng = fs.readFileSync(path.join(ROOT, 'python_backend', 'extraction', 'engine.py'), 'utf8');
const i = eng.indexOf('VALUE-EQUALS-LABEL guard (mig 213');
const block = eng.slice(i, eng.indexOf("# Supplier-scoped format first", i));
check('the env is read once, inside the Stage-4.5 guard', (eng.match(/os\.environ\.get\("NAME_VALUE_LABEL_FLAG"/g) || []).length === 1 && /os\.environ\.get\("NAME_VALUE_LABEL_FLAG", "0"\) != "0"/.test(block));
check('sits AFTER the mig-156 block (same loop, defers to an existing note)', eng.indexOf('NAME_ROLE_NONNAME_FLAG", "0") != "0"') < i && /not str\(data\.get\('validation_note'\) or ''\)\.strip\(\)/.test(block));
check('reuses the mig-156 +nonname_flag sentinel (trust.js unchanged)', /\+nonname_flag/.test(block) && typeof trust.isNonNameFlagRow === 'function'
      && trust.isNonNameFlagRow({ extraction_method: 'template_mapping+nonname_flag', validation_note: 'This reads as the label ‘Customer’, not a name — please check the value.' }) === true);
check('its note text differs from mig-156\'s (producers told apart) + a trace event', /This reads as the label/.test(block) && /self\._t\("name_value_label_flag"/.test(block) && !/This reads like/.test(block));
check('caps ≤69, exempts curated methods + accepted_names, keeps the value', /min\(data\.get\('confidence'\) or 0, 69\)/.test(block) && /_vl_curated/.test(block) && /self\._accept_norm\(val\) not in self\.accepted_names/.test(block) && /\*\*data,/.test(block));
const vq = fs.readFileSync(path.join(ROOT, 'python_backend', 'extraction', 'value_quality.py'), 'utf8');
check('the predicate is value_quality.value_is_own_label (pure; not keyword.value_is_caption)', /def value_is_own_label\(value, field_label=None, anchor_text=None\)/.test(vq) && /value_quality\.value_is_own_label\(str\(val\), _vl_label, _vl_anchor\)/.test(block));

console.log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} (${fails} bad)`);
process.exit(fails ? 1 : 0);
