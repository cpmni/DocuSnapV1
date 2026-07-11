'use strict';
// Two SEQUENTIAL confirms on the SAME doc by DIFFERENT users. The documented multi-user design
// says the 2nd should be rejected ("already filed by <first>"). Does it? Or does it re-file
// (last-writer-wins, silent overwrite)? Pins the finding from v1_stress / http_race.
const http = require('http');
const Database = require('better-sqlite3');
const api = require('../src/modules/api/handler');
const pw  = require('../src/modules/auth/password');
const { runMigrations } = require('../database/index');
const documents = require('../database/modules/documents');
const learning  = require('../database/modules/learning');
const reviewServiceMod = require('../src/services/reviewService');
const presenceMod = require('../src/services/presenceService');
const licensing = require('../src/modules/licensing/handler');
licensing.licenseDenied = () => null;

function req(port, method, path, { token, body } = {}) {
  return new Promise((resolve) => {
    const data = body != null ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    } }, (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, json: j }); }); });
    r.on('error', () => resolve({ status: 0 })); if (data) r.write(data); r.end();
  });
}
(async () => {
  const db = new Database(':memory:'); runMigrations(db);
  db.prepare("INSERT INTO document_types (id,name,slug,built_in) VALUES (1,'Invoice','invoice',1)").run();
  learning.setSetting(db, 'output_folder', '/out');
  db.prepare("INSERT INTO documents (id,original_filename,folder_path,document_type_id,status) VALUES (5,'a.pdf','/in',1,'needs_review')").run();
  let commits = 0;
  const reviewService = reviewServiceMod.createReviewService({
    documents, learning, doctypes: require('../database/modules/document_types'),
    filing: { commitDocument: async () => { commits++; return ({ success: true, filename: 'F.pdf', filePath: '/out/F.pdf', srcPath: '/in/a.pdf' }); }, removeSourceFile: async () => {} },
    fs: { existsSync: () => false, unlinkSync: () => {} }, path: require('path'), logger: null, audit: () => {}, notifyCounts: () => {}, releaseDelayMs: 0,
  });
  const server = api.createServer({ getDb: () => db, learning: { getDigitsOnlyFields: () => [] }, reviewService,
    presence: presenceMod.createPresenceService(),
    checkEntitlement: () => ({ entitled: true, feature: 'detached_client', search: { entitled: true, seats: 99 }, workflow: { entitled: true, seats: 99 } }) });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const h = await pw.hashPassword('Seq-9');
  db.prepare("INSERT INTO users (id,username,display_name,password_hash,role,is_active) VALUES (1,'admin','Ad',?, 'admin',1)").run(h);
  db.prepare("INSERT INTO users (id,username,display_name,password_hash,role,is_active) VALUES (2,'editor','Ed',?, 'edit',1)").run(h);
  const editT = (await req(port, 'POST', '/v1/auth/login', { body: { username: 'editor', password: 'Seq-9' } })).json?.token;
  const adminT = (await req(port, 'POST', '/v1/auth/login', { body: { username: 'admin', password: 'Seq-9' } })).json?.token;

  const body = (sup) => ({ document_type_slug: 'invoice', allValues: { supplier_name: sup }, corrections: {} });
  const r1 = await req(port, 'POST', '/v1/documents/5/confirm', { token: editT, body: body('Editor-Co') });
  const r2 = await req(port, 'POST', '/v1/documents/5/confirm', { token: adminT, body: body('Admin-Co') });   // a moment LATER
  const finalRow = db.prepare('SELECT confirmed_by_username, supplier_name FROM documents WHERE id=5').get();
  console.log(`1st (editor): status=${r1.status} ok=${r1.json && r1.json.success}`);
  console.log(`2nd (admin) : status=${r2.status} ${r2.json && (r2.json.code ? 'code=' + r2.json.code : 'ok=' + r2.json.success)}`);
  console.log(`commitDocument called ${commits}× | final confirmed_by=${finalRow.confirmed_by_username} supplier=${finalRow.supplier_name}`);
  console.log(r2.status === 409
    ? '\nVERDICT: 2nd rejected (409) — matches the documented "first wins, second rejected" design.'
    : `\nVERDICT: 2nd SUCCEEDED (re-file). The later confirm OVERWROTE the first (now confirmed_by=${finalRow.confirmed_by_username}), filed ${commits}×, NO "already filed by" rejection. Differs from the documented design — LOG IT.`);
  server.close(); process.exit(0);
})();
