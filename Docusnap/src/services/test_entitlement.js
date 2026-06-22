#!/usr/bin/env node
'use strict';
// Unit test for services/entitlementService.js — default-deny + setting-driven.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/services/test_entitlement.js

const Database = require('better-sqlite3');
const { checkClientEntitlement, SEARCH_SEATS_KEY, WORKFLOW_SEATS_KEY, SEATS_KEY } = require('./entitlementService');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

// No settings table at all → graceful default-deny.
const bare = new Database(':memory:');
check('no settings table -> not entitled (graceful)', checkClientEntitlement(bare).entitled === false);
bare.close();

const db = new Database(':memory:');
db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
const set = (k, v) => db.prepare(`INSERT INTO settings (key,value) VALUES (?,?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(k, v);

// Entitlement is now SEAT-COUNT driven (the backend caches per-feature counts on validate).
check('unset -> not entitled (default-deny)', checkClientEntitlement(db).entitled === false);
set(SEARCH_SEATS_KEY, '0'); check('search 0 -> not entitled', checkClientEntitlement(db).entitled === false);
set(SEARCH_SEATS_KEY, '2');
const e2 = checkClientEntitlement(db);
check('search 2 -> entitled; top-level seats mirror search', e2.entitled === true && e2.seats === 2 && e2.search.entitled === true && e2.search.seats === 2);
check('workflow off until granted', checkClientEntitlement(db).workflow.entitled === false);
set(WORKFLOW_SEATS_KEY, '1');
const e3 = checkClientEntitlement(db);
check('workflow 1 -> workflow entitled, seats 1', e3.workflow.entitled === true && e3.workflow.seats === 1);
check('feature name surfaced', checkClientEntitlement(db).feature === 'detached_client');
db.close();

// Legacy fallback: detached_client_seats alone still licenses SEARCH (cheap back-compat).
const dbL = new Database(':memory:');
dbL.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
dbL.prepare(`INSERT INTO settings (key,value) VALUES (?, '3')`).run(SEATS_KEY);
const eL = checkClientEntitlement(dbL);
check('legacy detached_client_seats=3 -> search entitled, seats 3', eL.search.entitled === true && eL.search.seats === 3);
dbL.close();

console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll entitlement checks passed.');
process.exit(fail ? 1 : 0);
