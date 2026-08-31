/**
 * vat_gate_probe.js — the Castellan arm of the VAT_REG_NOT_AMOUNT gate (Oracle gate item 5)
 * plus the SEAM B reconcile_pick census (gate item 3, BLOCKING).
 *
 * READ-ONLY: opens the live DB readonly, copies each document's working file to a temp dir and
 * runs process_docs over it. It NEVER writes the DB — so this is not a live reprocess and the
 * owner's queue is untouched.
 *
 * Adapted from stress_test/registration_gate_probe.js. Two differences that matter:
 *  - SETTING_ENV extended with the flags the owner has flipped SINCE that probe was written
 *    (template_fixed_*, pad-window code, credit_sign_coherence). Without them the "baseline" would
 *    not be what the owner actually runs, and the supplier column would regress spuriously.
 *  - --trace is on for BOTH arms so reconcile_pick events can be counted per document. Oracle:
 *    any NEW reconcile_pick under the armed arm is a BLOCKER, because removing the phantom tax
 *    makes the SUBTOTAL a perfectly reconciling total candidate.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe <this file>
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const REPO = 'c:/GIT Projects/Docusnap';
// This probe lives in the session scratchpad, OUTSIDE the repo, so bare requires do not resolve.
const Database = require('better-sqlite3');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null;
try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const FIELDS = (process.env.FIELDS || 'supplier_name,total_amount,vat_tax,subtotal,credit_note_number').split(',');
const w = (tag, d) => { const f = path.join(os.tmpdir(), `vgp_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
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
  // flipped since the registration probe was written — omitting these would misreport the baseline
  template_fixed_near_match: 'TEMPLATE_FIXED_NEAR_MATCH_RECONCILE',
  template_fixed_fragment: 'TEMPLATE_FIXED_FRAGMENT_DECLINE',
  template_pad_window_code: 'TEMPLATE_PAD_WINDOW_CODE',
  credit_sign_coherence: 'CREDIT_SIGN_COHERENCE',
};
function liveBaselineEnv(db) {
  const env = {};
  const get = k => { try { return learning.getSetting(db, k, 'false'); } catch { return 'false'; } };
  for (const [k, v] of Object.entries(SETTING_ENV)) if (get(k) === 'true') env[v] = '1';
  if (get('template_pad_window_code') === 'true' && get('template_pad_window_code_labelled') === 'true') env.TEMPLATE_PAD_WINDOW_CODE_LABELLED = '1';
  if (get('heading_absent_reread') === 'true') { env.HEADING_ABSENT_REREAD = '1'; env.HEADING_TITLE_GAP_COLLAPSE = '1'; env.REPROCESS_HEADING_GEOM = '1'; }
  const dpi = parseInt(get('ocr_dpi') === 'false' ? '300' : learning.getSetting(db, 'ocr_dpi', '300'), 10);
  if (Number.isFinite(dpi) && dpi >= 100 && dpi <= 600 && dpi !== 300) env.OCR_RENDER_DPI = String(dpi);
  return env;
}
const RECIPES = [
  { name: 'baseline (VAT_REG_NOT_AMOUNT off)', delta: {} },
  { name: 'armed    (VAT_REG_NOT_AMOUNT=1)',   delta: { VAT_REG_NOT_AMOUNT: '1' } },
  // Arm 3: the compensating control. A1 disarms the "total looks like the subtotal (tax not
  // included)" note, because that arm needs a tax to be present — so a NET-as-gross total loses a
  // TRUE flag (measured: 4 corpus docs + live #711, whose -854.70 x 1.2 = -1,025.64). This arm
  // tests whether NET_MISREAD_TOTAL_FLAG (built dark 2026-08-08, engine.py:1956) restores that flag
  // by a route that does not depend on a phantom tax.
  { name: 'armed+net (VAT_REG + NET_MISREAD)', delta: { VAT_REG_NOT_AMOUNT: '1', NET_MISREAD_TOTAL_FLAG: '1' } },
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
    '--config-file', CFG, '--registration', '--born-digital', '--multiline', '--trace'];
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
      const docs = {}, traces = {};
      let cur = null;
      for (const ln of out.split('\n')) {
        const t = ln.trim(); if (t[0] !== '{') continue;
        let m; try { m = JSON.parse(t); } catch { continue; }
        if (m.type === 'file_begin') cur = m.filename;
        if (m.type === 'trace') { const k = m.doc || cur || '?'; (traces[k] || (traces[k] = [])).push(m); }
        if (m.type === 'file_done') docs[m.original_filename] = m;
      }
      resolve({ docs, traces });
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
  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'vatgate-'));
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
  const BASE = liveBaselineEnv(db);
  db.close();
  console.log(`VAT-reg gate probe — ${files.length} docs (template 32)`);
  console.log(`Live baseline env: ${Object.keys(BASE).sort().join(', ') || '(none)'}\n`);

  const res = {};
  for (const rec of RECIPES) res[rec.name] = await runP(RR, args, files, manifest, { ...BASE, ...rec.delta });
  try { fs.rmSync(RR, { recursive: true, force: true }); } catch {}

  const [B, A, C] = RECIPES.map(r => res[r.name]);
  const cnt = (tr, ev) => (tr || []).filter(t => t.event === ev).length;
  const note = (m, k) => ((ef(m || {}, k).validation_note) || '').trim();

  console.log('=== per-document: baseline -> armed -> armed+net (Oracle gate 5, enumerated) ===');
  let notesCleared = 0, notesGained = 0, totalsChanged = 0, newPicks = 0, vatSkips = 0;
  let unflaggedByA1 = 0, restoredByNet = 0, newNotesFromNet = 0;
  for (const fname of files) {
    const id = fnameToId[fname];
    const mb = B.docs[fname], ma = A.docs[fname], mc = C.docs[fname];
    if (!mb || !ma) { console.log(`  #${id} (missing result)`); continue; }
    const tb = ef(mb, 'total_amount'), ta = ef(ma, 'total_amount'), tc = ef(mc || {}, 'total_amount');
    const vb = ef(mb, 'vat_tax'), va = ef(ma, 'vat_tax');
    const nb = note(mb, 'total_amount'), na = note(ma, 'total_amount'), nc = note(mc, 'total_amount');
    const pickB = cnt(B.traces[fname], 'reconcile_pick'), pickA = cnt(A.traces[fname], 'reconcile_pick');
    const skips = cnt(A.traces[fname], 'vat_reg_skip');
    vatSkips += skips;
    if (nb && !na) { notesCleared++; unflaggedByA1++; if (nc) restoredByNet++; }
    if (!nb && na) notesGained++;
    if (!na && nc) newNotesFromNet++;
    if (sv(tb.value) !== sv(ta.value)) totalsChanged++;
    if (pickA > pickB) newPicks++;
    const flags = [
      nb && !na ? (nc ? 'NOTE-CLEARED->RESTORED-BY-NET' : 'NOTE-CLEARED (stays clear)') : '',
      !nb && na ? 'NOTE-GAINED' : '',
      sv(tb.value) !== sv(ta.value) ? 'TOTAL-CHANGED' : '',
      pickA > pickB ? 'NEW-RECONCILE-PICK(BLOCKER)' : '',
      sv(tc.value) !== sv(ta.value) ? 'NET-ARM-CHANGED-TOTAL' : '',
    ].filter(Boolean).join(' ');
    console.log(`  #${id}  vat ${sv(vb.value).padEnd(10)} -> ${sv(va.value).padEnd(10)}  ` +
                `total ${sv(tb.value).padEnd(12)} -> ${sv(ta.value).padEnd(12)}  ` +
                `pick ${pickB}->${pickA}  skip=${skips}  ${flags}`);
    if (nb || na || nc) {
      console.log(`        base     : ${nb || '(none)'}`);
      console.log(`        armed    : ${na || '(none)'}`);
      console.log(`        armed+net: ${nc || '(none)'}`);
    }
  }

  console.log(`\n=== summary ===`);
  console.log(`  documents                 : ${files.length}`);
  console.log(`  vat_reg_skip fires (armed): ${vatSkips}`);
  console.log(`  notes CLEARED             : ${notesCleared}`);
  console.log(`  notes GAINED              : ${notesGained}`);
  console.log(`  totals CHANGED            : ${totalsChanged}   ${totalsChanged ? '<-- inspect each' : ''}`);
  console.log(`  NEW reconcile_pick        : ${newPicks}   ${newPicks ? '<-- BLOCKER (Oracle gate 3)' : 'OK'}`);
  // ORACLE G4 (survival census). validator.py:695 writes its note with NO existing-note guard, and
  // total_data is read AFTER the net helper ran — so the reconcile note can silently OVERWRITE a net
  // note. The document stays flagged either way, so note COUNTS look identical while the better note
  // degrades to the vague one. Compare net_misread_flag decision='flag' TRACE events against net
  // notes actually present in the final output; a gap is a clobber.
  let netDecided = 0, netSurvived = 0;
  for (const fname of files) {
    const decided = (C.traces[fname] || []).filter(t => t.event === 'net_misread_flag' && t.decision === 'flag').length;
    const abstained = (C.traces[fname] || []).filter(t => t.event === 'net_misread_flag' && t.decision === 'skip'
                                                          && /credit-sign/.test(String(t.reason || ''))).length;
    netDecided += decided;
    if (decided && /part-total/.test(note(C.docs[fname], 'total_amount'))) netSurvived++;
    if (abstained) console.log(`  #${fnameToId[fname]}  net ABSTAINED for the credit-sign note (Oracle C1)`);
  }
  console.log(`  -- G4 survival census --`);
  console.log(`  net decided to flag       : ${netDecided}`);
  console.log(`  net note SURVIVED to output: ${netSurvived}   ${netDecided !== netSurvived ? '<-- CLOBBERED by validator.py:695' : 'OK'}`);
  console.log(`  -- compensating control --`);
  console.log(`  unflagged by A1           : ${unflaggedByA1}`);
  console.log(`  of those, RESTORED by net : ${restoredByNet}`);
  console.log(`  notes ADDED by the net arm: ${newNotesFromNet}   (cost: any of these on a CORRECT total is a false flag)`);
  console.log(`\n  supplier column (must be unchanged):`);
  for (const fname of files) {
    const id = fnameToId[fname], sb = ef(B.docs[fname] || {}, 'supplier_name'), sa = ef(A.docs[fname] || {}, 'supplier_name');
    if (sv(sb.value) !== sv(sa.value)) console.log(`    #${id} CHANGED ${sv(sb.value)} -> ${sv(sa.value)}`);
  }
})();
