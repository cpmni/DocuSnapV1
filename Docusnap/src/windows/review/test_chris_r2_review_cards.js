'use strict';
/*
 * test_chris_r2_review_cards.js — contract pins for the Chris round-2 (2026-09-09) review-window fixes
 * (docs/CHRIS_FULL_APP_REVIEW_2026-09-09.md): finding 1 (the phantom "Format check · N" that pointed at
 * no visible field — a double-count of the low-confidence field + bare corrected_to) and finding 5 (the
 * issuer_fill banner "ready to file" colliding with the graduation countdown's "to file by itself").
 * Source-regex pins in the project's existing style (cf. test_chris_r6_ui_cards.js). Files on disk are
 * CRLF (core.autocrlf) — every span is `[\s\S]`-based, never `\n`-anchored.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd src/windows/review/test_chris_r2_review_cards.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const renderer = rd('src/windows/review/renderer.js');

// ── Finding 1 — the "Format check · N" count reconciles with a visible field ─────────────────────
console.log('r2-1 — Format-check count excludes the low-confidence field and bare corrected_to');
{
  const s = renderer.indexOf('const idNotes = _relevant.filter(e => isInferredIdentityNote');
  const e = renderer.indexOf('const parts = [];', s);
  const body = (s > -1 && e > -1) ? renderer.slice(s, e) : '';
  check('a lowKeys set is built from the same <70 threshold the row badge uses',
        /const lowKeys = new Set\([\s\S]{0,180}Number\(e\.confidence\) < 70[\s\S]{0,40}\.map\(e => e\.field_key\)/.test(body));
  check('otherFlagN counts only a non-inferred validation_note on a field that is NOT low-confidence',
        /const otherFlagN = _relevant\.filter\(e =>[\s\S]{0,160}e\.validation_note && !isInferredIdentityNote\(e\.validation_note\) && !lowKeys\.has\(e\.field_key\)[\s\S]{0,20}\)\.length;/.test(body));
  check('the old double-counting `flagN - idNotes.length` derivation is GONE (the bug this fixes)',
        !/const otherFlagN = Math\.max\(0, flagN - idNotes\.length\)/.test(renderer));
  const otherFlagM = body.match(/const otherFlagN = _relevant\.filter\(e =>([\s\S]*?)\)\.length;/);
  check('bare corrected_to is NOT counted (the otherFlagN filter keys on validation_note only, never corrected_to)',
        !!otherFlagM && !/corrected_to/.test(otherFlagM[1]));
  check('when nothing low / non-inferred-noted / identity remains, it falls to the clean-hold reason, not an empty banner',
        /if \(lowN === 0 && otherFlagN === 0 && idNotes\.length === 0\) \{[\s\S]{0,160}renderCleanHoldReason\(el, doc\)[\s\S]{0,40}return;/.test(body));
}

// ── Finding 5 — the issuer_fill banner does not borrow the auto-file "ready to file" phrase ──────
console.log('r2-5 — issuer_fill banner names the MANUAL File All Ready action, not auto-file readiness');
{
  const s = renderer.indexOf("switch (ev.kind) {");
  const e = renderer.indexOf('}', renderer.indexOf("case 'put_back':", s));
  const body = (s > -1 && e > -1) ? renderer.slice(s, e) : '';
  check("the issuer_fill chip points at File All Ready (the manual bulk action)",
        /case 'issuer_fill': return `\$\{n\} more offered in File All Ready`/.test(body));
  check('the issuer_fill chip no longer says "ready to file" (the phrase that collided with the countdown)',
        !/case 'issuer_fill': return `\$\{n\} more ready to file`/.test(body));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
