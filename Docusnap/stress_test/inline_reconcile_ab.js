/** 007's E1: run the 9 Pelican delivery notes in two arms and compare delivery_number.
 *  Arm A = live baseline. Arm B = TEMPLATE_INLINE_CODE_RECONCILE_DRIFT=0 (existing kill switch,
 *  disables the :1241 reconcile call site).
 *  Prediction if 007 is right: the 4 failures commit the correct PD code; the 5 already-correct
 *  documents are UNCHANGED. Any regression among the 5 means the reconcile is load-bearing there.
 *  Read-only: temp copies, no DB writes. */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require('better-sqlite3');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null;
try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const w = (t, d) => { const f = path.join(os.tmpdir(), `e1_${t}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e : {}; };
const sv = v => (v == null ? '—' : String(v));

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
  { name: 'A baseline (reconcile ON)', delta: {} },
  { name: 'B drift-site OFF        ', delta: { TEMPLATE_INLINE_CODE_RECONCILE_DRIFT: '0' } },
  // Arm C (007, round 2): the DRIFT switch governs only the :1241 call site. The ABSOLUTE rung's
  // reconcile at :1880 has its OWN switch, TEMPLATE_INLINE_CODE_RECONCILE, and stayed armed in B —
  // which is why B healed only #730. Both off is the true isolation of the proposed overlap fix,
  // because _target_inline_with_anchor gates BOTH call sites.
  { name: 'C both sites OFF        ', delta: { TEMPLATE_INLINE_CODE_RECONCILE_DRIFT: '0',
                                               TEMPLATE_INLINE_CODE_RECONCILE: '0' } },
];

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
  const rows = db.prepare(`SELECT id, working_path, stored_path, template_id,
                             (SELECT slug FROM document_types WHERE id=document_type_id) type_slug
                           FROM documents WHERE supplier_name LIKE 'Pelican%' ORDER BY id`).all();
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-'));
  const files = [], manifest = {}, idOf = {};
  for (const d of rows) {
    const src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : d.stored_path;
    if (!src || !fs.existsSync(src)) continue;
    const f = `doc${d.id}.pdf`;
    fs.copyFileSync(src, path.join(RR, f));
    manifest[f] = { known_template_id: d.template_id, known_doc_slug: d.type_slug };
    idOf[f] = d.id; files.push(f);
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
  console.log(`E1 — ${files.length} Pelican delivery notes, 2 arms\nlive env: ${Object.keys(BASE).sort().join(', ')}\n`);

  const res = {};
  for (const a of ARMS) res[a.name] = await runP(RR, args, files, manifest, { ...BASE, ...a.delta });
  try { fs.rmSync(RR, { recursive: true, force: true }); } catch {}

  const [A, B, C] = ARMS.map(a => res[a.name]);
  let fixed = 0, regressed = 0, same = 0;
  console.log('  doc    baseline           B drift-off        C both-off         verdict');
  for (const f of files) {
    const a = ef(A[f] || {}, 'delivery_number'), b = ef(B[f] || {}, 'delivery_number'), c2 = ef(C[f] || {}, 'delivery_number');
    const av = sv(a.value), bv = sv(b.value), cv = sv(c2.value);
    const g = v => /^PD/i.test(v.replace(/[^A-Za-z0-9]/g, ''));
    const aGood = g(av), cGood = g(cv);
    let verdict = 'same';
    if (!aGood && cGood) { verdict = 'FIXED by C'; fixed++; }
    else if (aGood && !cGood) { verdict = 'REGRESSED <<<'; regressed++; }
    else same++;
    console.log(`  #${idOf[f]}  ${av.padEnd(18)} ${bv.padEnd(18)} ${cv.padEnd(18)} ${verdict}  ` +
                `(c ${a.confidence}->${c2.confidence}, ${String(a.method).slice(0, 24)} -> ${String(c2.method).slice(0, 24)})`);
  }
  console.log(`\n  FIXED ${fixed} · REGRESSED ${regressed} · unchanged ${same}`);
  console.log(`  007 round-2 predicted for arm C: all 5 failures heal, #732/#734 untouched.`);
})();
