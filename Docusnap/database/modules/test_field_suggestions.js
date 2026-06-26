/**
 * test_field_suggestions.js — documents.getFieldValueSuggestions()
 *
 * The Review type-ahead source: distinct values CONFIRMED for the same field on the
 * same document type, excluding the current doc, case-insensitive de-duped.
 *
 * Uses a MINIMAL in-memory schema (just the two columns the query needs) so it does
 * not depend on the full migration chain.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 npx electron database/modules/test_field_suggestions.js
 */
const Database = require('better-sqlite3');
const documents = require('./documents');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE documents   (id INTEGER PRIMARY KEY, document_type_id INTEGER, status TEXT);
  CREATE TABLE extractions (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT,
                            raw_value TEXT, display_value TEXT);
`);
const addDoc = (id, typeId, status) =>
  db.prepare('INSERT INTO documents (id, document_type_id, status) VALUES (?,?,?)').run(id, typeId, status);
const addExt = (docId, key, disp, raw) =>
  db.prepare('INSERT INTO extractions (document_id, field_key, display_value, raw_value) VALUES (?,?,?,?)')
    .run(docId, key, disp, raw);

// Type 1 (invoice) — confirmed history for customer_name.
addDoc(1, 1, 'confirmed'); addExt(1, 'customer_name', 'Beaumont', 'Beaumont');
addDoc(2, 1, 'confirmed'); addExt(2, 'customer_name', 'Beautiful', 'Beautiful');
addDoc(3, 1, 'confirmed'); addExt(3, 'customer_name', 'beaumont', 'beaumont');   // case dup
addDoc(4, 1, 'confirmed'); addExt(4, 'customer_name', '', 'Carter');             // coalesce raw
addDoc(5, 1, 'confirmed'); addExt(5, 'customer_name', '   ', '   ');             // blank -> dropped
// Type 2 (po) — must NOT bleed into type 1 suggestions.
addDoc(6, 2, 'confirmed'); addExt(6, 'customer_name', 'OtherType Co', 'OtherType Co');
// Unconfirmed type-1 doc — must NOT contribute.
addDoc(7, 1, 'needs_review'); addExt(7, 'customer_name', 'NotConfirmed', 'NotConfirmed');
// The CURRENT doc being reviewed (type 1) — excluded from its own suggestions.
addDoc(10, 1, 'needs_review'); addExt(10, 'customer_name', 'Self', 'Self');

const out = documents.getFieldValueSuggestions(db, 10, 'customer_name');
console.log('suggestions:', out);

check('returns an array', Array.isArray(out));
check('includes Beaumont', out.includes('Beaumont'));
check('includes Beautiful', out.includes('Beautiful'));
check('includes Carter (coalesced from raw_value)', out.includes('Carter'));
check('excludes other doc type', !out.includes('OtherType Co'));
check('excludes unconfirmed docs', !out.includes('NotConfirmed'));
check('excludes the current doc value (Self)', !out.includes('Self'));
check('drops blank values', !out.some(v => !v.trim()));
check('case-insensitive de-dup (Beaumont once, total 3)', out.length === 3);

// Guard rails.
check('empty fieldKey -> []', documents.getFieldValueSuggestions(db, 10, '').length === 0);
check('null docId -> []', documents.getFieldValueSuggestions(db, null, 'customer_name').length === 0);
check('unknown docId -> []', documents.getFieldValueSuggestions(db, 99999, 'customer_name').length === 0);

db.close();
console.log(fail ? `\n${fail} FAILED` : '\nAll field-suggestion checks passed');
process.exit(fail ? 1 : 0);
