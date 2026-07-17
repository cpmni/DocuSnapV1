# Single-doc reprocess parallelism — Option B + Option C

**Date:** 2026-07-17 · **Status:** DESIGNED (advisor panel oscar/eric/gary + Oracle). **Oracle: SIGN OFF
WITH CONDITIONS.** NOT built. Workflow `wf_96a8fc1b-076`.
**Goal:** cut a single-doc reprocess from ~10.3s (16-core dev) / **~12s (owner 6-core i5-9500T)** toward ~5s,
with the extraction output **byte-identical** so learning + auto-file are untouched.

## Why (measured, instrumented on a real 1-page Copperfield straighten reprocess)
A single reprocess makes **~35 Tesseract calls, all sequential, each 1-core-bound**, while every other core
sits idle. Breakdown of the ~8.5s OCR (whole reprocess ~10.3s):
- **Full-page OCR = 2 passes** (PSM-3 `tesseract.py:179` + PSM-6 supplementary `:186`, inside
  `reconstruct_page_text`), **3.5s**. Runs on **straighten / enhance / first-import only** — SKIPPED on a
  plain cached reprocess (`handler.js:1308-1324`).
- **Per-field crop reads = ~33** small `image_to_data` in the anchor loop (`anchor.py` ~334; `_crop_and_ocr`
  ladder ~2360), **4.8s**. Runs on **every** reprocess (plain AND straighten).
- Banner re-read 0.2s + ~1.7s non-OCR (spawn/render/deskew-detect).

Proven: one Tesseract LSTM (OEM 3) call is ~1-core-bound (OMP-uncapped == OMP=1, **1.00×**); a Python
`ThreadPoolExecutor` over `pytesseract` calls scales near-linearly (**3.5× @4, 6.0× @8**) because each call
shells out to `tesseract.exe` (a subprocess that releases the GIL).

## The two changes
- **Option B — parallelise the 2 full-page passes** inside `reconstruct_page_text` (2-worker pool), merge
  UNCHANGED. ~3.5s → ~1.75s. **Byte-identical by construction:** the merge is `data`(PSM-3) as the fixed base
  + `supp`(PSM-6) survivors APPENDED (`tesseract.py:182-196`); both futures joined before the merge; neither
  mutates the image; line grouping sorts stably by y-centre. Helps straighten/enhance/first-import only.
- **Option C — parallelise the per-field crop reads** across cores. ~4.8s → ~1s. Helps **every** reprocess.
  **Field-key GROUP model** (Oracle condition): all anchors for one `field_key` run **sequentially** in one
  task (preserving the `anchor.py:343` "first higher-priority anchor wins" short-circuit VERBATIM); different
  field-keys run in parallel and merge disjoint keys. **FORBID** the "gather-all-candidates-then-rank"
  flattening — it eagerly OCRs lower-priority same-field anchors the sequential loop skips (more memory
  pressure → higher fallback risk → the one silent-wrong path).

## Concurrency model (both)
A stdlib `concurrent.futures.ThreadPoolExecutor` **INSIDE the spawned `process_docs.py`** — NOT the Electron
`regionWorker` pool (that serves only the draw tool; it is the *precedent* proving parallel same-doc OCR is
byte-identical, not code to reuse). No new dependency (stdlib + already-bundled pytesseract/Pillow/pypdfium2).
- **OMP discipline:** on the ON path set `OMP_THREAD_LIMIT=1` (+`OMP_NUM_THREADS=1`) in-python before the pool
  and let the POOL supply cross-core parallelism (LSTM is 1-core-bound so OMP=1 costs zero throughput and is
  recognition-identical). Pool width `W = min(cores, 8, num_groups)`; if the parent already exported an OMP
  cap, take `min()` — **never raise** the batch cap. OFF path sets **no OMP env** (byte-identical to today).
- Pools are ephemeral `with` blocks, torn down per-stage. **B and C are sequential pipeline stages** (B in
  OCR/`read_page`, C in Stage-2 anchor) → their pools never live simultaneously; max concurrent
  `tesseract.exe` = `max(2, W)`, never `2+W` (Oracle: the "B×C oversubscription" fear is a false seam).

## Kill switches (staged, default OFF)
- `DS_OCR_PARALLEL_FULLPAGE` (B) — OFF ⇒ the two passes run sequentially = today's code, byte-identical.
- `DS_OCR_PARALLEL_FIELDS` (C) — OFF ⇒ the untouched sequential `for anchor in relevant` loop.
- `DS_OCR_POOL_WORKERS` — shared width override (1 = fully serial escape hatch / memory bound on the 6-core i5).
- **Flag passed ONLY by the single-reprocess spawn (`handler.js:1330`)** — NEVER by batch `runWorker` (~832)
  or the shard path (~1519), which already parallelise across docs with their own OMP cap.
