/** TEACH-RUN A/B — replay the owner's 200-document teach test under a MUTATED learning state.
 *
 *  WHY. The teaching is manual and cannot be repeated cheaply, but almost every teach-side defect
 *  lives in what the teach WROTE (template rows, fixed values, the type slug it bound to), not in
 *  the drawing itself. So: read the taught state, mutate a COPY of it in memory, replay the same
 *  200 documents through the real pipeline, and score both arms against corpus ground truth. That
 *  measures the ceiling of a proposed fix in minutes, before a line of production code is written —
 *  and re-measures it afterwards.
 *
 *  READ-ONLY with respect to the app: the sandbox DB is opened readonly, documents are copied to a
 *  temp dir, nothing is written back. The mutation happens to the JSON handed to the extractor.
 *
 *  Arms are named on the command line; MUTATORS below defines them.
 *    ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe stress_test/teach_run_ab.js base unfreeze
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null;
try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}

const HOME = process.env.USERPROFILE || process.env.HOME;
const SANDBOX = process.env.TEACH_SANDBOX || path.join(HOME, 'Desktop', 'TESTING', '_sandbox');
const DB_PATH = process.env.TEACH_DB || path.join(SANDBOX, 'userData', 'docusnap.db');
const OUTDIR = path.join(HOME, 'Desktop', 'TESTING', 'arms');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const SHARDS = 8;

const w = (t, d) => { const f = path.join(os.tmpdir(), `tr_${t}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, d) => { try { return fn(); } catch { return d; } };
const COMPANY_KEYS = ['supplier_name'];

// ── ARM MUTATORS. Each takes {templates, anchors, hints, formats} and mutates in place. ─────────
// Every one of these simulates a CODE fix; none of them is the fix itself.
const MUTATORS = {
  base: () => {},

  // Simulates: never auto-freeze a template field except the ISSUER. Measures the ceiling of the
  // _buildTemplateFields freeze defect (review/handler.js:1323) — po_ref / serials / account_no are
  // frozen from a single taught document and stamped on every sibling as template_fixed @95.
  unfreeze: (S) => {
    let n = 0;
    for (const t of S.templates) {
      for (const f of (t.fields || [])) {
        if (COMPANY_KEYS.includes(f.field_key)) continue;
        if (f.is_variable === 0 || f.is_variable === false) {
          f.is_variable = 1; f.fixed_value = null; n++;
        }
      }
    }
    console.log(`    [unfreeze] released ${n} frozen field(s)`);
  },

  // Simulates: a taught template applies to its own siblings even when the type slug it was bound
  // to differs from the slug those siblings detect as. Retargets each template's slug to the slug
  // its OWN confirmed documents actually carry.
  retarget: (S, db) => {
    const rows = db.prepare(`SELECT d.template_id tid, dt.slug slug, COUNT(*) n
                             FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
                             WHERE d.template_id IS NOT NULL GROUP BY d.template_id, dt.slug`).all();
    const best = {};
    for (const r of rows) if (!best[r.tid] || r.n > best[r.tid].n) best[r.tid] = r;
    let n = 0;
    for (const t of S.templates) {
      const b = best[t.id];
      if (b && b.slug && b.slug !== t.document_type_slug) {
        console.log(`    [retarget] tpl ${t.id} ${t.name}: ${t.document_type_slug} -> ${b.slug}`);
        t.document_type_slug = b.slug; n++;
      }
    }
    if (!n) console.log('    [retarget] nothing to retarget from confirmed docs');
  },
};
MUTATORS['unfreeze+retarget'] = (S, db) => { MUTATORS.unfreeze(S); MUTATORS.retarget(S, db); };

// Simulates TEMPLATE_FREEZE_QUALIFY: release only those frozen values that the freeze guard would
// have refused to write in the first place (a printed CAPTION, a value failing the field's own
// format, or a code-role field holding no digit). The issuer and admin-locked rows are never
// touched. This is the NARROW cousin of `unfreeze` above — and the difference is the whole point:
// the blanket version measured vat_no 51% -> 16% because a VAT number IS a genuine per-supplier
// constant. It uses the SAME predicate module the product does, so the arm cannot drift from the
// shipped behaviour.
// IT PRINTS EVERY ROW IT RELEASES. An arm that releases nothing is VACUOUS and its green score
// proves nothing; an arm that releases as many rows as `unfreeze` means the predicate is too wide.
MUTATORS.freezequal = (S, db) => {
  const { freezeDeclineReason } = require(path.join(REPO, 'database', 'modules', 'freeze_guard.js'));
  const typeOf = {};
  try {
    for (const r of db.prepare(
      `SELECT dt.slug slug, f.key key, f.type type, f.label label
         FROM fields f JOIN document_types dt ON dt.id = f.document_type_id`).all()) {
      typeOf[`${(r.slug || '').toLowerCase()}|${r.key}`] = r;
    }
  } catch (e) { console.log('    [freezequal] field metadata unavailable:', e.message); }
  let released = 0, kept = 0;
  for (const t of S.templates) {
    for (const f of (t.fields || [])) {
      if (f.is_variable === 1 || f.is_variable === true) continue;
      if (!f.fixed_value) continue;
      if (f.fixed_locked === 1 || f.fixed_locked === true) { kept++; continue; }
      const meta = typeOf[`${(t.document_type_slug || '').toLowerCase()}|${f.field_key}`] || null;
      const reason = freezeDeclineReason(f.field_key, f.fixed_value, meta);
      if (!reason) { kept++; continue; }
      console.log(`    [freezequal] release tpl ${t.id} ${f.field_key} = ${JSON.stringify(f.fixed_value)} (${reason})`);
      f.is_variable = 1; f.fixed_value = null; released++;
    }
  }
  console.log(`    [freezequal] released ${released}, kept ${kept} frozen field(s)`);
};

// Arms that change CODE behaviour rather than learning state: the extractor reads these from env.
// Listed here so an arm name means one reproducible thing, rather than an env var someone typed.
// Arms that add process_docs CLI FLAGS. --deskew-pages is how "Straighten + Reprocess" works;
// it is passed only on reprocess today, never on import, because deskewing changes the coordinate
// frame and is NOT monotone. This arm measures whether that parking still holds on real scans.
const ARM_ARGS = {
  deskew:       ['--deskew-pages', '--deskew-min-angle', '0.2'],
  fixes_deskew: ['--deskew-pages', '--deskew-min-angle', '0.2'],
  // Oracle C2, the discriminating experiment: the corpus generator tilts pages by at most 1.6
  // degrees (gen_customer_test.py:675), so a 2.0 floor must leave every page untouched. If the
  // measured heal VANISHES here, the entire gain came from the 0.2-1.6 band — the band Tesseract
  // self-tolerates and which the doc-561 probe measured as HARMFUL on real paper.
  deskew20:     ['--deskew-pages', '--deskew-min-angle', '2.0'],
};

// Arms that REMOVE a CLI arg the run normally passes. `buildArgs` hardcodes `--registration`, and
// process_docs.py is its only consumer, so dropping it turns the transform fit off globally.
// DIAGNOSTIC ONLY, never a candidate configuration: it also kills the legitimate registration
// FALLBACK rung and the Stage-2 anchor_registration path, so it will cost accuracy elsewhere.
// What it answers (Oracle/gary, 2026-08-09): the registration ARBITER at template_mapper.py:2231
// has `abs_text` as its FIRST conjunct, so it can only fire when the taught box ALREADY produced a
// read — which it then discards on a geometry-only verdict. With registration off, that door is
// shut and the absolute/inline mapping read is what commits. If the 22 wrong issuers come back
// CORRECT, the arbiter was destroying good reads and any decline-branch fix is containment, not a
// cure. If they come back wrong or empty, registration was filling a real hole badly.
const ARM_DROP_ARGS = {
  noreg: ['--registration'],
};

const ARM_ENV = {
  refgate:  { STAGE05_REF_CODE_GATE: '1' },
  exclusive:{ KEYWORD_GENERIC_CAPTION_EXCLUSIVE: '1' },
  typeowner:{ TYPE_TITLE_OWNER_PRECEDENCE: '1' },
  fixes:    { STAGE05_REF_CODE_GATE: '1', KEYWORD_GENERIC_CAPTION_EXCLUSIVE: '1',
              TYPE_TITLE_OWNER_PRECEDENCE: '1' },
  fixes_deskew: { STAGE05_REF_CODE_GATE: '1', KEYWORD_GENERIC_CAPTION_EXCLUSIVE: '1',
              TYPE_TITLE_OWNER_PRECEDENCE: '1', FILING_VALUE_SANITY_FLAGS: '1' },
  sanity:   { FILING_VALUE_SANITY_FLAGS: '1' },
  all_on:   { STAGE05_REF_CODE_GATE: '1', KEYWORD_GENERIC_CAPTION_EXCLUSIVE: '1',
              TYPE_TITLE_OWNER_PRECEDENCE: '1', FILING_VALUE_SANITY_FLAGS: '1',
              TEACH_ANGLE_COMPOSE_SCAN: '1', TEMPLATE_FIXED_NEAR_MATCH_RECONCILE: '1',
              TEMPLATE_FIXED_FRAGMENT_DECLINE: '1', TEMPLATE_FIXED_ISSUER_REPAIR: '1',
              TEMPLATE_ABS_EDGE_GUARD: '1', TEMPLATE_CURRENCY_EDGE_GROW: '1' },
  issuer:   { STAGE05_REF_CODE_GATE: '1', KEYWORD_GENERIC_CAPTION_EXCLUSIVE: '1',
              TYPE_TITLE_OWNER_PRECEDENCE: '1', FILING_VALUE_SANITY_FLAGS: '1',
              TEACH_ANGLE_COMPOSE_SCAN: '1', TEMPLATE_FIXED_NEAR_MATCH_RECONCILE: '1',
              TEMPLATE_FIXED_FRAGMENT_DECLINE: '1', TEMPLATE_FIXED_ISSUER_REPAIR: '1' },
  // ── the 2026-08-09 MONEY arms. `issuer` is their OFF baseline (it is the launch set with neither
  // money flag), so an `issuer` re-run also proves the code edit is byte-identical with both off.
  // TEMPLATE_ABS_EDGE_GUARD / TEMPLATE_TARGET_WORD_SNAP are not listed: both are `true` settings in
  // the sandbox DB, so every arm already inherits them — which is what makes `money_snap` a real
  // measurement of the snap admission rather than of the snap itself.
  money_snap: { STAGE05_REF_CODE_GATE: '1', KEYWORD_GENERIC_CAPTION_EXCLUSIVE: '1',
              TYPE_TITLE_OWNER_PRECEDENCE: '1', FILING_VALUE_SANITY_FLAGS: '1',
              TEACH_ANGLE_COMPOSE_SCAN: '1', TEMPLATE_FIXED_NEAR_MATCH_RECONCILE: '1',
              TEMPLATE_FIXED_FRAGMENT_DECLINE: '1', TEMPLATE_FIXED_ISSUER_REPAIR: '1',
              TEMPLATE_CURRENCY_EDGE_GROW: '1' },
  money_row: { STAGE05_REF_CODE_GATE: '1', KEYWORD_GENERIC_CAPTION_EXCLUSIVE: '1',
              TYPE_TITLE_OWNER_PRECEDENCE: '1', FILING_VALUE_SANITY_FLAGS: '1',
              TEACH_ANGLE_COMPOSE_SCAN: '1', TEMPLATE_FIXED_NEAR_MATCH_RECONCILE: '1',
              TEMPLATE_FIXED_FRAGMENT_DECLINE: '1', TEMPLATE_FIXED_ISSUER_REPAIR: '1',
              TEMPLATE_DRIFT_ROW_PITCH: '1' },
  money:    { STAGE05_REF_CODE_GATE: '1', KEYWORD_GENERIC_CAPTION_EXCLUSIVE: '1',
              TYPE_TITLE_OWNER_PRECEDENCE: '1', FILING_VALUE_SANITY_FLAGS: '1',
              TEACH_ANGLE_COMPOSE_SCAN: '1', TEMPLATE_FIXED_NEAR_MATCH_RECONCILE: '1',
              TEMPLATE_FIXED_FRAGMENT_DECLINE: '1', TEMPLATE_FIXED_ISSUER_REPAIR: '1',
              TEMPLATE_CURRENCY_EDGE_GROW: '1', TEMPLATE_DRIFT_ROW_PITCH: '1' },
  // Oracle's ruling: fix PLACEMENT, not pixels. Composes the taught box by (theta_teach -
  // theta_scan) using a non-destructive skew measurement. No page is rotated.
  compose:  { STAGE05_REF_CODE_GATE: '1', KEYWORD_GENERIC_CAPTION_EXCLUSIVE: '1',
              TYPE_TITLE_OWNER_PRECEDENCE: '1', FILING_VALUE_SANITY_FLAGS: '1',
              TEACH_ANGLE_COMPOSE_SCAN: '1' },
  deskew20: { STAGE05_REF_CODE_GATE: '1', KEYWORD_GENERIC_CAPTION_EXCLUSIVE: '1',
              TYPE_TITLE_OWNER_PRECEDENCE: '1', FILING_VALUE_SANITY_FLAGS: '1' },
  all4:     { STAGE05_REF_CODE_GATE: '1', KEYWORD_GENERIC_CAPTION_EXCLUSIVE: '1',
              TYPE_TITLE_OWNER_PRECEDENCE: '1', FILING_VALUE_SANITY_FLAGS: '1' },
  // THE APP'S ACTUAL CURRENT STATE (2026-08-09). `all4` is NOT the live baseline: the settings
  // mirror above only arms a flag when the settings KEY uppercased happens to equal the env var,
  // and it does not here — `template_fixed_near_match` bridges to TEMPLATE_FIXED_NEAR_MATCH_RECONCILE
  // and `template_fixed_fragment` to TEMPLATE_FIXED_FRAGMENT_DECLINE (handler.js), both `true` in
  // the live DB. So `all4` silently understates the app by two flags. Use THIS arm as the baseline
  // when asking what bridging TEACH_ANGLE_COMPOSE_SCAN + TEMPLATE_FIXED_ISSUER_REPAIR actually buys
  // — `issuer` minus `applive` is exactly those two, and nothing else.
  applive:  { STAGE05_REF_CODE_GATE: '1', KEYWORD_GENERIC_CAPTION_EXCLUSIVE: '1',
              TYPE_TITLE_OWNER_PRECEDENCE: '1', FILING_VALUE_SANITY_FLAGS: '1',
              TEMPLATE_FIXED_NEAR_MATCH_RECONCILE: '1', TEMPLATE_FIXED_FRAGMENT_DECLINE: '1' },
};
// THE ISSUER CURE (2026-08-09 NIGHT). `noreg` proved the arbiter was destroying good taught reads
// by switching registration off wholesale — a diagnostic, not a candidate. This arm is the real
// fix: the arbiter keeps its jurisdiction, but may only override where the field's own caption was
// looked for AND failed. Same env as `money` plus one flag, so `arbiter` minus `money` is exactly
// TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE and nothing else — and `money` re-run is the OFF twin that
// proves the code edit is byte-identical with the flag off.
ARM_ENV.arbiter = { ...ARM_ENV.money, TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE: '1' };
// Fix 2 measured ON TOP of Fix 1, never instead of it (Oracle G2). The region-scoped presence
// confirm keeps a curated issuer seed when that name is actually printed in the padded taught box.
// Expect it near-inert HERE — the arbiter fix already heals the documents this corpus exhibits; its
// value is the genuinely-drifted-page case, which this corpus does not contain. Say so honestly
// rather than reporting the pair's heal twice.
ARM_ENV.arbiter_presence = { ...ARM_ENV.arbiter, TEMPLATE_ISSUER_REGION_PRESENCE: '1' };
// The first residual the issuer gate surfaced: an agreeing mapping read still displaces the curated
// seed, so a CORRECT issuer costs 95 -> 78 and four documents fall out of the >=88 band. This arm
// measures keeping the seed on exact agreement — and what to watch is NOT the lane score (the value
// is identical either way) but the METHOD/CONFIDENCE diff, and whether any supplier is BLANKED:
// keeping `template_fixed` re-arms TEMPLATE_FIXED_NAME_PRESENCE_VETO, which can blank a sender.
ARM_ENV.arbiter_agree = { ...ARM_ENV.arbiter_presence, TEMPLATE_FIXED_SEED_AGREEMENT_KEEP: '1' };
// A MUTATOR arm gets NO env of its own unless it is named here, and the settings mirror only arms
// a flag whose uppercased settings key equals the env var. `freezequal` first ran without the
// `applive` set and the two arms differed by TWO variables, not one: 40 account_no cells moved on
// scopes the mutator never touched (untaught issuers, which change when TYPE_TITLE_OWNER_PRECEDENCE
// is absent). Give a mutator arm the env of the arm it is compared against, or it answers nothing.
ARM_ENV.freezequal = { ...ARM_ENV.applive };
// COLD START: the same configuration plus the letterhead issuer reader, which fires only where
// nothing else could name the sender. Measures the ONE case a fresh customer meets on day one -
// a supplier the app has never seen - and it is measured on the SUGGESTION, not on the value: the
// reader deliberately leaves the field empty and offers the name.
ARM_ENV.coldstart = { ...ARM_ENV.applive, LETTERHEAD_ISSUER: '1' };
// The page's own wording is not a value. Measured against what is actually PRINTED: account_no is
// committed on 40 pages that carry no account number, and serials commits the literal 'Serial No:'
// on 19. Both are a confident value with NO SOURCE on the page - the worst kind, because the human
// checking it has nothing to compare against.
ARM_ENV.captionrefuse = { ...ARM_ENV.freezequal, CAPTION_VALUE_REFUSE: '1' };
// ORACLE C2. The claim "no supplier was blanked" was VACUOUS on this corpus:
// TEMPLATE_FIXED_NAME_PRESENCE_VETO — the guard that can BLANK a stamped supplier — needs
// TEMPLATE_NAME_PRESENCE_MIN_SAMPLE (default 3) confirmed documents for that supplier, and the
// taught state has ONE. So it abstained on all 200 documents and measured nothing at all about the
// destructive path TEMPLATE_FIXED_SEED_AGREEMENT_KEEP re-arms. Forcing the floor to 1 is the only
// way to see what that flag would do on an install that has been running long enough to matter.
ARM_ENV.agree_veto = { ...ARM_ENV.freezequal, TEMPLATE_FIXED_SEED_AGREEMENT_KEEP: '1',
                       TEMPLATE_NAME_PRESENCE_MIN_SAMPLE: '1' };
MUTATORS.agree_veto = MUTATORS.freezequal;
// The control that makes it non-vacuous: the same forced floor WITHOUT the agreement flag. If both
// arms blank the same suppliers, the blanking is the veto's own behaviour on this corpus and not
// something the agreement flag introduced.
ARM_ENV.veto_only = { ...ARM_ENV.freezequal, TEMPLATE_NAME_PRESENCE_MIN_SAMPLE: '1' };
MUTATORS.veto_only = MUTATORS.freezequal;
// THE WRONG-COMPANY MISFILE. A template whose keyword fingerprint is the OWNER's own address block
// (which every incoming document carries, as the recipient) claimed 18 documents from a different
// company and stamped its frozen issuer at 95. `identity` requires a template's own company name to
// appear somewhere on the page before a TEXT-arm match is accepted. Compare against `misfile_base`,
// which is the same configuration with the guard off - one variable.
ARM_ENV.misfile_base = { ...ARM_ENV.applive };
MUTATORS.misfile_base = () => {};
ARM_ENV.identity = { ...ARM_ENV.applive, TEMPLATE_IDENTITY_ON_PAGE: '1' };
MUTATORS.identity = () => {};
MUTATORS.captionrefuse = MUTATORS.freezequal;
// `noreg` must differ from the arm that MEASURED the 22 failures by exactly ONE thing: the
// `--registration` CLI arg. Give it that arm's env verbatim, or the diagnostic moves two variables
// and answers nothing.
ARM_ENV.noreg = { ...ARM_ENV.money };

for (const k of Object.keys(ARM_ENV)) if (!MUTATORS[k]) MUTATORS[k] = () => {};
for (const k of Object.keys(ARM_ARGS)) if (!MUTATORS[k]) MUTATORS[k] = () => {};

function buildArgs(S) {
  return ['--fields-file', w('f', S.fields),
    '--hints-file', w('h', S.hints),
    '--anchors-file', w('a', S.anchors),
    '--logos-file', w('l', S.logos),
    '--doc-types-file', w('d', S.dts),
    '--formats-file', w('fm', S.formats),
    '--templates-file', w('t', S.templates),
    '--label-overrides-file', w('lo', S.overrides),
    '--field-rules-file', w('fr', S.rules),
    '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
}

function runShards(folder, args, files, manifest, extraEnv, onDoc) {
  const shards = Array.from({ length: SHARDS }, () => []);
  files.forEach((f, i) => shards[i % SHARDS].push(f));
  const one = names => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', w('s', names),
      '--mode', 'smart', '--tesseract', TESS, '--reprocess-manifest', w('m', manifest), ...args],
      { windowsHide: true, env: { ...process.env, ...extraEnv } });
    let out = '', tail = '';
    p.stdout.on('data', d => {
      out += d; tail += d;
      const lines = tail.split('\n'); tail = lines.pop();
      for (const ln of lines) {
        const t = ln.trim(); if (t[0] !== '{') continue;
        let m; try { m = JSON.parse(t); } catch { continue; }
        if (m.type === 'file_done' && onDoc) { try { onDoc(m); } catch {} }
      }
    });
    p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(shards.filter(s => s.length).map(one)).then(outs => {
    const docs = {};
    for (const o of outs) for (const ln of o.split('\n')) {
      const t = ln.trim(); if (t[0] !== '{') continue;
      let m; try { m = JSON.parse(t); } catch { continue; }
      if (m.type === 'file_done') docs[m.original_filename] = m;
    }
    return docs;
  });
}

(async () => {
  const arms = process.argv.slice(2).filter(a => MUTATORS[a]);
  if (!arms.length) { console.error('usage: teach_run_ab.js <arm> [arm...]   arms: ' + Object.keys(MUTATORS).join(', ')); process.exit(1); }
  fs.mkdirSync(OUTDIR, { recursive: true });

  const db = new Database(DB_PATH, { readonly: true });
  // The 200 imported siblings only — never the taught documents (they are trivially correct).
  const rows = db.prepare(`SELECT id, original_filename, working_path, stored_path, template_id, status,
                             (SELECT slug FROM document_types WHERE id = document_type_id) type_slug
                           FROM documents WHERE status <> 'deleted' ORDER BY id`).all();
  const man = JSON.parse(fs.readFileSync(path.join(HOME, 'Desktop', 'TESTING', 'run_manifest.json'), 'utf8'));
  const taught = new Set(man.scopes.map(s => s.teach_file));

  const RR = fs.mkdtempSync(path.join(os.tmpdir(), 'teachab-'));
  const files = [], manifest = {}, statusOf = {};
  let missing = 0;
  for (const d of rows) {
    if (taught.has(d.original_filename)) continue;
    const src = (d.working_path && fs.existsSync(d.working_path)) ? d.working_path : d.stored_path;
    if (!src || !fs.existsSync(src)) { missing++; continue; }
    // keep the ORIGINAL filename so the scorer can map it back to its scope + ground truth
    fs.copyFileSync(src, path.join(RR, d.original_filename));
    // FRESH-IMPORT MODE (TEACH_FRESH_IDENTIFY=1). The manifest normally carries the template this
    // document is ALREADY bound to, because the harness models REPROCESS — and reprocess deliberately
    // keeps the known binding rather than re-identifying. That makes the harness structurally blind
    // to every identification-layer change: a fix to WHICH template is chosen cannot move a single
    // cell, because the choice is never made. (Discovered 2026-08-10 gating the wrong-company
    // misfile: two arms came back byte-identical and the guard looked inert, when in fact it was
    // never reached.) Dropping the known ids makes each document identify itself from scratch, which
    // is what a fresh IMPORT does — the path the defect actually arrives on.
    manifest[d.original_filename] = process.env.TEACH_FRESH_IDENTIFY === '1'
      ? {}
      : { known_template_id: d.template_id, known_doc_slug: d.type_slug };
    statusOf[d.original_filename] = d.status;
    files.push(d.original_filename);
  }

  const dts = db.prepare('SELECT * FROM document_types').all();
  const fby = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (fby[f.document_type_id] ||= []).push(f);
  for (const t of dts) t.fields = fby[t.id] || [];
  const BASE_STATE = {
    fields: dts.flatMap(t => t.fields), dts,
    hints: safe(() => learning.getAllHints(db), []),
    anchors: safe(() => learning.getAllAnchors(db), []),
    logos: safe(() => learning.getAllLogos(db), []),
    formats: safe(() => learning.getFieldFormats(db), []),
    templates: safe(() => templates.getAll(db), []),
    overrides: safe(() => labelOverrides ? labelOverrides.getForExtraction(db) : [], []),
    rules: safe(() => learning.getFieldRules(db), []),
  };
  // live switch state, so arm `base` is the owner's real behaviour
  const env = {};
  const rawSettings = db.prepare('SELECT key, value FROM settings').all();
  for (const r of rawSettings) {
    if (r.value !== 'true') continue;
    env[r.key.toUpperCase()] = '1';
  }
  // NON-BOOLEAN settings are invisible to the loop above (`value !== 'true'` skips them), and
  // `ocr_dpi` is one — so until 2026-08-09 every number this harness produced was rendered at
  // Python's 300 default while the app rendered at the owner's setting. Render DPI moves word
  // geometry, tokenisation and OCR confidence, which is exactly what the clip / snap / drift work
  // turns on, so the absolute lane scores did not describe the app. (A/B deltas between two arms
  // were never affected — both arms shared the error.)
  // Mirror `_ocrDpiEnv` in src/modules/processing/handler.js:91-96 EXACTLY: it emits
  // OCR_RENDER_DPI only when the setting differs from 300, so an unset/300 install stays
  // byte-identical. Do not "simplify" this to always setting the var.
  const _dpi = parseInt((rawSettings.find(r => r.key === 'ocr_dpi') || {}).value || '300', 10);
  if (Number.isFinite(_dpi) && _dpi > 0 && _dpi !== 300) {
    env.OCR_RENDER_DPI = String(_dpi);
    console.log(`    [dpi] OCR_RENDER_DPI=${_dpi} (matching the app; harness default was 300)`);
  }
  console.log(`teach-run A/B — ${files.length} sibling docs (${missing} missing), arms: ${arms.join(', ')}`);

  for (const arm of arms) {
    const S = JSON.parse(JSON.stringify(BASE_STATE));
    console.log(`\n=== arm ${arm} ===`);
    MUTATORS[arm](S, db);
    const t0 = Date.now();
    let done = 0;
    const step = Math.max(1, Math.ceil(files.length / 10));
    const armEnv = { ...env, ...(ARM_ENV[arm] || {}) };
    if (ARM_ENV[arm]) console.log(`    [env] ${Object.keys(ARM_ENV[arm]).join(', ')}`);
    let armArgs = ARM_ARGS[arm] ? [...buildArgs(S), ...ARM_ARGS[arm]] : buildArgs(S);
    if (ARM_ARGS[arm]) console.log(`    [args] ${ARM_ARGS[arm].join(' ')}`);
    if (ARM_DROP_ARGS[arm]) {
      armArgs = armArgs.filter(a => !ARM_DROP_ARGS[arm].includes(a));
      console.log(`    [args] DROPPED ${ARM_DROP_ARGS[arm].join(' ')} — diagnostic arm, not a candidate config`);
    }
    const res = await runShards(RR, armArgs, files, manifest, armEnv, () => {
      if (++done % step === 0 || done === files.length) {
        process.stdout.write(`    ${Math.round(100 * done / files.length)}% (${done}/${files.length})\n`);
      }
    });
    // emit in the shape stress_test/score_teach_run.py already consumes
    const out = files.map(fn => {
      const m = res[fn] || {};
      const fields = {};
      for (const [k, v] of Object.entries(m.extractions || {})) {
        if (k.startsWith('_') || !v || typeof v !== 'object') continue;
        fields[k] = { v: v.value, raw: v.value, c: v.confidence, m: v.method, note: v.validation_note || null, corr: 0 };
      }
      return { id: null, original_filename: fn, status: statusOf[fn] || 'needs_review',
               supplier_name: m.supplier_name || null, document_type_id: null,
               template_id: m._template_id ?? null, overall_confidence: m.overall_confidence ?? null,
               fields };
    });
    const dest = path.join(OUTDIR, `${arm}.json`);
    fs.writeFileSync(dest, JSON.stringify(out, null, 1));
    console.log(`    arm ${arm} done in ${Math.round((Date.now() - t0) / 1000)}s -> ${dest}`);
  }
  try { fs.rmSync(RR, { recursive: true, force: true }); } catch {}
  db.close();
  console.log(`\nscore with:\n  py -3.12 stress_test/score_teach_run.py --json "${path.join(OUTDIR, arms[0] + '.json')}" --label ${arms[0]}`);
})();
