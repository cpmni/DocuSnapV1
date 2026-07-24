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

function runP(folder, snapArgs, files) {
  const N = 8; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'fast', '--tesseract', TESS, ...snapArgs], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
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
  const conf = db.prepare(`SELECT d.id, d.supplier_name, d.reference_number, d.doc_date, d.original_filename, d.stored_path, d.working_path, dt.slug type_slug
    FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id WHERE d.status = 'confirmed'`).all();
  const exByDoc = {};
  for (const e of db.prepare(`SELECT e.document_id, e.field_key, e.display_value FROM extractions e JOIN documents d ON d.id = e.document_id WHERE d.status = 'confirmed'`).all())
    (exByDoc[e.document_id] || (exByDoc[e.document_id] = {}))[e.field_key] = e.display_value;

  // Stage the confirmed files into a temp folder keyed by doc<id><ext> (map back by filename).
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'realdoc-'));
  const resolveFile = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path
                         : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const gt = {}; const files = []; let noFile = 0; const gtOverrideSkipped = [];
  for (const d of conf) {
    const src = resolveFile(d); if (!src) { noFile++; continue; }
    const fname = `doc${d.id}${path.extname(src) || '.pdf'}`;
    try { fs.copyFileSync(src, path.join(RR, fname)); } catch { noFile++; continue; }
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
  const res = await runP(RR, snapObj.args, files);

  const F = ['type', 'supplier', 'ref', 'date', 'total', 'subtotal'];
  const acc = {}; for (const f of F) acc[f] = { ok: 0, n: 0 };
  const regress = [];
  let silentWrong = 0;
  let autoFiledN = 0, silentAutoFile = 0; const autoFileMisses = [];
  let rereadN = 0; const rereadDocs = [];   // Stage-4.5 gate-failure re-read adoptions (review-bound)
  let ownCapN = 0;                          // c2 taught-field ownership caps (review-volume delta, HOLD-only)
  let wrongTypeAutoFile = 0;                // M_type (Oracle C3): would auto-file under the WRONG document TYPE
  let bannerRereadN = 0; const bannerRereadDocs = [];  // BANNER_HEADING_REREAD firings (proves the fix fired)
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
      const rex = Object.entries(m.extractions || {}).map(([k, e]) => ({
        field_key: k,
        display_value: (e && typeof e === 'object') ? e.value : e,
        validation_note: (e && typeof e === 'object') ? e.validation_note : null,
        confidence: (e && typeof e === 'object') ? e.confidence : null,
      }));
      const fakeDoc = { id: g.id, supplier_name: m.supplier_name, document_type_id: detId, overall_confidence: m.overall_confidence };
      try { const _af = trust.isAutoFileEligible(db, fakeDoc, { extractions: rex }); wouldFile = _af.eligible; afReason = _af.reason; } catch {}
    }
    // RR_CONSENSUS (overnight P1 measurement, env-gated -> inert/byte-identical when unset): per-doc
    // hold-reason + per-critical-field {value,conf,note,correct} so the multi-read-consensus auto-file
    // opportunity (and its M-safety) can be analysed offline vs the stored page OCR. Read-only.
    if (process.env.RR_CONSENSUS) {
      try {
        const _cf = (k, ok) => { if (!k) return null; const e = m.extractions && m.extractions[k]; return { key: k, val: ef(m, k), conf: (e && typeof e === 'object') ? e.confidence : null, note: (e && typeof e === 'object') ? (e.validation_note || null) : null, correct: ok }; };
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
  out.push('');
  out.push('| Field | correct | scored | accuracy |');
  out.push('|---|---|---|---|');
  for (const f of F) out.push(`| ${f} | ${acc[f].ok} | ${acc[f].n} | ${pct(acc[f].ok, acc[f].n)} |`);
  out.push(`\n**Regressions (a confirmed value the pipeline no longer reproduces): ${regress.length}** — of which ${silentWrong} SILENT (wrong + no review flag).`);
  for (const r of regress.slice(0, 60)) out.push(`- ${r}`);
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

  if (process.env.GATE === '1' && (silentWrong > 0 || silentAutoFile > 0 || wrongTypeAutoFile > 0)) process.exit(1);   // any SILENT regression, wrong-value OR wrong-TYPE auto-file fails the gate
})();
