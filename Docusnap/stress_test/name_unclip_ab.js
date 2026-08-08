/** NAME_UNCLIP_RECONCILE A/B over the Pelican Office Interiors batch.
 *
 *  WHY THIS EXISTS (2026-08-08). The owner marked 66 of 72 `customer_name` cells WRONG in the SFDEV
 *  debug table. Root cause measured: template 33's taught target box is tw=0.1627 and ends flush
 *  with the final glyph of "Bramblewood Joinery Ltd", so per-scan drift shears the 'd' — the value
 *  commits at conf 95 (above the 88 critical floor) and beats a CORRECT keyword_override read at 83.
 *  The shipped clip-repair family (TEMPLATE_TARGET_WORD_SNAP, TEMPLATE_ABS_EDGE_GUARD — both ON on
 *  this install) deliberately EXCLUDES names: template_mapper.py:308-309, "NAMES excluded v1
 *  (NAME_UNCLIP_RECONCILE owns that class)". That owner is DEFAULT OFF and has never been flipped.
 *
 *  NAME_UNCLIP_RECONCILE (engine.py:301-312, reggie design -> Oracle SIGN-OFF-W/COND 2026-08-04) is
 *  described as healing exactly this: "a Stage-0.5 mapping whose drawn box CUTS a name mid-token
 *  ('Kingfisher Print Stuc' — the sliced 'd' misreads as 'c')". This corpus contains
 *  'Bramblewood Joinery Ltc'. Its five conditions C0-C5 include C1 (keyword AND crop witnesses,
 *  token-identical) which CANNOT be checked by inspection — only by running it. Hence this arm.
 *
 *  THE NUMBER THAT DECIDES THE FLIP is not the heal count. It is REGRESSED: the ~24 documents whose
 *  taught box currently reads correctly must not move. A post-merge rewrite of a Stage-0.5 winner is
 *  the most invasive class of heal in this codebase, so a single regression should stop the flip.
 *
 *  READ-ONLY: temp copies of the working files, no DB writes, live DB opened readonly. Mirrors the
 *  install's REAL switch state via liveEnv so arm A is the owner's actual behaviour, not a default.
 *
 *  Modelled on stress_test/inline_reconcile_ab.js (the 08-07 Pelican delivery-number arm).
 *    ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe stress_test/name_unclip_ab.js
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require('better-sqlite3');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null;
try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const CFG  = path.join(REPO, 'config', 'keyword_patterns.json');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const w = (t, d) => { const f = path.join(os.tmpdir(), `nu_${t}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e : {}; };
const sv = v => (v == null ? '—' : String(v));

// Same live-switch mirror as inline_reconcile_ab.js — arm A must be the owner's real behaviour.
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
  template_fixed_near_match: 'TEMPLATE_FIXED_NEAR_MATCH_RECONCILE', template_fixed_fragment: 'TEMPLATE_FIXED_FRAGMENT_DECLINE',
  template_pad_window_code: 'TEMPLATE_PAD_WINDOW_CODE', credit_sign_coherence: 'CREDIT_SIGN_COHERENCE',
  vat_reg_not_amount: 'VAT_REG_NOT_AMOUNT', net_misread_total_flag: 'NET_MISREAD_TOTAL_FLAG',
  template_inline_row_overlap: 'TEMPLATE_INLINE_ROW_OVERLAP', ref_role_digit_gate: 'REF_ROLE_DIGIT_GATE',
};
function liveEnv(db) {
  const env = {};
  const get = k => { try { return learning.getSetting(db, k, 'false'); } catch { return 'false'; } };
  for (const [k, v] of Object.entries(SETTING_ENV)) if (get(k) === 'true') env[v] = '1';
  if (get('template_pad_window_code') === 'true' && get('template_pad_window_code_labelled') === 'true') env.TEMPLATE_PAD_WINDOW_CODE_LABELLED = '1';
  if (get('heading_absent_reread') === 'true') { env.HEADING_ABSENT_REREAD = '1'; env.HEADING_TITLE_GAP_COLLAPSE = '1'; env.REPROCESS_HEADING_GEOM = '1'; }
  if (get('vat_reg_not_amount') === 'true') env.CREDIT_SIGN_COHERENCE = '1';
  return env;
}

const ARMS = [
  { name: 'A baseline        ', delta: {} },
  { name: 'B name-unclip ON  ', delta: { NAME_UNCLIP_RECONCILE: '1' } },
];

// GROUND TRUTH. Justified, not assumed: every Pelican delivery note in the DB is addressed to the
// same customer (the only distinct customer_name values across the whole batch are Bramblewood
// spellings plus that company's own address line), 24 documents already read it exactly, the
// keyword_override rung reads it independently, and the owner marked every other value WRONG in
// the debug table. Comparison is on the NORMALISED string so pure spacing never counts as a change.
const GT = 'bramblewood joinery ltd';
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isGood = v => norm(v) === GT;
// The two owner-marked failure classes, for reporting which one moved.
const klass = (v) => {
  const n = norm(v);
  if (!n) return 'EMPTY';
  if (n === GT) return 'correct';
  if (/^unit\b/.test(n) || /sawpit/.test(n)) return 'WRONG-ROW (address)';
  if (/joinery/.test(n) || /bramb|dramb|sramb/.test(n)) return 'TRUNCATED/misread';
  return 'other';
};

function runP(folder, args, files, manifest, extraEnv) {
  return new Promise(resolve => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', w('s', files),
      '--mode', 'smart', '--tesseract', TESS, '--reprocess-manifest', w('m', manifest), ...args],
      { windowsHide: true, env: { ...process.env, ...extraEnv } });
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('close', () => {
      const docs = {};
      for (const ln of out.split('\n')) {
        const t = ln.trim(); if (t[0] !== '{') continue;
        let m; try { m = JSON.parse(t); } catch { continue; }
        if (m.type === 'file_done') docs[m.original_filename] = m;
      }
      resolve(docs);
    });
  });
}

(async () => {
  const db = new Database(path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db'), { readonly: true });
  const rows = db.prepare(`SELECT id, working_path, stored_path, template_id, status,
                             (SELECT slug FROM document_types WHERE id=document_type_id) type_slug
                           FROM documents
                           WHERE supplier_name LIKE 'Pelican%' AND status <> 'deleted'
                           ORDER BY id`).all();
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'nu-'));
  const files = [], manifest = {}, idOf = {}, statusOf = {};
  let missing = 0;
  for (const d of rows) {
    const src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : d.stored_path;
    if (!src || !fs.existsSync(src)) { missing++; continue; }
    const f = `doc${d.id}.pdf`;
    fs.copyFileSync(src, path.join(RR, f));
    manifest[f] = { known_template_id: d.template_id, known_doc_slug: d.type_slug };
    idOf[f] = d.id; statusOf[f] = d.status; files.push(f);
  }
  const dts = db.prepare('SELECT * FROM document_types').all();
  const fby = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (fby[f.document_type_id] ||= []).push(f);
  for (const t of dts) t.fields = fby[t.id] || [];
  const args = ['--fields-file', w('f', dts.flatMap(t => t.fields)),
    '--hints-file', w('h', safe(() => learning.getAllHints(db), [])),
    '--anchors-file', w('a', safe(() => learning.getAllAnchors(db), [])),
    '--logos-file', w('l', safe(() => learning.getAllLogos(db), [])),
    '--doc-types-file', w('d', dts),
    '--formats-file', w('fm', safe(() => learning.getFieldFormats(db), [])),
    '--templates-file', w('t', safe(() => templates.getAll(db), [])),
    '--label-overrides-file', w('lo', safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], [])),
    '--field-rules-file', w('fr', safe(() => learning.getFieldRules(db), [])),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
  const BASE = liveEnv(db);
  db.close();

  console.log(`NAME_UNCLIP A/B — ${files.length} Pelican docs (${missing} skipped: file missing), 2 arms`);
  console.log(`live env: ${Object.keys(BASE).sort().join(', ') || '(none)'}`);
  console.log(`NAME_UNCLIP_RECONCILE in baseline: ${BASE.NAME_UNCLIP_RECONCILE ? 'ON (!!)' : 'off (correct)'}`);
  console.log(`ground truth: "Bramblewood Joinery Ltd"\n`);

  const res = {};
  for (const a of ARMS) {
    const t0 = Date.now();
    res[a.name] = await runP(RR, args, files, manifest, { ...BASE, ...a.delta });
    console.log(`  arm ${a.name.trim()} done in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  try { fs.rmSync(RR, { recursive: true, force: true }); } catch {}
  const [A, B] = ARMS.map(a => res[a.name]);

  // ── customer_name: the field under test ────────────────────────────────────────────────────
  let healed = 0, regressed = 0, movedOther = 0, sameGood = 0, sameBad = 0;
  const healedRows = [], regressedRows = [], otherRows = [];
  for (const f of files) {
    const a = ef(A[f] || {}, 'customer_name'), b = ef(B[f] || {}, 'customer_name');
    const av = sv(a.value), bv = sv(b.value);
    const aG = isGood(av), bG = isGood(bv);
    const line = `  #${idOf[f]}  ${av.padEnd(26)} -> ${bv.padEnd(26)} ` +
                 `(c ${a.confidence}->${b.confidence}, ${String(a.method).slice(0, 22)} -> ${String(b.method).slice(0, 22)})`;
    if (!aG && bG)      { healed++;    healedRows.push(line); }
    else if (aG && !bG) { regressed++; regressedRows.push(line); }
    else if (norm(av) !== norm(bv)) { movedOther++; otherRows.push(line + `   [${klass(av)} -> ${klass(bv)}]`); }
    else if (aG)        sameGood++;
    else                sameBad++;
  }

  console.log(`\n=== customer_name ===`);
  if (healedRows.length)    { console.log(`\nHEALED (${healed}):`);           healedRows.forEach(l => console.log(l)); }
  if (regressedRows.length) { console.log(`\nREGRESSED (${regressed}):`);     regressedRows.forEach(l => console.log(l)); }
  if (otherRows.length)     { console.log(`\nMOVED, still not GT (${movedOther}):`); otherRows.forEach(l => console.log(l)); }

  console.log(`\n  HEALED ${healed} · REGRESSED ${regressed} · moved-but-still-wrong ${movedOther} ` +
              `· unchanged-correct ${sameGood} · unchanged-wrong ${sameBad}`);
  console.log(`  baseline correct: ${sameGood + regressed}/${files.length}   armed correct: ${sameGood + healed}/${files.length}`);

  // Which failure class did it address? The wrong-ROW class is a box-HEIGHT defect and this healer
  // is not expected to touch it — stating that up front stops a partial heal reading as a failure.
  const cls = {};
  for (const f of files) {
    const a = ef(A[f] || {}, 'customer_name'), b = ef(B[f] || {}, 'customer_name');
    const k = klass(sv(a.value));
    (cls[k] ||= { n: 0, healed: 0 }).n++;
    if (!isGood(a.value) && isGood(b.value)) cls[k].healed++;
  }
  console.log(`\n  by baseline failure class:`);
  for (const [k, v] of Object.entries(cls)) console.log(`    ${k.padEnd(22)} ${v.n} docs, ${v.healed} healed`);

  // ── collateral: everything else on this template must not move ─────────────────────────────
  console.log(`\n=== COLLATERAL (must be 0 moved) ===`);
  for (const key of ['delivery_number', 'delivery_date', 'supplier_name']) {
    let moved = 0;
    const lines = [];
    for (const f of files) {
      const a = ef(A[f] || {}, key), b = ef(B[f] || {}, key);
      if (norm(sv(a.value)) === norm(sv(b.value))) continue;
      moved++;
      lines.push(`  #${idOf[f]}  ${sv(a.value).padEnd(24)} -> ${sv(b.value).padEnd(24)} ` +
                 `(${String(a.method).slice(0, 20)} -> ${String(b.method).slice(0, 20)})`);
    }
    console.log(`  ${key}: ${moved} moved`);
    lines.forEach(l => console.log(l));
  }

  console.log(`\nVERDICT INPUT: the flip is defensible only if REGRESSED is 0 and collateral is 0.`);
})();
