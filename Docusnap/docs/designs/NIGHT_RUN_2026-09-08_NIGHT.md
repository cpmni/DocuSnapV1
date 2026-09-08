# NIGHT RUN — 2026-09-08 NIGHT (after the audit-fix build + re-audit + Chris comparison round)

> Convention: "going to bed" = start this doc at once, in order, under the night-run autonomy protocol — AUTO + SAFE items run;
> advisors free; Chris ALWAYS sandboxed; APPROVAL-CLASS items are logged for the morning and SKIPPED; anything DANGEROUS goes to
> the advisors and STOPS that item. No pushes, no switch flips, no live-DB writes, no builds while a harness arm runs
> (`ELECTRON_RUN_AS_NODE=1` on every harness launch — an un-flagged `electron.exe script.js` never exits). Every item ends with a
> DONE-ledger line in `NIGHT_RUN.md` and, where code moved, a commit with its pin. Anything not reached rolls back to the QUEUE.

State at the start: branch `feat/teach-side-overnight`, HEAD `362a367`, 41 commits since `eeb8d56` unpushed. Click-through target
`dist/ScanFinder Setup 2.0.0-r20260908-1843-9251551.exe` (the owner has NOT clicked through yet — a later rebuild may move the target;
the morning summary names the newest VERIFIED artifact). Live DB: ABSENT at the documented path (censuses use the post-137 reference
copy `TESTING/_measure/reset_arm_20260908/arm137.db`, 147 confirmed docs, or the 605 folder corpus). Chris sandbox still running on
CDP 9223 (PID 3200) — reuse or rebuild for item 6.

## Order (value-ranked; stop rules inline)

### 1. The 17 pre-existing red JS pins — triage every one (test hygiene; one may hide a real regression)
- Source: `npm run test:pins` sweep, log `TESTING/_measure/run_pins_20260908.log`; all 17 reproduce at `eeb8d56`.
- (a) The hand-rolled-schema class (5): `test_detected_type_nudge` / `test_page_count` / `test_recycle_bin` / `test_purge_and_bin_truth`
  (`no column named ocr_recipe`, mig 104) and `test_accept_correction` (`charset_flag_meta`, mig 102) — sync the fixture schemas
  to the migrations (the 2026-06 remedy). AUTO.
- (b) **`test_failure_creates_holding_row` FIRST among the rest** — its own summary says "the failure-row producer regressed" (7
  checks). Root-cause read-only: is the producer (`processing/handler.js` failure → `status=error` holding row + `error_message`)
  actually broken on a real import failure, or is the pin stale against the watch/import unification (`3953b8f`/`898c70e`)? If REAL:
  a product fix is ordinary bug work — design (gary) + pin, implement ONLY if it does not touch extraction/auto-file; else log for
  the morning. If STALE: fix the pin.
- (c) The other 11 one by one (`test_authoritative_anchor` 2, `test_v1_contract` `reading '0'`, `test_scope_auto_accept`
  `app.getPath` under RUN_AS_NODE, `test_activity_actions_columns`, `test_activity_strip` 4, `test_deskew_session`,
  `test_teach_speaks` "one shared speaker", `test_settings_wiring`, `test_doctype_surface_parity`, `test_teach_fragment_name_guard`,
  `test_teach_multipage`) — each is either a stale pin (fix it) or a real defect (root-cause, pin, fix if low-blast, else log).
- Gate: `npm run test:pins` → 325/325, and every fixed pin proven RED-first against the defect it guards (no dead-guard greens).
- STOP if a "fix" would change a reading/auto-file road: log + Oracle in the morning.

### 2. `--smoke-windows` — the automated layer for the re-audit P0 class (Oracle item 7, top)
- Today's smoke proves boot + DB only; the P0 (a renderer script missing from the asar) is CALL-TIME and only the owner's
  click-through sees it. Build the flag in `src/main.js`: after the smoke's DB open, open EVERY window hidden (main, review, settings,
  search, teach, help, welcome, tutorial, onboarding, license, legal, dev-inspector, unlock, update-lock), await `did-finish-load`,
  probe each renderer for its load-bearing globals (`window.ReviewReadiness`, `window.listCaption`, the preload bridge) and for any
  `console.error`/uncaught exception, then exit 0/5. The verifier runs it after `--smoke-boot` and REFUSES on 5.
- Seam to name: the windows must open against the throwaway userData with NO licence gate and NO login (the smoke already exits
  before both) — open the BrowserWindows directly, never via `enterMainApp()`; nothing shown (`show:false`), nothing written.
- Gate: RED-first pin (a stubbed asar missing `reviewReadiness.js` → refused), then ONE `npm run build:release` at the END of the
  night (after every arm is finished) → verifier green incl. the window probe → the morning's click-through target = that artifact.
- STOP if a window cannot load without login/licence state → log the design, skip the rebuild.

### 3. The Oracle's "before the next flip / census" prerequisites (test + harness only)
- `_name_band_read` REAL-PAGE pin (a small PIL image + monkeypatched `_read_lines_full`; the band-pick pins all inject the hook, so
  the real body is dead-guard-shaped today) + replace the two tautological pins (`test_runtime_test_arming:79`,
  `test_migration137:82`) with real assertions.
