'use strict';
/*
 * test_import_autofile_gate.js — PINs for the GATE-UNIFY slice (three-gate disparity,
 * pendingfeatures 2026-08-12 NIGHT top entry; gary+eric consensus → Oracle SIGN-OFF-W/COND).
 *
 * The disparity: THREE auto-file opinions existed — the import pre-gate's blanket
 * `msg.needs_review` bail (parked 49 eligible docs for an empty optional field @0), FAR's
 * below_threshold_count skip ("117 skipped → Filed 0"), and the authoritative
 * trust.isAutoFileEligible. One flag (`autofile_gate_unify`) unifies the first onto the
 * predicate; a second (`far_lowconf_valued_only`) moves FAR + its four sibling consumers to a
 * valued-only below-threshold tier.
 *
 * Behavioural pins run on an in-memory fixture DB; structural pins read the shipped source
 * (test_foreign_fields.js style). THE HEADLINE PIN: armed + empty optional field @0 on an
 * otherwise-clean doc IS ELIGIBLE — a future dev cannot silently restore the parking.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/modules/processing/test_import_autofile_gate.js
 */
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const trust = require(path.join(REPO, 'database', 'modules', 'trust'));
const documents = require(path.join(REPO, 'database', 'modules', 'documents'));

let pass = 0, failn = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { failn++; console.log(`  FAIL ${name}`); } };

