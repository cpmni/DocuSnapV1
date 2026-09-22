# HANDOVER — 2026-09-02 DAY → next session's JOB = build the WATCH/IMPORT UNIFICATION

Branch `feat/teach-side-overnight`. This session (a) fixed the watch large-scan failure + shipped a live
watch-status UX, and (b) ran the full design consult for the owner's directive: **"unify watch + manual
import so field detection is identical regardless of arrival path."** The consult is DONE and Oracle-gated.
**The next session BUILDS it to the spec below.**

## THE JOB — watch/import unification (Oracle SIGN-OFF-WITH-CONDITIONS, 2026-09-02)
Owner directive: "I want the processing path to be the same and obtain exactly the same results — it
wouldn't matter if a doc was watch or manual." Consult: eric + gary designs → Oracle adjudication (full
transcripts summarised here; Oracle verdict is BINDING).

**Load-bearing FACT (Oracle-traced, this is why parity is provable):** `ExtractionEngine.extract()` resets
every per-run ledger at the top of each call (`engine.py:7379-7411`) and the DB-snapshot indexes are set
ONCE before the file loop, never mutated inside `extract()`. So **field detection is per-file INDEPENDENT**
— file ordering, shard partition, and `--folder`-vs-`--files-file` enumeration do NOT change reads. Reading
is fully determined by the per-worker `{scriptArgs, env}`. Both paths already share `buildTrainingArgs`, the
four env blocks (`_autoTitleEnv/_ocrDpiEnv/_anchorCropEnv/_reconcileEnv`), the `--mode` coercion, the
`handleFileMessage` DB writer, and the `separateFiles` detector. So this is **de-duplication, not a rewrite
— the paths are ~95% reading-identical today.**

### Oracle's BINDING conditions (build to these exactly; deviation → back to Oracle)
1. **LAYER = eric's two shared units. REJECT gary's batch-level `runImportBatch` merge.** Share:
   - **`buildWorkerCommand(db, opts) → {scriptArgs, env}` (PURE)** — the parity guarantee. Shared-by-
     construction: `--tesseract`, `--mode`, `...trainingArgs`, env = `process.env` + OMP(param) + the four
     env blocks. PARAMS each caller passes: `pyFolder` (`--folder`; import=folderPath, watch=tmpDir),
     `filesFile` (import=shard/null, watch=null), `mode`, `threadCap`, `wantTrace`, `trainingArgs`,
     `arrival` ('manual'|'watch').
   - **`runTrackedWorker(spawnFn, opts) → Promise<code|SPAWN_FAILED>`** — the lifecycle: line-buffered
     stdout parse, `procTracker` add/remove, idempotent `settled` spawn-fail guard, `onClose`.
   - **Keep each caller's THIN batch loop** (import = one-shot/renderer-driven + `failedShards` re-drive +
     "Using N workers" UX; watch = poll-driven/staged/headless — these legitimately differ, DO NOT merge).
