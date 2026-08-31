'use strict';
/*
 * test_import_concurrency_cap.js — the 2026-08-31 batch-import silent-crash fix (Oracle SIGN-OFF-W/COND).
 *
 * Two defects fixed in handler.js:
 *   A. RAM-blind, SMT-overcounted worker count → OOM on a 6c/12t / 16GB box (default 10 workers).
 *   B. runWorker was the ONLY batch spawn with no error handler → a failure-to-spawn under memory
 *      pressure became an uncaughtException → the app exited with no dialog.
 *
 * This pins the parts that are unit-testable here:
 *   1. The pure cap MATH (_effectiveWorkers / ramConcurrencyCap) — Oracle C6.1, the exact tuples.
 *   2. The OMP-decouple invariant (_reprocessThreadCap depends only on the setting, never a shard/file
 *      count) — Oracle C2/C3/C6.4.
 *   3. SOURCE-CONTRACT guards on the resilience + decouple wiring (Oracle C1/C4/C6.2/C6.3): the runWorker
 *      spawn is wrapped + has proc.on('error') + a settled flag; the worker map uses the configured-derived
 *      importThreadCap (not floor(cores/shards)); the re-drive + truthful source-folder message exist; the
 *      success formula discounts a healed spawn sentinel; get-concurrency-info exposes the RAM ceiling.
 *   The RUNTIME uncaughtException-doesn't-fire spy + the realdoc byte-identical arm are the owner-machine
 *   VM gate (Oracle C6.5) — they need the real corpus / a low-RAM VM and are logged there, not here.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/processing/test_import_concurrency_cap.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./handler');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const GiB = 1024 * 1024 * 1024;

console.log('§1 pure cap math (Oracle C6.1)');
// perWorkerBudget is the divisor; pin it so a silent change is caught.
check('perWorkerBudget is 1.5 GiB', H.PER_WORKER_BUDGET_BYTES === 1.5 * GiB);
// ramConcurrencyCap(total) = floor((total - max(3GiB, 25%)) / 1.5GiB)
check('ramCap 16GB → 8  (reserve max(3,4)=4 → budget 12 → floor(12/1.5))', H.ramConcurrencyCap(16 * GiB) === 8);
check('ramCap 8GB → 3   (reserve max(3,2)=3 → budget 5 → floor(5/1.5))',   H.ramConcurrencyCap(8 * GiB) === 3);
check('ramCap 32GB → 16 (reserve max(3,8)=8 → budget 24 → floor(24/1.5))', H.ramConcurrencyCap(32 * GiB) === 16);
check('ramCap 4GB → 1   (reserve 3 → budget 1 → floor(1/1.5)=0 → max(1))', H.ramConcurrencyCap(4 * GiB) === 1);
// _effectiveWorkers(cores, total, setting) = min(min(10,cores), setting, ramCap)
check('(12c, 16GB, want 10) → 8  (the crash case: hard-ceiled below the requested 10)', H._effectiveWorkers(12, 16 * GiB, 10) === 8);
check('(12c, 8GB, want 10)  → 3', H._effectiveWorkers(12, 8 * GiB, 10) === 3);
check('(4c, 32GB, want 10)  → 4  (core cap binds, RAM is generous)', H._effectiveWorkers(4, 32 * GiB, 10) === 4);
check('(32c, 64GB, want 10) → 10 (a big box that wants 10 KEEPS 10 — not throttled)', H._effectiveWorkers(32, 64 * GiB, 10) === 10);
check('(12c, 16GB, want 4)  → 4  (a modest explicit choice is honoured under the ceiling)', H._effectiveWorkers(12, 16 * GiB, 4) === 4);
check('never returns < 1 even on a tiny box', H._effectiveWorkers(1, 1 * GiB, 1) === 1 && H.ramConcurrencyCap(1 * GiB) === 1);

console.log('\n§2 OMP-decouple invariant (Oracle C2/C3/C6.4) — the OMP cap is a function of the SETTING, never shard count');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const learning = require('../../../database/modules/learning');
const cores = os.cpus().length || 1;
const db = new Database(':memory:');
runMigrations(db);
const tcFor = (setting) => { learning.setSetting(db, 'processing_concurrency', String(setting)); return H._reprocessThreadCap(db); };
// _reprocessThreadCap(db) = max(1, floor(cores / clamp(setting,1,10))) — no file/shard argument exists.
check('_reprocessThreadCap takes ONLY db (arity 1 — cannot depend on a shard count)', H._reprocessThreadCap.length === 1);
for (const s of [1, 2, 4, 8, 10]) {
  const expect = Math.max(1, Math.floor(cores / Math.max(1, Math.min(10, s))));
  check(`setting ${s} → OMP ${expect} (cores=${cores}), stable across repeated calls`,
        tcFor(s) === expect && tcFor(s) === expect);
}
db.close();

console.log('\n§3 source-contract: resilience + decouple wiring (Oracle C1/C4/C6.2/C6.3)');
const src = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8');
// Isolate the runWorker body so the guards below are about IT, not some other spawn in the file.
const rwStart = src.indexOf('const runWorker = (filesFile');
const rwEnd = src.indexOf('// ── Auto document separation', rwStart);
const runWorkerSrc = rwStart >= 0 && rwEnd > rwStart ? src.slice(rwStart, rwEnd) : '';
check('runWorker body isolated', runWorkerSrc.length > 500);
check('C4: a `settled` flag makes resolve idempotent', /let settled = false;/.test(runWorkerSrc));
check('C4: the spawn is wrapped in try/catch (sync-throw survival)', /try \{\s*proc = spawn\(/.test(runWorkerSrc));
check("B/C4: an async spawn-failure handler exists (the fix — no more uncaughtException)", /proc\.on\('error'/.test(runWorkerSrc));
check('C4: a spawn failure resolves the SPAWN_FAILED sentinel + records the shard', /settle\(SPAWN_FAILED, true\)/.test(runWorkerSrc));
check("C4: the 'error' handler removes proc from _currentBatchProcs (mirror the close handler)",
      /proc\.on\('error'[\s\S]{0,220}_currentBatchProcs = _currentBatchProcs\.filter/.test(runWorkerSrc));
check('close resolves via settle (not a bare resolve), so it cannot double-settle after error',
      /proc\.on\('close'[\s\S]{0,160}settle\(code\)/.test(runWorkerSrc));

// The worker map must pass the configured-derived importThreadCap, NOT a shards-derived cap.
check('C2/C3: importThreadCap is decoupled — 0 only when the user configured 1, else _reprocessThreadCap',
      /const importThreadCap = requestedConcurrency <= 1 \? 0 : _reprocessThreadCap\(db\);/.test(src));
check('C2/C3: the multi-worker map uses importThreadCap', /runWorker\(f, true, importThreadCap\)/.test(src));
check('C2/C3: the OLD shards-derived OMP cap is GONE (no floor(cores/shards.length) threadCap)',
      !/Math\.floor\(\(os\.cpus\(\)\.length \|\| 1\) \/ shards\.length\)/.test(src));
check('C2: the single-worker path also passes importThreadCap (RAM-forced-1 stays capped)',
      /runWorker\(null, false, importThreadCap\)/.test(src));

// C1: re-drive + truthful fail-toward-source-folder message (NOT "in Review").
check('C1: failed-to-spawn shards are re-driven once, sequentially, at _reprocessThreadCap',
      /for \(const ff of retry\)[\s\S]{0,220}runWorker\(ff, true, _reprocessThreadCap\(db\)\)/.test(src));
check('C1: the residual message says the docs are in the SOURCE FOLDER (not Review) — the true fail-toward',
      /left in your source folder and not imported/.test(src) && !/left in Review/.test(src));
check('C4: the low-memory retry line is emitted ONCE for the batch (not per shard)',
      (src.match(/Low memory — retrying/g) || []).length === 1);
check('success discounts a HEALED spawn sentinel but fails on an unhealed shard',
      /failedShards\.length === 0 && codes\.every\(c => c === 0 \|\| c === SPAWN_FAILED\)/.test(src));

// Item 5 transparency: the ceiling is surfaced.
check('get-concurrency-info exposes ramCap + effectiveMax', /ramCap: ramConcurrencyCap\(\)/.test(src) && /effectiveMax:/.test(src));
check('a runtime clamp emits ONE "stay within this PC\'s available memory" line',
      /to stay within this PC's available memory/.test(src));

console.log(fails ? `\n${fails} FAILED` : '\nAll import-concurrency-cap pins passed');
process.exit(fails ? 1 : 0);
