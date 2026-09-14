#!/usr/bin/env node
'use strict';
/**
 * test_v1_purge_files.js — the /v1 permanent purge deletes EVERY app-owned file, exactly like the desktop
 * purge (Chris 2026-09-14 card 1). THE BUG: `/v1/documents/:id/purge` (and purge-all) deleted
 * `[documents.resolveFilePath(doc), doc.working_path]` — the WORKING copy only — so a client "Delete
 * permanently" removed the record but left the FILED PDF and its `.metadata/<basename>.xml` on disk while
 * the warning said "and its file". The desktop's `_purgeOne` got the stored_path + sidecar fix on
 * 2026-08-13/25; the /v1 lane never did. Now both doors call ONE module-level helper
 * (review/handler.js purgeDocumentFiles). Hermetic: a stub fs records unlinks.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/api/test_v1_purge_files.js
 */
const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');
const api = require('./handler');
const pw  = require('../auth/password');
const review = require('../review/handler');
const { runMigrations } = require('../../../database/index');
const learning  = require('../../../database/modules/learning');
const licensing = require('../licensing/handler');

const PWD = 'Purge-Test-9';
let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };
licensing.licenseDenied = () => null;

// The DB stores forward-slash paths; the helper builds the sidecar path with path.join (OS separators). The stub
// fs normalises both so the comparison is by FILE, not by slash style.
const W = (s) => path.normalize(String(s));
const unlinked = [];
const onDisk = new Set([W('C:/inbox/1.pdf'), W('C:/out/Acme/Invoice.pdf'), W('C:/out/Acme/.metadata/Invoice.xml'),
                        W('C:/inbox/2.pdf'), W('C:/out/Acme/Two.pdf'), W('C:/out/Acme/.metadata/Two.xml'),
                        W('C:/inbox/3.pdf')]);
const stubFs = { existsSync: (p) => onDisk.has(W(p)), unlinkSync: (p) => { unlinked.push(W(p)); onDisk.delete(W(p)); } };

function seed() {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (1, 'Invoice', 'invoice', 1)").run();
  const ins = db.prepare("INSERT INTO documents (id, document_type_id, original_filename, stored_filename, stored_path, folder_path, working_path, status, supplier_name, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  ins.run(1, 1, 'a.pdf', 'Invoice.pdf', 'C:/out/Acme/Invoice.pdf', 'C:/out/Acme', 'C:/inbox/1.pdf', 'deleted', 'Acme', '2026-09-14');
  ins.run(2, 1, 'b.pdf', 'Two.pdf',     'C:/out/Acme/Two.pdf',     'C:/out/Acme', 'C:/inbox/2.pdf', 'deleted', 'Acme', '2026-09-14');
  ins.run(3, 1, 'c.pdf', 'c.pdf',       '',                        '',            'C:/inbox/3.pdf', 'deleted', 'Acme', '2026-09-14');   // never filed: working copy only
  learning.setSetting(db, 'output_folder', 'C:/out');
  return db;
}

const post = (port, p, token) => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} }, (res) => {
    let buf = ''; res.on('data', c => (buf += c)); res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch {} resolve({ status: res.statusCode, json }); });
  }); r.on('error', () => resolve({ status: 0 })); r.end();
});
const login = (port, u) => new Promise((resolve) => {
  const data = JSON.stringify({ username: u, password: PWD });
  const r = http.request({ host: '127.0.0.1', port, path: '/v1/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
    let buf = ''; res.on('data', c => (buf += c)); res.on('end', () => { try { resolve(JSON.parse(buf).token); } catch { resolve(null); } });
  }); r.write(data); r.end();
});

