'use strict';
/*
 * test_drain_tally.js — the per-folder drain tally (Oracle C1 on the Chris-r5 post-run line).
 * THE SEAM THIS PINS: a plain per-batch counter was contaminated by CONCURRENT WATCH drains
 * (watch messages share _drainNowOrDefer; watch defers behind a manual batch but not the
 * reverse), so the manual "N original scans moved" line could report watch-folder moves.
 * The tally keys on the item's SOURCE folder; the manual emit takes ONLY its own folder.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_drain_tally.js
 */
const path = require('path');
const { _recordDrain, _takeDrainTally } = require(path.join(__dirname, 'handler.js'));

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const MANUAL = 'C:\\Scans\\August';
const WATCH  = 'C:\\WatchDrop';

// A manual batch starts: clear any stale tally for its folder.
_takeDrainTally(MANUAL);

// Two manual drains + ONE WATCH DRAIN LANDING MID-BATCH (the exact contamination case).
_recordDrain(path.join(MANUAL, 'inv1.pdf'));
_recordDrain(path.join(WATCH, 'drop1.pdf'));      // concurrent watch drain
_recordDrain(path.join(MANUAL, 'inv2.pdf'));

check('the manual emit counts ONLY its own folder (2, not 3 — the watch drain is excluded)',
      _takeDrainTally(MANUAL) === 2);
check('take is destructive: a second take for the same folder returns 0',
      _takeDrainTally(MANUAL) === 0);
check("the watch folder's tally survives untouched until ITS OWN take",
      _takeDrainTally(WATCH) === 1);
check('case/normalisation: mixed-case + trailing-slash folder resolves to the same key',
      (_recordDrain(path.join(MANUAL, 'inv3.pdf')), _takeDrainTally('c:\\scans\\AUGUST\\')) === 1);
check('unknown folder takes 0 (never throws)', _takeDrainTally('C:\\NoSuchPlace') === 0);

console.log(fails ? `\n${fails} FAILED` : '\nAll drain-tally pins passed');
process.exit(fails ? 1 : 0);
