#!/usr/bin/env node
'use strict';
/**
 * src/windows/review/test_stale_note_matcher.js
 * Source-inspection pin (the eval-extraction pattern) on the renderer's LIVE stale
 * type-note suppressor — the display-only strip that hides the refuse-class note once one
 * same-scope confirm exists (Oracle Option-A shape, 2026-08-01). The 2026-08-01 note reword
 * silently broke it for an hour (the matcher knew only the legacy copy); this pin keeps the
 * matcher in lockstep with BOTH copies and asserts it never widens to other note classes
 * (the generalisation trap — a generic "re-check disagrees, hide the note" would be the
 * SENT-BACK Option B one class at a time).
 *
 *   node src/windows/review/test_stale_note_matcher.js
 */
const fs = require('fs');
const path = require('path');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const src = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
const m = src.match(/const _STALE_TYPE_NOTE = (\/.*\/i);/);
if (!m) { console.log('BAD could not extract _STALE_TYPE_NOTE from renderer.js'); process.exit(1); }
const re = eval(m[1]);   // the literal regex, verbatim from the renderer

console.log('\nrefuse-class matcher covers BOTH copies:');
check('legacy copy matches',
      re.test("The heading on this page names a document type that doesn't match this supplier's saved layout — please check the document type is correct before filing."));
check('reworded copy matches (typed)',
      re.test("Couldn't match this document to the supplier's saved Worksheet layout — please check the document type; confirming will teach this layout."));
check('reworded copy matches (untyped fallback)',
      re.test("Couldn't match this document to a saved layout for the supplier — please check the document type; confirming will teach this layout."));

console.log('\nnever widens to other note classes:');
for (const other of [
  "The sender's name couldn't be confirmed on this page. Please confirm the correct company — it's usually printed at the top of the document.",
  'format differs from the usual — please verify',
  'this looks like a date, but this field expects a reference — please check which value belongs here',
  "re-read from the page (was \"V-69523\") — please verify",
  'This delivery_number starts ‘IN’, but this sender’s usually start ‘DN’ — likely a one-character misread. Please check.',
]) check(`untouched: "${other.slice(0, 48)}…"`, !re.test(other));

console.log('');
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('All stale-note matcher pins pass');
