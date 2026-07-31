# HANDOVER 2026-07-31 NIGHT (Opus 4.8)

**Branch** `feat/reprocess-throughput-autostraighten` · **HEAD `a308e0b`, PUSHED** (origin in sync).
Tree clean bar the long-standing untracked (`../Backup/`, `../Docusnap - Copy*`, `HANDOVER_2026-07-28*.md`,
`docs/SECURITY_HARDENING_REPORT_2026-07-28.md`, `scripts/remove-superstore-invnum-anchor.js`).
**Dev app RUNNING** (owner's `npm start`, background task — all main-process code from this session is
loaded; python spawns fresh per run). **Installer `5b5d344` predates the ENTIRE day** (3 sessions of
work) — rebuild to ship anything. Continues `HANDOVER_2026-07-31_EVENING.md` (morning/afternoon arcs).
**NEXT SESSION'S AGREED TASK: build Catch-up Filing slice 1** (see FIRST ACTIONS).

## TL;DR
Owner-driven night session, three arcs, ALL COMMITTED+PUSHED:
1. **Ironbridge-as-Copperfield wrong-issuer prefill** → `TEMPLATE_FIXED_NAME_PRESENCE_VETO` (blank the
   un-named collision stamp) + the **reprocess merge bug it exposed** (`REPROCESS_ANNOTATED_EMPTY_WINS`
   — kept_existing was resurrecting engine-blanked values; proven live, fixed, healed in-app).
2. **Teach wizard**: ONE-step value+label confirm + clip-gated label pass-2 re-read (the "oe ee No."
   garble — recovered on real pixels), plus customer-plain note copy.
3. **Needless review flags** (owner: "information is there, no messages needed") → three slices
   herald+gary→Oracle-gated, ALL ON: `TYPE_AMBIG_COHESION` (cross-supplier phash band manufactured
   "several document types"), `HEADING_BAND_REREAD` (rung-2 single-pass title re-read cures the
   PSM-3+supp-merge doubled-heading garble at ocr_dpi 200), `TEMPLATE_IDENTITY_GEOM_WITNESS`
   ("Company inferred…" note shed when the letterhead geometry agrees).
4. **Catch-up Filing designed + SIGNED OFF (not built)** — `docs/designs/CATCHUP_FILING_2026-07-31.md`.

## COMMITTED this session (newest first; each message carries full detail)
- **`a308e0b`** docs(design): catch-up filing agreed design (barry→gary→Oracle W/COND).
- **`6994a66`** test(gates): `stress_test/demo_notes_gate.js` combined demo gate + pendingfeatures/CLAUDE.md.
- **`d8768fe`** **G** geometry-witness fill-note shed (kill `TEMPLATE_IDENTITY_GEOM_WITNESS`, ON).
- **`4a058a6`** **A** rung-2 general title-band re-read (kill `HEADING_BAND_REREAD`, ON).
- **`0f33e20`** **B** logo-arm ambiguity single-supplier cohesion (kill `TYPE_AMBIG_COHESION`, ON).
- **`ea4101a`** customer-plain wording for the two branding blank notes (markers preserved).
- **`72fe746`** reprocess merge: annotated empty WINS (kill `REPROCESS_ANNOTATED_EMPTY_WINS`, ON);
  operator `corrected_to` outranks; doc column mirrored NULL; repaired a PRE-EXISTING silently-failing
  pin in `test_reprocess_type_flip.js` (stale regex vs the reprocessTypeArgs refactor).
- **`5fa3cbb`** docs · **`934df8a`** teach one-step confirm + label pass-2 (+`anchorLabel.js` pure
  helpers + probes) · **`20d6be3`** template_fixed name-presence veto (+templates.js enrichment).

## Verification state — all READ live this session (honest)
- **Unit suites** all green at HEAD: veto py 17/17 + JS 6/6 · reprocess-merge 16/16 · anchorLabel full
  (incl. new pins) · ambiguity (incl. cohesion arms) · heading-band 13 · geom-witness 13 · red-rung
  fixture · matcher/kw/flag/band-graduate/fill/branding trios.
- **Real-pixel probes** (all read): `teach_label_reread_probe.js` ALL PINS (clipped draws recover
  'Sales Order No.', tight draw 0 extra OCR) · `heading_band_probe.py` (doc 180 SO@65→PO@95 trusted;
  clean sibling never fires) · `geom_witness_probe.js` (doc 170 OFF noted / ON shed, same value,
  conf 90 = 85 emitted + the generic Stage-4.5 boost — sub-95, parity with hints).
- **Realdoc**: veto OFF==ON FULL-LOG BYTE-IDENTICAL · B-ON zero behavioural deltas (corpus grew
  161→162 mid-session, new doc scores correct) · A+B-ON byte-identical to B-ON (0 type flips census).
  ⚠ Run WITHOUT `GATE=1` — the signal used was the byte-diff, not the exit code; the known 8-doc
  would-auto-file-wrong baseline (GT-poison class) is UNCHANGED throughout.
- **Demo gate** `demo_notes_gate.js` (90-doc sample, 2/supplier×type of Desktop\Demo Docs @ live
  ocr_dpi 200): ALL GATES PASS — 0 wrong sheds, no new wrong supplier/type, 0 ambiguity notes on
  correctly-typed docs, 1 OFF→ON type flip = verified HEAL (untyped Vellum worksheet → worksheet).
  First run FAILED on gate mis-calibration (worksheet slug GT, blanket note-count, G-inert-on-corpus)
  — recalibrated per Oracle's real criteria, documented in the script.
