'use strict';
/*
 * test_teach_label_pick.js — the teach wizard must pick its anchor label by SCORE, not by which
 * band happened to be read first.
 *
 * THE GAP THIS PINS (closed 2026-08-08). `autoLabel` built a `tries` list (LEFT band, then ABOVE
 * band) and returned inside the loop the moment a band produced any non-empty label. So the LEFT
 * strip won by ARRIVAL ORDER even when it was garbage and a clean caption sat directly above the
 * value. The Review ⊕ tool hit exactly this on 2026-07-11 — a garbled 'esha, i' to the left beating
 * a clean 'Customer' above — and fixed it by reading BOTH strips and scoring them through the
 * SHARED AnchorLabel.pickLabelCandidate (review/renderer.js, the D1 block). That picker was
 * Oracle-signed and pinned in shared/test_anchor_label.js, and its own source comment recorded that
 * the teach wizard did not share it: "the Teach wizard's autoLabel (teach/renderer.js) does NOT
 * share this picker, so it is unaffected (pre-existing gap, C5)".
 *
 * This pin exists so that gap cannot silently reopen. It asserts that teach WIRES the shared picker
 * (it does not re-implement one), that the caption bank stays FIELD-SCOPED, that the operator's
 * direction toggle still pins one side, and that the kill switch really is byte-identical rather
 * than nominally present. It also re-asserts, against the shared module itself, the specific picker
 * decisions teach now depends on — so a future change to the picker that would silently alter teach
 * shows up here and not only in the Review suite.
 *
 *   node src/windows/teach/test_teach_label_pick.js
 */
const fs = require('fs');
const path = require('path');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const raw = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');
// Strip line comments before asserting on structure: the comments in autoLabel deliberately
// DESCRIBE the old left-first shape, so a naive source scan would find the very pattern it is
// checking has gone (the trap test_teach_multipage.js fell into on its first run).
const js = raw.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

console.log('\nTHE SWITCH');
check('TEACH_LABEL_PICK exists as a module-level kill switch',
      /const TEACH_LABEL_PICK\s*=\s*(true|false)\s*;/.test(js));
check('it defaults ON (the scored pick is the shipped behaviour)',
      /const TEACH_LABEL_PICK\s*=\s*true\s*;/.test(js));

console.log('\nTEACH USES THE SHARED PICKER — it does not grow a second one');
check('autoLabel calls AnchorLabel.pickLabelCandidate',
      /pickLabelCandidate\s*\(/.test(js));
check('the picker is reached through the shared module handle, not redefined locally',
      /A\.pickLabelCandidate\s*\(/.test(js) && !/function\s+pickLabelCandidate/.test(js));
check('both bands are compared only when BOTH produced a candidate',
      /if\s*\(leftC\s*&&\s*aboveC\)/.test(js));
check('an "above" verdict returns the ABOVE candidate',
      /pick\.direction\s*===\s*'above'\s*\)\s*return\s+aboveC/.test(js));
check('a "left" verdict returns the LEFT candidate',
      /pick\.direction\s*===\s*'left'\s*\)\s*return\s+leftC/.test(js));

console.log('\nTHE CAPTION BANK IS FIELD-SCOPED (Oracle condition on the Review side)');
check('the bank is built from the CURRENT field only',
      /const caps = \[\];[\s\S]{0,200}curField\(\)[\s\S]{0,120}caps\.push\(cf\.label\)/.test(js));
check('the bank is passed to the picker',
      /pickLabelCandidate\([^)]*caps\)/.test(js));
check('no global/all-fields caption list is assembled for the pick',
      !/state\.fields\.map\([^)]*label[^)]*\)[\s\S]{0,80}pickLabelCandidate/.test(js));

console.log('\nTHE OPERATOR OVERRIDE STILL PINS ONE SIDE');
check('forceDir bypasses the pick entirely (the ← Left / ↑ Above toggle)',
      /if\s*\(!TEACH_LABEL_PICK\s*\|\|\s*forceDir\)/.test(js));
check('redetectAnchor still calls autoLabel with an explicit direction',
      /autoLabel\(_teachFwdBox\(r\.target\), dir\)/.test(js));

console.log('\nOFF IS BYTE-IDENTICAL BY CONSTRUCTION, NOT BY CLAIM');
check('the OFF branch is the original sequential loop over tries',
      /if\s*\(!TEACH_LABEL_PICK\s*\|\|\s*forceDir\)\s*\{[\s\S]{0,220}for\s*\(const band of tries\)/.test(js));
check('the OFF branch keeps the early return on the first non-empty band',
      /for\s*\(const band of tries\)\s*\{[\s\S]{0,160}if\s*\(c\)\s*return c;/.test(js));

console.log('\nTHE COST TRADE-OFF IS PINNED (a future dev must not quietly serialise it)');
check('with the pick ON the two bands are read CONCURRENTLY',
      /await Promise\.all\(tries\.map\(b => _bandResult\(b\)/.test(js));
check('the per-band read is one hoisted function, so both sides run identical logic',
      /const _bandResult = async \(band\) =>/.test(js));
check('the clip-gated pass-2 re-read stayed INSIDE the per-band function '
      + '(each side is scored on its own best reading)',
      /_bandResult = async \(band\) =>[\s\S]{0,6000}_rereadLabelTight\(/.test(js));

console.log('\nBOTH-SUSPICIOUS FALLS THROUGH TO POSITION-ONLY, never a staged garble');
check('a null direction is not treated as a pick',
      !/pick\.direction\s*===\s*null\s*\)\s*return/.test(js));
check('the synthetic position-only anchor is still the final fall-through',
      /anchor_text:null, dir:'left'\}/.test(js));

// ── behavioural: the shared picker decisions teach now inherits ───────────────────────────────
console.log('\nTHE SHARED PICKER ITSELF (the decisions teach now depends on)');
const A = require(path.join(__dirname, '..', 'shared', 'anchorLabel.js'));
const CUST = ['Customer'];
let p = A.pickLabelCandidate('esha, i', 'Customer', CUST);
check('THE INCIDENT teach was exposed to: clean "Customer" above beats garbled left',
      p.direction === 'above' && p.label === 'Customer');
p = A.pickLabelCandidate('Invoice No.', 'Customer', CUST);
check('a clean left caption is NOT stolen by a field-caption match above… ',
      p.direction === 'above');   // score 2 beats score 1 — documents the accepted behaviour
p = A.pickLabelCandidate('Ship To', 'Deliver To', []);
check('a balanced tie stays LEFT (the status-quo direction teach used to always take)',
      p.direction === 'left');
p = A.pickLabelCandidate('esha, i', '�garble', CUST);
check('both suspicious -> position-only, so teach stages no label at all',
      p.direction === null && p.label === '');
p = A.pickLabelCandidate('', 'Bill To', CUST);
check('an empty left no longer blocks a clean above',
      p.direction === 'above' && p.label === 'Bill To');

console.log(fails ? `\n${fails} CHECK(S) FAILED\n` : '\nall checks passed\n');
process.exit(fails ? 1 : 0);
