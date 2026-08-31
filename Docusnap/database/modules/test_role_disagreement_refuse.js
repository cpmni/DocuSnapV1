'use strict';
/*
 * test_role_disagreement_refuse.js — Chris round 19, Oracle gate item (d) (2026-08-23).
 *
 * THE INCIDENT: four Copperfield invoices self-filed with wrong dates at 94 % "Nothing looks wrong"
 * while each row's corroboration record said `disagree: [{family:'keyword', value:<the right date>}]`.
 * Every road shares the ONE predicate, so the refusal lives in docTrustGate: a role field (the type's
 * ref/date) contradicted by an independent PAGE family never files by itself. DARK:
 * trust_role_disagreement_refuse / TRUST_ROLE_DISAGREEMENT_REFUSE.
 *
 * Pins (each must fail on the pre-fix predicate): the 447 shape refuses 'disagreeing-read:invoice_date';
 * a memory/hint disagreement does not count; an AGREEING record passes (positive control); a non-role
 * field's disagreement does not refuse; absent record → fail-open; switch OFF → byte-identical; the
 * batch door (autoFileEligibleIds) hoists the switch; Review has copy for the reason.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_role_disagreement_refuse.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const documents = require('./documents');
const trust = require('./trust');
const learning = require('./learning');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in, ref_field_key, date_field_key) VALUES (1, 'Invoice', 'invoice', 1, 'invoice_number', 'invoice_date')").run();
for (const [k, req, type] of [['supplier_name', 1, 'text'], ['invoice_number', 1, 'text'], ['invoice_date', 1, 'text'], ['total_amount', 0, 'text']])
  db.prepare("INSERT INTO fields (document_type_id, key, label, type, required, enabled, built_in) VALUES (1, ?, ?, ?, ?, 1, 1)").run(k, k, type, req);
learning.setSetting(db, 'auto_file_threshold', '90');
db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (7, 'Copperfield Invoice', 'copperfield-invoice', 'invoice')").run();
db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value) VALUES (7, 'supplier_name', 'Copperfield Electrical')").run();
// a solid supplier-scoped history so the format gate passes and only the disagreement decides
for (let i = 0; i < 4; i++) {
  const id = Number(documents.insert(db, { original_filename: `c${i}.pdf`, folder_path: '/in', status: 'confirmed', supplier_name: 'Copperfield Electrical', document_type_id: 1 }).lastInsertRowid);
  for (const [k, v] of [['supplier_name', 'Copperfield Electrical'], ['invoice_number', `INV-1000${i}`], ['invoice_date', `0${i + 1}-01-2026`], ['total_amount', '12.00']])
    db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method) VALUES (?, ?, ?, ?, 95, 'keyword')").run(id, k, v, v);
}
const mk = (corrob, { key = 'invoice_date', value = '02-10-2026' } = {}) => {
  const id = Number(documents.insert(db, { original_filename: `d${Math.random().toString(36).slice(2, 6)}.pdf`, folder_path: '/in', status: 'needs_review', supplier_name: 'Copperfield Electrical', document_type_id: 1 }).lastInsertRowid);
  db.prepare('UPDATE documents SET overall_confidence = 94, template_id = 7 WHERE id = ?').run(id);
  const rows = { supplier_name: 'Copperfield Electrical', invoice_number: 'INV-26339', invoice_date: '12-10-2026', total_amount: '10.00' };
  rows[key] = value;
  for (const [k, v] of Object.entries(rows))
    db.prepare("INSERT INTO extractions (document_id, field_key, raw_value, display_value, confidence, extraction_method, corroboration) VALUES (?, ?, ?, ?, 94, 'template_mapping', ?)").run(id, k, v, v, k === key ? corrob : null);
  return id;
};
const row = (id) => db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
const DIS  = '{"winner_family":"mapping","agree":[],"disagree":[{"family":"keyword","value":"12/10/2026"}],"independent_agree":false}';
const MEM  = '{"winner_family":"mapping","agree":[],"disagree":[{"family":"memory","value":"12/10/2026"}],"independent_agree":false}';
const AGR  = '{"winner_family":"mapping","agree":["keyword"],"disagree":[],"independent_agree":true}';

console.log('OFF (default):');
const off = mk(DIS);
const vOff = trust.isAutoFileEligible(db, row(off));
check('a role-field page disagreement does NOT refuse while the switch is off (byte-identical) — the r19 hole', vOff.reason !== 'disagreeing-read:invoice_date');
check('default reader → OFF', trust._roleDisagreementRefuseEnabled(db) === false);

console.log('\nON:');
process.env.TRUST_ROLE_DISAGREEMENT_REFUSE = '1';
const v1 = trust.isAutoFileEligible(db, row(off));
check("the 447/r19 shape — the taught box's date contradicted by the keyword read — refuses 'disagreeing-read:invoice_date'", v1.eligible === false && v1.reason === 'disagreeing-read:invoice_date');
check('autoFileEligibleIds (every batch door) drops it too', !trust.autoFileEligibleIds(db, [row(off)]).includes(off));
const mem = mk(MEM);
check('a MEMORY-family disagreement does not count (near-circular)', trust.isAutoFileEligible(db, row(mem)).reason !== 'disagreeing-read:invoice_date');
const agr = mk(AGR);
check('positive control: an agreeing record passes this gate', trust.isAutoFileEligible(db, row(agr)).reason !== 'disagreeing-read:invoice_date');
const nonRole = mk(DIS, { key: 'total_amount', value: '10.00' });
check("a NON-role field's disagreement does not refuse here (only the filing-critical ref/date roles)", trust.isAutoFileEligible(db, row(nonRole)).reason !== 'disagreeing-read:total_amount');
const none = mk(null);
check('absent record → fail-open (no refusal on this gate)', !/disagreeing-read/.test(trust.isAutoFileEligible(db, row(none)).reason || ''));
check('_pageFamilyDisagrees parses a string record and names the page family + value', JSON.stringify(trust._pageFamilyDisagrees(DIS)) === '{"family":"keyword","value":"12/10/2026"}' && trust._pageFamilyDisagrees(MEM) === null && trust._pageFamilyDisagrees('not json') === null);
process.env.TRUST_ROLE_DISAGREEMENT_REFUSE = '0';
check('env 0 → off', trust._roleDisagreementRefuseEnabled(db) === false);
delete process.env.TRUST_ROLE_DISAGREEMENT_REFUSE;

console.log('\nReview copy + the engine date fold (source contract):');
const rend = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'windows', 'review', 'renderer.js'), 'utf8');
check("Review explains 'disagreeing-read' (the box and the page's own text don't agree)", /'disagreeing-read': fieldName/.test(rend) && /the taught box and the page's own text don't agree/.test(rend));
const eng = fs.readFileSync(path.join(__dirname, '..', '..', 'python_backend', 'extraction', 'engine.py'), 'utf8');
check('the engine compares corroboration candidates date-aware (_corrob_values_agree) — the separator artefact that made every date a "disagreement"', /def _corrob_values_agree\(a, b\) -> bool:/.test(eng) && /if _corrob_values_agree\(cv, val\):/.test(eng) && /FIELD_CORROBORATION_DATE_FOLD/.test(eng));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