- **Mid-session claim corrected**: my first "restart then reprocess heals the Copperfield docs" was
  WRONG — the veto fired but the reprocess merge resurrected the old value (owner caught it; Oracle
  2nd-pass; fixed in `72fe746`). Also `_doctype_fixed_supplier` found to be a production DEAD GUARD
  (`key` vs `field_key`) — NOT fixed deliberately; logged.
- **In-app verified by owner**: doc 181 healed (blank + veto note post-merge-fix); docs 170/180
  healed via probes on their actual PDFs. Queue-wide heal needs "Reprocess all in queue" (owner may
  have run it — verify state at the source next session, don't assume).

## FIRST ACTIONS (fresh session)
1. **Build Catch-up Filing — the owner-agreed next task.** READ
   `docs/designs/CATCHUP_FILING_2026-07-31.md` FIRST (the signed design; do not re-litigate the
   rulings). **Slice 1 = `confirmed_via` migration + scopeTrust human-window/corrections-SPAN rework
   + PINs** — feature-independent, riskiest seam, land it alone with its own realdoc A/B (byte-identical
   with migration applied + feature off is a HARD gate). Then slice 2 (predicate + IPC), 3 (renderer
   consent UI), 4 (gates + per-install flip of `scope_sweep_enabled`).
2. Verify queue state at the source (did the owner reprocess-all? docs 142-151 + the Ironbridge set) —
   one SQL, not an assumption.
3. Installer rebuild decision (close dev app first — EPERM; `npm run build`); owner also free to set
   `ocr_dpi` back to 300 (200 was speed-testing only; all fixes proven at 200).

## DEFERRED (designed / logged, NOT built — load-bearing conditions attached)
- **Catch-up Filing** (above) — every Oracle condition is in the design doc; slice order mandatory.
- **Slice C `_center_in_any` overlap-fraction** (the supp-merge doubling at source) — corpus-wide OCR
  text change, OWN session + full gate, never bundle (`pendingfeatures.md`).
- **Bank-less-supplier collision** (conf-95 unflagged, can auto-file) + **`_doctype_fixed_supplier`
  dead guard** (do NOT "fix" casually — activates a dormant conf-95 stamp path) + ratio-deflation
  poison loop — all in `pendingfeatures.md` under the veto residuals.
- **Teach follow-ups**: pass-1 type-heading reject in teach; Review ⊕ adoption of the clip-gate
  helpers; teach import-itself-instant (pending-row on `file_begin`).
- **Demo-corpus identity residuals**: Saltmarsh `'altmarsh` leading-glyph clip + Saltmarsh→Ridgeway
  cross-supplier identity (branding-primary class, `project_identity_branding_primary_20260728`).

## NEEDS THE USER (in-app)
- Visual smoke of the teach one-step confirm + label re-read (reopen teach; draw on the Ironbridge SO).
- "Reprocess all in queue" if not already run (heals fill notes/ambiguity/untyped docs corpus-wide).
- Installer rebuild + ocr_dpi decision (#3 above).

## KEY FACTS / PATHS
- Kill switches (ALL default ON unless stated): `TEMPLATE_FIXED_NAME_PRESENCE_VETO` ·
  `REPROCESS_ANNOTATED_EMPTY_WINS` · `TYPE_AMBIG_COHESION` · `HEADING_BAND_REREAD` ·
  `TEMPLATE_IDENTITY_GEOM_WITNESS`. S1 band arm (`TEMPLATE_IDENTITY_BAND_GRADUATE`) still OFF/dark —
  DO NOT FLIP.
- Fix sites: engine.py (`_flag_branding_conflict` un-named branch + `_prints_name_stats` + G shed at
  Stage 2.5a + `_should_shed_fill_note_geom`) · template_matcher.py (`_letterhead_cohort`,
  `_type_ambiguity`, `_band_siblings`) · ocr/heading_reread.py (rung 2) · process_docs.py (rung-2 call)
  · processing/handler.js (`mergeReprocessRows` annotated-empty + `supplierColumnBlanked`) ·
  templates.js (`supplier_prints_name` enrichment) · teach/renderer.js + shared/anchorLabel.js.
- Harnesses (read-only, live DB): `stress_test/demo_notes_gate.js` (DEMO_GATE_N env) ·
  `heading_band_probe.py` · `geom_witness_probe.js` · `teach_label_reread_probe.js` +
  `teach_label_probe_crops.py` · `realdoc_regression.js`. JS via
  `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron`; python `PYTHONIOENCODING=utf-8 py -3.12`.
- ⚠ Machine-wide env `TESSERACT` = the install DIRECTORY (invisible to bash echo; python children see
  it) — executing it = WinError 5; harnesses must use their own env keys + explicit exe path.
- Live DB `%APPDATA%\ScanFinder\docusnap.db` (`?mode=ro`). Demo corpus `Desktop\Demo Docs` (9 suppliers
  × 5 types × 20, 900 PDFs). Memories: `project_needless_flags_20260731` ·
  `project_catchup_filing_design_20260731` · `project_template_fixed_name_presence_veto_20260731` ·
  `project_teach_label_reread_20260731`.
- Agents this session: gary×3, Oracle×4, herald, barry (all advisory; every substantive change gated).
