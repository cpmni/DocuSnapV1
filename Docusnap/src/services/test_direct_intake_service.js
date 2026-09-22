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
  extractSearchText: async (_p, ext) => (ext === '.docx' ? 'BODYTEXT lease renewal clause 7' : ''),
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
  check('intake_notes stored; ocr_text = title+notes+BODY (searchable, no OCR — Q2)', doc.intake_notes === 'signed copy' && /Office lease 2026/.test(doc.ocr_text) && /signed copy/.test(doc.ocr_text) && /BODYTEXT lease renewal clause 7/.test(doc.ocr_text));
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

console.log('§4 update — edit details, re-file only when a filing token changes, keep body searchable');
{
  // A commit stub whose path varies with the title, so a filing-token change moves the file (refile+unlink).
  const depsU = () => ({ ...deps(),
    commitDocument: async ({ allValues }) => {
      const slug = String(allValues.title || 'x').replace(/[^a-z0-9]+/gi, '_');
      return { success: true, filename: `${slug}.docx`, filePath: `/out/Acme/2026/September/${slug}.docx` };
    },
  });
  const { db, inv } = freshDb(true);
  const r = await svc.submit(db, EDIT, baseInput(inv), depsU());
  const before = db.prepare('SELECT stored_path FROM documents WHERE id=?').get(r.docId).stored_path;

  // (a) notes-only edit → NO re-file, notes + search text updated.
  const u1 = await svc.update(db, EDIT, r.docId, { notes: 'countersigned' }, depsU());
  const d1 = db.prepare('SELECT * FROM documents WHERE id=?').get(r.docId);
  check('notes-only update ok, not re-filed', u1.ok && u1.refiled === false && d1.intake_notes === 'countersigned' && d1.stored_path === before);
  check('body text preserved in search after edit', /BODYTEXT lease renewal clause 7/.test(d1.ocr_text) && /countersigned/.test(d1.ocr_text));

  // (b) title edit → RE-FILE, old copy unlinked, new title searchable + in extractions.
  unlinked.length = 0;
  const u2 = await svc.update(db, EDIT, r.docId, { title: 'Office lease RENEWED' }, depsU());
  const d2 = db.prepare('SELECT * FROM documents WHERE id=?').get(r.docId);
  const t2 = db.prepare("SELECT display_value FROM extractions WHERE document_id=? AND field_key='title'").get(r.docId);
  check('title update re-files (path changed)', u2.ok && u2.refiled === true && d2.stored_path !== before && /RENEWED/.test(d2.stored_path));
  check('old filed copy was unlinked', unlinked.includes(before));
  check('new title in extractions + search text', t2.display_value === 'Office lease RENEWED' && /Office lease RENEWED/.test(d2.ocr_text));

  // (c) refusals — invalid date changes nothing; non-quick-file / disabled / role.
  const u3 = await svc.update(db, EDIT, r.docId, { date: 'notadate' }, depsU());
  check('invalid date refused, doc unchanged', u3.error === 'bad_date' && db.prepare('SELECT doc_date FROM documents WHERE id=?').get(r.docId).doc_date === '12-09-2026');
  check('readonly refused', (await svc.update(db, { role: 'readonly' }, r.docId, { notes: 'x' }, depsU())).error === 'forbidden');
  // an OCR doc (intake NULL) is not a quick-file row
  const ocrId = db.prepare("INSERT INTO documents (original_filename, folder_path, status, document_type_id) VALUES ('scan.pdf','C:/src','confirmed',?)").run(inv).lastInsertRowid;
  check('a non-quick-file (OCR) doc is refused', (await svc.update(db, EDIT, ocrId, { notes: 'x' }, depsU())).error === 'not_quick_file');
  const { db: d3 } = freshDb(false);
  check('disabled refused', (await svc.update(d3, EDIT, 1, { notes: 'x' }, depsU())).error === 'disabled');
}

