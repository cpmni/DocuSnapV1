# HANDOVER — 2026-09-09 EVENING (reboot handover)

Branch `feat/teach-side-overnight`. HEAD `b1a64b0`. **origin at `cad6c2c`** — the ONE commit `b1a64b0`
(teach-catalog feature log, docs only) is UNPUSHED; push it next session. Everything else is pushed.

---

## ⚠ 1. THE LIVE ISSUE — tesseract.exe crash + orphaned processes (owner reboot in progress)

**Symptom (owner):** `tesseract.exe - Application Error: unknown software exception (0x40000015)` popup on the
new `-TEST` build; and after CLOSING the app, multiple tesseract.exe stayed alive and kept respawning.

**Investigated (Windows Event Log 1000 + live process inspection):**
- Faulting module = **`libstdc++-6.dll`**, exception **0x40000015** = STATUS_FATAL_APP_EXIT (a C++
  `std::terminate`→`abort()`). **THREE+ tesseract aborted within 6 s** (18:04:39/:42/:45).
- The tesseract processes are **SMALL** (26–93 MB working set) → **NOT memory exhaustion.** My first read
  ("0 GB free RAM") was the **misleading Windows standby-cache metric**, not true OOM — corrected after
  seeing the tiny process sizes. (A renderer/main-window OOM was ALSO logged at 17:04 — likely a separate
  JS-heap accumulation in the main window; worth a look but not the tesseract crash.)
- **Signature = many small tesseract spawning concurrently and some aborting in libstdc++**, + crashed
  ones **not reaped** (2 were 9 min old at 0 CPU = hung), + **something respawns them after app close**
  (killed 6+, 2 kept reappearing with 0 ScanFinder procs and 0 packaged python — a detached parent I
  didn't pin; a REBOOT is the clean clear).
- **Concurrency source (default, NOT the -TEST arming):** `ocr_parallel_import_enabled = true` (**mig 139**,
  a customer default since 09-08) → per-doc OCR pools `DS_OCR_PARALLEL_FULLPAGE` (PSM3+PSM6 = 2 tesseract)
  + `DS_OCR_PARALLEL_FIELDS` (many small field-crop tesseract at once). Plus N cross-doc import workers.
- The **-TEST build's armed arcs add MORE small-crop tesseract calls** (read-widen `_read_pad_window_code`,
  date-adopt `_read_pad_window_date`) on `delivery_number`/`delivery_date` — the exact fields on the docs
  being processed at crash time. **NOT PROVEN to be the trigger** — the decisive test is below.

