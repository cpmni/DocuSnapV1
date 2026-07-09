#!/usr/bin/env node
'use strict';
/**
 * Title aliases for document types — the normaliser (validation rules), CRUD round-trip
 * (stored as JSON, read back as an ARRAY), and the migration idempotency.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_document_types_aliases.js
 */
const Database = require('better-sqlite3');
const doctypes = require('./document_types');
const { runMigrations } = require('../index');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE document_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, slug TEXT UNIQUE, built_in INTEGER DEFAULT 0,
      ref_field_key TEXT, date_field_key TEXT, sort_order INTEGER DEFAULT 100, enabled INTEGER DEFAULT 1,
      title_aliases TEXT
    );
    CREATE TABLE fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document_type_id INTEGER, key TEXT, label TEXT,
      type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, built_in INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1, confidence_threshold REAL, sort_order INTEGER DEFAULT 100,
      UNIQUE(document_type_id, key)
    );
  `);
  return db;
}
const aliasesOf = (db, name) => (doctypes.getAllWithFields(db).find(t => t.name === name) || {}).title_aliases;

// ── CRUD round-trip ───────────────────────────────────────────────────────────
console.log('CRUD round-trip (stored JSON -> read back as an ARRAY):');
{
  const db = makeDb();
  doctypes.addType(db, { name: 'Worksheet', title_aliases: ['Work Sheet', '  work sheet  ', '', 'Job Sheet'] });
  const a = aliasesOf(db, 'Worksheet');
  check('stored + read back as an array', Array.isArray(a));
  check('trimmed, empty dropped, case-insensitive de-duped -> [Work Sheet, Job Sheet]',
        JSON.stringify(a) === JSON.stringify(['Work Sheet', 'Job Sheet']));
  const raw = db.prepare("SELECT title_aliases FROM document_types WHERE name='Worksheet'").get().title_aliases;
  check('column holds a JSON STRING (not a JS array)', typeof raw === 'string' && raw.startsWith('['));

  doctypes.updateType(db, 1, { title_aliases: ['Site Report'] });
  check('updateType replaces the aliases', JSON.stringify(aliasesOf(db, 'Worksheet')) === JSON.stringify(['Site Report']));
  doctypes.updateType(db, 1, { title_aliases: [] });
  check('updateType([]) clears to NULL (byte-identical to a pre-feature row)',
        db.prepare('SELECT title_aliases FROM document_types WHERE id=1').get().title_aliases === null);
  check('cleared -> read back as []', JSON.stringify(aliasesOf(db, 'Worksheet')) === '[]');

  doctypes.addType(db, { name: 'Quote' });   // no aliases at all
  check('a type with NO aliases reads back as [] (back-compat)', JSON.stringify(aliasesOf(db, 'Quote')) === '[]');
  db.close();
}

// ── Normaliser rules (C1) ─────────────────────────────────────────────────────
console.log('\nNormaliser rules:');
{
  const db = makeDb();
  doctypes.addType(db, { name: 'Invoice' });
  const N = (input, name = 'Worksheet') => doctypes.normaliseTitleAliases(db, input, name);

  check('HARD ERROR when an alias equals ANOTHER type name',
        N(['Invoice']).error && /already a document type/i.test(N(['Invoice']).error));
  check('addType/updateType THROW on that collision', (() => {
    try { doctypes.addType(db, { name: 'Worksheet', title_aliases: ['Invoice'] }); return false; } catch { return true; }
  })());
  check('alias == THIS type name is silently dropped (redundant, no error)',
        N(['Worksheet', 'Work Sheet']).error === null && JSON.stringify(N(['Worksheet', 'Work Sheet']).aliases) === JSON.stringify(['Work Sheet']));
  check('drops < 3 letters/digits ("WS") with a notice',
        N(['WS']).aliases.length === 0 && N(['WS']).notices.length > 0);
  check('drops a purely-numeric alias ("2026")', N(['2026']).aliases.length === 0);
  check('drops an over-60-char alias', N(['x'.repeat(70)]).aliases.length === 0);
  check('WARNS (but keeps) a document-chrome word ("Order")',
        N(['Order']).aliases.length === 1 && N(['Order']).notices.length > 0);
  check('caps at 20 aliases', N(Array.from({ length: 30 }, (_, i) => `Alias Number ${i}`)).aliases.length === 20);
  check('accepts a comma/newline STRING too', JSON.stringify(N('Work Sheet, Job Sheet\nSite Report').aliases) === JSON.stringify(['Work Sheet', 'Job Sheet', 'Site Report']));
  db.close();
}

// ── Garbage tolerance + migration idempotency ─────────────────────────────────
console.log('\nGarbage tolerance + migration idempotency:');
{
  const db = makeDb();
  doctypes.addType(db, { name: 'Worksheet' });
  db.prepare("UPDATE document_types SET title_aliases='{not valid json' WHERE id=1").run();
  let ok = true; try { aliasesOf(db, 'Worksheet'); } catch { ok = false; }
  check('a garbage stored value reads back as [] (no throw)', ok && JSON.stringify(aliasesOf(db, 'Worksheet')) === '[]');
  db.close();
}
{
  const db = new Database(':memory:');
  runMigrations(db);
  const hasCol = () => db.prepare("PRAGMA table_info(document_types)").all().some(c => c.name === 'title_aliases');
  check('migration adds document_types.title_aliases', hasCol());
  let ok = true; try { runMigrations(db); } catch (e) { ok = false; console.log('    (second run threw: ' + e.message + ')'); }
  check('runMigrations is idempotent (no throw on second run)', ok && hasCol());
  db.close();
}

console.log(`\n${fails ? fails + ' FAILED' : 'All title-alias checks passed.'}`);
process.exit(fails ? 1 : 0);
