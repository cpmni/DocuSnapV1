// test_logo_crossplant_guard.js — pins the saveLogoFingerprint CROSS-PLANT GUARD (Oracle 2026-07-12):
// stops the logo-collision poisoning loop (a Thornbury "TF" mark being planted under Cascade). Refuse
// an INSERT-new phash under X when it's decisively CLOSER (> MARGIN bits) to a DIFFERENT supplier's
// print than to X's own — BUT always plant a supplier's first-ever print, never touch the UPDATE
// (match_count++) branch, and let an explicit manual assignment bypass.
//
// Run with Electron-as-Node (native better-sqlite3 ABI):
//   ELECTRON_RUN_AS_NODE=1 NODE_PATH=.../node_modules electron test_logo_crossplant_guard.js
const path = require('path');
const Database = require('better-sqlite3');
const learning = require(path.join(__dirname, 'learning.js'));

let fails = 0;
const check = (name, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + name); if (!cond) fails++; };

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE logo_fingerprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT, phash TEXT, ahash TEXT, detail_hash TEXT,
    match_count INTEGER DEFAULT 1, last_seen TEXT)`);
  return db;
}
const count = (db, s) => db.prepare('SELECT COUNT(*) c FROM logo_fingerprints WHERE supplier_name=?').get(s).c;
const mcount = (db, s, ph) => db.prepare('SELECT match_count m FROM logo_fingerprints WHERE supplier_name=? AND phash=?').get(s, ph)?.m;

// 16-hex (64-bit) phashes with controlled bit distances. hammingDistance is per-hex-digit bit XOR.
const C  = '0000000000000000';   // Cascade own print
const T  = 'ffff000000000000';   // Thornbury own print — 16 bits from C
const P_TF   = 'ffff000000000001';   // NEW, ~Thornbury: dist(T)=1, dist(C)=17  → cross-plant
const P_CASC = '00000000ffff0000';   // NEW, legit Cascade drift: dist(C)=16, dist(T)=32 → keep
const P_NEAR = '0000000000000003';   // dist(C)=2 (≤10) → UPDATE branch

function seed(db) {
  db.prepare('INSERT INTO logo_fingerprints (supplier_name, phash) VALUES (?,?)').run('Cascade Water Systems', C);
  db.prepare('INSERT INTO logo_fingerprints (supplier_name, phash) VALUES (?,?)').run('Thornbury Fasteners', T);
}

// 1 — cross-plant REFUSED
let db = freshDb(); seed(db);
let r = learning.saveLogoFingerprint(db, { supplier_name: 'Cascade Water Systems', phash: P_TF });
check('a NEW phash closer to Thornbury than to Cascade\'s own → REFUSED (no new Cascade row)',
      count(db, 'Cascade Water Systems') === 1);
check('  refusal reports the cross-plant reason + the closer supplier',
      r && r.skipped === true && r.reason === 'cross_plant' && r.closerTo === 'Thornbury Fasteners');
check('  Thornbury\'s set is NOT touched', count(db, 'Thornbury Fasteners') === 1);

// 2 — legit same-supplier drift PLANTED
db = freshDb(); seed(db);
learning.saveLogoFingerprint(db, { supplier_name: 'Cascade Water Systems', phash: P_CASC });
check('a NEW phash closest to Cascade\'s own (not a rival) → PLANTED (Cascade now has 2)',
      count(db, 'Cascade Water Systems') === 2);

// 3 — first-ever print BOOTSTRAPPED (guard must not block a brand-new supplier)
db = freshDb(); seed(db);
learning.saveLogoFingerprint(db, { supplier_name: 'Newco Ltd', phash: T });   // identical to Thornbury's mark
check('a supplier\'s FIRST-EVER print is always planted, even if it resembles a rival',
      count(db, 'Newco Ltd') === 1);

// 4 — UPDATE (match_count++) branch UNTOUCHED
db = freshDb(); seed(db);
learning.saveLogoFingerprint(db, { supplier_name: 'Cascade Water Systems', phash: P_NEAR });
check('a NEW phash within 10 of an own print → increments match_count (no new row)',
      count(db, 'Cascade Water Systems') === 1 && mcount(db, 'Cascade Water Systems', C) === 2);

// 5 — explicit MANUAL assignment BYPASSES the guard (operator authority)
db = freshDb(); seed(db);
learning.saveLogoFingerprint(db, { supplier_name: 'Cascade Water Systems', phash: P_TF, manual: true });
check('manual:true bypasses the guard → the print IS planted under the operator\'s chosen supplier',
      count(db, 'Cascade Water Systems') === 2);

// ── C1 (Oracle 2026-07-15): DETAIL-space cross-plant guard on BOTH enrolment branches ──────────────
// Once the 256-bit detail hash is a PRIMARY picker, a poisoned enrolled mark flips a real PICK (mis-file).
// The collide-at-8 COALESCE backfill branch pre-empts the coarse insert guard, so it MUST be gated too.
function at(d) {                                   // 64-hex (256-bit) detail hash at Hamming d from base
  const full = Math.floor(d / 4), rem = d % 4;
  const remHex = ['', '1', '3', '7'][rem];
  const s = 'f'.repeat(full) + remHex;
  return s + '0'.repeat(64 - s.length);
}
const D_N = at(0);          // Northgate's enrolled detail mark
const D_C = at(100);        // Cascade's own detail mark — far (100) from Northgate's
const detailOf = (db, ph) => db.prepare('SELECT detail_hash dh FROM logo_fingerprints WHERE phash=?').get(ph)?.dh;

function seedDetail(db, cascadeDetail) {           // Cascade phash C (detail optional), Northgate T+D_N
  db.prepare('INSERT INTO logo_fingerprints (supplier_name, phash, detail_hash) VALUES (?,?,?)')
    .run('Cascade Water Systems', C, cascadeDetail || null);
  db.prepare('INSERT INTO logo_fingerprints (supplier_name, phash, detail_hash) VALUES (?,?,?)')
    .run('Thornbury Fasteners', T, D_N);
}

// 6 — COALESCE backfill (coarse collide) REFUSES a rival's detail (the poison path)
db = freshDb(); seedDetail(db, null);              // Cascade's detail is NULL (pre-migration row)
learning.saveLogoFingerprint(db, { supplier_name: 'Cascade Water Systems', phash: P_NEAR, detail_hash: D_N });
check('C1 backfill: a rival-matching detail is REFUSED → Cascade row detail stays NULL',
      detailOf(db, C) === null && mcount(db, 'Cascade Water Systems', C) === 2);

// 7 — COALESCE backfill ALLOWS a legit own detail far from every rival (cold-start safe)
db = freshDb(); seedDetail(db, null);
learning.saveLogoFingerprint(db, { supplier_name: 'Cascade Water Systems', phash: P_NEAR, detail_hash: D_C });
check('C1 backfill: a legit own detail (far from rivals) IS backfilled',
      detailOf(db, C) === D_C);

// 8 — INSERT branch nulls a rival detail (contradictory coarse-vs-detail evidence)
db = freshDb(); seedDetail(db, D_C);               // Cascade already has its own detail
learning.saveLogoFingerprint(db, { supplier_name: 'Cascade Water Systems', phash: P_CASC, detail_hash: D_N });
check('C1 insert: coarse-legit phash planted but a rival detail is nulled',
      count(db, 'Cascade Water Systems') === 2 && detailOf(db, P_CASC) === null);

// 9 — INSERT branch keeps a legit own detail
db = freshDb(); seedDetail(db, D_C);
learning.saveLogoFingerprint(db, { supplier_name: 'Cascade Water Systems', phash: P_CASC, detail_hash: D_C });
check('C1 insert: a legit own detail is kept on the new print',
      detailOf(db, P_CASC) === D_C);

// 10 — MANUAL bypasses the detail guard on the COALESCE branch (operator authority)
db = freshDb(); seedDetail(db, null);
learning.saveLogoFingerprint(db, { supplier_name: 'Cascade Water Systems', phash: P_NEAR, detail_hash: D_N, manual: true });
check('C1: manual:true bypasses the detail guard → the rival-looking detail IS planted',
      detailOf(db, C) === D_N);

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILED`);
process.exit(fails ? 1 : 0);
