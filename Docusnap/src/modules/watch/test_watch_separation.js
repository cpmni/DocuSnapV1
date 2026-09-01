'use strict';
/**
 * test_watch_separation.js — the pure separation→tracked fold (2026-09-01, watch separation parity).
 * Pins the RE-IMPORT-LOOP GUARD: after a split, each segment must be pre-marked 'processing' in the
 * tracked map so the resumed poll classifies it as in-flight (never a fresh arrival to re-queue).
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/watch/test_watch_separation.js
 * (also plain node — no native deps)
 */
const { applySeparationToTracked, classifyPoll } = require('./handler');

let fail = 0;
const ok = (n, c) => { if (c) console.log('  OK  ' + n); else { fail++; console.error('  BAD ' + n); } };

const NOW = 1000;

// ── split: original replaced by its segments; each segment pre-marked 'processing' ──
{
  const tracked = new Map([['bundle.pdf', { size: 9, mtimeMs: 9, lastChangeAt: 1, state: 'processing' }],
                           ['solo.pdf',   { size: 5, mtimeMs: 5, lastChangeAt: 1, state: 'processing' }]]);
  const files = ['bundle.pdf', 'solo.pdf'];
  const out = applySeparationToTracked(files, tracked,
    [{ original: 'bundle.pdf', segments: ['bundle_1.pdf', 'bundle_2.pdf'] }], [], NOW);
  ok('original replaced by segments in the list', JSON.stringify(out) === JSON.stringify(['bundle_1.pdf', 'bundle_2.pdf', 'solo.pdf']));
  ok('original dropped from tracked', !tracked.has('bundle.pdf'));
  ok('segment 1 pre-marked processing', tracked.get('bundle_1.pdf')?.state === 'processing');
  ok('segment 2 pre-marked processing', tracked.get('bundle_2.pdf')?.state === 'processing');
  ok('non-split file untouched in list', out.includes('solo.pdf') && tracked.get('solo.pdf').state === 'processing');
}

// ── THE RE-IMPORT-LOOP GUARD: a poll firing after the pre-mark must NOT re-queue the segment ──
{
  const tracked = new Map([['b.pdf', { size: 9, mtimeMs: 9, lastChangeAt: 1, state: 'processing' }]]);
  applySeparationToTracked(['b.pdf'], tracked, [{ original: 'b.pdf', segments: ['b_1.pdf'] }], [], NOW);
  // The segment now sits in the folder with some stat; the resumed poll classifies it:
  const decision = classifyPoll(tracked.get('b_1.pdf'), { size: 4321, mtimeMs: 5555 }, NOW + 20000, 10000);
  ok('resumed poll sees segment as in-flight (NOT a fresh detect → no re-import loop)', decision.action === 'in-flight');
}

// ── consumed (only separator sheets): dropped from list AND tracked ──
{
  const tracked = new Map([['sheets.pdf', { size: 3, mtimeMs: 3, lastChangeAt: 1, state: 'processing' }],
                           ['keep.pdf',   { size: 4, mtimeMs: 4, lastChangeAt: 1, state: 'processing' }]]);
  const out = applySeparationToTracked(['sheets.pdf', 'keep.pdf'], tracked, [], ['sheets.pdf'], NOW);
  ok('consumed file removed from list', JSON.stringify(out) === JSON.stringify(['keep.pdf']));
  ok('consumed file removed from tracked', !tracked.has('sheets.pdf'));
}

// ── no rewrites/consumed: list + tracked byte-identical (OFF / nothing-to-split path) ──
{
  const tracked = new Map([['a.pdf', { size: 1, mtimeMs: 1, lastChangeAt: 1, state: 'processing' }]]);
  const out = applySeparationToTracked(['a.pdf'], tracked, [], [], NOW);
  ok('nothing to split → list unchanged', JSON.stringify(out) === JSON.stringify(['a.pdf']));
  ok('nothing to split → tracked unchanged', tracked.get('a.pdf').state === 'processing' && tracked.size === 1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
process.exit(fail ? 1 : 0);