async function main() {
  console.log('0. the helper itself (module-level, shared by both doors)');
  {
    const db = seed();
    const removed = review.purgeDocumentFiles(db, 1, { fs: stubFs, path }).map(W);
    check('purgeDocumentFiles removes the working copy + the filed copy + the .metadata sidecar (3 files)',
          removed.length === 3 && removed.includes(W('C:/inbox/1.pdf')) && removed.includes(W('C:/out/Acme/Invoice.pdf')) && removed.includes(W('C:/out/Acme/.metadata/Invoice.xml')));
    check('it does NOT delete the DB row (the caller decides)', !!db.prepare('SELECT id FROM documents WHERE id = 1').get());
    check('a never-filed document: only its working copy', JSON.stringify(review.purgeDocumentFiles(db, 3, { fs: stubFs, path }).map(W)) === JSON.stringify([W('C:/inbox/3.pdf')]));
    check('a missing document → nothing', review.purgeDocumentFiles(db, 999, { fs: stubFs, path }).length === 0);
    db.close();
  }

  console.log('1. /v1 purge + purge-all go through the SAME helper');
  unlinked.length = 0;
  for (const p of ['C:/inbox/1.pdf', 'C:/out/Acme/Invoice.pdf', 'C:/out/Acme/.metadata/Invoice.xml', 'C:/inbox/2.pdf', 'C:/out/Acme/Two.pdf', 'C:/out/Acme/.metadata/Two.xml', 'C:/inbox/3.pdf']) onDisk.add(W(p));
  const db = seed();
  const server = api.createServer({
    getDb: () => db, learning, fs: stubFs, path,
    checkEntitlement: () => ({ entitled: true, feature: 'detached_client', search: { entitled: true, seats: 99 }, workflow: { entitled: true, seats: 99 } }),
    app: { getPath: () => require('os').tmpdir() },
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const h = await pw.hashPassword(PWD);
  const ins = db.prepare("INSERT INTO users (id, username, display_name, password_hash, role, is_active) VALUES (?,?,?,?,?,1)");
  ins.run(1, 'admin', 'Admin', h, 'admin'); ins.run(2, 'editor', 'Editor', h, 'edit');
  const adminT = await login(port, 'admin'), editT = await login(port, 'editor');

  check('purge as EDIT → 403 (admin only), nothing deleted', (await post(port, '/v1/documents/1/purge', editT)).status === 403 && unlinked.length === 0);
  const r1 = await post(port, '/v1/documents/1/purge', adminT);
  check('purge as admin → 200', r1.status === 200 && r1.json && r1.json.ok === true);
  check('…deleted the working copy, the FILED copy and the .metadata xml (the bug: only the working copy)',
        unlinked.includes(W('C:/inbox/1.pdf')) && unlinked.includes(W('C:/out/Acme/Invoice.pdf')) && unlinked.includes(W('C:/out/Acme/.metadata/Invoice.xml')));
  check('…and removed the record', !db.prepare('SELECT id FROM documents WHERE id = 1').get());
  check('…and touched nothing else', unlinked.length === 3);
  unlinked.length = 0;
  const r2 = await post(port, '/v1/documents/purge-all', adminT);
  check('purge-all as admin → 200 with the count of the remaining binned docs (2)', r2.status === 200 && r2.json && r2.json.purged === 2);
  check('…deleted doc 2\'s three files + doc 3\'s working copy', unlinked.length === 4 && unlinked.includes(W('C:/out/Acme/Two.pdf')) && unlinked.includes(W('C:/out/Acme/.metadata/Two.xml')) && unlinked.includes(W('C:/inbox/2.pdf')) && unlinked.includes(W('C:/inbox/3.pdf')));
  check('…and the bin is empty', db.prepare("SELECT COUNT(*) n FROM documents WHERE status = 'deleted'").get().n === 0);
  check('the desktop purge (_purgeOne) delegates to the same helper (source pin)', /function _purgeOne\(db, docId\) \{\s*purgeDocumentFiles\(db, docId, \{ fs, path \}\);\s*documents\.deleteDoc\(db, docId\);/.test(require('fs').readFileSync(path.join(__dirname, '..', 'review', 'handler.js'), 'utf8')));
  check('the /v1 lane no longer deletes via resolveFilePath (the working-copy-only bug)', !/for \(const p of \[documents\.resolveFilePath\(doc\), doc\.working_path\]\)/.test(require('fs').readFileSync(path.join(__dirname, 'handler.js'), 'utf8')));

  server.close(); db.close();
  console.log(fail ? `\n${fail} FAILED` : '\nAll /v1 purge-files pins passed');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
