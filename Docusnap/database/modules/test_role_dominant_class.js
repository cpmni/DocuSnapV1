#!/usr/bin/env node
'use strict';
/*
 * test_role_dominant_class.js — PINs for the ROLE-FIELD DOMINANT CLASS (Chris round 13 → Oracle
 * SIGN-OFF-W/COND C1.1–C1.4, 2026-08-22; DARK behind `role_field_dominant_class` /
 * ROLE_FIELD_DOMINANT_CLASS).
 *
 * WHY IT EXISTS. Veltrix: taught + 12 human confirms, a SOLID 12-distinct reference group — and every
 * sibling refused `unverifiable-value:sales_order_number` forever, because ONE confirmed value was
 * 'VX$22033' (a $-for-S misread confirmed as-is). classifyLearnedShape is all-or-nothing → 'freetext'
 * → the ROLE branch of docTrustGate refuses, and scopeTrust refuses graduation, with no way out short
 * of Learning History. The dominant-class rule (≥5 DISTINCT samples, ≥75% agreement) already rescued
 * NON-role fields from exactly this; this applies the SAME verification (never an exemption) to role
 * fields at all three sites — scopeTrust's loop, its corroboration probe, docTrustGate's role branch.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_role_dominant_class.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const documents = require('./documents');
const learning  = require('./learning');
const trust     = require('./trust');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; return cond; };

function fixture({ refRole = 'invoice_number' } = {}) {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, ?, 'invoice_date')").run(refRole);
  for (const [k, l, req] of [['supplier_name', 'Document Issuer', 1], ['invoice_number', 'Invoice Number', 1], ['invoice_date', 'Invoice Date', 1], ['account_code', 'Account Code', 0]])
    db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, built_in) VALUES (1, ?, ?, 'text', ?, 1)").run(k, l, req);
  db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (7, 'Acme Invoice', 'acme-invoice', 'invoice')").run();
  for (const [k, v] of [['auto_file_threshold', '90'], ['graduation_window', '5'], ['learning_exclude_machine_confirms', 'true'], ['autofile_gate_unify', 'true']]) learning.setSetting(db, k, v);
  let n = 0;
  const mk = (supplier, rows, { status = 'confirmed', conf = 95 } = {}) => {
    const id = Number(documents.insert(db, { original_filename: `d${++n}.pdf`, folder_path: '/in', status, supplier_name: supplier, document_type_id: 1, template_id: 7, overall_confidence: conf }).lastInsertRowid);
    if (status === 'confirmed') db.prepare("UPDATE documents SET confirmed_at = datetime('now', ?) WHERE id = ?").run(`+${n} seconds`, id);
    const ins = db.prepare('INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, ?, ?, ?, 95, ?)');
    for (const [k, v] of Object.entries(rows)) ins.run(id, k, v, v, 'template_mapping');
    return id;
  };
  return { db, mk };
}
const held = (db, mk, supplier, rows) => {
  const id = mk(supplier, rows, { status: 'needs_review', conf: 95 });
  return documents.getById(db, id);
};
const elig = (db, doc, on) => trust.isAutoFileEligible(db, doc, { roleDominant: on });
const gradOK = (db, sup, on) => trust.scopeTrust(db, sup, 'invoice', { roleDominant: on });

// ── §1 the Veltrix exhibit: eleven codes + one '$' outlier, a ROLE field ─────────────────────
console.log('§1 the exhibit — 11 codes + one confirmed "$" outlier on the reference ROLE');
{
  const { db, mk } = fixture();
  for (let i = 0; i < 11; i++) mk('Acme', { supplier_name: 'Acme', invoice_number: `VXS${37510 + i * 997}`, invoice_date: `0${(i % 9) + 1}-06-2026` });
  mk('Acme', { supplier_name: 'Acme', invoice_number: 'VX$22033', invoice_date: '11-06-2026' });
  const fmts = learning.getFieldFormats(db).find(f => f.field_key === 'invoice_number' && f.supplier_name === 'Acme');
  check('the learned group is SOLID (12 distinct) yet its strict class is freetext (the all-or-nothing collapse)',
        fmts && (fmts.sample_values || []).length === 12 && trust.classifyLearnedShape(fmts.sample_values) === 'freetext');
  check('_effectiveClass OFF = strict (freetext)', trust._effectiveClass({ cls: 'freetext', sampleValues: fmts.sample_values }, false) === 'freetext');
  check('_effectiveClass ON = the dominant class (code)', trust._effectiveClass({ cls: 'freetext', sampleValues: fmts.sample_values }, true) === 'code');
  const good = held(db, mk, 'Acme', { supplier_name: 'Acme', invoice_number: 'VXS58641', invoice_date: '03-09-2025' });
  check('OFF: a clean VXS sibling is refused unverifiable-value (the bricked scope — the bug)', elig(db, good, false).reason === 'unverifiable-value:invoice_number');
  const on = elig(db, good, true);
  check('ON: the same sibling VERIFIES against the dominant code shape and is eligible', on.eligible === true && on.reason === 'ok');
  check('ON: the scope GRADUATES (positive control) — OFF it does not',
        gradOK(db, 'Acme', true).trusted === true && gradOK(db, 'Acme', false).reason === 'unverifiable-required-field');
  const word = held(db, mk, 'Acme', { supplier_name: 'Acme', invoice_number: 'Information', invoice_date: '03-09-2025' });
  check('ON: a WORD in the reference role is still refused (verification, not exemption)', elig(db, word, true).reason === 'unverifiable-value:invoice_number');
  const dollar = held(db, mk, 'Acme', { supplier_name: 'Acme', invoice_number: 'VX$99999', invoice_date: '03-09-2025' });
  check('ON: the outlier SHAPE itself ("VX$…") is refused — $ is not codeish', elig(db, dollar, true).reason === 'unverifiable-value:invoice_number');
  check('switch read from the setting: ON on a fresh DB (mig 80; mig 79 had seeded OFF)', trust._roleDominantEnabled(db) === true);
  learning.setSetting(db, 'role_field_dominant_class', 'false');
  check('…OFF via the setting (the revert)', trust._roleDominantEnabled(db) === false && trust.isAutoFileEligible(db, good).reason === 'unverifiable-value:invoice_number');
  learning.setSetting(db, 'role_field_dominant_class', 'true');
  check('…ON via the setting', trust._roleDominantEnabled(db) === true && trust.isAutoFileEligible(db, good).eligible === true);
  process.env.ROLE_FIELD_DOMINANT_CLASS = '0';
  check('…env 0 wins over the setting (both directions)', trust._roleDominantEnabled(db) === false);
  process.env.ROLE_FIELD_DOMINANT_CLASS = '1'; learning.setSetting(db, 'role_field_dominant_class', 'false');
  check('…env 1 wins over the setting', trust._roleDominantEnabled(db) === true);
  delete process.env.ROLE_FIELD_DOMINANT_CLASS;
}

// ── §2 the bars: ≥5 DISTINCT samples, ≥75% agreement ─────────────────────────────────────────
console.log('§2 the bars');
{
  const { db, mk } = fixture();
  for (let i = 0; i < 3; i++) mk('Few', { supplier_name: 'Few', invoice_number: `FW-${100 + i}`, invoice_date: `0${i + 1}-06-2026` });
  mk('Few', { supplier_name: 'Few', invoice_number: 'FW$999', invoice_date: '04-06-2026' });
  const d = held(db, mk, 'Few', { supplier_name: 'Few', invoice_number: 'FW-777', invoice_date: '05-06-2026' });
  check('4 distinct samples (3 codes + 1 outlier) → still unverifiable ON (the ≥5 bar)', elig(db, d, true).reason === 'unverifiable-value:invoice_number');
}
{
  const { db, mk } = fixture();
  for (let i = 0; i < 7; i++) mk('Seventy', { supplier_name: 'Seventy', invoice_number: `SV-${100 + i}`, invoice_date: `0${(i % 9) + 1}-06-2026` });
  for (const w of ['Information', 'Invoice copy', 'See attached']) mk('Seventy', { supplier_name: 'Seventy', invoice_number: w, invoice_date: '09-06-2026' });
  const d = held(db, mk, 'Seventy', { supplier_name: 'Seventy', invoice_number: 'SV-777', invoice_date: '05-06-2026' });
  check('70% agreement (7 codes + 3 words) → still unverifiable ON (the ≥75% bar)', elig(db, d, true).reason === 'unverifiable-value:invoice_number');
}

// ── §3 orthogonality: a wobbling ISSUER never graduates through this ────────────────────────
console.log('§3 orthogonality — names are never codeish');
{
  const { db, mk } = fixture();
  const names = ['Acme Ltd', 'Acme Limited', 'ACME Group', 'Acme Ltd', 'Acme Limited', 'Acme Holdings'];
  names.forEach((nm, i) => mk('Acme Ltd', { supplier_name: nm, invoice_number: `AC-${100 + i}`, invoice_date: `0${i + 1}-06-2026` }));
  const t = gradOK(db, 'Acme Ltd', true);
  check('a 4-distinct-name issuer scope does NOT graduate ON (freetext with no dominant structured class)',
        t.trusted === false && t.reason === 'unverifiable-required-field' && t.field === 'supplier_name');
}

// ── §4 dangling role keeps strict refusal (C1.2) ─────────────────────────────────────────────
console.log('§4 dangling role (C1.2)');
{
  const { db, mk } = fixture({ refRole: null });
  for (let i = 0; i < 11; i++) mk('Dang', { supplier_name: 'Dang', invoice_number: `DG-${100 + i}`, invoice_date: `0${(i % 9) + 1}-06-2026` });
  mk('Dang', { supplier_name: 'Dang', invoice_number: 'DG$1', invoice_date: '11-06-2026' });
  const d = held(db, mk, 'Dang', { supplier_name: 'Dang', invoice_number: 'DG-777', invoice_date: '05-06-2026' });
  check('with the ref role UNSET, the contaminated reference is refused ON exactly as OFF',
        elig(db, d, true).reason === 'unverifiable-value:invoice_number' && elig(db, d, false).reason === 'unverifiable-value:invoice_number');
}

// ── §5 a NON-role field is byte-identical ON vs OFF (the existing rule, untouched) ───────────
console.log('§5 non-role branch untouched');
{
  const { db, mk } = fixture();
  for (let i = 0; i < 11; i++) mk('Non', { supplier_name: 'Non', invoice_number: `NR-${100 + i}`, invoice_date: `0${(i % 9) + 1}-06-2026`, account_code: `AC${1000 + i}` });
  mk('Non', { supplier_name: 'Non', invoice_number: 'NR-200', invoice_date: '11-06-2026', account_code: 'Account' });
  const d = held(db, mk, 'Non', { supplier_name: 'Non', invoice_number: 'NR-777', invoice_date: '05-06-2026', account_code: 'Sundry' });
  const a = elig(db, d, true), b = elig(db, d, false);
  check('a non-role field judged identically ON and OFF', a.reason === b.reason);
}

// ── §6 the corroboration probe agrees with the main loop (C1.1, third site) ──────────────────
console.log('§6 corroboration probe agreement');
{
  const { db, mk } = fixture();
  learning.setSetting(db, 'graduation_window', '10');                     // 12 confirms < W → 'volume'
  for (let i = 0; i < 11; i++) mk('Probe', { supplier_name: 'Probe', invoice_number: `PR-${100 + i}`, invoice_date: `0${(i % 9) + 1}-06-2026` });
  mk('Probe', { supplier_name: 'Probe', invoice_number: 'PR$1', invoice_date: '11-06-2026' });
  learning.setSetting(db, 'graduation_window', '20');
  const on = trust.scopeTrust(db, 'Probe', 'invoice', { roleDominant: true, corrobProbe: true });
  const off = trust.scopeTrust(db, 'Probe', 'invoice', { roleDominant: false, corrobProbe: true });
  check('below the window, the probe reports cleanButForVolume TRUE with the switch on …', on.reason === 'volume' && on.cleanButForVolume === true);
  check('… and FALSE with it off (the probe and the main loop share _effectiveClass)', off.reason === 'volume' && off.cleanButForVolume === false);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
