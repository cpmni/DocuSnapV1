#!/usr/bin/env node
'use strict';
// Unit test for services/backupService.js — encrypted round-trip, password/tamper
// rejection, licensing-key exclusion, settings MERGE vs table REPLACE, FK integrity.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/services/test_backupservice.js

const Database = require('better-sqlite3');
const { createBackup, readBackup, applyBackup } = require('./backupService');

let fail = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fail++; };

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE document_types(id INTEGER PRIMARY KEY, name TEXT, slug TEXT);
  CREATE TABLE fields(id INTEGER PRIMARY KEY, document_type_id INTEGER, key TEXT,
    FOREIGN KEY(document_type_id) REFERENCES document_types(id));
`);
db.pragma('foreign_keys = ON');
db.prepare("INSERT INTO settings VALUES('output_folder','C:/Out')").run();
db.prepare("INSERT INTO settings VALUES('theme','dark')").run();
db.prepare("INSERT INTO settings VALUES('license_time_hwm','999')").run();   // must be EXCLUDED
db.prepare("INSERT INTO document_types VALUES(1,'Invoice','invoice')").run();
db.prepare("INSERT INTO fields VALUES(10,1,'invoice_number')").run();

const buf = createBackup(db, 'pw123', { appVersion: '2.0.0' });
check('backup is a Buffer', Buffer.isBuffer(buf));
const asText = buf.toString('latin1');
check('encrypted — plaintext values absent', !asText.includes('output_folder') && !asText.includes('invoice_number') && !asText.includes('Invoice'));

const r = readBackup(buf, 'pw123');
check('readBackup returns meta + summary', r.meta.app_version === '2.0.0' && r.summary.document_types === 1);
check('licensing setting excluded from backup', r.summary.settings === 2);   // output_folder + theme, NOT license_time_hwm

// Device fingerprint round-trip (drives the cross-machine import gate in settings/handler).
const fpBuf = createBackup(db, 'pw123', { appVersion: '2.0.0', deviceFp: 'FP-ABC' });
check('device_fp embedded + surfaced in meta', readBackup(fpBuf, 'pw123').meta.device_fp === 'FP-ABC');
check('device_fp empty when not provided', r.meta.device_fp === '');

const reject = (label, fn) => { let threw = false; try { fn(); } catch { threw = true; } check(label, threw); };
reject('wrong password rejected', () => readBackup(buf, 'nope'));
reject('empty password rejected', () => readBackup(buf, ''));
reject('non-backup buffer rejected', () => readBackup(Buffer.from('hello world not a backup'), 'pw123'));
const tampered = Buffer.from(buf); tampered[tampered.length - 1] ^= 0xff;
reject('tampered file rejected', () => readBackup(tampered, 'pw123'));

// Mutate the DB, then restore and verify replace/merge + FK integrity.
db.prepare('DELETE FROM fields').run();
db.prepare('DELETE FROM document_types').run();
db.prepare("UPDATE settings SET value='light' WHERE key='theme'").run();
db.prepare("DELETE FROM settings WHERE key='output_folder'").run();

applyBackup(db, readBackup(buf, 'pw123').payload);
check('doc type REPLACED back', (db.prepare('SELECT name FROM document_types WHERE id=1').get() || {}).name === 'Invoice');
check('field restored with FK intact', (db.prepare('SELECT key FROM fields WHERE id=10').get() || {}).key === 'invoice_number');
check('deleted setting merged back', (db.prepare("SELECT value FROM settings WHERE key='output_folder'").get() || {}).value === 'C:/Out');
check('changed setting upserted', (db.prepare("SELECT value FROM settings WHERE key='theme'").get() || {}).value === 'dark');
check('licensing setting untouched by restore', (db.prepare("SELECT value FROM settings WHERE key='license_time_hwm'").get() || {}).value === '999');

// Harder: restore AGAIN without pre-clearing, with FK enforcement ON. applyBackup
// must DELETE FROM document_types while fields still reference it — only works if
// defer_foreign_keys defers the check to commit. This is the real reinstall case
// (a freshly-seeded DB already has built-in types + fields).
db.pragma('foreign_keys = ON');
let reThrew = false;
try { applyBackup(db, readBackup(buf, 'pw123').payload); }
catch (e) { reThrew = true; console.log('   (restore-over-existing error: ' + e.message + ')'); }
check('restore over existing related rows (deferred FK) succeeds', !reThrew &&
  (db.prepare('SELECT key FROM fields WHERE id=10').get() || {}).key === 'invoice_number');

// ── M5: an EMPTY-array learned table must NOT wipe the target (fresh-install backup case) ──
db.exec(`CREATE TABLE supplier_hints(id INTEGER PRIMARY KEY, supplier_name TEXT, field_key TEXT, hint_value TEXT);`);
db.prepare("INSERT INTO supplier_hints VALUES(1,'Acme','invoice_number','INV-1')").run();
db.prepare("INSERT INTO supplier_hints VALUES(2,'Acme','po_number','PO-2')").run();
// (a) empty array ⇒ "nothing to import", learned rows PRESERVED (was: silently wiped).
applyBackup(db, { tables: { supplier_hints: [] } });
check('M5: an empty-array learned table is NOT wiped', db.prepare('SELECT COUNT(*) c FROM supplier_hints').get().c === 2);
// (b) absent table ⇒ left intact (the pre-existing baseline behaviour, must still hold).
applyBackup(db, { tables: {} });
check('M5: an absent learned table is left intact', db.prepare('SELECT COUNT(*) c FROM supplier_hints').get().c === 2);
// (c) a NON-empty table still fully REPLACES — the guard must not disable a real restore.
applyBackup(db, { tables: { supplier_hints: [{ id: 5, supplier_name: 'Beta', field_key: 'ref', hint_value: 'R-9' }] } });
const shRows = db.prepare('SELECT supplier_name FROM supplier_hints').all();
check('M5: a non-empty learned table still fully REPLACES', shRows.length === 1 && shRows[0].supplier_name === 'Beta');

db.close();
console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll backupService checks passed.');
process.exit(fail ? 1 : 0);
