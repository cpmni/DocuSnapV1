#!/usr/bin/env node
'use strict';
/**
 * database/modules/test_plant_text_gate.js — the CONFIRM-TIME PLANT GATE predicate
 * (identity text-first, Oracle C4).
 *
 * The text-agreement gate stops the ENGINE asserting a contradicted identity; this closes the
 * other half of the loop — a human rubber-stamping a plausible wrong prefill, whose confirm would
 * otherwise plant that page's logo under the WRONG company and make the next batch worse (measured
 * cross-supplier min hamming = 2). The gate may only ever skip a LEARNING write, never a filed
 * value, so every unjudgeable case FAILS OPEN.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_plant_text_gate.js
 */
const { nameCorroboratedByText } = require('./branding_fingerprint');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

const LARKSPUR_PAGE = 'Larkspur Interiors\nThe Design Rooms, 3 Chapel Lane\nHarrogate HG1 2PZ\n'
  + 'DELIVERY DOCKET  Delivery Note No. DN-62624\nDeliver To\nBrightwater Dental Practice';
const RIDGEWAY_FP = [['ridgeway', 'plant', 'hire', 'quarry', 'aggregates']];

console.log('§1 the incident — a mis-confirmed supplier must NOT be taught this page');
check('Ridgeway (with its own template fingerprint) on a LARKSPUR page -> NOT corroborated => plant skipped',
  (() => { const v = nameCorroboratedByText('Ridgeway Plant Hire', RIDGEWAY_FP, LARKSPUR_PAGE);
           return v.judgeable === true && v.corroborated === false; })());
check('Ridgeway on its OWN page -> corroborated => plant proceeds',
  nameCorroboratedByText('Ridgeway Plant Hire', RIDGEWAY_FP,
    'Ridgeway Plant Hire\nQuarry Road\nDELIVERY NOTE DN-70099').corroborated === true);

console.log('\n§2 FIRST CONTACT must still enrol (the Oracle rejected a note-based gate for this)');
check('a brand-new supplier with NO template falls back to its NAME tokens and corroborates',
  (() => { const v = nameCorroboratedByText('Larkspur Interiors', [], LARKSPUR_PAGE);
           return v.judgeable === true && v.corroborated === true; })());
check('...and a new supplier whose name is NOT on the page is still refused',
  nameCorroboratedByText('Copperfield Electrical', [], LARKSPUR_PAGE).corroborated === false);

console.log('\n§3 FAIL OPEN — the gate may only skip a learning write, never block one blindly');
check('no ocr_text -> unjudgeable + corroborated (plant proceeds)',
  (() => { const v = nameCorroboratedByText('Ridgeway Plant Hire', RIDGEWAY_FP, '');
           return v.judgeable === false && v.corroborated === true; })());
check('nothing distinctive to test (name is all stopwords) -> fail open',
  nameCorroboratedByText('Invoice Note', [], LARKSPUR_PAGE).judgeable === false);
check('null supplier + null text -> fail open', nameCorroboratedByText(null, null, null).corroborated === true);

console.log('\n§4 token matching is word-bounded (no substring false positives)');
check("'hire' does NOT match inside 'hired' only — boundary respected",
  nameCorroboratedByText('Hire', [], 'the equipment was hired out').corroborated === false);
check('a real word boundary DOES match',
  nameCorroboratedByText('Hire', [], 'plant hire, Ltd').corroborated === true);
check('regex-special characters in a name never throw',
  (() => { try { nameCorroboratedByText('A+B (Ltd) [x]', [], 'a+b ltd'); return true; } catch { return false; } })());

console.log('\n§5 PINNED: template fingerprints outrank the name fallback');
check('a supplier WITH fingerprints is judged on them (name-only coincidence does not rescue it)',
  nameCorroboratedByText('Ridgeway Plant Hire', [['quarry', 'aggregates', 'ridgeway']],
    'Some page mentioning nothing relevant').corroborated === false);

console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll plant-gate checks passed.');
process.exit(fail ? 1 : 0);