2. **ONE home for the threadCap decision inside `buildWorkerCommand`, using IMPORT's exact rule:**
   `requestedConcurrency <= 1 ? 0 : _reprocessThreadCap(db)`. Watch adopts it → at concurrency==1 watch is
   ALSO unset (today watch caps to `cores`) → env BIT-IDENTICAL across paths for every setting. **No
   OpenMP measurement needed** (sidesteps eric's open "does OMP=cores==unset" question — we make it unset).
   Converge WATCH→import; **never touch the manual reads** (the confirmed corpus/GT was filed under manual;
   capping manual = M-risk). At default settings on cores≥6, `_reprocessThreadCap`=`floor(cores/(cores-2))`=1,
   so both already run single-thread — this fix only matters for an explicit-1-worker user.
3. **`runTrackedWorker` takes `procTracker` as an opt** — manual passes `_currentBatchProcs`, watch passes
   `_liveProcs`; NEVER a shared global (Oracle's standing "never co-mingle" — a manual Stop / `killAll` /
   the three `_currentBatchProcs=[]` resets must never touch live watch procs). **Spawn-fail stays SPLIT:**
   the wrapper only surfaces the SPAWN_FAILED outcome; the `failedShards` sequential re-drive stays in the
   MANUAL caller, watch keeps leave-for-next-poll. Do NOT centralize re-drive.
4. **SEAM CONDITION (BLOCKING — both advisors missed this): `--deskew-pages` stays ARRIVAL-SCOPED and OFF
   for watch.** `buildWorkerCommand` must NOT emit `--deskew-pages` for the watch arrival even when
   `deskew_on_import` is set. WHY: deriving it from the setting means the day the owner ever flips
   `deskew_on_import`, the unified command silently propagates a coordinate-frame change onto the
   UNATTENDED, AUTO-FILING watch path = fail-toward-silent-wrong-file — strictly worse than the fenced-off
   import case. The correct posture here is ANTI-parity. PIN: `buildWorkerCommand(db,{arrival:'watch'})
   .scriptArgs` never contains `--deskew-pages` for ANY setting value. (Deskew-on-watch, if ever wanted, is
   its own owner-gated DARK arc.)
5. **THE GATE** (`stress_test/import_watch_parity.js` + pins):
   - **Layer A (load-bearing)** — `buildWorkerCommand(manual)` vs `(watch)`: scriptArgs equal EXCEPT
     `--folder`; env equal EXACTLY (incl. OMP now). Plus a **NEGATIVE CONTROL**: seed one deliberate env
     divergence, assert Layer A FAILS (a green that can't reproduce drift is worse than none).
   - **Layer B** — behavioural row-equality with `OMP_THREAD_LIMIT=1` PINNED (legitimate, not a cover-up:
     Layer A already guarantees both ship the same OMP in production, so OMP>1 noise is inherent-and-equal;
     Layer B pins OMP=1 only to make the row diff deterministic). Diff the `file_done` contract tuple:
     `document_type / supplier_name / overall_confidence / needs_review` + per field `{field_key, value,
     confidence, extraction_method}`.
   - **Split-hold arm** — same rows, but watch HOLDS the fresh split segment (`autoFileRun=false`) while
     manual auto-files. Pins the INTENTIONAL divergence so a future dev can't "restore parity."
   - **MISSING ARM Oracle added — realdoc M=0 on the WATCH path at concurrency==1** (watch-after ==
     the manual reference). The manual M=0 proves nothing about the ONE behaviour that changes (watch
     losing its OMP cap at conc==1); Layer B (OMP=1) can't exercise it either. This is the tripwire for #2.
   - A guard that the refactor did NOT alter either separation call site (import still `auto_separate`,
     watch still `watch_separate`).
6. **MIGRATION ORDER (parameterise-then-delegate; manual is the byte-identical reference):**
   (a) extract the two units, wire the **MANUAL** caller first, prove byte-identical (Layer A self-equality
       pre/post + manual realdoc **M=0**). (b) wire **WATCH** (passing `_liveProcs`), prove byte-identical +
       the full parity gate. (c) land the OMP conc==1 convergence as its **OWN commit** carrying the
       watch-conc==1 M=0 arm. Do NOT force `OMP_THREAD_LIMIT=1` globally (changes the manual reference).

### What this arc does NOT deliver — TELL THE OWNER
- **The real "watch vs manual" divergence a user WILL hit is SEPARATION, not OMP.** Manual runs
  `auto_separate_enabled` (default **ON**); watch runs `watch_separate_enabled` (default **OFF**). A bundled
  multi-doc PDF → manual splits + per-segment detection; watch imports it as ONE = genuinely different field
  detection by arrival path TODAY. This refactor does NOT touch it — it's the DARK `watch_separate_enabled`
  soak arc (built `29adce2`, needs a live soak before flip). **The owner's "it wouldn't matter if watch or
  manual" is FALSE for bundled PDFs until that flips.** Flipping it is the higher-value parity win.
- **True bitwise-identical same-doc reads** need `OMP_THREAD_LIMIT=1` everywhere — inherent OCR reality
  (Tesseract OMP>1 LSTM float non-determinism, equal on both paths). Off the table (M-risk on manual).
  Optional `deterministic_reads` setting (OMP=1, default OFF, throughput cost) if ever wanted.

## PHASE 2 (folded into this arc) — a real ETA for the live watch status
Phase 1 (elapsed + pages + step) SHIPPED this session (`85ca2db`, renderer only). Phase 2 = emit per-page
OCR progress from the SHARED `extract_text_and_images` (tesseract.py:936; used by watch+manual+reprocess)
via an OPTIONAL `progress_cb(page, total)` (default None = no-op = byte-identical), surface it as "page 12
of 34 · ~2m left." It touches the core OCR function the parity gate must keep byte-identical, so build it
WITH the unification (the no-op callback must not perturb Layer B).

## This session's SHIPPED fixes (ALL PUSHED — branch synced with origin at `ddb7b53`)
- `bac4e90` **watch/import per-file timeout scales with page count** (in the built installer). The 34-page
  scan that dead-lettered to Errors was hitting the flat 300s; now base + 20s/page (1-page byte-identical).
  Verified on the real doc (completes, no timeout). Pin `test_file_timeout_pagescale.py`.
- `85ca2db` **live watch import status** (renderer only) — the bottom message no longer looks stagnant:
  elapsed + page count + friendly step, ticking every second.
- `ddb7b53` **File-up-to-N honest "still finishing" message** (renderer only) — see the NEW BUG section.
- Installer built: `dist\ScanFinder Setup 2.0.0-r20260902-1023-bac4e90.exe` (370 MB, **UNSIGNED** —
  confirmed at the file; SmartScreen). Contains the timeout fix ONLY; the two renderer fixes (`85ca2db`,
  `ddb7b53`) need a REBUILD to reach an install.

## NEW BUG to investigate (owner-reported 2026-09-02, screenshot) — "Couldn't file those documents"
Owner hit **Reprocess all** on the Demo Docs WATCH instance (27 Print Tracker `4_split_pN.pdf` = watch-
separated docs); nothing auto-filed (EXPECTED — freshly-split segments are held, `autoFileRun=false`), the
consent bar offered **"File up to 11 … already read cleanly"**, and clicking it showed **"Couldn't file
those documents — please try again."** Evidence: `Desktop\Demo Docs\docusnap.db` + `processing.log`.
**Root cause (diagnosed):** `sweep-scope-accept` (`handler.js:4028-4044`) returns a WHOLE-BATCH `{ok:false}`
only from its early gates; with scope-sweep ON + licensed + valid args the live reasons are **`busy`**
(`_anyProcessingBusy()`, :4037) or **`quiet-lane-active`** (:4043). The log CONFIRMS quiet re-reads were
still in flight (`Reprocess done: 4_split_p11.pdf`, `quiet-reprocess stderr` at 10:52) when File-All was
pressed. The renderer's `catch{}` threw the reason away and showed a generic scare for a TRANSIENT state.
**FIXED (this session, safe): `da…`→ the accept toast now says WHY** — a transient `busy`/`quiet-lane-active`/
`not-ready` refusal reads "Scan Finder is still finishing reading your documents — give it a moment, then
try again" and logs the reason (`review/renderer.js` ~7521). Retrying once processing settles files them.
**STILL FOR THE NEW SESSION (deeper):**
1. **Is it TRANSIENT or a LEAKED/STUCK busy flag?** If `_reprocessStatus.running` / `_currentBatchProcs`
   didn't clear after the batch (interrupted doc, unresolved shard), `_anyProcessingBusy()` stays true and
   the owner can NEVER file → a real bug, not just copy. Reproduce on the Demo Docs DB; check the busy
   state clears. (gary/eric → Oracle.)
2. **The offer shouldn't invite a file it will refuse.** The consent bar shows "File up to N" while the
   scope's quiet lane / batch is still active. Design: gate the "File up to N" button (or auto-re-enable it)
   on the scope actually being idle, OR have the accept wait-and-retry briefly server-side. Fail toward an
   honest "still finishing" state, never a scary error.
3. Confirm no SPLIT-doc-specific filing failure hides behind the busy refusal (the whole-batch ok:false
   points to the early gate, not per-doc `confirm-failed` drops — but verify on the real DB).

## NEW EXHIBIT for next session — corroboration IGNORED, a drifted taught anchor wins (owner-reported 2026-09-02)
Owner: "another example of where corroboration is failing and the value is drifting from the anchor."
Evidence: `Desktop\Demo Docs\docusnap - Copy.db` + `processing - Copy.log` + the SFDEV trace screenshot
(`Desktop\Demo Docs\Screenshot 2026-09-02 121357.png`). Doc `4_split_p3.pdf`, Print Tracker.
**The field: `make`.** Correct value = **"Ricoh"** (page prints "Make: Ricoh"). App shows **"MP C4504ex"**
(which is the MODEL value — `make` and `model` collided on the same string; MODEL flags "format differs from
the usual — please verify").
**The trace (the smoking gun):**
- `template_mapping` = **"Ricoh" @90%** · `keyword_override` = **"Ricoh" @85%** (lost to mapping, same value)
  → **TWO independent page families AGREE on "Ricoh" = corroboration.**
- `anchor_crop` = **"MP C4504ex" @85%** → **WON**, despite being lower confidence than mapping (90%) AND
  contradicted by the two corroborating witnesses. It won by **authority precedence** (a taught anchor wins
  on regex/type alone, `shape_mode='ignore'`).
- The visual boxes show the drift directly: the label-locate derived-offset read "Ricoh" @64% (CORRECT),
  but the taught box @69% reads "MP C4504ex" (drifted DOWN to the Model row).
**Mechanism hypothesis (for next session — verify at source):** a TAUGHT `anchor_crop` for `make` drifted to
the Model zone and won by authority, and **corroboration did not protect the correct value** because
`anchor_crop`/`anchor_inline` are DELIBERATELY EXEMPT from the `BLIND_GEOM_DISAGREE_RECONCILE` witness
reconcile (per CLAUDE.md — the 2026-07-26 re-teach fix depends on that exemption; only
method `anchor_registration` is reconciled). So a drifted crop anchor is never checked against the ≥2
agreeing witnesses. **The design question:** should a taught-anchor read that (a) DISAGREES with ≥2
independent corroborating witnesses AND (b) collides with ANOTHER field's value (make==model) be reconciled
/ demoted, WITHOUT breaking the re-teach exemption the exemption exists for? This is the owner's standing
"encode corroboration / independence of method family" direction. gary/reggie/007 → Oracle; DARK + a census
(how many taught-anchor reads disagree with ≥2 witnesses on the live corpus) before any flip. Ties to the
existing corrob arcs but this is the ANCHOR-WINS-OVER-CORROB class, not a note-demote.

## Other OPEN items (carried — see HANDOVER_2026-09-02.md + the review docs)
- **Security release gate** (`docs/SECURITY_REVIEW_2026-09-01.md`, owner approval-class): C-1 code-sign the
  installer (the one no-doc-workaround blocker on a direct channel; MS-Store-only would satisfy it) · R1
  plaintext-DB disclosure (Oracle: opt-in encryption + loud BitLocker posture, NOT default-on) · R2 honest
  binned-doc copy · D-1 node-forge→^1.4.0 (hygiene) · D-3 CVE prebuild gate. 3 safe fixes already shipped
  (`a6ff457`).
- **Chris cards** (`docs/CHRIS_FULL_APP_REVIEW_2026-09-01_NIGHT.md`, verdict YES): #1 letterhead-match teach
  guard (top — a plausible-word teach garble still stands up "Apply to N"; needs a NEW letterhead-match
  signal, diagnosed as out-of-scope for Plan A) · #2-4/#6 copy/refresh.
- **Quick Reprocess flip gate** (`docs/QUICK_REPROCESS_GATE_2026-09-01.md`, DARK): the 5-arm gate on the
  owner's real Castellan DB before any flip.

## FIRST ACTIONS for the new session
1. Read this handover (the unification spec is the job) + skim the eric/gary/Oracle transcripts if a detail
   is unclear (Oracle verdict is binding). `git log --oneline -6` — expect HEAD=origin=`ddb7b53`, clean tree.
2. **Decide the order with the owner:** the WATCH/IMPORT UNIFICATION (the main job) vs the NEW BUG deeper
   follow-ups (the leaked-busy check — quick + high user impact) vs flipping `watch_separate_enabled` (the
   real bundled-PDF parity win Oracle flagged). The bug follow-up (#1, is busy leaking?) is the cheapest and
   most user-visible — consider it first.
3. Build the unification in the migration order (§6): manual first (byte-identical, M=0), then watch, then
   the OMP conc==1 commit. Land the deskew-seam pin (#4) and the parity gate (#5) as you go. DARK where a
   behaviour changes; nothing flips without the owner.
4. Phase 2 ETA emit alongside the unification (the shared OCR-function callback).
