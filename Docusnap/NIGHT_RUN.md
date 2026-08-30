# NIGHT RUN — the overnight test/check queue and its ledger

> **Owner convention (2026-08-30):** anything Claude thinks is worth TESTING or CHECKING goes into this file's QUEUE as
> it is noticed. When the owner says "going to bed", the newest `docs/designs/NIGHT_RUN_*.md` prompt runs. **Every
> night, when the run finishes, the session moves what it did into the DONE ledger with the result and a
> "repeat only if" condition — so no night repeats work unless it is needed.** Before planning a night, read the
> DONE ledger first. Keep entries one to three lines; detail lives in the linked report/handover.

## TONIGHT (the active prompt)
- `docs/designs/NIGHT_RUN_2026-08-31_ADVERSARIAL_CORPUS.md` — build the Hard Set (10 classes × digital + scan), score
  cold/warm, advisor class cards for the top-3 would-file-wrong classes, `/christest` on the scan set, morning
  handover. Fixes only DARK + Oracle + realdoc-605 gated.

## QUEUE — worth testing or checking (ranked; add freely, date each)
- **2026-08-30 · The baseline 7 wrong auto-files (M = 7 / 605, 1.2 %) — the leading/garbled-digit DATE class**
  (#953, #1423, #1453, #1649 + the poisoned-GT #364; suppliers #331, #1092). Silent misfiles a customer never sees;
  the biggest remaining extraction risk. Needs: trace each, class card (reggie + 007), a witness-style guard.
  Covered partly by the Hard Set's `edge_date` class — read that result before designing.
- **2026-08-30 · AUDIT of every shipped "never auto-files / review-bound / held" claim against the REAL gate** with
  `autofile_gate_unify` ON: the deskew retry's `_needs_review=True` was a dead guard (found by accident). Enumerate
  every writer that relies on `_needs_review` or on a doc-level flag instead of a field NOTE, and test each with
  `trust.isAutoFileEligible` on a fixture. gary → Oracle.
- **2026-08-30 · Refs/dates in the re-slice witness sweep (slice 2)** — trigger must be "the zone's own read was
  ABSENT or format-INVALID" (never out-vote a valid dissent); reuse `_read_pad_window_date/code` as rung 1; the ref
  xcheck demoter is Oracle-B2-deferred (0030's `NRQ-2551` hold is that class).
- **2026-08-30 · R8 as the PRIMARY money mapping read — census only**: every taught currency mapping across ≥5
  templates at 200 AND 300 DPI, tight ladder vs R8 vs GT (0 T→F, 0 new format-valid wrong, pad-window suites
  byte-identical, small-font totals decide it). Oracle said NO until this exists.
- **2026-08-30 · The deskew retry never fires on a note-only hold** (keys on engine `_needs_review`); its 5/20 heals
  were a sandbox artefact (empty ref/date). Measure how many live held docs have skew ≥ 0.3° and a note-only hold
  before widening the trigger.
- **2026-08-30 · Tidy the 15 JS pins broken by the mig-93 default flip** ("OFF (default)" sections now start ON in a
  fresh in-memory DB): `test_company_key_own_scope`, `test_learning_excluded_readers`, `test_put_back_hold`,
  `test_rewrite_marker_exclusion`, `test_quiet_lane_*` ×3, `test_reprocess_holds_as_lane`, `test_reviewservice`,
  `test_type_ambiguity_ripple`, `test_activity_strip`, `test_issuer_clear_not_a_correction` (+ the three crashes
  `test_document_types_aliases`, `test_workflow_ipc`, `test_workflow_snapshot`, and the `stamp-*` wiring red). One-line
  fix each (state the OFF arm explicitly after `runMigrations`, as done in `test_role_disagreement_refuse.js`).
- **2026-08-30 · The total-swap class** (garbage zone read WON, no keyword read, only the re-read reconciles) — 0
  stored exhibits; needs the re-read injected before `_reconciliation_pick_total`. Low priority until a census finds one.
- **2026-08-30 · Money fold in `_corrob_values_agree`** — no measured target (19/20 records already agree); build only
  if a census finds separator-only money dissents. reggie's design is in the 08-30 handover.
- **2026-08-30 · Warm cross-contamination** (2026-07-29 rig: loading live learning dropped a NEW supplier's ref 58→33 %
  on suppliers sharing nothing with the scanned data) — still open; the Hard Set's warm-scan arm re-measures it.
- **2026-08-30 · Search perf**: `verifyAuditChain` re-verifies the whole audit log on every Search open (grows with use).

## DONE ledger (newest first) — do NOT repeat unless the "repeat if" condition holds
- **2026-08-30 EVENING · Re-slice witness arc + money-format hygiene + deskew dead-guard fix.** Result: built DARK,
  Oracle C1-C14, 605-paper four-arm realdoc gate MET (M 7 unchanged, +1 would-file, 0 wrong releases); full suites'
  reds all pre-existing. Report: `HANDOVER_2026-08-30_NIGHT.md`, artefacts `TESTING/_measure/reslice_20260830/`.
  Repeat if: the money reader or `_reconciliation_pick_total` changes, or a new corpus shows a noted-total class the
  sweep declines on (`RESLICE_CENSUS_DIR` reasons).
- **2026-08-30 EVENING · Duplicate census of the confirmed corpus.** Result: 2,029 confirmed → 1,940 with a file → 618
  byte-distinct → 605 papers by (type, supplier, ref, date); `RR_IDS` list at
  `TESTING/_measure/reslice_20260830/runs/rr_ids_dedup.txt` (`_dedup_ids.py`). Repeat if: the owner imports a new
  batch (re-run `_dedup_ids.py` on a fresh `db.backup()` copy).
- **2026-08-30 EVENING · Stored-record money-dissent census.** Result: 10 money dissents in 538 records — 8
  format-invalid (older-vintage reads), 2 valid garbles (0023). Repeat if: the crop ladder changes.
- **2026-08-30 DAY · Deskew review-bound retry (whole-page straighten).** Result: `4607cc6`, 5/20 Nordwind identities
  healed — on a sandbox with EMPTY ref/date; live mostly inert on note-only holds. Repeat: NO — measure the live
  note-only-hold population first (queue item above).
- **2026-08-29 · Electron 44 upgrade gates 1-5b; security audit; Chris vet.** See `HANDOVER_2026-08-29.md`.
  Repeat if: Electron bumps again (gate 5b DPAPI continuity is the mandatory one).
