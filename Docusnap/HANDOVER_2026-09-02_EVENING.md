# HANDOVER — 2026-09-02 EVENING

Continued from `HANDOVER_2026-09-02_DAY.md` (the prior session set up the watch/import unification JOB).
This session did the ranked bug follow-ups, BUILT the unification (steps 1+2, byte-identical), and SET UP
the `watch_separate_enabled` soak flip gate. Branch `feat/teach-side-overnight`. **HEAD = origin =
`696b4bf`, tree clean, ALL PUSHED.**

## Commits this session (newest first, all pushed)
- `696b4bf` **test(watch): set up the `watch_separate_enabled` soak flip gate** — analyzer + protocol + pin.
- `898c70e` **refactor(watch): wire watch worker to `buildWorkerCommand`** — unification step 2 (byte-identical).
- `3953b8f` **refactor(processing): extract shared `buildWorkerCommand`** — unification step 1 (manual, byte-identical).
- `566ec1e` **fix(review): File-up-to-N retries** on a transient refusal instead of dead-ending.

## 1. The three bug follow-ups from the DAY handover — RESOLVED
- **#1 busy flag LEAK? → CLOSED, no bug.** Traced the whole `quietLane.js` `markScopeActive` on/off
  pairing: every `_run` `finally` branch clears the scope (`_finish` on the running-state fall-through;
  explicit clears on defer/queue; a `runShard` reject still routes through `_finish`), and
  `_currentBatchProcs`/`_singleReprocessActive` reset in `finally`/idempotent `finish()`. `_anyProcessingBusy`
  and `_quietLaneActiveScopes` cannot stick. The incident was genuinely TRANSIENT; `ddb7b53`'s copy fix was
  the right resolution.
- **#2 the offer invites a file it will refuse → FIXED `566ec1e`** (renderer-only). The File-up-to-N accept
  now RETRIES in place up to 5×1.2s on a transient refusal (`busy`/`quiet-lane-active`/`not-ready`) before
  the honest message — each accept is a cheap server-guarded no-op until the scope is idle, so one click
  files even mid re-read. Hard refusals (license/unknown-type) break out immediately; a dismissed/superseded
  bar abandons quietly.
- **#3 hidden split-filing failure? → CONFIRMED none.** A watch-split segment is a normal held
  `needs_review` doc; `_sweepAcceptCore` per-doc drops return `ok:true` — the owner's whole-batch `ok:false`
  was the early busy gate, not a per-doc `confirm-failed` drop.

## 2. Watch/import UNIFICATION — steps 1+2 BUILT (byte-identical), step c + M=0 owner-gated
The load-bearing fact (Oracle): a worker's reads are fully determined by its `{scriptArgs, env}`, so
command-equality = reading parity. Built to Oracle §6:
- **Step 1 `3953b8f`:** extracted the PURE `processing.buildWorkerCommand(db, opts) → {scriptArgs, env}`
  (handler.js, module-level, exported) and wired the MANUAL import worker to it. Slice-dir mkdir stays in
  the caller (builder is pure). BYTE-IDENTICAL (Layer A self-equality + the unchanged
  `test_import_concurrency_cap.js` source pins). Landed the **BLOCKING deskew seam (§4):** the builder never
  emits `--deskew-pages` for `arrival:'watch'` at ANY `deskew_on_import` value.
- **Step 2 `898c70e`:** wired `watch/handler.js` to `buildWorkerCommand({arrival:'watch', threadCap:
  _reprocessThreadCap(db), filesFile:null, wantTrace:false})`. Byte-identical — `_reprocessThreadCap`>=1
  always (`max(1,floor(cores/conc))`), so there is no threadCap==0 edge where the builder would leave OMP
  unset; the emitted env matches the old `String(_reprocessThreadCap(db))` exactly. Lifecycle UNCHANGED
  (`_liveProcs` tracking never co-mingled with `_currentBatchProcs`; spawn-fail leave-for-next-poll; the
  split-hold `autoFileRun=false` guard).
- **Parity gate `stress_test/import_watch_parity.js` — ALL GREEN:** §A Layer A command equality · §A2 OMP
  carried identically given equal threadCap · §B NEGATIVE CONTROL (a seeded env divergence MUST fail the
  gate) · §C deskew seam across all floors · §D trace/slice-dir contract · **§E call-site pin: scriptArgs
  equal except --folder, and the ONE remaining env divergence is `OMP_THREAD_LIMIT` at concurrency==1**
  (manual unset vs watch set) = exactly what the deferred step c closes.

