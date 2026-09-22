'use strict';
/*
 * census_confirm_persist_flip.js — Oracle-vetted four-arm census (2026-08-21) gating the default-ON
 * flip of confirm_persist_values + format_corrections_dedupe (Phase 2 of the faster-confirms plan).
 *
 * READ-ONLY on the source DB: every arm works on a temp COPY. Judge the flip on the BOTH arm;
 * mint-only / defan-only are decomposition. Real gate = trust.isAutoFileEligible + trust.scopeTrust
 * (NOT a format-solid proxy — that ignores the volume/critical-field/below-floor walls). M-check =
 * wrong supplier OR wrong type among the newly-eligible set (a hard NO-GO). Oracle conditions:
 *   - mint faithfully (persistConfirmedValues, skip-if-row-exists) over NON-MACHINE confirms only,
 *     ref/date under per-type role keys — the asymptotic steady state, not the day-1 (go-forward) delta;
 *   - G3: how many issuer mints are BLOCKED by an existing (annotated-empty) row — persist under-delivery;
 *   - dedupe de-graduations must each be a fan-out artifact (<3 distinct contributing docs);
 *   - scopeTrust invariant: confirmedCount + corrections identical across arms; reason may move only
 *     between 'ok' and 'unverifiable-required-field'.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 electron census_confirm_persist_flip.js <db>
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const trust = require(path.join(REPO, 'database', 'modules', 'trust.js'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const { MACHINE_VIAS_SQL } = require(path.join(REPO, 'database', 'modules', 'machine_vias.js'));

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) { console.error('usage: census <db>'); process.exit(2); }

// Ground-truth for the M-check (the demo-corpus senders + types). gtOf returns {sup,type} or nulls;
// when a filename doesn't match, the M-check is vacuous for that doc (reported).
const GT = { 'castellan-security': 'castellan', 'harrowgate-timber': 'harrowgate', 'ironclad-tool-hire': 'ironclad',
  'meadowvale-dairy': 'meadowvale', 'nordwind-refrigeration': 'nordwind', 'oakhaven-electrical': 'oakhaven',
  'pelican-office': 'pelican', 'quillstone-print': 'quillstone', 'silverbeck-cleaning': 'silverbeck', 'veltrix-automotive': 'veltrix' };
const TYPES = ['service_worksheet', 'sales_order', 'purchase_order', 'credit_note', 'delivery_note', 'invoice', 'quote', 'statement'];
const gtOf = (fn) => { const b = String(fn || '').toLowerCase().replace(/\.pdf$/, '');
  const k = Object.keys(GT).find(x => b.startsWith(x));
  return { sup: k ? GT[k] : null, type: TYPES.find(t => b.includes('_' + t)) || null }; };

// Faithful mint: exactly what persistConfirmedValues will do from now on, backfilled onto the
// already-confirmed HUMAN docs (the asymptotic steady state). Returns the G3 accounting.
function mintSim(db) {
  const docs = db.prepare(`
    SELECT d.id, d.supplier_name AS sup, d.reference_number AS refv, d.doc_date AS datev,
           dt.ref_field_key AS rk, dt.date_field_key AS dk
      FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
     WHERE d.status = 'confirmed' AND COALESCE(d.confirmed_via, '') NOT IN (${MACHINE_VIAS_SQL})`).all();
  const supRow = db.prepare("SELECT display_value AS dv FROM extractions WHERE document_id = ? AND field_key = 'supplier_name' LIMIT 1");
  let minted = 0, issuerBlockedEmpty = 0, issuerBlockedPopulated = 0, issuerMintable = 0;
  for (const d of docs) {
    if (d.sup && String(d.sup).trim()) {                 // G3: the issuer class the flip targets
      const ex = supRow.get(d.id);
      if (!ex) issuerMintable++;
      else if (!String(ex.dv || '').trim()) issuerBlockedEmpty++;    // annotated-empty → persist CANNOT help (has.get skip)
      else issuerBlockedPopulated++;                                 // already read → fine
    }
    const av = {};
    if (d.sup) av['supplier_name'] = d.sup;
    if (d.rk && d.refv) av[d.rk] = d.refv;               // per-type role keys (Oracle C4)
    if (d.dk && d.datev) av[d.dk] = d.datev;
    minted += learning.persistConfirmedValues(db, d.id, av);
  }
  return { minted, issuerMintable, issuerBlockedEmpty, issuerBlockedPopulated, humanDocs: docs.length };
}

function arm(label, { mint, defan }) {
  const p = path.join(os.tmpdir(), `cpf_${label}_${Date.now()}.db`);
  fs.copyFileSync(SRC, p);
  const db = new Database(p);
  const g3 = mint ? mintSim(db) : null;
  process.env.FORMAT_CORRECTIONS_DEDUPE = defan ? '1' : '0';

  const held = db.prepare("SELECT * FROM documents WHERE status = 'needs_review'").all();
  const eligDocs = held.filter(d => { try { return trust.isAutoFileEligible(db, d).eligible; } catch { return false; } });

  const scopes = db.prepare(`SELECT DISTINCT d.supplier_name AS sup, dt.slug AS slug
      FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
     WHERE TRIM(COALESCE(d.supplier_name, '')) <> ''`).all();
  const st = new Map();
  for (const s of scopes) { let t; try { t = trust.scopeTrust(db, s.sup, s.slug); } catch { t = { trusted: false, reason: 'err' }; } st.set(`${s.sup}|${s.slug}`, t); }
  const grad = new Set([...st].filter(([, t]) => t.trusted).map(([k]) => k));

  const typeSlug = db.prepare('SELECT slug FROM document_types WHERE id = ?');
  const wrong = eligDocs.filter(d => {
    const g = gtOf(d.original_filename);
    const f = String(d.supplier_name || '').toLowerCase().replace(/[^a-z]/g, '');
    const wrongSup = g.sup && !f.includes(g.sup);
    const slug = (typeSlug.get(d.document_type_id) || {}).slug;
    const wrongType = g.type && slug && slug !== g.type;
    return wrongSup || wrongType;
  }).map(d => d.original_filename);
  const gtCoverage = eligDocs.filter(d => gtOf(d.original_filename).sup).length;

  db.close(); fs.unlinkSync(p);
  return { label, held: held.length, eligible: eligDocs.length, grad, st, wrong, g3, gtCoverage, eligN: eligDocs.length };
}

const base = arm('base',  { mint: false, defan: false });
const mint = arm('mint',  { mint: true,  defan: false });
const defan = arm('defan', { mint: false, defan: true });
const both = arm('both',  { mint: true,  defan: true });
delete process.env.FORMAT_CORRECTIONS_DEDUPE;

const diff = (a, b) => [...b].filter(x => !a.has(x));
console.log(`\n=== FOUR-ARM CENSUS (${path.basename(SRC)}) — judge on BOTH ===`);
for (const [name, r] of [['base', base], ['mint-only', mint], ['defan-only', defan], ['BOTH', both]]) {
  console.log(`\n${name.padEnd(11)} held=${r.held} eligible=${r.eligible} graduatedScopes=${r.grad.size} wrongAmongEligible=${r.wrong.length} (gt-covered eligible=${r.gtCoverage})`);
  if (name !== 'base') {
    console.log(`            newly graduated: ${diff(base.grad, r.grad).join(', ') || '(none)'}`);
    console.log(`            DE-graduated   : ${diff(r.grad, base.grad).join(', ') || '(none)'}`);
    console.log(`            newly eligible : ${r.eligible - base.eligible >= 0 ? '+' : ''}${r.eligible - base.eligible} docs`);
  }
  if (r.wrong.length) console.log('            M>0 (wrong sup/type):', r.wrong.join(', '));
  if (r.g3) console.log(`            G3 mint: minted ${r.g3.minted} rows over ${r.g3.humanDocs} human docs · issuer mintable ${r.g3.issuerMintable}, `
    + `BLOCKED-empty ${r.g3.issuerBlockedEmpty} (persist under-delivers here), blocked-populated ${r.g3.issuerBlockedPopulated}`);
}

// scopeTrust invariant (Oracle step-7 replacement): confirmedCount + corrections identical across
// arms; reason may move only between 'ok' and 'unverifiable-required-field'.
console.log(`\n=== scopeTrust INVARIANT (confirmedCount/corrections fixed; reason moves only ok<->unverifiable-required-field) ===`);
let invBreaks = 0;
const OKMOVE = new Set(['ok', 'unverifiable-required-field']);
for (const [k, b] of base.st) {
  for (const [name, r] of [['mint', mint], ['defan', defan], ['both', both]]) {
    const o = r.st.get(k); if (!o) continue;
    const cntSame = (b.confirmedCount || 0) === (o.confirmedCount || 0);
    const corrSame = (b.corrections || 0) === (o.corrections || 0);
    const reasonOk = b.reason === o.reason || (OKMOVE.has(b.reason) && OKMOVE.has(o.reason));
    if (!cntSame || !corrSame || !reasonOk) {
      invBreaks++;
      console.log(`  BREAK ${k} [${name}] base{cnt:${b.confirmedCount},corr:${b.corrections},reason:${b.reason}} vs {cnt:${o.confirmedCount},corr:${o.corrections},reason:${o.reason}}`);
    }
  }
}
console.log(`  invariant breaks: ${invBreaks}${invBreaks ? '  <-- SIMULATION BUG or unexpected leg moved' : '  (clean)'}`);

// Dedupe de-graduation audit: each scope graduated in base but not under defan must be a fan-out
// artifact — its de-solidified required field had <3 DISTINCT contributing documents. A >=3 result
// is structurally impossible post-dedupe → a simulation bug, not a regression.
console.log(`\n=== DEDUPE DE-GRADUATION AUDIT (each must be <3 distinct contributing docs = fan-out fix) ===`);
const lost = diff(defan.grad, base.grad);
if (!lost.length) console.log('  (no scope de-graduated under dedupe)');
else {
  const tmp = path.join(os.tmpdir(), `cpf_audit_${Date.now()}.db`);
  fs.copyFileSync(SRC, tmp);
  const adb = new Database(tmp);
  process.env.FORMAT_CORRECTIONS_DEDUPE = '1';
  const fmts = learning.getFieldFormats(adb, { includeProvisional: true }) || [];
  for (const key of lost) {
    const [sup, slug] = key.split('|');
    const b = base.st.get(key), o = defan.st.get(key);
    const field = o && o.field;   // scopeTrust reports the failing required field
    const g = fmts.find(x => String(x.supplier_name || '').toLowerCase().trim() === sup.toLowerCase().trim()
      && String(x.document_type || '').toLowerCase().trim() === slug.toLowerCase().trim() && x.field_key === field);
    const cnt = g ? (Number(g.confirmed_count) || 0) : 0;
    console.log(`  ${key}  field=${field}  post-dedupe confirmed_count=${cnt}  ${cnt < 3 ? '(fan-out fix — OK)' : '<-- >=3 STRUCTURALLY IMPOSSIBLE: simulation bug'}`);
  }
  delete process.env.FORMAT_CORRECTIONS_DEDUPE;
  adb.close(); fs.unlinkSync(tmp);
}

// GO / NO-GO summary (the human still rules; this states the mechanical result).
console.log(`\n=== GO/NO-GO (mechanical) ===`);
const mZero = !mint.wrong.length && !defan.wrong.length && !both.wrong.length;
const reward = (both.eligible - base.eligible) > 0 || diff(base.grad, both.grad).length > 0;
console.log(`  M=0 on mint/defan/both : ${mZero ? 'YES' : 'NO  <-- NO-GO'}`);
console.log(`  BOTH shows reward>0    : ${reward ? 'YES' : 'no  <-- weak flip; if G3 shows empty-issuer block swallows the class -> route to Refinement B'}`);
console.log(`  scopeTrust invariant   : ${invBreaks ? 'BROKEN' : 'clean'}`);
console.log(`  (realdoc M=0 + zero accuracy drop is a SEPARATE run — G2 — not measured here)`);
