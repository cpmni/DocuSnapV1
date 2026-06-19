#!/usr/bin/env node
'use strict';
// Unit test for services/entitlementService.js — default-deny + setting-driven.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/services/test_entitlement.js

const Database = require('better-sqlite3');
const { checkClientEntitlement, SETTING_KEY } = require('./entitlementService');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

// No settings table at all → graceful default-deny.
const bare = new Database(':memory:');
check('no settings table -> not entitled (graceful)', checkClientEntitlement(bare).entitled === false);
bare.close();

const db = new Database(':memory:');
db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
const set = (v) => db.prepare(`INSERT INTO settings (key,value) VALUES (?,?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(SETTING_KEY, v);

check('unset -> not entitled (default-deny)', checkClientEntitlement(db).entitled === false);
set('false'); check("'false' -> not entitled", checkClientEntitlement(db).entitled === false);
set('true');  check("'true' -> entitled", checkClientEntitlement(db).entitled === true);
set('1');     check("'1' -> entitled", checkClientEntitlement(db).entitled === true);
check('feature name surfaced', checkClientEntitlement(db).feature === 'detached_client');
db.close();

console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll entitlement checks passed.');
process.exit(fail ? 1 : 0);