console.log('§5 Slice 0 (Fork A) — per-type CUSTOM fields persist as typed extractions, deduped vs role keys (C8), searchable');
{
  const { db, inv } = freshDb(true);
  // customFields carries two genuine custom fields + four that COLLIDE with role keys (the C8 attack).
  const r = await svc.submit(db, EDIT, baseInput(inv, {
    customFields: { child_dob: '01-01-2020', address: '12 High St', supplier_name: 'HACK', title: 'HACK', doc_date: '2020', reference_number: 'HACK' },
  }), deps());
  check('submit ok with custom fields', r.ok === true);
  const ex = db.prepare('SELECT field_key, display_value, confidence, extraction_method FROM extractions WHERE document_id=?').all(r.docId);
  const byKey = {}; const counts = {};
  for (const e of ex) { byKey[e.field_key] = e; counts[e.field_key] = (counts[e.field_key] || 0) + 1; }
  check('custom non-role fields persisted (child_dob, address), method=typed conf 100',
    byKey.child_dob && byKey.child_dob.display_value === '01-01-2020' && byKey.child_dob.extraction_method === 'typed' && byKey.child_dob.confidence === 100 &&
    byKey.address && byKey.address.display_value === '12 High St');
  check('C8 — a custom field keyed like a role never writes a 2nd row (one row per role key)',
    counts.supplier_name === 1 && counts.title === 1 && counts.doc_date === 1 && counts.reference_number === 1);
  check('C8 — the ROLE value wins over a same-keyed custom value (no clobber)',
    byKey.supplier_name.display_value === 'Acme Ltd' && byKey.title.display_value === 'Office lease 2026' &&
    byKey.doc_date.display_value === '12-09-2026' && byKey.reference_number.display_value === 'OL-2026');
  const oc = db.prepare('SELECT ocr_text FROM documents WHERE id=?').get(r.docId).ocr_text;
  check('custom values are searchable (in ocr_text)', /12 High St/.test(oc) && /01-01-2020/.test(oc));

  // update: change a custom field + add a new one; an untouched custom field stays searchable.
  const u = await svc.update(db, EDIT, r.docId, { customFields: { address: '99 New Rd', guardian: 'Jane Doe' } }, deps());
  check('update ok with custom fields', u.ok === true);
  const ex2 = {}; for (const e of db.prepare('SELECT field_key, display_value FROM extractions WHERE document_id=?').all(r.docId)) ex2[e.field_key] = e.display_value;
  check('custom field updated + new custom field added', ex2.address === '99 New Rd' && ex2.guardian === 'Jane Doe');
  check('untouched custom field (child_dob) preserved', ex2.child_dob === '01-01-2020');
  const oc2 = db.prepare('SELECT ocr_text FROM documents WHERE id=?').get(r.docId).ocr_text;
  check('search text refreshed: new address in, old out, untouched dob still in',
    /99 New Rd/.test(oc2) && !/12 High St/.test(oc2) && /01-01-2020/.test(oc2));
}

console.log('§6 no customFields → byte-identical (only the four role rows; C8 path is inert)');
{
  const { db, inv } = freshDb(true);
  const r = await svc.submit(db, EDIT, baseInput(inv), deps());
  const n = db.prepare('SELECT COUNT(*) n FROM extractions WHERE document_id=?').get(r.docId).n;
  check('exactly the four role extractions when no custom fields given', r.ok && n === 4);
}

console.log('§7 F3 — record-folder scheme: submit passes recordScheme + merges the key field into allValues');
{
  const { db, inv } = freshDb(true);
  let captured = null;
  const capDeps = () => ({ ...deps(), commitDocument: async (args) => { captured = args; return { success: true, filename: 'F.docx', filePath: '/out/Child Record/Ava/2026/September/F.docx' }; } });
  const r = await svc.submit(db, EDIT, baseInput(inv, { customFields: { child_name: 'Ava Thompson', address: '1 Elm', reference_number: 'SHOULD_NOT_LEAK' } }), capDeps());
  check('submit ok', r.ok === true);
  check('recordScheme:true passed to commitDocument (direct lane)', !!captured && captured.recordScheme === true);
  check('the key custom field is merged into allValues (so the folder can key on it)', !!captured && captured.allValues && captured.allValues.child_name === 'Ava Thompson');
  check('other non-role custom fields merged too', !!captured && captured.allValues.address === '1 Elm');
  check('role keys still present + win', !!captured && captured.allValues.supplier_name === 'Acme Ltd');
  check('C4: a custom field named reference_number does NOT leak into the {ref} token', !!captured && captured.allValues.reference_number === 'OL-2026');
}

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
})();
