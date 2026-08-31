#!/usr/bin/env node
'use strict';

/**
 * src/services/test_keep_processed_originals.js
 * ----------------------------------------------
 * Q1 of the Chris round-14 queue (card 1, "filed → Put back → Delete → Empty bin destroys the only
 * copy"; gary (a′) → Oracle SIGN-OFF-W/COND C1.1–C1.7, 2026-08-22).
 *
 * Import MOVES the original into the Processed folder; the confirm-time `removeSourceFile` then
 * UNLINKED that Processed file (it predates the drain), so the Output copy was the only copy.
 * Under `keep_processed_originals` (mig 83 UPSERTs 'true' for every install) the ONE gate in
 * reviewService.confirm:
 *   OFF                  → today's removal (onScheduleSourceMove), byte-identical
 *   ON + drained_at set  → nothing is removed (the original is the archive copy)
 *   ON + not drained     → the original is DRAINED now (drainOriginal dep), never unlinked;
 *                          drain_processed='false' → left where it is
 *   env KEEP_PROCESSED_ORIGINALS=0/1 overrides the setting either way
 * + the mig-83 BACKFILL (rows drained before the column existed carry a Processed folder_path)
 * + a put-back re-confirm under ON never touches the original.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_keep_processed_originals.js
 */

const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../database/index');
const documents = require('../../database/modules/documents');
const learning  = require('../../database/modules/learning');
const { createReviewService, keepProcessedOriginals } = require('./reviewService');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; }
const get = (db, id) => db.prepare('SELECT * FROM documents WHERE id = ?').get(id);

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Invoice', 'invoice', 1)").run();
learning.setSetting(db, 'output_folder', '/out');

const calls = { sourceMove: 0, drain: [] };
let drainResult = { folder: path.join('/in', 'Processed'), filename: 'scan.pdf' };
const deps = {
  documents, learning,
  doctypes: { getWithFields: () => ({ id: 1, name: 'Invoice', ref_field_key: 'invoice_number', date_field_key: 'invoice_date' }) },
  filing: {
    normaliseDate: require('../modules/filing/handler').normaliseDate,
    commitDocument: async ({ folderPath, originalFilename }) =>
      ({ success: true, filename: 'F.pdf', filePath: '/out/F.pdf', metadataPath: '/out/.metadata/F.xml',
         srcPath: path.join(folderPath, originalFilename) }),
  },
  fs: { existsSync: () => true, unlinkSync: () => {} },
  path,
  logger: null,
  audit: () => {},
  onScheduleSourceMove: () => { calls.sourceMove++; },
  drainOriginal: (srcPath, destDir, originalFilename) => { calls.drain.push({ srcPath, destDir, originalFilename }); return drainResult; },
  notifyCounts: () => {},
  releaseDelayMs: 0,
};
const svc = createReviewService(deps);
const reset = () => { calls.sourceMove = 0; calls.drain = []; };
const newDoc = (folder_path, drained) => {
  const id = Number(documents.insert(db, { original_filename: 'scan.pdf', folder_path, status: 'needs_review' }).lastInsertRowid);
  if (drained) db.prepare("UPDATE documents SET drained_at = '2026-08-22T10:00:00Z' WHERE id = ?").run(id);
  return id;
};
const payload = (id, extra = {}) => ({
  document_id: id, folder_path: get(db, id).folder_path, original_filename: 'scan.pdf', corrections: {},
  allValues: { supplier_name: 'Acme', invoice_number: 'INV-1', invoice_date: '01-01-2026' },
  supplier_name: 'Acme', document_type: 'Invoice', document_type_slug: 'invoice', taught_fields: [], ...extra,
});

