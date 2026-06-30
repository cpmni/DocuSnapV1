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
check('no licence -> workflow off too', checkClientEntitlement(db).workflow.entitled === false);
set(SEARCH_SEATS_KEY, '2');
const e2 = checkClientEntitlement(db);
check('search 2 -> entitled; top-level seats mirror search', e2.entitled === true && e2.seats === 2 && e2.search.entitled === true && e2.search.seats === 2);
// MASTER SWITCH OFF (pre-release): workflow is hidden everywhere regardless of seats — entitled
// stays FALSE even with a client/workflow licence. The bundling logic is preserved behind the
// WORKFLOW_FEATURE_ENABLED flag; re-enable the flag (and these asserts) when workflow ships.
check('workflow master-disabled: a client licence does NOT grant workflow', e2.workflow.entitled === false && e2.workflow.disabled === true);
set(WORKFLOW_SEATS_KEY, '1');
const e3 = checkClientEntitlement(db);
check('workflow master-disabled: explicit workflow seats still do not grant it', e3.workflow.entitled === false);
check('feature name surfaced', checkClientEntitlement(db).feature === 'detached_client');
db.close();

// P0 self-grant fix: the local detached_client_seats key is NO LONGER a source — a
// hand-edited local seat count cannot grant entitlement (only the backend-cached
// detached_search_seats does).
const dbL = new Database(':memory:');
dbL.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
dbL.prepare(`INSERT INTO settings (key,value) VALUES (?, '3')`).run(SEATS_KEY);
const eL = checkClientEntitlement(dbL);
check('local detached_client_seats=3 -> NOT entitled (no local fallback)', eL.search.entitled === false && eL.search.seats === 0);
dbL.close();

console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll entitlement checks passed.');
process.exit(fail ? 1 : 0);
