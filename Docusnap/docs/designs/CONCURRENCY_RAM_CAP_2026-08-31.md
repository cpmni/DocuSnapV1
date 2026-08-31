# Batch-import silent crash — RAM-aware cap + worker-death resilience (design)

**Status:** DESIGNED (eric + oscar consensus, 2026-08-31). **Oracle gate PENDING**, then build.
Owner approved "design it + run the gate, don't just patch." Incident diagnosis was in
`HANDOVER_2026-08-31_INTEGRATION.md` §2; this is the post-advisor design.

## Incident
A friend batch-imported the test docs on a Ryzen 5 / 16GB Windows PC → the app locked up, crashed,
and disappeared with NO error dialog. Diagnosed from code; NOT yet confirmed against his crash log.

## Two compounding defects (both confirmed in code)
- **A — RAM-blind, SMT-overcounted worker count.** `os.cpus().length` = LOGICAL processors (12 on a
  6c/12t Ryzen 5) and nothing in `src/modules/processing` reads memory. `maxConcurrency()`
  (`handler.js:1919`) = `min(10, 12)` = 10; `defaultConcurrency()` (`:1929`) = `min(10, 12-2)` = 10 →
  10 heavy Python workers (Tesseract + pypdfium2, each holding 200-DPI page bitmaps) × ~1.5GB > the
  ~12GB budget on a 16GB box → pagefile thrash = the "locked up" phase.
- **B — the batch spawn has NO error handler → memory pressure becomes a SILENT main crash.**
  `runWorker` (`handler.js:2532`) wires only `stdout`/`stderr`/`close` — no `proc.on('error')`, no
  try/catch. It is the ONLY spawn in the file without one (contrast `runPyJson` `:2296/:2305` and
  `:1554,:3268,:3418,:4340,:4636,:4699,:5044,:5111,:5413`). On exhaustion a failure-to-spawn emits an
  async `'error'` (EAGAIN/ENOMEM) → with no listener Node re-raises as `uncaughtException`; main's only
  net is `uncaughtExceptionMonitor` (`main.js:1313`) which is monitor-only (logs, never prevents) → the
  window disappears with no dialog. **This is the "no warning" mechanism.** A worker that dies AFTER
  spawning is already survivable (`close` → `resolve(code)` `:2589`); only failure-to-spawn is fatal.

## The fix (smallest correct)
1. **RAM cap, computed ONCE at batch start** (every worker shares one decision):
   `reserve = max(3*GiB, totalmem()*0.25)`; `budget = totalmem() - reserve`;
   `ramCap = max(1, floor(budget / perWorkerBudget))`;
   `effective = max(1, min(configuredOrDefault, maxConcurrency(), ramCap))`.
   Use **`totalmem()` as the PRIMARY term** (stable → reproducible, and a true physical ceiling);
   Windows `os.freemem()` under-reports (excludes standby/cache) so use it only as a secondary
   tripwire (`freemem < perWorkerBudget + 1GiB` → drop one more + warn). With `perWorkerBudget≈1.5GB`:
   16GB→8 workers (down from the fatal 10), 8GB→3, 32GB→coreCap binds.
2. **`perWorkerBudget = 1.5 GB`** (oscar) — but note the import worker holds EVERY page of a PDF at
   once (`ocr/tesseract.py:992-1039` renders all pages up front, kept resident through the whole
   extraction), so the budget is page-count-dependent: typical 1–2pg ≈ 0.5GB, 50pg ≈ 1.3GB,
   near the 300-page DoS cap ≈ 4.85GB (OOMs regardless of worker count). Pair the flat 1.5GB with lever 3.
3. **Grayscale-pages-1..N lever (oscar; SEPARATE accuracy-touching sub-arc, its own gate).** Convert
   rasters to `'L'` for pages 1..N (Tesseract OCRs grayscale anyway) → ~4× cut on the blow-up term
   (50pg 1.3GB→0.45GB). **SEAM — keep page 0 in colour:** `BANNER_HEADING_REREAD` reads page 0's raw
   RGB red channel for stylised-red heading/type recovery and logo phash runs on page 0; a blanket 'L'
   would silently disable type-detection recovery. Also `.to_pil().convert("RGB")` drops a useless
   alpha channel (free ~25%). Per-page streaming/free is the true architectural fix but NOT a drop-in
   (later stages reuse arbitrary pages for crop/anchor/registration) → its own arc.
