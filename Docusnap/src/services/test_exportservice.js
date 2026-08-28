'use strict';
/**
 * test_exportservice.js
 * Pins the data-export core (src/services/exportService.js): the EAV→wide pivot
 * (one row per doc, human-answer-wins), CSV (BOM, formula-injection neutralised
 * BEFORE quoting, truncation marker), JSON (list→array, truncation, no BOM), the
 * xlsx delegate, and the audit filter summary.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron src/services/test_exportservice.js
 */
const path = require('path');
const Database = require(path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'));
const xp = require('./exportService');

let FAILS = 0;
const check = (label, cond) => { if (!cond) FAILS++; console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); };

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT, ref_field_key TEXT, date_field_key TEXT);
  CREATE TABLE documents (id INTEGER PRIMARY KEY, status TEXT, supplier_name TEXT, doc_date TEXT,
    reference_number TEXT, original_filename TEXT, folder_path TEXT, overall_confidence INTEGER,
    confirmed_at TEXT, document_type_id INTEGER);
  CREATE TABLE extractions (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT, raw_value TEXT, display_value TEXT);
  CREATE TABLE corrections (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT, corrected_value TEXT);
`);
db.prepare(`INSERT INTO document_types VALUES (1,'Invoice','invoice','invoice_number','invoice_date')`).run();
const doc = (id, status, sup, ref, when) => db.prepare(
  `INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,1)`).run(id, status, sup, '01-06-2026', ref, `f${id}.pdf`, `C:/Filing/${sup}`, 90, when);
const ext = (docId, k, v) => db.prepare(`INSERT INTO extractions (document_id,field_key,raw_value,display_value) VALUES (?,?,?,?)`).run(docId, k, v, v);
const corr = (docId, k, v) => db.prepare(`INSERT INTO corrections (document_id,field_key,corrected_value) VALUES (?,?,?)`).run(docId, k, v);

doc(1, 'confirmed', 'Acme, Ltd', 'INV-001', '2026-06-10T09:00:00Z');
ext(1, 'total_amount', '90'); corr(1, 'total_amount', '100.00');           // human answer wins
ext(1, 'serial_numbers', 'SN1; SN2; SN3');                                  // list-type field
ext(1, 'note', '=SUM(A1)+2');                                              // formula-injection value
doc(2, 'confirmed', 'Beta Co', 'INV-002', '2026-06-11T09:00:00Z');
ext(2, 'total_amount', '-50.00');                                          // negative number (must NOT be neutralised)
doc(3, 'needs_review', 'Acme, Ltd', 'INV-003', '2026-06-12T09:00:00Z');    // excluded unless includeNeedsReview

const FIELDS = [
  { key: 'total_amount', label: 'Total', type: 'money' },
  { key: 'serial_numbers', label: 'Serials', type: 'list' },
  { key: 'note', label: 'Note', type: 'text' },
];
const SEL = { metaKeys: ['_supplier', '_reference'], fields: FIELDS };

console.log('gather — pivot + filters:');
let g = xp.gather(db, {}, SEL);
check('2 confirmed docs (needs_review excluded)', g.count === 2 && g.rows.length === 2);
check('columns = 2 meta + 3 fields', g.columns.length === 5);
const r1 = g.rows.find(r => r._reference === 'INV-001');
check('human correction wins (total 100.00, not 90)', r1.total_amount === '100.00');
check('list field carries the joined string', r1.serial_numbers === 'SN1; SN2; SN3');
check('supplier meta column populated', r1._supplier === 'Acme, Ltd');
check('supplier filter narrows to 1', xp.gather(db, { suppliers: ['Beta Co'] }, SEL).count === 1);
check('supplier filter is case-insensitive', xp.gather(db, { suppliers: ['beta co'] }, SEL).count === 1);
check('type filter honoured', xp.gather(db, { typeSlugs: ['invoice'] }, SEL).count === 2);
check('bogus type → 0', xp.gather(db, { typeSlugs: ['nope'] }, SEL).count === 0);
check('includeNeedsReview → 3', xp.gather(db, { includeNeedsReview: true }, SEL).count === 3);

console.log('_csvCell — formula neutralise BEFORE quote, numbers exempt:');
check('=formula → leading apostrophe', xp._csvCell('=SUM(1)') === "'=SUM(1)");
check('+formula → apostrophe', xp._csvCell('+1') === "'+1");
check('@formula → apostrophe', xp._csvCell('@x') === "'@x");
check('-text → apostrophe', xp._csvCell('-cmd') === "'-cmd");
check('negative number NOT touched', xp._csvCell('-50.00') === '-50.00');
check('plain number NOT touched', xp._csvCell('1234') === '1234');
check('=formula WITH comma: prefixed THEN quoted', xp._csvCell('=1,2') === '"\'=1,2"');
check('comma value quoted', xp._csvCell('Acme, Ltd') === '"Acme, Ltd"');
check('quote value doubled', xp._csvCell('a"b') === '"a""b"');

console.log('toCsv:');
const csv = xp.toCsv(g.columns, g.rows);
check('starts with UTF-8 BOM', csv.charCodeAt(0) === 0xFEFF);
check('CRLF line breaks', csv.includes('\r\n'));
check('header has labels', csv.includes('Total') && csv.includes('Serials'));
check('formula value neutralised in body', csv.includes("'=SUM(A1)+2"));
check('negative amount left intact', csv.includes('-50.00') && !csv.includes("'-50.00"));

console.log('toJson:');
const json = JSON.parse(xp.toJson(g.columns, g.rows));
check('no BOM (valid JSON parse)', Array.isArray(json));
const j1 = json.find(o => o.Total === '100.00');
check('list field is a real array', Array.isArray(j1.Serials) && j1.Serials.length === 3 && j1.Serials[0] === 'SN1');

console.log('truncation markers (cap via sel.limit):');
const gt = xp.gather(db, { includeNeedsReview: true }, { ...SEL, limit: 1 });
check('gather reports true total + truncated', gt.count === 3 && gt.truncated === true && gt.rows.length === 1);
const trunc = { exported: gt.rows.length, total: gt.count };
check('CSV carries a # TRUNCATED note', xp.toCsv(gt.columns, gt.rows, trunc).includes('# TRUNCATED'));
const jt = JSON.parse(xp.toJson(gt.columns, gt.rows, trunc));
check('JSON carries a _truncated marker object', jt[jt.length - 1]._truncated === true && jt[jt.length - 1]._total === 3);

console.log('toXlsx delegate:');
const xbuf = xp.toXlsx(g.columns, g.rows);
check('returns a Buffer with PK signature', Buffer.isBuffer(xbuf) && xbuf.readUInt32LE(0) === 0x04034b50);

console.log('filterSummary (audit — counts only, never sender values):');
const fs1 = xp.filterSummary({ suppliers: ['Acme, Ltd', 'Beta Co'], typeSlugs: ['invoice'], includeNeedsReview: true, filedFrom: '2026-01-01' });
check('names counts not values', fs1.includes('2 sender(s)') && fs1.includes('1 type(s)') && !fs1.includes('Acme'));
check('all senders / all types when unfiltered', xp.filterSummary({}) === 'all senders, all types');
check('filterSummary names a doc-date range', xp.filterSummary({ docFrom: '2026-01-01' }).includes('doc-date'));

console.log('document-date range (doc_date DD-MM-YYYY → sortable YYYY-MM-DD):');
check('docFrom on/after their date includes both June docs', xp.gather(db, { docFrom: '2026-06-01' }, SEL).count === 2);
check('docTo before their date → 0', xp.gather(db, { docTo: '2026-05-31' }, SEL).count === 0);
check('same-day range is inclusive', xp.gather(db, { docFrom: '2026-06-01', docTo: '2026-06-01' }, SEL).count === 2);
// a confirmed doc with an unparseable/empty doc_date participates normally, but is excluded the
// moment a doc-date RANGE is set (it has no known document date to fall in the range).
db.prepare(`INSERT INTO documents VALUES (4,'confirmed','Acme, Ltd','','INV-004','f4.pdf','C:/Filing/x',90,'2026-06-13T09:00:00Z',1)`).run();
check('undated confirmed doc counts with NO doc-date filter', xp.gather(db, {}, SEL).count === 3);
check('undated confirmed doc EXCLUDED when a doc-date range is set', xp.gather(db, { docFrom: '2026-06-01' }, SEL).count === 2);
check('filed-date range still works independently', xp.gather(db, { filedFrom: '2026-06-13' }, SEL).count === 1);

console.log('exported dates follow Settings → "Date format (region)" (region_date_order):');
check('_fmtDate dmy → DD/MM/YYYY', xp._fmtDate('01-06-2026', 'ddmmyyyy', 'dmy') === '01/06/2026');
check('_fmtDate mdy → MM/DD/YYYY', xp._fmtDate('01-06-2026', 'ddmmyyyy', 'mdy') === '06/01/2026');
check('_fmtDate ymd → ISO (database-friendly)', xp._fmtDate('01-06-2026', 'ddmmyyyy', 'ymd') === '2026-06-01');
check('_fmtDate iso timestamp → chosen order', xp._fmtDate('2026-06-13T09:00:00Z', 'iso', 'dmy') === '13/06/2026');
check('_fmtDate empty stays empty', xp._fmtDate('', 'ddmmyyyy', 'dmy') === '');
check('_fmtDate non-date left unchanged', xp._fmtDate('N/A', 'ddmmyyyy', 'dmy') === 'N/A');
const dm = xp.gather(db, {}, { metaKeys: ['_reference', '_date', '_filed_at'], fields: [], dateOrder: 'mdy' }).rows.find(r => r._reference === 'INV-001');
check('gather formats doc_date per order (mdy)', dm._date === '06/01/2026');
check('gather formats confirmed_at per order (mdy)', dm._filed_at === '06/10/2026');
const dy = xp.gather(db, {}, { metaKeys: ['_reference', '_date'], fields: [], dateOrder: 'ymd' }).rows.find(r => r._reference === 'INV-001');
check('gather honours ymd/ISO for database use', dy._date === '2026-06-01');

console.log(FAILS ? `\n${FAILS} FAILED` : '\nALL PASS');
process.exit(FAILS ? 1 : 0);
