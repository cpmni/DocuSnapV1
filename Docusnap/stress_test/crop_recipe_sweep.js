'use strict';
/*
 * crop_recipe_sweep.js — A/B the DARK crop-recovery flags on a fixed set of docs.
 *
 * Motivation: the taught absolute po_number box on the Larkspur Interiors purchase_order template
 * is too tight and clips the "PO-" prefix (#637 -> "40351", #640 -> garble "IM.ANKI1"). The
 * clip-recovery machinery (TEMPLATE_ABS_EDGE_GUARD word-bounded grow, TARGET_WORD_SNAP, frag/clip
 * cleaning, EDGE_CUT_RELOCATE) is all DEFAULT-OFF. This harness reprocesses the exact docs through
 * the REAL pipeline under each recipe (flag combo) and scores po_number vs known-correct values,
 * so a recipe can be picked on evidence: "recipe X recovers the 2 clipped docs, 0 regression".
 *
 * READ-ONLY: opens the live DB read-only (direct SQL, no repair write), copies the working_path
 * PDFs to a temp dir, reprocesses, deletes the temp dir. Writes nothing to the DB. Output (real
 * values) -> stdout only. Reuses realdoc_regression.js's snapshot approach.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/crop_recipe_sweep.js
 * Optional: DOC_IDS="625,630,..." GT="637=PO-40351,640=PO-90621" FIELD=po_number
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const FIELD = process.env.FIELD || 'po_number';
const norm = s => String(s == null ? '' : s).toUpperCase().replace(/\s+/g, '');
const w = (tag, d) => { const f = path.join(os.tmpdir(), `crs_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : (k && m[k] != null ? m[k] : null); };
const efm = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? { value: e.value, method: e.method, confidence: e.confidence } : { value: m[k], method: '?', confidence: '?' }; };

// ── Ground truth (po_number) for the Larkspur PO set — #637/#640 recovered from the padded crop ──
const DEFAULT_GT = { 625: 'PO-48009', 630: 'PO-91914', 632: 'PO-82956', 635: 'PO-19649',
                     637: 'PO-40351', 638: 'PO-60906', 639: 'PO-41508', 640: 'PO-90621' };
const GT = {};
if (process.env.GT) for (const pair of process.env.GT.split(',')) { const [k, v] = pair.split('='); GT[k.trim()] = v.trim(); }
else Object.assign(GT, DEFAULT_GT);
const DOC_IDS = (process.env.DOC_IDS ? process.env.DOC_IDS.split(',').map(s => s.trim()) : Object.keys(GT)).map(Number);

// ── Live baseline env: mirror handler.js _ocrDpiEnv + _anchorCropEnv + _reconcileEnv, reading the
//    OWNER'S ACTUAL enabled settings. The app reprocesses with these ON, so the harness MUST too or
//    its "baseline" is a bare pipeline that doesn't reproduce what the owner sees. ──
const SETTING_ENV = {
  anchor_value_right_grow: 'ANCHOR_VALUE_RIGHT_GROW', anchor_label_left_clamp: 'ANCHOR_LABEL_LEFT_CLAMP',
  struct_code_read: 'STRUCT_CODE_READ', prefix_garble_adopt: 'PREFIX_GARBLE_ADOPT',
  crosscheck_outlier_reconcile: 'CROSSCHECK_OUTLIER_RECONCILE', universal_verify_restore: 'UNIVERSAL_VERIFY_RESTORE',
  universal_verify_flag: 'UNIVERSAL_VERIFY_FLAG', universal_verify_numeric: 'UNIVERSAL_VERIFY_NUMERIC',
  template_code_edge_clean: 'TEMPLATE_CODE_EDGE_CLEAN', template_target_word_snap: 'TEMPLATE_TARGET_WORD_SNAP',
  template_code_frag_clean: 'TEMPLATE_CODE_FRAG_CLEAN', template_clip_commit: 'TEMPLATE_CLIP_COMMIT',
  name_unclip_reconcile: 'NAME_UNCLIP_RECONCILE', template_abs_edge_guard: 'TEMPLATE_ABS_EDGE_GUARD',
  template_date_clip_gate: 'TEMPLATE_DATE_CLIP_GATE', template_label_digit_exact: 'TEMPLATE_LABEL_DIGIT_EXACT',
  teach_angle_compose: 'TEACH_ANGLE_COMPOSE', template_edge_cut_relocate: 'TEMPLATE_EDGE_CUT_RELOCATE',
  template_clip_commit_edge_slack: 'TEMPLATE_CLIP_COMMIT_EDGE_SLACK', template_date_invalid_yield: 'TEMPLATE_DATE_INVALID_YIELD',
  template_date_future_yield: 'TEMPLATE_DATE_FUTURE_YIELD', template_pad_window_read: 'TEMPLATE_PAD_WINDOW_READ',
};
function liveBaselineEnv(db) {
  const env = {};
  const get = k => { try { return learning.getSetting(db, k, 'false'); } catch { return 'false'; } };
  for (const [k, v] of Object.entries(SETTING_ENV)) if (get(k) === 'true') env[v] = '1';
  if (get('heading_absent_reread') === 'true') { env.HEADING_ABSENT_REREAD = '1'; env.HEADING_TITLE_GAP_COLLAPSE = '1'; env.REPROCESS_HEADING_GEOM = '1'; }
  const dpi = parseInt(get('ocr_dpi') === 'false' ? '300' : learning.getSetting(db, 'ocr_dpi', '300'), 10);
  if (Number.isFinite(dpi) && dpi >= 100 && dpi <= 600 && dpi !== 300) env.OCR_RENDER_DPI = String(dpi);
  return env;
}
// ── Recipes: each is the LIVE baseline (all owner flags) + one experimental DELTA. The existing crop
//    flags are already ON in the live app and still fail — so the deltas probe levers NOT yet applied
//    (render DPI up/down; the one flag the owner has off). BASELINE_ENV is filled at runtime. ──
let BASELINE_ENV = {};
const RECIPES = [
  { name: 'live baseline (owner flags)', delta: {} },
  { name: '+ PAD_WINDOW_CODE',           delta: { TEMPLATE_PAD_WINDOW_CODE: '1' } },
  { name: '+ PAD_WINDOW_CODE +LABELLED', delta: { TEMPLATE_PAD_WINDOW_CODE: '1', TEMPLATE_PAD_WINDOW_CODE_LABELLED: '1' } },
];
// REPEATS: the marginal clip is NOT bit-reproducible (which doc clips shuffles with render DPI +/-1),
// so a single paired run cannot support a heal claim (Oracle, 2026-08-06). Default 1 for a quick look;
// the gate runs REPEATS=3.
const REPEATS = parseInt(process.env.REPEATS || '1', 10);

function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
}
function snapArgs(db) {
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
function runP(folder, args, files, manifest, extraEnv) {
  const shardFile = w('shard', files);
  const manifestArgs = (manifest && Object.keys(manifest).length) ? ['--reprocess-manifest', w('manifest', manifest)] : [];
  return new Promise(resolve => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'smart', '--tesseract', TESS, ...manifestArgs, ...args],
      { windowsHide: true, env: { ...process.env, ...extraEnv } });
    let out = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', () => {});
    p.on('close', () => {
      const docs = {};
      for (const ln of out.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
      resolve(docs);
    });
  });
}

(async () => {
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const rows = db.prepare(`SELECT id, original_filename, working_path, stored_path, template_id, document_type_id,
                            (SELECT slug FROM document_types WHERE id = documents.document_type_id) type_slug
                           FROM documents WHERE id IN (${DOC_IDS.map(() => '?').join(',')})`).all(...DOC_IDS);
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'cropsweep-'));
  const files = [], manifest = {}, fnameToId = {};
  for (const d of rows) {
    const src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
    if (!src) { console.log(`#${d.id}: NO FILE`); continue; }
    const fname = `doc${d.id}${path.extname(src) || '.pdf'}`;
    fs.copyFileSync(src, path.join(RR, fname));
    manifest[fname] = { known_template_id: d.template_id || null, known_doc_slug: d.type_slug || null };
    fnameToId[fname] = d.id; files.push(fname);
  }
  const args = snapArgs(db);
  BASELINE_ENV = liveBaselineEnv(db);
  db.close();
  console.log(`Crop-recipe sweep — field=${FIELD}, ${files.length} docs, ${RECIPES.length} recipes`);
  console.log(`Live baseline env (owner-enabled): ${Object.keys(BASELINE_ENV).join(', ') || '(none)'}\n`);

  const results = {};   // recipe -> {id -> {value,method,confidence,ok}}
  const census = [];    // every pad FIRE across every repeat, with its GT verdict
  for (const rec of RECIPES) {
    const perRun = [];
    for (let rep = 0; rep < REPEATS; rep++) {
      const res = await runP(RR, args, files, manifest, { ...BASELINE_ENV, ...rec.delta });
      const per = {};
      for (const fname of files) {
        const id = fnameToId[fname], m = res[fname];
        if (!m) { per[id] = { value: '(no result)', ok: false }; continue; }
        const fm = efm(m, FIELD);
        per[id] = { ...fm, ok: norm(fm.value) === norm(GT[id]) };
        // FIRE CENSUS (Oracle gate): every pad swap/flag, and whether it landed on a value that
        // matches GT. A _padcodeflag on a CORRECT value is a false flag (a lost auto-file); a
        // _padunclip that makes a GT-equal value non-GT is a STOP condition.
        const meth = String(fm.method || '');
        if (meth.includes('_padunclip') || meth.includes('_padcodeflag')) {
          census.push({ recipe: rec.name, rep, id, kind: meth.includes('_padunclip') ? 'swap' : 'flag',
                        value: fm.value, conf: fm.confidence, gt: GT[id], ok: per[id].ok });
        }
      }
      perRun.push(per);
    }
    // Report the LAST repeat in the grid, but score every repeat.
    results[rec.name] = perRun[perRun.length - 1];
    const scores = perRun.map(p => Object.values(p).filter(x => x.ok).length);
    console.log(`  ${rec.name.padEnd(38)} ${scores.join('/')} correct of ${files.length}` +
                (REPEATS > 1 ? `  (${REPEATS} repeats)` : ''));
    results[rec.name]._runs = perRun;
  }
  try { fs.rmSync(RR, { recursive: true, force: true }); } catch {}

  // ── grid ──
  const ids = DOC_IDS.filter(id => rows.some(r => r.id === id));
  console.log(`\n=== ${FIELD} per doc × recipe (✓=correct value) ===`);
  const head = 'recipe'.padEnd(38) + ids.map(id => `#${id}`.padStart(9)).join('');
  console.log(head + '   score');
  for (const rec of RECIPES) {
    const per = results[rec.name];
    let line = rec.name.padEnd(38);
    let ok = 0;
    for (const id of ids) { const p = per[id]; const mark = p.ok ? '✓' : '✗'; line += `${mark}${String(p.value).slice(0, 8)}`.padStart(9); if (p.ok) ok++; }
    console.log(line + `   ${ok}/${ids.length}`);
  }
  // baseline diff — which recipe recovers the baseline failures with no NEW regression
  const base = results[RECIPES[0].name];
  const baseWrong = ids.filter(id => !base[id].ok);
  console.log(`\nBaseline wrong: ${baseWrong.map(id => '#' + id).join(', ') || '(none)'}`);
  // Score ACROSS repeats: a doc counts as recovered if the armed arm got it right in a repeat where
  // some baseline repeat got it wrong; regressed if armed got it wrong where every baseline repeat
  // was right. This is the honest reading given the clip shuffles.
  const okInAny = (runs, id) => runs.some(p => p[id] && p[id].ok);
  const okInAll = (runs, id) => runs.every(p => p[id] && p[id].ok);
  for (const rec of RECIPES.slice(1)) {
    const per = results[rec.name];
    const bRuns = base._runs, aRuns = per._runs;
    const recovered = ids.filter(id => !okInAll(bRuns, id) && okInAll(aRuns, id));
    const regressed = ids.filter(id => okInAll(bRuns, id) && !okInAny(aRuns, id));
    const flaky = ids.filter(id => okInAny(aRuns, id) && !okInAll(aRuns, id));
    console.log(`  ${rec.name.padEnd(38)} recovered ${recovered.length} [${recovered.map(i => '#' + i).join(',')}]  regressed ${regressed.length} [${regressed.map(i => '#' + i).join(',')}]  shuffling ${flaky.length} [${flaky.map(i => '#' + i).join(',')}]`);
  }

  // ── FIRE CENSUS (Oracle merge bar) ──
  console.log(`\n=== PAD FIRE CENSUS (${census.length} fires across all recipes/repeats) ===`);
  if (!census.length) console.log('  (no pad fires — armed run was byte-identical)');
  for (const c of census) {
    const bad = (c.kind === 'flag' && c.ok) ? '  <== FALSE FLAG on a correct value (lost auto-file)'
              : (c.kind === 'swap' && !c.ok) ? '  <== BAD SWAP (STOP)' : '';
    console.log(`  [${c.recipe}] rep${c.rep} #${c.id} ${c.kind} value=${c.value} conf=${c.conf} gt=${c.gt} ok=${c.ok}${bad}`);
  }
  const falseFlags = census.filter(c => c.kind === 'flag' && c.ok).length;
  const badSwaps = census.filter(c => c.kind === 'swap' && !c.ok).length;
  const provSwaps = census.filter(c => c.kind === 'swap' && Number(c.conf) < 88).length;
  console.log(`\n  false flags on correct values: ${falseFlags}   bad swaps: ${badSwaps}   swaps below the 88 floor: ${provSwaps}`);
  console.log(`  MERGE BAR: false flags == 0 AND bad swaps == 0`);
  console.log('\nGT used:', JSON.stringify(GT));
})();
