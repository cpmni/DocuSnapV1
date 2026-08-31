# PLAN — make the draw-a-box OCR feel instant (Review draw + ⊕ teach)

**Date:** 2026-07-16 · **Status:** advisor-panel + Oracle SIGN-OFF-WITH-CONDITIONS · **Slices 0+1 COMMITTED
(`81a967d`); Slice 2 (pool + caption-parallelise) COMMITTED (`504884e`) + **OWNER-VALIDATED live: ~4.6× draw
speedup (2s → ~0.45s; measured warm read 223ms vs cold 687ms)** → flipped **DEFAULT ON** + Settings→Processing
toggle + a smooth overlay fade; Slice 3 held.**

> **Live measurement (owner machine, warm-vs-cold):** cold `region.py --boxes` spawn ~687ms/read; **warm
> worker read ~223ms/read (3.1× faster)** — a fresh spawn pays interpreter+import+a COLD tesseract call
> (~357ms); a warm worker pays none of that and its repeated tesseract calls hit the warm ~107ms floor. This
> **corrects the pre-build estimate** that the Python pool was "only half the lever" — it is the whole lever;
> `tesserocr` is now LOW priority (little left to shave). Field draw: ~2060ms cold → **~447ms** warm+caption-
> parallel → ~223ms with the (deferred) full 3-way parallelise. Owner turned it on default after validating;
> `idle-kill` (3 min) + crash-fallback bound the soak risk; `ocr_warm_worker_enabled` toggle + env
> `OCR_WARM_WORKER=1/0` override.

**BUILT 2026-07-16 (Slice 2):** NEW `python_backend/ocr/region_worker.py` (long-lived worker: imports
region_core once, newline-JSON over stdio, STATELESS per request) · NEW `src/modules/processing/regionWorker.js`
(pool manager: least-busy dispatch, per-request timeout, crash→reject→handler-cold-fallback, backoff [3
deaths/60s → disable], idle-kill, shutdown on before-quit) · `processing/handler.js` routes ocr-region(-boxes)
through the pool when enabled (env `OCR_WARM_WORKER=1` or setting `ocr_warm_worker_enabled`, **default OFF**),
single tmpfile write+unlink, cold-spawn fallback on any failure · `review/renderer.js` `captureAnchorContext`
now reads the LEFT + ABOVE captions CONCURRENTLY (`Promise.all`, byte-identical results — 2b). **Verified:**
`test_region_worker.py` (warm==cold byte-identical + statelessness/no-cache pin + error-safe) green;
`test_region_worker.js` (dispatch/parallel/kill-switch/crash-reject) green; region regressions green; all JS
`node -c` clean. **Deferred:** full value+caption 3-way parallelise (captureAnchorContext restructure);
`tesserocr` (removes the ~300ms/read model reload); Slice 3 async UX (held). **Needs the owner:** turn on
`OCR_WARM_WORKER=1`, draw a few fields to confirm the felt speedup + that anchor capture still stages, then a
long-soak (memory / orphaned tesseract) before flipping default-on.
**Panel:** eric (renderer/IPC) · oscar (OCR recipe) · 007 (pipeline arch) · gary (Python perf) · reggie
(format feedback) · bob (product) → synthesis → Oracle. Workflow: `wf_bb25f2d5-4f3`.

**BUILT 2026-07-16 (Slices 0+1, uncommitted):** NEW `python_backend/ocr/region_core.py` (pure, importable OCR
— the byte-identical function the CLI and the future warm worker share; holds the moved `_strip_horizontal_rules`
/ `_looks_unreadable_sliver` + `_ink_band_count` + `process()`). `python_backend/ocr/region.py` refactored to a
thin CLI wrapper that calls `region_core.process` + re-exports the helpers (tests unchanged) + `DS_OCR_TIMING`
(stderr, default off → byte-identical). Slice 1 band-gate (`DS_OCR_SINGLELINE_FAST`, default on) skips the PSM-6
pass on a single-line PLAIN crop only. **Verified:** `test_region_light_first` / `test_region_sliver` /
`test_strip_rules` green; Slice-1 A/B byte-identical across single/multi-line × plain/boxes; timing measured
(see Root cause). No behaviour change on any real path (default switches keep it byte-identical).

## The problem
Drawing a box around a field value (the field tool + the ⊕ teach) greys the whole preview, waits ~2s, then
populates — you can't start the next box until it returns. Stop-start across many fields.