- Both **force the sequential path** whenever trace/inspector/diag is active (`on_reject`/`slice_capture` set)
  so dev diagnostics + the corpus harness stay in the proven serial order.

## Build order
- **STAGE 1 = B** behind `DS_OCR_PARALLEL_FULLPAGE`. Small, one function, byte-identical merge. Prove the
  OMP=1 recognition-identity pre-gate + byte-identical `ocr_text` corpus A/B here (de-risks the in-python-pool
  + OMP-cap plumbing on the smallest surface). Owner-validate on the 6-core box → default ON (mirror the
  `OCR_WARM_WORKER` rollout: built OFF, owner-validated, then default-ON + Settings toggle).
- **STAGE 2 = C** behind `DS_OCR_PARALLEL_FIELDS`, only after Stage 1 is green:
  - **2a (refactor gate):** PURE move-only extract of the per-anchor body (`anchor.py:334-~1195`) into
    `_eval_field_group` with **ZERO logic edits** — a reviewable move-only diff. Land it with the OFF path
    calling it in the ORIGINAL sequential order and prove **OFF-corpus == baseline byte-identical BEFORE any
    threading**. Isolates the scheduling change to the ON path.
  - **2b:** add the field-key-GROUP pool + mandatory `line_cache` pre-seed (single-threaded, the one
    cross-field-shared key `id(page),0,0,1,1`; without it every group misses simultaneously and re-runs a ~2s
    full-page OCR = perf regression) + **per-task-exception → sequential re-run of that field-group** (turns
    an OOM/handle-contention degraded read into "slower but byte-identical", never a silently-learned wrong
    value) + trace-forces-sequential + OMP=1/min(parent).
  - **2c:** three pre-gates + per-doc byte-identical corpus A/B; owner-validate on the i5-9500T → default ON.

## Verification gate (control-test-first)
**Baseline captured BEFORE any code:** the current sequential timing (~10.3s dev / ~12s user) + the corpus
A/B reference (`stress_test/realdoc_regression.js`, M=1 #135 baseline) + a per-doc byte-identical reference.
Then, per stage:
- **Switch-OFF = byte-identical to baseline** (literal existing code path).
- **Switch-ON = only-intended-change:** per-doc BYTE-IDENTICAL corpus A/B — every doc's full-page `ocr_text`
  (B) AND every field's `raw_value`/`display_value`/`confidence`/`method`/`ocr_conf`/`validation_note` (C)
  identical to OFF. M=0/M_type=0/zero accuracy drop is **necessary but NOT sufficient** — a single differing
  doc is a determinism BUG, not a tuning trade-off.
- **THREE hard pre-gates (dev-box A/B is blind to memory pressure):**
  1. **OMP=1 recognition identity** — OMP=1 vs uncapped byte-identical on a crop + full-page battery (if even
     one glyph diverges, the pure-performance claim is void on that box).
  2. **Determinism-repeat** — ≥20 identical runs of the Copperfield-straighten doc + a competing
     multi-anchor-per-field doc.
  3. **6-core load test under induced memory pressure** — instrument the except-fallbacks (`:181` full-page
     `ocr_image` / `:2209` `return '',0,0` / `:2619` `return None`) and assert **ZERO** fire (this is the
     ONLY silent-wrong path, and the dev box won't reproduce it without pressure).

## The one silent-wrong path (and how it's closed)
Under 6-core memory pressure an except-fallback yields a *different/worse* read that can flip a field across
the 88 critical floor and be silently learned/auto-filed — and the dev-box A/B won't reproduce it (false
green). Closed by: **field-group model** (no eager same-field OCR → less memory), **per-task-exception →
sequential retry** (accept only the sequential result), and the **6-core load test asserting zero fallbacks**.

## C's five Oracle conditions (each PINNED by a test)
1. Atomic unit = field-key GROUP (sequential anchors within a key; parallel across keys). Pin
   `test_same_field_shortcircuit_preserved`: a lower-priority same-field anchor that would read a DIFFERENT
   value must NEVER be OCR'd and must NOT win.
2. Move-only `_eval_field_group` extraction, OFF==baseline byte-identical proven before threading.
3. Per-task-exception → sequential re-run belt (only the sequential result accepted).
4. Mandatory single-threaded `line_cache` pre-seed.
5. OMP=1 + `W=min(cores,8,num_groups)` + `min(parent cap)`; flag single-reprocess-only; trace forces sequential.

## Honest caveats
- **B does nothing for a plain cached reprocess** (full-page OCR is skipped there) — it helps
  straighten/enhance/first-import only. Do not oversell B's felt win. **C is the one that helps every reprocess.**
- Net target on the 6-core i5: ~12s → **~4-5s** (B ~1.75s of full-page + C ~1s of field reads + ~1.7s fixed).
- Licence-clean: stdlib threading + already-bundled OCR deps, all commercial-free.
