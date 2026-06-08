#!/usr/bin/env node
'use strict';

/**
 * src/modules/filing/test_remove_source_file.js
 * -----------------------------------------------
 * Direct unit test for filing/handler.js's removeSourceFile — the function
 * the deferred source-file move (review/handler.js) calls once it has
 * decided the preview UI should no longer have the original scan open.
 *
 * Covers the contract that matters for this change: a single attempt is the
 * PRIMARY path (the deferred-move design is what's supposed to make the file
 * free by the time this runs), and the escalating retry + `.deleting` rename
 * are a FINAL FALLBACK only, not a loop that runs on every commit.
 *
 *   1. Expected case — file is free, one unlink call succeeds. No backoff.
 *   2. A non-lock error (e.g. permissions) surfaces immediately — not retried.
 *   3. Still locked at the expected-free moment — fallback retry recovers
 *      partway through.
 *   4. Locked through every retry — final fallback renames to `.deleting`
 *      for later cleanup instead of leaving the file in place.
 *
 * global.setTimeout is monkey-patched to fire synchronously for the
 * fallback-path cases so the (several-second) backoff runs instantly.
 *
 * Usage:
 *   node src/modules/filing/test_remove_source_file.js
 *
 * Exit code 0 = behaves as expected. Exit code 1 = regression.
 */

const { removeSourceFile } = require('./handler');

function check(label, condition) {
  console.log(`  ${condition ? 'OK ' : 'BAD'} ${label}`);
  return condition;
}

function lockError() {
  return Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
}

function permError() {
  return Object.assign(new Error('access denied'), { code: 'EACCES' });
}

function makeFs(unlinkBehaviour) {
  let unlinkCalls = 0;
  let renamed = null;
  return {
    state: () => ({ unlinkCalls, renamed }),
    existsSync: () => true,
    unlinkSync: () => {
      unlinkCalls++;
      const outcome = unlinkBehaviour(unlinkCalls);
      if (outcome instanceof Error) throw outcome;
    },
    renameSync: (from, to) => { renamed = { from, to }; },
  };
}

const silentLogger = { log() {}, warn() {} };

async function withInstantTimers(fn) {
  const real = global.setTimeout;
  global.setTimeout = (cb) => { cb(); return 0; };
  try { return await fn(); }
  finally { global.setTimeout = real; }
}

async function main() {
  let failures = 0;

  // 1. Expected case: file is free — single unlink, no fallback engaged.
  {
    const fs = makeFs(() => null);
    const ok = await removeSourceFile(fs, 'C:/scans/a.pdf', silentLogger);
    console.log("Free at expected time: single unlink succeeds");
    if (!check('returns true', ok === true)) failures++;
    if (!check('exactly one unlink call — no backoff loop ran', fs.state().unlinkCalls === 1)) failures++;
  }

  // 2. A non-lock error must surface immediately, not be retried.
  {
    const fs = makeFs(() => permError());
    const ok = await removeSourceFile(fs, 'C:/scans/b.pdf', silentLogger);
    console.log("Non-lock error (EACCES): surfaced without retrying");
    if (!check('returns false', ok === false)) failures++;
    if (!check('exactly one unlink call — non-lock errors are not retried', fs.state().unlinkCalls === 1)) failures++;
  }

  // 3. Locked at the expected-free moment, frees up partway through fallback retry.
  await withInstantTimers(async () => {
    const fs = makeFs(n => (n < 4 ? lockError() : null));
    const ok = await removeSourceFile(fs, 'C:/scans/c.pdf', silentLogger);
    console.log("Still locked, then frees: fallback retry recovers");
    if (!check('returns true', ok === true)) failures++;
    if (!check('took more than one attempt (fallback engaged)', fs.state().unlinkCalls > 1)) failures++;
    if (!check('did not fall through to the rename fallback', fs.state().renamed === null)) failures++;
  });

  // 4. Locked through every retry — final fallback renames for later cleanup.
  await withInstantTimers(async () => {
    const fs = makeFs(() => lockError());
    const ok = await removeSourceFile(fs, 'C:/scans/d.pdf', silentLogger);
    console.log("Locked through every retry: renamed to `.deleting` sidecar");
    if (!check('still reports success (handed off for later cleanup)', ok === true)) failures++;
    if (!check("renamed 'd.pdf' -> 'd.pdf.deleting'",
               !!fs.state().renamed && fs.state().renamed.to === 'C:/scans/d.pdf.deleting')) failures++;
  });

  console.log();
  if (failures) {
    console.log(`${failures} check(s) failed — removeSourceFile regressed.`);
    process.exitCode = 1;
    return;
  }
  console.log('All checks passed — removeSourceFile behaves as expected.');
}

main();
