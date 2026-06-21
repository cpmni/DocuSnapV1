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

db.close();
console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll backupService checks passed.');
process.exit(fail ? 1 : 0);
