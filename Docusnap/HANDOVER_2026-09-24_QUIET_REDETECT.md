# HANDOVER 2026-09-24 (evening 2) — Quick-rescore fix SHIPPED to the sandbox · QUIET REDETECT built DARK (mig 216) · owner testing

**Branch:** `feat/teach-side-overnight` · HEAD `b887dae` (+ this handover) · origin at `83cf5d4` — **6 commits UNPUSHED**
(`a5f3cab` constants · `36f14a1` Quick rescore · `081e965` pin + wrap · `34a9f11` quiet redetect · `b887dae` docs · this) ·
migrations **216** · `TEST_SWITCH_KEYS` **14** · `/v1` contract 1.9.0 · `node scripts/run-pins.js` **428/428** · installer
to ship unchanged: `dist\ScanFinder Setup 2.0.0-r20260924-1805-fa249d1.exe` (neither fix is in it).
**Read with:** `HANDOVER_2026-09-24_QUICK_RESCORE.md` (the first fix, its gate) · `docs/designs/QUIET_REDETECT_2026-09-24.md`
· `docs/oracle_log.md` (two entries dated 2026-09-24 evening / evening 2) · `HANDOVER_2026-09-24.md` (the day).

## 1. Quick rescore (Plan-B C4 re-ruled) — BUILT, GATED, ON THE SANDBOX
A Quick reprocess can now RAISE a stale low overall: `quickRescoreMerged` / `quickRescoreStore` in
`src/modules/processing/handler.js` store `max(today's value, min(rescored-from-merged-rows, 99))`, never when the doc is
contested or a TAUGHT key was kept on a scored field; env kill `QUICK_RESCORE_MERGED=0`. Penalty constants live once in
`database/modules/format_consistency.js`. Gate `TESTING/_measure/quick_rescore_gate_20260924/RESULT.md`: exhibit 17 → 93
with 0 field diffs (hold becomes the honest `no-template`); once the sender has a template the same pass files 12/12;
live-DB copy byte-identical. Live default (no switch).

## 2. QUIET REDETECT — BUILT DARK (owner ask: "categorise everything quickly, then confirms allow auto-file")
gary + eric → Oracle: **A SIGN OFF W/COND C1-C7 · B DO NOTHING · C DO NOTHING.** Built = slice A: a type that becomes
available (created / catalog / re-enabled / aliases edited, desktop or /v1) or a Keyword Label Override saved/removed →
the quiet lane's scope-less QUICK job (`quietLane.js` kind `redetect`) over the held template-less docs typed NULL or
General Document (or the override's type). Cap 400, `detected_type_name` first, unusable-cache docs skipped (never Full;
born-digital text-layer docs ARE admitted — see §4), no sweep scope, no auto-accept fan-out, reliability first-fill holds
released at finish, identity-key override → confirm-once on that key (C5). Under the switch the SCOPED arms also admit
Generic-typed docs (C1, they were silently skipped since mig 93) and a Generic→X re-type plants no "type changed" note
(3b). Switch `quiet_redetect_on_type_change` (mig 216, DARK; env `QUIET_REDETECT_ON_TYPE_CHANGE`). Pins listed in the
design doc. **Gate MET** (`TESTING/_measure/quiet_redetect_gate_20260924/RESULT.md`): OFF byte-identical; ON: adding three
catalog types typed the exhibit's three matching untyped docs within ~10 s (the fourth stayed untyped — its type was not
added), nothing filed, no notes left; saving a Quote override re-read 16/17 quotes 31 → 93 hands-free (the 17th was open
in Review — correctly untouched).
**B (a re-read after a naming confirm) and C (after every confirm) were decided against** — the existing "Apply 'X' to N &
re-read" ripple OFFER is the honest lever; the READY arm + graduation mint already cover the confirm that makes a sender
fileable (`pendingfeatures.md` 2026-09-24 evening 2).

## 3. The owner's sandbox NOW
Restarted ~21:58 on HEAD with **`QUIET_REDETECT_ON_TYPE_CHANGE=1` in its process env** (CDP 9223, PID 4500, data folder
`C:\Users\cmccu\AppData\Local\Temp\claude\c--GIT-Projects-Docusnap\owner-sandbox-20260924\userData`, logs `app3*.log`
beside it). **PERSISTED (owner ask, ~22:05): `quiet_redetect_on_type_change = 'true'` written into the sandbox DB** — the predicate
reads the setting per call, so it is live now and survives restarts; the env arming is now redundant (a plain
restart keeps the feature on in the sandbox). Flip mig 216 for everyone only after the owner's verdict. **What to try:**
import a few docs of a type that is not installed → they land in "Not recognised" → Settings → Document Types → "Add
from catalog" → within ~10 s they should be typed and field-filled (Review refresh is deferred while a doc is open);
save a Keyword Label Override → the held docs of that type re-read and rescore. ⚠ sandbox `output_folder` is the REAL
`C:\Users\cmccu\Documents\Scan Finder`; docs 2-10 still point at the mortal job-scratch inbox.

## 4. OWED / open
- ~~Oracle re-rule of the born-digital relaxation~~ — **DONE the same night: SIGN OFF WITH CONDITIONS C1-C3, all
  applied** (`docs/oracle_log.md` 2026-09-24 night): the re-ask now lives in `ocrCache.ocrCacheUsableForRedetect`
  (lane-only; the batch keeps its Full fallback), `test_ocr_cache_born_digital.js` (17 checks), wording corrected
  (Full-bd does build letterhead geometry from `page_text_lines`; Quick-bd does not — consumers fail-toward-review),
  issuer before/after column in the gate RESULT (all unchanged).