4. **Do NOT chase physical cores.** `os.availableParallelism()` still returns logical on Windows; `wmic`
   is gone on Win11 24H2 (this user is on 26200); no clean in-process API. Let the RAM cap be the
   binding constraint. Optional cheap default estimate `ceil(logical/2)`, fresh-install-only.
5. **Policy: HARD-ceil even an EXPLICIT `processing_concurrency`** (not just the default) — the ceiling is
   `totalmem`-derived (a true physical limit, never below what the box supports), so it can't throttle a
   real preference into anything but crash-avoidance. Transparency (required): `get-concurrency-info`
   (`:2747`) gains an `effectiveMax`/`ramCap` field → Settings shows "Your PC's memory limits large
   batches to N workers"; emit ONE `process-progress` line when the runtime clamp reduces below the
   chosen value. Main stays the sole authority.
6. **Resilience — fix `runWorker`.** Wrap the spawn in try/catch (sync throw) + add `proc.on('error')`
   (async) that resolves the worker promise with a sentinel non-zero code (guard with a `settled` flag
   vs a double-resolve with `close`) and surfaces ONE user line ("Couldn't start a processing worker —
   continuing with N; some documents were left in Review"). The failed shard's docs stay pending →
   visible in Review, never silently lost; the batch finishes via the existing `Promise.all` (`:2683`).
   Do NOT make `uncaughtExceptionMonitor` swallow (wrong layer).
7. **Determinism seam (Oracle WILL flag) — DECOUPLE the OMP cap from the RAM cap.** The import OMP thread
   cap (`:2669`) is `floor(cores/shards.length)`; fewer workers → fewer shards → HIGHER threadCap →
   OpenMP thread count changes → LSTM float-accumulation shifts boundary glyphs (`ACC-2291` vs
   `ACC-229]`, the owner's 2026-08-11 fight). Derive OMP from the **configured `processing_concurrency`**
   (reuse `_reprocessThreadCap` `:1945`), NOT live `shards.length`. Then dropping workers 10→8 for memory
   leaves OMP unchanged → no glyph flips (mildly under-threaded = "the safe direction", `:1941`). Bonus:
   retires the existing small-final-batch import-determinism residual noted at `:1944`.
8. **Also RAM-blind:** the detection pre-pass `_separateBatchDocuments` cap `sepP = min(cores, 6)`
   (`:2615`) — apply the same `ramCap` min (secondary, same-family).

## Test plan (hermetic, Electron-as-Node)
1. **Cap math** (extract the formula into a pure helper): (12c,16GB)→8, (12c,8GB)→3, (4c,32GB)→coreCap,
   (setting=10,16GB)→8. Pin the `max(3GiB,25%)` reserve.
2. **Spawn-failure survival:** stub `spawn` to emit `'error'`(EAGAIN) with no `close` → `runWorker`
   resolves a sentinel, `Promise.all` completes, `success===false`, and NO `uncaughtException` escapes
   (a `process.on('uncaughtException')` spy that must NOT fire).
3. **Sync-throw survival:** stub `spawn` to throw synchronously → same graceful resolve.
4. **Determinism invariant:** stub `spawn` to capture env; force `ramCap` below configured concurrency →
   assert every worker's `OMP_THREAD_LIMIT` == `_reprocessThreadCap(db)` (configured-derived), INDEPENDENT
   of shard count.
5. **Clamp transparency:** a `process-progress` line fires when `effective < setting`; `get-concurrency-info`
   returns `effectiveMax`/`ramCap`.

## Confirm before ship (incident is code-derived, not yet proven)
Get the friend's `%APPDATA%\ScanFinder\processing.log` tail + Windows Event Viewer → Application (an OOM /
`0xC0000005` naming `python.exe` or the app; and the diagnostic log's last `uncaughtException:` line at
`main.js:1313`) to CONFIRM the OOM path before shipping.

## Licences (all commercial-OK)
pypdfium2 — Apache-2.0 OR BSD-3 (bundled PDFium BSD-3); Pillow MIT-CMU/HPND; pytesseract + Tesseract 5 +
`eng.traineddata` Apache-2.0; NumPy BSD-3.

## Remaining gate
**Oracle** vets the seams (esp. the OMP-decouple and the hard-ceil-explicit-setting policy), then build
the smallest correct fix + the pins above (gary-style test strategy). The grayscale-pages lever (item 3)
is a SEPARATE accuracy-touching arc with its own census/gate — the count cap + resilience (items 1,5,6,7)
ship first and are pure throughput/robustness (no pixels, no confidence, no read changes by construction).
