'use strict';
/*
 * sweep_demo_gate.js — Catch-up Filing SLICE 4: the demo-corpus gate
 * (design docs/designs/CATCHUP_FILING_2026-07-31.md §Test plan: "Demo-corpus gate …
 * confirm K with GT, green-lit role values == GT; poisoned stored ref → never
 * green-lit; de-confirming the swept N restores the pre-sweep learning state;
 * graduation equals the K-human-only computation").
 *
 * Uses the BORN-DIGITAL demo corpus (Desktop\Demo Docs Digital + ground_truth.json —
 * the one demo corpus with per-doc VALUE GT), one Set-A supplier's invoices:
 *   1. COLD import through the REAL pipeline (process_docs.py, empty learning) into a
 *      fresh migrated DB — engine outputs stored as the docs' extraction rows.
 *   2. Confirm K=10 with GT values (HUMAN, reviewService.confirm — corrections where
 *      the cold engine disagreed with GT, exactly like an operator fixing a field).
 *   3. Sweep-evaluate the remainder: Tier 1 (stored rows vs the live gate) and a
 *      Tier-2-shaped consistency check (fresh WARM full re-extract through the same
 *      pipeline → evaluateSweepConsistency + the gate on the overlay).
 *      NOTE (honest): production Tier 2 re-reads the doc's CACHED ocr_text imageless
 *      (_reextractFastCore, its own suites); this gate's fresh side is a full WARM
 *      re-read — a STRICTER disagreement source for the same predicate. What this
 *      gate proves is the design's green-light claim: whatever green-lights, its
 *      role values equal GT.
 *   4. GATE: every green-lit doc's ref+date+supplier == GT (zero tolerance).
 *   5. POISON: corrupt one candidate's STORED ref → it must NEVER green-light
 *      (role-mismatch / gate refusal), on both tiers.
 *   6. Accept the green-lit docs ({via:'scope_sweep'}) → graduation still counts the
 *      K human confirms only; undo → learning state byte-equal to pre-sweep.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/sweep_demo_gate.js
 * Env: SUPPLIER=<name substring> TYPE=<slug, default invoice> K=<confirm count, default 10>
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const dbmod     = require(path.join(REPO, 'database', 'index.js'));
const doctypes  = require(path.join(REPO, 'database', 'modules', 'document_types.js'));
const documents = require(path.join(REPO, 'database', 'modules', 'documents.js'));
const learning  = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
const trust     = require(path.join(REPO, 'database', 'modules', 'trust.js'));
const { createReviewService } = require(path.join(REPO, 'src', 'services', 'reviewService.js'));
const { evaluateSweepConsistency, extractionsFingerprint } = require(path.join(REPO, 'src', 'services', 'sweepPredicate.js'));

const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROC = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const ROOT = path.join(process.env.USERPROFILE, 'Desktop', 'Demo Docs Digital');
const TYPE = (process.env.TYPE || 'invoice').toLowerCase();
const K = parseInt(process.env.K || '10', 10);

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; };
const normRef = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const normDate = s => String(s || '').replace(/[^0-9]/g, '');
const normSup = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sweepdemo-'));
const w = (tag, obj) => { const p = path.join(tmp, `${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(p, JSON.stringify(obj)); return p; };

// ── pick the supplier: the Set-A supplier with the most GT docs of TYPE ─────────────
const GT_ALL = JSON.parse(fs.readFileSync(path.join(ROOT, 'ground_truth.json'), 'utf8'));
const bySup = {};
for (const g of GT_ALL) {
  if (g.set !== 'A' || g.type_slug !== TYPE || g.clash) continue;
  if (process.env.SUPPLIER && !g.supplier.toLowerCase().includes(process.env.SUPPLIER.toLowerCase())) continue;
  (bySup[g.supplier] || (bySup[g.supplier] = [])).push(g);
}
const SUP = Object.keys(bySup).sort((a, b) => bySup[b].length - bySup[a].length)[0];
const gtDocs = (bySup[SUP] || []).filter(g => fs.existsSync(path.join(ROOT, g.file)));
console.log(`supplier: ${SUP} — ${gtDocs.length} ${TYPE} docs with GT (K=${K} human confirms, rest swept)`);
if (gtDocs.length < K + 3) { console.error('not enough docs for the gate'); process.exit(1); }

// ── fresh migrated DB ───────────────────────────────────────────────────────────────
const db = new Database(path.join(tmp, 'demo.db'));
dbmod.runMigrations(db);
try { dbmod.runJsMigrations(db); } catch { }
doctypes.seedBuiltInTypes(db);
const outRoot = path.join(tmp, 'out'); fs.mkdirSync(outRoot);
learning.setSetting(db, 'output_folder', outRoot);
// A tuned mid-life install: the operator has set the auto-file slider to 95 (default 100
// would hold every sub-perfect read regardless of the sweep — the graduation-bootstrap
// question is the integration fixture's job; THIS gate's question is the green-light
// predicate + values==GT). The learned template exists (learn-on-commit / template link
// in production) so the sub-100 structural gate has its template-matched premise.
learning.setSetting(db, 'auto_file_threshold', '95');
db.prepare("INSERT INTO templates (name, slug, document_type_slug) VALUES (?, ?, 'invoice')")
  .run('Demo Gate Supplier Invoice', 'demo-gate-supplier-invoice');
const TPL_ID = db.prepare('SELECT last_insert_rowid() AS id').get().id;
const dt = db.prepare('SELECT * FROM document_types WHERE slug = ?').get(TYPE);
const roleKeys = new Set(['supplier_name', dt.ref_field_key, dt.date_field_key].filter(Boolean));
const auditLog = [];
const svc = createReviewService({ audit: (dbh, ev) => auditLog.push(ev) });
const actor = { username: 'demo-gate' };

function docTypesWithFields() {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const d of dts) d.fields = byType[d.id] || [];
  return dts;
}
function snapArgs(warm) {
  const dts = docTypesWithFields();
  return ['--fields-file', w('f', dts.flatMap(d => d.fields)),
          '--hints-file', w('h', warm ? learning.getAllHints(db) : []),
          '--anchors-file', w('a', warm ? learning.getAllAnchors(db) : []),
          '--logos-file', w('l', warm ? learning.getAllLogos(db) : []),
          '--doc-types-file', w('d', dts),
          '--formats-file', w('fm', warm ? learning.getFieldFormats(db) : []),
          '--templates-file', w('t', warm ? templates.getAll(db) : []),
          '--label-overrides-file', w('lo', []), '--field-rules-file', w('fr', []),
          '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
}
function runPipeline(folder, files, warm) {
  return new Promise(res => {
    const p = spawn('py', ['-3.12', PROC, '--folder', folder, '--files-file', w('shard', files),
                           '--mode', 'fast', '--tesseract', TESS, ...snapArgs(warm)], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {});
    p.on('close', () => {
      const docs = {};
      for (const ln of out.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
      res(docs);
    });
    p.on('error', () => res({}));
  });
}

(async () => {
  // ── 1. COLD import through the real pipeline ─────────────────────────────────────
  const stage = path.join(tmp, 'stage'); fs.mkdirSync(stage);
  const fmap = {};
  for (const g of gtDocs) { const b = path.basename(g.file); fs.copyFileSync(path.join(ROOT, g.file), path.join(stage, b)); fmap[b] = g; }
  const cold = await runPipeline(stage, Object.keys(fmap), false);
  console.log(`\n§1 cold import: ${Object.keys(cold).length}/${gtDocs.length} processed`);

  const idByFile = {};
  for (const [fname, m] of Object.entries(cold)) {
    documents.insert(db, {
      original_filename: fname, folder_path: stage, document_type_id: dt.id,
      supplier_name: m.supplier_name || fmap[fname].supplier,
      overall_confidence: Math.round(m.overall_confidence || 0), status: 'needs_review',
      ocr_text: m.ocr_text || null,
    });
    const id = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    idByFile[fname] = id;
    for (const [k, e] of Object.entries(m.extractions || {})) {
      if (!e || typeof e !== 'object') continue;
      db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note, corrected_to)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, k, e.value ?? null, e.value ?? null, e.confidence ?? null, e.method || 'keyword', e.validation_note || null, e.corrected_to || null);
    }
  }

  // ── 2. confirm K with GT (human) ────────────────────────────────────────────────
  const names = Object.keys(idByFile).sort();
  const confirmNames = names.slice(0, K), sweepNames = names.slice(K);
  for (const fname of confirmNames) {
    const id = idByFile[fname], g = fmap[fname];
    const vals = {}; for (const r of db.prepare('SELECT field_key, display_value FROM extractions WHERE document_id = ?').all(id)) vals[r.field_key] = r.display_value;
    const corrections = {};
    const want = { supplier_name: g.supplier, [dt.ref_field_key]: g.ref, [dt.date_field_key]: g.date };
    for (const [k, v] of Object.entries(want)) {
      if (v != null && String(vals[k] || '') !== String(v)) { corrections[k] = { original_value: vals[k] || '', corrected_value: String(v) }; vals[k] = String(v); }
    }
    const res = await svc.confirm(db, actor, {
      document_id: id, allValues: vals, corrections, taught_fields: [],
      supplier_name: g.supplier, document_type: dt.name, document_type_slug: dt.slug, bulk: true,
    });
    if (!res || !res.ok) check(`human confirm ${fname} (${res && (res.code || res.error)})`, false);
  }
  const st0 = trust.scopeTrust(db, SUP, dt.slug);
  console.log(`\n§2 K=${K} human confirms with GT`);
  check(`graduation is the K-human-only computation (trusted=${st0.trusted}, count=${st0.confirmedCount})`,
        st0.confirmedCount === Math.min(K, 10) || st0.confirmedCount === K);

  // ── 2b. WARM-reprocess the still-queued docs (the production flow: the queue is
  // reprocessed / re-identified after the scope's confirms — the sweep design's stored
  // rows are the app's CURRENT rows, which carry the learned supplier, not the cold
  // first-contact blanks the letterhead hole leaves). The stored rows become the warm
  // read, exactly like reprocess-all's applyReprocessResult replaces them. ──
  const rewarm = await runPipeline(stage, sweepNames, true);
  for (const fname of sweepNames) {
    const m = rewarm[fname]; if (!m) continue;
    const id = idByFile[fname];
    db.prepare('UPDATE documents SET supplier_name = ?, overall_confidence = ?, template_id = ? WHERE id = ?')
      .run(m.supplier_name || null, Math.round(m.overall_confidence || 0), TPL_ID, id);
    db.prepare('DELETE FROM extractions WHERE document_id = ?').run(id);
    for (const [k, e] of Object.entries(m.extractions || {})) {
      if (!e || typeof e !== 'object') continue;
      db.prepare(`INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note, corrected_to)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, k, e.value ?? null, e.value ?? null, e.confidence ?? null, e.method || 'keyword', e.validation_note || null, e.corrected_to || null);
    }
  }

  // ── 3. sweep-evaluate the remainder (Tier 1 + a Tier-2-shaped consistency pass) ──
  console.log(`\n§3 sweep evaluation over ${sweepNames.length} queue docs`);
  const warm = await runPipeline(stage, sweepNames, true);
  const green = [], excluded = [];
  for (const fname of sweepNames) {
    const id = idByFile[fname];
    const doc = documents.getById(db, id);
    const rows = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(id);
    const fingerprint = extractionsFingerprint(rows);
    const t1 = trust.isAutoFileEligible(db, doc);
    if (t1.eligible) { green.push({ fname, id, tier: 1, fingerprint }); continue; }
    const fresh = warm[fname];
    if (!fresh) { excluded.push({ fname, reason: 'no-recheck' }); continue; }
    const verdict = evaluateSweepConsistency({
      storedRows: rows, freshFields: fresh.extractions || {}, roleKeys,
      storedSlug: dt.name, freshSlug: fresh.document_type || dt.name,
    });
    if (!verdict.pass) { excluded.push({ fname, reason: verdict.reason, field: verdict.field }); continue; }
    const synth = { id, document_type_id: dt.id, supplier_name: doc.supplier_name,
                    overall_confidence: Math.round(Number(fresh.overall_confidence) || 0) };
    const gate = trust.isAutoFileEligible(db, synth, { extractions: verdict.overlay });
    if (gate.eligible) green.push({ fname, id, tier: 2, fingerprint });
    else excluded.push({ fname, reason: gate.reason });
  }
  console.log(`  green-lit ${green.length} (tier1 ${green.filter(g => g.tier === 1).length} / tier2 ${green.filter(g => g.tier === 2).length}) · excluded ${excluded.length}`);
  for (const e of excluded.slice(0, 12)) console.log(`    excluded ${e.fname}: ${e.reason}${e.field ? ':' + e.field : ''}`);

  // ── 4. GATE: green-lit role values == GT ────────────────────────────────────────
  console.log('\n§4 green-lit role values == GT (zero tolerance)');
  let wrong = 0;
  for (const c of green) {
    const g = fmap[c.fname];
    const vals = {}; for (const r of db.prepare('SELECT field_key, display_value FROM extractions WHERE document_id = ?').all(c.id)) vals[r.field_key] = r.display_value;
    const bad = [];
    if (normSup(vals.supplier_name) !== normSup(g.supplier)) bad.push(`supplier '${vals.supplier_name}'≠'${g.supplier}'`);
    if (g.ref != null && normRef(vals[dt.ref_field_key]) !== normRef(g.ref)) bad.push(`ref '${vals[dt.ref_field_key]}'≠'${g.ref}'`);
    if (g.date != null && normDate(vals[dt.date_field_key]) !== normDate(g.date)) bad.push(`date '${vals[dt.date_field_key]}'≠'${g.date}'`);
    if (bad.length) { wrong++; console.log(`    WRONG ${c.fname} (tier ${c.tier}): ${bad.join(' · ')}`); }
  }
  check(`every green-lit doc matches GT on supplier+ref+date (${green.length - wrong}/${green.length})`, wrong === 0);
  check('the sweep green-lit at least one doc (a zero-green gate proves nothing)', green.length >= 1);

  // ── 5. POISON: a corrupted stored ref must NEVER green-light ────────────────────
  console.log('\n§5 poisoned stored ref → never green-lit');
  if (!green.length) {
    console.log('  (skipped — nothing green-lit; the §4 gate above already failed this run)');
    try { db.close(); } catch { }
    console.log(`\n${fails} FAILED`);
    process.exit(1);
  }
  const victim = green[0];
  db.prepare('UPDATE extractions SET display_value = ?, raw_value = ? WHERE document_id = ? AND field_key = ?')
    .run('ZZ-0000', 'ZZ-0000', victim.id, dt.ref_field_key);
  {
    const doc = documents.getById(db, victim.id);
    const rows = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(victim.id);
    const t1 = trust.isAutoFileEligible(db, doc);
    let poisonGreen = false, why = t1.reason;
    if (t1.eligible) {
      // Tier 1 passing on a poisoned ref would be a GATE hole — but the design's wall is
      // Tier 2: the fresh re-read of the page cannot echo the poison → role-mismatch.
      const fresh = warm[victim.fname];
      const verdict = evaluateSweepConsistency({ storedRows: rows, freshFields: (fresh && fresh.extractions) || {}, roleKeys, storedSlug: dt.name, freshSlug: (fresh && fresh.document_type) || dt.name });
      poisonGreen = verdict.pass; why = verdict.reason;
    }
    check(`the poisoned doc is excluded (${why})`, !poisonGreen);
    // restore the true stored value for the accept below
    const g = fmap[victim.fname];
    db.prepare('UPDATE extractions SET display_value = ?, raw_value = ? WHERE document_id = ? AND field_key = ?')
      .run(String(g.ref), String(g.ref), victim.id, dt.ref_field_key);
  }

  // ── 6. accept + graduation-exclusion + undo restores learning ───────────────────
  console.log('\n§6 accept (via scope_sweep) → graduation unchanged → undo restores learning');
  const learnPre = JSON.stringify(learning.getFieldFormats(db));
  const filed = [];
  for (const c of green) {
    const doc = documents.getById(db, c.id);
    const rows = db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(c.id);
    const vals = {}; for (const r of rows) vals[r.field_key] = r.display_value ?? r.raw_value;
    const res = await svc.confirm(db, actor, {
      document_id: c.id, allValues: vals, corrections: {}, taught_fields: [],
      supplier_name: doc.supplier_name, document_type: dt.name, document_type_slug: dt.slug, bulk: true,
    }, { via: 'scope_sweep' });
    if (res && res.ok) filed.push(c.id);
  }
  check(`accepted docs filed via the one shared confirm (${filed.length}/${green.length})`, filed.length === green.length);
  const st1 = trust.scopeTrust(db, SUP, dt.slug);
  check(`graduation window still the K-human-only computation after the sweep (count=${st1.confirmedCount})`,
        st1.confirmedCount === st0.confirmedCount);
  for (const id of filed) {
    const row = db.prepare('SELECT status, confirmed_via FROM documents WHERE id = ?').get(id);
    if (row.status === 'confirmed' && row.confirmed_via === 'scope_sweep') documents.deconfirmDocument(db, id);
  }
  check('undo returns every swept doc to the queue',
        db.prepare(`SELECT COUNT(*) n FROM documents WHERE id IN (${filed.join(',')}) AND status = 'needs_review'`).get().n === filed.length);
  check('learning state (field formats) restored BYTE-EQUAL to pre-sweep',
        JSON.stringify(learning.getFieldFormats(db)) === learnPre);

  try { db.close(); } catch { }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
  console.log(`\n${fails ? fails + ' FAILED' : 'All sweep demo-corpus gate checks passed.'}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('DEMO GATE ERROR:', e); process.exit(1); });