**oscar ROOT-CAUSED it (agent DONE — full report in this session's transcript). TWO distinct failures:**
- **Failure A (the abort):** the bundled MinGW tesseract hits an **uncaught C++ exception → `std::terminate`
  → `abort()`** (0x40000015). `libstdc++-6.dll` is where `terminate` LIVES — the MESSENGER, not the bug. A
  fixed fault offset across the 3 near-simultaneous crashes = the SAME code path terminating repeatedly.
- **Failure B (the wedge/orphan/popup):** the crashed child blocks on the **Windows Error Reporting modal**
  (0 CPU, 9 min) and **there is NO per-call `timeout=` on ANY pytesseract call** (default `timeout=0` = wait
  forever) → the parent `subprocess` blocks forever → the child is orphaned (watchdog `os._exit(0)` at
  `process_docs.py:323`, no Job Object). This is what turned a recoverable per-field miss into a visible wedge.
- **The crasher is the FIELD-CROP / pad-window layer, not full-page** (26–93 MB working sets = crop reads;
  full-page @300 would be 150–400 MB+). Root cause ranked: **(a) MOST LIKELY** a degenerate/near-empty crop
  the LSTM/Leptonica can't handle → uncaught throw. The `<4px` guard is in PAGE space; `_read_pad_window_*`
  use `vpad=0.5*bh` (short strip) then `_prep` upscales with **NO white quiet-zone border and NO min-final-
  height floor** (the ⊕ `ocr/region.py` reader DOES add a 20px quiet zone — a real asymmetry). Feeds an
  extreme-aspect single-row strip flush-to-edge into PSM 6. **Clusters by layout** (same docket → both
  `delivery_number` + `delivery_date` bad → 3 crashes in 6 s). (b) concurrency = AMPLIFIER; (c) MinGW
  libstdc++/libgomp fragility under rapid concurrent spawns = AGGRAVATOR (why it crashes under fan-out but
  not the serial harness). tessdata contention + `--dpi 0` RULED OUT.
- **The newly-armed arcs (read-widen/pad/date-adopt) DO raise the abort rate** — extra small-crop calls on
  `delivery_number`/`delivery_date` + the short-strip-no-quiet-zone feed = exactly sub-case (a).
- **KEY INSIGHT:** the existing `except Exception: return None` around every crop read ALREADY degrades an
  abort into a clean per-field miss — it just never runs because the child HANGS and never returns. Make the
  child return fast and today's handling does its job.

**Fix plan (oscar, ranked smallest-correct first — BUILD #1 FIRST next session):**
1. **Per-call `timeout=` on every pytesseract call + `SetErrorMode(SEM_FAILCRITICALERRORS|SEM_NOGPFAULTERRORBOX|
   SEM_NOOPENFILEERRORBOX)` at worker startup** (ctypes, PSF; no new dep). Tiny, zero seam, highest value —
   fixes Failure B entirely, makes A recoverable via the existing `except`. Generous timeout full-page
   (~60–120 s), short for tiny crops. `timeout=` is the GUARANTEED backstop (WER-inheritance varies by build).
2. **Crop-conditioning in `_prep` + the two pad readers:** white quiet-zone border (≥10–20px), min FINAL
   prepped height (≥~20–24px, pad canvas white), cap the upscale factor, skip autocontrast on a near-uniform
   crop, reject degenerate final dims (→ abstain). Guard on FINAL pixel dims, not page-space 4px. Removes the
   TRIGGER. ⚠ **SEAM:** the pad-window path is a FLAG PRODUCER (`_maybe_pad_date_flag` caps@70 + `corrected_to`)
   — a conditioned read that now SUCCEEDS must STAY subject to the pad disagree/containment flag + conf cap,
   never sail past the checkpoint just because it stopped crashing. A cleaner read is not a righter read.
3. Global concurrent-tesseract ceiling (semaphore, independent of worker count; narrow the fields pool
   `anchor.py:1832`). 4. Retry-once-serial on a caught abort (value-neutral — NEVER a corroboration witness).
   5. Job Object `KILL_ON_JOB_CLOSE` so the watchdog never orphans (the eric piece; overlaps #1/#5).
- **Logging to catch the exact crop:** a breadcrumb written BEFORE each pytesseract call + cleared AFTER
  (survives a hang; mirror the `_watch` idiom) recording field_key/stage/original box/**final prepped
  dims+upscale**/config/pool-state; save the failing crop PNG pre+post `_prep` behind the diag/`--slice-dir`
  gate. That single artifact settles (a) vs (c).

**DECISIVE attribution test (still worth running):** does the crash reproduce on the RELEASE build
(`…-r20260908-1843-9251551.exe`, arcs DARK, mig 139 parallel STILL on) vs `-TEST`? Release too → the
parallel-OCR/no-timeout class (pre-existing); only -TEST → the armed small-crop arcs amplify it. Either way
fix #1+#2 cover it.

**Immediate mitigations for the owner (after reboot, if it recurs):** Settings → Processing → lower
concurrency; and/or turn OFF `ocr_parallel_import_enabled`.

---

## 2. SHIPPED THIS SESSION (all pushed except `b1a64b0`)

**5 DARK arcs** (seed-OFF, in `TEST_SWITCH_KEYS`=32, armed only by the `-TEST` build, owner-gated for the
customer flip = census + Oracle):
- `template_code_read_widen` (mig 141, `6f0bbab`) — leading-glyph clip on wider dockets. **Census PASS.**
  **Oracle = SIGN OFF WITH CONDITIONS (see §4) — do NOT flip until Condition 1 is built.**
- `optional_soft_flag_autofile` (mig 142, `1c538f7`+`e2f26e1`) — a soft optional-field note no longer blocks
  a graduated auto-file. Census SAFE, 0 fires on arm137 (target = the owner's live customer_name holds).
- `template_pad_date_adopt` (mig 143, `1f78d92`, Q4) — adopt a corroborated widened date instead of holding.
  **Census done: SAFE (0 regressions / 0 new wrong / byte-identical), 0 fires on arm137** (no clipped-date
  dockets there — efficacy = the owner's dockets). 22 unit pins + mig pin.
- `type_split_teach_scope_suppress` (mig 144, `5a07402`, Q1) — a wizard-taught type no longer re-triggers the
  type-split ask. herald: NO misdetection, it's a confirmed-count predicate treating a taught type as
  unsupported. Census NOT run (wouldAsk delta owed).
- `corrob_autofile_band88` (mig 145, `5a07402`, Q3) — corroboration auto-file down to the 88 floor. Honest
  limit (pinned): inert on a single-family @93. **Reach census NOT run.**

**3 UX (shipped, not DARK):** teach-import overlap (`235be28`) · styled hold-note buttons (`235be28`) ·
auto-file toast + eligibility progress bar (`13036dc`).

**Full pin suite 333/333.** `-TEST` installer =
**`dist/ScanFinder Setup 2.0.0-r20260909-1607-cad6c2c-TEST.exe`** (all arcs armed; verified ON on a fresh DB).

---

## 3. DEFERRED / QUEUED (need a trigger or a build)
- **release-net `INLINE_DISAGREE_CORROB_RELEASE`** (mig 146 reserved) — gary DEFERRED: flip read-widen first
  + census, build the net only if a material warm residual remains. Full recipe in `pendingfeatures.md`.
- **Multi-res confusable re-OCR** (oscar/007) — logged idea, deferred.
- **herald `detected_type_name` one-liner** — persist it on the template-match path → unlocks a title-first
  type-split gate (also catches a mis-typed teach).
- **Teach-wizard catalog auto-select** (`b1a64b0`, owner ask this session) — auto-select a newly-added catalog
  type when exactly ONE is added; multiple → unchanged. Small UI build.
- Bigger pre-deploy queue (night-run handover): click-through+uninstall drill → flip default `build` to
  hardened · Chris card re-vet · item-5 display bugs (mailbox "Type —/Unknown"; import row stale after a
  manual confirm) · security vet (backup restore accepted a fabricated fingerprint) · Learning Repair ·
  client/cert-tool finish · DB-at-rest · backend 2FA.

---

## 4. Oracle read-widen verdict — SIGN OFF WITH CONDITIONS (do before flipping mig 141)
- **Condition 1 (binding):** a read-widen value may auto-file ONLY when independently corroborated —
  (a) an independent family (inline/keyword) agrees, OR (b) it equals a confirmed in-scope literal, OR
  (c) it is a clean suffix-unclip of the tight read (`_code_norm(recovery).endswith(_code_norm(tight))`,
  ≥4-char core). Else CAP the commit below the auto-file floor (≤84) + review note. The seam: read-widen
  removes `docTrustGate.valueMatchesShape`'s checkpoint (invalid→valid), so a same-length **letter↔letter**
  wrong recovery (`D`→`U`, shape `@` preserved) would silently auto-file on a sole-crop witness. Cheapest impl
  = cap at `template_mapper.py:2832` when `read_widened` set and none of (a)/(b)/(c).
- **Condition 2:** pin the FAILURE — assert `_widen_code_read('-57601','UN-57601')` DOES swap (documents the
  hole) + an integration pin that an uncorroborated non-suffix-unclip read-widen value does NOT clear the
  auto-file floor. Keep the same-length-tight blind-spot pin.
- **Condition 3 (recommended):** run the isolated A/B on the Demo Docs Marlowe/Ridgeway docket templates so
  the owner's actual exhibit is measured; classify the census's 31 fires as suffix-unclip vs divergent.
- Full detail: the Oracle result in this session's transcript + `docs/oracle_log.md` (log it there).

---

## 5. Advisors
- **oscar** — DONE; the tesseract-abort root cause + ranked fix are folded into §1. (Full report in the
  session transcript.) NEXT SESSION: build fix #1 (per-call timeout + WER SetErrorMode) first — tiny, zero
  seam, fixes the visible wedge — then #2 crop-conditioning (honour the flag-producer seam).
- **eric** — NOT spawned; the Job Object / child-reaping piece is oscar's fix #5 (build with #1). Spawn eric
  only if the process-tree kill needs Electron-side lifecycle work.
- gary (release-net + Q3) · herald (Q1) · Oracle (read-widen) · oscar (tesseract abort) — all DONE.

## 6. Measurement dirs (untracked, in TESTING/_measure)
`clip_census_20260909/` (read-widen PASS) · `date_adopt_census_20260909/` (SAFE, 0 fires) ·
`soft_flag_census_20260909/` (SAFE, 0 fires). type-split + band-88 censuses NOT run.

## 7. Memory
`memory/project_autofile_friction_arcs_20260909.md` (this session's arcs). MEMORY.md compacted to ~17.9 KB.
