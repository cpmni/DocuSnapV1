'use strict';
// Badge census for ref_badge_verify_state (mig 185). Over a COPY of a warm DB (never the original),
// for every confirmed doc's REFERENCE-role field, apply trust.refBadgeVerified and the renderer's badge
// rule, and tally how many confident refs stay green ("High") vs flip to the calm neutral "Read".
//
// Substrate note: a warm DB has REAL confirmed-scope history (drives the history leg faithfully) but NO
// corroboration records, so leg (a) is inert here — this census OVER-counts "Read" (real corroboration
// would turn more Read back to green). It is therefore a WORST-CASE nag measurement. Every warm doc is a
// correctly-confirmed value, so every flip here is a "calm nag" (not a caught misread) — exactly the
// alarm-fatigue side we need to bound. The flips-on-trained-scope count is the load-bearing gate (must be 0).
const path = require('path');
const Database = require('better-sqlite3');
const REPO = 'C:/GIT Projects/Docusnap';
const learning = require(path.join(REPO, 'database/modules/learning.js'));
const trust    = require(path.join(REPO, 'database/modules/trust.js'));

const dbPath = process.argv[2];
const db = new Database(dbPath, { readonly: true });

const formats = learning.getFieldFormats(db);   // default excludes provisional (<3)
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const confirmedCountFor = (sup, slug, refKey) => {
  const s = norm(sup), sl = String(slug || '').toLowerCase().trim();
  for (const g of formats) {
    if (g.field_key !== refKey) continue;
    if (String(g.document_type || '').toLowerCase().trim() !== sl) continue;
    if (norm(g.supplier_name) !== s) continue;   // supplier-scoped only
    return g.confirmed_count || 0;
  }
  return 0;
};

const types = new Map();
for (const t of db.prepare('SELECT id, slug, ref_field_key FROM document_types WHERE ref_field_key IS NOT NULL').all())
  types.set(t.id, { slug: t.slug, refKey: t.ref_field_key });

const docs = db.prepare("SELECT id, supplier_name, document_type_id FROM documents WHERE status='confirmed'").all();
const getExt = db.prepare('SELECT display_value, raw_value, confidence, corroboration, extraction_method FROM extractions WHERE document_id=? AND field_key=?');

let total = 0, confident = 0, verified = 0, flips = 0, flipsTrained = 0, flipsCold = 0;
let viaHistory = 0, viaMethod = 0, viaCorrob = 0;
let trainedRefs = 0, coldRefs = 0;
const AUTH = new Set(['manual', 'template_fixed', 'template_fixed_locked', 'keyword_override']);

for (const d of docs) {
  const t = types.get(d.document_type_id);
  if (!t || !t.refKey) continue;
  const ext = getExt.get(d.id, t.refKey);
  if (!ext) continue;
  const val = String(ext.display_value ?? ext.raw_value ?? '').trim();
  if (!val) continue;
  total++;
  const conf = ext.confidence;
  const isConfident = conf != null && conf >= 70;
  const cc = confirmedCountFor(d.supplier_name, t.slug, t.refKey);
  const trained = cc >= 3;
  if (trained) trainedRefs++; else coldRefs++;
  if (!isConfident) continue;               // renderer only re-badges conf>=70
  confident++;
  const doc = { supplier_name: d.supplier_name, type_slug: t.slug };
  const v = trust.refBadgeVerified(db, doc, t.refKey, ext, { formats });
  if (v) {
    verified++;
    // attribute why (corrob is structurally 0 on a warm DB)
    if (trust._corrobLicensed && trust._corrobLicensed(ext.corroboration)) viaCorrob++;
    else if (AUTH.has(String(ext.extraction_method || ''))) viaMethod++;
    else viaHistory++;
  } else {
    // conf>=70 && !verified => the renderer shows "Read"
    flips++;
    if (trained) flipsTrained++; else flipsCold++;
  }
}

const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '—';
console.log('=== Badge census: ref_badge_verify_state (warm DB, worst-case) ===');
console.log('DB:', dbPath);
console.log('confirmed docs with a non-empty ref value :', total);
console.log('  scope TRAINED (>=3 confirmed)            :', trainedRefs, '(' + pct(trainedRefs, total) + ')');
console.log('  scope COLD    (<3 confirmed)             :', coldRefs, '(' + pct(coldRefs, total) + ')');
console.log('confident refs (conf>=70)                 :', confident);
console.log('  stay GREEN "High" (verified)            :', verified, '(' + pct(verified, confident) + ')');
console.log('    via corroboration (leg a)             :', viaCorrob, '(0 expected on a warm DB)');
console.log('    via authoritative method (leg b)      :', viaMethod);
console.log('    via scope history >=3 (leg c)         :', viaHistory);
console.log('  flip to "Read" (unverified)             :', flips, '(' + pct(flips, confident) + ')');
console.log('    FLIPS ON A TRAINED SCOPE (must be 0)   :', flipsTrained, flipsTrained === 0 ? 'PASS' : '*** FAIL ***');
console.log('    flips on a cold scope                 :', flipsCold);
db.close();
process.exit(flipsTrained === 0 ? 0 : 1);