## Root cause — MEASURED (Slice 0 ran 2026-07-16, DS_OCR_TIMING on the target machine)
Per single `region.py` spawn (median of 4): **plain ~573ms**, **--boxes ~687ms**, split:
- Python interpreter launch + `tesseract.exe` spawn overhead ≈ **90–98ms**
- pytesseract/PIL **import ≈ 113–117ms** (this is ALL the warm worker removes)
- OCR: **ladder (1 tesseract call) ≈ 357ms** + (boxes path) **PSM-6 (2nd call) ≈ 117ms** — dominated by the
  ~300ms Tesseract **model reload per call**.

**The felt ~2s = THREE of these spawns run SEQUENTIALLY per draw** (value + left-strip + above-strip captions,
all `--boxes` at ~687ms). 3 × ~600–690ms ≈ ~1.8–2.0s. ✓ matches the symptom.

**What this means for the levers (honest, measured):**
- **Parallelising the 3 reads is the big win** (~1.8s → ~0.7s, one read's wall-clock) — byte-identical, keeps
  the overlay, no async races. THE lever.
- **Warm worker removes only the ~115ms import/read** (~20% of a read) — modest; a warm *Python* worker still
  pays the ~470ms of `tesseract.exe` runs (pytesseract shells out each call).
- **`tesserocr` (in-process, model stays loaded) removes the ~300ms model reload per call** — the biggest
  *per-read* cut (~600ms → ~150ms), but the native-dep/packaging cost.
- **Slice 1's band-gate saves the ~117ms PSM-6 only on the PLAIN path — which is the rarely-hit fallback (the
  primary path is `--boxes`, which needs PSM-6). So its real-world win is small; it ships because it's a clean
  byte-identical cut, not because it moves the needle.**

Original inference (kept for the record):
Fixed **per-call process startup paid on every draw**, not OCR compute:
- **Cold Python spawn per draw** — `ocr-region-boxes` (`processing/handler.js:1568`) spawns a *fresh* `region.py`
  each call. 007 found a single field draw fires **up to 3 spawns** (value + left-strip + above-strip caption
  reads). Each = interpreter start + imports (~0.6–1.2s) **+ 2–6 `tesseract.exe` cold-starts** (model reload).
- **Full-screen blocking grey** (`#ocr-overlay`, `renderer.js:2633/3288`) that also eats pointer events — so
  it's silently doing **three** jobs: "busy" visual, an input-lock, and a de-facto Confirm-lock.

**Oracle's sharpening (load-bearing):** a warm Python worker removes only the **import** cost (~1s once), NOT
the per-call `tesseract.exe` model reloads. So the warm worker is **half the lever, not the whole lever** —
which is exactly why Slice 0 measures first, and why `tesserocr` may leapfrog it if tesseract-spawn dominates.

## Approach
**Warm the process first (pure latency, zero new risk); add async UX only if still stop-start.** Optimistic
instant-value is **rejected** — for a *read* there's no trustworthy guess (the OCR *is* the answer), so any
placeholder is a fabrication the operator might Confirm.

**Multi-core refinement (owner-requested, folded in 2026-07-16): a POOL of warm workers, not a single one.**
Because one field draw fires **3 independent reads** (value + left-strip + above-strip captions), a small pool
(2–4 workers, one per spare core) with round-robin/least-busy dispatch lets those 3 reads run **in parallel** →
one draw ≈ *one* read's wall-clock instead of three, and consecutive draws overlap without a CPU spike. Crucially
this keeps the **blocking overlay** — it's a pure speedup with byte-identical reads and **no new race surface**,
so it does NOT need the async-UI ship-blockers (SEAM 1/2). This makes the pool a *safer* path to "feels instant"
than the async UX. Honest ceiling: a warm *Python* worker still shells a fresh `tesseract.exe` per read (model
reload ~1s); the pool parallelises that across cores, but only `tesserocr` (in-process, model stays loaded)
removes the per-read reload — so the pool gives parallelism, `tesserocr` gives per-read speed. Slice 0's numbers
decide how far the pool alone gets us.

## Staged slices (smallest-safe-first)

**Slice 0 — Measure + `region_core` refactor** (ship first, zero user-visible change). Env-gated timing split
(`DS_OCR_TIMING`) in `region.py` — attribute the 2s (import vs tesseract-spawn) on the real machine. Extract
the image→result logic into a pure `region_core.process(...)` so warm and cold paths call the identical
function (byte-identical by construction). **Gate: if import-cost <30% of the 2s, re-open `tesserocr` before
building the warm worker.** Existing region tests stay green.

