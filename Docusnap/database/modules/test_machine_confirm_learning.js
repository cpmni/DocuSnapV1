'use strict';
/*
 * test_machine_confirm_learning.js — PINs for LEARNING_EXCLUDE_MACHINE_CONFIRMS (machine-feed
 * arc slice 1; gary design → Oracle SIGN-OFF-W/COND C1-C6, 2026-08-13; DEFAULT OFF).
 *
 * The T3 principle one level down: a machine auto-file of a garbled read must not manufacture
 * the learning evidence the machine then consumes (the Quillstone lexicon poison).
 *
 * Run:  ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe database/modules/test_machine_confirm_learning.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const learning = require('./learning');
const { MACHINE_VIAS, MACHINE_VIAS_SQL, MACHINE_VIAS_SET } = require('./machine_vias');

let passed = 0, failed = 0;
const check = (name, ok) => {
  if (ok) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL ${name}`); }
};

function mkDb({ withVia = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY, supplier_name TEXT, document_type_id INTEGER,
      status TEXT, confirmed_at TEXT${withVia ? ', confirmed_via TEXT' : ''});
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, slug TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY, document_type_id INTEGER, key TEXT, type TEXT);
    CREATE TABLE extractions (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT,
      display_value TEXT, extraction_method TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT,
      corrected_value TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  db.prepare("INSERT INTO document_types (id, slug) VALUES (1, 'quote')").run();
  return db;
}

// Fixture: 3 human confirms of the TRUE name + one machine confirm per sentinel via of a GARBLE.
function seed(db, { withVia = true } = {}) {
  let id = 0;
  const addDoc = (via) => {
    id++;
    if (withVia) {
      db.prepare(`INSERT INTO documents (id, supplier_name, document_type_id, status, confirmed_at, confirmed_via)
                  VALUES (?, 'Quillstone', 1, 'confirmed', '2026-08-0${(id % 9) + 1}', ?)`).run(id, via);
    } else {
      db.prepare(`INSERT INTO documents (id, supplier_name, document_type_id, status, confirmed_at)
                  VALUES (?, 'Quillstone', 1, 'confirmed', '2026-08-0${(id % 9) + 1}')`).run(id);
    }
    return id;
  };
  const addEx = (docId, value) =>
    db.prepare(`INSERT INTO extractions (document_id, field_key, display_value)
                VALUES (?, 'customer_name', ?)`).run(docId, value);
  for (let i = 0; i < 3; i++) addEx(addDoc(null), 'Bramblewood Joinery Ltd');
  const machineIds = [];
  for (const via of MACHINE_VIAS) { const d = addDoc(via); machineIds.push(d); addEx(d, 'Branblewood Joinery Ltd'); }
  return machineIds;
}

const groupOf = (rows) =>
  rows.find(g => g.supplier_name === 'Quillstone' && g.field_key === 'customer_name');

console.log('1. OFF = byte-identical (machine rows counted exactly as before)');
{
  const db = mkDb(); seed(db);
  const g = groupOf(learning.getFieldFormats(db));
  check('off: machine garble counted in value_counts (legacy behaviour)',
        g && g.confirmed_count === 8 && g.value_counts['Branblewood Joinery Ltd'] === 5);
  check('off: NO machine_value_counts key emitted (byte-identical output shape)',
        g && !('machine_value_counts' in g));
  db.close();
}

console.log('2. ARMED (env) = machine rows leave the counted substrate');
{
  const db = mkDb(); seed(db);
  process.env.LEARNING_EXCLUDE_MACHINE_CONFIRMS = '1';
  const g = groupOf(learning.getFieldFormats(db));
  delete process.env.LEARNING_EXCLUDE_MACHINE_CONFIRMS;
  check('armed: confirmed_count = the 3 human rows only', g && g.confirmed_count === 3);
  check('armed: the garble is GONE from value_counts and sample_values',
        g && !('Branblewood Joinery Ltd' in g.value_counts)
        && !g.sample_values.includes('Branblewood Joinery Ltd'));
  check('armed: machine_value_counts carries the excluded evidence (additive channel — '
        + 'consumed by nothing in slice 1, pinned inert below)',
        g && g.machine_value_counts && g.machine_value_counts['Branblewood Joinery Ltd'] === 5);
  db.close();
}

console.log('3. falsifiable control — flip one machine via to NULL and it re-enters');
{
  const db = mkDb(); const ids = seed(db);
  db.prepare('UPDATE documents SET confirmed_via = NULL WHERE id = ?').run(ids[0]);
  process.env.LEARNING_EXCLUDE_MACHINE_CONFIRMS = '1';
  const g = groupOf(learning.getFieldFormats(db));
  delete process.env.LEARNING_EXCLUDE_MACHINE_CONFIRMS;
  check('via NULL row re-enters the counted substrate (the exclusion keys on the stamp — '
        + 'gate-unify OFF would blind it, Oracle C5)',
        g && g.confirmed_count === 4 && g.value_counts['Branblewood Joinery Ltd'] === 1);
  db.close();
}

console.log('4. C2 carve-out — a HUMAN correction on a machine doc stays counted');
{
  const db = mkDb(); const ids = seed(db);
  db.prepare(`INSERT INTO corrections (document_id, field_key, corrected_value)
              VALUES (?, 'customer_name', 'Bramblewood Joinery Ltd')`).run(ids[0]);
  process.env.LEARNING_EXCLUDE_MACHINE_CONFIRMS = '1';
  const g = groupOf(learning.getFieldFormats(db));
  delete process.env.LEARNING_EXCLUDE_MACHINE_CONFIRMS;
  check('corrected machine row counted WITH the corrected value (a correction row is a human '
        + 'act — the remediation mechanism\'s own lever, Oracle C2 RETAIN)',
        g && g.confirmed_count === 4 && g.value_counts['Bramblewood Joinery Ltd'] === 4
        && !('Branblewood Joinery Ltd' in g.value_counts));
  db.close();
}

console.log('5. env wins BOTH directions (the shadow-row-skip C5 pattern)');
{
  const db = mkDb(); seed(db);
  db.prepare("INSERT INTO settings (key, value) VALUES ('learning_exclude_machine_confirms', 'true')").run();
  process.env.LEARNING_EXCLUDE_MACHINE_CONFIRMS = '0';
  const g = groupOf(learning.getFieldFormats(db));
  delete process.env.LEARNING_EXCLUDE_MACHINE_CONFIRMS;
  check('env=0 beats setting=true (harness arms unambiguous)', g && g.confirmed_count === 8);
  const g2 = groupOf(learning.getFieldFormats(db));
  check('setting=true alone arms it', g2 && g2.confirmed_count === 3);
  db.close();
}

console.log('6. pre-migration DB (no confirmed_via column) — legacy output, no throw');
{
  const db = mkDb({ withVia: false }); seed(db, { withVia: false });
  process.env.LEARNING_EXCLUDE_MACHINE_CONFIRMS = '1';
  let g = null, threw = false;
  try { g = groupOf(learning.getFieldFormats(db)); } catch { threw = true; }
  delete process.env.LEARNING_EXCLUDE_MACHINE_CONFIRMS;
  check('no via column: no throw, all 8 rows counted (legacy)',
        !threw && g && g.confirmed_count === 8 && !('machine_value_counts' in g));
  db.close();
}

console.log('7. structural pins — the shared sentinel set (three consumers, one module)');
{
  const src = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const trust = src('trust.js'), templates = src('templates.js'), learn = src('learning.js');
  check('sentinel set is exactly the FIVE machine vias',
        MACHINE_VIAS.length === 5 && MACHINE_VIAS_SET.has('auto_corroborated')
        && MACHINE_VIAS_SET.has('scope_sweep') && MACHINE_VIAS_SET.has('auto_reprocess')
        && MACHINE_VIAS_SET.has('auto_graduated') && MACHINE_VIAS_SET.has('auto_threshold'));
  check('trust.js human window builds its NOT IN from the shared module (no inline list — '
        + 'templates.js had already drifted to 2 of 5 when Oracle caught it)',
        trust.includes("require('./machine_vias')")
        && !trust.includes("'scope_sweep', 'auto_corroborated', 'auto_reprocess'"));
  check('learning.js reads the shared set', learn.includes("require('./machine_vias')"));
  check('templates.js C1 leg reads the shared set (armed full-set exclusion; the legacy '
        + 'two-value filter stays unconditional)',
        templates.includes("require('./machine_vias')")
        && templates.includes("'scope_sweep' || _via === 'auto_reprocess'"));
  // CONSCIOUSLY UPDATED 2026-08-19, exactly as this pin's own note demanded. The channel is no
  // longer inert: `classFixService` unions it into the bucket it hands `bothFormsEstablished`
  // (Oracle S1-C3). That is the REFUSAL side, and the distinction is the whole invariant —
  //   • a REFUSAL test may use the fullest evidence available (human + all machine);
  //   • a LICENSING or rewrite-permission test may use human-attested evidence only.
  // Starving the refusal side was a SAFETY loss: with the read's own form hidden, the class fix
  // asked no question and rewrote up to 25 references on evidence the app was holding.
  // The count is pinned at TWO — the emit plus that one consumer — so a third reference has to be
  // justified here, and in particular so nobody quietly wires this into a licensing index. The
  // 2026-08-19 Oracle ruling SENT BACK exactly that (see test_prefix_amplification_invariant.py:
  // amplifying `prefix_index` silences the outlier guard on the prefix it exists to catch).
  // THIRD CONSUMER (2026-09-04, Oracle O3a/O3d — CONFUSION PRECEDENCE 2a): processing/handler.js
  // buildTrainingArgs builds `confusion_literals` = keys(value_counts) ∪ keys(machine_value_counts) ONCE at
  // the facts merge, so format_anomaly_checker.confusion_correct can REFUSE on the fullest evidence (the
  // edit-1 ball, the from-glyph attestation, the break-check — a machine-confirmed genuine serial such as
  // W2S8745899 must read as SEEN). Same mirrored rule as classFixService: refusal-side only; value_counts
  // (human-attested) stays the LICENSING precondition — asserted at the source below. Never a licensing index.
  check('machine_value_counts is consumed ONLY by the refusal side (emit + classFixService + the 2a literal '
        + 'union in processing/handler.js); a further consumer must be justified, and must never be a licensing index',
        (() => {
          const roots = ['database/modules', 'src', 'python_backend/extraction'];
          const repo = path.join(__dirname, '..', '..');
          let hits = 0;
          const scan = dir => {
            for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
              const p = path.join(dir, f.name);
              if (f.isDirectory()) { if (!/node_modules|__pycache__/.test(f.name)) scan(p); }
              // Count PRODUCTION consumers only. The scan used to exclude just this file by name,
              // which meant any new suite asserting the behaviour tripped the pin it was written
              // to support — a test is not a consumer.
              else if (/\.(js|py)$/.test(f.name) && !/(^|[\\/])test_/.test(f.name)
                       && fs.readFileSync(p, 'utf8').includes('machine_value_counts')) hits++;
            }
          };
          for (const r of roots) scan(path.join(repo, r));
          return hits === 3;   // learning.js's emit + classFixService's refusal-side union + handler.js's 2a literal union
        })());
  check('2a: value_counts (human-attested) remains the LICENSING precondition of confusion_correct — the machine '
        + 'union can only widen REFUSAL (source pin on format_anomaly_checker.py)',
        (() => {
          const src = fs.readFileSync(path.join(__dirname, '..', '..', 'python_backend', 'extraction', 'format_anomaly_checker.py'), 'utf8');
          const i = src.indexOf('def confusion_correct(');
          const body = i >= 0 ? src.slice(i, i + 4000) : '';
          return /if not facts or not vc:\s*\n\s*return None/.test(body)         // licensing precondition first
              && !/machine_value_counts/.test(src)                                  // Python never reads the channel
              && /_confusion_refusal_literals\(fe\)/.test(body);                    // refusals use the union
        })());
}

console.log('8. C1 template leg — armed flag blocks all five vias from learnTemplateOnCommit');
{
  const templates = fs.readFileSync(path.join(__dirname, 'templates.js'), 'utf8');
  check('templates.js gates the full set behind learning_exclude_machine_confirms',
        /MACHINE_VIAS_SET[\s\S]{0,600}learning_exclude_machine_confirms/.test(templates)
        || /learning_exclude_machine_confirms[\s\S]{0,600}MACHINE_VIAS_SET/.test(templates));
}

console.log(`\n${passed} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
