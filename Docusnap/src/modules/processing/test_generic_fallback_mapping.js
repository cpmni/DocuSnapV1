#!/usr/bin/env node
'use strict';

/**
 * src/modules/processing/test_generic_fallback_mapping.js
 * -------------------------------------------------------
 * Generic Document slice 2 pins (docs/designs/GENERIC_DOCTYPE_2026-07-18.md §3 + Oracle C1):
 * the fallback maps a NO-MATCH doc to the General Document type ONLY when detection
 * returned None AND the switch is on AND the preset exists+enabled (PIN 1); the reprocess
 * seam is DIRECTION-GUARDED (a typed doc whose reprocess detection returns None is never
 * dragged to generic; a detected type always wins); env GENERIC_FALLBACK=0 hard-kills.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_generic_fallback_mapping.js
 */

const path = require('path');
const Database = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'better-sqlite3'));
const { _genericFallbackId, _reprocessGenericAdopt } = require('./handler');

let fails = 0;
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${JSON.stringify(extra)}]` : ''}`);
  if (!cond) fails++;
};

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE document_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, slug TEXT UNIQUE,
                               ref_field_key TEXT, date_field_key TEXT, enabled INTEGER DEFAULT 1);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
`);

console.log('§1 import seam — _genericFallbackId');
check('switch OFF (default) ⇒ null', _genericFallbackId(db, null) === null);
db.prepare("INSERT INTO settings (key, value) VALUES ('generic_fallback_enabled','true')").run();
check('switch ON but type absent ⇒ null (existence-coupled)', _genericFallbackId(db, null) === null);
const gid = db.prepare("INSERT INTO document_types (name, slug) VALUES ('General Document','general_document')").run().lastInsertRowid;
check('switch ON + type present + detection None ⇒ generic id', _genericFallbackId(db, null) === gid);
check('PIN 1: a DETECTED type name always wins ⇒ null', _genericFallbackId(db, 'Invoice') === null);
db.prepare('UPDATE document_types SET enabled = 0 WHERE id = ?').run(gid);
check('type disabled ⇒ null', _genericFallbackId(db, null) === null);
db.prepare('UPDATE document_types SET enabled = 1 WHERE id = ?').run(gid);
process.env.GENERIC_FALLBACK = '0';
check('env GENERIC_FALLBACK=0 hard-kills despite the setting', _genericFallbackId(db, null) === null);
delete process.env.GENERIC_FALLBACK;
check('env cleared ⇒ maps again', _genericFallbackId(db, null) === gid);

console.log('§2 reprocess seam — _reprocessGenericAdopt (Oracle C1, both directions)');
check('NULL doc + reprocess detection None ⇒ adopts generic', _reprocessGenericAdopt(db, null, null) === gid);
check('DIRECTION GUARD: typed doc (priorTypeId=5) + detection None ⇒ NEVER dragged', _reprocessGenericAdopt(db, 5, null) === null);
check('NULL doc + a detected type on reprocess ⇒ the real type wins (null here — caller maps the name)', _reprocessGenericAdopt(db, null, 'Invoice') === null);
db.prepare("UPDATE settings SET value='false' WHERE key='generic_fallback_enabled'").run();
check('switch OFF ⇒ reprocess adopts nothing', _reprocessGenericAdopt(db, null, null) === null);

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