**Slice 1 — Band-gate the redundant PSM-6 pass** (byte-identical, kill `DS_OCR_SINGLELINE_FAST`). `region.py`
runs a PSM-6 `image_to_data` multi-line pass *unconditionally*. Gate it on a cheap NumPy ink-band count (≤1
band → skip). Multi-line address values must still classify ≥2 bands and keep PSM-6.
**⚠ SCOPE CORRECTION (found in the region.py read, 2026-07-16):** the saving is smaller than first framed. The
PRIMARY read path is `--boxes` (ocrRegionBoxes is called first; renderer.js:2656), and it NEEDS the PSM-6
`image_to_data` to produce the taught-label WORD BOXES — so PSM-6 cannot be skipped there byte-identically. On
a single-line crop the PSM-6 pass never changes `text` (the multi-line rebuild only fires at `len(seg)>=2`), so
the **provably byte-identical** skip is the **plain-text path** (ocrRegion, the fallback) only. The bigger
`--boxes`-path win (word boxes from a single PSM-7 `image_to_data` instead of ladder-string + PSM-6-data = two
tesseract runs → one) is NOT byte-identical (different PSM, reconstructed text) and is therefore **deferred to a
measured, A/B-gated step**, not this byte-identical slice. Net: build the safe plain-path skip; let Slice 0's
numbers say whether the two-tesseract-runs-per-read cost justifies the riskier boxes-path merge or going
straight to the warm pool.

