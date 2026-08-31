'use strict';
/*
 * regionWorker.js — a POOL of long-lived focused-OCR workers (draw-tool UX plan Slice 2).
 *
 * The ocr-region / ocr-region-boxes handlers route through here when the pool is ENABLED
 * (default OFF — env OCR_WARM_WORKER=1 or setting ocr_warm_worker_enabled). Each worker
 * (python_backend/ocr/region_worker.py) imports region_core ONCE and answers newline-JSON
 * requests, so a read skips the ~115ms interpreter+import cost. A pool of N (one per spare core)
 * lets the 3 reads of a single draw run in PARALLEL on separate cores.
 *
 * FAIL-SAFE (Oracle): a worker death / timeout REJECTS the in-flight request; the HANDLER then
 * falls back to a cold region.py spawn — the renderer only ever sees a normal (slower) result,
 * never fail-toward-empty. >=3 deaths in 60s disables the pool for the session. Byte-identical to
 * the cold path (both call region_core.process). Workers talk over their OWN stdio only (never the
 * DB / webContents), so there is no "send after destroyed" surface. Idle workers are killed after
 * IDLE_MS and respawned on demand; shutdown() is called on app before-quit.
 *
 * Decoupled from Electron internals: the handler injects {pythonExe, pythonArgs, workerScript,
 * tesseract, isEnabled} via configure() so this is unit-testable with real or fake deps.
 * Guarded by src/modules/processing/test_region_worker.js.
 */
const os = require('os');
const { spawn } = require('child_process');

const REQ_TIMEOUT_MS = 15000;   // a single crop OCR never legitimately takes this long
const IDLE_MS        = 180000;  // kill idle workers after 3 min (respawned lazily on next run)
const DEATH_WINDOW   = 60000;
const DEATH_LIMIT    = 3;

let cfg = null;
let pool = [];                  // [{proc, buf, pending:Map<id,{resolve,reject,timer}>, ready}]
let nextId = 1;
let disabledForSession = false;
let idleTimer = null;
const deathTimes = [];

function configure(deps) { cfg = deps; disabledForSession = false; }

function enabled() {
  return !!(cfg && !disabledForSession && cfg.isEnabled && cfg.isEnabled());
}

function _poolSize() {
  if (cfg && cfg.poolSize) return Math.max(1, cfg.poolSize);
  const cores = ((os.cpus && os.cpus()) || []).length || 2;
  return Math.max(1, Math.min(4, cores - 2));
}

function _touchIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(shutdown, IDLE_MS);
  if (idleTimer.unref) idleTimer.unref();      // don't keep the process alive just for the idle timer
}

function _spawnWorker() {
  const proc = spawn(cfg.pythonExe(), cfg.pythonArgs(cfg.workerScript, '--tesseract', cfg.tesseract()),
                     { windowsHide: true });
  const w = { proc, buf: '', pending: new Map(), ready: false };
  proc.stdout.on('data', d => _onData(w, d));
  proc.stderr && proc.stderr.on('data', () => {});   // ignore worker stderr
  proc.on('exit', () => _onExit(w));
  proc.on('error', () => _onExit(w));
  return w;
}

function _onData(w, d) {
  w.buf += d.toString();
  let nl;
  while ((nl = w.buf.indexOf('\n')) >= 0) {
    const line = w.buf.slice(0, nl).trim();
    w.buf = w.buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.ready) { w.ready = true; continue; }
    const p = w.pending.get(msg.id);
    if (!p) continue;
    w.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error('worker: ' + msg.error));
    else p.resolve(msg);
  }
}

function _onExit(w) {
  // Reject every in-flight request on this worker -> the handler falls back to a cold spawn.
  for (const [, p] of w.pending) { clearTimeout(p.timer); p.reject(new Error('worker died')); }
  w.pending.clear();
  pool = pool.filter(x => x !== w);
  const now = Date.now();
  deathTimes.push(now);
  while (deathTimes.length && now - deathTimes[0] > DEATH_WINDOW) deathTimes.shift();
  if (deathTimes.length >= DEATH_LIMIT) { disabledForSession = true; shutdown(); }
}

function _ensurePool() {
  if (disabledForSession) return;
  const size = _poolSize();
  while (pool.length < size) pool.push(_spawnWorker());
}

/** Pre-spawn the pool (optional; call on Review-window open so the first draw is already warm). */
function warmUp() {
  if (enabled()) { _ensurePool(); _touchIdle(); }
}

/** Run one crop OCR on a warm worker. Resolves the worker's response {text,box,words,lines};
 *  REJECTS on disabled / no-worker / timeout / worker-death so the handler can cold-fallback. */
function run({ imageFile, boxes }) {
  return new Promise((resolve, reject) => {
    if (!enabled()) { reject(new Error('pool disabled')); return; }
    _ensurePool();
    if (!pool.length) { reject(new Error('no worker')); return; }
    _touchIdle();
    // least-busy dispatch: fewest in-flight wins (a synchronous burst of run() calls — Promise.all
    // of the 3 reads — spreads across workers because pending is set before the next run() executes).
    let w = pool[0];
    for (const x of pool) if (x.pending.size < w.pending.size) w = x;
    const id = nextId++;
    const timer = setTimeout(() => {
      if (w.pending.has(id)) { w.pending.delete(id); reject(new Error('worker timeout')); }
    }, REQ_TIMEOUT_MS);
    w.pending.set(id, { resolve, reject, timer });
    try {
      w.proc.stdin.write(JSON.stringify({ id, file: imageFile, boxes: !!boxes }) + '\n');
    } catch (e) {
      w.pending.delete(id); clearTimeout(timer); reject(e);
    }
  });
}

/** Kill the whole pool (app before-quit / Review-window close / idle / backoff). Reject in-flight. */
function shutdown() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  for (const w of pool) {
    for (const [, p] of w.pending) { clearTimeout(p.timer); p.reject(new Error('shutdown')); }
    w.pending.clear();
    try { w.proc.stdin.end(); } catch {}
    try { w.proc.kill(); } catch {}
  }
  pool = [];
}

module.exports = { configure, enabled, run, warmUp, shutdown, _poolSize };