- `RR_ALLOW_ARMED`: the realdoc harness prints the arming marker + the count of ON `TEST_SWITCH_KEYS` in `_operating_point` and
  REFUSES an armed DB unless `RR_ALLOW_ARMED=1`; fold C9 = `RR_APP_ENV` default-ON (refuse without an explicit `RR_APP_ENV=0`).
  Then re-run the 136-vs-137 compare once to prove the harness still runs (non-vacuous).
- Gate: pins green; one arm on `arm137.db` byte-identical to today's `consensus_off.jsonl`.

### 4. The 4(b) heading-fold ARM (queue 2026-09-06; Chris's Statement card is its exhibit)
- OCR re-detect over the Desktop 605 corpus + the Hard Set (PDFs, no stored text) with `TYPE_UNINSTALLED_HEADING_FOLD=1` vs OFF —
  winner changes must be EXACTLY the uninstalled-heading docs (the live-copy text census already met 20/20 Ironclad → Statement,
  521 unchanged). Read-only harness; no flip. Result = the owner's flip evidence + the UX half ("add Statement as a type?" nudge
  on the picker = a design card for the morning, not built).

### 5. Chris's vet queue — READ-ONLY diagnoses + advisor designs (nothing implemented)
- **#5 Edit-role mailbox card "Type — / Unknown / Document —"** for the approver on a filed invoice — trace the mailbox document
  card's projection for a non-admin role (desktop mailbox IPC → `workflowService` → the card); FACT vs ASSUMPTION; if a real
  projection bug, gary designs the smallest fix + pin (build only in the morning with the go).
- **09-03 #1 Import list "Confirm to file →" after a MANUAL confirm** (open since 09-03, unvetted): trace why the import result row
  never re-reads the document status after `confirm-review` (the `watch db_id` fix `205143a` flipped the split rows; the manual-confirm
  road may lack the broadcast) — design + pin, log for the vet.
- **#1 Bundle issuer read from page 3 while page 1 is shown** — 007 + gary → Oracle: the honest cross-page provenance note on the
  issuer + a Split nudge when the issuer's source page ≠ the shown page on a multi-page doc; name the seam with
  `watch_separate_enabled` (the real fix for bundles) and with the type/identity election across pages. Design only.
- **#7 `✓ → undefined`** (`main/renderer.js:1158` prints `msg.new_filename` unconditionally) and the "Document Issuer box is still
  empty" note surviving a ⊕ fill — cosmetic; propose the one-line fixes in the morning list.
- **#8 same-sender rows identical after the truncation fix** — propose: when grouped by sender, the row shows the reference/date
  instead of repeating the sender. Design only.

### 6. Chris round 2 — the surfaces he did NOT exercise (sandboxed `/christest`, focus args)
- Split on the real 3-page bundle (the "original is permanently removed" clause), the Teach WIZARD (nav "Teach") end to end,
  Defer, Print, Export (CSV/xlsx/JSON), the separator sheet, Learning Repair, Straighten, the auto-import toggle off + a second drop,
  Settings backup export/restore (the dark-switch exclusion — he should see nothing odd). Same rules: sandbox only, cards logged,
  NOTHING implemented, verdict → `docs/CHRIS_FULL_APP_REVIEW_2026-09-09.md`.

### 7. Housekeeping (mechanical, safe)
- `client/` + `cert-tool/` `npm install` (Electron 44 already declared; no native modules) + a launch smoke of each.
- Re-run `npm run test:pins` + the Python pins touched tonight; `git status` clean except the owner's files; DONE-ledger lines.

## APPROVAL-CLASS — logged for the morning, NOT run tonight
- The scripted click-through + uninstall "remove all data" drill on the newest verified artifact → then the `build`/`build:store`
  default flip (plan 2.7b, Oracle C5) + retiring the "revert list" wording (C10).
- Push (41+ local commits).
- `watch_separate_enabled` SOAK (owner-machine, approval-class flip); the DB-encryption drills; the low-RAM VM batch-import checks;
  the Quick-check dropdown focus fix (focus landmines — eric's design only).
- Learning Repair: invoice docs #42/#25/#27/#40, Ridgeway 8/19/21, doc 99 `ws-55718`.
- Flips: mig-140 belts (mapper pair) with the §7.1 table; `type_uninstalled_heading_fold` with tonight's arm; `deskew_corrob_autofile`.
- Incorporation → signing; DB-at-rest; backend DocumentRoot + 2FA; `pip uninstall` the 9 dead packages + relock with hashes; the
  DPI/budget decision (Pelican `PI` at 200 DPI = the documented confusable trade-off).

## Morning summary must carry
Which of 1-7 ran, the pin count (`x/325`), the newest VERIFIED artifact name (if item 2 rebuilt), the heading-fold arm numbers, the
Chris round-2 verdict + cards, every diagnosis from item 5 as FACT/ASSUMPTION with its proposed fix, and the approval-class list above.