**DEFERRED — owner-gated (do NOT land autonomously; need the real corpus DB / change live watch reads):**
- **(c) the OMP conc==1 convergence** — change watch's caller to pass `requestedConcurrency<=1 ? 0 :
  _reprocessThreadCap` (or move that rule into `buildWorkerCommand` for "one home"), landing WITH a
  **watch-conc==1 realdoc M=0 arm** (it changes live watch reads — Tesseract LSTM thread nondeterminism).
  When it lands, §E flips to "env equal EXACTLY".
- **The realdoc M=0 on the WATCH path** (§6b) vs the manual reference on the real corpus DB, BEFORE a
  build/rollout — the code is byte-identical but the unattended auto-filing path deserves the empirical
  confirm. Harness `TESTING/_measure/reslice_20260830/_run_docs.js`, `RR_APP_ENV=1`, `OCR_RENDER_DPI=200`,
  dedup `RR_IDS`. Not runnable here (this machine has a reset test DB, not the owner's learned Castellan DB).
- `runTrackedWorker` lifecycle extraction (Oracle's second shared unit) — needs row-equality; deferred.

## 3. `watch_separate_enabled` soak flip gate — SET UP `696b4bf`
The higher-value watch/manual parity win Oracle flagged: a bundled multi-doc PDF splits on manual import but
imports WHOLE on watch until this flips (built DARK `29adce2`). The build already HOLDS fresh split segments
(`autoFileRun=false`); the UNMEASURED risk is empirical wrong-boundary auto-file on the unattended path.
- **`stress_test/watch_separate_soak.js`** — SOAK ANALYZER. Mines `processing.log` after a live soak →
  **PASS** (≥1 separation, 0 re-import loops, 0 errors, 0 non-zero exits, 0 orphaned split-originals) /
  **FAIL** / **INCONCLUSIVE**. Detects the re-import loop (segment re-accepted / recurring re-track) +
  separation errors; `--watch-folder <dir>` cross-checks `.sf_separated_originals/`. Proven both directions
  on synthetic logs; runs clean on the live log (INCONCLUSIVE — flag OFF).
- **`src/modules/watch/test_watch_separation.js`** — extended to 17 pure checks (re-import guard + no-loss
  accounting + held-set = produced segments + no name collision). ALL PASS.
- **`docs/designs/WATCH_SEPARATE_SOAK_GATE_2026-09-02.md`** — the authoritative protocol: what's already
  unit-guaranteed, the 6 empirical risk axes, pre-check → arm ON in a SANDBOX watch folder → feed known
  bundles (Demo Docs Print Tracker) + genuine single docs (over-split control) → run the analyzer → HUMAN
  boundary + held-review check (the part no tool does) → flip. PASS criteria + rollback.
- Queued in `NIGHT_RUN.md` + `pendingfeatures.md`.
- **REMAINING = the owner runs the soak** (owner-machine, sandbox only; needs real bundled scans + the SFDEV
  toggle). Flip = `watch_separate_enabled='true'` default, approval-class; SFDEV kill-switch stays. Dominant
  failure mode to watch = OVER-split of a genuine multi-page single doc.

## Test status (this session)
- `test_watch_separation.js` — **17/17 ALL PASS**.
- `stress_test/import_watch_parity.js` — **ALL PASS** (§A–§E).
- `test_import_concurrency_cap.js` — all pins pass (proves the manual refactor byte-identical).

## Other OPEN items (carried — unchanged this session)
- **NEW EXHIBIT** `HANDOVER_2026-09-02_DAY.md` "anchor-wins-over-corroboration" — a drifted taught
  `anchor_crop` (`make` → Model row) beat ≥2 agreeing witnesses by authority precedence. Logged in
  `pendingfeatures.md` (2026-09-02). DARK + census before any flip; gary/reggie/007 → Oracle.
- **Security release gate** (`docs/SECURITY_REVIEW_2026-09-01.md`): C-1 code-sign the installer · R1
  plaintext-DB disclosure (opt-in encryption + BitLocker posture) · R2 honest binned-doc copy · D-1
  node-forge→^1.4.0.
- **Chris cards** (`docs/CHRIS_FULL_APP_REVIEW_2026-09-01_NIGHT.md`, YES): #1 letterhead-match teach guard.
- **Quick Reprocess flip gate** (`docs/QUICK_REPROCESS_GATE_2026-09-01.md`, DARK) — 5-arm gate on the real DB.

## FIRST ACTIONS for the next session
1. Read this handover. `git log --oneline -6` — expect HEAD=origin=`696b4bf`, clean tree.
2. **Owner decisions ready (approval-class):** (a) run the `watch_separate_enabled` SOAK (protocol +
   analyzer are set up — the higher-value parity win); (b) the unification's owner-gated tail — the WATCH
   realdoc M=0 + the OMP conc==1 convergence commit (needs the real Castellan DB).
3. Unrelated build work continues from `pendingfeatures.md` / `NIGHT_RUN.md` as normal.
