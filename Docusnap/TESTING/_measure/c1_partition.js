// Oracle C1: partition the blocked docs by the ACTUAL refusal mechanism before building anything.
const db = require('better-sqlite3')(process.argv[2], {readonly:true});
const trust = require('C:/GIT Projects/Docusnap/database/modules/trust.js');
const learning = require('C:/GIT Projects/Docusnap/database/modules/learning.js');
const { normaliseForTokens } = require('C:/GIT Projects/Docusnap/database/modules/text_normalise.js');
const norm = s => String(s||'').toLowerCase().trim().replace(/\s+/g,' ');   // the gate's weak _norm
const fmts = learning.getFieldFormats(db) || [];
const pick = (sup, slug, key) => {
  const s = String(sup||'').toLowerCase().trim(), d = String(slug||'').toLowerCase().trim();
  const own = fmts.find(f => f.field_key===key && String(f.supplier_name||'').toLowerCase().trim()===s && String(f.document_type||'').toLowerCase().trim()===d);
  if (own) return { f: own, scope: 'supplier' };
  const pooled = fmts.find(f => f.field_key===key && !String(f.supplier_name||'').trim() && String(f.document_type||'').toLowerCase().trim()===d);
  return pooled ? { f: pooled, scope: 'POOLED' } : { f: null, scope: 'none' };
};
const docs = db.prepare("SELECT * FROM documents WHERE status='needs_review'").all();
const ex = db.prepare("SELECT display_value FROM extractions WHERE document_id=? AND field_key='supplier_name'");
const cases = {}; const rows = [];
for (const d of docs) {
  const v = trust.isAutoFileEligible(db, d);
  if (v.eligible || !String(v.reason||'').startsWith('unverifiable-value:supplier_name')) continue;
  const dt = db.prepare('SELECT slug FROM document_types WHERE id=?').get(d.document_type_id) || {};
  const val = String((ex.get(d.id)||{}).display_value || '').trim();
  const { f, scope } = pick(d.supplier_name, dt.slug, 'supplier_name');
  const samples = f ? (f.sample_values || Object.keys(f.value_counts || {})) : [];
  const cls = f ? trust.classifyLearnedShape(samples) : null;
  const litWeak   = samples.some(s => norm(s) === norm(val));
  const litStrong = samples.some(s => normaliseForTokens(s) === normaliseForTokens(val));
  let c;
  if (!f)                          c = '(ii) no format group at all';
  else if (scope === 'POOLED')     c = '(i) <3 in-scope confirms → POOLED cross-company group';
  else if (cls === 'freetext')     c = '(iii) genuine freetext (3+ distinct variants in scope)';
  else if (!litWeak && litStrong)  c = '(iv-a) constant, weak-norm miss but PUNCTUATION-fold match';
  else if (!litWeak)               c = '(iv-b) constant, literal genuinely differs';
  else                             c = '(v) UNEXPLAINED — verifies here but the gate refused';
  cases[c] = (cases[c]||0)+1;
  if (rows.length < 6) rows.push({ f: d.original_filename, val, scope, cls, samples: samples.slice(0,2), litWeak, litStrong });
}
console.log('PARTITION of docs refused on supplier_name:');
for (const [k,n] of Object.entries(cases).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(n).padStart(3)}  ${k}`);
console.log('\nexemplars:');
rows.forEach(r => console.log(`  ${r.f}\n     value=${JSON.stringify(r.val)} scope=${r.scope} cls=${r.cls} samples=${JSON.stringify(r.samples)} weakEq=${r.litWeak} strongEq=${r.litStrong}`));
