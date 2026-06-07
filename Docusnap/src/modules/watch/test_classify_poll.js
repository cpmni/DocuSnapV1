#!/usr/bin/env node
'use strict';

/**
 * src/modules/watch/test_classify_poll.js
 * -----------------------------------------
 * Direct unit test for watch/handler.js's classifyPoll — the pure decision
 * function at the heart of the watch-folder feature's stability/debounce
 * state machine ("wait 30s after the file stops changing, reset the timer
 * if it changes again, never reprocess a file already in flight or done").
 *
 * Covers every transition the spec calls for:
 *   1. New file -> detected, timer started
 *   2. Still changing -> timer reset (lastChangeAt bumped to now)
 *   3. Unchanged, not yet at the delay -> wait (no state change)
 *   4. Unchanged, at/over the delay -> stable, handed off for processing
 *   5. Already in flight -> left alone regardless of further fs changes
 *      (this is the "don't requeue something already queued/processing" guard)
 *   6. Done and unchanged -> left alone (never reprocessed)
 *   7. Done but changed (e.g. a re-scan overwrote the same filename) ->
 *      re-tracked from scratch, exactly like a brand new arrival
 *
 * Usage:
 *   node src/modules/watch/test_classify_poll.js
 *
 * Exit code 0 = behaves as expected. Exit code 1 = regression.
 */

const { classifyPoll } = require('./handler');

const DELAY = 30000;

function check(label, condition) {
  console.log(`  ${condition ? 'OK ' : 'BAD'} ${label}`);
  return condition;
}

function main() {
  let failures = 0;
  const T0 = 1_000_000; // arbitrary fixed "now" for reproducible deltas

  // 1. New file -> detected, stability timer started fresh
  {
    const stat = { size: 1000, mtimeMs: 5000 };
    const d = classifyPoll(null, stat, T0, DELAY);
    console.log('New file: detected, watching, timer baseline = now');
    if (!check('action = detected', d.action === 'detected')) failures++;
    if (!check('state = watching', d.record.state === 'watching')) failures++;
    if (!check('lastChangeAt = now', d.record.lastChangeAt === T0)) failures++;
    if (!check('size/mtime captured', d.record.size === 1000 && d.record.mtimeMs === 5000)) failures++;
  }

  console.log();

  // 2. Still changing while watching -> timer resets to "now"
  {
    const prev = { size: 1000, mtimeMs: 5000, lastChangeAt: T0, state: 'watching' };
    const stat = { size: 1500, mtimeMs: 6000 }; // grew — still being written
    const d = classifyPoll(prev, stat, T0 + 10000, DELAY);
    console.log('File still growing: stability timer resets');
    if (!check('action = reset', d.action === 'reset')) failures++;
    if (!check('lastChangeAt bumped to the new "now"', d.record.lastChangeAt === T0 + 10000)) failures++;
    if (!check('size/mtime updated', d.record.size === 1500 && d.record.mtimeMs === 6000)) failures++;
    if (!check('still watching (not yet handed off)', d.record.state === 'watching')) failures++;
  }

  console.log();

  // 3. Unchanged but the delay hasn't elapsed yet -> keep waiting
  {
    const prev = { size: 1000, mtimeMs: 5000, lastChangeAt: T0, state: 'watching' };
    const stat = { size: 1000, mtimeMs: 5000 }; // identical
    const d = classifyPoll(prev, stat, T0 + (DELAY - 1), DELAY);
    console.log('Unchanged, just under 30s: still waiting');
    if (!check('action = wait', d.action === 'wait')) failures++;
    if (!check('record/state untouched', d.record.state === 'watching' && d.record.lastChangeAt === T0)) failures++;
  }

  console.log();

  // 4. Unchanged and the delay has fully elapsed -> stable, accepted
  {
    const prev = { size: 1000, mtimeMs: 5000, lastChangeAt: T0, state: 'watching' };
    const stat = { size: 1000, mtimeMs: 5000 };
    const d = classifyPoll(prev, stat, T0 + DELAY, DELAY);
    console.log('Unchanged for the full 30s: accepted for processing');
    if (!check('action = stable', d.action === 'stable')) failures++;
    if (!check('state -> processing (so it is not requeued next poll)', d.record.state === 'processing')) failures++;
  }

  console.log();

  // 5. Already in flight -> left alone no matter what the filesystem shows
  // (this is the "don't double-queue / don't reprocess something already
  // queued or processing" guard the spec calls out explicitly)
  {
    const prev = { size: 1000, mtimeMs: 5000, lastChangeAt: T0, state: 'processing' };
    const stat = { size: 9999, mtimeMs: 9999 }; // wildly different — must not matter
    const d = classifyPoll(prev, stat, T0 + 999999, DELAY);
    console.log('Already processing: never re-evaluated mid-flight');
    if (!check('action = in-flight', d.action === 'in-flight')) failures++;
    if (!check('record returned unchanged (same object)', d.record === prev)) failures++;
  }

  console.log();

  // 6. Done and unchanged -> never reprocessed
  {
    const prev = { size: 1000, mtimeMs: 5000, lastChangeAt: T0, state: 'done' };
    const stat = { size: 1000, mtimeMs: 5000 };
    const d = classifyPoll(prev, stat, T0 + 999999, DELAY);
    console.log('Done and unchanged: left alone — no reprocessing loop');
    if (!check('action = unchanged-done', d.action === 'unchanged-done')) failures++;
    if (!check('record returned unchanged (same object)', d.record === prev)) failures++;
  }

  console.log();

  // 7. Done but the file changed (e.g. re-scanned over the same name) ->
  // treated as a brand new arrival, with its own fresh stability timer
  {
    const prev = { size: 1000, mtimeMs: 5000, lastChangeAt: T0, state: 'done' };
    const stat = { size: 2000, mtimeMs: 8000 };
    const d = classifyPoll(prev, stat, T0 + 999999, DELAY);
    console.log('Done but file changed: re-tracked from scratch (fresh timer)');
    if (!check('action = retrack', d.action === 'retrack')) failures++;
    if (!check('state reset to watching', d.record.state === 'watching')) failures++;
    if (!check('timer baseline reset to "now", not inherited', d.record.lastChangeAt === T0 + 999999)) failures++;
    if (!check('new size/mtime captured', d.record.size === 2000 && d.record.mtimeMs === 8000)) failures++;
  }

  console.log();
  if (failures) {
    console.log(`${failures} check(s) failed — classifyPoll regressed.`);
    process.exitCode = 1;
    return;
  }
  console.log('All checks passed — classifyPoll behaves as expected.');
}

main();
