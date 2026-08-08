'use strict';
/*
 * registration_gate_probe.js — A/B the S-D vacuous-fit gate at the Stage-0.5 call site.
 *
 * Motivation (2026-08-06): `_fit_page_transform` has TWO callers. engine.py's Stage-2 caller has
 * refused `n_inliers < 3` since 2026-08-01 (`REG_MIN_INLIERS_GATE`, default ON); the Stage-0.5
 * caller in template_mapper.py was never gated, so `template_registration` kept consuming the very
 * fits Stage 2 refuses. On the Castellan credit_note template that overwrote a CORRECT taught
 * supplier read with junk on 15 of 22 docs.
 *
 * Reports what the Oracle required and aggregate accuracy cannot show:
 *   • the resulting value PER DOCUMENT (not just a pass count) — "registration went inert" is only
 *     good news if what replaces it is the right answer;
 *   • a census of winning `template_registration` AND `anchor_registration` reads, so Stage-2
 *     collateral is visible (counting only the Stage-0.5 method is blind to it);
 *   • an explicit EXERCISE LEVEL line — if the doc set barely fires registration, the run is
 *     under-powered for the risk and must not be read as proof.
 *
 * READ-ONLY: opens the live DB read-only, copies working_path PDFs to a temp dir, reprocesses,
 * deletes the temp dir. Writes nothing to the DB.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe stress_test/registration_gate_probe.js
 * Env: DOC_IDS="705,706,..."  FIELDS="supplier_name,credit_note_number,credit_note_date"
 *      GT_FIELD=supplier_name GT_VALUE="Castellan Security Systems"
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

const FIELDS = (process.env.FIELDS || 'supplier_name,credit_note_number,credit_note_date,total_amount').split(',');
const GT_FIELD = process.env.GT_FIELD || 'supplier_name';
const GT_VALUE = process.env.GT_VALUE || 'Castellan Security Systems';
const norm = s => String(s == null ? '' : s).toUpperCase().replace(/\s+/g, '');
const w = (tag, d) => { const f = path.join(os.tmpdir(), `rgp_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e : {}; };

// Mirror handler.js so the baseline reproduces what the owner actually runs.
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
// The gate defaults ON in code, so the BASELINE arm is the one that must disable it.
const RECIPES = [
  { name: 'baseline (gate OFF = pre-fix)', delta: { REG_MIN_INLIERS_GATE: '0' } },
  { name: 'iter1 (vacuous-fit gate ON)',   delta: { REG_MIN_INLIERS_GATE: '1' } },
  { name: 'iter2 (+ fixed-seed guards)',   delta: { REG_MIN_INLIERS_GATE: '1',
                                                    TEMPLATE_FIXED_NEAR_MATCH_RECONCILE: '1',
                                                    TEMPLATE_FIXED_FRAGMENT_DECLINE: '1' } },
];

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
  const ids = process.env.DOC_IDS
    ? process.env.DOC_IDS.split(',').map(s => parseInt(s.trim(), 10))
    : db.prepare(`SELECT id FROM documents WHERE template_id = 32 ORDER BY id`).all().map(r => r.id);
  const rows = db.prepare(`SELECT id, original_filename, working_path, stored_path, template_id,
                            (SELECT slug FROM document_types WHERE id = documents.document_type_id) type_slug
                           FROM documents WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'reggate-'));
  const files = [], manifest = {}, fnameToId = {}, tplOf = {};
  for (const d of rows) {
    const src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : (d.stored_path && fs.existsSync(d.stored_path)) ? d.stored_path : null;
    if (!src) { console.log(`#${d.id}: NO FILE`); continue; }
    const fname = `doc${d.id}${path.extname(src) || '.pdf'}`;
    fs.copyFileSync(src, path.join(RR, fname));
    manifest[fname] = { known_template_id: d.template_id || null, known_doc_slug: d.type_slug || null };
    fnameToId[fname] = d.id; tplOf[d.id] = d.template_id; files.push(fname);
  }
  const args = snapArgs(db);
  const BASE = liveBaselineEnv(db);
  db.close();
  console.log(`Registration-gate probe — ${files.length} docs, GT ${GT_FIELD}=${GT_VALUE}`);
  console.log(`Live baseline env: ${Object.keys(BASE).join(', ') || '(none)'}\n`);

  const res = {};
  for (const rec of RECIPES) res[rec.name] = await runP(RR, args, files, manifest, { ...BASE, ...rec.delta });
  try { fs.rmSync(RR, { recursive: true, force: true }); } catch {}

  // ── per-document values (the Oracle's requirement: show what REPLACED the registration read) ──
  for (const rec of RECIPES) {
    const r = res[rec.name];
    let ok = 0;
    console.log(`=== ${rec.name} ===`);
    for (const fname of files) {
      const id = fnameToId[fname], m = r[fname];
      if (!m) { console.log(`  #${id} (no result)`); continue; }
      const e = ef(m, GT_FIELD);
      const good = norm(e.value) === norm(GT_VALUE);
      if (good) ok++;
      console.log(`  #${id} ${good ? 'OK ' : 'BAD'} ${String(e.value).slice(0, 34).padEnd(35)} ${String(e.method || '').padEnd(26)} conf=${e.confidence}${e.validation_note ? '  NOTE' : ''}`);
    }
    console.log(`  -> ${GT_FIELD} correct on ${ok}/${files.length}\n`);
  }

  // ── registration census, BOTH methods (Stage-0.5 and Stage-2 collateral) ──
  console.log('=== registration census (winning reads, by method and template) ===');
  for (const rec of RECIPES) {
    const r = res[rec.name];
    const byMethod = {}, byTpl = {};
    let wins = 0;
    for (const fname of files) {
      const m = r[fname]; if (!m) continue;
      for (const [k, e] of Object.entries(m.extractions || {})) {
        const meth = String((e && e.method) || '');
        if (!/registration/.test(meth)) continue;
        wins++;
        byMethod[meth] = (byMethod[meth] || 0) + 1;
        const t = tplOf[fnameToId[fname]] || '?';
        byTpl[t] = (byTpl[t] || 0) + 1;
      }
    }
    console.log(`  ${rec.name.padEnd(30)} registration wins=${wins} byMethod=${JSON.stringify(byMethod)} byTemplate=${JSON.stringify(byTpl)}`);
  }
  const baseWins = Object.values(res[RECIPES[0].name]).reduce((n, m) => n + Object.values(m.extractions || {}).filter(e => /registration/.test(String(e && e.method))).length, 0);
  console.log(`\nEXERCISE LEVEL: the baseline arm fired registration as a WINNING read ${baseWins} time(s) across ${files.length} docs.`);
  if (baseWins < 30) console.log('  WARNING: under-powered. This run cannot prove absence of regression on healthy multi-landmark templates; use realdoc for that.');

  // ── field-level collateral: did anything else move? ──
  console.log('\n=== other taught fields (collateral check) ===');
  for (const fname of files) {
    const id = fnameToId[fname];
    const a = res[RECIPES[0].name][fname], b = res[RECIPES[1].name][fname];
    if (!a || !b) continue;
    for (const f of FIELDS) {
      if (f === GT_FIELD) continue;
      const va = ef(a, f).value, vb = ef(b, f).value;
      if (String(va) !== String(vb)) console.log(`  #${id} ${f}: ${String(va)} -> ${String(vb)}`);
    }
  }
  console.log('  (no lines above = every other taught field byte-identical)');
})();
