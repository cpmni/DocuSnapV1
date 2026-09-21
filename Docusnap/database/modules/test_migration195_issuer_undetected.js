#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_migration195_issuer_undetected.js — mig 195 seeds `issuer_undetected_blank` OFF (DARK),
 * and the JS side of the issuer-implausibility TWIN (reggie+gary -> Oracle SIGN-OFF-W/COND 2026-09-21). The gate
 * declares a NON-NAME, unsupported cold Document-Issuer read UNDETECTED (blank + review note) instead of
 * committing a garbage heading. This pin covers the migration (DARK seed, INSERT OR IGNORE, no @DEFAULT_FLIP,
 * in TEST_SWITCH_KEYS, release gate clean, env-wired) AND the JS predicate `issuerReadLooksImplausible` over the
 * SHARED vector set (python_backend/tests/issuer_implausible_vectors.json) — the SAME file the Python twin
 * (keyword.issuer_read_looks_implausible) is pinned against, so the two predicates cannot drift (Oracle C2).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration195_issuer_undetected.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
const { issuerReadLooksImplausible } = require(path.join(ROOT, 'database', 'modules', 'learning'));
const { scan } = require(path.join(ROOT, 'scripts', 'check-release-migrations'));

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

// ── the migration ────────────────────────────────────────────────────────────────────────────────
const db = new Database(':memory:');
const logs = []; const origLog = console.log; console.log = (m) => { logs.push(String(m)); };
runMigrations(db);
console.log = origLog;
const get = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));

console.log('1. mig 195 — DARK seed');
check('migration 195 stamped', applied.has(195));
check("issuer_undetected_blank seeded 'false' (DARK)", get('issuer_undetected_blank') === 'false');
check('the seed line says seeded OFF', logs.some(l => /migration 195 applied/.test(l) && /seeded OFF/.test(l)));
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('mig 195 is an INSERT OR IGNORE seed of false (not a UPSERT)',
  /INSERT OR IGNORE INTO settings \(key, value\) VALUES \('issuer_undetected_blank', 'false'\)/.test(src));
check('mig 195 has NO @DEFAULT_FLIP label (it is DARK, not a customer default)', !/@DEFAULT_FLIP 195/.test(src));
check('issuer_undetected_blank is IN TEST_SWITCH_KEYS (armable in a test build, disarmed in release)',
  TEST_SWITCH_KEYS.includes('issuer_undetected_blank'));
const hits = scan({ indexSrc: src, otherFiles: [], pkgJson: {} }).hits.filter(h => /195/.test(String(h.detail)) || String(h.detail).includes('issuer_undetected_blank'));
check('the release gate raises NO hit on migration 195', hits.length === 0);
const handler = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('handler wires the setting to env.ISSUER_UNDETECTED_BLANK',
  /getSetting\(db, 'issuer_undetected_blank'[\s\S]{0,80}env\.ISSUER_UNDETECTED_BLANK = '1'/.test(handler));
// a deliberate 'true' survives (mig 195 is a one-shot INSERT-OR-IGNORE, not a sweep)
db.prepare("UPDATE settings SET value = 'true' WHERE key = 'issuer_undetected_blank'").run();
console.log = () => {}; runMigrations(db); console.log = origLog;
check("a deliberate issuer_undetected_blank='true' survives the next start", get('issuer_undetected_blank') === 'true');

// ── the JS predicate over the SHARED twin vectors (must match the Python side byte-for-byte) ──────
console.log('\n2. issuerReadLooksImplausible over the shared twin vectors (JS half of the lockstep)');
const VEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'python_backend', 'tests', 'issuer_implausible_vectors.json'), 'utf8'));
for (const v of [...VEC.must_blank, ...VEC.accepted_tradeoff_blank]) check(`blank: ${JSON.stringify(v)}`, issuerReadLooksImplausible(v) === true);
for (const v of VEC.must_stay) check(`stay:  ${JSON.stringify(v)}`, issuerReadLooksImplausible(v) === false);

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
