'use strict';
/*
 * reextract_c2_gate.js — C2 CORRECTNESS GATE for the fast on-open re-extract (Slice B).
 *
 * Proves the production fill path never surfaces a value a FULL reprocess wouldn't produce
 * identically. Runs BOTH pipelines over the live corpus with the SAME training data:
 *   Run A (full):  process_docs over the real images — full-page OCR + per-field crop OCR +
 *                  anchor / mapping / registration stages.
 *   Run B (fast):  process_docs --reextract (IMAGELESS) over zero-byte placeholders, each fed
 *                  Run A's OWN emitted ocr_text + matched template_id via the manifest. This
 *                  holds the OCR text + template CONSTANT, so the ONLY variable is the image
 *                  stage subset that --reextract removes — exactly the divergence we must bound.
 *
 * The gate is production-faithful, not a raw field diff: for each doc it runs the REAL
 * mergeReextractRows(storedExtractions, fastExtractions, anchoredKeys) — so it scores only the
 * fields production would ACTUALLY fill (empty, non-anchored, Stage-4 clean) — and requires every
 * such suggestion to EQUAL Run A's value for that field. Any suggestion where the full run is
 * empty (fast invents a value) OR different (fast fills a worse value) fails the gate. Also fails
 * on any doc-level TYPE flip between the two runs.
 *
 * PRIVACY / SAFETY (touches real business data):
 *   - Live DB opened STRICTLY READ-ONLY (doc-types via direct SQL, no repair write).
 *   - Files copied to a TEMP dir, processed, temp dir deleted. Output → stress_test/out/
 *     (gitignored). NEVER commit it. This script carries no data — safe to commit.
 *
 * Run:  ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/reextract_c2_gate.js
 * Gate: GATE=1 exits 1 on ANY fill-vs-full disagreement or type flip.
 * Env:  C2_LIMIT=N samples the first N corpus docs (quick run); RR_DB overrides the DB.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap', ST = path.join(REPO, 'stress_test');
const OUT = path.join(ST, 'out'), CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning  = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
const { _mergeReextractRows: mergeReextract } = require(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'));

const w = (tag, d) => { const f = path.join(os.tmpdir(), `c2_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : (k && m[k] != null ? m[k] : null); };
// Light value-equality: trim + collapse whitespace + lowercase. Money/date already canonicalised
// identically by the SAME validator in both runs, so meaningful divergence still shows.
const norm = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();

function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
}

// Training args identical to a live reprocess (mirrors buildTrainingArgs / realdoc snap).
function snap(db) {
  const dts = docTypesWithFields(db);
  return ['--fields-file', w('f', dts.flatMap(d => d.fields)),
    '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
    '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])),
    '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts),
    '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', safe(() => templates.getAll(db), [])),
    '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
}

// Sharded process_docs run; `extra` adds the fast-path flags. Keys results by original_filename.
function runP(folder, snapArgs, files, extra = []) {
  const N = 8; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile,
      '--mode', 'fast', '--tesseract', TESS, ...snapArgs, ...extra], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => {
    const docs = {}; for (const o of outs) for (const ln of o.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
    return docs;
  });
}

(async () => {
  if (!fs.existsSync(LIVE_DB)) { console.error('live DB not found:', LIVE_DB); process.exit(1); }
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const nameToSlug = {}; for (const r of db.prepare('SELECT name, slug FROM document_types').all()) nameToSlug[r.name] = r.slug;

  let docs = db.prepare(`SELECT d.id, d.supplier_name, d.original_filename, d.stored_path, d.working_path,
      d.template_id, d.ocr_text, dt.slug type_slug
    FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.status IN ('confirmed','needs_review','deferred')`).all();
  if (process.env.C2_LIMIT) docs = docs.slice(0, parseInt(process.env.C2_LIMIT, 10) || docs.length);

  // Stored extractions per doc (what production merges against).
  const storedEx = {};
  for (const e of db.prepare(`SELECT document_id, field_key, display_value, validation_note FROM extractions`).all())
    (storedEx[e.document_id] || (storedEx[e.document_id] = [])).push(e);

  // Stage the real files; map fname -> doc.
  const FOLDER = fs.mkdtempSync(path.join(os.tmpdir(), 'c2-full-'));
  const resolveFile = d => (d.working_path && fs.existsSync(d.working_path)) ? d.working_path
                         : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
  const byFname = {}; const files = []; let noFile = 0;
  for (const d of docs) {
    const src = resolveFile(d); if (!src) { noFile++; continue; }
    const fname = `doc${d.id}${path.extname(src) || '.pdf'}`;
    try { fs.copyFileSync(src, path.join(FOLDER, fname)); } catch { noFile++; continue; }
    byFname[fname] = d; files.push(fname);
  }

  const snapArgs = snap(db);
  console.log(`[C2] Run A (full) over ${files.length} docs…`);
  const A = await runP(FOLDER, snapArgs, files);

  // Build the fast run: placeholder folder + per-doc manifest (Run A's own ocr_text + matched template).
  const PLACE = fs.mkdtempSync(path.join(os.tmpdir(), 'c2-fast-'));
  const manifest = {}; const fastFiles = [];
  for (const fname of files) {
    const a = A[fname]; const d = byFname[fname];
    const cached = (a && a.ocr_text) || d.ocr_text || '';
    if (!cached.trim()) continue;                              // no OCR text → the fast path can't run (as in production)
    fs.writeFileSync(path.join(PLACE, fname), '');             // zero-byte placeholder (never read in --reextract)
    manifest[fname] = {
      ocr_text: cached,
      known_template_id: (a && a.template_id) || d.template_id || null,
      known_doc_slug: (a && (a._document_slug || nameToSlug[a.document_type])) || d.type_slug || null,
    };
    fastFiles.push(fname);
  }
  const manifestFile = w('mani', manifest);
  console.log(`[C2] Run B (fast/--reextract) over ${fastFiles.length} docs…`);
  const B = await runP(PLACE, snapArgs, fastFiles, ['--reextract', '--reprocess-manifest', manifestFile]);

  // TWO metrics:
  //  (1) PRODUCTION — the real merge against the doc's actual stored state: what the fill path would
  //      ACTUALLY surface today. Low on a stable corpus (a field empty in stored stays empty in fast —
  //      same keyword stage on the same OCR — so fills come only from learning added since import).
  //  (2) POWER — simulate EVERY field empty (existing=[]) so every value the fast path CAN produce
  //      (non-anchored, Stage-4-clean) becomes a suggestion, then compare each to the full run. This
  //      exercises the divergence check regardless of what the corpus stores, and is the GATED metric:
  //      it is the true safety question "can the imageless path ever emit a value a full reprocess
  //      wouldn't reproduce identically — which fill-only would then put into an empty field".
  let docsScored = 0, suggN = 0, agree = 0, prodDisagree = 0;
  let forcedN = 0, forcedAgree = 0, forcedFullEmpty = 0, forcedFullDiffer = 0; const disagreements = [];
  let typeFlip = 0; const typeFlips = [];
  let fastMissing = 0, fastEmpty = 0;                          // Run B produced nothing / no fields
  for (const fname of fastFiles) {
    const a = A[fname], b = B[fname], d = byFname[fname];
    if (!b || !b.extractions) { fastMissing++; continue; }
    if (!a) continue;
    if (!Object.keys(b.extractions).length) fastEmpty++;
    docsScored++;

    // Doc-level type must not flip between the two runs (fast pins known_doc_slug).
    const slugA = a._document_slug || nameToSlug[a.document_type] || null;
    const slugB = b._document_slug || nameToSlug[b.document_type] || null;
    if (slugA && slugB && slugA !== slugB) { typeFlip++; typeFlips.push(`#${d.id}: A=${slugA} B=${slugB}`); }

    const anchored = new Set(safe(() => learning.getTaughtFieldKeys(db, {
      supplier_name: d.supplier_name || b.supplier_name || '', document_type: d.type_slug || slugB || null,
    }).map(r => r.field_key), []));

    // (1) production merge vs full
    for (const s of mergeReextract(storedEx[d.id] || [], b.extractions, anchored)) {
      suggN++;
      if (norm(ef(a, s.field_key)) === norm(s.value)) agree++; else prodDisagree++;
    }

    // (2) power: every field forced empty
    for (const s of mergeReextract([], b.extractions, anchored)) {
      forcedN++;
      const fullVal = ef(a, s.field_key);
      if (norm(fullVal) === norm(s.value)) { forcedAgree++; continue; }
      if (!norm(fullVal)) forcedFullEmpty++;                   // fast invents a value the full run left empty (DANGEROUS)
      else forcedFullDiffer++;                                 // fast reads a field differently from the full crop/anchor
      if (disagreements.length < 100)
        disagreements.push(`#${d.id} ${d.type_slug || '∅'} ${s.field_key}: fast='${s.value}' full='${fullVal || ''}'`);
    }
  }
  fs.rmSync(FOLDER, { recursive: true, force: true });
  fs.rmSync(PLACE, { recursive: true, force: true });
  db.close();

  const forcedDisagree = forcedFullEmpty + forcedFullDiffer;
  const o = [];
  o.push(`# Fast re-extract — C2 correctness gate`);
  o.push(`corpus: ${files.length} docs staged (${noFile} had no resolvable file); ${fastFiles.length} had cached OCR; ${docsScored} scored; ${fastMissing} fast-run misses; ${fastEmpty} fast runs emitted 0 fields.`);
  o.push('');
  o.push(`## (1) Production fill path — real merge vs the doc's ACTUAL stored state`);
  o.push(`Fill suggestions the operator would actually see today: **${suggN}** (agree ${agree}, disagree ${prodDisagree}).`);
  o.push(`Low is expected on a stable corpus: a field empty in stored stays empty in fast (same keyword stage on`);
  o.push(`the same OCR), so real fills come only from learning added since import. This measures fire-rate, not safety.`);
  o.push('');
  o.push(`## (2) POWER metric (GATED) — every field forced empty, every fast-producible value vs the full run`);
  o.push(`Fast-producible fill candidates (non-anchored, Stage-4-clean): **${forcedN}** across ${docsScored} docs.`);
  o.push(`- AGREE (fast value == full-reprocess value): ${forcedAgree}`);
  o.push(`- **DISAGREE (must be 0): ${forcedDisagree}** — ${forcedFullEmpty} where the full run is EMPTY (fast would invent a value), ${forcedFullDiffer} where the full run reads it DIFFERENTLY.`);
  o.push(`- **Type flips A↔B (must be 0): ${typeFlip}**`);
  o.push('');
  if (disagreements.length) { o.push('## Disagreements (fast vs full)'); for (const r of disagreements) o.push(`- ${r}`); o.push(''); }
  if (typeFlips.length) { o.push('## Type flips'); for (const r of typeFlips) o.push(`- ${r}`); o.push(''); }
  const powered = forcedN >= 20;   // a PASS is only meaningful if the power metric actually exercised fills
  const pass = forcedDisagree === 0 && typeFlip === 0;
  o.push(`\n**C2 verdict: ${pass ? (powered ? 'PASS' : 'PASS (UNDER-POWERED — only ' + forcedN + ' candidates; treat as provisional)') : 'FAIL — see disagreements above.'}**`);
  o.push(pass && powered ? 'The fast fill path never emits a value a full reprocess would not reproduce identically.' : '');
  const txt = o.join('\n');
  try { fs.mkdirSync(OUT, { recursive: true }); } catch {}
  fs.writeFileSync(path.join(OUT, 'reextract_c2_gate.md'), txt);
  console.log('\n' + txt);

  if (process.env.GATE === '1' && !pass) process.exit(1);
})();