(async () => {
  console.log('§1 migration 83 state');
  check('mig 83 added documents.drained_at', db.prepare("PRAGMA table_info(documents)").all().some(c => c.name === 'drained_at'));
  check('mig 83 UPSERTed keep_processed_originals = true (every install)', learning.getSetting(db, 'keep_processed_originals', null) === 'true');
  check('keepProcessedOriginals(db) reads it', keepProcessedOriginals(db, learning) === true);

  console.log('§2 ON + drained → the Processed original is NOT removed (the exhibit)');
  reset();
  const dA = newDoc(path.join('/in', 'Processed'), true);
  const rA = await svc.confirm(db, { username: 'sarah', role: 'admin' }, payload(dA));
  check('confirm ok', rA.ok === true && get(db, dA).status === 'confirmed');
  check('onScheduleSourceMove NOT called', calls.sourceMove === 0);
  check('no drain either (already drained)', calls.drain.length === 0);
  check('drained_at untouched', get(db, dA).drained_at === '2026-08-22T10:00:00Z');

  console.log('§3 ON + not drained → drained NOW, never unlinked (Oracle C1.2)');
  reset();
  const dB = newDoc('/in', false);
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, payload(dB));
  check('onScheduleSourceMove NOT called', calls.sourceMove === 0);
  check('drainOriginal called once with the intake file + <source>/Processed', calls.drain.length === 1
        && calls.drain[0].srcPath === path.join('/in', 'scan.pdf') && calls.drain[0].destDir === path.join('/in', 'Processed')
        && calls.drain[0].originalFilename === 'scan.pdf');
  check('folder_path follows the drain + drained_at stamped', get(db, dB).folder_path === path.join('/in', 'Processed') && !!get(db, dB).drained_at);

  console.log('§3b ON + not drained + an explicit processed_folder → drained there');
  reset();
  learning.setSetting(db, 'processed_folder', '/archive');
  drainResult = { folder: '/archive', filename: 'scan-1.pdf' };
  const dB2 = newDoc('/in', false);
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, payload(dB2));
  check('destDir is the processed_folder setting', calls.drain.length === 1 && calls.drain[0].destDir === '/archive');
  check('a renamed drain (scan-1.pdf) updates original_filename', get(db, dB2).original_filename === 'scan-1.pdf' && get(db, dB2).folder_path === '/archive');
  learning.setSetting(db, 'processed_folder', '');
  drainResult = { folder: path.join('/in', 'Processed'), filename: 'scan.pdf' };

  console.log('§3c ON + not drained + drain_processed=false → left in place (no drain, no unlink)');
  reset();
  learning.setSetting(db, 'drain_processed', 'false');
  const dC = newDoc('/in', false);
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, payload(dC));
  check('neither drained nor removed', calls.sourceMove === 0 && calls.drain.length === 0);
  check('folder_path unchanged', get(db, dC).folder_path === '/in' && get(db, dC).drained_at == null);
  learning.setSetting(db, 'drain_processed', 'true');

  console.log('§4 OFF → today\'s removal (the kill switch; positive control for the gate)');
  reset();
  learning.setSetting(db, 'keep_processed_originals', 'false');
  const dD = newDoc(path.join('/in', 'Processed'), true);
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, payload(dD));
  check('onScheduleSourceMove called once (drained or not, OFF removes)', calls.sourceMove === 1 && calls.drain.length === 0);
  reset();
  const dD2 = newDoc('/in', false);
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, payload(dD2));
  check('OFF + not drained → removed too (byte-identical to before)', calls.sourceMove === 1 && calls.drain.length === 0);

  console.log('§5 env override both ways');
  reset();
  process.env.KEEP_PROCESSED_ORIGINALS = '1';                       // setting is false
  const dE = newDoc(path.join('/in', 'Processed'), true);
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, payload(dE));
  check('env=1 over setting=false → kept', calls.sourceMove === 0);
  learning.setSetting(db, 'keep_processed_originals', 'true');
  process.env.KEEP_PROCESSED_ORIGINALS = '0';
  reset();
  const dF = newDoc(path.join('/in', 'Processed'), true);
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, payload(dF));
  check('env=0 over setting=true → removed', calls.sourceMove === 1);
  delete process.env.KEEP_PROCESSED_ORIGINALS;

  console.log('§6 put back → re-confirm under ON never touches the original (Oracle C1.7)');
  reset();
  documents.deconfirmDocument(db, dA);
  check('put back → needs_review', get(db, dA).status === 'needs_review');
  const rG = await svc.confirm(db, { username: 'sarah', role: 'admin' }, payload(dA));
  check('re-confirm ok', rG.ok === true && get(db, dA).status === 'confirmed');
  check('no removal, no drain', calls.sourceMove === 0 && calls.drain.length === 0);

  console.log('§7 machine doors pass the same gate (scope_sweep via)');
  reset();
  const dH = newDoc(path.join('/in', 'Processed'), true);
  await svc.confirm(db, { username: 'sarah', role: 'admin' }, payload(dH, { bulk: true }), { via: 'scope_sweep' });
  check('a sweep confirm keeps the original too', get(db, dH).status === 'confirmed' && calls.sourceMove === 0);

  console.log('§8 mig 83 BACKFILL (rows drained before the column existed)');
  const db2 = new Database(':memory:');
  runMigrations(db2);
  db2.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Invoice', 'invoice', 1)").run();
  learning.setSetting(db2, 'processed_folder', 'D:\\Archive\\Scans');
  const mk2 = (fp) => Number(documents.insert(db2, { original_filename: 'x.pdf', folder_path: fp, status: 'needs_review' }).lastInsertRowid);
  const b1 = mk2('C:\\Scans\\Doc sol\\Processed');           // default drain dir (backslash)
  const b2 = mk2('C:/Scans/Doc sol/Processed');              // forward slash
  const b3 = mk2('D:\\Archive\\Scans');                      // the explicit processed_folder
  const b4 = mk2('C:\\Scans\\Doc sol');                      // an intake folder — NOT drained
  const b5 = mk2('C:\\Scans\\Processed\\Processed');         // the nested case — still a Processed dir
  db2.prepare('DELETE FROM migrations WHERE version = 83').run();
  db2.prepare('UPDATE documents SET drained_at = NULL').run();
  runMigrations(db2);
  const g2 = (id) => db2.prepare('SELECT drained_at FROM documents WHERE id = ?').get(id).drained_at;
  check('…\\Processed stamped', !!g2(b1));
  check('…/Processed stamped', !!g2(b2));
  check('the explicit processed_folder stamped', !!g2(b3));
  check('an intake folder NOT stamped (negative control)', g2(b4) == null);
  check('Processed\\Processed stamped', !!g2(b5));
  check('mig 83 recorded once', db2.prepare('SELECT COUNT(*) n FROM migrations WHERE version = 83').get().n === 1);

  console.log('§9 source contract');
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, 'reviewService.js'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '..', 'modules', 'api', 'handler.js'), 'utf8');
  const rev = fs.readFileSync(path.join(__dirname, '..', 'modules', 'review', 'handler.js'), 'utf8');
  check('ONE gate: keepProcessedOriginals is consulted exactly once in confirm', (src.match(/if \(!keepProcessedOriginals\(db, learning\)\)/g) || []).length === 1);
  check('the /v1 door adds no second check (Oracle C1.1)', !/keep_processed_originals|keepProcessedOriginals/.test(api));
  check('both doors inject drainOriginal', /drainOriginal:/.test(api) && /drainOriginal:/.test(rev));
  const ph = fs.readFileSync(path.join(__dirname, '..', 'modules', 'processing', 'handler.js'), 'utf8');
  check('both import drain paths stamp drained_at', (ph.match(/folder_path = \?, drained_at = datetime\('now'\)/g) || []).length === 2);

  console.log('§10 the import seam (Oracle C1.6): a folder holding kept originals of FILED docs is refused, overridable');
  const proc = require('../modules/processing/handler');
  const db3 = new Database(':memory:');
  runMigrations(db3);
  const mk3 = (fp, status) => documents.insert(db3, { original_filename: 'x.pdf', folder_path: fp, status });
  mk3('C:\\Scans\\Processed', 'confirmed'); mk3('c:/scans/processed/', 'confirmed');   // same folder, two spellings
  mk3('C:\\Scans\\Processed', 'needs_review');                                          // held — not counted
  mk3('C:\\Other', 'confirmed');
  check('counts CONFIRMED docs whose folder_path resolves to the folder (2, both spellings)', proc._filedDocsInFolder(db3, 'C:\\Scans\\Processed\\') === 2);
  check('a folder with only held docs → 0 (negative control)', proc._filedDocsInFolder(db3, 'C:\\Scans') === 0);
  check('unrelated folder → 1', proc._filedDocsInFolder(db3, 'C:/Other') === 1);
  check('process-folder consults it, honours {importAnyway:true} and the env kill', /opts\.importAnyway === true/.test(ph) && /IMPORT_FILED_FOLDER_GUARD/.test(ph) && /overridable: true/.test(ph));
  const mainR = fs.readFileSync(path.join(__dirname, '..', 'windows', 'main', 'renderer.js'), 'utf8');
  check('the renderer asks before overriding', /processResult\.overridable/.test(mainR) && /importAnyway: true/.test(mainR));

  console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
