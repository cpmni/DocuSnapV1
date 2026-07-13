'use strict';
// Focused HTTP re-run of ONLY the parallel-confirm race, with per-request status logging,
// to pin the "6 wins" artifact from v1_stress.js.
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
    r.on('error', () => resolve({ status: 0, json: null }));
    if (data) r.write(data); r.end();
  });
}
(async () => {
  const db = new Database(':memory:'); runMigrations(db);
  db.prepare("INSERT INTO document_types (id,name,slug,built_in) VALUES (1,'Invoice','invoice',1)").run();
  learning.setSetting(db, 'output_folder', '/out');
  db.prepare("INSERT INTO documents (id,original_filename,folder_path,document_type_id,status) VALUES (5,'a.pdf','/in',1,'needs_review')").run();
  const reviewService = reviewServiceMod.createReviewService({
    documents, learning, doctypes: require('../database/modules/document_types'),
    filing: { commitDocument: async () => ({ success: true, filename: 'F.pdf', filePath: '/out/F.pdf', srcPath: '/in/a.pdf' }), removeSourceFile: async () => {} },
    fs: { existsSync: () => false, unlinkSync: () => {} }, path: require('path'), logger: null, audit: () => {}, notifyCounts: () => {}, releaseDelayMs: 0,
  });
  const server = api.createServer({ getDb: () => db, learning: { getDigitsOnlyFields: () => [] }, reviewService,
    presence: presenceMod.createPresenceService(),
    checkEntitlement: () => ({ entitled: true, feature: 'detached_client', search: { entitled: true, seats: 99 }, workflow: { entitled: true, seats: 99 } }) });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const h = await pw.hashPassword('Race-9');
  db.prepare("INSERT INTO users (id,username,display_name,password_hash,role,is_active) VALUES (2,'editor','Ed',?, 'edit',1)").run(h);
  const editT = (await req(port, 'POST', '/v1/auth/login', { body: { username: 'editor', password: 'Race-9' } })).json?.token;

  const race = await Promise.all(Array.from({ length: 6 }, () => req(port, 'POST', '/v1/documents/5/confirm', { token: editT, body: { document_type_slug: 'invoice', allValues: { supplier_name: 'A' }, corrections: {} } })));
  console.log('statuses:', race.map(r => r.status).join(', '));
  console.log('codes   :', race.map(r => (r.json && (r.json.code || (r.json.success ? 'OK' : '?'))) || '?').join(', '));
  console.log('wins    :', race.filter(r => r.status === 200 && r.json && r.json.success).length);
  server.close(); process.exit(0);
})();
