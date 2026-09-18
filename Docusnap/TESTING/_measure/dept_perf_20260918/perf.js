'use strict';
/**
 * Departments D7 perf gate (Oracle 2026-09-18 #6): the correlated-EXISTS join filter runs on every list/count
 * reader. The corpus M=0 gate is VACUOUS for latency (no departments in the corpus), so this measures the join
 * filter's cost on a departments-LOADED synthetic corpus. For each reader we time three viewers on the SAME
 * corpus: a MEMBER (the join clause is active), an ADMIN (fragment '' — the pre-D7 fast path = baseline), and
 * SYSTEM_ACTOR (unfiltered). PASS = no reader's member time regresses beyond a small multiple of the baseline,
 * and absolute times stay sub-second at scale.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron TESTING/_measure/dept_perf_20260918/perf.js [nDocs]
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const documents = require('../../../database/modules/documents');
const access = require('../../../src/services/accessService');
const dv = require('../../../database/modules/departmentVisibility');

const N = Number(process.argv[2]) || 20000;
const N_DEPTS = 8, N_USERS = 40;
const db = new Database(':memory:');
runMigrations(db);

// ── build the corpus ──
const rnd = (n) => Math.floor(Math.random() * n);
const deptIds = [];
for (let i = 0; i < N_DEPTS; i++) deptIds.push(db.prepare('INSERT INTO departments (name, slug) VALUES (?, ?)').run('Dept' + i, 'dept' + i).lastInsertRowid);
const users = [];
const uins = db.prepare('INSERT INTO users (username, display_name, password_hash, role, all_departments) VALUES (?,?,?,?,0)');
const mins = db.prepare('INSERT OR IGNORE INTO user_departments (user_id, department_id) VALUES (?,?)');
db.transaction(() => {
  for (let i = 0; i < N_USERS; i++) {
    const id = uins.run('u' + i, 'u' + i, 'x', 'edit').lastInsertRowid;
    const k = 1 + rnd(3);
    const mine = new Set();
    for (let j = 0; j < k; j++) mine.add(deptIds[rnd(N_DEPTS)]);
    for (const d of mine) mins.run(id, d);
    users.push({ role: 'edit', id, depts: [...mine] });
  }
})();
const admin = { role: 'admin', id: uins.run('admin', 'admin', 'x', 'admin').lastInsertRowid };
// a member viewer in ~2 departments (the join-active case)
const member = users.find(u => u.depts.length >= 2) || users[0];

const typeId = db.prepare("INSERT INTO document_types (name, slug, built_in) VALUES ('Invoice','invoice',1)").run().lastInsertRowid;
const STATUS = ['confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'needs_review', 'deferred', 'error', 'deleted'];
const dins = db.prepare("INSERT INTO documents (original_filename, folder_path, status, supplier_name, reference_number, document_type_id) VALUES (?, '/in', ?, ?, ?, ?)");
const ddins = db.prepare('INSERT OR IGNORE INTO document_departments (document_id, department_id) VALUES (?, ?)');
let tagged = 0;
const t0 = Date.now();
db.transaction(() => {
  for (let i = 0; i < N; i++) {
    const st = STATUS[rnd(STATUS.length)];
    const id = dins.run('doc' + i + '.pdf', st, 'Supplier ' + (i % 500), 'REF-' + i, typeId).lastInsertRowid;
    if (Math.random() < 0.6) { const k = 1 + rnd(3); for (let j = 0; j < k; j++) ddins.run(id, deptIds[rnd(N_DEPTS)]); tagged++; }
  }
})();
console.log(`corpus: ${N} docs (${tagged} tagged, ${N - tagged} shared), ${N_DEPTS} depts, ${N_USERS} users — built in ${Date.now() - t0}ms`);
console.log(`member viewer u${member.id} in ${member.depts.length} departments\n`);

// ── timing ──
function med(fn, reps = 5) {
  const t = [];
  for (let i = 0; i < reps; i++) { const s = process.hrtime.bigint(); fn(); t.push(Number(process.hrtime.bigint() - s) / 1e6); }
  t.sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];
}
const allIds = db.prepare('SELECT id FROM documents LIMIT 2000').all().map(r => r.id);
const readers = {
  'search(confirmed)':   (v) => documents.search(db, { viewer: v }),
  'getReviewQueue':      (v) => documents.getReviewQueue(db, v),
  'getReviewCount':      (v) => documents.getReviewCount(db, v),
  'getReviewSplit':      (v) => documents.getReviewSplit(db, v),
  'getDeferredQueue':    (v) => documents.getDeferredQueue(db, v),
  'getDeferredCount':    (v) => documents.getDeferredCount(db, v),
  'getStuckQueue':       (v) => documents.getStuckQueue(db, v),
  'getStuckCount':       (v) => documents.getStuckCount(db, v),
  'getDeletedQueue':     (v) => documents.getDeletedQueue(db, v),
  'getByIds(2000)':      (v) => documents.getByIds(db, allIds, v),
  'getConfirmedByIds':   (v) => documents.getConfirmedDocsByIds(db, allIds, v),
};

console.log('reader                 member(ms)  admin/base(ms)  system(ms)   member/base');
console.log('─'.repeat(78));
let worstAbs = 0, worstMeaningfulRatio = 0, worstRName = '';
for (const [name, fn] of Object.entries(readers)) {
  const m = med(() => fn(member));
  const a = med(() => fn(admin));            // admin → visibleDocSql '' = the pre-D7 fast path baseline
  const s = med(() => fn(dv.SYSTEM_ACTOR));
  const ratio = a > 0.05 ? m / a : (m < 0.5 ? 1 : 99);
  if (m > worstAbs) worstAbs = m;
  // A ratio only matters when the baseline is NON-TRIVIAL — a x10 ratio on a 0.15ms count is meaningless
  // (both are instant). Judge the join filter's real cost only on readers that take real time.
  if (a >= 2 && ratio > worstMeaningfulRatio) { worstMeaningfulRatio = ratio; worstRName = name; }
  console.log(`${name.padEnd(22)} ${m.toFixed(2).padStart(9)} ${a.toFixed(2).padStart(13)} ${s.toFixed(2).padStart(12)} ${('x' + ratio.toFixed(2)).padStart(13)}`);
}

// per-doc gate (canAccessDocument) — 2000 calls, member viewer
const probe = db.prepare('SELECT id FROM documents ORDER BY RANDOM() LIMIT 2000').all().map(r => r.id);
const perDoc = med(() => { for (const id of probe) access.canAccessDocument(db, member, id); }, 3);
console.log(`\nper-doc canAccessDocument × 2000 (member): ${perDoc.toFixed(1)}ms total = ${(perDoc / 2000 * 1000).toFixed(1)}µs/call`);

const perCallUs = perDoc / 2000 * 1000;
console.log(`\nworst absolute list-reader (member): ${worstAbs.toFixed(1)}ms; worst join-filter ratio on a non-trivial reader: x${worstMeaningfulRatio.toFixed(2)} (${worstRName || 'none'})`);
// Gate: every list reader stays fast in absolute terms at scale, the join filter costs < 3x the empty fragment
// on readers that do real work, and a single per-doc access check is sub-millisecond.
const PASS = worstAbs < 150 && worstMeaningfulRatio < 3 && perCallUs < 1000;
console.log(`budget: worstAbs<150ms (${worstAbs.toFixed(1)}), meaningful ratio<3 (x${worstMeaningfulRatio.toFixed(2)}), per-doc<1000µs (${perCallUs.toFixed(0)})`);
console.log(PASS ? '\nPERF PASS' : '\nPERF FAIL (a reader regressed — investigate indexes / the EXISTS shape)');
process.exit(PASS ? 0 : 1);
