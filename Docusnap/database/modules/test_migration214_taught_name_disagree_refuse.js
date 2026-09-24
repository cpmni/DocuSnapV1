#!/usr/bin/env node
'use strict';
/**
 * test_migration214_taught_name_disagree_refuse.js — mig 214 seeds `taught_name_disagree_refuse` OFF (2026-09-24; Chris
 * 09-23 teach round card 1; gary Slice 2 → Oracle SIGN-OFF-W/COND C1-C7). Pins: stamped, seeded 'false', in
 * TEST_SWITCH_KEYS, no force-ON twin, a later manual ON survives; JS-ONLY (no _reconcileEnv line — the Python child never
 * reads it); the reader honours env '1'/'0' over the setting; the predicate is exported.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration214_taught_name_disagree_refuse.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
const trust = require(path.join(ROOT, 'database', 'modules', 'trust.js'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };
const KEY = 'taught_name_disagree_refuse', ENV = 'TAUGHT_NAME_DISAGREE_REFUSE';

console.log('\n1. mig 214 seed');
const db = new Database(':memory:');
const logs = []; { const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db); console.log = o; }
const get = (d, k) => { const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 214 stamped', applied.has(214));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 214 applied/.test(l) && /seeded OFF/.test(l)));
check(`a fresh install has ${KEY} === 'true' (GRADUATED by the 215 batch, 2026-09-24 evening; the mig-214 seed 'false' is UPSERT-flipped)`, get(db, KEY) === 'true');
check(`${KEY} is DELISTED from TEST_SWITCH_KEYS (graduated — the mig-137 reset can never un-promote it)`, !TEST_SWITCH_KEYS.includes(KEY));
check('the two HARD deps are ON on a fresh install', get(db, 'trust_role_disagreement_refuse') === 'true' && get(db, 'role_disagree_refuse_at100') === 'true');
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('single-key INSERT OR IGNORE seed of false', new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(src));
check('the ONLY force-ON is the labelled @DEFAULT_FLIP 215 batch (no unlabelled twin)', (src.match(new RegExp(`VALUES \\('${KEY}', 'true'\\)`, 'g')) || []).length === 1 && /@DEFAULT_FLIP 215/.test(src));
const setS = (d, k, v) => d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
setS(db, KEY, 'true'); quiet(() => runMigrations(db));
check('a later manual ON survives the next start', get(db, KEY) === 'true');

console.log('\n2. JS-only: reader + no Python env mirror');
const H = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('handler.js has NO _reconcileEnv line for it (the Python child never reads it)', !H.includes(ENV) && !H.includes(KEY));
setS(db, KEY, 'false'); check('OFF → reader false', trust._taughtNameDisagreeEnabled(db) === false);
setS(db, KEY, 'true');  check('ON → reader true', trust._taughtNameDisagreeEnabled(db) === true);
process.env[ENV] = '0'; check("env '0' beats a 'true' setting", trust._taughtNameDisagreeEnabled(db) === false);
process.env[ENV] = '1'; setS(db, KEY, 'false'); check("env '1' beats a 'false' setting (the harness lever)", trust._taughtNameDisagreeEnabled(db) === true);
delete process.env[ENV];

console.log('\n3. shape');
const T = fs.readFileSync(path.join(ROOT, 'database', 'modules', 'trust.js'), 'utf8');
check('ONE row predicate used at BOTH sites', (T.match(/_disagreeRefusesRow\(e, _disagreeCtx\)/g) || []).length === 2);
check('the field-rows query now carries label (isNameLikeField(key, label) parity with the census)', /SELECT key, type, required, label FROM fields WHERE document_type_id = \?/.test(T));
check('the at-100 branch keeps its name + return shape (Oracle C4)', /if \(opts\.roleDisagreeOnly\) \{[\s\S]{0,400}reason: 'role-disagree-only'/.test(T));
check('exports the predicate + helpers', typeof trust._disagreeRefusesRow === 'function' && typeof trust._nameWitnessTokens === 'function' && typeof trust._isNameOnlyKey === 'function');

console.log(`\n${fails === 0 ? 'ALL OK' : 'FAILURES: ' + fails} (${fails} bad)`);
process.exit(fails ? 1 : 0);
