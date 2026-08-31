#!/usr/bin/env node
'use strict';

/**
 * src/modules/print/test_print.js
 * -------------------------------
 * Print-Slice 1 kill-switch gate (docs/designs/WORKFLOW_SUITE_2026-07-18.md §7): the
 * control-test that proves printing is OFF by default (⇒ no Review print button, the
 * print-document IPC returns 'disabled'), with an env override for the control phase.
 * The actual driver-dialog spool is a MANUAL verify (can't unit-test a physical printer);
 * the security predicate (canAccessDocument) is covered by test_access_service.js, and the
 * IPC takes only {docId, source} — never a path — resolving the file server-side via
 * documents.resolveFilePath.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/print/test_print.js
 */

const Database = require('better-sqlite3');
const printHandler = require('./handler');

let fails = 0;
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`);
  if (!cond) fails++;
};

function makeDb() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);");
  return db;
}
const setSetting = (db, k, v) => db.prepare(
  "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, v);

const enabled = printHandler._printingEnabled;

console.log('§1 default OFF (the control-test gate — OFF ⇒ no print surface)');
{
  const db = makeDb();
  delete process.env.PRINTING_ENABLED;
  check('unset setting ⇒ OFF', enabled(db) === false);
  setSetting(db, 'printing_enabled', 'false');
  check("setting 'false' ⇒ OFF", enabled(db) === false);
}

console.log('§2 setting turns it on');
{
  const db = makeDb();
  delete process.env.PRINTING_ENABLED;
  setSetting(db, 'printing_enabled', 'true');
  check("setting 'true' ⇒ ON", enabled(db) === true);
}

console.log('§3 env override (control phase) wins over the setting, both directions');
{
  const db = makeDb();
  setSetting(db, 'printing_enabled', 'false');
  for (const v of ['1', 'true', 'on']) { process.env.PRINTING_ENABLED = v; check(`env '${v}' forces ON despite setting off`, enabled(db) === true); }
  setSetting(db, 'printing_enabled', 'true');
  for (const v of ['0', 'false', 'off']) { process.env.PRINTING_ENABLED = v; check(`env '${v}' forces OFF despite setting on`, enabled(db) === false); }
  delete process.env.PRINTING_ENABLED;
  check('env cleared ⇒ setting governs again (ON)', enabled(db) === true);
}

console.log('§4 module surface');
check('register is a function', typeof printHandler.register === 'function');

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
