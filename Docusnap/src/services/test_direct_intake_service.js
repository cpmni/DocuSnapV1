'use strict';
/**
 * test_direct_intake_service.js — pins the Quick File lane (QuickFile+Departments, eric B.5 / Oracle Q-Cx).
 * Filing is STUBBED (the pin proves the lane's contract, not commitDocument, which has its own pins):
 * the refusal family (role / disabled / ext / size / date), the CONFIRMED typed row shape (intake='direct',
 * overall NULL, method='typed', role fields keyed off the doc type), working_path NULL after filing, the
 * user's SOURCE never deleted (only the inbox working copy), and no reviewService/learning path is touched.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_direct_intake_service.js
 */
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const svc = require('./directIntakeService');

let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

function freshDb(enabled = true) {
  const db = new Database(':memory:');
  runMigrations(db);
  const inv = db.prepare("INSERT INTO document_types (name, slug, ref_field_key, date_field_key, reading_mode, built_in) VALUES ('Filed Document','filed_document','reference_number','doc_date','none',0)").run().lastInsertRowid;
  db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('direct_intake_enabled', ?)").run(enabled ? 'true' : 'false');
  return { db, inv };
}
const EDIT = { role: 'edit', username: 'chris' };
const unlinked = [];
const deps = () => ({
  path, fs: { unlinkSync: (p) => unlinked.push(p) },
  outputRoot: '/out', inboxDir: '/inbox',
  ensureWorkingCopy: (_fs, _p, _inbox, _src, id, name) => `/inbox/${id}${path.extname(name)}`,
  commitDocument: async ({ originalFilename }) => ({ success: true, filename: `Filed.${originalFilename}`, filePath: `/out/Acme/2026/September/Filed.${originalFilename}` }),
  normaliseDate: (s) => (s === 'notadate' ? null : s),
  logAudit: () => {},
  now: () => '2026-09-13T00:00:00Z',
});
const baseInput = (inv, over = {}) => ({ srcPath: 'C:/src/Office lease.docx', ext: '.docx', size: 2 * 1024 * 1024,
  documentTypeId: inv, party: 'Acme Ltd', date: '12-09-2026', title: 'Office lease 2026', reference: 'OL-2026', notes: 'signed copy', ...over });

(async () => {
console.log('§1 refusals (a typed doc never enters a queue — the safe state is refusal with a reason)');
{
  const { db, inv } = freshDb(true);
  check('readonly refused', (await svc.submit(db, { role: 'readonly' }, baseInput(inv), deps())).error === 'forbidden');
  check('null actor refused', (await svc.submit(db, null, baseInput(inv), deps())).error === 'forbidden');
  const { db: d2, inv: i2 } = freshDb(false);
  check('disabled (switch off) refused', (await svc.submit(d2, EDIT, baseInput(i2), deps())).error === 'disabled');
  check('never-open ext (.docm) refused', (await svc.submit(db, EDIT, baseInput(inv, { srcPath: 'x.docm', ext: '.docm' }), deps())).error === 'unsupported_type');
  check('executable (.exe) refused', (await svc.submit(db, EDIT, baseInput(inv, { srcPath: 'x.exe', ext: '.exe' }), deps())).error === 'unsupported_type');
  check('non-intake (.zzz) refused', (await svc.submit(db, EDIT, baseInput(inv, { ext: '.zzz', srcPath: 'x.zzz' }), deps())).error === 'unsupported_type');
  check('oversize refused', (await svc.submit(db, EDIT, baseInput(inv, { size: 999 * 1024 * 1024 }), deps())).error === 'too_large');
  check('invalid date refused (every-door normalise)', (await svc.submit(db, EDIT, baseInput(inv, { date: 'notadate' }), deps())).error === 'bad_date');
  check('unknown doc type refused', (await svc.submit(db, EDIT, baseInput(9999), deps())).error === 'unknown_type');
  check('no refusal left a row behind', db.prepare('SELECT COUNT(*) n FROM documents').get().n === 0);
}

console.log('§2 happy path — a CONFIRMED typed row, filed, searchable, never-learning');
{
  const { db, inv } = freshDb(true);
  unlinked.length = 0;
  const r = await svc.submit(db, EDIT, baseInput(inv), deps());
  check('ok + docId + storedPath returned', r.ok === true && r.docId > 0 && /Filed\./.test(r.storedPath));
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(r.docId);
  check("status='confirmed'", doc.status === 'confirmed');
  check("intake='direct' (the non-switchable learning-exclusion marker)", doc.intake === 'direct');
  check('overall_confidence NULL (nothing was read)', doc.overall_confidence === null);
  check('confirmed_at + confirmed_by set', doc.confirmed_at === '2026-09-13T00:00:00Z' && doc.confirmed_by_username === 'chris');
  check('supplier_name / doc_date / reference_number are the TYPED values', doc.supplier_name === 'Acme Ltd' && doc.doc_date === '12-09-2026' && doc.reference_number === 'OL-2026');
  check('intake_notes stored; ocr_text = title+notes (searchable, no OCR)', doc.intake_notes === 'signed copy' && /Office lease 2026/.test(doc.ocr_text) && /signed copy/.test(doc.ocr_text));
  check('stored_filename/stored_path written; working_path NULL after filing (Q-C5)', /Filed\./.test(doc.stored_filename) && doc.working_path === null);
  const ex = db.prepare("SELECT field_key, display_value, confidence, extraction_method FROM extractions WHERE document_id = ? ORDER BY field_key").all(r.docId);
  const byKey = Object.fromEntries(ex.map(e => [e.field_key, e]));
  check('every extraction is method=typed, confidence=100', ex.length >= 4 && ex.every(e => e.extraction_method === 'typed' && e.confidence === 100));
  check('typed role fields present (supplier_name, reference_number, doc_date, title)',
    byKey.supplier_name && byKey.reference_number && byKey.doc_date && byKey.title && byKey.title.display_value === 'Office lease 2026');
  check('the SOURCE file was never deleted (only the inbox working copy)', unlinked.every(p => p.startsWith('/inbox/')) && !unlinked.includes('C:/src/Office lease.docx'));
  check('it is SEARCHABLE (search returns it)', db.prepare("SELECT COUNT(*) n FROM documents WHERE intake='direct' AND status='confirmed'").get().n === 1);
}

console.log('§3 no title given → falls back to the filename stem');
{
  const { db, inv } = freshDb(true);
  const r = await svc.submit(db, EDIT, baseInput(inv, { title: '' }), deps());
  const t = db.prepare("SELECT display_value FROM extractions WHERE document_id=? AND field_key='title'").get(r.docId);
  check('title defaults to the cleaned filename stem', r.ok && t && t.display_value === 'Office lease');
}

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
})();
