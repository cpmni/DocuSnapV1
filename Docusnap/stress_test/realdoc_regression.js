'use strict';
/*
 * realdoc_regression.js — REAL-DOC regression corpus.
 *
 * Reprocesses the user's own CONFIRMED documents through the live pipeline and scores the
 * result against their CONFIRMED (ground-truth) values, so the exact real cases that exposed
 * bugs (City Office et al.) are permanently guarded: a code change that makes the pipeline
 * mis-read a doc it previously filed correctly shows up here as a regression.
 *
 * PRIVACY / SAFETY (this touches real business data):
 *   - The live DB is opened STRICTLY READ-ONLY; doc-types are read via direct SQL to avoid
 *     getAllWithFields' repair WRITE. The DB is never modified.
 *   - Files are copied to a TEMP dir, reprocessed, and the temp dir is deleted.
 *   - Output (which contains real values) goes only to stress_test/out/ (gitignored). NEVER
 *     commit it. This script itself carries no data — safe to commit.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/realdoc_regression.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap', ST = path.join(REPO, 'stress_test');
const OUT = path.join(ST, 'out'), CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
// RR_DB: optional DB override for same-corpus A/Bs against a MODIFIED COPY (e.g. the
// logo-detail backfill activation gate, Oracle C5 2026-07-23). Absent ⇒ the live DB, unchanged.
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
const trust = require(path.join(REPO, 'database', 'modules', 'trust.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
// GT overrides: docs whose CONFIRMED value was poisoned during testing (mis-confirmed page
// numbers / transpositions). Corrects the harness's EXPECTED value to the true value (per the
// original filename), so the M gate reflects true pipeline soundness — WITHOUT mutating the DB.
// See stress_test/gt_overrides.json. Ignored (all reads scored vs raw DB) if the file is absent.
let GT_OVERRIDES = {}; try { GT_OVERRIDES = JSON.parse(fs.readFileSync(path.join(ST, 'gt_overrides.json'), 'utf8')); } catch {}

const normSupplier = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normRef = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const normMoney = s => { const v = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return isNaN(v) ? null : v.toFixed(2); };
const normDate = s => String(s || '').replace(/[^0-9]/g, '');   // digit-strip: tolerant of separator format
const w = (tag, d) => { const f = path.join(os.tmpdir(), `rr_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

// Doc-types + fields via DIRECT SQL — getAllWithFields runs repairStructuralRoles (a WRITE),
// which would throw on a read-only handle. This reproduces its {..., fields:[...]} shape read-only.
function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
}

function snap(db) {
  const dts = docTypesWithFields(db);
  let anchors = safe(() => learning.getAllAnchors(db), []);
  // Ablation: NO_IDENTITY_ANCHORS=1 drops supplier_name/customer_name anchors — proves whether
  // an identity anchor (which is supplier-specific) is helping or hurting when swept cross-supplier.
  if (process.env.NO_IDENTITY_ANCHORS) anchors = anchors.filter(a => !['supplier_name', 'customer_name'].includes(a.field_key));
  // DROP_MISTAUGHT=1 simulates removing the end-of-session mis-taught AUTHORITATIVE invoice_number
  // anchor (Cloud VPS, label "Invoice") WITHOUT touching the live DB — proves it is the root cause
  // of the cross-supplier bleed (City Office 1828987, etc.).
  if (process.env.DROP_MISTAUGHT) anchors = anchors.filter(a => !(a.field_key === 'invoice_number' && String(a.last_authoritative_at || '').trim()));
  return { args: [
    '--fields-file', w('f', dts.flatMap(d => d.fields)),
    '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),   // uncapped — mirrors buildTrainingArgs (the bare getHints LIMIT-100 starved the engine)
    '--anchors-file', w('a', anchors),
    '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts),
    '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', safe(() => templates.getAll(db), [])),
    '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'] };
}

// `onDoc` (optional) is called with each file_done AS IT ARRIVES, not at shard close — this is what
// makes the 10% progress checkpoints possible (owner request 2026-08-08: "if we are capturing fails
// early on then we can deal with them rather than running through the whole batch"). Shards run in
// PARALLEL, so arrival order is interleaved and a checkpoint is a count of documents COMPLETED, never
// a position in the file list. `ctl` (optional) receives a kill() used only by RR_ABORT_ON.
function runP(folder, snapArgs, files, manifest, onDoc, ctl) {
  const N = 8; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  // FAITHFUL REPROCESS (2026-08-03): pass the per-doc known template/type like the app's
  // Reprocess All (--reprocess-manifest), so Stage 0.5 template_mapping fires on docs whose logo
  // no longer self-matches — WITHOUT this the harness silently skips Stage 0.5 and is blind to the
  // whole template_mapping-garble class (the Northgate PO-17039 gap). All shards share the manifest.
  const manifestArgs = (manifest && Object.keys(manifest).length) ? ['--reprocess-manifest', w('manifest', manifest)] : [];
  const procs = [];
  if (ctl) ctl.kill = () => { for (const p of procs) { try { p.kill(); } catch {} } };
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'fast', '--tesseract', TESS, ...manifestArgs, ...snapArgs], { windowsHide: true });
    procs.push(p);
    let out = '', tail = '';
    p.stdout.on('data', d => {
      out += d;
      if (!onDoc) return;
      // Line-buffered live parse. The final partial line stays in `tail` until its newline arrives,
      // so a message split across two chunks is never parsed half-formed. `out` is still the source
      // of truth for the scoring pass below — this only OBSERVES.
      tail += d;
      const lines = tail.split('\n'); tail = lines.pop();
      for (const ln of lines) {
        const t = ln.trim(); if (t[0] !== '{') continue;
        let m; try { m = JSON.parse(t); } catch { continue; }
        if (m.type === 'file_done') { try { onDoc(m); } catch {} }
      }
    });
    p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => {
    const docs = {}; for (const o of outs) for (const ln of o.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
    return docs;
  });
}
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : (k && m[k] != null ? m[k] : null); };

(async () => {
  if (!fs.existsSync(LIVE_DB)) { console.error('live DB not found:', LIVE_DB); process.exit(1); }
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const nameToSlug = {}; for (const r of db.prepare('SELECT name, slug FROM document_types').all()) nameToSlug[r.name] = r.slug;
  const roles = {}; for (const r of db.prepare('SELECT slug, ref_field_key, date_field_key FROM document_types').all()) roles[r.slug] = { ref: r.ref_field_key, date: r.date_field_key };
  const slugToId = {}; for (const r of db.prepare('SELECT id, slug FROM document_types').all()) slugToId[r.slug] = r.id;
  // Every field key each TYPE defines — the denominator for the per-field fill rate below.
  const typeFieldKeys = {};
  for (const r of db.prepare(`SELECT dt.slug, f.key FROM fields f
                                JOIN document_types dt ON dt.id = f.document_type_id`).all()) {
    (typeFieldKeys[r.slug] || (typeFieldKeys[r.slug] = [])).push(r.key);
  }
  const conf = db.prepare(`SELECT d.id, d.supplier_name, d.reference_number, d.doc_date, d.original_filename, d.stored_path, d.working_path, d.template_id, dt.slug type_slug
    FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id WHERE d.status = 'confirmed'`).all();
  const exByDoc = {};
  for (const e of db.prepare(`SELECT e.document_id, e.field_key, e.display_value FROM extractions e JOIN documents d ON d.id = e.document_id WHERE d.status = 'confirmed'`).all())
    (exByDoc[e.document_id] || (exByDoc[e.document_id] = {}))[e.field_key] = e.display_value;

  // Stage the confirmed files into a temp folder keyed by doc<id><ext> (map back by filename).
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'realdoc-'));
  const resolveFile = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path
                         : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const gt = {}; const files = []; let noFile = 0; const gtOverrideSkipped = [];
  const manifest = {};   // per-doc known template/type — makes Stage 0.5 fire faithfully (see runP)
  for (const d of conf) {
    const src = resolveFile(d); if (!src) { noFile++; continue; }
    const fname = `doc${d.id}${path.extname(src) || '.pdf'}`;
    try { fs.copyFileSync(src, path.join(RR, fname)); } catch { noFile++; continue; }
    manifest[fname] = { known_template_id: d.template_id || null, known_doc_slug: d.type_slug || null };
    files.push(fname);
    const ex = exByDoc[d.id] || {};
    gt[fname] = { id: d.id, type_slug: d.type_slug, supplier: d.supplier_name, ref: d.reference_number, date: d.doc_date,
                  total: ex.total != null ? ex.total : ex.total_amount, subtotal: ex.subtotal };
    // Apply a GT override (poisoned test-session confirmation → true value per filename), but ONLY
    // after SELF-VALIDATING that the doc at this id is STILL the poisoned one (Oracle condition): the
    // id keys a MUTABLE, resettable, machine-specific live DB, so after a `docusnap.db` reset (or on
    // another machine / CI) id 896 could be an UNRELATED doc — blindly substituting would mask a real
    // regression. Require the DB row still carry the recorded poison (`poisoned_ref`/`poisoned_date`)
    // AND the filename token (`fname_has`). On ANY mismatch: DO NOT apply, warn, score vs raw DB GT.
    const ov = GT_OVERRIDES[String(d.id)];
    if (ov && typeof ov === 'object') {
      const fnameOk = ov.fname_has == null || String(d.original_filename || '').includes(ov.fname_has);
      const refOk   = ov.poisoned_ref  == null || normRef(d.reference_number) === normRef(ov.poisoned_ref);
      const dateOk  = ov.poisoned_date == null || normDate(d.doc_date) === normDate(ov.poisoned_date);
      // Supplier poison: `poisoned_supplier: ""` means the DB row must STILL carry NO issuer
      // (normSupplier(null) === '' — the confirmed-without-issuer class, e.g. the Unknown-Company
      // Ashford sales orders 1777/1786/1788 whose correct read the 2026-07-10 improvements restored).
      const supOk   = ov.poisoned_supplier == null || normSupplier(d.supplier_name) === normSupplier(ov.poisoned_supplier);
      // Type poison: a doc mis-CONFIRMED under the wrong document TYPE (e.g. #190, a purchase order
      // filed as delivery_note — the ref/date VALUES are correct, only the type is wrong). Same
      // self-validation discipline: the DB row must STILL carry the poisoned slug, else SKIP.
      const typeOk  = ov.poisoned_type == null || String(d.type_slug || '') === ov.poisoned_type;
      if (fnameOk && refOk && dateOk && supOk && typeOk) {
        if (ov.ref      != null) gt[fname].ref       = ov.ref;
        if (ov.date     != null) gt[fname].date      = ov.date;
        if (ov.supplier != null) gt[fname].supplier  = ov.supplier;
        if (ov.type     != null) gt[fname].type_slug = ov.type;   // corrects role-key lookup + the type score
        gt[fname]._overridden = true;
      } else {
        gtOverrideSkipped.push(`#${d.id}: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='${d.reference_number}' file='${d.original_filename}')`);
      }
    }
  }
  const gtOverrideN = Object.values(gt).filter(g => g._overridden).length;
  const snapObj = snap(db);

  // ── PROGRESS CHECKPOINTS every 10% of documents completed (owner request 2026-08-08) ──────────
  // WHAT THIS IS: an EARLY WARNING, not the gate. It compares type/supplier/ref/date against the
  // confirmed values as each document lands, so a change that breaks a whole supplier shows up in
  // the first minutes instead of after the full batch. The GATE numbers (SILENT wrong values and
  // wrong auto-files) still come only from the full scoring pass below — a document disagreeing
  // here may well be flagged for review, which is a correct outcome, not a failure.
  // RR_ABORT_ON=<n> stops the run once n documents disagree. The report is then STAMPED ABORTED and
  // the gate exits non-zero regardless, so a truncated run can never be mistaken for a pass.
  const ckDisagreed = [];        // {id, text} — sorted into the report, which must diff cleanly
  const CK_STEP = Math.max(1, Math.ceil(files.length / 10));
  const ABORT_ON = Number(process.env.RR_ABORT_ON || 0);
  const ctl = {};
  let ckDone = 0, ckNext = CK_STEP, ckWrong = 0, aborted = false;
  let ckFresh = [];
  const liveScore = (m) => {
    const g = gt[m.original_filename]; if (!g) return null;
    const rk = (roles[g.type_slug] || {}).ref, dk = (roles[g.type_slug] || {}).date;
    const detSlug = m._document_slug || nameToSlug[m.document_type] || null;
    const bad = [];
    if (detSlug !== g.type_slug) bad.push(`type ${g.type_slug}->${detSlug}`);
    if (normSupplier(m.supplier_name) !== normSupplier(g.supplier)) bad.push(`supplier '${g.supplier}'->'${m.supplier_name}'`);
    if (rk && g.ref != null && normRef(ef(m, rk)) !== normRef(g.ref)) bad.push(`ref '${g.ref}'->'${ef(m, rk)}'`);
    if (dk && g.date != null && normDate(ef(m, dk)) !== normDate(g.date)) bad.push(`date '${g.date}'->'${ef(m, dk)}'`);
    return bad;
  };
  const onDoc = (m) => {
    ckDone++;
    const bad = liveScore(m);
    if (bad && bad.length) {
      ckWrong++;
      const id = (gt[m.original_filename] || {}).id;
      ckDisagreed.push({ id: Number(id) || 0, text: `${m.original_filename} — ${bad.join(' · ')}` });
      ckFresh.push(`    #${id} ${m.original_filename} — ${bad.join(' · ')}`);
    }
    if (ckDone < ckNext && ckDone !== files.length) return;
    const line = `[${String(Math.round(100 * ckDone / files.length)).padStart(3)}%] ${ckDone}/${files.length} done · ${ckWrong} disagreeing with their confirmed values`;
    console.log(line);
    for (const s of ckFresh) console.log(s);
    ckFresh = [];
    while (ckNext <= ckDone) ckNext += CK_STEP;
    if (ABORT_ON && ckWrong >= ABORT_ON && !aborted) {
      aborted = true;
      console.log(`\n!! RR_ABORT_ON=${ABORT_ON} reached (${ckWrong} disagreements) — stopping the run.`);
      if (ctl.kill) ctl.kill();
    }
  };

  const res = await runP(RR, snapObj.args, files, manifest, onDoc, ctl);

  const F = ['type', 'supplier', 'ref', 'date', 'total', 'subtotal'];
  const acc = {}; for (const f of F) acc[f] = { ok: 0, n: 0 };
  const regress = [];
  let silentWrong = 0;
  let autoFiledN = 0, silentAutoFile = 0; const autoFileMisses = [];
  let rereadN = 0; const rereadDocs = [];   // Stage-4.5 gate-failure re-read adoptions (review-bound)
  let ownCapN = 0;                          // c2 taught-field ownership caps (review-volume delta, HOLD-only)
  let wrongTypeAutoFile = 0;                // M_type (Oracle C3): would auto-file under the WRONG document TYPE
  let bannerRereadN = 0; const bannerRereadDocs = [];  // BANNER_HEADING_REREAD firings (proves the fix fired)
  // PER-FIELD FILL RATE (Oracle 2026-08-08, "the number that must not move — it does not exist yet").
  // Every other number in this report is BLIND to a field going EMPTY. A change that turns a wrong
  // value into an omitted field REDUCES the wrong-value count (M) and leaves the auto-file count
  // happy — the type+un-flagged gate passes fine with a field simply absent — so a guard that
  // deletes values scores as an improvement. This tracks, per (type_slug, field_key), how many
  // documents of that type produced a NON-EMPTY value, which is the only lane that can see it.
  // Keyed by type so a field the type does not define never drags its own denominator.
  const fill = {};   // `${slug}|${key}` -> {n, filled}
  for (const fname of files) {
    const m = res[fname]; const g = gt[fname]; if (!m) continue;
    if (m.banner_heading_reread) { bannerRereadN++; bannerRereadDocs.push(`#${g.id} ${g.type_slug} -> ${m.document_type}`); }
    const rk = (roles[g.type_slug] || {}).ref, dk = (roles[g.type_slug] || {}).date;
    const detSlug = m._document_slug || nameToSlug[m.document_type] || null;
    const s = {
      type: detSlug === g.type_slug,
      supplier: normSupplier(m.supplier_name) === normSupplier(g.supplier),
      ref: (rk && g.ref != null) ? normRef(ef(m, rk)) === normRef(g.ref) : null,
      date: (dk && g.date != null) ? normDate(ef(m, dk)) === normDate(g.date) : null,
      total: g.total != null ? normMoney(ef(m, 'total') != null ? ef(m, 'total') : ef(m, 'total_amount')) === normMoney(g.total) : null,
      subtotal: g.subtotal != null ? normMoney(ef(m, 'subtotal')) === normMoney(g.subtotal) : null,
    };
    for (const f of F) { if (s[f] == null) continue; acc[f].n++; if (s[f]) acc[f].ok++; }
    // Fill rate: count EVERY field this document's type defines, not just the ones scored above,
    // so a guard that empties a non-scored field (an address, a payment term) is still visible.
    for (const key of (typeFieldKeys[g.type_slug] || [])) {
      const k = `${g.type_slug}|${key}`;
      (fill[k] || (fill[k] = { n: 0, filled: 0 })).n++;
      const v = ef(m, key);
      if (v != null && String(v).trim() !== '') fill[k].filled++;
    }
    // Gate-failure re-read adoptions (GATE_REREAD): a re-read is review-bound (note + corrected_to),
    // so it can never auto-file — count it so a corpus A/B shows the feature actually FIRED.
    for (const [k, e] of Object.entries(m.extractions || {})) {
      if (e && typeof e === 'object' && (e.reread === true || String(e.validation_note || '').startsWith('re-read from the page'))) {
        rereadN++; rereadDocs.push(`#${g.id} ${g.type_slug} ${k}: '${e.value}' (was garbled)`);
      }
      if (e && typeof e === 'object' && String(e.validation_note || '').startsWith('this field has a taught position')) ownCapN++;
    }
    // #6 auto-file SOUNDNESS — would the REAL gate auto-file this reprocessed read, and is it wrong?
    const detId = slugToId[detSlug];
    let wouldFile = false, afReason = null;
    if (detId != null && m.overall_confidence != null) {
      // extraction_method is THREADED (2026-08-07): docTrustGate's shadow-row skip keys on it, and
      // an overlay that omitted it would make that gate VACUOUSLY GREEN — every row would look like
      // a non-shadow row here no matter what the pipeline actually produced.
      const rex = Object.entries(m.extractions || {}).map(([k, e]) => ({
        field_key: k,
        display_value: (e && typeof e === 'object') ? e.value : e,
        validation_note: (e && typeof e === 'object') ? e.validation_note : null,
        confidence: (e && typeof e === 'object') ? e.confidence : null,
        extraction_method: (e && typeof e === 'object') ? e.method : null,
        // THREADED 2026-08-11 (Oracle C4): the corroborated auto-file route keys on this —
        // omitting it here fails the route closed and makes every armed arm vacuously green.
        corroboration: (e && typeof e === 'object') ? (e.corroboration ?? null) : null,
      }));
      const fakeDoc = { id: g.id, supplier_name: m.supplier_name, document_type_id: detId, overall_confidence: m.overall_confidence };
      try { const _af = trust.isAutoFileEligible(db, fakeDoc, { extractions: rex }); wouldFile = _af.eligible; afReason = _af.reason; } catch {}
    }
    // RR_CONSENSUS (overnight P1 measurement, env-gated -> inert/byte-identical when unset): per-doc
    // hold-reason + per-critical-field {value,conf,note,correct} so the multi-read-consensus auto-file
    // opportunity (and its M-safety) can be analysed offline vs the stored page OCR. Read-only.
    if (process.env.RR_CONSENSUS) {
      try {
        const _cf = (k, ok) => { if (!k) return null; const e = m.extractions && m.extractions[k]; return { key: k, val: ef(m, k), conf: (e && typeof e === 'object') ? e.confidence : null, note: (e && typeof e === 'object') ? (e.validation_note || null) : null, method: (e && typeof e === 'object') ? (e.method || e.extraction_method || null) : null, correct: ok }; };
        fs.appendFileSync(process.env.RR_CONSENSUS, JSON.stringify({ id: g.id, type: g.type_slug, wouldFile, reason: afReason, ref: _cf(rk, s.ref), date: _cf(dk, s.date) }) + '\n');
      } catch {}
    }
    if (wouldFile) autoFiledN++;
    // RR_DUMP (C5 attribution, 2026-07-23): per-doc would-auto-file + the supplier field's note,
    // so an A/B shortfall can be attributed doc-by-doc (which arm held it), never hand-waved.
    if (process.env.RR_DUMP) {
      try {
        const supEx = (m.extractions || {}).supplier_name;
        fs.appendFileSync(process.env.RR_DUMP, JSON.stringify({
          id: g.id, wouldFile, sup: m.supplier_name || null,
          supNote: (supEx && typeof supEx === 'object' && supEx.validation_note) || null,
          // method+confidence (2026-08-12 graduation-freeze replay): a value can be identical in
          // both arms while its EVIDENCE moved (hint@85 -> template_fixed@95) — the dump must see it.
          supConf: (supEx && typeof supEx === 'object' && supEx.confidence != null) ? supEx.confidence : null,
          supMethod: (supEx && typeof supEx === 'object' && (supEx.method || supEx.extraction_method)) || null,
        }) + '\n');
      } catch {}
    }
    // RR_TYPE_ENUM (type-outcome enumerator — task #5 gate, 2026-07-26): per-doc type resolution +
    // which TYPE guard (if any) held it, so the fix's two load-bearing numbers are measurable
    // corpus-wide: SILENT-MISFILE (wrong type, would-file, no guard) and FALSE-HOLD (correct type but
    // a type guard fired). Guard inferred from the persisted validation_note signatures
    // (engine.py: ambiguity :4950, refuse :4858, adjacent-G1 :4889). Read-only, env-gated ⇒ inert.
    if (process.env.RR_TYPE_ENUM) {
      try {
        let guard = null;
        for (const e of Object.values(m.extractions || {})) {
          const n = (e && typeof e === 'object' && e.validation_note) ? String(e.validation_note) : '';
          if (n.includes('used for several document types')) guard = 'ambiguity';
          else if (n.includes("names a document type that doesn't match") || n.includes("match this document to")) guard = guard || 'refuse';
          else if (n.includes("couldn't be confirmed anywhere else")) guard = guard || 'g1';
        }
        fs.appendFileSync(process.env.RR_TYPE_ENUM, JSON.stringify({
          id: g.id, supplier: m.supplier_name || null, gt: g.type_slug, got: detSlug || null,
          conf: m.overall_confidence != null ? m.overall_confidence : null,
          wouldFile, typeOk: s.type, guard, overridden: !!g._overridden,
        }) + '\n');
      } catch {}
    }
    if (wouldFile && F.some(f => s[f] === false)) {
      silentAutoFile++;
      autoFileMisses.push(`#${g.id} ${g.type_slug} would-auto-file but WRONG on: ${F.filter(f => s[f] === false).join(',')}`);
    }
    // M_type (Oracle C3): a doc that would auto-file under the WRONG document TYPE. A SUBSET of
    // silentAutoFile (type ∈ F) but tracked + gated on its OWN so a wrong-TYPE/right-VALUE auto-file
    // — the banner-heading fix's exact failure mode — is VISIBLE and can't hide in the value metric.
    if (wouldFile && s.type === false) wrongTypeAutoFile++;
    // Regressions on the filing-critical fields; flag whether the wrong read carried a review note (SILENT = didn't).
    for (const [f, key, want] of [['supplier', 'supplier_name', g.supplier], ['ref', rk, g.ref], ['date', dk, g.date]]) {
      if (s[f] === false) {
        const exr = key && m.extractions && m.extractions[key];
        const got = f === 'supplier' ? m.supplier_name : ef(m, key);
        // A wrong value is only truly SILENT if it carries NO review note AND is above the
        // review threshold (70) — i.e. it would actually auto-file. Below-threshold reads
        // surface as needs-a-check in the app, so they're caught, not silent.
        const flagged = !!(exr && (String(exr.validation_note || '').trim() || (exr.confidence != null && exr.confidence < 70)));
        if (!flagged) silentWrong++;
        // An OVERRIDDEN doc that STILL fails means the pipeline reads NEITHER the poison nor the
        // filename-true value — a genuine problem the override is NOT hiding (want is the corrected GT).
        const ovTag = g._overridden ? ' [GT-OVERRIDDEN — pipeline disagrees with the TRUE value!]' : '';
        regress.push(`#${g.id} ${g.type_slug} ${f}: want '${want}' got '${got}'${flagged ? ' [flagged]' : ' [SILENT]'}${ovTag}`);
      }
    }
  }
  fs.rmSync(RR, { recursive: true, force: true });
  db.close();

  const pct = (o, n) => n ? (100 * o / n).toFixed(1) + '%' : '-';
  const out = [];
  out.push(`# Real-doc regression — ${files.length} confirmed docs reprocessed vs their confirmed values`);
  out.push(`(${noFile} confirmed docs had no resolvable file and were skipped.)`);
  if (gtOverrideN) out.push(`(${gtOverrideN} docs used a GT override — poisoned test-session confirmations corrected to the filename true value; see stress_test/gt_overrides.json.)`);
  for (const s of gtOverrideSkipped) out.push(`⚠ ${s}`);
  if (aborted) {
    out.push('');
    out.push(`> # ⛔ ABORTED EARLY — THIS IS NOT A GATE RESULT`);
    out.push(`> RR_ABORT_ON=${ABORT_ON} stopped the run after ${ckDone} of ${files.length} documents.`);
    out.push(`> Every number below is computed over that PARTIAL set. It cannot show a pass: the`);
    out.push(`> documents never processed are absent, not correct. Re-run without RR_ABORT_ON to gate.`);
  }
  out.push('');
  // Progress checkpoints: the early-warning lane (see the comment where they are collected). These
  // are DISAGREEMENTS with the confirmed values, which is a superset of the gate's SILENT-wrong
  // count — a disagreement that got flagged for review is a correct outcome and is NOT a failure.
  // The live 10%-checkpoint lines are DELIBERATELY not reproduced here. Shards finish in a
  // different order every run, so both the per-checkpoint counts and the order of the documents
  // under them vary between two arms of the SAME code — which made an arm-to-arm diff of this
  // report unreadable the first time it was used. The live view belongs on the console; the report
  // gets the same information in a form that diffs: one total, and the documents SORTED by id.
  if (ckDisagreed.length) {
    out.push(`## Early-warning disagreements: ${ckDisagreed.length}`);
    out.push(`type/supplier/ref/date compared against the confirmed values as each document landed.`);
    out.push(`A SUPERSET of the gate: a disagreement that was correctly flagged for review is not a`);
    out.push(`failure. The gate numbers are the SILENT wrong values and wrong auto-files below.`);
    out.push('```');
    for (const l of ckDisagreed.slice().sort((a, b) => (a.id - b.id))) out.push(`  #${l.id} ${l.text}`);
    out.push('```');
    out.push('');
  }
  out.push('| Field | correct | scored | accuracy |');
  out.push('|---|---|---|---|');
  for (const f of F) out.push(`| ${f} | ${acc[f].ok} | ${acc[f].n} | ${pct(acc[f].ok, acc[f].n)} |`);
  out.push(`\n**Regressions (a confirmed value the pipeline no longer reproduces): ${regress.length}** — of which ${silentWrong} SILENT (wrong + no review flag).`);
  for (const r of regress.slice(0, 60)) out.push(`- ${r}`);
  // PER-FIELD FILL RATE — see the comment at the accumulator. This is the ONLY lane in this report
  // that can see a field going EMPTY: a guard that withholds instead of committing a wrong value
  // LOWERS the wrong-value count and leaves the auto-file count untouched, so without this a
  // value-deleting change reads as an improvement. Gate any withholding change on M=0 AND zero
  // fill-rate drop here, with supplier_name read separately — it is the learning scope key and the
  // filing folder, so emptying it costs an auto-file on every document of that supplier.
  out.push(`\n## Per-field fill rate (non-empty), by document type`);
  out.push(`A withholding change must not drop any of these. supplier_name is called out separately:`);
  out.push(`it is the learning-scope key AND the filing folder, so a drop there is the worst kind.`);
  const fillKeys = Object.keys(fill).sort();
  const supplierLines = [];
  for (const k of fillKeys) {
    const [slug, key] = k.split('|');
    const r = fill[k];
    const line = `- ${slug} · ${key}: ${r.filled}/${r.n} (${pct(r.filled, r.n)})`;
    if (key === 'supplier_name') supplierLines.push(line); else out.push(line);
  }
  if (supplierLines.length) {
    out.push(`\n**ISSUER FILL RATE (supplier_name) — watch this one first:**`);
    for (const l of supplierLines) out.push(l);
  }
  out.push(`\n**Auto-file soundness (#6): ${autoFiledN}/${files.length} reprocessed docs would auto-file; ${silentAutoFile} would auto-file a WRONG value (must be 0).**`);
  for (const r of autoFileMisses.slice(0, 40)) out.push(`- ${r}`);
  out.push(`\n**Wrong-TYPE auto-file (M_type, Oracle C3): ${wrongTypeAutoFile} (must be 0 — would auto-file under the WRONG document type; a subset of M above, tracked + gated separately).**`);
  out.push(`\n**Banner heading re-reads adopted (BANNER_HEADING_REREAD): ${bannerRereadN} (red-channel recovery FIRED + adopted a trusted type; 0 = never fired on this corpus, NOT proof of safety).**`);
  for (const r of bannerRereadDocs.slice(0, 40)) out.push(`- ${r}`);
  out.push(`\n**Gate-failure re-reads adopted (GATE_REREAD): ${rereadN} (review-bound — can't auto-file; 0 = the feature never fired, not "safe").**`);
  for (const r of rereadDocs.slice(0, 40)) out.push(`- ${r}`);
  out.push(`\n**c2 taught-field ownership caps (TAUGHT_FIELD_OWNERSHIP): ${ownCapN} (HOLD-only — value untouched, review-bound; this is the review-VOLUME delta, not an accuracy change).**`);
  const txt = out.join('\n');
  fs.writeFileSync(path.join(OUT, 'realdoc_regression.md'), txt);
  console.log(txt);

  // An ABORTED run fails the gate unconditionally: it is a partial corpus, so "0 wrong" means
  // "not reached yet", never "clean". Only a complete run can pass.
  if (process.env.GATE === '1' && (aborted || silentWrong > 0 || silentAutoFile > 0 || wrongTypeAutoFile > 0)) process.exit(1);   // any SILENT regression, wrong-value OR wrong-TYPE auto-file fails the gate
})();
