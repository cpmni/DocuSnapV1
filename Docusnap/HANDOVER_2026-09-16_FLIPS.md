# HANDOVER 2026-09-16 DAY — the dark-switch flip census re-run + the first two flips

## STATE (verified at wrap)
- Branch `feat/teach-side-overnight`, **HEAD `c3ca29e` + this docs fix; origin CURRENT — everything PUSHED
  2026-09-16 on the owner's "push it"** (the 4 video-night commits + today's flips `764b397`/`cb60e3a` + docs).
- Tree: the 7 `tools/video_tutorials/` modifications (6 script JSONs + `voice.py`) were ALREADY uncommitted when this
  session started (09-16 morning, before the census) and were NOT touched — the owner's own edits; leave or commit as
  they see fit. Nothing else uncommitted.
- Migration version **176** (172-175 flips + 176 the split-segment hold seed). `npm run test:pins` 381/382
  (the 1 red = the pre-existing `test_ref_class_fix.js` timing flake). Release gate: "46 DARK keys guarded".
  HEAD `db04a8f` + the docs commit; origin current.
- No app running. No installer built (the flips ship in the next build; they also activate on the owner's live
  install at its next `npm start` / installed-app launch via migs 172/173/174).
- **Second commit this session (owner: "flip 143 as well"): mig 174 `template_pad_date_adopt` ON by default** —
  same shape as `764b397` (UPSERT + `@DEFAULT_FLIP` + delist + the shared pin extended + count pins 48→47 +
  `test_migration143_pad_date_adopt.js` reworked). HARD dependency `template_pad_window_read` verified ON on a
  fresh install AND in the census DB (pinned).