- Flip decision for mig 216 after the owner's sandbox verdict (+ the CX copy: a still-untyped doc's hint should name the
  next step; a heading-absent scan stays untyped on Quick by design).
- Push the 6 commits. `docs/detached-client.md` 1.9.0 note. The Hard Set digital supplier-EMPTY question. A Chris round
  on the packaged build. `charsetAcceptService.recomputeOverall` rounds where Python floors (≤1 pt, flagged, untouched).
- Gate scripts live in the job scratch `%USERPROFILE%\.claude\jobs\68b38f39\tmp\gate\` (prep / seed-user / CDP driver /
  snapshot / compare / flips / audit / run_arm / run_redetect_arm) — mortal; both RESULT.md files describe them.

## 6. NIGHT (owner asleep: "take Chris's review and apply any fixes that you deem suitable")
**Chris round** (`docs/CHRIS_FULL_APP_REVIEW_2026-09-24.md`, fresh sandbox CDP 9226, PID 32576, still running): both roads
WORK underneath — adding four kinds from the catalog sorted **91 of 98** kind-less papers by themselves, one saved keyword
fixed **19 of 20** credit notes hands-free, the confirm road filed 9 siblings 10 s after his 10th confirm, every file on
the right shelf, delete/bin/restore never lost a file. Verdict "yes, I'd keep it". Eight cards; the Review window's
SILENCE while the pile sorted was his top friction.
**Fixed the same night (all pinned, suite green — see §7):**
- **Card 3 (root cause verified in his DB):** the 7 leftovers all carried the engine's import-time "Found '…' after
  straightening — confirm once." note; the lane's "already asked" family exclusion dropped them. The UNTYPED redetect job
  no longer applies the lane-note exclusion (an untyped doc was never asked); the override (typed) job keeps it.
- **Card 2:** the untyped notice now recognises an INSTALLED type named by `detected_type_name` ("Statement is set up —
  Read it as a Statement" → selects the type + reprocesses) instead of the false "Add 'Statement'" → "isn't a ready-made
  type" → create-a-duplicate door.
- **Card 4 "nanann":** the on-open fast-suggestion road (`reextract_fast_enabled`) had no shape gate; it now drops a
  suggestion for the type's reference role with no digit (the `ref_role_digit_gate` twin) and any suggestion with no
  letter or digit.
- **Card 1 (receipt):** a redetect's `job_done` now refreshes the Review list at once (never the open document's pane),
  toasts "Re-read N documents after you added X — the list has been refreshed", and, when the open document was one the
  pass left alone, says so and points at Reprocess; the lane reports the viewer-skipped ids (`viewing`) in the event.
- **Cards 6/7/8:** copy ("if it reads clean it will be offered in File All Ready"; "the 90% level for filing without a
  check (Settings → Processing)"; "so it knows what to look for"; "however the automatic-filing level is set"); the
  Not-recognised intro wraps full-width and says the SENDER couldn't be identified.
- Two source pins adjusted for the new shapes (`test_quiet_lane.js` job_done window; `test_review_untyped_reason.js`
  wording) + new pins in `test_quiet_lane_redetect.js` / `test_review_untyped_reason.js`.
**Logged, NOT built:** card 5 (near-identical sender names "Meadowyale" / "Dairy Wholesale" — identity near-match arc);
card 8's tab rename + a "no type yet" pill on kind-less rows; "Set aside all" with no prompt; two Ironclad statements
typed Invoice (detection; held anyway); natural-language search ("Harrowgate March 2026"); a durable activity-strip
receipt for the redetect (Oracle skipped the KINDS extension).

## 7. Verification state at the night wrap
`node scripts/run-pins.js` **429 files: 428 green + the client teach-shared sync pin** (the catalog wording change made
the synced client copy stale → `node scripts/sync-client-teach.js` → 17/17) = green across the board. Every new pin green
in isolation. The owner's sandbox was RESTARTED on the final code (CDP 9223) with the switch persisted in its DB; Chris's
instance (9226) still runs the pre-fix code and is left up per the skill. Not measured live tonight: the receipt toast and
the "Read it as a Statement" door (renderer pins only) — the first sandbox click in the morning is the check.

## NEEDS YOUR APPROVAL (morning)
- **Push** the branch (10+ commits unpushed: the Quick rescore, the quiet redetect, the Oracle re-rule, the Chris-round fixes).
- **Flip mig 216** (`quiet_redetect_on_type_change`) for everyone, or keep it DARK + armed only in your sandbox. Chris's
  round is the efficacy evidence (91/98, 19/20, nothing filed by the pass); the OFF arm is byte-identical.
- **Card 5** design (near-identical sender names) — gary/Oracle before any build.
- The sandbox's `output_folder` is still your REAL `Documents\Scan Finder`.

## 5. Traps met tonight
- The CDP driver must pick the main page by URL (`/main/`), not by the title "ScanFinder" (the splash shares it).
- A Review window can close on its own after an offer is consumed → a driver loop that waits on "review" must time out.
- The audit redactor masks any metadata field whose NAME looks like a secret (`override_keys` → `[redacted]`).
- `ocrCacheUsable` refuses born-digital docs by design (a cost rule) — any future Quick-road consumer must decide this.
