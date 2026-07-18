'use strict';
/*
 * test_split_plan.js — pins the batch-separation decision rules (Filing Slips slice 1,
 * docs/designs/FILING_SLIPS_2026-07-18.md §7). Plain Node — no Electron/DB deps.
 *
 * Run: node src/modules/processing/test_split_plan.js
 */
const { buildSegmentArgs, buildSplitPlan, toRanges } = require('./split_plan');

let fails = 0;
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`);
  if (!cond) fails++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('§1 buildSegmentArgs (Oracle C1 — argv construction)');
let a = buildSegmentArgs({ filePath: 'f.pdf', templatesFile: null, tesseract: null, slips: true });
check('slips ON + zero templates: --slips present, NO --templates-file, no null/undefined in argv',
  eq(a, ['--file', 'f.pdf', '--slips']) && a.every(x => typeof x === 'string'), JSON.stringify(a));
a = buildSegmentArgs({ filePath: 'f.pdf', templatesFile: 't.json', tesseract: 'tess.exe', slips: false });
check('templates only (today\'s path): byte-identical argv, no --slips',
  eq(a, ['--file', 'f.pdf', '--templates-file', 't.json', '--tesseract', 'tess.exe']), JSON.stringify(a));
a = buildSegmentArgs({ filePath: 'f.pdf', templatesFile: 't.json', tesseract: 'tess.exe', slips: true });
check('both arms: templates AND --slips', eq(a, ['--file', 'f.pdf', '--templates-file', 't.json', '--tesseract', 'tess.exe', '--slips']));

console.log('§2 today\'s template rule, verbatim (no separators)');
check('null detector → skip', buildSplitPlan(null).action === 'skip');
check('failed detector → skip', buildSplitPlan({ success: false }).action === 'skip');
check('1 segment, no seps → skip (untouched)', buildSplitPlan({ success: true, segments: [[0, 4]] }).action === 'skip');
let p = buildSplitPlan({ success: true, segments: [[0, 1], [2, 3]] });
check('2 segments, no seps → split minFiles=2', p.action === 'split' && p.minFiles === 2 && p.ranges === '1-2,3-4');

console.log('§3 PIN #1 — the exclusion-seam fix (do NOT restore "<2 segments ⇒ untouched" here)');
p = buildSplitPlan({ success: true, segments: [[0, 1]], separator_pages: [2], separator_payloads: ['SFSEP-0007'] });
check('1 segment + separator ⇒ REWRITE plan (minFiles=1), never skip — a trailing sheet must not be filed inside the doc',
  p.action === 'split' && p.minFiles === 1 && p.ranges === '1-2' && p.separators === 1, JSON.stringify(p));
check('rewrite plan carries payloads for the log line', eq(p.payloads, ['SFSEP-0007']));

console.log('§4 slips split + consume');
p = buildSplitPlan({ success: true, segments: [[0, 0], [2, 2]], separator_pages: [1], separator_payloads: ['SFSEP-0003'] });
check('slip mid-file → split minFiles=1, ranges exclude the sheet page', p.action === 'split' && p.minFiles === 1 && p.ranges === '1,3');
p = buildSplitPlan({ success: true, segments: [], separator_pages: [0, 1], separator_payloads: ['SFSEP-1', 'SFSEP-2'] });
check('only-slips file → consume (no splitter call)', p.action === 'consume' && p.separators === 2);

console.log('§5 Oracle C4 — an aborted slip scan must never half-apply');
p = buildSplitPlan({ success: true, segments: [[0, 4]], separator_pages: [2], slip_aborted: 'decoder unavailable' });
check('separators listed but slip_aborted set ⇒ separator data IGNORED ⇒ today\'s rule (skip)',
  p.action === 'skip', JSON.stringify(p));
p = buildSplitPlan({ success: true, segments: [[0, 1], [2, 4]], separator_pages: [9], slip_aborted: 'x' });
check('aborted + 2 template segments ⇒ plain template split (minFiles=2, no separators counted)',
  p.action === 'split' && p.minFiles === 2 && p.separators === 0);

console.log('§6 toRanges formatting');
check('single-page and multi-page groups', toRanges([[0, 0], [2, 5]]) === '1,3-6');

console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