## What happened (owner: "read the handover and continue with the switch tests … then flip 156 and 159")
1. **Census re-run at HEAD** on the 700-doc synthetic warm corpus (`Desktop\Flip Corpus 700\warm_700.db`, COPIED to
   scratch + migrated 163→171 — the Desktop fixture untouched). Baseline OFF (`RR_APP_ENV=1`) + 4 ON arms, ~10 min
   each. Full table in `TESTING/_measure/flip_corpus_20260912/CENSUS.md` (2026-09-16 section); the runner, migrate
   script, comparator and per-arm diffs are in `TESTING/_measure/flip_corpus_20260912/rerun_20260916/`.
   - baseline deterministic (identical to 09-15: 192/400 would-file, same 13 disagreeing, 36 total-noise, #166 silent)
   - **159 `ref_confusable_flag`**: M=0, 0 value changes, 6 fires (every injected `S0-#####`), 2 file→hold — PASS ×2
   - **156 `name_role_nonname_flag`**: M=0, 0 value changes, 5 fires (every injected `BT1 1HE`), 1 file→hold — PASS ×2
   - `deskew_corrob_autofile`: byte-identical to OFF (the 3 straighten-changed fields all KEPT their hold) — safety
     pass, efficacy VACUOUS → **stays DARK** (no evidence for a flip from this corpus)
   - `template_pad_date_adopt` (mig 143): M=0 + the same real heal (#279 date) — PASS ×2 → **flip-ready, owner's call**
2. **The flip (`764b397`)**: mig 172 (`name_role_nonname_flag`) + mig 173 (`ref_confusable_flag`) UPSERT `'true'`
   under `// @DEFAULT_FLIP` labels; both keys DELISTED from `database/dark_switches.js` in the same commit; new pin
   `database/test_default_flip_156_159.js` (fresh-install ON · upgrade-from-seeded-false ON · a deliberate 'false'
   survives a relaunch · delisted · labelled · release-gate clean · handler bridge); `test_migration156_nonname_flag.js`
   reworked to the graduated contract; count pins 50→48; ledger + handler comments updated.

## THIRD thing this session: the split-segment "look first" belt (`db04a8f`, mig 176, default ON)
Owner: "keep going with the recommended work … build it once the oracle signs off". gary designed → Oracle
SIGN-OFF-W/COND C1-C10 (the Oracle run died once on a network error and was RESUMED via SendMessage with its
context intact — that works). Built exactly to the conditions: the separator's rewrite set (now carrying
`separators`) is threaded to `_handleFileMessage` on BOTH arrival paths; every MULTI-page segment of a HEURISTIC
split gets a "— confirm once." lane-hold note on its ref-role row (C3 target order) before the auto-file decision,
so the ONE predicate refuses it at import / File-All-Ready / the sweep (Tier 2 pinned) / the reprocess offer;
slice 2 carries the mark across a reprocess; Review's reason panel says "pages 2–3 were cut from a multi-document
scan… use Split" (C4); `composeNote` never de-dups it (C5). Measured: belt OFF, a manual import auto-filed **12 of
16** multi-page cuts at 100 %; belt ON, **0** (14/14 marked, held) on both watch and manual replays, one-page cuts
untouched (the 34-alert one-click flow intact). Design record `docs/designs/SPLIT_SEGMENT_HOLD_2026-09-16.md`;
Oracle entry appended to `docs/oracle_log.md`; pins `test_segment_hold_{predicate,stamp}.js` +
`database/test_segment_hold_default.js` + a C5 case in `test_note_topic_dedup.js`. Suite 381/382 — the red
`test_ref_class_fix.js` is a PRE-EXISTING timing flake (ARM B hashes two corpora built at different moments →
a second-boundary under load; passes 1 in 3 standalone), not this change.
**Still open (pendingfeatures.md):** the separator's same-logo sibling accuracy, and the class the belt cannot see
(a stack whose only recognised first page is page 1 is never split → imports whole). Oracle's separate fork, not
done: with the dangerous population now marked, the 09-01 import-time hold of 1-page WATCH cuts could be relaxed
to match manual (34 alerts → zero clicks) — owner's call.

## Plain-English meaning for the customer
- A "name" box that actually reads as a bare postcode / email / VAT number / IBAN now waits for a look instead of
  filing silently. A reference with an O-vs-0 / I-vs-1 / S-vs-5 look-alike in the wrong place now waits for a look
  instead of filing under a wrong name. Neither ever changes a value; both are just a "please check" hold.
- A taught date box that clipped the first digit now takes the wider read when a second reading of the page backs
  it up, so the correct date files instead of waiting (mig 174; the census's one swap was the right date, twice).
- All three can be switched off (Settings → the dev switches, or a settings write) and the off choice sticks.

## Traps learned (also in memory `project_flip_corpus_pipeline_20260912.md`)
- The Bash tool's background mode has a 10-minute cap → launch a multi-arm census DETACHED (PowerShell `Start-Process
  bash …`) and watch the output file with a Monitor.
- A `TaskStop` on a background bash does NOT stop the script — it killed the electron child and the script moved on
  to its NEXT arm, writing the same output files as the fresh run. Kill by PID, the bash FIRST, then its children.
- Never run the pin suite while census arms run (8 OCR shards + per-file watchdogs → a starved doc reads null = a
  false M).

## NEXT (owner decides)
- ~~Push~~ — DONE (origin current after each step).
- ~~Flip `watch_separate_enabled`~~ — **DONE, mig 175**, but NOT on the earlier "soak PASSED" claim: that ledger line
  (09-12) had NO run behind it. The owner chose "run the soak first"; it was run 2026-09-16 in a sandbox on a copy of
  the live DB (`TESTING/_measure/watch_separate_soak_20260916/RESULT.md` + reusable harness): analyzer PASS, the real
  34-page bundle 34/34, 0 over-split, 91 segments all held, 0 auto-filed; synthetic same-logo stacks under-split =
  the separator's fingerprint floor (shared with manual import, never worse than OFF). **Seam logged in
  `pendingfeatures.md`:** the hold is import-time only → a later File-All / scope sweep can file a merged clean
  segment unseen → a durable "look first" mark is the follow-up belt. `deskew_corrob_autofile` stays DARK.
- **The soak sandbox app may still be running** (dev app, DevTools port 9223, `DOCUSNAP_USERDATA=<scratch>\soak\
  userData`, a COPY of the live DB with sandbox paths; login admin / Scan-Finder-2026). Harmless; close it from its
  window or kill the electron whose command line carries `--remote-debugging-port=9223`. Its scratch folder dies
  with the session.
- The rest of the flip queue is in `docs/DARK_SWITCH_LEDGER.md` (🟡 WAITING; most are geometry-inert on the synthetic
  corpus → efficacy only on real exhibits; `format_class_join` HOLD on blast radius).
- Then the standing 09-15 EVENING queue: VM live-test of both installers; Departments D2b/D3/D4 before the
  `departments_enabled` flip; client-Review S0.

## Commands
```powershell
# census (detached; ~10 min per arm over 400 docs)
Start-Process 'C:\Program Files\Git\bin\bash.exe' -ArgumentList '"<scratch>\census_run.sh"' -WindowStyle Hidden -RedirectStandardOutput '<scratch>\census_run.out'
# compare an arm to the baseline
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe TESTING/_measure/flip_corpus_20260912/rerun_20260916/compare.js base.jsonl on.jsonl "<fire regex>"
# pins
node scripts/run-pins.js
```
