#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_licensing_migration.js
 * --------------------------------------------
 * Loop 4 / Phase 0 — verifies migration 16 (licensing scaffolding):
 *   1. Applies on a FRESH DB: device_registrations + license_tokens created,
 *      migrations row 16 present.
 *   2. Re-run is a NO-OP: second runMigrations() does not throw and does not
 *      duplicate the version-16 row.
 *   3. Applies on an EXISTING (older) DB: simulate a DB that predates migration
 *      16 (drop the tables + remove the v16 row), re-run, tables are recreated.
 *
 * Run under Electron-as-Node (better-sqlite3 is built for Electron's ABI):
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_licensing_migration.js
 */

const Database = require('better-sqlite3');
const { runMigrations } = require('../index');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }
let fail = 0;
const tableExists = (db, t) =>
  !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
const v16Count = (db) =>
  db.prepare('SELECT COUNT(*) c FROM migrations WHERE version=16').get().c;

// 1. Fresh DB
const db = new Database(':memory:');
runMigrations(db);
if (!check('fresh: device_registrations exists', tableExists(db, 'device_registrations'))) fail++;
if (!check('fresh: license_tokens exists',       tableExists(db, 'license_tokens'))) fail++;
if (!check('fresh: migrations has version 16',    v16Count(db) === 1)) fail++;

// 2. Re-run is a no-op
let threw = false;
try { runMigrations(db); } catch (e) { threw = true; console.log('   threw:', e.message); }
if (!check('re-run: did not throw',               !threw)) fail++;
if (!check('re-run: still exactly one v16 row',    v16Count(db) === 1)) fail++;
if (!check('re-run: tables still present',          tableExists(db, 'device_registrations') && tableExists(db, 'license_tokens'))) fail++;

// 3. Existing/older DB that predates migration 16
db.exec('DROP TABLE license_tokens');
db.exec('DROP TABLE device_registrations');
db.prepare('DELETE FROM migrations WHERE version=16').run();
if (!check('older DB: tables removed pre-run',     !tableExists(db, 'device_registrations') && v16Count(db) === 0)) fail++;
runMigrations(db);
if (!check('older DB: tables recreated',            tableExists(db, 'device_registrations') && tableExists(db, 'license_tokens'))) fail++;
if (!check('older DB: v16 row re-applied',          v16Count(db) === 1)) fail++;

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
