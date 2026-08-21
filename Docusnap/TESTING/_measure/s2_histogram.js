// Slice 2 (Tier 1.5 fc recompute) go/no-go histogram — Oracle 2026-08-21 gate (a).
// For every needs_review doc: current isAutoFileEligible reason → reason AFTER a persisted
// recompute overall = clamp(base + fc(today), ≤99). `base` is re-derived from the STORED rows
// (validator.overall_confidence twin) and cross-checked against the stored overall so an
// unverifiable base is reported, never trusted. READ-ONLY: run on a COPY of the sandbox DB.
// Usage: node s2_histogram.js <db-copy> [--scope "Supplier|slug"]
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');

const dbPath = process.argv[2];
if (!dbPath) { console.error('usage: s2_histogram.js <db>'); process.exit(2); }
const db = new Database(dbPath);
const ROOT = path.join(__dirname, '..', '..');
const learning = require(path.join(ROOT, 'database/modules/learning'));
const trust = require(path.join(ROOT, 'database/modules/trust'));

// ── the same formats Python receives (handler.js:1277) → the REAL index via Python ──────────
const formats = learning.getFieldFormats(db, { includeProvisional: true });
const tmpF = path.join(os.tmpdir(), `s2_formats_${process.pid}.json`);
const tmpO = path.join(os.tmpdir(), `s2_supported_${process.pid}.json`);
fs.writeFileSync(tmpF, JSON.stringify(formats));
const pyOut = execFileSync('py', ['-3.12', path.join(__dirname, 's2_supported.py'), tmpF, tmpO], { encoding: 'utf-8' });
const supported = JSON.parse(fs.readFileSync(tmpO, 'utf-8'));
fs.unlinkSync(tmpF); fs.unlinkSync(tmpO);

// validator.format_consistency_adjustment twin (validator.py:905-932)
function fcAdjust(signals) {
  const present = signals.length;
  if (!present) return 0;
  const mism = signals.filter(s => s.mismatch).length;
  if (mism) return -Math.min(25, 12 + 6 * (mism - 1));
  const sup = signals.filter(s => s.supported).length;
  if (present >= 3 && sup >= 2) return Math.min(10, 3 * sup);
  return 0;
}
const clamp = v => Math.max(0, Math.min(100, v));

const thr = parseInt(learning.getSetting(db, 'auto_file_threshold', '100'), 10);
const excl = learning.getSetting(db, 'learning_exclude_machine_confirms', 'false');
console.log(`auto_file_threshold=${thr}  learning_exclude_machine_confirms=${excl}  ${pyOut.trim()}`);

const docs = db.prepare("SELECT * FROM documents WHERE status = 'needs_review' ORDER BY id").all();
const fieldsStmt = db.prepare('SELECT key, required FROM fields WHERE document_type_id = ? AND enabled = 1');
const rowsStmt = db.prepare('SELECT field_key, display_value, confidence, validation_note, corrected_to FROM extractions WHERE document_id = ?');
const dtStmt = db.prepare('SELECT slug FROM document_types WHERE id = ?');

const hist = {};           // "before → after" → count
const perScope = {};       // scope → {held, lifted, reasons}
const baseCheck = { fc0: 0, fcT: 0, none: 0, untyped: 0 };
const liftedRows = [];
for (const doc of docs) {
  const dt = doc.document_type_id ? dtStmt.get(doc.document_type_id) : null;
  const slug = dt ? dt.slug : null;
  const scopeKey = `${String(doc.supplier_name || '').toLowerCase().trim()}|${String(slug || '').toLowerCase().trim()}`;
  const before = trust.isAutoFileEligible(db, doc, { formats });
  let after = before, newOverall = doc.overall_confidence, base = null, match = 'untyped';
  if (dt) {
    const fields = fieldsStmt.all(doc.document_type_id);
    const keyFields = (fields.filter(f => f.required).length ? fields.filter(f => f.required) : fields).map(f => f.key);
    const rows = Object.fromEntries(rowsStmt.all(doc.id).map(r => [r.field_key, r]));
    const scores = [];
    const sigToday = [], sigNone = [];
    const supToday = new Set(supported[scopeKey] || []);
    for (const k of keyFields) {
      const r = rows[k];
      const valued = r && String(r.display_value || '').trim();
      if (valued) {
        scores.push(r.confidence || 0);
        const mism = !!String(r.validation_note || '').trim();
        sigToday.push({ mismatch: mism, supported: supToday.has(k) });
        sigNone.push({ mismatch: mism, supported: false });
      } else scores.push(0);
    }
    base = scores.length ? Math.floor(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const stored = doc.overall_confidence || 0;
    // which import-time supported set reproduces the stored overall?
    if (clamp(base + fcAdjust(sigNone)) === stored) match = 'fc0';
    else if (clamp(base + fcAdjust(sigToday)) === stored) match = 'fcT';
    else match = 'none';
    const fcT = fcAdjust(sigToday);
    newOverall = Math.min(99, clamp(base + fcT));
    after = trust.isAutoFileEligible(db, { ...doc, overall_confidence: newOverall }, { formats });
  }
  baseCheck[match]++;
  const key = `${before.reason} → ${after.reason}`;
  hist[key] = (hist[key] || 0) + 1;
  const ps = perScope[scopeKey] = perScope[scopeKey] || { held: 0, lifted: 0, before: {}, after: {}, floor: before.floor };
  ps.held++;
  ps.before[before.reason] = (ps.before[before.reason] || 0) + 1;
  ps.after[after.reason] = (ps.after[after.reason] || 0) + 1;
  if (!before.eligible && after.eligible) {
    ps.lifted++;
    liftedRows.push({ id: doc.id, file: doc.original_filename, scope: scopeKey, stored: doc.overall_confidence, base, newOverall, baseMatch: match, floor: after.floor });
  }
}

console.log(`\nHELD (needs_review): ${docs.length}`);
console.log('\nREASON before → after:');
for (const [k, v] of Object.entries(hist).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log(`\nbase re-derivation vs stored overall: reproduced-with-supported=∅ ${baseCheck.fc0} · reproduced-with-supported=today ${baseCheck.fcT} · NOT reproduced ${baseCheck.none} · untyped ${baseCheck.untyped}`);
const lifted = liftedRows.length;
console.log(`\nLIFTED past the gate by the recompute: ${lifted}/${docs.length} = ${docs.length ? (100 * lifted / docs.length).toFixed(1) : 0}%  (Oracle bar: <20% ⇒ DO NOTHING)`);
console.log('\nPER SCOPE:');
for (const [k, v] of Object.entries(perScope).sort((a, b) => b[1].held - a[1].held))
  console.log(`  ${k.padEnd(48)} held ${String(v.held).padStart(3)} lifted ${String(v.lifted).padStart(3)} floor ${v.floor}  before ${JSON.stringify(v.before)}  after ${JSON.stringify(v.after)}`);
if (lifted) {
  console.log('\nLIFTED DOCS:');
  for (const r of liftedRows) console.log(`  #${r.id} ${String(r.file).padEnd(40)} ${r.scope.padEnd(40)} stored ${r.stored} base ${r.base} → ${r.newOverall} (floor ${r.floor}, base ${r.baseMatch})`);
}
