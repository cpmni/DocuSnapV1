'use strict';
/*
 * census_rewrite_markers.js — Oracle S0-C2: what does the rewrite-marker exclusion COST?
 * READ-ONLY on the database given (copies to a temp file before flipping anything).
 *
 * Slice 0 removes rows a REWRITE created from the two corpora that judge rewrites. Unlike the three
 * unconditional marker clauses it SHRINKS live corpora (`+snapped` rows date from July), and a
 * shrunk corpus can make a field unverifiable and DE-GRADUATE a scope. The shrink direction is
 * fail-safe — a vanished group means the sub-100 gate refuses, i.e. more review, never a wrong file
 * — but the flip is not licensed until the cost is on the table.
 *
 * Reports: how many rows carry each marker; groups that DIE; shape classes that FLIP; scopes whose
 * scopeTrust changes; and the confirm-time prefix models that change verdict.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 electron.exe census_rewrite_markers.js <db>
 */
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const trust    = require(path.join(REPO, 'database', 'modules', 'trust.js'));

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) { console.error('usage: census_rewrite_markers <db>'); process.exit(2); }
const tmp = path.join(os.tmpdir(), `cens_rw_${Date.now()}.db`);
fs.copyFileSync(SRC, tmp);
const db = new Database(tmp);

const MARKERS = ['+snapped', '+snap_corrob', '+name_corrob_adopt', '+prefix_confusable_adopt'];
console.log(`\n=== ROWS CARRYING A REWRITE MARKER (${path.basename(SRC)}) ===`);
let any = 0;
for (const m of MARKERS) {
  const r = db.prepare(`SELECT COUNT(*) c FROM extractions e JOIN documents d ON d.id = e.document_id
                         WHERE d.status='confirmed' AND e.extraction_method LIKE ?`).get(`%${m}%`).c;
  const withCorr = db.prepare(`SELECT COUNT(*) c FROM extractions e JOIN documents d ON d.id = e.document_id
                                JOIN corrections c2 ON c2.document_id = e.document_id AND c2.field_key = e.field_key
                               WHERE d.status='confirmed' AND e.extraction_method LIKE ?`).get(`%${m}%`).c;
  any += r;
  console.log(`  ${m.padEnd(26)} ${String(r).padStart(5)} confirmed rows   (${withCorr} re-admitted by a human correction)`);
}
if (!any) console.log('  none — this database predates the markers, so slice 0 is a no-op on it');

const key = g => `${String(g.supplier_name || '(all)').trim()}|${g.document_type}|${g.field_key}`;
const snapshot = () => {
  const m = new Map();
  for (const g of (learning.getFieldFormats(db) || [])) {
    m.set(key(g), { n: g.confirmed_count, distinct: (g.sample_values || []).length,
                    prov: !!g.provisional });
  }
  return m;
};
const set = (k, v) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?) '
  + 'ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);

set('learning_exclude_rewrite_markers', 'false');
const before = snapshot();
set('learning_exclude_rewrite_markers', 'true');
const after = snapshot();

const died = [...before.keys()].filter(k => !after.has(k));
const shrank = [...after.keys()].filter(k => before.has(k) && after.get(k).n < before.get(k).n);
const flipped = [...after.keys()].filter(k => before.has(k) && after.get(k).prov !== before.get(k).prov);

console.log(`\n=== GROUPS ===`);
console.log(`  before ${before.size}   after ${after.size}   DIED ${died.length}   shrank ${shrank.length}`);
for (const k of died.slice(0, 20)) console.log(`  DIED   ${k}  (was n=${before.get(k).n})`);
for (const k of shrank.slice(0, 20)) console.log(`  shrank ${k}  ${before.get(k).n} -> ${after.get(k).n}`);
console.log(`\n=== SOLID/PROVISIONAL FLIPS (a shape model appearing or vanishing) ===`);
console.log(`  ${flipped.length}` + (flipped.length ? '  <-- these change what the sub-100 gate can verify' : ''));
for (const k of flipped.slice(0, 20)) console.log(`  ${k}  provisional ${before.get(k).prov} -> ${after.get(k).prov}`);

console.log(`\n=== DE-GRADUATION CENSUS (scopeTrust) ===`);
const scopes = db.prepare(`SELECT DISTINCT d.supplier_name sup, t.slug slug FROM documents d
  JOIN document_types t ON t.id = d.document_type_id
  WHERE d.status='confirmed' AND TRIM(COALESCE(d.supplier_name,'')) <> ''`).all();
let diff = 0;
for (const s of scopes) {
  set('learning_exclude_rewrite_markers', 'false');
  const a = trust.scopeTrust(db, s.sup, s.slug);
  set('learning_exclude_rewrite_markers', 'true');
  const b = trust.scopeTrust(db, s.sup, s.slug);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    diff++;
    console.log(`  DIFFERS ${s.sup} | ${s.slug}\n    OFF ${JSON.stringify(a)}\n    ON  ${JSON.stringify(b)}`);
  }
}
console.log(`  scopes ${scopes.length}, differing ${diff}`);

console.log(`\n=== CONFIRM-TIME PREFIX MODELS (getPrefixModelForScope, the S0-C1 twin) ===`);
let pdiff = 0;
const fields = db.prepare(`SELECT DISTINCT d.supplier_name sup, t.slug slug, e.field_key fk
  FROM documents d JOIN document_types t ON t.id = d.document_type_id
  JOIN extractions e ON e.document_id = d.id
  WHERE d.status='confirmed' AND TRIM(COALESCE(d.supplier_name,'')) <> ''`).all();
for (const f of fields) {
  set('learning_exclude_rewrite_markers', 'false');
  const a = learning.getPrefixModelForScope(db, f.sup, f.slug, f.fk);
  set('learning_exclude_rewrite_markers', 'true');
  const b = learning.getPrefixModelForScope(db, f.sup, f.slug, f.fk);
  const norm = r => r ? `${r.dominant}:${r.total}` : 'null';
  if (norm(a) !== norm(b)) { pdiff++; console.log(`  ${f.sup} | ${f.slug} | ${f.fk}: ${norm(a)} -> ${norm(b)}`); }
}
console.log(`  fields ${fields.length}, differing ${pdiff}`);

console.log(`\nVERDICT: ${died.length === 0 && flipped.length === 0 && diff === 0
  ? 'safe to flip on this corpus — nothing dies, no shape flips, no de-graduation'
  : 'HOLD — investigate the rows above before flipping'}`);

db.close(); fs.unlinkSync(tmp);