**Slice 2 — Warm OCR worker POOL + parallelise the 3 reads per draw** (the structural lever). A POOL of 2–4
long-lived workers (`ocr/region_worker.py`, importing `region_core` once, **stateless per request**, newline-JSON
over stdio), one per spare core. Node singleton `processing/regionWorker.js`: lazy-spawn the pool, `Map<id,
resolve>`, **round-robin/least-busy dispatch** so the 3 reads of one draw land on different workers and run in
parallel (one draw ≈ one read). This **subsumes** the old single-worker 2-lane-queue idea (Oracle SEAM 3) — with
a pool there's no head-of-line because the value read grabs a free worker immediately. Per-worker: idle-kill +
max-requests recycle, kill on Review `closed` / `before-quit` (tree-kill). **Fail-safe:** on a worker
death/timeout, reject in-flight **inside the manager** and fall back to the existing per-draw spawn (kept
verbatim) — the renderer only ever sees a normal (slower) result, never fail-toward-empty (Oracle); ≥3 deaths in
60s → disable the pool for the session. **Tmpfile lifecycle (Oracle):** no per-request `close` event now —
unlink on **response receipt** (id→tmpfile), sweep orphans on worker death, no double-unlink. IPC contract
(`ocrRegionBoxes`/`ocrRegion`) unchanged → no contextBridge/contextIsolation change. Also parallelise the 3
reads in the renderer (`Promise.all` the value + two caption reads — they're independent, combined after) — with
a warm pool this is the big felt win and it KEEPS the blocking overlay, so **no async races**. Pool size =
`min(4, cores-2)`, kill switch `OCR_WARM_WORKER` / setting `ocr_warm_worker_enabled`, **default OFF for first
ship**, flip on after the benchmark + long-soak (the `LOGO_DETAIL_PRIMARY` flip pattern).

**Slice 3 — Non-blocking async UX** (only if Slice 2 didn't already win; renderer-only; kill `ASYNC_DRAW_READ`,
default off). Replace the full-screen overlay in `runZoneOcr`/`runAnchorDraw` with a **per-field inline
spinner** (`pointer-events:none`) so the operator draws the next box immediately; populate from the value read
and background the two caption strip reads. **The overlay's three implicit jobs must be re-added explicitly —
these are the guards:**
- **Out-of-order / doc-nav (Oracle SEAM 1 — SHIP-BLOCKER):** the generation token must be **doc/selection-scoped,
  not per-field**. Draw on doc A → switch to doc B before the read lands → a per-field-only counter still
  applies A's value/anchor to B (silent wrong value + cross-contaminated authoritative anchor). Bump a global
  selection-generation in `selectDoc`; drop ANY read (value or caption) whose captured generation ≠ current.
- **Confirm-guard (fail-toward-review):** `validateConfirm` treats an in-flight field as **not satisfied**
  (disable/queue Confirm); a spinning field is never counted as blank-and-fine.
- **Learning-safety (Oracle SEAM 2 — SHIP-BLOCKER):** `confirmCurrentDoc` must **await the in-flight
  caption-capture promise** (not just the value read) BEFORE reading `pendingAnchors` (`renderer.js:3452`),
  then re-check the selection-generation — else a ⊕ teach drawn-and-filled but not-yet-staged is silently
  lost, or an awaited capture from a since-changed frame/doc contaminates.
- **Focus (new race):** post-read focus must be **caret-preserving** — `input.focus()` only if that field is
  still the active target; else `ensureWindowFocus()` alone (a late read must not yank the caret).
- **Frame-drop (Oracle SEAM 4):** Straighten-toggle / page-nav become reachable mid-capture → the
  `_deskewFixPending` guard drops teaches more often. Disable frame-changing controls while a taught-field
  capture is in-flight, or measure + accept the drop-rate (don't let it masquerade as "working").
- **⊕ ordering:** keep `runAnchorDraw` gated on its own value read resolving.

**Slice 3b — reggie's precision gate** (bundle with 3, cheap). Condition the note-dismissal + `corrected`
marking on `fieldValidationError(...) === null`, so a fast-but-wrong read never silently clears a flag the
operator hasn't seen. (Oracle: the value is mild — SEAM 1 already drops stale reads whole — ship it, but don't
frame it as "safe only because the overlay blocks.")

**Deferred:** `tesserocr` (MIT + leptonica) in-process libtesseract — the ONLY thing that removes the per-call
`tesseract.exe` cold-start (sub-100ms reads). New native dep + ABI bundling risk → own kill switch,
byte-identical A/B, last. **But if Slice 0 shows tesseract-spawn dominance it jumps AHEAD of Slice 2** — its
position is measurement-decided, not fixed.

## Verification gate (per slice)
- **0:** timing split on target machine; region fixtures green over `region_core`.
- **1:** single-line crops byte-identical + a PSM-6-not-invoked spy pin; multi-line fixture unchanged.
- **2:** `worker_response == region_core.process(...)` byte-identical across ALL fixtures; a **statelessness /
  no-cache-last-read pin** (the whole safety story — corpus M=0 is **N/A**, this path touches no
  extraction/auto-file decision); `warm ≤ cold` p95 latency regression guard; **manual long-soak** (memory +
  orphaned `tesseract.exe`) before default-on.
- **3:** a **doc-navigation test** (draw on A, switch to B before the read lands → B untouched, no anchor
  staged — pins SEAM 1); a **caption-in-flight-at-Confirm** test (value populated, anchor not yet staged —
  pins SEAM 2); a late-read-focus test.
- **3b:** failing-pattern read keeps warning + flag; passing read clears as today.

## Oracle verdict
**SIGN OFF WITH CONDITIONS.** Sequencing (measure → free cut → warm worker → guarded async) and the
rejection of optimistic-value are correct. Ship-blockers for Slice 3: **SEAM 1** (doc/selection-scoped
generation token) and **SEAM 2** (confirm awaits the caption-capture promise). Also required: SEAM 3 (2-lane
queue), tmpfile-lifecycle respec, worker-death fallback transparent in main. Fork ruling: **warm worker before
async** — because async-alone leaves each read at the full ~2s (values dribble in, or concurrent cold spawns
spike CPU); "async needs the warm worker to be good," not "async is riskier."

## Open decisions for the owner
1. **Order:** warm worker (Slice 2) first [recommended] vs the renderer-async slice first (smaller, highest
   *felt* gain, zero accuracy/packaging risk, but adds race surface up front). Both safe with their guards.
2. **Who signs off flipping the warm worker default-on** after the benchmark + long-soak.
3. **Is Slice 3 needed at all?** Decide only after re-measuring post-Slice-2 on a real multi-field doc / slow
   machine — the warm worker may dissolve the complaint.
4. **`tesserocr` adoption** — worth the native-dep + leptonica-bundling cost only if Slice 0 shows the
   `tesseract.exe` cold-start dominates. Owner call on packaging risk vs the sub-100ms payoff.
5. **Caption-read UX under async** — surface a "learning this field" spinner, or keep it invisible until Confirm?

**Bottom line:** Slice 0 (measure + refactor) de-risks everything and is independently shippable today; Slice 1
is a free byte-identical cut; Slice 2 is the real (half-)lever with zero accuracy/learning risk; Slice 3 (+3b)
is the fluidity finisher — take it only if measurement says the warm worker didn't already win, and never
without the doc-scoped generation token + the confirm-time caption-await.
