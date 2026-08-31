'use strict';
/*
 * name_demote_b2_gate.js — the Oracle B2 flip gate for NAME_CORROB_NOTE_DEMOTE (slice 3).
 *
 * WHAT B2 ASKS (docs/oracle_log.md 2026-08-13, pendingfeatures "SLICE 3"):
 *   (1) an ARMED #259-class replay — a doc whose ONLY hold is the Layer-A name-guard note while a
 *       SIBLING field is silently wrong: after the demote the doc must still be HELD (or the
 *       release must at least be OBSERVABLE), and
 *   (2) demoted-and-wrong measured at DOC level on the NEWLY-UNPARKED auto-files — not per field.
 *   (3) it must ANSWER A2: does the release ALONE un-park, given slice 3 mints NO confidence?
 *
 * WHY A NEW HARNESS (the vacuous-arm trap, twice now):
 *   - `realdoc_regression.js` replays CONFIRMED documents only. The live carriers of this note are
 *     4 DELETED docs + 1 `needs_review` doc, so realdoc is STRUCTURALLY BLIND to the class and its
 *     "armed changes nothing" arm was vacuous for slice 3. This harness is STATUS-AGNOSTIC.
 *   - `realdoc_regression.js` spawns python at the DEFAULT 300 DPI while the app runs `ocr_dpi=200`
 *     (handler.js:91-98). The disagreement classes only form at 200. This harness pins
 *     OCR_RENDER_DPI to the live `ocr_dpi` setting (override with B2_DPI).
 *
 * WHAT IT MEASURES (per doc, in BOTH arms — OFF and ARMED):
 *   needs_review · overall_confidence · every extraction's value/conf/note/method ·
 *   trust.isAutoFileEligible (the REAL gate, extraction_method + corroboration threaded) ·
 *   the FAR two-tier "needs a look" predicate (documents.js getReviewSplit's own rule) ·
 *   correctness of every scoreable field against ground truth.
 * Then it reports the ARM DELTA: which docs demoted, which changed hold state, which became
 * auto-file eligible ONLY under the armed flag, and whether ANY of those carries a wrong value.
 *
 * GROUND TRUTH, and its honesty rules:
 *   - Corpus GT (`ground_truth.json` of the Customer Doc Test corpus, B2_GT to override) keyed by
 *     the doc's original filename with any `-<n>` import suffix stripped. This is the only GT that
 *     can score a doc that was never confirmed.
 *   - A CONFIRMED doc also carries DB GT, but a doc confirmed by a MACHINE via (auto_reprocess et
 *     al.) is SUSPECT GT (the 2026-08-12 sweep cohort) — those docs are scored, reported, and kept
 *     OUT of the gate's pass/fail count. Corpus GT, where present, always wins.
 *
 * PRIVACY / SAFETY: the live DB is opened STRICTLY READ-ONLY and is never modified; files are
 * copied to a temp dir which is deleted; the report (real values) goes to stress_test/out/ which is
 * gitignored. This script carries no data — safe to commit.
 *
 * Run:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/name_demote_b2_gate.js
 * Env:
 *   B2_DOCS=1217,1218   explicit doc ids (default: every carrier of the note + its scope siblings)
 *   B2_ALL=1            every doc with a resolvable file, any status (the wide arm — slow)
 *   B2_SCOPE_CAP=60     per-scope sibling cap for the default population
 *   B2_WITH_SLICE2=1    also arm RECON_TOTAL_NOTE_DEMOTE in BOTH arms (the #1217 double exhibit:
 *                       slice 2 removes the OTHER note, so slice 3's note becomes the SOLE hold —
 *                       this is how the #259 shape is reached with REAL pixels)
 *   B2_FRESH=1          drop `--reprocess-manifest`, i.e. model the IMPORT path (fresh template
 *                       identification) instead of REPROCESS. LOAD-BEARING for this class: the
 *                       Layer-A name note is written by the Stage-2 relocate guard, and with a
 *                       known_template_id pinned, Stage 0.5 answers the field first and the note
 *                       never forms — the same structural blindness as teach_run_ab's
 *                       TEACH_FRESH_IDENTIFY (CLAUDE.md 2026-08-10). A "0 fired" run without this
 *                       arm proves nothing.
 *   B2_DPI=200          render DPI (default: the live `ocr_dpi` setting, else 200)
 *   B2_GT=<path>        ground_truth.json
 *   GATE=1              exit non-zero when demoted-and-wrong > 0 at DOC level
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const REPO = 'c:/GIT Projects/Docusnap', ST = path.join(REPO, 'stress_test');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const OUT = path.join(ST, 'out'), CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
const trust = require(path.join(REPO, 'database', 'modules', 'trust.js'));
let labelOverrides = null;
try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

// The note this slice demotes — byte-identical to anchor.NAME_GUARD_DISAGREE_NOTE. A drift here
// silently empties the population, so it is asserted against the Python source at startup.
const NOTE = "The value found beside this document's own caption disagreed with the taught position — please verify.";
// Machine confirm vias — a doc confirmed by one of these has SUSPECT ground truth (the 2026-08-12
// sweep cohort). Shared module, never a local copy (the drift class machine_vias.js exists to kill).
let MACHINE_VIAS = ['scope_sweep', 'auto_corroborated', 'auto_reprocess', 'auto_graduated', 'auto_threshold'];
try { MACHINE_VIAS = require(path.join(REPO, 'database', 'modules', 'machine_vias.js')).MACHINE_VIAS || MACHINE_VIAS; } catch {}

const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const w = (tag, d) => { const f = path.join(os.tmpdir(), `b2_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const normName = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normRef  = s => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const normDate = s => String(s == null ? '' : s).replace(/[^0-9]/g, '');
const normMoney = s => { const v = parseFloat(String(s == null ? '' : s).replace(/[^0-9.\-]/g, '')); return isNaN(v) ? null : Math.abs(v).toFixed(2); };
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : (k && m[k] != null ? m[k] : null); };
const exOf = (m, k) => { const e = k && m.extractions && m.extractions[k]; return (e && typeof e === 'object') ? e : null; };

// ── the extraction snapshot: identical construction to realdoc_regression.js ────────────────────
function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
}
function snap(db) {
  const dts = docTypesWithFields(db);
  return { args: [
    '--fields-file', w('f', dts.flatMap(d => d.fields)),
    '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
    '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])),
    '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts),
    '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', safe(() => templates.getAll(db), [])),
    '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'] };
}

// One arm. `env` is merged over the parent environment for the spawned python ONLY — the harness's
// own process.env is never mutated, so the two arms cannot leak into each other.
function runArm(folder, snapArgs, files, manifest, env) {
  const N = Math.min(8, Math.max(1, files.length));
  const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  const manifestArgs = (manifest && Object.keys(manifest).length && process.env.B2_FRESH !== '1')
    ? ['--reprocess-manifest', w('manifest', manifest)] : [];
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile,
                           '--mode', 'fast', '--tesseract', TESS, ...manifestArgs, ...snapArgs],
                    { windowsHide: true, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', () => {});
    p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => {
    const docs = {};
    for (const o of outs) for (const ln of o.split('\n')) {
      const t = ln.trim(); if (t[0] !== '{') continue;
      let m; try { m = JSON.parse(t); } catch { continue; }
      if (m.type === 'file_done') docs[m.original_filename] = m;
    }
    return docs;
  });
}

// ── the two doc-level hold predicates, each computed from the REPLAYED rows (never the DB) ──────
// (a) would the backend auto-file it — the real shared predicate, nothing re-implemented here.
function autoFileVerdict(db, g, m, slugToId, detSlug) {
  const detId = slugToId[detSlug];
  if (detId == null || m.overall_confidence == null) return { eligible: false, reason: 'no-type' };
  const rex = Object.entries(m.extractions || {}).map(([k, e]) => ({
    field_key: k,
    display_value: (e && typeof e === 'object') ? e.value : e,
    validation_note: (e && typeof e === 'object') ? e.validation_note : null,
    corrected_to: (e && typeof e === 'object') ? (e.corrected_to ?? null) : null,
    confidence: (e && typeof e === 'object') ? e.confidence : null,
    extraction_method: (e && typeof e === 'object') ? e.method : null,
    corroboration: (e && typeof e === 'object') ? (e.corroboration ?? null) : null,
  }));
  const fakeDoc = { id: g.id, supplier_name: m.supplier_name, document_type_id: detId, overall_confidence: m.overall_confidence };
  try { const r = trust.isAutoFileEligible(db, fakeDoc, { extractions: rex }); return { eligible: !!r.eligible, reason: r.reason || null, floor: r.floor }; }
  catch (e) { return { eligible: false, reason: 'threw:' + e.message }; }
}
// (b) does it still read as "needs a look" in the queue — getReviewSplit's OWN rule, applied to the
// replayed rows. `valuedOnly` is the live far_lowconf_valued_only two-tier (A2 turns on this).
function needsALook(m, fieldThr, typeFields, valuedOnly) {
  let flagged = 0, belowValued = 0, below = 0;
  for (const [k, e] of Object.entries(m.extractions || {})) {
    if (!e || typeof e !== 'object') continue;
    if (String(e.validation_note || '').trim() || String(e.corrected_to || '').trim()) flagged++;
    const thr = fieldThr[k] != null ? fieldThr[k] : 70;
    if (e.confidence != null && e.confidence < thr) {
      below++;
      if (String(e.value == null ? '' : e.value).trim()) belowValued++;
    }
  }
  const missing = (typeFields || []).filter(f => f.required && !String(ef(m, f.key) || '').trim()).map(f => f.key);
  const need = flagged > 0 || (valuedOnly ? belowValued : below) > 0 || missing.length > 0;
  return { need, flagged, below, belowValued, missing };
}

(async () => {
  if (!fs.existsSync(LIVE_DB)) { console.error('live DB not found:', LIVE_DB); process.exit(1); }
  // The note literal must match the Python source or the population is silently empty.
  const anchorSrc = fs.readFileSync(path.join(REPO, 'python_backend', 'extraction', 'anchor.py'), 'utf8');
  const noteOk = anchorSrc.includes("The value found beside this document's own caption disagreed ")
              && anchorSrc.includes('with the taught position — please verify.');
  if (!noteOk) { console.error('ABORT: NAME_GUARD_DISAGREE_NOTE drifted from this harness\'s copy — fix the literal.'); process.exit(2); }

  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const nameToSlug = {}, slugToId = {}, roles = {}, typeFieldsBySlug = {}, fieldThrBySlug = {};
  for (const r of db.prepare('SELECT id, name, slug, ref_field_key, date_field_key FROM document_types').all()) {
    nameToSlug[r.name] = r.slug; slugToId[r.slug] = r.id;
    roles[r.slug] = { ref: r.ref_field_key, date: r.date_field_key };
  }
  for (const f of db.prepare('SELECT f.*, dt.slug FROM fields f JOIN document_types dt ON dt.id = f.document_type_id').all()) {
    (typeFieldsBySlug[f.slug] || (typeFieldsBySlug[f.slug] = [])).push(f);
    (fieldThrBySlug[f.slug] || (fieldThrBySlug[f.slug] = {}))[f.key] = f.confidence_threshold != null ? f.confidence_threshold : 70;
  }
  const setting = (k, d) => { const r = safe(() => db.prepare('SELECT value FROM settings WHERE key=?').get(k), null); return r ? r.value : d; };
  const DPI = process.env.B2_DPI || setting('ocr_dpi', '200') || '200';
  const valuedOnly = setting('far_lowconf_valued_only', 'false') === 'true';

  // ── population ────────────────────────────────────────────────────────────────────────────────
  const carriers = db.prepare(
    'SELECT DISTINCT document_id FROM extractions WHERE validation_note = ?').all(NOTE).map(r => r.document_id);
  const allDocs = db.prepare(`SELECT d.id, d.status, d.supplier_name, d.original_filename, d.stored_path,
      d.working_path, d.template_id, d.confirmed_via, d.reference_number, d.doc_date, dt.slug type_slug
    FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id`).all();
  const byId = {}; for (const d of allDocs) byId[d.id] = d;
  let picked;
  if (process.env.B2_DOCS) {
    picked = process.env.B2_DOCS.split(',').map(s => byId[Number(s.trim())]).filter(Boolean);
  } else if (process.env.B2_ALL === '1') {
    picked = allDocs.filter(d => d.status !== 'error');
  } else {
    // carriers + their (supplier, type) scope siblings — the class's own neighbourhood, so a
    // collateral change on a NON-carrier of the same taught template is visible too.
    const cap = Number(process.env.B2_SCOPE_CAP || 60);
    const scopes = new Set(carriers.map(id => `${normName((byId[id] || {}).supplier_name)}|${(byId[id] || {}).type_slug}`));
    const seen = new Set(carriers), per = {};
    picked = carriers.map(id => byId[id]).filter(Boolean);
    for (const d of allDocs) {
      if (seen.has(d.id)) continue;
      const k = `${normName(d.supplier_name)}|${d.type_slug}`;
      if (!scopes.has(k)) continue;
      per[k] = (per[k] || 0) + 1; if (per[k] > cap) continue;
      picked.push(d); seen.add(d.id);
    }
  }
  const resolveFile = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path
                         : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'b2gate-'));
  const files = [], manifest = {}, meta = {}, noFile = [];
  for (const d of picked) {
    const src = resolveFile(d); if (!src) { noFile.push(`#${d.id} ${d.status} ${d.original_filename}`); continue; }
    const fname = `doc${d.id}${path.extname(src) || '.pdf'}`;
    try { fs.copyFileSync(src, path.join(RR, fname)); } catch { noFile.push(`#${d.id} copy failed`); continue; }
    manifest[fname] = { known_template_id: d.template_id || null, known_doc_slug: d.type_slug || null };
    files.push(fname); meta[fname] = d;
  }
  if (!files.length) { console.error('ABORT: no replayable files in the population.'); process.exit(2); }

  // ── ground truth ──────────────────────────────────────────────────────────────────────────────
  // Corpus GT keyed by the base filename (the live copies carry an import suffix: `_0021-4.pdf`).
  const GT_PATH = process.env.B2_GT || path.join(os.homedir(), 'Desktop', 'Customer Doc Test', 'ground_truth.json');
  const corpusGt = {};
  let gtRows = [];
  try { gtRows = JSON.parse(fs.readFileSync(GT_PATH, 'utf8')); } catch {}
  const baseKey = fn => String(fn || '').replace(/\.[^.]+$/, '').replace(/-\d+$/, '').toLowerCase();
  for (const r of gtRows) {
    const k = baseKey(path.basename(String(r.file || '').replace(/\\/g, '/')));
    if (k) corpusGt[k] = r;   // later rendition rows overwrite: the VALUES are identical per doc
  }
  // DB GT for confirmed docs (values as filed), plus the machine-via suspicion flag.
  const exByDoc = {};
  for (const e of db.prepare('SELECT document_id, field_key, display_value FROM extractions').all())
    (exByDoc[e.document_id] || (exByDoc[e.document_id] = {}))[e.field_key] = e.display_value;

  // ── arms ──────────────────────────────────────────────────────────────────────────────────────
  const CENSUS_OFF = fs.mkdtempSync(path.join(os.tmpdir(), 'b2cen-off-'));
  const CENSUS_ON  = fs.mkdtempSync(path.join(os.tmpdir(), 'b2cen-on-'));
  // THE APP'S OWN SPAWN ENV, not a harness copy of it. `handler.js` builds the batch/import env as
  // _autoTitleEnv + _ocrDpiEnv + _anchorCropEnv + _reconcileEnv (handler.js:2008-2014) — ~47 live
  // toggles reach Python ONLY through those builders. `realdoc_regression.js` sets NONE of them, so
  // a realdoc arm runs a DIFFERENT product configuration from the app: that is exactly how a class
  // that forms live can fail to form on replay and be written off as "import-batch-specific".
  // Requiring the real functions (they are exported for precisely this) means the mirror cannot rot.
  let appEnv = {};
  try {
    const H = require(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'));
    appEnv = { ...safe(() => H._autoTitleEnv(db), {}), ...safe(() => H._anchorCropEnv(db), {}),
               ...safe(() => H._reconcileEnv(db), {}) };
  } catch (e) { console.log('WARN: could not load the app env builders — arms run bare:', e.message); }
  const baseEnv = {
    ...appEnv,
    // _ocrDpiEnv is not exported; reproduce it exactly (emit only when ≠ 300, handler.js:91-96).
    ...(String(DPI) === '300' ? {} : { OCR_RENDER_DPI: String(DPI) }),
    // The sibling slices: mirror the live setting, except slice 2 which B2_WITH_SLICE2 forces ON in
    // BOTH arms (so the delta stays this slice alone while the OTHER note is out of the way).
    XCHECK_CORROB_NOTE_DEMOTE: setting('xcheck_corrob_note_demote', 'false') === 'true' ? '1' : '0',
    RECON_TOTAL_NOTE_DEMOTE: process.env.B2_WITH_SLICE2 === '1' ? '1'
      : (setting('recon_total_note_demote', 'false') === 'true' ? '1' : '0'),
  };
  console.log(`app spawn env mirrored: ${Object.keys(appEnv).length} vars`);
  const snapObj = snap(db);
  console.log(`population ${files.length} docs (${carriers.length} note carriers, ${noFile.length} unreplayable) · DPI ${DPI} · slice2 ${baseEnv.RECON_TOTAL_NOTE_DEMOTE} · far_valued_only ${valuedOnly}`);
  console.log('arm 1/2: OFF …');
  const armOff = await runArm(RR, snapObj.args, files, manifest,
    { ...baseEnv, NAME_CORROB_NOTE_DEMOTE: '0', XCHECK_DEMOTE_CENSUS_DIR: CENSUS_OFF });
  console.log('arm 2/2: ARMED …');
  const armOn = await runArm(RR, snapObj.args, files, manifest,
    { ...baseEnv, NAME_CORROB_NOTE_DEMOTE: '1', XCHECK_DEMOTE_CENSUS_DIR: CENSUS_ON });
  try { fs.rmSync(RR, { recursive: true, force: true }); } catch {}

  // ── scoring ───────────────────────────────────────────────────────────────────────────────────
  // The scoreable fields and the comparator each uses. `null`/absent GT ⇒ not scored (never a fail).
  const CMP = { supplier: normName, customer: normName, ref: normRef, date: normDate,
                total: normMoney, vat_no: s => normRef(s), account_no: s => normRef(s), po_ref: normRef };
  function gtFor(d) {
    const c = corpusGt[baseKey(d.original_filename)];
    const dbEx = exByDoc[d.id] || {};
    const machine = d.status === 'confirmed' && MACHINE_VIAS.includes(String(d.confirmed_via || ''));
    const src = c ? 'corpus' : (d.status === 'confirmed' ? (machine ? 'db(SUSPECT)' : 'db') : null);
    if (c) return { src, suspect: false, type_slug: c.type_slug, supplier: c.issuer, customer: c.customer,
                    ref: c.ref, date: c.date, total: c.total, vat_no: c.vat_no, account_no: c.account_no, po_ref: c.po_ref };
    if (d.status !== 'confirmed') return { src: null, suspect: true };
    return { src, suspect: machine, type_slug: d.type_slug, supplier: d.supplier_name, ref: d.reference_number,
             date: d.doc_date, total: dbEx.total != null ? dbEx.total : dbEx.total_amount,
             customer: dbEx.customer_name, vat_no: dbEx.vat_no, account_no: dbEx.account_no, po_ref: dbEx.po_ref };
  }
  // Which extraction key carries each scoreable slot for this doc's detected type.
  function keyFor(slot, slug) {
    if (slot === 'supplier') return 'supplier_name';
    if (slot === 'customer') return 'customer_name';
    if (slot === 'ref')  return (roles[slug] || {}).ref;
    if (slot === 'date') return (roles[slug] || {}).date;
    if (slot === 'total') return 'total';
    return slot;
  }
  function scoreDoc(d, m) {
    const g = gtFor(d);
    const slug = m._document_slug || nameToSlug[m.document_type] || null;
    const out = { src: g.src, suspect: !!g.suspect, wrong: [], scored: 0, slug };
    if (!g.src) return out;
    if (g.type_slug && slug && slug !== g.type_slug) { out.wrong.push(`type ${g.type_slug}→${slug}`); out.scored++; }
    for (const slot of Object.keys(CMP)) {
      const want = g[slot];
      if (want == null || String(want).trim() === '') continue;
      const k = keyFor(slot, slug || g.type_slug);
      if (!k) continue;
      const got = ef(m, k);
      if (got == null || String(got).trim() === '') continue;   // EMPTY is a miss, never a wrong VALUE
      out.scored++;
      const f = CMP[slot];
      if (f(got) !== f(want)) out.wrong.push(`${slot}(${k}) want '${want}' got '${got}'`);
    }
    return out;
  }

  const rows = [];
  for (const fname of files) {
    const d = meta[fname], a = armOff[fname], b = armOn[fname];
    if (!a || !b) { rows.push({ d, missing: true }); continue; }
    const slugA = a._document_slug || nameToSlug[a.document_type] || null;
    const slugB = b._document_slug || nameToSlug[b.document_type] || null;
    const r = {
      d, a, b,
      afA: autoFileVerdict(db, d, a, slugToId, slugA), afB: autoFileVerdict(db, d, b, slugToId, slugB),
      lookA: needsALook(a, fieldThrBySlug[slugA] || {}, typeFieldsBySlug[slugA] || [], valuedOnly),
      lookB: needsALook(b, fieldThrBySlug[slugB] || {}, typeFieldsBySlug[slugB] || [], valuedOnly),
      scoreA: scoreDoc(d, a), scoreB: scoreDoc(d, b),
    };
    // The demote's own fingerprint: a field whose OFF row carries the note and whose ARMED row does
    // not (and gained the +corrob_clear method suffix).
    r.demoted = Object.keys(a.extractions || {}).filter(k => {
      const ea = exOf(a, k), eb = exOf(b, k);
      return ea && eb && String(ea.validation_note || '') === NOTE && !String(eb.validation_note || '').trim();
    });
    // Any OTHER value/method/note difference between the arms — the collateral check.
    r.otherDiff = Object.keys({ ...(a.extractions || {}), ...(b.extractions || {}) }).filter(k => {
      if (r.demoted.includes(k)) return false;
      const ea = exOf(a, k) || {}, eb = exOf(b, k) || {};
      return String(ea.value ?? '') !== String(eb.value ?? '')
          || String(ea.validation_note || '') !== String(eb.validation_note || '')
          || String(ea.confidence ?? '') !== String(eb.confidence ?? '');
    });
    rows.push(r);
  }

  const readCensus = dir => {
    const f = path.join(dir, 'name_demote_census.jsonl');
    try { return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
    catch { return []; }
  };
  const cenOn = readCensus(CENSUS_ON), cenOff = readCensus(CENSUS_OFF);

  // ── report ────────────────────────────────────────────────────────────────────────────────────
  const live = rows.filter(r => !r.missing);
  const demotedDocs = live.filter(r => r.demoted.length);
  const newlyEligible = live.filter(r => !r.afA.eligible && r.afB.eligible);
  const newlyUnlooked = live.filter(r => r.lookA.need && !r.lookB.need);
  const nowWrongUnparked = newlyEligible.filter(r => r.scoreB.wrong.length);
  const gateable = nowWrongUnparked.filter(r => !r.scoreB.suspect);
  // The #259 SHAPE inside this population: the name note is the doc's ONLY hold AND some sibling
  // field is wrong — the exact configuration Oracle demanded be replayed.
  const class259 = live.filter(r => {
    const notes = Object.values(r.a.extractions || {}).filter(e => e && typeof e === 'object' && String(e.validation_note || '').trim());
    const soleNameNote = notes.length === 1 && String(notes[0].validation_note) === NOTE;
    const siblingWrong = r.scoreA.wrong.some(x => !/customer|supplier/.test(x));
    return soleNameNote && siblingWrong;
  });

  const o = [];
  o.push(`# NAME_CORROB_NOTE_DEMOTE — Oracle B2 doc-level gate\n`);
  o.push(`DB \`${LIVE_DB}\` · DPI ${DPI} · far_lowconf_valued_only ${valuedOnly} · slice2 armed in both arms: ${baseEnv.RECON_TOTAL_NOTE_DEMOTE === '1'}`);
  o.push(`Population ${files.length} replayed (${carriers.length} live note carriers; ${noFile.length} had no file on disk).`);
  if (rows.some(r => r.missing)) o.push(`**${rows.filter(r => r.missing).length} doc(s) produced no file_done in one arm — reported, not scored.**`);
  o.push(`\n## 1. Did the class fire?`);
  o.push(`- name demotes: **${demotedDocs.length} doc(s)**, ${demotedDocs.reduce((n, r) => n + r.demoted.length, 0)} field(s).`);
  o.push(`- census rows: armed ${cenOn.length} (${cenOn.filter(c => c.demoted).length} demoted / ${cenOn.filter(c => !c.demoted).length} DECLINED), off ${cenOff.length} (must be 0 — the flag gates the census too).`);
  for (const c of cenOn.filter(x => !x.demoted).slice(0, 20))
    o.push(`  - DECLINED ${c.field} '${c.committed}' — w1=${c.w1 || 'none'} w2=${c.w2 || 'none'} rejections=${c.d1_rejections} dissent=${c.d2_dissent}`);
  for (const r of demotedDocs)
    o.push(`  - #${r.d.id} ${r.d.status} ${r.d.original_filename}: ${r.demoted.map(k => `${k}='${ef(r.b, k)}'`).join(', ')}`);
  // WHY it did / did not form — without this a "0 fired" run is undiagnosable and looks like a pass.
  // The demoter's eligibility is method=='anchor_crop' AND the note EXACTLY; show both per name field.
  o.push(`\n### 1b. Eligibility of each name field in the OFF arm (why the class did/didn't form)`);
  o.push(`| doc | field | value | conf | method | note |`);
  o.push(`|---|---|---|---|---|---|`);
  for (const r of live) for (const [k, e] of Object.entries(r.a.extractions || {})) {
    if (!e || typeof e !== 'object') continue;
    if (!/name|customer|supplier|company|client/i.test(k)) continue;
    const n = String(e.validation_note || '').trim();
    o.push(`| #${r.d.id} | ${k} | ${String(e.value ?? '').slice(0, 40)} | ${e.confidence} | ${e.method} | ${n === NOTE ? '**THE NOTE**' : (n ? n.slice(0, 50) : '-')} |`);
  }
  o.push(`\n## 2. A2 — does the release ALONE un-park? (no confidence is minted)`);
  o.push(`| doc | needs_review off→on | auto-file off→on | "needs a look" off→on | conf |`);
  o.push(`|---|---|---|---|---|`);
  for (const r of demotedDocs)
    o.push(`| #${r.d.id} | ${!!r.a.needs_review}→${!!r.b.needs_review} | ${r.afA.eligible}(${r.afA.reason})→${r.afB.eligible}(${r.afB.reason}) | ${r.lookA.need}→${r.lookB.need} | ${r.a.overall_confidence}→${r.b.overall_confidence} |`);
  o.push(`\n**A2 ANSWER: ${demotedDocs.length ? (newlyEligible.length ? `YES for ${newlyEligible.length} doc(s) — the release alone made them auto-file eligible.` : (newlyUnlooked.length ? `PARTLY — ${newlyUnlooked.length} doc(s) left the "needs a look" bucket but NONE became auto-file eligible.` : 'NO — no doc changed hold state.')) : 'UNANSWERED — the class did not fire in this population.'}**`);
  o.push(`\n## 3. Demoted-and-wrong at DOC level (the gate)`);
  o.push(`- newly auto-file eligible under the armed flag: **${newlyEligible.length}**`);
  o.push(`- of those, carrying ANY wrong scoreable value: **${nowWrongUnparked.length}** (${nowWrongUnparked.length - gateable.length} on SUSPECT machine-confirmed GT, excluded from the gate)`);
  o.push(`- **GATE: demoted-and-wrong (doc level, trustworthy GT) = ${gateable.length} — must be 0.**`);
  for (const r of nowWrongUnparked)
    o.push(`  - #${r.d.id} ${r.d.original_filename} [GT ${r.scoreB.src}${r.scoreB.suspect ? ', SUSPECT' : ''}] → ${r.scoreB.wrong.join(' · ')}`);
  o.push(`\n### 3b. Is a release AUDITABLE in production? (Oracle B2's "or the census must catch it")`);
  o.push(`The demote writes \`note_demoted\` into the field's corroboration record, and that record is`);
  o.push(`PERSISTED (extractions.corroboration) and surfaced in Review/SFDEV — so a released hold is`);
  o.push(`queryable after the fact WITHOUT the env-gated census. Checked on the emitted payload:`);
  for (const r of demotedDocs) for (const k of r.demoted) {
    const c = (exOf(r.b, k) || {}).corroboration;
    const nd = c && (typeof c === 'string' ? safe(() => JSON.parse(c), null) : c);
    const has = !!(nd && nd.note_demoted);
    o.push(`- #${r.d.id} ${k}: note_demoted in the persisted record = **${has}**${has ? ` (witnesses ${nd.note_demoted.witness_method} + ${nd.note_demoted.keyword_method}, ${(nd.note_demoted.rejected_reads || []).length} recorded rejections)` : ''}`);
  }
  o.push(`\n## 4. The #259 shape in this population`);
  o.push(`Docs whose name note is the SOLE hold while a sibling field is wrong: **${class259.length}**.`);
  for (const r of class259)
    o.push(`  - #${r.d.id} ${r.d.original_filename}: sibling wrong = ${r.scoreA.wrong.join(' · ')} · after demote: needs_review ${!!r.b.needs_review}, auto-file ${r.afB.eligible} (${r.afB.reason})`);
  if (!class259.length) o.push(`_None. The shape is not present in this population — state that honestly; it does not discharge B2 on its own._`);
  // 4b. The COUNTERFACTUAL. If no real doc carries the shape, the question Oracle actually asked —
  // "with the note released, would anything ELSE still hold a doc whose sibling is silently wrong?"
  // — is still answerable, by asking the REAL predicate about a doc we have deliberately spoiled:
  // take each newly-eligible doc, corrupt its ref-role value (digit flip, NO note, same confidence)
  // and re-run isAutoFileEligible. This is a PROBE, not a measurement: it proves what the gate does,
  // it does not claim the corpus contains such a doc.
  o.push(`\n### 4b. #259 counterfactual — is the released doc held by anything else?`);
  if (!newlyEligible.length) o.push(`_No newly-eligible doc to spoil._`);
  for (const r of newlyEligible) {
    const slug = r.scoreB.slug, rk = (roles[slug] || {}).ref;
    const e = rk && exOf(r.b, rk);
    if (!e || !String(e.value || '').trim()) { o.push(`- #${r.d.id}: no ref-role value to spoil (${rk || 'no ref role'})`); continue; }
    const spoiled = String(e.value).replace(/\d/, d => String((Number(d) + 1) % 10));
    const m2 = { ...r.b, extractions: { ...r.b.extractions, [rk]: { ...e, value: spoiled, validation_note: null, corrected_to: null } } };
    const v = autoFileVerdict(db, r.d, m2, slugToId, slug);
    o.push(`- #${r.d.id}: ref ${rk} '${e.value}'→'${spoiled}' (silent, conf ${e.confidence}) ⇒ auto-file **${v.eligible ? 'STILL ELIGIBLE — nothing else holds it' : `HELD (${v.reason})`}**`);
  }
  o.push(`\n## 5. Collateral (arm delta outside the demoted field)`);
  const coll = live.filter(r => r.otherDiff.length);
  o.push(`- docs with any other field differing between the arms: **${coll.length}** (must be 0 — the flag touches one note).`);
  for (const r of coll.slice(0, 20))
    o.push(`  - #${r.d.id}: ${r.otherDiff.map(k => `${k} '${ef(r.a, k)}'→'${ef(r.b, k)}'`).join(' · ')}`);
  o.push(`\n## 6. Per-doc detail`);
  o.push(`| doc | status | GT | wrong (off) | wrong (armed) | demoted |`);
  o.push(`|---|---|---|---|---|---|`);
  for (const r of live)
    o.push(`| #${r.d.id} ${r.d.original_filename} | ${r.d.status}${r.scoreB.suspect ? ' ⚠GT' : ''} | ${r.scoreB.src || 'none'} | ${r.scoreA.wrong.length} | ${r.scoreB.wrong.length} | ${r.demoted.join(',') || '-'} |`);

  fs.mkdirSync(OUT, { recursive: true });
  const rp = path.join(OUT, process.env.B2_REPORT || 'name_demote_b2_gate.md');
  fs.writeFileSync(rp, o.join('\n') + '\n');
  console.log(o.join('\n'));
  console.log(`\nreport → ${rp}\ncensus(armed) → ${path.join(CENSUS_ON, 'name_demote_census.jsonl')}`);
  db.close();
  if (process.env.GATE === '1' && (gateable.length > 0 || coll.length > 0 || cenOff.length > 0)) process.exit(1);
})();
