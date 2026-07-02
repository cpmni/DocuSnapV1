#!/usr/bin/env node
'use strict';
// reviewService replace-in-place for Learning Repair's "Send back to Review":
// a previously-filed doc, sent back to the queue (deconfirmDocument keeps stored_path) and
// then re-confirmed, must REPLACE its original filed copy — never mint a -DUPLICATE. A
// never-filed needs_review doc is unaffected. Uses real filing to a temp output folder.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_reviewservice_refile.js

const Database = require('better-sqlite3');
const fs = require('fs'), path = require('path'), os = require('os');
const { runMigrations } = require('../../database/index');
const documents = require('../../database/modules/documents');
const doctypes  = require('../../database/modules/document_types');
const learning  = require('../../database/modules/learning');
const filing    = require('../modules/filing/handler');
const { createReviewService } = require('./reviewService');

let fail = 0;
const check = (l, c, extra) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}${extra ? '  ' + extra : ''}`); if (!c) fail++; };

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-refile-'));
const OUTPUT = path.join(ROOT, 'output'), INBOX = path.join(ROOT, 'inbox');
for (const d of [OUTPUT, INBOX]) fs.mkdirSync(d, { recursive: true });
const db = new Database(':memory:'); runMigrations(db); doctypes.seedBuiltInTypes(db);
learning.setSetting(db, 'output_folder', OUTPUT);
const invId = db.prepare("SELECT id FROM document_types WHERE slug='invoice'").get().id;
const svc = createReviewService({ documents, learning, doctypes, filing, fs, path, audit: () => {}, notifyCounts: () => {}, releaseDelayMs: 0 });

function pdfs() {
  const out = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.metadata') continue; const f = path.join(d, e.name); e.isDirectory() ? walk(f) : (e.name.endsWith('.pdf') && out.push(f)); } })(OUTPUT);
  return out;
}
const vals = { supplier_name: 'Acme', invoice_number: 'INV-1', invoice_date: '01-01-2024' };
const confirmPayload = (id) => ({ document_id: id, folder_path: INBOX, original_filename: 'scan.pdf', corrections: {}, allValues: { ...vals }, supplier_name: 'Acme', document_type_slug: 'invoice' });

(async () => {
  // Seed a doc + working copy, confirm it (files it).
  const wc = path.join(INBOX, 'wc.pdf'); fs.writeFileSync(wc, 'PDF-BYTES');
  const id = documents.insert(db, { original_filename: 'scan.pdf', folder_path: INBOX, document_type_id: invId, status: 'needs_review' }).lastInsertRowid;
  documents.update(db, id, { working_path: wc });
  const c1 = await svc.confirm(db, { username: 'alice' }, confirmPayload(id));
  const filed1 = documents.getById(db, id).stored_path;
  check('first confirm files the doc once', c1.ok && pdfs().length === 1 && fs.existsSync(filed1));

  // Send back to Review — keeps stored_path.
  documents.deconfirmDocument(db, id);
  const row = documents.getById(db, id);
  check('send-to-review → needs_review, keeps stored_path', row.status === 'needs_review' && row.stored_path === filed1);

  // Re-confirm (queue item, same values) → replace in place, NO -DUPLICATE.
  const c2 = await svc.confirm(db, { username: 'alice' }, confirmPayload(id));
  check('re-confirm ok', c2.ok);
  const files = pdfs();
  check('still exactly ONE filed copy (no -DUPLICATE)', files.length === 1, `(${files.length})`);
  check('no -DUPLICATE filename', !files.some(p => /-DUPLICATE/.test(p)));
  check('filed at the SAME path as before', documents.getById(db, id).stored_path === filed1 && fs.existsSync(filed1));

  // A never-filed needs_review doc confirms normally (unaffected by the change).
  const wc2 = path.join(INBOX, 'wc2.pdf'); fs.writeFileSync(wc2, 'PDF2');
  const id2 = documents.insert(db, { original_filename: 'scan2.pdf', folder_path: INBOX, document_type_id: invId, status: 'needs_review' }).lastInsertRowid;
  documents.update(db, id2, { working_path: wc2 });
  const c3 = await svc.confirm(db, { username: 'alice' }, { ...confirmPayload(id2), original_filename: 'scan2.pdf', allValues: { supplier_name: 'Beta', invoice_number: 'INV-2', invoice_date: '02-02-2024' } });
  check('a never-filed doc still files normally', c3.ok && pdfs().length === 2);

  db.close();
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
  console.log(`\n${fail ? fail + ' FAILED' : 'All reviewService replace-in-place checks passed.'}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e); try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {} process.exit(1); });