// ── fixture ─────────────────────────────────────────────────────────────────────────────────
function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE document_types (id INTEGER PRIMARY KEY, name TEXT, slug TEXT,
      ref_field_key TEXT, date_field_key TEXT);
    CREATE TABLE fields (id INTEGER PRIMARY KEY, document_type_id INTEGER, key TEXT, label TEXT,
      type TEXT DEFAULT 'text', required INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1,
      confidence_threshold INTEGER);
    CREATE TABLE documents (id INTEGER PRIMARY KEY, document_type_id INTEGER, status TEXT,
      overall_confidence INTEGER, supplier_name TEXT, template_id INTEGER,
      confirmed_at TEXT, confirmed_via TEXT, processed_at TEXT DEFAULT '2026-08-12');
    CREATE TABLE extractions (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT,
      raw_value TEXT, display_value TEXT, confidence INTEGER, extraction_method TEXT,
      validation_note TEXT, corrected_to TEXT);
    CREATE TABLE corrections (id INTEGER PRIMARY KEY, document_id INTEGER, field_key TEXT,
      original_value TEXT, corrected_value TEXT);
    CREATE TABLE template_hidden_fields (template_id INTEGER, field_key TEXT);
  `);
  db.prepare("INSERT INTO document_types (id, name, slug, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 'invoice_number', 'invoice_date')").run();
  const addField = db.prepare('INSERT INTO fields (document_type_id, key, label, required) VALUES (1, ?, ?, ?)');
  addField.run('supplier_name', 'Document Issuer', 0);
  addField.run('invoice_number', 'Invoice Number', 0);
  addField.run('invoice_date', 'Invoice Date', 0);
  addField.run('vat_no', 'VAT Number', 0);          // the optional field of the measured class
  addField.run('job_code', 'Job Code', 1);          // a required custom field
  return db;
}
let _nextDoc = 0;
function addDoc(db, { conf = 100, rows = [], template = null } = {}) {
  const id = ++_nextDoc;
  db.prepare("INSERT INTO documents (id, document_type_id, status, overall_confidence, supplier_name, template_id) VALUES (?, 1, 'needs_review', ?, 'Acme Ltd', ?)").run(id, conf, template);
  const ins = db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, validation_note) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const r of rows) ins.run(id, r.key, r.value ?? null, r.value ?? null, r.conf ?? 90, r.method || 'keyword', r.note || null);
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
}
const FULL = [   // a clean, fully-valued doc
  { key: 'supplier_name', value: 'Acme Ltd', conf: 98 },
  { key: 'invoice_number', value: 'INV-100', conf: 98 },
  { key: 'invoice_date', value: '01-08-2026', conf: 98 },
  { key: 'vat_no', value: 'GB 123 4567 89', conf: 95 },
  { key: 'job_code', value: 'JC-1', conf: 95 },
];
const drop = (rows, key) => rows.filter(r => r.key !== key);
const withEmpty = (rows, key) => drop(rows, key).concat([{ key, value: null, conf: 0, method: 'unknown' }]);

// ── 1. T2 behavioural: the missing-required refusal + THE headline pin ─────────────────────
console.log('1. T2 missing-required refusal (isAutoFileEligible, fixture DB)');
{
  const db = freshDb();
  const clean = addDoc(db, { rows: FULL });
  check('baseline: clean valued doc @100 eligible (both flag states)',
        trust.isAutoFileEligible(db, clean, { gateUnify: false }).eligible === true
        && trust.isAutoFileEligible(db, clean, { gateUnify: true }).eligible === true);

  const emptyOpt = addDoc(db, { rows: withEmpty(FULL, 'vat_no') });
  check('DARK (flag off): empty optional vat_no@0 — predicate blind to empties, eligible (today)',
        trust.isAutoFileEligible(db, emptyOpt, { gateUnify: false }).eligible === true);
  check('★ HEADLINE PIN — ARMED: empty optional vat_no@0 on a clean doc STILL FILES '
        + '(the 49-doc parked class; restoring any blanket empty-field veto goes red HERE)',
        trust.isAutoFileEligible(db, emptyOpt, { gateUnify: true }).eligible === true);

  const emptyRef = addDoc(db, { rows: withEmpty(FULL, 'invoice_number') });
  check('DARK: empty ref role eligible (the pre-gate was the only wall — pinned so the flip is honest)',
        trust.isAutoFileEligible(db, emptyRef, { gateUnify: false }).eligible === true);
  const r1 = trust.isAutoFileEligible(db, emptyRef, { gateUnify: true });
  check('ARMED: empty REF ROLE refused missing-required:invoice_number',
        r1.eligible === false && r1.reason === 'missing-required:invoice_number');

  const emptyDate = addDoc(db, { rows: drop(FULL, 'invoice_date') });   // row entirely ABSENT
  const r2 = trust.isAutoFileEligible(db, emptyDate, { gateUnify: true });
  check('ARMED: ABSENT date-role row (no extraction at all) refused missing-required:invoice_date',
        r2.eligible === false && r2.reason === 'missing-required:invoice_date');

  const emptyReq = addDoc(db, { rows: withEmpty(FULL, 'job_code') });
  const r3 = trust.isAutoFileEligible(db, emptyReq, { gateUnify: true });
  check('ARMED: empty required CUSTOM field refused missing-required:job_code',
        r3.eligible === false && r3.reason === 'missing-required:job_code');

  // Oracle C1 — hidden-field exclusion: a field the owner declared absent never blocks.
  db.prepare('INSERT INTO template_hidden_fields (template_id, field_key) VALUES (7, ?)').run('job_code');
  const hiddenReq = addDoc(db, { rows: withEmpty(FULL, 'job_code'), template: 7 });
  check('ARMED: required field HIDDEN for the doc\'s template (per-sender "Never — stop looking") FILES',
        trust.isAutoFileEligible(db, hiddenReq, { gateUnify: true }).eligible === true);
  const hiddenOther = addDoc(db, { rows: withEmpty(FULL, 'job_code'), template: 8 });
  check('ARMED: same empty field on a DIFFERENT template still refused (hide is template-scoped)',
        trust.isAutoFileEligible(db, hiddenOther, { gateUnify: true }).eligible === false);

  // Identity exclusion: Document-Issuer is warn-only in validateConfirm — mirror it.
  const emptySup = addDoc(db, { rows: withEmpty(FULL, 'supplier_name') });
  check('ARMED: empty identity (supplier_name) NOT a missing-required refusal (validateConfirm mirror)',
        trust.isAutoFileEligible(db, emptySup, { gateUnify: true }).reason !== 'missing-required:supplier_name');

  const noted = addDoc(db, { rows: drop(FULL, 'vat_no').concat([{ key: 'vat_no', value: 'VAT', conf: 60, note: 'unexpected characters (…)' }]) });
  check('ARMED: a NOTED field still refuses via flagged (precedence: flagged before missing-required)',
        trust.isAutoFileEligible(db, noted, { gateUnify: true }).reason === 'flagged');

  // opts.extractions data path (the harness/batch leg) mirrors the DB path.
  const exRows = withEmpty(FULL, 'invoice_number').map(r => ({ field_key: r.key, display_value: r.value, raw_value: r.value, confidence: r.conf }));
  const viaOpts = trust.isAutoFileEligible(db, clean, { gateUnify: true, extractions: exRows });
  check('ARMED: opts.extractions path refuses the same empty ref role (both data paths, Oracle C1)',
        viaOpts.eligible === false && viaOpts.reason === 'missing-required:invoice_number');

  // Setting-driven read (no opts override): flag from the settings table.
  db.prepare("INSERT INTO settings (key, value) VALUES ('autofile_gate_unify', 'true')").run();
  check('setting autofile_gate_unify=true arms the refusal without opts (product read)',
        trust.isAutoFileEligible(db, emptyRef).reason === 'missing-required:invoice_number');
}

// ── 2. Oracle C4 pin pair — the valued-below-threshold trade-off ───────────────────────────
console.log('2. valued-below-threshold trade-off (pin PAIR, Oracle C4)');
{
  const db = freshDb();
  // Learned format history: 5 confirmed in-scope docs with VARIED same-shape SPACELESS codes
  // give vat_no a DOMINANT STRUCTURED class. Classifier semantics pinned INCIDENTALLY here (not
  // this slice's concern, but load-bearing for the pair): a single distinct sample collapses to
  // a literal; spaced multi-token values classify 'freetext' (dominant class null → the non-role
  // lenient arm exempts the field, trust.js:798-810); <5 samples never reach the ≥5 @ ≥75%
  // dominance bar. Spaceless varied codes are the shape the guard actually enforces on.
  const vats = ['GB123456789', 'GB234567890', 'GB345678901', 'GB456789012', 'GB567890123'];
  for (let i = 0; i < 5; i++) {
    const d = addDoc(db, { rows: drop(FULL, 'vat_no').concat([{ key: 'vat_no', value: vats[i], conf: 95 }]) });
    db.prepare("UPDATE documents SET status='confirmed', confirmed_at='2026-08-0" + (i + 1) + "' WHERE id=?").run(d.id);
  }
  const learning = require(path.join(REPO, 'database', 'modules', 'learning'));
  const formats = learning.getFieldFormats(db);
  const conforming = addDoc(db, { rows: drop(FULL, 'vat_no').concat([{ key: 'vat_no', value: 'GB987654321', conf: 40 }]) });
  const g1 = trust.docTrustGate(db, conforming.id, 'Acme Ltd', 'invoice', { formats, templateMatched: true });
  check('valued low-conf field that MATCHES its learned shape passes the gate (accepted trade-off — pinned)',
        g1.ok === true);
  const breaking = addDoc(db, { rows: drop(FULL, 'vat_no').concat([{ key: 'vat_no', value: 'es we', conf: 40 }]) });
  const g2 = trust.docTrustGate(db, breaking.id, 'Acme Ltd', 'invoice', { formats, templateMatched: true });
  check('valued low-conf field that BREAKS its learned shape refused unverifiable-value (the fail-closed guard)',
        g2.ok === false && String(g2.reason).startsWith('unverifiable-value'));
}

// ── 3. T3 behavioural: machine bases never fill the human window; span keeps them ──────────
console.log('3. T3 window exclusion both-sides (auto_graduated / auto_threshold)');
{
  const db = freshDb();
  const mk = (via, i) => {
    const d = addDoc(db, { rows: FULL });
    db.prepare("UPDATE documents SET status='confirmed', confirmed_at=?, confirmed_via=? WHERE id=?")
      .run(`2026-08-${String(i + 1).padStart(2, '0')}T00:00:00`, via, d.id);
    return d;
  };
  for (let i = 0; i < 4; i++) mk(null, i);                    // 4 human confirms
  for (let i = 4; i < 14; i++) mk(i % 2 ? 'auto_graduated' : 'auto_threshold', i);  // 10 machine files
  const t = trust.scopeTrust(db, 'Acme Ltd', 'invoice');
  check('window counts ONLY the 4 human confirms (10 machine rows excluded — trust never self-manufactures)',
        t.trusted === false && t.confirmedCount === 4);
  // Span side: a correction on a machine-filed doc must still be able to revoke — the span is
  // via-agnostic by design (structural pin below asserts _confirmedSql(false) survives).
}

// ── 4. FAR two-tier: the count split + getReviewSplit parity ────────────────────────────────
console.log('4. FAR valued-only tier (documents.js)');
{
  const db = freshDb();
  addDoc(db, { rows: withEmpty(FULL, 'vat_no') });                                        // empty-low only
  addDoc(db, { rows: drop(FULL, 'vat_no').concat([{ key: 'vat_no', value: '1RE', conf: 30 }]) }); // valued-low
  const q = documents.getReviewQueue(db);
  const emptyLow  = q.find(d => (d.below_threshold_count || 0) > 0 && (d.below_threshold_valued_count || 0) === 0);
  const valuedLow = q.find(d => (d.below_threshold_valued_count || 0) > 0);
  check('below_threshold_valued_count: empty@0 row NOT counted, valued low row counted',
        !!emptyLow && !!valuedLow && valuedLow.below_threshold_count > 0);
  const offSplit = documents.getReviewSplit(db);
  check('getReviewSplit DARK: both docs need a look (byte-identical to today)', offSplit.need === 2);
  db.prepare("INSERT INTO settings (key, value) VALUES ('far_lowconf_valued_only', 'true')").run();
  const onSplit = documents.getReviewSplit(db);
  check('getReviewSplit ARMED: only the valued-low doc needs a look (empty-optional reads clean)',
        onSplit.need === 1 && onSplit.ready === 1);
  db.prepare("UPDATE settings SET value='false' WHERE key='far_lowconf_valued_only'").run();
  process.env.FAR_LOWCONF_VALUED_ONLY = '1';
  check('env FAR_LOWCONF_VALUED_ONLY=1 wins over the setting (harness arm, both directions)',
        documents.getReviewSplit(db).need === 1);
  delete process.env.FAR_LOWCONF_VALUED_ONLY;
}

// ── 5. Structural pins (shipped source) ─────────────────────────────────────────────────────
console.log('5. structural pins');
{
  const handler  = read('src/modules/processing/handler.js');
  const trustSrc = read('database/modules/trust.js');
  const renderer = read('src/windows/review/renderer.js');
  const docsSrc  = read('database/modules/documents.js');

  // Ordering seam (gary): extraction rows (with notes) must be persisted BEFORE the deferred
  // block that runs _maybeAutoFile — the whole "DB flagged-check supersets msg.needs_review"
  // argument rests on it. insertExtractions must appear before the setImmediate in the same
  // file_done persist path.
  const iIns  = handler.indexOf('learning.insertExtractions');
  const iDefer = handler.indexOf('setImmediate', iIns);
  const iGate = handler.indexOf('function _maybeAutoFile');
  check('ordering: insertExtractions precedes the deferred block that reaches _maybeAutoFile',
        iIns > 0 && iDefer > iIns && iGate > 0);

  check('T1: the needs_review bail survives DARK — guarded by !trust._gateUnifyEnabled, not deleted',
        /if \(!trust\._gateUnifyEnabled\(db\)\)[\s\S]{0,400}preFloor < 100 && msg\.needs_review/.test(handler));
  check('T1: ONE shared flag read — handler uses trust._gateUnifyEnabled (no second parser)',
        !/getSetting\(db, 'autofile_gate_unify'/.test(handler));
  check('C6: auto-file dispatches serialize through the module chain with a per-doc catch',
        /_autoFileChain = _autoFileChain\.then\(\(\) =>\s*\n\s*_autoFileDoc[\s\S]{0,200}\.catch/.test(handler));
  check('T3: graduated basis stamps auto_graduated under the flag',
        /_elig\.basis === 'graduated' \? 'auto_graduated' : 'auto_threshold'/.test(handler));
  check('T3: honest username for graduated files',
        /'Auto-filed \(graduated\)'/.test(handler));
  check('T2 lives AFTER the flagged check (refusal-reason stability)',
        trustSrc.indexOf("reason: 'flagged'") < trustSrc.indexOf('missing-required:${mk}'));
  check('T2 mirrors the hidden-field exclusion (template_hidden_fields consulted)',
        /_missingRequiredKey[\s\S]{0,900}template_hidden_fields/.test(trustSrc));
  check('T2 mirrors the identity exclusion (supplier_name/customer_name never missing-required)',
        /_missingRequiredKey[\s\S]{0,900}NOT IN \(\\'supplier_name\\', \\'customer_name\\'\)/.test(trustSrc));

  check('FAR: review_flag_count ALWAYS flags (the two-tier rule only narrows the below leg)',
        /review_flag_count \|\| 0\) > 0 \|\| \(below \|\| 0\) > 0/.test(renderer));
  check('FAR: isFlagged keys the below tier on __farValuedOnly (all five consumers move together)',
        /window\.__farValuedOnly \? doc\?\.below_threshold_valued_count : doc\?\.below_threshold_count/.test(renderer));
  check('getReviewSplit twin reads the SAME setting (never-disagree contract)',
        /_farValuedOnlyEnabled/.test(docsSrc) && /far_lowconf_valued_only/.test(docsSrc));
  check('span stays via-agnostic (_confirmedSql(false) still present — machine files remain revocable)',
        /_confirmedSql\(false\)/.test(read('database/modules/trust.js')));
}

console.log(`\n${pass} ok, ${failn} failed`);
process.exit(failn ? 1 : 0);
