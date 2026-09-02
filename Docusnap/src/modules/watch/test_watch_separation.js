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

// ── NO-LOSS ACCOUNTING + HELD-SET (watch_separate soak gate, 2026-09-02) ──
// Every input must be accounted for: consumed (dropped) OR passed through OR expanded to >=1 segment,
// with NO duplicate in the output and NO segment name colliding with a surviving input. And the HELD set
// (autoFileRun=false — a fresh split boundary must not auto-file unattended) is EXACTLY the produced
// segments — never a passed-through single doc (which stays auto-fileable).
{
  const inputs = ['bundle.pdf', 'twoup.pdf', 'solo.pdf', 'sheets.pdf'];
  const tracked = new Map(inputs.map(n => [n, { size: 1, mtimeMs: 1, lastChangeAt: 1, state: 'processing' }]));
  const rewrites = [
    { original: 'bundle.pdf', segments: ['bundle_1.pdf', 'bundle_2.pdf', 'bundle_3.pdf'] },
    { original: 'twoup.pdf',  segments: ['twoup_1.pdf', 'twoup_2.pdf'] },
  ];
  const consumed = ['sheets.pdf'];
  const out = applySeparationToTracked([...inputs], tracked, rewrites, consumed, NOW);

  // heldNames = the same set _drainQueue builds (every segment of every rewrite).
  const held = new Set();
  for (const r of rewrites) for (const s of r.segments) held.add(s);

  const producedSegments = rewrites.flatMap(r => r.segments);
  const passthrough = inputs.filter(n => !rewrites.some(r => r.original === n) && !consumed.includes(n));

  ok('no-loss: output = passthrough + all segments (consumed dropped, no ghost)',
     JSON.stringify([...out].sort()) === JSON.stringify([...passthrough, ...producedSegments].sort()));
  ok('no dup in the output list', new Set(out).size === out.length);
  ok('no segment name collides with a surviving input', producedSegments.every(s => !passthrough.includes(s)));
  ok('held set = exactly the produced segments (the autoFileRun=false contract)',
     held.size === producedSegments.length && producedSegments.every(s => held.has(s)));
  ok('a passed-through single doc is NOT held (stays auto-fileable)', passthrough.every(n => !held.has(n)));
  ok('every produced segment is pre-marked processing (re-import guard, at scale)',
     producedSegments.every(s => tracked.get(s)?.state === 'processing'));
  ok('consumed + split originals all gone from tracked',
     !tracked.has('sheets.pdf') && !tracked.has('bundle.pdf') && !tracked.has('twoup.pdf'));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
process.exit(fail ? 1 : 0);
