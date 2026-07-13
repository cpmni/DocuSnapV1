'use strict';
// Isolate the confirm CAS from the HTTP layer to characterise the "6 parallel wins" finding.
const Database = require('better-sqlite3');
const { runMigrations } = require('../database/index');
const documents = require('../database/modules/documents');
const learning  = require('../database/modules/learning');
const reviewServiceMod = require('../src/services/reviewService');

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id,name,slug,built_in) VALUES (1,'Invoice','invoice',1)").run();
learning.setSetting(db, 'output_folder', '/out');
db.prepare("INSERT INTO documents (id,original_filename,folder_path,document_type_id,status) VALUES (1,'a.pdf','/in',1,'needs_review')").run();

console.log('1) Direct documents.confirmIfReviewable 3× on a needs_review doc:');
for (let i = 0; i < 3; i++) {
  const r = documents.confirmIfReviewable(db, 1, { confirmed_by_username: 'u' + i });
  console.log(`   call ${i}: changes=${r && r.changes}  status=${db.prepare('SELECT status FROM documents WHERE id=1').get().status}`);
}

db.prepare("UPDATE documents SET status='needs_review', confirmed_by_username=NULL, stored_path=NULL WHERE id=1").run();
const rs = reviewServiceMod.createReviewService({
  documents, learning, doctypes: require('../database/modules/document_types'),
  filing: { commitDocument: async () => ({ success: true, filename: 'F.pdf', filePath: '/out/F.pdf', srcPath: '/in/a.pdf' }), removeSourceFile: async () => {} },
  fs: { existsSync: () => false, unlinkSync: () => {} }, path: require('path'), logger: null,
  audit: () => {}, notifyCounts: () => {}, releaseDelayMs: 0,
});

(async () => {
  const actor = { username: 'editor', role: 'edit' };
  const mk = () => ({ document_id: 1, document_type_slug: 'invoice', allValues: { supplier_name: 'A' }, corrections: {} });
  const results = await Promise.all(Array.from({ length: 6 }, () => rs.confirm(db, actor, mk())));
  const wins = results.filter(r => r && r.success).length;
  console.log('\n2) Parallel reviewService.confirm ×6 on ONE fresh doc:');
  console.log('   wins=' + wins + '  codes=[' + results.map(r => r && (r.code || (r.success ? 'OK' : 'FAIL'))).join(', ') + ']');
  console.log('   final doc status=' + db.prepare('SELECT status, confirmed_by_username FROM documents WHERE id=1').get().status);
  console.log(wins === 1 ? '\n   VERDICT: CAS holds (1 win) — the HTTP stress finding was a harness artifact.'
                          : '\n   VERDICT: >1 WIN — real concurrency gap in reviewService.confirm. LOG IT.');
  process.exit(0);
})();
