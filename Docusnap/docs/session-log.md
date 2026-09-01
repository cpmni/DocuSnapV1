# Session-change archive (moved out of CLAUDE.md 2026-07-19)

> Verbatim archive of the CLAUDE.md "Recent session changes" blocks (2026-07-09 -> 07-19), moved here
> to keep CLAUDE.md a lean index. Nothing was edited or summarised in the move. Newest first.
> Per-session detail also lives in HANDOVER_*.md (repo root) + docs/handovers/ + docs/designs/.

## Recent session changes (2026-07-09 → 07-19) — durable mechanisms now in the code
### 2026-07-19 (branch `feat/reprocess-throughput-autostraighten`, **15 commits UNPUSHED** — ask before pushing; installer STALE `r20260718-0818-bea1028`)
**READ FIRST: `HANDOVER_2026-07-19.md`.** Opus-4.8 (1M) session. **(1) PRINT FLOW FIX (`75206fb`, ⚠ UNVERIFIED
LIVE)** — "Advanced printing" closes the custom modal + `alwaysOnTop`/`skipTaskbar` force the OS driver dialog
topmost (a `parent` on a `show:false` window can't) + an `isEnabled`-poll reaps the ghost window on dialog close
(fixes a cancel-path leak). eric-vetted; NEEDS an owner Windows/Ricoh live test (z-order + does it spool paper).
**(2) WORKFLOW SLICES 2 & 3 BUILT + committed, dark** (`a6e8153` decision snapshot / append-only `route_decisions`;
`92851ab` amount-threshold routing). **(3) ROUTING SETTINGS SLICE (`e85f646`) — CLOSES SEAM A + REFRAMES the
feature** (Barry-led): Review=data-completeness, **routing = a separate step firing at the FILING SEAM for EVERY
filed doc** (auto-filed via new `workflowService.assignSystem` NULL-sender + reviewed + bulk File-All-Ready = D2),
driven by admin rules in a new HIDDEN entitlement-gated **Workflow Settings tab** (sentence rule builder
APPROVAL-ONLY per Oracle D1, rules list, read-only dry-run). Engine adds type-only rules (skip the amount gate),
null-total shadowing fix, route-to-self vs role-SoD, immutable `matched_rule_summary` (a new `document_routes`
column). Barry→gary+eric→Oracle SIGN OFF WITH CONDITIONS. Spec `docs/designs/WORKFLOW_ROUTING_SLICE_2026-07-19.md`;
SEAM-A test `src/modules/processing/test_autofile_route.js`. **(4) MULTI-STEP routing (old Slice 4) DEFERRED**
(Barry: single-hop covers the home/small-office segment; the risky `document_routes` stamped-rebuild is
Oracle-signed C1–C8 but shelved). **NEXT = make the FYI/`acknowledge` action NON-LOCKING** (split `hasActiveRoute`
so only approve routes edit-lock, acknowledge still grants visibility+dedupe) + PRE-LAUNCH **E1 admin cancel-route**
(a null-sender auto-file route isn't user-recallable; editGuard override frees the doc not the route). New process
rule (memory `feedback_barry_new_features`): **include Barry EARLY on new features**, before the design/Oracle gate.
### 2026-07-18 NIGHT2 (branch `feat/reprocess-throughput-autostraighten`, last PUSHED `c9d32ec`, **11 commits UNPUSHED** — ask before pushing; installer STALE `r20260718-0818-bea1028`)
**READ FIRST: `HANDOVER_2026-07-18_NIGHT2.md`** (supersedes the NIGHT handover). A Fable-5 session; owner
returned to Opus. Two workstreams. **(1) WORKFLOW SLICE 1 BUILT — 5 commits `e66bc04`→`42a671b`, all DARK
behind `WORKFLOW_FEATURE_ENABLED=false`** (does NOT flip it — that's Slice 6). Removed the half-wired `paid`
state + idempotent boot HEAL paid→approved at the TOP of `runJsMigrations` (Oracle C1, un-brickable; KEY TRAP:
readonly+paid now → INVALID not FORBIDDEN, decision-check precedes role-gate) · reject→revise→resubmit (core
mailbox now shows the rejection REASON + "Send again" prefills the recipient + `resubmitOf` audit lineage) ·
pull-model notifications (ONE shared main.js `notifyWorkflowEvent` sink for BOTH transports, `notifyAllWindows`
fan-out, pure `src/lib/workflowNotify.js` debounce+fire-time-guards, Home "Waiting on you" card via
`get-workflow-counts` IPC, at-login digest, `GET /v1/workflow/counts` + client 60s poll) · reprocess
workflow-lock on BOTH doors (single-doc editGuard + batch skip-and-report, admin batch ALSO skips — pinned).
`test_workflow_ipc.js` known-fail is now GREEN (Stage D, test-side stub). Plan+gate:
`docs/designs/WORKFLOW_SLICE1_BUILD_2026-07-18.md` (gary+eric GO-WITH-CHANGES, Oracle SIGN OFF WITH CONDITIONS
1-4 folded). Corpus byte-identical to `workflow_slice1_BASELINE`; 18-suite battery green; dark ⇒ OFF structural.
**(2) PRINT — long UX saga, landed "modal works, functional-print UNVERIFIED" (6 commits `bf98389`→`9eb4377`).**
CONCLUSION: Electron 31 can't give the native/classic Windows dialog from `webContents.print` (always Win11's
modern dialog with the "doesn't support preview" pane — a **Windows-11** behaviour, not Electron; same message
from .NET); no permissive off-the-shelf PDF-print tool exists (all GPL/AGPL or $thousands SDKs). Current custom
modal: reactive preview (mono/range/N-up), driver dialog parented to Review (stays in front), and — the key
finding — **Electron's print callback is UNRELIABLE (doesn't fire on cancel, on a virtual printer's Save
prompt, or even a normal Ricoh job)**, so the modal is now callback-INDEPENDENT (watchdog re-enables). ⚠ OPEN:
**does the Ricoh actually print paper?** — decides "functional, move on" vs "build the banked design". Clean
native-dialog rebuild is DESIGNED + Oracle-signed but **BANKED**: `docs/designs/NATIVE_PRINT_2026-07-18.md`
(C2: ship a **compiled C# helper** not a `.ps1` — a GPO ExecutionPolicy overrides `-Bypass`; C1: LOCAL temp
not roaming; C4: block virtual/file printers by default). The `PreferLegacyPrintDialog` registry toggle was
REJECTED (eric WRONG-LAYER — system-wide mutation from an unsigned app; revert can't run on cancel). SEC-03
marked FIXED in `SECURITY_BACKLOG.md` (bookkeeping — was `f8299d4`).

### 2026-07-18 (branch `feat/reprocess-throughput-autostraighten`, ALL PUSHED through `bea1028`; installer `r20260718-0818-bea1028`)
**READ FIRST: `HANDOVER_2026-07-18_EVENING.md` (the Filing Slips day), then `HANDOVER_2026-07-18.md` (morning, template convergence).** Three workstreams. **(1) TEMPLATE FRAGMENTATION FIX (M#19/N#20) BUILT +
COMMITTED (unpushed), default OFF** — branding-fingerprint template convergence past the panel (gary/Phillip/
reggie/eric) + Oracle, control-test-first. `7d051f3` = **M2** (a drifted-logo taught confirm now REUSES its
branding-matched same-type template instead of spawning a duplicate; new shared `database/modules/
branding_fingerprint.js` = distinctive-token SYMMETRIC overlap; `templates.findByBrandingFingerprint` ≥3 shared
tokens/ratio≥0.80/same-slug; kill switch `TEMPLATE_REUSE_BY_BRANDING`, **default OFF ⇒ byte-identical**) + **N**
(Template Manager shows a LIVE confirmed-doc COUNT via `templates.getAllWithLiveCounts`/`confirmedDocCount`;
`getAll` — the pipeline reader — untouched; fixes "confirmed 0×"). `02fc10c` = **M3** (`database/modules/
templateMerge.js` `findMergeCandidates` + landmark-constellation STRUCTURE gate + `planBackfill`/`applyBackfill`;
admin "Suggested cleanups" UI in Settings→Templates; `merge-template-cluster` IPC takes a WAL-safe `db.backup()`
BEFORE `templates.mergeInto`). **M1 folded into M3's backfill.** Corpus OFF byte-identical (76 docs, M=0/M_type=0);
unit batteries (`test_template_reuse`/`_confirmed_count`/`_merge_plan`) + `db.backup()` smoke all green; a
read-only live-DB test confirmed N + the 6 real strays M3 would re-link. **⚠ OPEN (Oracle-first):** on the real
DB the merge one-click WON'T fire — the duplicates have NO landmarks → `group_or_review`; and the 4 PO fragments
don't cluster (template-level fingerprints diverge <0.60). Proposed refinement: no-geometry (no landmarks AND no
mappings) ⇒ safe-to-merge + lower/seed the cluster threshold. Spec + Oracle conditions:
`docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md`. **(2) SECURITY AUDIT → living backlog** (both gitignored /
LOCAL-ONLY — exploit detail): `SECURITY_BACKLOG.md` (SEC-01…20, priority-ordered, one-by-one) + `SECURITY_AUDIT_
2026-07-17.md`. Headline: **SEC-01** admin console no-lockout + 2FA-off (HIGH, only remote); **SEC-02** IONOS
signing key has no deny backstop — verify GET `/keys/*` is 403/404; **SEC-03** `/v1` read-endpoint authz;
**SEC-04** core↔client TOFU + dead pairing gate; **SEC-05** offline trial extension; client-side licensing tamper
= LOW (crown jewel = the SERVER signing key). Owner directive (memory `feedback-security-vigilance`): work the
backlog one-by-one + **proactively flag security holes any new feature could expose**.
**(3) FILING SLIPS ("Separator sheets") — DESIGNED (Oracle-signed) + SLICE 1 BUILT** — printable QR separator
sheets (90mm ECC-H `SFSEP-%04d` + corner minis) that split a scanned batch at each sheet AND remove the sheet
page; QR decode IS the decision, no-decode ⇒ no split (fail-safe). Panel oscar/gary/eric/barry (NEW advisor
`agents/barry-the-brainstormer.md`) → **Oracle SIGN OFF WITH CONDITIONS C1–C6**; owner answered all 9 open
questions "as recommended" (§10 of the spec). **SLICE 1 (detector + pipeline) BUILT, default OFF** — setting
`filing_slips_enabled` (default 'false') + env `FILING_SLIPS=0` hard-kill: new `ocr/slip_detect.py`
(150 DPI render + zxingcpp decode, anchored `^SFSEP-\d{1,6}$`, whole-file-or-abort, 500-page cap) +
`segment_docs.py --slips` (slips-first, slips-present ⇒ template segmentation SKIPPED = PIN #2, abort recorded
in reasons) + pure `src/modules/processing/split_plan.js` (`buildSegmentArgs` C1 + `buildSplitPlan`: 1-segment+
separator = REWRITE minFiles=1 = PIN #1 — never file a sheet inside a doc; only-slips ⇒ consume; C4 abort
never half-applies) + handler C2 DECOUPLED gate `(auto_separate && templatesFile) || slipsOn` (slips work on
zero-template installs, never re-arm template separation). Deps zxing-cpp (Apache-2.0) + segno (BSD-3) vendored
+ gated (check-vendor REQUIRED, BUILD.txt, notices regen — C5 same-commit). Tests all green incl. C1 real-spawn
E2E (`test_slip_e2e.js`), 31-check python battery, embeddable `-P` pin; PIN #1/#2 PROVEN to fail on reversion
(C6). Corpus: baseline `stress_test/out/filing_slips_BASELINE.md` (76 docs M=0/M_type=0) captured pre-code;
OFF-run identical. **SLICE 2 (generation + UI) ALSO BUILT**: `python_backend/filing_slips.py` (PIL+segno,
200 DPI A4 raster `resolution=200.0` load-bearing, duplex pairs, 90mm ECC-H QR + 2×35mm corner minis, frozen-
contract artwork) + `generate-filing-slips` IPC (admin/edit, clamp via pure `slip_pack.js`
clampSlipCount/nextSlipRange/slipPackName — counter `filing_slip_next_number` advances only on success,
restart-at-1 wrap, writes `userData/filing-slips/`, keeps newest 5 packs, 30s kill-timer OUTSIDE the batch
registry) + preload `generateFilingSlips` + Settings→Processing "Recognise separator sheets" toggle +
count+"Print separator sheets…" row + **C3 watch-folder warning** (toggle row + success panel when
`watch_folder_enabled`) + Import-view `#btn-print-slips` (inline msg, no native alert) + `slip_split`
process-trace event + Help section (`help/importing.html#separator-sheets`). Tests `test_filing_slips.py`
(ROUND-TRIP: every generated page decodes via the real detector, exact payload sequence; A4 geometry; -P) +
`test_slip_pack.js` green; div-balance checked. **LIVE-TESTED 2026-07-18: two bugs found+fixed during owner
testing** — `77e674e` IPC ReferenceError (`learning` is per-function-required in processing/handler.js, a
module-load smoke can't catch call-time references) + `bea1028` `userData/filing-slips` added to
`_allowedOpenRoots` (the F-06 open-file guard silently blocked "Open to print"). **SYNTHETIC PILOT PASSED on
the live app**: 3 composed batches (10-doc/9-sheet incl. rotated sheets; payment-QR control; defaced-sheet
control) → 13 docs to Review exactly as predicted, sheets removed, QR firewall held, fail-safe merged. Also
`a14bd08` Settings HIERARCHY RESTYLE (barry+eric consult, owner-picked): `.section-title` → small-caps accent
eyebrow + rule, labels weight 500, subs 65ch cap — settings-local style block ONLY (license window carries its
own class copies — do NOT move to theme.css). Installer `dist\ScanFinder Setup 2.0.0-r20260718-0818-bea1028.exe`,
branch PUSHED through `bea1028`. **SlipTest CLEANUP done** (13 test docs soft-deleted; ALL fake-supplier
learning purged — 17 hints + 5 logo fingerprints + 16 anchors + 4 templates, zero residue; lesson: 6 casual
confirms of fictional docs planted 42 learning rows). NEXT = real MFD pilot (scan degradation, the unproven
axis), then slice 5 watch parity BEFORE any default-ON flip (Oracle C3). Full session detail + honest
verification ledger: `HANDOVER_2026-07-18_EVENING.md`.
**(4) GENERIC DOCUMENT TYPE + AUTO-TITLE — DESIGNED (Oracle-signed C1–C6), NOT BUILT** (`da3fab0`, pushed,
post-handover): "General Document" fallback preset assigned at the Electron INSERT seam ONLY on detection-None,
paired same-commit with an unconditional `trust.js` `generic-type` auto-file refusal (**the whole wall at 100 —
the at-100 gate is GATE-FREE by default**, `strict_100_autofile` opt-in); Date stays required, satisfied by a
visible SCAN-DATE PREFILL; pure `title_pick.py` Auto-Title (empty-beats-junk pinned) as an extractions row,
generic-only v1; 'General' folder for this slug only; `{title}` token registered before any UI mentions it.
Oracle caught 2 panel-missed seams: reprocess = a SECOND insert seam (`applyReprocessResult`), and free-text
seeding would EAT the title via the printed "Title:" caption. Owner answered all 8 questions "as recommended".
**ALL SLICES 1-6 BUILT + PUSHED same day** (`6d54b2f` preset+refusal+template-skip · `20c0963` fallback both
seams + Review chip · `6e05803` scan-date prefill + glance aids + 'General' folder + Settings toggles ·
`59822d6` Auto-Title engine `extraction/title_pick.py` (empty-beats-junk pinned; C2 seeding + C3 hints
exclusions; AUTO_TITLE env via `auto_title_enabled`) · `4a4abe4` {title} token + NEW DEFAULT filename pattern
`{docType}.{date}.{ref}.{title}` (byte-identical for typed docs, pinned)). Also `2deed1b` = the 07-17 Option-A
duplicate-filing core committed as its own change (still unwired). Feature DEFAULT OFF: Settings→Processing→
"Unrecognised documents" (fallback toggle auto-creates the preset; Auto-Title sub-toggle). Corpus: slice-4 OFF
AND ON runs byte-identical to `stress_test/out/generic_doctype_BASELINE.md`; real-spawn seam test green.
REMAINING: owner live smoke (toggles ON → arbitrary letter → General Document + title + scan-date prefill →
Ctrl+Enter → `General/`); known minor gap: single-doc reprocess doesn't thread AUTO_TITLE (titles survive via
the merge carry). Spec: `docs/designs/GENERIC_DOCTYPE_2026-07-18.md`.
**(5) WORKFLOW SUITE + DOCUMENT PRINT — DESIGNED (Oracle-signed C1–C8), NOT BUILT; BUILD HELD** (`docs/designs/
WORKFLOW_SUITE_2026-07-18.md`). Separately-licensed approval + routing between LAN users + a driver-honoring
Document Print feature (owner asked for both). Barry-chaired panel (barry/eric/gary/security) + 4-beat web
research + Oracle SIGN OFF WITH CONDITIONS. **KEY: a complete single-hop approval MAILBOX ALREADY EXISTS** wired
end-to-end (document_routes + CAS + editGuard lock + PDF stamping + audit + workflow seat pool + core Search
mailbox AND detached client mailbox) held dark behind `WORKFLOW_FEATURE_ENABLED=false` (entitlementService.js:37);
entitlement pre-built for a 2nd paid module (signed token {core,search,workflow} features map). Suite COMPLETES
it. **Slice 0 = AUTHZ PREREQUISITE**: fix SEC-03 + desktop twins (6 by-id read holes) via ONE fail-closed
`canAccessDocument` (new src/services/accessService.js), `ACCESS_GATE_ENABLED` default ON — routing on unfixed
authz is a REGRESSION. Flagship = amount-threshold routing off the extracted total (Oracle C4 trust-gated).
Remove half-wired `paid` (C1). Print = `webContents.print({silent:false})` → OS/driver dialog (honors the
customer's printer driver, NOT a fixed Windows path — memory `feedback_print_driver_audit`), every print audited,
original-vs-stamped, `printing_enabled` default OFF; Print-Slice 1 (original) has no workflow dependency.
Owner answered all 8 decisions "as recommended". **SLICE 0 (authz) BUILT+PUSHED `f8299d4`** — SEC-03 fixed:
`src/services/accessService.js` `canAccessDocument` at all 6 by-id seams + desktop path-trust fix; kill
`ACCESS_GATE_ENABLED` default ON; `test_access_service.js` 28/28; corpus byte-identical. **PRINT: Print-Slice 1
`b9e8c03` + Print Preview `252c058` BUILT** (`src/modules/print/handler.js`; driver-honoring `webContents.print`,
our own preview modal since Electron omits Chromium's; kill `printing_enabled` default OFF). Workflow engine
**Slice 1 now BUILT 2026-07-18 NIGHT2 (see the top block); Slices 2-6 DESIGNED not built** (Oracle C1–C8).
Memory `project_workflow_suite_design`, `feedback_print_driver_audit`.
Full spec: `docs/designs/FILING_SLIPS_2026-07-18.md`; product origin
`docs/brainstorms/BARRY_2026-07-18_home-edition_generic-docs_separator-sheets.md`.
### 2026-07-17 EVENING (branch `feat/reprocess-throughput-autostraighten`, 3 commits UNPUSHED + Option-A uncommitted)
**READ FIRST: `HANDOVER_2026-07-17_EVENING.md`.** A testing marathon on the built app. Committed-unpushed:
`da4a5ff` template rescue no longer trusts the unstable logo (kill `RESCUE_ENFORCE_LOGO_BAND`, half-fix — MATCH
side only); `ba667b6` wizard Speed→Fast default + Review new-type modal focus repair; `1f30946` teach
label-picker word-ratio tiebreak (kill `anchorLabel.setRatioTiebreak`). Uncommitted: Option-A duplicate-filing
core in `filename_pattern.js` (`resolveDuplicate`, default byte-identical — NOT wired). Pushed earlier this
session: `25469e2`/`7298b10` single-doc reprocess parallelism B+C (default OFF, `DS_OCR_PARALLEL_FULLPAGE`/
`DS_OCR_PARALLEL_FIELDS`, Settings `ocr_parallel_reprocess_enabled` — owner load-test pending). Installer
`dist\ScanFinder Setup 2.0.0-r20260717-1415-7298b10.exe`.
- **⚠ ROOT CAUSE DIAGNOSED (not fixed) — the "no template match" family = MEASURED logo unreliability.**
  On scans the coarse 64-bit AND 256-bit logo hash can't separate suppliers (same logo drifts up to 36; ranges
  overlap). The KEYWORD BRANDING FINGERPRINT separates cleanly (0% cross-supplier false-match @0.80). Verified on
  the dev DB: Copperfield has 3 invoice + 4 PO + 1 sales templates (fragmented); `sales_order_05` branding overlap
  1.00 vs template 9 but logo dist 22 (a matching one = 1.00 / dist 6). **M (#19)** = `_upsertTemplate` reuse is
  still logo-gated (7–13 band) → spawns duplicate templates OR confirms template-less → fragmentation → new docs
  match none. Fix = reuse-by-branding-fingerprint + grow one logo set + merge duplicates (advisor+Oracle next).
  **N (#20)** = `confirmed_count` never incremented on confirm (roster shows 0×; may also block trust graduation
  — verify `trust.js`). Both queued; `da4a5ff` only did the MATCH half.

### 2026-07-16 → 07-17 (branch `feat/reprocess-throughput-autostraighten`, all PUSHED through `7298b10`)
**READ FIRST: `HANDOVER_2026-07-17.md`** (also `HANDOVER_2026-07-16.md` for the prior batch). Two features,
control-test-first (corpus baseline captured BEFORE any code; every stage kill-switched; OFF ⇒ byte-identical
to baseline M=1/M_type=0). **Core installer BUILT: `dist\ScanFinder Setup 2.0.0-r20260717-0754-e2a197e.exe`.**
- **Draw-tool UX — ⊕ field draw ~2s → ~0.45s** (`81a967d`/`504884e`/`c60a54e`): `ocr/region_core.py` (pure OCR
  shared by CLI + a NEW long-lived `ocr/region_worker.py` warm POOL, `src/modules/processing/regionWorker.js`)
  + parallel caption reads. Owner-validated → **DEFAULT ON** + Settings→Processing toggle
  (`ocr_warm_worker_enabled`) + `#ocr-overlay` fade. Kills `OCR_WARM_WORKER`, `DS_OCR_SINGLELINE_FAST`,
  `DS_OCR_TIMING`. (Corrected estimate: the warm pool is the WHOLE latency lever, not half → `tesserocr` deprioritized.)
- **Resolve-the-issuer + operator supplier PIN** (`de96611`/`e2a197e`, kill `SUPPLIER_PIN`): a colliding-logo
  mis-ID (Marlowe filed under Ridgeway) gets a **"Use '<name>'" button** (surfaces the branding-detected
  supplier; migration 49 `extractions.suggested_supplier`) + a per-doc **pin** (migration 50
  `documents.supplier_pin`, `resolve-issuer` IPC) that OVERRIDES logo/template on reprocess (engine
  `pinned_supplier`, `process_docs --known-supplier`, batch manifest carry) — method `operator_pin`,
  REVIEW-BOUND, writes NO logo learning, pin cleared on confirm. Badge shows **"Check"** not a misleading 100%.
- **⚠ PACKAGED-BUILD REGRESSION found+fixed (`5d5fd8c`)** — the draw-tool refactor's bare `import region_core`
  in `ocr/region.py`+`region_worker.py` crashed under the built app's EMBEDDABLE Python (its `python312._pth`
  drops the script-dir from `sys.path`), breaking Straighten/`--skew`/`--boxes`/the ⊕ draw tool in the PACKAGED
  build only (dev's system Python masked it). Fix: add `ocr/`+`python_backend` to `sys.path` before the import.
  **Durable rule: any spawned Python CLI must import siblings via `from ocr.x import …` after a `sys.path.insert`,
  never bare `import x`; reproduce with `python -P`; verify build-only fixes against `vendor/python`, not `py`.**
  Regression pin `tests/test_region_embeddable_import.py`. Second installer rebuilt with the fix.
- **DEFERRED — B-safety** (Resolve→Confirm-WITHOUT-reprocess poison seam): touches the SHARED confirm/learning
  path → too risky unattended; avoided by the flow resolve→Reprocess→Confirm; `SUPPLIER_PIN=0` disables all of B.
- **FINDING (pre-existing):** `logo_fingerprints.detail_hash` is NULL for every supplier — enrolment plants the
  256-bit detail into TEMPLATES not logo_fingerprints, so **Slice D (256-bit logo resolver) is partly INERT**;
  likely the deeper root of the Marlowe/Ridgeway (and Copperfield/Northgate) collisions. Its own investigation.

### 2026-07-09 → 07-15
**READ FIRST: `HANDOVER_2026-07-15_EVENING.md`** (repo root, 6 UNPUSHED commits). This session SHIPPED the
deferred TYPE-heading fix + more: **TYPE-heading fix BUILT + CONFIRMED live** (worksheet types as WSht) —
Part B column-aware heading SCORING + C1 refuse→review-hold + Part D confirm-path type-link detach
(`2168c85`, kills `HEADING_SCORE_COLUMN_AWARE`/`TYPE_REFUSE_HOLD`/`TEMPLATE_TYPE_LINK_GUARD`); **Slice D
enabled by default** (`LOGO_DETAIL_PRIMARY` 0→1, `51ea89d`); **review-UX** (`ae3a330` taught-dots re-scope
on issuer change + clear-suspect-reads + label-cluster banner fix; `c8ed1cf` V4 straighten icon + direct
Learning-History button; `809f4fa` position-only readout reword); **taught-ownership corroboration
exemption** (`c5ec661`, kill `TAUGHT_OWNERSHIP_CORROBORATE`). Per-install DATA (not committed): WSht type
(id 13) got aliases `["Worksheet","Work Sheet"]` — **a custom type is identified by its "Also appears as"
aliases, NEVER its arbitrary internal name.** **NEXT = the gary/Oracle-signed ISSUER positional-read DROP**
(`engine.py:2662`, kill `IDENTITY_POSITIONAL_DROP`, DESIGNED not built): fixes cross-supplier positional
issuer bleed — a swept position-only issuer teach makes SuperStore invoices read ANOTHER supplier's issuer
POSITION → junk "Item"/"Ship To:" (14 needs_review docs, nothing filed; audit: 0 confirmed wins use
positional issuer reads). Full spec in the EVENING handover.
Prior same-day: `HANDOVER_2026-07-15.md` (poison cleanup + Slice D BUILT default-off + 2 disambiguation-picker guards + icon restyle + the TYPE-heading fix DESIGN — now built).
Prior: `docs/handovers/HANDOVER_2026-07-14_NIGHT.md` (SUPPLIER+DOC IDENTITY overhaul). Earlier-shipped:
**Slice 1 `999898c`** (SuperStore garble guard, `SUPPLIER_CHROME_FRAGMENT_GUARD`) + **Slice 2 `109a9df`**
(DOCUMENT SOLUTIONS template-identity FILL, `TEMPLATE_IDENTITY_FILL`/`TEMPLATE_PRECEDENCE_CORROBORATE`).
**2026-07-15 (branch `feat/reprocess-throughput-autostraighten`, UNPUSHED, 3 commits): (a) Cascade↔Northgate
template poison CLEANED on the live DB (backup `docusnap.db.poison-backup-20260715-072322`) — supersedes the
old "templates 4/5/7 Cascade/Northgate" cleanup TODO; (b) `40994fe` Slice D — the 256-bit isolated-mark detail
hash PROMOTED from abstain-veto to PRIMARY supplier matcher, DEFAULT OFF (`LOGO_DETAIL_PRIMARY`), review-bound
@69+note, both-branch enrolment cross-plant guard — resolves Cascade↔Northgate AND Northgate↔Copperfield
collisions (measured NT intra 62 < inter 126); supersedes the "BIG proven-but-unbuilt" TODO; enable it by
flipping the switch on the next reimport (self-heals per supplier after 1 confirm), then the C7 field-scan/M=0
gate; (c) `1f02557` two disambiguation-picker guards (`CANDIDATE_OCR_VALIDATE` off-page-candidate drop +
`ANCHOR_CAPTION_BLEED_GUARD` fuzzy caption-bleed hold); (d) `b806fa1` Resolve/Straighten icon restyle. **[UPDATE: the type fix below was BUILT + SHIPPED 2026-07-15 evening — commit `2168c85`;
see HANDOVER_2026-07-15_EVENING.md. This is the design that got built.]** The system-wide document-TYPE
heading-authority fix — full spec + the 6 Oracle conditions (C1 was a
ship-blocker) in `docs/designs/TYPE_HEADING_AUTHORITY_2026-07-15.md` (PO→Invoice / Worksheet→Sales-Order: the
logo-sibling template type overrides the printed heading; the enhancement pass erodes the RED heading; and
`_upsertTemplate` reinforces the wrong-type template instead of borning the correct-type one — owner's 16
worksheet confirms are all mislinked).** Superseded
next-task: the auto-straighten field re-read (`docs/designs/DESKEW_FIELD_REREAD_2026-07-14.md`, field-scoped,
Oracle-signed, NOT built). Prior evening handover `…_2026-07-14_EVENING.md` (⑂ Resolve picker +
anchor-precedence/caption fixes, **MERGED to `main` via PR #10** = `6c93bb0`; reprocess worker cap 5→10). Earlier:
`…_2026-07-14.md` (skew type-flip + branding fuzzy + logo isolated-mark discriminator; MERGED in PR #10).
Earlier:
`…_2026-07-13.md` (review UX + Straighten-all + buyer-issued issuer guard; MERGED to `main` via PR #9 =
`ea9bdec`). Earlier: `…_2026-07-12.md` (identity/name guards) · `…_2026-07-11*.md` (the NIGHT batch).
Session write-ups live in `docs/handovers/` + `docs/night-reports/` + `docs/audits/`. Each fix has unit
tests (+ a corpus A/B where noted); all kill-switched + additive.

### 2026-07-14 — skew type-flip + branding fuzzy naming + logo discriminator foundation (ALL COMMITTED + PUSHED)
**READ `docs/handovers/HANDOVER_2026-07-14.md`.** Branch pushed to origin; working tree clean.
- **`8ab5bd2` — skew type-flip robustness (Fix A + B1).** Same-letterhead suppliers (one logo, several doc
  types → identical fingerprints) coin-flip the doc TYPE under MFD skew → wrong-type auto-file. Fix A
  (`TYPE_AMBIGUITY_GUARD`) HOLDS an ambiguous same-letterhead type on BOTH the logo-cluster (`_type_ambiguity`)
  and keyword-fingerprint (`_kw_type_ambiguity`, single-supplier cohesion C1) paths. Fix B1
  (`REF_PREFIX_RETYPE`) resolves the correct sibling from the doc's own ref-PREFIX + pins its template but
  KEEPS the review hold (Oracle rejected auto-file — the PO↔SO cross-reference hole). C2: pinned⇒held.
  Corpus A/B accuracy UP, M unchanged. Tests: `test_kw_type_ambiguity`/`_ref_prefix_retype`/`_type_ambiguity_flag`/`_template_type_ambiguity`.
- **`f06f349` — branding cross-check FUZZY-names the real supplier** from a garbled letterhead
  ("rthgate textiles"→"Northgate Textiles"). ISSUER-BAND scoped (`chrome_band.py`, stdlib — never names a
  mid-page recipient, positional not name-based), `own_ratio` stays exact+whole-page (fuzzing = fail-open),
  suggest-only + additive `suggested_supplier` for a future renderer button (**Slice 2 NOT built** — Oracle
  SEND-BACK the engine pre-fill; the value-change belongs at confirm-time). Kill switch `BRANDING_ALT_FUZZY`;
  corpus A/B byte-identical. `test_branding_conflict.py` extended.
- **`c0ac414` — logo isolated-mark 256-bit detail hash (INERT foundation).** `python_backend/logo_detail.py`
  (dependency-free pure-NumPy connected-components → isolate the compact mark → 256-bit phash; colour-free →
  B&W-identical; fail-safe None). GATE-0 proven on the live NT/CW pair (SEPARATED on colour AND B&W;
  inter 114 vs typical intra ~30). NOTHING WIRED → zero behaviour change. **NEXT: Slice B (migration +
  enrolment) + Slice C (abstain-only disambiguator at `identify_template` + JS `findLogoMatch`).** Colour
  RULED OUT (same-navy monograms + B&W strips it); structural mark-isolation is the fix. Tests
  `test_logo_detail.py`; gate `stress_test/logo_detail_probe.js`.
- **Diagnoses closed to root:** customer-drop hint-bleed = a SYMPTOM of the wrong-supplier resolution +
  poisoned Cascade scope (NOT a hint bug — the hint apply is fill-empty); self-corrects when supplier
  resolves right. Colour-vs-structural logo direction settled by GATE-0. See the handover.

### 2026-07-13 — review UX + session "Straighten all" + buyer-issued issuer guard committed (ALL COMMITTED → `f948112`)
**READ `docs/handovers/HANDOVER_2026-07-13.md`.** Working tree CLEAN; 4 commits ahead of origin (unpushed).
- **`6d72833` — buyer-issued issuer guard** (built by the prior session, committed now after re-verify):
  `engine._suppress_buyer_seller_issuer` DROPS a `supplier_name` keyword read whose matched label is a
  "Supplier/Vendor/Seller" caption on a buyer-issued type (ref role `po_number` OR trusted `purchase_order`
  title), unless operator-allowlisted — so a PO Document Issuer falls to logo/letterhead/hint or empty→review
  instead of filling with the VENDOR. Oracle C1–C5 applied; kill switch `BUYER_ISSUED_ISSUER_GUARD`. 6-for-6.
- **`1eceb9e` — A: import refusal is VISIBLE.** `startProcessing()` (main renderer) now shows the handler's
  `{success:false,error}` reason (source ⊆ output/Processed folder, licence, setup error) instead of a silent
  "0 processed". Gated on `error` present so a normal/partial-fail batch still renders results. (Diagnosed a
  live "won't process" report as a CONFIG issue — `processed_folder` was the PARENT of the import folder.)
- **`c0eeca4` — B: Reprocess All closes the doc on empty queue** (`autoCommitFullConfidence` nulls currentDoc
  + `clearDocPanel()`); **C: session "Straighten all"** — rail button `#btn-deskew-all` + `#deskew-all-bar`
  flyout with a min-skew-angle input (default 1.0°, 0.2–5.0°). ON → every opened doc auto-straightens AND
  Reprocess All/-sender force a straightened READ, but ONLY past the floor. ONE `--deskew-min-angle` flag,
  floor `max(0.2,user)` in `detect_skew_angle` (tesseract.py), threaded to BOTH read (`--deskew-pages`) and
  display (`region.py --deskew`); default 0.2° = byte-identical. C3 (oscar): batch manifest `ocr_text`
  SUPPRESSED when deskewAll (else deskew no-ops under `use_cache`). C2: flag persisted only by the apply/off
  handlers. **Straightened reprocess docs auto-file via the SAME gate as any read (owner's call) — corpus A/B
  (M must not increase) PENDING a rebuilt corpus.** Tests `test_deskew_min_angle.py` 10/10 +
  `test_deskew_session.js` 27/27. oscar+eric+Oracle signed.
- **`f948112` — advisor gap fix:** eric.md rule "grep the whole index.html before asserting a UI absence" +
  CLAUDE.md now documents the Review docked tool rail (`#queue-scroll-rail`) vs horizontal `#doc-toolbar`.

### 2026-07-12 — identity/name guards: wrong-supplier logo collision + customer-name heading garble (COMMITTED)
**Two committed fixes; HEAD `2ba919f`. READ `docs/handovers/HANDOVER_2026-07-12.md`.**
- **`2ba919f` — BRANDING CROSS-CHECK + logo cross-plant guard (wrong-supplier collision).** Thornbury
  dockets auto-filed at 100% as "Cascade" (colliding TF/CW monogram logos + a logo set POISONED with TF
  prints). `engine._flag_branding_conflict` at the finalisation seam (AFTER the identity-conflict block,
  skip if it acted): a resolved supplier whose OWN template keyword-fingerprint is absent from the page
  (own_ratio≤0.25, ≥3 distinctive words after `_BRANDING_STOPWORDS` strips generic doc-type words like
  "delivery"/"docket") → cap `supplier_name`≤69 + review NOTE (naming the branding-detected alternative) +
  needs_review. FLAG-ONLY — **the NOTE, not the cap, blocks auto-file** (trust.isAutoFileEligible). Covers
  logo + template_fixed + fixed-supplier paths; dependency-free (reuses `_keyword_hit_ratio`); works with
  identity_fusion absent (it's inert in packaged builds — rapidfuzz unbundled). Exempt ONLY manual +
  accepted_issuers (NOT template_fixed_locked/keyword_override — the closed hole). Kill switch
  `BRANDING_CONFLICT_GUARD`. `learning.saveLogoFingerprint` cross-plant guard refuses to plant a phash under
  X when it's closer to a different supplier's print (first-print bootstrap + manual bypass; UPDATE branch
  untouched). Oracle SIGN OFF /4 conditions applied (now 5-for-5). Corpus M(auto-file-wrong) 8→1 (the 1 =
  #98, a SEPARATE DELIVERY-DOCKET→worksheet TYPE issue). `test_branding_conflict.py` 17/17 +
  `test_logo_crossplant_guard.js` 7/7. **Owner will reset+reimport the test corpus — build+RESTART FIRST
  (save-guard runs in the main process) else it re-poisons.**
- **`4576c76` — HEADING-GARBLE NAME demotion.** A taught anchor's RELOCATED read landing on a caption garble
  ("Deliver To RRS") beat the clean keyword name (relocated reads are unconditionally located + null OCR
  conf → skip the Tier-A garble gate). Now demoted (`located_ok=False`→existing ≤50 cap) UNLESS it carries a
  protective structural word (`wordness.has_no_protective_token` keeps "Delivery Solutions Ltd" inert).
  anchor-local, demotion-only. Kill switch `HEADING_GARBLE_GUARD`. E2E `Deliver To RRS`@92 silent →
  `Primrose Childcare`@83. `test_heading_garble_demotion.py` 24/24; corpus A/B NEUTRAL, M=0.

### 2026-07-11 EVENING+++ — DIRECTION_SUPREMACY D1 (teach label-pick) BUILT — package COMPLETE
**Slice 3/3, own commit — closes DIRECTION_SUPREMACY (D2 = DO NOTHING).** The ⊕ teach used a
LEFT-FIRST early return: a garbled left-strip caption ('esha, i') was staged before the ABOVE strip
was even read, so a clean caption above ('Customer') was lost. NOW `captureAnchorContext` reads BOTH
strips, then `AnchorLabel.pickLabelCandidate(left, above, fieldCaptions)` picks: score 2 = matches
THIS field's own caption (FIELD-SCOPED bank = the field's display label via `labelFor`; NOT a global
bank, which would let a neighbour row's 'Date' outscore the true left caption — Oracle), 1 = clean,
0 = suspicious/empty; higher wins, TIE → LEFT (status quo), BOTH 0 → position-only (empty label,
never a staged garble). The COMMA-ORPHAN rule (a label ending ", <single letter>" = OCR fragment)
landed in the SHARED `labelLooksSuspicious`, retro-benefiting the existing suspicious→position-only
downgrade. Renderer-only (teach-time; extraction untouched) → no corpus A/B; `test_anchor_label.js`
D1 battery (incident 'esha, i' left vs 'Customer' above → above wins; tie→LEFT; both-0→position-only;
comma-orphan boundaries) all green, both files `node -c` clean. forceDir (Left/Above toggle) still
pins one side. NEEDS A RESTART to load (renderer JS).

### 2026-07-11 EVENING++ — DIRECTION_SUPREMACY G3b (known-caption value guard) BUILT
**Slice 2/3, own commit.** For a name-like/party field (CUSTOMER-SIDE — supplier_name EXCLUDED
explicitly, NOT via `_IDENTITY_FIELD_KEYS` which still lists customer_name), a candidate VALUE that
IS a known caption dies AT GENERATION in `keyword._search_for_label` (blanked at 'right' → falls
through to 'below'; skipped at 'below') — so a printed caption ("SO #", "Order Number") never fills a
name field (the incident: customer_name read the "SO #" caption). Reuses the c2 SHARED vocab
`keyword.build_caption_vocab`/`value_is_caption`; the engine builds it once + the armed-key set
(name-like ∧ ≠supplier_name) and threads both into `extract_fields`. Kill switch env
`KNOWN_CAPTION_GUARD` default ON. Broader than the role_caption='party' `_is_caption_fragment` guard
(whole RUN vocab, fires even when role_caption is None — the shipped customer_name pattern carries
none). Engine wiring confirmed LIVE (caption_guard_keys=['customer_name'], 206-caption vocab — the
c2 lesson). `test_known_caption_guard.py` 18/18. **A/B (same 2495-doc DB, ON vs OFF): perfectly
NEUTRAL — M 9=9, per-field IDENTICAL, regressions 58=58** (customer_name isn't corpus-scored, so the
gate proves NEUTRALITY; positive evidence = the unit battery + the incident smoke test). Remaining:
D1 (teach label-pick). D2 = DO NOTHING.

### 2026-07-11 EVENING+ — DIRECTION_SUPREMACY c2 (taught-field ownership guard) BUILT
**Second queued design; first of its 3 slices (c2→G3b→D1), own commit on `28d31c5`.** A NON-identity
field whose FINAL read is a plain 'keyword' match, while the user AUTHORITATIVELY taught that field's
position for this scope (⊕ anchor w/ last_authoritative_at, admissible), is a generic-caption stand-in
for a taught position that didn't confirm on this page → HOLD-ONLY cap ≤69 + note (value untouched,
review-bound). `engine._flag_taught_field_ownership` at the guard seam (after the dup guard, BEFORE
identity rescue); kill switch env `TAUGHT_FIELD_OWNERSHIP` default ON. Exempt: keyword_override (method
≠ 'keyword'), empty/None, and a keyword value agreeing with a same-scope confirmed HINT that would fill
(true `_apply_hints` variability parity) UNLESS the hint is itself a caption (poison-loop deny). Shared
caption vocab `keyword.build_caption_vocab`/`value_is_caption` (token-tuple + alnum-joined rules, NEVER
containment; 'SO #'→('so',), 'S.O.No.'→'sono') — G3b reuses it. `test_taught_field_ownership.py` 23/23.
**⚠ BUG CAUGHT pre-commit: the design premise "field_anchors.document_type stores the NAME" was WRONG —
it stores the SLUG (verified live + matches `engine.py` `extract_with_anchors(…, document_slug, …)`); c2
first passed the NAME → `owned` always empty → a DEAD guard (0 caps), and the unit test FALSELY PASSED
(name-consistent frame — the "dead guard greens every test" trap). Fixed to `document_slug`; added a
load-bearing `admitted by SLUG not NAME` pin.** Identity exclusion is PER-TYPE (supplier_name always;
customer_name only when SOLE issuer — post-migration-44 customer_name is a RECIPIENT field c2 must ARM,
NOT via the stale `_IDENTITY_FIELD_KEYS` that still lists it). **A/B (same 2495-doc DB, ON vs OFF): net
SAFETY WIN — M 12→9 (caught 3 high-conf ref misreads on taught fields #2357/#2566/#2572, ZERO added to
M), per-field accuracy IDENTICAL (HOLD-only), silent regressions 42→41. Cost: 245 caps → +128 docs (5%)
newly review-bound (user's taught-field-suppression rule; disable via TAUGHT_FIELD_OWNERSHIP=0).**
Remaining DIRECTION_SUPREMACY: G3b (known-caption value guard) · D1 (teach label-pick). D2 = DO NOTHING.

### 2026-07-11 EVENING — gate-failure targeted RE-READ BUILT (REREAD_ESCALATION, default ON)
**First of the 5 queued designs, built on the committed batch `838de51` as its OWN commit.** When
Stage 4.5 WITHHOLDS a structured value on format grounds (engine.py withhold branch → value=None),
take ONE bounded second look: relocate the garble on the page (fresh PSM-3 `image_to_data`, cached
per-extract), tight-crop re-read via the anchor crop ladder (`_crop_and_ocr`), and adopt ONLY a
read that PASSES the exact gate the original failed (learned-format `check_value` clean) AND is KIN
to the garble (edit-distance ≤2 on alnum forms). REVIEW-BOUND by construction — conf≤69 + note +
corrected_to (three independent auto-file locks, all below the 88 critical floor) — so it can NEVER
auto-file; abstains (byte-identical withhold) on born-digital pages (new per-page `provenance_out`:
`tesseract.extract_text_and_images` → `process_docs` → `engine.extract page_provenance`), ambiguous
locate, or any non-adoptable read (fail-safe). Kill switch env `GATE_REREAD` (default ON; `=0`
disables). Pure/injectable module `ocr/targeted_reread.py` (`is_adoptable` + `locate_value_region`
n-gram/label-adjacency/abstain + `reread_field_value` seam #1 re-check) wired via engine
`_maybe_gate_reread`; `tests/test_gate_fail_reread.py` 27 units. **A/B (SAME 2494-doc DB, ON vs
OFF): M IDENTICAL (12=12 — the re-read adds ZERO to auto-file-wrong), ref +3 correct (3 pure recall
wins null→correct #1886/#2354/#2335), all 5 adoptions correct/more-correct + review-bound, every
other field byte-identical.** E2E: #2408 adopts `SO-27481`; #2392 fail-safe abstains (crop still
garbled '$0-51337'). Design + Oracle conditions + BUILT note: `docs/designs/REREAD_ESCALATION_DESIGN_2026-07-11.md`.
⚠ Corpus-health follow-up (ORTHOGONAL, new-data, not this change): 7 new invoice-ref misreads
(#2566/69/70/72/75/76/85 — a new supplier's `mbdN…`/`IN/26/…` refs, `/` dropped) auto-file wrong —
extends the standing Cloudpeak high-conf-ref-misread class; reggie pass queued.

### 2026-07-11 DAYTIME — slip-fixer FIXED+WIDENED · 5 designs Oracle-closed
**READ: `docs/handovers/HANDOVER_2026-07-11_DAYTIME.md`** (full detail; this is the index).
- **SHIPPED (uncommitted, tested):** (1) slip-fixer ORIENTATION VETO — proposer extracted to
  `src/windows/shared/slipFix.js`; letter↔digit proposals need the candidate's own neighbour
  classes to agree; manual ✎ renames deliberately veto-free; (2) fused-pair DELETION widening —
  `S0O-51337`-class heals ONLY toward an exact learned witness + orientation. `test_slip_fix.js`
  38/38 + live-DB sweep `stress_test/slipfix_sweep.js` PASS. NO corpus run BY DESIGN (zero
  pipeline files). **Ban lifted** — but a Review window opened before the fix runs the OLD code
  (reopen to load). (3) "Dated" added to order_date labels (`tests/test_date_labels.py` 7/7).
- **5 DESIGNS CLOSED (Oracle SIGN OFF WITH CONDITIONS; build AFTER the batch commits, each its
  own commit + corpus A/B) — the conditions live in `docs/designs/*_2026-07-11.md`:**
  REREAD_ESCALATION (Stage-4.5 withheld ref → pixel re-read, ≤69+note; 9 conditions) ·
  ACCEPTED_DEBRIS (Accept button on the trim flag; scoped issuer+doctype+field; C1 crosscheck
  rail blocking) · DIRECTION_SUPREMACY (c2 ownership guard + G3b known-caption guard
  customer-side + D1 teach label-pick; D2 sweep-guard = DO NOTHING; builder traps recorded) ·
  CROP_GEOMETRY (read-time snap-to-glyph retry INTRUSION-only + teach-time box snap).
- **Recorded seams/follow-ups** (detail in the handover + design docs): qualification-withhold ×
  reprocess-merge keeps stale pre-gating junk unflagged; crosscheck side-pick prefers label-side
  debris over agreeing crop+keyword (doc 2378 repro); Stage-2.5d can reproduce the inversion on
  poisoned constant-code dominants; read-time witness-deletion rung (user-proposed companion to
  the re-read). Live wins: Bramble learning clean; customer anchor #158 re-taught, generalizing.

### 2026-07-11 MORNING — "Fix likely slips" INVERTED live (tool defect; fix cycle APPROVED)
- The Learning-History slip-fixer (`computeSlipFixes`, review renderer → `renameFieldValue`) is
  COUNT-BLIND: it renames toward the ≥80% in-scope column consensus, with no orientation guard on
  symmetric confusion pairs (0↔O/$↔S/1↔I). On (Bramble & Finch, sales_order, sales_order_number)
  the majority was itself the poisoned ZERO form (3 mis-confirmed `S0-…` docs), so it renamed the
  two LEGIT values majority-ward: 1879 `SO-66820`→`S0-66820`, 1886 `SO-27481`→`S0-27481`. Blast
  radius = learning tables only (extractions/corrections/hints; `documents.reference_number` +
  filed files untouched — the filenames PROVED the inversion). Undo = five ✎ renames toward `SO-`
  (66820/27481/55005/51337/33736; each also drops the stale hint) — VERIFY landed before touching
  learning. **"Fix likely slips" ban LIFTED — fix SHIPPED 2026-07-11 daytime (block above); safe
  once the Review window is reopened on the new code** (an already-open window runs the old
  proposer). (The NIGHT++++ note + gt_overrides 1880 `why` used to say the opposite — corrected.)
  **USER APPROVED the fix cycle ("yes, run it") — first job next session, don't re-ask:** gary+
  reggie design → Oracle last; smallest slice = block wrong-ward proposals (alpha-prefix
  letter-prior, cross-supplier/doc-type-wide consensus agreement, filename confirm-time record;
  propose NOTHING rather than invert); pin the inversion scenario in a test. Design brief in
  `docs/handovers/HANDOVER_2026-07-11.md`.

### 2026-07-10 NIGHT++++ — SLICE 1 BUILT ANYWAY (explicit USER POLICY OVERRIDE of the gate)
- The owner overrode the Slice-0 do-nothing gate ("belt-and-braces over conditional deployment"),
  so the runtime guard SHIPPED: `value_quality.contains_structured_sibling` (pure predicate —
  whole-value token-bounded containment on normalise_for_tokens forms, sibling len≥5 + ≥1 digit;
  kills the year/pure-alpha/mid-token classes) + `engine._flag_cross_field_duplication` at the
  post-merge guard seam (after the recipient guard, BEFORE identity rescue — gary's composition).
  HOLD-ONLY: name-like non-exempt (manual/template_fixed*/keyword_override) field whose value
  contains an UN-NOTED ≥80-conf non-name sibling's whole value → cap ≤69 + note + needs_review;
  value never touched; an existing wordness note is preserved (cap still applies). The SWEEP now
  IMPORTS the same predicate (offline regression twin; post-refactor re-run reproduces 1 hit /
  0 silent exactly). Tests: `test_cross_field_duplication.py` (incl. the PINNED trade-off: a legit
  "Name REF" compound layout flags every doc until a slice-2 evidence exemption) + six neighbour
  suites green. **Oracle: SIGN OFF WITH CONDITIONS** — seams verified (dup-cap→rescue composition
  REAL; boost-skip intended; conflict-note overwrite lossy-but-safe; no renderer accept-button
  leakage; auto-file TRIPLE-LOCKED incl. at-100). A2 APPLIED same night: the helper's
  `_needs_review` set was DEAD code (the pipeline reassigns unconditionally) — removed; 69<70
  threshold + the note ARE the routing (test reworked to assert the real mechanism + pin
  no-dead-set). REMAINING CONDITIONS: (1) corpus A/B overnight (M=0, zero per-field drop,
  flag-delta eyeball — esp. address⊃postcode / ship_to⊃PO classes); (2) FAST-FOLLOW: pass
  accepted_names/accepted_issuers into the guard (the ONLY name guard ignoring the operator
  allowlists — a compound-layout install has no in-product escape until then; workaround: type
  the value = manual exempt, or re-teach excluding the ref); (3) slice-2 notes: evidence
  exemption, label-aware name-likeness (key-only today — a `field_7` labelled "Customer Name"
  is invisible). READ THE CORPUS OUTPUT BEFORE COMMIT.
- **✅ TRIAGED 2026-07-11 morning — the RED was GT-NULL POISONING, not a code regression.**
  #1777/#1786/#1788 are AW_sal_* Ashford Wholesale sales orders CONFIRMED WITHOUT AN ISSUER in the
  early testing era (filed under `Unknown-Company\` on disk — the stored paths prove it; 1777's
  letterhead was read as 'Ashford Wholesale' in the 07-10 probes). The pipeline NOW resolves the
  correct supplier; the harness scored the right answer against a null answer key. The +5
  regressions account EXACTLY: these 3 supplier rows + doc #1778's known ref/date pair. REMEDY per
  house convention: `gt_overrides.json` gained the 3 entries (NEW `poisoned_supplier` support in the
  harness applier — `""` means "DB issuer must STILL be null", self-validated + fname-pinned;
  non-destructive). Corpus RELAUNCHED with overrides — expect M back to the known Cloudpeak 4.
  OPTIONAL user cleanup: re-file the 3 docs to Ashford in-app (edit-in-place), then REMOVE the
  entries per the file's convention. (Superseded RED note below kept for the record.)
  **RERUN RESULT (07-11 morning): supplier 99.9% (the 3 Ashford rows now score correct), all 10
  overrides applied / 0 skipped, M=5 = the known Cloudpeak 4 + #1880 (BF_sal_24)** — triaged:
  DUAL cause: (a) GT mis-confirmed 'S0-51337' with a ZERO (the 0/O slip class; true SO-51337 per
  the sibling pattern; gt_override ADDED — the doc stays a VISIBLE regression since the
  pipeline's own read 'S0O-51337'@90/keyword is also imperfect on this rough scan — honest and
  intended); (b) the read itself = the SAME class as the Cloudpeak 4 (high-conf keyword ref
  misread on a rough scan clearing the 88 floor) — FOLDED into that standing triage item.
  Tonight's guards are NON-CAUSAL for the read (shipped 'Order Number' label, pre-existing; the
  new guards only push review-ward; the current-tree faithful run lands the doc review=TRUE —
  the fail-safe holds live; the harness M is eligibility-boundary jitter via the customer
  field's read). ⚠ The remediation originally queued here ("Fix likely slips, S0→SO") MISFIRED
  2026-07-11 — the tool renamed majority-ward INTO the poison; see the 2026-07-11 MORNING block.
  Remediation is now the five manual ✎ renames + re-confirm 1880.
- **⚠ OVERNIGHT CORPUS RESULT (2026-07-10 ~23:30): RED — DO NOT COMMIT UNTIL TRIAGED.** Corpus
  2,106→2,253 (evening confirms). Regressions 29→34 (24→28 silent); ref 99.2→98.9; supplier/date
  held/up. **M = 8**: the four KNOWN pre-existing Cloudpeak refs (#2068/70/74/82, kill-switch-proven
  non-causal earlier) **+ THREE NEW: #1777/#1786/#1788 — all sales_order, all wrong on SUPPLIER,
  all OLD docs that were clean in the previous run.** The variant-adopt slice CANNOT be the cause
  in-harness (realdoc's snap() never passes --identity-conflict → the conflict block never runs
  there) — suspects: the C2 weak-core locate exception (anchor.py — NO kill switch), the name-lock
  Layers A/B, or GT drift from the evening's rapid confirms. **MORNING TRIAGE (before commit):**
  per-doc A/B of #1777/#1786/#1788 supplier reads — working tree vs `git show HEAD:` copies of
  anchor.py (the ab_offenders.py pattern in the session scratchpad; swap the file, rerun the doc,
  diff supplier value/method) → if C2/Layers causal, fix-or-gate before commit; if GT drift,
  annotate like the City Office class. Also eyeball the +5 regressions + the ref dip against the
  new-doc population (Cloudpeak-class growth). The duplication guard is FLAG-ONLY and cannot
  change values (any value delta from it = a bug — Oracle).

### 2026-07-10 NIGHT+++ — cross-field duplication guard: SLICE-0 GATE SAID DO-NOTHING (superseded by the override above; the sweep + gate reasoning remain the record)
- The KO_wor_41 class (a wandered relocate committing a SIBLING structured field's value into a
  name-like field: customer="Reference 'WS703182" while reference_number=WS703182@95). Bob+gary
  designed a two-slice guard; **Slice 0 (the decision gate) ran 2026-07-10 night**:
  `stress_test/crossfield_sweep.py` (READ-ONLY, permanent tool — re-run on the next sighting)
  swept 2,360 docs / 7,261 extraction rows with the exact Slice-1 predicate (name-like target
  non-manual; sibling non-name-like, normalised len≥5, ≥1 digit, conf≥80, un-noted; whole-value
  token-boundary containment on normalise_for_tokens forms). RESULT: **1 hit in the entire
  corpus — KO_wor_41 itself — already noted by wordness. Silent residual = 0 → documented
  DO-NOTHING**; wordness's live coverage of this class is currently complete. Slice 1 (pure
  predicate in value_quality.py + flag-only cap≤69+note beside the engine ~2547 guard seam,
  digit/boundary/method-exemption FP rules, the pinned compound-layout nag trade-off) stays a
  READY DESIGN in gary's 2026-07-10 feasibility report — build it ONLY when the sweep shows a
  silent hit (his named structural risk: wordness self-disables on scopes whose confirmed
  history went code-like, so re-run the sweep if a scope's wordness goes quiet). Related
  later slices (own Oracle passes): same-field variant preference (sighting 2), relocate
  geometry (007-led, evidence-first).

### 2026-07-10 NIGHT++ — focus repair COMPLETED (the "no caret but typing works" cure)
- **Root cause (eric, telemetry-proven)**: the repair edge was ASYMMETRIC — `blurWebView()` is
  WIDGET-level and its focus-DROP always lands; `wc.focus()` is VIEW-level and EARLY-OUTS with no
  renderer message when aura focus never moved (window stayed OS-focused — true in every broken
  press: 17-run telemetry `suspect=false pageHasFocus=false winFocused=true wcFocused=true`). So
  every edge was a NET page-focus drop: Blink `focused_` stuck FALSE → no caret/:focus/hasFocus,
  keys still route to activeElement (typing works). Explains BOTH the original "broken everywhere"
  era AND the milder stranded state. TWO stale polarities: post-dialog renderer hasFocus() lies
  TRUE (suspect-arming catches it); post-child-close it's truthfully FALSE (only a renderer-read
  can catch it) — both needed.
- **Fixes (focusRepair.js + preload + main; test_focus_repair.js extended, all green)**:
  (1) THE RESTORE HALF — `blurWebView(); focusOnWebView(); wc.focus()` (focusOnWebView =
  documented widget-level counterpart, RenderWidgetHost::Focus, ZERO OS activation — the
  win.blur/win.focus storm invariant holds); edge gated on `win.isFocused()` (a proactive draw
  edge must never stamp page focus onto a background window); returns {edgeRan} (IPC reply +
  telemetry `forceEdge=` added). (2) forceEdge — the preload's (C) one-shot re-issue (fires ONLY
  after an invoke-ordered repair + double-rAF STILL measures hasFocus()===false; unreachable from
  a healthy click; capped at one) now sends `forceEdge:true` which the edge honours — the old
  payload was deliberately ignored, leaving the self-heal TOOTHLESS (the latent revision bug).
  PINNED: pageHasFocus alone NEVER fires the edge (the at-rest OR-fallback stays dead); first-pass
  payload never carries forceEdge. (3) CHILD-CLOSE ARMING — browser-window-created hook:
  `win.on('close') → getParentWindow().__focusSuspect = true` (dropdown pin safe: <select> popups
  aren't BrowserWindows). REJECTED by eric: caret nudges (setSelectionRange/el.blur+focus — wrong
  layer, page-focus bit is the gate), wc.isFocused() gating (truthful for key routing, blind to
  the renderer bit), draw-path send→invoke (FIFO ordering + self-sufficient edge). NEEDS RESTART.
  **Oracle: SIGN OFF WITH CONDITIONS (applied)** — his headline: the restore half RETRO-FIXES the
  morning's own armed heals (all three arm sites ran blur-only NET-DROP edges — how the runs were
  manufactured); F3 child-close arming is safe ONLY because of F1 (both pinned together). C1
  comment fix applied (help/license are PARENTLESS → never arm; covered by (C) forceEdge).
  ⚠ FAST-FOLLOW (Oracle C3, non-blocking): the dialog wrap is REVIEW-ONLY — 44 native
  confirm()/alert() sites elsewhere (34 in Settings) leave stale-TRUE desyncs unarmed. The wrap
  CANNOT move to the preload (contextIsolation: overriding window.confirm there wraps the
  ISOLATED world's copy — page code never calls it; it would silently do nothing) — replicate
  the review renderer's 6-line IIFE via a shared MAIN-WORLD script per window. Optional
  hardening (recorded, not built): conditional __focusSuspect clear on edgeRan. Manual gate
  (A-F scenarios) required before commit+build.

### 2026-07-10 NIGHT+ — template NAME-HEAL widened (the postcode-named-template report)
- A template born at a supplier's FIRST confirm is NAMED from whatever sat in the Document-Issuer
  field (by design, `_upsertTemplate`; slug derived + frozen) — a wrong first detection birthed
  `name='BT23 1BE'` (slug bt23_1be, later hand-renamed 'Pinnacle') and `name='Ref'` (4 confirms).
  The old heal renamed only still-GENERIC "<Type> Template" names. NOW: `templates.
  shouldAdoptIssuerName(current, issuer)` (pure, exported) — a later confirm's PLAUSIBLE issuer
  (learning.isPlausibleSupplierName, and never a postcode) is adopted when the current name is
  generic OR shape-implausible ("IN"/"36552") OR a UK POSTCODE (regex twin of validation_patterns.
  postcode_uk — postcodes PASS the plausibility shape test, hence the extra rule) OR a single bare
  DOCUMENT-CAPTION word (Ref/Invoice/Total/… frozen set). A plausible hand-given/adopted name is
  NEVER touched (no flip-flop); documented residual: a hand-named ≤3-char ALL-CAPS brand ('DHL')
  re-adopts the issuer (cosmetic; pinned). Wired in review/handler `_upsertTemplate` reuse branch.
  `test_template_name_heal.js`. Template 20 ('Ref') self-heals on its next confirm. ALSO REPAIRED:
  `test_supplier_identity_persistence.js` fixture lacked the `extractions` table the EVENING
  confirm-upsert now writes (pre-existing break since that batch, crashed on require) — table added.

### 2026-07-10 NIGHT — Sales-Order anchor/label geometry (MP_sal_35 'Sso'@91 + "SO #" captions)
- **Diagnosed on the real scan (trace-proven), 3 axes**: (1) the ⊕ LEFT label strip was exactly rect.h
  tall at the VALUE's y — a bolder/higher caption ("SO #") got DECAPITATED → 'sok' → extractLabel's
  ≤3-char reject → position-only teach (the vertical twin of the above-band bug); (2) short captions
  structurally locked out (sanitize stripped '#' → weak 2-char "SO" label; ≤3 tails rejected);
  (3) THE INVERSION: the taught below-anchor's label-lock INLINE HARVEST is CROSS-COLUMN by
  construction (007) — rigid crop read the CORRECT 'Formby & Sons', rejected off_row_drift; the
  harvested junk 'Sso#' cleared every gate (single-token skips the multi-word name gate; '#' pushed
  name_quality to 1.0; ocr_conf NULLED on relocate paths → OCR cap blind; synthetic conf 87-92 has no
  quality term; wordness missed by 0.16 logprob) → committed @91 UNFLAGGED. DPI theory half-disproven
  by probe: tight 108-DPI crops read clean; 300-DPI source = robustness margin only (deferred design).
- **Fixes (oscar+007+reggie designed, gary consolidation-reviewed)**: LEFT strip centre-expanded 1.8×
  (review captureAnchorContext + teach autoLabel) + shared `nearestRowTo` row-pick (anchorLabel.js
  `_groupRows` refactor shared with nearestAboveRow) so a neighbour row can't hijack the column pick;
  SHORT_CAPTION allowlist in extractLabel (closed class [SP]/?O|[SP]\.O\.?|REF|NO + one [.#:], glued
  'SO#'→'SO #' normalised — spaced locates 1.0 vs SOLD-TO 0.5, glued fuzzy-TIES 0.667 both) +
  sanitize keeps a STANDALONE '#' — landed in BOTH twins (anchorLabel.js + learning.js — divergence
  re-strips AND NULLS the drift offset; pinned in test_anchor_phantom_display_label.js) + 9 shipped
  S/O-S.O.-"SO #" sales_order_number labels (longest-first!) + `_label_score` boundary guards made
  conditional on alnum needle edges ('#'-terminal needles match glued values). **anchor.py NAME-GUARD
  Layers A+B** (`_name_junk_shaped`: key-only is_name_like_field, judged on the NON-ALNUM-STRIPPED
  form, single-token <4 letters or name_quality<0.5): A = the label-lock replacement keeps a
  multi-word name-quality rigid over a junk-shaped candidate (reject event
  `name_guard_junk_candidate`), B = relocated/inline junk-name commits capped ≤70; both flag via
  `_relocate_guard_note` (SEPARATE slot from _xcheck_note — the crosscheck can flip the value; never
  overwrites a method note). off_row_drift untouched; the 2026-07-06 drift-fix class pinned
  replaceable; DELIBERATE residual: ≤3-alpha brands ('IBM') flag on wandered reads (accepted-names
  doesn't reach anchor.py yet — future plumbing). Composes with Stage-2.6 rescue (min-cap keeps
  70+note; pinned in test_late_anchor_rescue.py §4c).
- **E2E MP_sal_35**: BEFORE customer_name='Sso'@91 unflagged + SO number ABSENT → AFTER
  customer_name='Formby & Sons'@70+note (beats the keyword interleave artifact "SO #"@83) +
  sales_order_number filled @88 review-bound. Siblings: MP_sal_36 clean 'Antrim Coast Hotels'@90
  (guard costless when clean) + SO@88; MP_sal_03 kept-rigid@70+note + SO@88; AW_sal_07 (other
  supplier) imperfect reads capped 69/70 → review, never silent. Strip probe: old geometry → no
  label; new → 'so #'. Tests: test_anchor_name_lock_guard.py (junk shapes + BOTH trade-off pins) +
  test_so_number_labels.py + test_anchor_label.js §nearestRowTo/SHORT_CAPTION/sanitize# +
  phantom-label test premise moved customer_name→supplier_name (STALE after migration 44 — the 2 BADs
  were PRE-EXISTING, proven vs HEAD). Full battery green. DEFERRED designs recorded: 300-DPI teach
  crop source (--source-dpi + sliver-gate scaling 5px@108≡14px@300 + crop_norm box space, gated
  image-only via born_digital.assess_page); '↓ Below' readout toggle (+ runAnchorDraw dcy>0
  misclassify fix); min(native,300).
- **Oracle verdict: SIGN OFF WITH CONDITIONS — ALL THREE CLOSED.** C1 corpus A/B: regressions
  29/24-silent (one BETTER than the pre-fix run), per-field supplier 99.8/ref 99.2/date 99.6
  (identical; sales_order_number scores inside the type's ref role; customer_name NOT
  corpus-scored — its evidence is the 4-doc E2E), M=4 = the SAME pre-existing Cloudpeak set
  (kill-switch-proven non-causal; open triage). C2 IMPLEMENTED: `_is_blind_cross_supplier_anchor`
  weak-core exception — a locate via a ≤3-alpha-core caption ("No."/"Ref"/"SO #") does NOT count
  as "same layout" for a NAMED different supplier (falls to the blind drop); same-supplier /
  global / ≥4-core byte-identical; the suite's two LOCATED-KEEP pins were moved off the
  placeholder 'x' label onto realistic captions (intent preserved); 5 new C2 rows; ZERO stored
  anchors have weak-core labels → the completed corpus run certifies the final code. C3 RECORDED:
  **the 88 critical floor passes conf==88 BY DESIGN** (trust.js blocks only c < 88, pinned in
  test_scope_trust.js — do NOT "fix" the comparator, it would over-hold clean 88/90 base reads);
  the pattern-valid slipped-ref class ('SO'→'50' @88) is carried by Stage-4.5 learned-shape
  gating + docTrustGate + overall/notes, NOT the floor (doc 2204 was stopped twice: overall 58 +
  the name-guard note). Oracle also corrected one evidence line: 'Formby & Sons'@70 beats
  keyword@83 via TAUGHT-anchor precedence (Tier-A), not confidence — a PASSIVE anchor would lose
  that merge to the interleave artifact (pre-existing keyword exposure, documented, not new).

### 2026-07-10 LATE EVENING — custom FREE-TEXT fields first-class (RC1 slice 2 + the ordering seam)
- **Diagnosed on MP_wor_48 (Worksheet `customer` "Not found" forever, reprocess included), 3 stacked
  causes**: (1) free-text custom fields never Stage-1-seeded (slice-1 gap, by design); (2) THE ORDERING
  SEAM — on a late-resolving doc (no template/logo match) Stage 2 runs with supplier=None and
  `_anchor_matches` cannot admit that supplier's OWN POSITIONAL anchors (only identity anchors ride the
  type-match branch — gary corrected the initial blind-drop theory: it's the FILTER), supplier resolves
  at 2.5a but anchors never re-ran — so teaching was ignored exactly where it matters most; (3) the 3
  pre-geometry-fix CUSTOMER anchors carry GARBLED labels ('ie), Oo Sp' slips labelLooksSuspicious — all
  tokens <4 alpha). Hints correctly skip multi-valued customer (variability guard, unchanged).
- **Fix A — free-text seeding** (`keyword.seed_field_labels` party branch, kill switch
  `SEED_FREE_TEXT_ENABLED`): a custom text field seeds its OWN DB label only (len≥3, SAME-TYPE sibling
  label dedupe so customer_name+customer on one type can't double-fill; global bank alone never blocks),
  base 75 (< ref/date's 80 < the 88 floor, > the 70 review threshold), method plain 'keyword',
  role_caption='party' arming reggie's guards in `_search_for_label`: G1 `_party_caption_conflict`
  (follow-word stop: ref/no/order/po/copy/signature/services… — "Customer Ref 4118"/"CUSTOMER COPY"
  never fill; 4-space column break after the label = another column's caption, NOT a conflict), G2
  compound-tail ("Customer / Site" remainder never a value), G3 `_is_caption_fragment` (a candidate
  VALUE that is itself a caption fragment — "Reference No.", bare "Name" — is skipped; fixes the
  COLUMN-INTERLEAVE where the line after 'Site / Customer' in reading order is the ref row and the true
  value 'Formby & Sons' is one further). Shipped patterns byte-identical (party-gated).
- **Fix B — Stage 2.6 LATE-ANCHOR RESCUE** (`engine.py`, kill switch `LATE_ANCHOR_RESCUE_ENABLED`,
  pure gate `_late_rescue_applicable` + `anchor.anchor_admissible` public wrapper): when the supplier
  was UNRESOLVED at Stage-2 time and is plausibly resolved after (2.5a text scan, or the post-Stage-2
  promotion of a Stage-1 keyword identity — same seam), re-run anchor extraction over the DELTA OF
  ADMISSION (admissible under resolved supplier, NOT under None) = provably ONLY that supplier's own
  named positional anchors (identity/global already admitted; foreign fails both) → can never re-admit
  the 2026-07-09-banned cross-supplier positional reads. FILL-EMPTY-ONLY, conf ≤ _LATE_RESCUE_CAP 85
  (the text-scan premise's own cap; < 88 critical floor), blind reads keep anchor.py's 50 cap → review;
  method string untouched + `late_rescue` marker. Stage-0-resolved docs byte-identical (gate).
  Post-rescue the 3 garbled anchors self-serve as positional reads @50 → NO cleanup migration (gary D3:
  blanking ≡ same path; re-teach per scope upgrades to located reads — saveAnchor sweep is
  SUPPLIER-scoped, learning.js:434, contra the older "across all suppliers" note above).
- **Oracle verdict: SIGN OFF WITH CONDITIONS (all code conditions APPLIED + re-tested)**: C2 the
  "75 keeps the doc off exactly-100" rationale was FALSE (optional fields often UNCOUNTED in
  overall_confidence; a counted-EMPTY field scored 0, so a fill RAISES overall — the real rails are the
  at-100 freetext-skip class + review routing + the 88 critical floor; comment corrected); C3
  `_PARTY_FOLLOW_STOP` += site/address/tel/telephone/phone/fax/email/mobile/web/website ("Customer Site
  Address" now fail-empty); C4 rescue delta tightened to SAME-TYPE anchors (legacy NULL-type rows out),
  the A-over-B PRECEDENCE INVERSION named in the Stage-2.6 comment (a seeded keyword@75 fill excludes
  the field from the delta, so on late docs a ⊕ teach can't displace a wrong seeded read until the
  supplier gains a template/logo — fails toward review; follow-up option documented), gate docstring
  widened (any results['supplier_name'] promotion arms it). C1 PENDING: read the corpus REPORT incl.
  at-100/auto-file churn (filled fields LIFT overall — check no doc newly crosses into auto-file with a
  wrong seeded/rescued value). C5: state plainly whether corpus GT covers custom `customer`.
- **E2E on the real doc**: seeded path `customer='Formby & Sons' @75 keyword` (overall 82 → review);
  rescue path (seeding off) `@50 anchor_crop late_rescue` → review. Tests:
  `test_custom_field_seeding.py` (slice-1 "customer NOT seeded" pin DELIBERATELY flipped; full G1/G2/G3
  battery + T-real interleave + dedupe + kill switch) + NEW `test_late_anchor_rescue.py` (delta
  invariants, fill-empty-only, caps, gate pins, kill switch). All 8 anchor/identity/guard/rescue suites
  green. **Corpus gate (C1) RESULT**: corpus 1838→2098 (tonight's confirms); regressions 30/25-silent
  = BASELINE-IDENTICAL (zero new); per-field supplier 99.8%→99.8%, ref 99.2%→99.2%, date 99.4%→99.6%
  (improved); no auto-file churn (96.6%→96.5%). **M=4 — ALL PROVEN NON-CAUSAL** (per-doc kill-switch
  A/B: ON==OFF byte-identical): a PRE-EXISTING weakness surfaced by NEW DATA — Cloudpeak Systems
  (first confirmed TODAY), invoices carrying BOTH an invoice# and a PO#, scanned-digit misreads at 95
  keyword conf (> the 88 floor) → #2068/70/74/82 would-auto-file wrong ref; #2074's GT itself looks
  mis-confirmed ('PO755' vs printed '1947063' — the #404 class). ⚠ OPEN FOLLOW-UP (not this change):
  triage tonight's Cloudpeak confirms (Learning Repair / re-confirm) + a reggie pass on the
  invoice#-vs-PO# candidate ambiguity; until then a future Cloudpeak invoice CAN auto-file a wrong ref
  (pre-existing exposure). C5 (honesty): the harness scores supplier/ref/date/total ONLY — `customer`
  is NOT corpus-scored; the seeded field's accuracy evidence = the MP_wor_48 E2E (both paths, correct
  value, review-bound) + the unit battery + review routing.

### 2026-07-10 EVENING (UNCOMMITTED at handover — details/conditions in the EVENING handover)
- **Focus REVISED**: the systemic cure's `pageHasFocus===false` OR-fallback made `blurWebView` (the app's
  ONLY page-focus dropper) fire on ~half of clicks → SELF-PERPETUATED the desync ("broken everywhere").
  Now SUSPECT-ONLY (armed: native dialog / post-Confirm / runZoneOcr draw); the preload `focusin`
  secondary from `4d2de72` is REVERTED. Child-window-close arm SHIPPED NIGHT++ (see below, with
  the focusOnWebView restore half that made it safe). `test_focus_repair.js`.
- **RC2 UNLINK (migrations 44+45)**: `COMPANY_KEYS=['supplier_name']` — customer_name is an ordinary
  OPTIONAL recipient field everywhere; 44 reshapes existing types (SCHEMA-ONLY), 45 purges stale
  issuer-as-customer hints/anchors (keeps legit recipients); review renderer decoupled (6 ISSUER_KEYS
  sites). `test_migration_customer_unlink.js` + `test_migration_customer_hint_cleanup.js`.
- **Reprocess keeps the template** (`process_docs.py`): the machine-authority override no longer clears
  `_kt`; an `authoritative` guard stops a resurrected template re-asserting its stale type.
- **Template RESCUE** (`template_matcher.py`): a drifted-logo doc still matches its own SAME-TYPE template
  on ≥0.80 keyword-branding overlap + logo band ≤20 → `keywords+slug_rescue` @60 (Meridian 3-fragment case).
- **`region.py _strip_horizontal_rules`**: gated underline/rule removal before the light rung (underlined
  captions garbled at the 108-DPI teach preview). **`po_number`** labels: + "P/O …"/"P.O. …" forms.
  ⚠ **SUPERSEDED DIAGNOSIS (2026-07-10 late evening)** — the LIVE garble ("eee F WS CwE ewe") was NOT
  underline fusion: the ⊕ ABOVE-strip (one value-box height) CLIPPED the caption to its bottom 2-4px
  (line spacing > box height) and OCR HALLUCINATED words from the sliver. THREE-LAYER FIX, oscar-vetted,
  proven on MP_wor_47 + 4 more docs/2 suppliers (probe: true captions 2→8, empties 3→0): (1) GEOMETRY —
  above band = 2.5 line-heights (floor 34px) with a 0.1h bottom STANDOFF, BOTH surfaces (review
  captureAnchorContext + teach autoLabel, teach floor 0.028 page-height); shared `nearestAboveRow`
  (anchorLabel.js) keeps only the BOTTOM word-row so the taller band can't re-glue two lines;
  (2) `region.py` SLIVER GATE `_looks_unreadable_sliver` (ink band <5px pre-upscale → EMPTY, all
  draw-tool callers incl. /v1 targeting-OCR — fail toward "no label", never junk); (3) UX — a
  suspicious/garbled caption is NEVER DISPLAYED (review readout + teach wizard show "couldn't read the
  caption — position remembered", empty editable input; junk dropped on advance). ALSO FIXED:
  _strip_horizontal_rules erased BOX BORDERS (edge-hugging full-width lines) which flipped
  test_region_light_first's bordered crop read "Serial number"→EMPTY — now skips edge bands
  (top/bottom 6%). Dashed-underline eraser DELIBERATELY DEFERRED (geometry solves it; bridging dash
  gaps risks erasing text rows — oscar's safe row-profile recipe is in the 07-10 oscar consult if ever
  needed; pinned in test_strip_rules.py). Tests: `test_region_sliver.py` + `test_strip_rules.py` (NOW
  EXISTS — was claimed but missing) + `test_anchor_label.js` §nearestAboveRow; light_first back GREEN.
- Corpus gate: batch corpus-NEUTRAL, **M=0 held**; `GATE=1` exits 1 on the PRE-EXISTING 21-silent class —
  read the report file, not the exit code. Final Oracle vet of the template/rescue/PO fixes crashed
  (transient API) — **re-run before commit+build**.
- **Migration 43 stamped** (`database/index.js`) — `document_types.title_aliases` only ever landed on
  FRESH DBs (safeAdd sat in the stamped migration-2 block); existing installs stayed at v42. Now a
  proper stamped migration 43. `test_document_types_aliases.js` pins the stamped-v42 case.
- **Reprocess type-authority override** (`process_docs.resolve_assigned_type_authority`, handler manifest):
  a MACHINE-assigned doc type (never human-confirmed) may be re-typed on reprocess by the doc's OWN
  TRUSTED standalone title; a human-confirmed type is NEVER overridden; clipped scans keep the pin;
  `--known-doc-slug-authority machine` passed only for never-confirmed docs; flip drops stale wrong-type
  extraction rows + plants a load-bearing review note (blocks auto-file). Fixed the "keeps applying Sales
  Order on reprocess" report. Coherent (detected_slug,title_trusted) pair. `test_reprocess_type_flip.py/.js`.
- **Recipient-caption issuer guard** (`engine._flag_recipient_caption_issuer`): a plain 'keyword' read of a
  customer_name-IDENTITY field (shipped label bank is all recipient captions) is capped 69 + noted (never
  rewritten) — a sales-order BUYER name can't silently fill the Document Issuer. Exempts learned/taught/
  manual methods + accept allowlists + both-key types. `test_issuer_caption_guard.py`.
- **Identity rescue slice 1** (`engine._rescue_identity_from_scope`, kill-switch `IDENTITY_RESCUE_ENABLED`):
  on a customer_name-identity type, when the incumbent issuer read is QUALITY-FAILED junk AND the supplier
  scope resolved STRUCTURALLY (logo/template) AND a same-scope confirmed hint (usage≥2, guarded by
  `_apply_hints`) AGREES with it, REPLACE the junk with the confirmed issuer at conf 69 + provenance note
  (review by construction, never silent). Fixed "issuer says SO #". Structural-origin is by METHOD (the
  field VALUE may be format-withheld). `test_identity_rescue.py` (37 checks + real E2E). Slice 2
  (graduate past review) DESIGNED, NOT Oracle-signed, NOT built. supplier_name-identity types NOT covered
  (Fix A below solved the PO case via the logo).
- **Supplier "Ref" label guard** (`keyword._identity_ref_caption`, mirrors `_total_role_collision`): a bare
  "Supplier"/"Vendor"/"Seller" caption followed by a reference word (Ref/Reference/No/Number/Code/ID/VAT/
  Account) or '#' is a BUYER-side reference caption, NOT the issuer — skip it; a real "Supplier: Acme" still
  reads. Removing the "Ref" junk lets the LOGO win (@96). `test_keyword_label_guard.py` §1e.
- **Confirm-upsert** (`learning.saveCorrections`): a value TYPED into a field the engine never read had NO
  extraction row, so the reflect-back UPDATE was a no-op and the value lived only in `corrections` —
  invisible to every learning reader (all select FROM extractions), to search, and on reopen ("worksheets
  no longer learning values"). Now inserts a `manual` extraction row (conf 100, corrected_to NULL). Born at
  CONFIRM time so no auto-file path reads it. `test_save_corrections.js`.
- **getAllHints (uncapped training)** (`learning.getAllHints`): `buildTrainingArgs` used bare `getHints(db)`
  whose default LIMIT 100 (usage DESC) STARVED the engine of every new supplier's usage-1/2 hints once the
  corpus passed 100 rows. Training now uncapped (scoped/display callers keep the cap). `test_getallhints.js`.
- **Position-only issuer teach** (renderer + `learning.saveAnchor`): a ⊕ issuer teach with no printed caption
  now saves an EMPTY label (position-only), never the field DISPLAY name ("Document Issuer") — a phantom
  label the anchor engine silently dropped ("my teach never sticks"). saveAnchor also drops a label equal to
  the field's display label (unless OCR'd from the page). `test_anchor_phantom_display_label.js`.
- **SYSTEMIC keyboard-focus cure** (`src/preload.js` pointerdown + `src/main.js` runEnsureFocus +
  `src/lib/focusRepair.js`): ONE central heal at the universal text-field pointerdown chokepoint fixes the
  render-widget desync (page-focus lost while the window still claims focus) regardless of trigger (Confirm/
  draw/Learning-History all showed identical `pageHasFocus=false`). In the desynced state only: pre-focus the
  pressed control SYNCHRONOUSLY (so SetPageFocus restores focus to IT not <body>) → `invoke` the repair
  (ordered, not fire-and-forget send) → double-rAF re-assert → one-shot blind-spot re-issue. Healthy clicks
  byte-identical; <select> excluded; the two pinned regressions hold (no win.blur/focus; no win.on('blur')
  suspect). Per-site confirm(suspect)+draw(proactive) fixes stay as belt-and-braces. NEEDS A RESTART.
  `test_focus_repair.js`. ⚠ **REVISED 2026-07-10 (the systemic-cure build was net-broken "everywhere"):**
  the blanket `pageHasFocus===false` OR-fallback in `focusRepair.js` was REMOVED — it fired `blurWebView`
  (the ONLY page-focus dropper in the app) off a CAPTURE-phase at-rest `document.hasFocus()` read on ~half of
  clicks, so it SELF-PERPETUATED the desync (telemetry: false in runs of 5-7 consecutive). `blurWebView` now
  fires ONLY on an ARMED `__focusSuspect` trigger (native dialog / post-Confirm / draw-OCR — each arms it);
  the additive `focusin` secondary was reverted. So the heal covers ARMED triggers — NOT "regardless of
  trigger"; a non-armed desync (child-window close, keyboard-Tab-only) falls through to the recoverable
  click-out-and-back dead caret (fail-safe — never a wrong value). Arming child-window-close is a fast-follow.



---

## ARCHIVE: CLAUDE.md session-state blocks 2026-07-20 → 2026-07-28 (moved out 2026-07-29 to keep CLAUDE.md lean)

> These are the verbatim per-session state blocks that had piled up in CLAUDE.md.
> Each also has a matching `HANDOVER_<date>*.md`. Grep here before re-touching recent work.

## (prior) Session state (2026-07-28) — long live-test day — READ `HANDOVER_2026-07-28.md` FIRST
**2026-07-28 (Opus 4.8). 5 commits ahead of origin ALL UNPUSHED (`c22e771`→`eebe154`, from BEFORE today) PLUS a
LARGE UNCOMMITTED batch this session (11 tracked + 3 untracked) — NOTHING committed/pushed today. Owner REBOOTED
the PC at wrap-up (chasing a lingering import slowdown).** All uncommitted work is default-safe + unit-tested,
NOT live-smoked, NO corpus run.
**Committed before today (5, unpushed):** `a666b83` SuperStore teach-safety (`labelIsTypeHeading()` — a ⊕-teach
whose auto-label EXACT-matches a type name/alias falls back to POSITION-ONLY, so the doc TITLE "INVOICE" can't be
pinned as the invoice_number label → the "stuck at 69%" taught-ownership cap; + clearer teach copy/badge) ·
`eebe154` reprocess-All survives Review close/reopen (persists `_reprocessStatus`, mirrors to the LIVE window,
`reconnectRunningBatch`, consume-once auto-file). Data cleanup `scripts/remove-superstore-invnum-anchor.js`
(uncommitted, removes the EXISTING bad anchor — owner runs app-closed `--apply`).
**Built THIS session (all UNCOMMITTED):** (1) case-insensitive **Forget** — `supplier_name = @sn COLLATE NOCASE`
in `learning.js`/`recoveryService.js`/`documents.js` so a lowercase "superstore" clears "SuperStore" learning
(pinned, GREEN). (2) **Focus** fix — settings `renderer.js` wraps `confirm`/`alert` to arm the focus-suspect
(mirror of Review), curing the no-caret Learning-Repair field. (3) **Stale-overlay** + (4) **clearer position-
anchor message** in review `renderer.js`. (5) **Configurable OCR render DPI** — kill via `ocr_dpi` setting
(Settings→Processing, 150/200/300, DEFAULT 300 = byte-identical); env `OCR_RENDER_DPI` → `tesseract.py`
`_resolve_render_dpi` (clamp [100,600]→300); wired into all 3 extraction spawns in `handler.js`; pins GREEN.
**Designed (gary→Oracle SIGN OFF W/COND, GO to build, NOT built):** consolidated auto-file **S1** — shed the
template-identity issuer note when corroborated in the ISSUER BAND (kill `TEMPLATE_IDENTITY_BAND_GRADUATE` OFF;
C1 all-tokens-in-band, C2 unconditional band). #4 SuperStore label-less same-pixel ref correctly STAYS in review.
**Import perf — NO code regression:** acute crawl = Chrome (~2GB) + low free RAM starving the OCR fleet; each doc
is a fixed ~3.7s single-threaded 300-DPI Tesseract (thread-invariant) so MORE parallelism helps not less (earlier
"lower to 6" advice was WRONG). Corpus is 150-DPI-native → 300-DPI OCR = 4× waste → the DPI setting. Owner post-
DPI: "faster on 150 but still slower than before" → rebooted. **Diagnosed, NOT built:** import-view folder count
stuck at 900 + session stats +900/run (both `main/renderer.js`). **Prior block ↓**

## Current session state (2026-07-27 PM) — hidden-field SCORING built + live-gated
**2026-07-27 PM (Fable 5). PUSHED through `6a7a447` (origin `0 0`).** Owner: "Northgate worksheets stuck
at 72%, nothing flagged, won't auto-file." Root (math-exact): worksheet type has 6 schema fields, layout
lacks item/serial_no → `overall_confidence` zero-scores the two empties → cap ~74 < graduated floor 95
FOREVER; the owner's mig-54 field-HIDING was display-only (engine blind). **`59c4032` HIDDEN_FIELD_SCORING
(kill, default ON; =0 byte-identical)** — gary→Oracle SIGN-OFF-W/COND: `templates.getAll` rides
`hidden_fields` to Python; `template_matcher.hidden_fields_for_scope` = byte-mirror of the JS display
resolver (name exact/containment + group_id union, NO branding arm — fail toward held);
`overall_confidence(exclude_keys=)` **EMPTY-ONLY** (Oracle C1 LOAD-BEARING: a VALUED hidden field keeps
its drag — at 100 the structural docTrustGate is opt-in-OFF, so dropping the drag would file+learn a
ghost gate-free; never widen to key_fields filtering); engine strips identity+current-ref/date-role keys
(`date_field_key` newly threaded); fc_delta/needs_review untouched. JS↔Python parity pinned via SHARED
vectors `python_backend/tests/data/vis_norm_vectors.json` read by BOTH new suites. **Gates: #714-717
replay 71-73→100 values-identical + all 4 pixel-page-checked; corpus A/B (710-doc snapshot) 36 diffs ALL
confined to the two hidden-config worksheet scopes (Saltmarsh id23, Northgate id33), +28 correct
would-auto-file, 0 genuine new M.** The gate CAUGHT `6a7a447` **#557 GT POISON** (worksheet_15 confirmed
with sibling #558's values; page pixel-proves WS-18541/22-02-2026/Corvus; -DUPLICATE filename = the
collision receipt) → gt_overrides "557". ⚠ Residuals (accepted, pinned): branding-only-resolvable scope
still holds at ~72 (display hides, scoring doesn't exclude); containment false-inherit mirrored from
display. NEEDS OWNER: reprocess the 4 held Northgate worksheets (they'll now file at 100); Learning
Repair → send `SaltmarshSeafoods_worksheet_15` back → re-confirm with the page's real values (WS-18541 /
22-02-2026). Memory [[project_hidden_field_scoring_20260727]]. **Morning block ↓**

## Current session state (2026-07-27) — READ `HANDOVER_2026-07-27.md` FIRST
**2026-07-27 (Opus 4.8) — long owner-driven live-testing day. ALL PUSHED through `c0f9434` (origin `0 0`),
tree clean, no running processes.** 9 commits, each kill-switched + advisor→Oracle gated (realdoc is BLIND to
the JS/renderer paths → several used live-DB replays). Shipped: type-flip `e0b5c04` + hardening `c617230`
(overnight, pushed a.m.), then 4 live-found fixes — **`93b766c` SO-template phash-collision refuse**
(`LOGO_REFUSE_SUPPLIER_CORROB`: the 64-bit phash can't separate suppliers → a foreign wrong-type template →
the trusted-title refuse blocks the correct same-supplier rescue; fix = two-factor the guard + a winner-side
distinctive-presence gate; 10/20 roulette→0) · **`8be9ac5` field-hiding UNION**
(`getHiddenFieldsForSupplierType` resolves hidden fields across DUPLICATE templates by (name,type), EVEN when
matched; display-only) · **`9164c28` po_number "Order No." reader** (`PO_ORDER_NO_LABELS`: inject the missing
label + a qualified-caption guard + close a latent sales_order_number-grabs-PO leak. **007-A full-res inline
re-read BUILT but DARK** — corpus regressed because the `inline_box` is LOW-RES-derived; 007 pixel-proved doc
669's `PO-78399`→`PO-78309` is a ~120-DPI DOWNSCALE in the label-locate pass, owner rule "look at the SLICES")
· **`1f0a021`+`c0f9434` template DEDUP** (`TEMPLATE_REUSE_BY_NAME`: `templates.reuseByEstablishedName` — exact
`establishedIdentity`+slug, NEVER containment, richest canonical — wired FIRST in `_upsertTemplate` +
`graduationTemplate` to PREVENT new dups; + group_id activation + owner-run reversible backfill
`scripts/template-group-backfill.js --apply` to COLLAPSE existing; Phillip-measured; live replay 0
cross-identity) · **`522749a` juncture 6** (verify system STATE at the source, never from a UI/indirect
signal). ⚠ OPEN: 669 ref still shows the wrong value (the taught anchor's low-res misread wins over reggie's
correct keyword read — needs a full-res re-LOCATE, not the coarse re-crop that regressed); deferred Python
matcher tie-break + IDF (Oracle C5). NEEDS OWNER: restart app (main-process changes) + reprocess; run the
backfill `--apply`; rebuild the installer + smoke hardening. **Prior block ↓**

## Current session state (2026-07-26 NIGHT, autonomous) — READ `HANDOVER_2026-07-26_NIGHT.md` FIRST
**2026-07-26 NIGHT (Opus 4.8, autonomous; owner asleep). ALL PUSHED through `c617230` (origin `0 0`), tree
clean.** Two atomic kill-switched commits. **`e0b5c04` TASK #5 Northgate PO→Invoice TYPE-FLIP FIXED** —
Herald-designed, Oracle SIGN-OFF-W/COND (C1-C6 all met), corpus-gated on a FROZEN live-DB snapshot:
**Lever 1 `HEADING_FUZZY_VOCAB`** (keyword.py, DEFAULT ON) = a fuzzy-to-closed-vocabulary title arm beside
the exact `_despaced_heading` (difflib ratio ≥0.82, ARGMAX+0.08 margin, single-word only-if-fragmented so
the alias contract holds; new `_collapse_title_tokens`, `_despaced_heading` byte-UNTOUCHED) — recovers
'PU RC fa ASE ORDER'/'I N V O I C E'; **Lever 3 `KW_TYPE_NONDISTINCTIVE_HOLD`** (template_matcher.py,
DEFAULT ON) = the silent-misfile backstop: `_kw_nondistinctive_hold` HOLDs a keyword winner whose
DISTINCTIVE fingerprint ⊆ a same-supplier different-type sibling's, NO exact tie needed; gate
`winner_slug_match==0 and not title_trusted` composes cleanly with Lever 1 (no double-hold); reuses the
intact ambiguity→HOLD engine chain (no engine change). BOTH OFF ⇒ byte-identical. **Gate: value accuracy
byte-identical (type 99.5/sup 100/ref 98.0/date 95.3), M_type 0, 0 new silent-misfile, 0 new false-hold,
−6 false-holds, +1 correct auto-file; Northgate 673/674 invoice→PO, Lever-3-only turns a conf-100 garble
from silent-Invoice into ambiguity-HELD-with-correct-PO-suggestion.** New gate tooling (data-free):
`stress_test/type_outcome_report.js` + `northgate_type_trace.js` + an inert `RR_TYPE_ENUM` dump in
realdoc_regression.js. · **`c617230` BUILD DECOMPILE-HARDENING scaffold** (eric-designed,
`docs/BUILD_HARDENING_PLAN_2026-07-26.md`): **Rung C DEFAULT ON** (asar `files` negations drop
`test_*.js`/`__tests__` — dry-pack verified 0 of our test files in app.asar) + **Rung A scaffold DEFAULT
OFF** (`scripts/afterPack-fuses.js`, kill `HARDEN_FUSES`; arms RunAsNode/NODE_OPTIONS/--inspect OFF on
ScanFinder.exe; `@electron/fuses` MIT devDep). Default dry pack `electron-builder --dir` SUCCEEDS, afterPack
no-op fires (byte-identical), check-licenses OK (79 comps commercially-free). ⭐ **NEEDS OWNER (needs a live
app, couldn't do asleep): (1) reprocess Northgate in `npm start` to SEE the fix (POs now type Purchase
Order, held); (2) ARM the fuses — `HARDEN_FUSES=1 npm run build` + smoke every window (a bad flip = won't
start) — then decide to keep it in the release build cmd; (3) decide the deferred rungs B/D/F/E (each needs
a smoke; weakest links = config JSON + JS-in-asar, `.pyc` already best-protected).** Installer
`r20260726-1018` predates all of this — rebuild to carry task #5 + smoke hardening. Revert: `git revert
e0b5c04`/`c617230`, or the kill switches restore byte-identical. **Prior block ↓**

## Current session state (2026-07-26 EVENING) — READ `HANDOVER_2026-07-26_EVENING.md` FIRST
**2026-07-26 EVENING (Opus 4.8) — ALL PUSHED through `7cfcc5f` (origin `0 0`), tree clean; a dev
`npm start` is RUNNING (owner live test). READ `HANDOVER_2026-07-26_EVENING.md` (its ⭐ LATEST block first).** Built the two planned
targets, each gary→Oracle gated + kill-switched: **`18d851a` B′ TYPE-SCOPED taught-ownership label
exemption — DEFAULT ON** (`keyword.label_is_own_discriminating_in_type` intersects the global label owners
with the RESOLVED type's field keys → "Order Date" on a PO is own-label; fires only on an AUTHORITATIVE
type `self._type_authoritative` = title_trusted AND not type-ambiguous/-refused; method-only; kill
`TAUGHT_OWNERSHIP_TYPE_SCOPED_LABEL=0`. C1 live: the 13 Copperfield POs 69→98 VALUES-UNCHANGED; C2 corpus
diff = 1 line, M/accuracy identical) · **`9119227` Fix A #183 inline-harvest absence hold**
(`engine._inline_absence_should_hold` = a critical `anchor_inline` winner that
`_fallthrough_critical_corroborated` can't confirm is HELD; Oracle C2 DROPPED the crop-box requirement
[pure fn of the result, closes the label-less-anchor hole too]; corpus M 2→1 [#183 caught, #583 untouched],
accuracy identical) · **`ae12a0e` Fix A → DARK** (owner live-test: over-flags a CORRECT VISIBLE ref on the
systematically-skewed Northgate batch — the rigid crop read it too but rejected on the caption prefix, so
its agreement is invisible to the winners-only ledger; refine before re-flip, task #4). **THEN: the
Northgate PO→Invoice TYPE-FLIP was root-caused by a NEW agent HERALD** (created + registered this session,
`bd400e4`/`7cfcc5f`; `.claude/agents/herald.md`, skill `document-type-heading`, standing ref
`docs/HERALD_TYPE_DETECTION_REFERENCE.md` = THE spec — read before building). Herald renders+OCRs the TITLE
BAND before citing a score and CORRECTED the diagnosis: **axis-2 classification is SOUND** (correct title →
PO 95/trusted); the mis-type is a **DETERMINISTIC generic-fingerprint** hole (the pure-letterhead Invoice
template scores 1.0 on every page → wins; `_kw_type_ambiguity` blind = exact-tie-only), TEMPLATE-path not
logo-only, NOT a coin-flip — a garbled PO with clean fields would silently auto-file Invoice. **The owner's
REAL docs type correctly TODAY** (born-digital/logoless SuperStore + real-scanned City Office/"doc-solutions";
`detect_document_type` scans every line = layout-agnostic) — Northgate is a DEMO-skew artefact. ⭐ **NEXT:
(1) owner reprocess Copperfield (B′ clears 69→98) + Northgate (Fix A dark clears the flags) in the dev app;
(2) TYPE-FLIP (task #5, HERALD owns it): Herald designs the GENERALISED fix — PRIMARY = fuzzy-to-CLOSED-
VOCABULARY beside `_despaced_heading`'s exact test (skew-agnostic; drop the multi-word-only guard), + a
TEMPLATE-PATH HOLD-on-generic-fingerprint + fp hygiene (strip Bluefin/Marine from PO id30) → Oracle → build;
GATE = corpus type-outcome enumerator (false-hold + silent-misfile); (3) Fix A refinement = crop-read
corroboration (task #4).** Installer `r20260726-1018` predates all commits; iris + herald are registered
agents. **ALL PUSHED through `7cfcc5f`, origin `0 0`. The 2026-07-26 morning block's "NEXT" is DONE
(Copperfield = B′; #183 = Fix A). ↓**

## Current session state (2026-07-26) — READ `HANDOVER_2026-07-26.md` FIRST
**Wrapped 2026-07-26 (Fable 5). ALL PUSHED through `fff6cde` (origin `0 0`), tree clean, no background
processes.** The day: logo-identity fix END-TO-END (iris forensics → A+C → corpus block → G1/G2 guards
→ revised-C8 PASS → FLIPPED ON → owner live-validated "docs filed fine") + installer
`r20260726-1018-58533ea` BUILT with NEW bytecode hardening (extraction ships sourceless .pyc; kill
`SHIP_PY_SOURCE=1`) + `docs/ARCHITECTURE_SNAPSHOT_2026-07-26.md` (C++-port report; MODULES.md = stale).
⭐ **NEXT SESSION: (1) owner smoke of the hardened installer, (2) the COPPERFIELD TAUGHT-OWNERSHIP PLAN
(formulated, NOT built — 13 POs @69; root = a BLIND label-less po_date anchor the ⊕ teach silently
planted; slices 0/A/B/B′/B″/C incl. the owner's TWO DESIGN DECISIONS: TYPE-SCOPED label ownership +
single-date crop salvage — [[project_taught_anchor_ownership_20260726]]), (3) #183 anchor-binding.**
Details + recovery anchors below. **↓**

## (detail) 2026-07-26 — logo-identity LIVE + INSTALLER BUILT (bytecode-hardened)
**INSTALLER: `dist\ScanFinder Setup 2.0.0-r20260726-1018-58533ea.exe`** — carries the ENTIRE week
(logo-identity A+C+G1+G2 flipped ON, field-vis, logo-refuse, caption-strip DARK) **+ the new
BYTECODE HARDENING**: `scripts/compile-python-bytecode.js` stages `build_python/` (extraction/ etc.
compiled sourceless under vendor/python — 38 modules .pyc-only, 15 JS-spawned entries stay .py;
packaged-tree VERIFIED zero .py in extraction/). Kill `SHIP_PY_SOURCE=1` stages verbatim source.
⚠ Build trap found: Git-bash mangles `taskkill /IM` into a path (silent fail) — close the app via
PowerShell `Stop-Process -Name electron` or the EBUSY on better_sqlite3.node kills electron-builder.
**RECOVERY ANCHORS:** tag `milestone-20260726-logo-identity` (=`3c37500`, pushed) · DB snapshot
`%APPDATA%\ScanFinder\docusnap.backup-20260726-prebuild.db` · prior installer `r20260724-1432` in
dist · revert `58533ea` or SHIP_PY_SOURCE=1 to un-harden. Hardening ladder recorded: .pyc now →
Cython/bytenode at PRE-LAUNCH (see the decompile discussion; C++ port = engine-first if ever, see
`docs/ARCHITECTURE_SNAPSHOT_2026-07-26.md`; vendor/ bundles python AND tesseract — port Q1 answered).
**NEXT: #183 anchor-binding** (007→Oracle→build; the last real corpus M) in a FRESH session.
**FLIP + LIVE VALIDATION (latest):** defaults flipped ON (`eeb257d` — `TEMPLATE_VETO_FALLTHROUGH` +
`LOGO_DETAIL_GLOBAL_RIVALS` default '1', =0 restores; test OFF-cases now set '0' explicitly). Owner ran
`npm start`, reprocessed the stuck Saltmarsh dockets: **"the docs filed fine"** — the full chain
(collision-vetoed → fall-through match → boost → G1/G2 clean → FILED) is live-proven. ⚠ The PACKAGED
app needs an installer REBUILD to carry it. **10 commits ahead of origin, ALL UNPUSHED** (through
`3e0812c` — incl. `docs/ARCHITECTURE_SNAPSHOT_2026-07-26.md`, the C++-port planning report; MODULES.md
verified badly stale there). Push decision = owner. **The earlier DARK note below is superseded. ↓**
**LATER 2026-07-26: the corroboration-gated variant CLEARED the gate.** gary designed + Oracle signed
(revised C8) the G1/G2 guards, BUILT `ba8bcea`, all green: **G1** (final assembly) — a fall-through
doc's critical winner must be corroborated (independent-FAMILY rail read, or boundary-guarded page
presence incl. the date RAW-form arm; field-kind-aware note holds via the flagged gate; NO authoritative
exemption) · **G2** (Stage-2 merge) — a non-authoritative crop at INVERTED confidence never silently
displaces a disagreeing keyword (keep keyword + note; agreeing keeps the incumbent noteless, C6;
authoritative exempt BY RULING — G1 backstops, accepted cost (c) pinned). Tag `veto_fallthrough` from
the matcher; ONE master switch (`TEMPLATE_VETO_FALLTHROUGH`) — **naked C is unreachable at runtime**
(Oracle-blessed deviation). **Gate results: M == 2 exactly** (#472 eliminated; baseline #183/#583 only),
M_type 0, **would-auto-file 377** (+42 vs OFF 335), ref/supplier = baseline, dates 98.2 with the complete
wrong-stored set {#456, #472} both **[flagged]** note-held ("no silent wrong value"); live: #472/#456
held with notes, Saltmarsh clean 100. Unit `test_veto_fallthrough_corrob.py` 20 pins + 7 sibling suites
green. **STILL DARK — the flip (defaults ON + installer rebuild) is the OWNER'S call.** Backlog (named,
do NOT widen G1 for it): G1 verifies EXISTENCE not BINDING — a lone read grabbing a different genuine
page token passes; that is the #183 Fix-A anchor-binding work. **The earlier block below is superseded
on the gate outcome; its root-cause forensics remain canonical. ↓**

## (superseded on outcome) 2026-07-26 — logo-identity slices BUILT DARK; corpus gate BLOCKED naked C
**2026-07-26 (Fable 5, owner-directed).** The remaining 4 "perfect" dockets (587/588/589/590, overall 94
< graduated floor 95) were root-caused to the END: owner's exercise ("the logo is visually identical —
find the algorithmic fix") → built the **iris** perceptual-forensics agent (`.claude/agents/iris.md`,
REGISTERED — pixels-first, 4-layer decomposition, contrastive matrices) → iris proved the 64-bit "logo
hash" hashes **LAYOUT not the mark** (phash of the top-left w/2×h/5 crop; mark <5% of area; intra- ==
inter-supplier distance ⇒ ZERO separation; 8/16 dockets coarse-lock a WRONG supplier ≤6) while the
**256-bit isolated mark separates cleanly** (own ≤38 vs impostors ≥86 min-over-set; pairwise tails cross
— the multi-ref set is load-bearing) and the purpose-built detail veto was silent because its rival
universe was cut by the same broken coarse hash. **BUILT (Oracle-conditioned, both DARK/OFF, 2 commits):**
`522cc3b` Slice A global-rival veto universe (kill `LOGO_DETAIL_GLOBAL_RIVALS`; probe 606 docs 0 wrong/0
false-abstain) · `c1f9a3f` Slice C identity-veto fall-through to the text arms (kill
`TEMPLATE_VETO_FALLTHROUGH`; C2 supplier-scoped sibling exclusion LOAD-BEARING + C3 winner branding/mark
bar). Unit 6/6+8/8, matcher family green. **Live A+C ON: all 4 dockets match T24, overall 99-100, values
unchanged-correct.** Slice B (mark as primary matcher) DEFERRED per Oracle until mark normalisation.
**⚠ CORPUS FLAG-MATRIX FAILED THE FLIP — DO NOT FLIP:** ON = +43 would-auto-file BUT **NEW M #472**
(template match un-holds its skew-wrong ref — the hold was luck, not safety) **+ date 98.4→98.2 (#456**
new wrong date on the template-matched path). Flip prerequisite = the skew read-layer fix
([[project_183_harvest_synthesis]] A/B) OR a corroboration-gated C (fall-through docs auto-file only on
multi-source-corroborated criticals — Saltmarsh 4 pass, #472 fails); each needs its own Oracle round.
Meanwhile: the 4 docs are correct on screen — owner confirms by hand. Earlier same session: caption-strip
`9dfa011` (DARK), audit `docs/AUTOFILE_AUDIT_2026-07-25.md` (07-26 update appended), template-diagnosis
`6c13ec3`. **6 commits ahead of origin, ALL LOCAL/UNPUSHED.** Memory:
[[project_logo_identity_slices_20260726]] · [[project_autofile_blockers_20260725]] ·
[[project_caption_prefix_strip_20260725]]. **Prior block ↓**

## Current session state (2026-07-25 NIGHT, autonomous) — READ `HANDOVER_2026-07-25_NIGHT.md` FIRST
**2026-07-25 NIGHT (Opus 4.8, autonomous overnight; owner asleep, hard NO-REGRESSIONS rule).** Chased the
owner's "recipient/customer anchor" problem to root and it is a **RED HERRING for the auto-file pile-up**:
customer_name is `required=0` → never feeds `overall_confidence`. The 16 correct Saltmarsh dockets pile up
because of **TEMPLATE MATCH + confidence caps + an ungraduated scope**, NOT a wrong read. Full audit:
**`docs/AUTOFILE_AUDIT_2026-07-25.md`**. Root: match→supplier early→Stage-2.5 conformance boost (85→96)+
docTrustGate ok→95; no-match→supplier LATE→`late_anchor_rescue` cap 85→88, and **no-template BARS sub-100
auto-file** (docTrustGate, trust.js:391). Scope **4/10 confirms→floor 100→nothing auto-files**; simulated
at graduated floor 95 only **4/20** file (11 no-template + 5 flagged [2 "type changed on reprocess", 3
customer phantom note]). **BUILT (DARK, LOCAL commit `9dfa011`, NOT pushed): caption-prefix strip** (kill
`ANCHOR_CAPTION_PREFIX_STRIP` default OFF) — `_strip_caption_prefix` recovers a structured crop that
captured its caption ("Date 22/07/2026"→"22/07/2026") + fixes a cold-supplier dirty-commit; reggie+Oracle
SIGN-OFF-W/COND (SEAM A currency-exclude, SEAM B recovery-not-pre-emption). OFF byte-identical; unit green
(`test_caption_prefix_strip.py`); ON live batch **16/16 zero VALUE changes** (method-only recovery). ⚠ NOT
flipped, NOT full-corpus-gated, **does NOT clear the batch**. **RULED OUT (gary+Oracle DO NOTHING): the
corroboration lift** (late-rescue⟺template-less⟹zero recall; enumeration confirmed inert). **UNCOMMITTED
new files** (safe, carry no data): `stress_test/caption_strip_ab.js` (A/B harness), `docs/AUTOFILE_AUDIT_2026-07-25.md`,
`HANDOVER_2026-07-25_NIGHT.md`. **NEXT (owner-gated; Oracle: do NOT touch the matcher autonomously):** confirm
6 more dockets→graduate; diagnose the template-match gap (primary lever, [[project_template_defrag_20260725]]);
decide the "type changed on reprocess" flag; flip the strip after corpus A/B + page-verify. Memory:
[[project_autofile_blockers_20260725]] · [[project_caption_prefix_strip_20260725]]. **Prior block ↓**

## Current session state (2026-07-25 EVENING) — READ `HANDOVER_2026-07-25_EVENING.md` FIRST
**2026-07-25 (Opus 4.8) — live-testing day with the owner; branch `feat/reprocess-throughput-autostraighten`
ALL PUSHED through `863e914` (origin `0 0`, tree clean). 6 commits, all kill-switched + advisor/Oracle gated.**
`5501be1` **merge tool (Slice 1)** — `templateMerge` splits `insufficient` vs `divergent` + offers an owner-
confirmed backup-first `merge_review` for near-identical-branding dupes (kill `TEMPLATE_MERGE_REVIEW`;
Settings→Templates→Suggested cleanups; ⚠ the merges themselves are an OWNER click, NOT run) · `aba2f46`
**reuse-by-branding DEFAULT ON (Slice 2)** — a confirm/teach reuses its (branding,slug) template instead of
minting (kill `TEMPLATE_REUSE_BY_BRANDING`; replay 482/534 reuse, 0 cross-supplier; ⚠ needs one LIVE OWNER
BATCH + Phillip's IDF hardening before wide rollout) · `17f25e5` **live field-visibility by supplier** —
`templates.findForSupplierType` resolves a no-template doc's hidden fields + re-scopes on issuer edit (kill
`FIELD_VIS_LIVE_RESOLVE`; modes via setting `field_visibility_resolve_mode`) · `af346d8` **logo-refuse
fall-through** — `identify_template`'s logo-arm trusted-title refuse falls through to the same-type keyword
rescue (+ Oracle C1 supplier guard) so a wrong-type same-supplier logo lock no longer gives "No template match"
on reprocess (kill `LOGO_REFUSE_FALLTHROUGH`; corpus M/accuracy-neutral, +5 correct auto-files; VALIDATED LIVE)
· `8103268`/`863e914` docs (label-separator tolerance INVESTIGATED → DO NOT BUILD: reggie premise-break, no-op
for its symptom). ⚠ **Python change ⇒ clear `python_backend/**/__pycache__`** or a reprocess runs STALE
bytecode (masked the logo fix for ~an hour this session). ⭐ **NEXT SESSION'S TARGET: the recipient/customer
anchor** can't pick the COMPANY-NAME line out of a captioned multi-line address block ("Deliver To" / "Site
Customer") — it reads the caption or a garbled address line, `keyword_override` rescues the correct name, and
the batch keeps landing in review; DIAGNOSED, not fixed (handover + [[project_recipient_anchor_problem]]).
Memory: [[project_logo_refuse_fallthrough_20260725]] · [[project_field_visibility_live_resolve_20260725]] ·
[[project_template_defrag_20260725]]. **Prior block ↓**

## Current session state (2026-07-24 LATE → overnight) — READ `HANDOVER_2026-07-24_LATE.md` FIRST
**2026-07-24 LATE (Opus 5 → Opus 4.8 re-review + autonomous overnight) — 5 commits PUSHED through
`c9d9480` (origin `0 0`, tree clean).** `733b4e1` **late-rescue sticky cap** (kill `LATE_RESCUE_CAP_STICKY`,
default ON; restores the documented 85 cap that Stage-2.5b +8 conformance + Stage-4.5 +5 silently lifted to
98; terminal re-cap before overall_confidence; A/B M 10→9, OFF byte-identical) · `ef612ae` **GT repair** (9
poisoned corpus rows re-read at 600 DPI + corrected in `gt_overrides.json`, self-validating; + type-override
support; corpus now type 100% / ref 98.6% / M 10→1 [only #183] / M_type 0) · `2cc20f7` docs · `14d52c4`+
`c9d9480` **per-template field HIDING BUILT** (Task #2; migration **54** `template_hidden_fields`; hide a
field the type has but a layout lacks so Review stops flagging it missing; HIDE-ONLY + superset-locked +
structural roles never hideable; INERT with no rows ⇒ byte-identical; Template Manager toggle + Review
row-skip need a LIVE-TEST). ⚠ Remaining real M = **#183** (skew broke OCR row-grouping → the harvest
SYNTHESISED `PO-20008`; two fixes proposed, NOT built — see `project_183_harvest_synthesis`). ⚠ The
`NAME_GUARD_KEYWORD_CLEAR` flip is now UNBLOCKED (#259 GT repaired) but its gate is "enumerate the docs it
newly auto-files + check each against the PAGE", not M. **↓ The Opus-5 investigation block (superseded on
the facts by the re-review) follows.**
**2026-07-24 LATE (Opus 5) — an INVESTIGATION session. The session was asked to build the REF-HOLD guard
and instead demolished its premise.**
⚠ **THE REF-HOLD GUARD IS DEAD — do NOT build it** (Oracle DO NOTHING, on MECHANISM not measurement: the
doctrine at `anchor.py:651` presumes BOTH reads are credible, and the guard would apply it to one credible
read + one the pipeline already binned as not-credible = the invariant inverted). Measured 0 TP / 9-10 FP.
⚠ **THE CORPUS GT IS POISONED ON 8 ROWS — true M is 2, not 10** (#180 #259 #262 #263 #266 #269 #273 #287
+#190; each page read at 350-400 DPI; only **#183** and **#472** are genuine misreads). This invalidates the
"M-safe" gate on ALL FOUR of 2026-07-24's commits, in BOTH directions — re-run them after the GT repair.
⚠ **#259 is NOT a real misread**: the pipeline's `DN-38472` is CORRECT; its `corrections` row is a
single-character prepend (`N-28472`→`DN-28472`), so the operator fixed a missing letter and never audited
the digits. The prior claim *"two sources say DN-28472"* is FALSE — the quoted "crop read" was verbatim that
row's `original_value`. So `NAME_GUARD_KEYWORD_CLEAR`'s DARK reason does not exist; its gate is NOT "did M
rise" (the harness's scored set excludes `customer_name`) but "enumerate the docs the flip newly auto-files
and check each against the PAGE".
⚠ **ROOT CAUSE = MULTI-FACTOR STACK, no single clean fix (Opus 4.8 re-review, TESTED — corrects the
"skew is THE cause / deskew is THE fix" framing that an earlier pass asserted untested).** For the two
genuine misreads {#183, #472} the chain is: (a) keyword can't read the clean value — po_number labels
lack "Order No" AND the doc's footer boilerplate ("quote this Order No. on all correspondence") collides,
so a naive label-add REGRESSES to null (TESTED) → (b) falls to the taught crop → (c) supplier resolved
LATE → Stage 2.6 blind crop → (d) SKEW clips it → wrong value → (e) the 85 late-rescue cap LEAKS to 98 →
silent misfile. **SKEW is real (deskew recovers #472→PO-98093, #183→PO-60906) BUT DESKEW IS NOT THE FIX:
it is not fail-safe — it CORRUPTED #180 (correct raw `PO-91914` → resample-flipped `PO-81914`), exactly
the `DESKEW_RAW_WITNESS` glyph-flip.** Global deskew trades errors; any deskew must be field-scoped +
witnessed. `project_detect_deskew_parked`/`_deskew_field_reread`/`_deskew_raw_witness` already warned this.
**SAFEST NEXT BUILD = the late-rescue TERMINAL RE-CAP (below): fail-toward-review, Oracle-signed, converts
#472 to held-for-review without solving skew/keyword — but its ~14% review-volume cost is an OWNER call.**
⚠ **#180 is a GT-poison, NOT a genuine misread** (raw pipeline reads `PO-91914` correctly). GT poisoning
re-confirmed at 600 DPI (#180/#259/#266); true M=2. Skew measurement (still valid as CONTEXT): spread
−2.1°…+2.4°, ~15px/degree walk at x_norm 0.83-0.86, up to 66% of a band; corpus is SYNTHETIC (simulated
scans, skew deliberate). ⚠ **(a SYMPTOM, do NOT lead with it, A/B REGRESSED, DEFAULT OFF) structured
ref/date OCR crops slice the glyph bottoms off.** `anchor.py:3053-3058` gives vertical headroom ONLY to
text/multiline_text;
ref/date keep a FLAT 20px. The stated reason ("numerics keep the tight box so they don't bleed into the next
COLUMN") does not cover what it gates — the withheld pad is `half_h`, i.e. VERTICAL, which can only bleed
into an adjacent ROW. Measured on #472 at 300 DPI: OFF ⇒ `"No. PQO-aRano"` (garbage) · 0.25 ⇒ `"No. PO-98092"`
· **0.35/0.4 ⇒ `"No. PO-98093"` EXACTLY CORRECT**. PART 1 BUILT (kill `ANCHOR_STRUCTURED_HEADROOM`, DEFAULT
OFF). ⚠ **BUT THE FIRST A/B FAILED — DO NOT FLIP IT ON:** at 0.35, part 1 ALONE gives M 10→11, M_type 0→1,
ref −2, **0 healed** (new silent wrongs #173 `WS-77682`→`WS-77622`, #484 `PO-83362`→`PO-82262`) — the
adjacent-row/extra-noise risk is MEASURED. Mechanism proven, shipped shape not. Measure part 1+2 TOGETHER,
sweep the ratio DOWN, and consider applying the headroom ONLY where the rigid crop would otherwise be
REJECTED (that shape avoids both regressions by construction). **PART 2 REQUIRED, not built**: the correct
crop is STILL rejected because it carries the caption tail
`No.` and `_pattern_coverage` (`anchor.py:2208-2222`) uses `re.search` = FIRST match (3/12) — and `finditer`
alone only reaches 0.67 < 0.8, so the fix is to STRIP THE TAUGHT LABEL before the credibility gate.
⚠ **Stage-2.6 late-rescue cap leak (real, DEMOTED):** `engine.py:3628` caps 85, then `:3784` +8
(`ocr_corrector.py:274` `boost_table{0:8}` = +8 for ZERO fixes) and `:4358` +5 ⇒ **98**. 55 of 56 rescued
fields leak. Holding them costs 54 correct docs to catch 1 → **re-measure AFTER the crop fix, not before**.
Dead code found: `late_rescue` (`engine.py:3629`) is written and NEVER read; `review/renderer.js:2482` tests
it as a METHOD string and can never fire; `engine.py:4338`'s "never reaches 100" is stale (graduated floor is
**95**, `trust.js:45/548`). `test_late_anchor_rescue.py` 7 RED = ONE stale fixture (its OCR puts the supplier
after "Customer", a recipient marker per `chrome_band.py:26`) — and its `capped at 85` check passes
VACUOUSLY on an empty field. **Prior block ↓**

## (prior) Session state (2026-07-24) — READ `HANDOVER_2026-07-24.md` FIRST
**2026-07-24 (Opus 4.8 1M) — live-testing day WITH the owner; branch `feat/reprocess-throughput-autostraighten`
PUSHED through `f0107f9` (origin in sync `0 0`); tree clean.** Owner-facing pipeline overview (flowchart + plain-
English stage-by-stage): **`docs/DETECTION_OVERVIEW_2026-07-24.pdf`**. **6 code commits, all kill-switched
(OFF ⇒ byte-identical), each advisor→Oracle SIGN-OFF, corpus M-safe:**
`4af4bba` **issue-2 own-label exemption** — a precise labelled keyword read (Invoice No/PO Date) no longer
over-flagged by the taught-ownership guard; SHARED/generic labels (Date/#) still held (kill `TAUGHT_OWNERSHIP_OWN_LABEL`, ON) ·
`5c94db8` **located-recovery** — Stage-2.6b re-runs an owned taught anchor when the supplier resolved LATE (Stage 2
ran supplier-blind) so a correct held ref/date lifts (kill `LATE_RESCUE_LOCATED_CORROB`, ON; #473 fixed; the crop-
BLIND version was Oracle-REJECTED = repeated-date misfile) · `7229cdd` **name-presence veto** — kills a cross-supplier
LOGO false-match on the JS template SUGGESTION path (Larkspur-on-Saltmarsh): a supplier that reliably prints its own
name can't be suggested for a page missing it (kill `TEMPLATE_NAME_PRESENCE_VETO`, ON; live sweep 510 docs → 0 false-
vetoes; guards the pill + teach-wizard save-target + graduation link) · `7d11f86` **name-guard keyword-clear — DARK**
(kill `NAME_GUARD_KEYWORD_CLEAR`, **DEFAULT OFF**) — clears a PHANTOM 'caption disagreed' flag on a keyword-corroborated
name; the owner's raw-OCR-witness idea was Oracle-SENT-BACK (it silently files a stale DRIFTED name); its M-gate rose
10→11 on **#259** (a CORRECT name-flag-clear un-masked a pre-existing REAL ref misread DN-28472→DN-38472), so per
Oracle+owner it ships DARK · (+ overnight `8e2211c` deskew raw-witness ON, `5377e24` slice-1d DO-NOTHING; the naive
cross-tier auto-file lift was MEASURED+REVERTED). **Installer** `dist\ScanFinder Setup 2.0.0-r20260724-1432-7229cdd.exe`
(3 LIVE fixes; name-guard is dark → NO rebuild needed for it). ~~**NEXT — the REF-HOLD guard.**~~
⚠ **SUPERSEDED 2026-07-24 LATE — DO NOT BUILD THE REF-HOLD GUARD.** Its whole premise was wrong: #259's GT is
POISONED (the pipeline's `DN-38472` is CORRECT), the cited crop read `'N-28472'` was actually a `corrections`
row's `original_value` not a measurement, the "single-digit" framing was wrong (the crop is 2 positions off),
the cited site `anchor.py:638-659` is stale (`:642-689`, and it is structurally unreachable on a rejected crop
because it is gated `method == "anchor_crop"` at `:665`), and `on_reject` is TRACE-ONLY so a guard hung off it
would be dead in production. Measured 0 TP / 9-10 false holds. See the LATE block above. **Owner live-checks OPEN**
(on the current installer): Thornbury
invoice/PO_05 (issue-2 + located-recovery) + Saltmarsh sales-order (no "Template available: Larkspur"). Memory:
[[project_taught_ownership_own_label]] · [[project_late_located_corrob]] · [[project_name_presence_veto]] ·
[[project_name_guard_keyword_clear]] · [[project_deskew_raw_witness]] · [[project_slice1d_donothing]]. **Prior block ↓**

## (prior) Session state (2026-07-23 NIGHT) — READ `HANDOVER_2026-07-23_NIGHT.md` FIRST
**2026-07-23 NIGHT (Fable 5) — 15 commits, ALL PUSHED through `b28f581`; tree clean; migration 53.**
`48262e0` **ANCHOR_LINE_SELECT built DARK** (flip = the live Thornbury gate) · UI: editor subgrid rows
+ Keywords pill `c5c1e58`, type-LIST drag `76c2b96`, Review labels left `7b07620` · **identity chain**:
JS detail-hash veto `6ab04f1` (64-bit histograms CROSSED — 2/64 cross vs 18/64 drift, never tune it;
256-bit impostor floor 86) + poisoned-link sweep `2c1dd13` (13 live links, owner --apply PENDING) +
enrolment DARK `c9725e2` (`LOGO_DETAIL_ENROL=1` arms — INVERTED default) + sparse guard `059d87b` →
**unified `b28f581`: BOTH detail arms suggest-only, coarse winner THREADED to the text gate; C5 gate
PASSED (backfilled == starved BYTE-IDENTICAL, 268/390, M=9 same rows) — enrolment flip now SAFE,
owner-timed** · `06470a4` KEYWORD_ANCHOR_CORROB lift + weak-critical-field hold copy ·
repair symmetry: send-back UN-PLANTS `a9f2d42` (hints retract + corrections delete + suspect notes;
corrections queries had NO status filter — that leak is closed), delete/restore `6d61cb0` (mig-53
marker; re-plant IFF retract proven), C7 plant-side foreign filter `de67cc7`. ⚠ PREMISES CORRECTED:
the sparse-set "abstention" theory was WRONG (it was the Slice-D miss-fill arm); the Oracle's
"disagree can't fire on genuine docs" was measured FALSE (the WINNER is the rival on 2-bit
collisions) — he re-adjudicated; "ref-via-keyword NEVER auto-files" was over-broad (shipped patterns
score 90; the support boost self-heals at ≥5 confirms). NEXT (2026-07-24 CORRECTION): Slice 1d
INVESTIGATED → **DO-NOTHING-IN-CODE** (gary + Oracle SIGN-OFF-W/CONDITIONS). The "Stage-0 accepts on
logo alone" premise was a STORE CATEGORY-ERROR: the Stage-0 veto (`_logo_detail_veto`→`veto_by_detail`)
reads `template_logo_hashes.detail_hash` (**Store B, 19/21, written UNCONDITIONALLY at confirm-time**),
NOT the starved Store A `logo_fingerprints.detail_hash` (0/29 = the dark-enrolment/backfill target,
which feeds the ANCHOR path only). Engine threads the query hash (engine.py:2484). MEASURED live:
`veto_by_detail` fires 13/13 on the poisoned links, 0/364 false abstains; a fresh `identify_template`
replay (`stress_test/stage0_detail_veto_probe.py`, veto OFF vs ON) = **0 wrong matches** → the 13 links
are HISTORICAL DATA, not reproducible today. "Mirror the JS twin" would MISFILE (bare one-sided veto is
non-separable at Stage-0 — drift p90 96 overlaps impostor floor 86; regresses 268→131 auto-files).
Owner action = `scripts/poisoned-template-link-sweep.js --apply` (NOT reprocess — the known-id fallback
re-imposes the poison). Full ledger + seam pins + residual-(b) fix: [[project_slice1d_donothing]].
Owner live checks still open. **Prior block ↓**

## (prior) Session state (2026-07-23 EVENING) — READ `HANDOVER_2026-07-23_EVENING.md` FIRST
**2026-07-23 EVENING (Opus 4.8 → Fable 5) — Thornbury live-testing day; 5 commits PUSHED through
`0ae0f46` (origin in sync `0 0`); tree clean.** `0bbfdce` SFDEV trace shows EVERY field + per-field
OCR crop thumbnails · `d91da4b` field drag-to-reorder (shared DocTypeEditor, ⠿ handle) · `274276c`
per-field keyword labels (🏷, reuses label_overrides) · **`1c8243b` E2** — a crop-vs-fullpage
crosscheck flip auto-accepts when a Stage-1 keyword read normalises-equal (re-based `anchor_inline`
@90 ≥ the 88 floor; kill `CROSSCHECK_KEYWORD_CLEAR`; corpus A/B: only 117→118 would-auto-file, M=3
unchanged) · **`0ae0f46`** gate-reread NORMALISATION-ONLY recoveries file clean (0-edit alnum-core;
dates need strict CALENDAR equality — Oracle C1; kill `GATE_REREAD_CLEAN_ACCEPT`; corpus A/B
byte-identical). ⚠ DEAD PREMISES, do not re-chase: E1 "oversized taught box" (all taught ref/date
anchors are SINGLE-ROW h_norm 0.015-0.024 — the 2-row crop is READ-TIME +20px padding bleed) ·
"keyword corroboration inert on delivery_number" (preset installs seed 8 labels — owner caught it).
**NEXT SESSION'S BUILD JOB: `ANCHOR_LINE_SELECT`** — per-line crop selection, fully designed +
Oracle-SIGNED: **`docs/designs/ANCHOR_LINE_SELECT_2026-07-23.md`** is the canonical spec (band +
per-rung rescale, pins a-k incl. RED-first, slice-2 `ANCHOR_ROW_GRACE` builds DARK). Then:
owner-requested **doc-TYPE list rearranging** (backend sort_order READY, UI only) + live-test
drag-reorder/keywords · the **85-vs-88 hold class** (BUILT 2026-07-23 late session, Oracle fork-A:
`KEYWORD_ANCHOR_CORROB` lift + the weak-critical-field panel copy. FRAMING CORRECTED per Oracle C8:
the SEEDED/override keyword path caps at 85 by design — shipped patterns score 90 and clear the
floor — and the class PARTIALLY SELF-HEALS: the Stage-4.5 support boost lifts 85→89 at ≥5 confirmed
docs in scope; the truly-held residue is young scopes + same-batch first contact + constant-value
fields, which the corroboration lift now covers when a second located read agrees. The recovered/
slipfix caps are DELIBERATELY not lifted — anchor.py:1247-1275). P4 CORRECTED: Review already honours sort_order —
only Search-preview extras (rowid) + the /v1 DTO remain. Corpus facts: 276 docs, ref accuracy 95.3%
(the weak spot), several "regressions" are poisoned `N-99718`-style GT. **Base block ↓**

## (prior) Session state (2026-07-23) — READ `HANDOVER_2026-07-23.md` FIRST
**2026-07-23 (Opus 4.8) — a RENDERER-ONLY Review first-run UX fix. Branch
`feat/reprocess-throughput-autostraighten` PUSHED through `f4463cd` (origin in sync `0 0`); tree clean.**
Fixed the "first-import user gets lost in Review" hole: the queue defaults to **grouped-by-sender**,
all groups **collapsed on open**, and on a cold DB every doc's `supplier_name` is null → a single
collapsed **"—"** bar over an EMPTY pane, nothing selected. **2 commits, both pushed:** `5e0fc80` —
new PURE `decideInitialSelection()` (grouped view with a SINGLE sender pile auto-expands + opens doc 1;
**2+ piles → land on nothing**, preserving the collapsed overview; flat unchanged) + made target-nav
**XOR** auto-land (removes a pre-existing double-select race) + relabel the null pile via
`groupTitle()` ("Your scanned documents" alone / "Sender not identified" among named piles; per-row →
"Not yet identified"; **KEY stays `'—'`** so expand/nav unchanged; unidentified pile sunk in the SHARED
sort but BELOW the `need>0` term so a flagged pile is never buried) + an empty-pane "Start reviewing →"
CTA (`#preview-cta`, hidden via the single `_clearPreviewState` seam). `f4463cd` — Defer + File-All
done-paths now `advanceAfterAction()` (land on the next doc in grouped view) instead of blanking the
pane; the flat-only `selectDoc(queue[0])` pattern is now gone from **all three** sites. Advisors:
**barry + eric + oracle (SIGN OFF WITH CONDITIONS C1–C4, all met)**. **No kill switch** (renderer-only;
corpus harness is BLIND to renderer code). **Pinned:** `src/windows/review/test_review_initial_selection.js`
(16/16 green under `node` — extracts+evals the pure fn, incl. the "2+ groups → select nothing" widening
guard). Siblings green; `node --check` OK. **⚠ NOT DONE: the live cold-DB smoke** — reopen Review to
load it; (ii)+(iii) checkable now on the live DB, (i) needs a cold/single-null-pile queue (fresh-install
run or a seeded copy — do NOT wipe the live 187-confirmed DB). **Prior block ↓**

## (prior) Session state (2026-07-22 NIGHT) — READ `HANDOVER_2026-07-22_NIGHT.md` FIRST
**2026-07-22 NIGHT (Opus 4.8) — a LIVE CUSTOMER CRASH session. Branch
`feat/reprocess-throughput-autostraighten` PUSHED through `dde0e39` (origin in sync `0 0`); tree clean.**
Fixed a production crash **`'bool' object has no attribute 'get'`** on 2 PCs (surfaced BOTH as reprocess
"No data returned" AND import→Errors): the logo text-gate **`'suggest'`** branch injects
`results["_needs_review"]=True` (a bool) mid-pipeline (`engine.py:2605`) and the 3 UNGUARDED Stage-0/1/2
"found" counters (`engine.py:2421/:2783/:3010`) `.get()` it → crash; fires once a supplier's LOGO is learned
but its page TEXT doesn't corroborate. **`3e3fde1`** = shared `_count_valued_fields()` guard (log-only,
byte-identical). **INSTALLER BUILT crash-fix-only:** `dist\ScanFinder Setup 2.0.0-r20260722-1742-3e3fde1.exe`
(does NOT include the label guard — rebuild off `dde0e39` to add it; ⚠ 4 stray `electron.exe` at wrap-up →
close before building). ⚠ RULED OUT + do NOT re-chase: the parallel reprocess option (`ocr_parallel_reprocess_enabled`)
AND the `field_rules` multiline rule were BOTH wrong leads. **5 commits, all PUSHED:** `2cbc3ec` **P2**
foreign-date-field drop at BOTH confirm sites after the auto-file gate (kill `FOREIGN_FIELD_DROP`; shared
`src/lib/foreignFields.js`; sweep `scripts/p2-foreign-field-sweep.js` found **94** live rows — owner `--apply`) ·
`bd7eb83` date cross-check by CALENDAR date not raw string (kill `DATE_AWARE_CROSSCHECK`) · `f55bf98`
garbled-snippet tidy (renderer) · `3e3fde1` the crash fix · `dde0e39` **label caption guard** — a taught
label ("Item") that leads a HEADING ("Item Information") no longer harvests "information"; nulls the caption
re-read + emits an empty+note row → review (kill `ANCHOR_CAPTION_HARVEST_GUARD`; Oracle conds 1-6 met; corpus
A/B OFF-vs-ON **byte-identical**; the geometry occurrence-picker to make teaching auto-STICK is a DEFERRED
follow-up). Live DB **mig 52, 187 confirmed**. Corpus gate EXITS 1 on the PRE-EXISTING baseline (M=3
poisoned-GT #190/#7 + OCR misreads), NOT this session's fixes (crash fix log-only; label guard A/B empty diff).
**Base block ↓**

## (prior) Session state (2026-07-22 LATE) — READ `HANDOVER_2026-07-22_LATE.md` FIRST
**2026-07-22 LATE adds to the below:** this session's unit tests all RAN GREEN (P1/audit/P3/P5); P1 scope
corrected to **JS-only** (`bc677d1`); **P3 BUILT+PUSHED** (`4e0af32`, wizard 12s self-close, eric-signed,
kill `WIZARD_TEARDOWN_FIX`); **P5 BUILT UNPUSHED** (`0849579`, alphabetical Template Manager, kill
`TEMPLATE_VIEWER_ALPHA`). Origin at `5db3590`, **1 commit ahead**. Open: H2 owner decision · P2/P4
designs · installer rebuild + owner live-test of P3/P5/teach. **Base block ↓**
**2026-07-22 (Opus 4.8) — the night run + a security-audit remediation pass; branch
`feat/reprocess-throughput-autostraighten` has **11 commits UNPUSHED** on top of origin `370d04d`
(`f6d85b5`→`90ecaf7`). Tree clean except this session-state refresh.** The LATE handover's UI batch is
now COMMITTED (`f6d85b5` cards, `1618f77` wizard height, `f9bc202` teach batch — **still none owner-tested**).
**P1 BUILT** (`ac7bdb3`): `repairSuspects.detectRefPrefixOutliers` (JS, kill `REPAIR_PREFIX_MISMATCH`) —
suggestion-only Learning-Repair flag for a ref whose alpha prefix (DN/PO/SO/INV) disagrees with the
type's dominant one. **JS-ONLY by deliberate reggie+Oracle decision** — the "one side or both" answer is
**JS-only + a Python tripwire**: `format_anomaly_checker.shape_signature` stays PREFIX-BLIND on purpose
(prefix-awareness at extraction time would fail-toward-review-violate on a new supplier), pinned by
`test_format_shape_consistency.py` §8. Do NOT port the rule into Python. Tests green (JS 27/27 + Py §8). **P3 BUILT** (`4e0af32`, kill
`WIZARD_TEARDOWN_FIX=0`): the first-run wizard's 12s self-close — `openMainShell`'s teardown now
identity-scopes the captured cover-window instances + tears down synchronously on the reuse branch +
stores/clears the backstop timer (`src/lib/coverTeardown.js`, pin `test_coverteardown.js` 19 checks;
eric SIGN-OFF-W/CONDITIONS, all met). **⚠ needs an owner FULL-RESTART to confirm live** (main-process
change); does NOT fix the separate "Re-run reopens a stale wizard on its old step". **P5 BUILT** (2026-07-22,
kill `TEMPLATE_VIEWER_ALPHA=0`): Template Manager roster now ALPHABETICAL by name — sorted in the
viewer-only wrapper `templates.getAllWithLiveCounts` (its sole non-test caller is the `get-templates`
IPC); the matcher-facing `templates.getAll` count-desc order is left BYTE-IDENTICAL (pinned in
`test_template_confirmed_count.js` with divergent names). **P2 DIAGNOSED, P4 DESIGNED** (`b0739ca`, docs
in `docs/designs/`): P2 fault(b) root cause = generic Stage-1 date patterns all carry a bare `"Date"`
label, so a delivery docket's `Date:` fills invoice/order/po_date alike (Option A storage-seam fix
recommended, NOT built). **SECURITY AUDIT `SECURITY_AUDIT_2026-07-21.md` — 6/7 FIXED:** H1 CA-key-at-rest (`8546932`,
`src/lib/secretStore.js`) · M1 secure_delete (`75634be`) · M2+M3 `/v1` session-revoke + TOTP re-auth
(`90ecaf7`) · M4 nav lockdown (`3555c73` `src/lib/navGuard.js`) + CSP `'none'` sweep (`12c9da1`) · M5
empty-array backup guard (`596c083`). **H2 (LAN pairing TOFU) is the ONLY open finding — DESIGN ONLY,
needs OWNER Path-A-vs-B call** (`docs/designs/AUDIT_H2_PAIRING_2026-07-21.md`; add-on OFF by default = no
live exposure). ⚠ **UNVERIFIED: no test suite / corpus gate was RUN this session — unit tests authored,
not proven green.** Installer predates all 11 commits → REBUILD before any live test. Nothing pushed.

## (prior) Session state (2026-07-21 LATE) — `HANDOVER_2026-07-21_LATE.md` (NIGHT RUN NOW DONE — see 07-22)
**2026-07-21 LATE (Opus 4.8) — UI session; branch `feat/reprocess-throughput-autostraighten` was
pushed through `370d04d`** (verified `git rev-list --left-right --count @{u}...HEAD` = `0 0` —
the earlier "7 commits ALL UNPUSHED" note below is STALE, do not re-push). **(This batch is now
COMMITTED as `f6d85b5`/`1618f77`/`f9bc202` — see the 07-22 block; still NONE owner-tested.)** (1) `onboarding/index.html` **first-run cards** — a `theme.css` `.card + .card{margin-top:16px}`
leak knocked every row-card after the first down 16px (the long-standing "second card doesn't line up");
cancelled + selected card grows via **flex-grow NOT scale** (scale overlapped the wide Accuracy row) —
owner said "this is better" · (2) `main.js` **wizard height 720→820**, screen-clamped via new
`onboardingWindowOptions()` (fixed-size window must fit its TALLEST step; step 1 grows ~95px when
"Choose a folder" reveals the path row) — NOT yet seen running · (3) `teach/{index.html,renderer.js}`
**teach batch** (7 changes): native-resolution crop = **OCR parity with Review** (fixes teach reading
`SO-51261` as `$00-51261`; kill `TEACH_NATIVE_CROP=false`), **Issuer taught POSITION-ONLY** (no phantom
label anchor; same rule as Review RC2), read-back panel moved to the banner via one `setConfirm()` seam,
`.pact`/`.ptitle` prompt emphasis via one `setPrompt()` (⚠ the "What to do now" GUIDANCE BAND was
REJECTED — do NOT rebuild), page-preview doc picker + 1.5× default zoom. **WIZARD SELF-CLOSE ROOT-CAUSED
(not fixed):** `openMainShell()` arms an uncancelled `setTimeout(teardown,12000)` (`main.js:210-217`)
whose `destroyWindow('onboarding')` resolves the window at FIRE time, so any wizard alive 12s after any
`openMainShell()` is destroyed — and on a re-run the main-shell reuse branch skips `loadFile` so
ready-to-show never fires and the 12s timer is the ONLY teardown. Fix = run teardown synchronously on the
reuse branch + identity-scope it + clearTimeout (eric-gate). **Corrections to CLAUDE.md:** live DB is at
**mig 52** (not "51 until next start"); opt-in diagnostics IS built (`telemetry.js` + mig 42 + Settings
toggle + wizard card, OFF by default — not "DESIGNED but NOT built"). **The AUTONOMOUS NIGHT RUN this
block planned (§7) HAS RUN — P1 built, P2 diagnosed, P3–P5 designed; see the 07-22 block for outcomes.**
Installer `...r20260721-1010-581d626.exe` predates the 07-22 commit stack → REBUILD before live-test.

## (prior) Session state (2026-07-21) — READ `HANDOVER_2026-07-21.md`
**2026-07-21 (Opus 4.8) — 7 commits, ALL UNPUSHED on `feat/reprocess-throughput-autostraighten`
(`f08f131`→`8f41e95`); tree clean.** Overnight SECURITY AUDIT delivered (`SECURITY_AUDIT_2026-07-21.md`,
gitignored: DB not encrypted → recommend disk-level; licensing self-grant main-process-only; PHP
hardening inert until IONOS). Then, live-testing: (1) `581d626` **label-as-value** — a taught 'below'
anchor no longer commits its own caption garble (order A→C→D→B; kills `NAME_HOLD_ADMIT_OVERRIDE`/
`LABELLOCK_INLINE_PROVENANCE`/`CAPTION_BAND_REJECT`) · (2) `666258a` **identity self-poisoning** — the
`TEMPLATE_SUPPLIER_LINK_GUARD` confirm path voted the doc-being-confirmed for its own stale identity
(the "Copperfield sticks after re-teach" root cause); `getDominantSupplier`/`establishedIdentity` now
take `excludeDocId` (kill `TEMPLATE_GUARD_SELF_INDEPENDENT`) · (3) `27d54b7`+`5760489` **Search UI** —
vertical rail + zoom/pan + expandable details + ↑/↓ cycle · (4) `1234814` **box-width learning**
(migration **52** `field_anchors.max_w_norm` high-water; DARK behind `ANCHOR_MAX_CROP_WIDTH`; live DB
**IS at 52** — the "still at 51" note was superseded once the app restarted) · (5) `80d532c` **letter-spacing type recovery** — "PU RC HASE ORDER"→
Purchase Order via top-band collapsed-equality + Seam-B heading force (default ON `HEADING_LETTER_SPACING`;
multi-word-only guard) · (6) `8f41e95` audit-log View buttons styled. **Installer
`...r20260721-1010-581d626.exe` predates commits 2–6 → REBUILD before owner live-test.** Non-bug: filed
files show scan mtime (copyFileSync preserves it), not a filing bug. Poisoned GT: doc #190
LarkspurInteriors_purchase_order_08 mis-confirmed as delivery_note. **QUEUE (diagnosed, not built):**
first-run-wizard output-folder-not-copying-on-a-different-PC (REAL, unstarted) · per-template field
HIDING (superset-locked, structural-protected) · keyword-per-field (backend done, UI left) · po_date
corroboration date-separator exemption · worksheet line-merge mode-3 (diagnose doc-156 A-vs-B first) ·
buyer-issued Supplier→issuer guard trace · `LETTERHEAD_ISSUER` flip · **TEACH-WIZARD PROMPT EMPHASIS — DONE 2026-07-21, uncommitted**
(owner: the wizard is hard to follow — "you don't know what to do next, so you find yourself looking for
the instruction". ⚠ A "What to do now" GUIDANCE BAND above the pane was built and **REJECTED by the owner
as "too much" — do NOT rebuild it.** The accepted answer is far smaller: make the EXISTING step-3 banner
stand out by splitting the prompt into a quiet ACTION line + the FIELD NAME as a title
(`.pact`/`.ptitle` in `teach/index.html`; single `setPrompt(action,title)` helper in `teach/renderer.js`
so a later prompt can't lose the emphasis). Awaiting owner test) ·
**FIELD ORDER UNSTABLE ACROSS DOCS** (owner 2026-07-21, Search pane + probably the detached client:
the same type's fields appear in a DIFFERENT order doc-to-doc. LEAD, evidenced: `getWithExtractions`
`database/modules/documents.js:126` is `ORDER BY rowid` = the order the PYTHON ENGINE happened to emit
fields for THAT doc, which varies by which stage won — so it is arbitrary per document. `fields.sort_order`
ALREADY EXISTS (`database/index.js:1205`, default 100) and is the intended canonical order. Fix = order
displayed fields by the type's `sort_order` (fallback rowid) at the SHARED seam so Review/Search/client
all agree; then ADD drag-to-reorder in the Doc Type editor writing `sort_order`. ⚠ structural roles
issuer/date/ref must stay reorderable-but-never-deletable; check the /v1 DTO contract before changing
client-visible ordering) · **"RE-RUN SETUP" REOPENS A STALE WIZARD, NEVER A FRESH ONE** (found 2026-07-21 while styling
the cards. VERIFIED: `close_to_tray` defaults to `'true'` (`main.js:655`), and onboarding is in
`PRIMARY_WINDOWS`, so the window X **hides** it (`main.js:571-578`) instead of destroying it.
`showOnboarding()` (`main.js:220`) then calls `createWindow`, which REUSES a live window —
`.restore()/.show()/.focus()` and returns WITHOUT `loadFile` (`main.js` createWindow reuse branch).
So Settings→Advanced→Re-run setup re-shows the wizard **on whatever step it was left on, with the
previous field values and stale renderer state** — it does not restart setup. Also means renderer
edits to onboarding/login/license/main need a FULL APP RESTART, not a window reopen (child windows
like teach/review/settings/search DO reload — they are destroyed on close). FIX DIRECTION: have
`showOnboarding` reload/reset when reusing (e.g. `loadFile` again), so the wizard always starts at
step 0. ⚠ Check the same reuse-without-reload seam on login/license before changing createWindow
itself) · **"MIGHT NOT BELONG" IS BLIND TO A REF-PREFIX OUTLIER** (owner 2026-07-21, doc **#190**
`LarkspurInteriors_purchase_order_08.pdf` — a PURCHASE ORDER confirmed as a DELIVERY NOTE, with
`PO-21275` stored in Delivery Number while every sibling reads `DN-#####`. ROOT CAUSE **VERIFIED, not
hypothesised**: `repairSuspects.shapeSignature` (`src/services/repairSuspects.js:36-45`) maps EVERY
letter to `@`, so `PO-21275` and `DN-70795` BOTH reduce to `@@-#####` — identical. The detector
discards the only differing token, so this class is STRUCTURALLY invisible; no threshold tuning can
ever surface it (B1 at :182 and the pool check at :239 both compare shapes only). FIX DIRECTION: learn
the dominant ALPHABETIC PREFIX / literal token per (doc-type, field) alongside the shape and flag a
strong-dominant mismatch — owner: "needs to be smarter than a 1-char swap". ⚠ Mirror lives in
`format_anomaly_checker.shape_signature` (python) — keep the two aligned or they drift. NOTE doc #190
is ALSO the known poisoned-GT doc, so fixing this detector would have caught the poisoning itself) ·
**IRRELEVANT DATE FIELDS ALL FILLED WITH THE SAME VALUE** (owner 2026-07-21, seen in Learning
Repair on `IronbridgeFabrication_delivery_docket_04.pdf`: a DELIVERY NOTE shows Delivery Date **and**
Invoice Date **and** Order Date **and** Po Date, all four = "12-06-2026", while the real Delivery Date
read as the garbled "2 12/06/2026" and got flagged. TWO separate faults: (a) a delivery note carries
invoice/order/po date fields AT ALL — CLAUDE.md already records that extraction runs against the UNION
of all installed types' keys, so a date lands in every date-ish key; (b) one date value is copied into
every one of them, which then feeds learning as if corroborated. Overlaps the per-template field HIDING
item but is NOT the same thing — hiding is display-only, this is bad DATA being stored and learned.
Diagnose which stage writes the duplicates before designing) · **TEMPLATE MANAGER ALPHABETICAL** (owner 2026-07-21. LEAD: `templates.getAll`
`database/modules/templates.js:32` sorts `confirmed_count DESC, name`. ⚠ SEAM — that same `getAll` feeds
the sibling tiebreaks and "the order templates reach the matcher" (`277a107`/`TEMPLATE_LIVE_COUNTS`), so
do NOT re-sort the query; sort in the Admin Template VIEWER only, or add an explicit display-order arg).

## (prior) Session state (2026-07-20) — full detail in `HANDOVER_2026-07-20_LATE.md` + `docs/session-log.md`
**LATE SESSION 2026-07-20 (Fable 5) — READ `HANDOVER_2026-07-20_LATE.md` FIRST.** All pushed
through `2a81124`, tag `milestone-20260720-identity` (owner-marked good point). **CURRENT installer
`dist\ScanFinder Setup 2.0.0-r20260720-2050-2a81124.exe`** — every earlier one is stale. The live
DB was WIPED ~21:00 for a fresh-install test (migration 51); the OLD 213-doc misfile corpus is
preserved at `%APPDATA%\ScanFinder\docusnap.backup-20260720-misfile-corpus.db` (replayable via
`TEMPLATE_PROBE_DB`).
**THE FRESH SESSION'S BUILD JOB — the LABEL-AS-VALUE plan (Oracle-ruled, NOT built).** A correctly-
taught 'below' anchor commits a garble OF ITS OWN LABEL ('Vetiver 10'≈"Deliver To") as
customer_name — 12/20 live Ridgeway dockets, 7 of 12 UNFLAGGED; on a graduated supplier the class
silently wrong-files. Root causes (007 instrumented replay, all code-verified): the OCR ladder's
preview fast path re-crops the FULL PAGE from the UNCLAMPED box (anchor.py:2335-2347/:2402/:2448 —
restores the caption band the :525 clamp excluded; `clean_crop_segment` takes the FIRST line) · a
swallowed NameError at :578 (bare except :598; fixing it ALONE makes inline junk MORE Tier-A-
eligible — sequencing load-bearing) · flag family structurally capped
(name_quality('Veliver to')=1.0 == 'Denver Trading') · merge hold dead on `keyword_override`
(engine.py:255 checks =="keyword") · Tier-A ignores confidence. **Build order A→C→D→B** (ladder
clamp → composed reject [bare fuzzy-echo vocab AND window-overlaps-caption-band; content alone
CANNOT separate: gary's full-label echo misses 'Vetiver 10' at 0.444, the bare vocab falsely
rejects 'Denver Trading' at 0.286] → keyword_override one-token → NameError fix; E crop-first
DEFERRED). Full plan + merge gate: memory `project_label_capture_plan.md`. ⚠ DATA HYGIENE: the 12
garble docs are in the review queue — confirming one plants the garble into learning; reprocess
after the fix, or correct Customer per-doc first.
**GEOMETRY SLICE BUILT+MEASURED, still DARK (`2a81124`, LETTERHEAD_ISSUER=0):** words_out threads
page-0 rows/heights → `pick_issuer(geometry=)`; COLUMN-SEGMENT candidates, LINE-level heights
ratioed to med_h, fragment-yields-to-superset. Real scans 0%→**67% correct** (117/174, 13 garble
fragments, 44 honest abstains), synthetic 45/45. Flip = owner+Oracle decision. Corpus byte-identical
proven on a SAME-DB stash pair (mid-session A/B is invalid while the owner confirms — re-pair).
**Earlier today (see EVENING/daytime handovers):** trust gate `eb79638`, issuer band `e8f3a6c`,
detected-type nudge `0f3c8e9`, word-geometry hand-off `1bc144e` (now consumed by the slice above).
**Five PRE-EXISTING test failures catalogued by stash-bisect (NOT today's work, un-triaged):**
test_anchor_crop_crosscheck(3) · test_late_anchor_rescue(7) · test_template_rescue(1) ·
test_field_data_types(silent) · test_identity_fusion(known).
**THE 10 template_fixed MISFILES ARE FIXED (late evening 2026-07-20, `705da10`→`7c541fa`)** — full
investigation → gary+Phillip design → Oracle SIGN-OFF-WITH-CONDITIONS → built in his order. Five
kill-switched slices, ALL ON: `TEMPLATE_SUPPLIER_LINK_GUARD` (the confirm-time reinforcement loop —
Oracle's blocking catch: a corrected confirm bumped/appended/diluted/landmark-sampled the WRONG
template; guard at BOTH the reviewService confirm seam and `_upsertTemplate` Part E) ·
`TEMPLATE_GATE_DISTINCTIVE` (Stage-0 gate on distinctive tokens — V1 was defeated 3 ways: the
logo+slug bypass, junk 'INV'/'Industrial' stored tokens, and a rival bar unreachable by cross-type/
customer-leaked fingerprints; V2 = per-identity banks + supplier-NAME arm, fuzzy, issuer-band) ·
`BRANDING_DISTINCTIVE_TOKENS` (engine banks, parity-pinned) · `FINGERPRINT_HYGIENE` (digit-glue
harvest skip + confirmed-customer-token subtraction; stored leaks HEAL via the update intersect) ·
`BRANDING_NAMED_BLANK` (a named-rival-contradicted `template_fixed` value blanks + keeps the "Use"
button; locked/un-named/non-template NEVER blank). **Gate: `stress_test/template_gate_probe.py`**
(permanent live-DB replay — realdoc_regression is BLIND to this class): 52/52 wrong-match outcomes
healed (the 10 + the Larkspur-class), false-abstain 0; corpus ON == baseline byte-identical.
**The 6 misfiled Vellum docs in review are safe to correct+confirm once a build with the guard is
installed** (needs an installer REBUILD — the current one predates all of this). Residual, honest:
a FULLY cold supplier (no template/hints/name anywhere) still accepts + flags with the wrong name —
that is the letterhead cold-start thread's job, not this fix's.

**Branch `feat/reprocess-throughput-autostraighten` — ALL PUSHED through `2a81124`, working tree
clean. (Installer note superseded — the CURRENT installer is `...r20260720-2050-2a81124.exe`, see
the LATE session block above.) Daytime detail: `HANDOVER_2026-07-20.md` (then
`HANDOVER_2026-07-19.md`).**
- **OWNER-REPORTED LIVE BUGS FIXED 2026-07-20** (all root-caused from their log + a copy of the
  second machine's DB, all corpus-gated byte-identical): **`04a6af1` the FRESH-INSTALL TYPE HOLE** —
  a type detected from the SHIPPED keyword buckets but NOT installed (Delivery Note is a PRESET, not
  a built-in) left `detected_slug` None, which silently DISARMED **both** type-refuse guards, so a
  same-supplier PO template stamped its slug on delivery dockets; now the slug is DERIVED
  (`_slug_from_type_name`, parity with JS `safeSlug`; kill `DETECTED_SLUG_FALLBACK`) ·
  **`277a107` `templates.confirmed_count` was ALWAYS 0** (only bumped on the taught-confirm branch) —
  NOT cosmetic: it feeds the sibling tiebreaks at `template_matcher.py:179` + `engine.py:696` and the
  order templates reach the matcher, all inert at 0; `getAll` now serves the LIVE count
  (`liveConfirmedCounts` returns **null**, not an empty Map, when uncountable so a fixture without a
  `documents` table keeps the stored value; kill `TEMPLATE_LIVE_COUNTS`; a pin asserting "getAll is
  UNTOUCHED" was deliberately flipped) · **`0107331`** a GARBLED caption on the RELOCATED crop (the
  exact check was relocate-only, the fuzzy check rigid-only — a garbled relocate fell between them) ·
  **`53ceea9`** Review now says WHY a clean doc waits below the auto-file threshold.
- **UNTYPED-DOC REVIEW MESSAGE FIXED `39e8142`** (gary design → Oracle SEND-BACK-WITH-CONDITIONS;
  his C1 IS the commit): a null-type doc used to fall through to the clean-hold branch and be told
  "just below the X% you've set — lower the threshold", which is FALSE at any threshold because
  `trust.js` refuses `no-type` unconditionally; `validateConfirm` also disabled Confirm with NO note.
  New FIRST branch in `renderReviewReason` **gated on `document_type_id`, NOT on any detected name**
  (the advice is wrong for EVERY untyped doc; detection usually returns nothing at all) + a note on
  the no-type Confirm return. ORDERING is the load-bearing property — pinned by
  `src/windows/review/test_review_untyped_reason.js` (8 checks red pre-fix). **STILL OPEN (gary's
  slice 1 tail, Oracle C2/C3/C5/C6): `detected_type_name`/`detected_type_conf` columns (migration 51
  is free) + the "Add '<type>'" button. TRAP to solve first — extraction ran against the union of
  all installed types' keys, so add-type → auto-select rebuilds rows by key and every field goes
  BLANK; add-a-type must be followed by a REPROCESS (safe: reprocess forces needs_review and
  `_maybeAutoFile` has ONE call site, the import `file_done` path) or must not auto-select. Also:
  clear the columns wherever a type is later assigned, and `document_type` can be template-overridden
  while `type_confidence` is always the keyword score (don't pair them blindly).**
  ⚠ `realdoc_regression.js` spawns `process_docs.py` DIRECTLY — it is structurally blind to every
  Electron/renderer change. A green corpus run proves nothing about renderer work.
- **DETECTED-TYPE NUDGE BUILT `0f3c8e9`** (the tail above, Oracle C2/C3/C5/C6): **migration 51**
  `documents.detected_type_name` (NULL-inert; set ONLY when a detected name matches no installed
  type; **name only — no confidence column**, since `type_confidence` is a keyword-bucket score and
  `document_type` can be template-overridden) · one helper `_resolveDetectedType` at BOTH insert
  seams, reprocess **CLEARS** via plain assignment not COALESCE (else the suggestion outlives the
  type being added) · Review's untyped notice gains "Add '<type>'" which **adds AND RE-READS** —
  auto-select alone BLANKS every field, because extraction ran against the union of all installed
  types' keys (Oracle's best catch) · **NO slug fallback** (would newly resolve types exact matching
  misses = a live `document_type_id` change; pinned out) · kill `DETECTED_TYPE_NUDGE=0`. PIN A: a
  named detection never adopts Generic. Guarded by `test_detected_type_nudge.js` (whitelist trap
  proven red first). **UNCLICKED — needs an owner fresh-install run with dockets.**
- **AUTO-FILE TRUST GATE — non-role shape leniency, DEFAULT ON `eb79638`** (built dark `5f88791`;
  Barry+gary designed, **Oracle SENT BACK and the shipped design is his**). Sub-100 auto-file
  required EVERY valued field to pass `valueMatchesShape`, which returns false for `'freetext'` BY
  DESIGN — so a per-document customer name made the gate UNSATISFIABLE and **graduation unreachable
  for any doc carrying one**. Measured: 29 docs held, 25 of them among 156 already hand-confirmed.
  **THE TRAP THAT KILLED TWO DESIGNS:** `item="Information"` is a misread that GETS CONFIRMED, which
  collapses its own field to freetext — so a blanket freetext exemption **disarms the guard exactly
  when the field is poisoned** (today's blanket block fails SAFE under contamination; both proposed
  designs failed OPEN). Also rejected: keying on `isNameLikeField` — it matches on SUBSTRING, so
  `customer_order_number`/`company_reg_no` are "name-like" CODE fields; it was built for
  `_buildTemplateFields` where over-inclusion is safe, here it inverts. **SHIPPED:**
  `_dominantStructuredClass` (≥5 samples, ≥75%) consulted ONLY in the lenient branch — 14 codes
  outvote one intruder, 11 varied names abstain. Do NOT change `classifyLearnedShape` itself (it
  feeds `scopeTrust`, and reclassifying there widens GRADUATION). NULL/dangling role ⇒ NO leniency
  (the 88 floor is already a no-op there — two guards off at once). Gate: corpus A/B 50→82
  would-auto-file, **M unchanged at 1**, M_type 0, accuracy byte-identical. Kill
  `TRUST_NONROLE_SHAPE_LENIENT=0`. Pins: `test_scope_trust.js` §18b (contaminated history — FAILS
  against the rejected design) + §18c (NULL-role) + the both-directions trade-off pin.
- **REVIEW HOLD REASON IS NOW AUTHORITATIVE (`5f88791`, Oracle merge precondition)** — the panel
  derived its message from the confidence threshold and claimed that was "truthful by construction".
  **FALSE once graduation is active** (effective floor = min(threshold, 95)), and wrong BOTH ways: a
  gate-held doc was told to lower a threshold that cannot help it, and a graduated doc ABOVE its
  floor was told **"Ready to file"** about a doc the predicate had refused. New `get-auto-file-reason`
  IPC returns the SAME predicate's verdict; the panel names the blocking field. **THIRD false
  hold-reason of this class fixed 2026-07-20** (`39e8142` untyped, this one, + the nudge copy) —
  when Review explains a hold, it must read the real verdict, never re-derive one.
- **ISSUER BAND for known-supplier text matches `e8f3a6c`** (gary design → Oracle SIGN-OFF-WITH-
  CONDITIONS C1-C4). `engine.py` Stage 2.5a matched a known supplier HINT anywhere in a raw
  `ocr_text[:600]` slice whose docstring called it "the issuer band" — it isn't: the RECIPIENT name
  sits ~160-180 chars in on real docs, so the CUSTOMER was admissible evidence for the ISSUER.
  Now `_issuer_hint_band` truncates at the first recipient marker via `chrome_band.issuer_chrome`,
  keeping the 600-char REACH (`_HINT_BAND_LINES=40`) — chrome_band's own `max_lines=6` default is
  NOT used and must NOT be moved (it is calibrated for TOKEN-RATIO consumers like
  `_identity_text_sufficient`; this consumer is an all-or-nothing substring test). Kill
  `ISSUER_HINT_BAND=0`. **THE REWARD IS ON THE GRADUATION ARM, not the swap arm** — graduation swaps
  a NOTED fill for an UN-NOTED one and `trust.js` refuses auto-file on any note BEFORE the floor
  check, so the note IS the human checkpoint; its stated evidence standard (`engine.py:3024`) had
  never matched the code. **Oracle C1 (the blocking catch): the swap arm has NO else** — suppressing
  a match left an IMPLAUSIBLE incumbent ('IN') standing as the filing + learning scope, unnoted; it
  now blanks with a note, DELTA-SCOPED to only where the legacy slice would have matched.
  HONEST SCOPE: marker-bearing layouts only — a marker-free "To:"-first page still gets the legacy
  window. Accepted+pinned costs: issuer-RIGHT two-column loses its match; a two-row-wrapped name is
  newly matchable. **Does NOT fix the buyer-issued vendor-caption class** (needs a type-aware slice;
  do NOT add supplier/vendor/seller to `_RECIPIENT_MARKER` — type-blind, 3+ consumers, and
  "Supplier: ACME" is the issuer's own self-declaration on a supplier-issued form).
- **⚠ THE ISSUER IS ONLY FINDABLE BY A CAPTION — the structural cold-start hole (OPEN)**. Traced
  2026-07-20: `Vellum & Crane Stationers` is OCR line 1 and `supplier_name` comes back null.
  `field_patterns.supplier_name` is caption-only (Bill From/Supplier/Vendor/Issued By/Billed By/
  Seller/Company Name/Business Name) and real letterheads carry NONE; `position_hint:"top_third"`
  is DEAD CONFIG (read nowhere). The RECIPIENT *is* captioned (`Bill To`, base_confidence **78** vs
  the issuer's **40**). EVERY other issuer path (template/logo/hint-scan/branding) is
  learning-dependent ⇒ dead on a cold DB. 007: the geometry that would fix it (word boxes, heights,
  `med_h`) is COMPUTED THEN DISCARDED at `ocr/tesseract.py:239` — `keyword.py` gets a bare string, so
  "largest text in the top band" is UNREPRESENTABLE, not merely unimplemented. Designed, NOT built:
  a `letterhead.py` SUGGESTION-only reader (it only ever has to carry doc #1 — after one confirm,
  learning resolves the supplier forever, so it never needs authority to assert).
- **⚠ RECURRING TRAP — THREE stale fixtures fixed in one day, all one class** (`71ffc8d`, `0f3c8e9`):
  a `documents`/`templates` test fixture that never gained a column production gained. Because
  `documents.insert()`/`templates.create()` name every column, the INSERT fails outright and EVERY
  downstream assertion reads as a PRODUCT regression ("the failure-row producer regressed"). SUSPECT
  THE FIXTURE SCHEMA FIRST. Also: `documents.update()`'s `allowed` whitelist SILENTLY DROPS unknown
  keys — a column added to `insert()` but not there writes once and can never be cleared.
- **THE TWO PRE-EXISTING TEST FAILURES ARE FIXED (`71ffc8d`)** — both were stale, not regressions:
  `test_reprocess_type_flip.py` unpacked a 5-tuple from `doc_overrides` (6 since the supplier-pin
  work), and its own shape pin was red too so it never flagged it; `test_promote_custom_doctype.js`
  had a fixture predating `logo_detail_hash`/`detail_hash` (mig 47), so the promote died on
  "no such column" and EVERY later assertion cascaded off that one error. A stale pin there was
  deliberately flipped: it asserted a recipient `customer` name freezes as a template `fixed_value`,
  which contradicts `_buildTemplateFields` rule (B) — only the ISSUER is legitimately constant.
- **WORKFLOW SUITE — engine COMPLETE for single-hop; 2 slices left, neither blocking**: built =
  slice 0 (authz) · 1 (reveal core) · 2 (decision snapshot) · 3 (amount routing) · routing-settings ·
  FYI non-locking · E1 admin cancel. REMAINING = **slice 5 delegation+escalation** (a real feature,
  not a prerequisite) and **slice 6 PACKAGING FLIP** (unbundle from the client seat + backend SKU +
  entitlement card — this is the go-live switch). Slice 4 multi-step DEFERRED (Barry). The temp
  `WORKFLOW_FEATURE_ENABLED=true` flip is REVERTED (`14a7d2e`) — the suite ships dark; flipping it
  locally for testing turns `test_entitlement.js` red, which is expected, not a regression.
- **FYI NON-LOCKING slice BUILT 2026-07-19 (Barry→gary/eric→Oracle C1–C8, 20-suite gate green)** —
  only open APPROVE routes lock (`hasActiveApprovalRoute`, NOT-acknowledge polarity incl. NULL;
  env `WORKFLOW_ACK_LOCKS=1` restores old locking); delete now CLOSES open routes as 'recalled' +
  "Document deleted by <name>" at ALL SIX soft-delete doors (five were unguarded — pre-existing
  approve-strand hole fixed; **/v1 delete also GAINED editGuard**, was a remote authz hole); rule
  builder offers "for approval / for information"; mailbox shows "For your information"/"Got it"
  (display-only). Spec+conditions `docs/designs/WORKFLOW_FYI_NONLOCKING_2026-07-19.md`. KNOWN:
  `test_entitlement.js` fails while the temp flag flip is in the tree (revert to clear).
- **E1 ADMIN CANCEL-ROUTE ALSO BUILT 2026-07-19 (gary GO-W/CHANGES + eric + Oracle OC1–OC4;
  19-suite gate green)** — `workflowService.adminCancelRoute` (admin-only both layers; pending AND
  claimed; CAS; comment ALWAYS "Cancelled by <name> (administrator)" = the third 'recalled'
  producer discriminator; conditional workflow_status stamp; `admin_cancelled` badge-only event;
  heals routes on deleted docs/recipients — NEVER add a ROUTABLE_STATES check there) + 3 IPCs
  (`workflow-admin-cancel` / `workflow-doc-routes` access-gated per SEC-03 / `workflow-open-routes`)
  + Search-preview routed-banner (self-populating `.wf-routed`, two-step confirm, no native
  confirm()) + Settings→Workflow "Open routes" list (THE discovery surface — system routes appear
  in nobody's Sent; deleted-doc rows included as the legacy-strand healer). Spec
  `docs/designs/WORKFLOW_ADMIN_CANCEL_2026-07-19.md`. The workflow feature is now
  PRE-LAUNCH-COMPLETE per the handover checklist. **NEXT:** owner live tests (print/Ricoh; a
  click-through of the rule builder + FYI flow + cancel surfaces while the flag is on) → revert
  `WORKFLOW_FEATURE_ENABLED` to false before any push/build → push decision (23 commits).
- **Workflow suite**: Slices 1–3 + the routing-settings slice ALL BUILT, DARK behind
  `WORKFLOW_FEATURE_ENABLED=false` (entitlementService.js). Routing = a separate step at the FILING SEAM
  for EVERY filed doc (auto-filed via `workflowService.assignSystem` null-sender + reviewed + File-All-Ready),
  admin rules in a hidden Workflow Settings tab. Spec `docs/designs/WORKFLOW_ROUTING_SLICE_2026-07-19.md`;
  Slice-1 plan `docs/designs/WORKFLOW_SLICE1_BUILD_2026-07-18.md`. Multi-step routing DEFERRED (Barry).
- **⚠ AWAITING OWNER LIVE TEST**: print flow fix `75206fb` (does the Ricoh spool paper? z-order OK?) —
  Electron 31 CANNOT show the classic Windows print dialog (Win11 behaviour; print callback UNRELIABLE —
  modal is callback-independent); clean native rebuild BANKED in `docs/designs/NATIVE_PRINT_2026-07-18.md`
  (C2: compiled C# helper, NOT .ps1). Also pending: Generic-Document owner smoke; reprocess-parallelism
  load test (`ocr_parallel_reprocess_enabled`); Filing Slips real-MFD pilot (then slice 5 watch parity
  BEFORE default-ON).
- **Recently shipped, DEFAULT OFF unless noted**: Filing Slips slices 1+2 (synthetic pilot PASSED);
  Generic Document type + Auto-Title (6 slices, `4a4abe4`); template convergence M2/M3
  (`TEMPLATE_REUSE_BY_BRANDING` — ⚠ open: real-DB duplicates have no landmarks → merge won't fire, see
  `docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md`); supplier PIN + resolve-the-issuer (`SUPPLIER_PIN`);
  single-doc reprocess parallelism B+C. DEFAULT ON: accessService authz gate (SEC-03 fix, `f8299d4`);
  auto-file critical-field floor (88); Slice D 256-bit logo detail; OCR warm worker pool; the 2026-07-09→15
  extraction-guard family (see the archive).
- **Security**: work `SECURITY_BACKLOG.md` (repo root, gitignored, LOCAL-ONLY) one-by-one; proactively
  flag holes any new feature exposes. **CODE-FIXED + Oracle-signed: SEC-01/02/06/14 (`aad2141`,
  `bd82a9e`) · SEC-05 (`07d01af` + `98da251` = its Oracle C1/C2/C3) · SEC-13/15/19 (`10bb9e1`).**
  ALL INERT UNTIL DEPLOYED TO IONOS. Owner gates V7 (live `REMOTE_ADDR` — load-bearing for SEC-01)
  + V8 (`php licensing-backend\scripts\test_admin_throttle.php` with WAMP up, never run); the live
  console will REQUIRE 2FA (break-glass env `LICENSING_ADMIN_ALLOW_NO_2FA=1` once).
  **SEC-05 recovery runbook CHANGED**: the rollback mark now also lives at
  `%LOCALAPPDATA%\ScanFinder\.time-anchor`, so "delete `%APPDATA%\ScanFinder`" alone no longer
  un-bricks a machine — delete that file too, or just get it online once (the C2 self-heal).
  **Next open: SEC-04** (dead pairing gate) — eric-designed, NOT built; client transport+IPC already
  thread `code`, ship CLIENT field first then core; his own finding to fold in:
  `backupService._settingExcluded` only filters `licens`, so a pairing code would ride out in backups.
- **IDENTITY REDESIGN — BUILT 2026-07-20** (owner-signed, Oracle C1–C8 folded; 5 commits
  `3c0a744`→`febdc29`; spec `docs/designs/IDENTITY_TEXT_FIRST_2026-07-19.md` carries the full
  verification ledger). A logo match no longer asserts identity alone: it must AGREE with the page
  text (`LOGO_TEXT_GATE`), may only SUGGEST when the text can't judge, and is DROPPED when the text
  contradicts it — while still surfacing the branding-detected name so the "Use '<name>'" button (and
  the ripple) survive. A confirm can no longer teach the logo to a wrong-but-confirmed supplier
  (`LOGO_PLANT_TEXT_GATE`, corroboration-gated so first-contact enrolment still works). The renderer's
  silent auto-fill is now a click affordance. One correction RIPPLES to same-sender siblings by text
  (`SUPPLIER_RIPPLE`) through the review-bound pin rail. Corpus ON==OFF byte-identical; on the live
  install the gate abstains on exactly the 4 misassigned dockets, 0 correct identities suppressed.
  **OPEN**: Slice 1d — **RESOLVED 2026-07-24 DO-NOTHING-IN-CODE** (Oracle SIGN-OFF-W/COND; the Stage-0
  veto is LIVE via Store B, the 13 links are historical DATA → owner sweep, not a code fix; genuine
  cold-start residual (b) is NOT text-gate-defended = the issuer-by-caption family, letterhead/text
  layer not a logo veto; ledger [[project_slice1d_donothing]]) · D2 Barry slices 3-5 · D3 the inert
  detail-hash path (retire or fix) · **UX: a clean doc held just below the auto-file threshold gives
  no on-screen reason** (owner hit this: 9/20 auto-filed at 100, #121 held at 98 with
  `auto_file_threshold` unset=100 — the mechanism is correct, the silence isn't; Review should say
  "98% — just below your auto-file setting").
- **(superseded) IDENTITY REDESIGN (overnight 2026-07-19) — DESIGNED**: the Larkspur
  incident (20 new-supplier docs; logo layer misassigned 5; correction didn't heal) is diagnosed to root —
  the 64-bit logo phash has ZERO separating power (live-measured cross-supplier min hamming 2) while the
  branding TEXT named the true supplier every time. Direction (Barry+gary): **text-first, logo
  corroborates, abstain-by-default; a logo match alone never assigns or plants learning** + a correction
  RIPPLE via the pin rail. Spec `docs/designs/IDENTITY_TEXT_FIRST_2026-07-19.md`; permanent suite
  `stress_test/logo_identity_suite.py` (GREEN — 6 PIN-BROKEN reality pins). Oracle vet AFTER owner D1.
  KEY TRAP for the build: review-renderer `attemptLogoMatch` is NOT display-only (auto-fills + writes
  corrections = the confirm-time poison back door); Stage-0 `identify_template` accepts on logo alone
  (Slice 1d, own corpus gate).
- **Process rules**: include Barry EARLY on new features (before design/Oracle); control-test-first
  (baseline BEFORE code; kill-switched; OFF ⇒ byte-identical); advisor+Oracle gate on substantive changes.



---

## ARCHIVE: CLAUDE.md 2026-07-29 DAYTIME session-state block (moved out 2026-07-29 EVENING to keep CLAUDE.md lean)

## Current session state (2026-07-29) — long day: fixes + born-digital test rig + reggie fix — ALL PUSHED
**2026-07-29 (Opus 4.8). ALL PUSHED through `3705296` (HEAD; origin `0 0`, tree clean).** THREE phases:
(A) morning "run of fixes" (below), (B) an 800-doc BORN-DIGITAL test batch + a cold/warm SCORER, (C) a
reggie ISO-date/ref-label fix — B+C detailed in the AFTERNOON block after the veto section. Installer
**`dist\ScanFinder Setup 2.0.0-r20260729-0905-3351e2f.exe`** (VETO ON) **PREDATES the reggie config fix
`42a9334` — REBUILD to carry it.** The `-0812-41f1916` build (veto DARK) is superseded.
**Morning "run of fixes":** Committed + pushed the 07-28 uncommitted batch (DPI/forget/focus/overlay) + 3
owner-requested builds.
**Batch committed (07-28 work, now pushed):** `1e0a896` configurable OCR render DPI (`ocr_dpi` 150/200/300,
default 300 = byte-identical; owner LIVE-CONFIRMED 150 FASTER) · `a0ca71d` OCR-DPI selector + native-dialog focus
repair · `91ef6a7` case-insensitive Forget (`COLLATE NOCASE`) · `d04339a` stale anchor-overlay clear + clearer
position-anchor copy · `3a578f4` CLAUDE.md.
**Built THIS session (3 fixes):**
· `aebbd79` **import-view counts** (`main/renderer.js`, renderer-only) — folder preview re-scans at run end
(originals drained to Processed/); session "Found" counts per `file_done`, not the up-front folder total. Fixes
"still says 900 on stop".
· `958229c` **S1 band-graduate — DARK** (kill `TEMPLATE_IDENTITY_BAND_GRADUATE` default OFF) — sheds the
MAJORITY-tier template-identity issuer note → `{V,85,template_identity_corroborated}` when V is STRICTLY
corroborated in the ISSUER BAND (Profile-Construction class: name printed under BILL FROM, fill+note wins the
read). gary→Oracle C1 (strict ALL-tokens, not the FILL's ≥60%) + C2 (band-gated, never raw `[:600]`) + C3
(excluded from `_IDENTITY_STRUCTURAL_METHODS`). Pure static `_should_shed_template_identity_note`; pins
`test_template_identity_band_graduate.py` (20 green). **Corpus fired 0× (vacuous). FIRING TEST DONE (real docs
897/905/963/981/1128): S1 is INERT on its target — DO NOT FLIP.** The Profile docs are TWO-COLUMN born-digital
(`BILL FROM   BILL TO` one line, `Profile Construction   ACME Inc` the next); `_issuer_hint_band` truncates at
the "BILL TO" recipient marker which precedes the issuer name → band `"INVOICE BILL FROM"`, name excluded → no
shed (predicate logic verified correct — ON sheds / OFF keeps / wrong-name held; only the BAND lacks the name).
Same truncation defeats hint-graduation = WHY the docs are stuck. Real fix (deferred, gary+Oracle, C2 is the
constraint): a column/geometry-aware issuer window OR a `BILL FROM`-anchored recipient-excluding window.
[[project_autofile_s1_band_graduate_20260729]]
· `41f1916` (dark) → `3351e2f` **TYPE_PRESENCE_VETO — FLIPPED ON** (kill `TYPE_PRESENCE_VETO=0` restores byte-
identical) — the TYPE analog of `namePresence.js`. HOLDs a wrong-type logo-collision pick whose OWN type-heading
is ABSENT from the candidate top band (worksheet→delivery_note, PO→sales_order — the misfires that happen when
`title_trusted=False` starves the trusted-title refuse `template_matcher.py:457`). Two seams parity-pinned via
`python_backend/tests/data/type_presence_vectors.json`: LEARN = `database/modules/typePresence.js` +
`templates.getAll` threads `{type_heading_ratio,_n,_tokens}` per template; CONSUME = `template_matcher.py`
`_type_heading_absent` + the veto block (after the refuse, gated `_logo_refused is None`, reuses
`_type_refuse`/`type_refused`). Pins `test_type_presence.js` + `test_type_presence_matcher.py` green (matcher
fixtures unaffected — no threaded tokens ⇒ abstain). [[project_type_presence_veto_20260728]]
**Corpus gate (realdoc, 2057 docs, OFF baseline vs BOTH-flags-ON):** M_type=0 held · **ZERO new silent-wrong M**
· veto ELIMINATED #2390 (wrong-ref PO now held) · would-auto-file −30 (~1.5%) + taught-ownership 24→74, ALL
HOLD-only + FAIL-SAFE BY CONSTRUCTION (type_refused → no-template → one-click review, never a wrong file). S1
0 firings. (ON log `scratchpad/corpus_on.log`; OFF baseline = night session `beaewxxm4.output`.)

**AFTERNOON — BORN-DIGITAL TEST RIG + reggie ref/date fix (owner: "we've only tested 2 digital doc types,
both had bugs — build a varied batch"):**
· **Demo batch** — `stress_test/gen_demo_digital.py` (reportlab, born-digital = real text layer, isolates
LAYOUT/anchor/band/type bugs, no OCR noise) writes **800 PDFs to `Desktop/Demo Docs Digital/`**. **Set A** (600:
6 NEW suppliers × 6 archetypes — saas-clean / two-col BILL FROM\|BILL TO / footer-letterhead / three-party /
minimalist-text-wordmark / subheading — reproduces the 2 known bugs; safe anywhere). **Set B** (200: CLASH —
reuses live names SuperStore/Marlowe on divergent layouts). `ground_truth.json` per doc; edge tags
(below_tall / in_image_title / watermark / multi_page). Catalogue from barry+herald+gary. `README_PROTOCOL.txt`:
Set B → COPY DB or plain-confirm-only (gary: template-reuse-by-name collapses digital+scanned into one row,
un-unmergeable; ⊕-teach/correct irreversibly wipes scanned anchors); veto is SEED-FIRST (inert < 3 confirms).
· **Scorer** — `stress_test/score_demo_digital.js` reprocesses vs ground_truth.json, **cold** (empty learning,
isolates layout) or **`warm`** (loads live snapshot). Findings: type detection SOLID (invoice 100/PO 98.8/SO
97.5/delivery 98.8 — installed types); **supplier 8% cold = letterhead cold-start hole**; warm Set B **CLASH
BLEED CONFIRMED** (supplier 90% inherited from scanned learning, ref 29% layout-mismatch → held); warm Set A
**CROSS-CONTAMINATION** (ref 58→33% — live learning degrades UNRELATED new suppliers; suspect name-blind
`findLogoMatch` / global anchor → [[pendingfeatures]]). ⚠ DB has only 5 types + NO total field (install
credit_note/quote/statement/receipt + a total field to score the full 9 + money).
· **`42a9334` reggie ISO-date + ref-labels** (config-only `keyword_patterns.json`, reggie→Oracle SIGN-OFF-W/COND
ALL met) — **ISO date transposition** `2026-11-01`→`26-11-2001` FIXED (`_clean_value`/`_clean_text_fallback`
first-matched the DD/MM pattern on the ISO tail): ISO pattern FIRST + BOTH numeric date patterns now carry
`(?<!\d)…(?!\d)` (Oracle C2, no clip inside a longer digit run). NEW **`delivery_number`** field_patterns entry
(was NONE → 0%). `Our Ref`/`Order Ref`/`Issued` labels. Pins `test_iso_date_clip.py` (+C2 boundary +C5 mirror
trade-off). Corpus: date 96.1% UNCHANGED (corpus is scanned, no ISO — fix targets born-digital), M 19 no-new,
M_type 0, **delivery_number safe on 540 confirmed delivery notes (C3 PROVEN)**. Demo rescore ref 58→83 / date
60→84. **Config change → LIVE in the running dev app on the next processed doc (no restart).**
· **`3705296` `pendingfeatures.md`** — running backlog (owner convention: add discussed-but-deferred features
here). Item 1 = import **"couldn't be read" banner** (`renderStuckChip` `main/renderer.js:1265` — count-only,
no filename/reason/DISMISS; the doc holds at `status='error'`, NOT lost; `getStuckDocs()` already has names) +
10 deferred items (letterhead reader, S1 column-window, warm cross-contam, digital↔scanned bleed, delivery/
worksheet ref, preset+total fields, TYPE-veto slices, identity branding-primary, Cython/fuses hardening).
· **Security Q answered** (owner: ".py/.pak decompilable?"): engine ships sourceless **`.pyc`** (verified in the
package — a speed bump, decompilable); `.pak` = Chromium resources (non-issue); most `.py` = third-party libs +
thin entry shims. Real upgrades (deferred, backlog): Cython→native `.pyd`, arm fuses (`HARDEN_FUSES`), asar
rungs. **Licensing gate = the commercial moat, not code secrecy.**

**NEEDS OWNER:** (1) **REBUILD installer** off `3705296` — `r20260729-0905` predates the reggie config fix. Then
live-smoke: 150-DPI import, reprocess-reconnect (`eebe154`), forget/focus/overlay, the VETO. (2) **Import the demo
batch** — Set A into the live app (safe), Set B into a COPY DB (per README); run `score_demo_digital.js A` /
`… B warm`. (3) **Diagnose the Set A warm cross-contamination** (58→33 ref, [[pendingfeatures]]). (4) work
`pendingfeatures.md` (the stuck-banner UX + the rest). (5) SuperStore anchor-removal
`scripts/remove-superstore-invnum-anchor.js --apply` (app-closed, STILL not run). (6) untracked
`HANDOVER_2026-07-28*.md` + `docs/SECURITY_HARDENING_REPORT_2026-07-28.md` — commit or leave.
**S1 stays DARK (INERT on two-column, real fix deferred). Prior block ↓**

<!-- moved from CLAUDE.md 2026-08-01 night wrap -->
### Prior session (2026-07-30) — reextract + worksheet-type-presence FLIPPED ON (READ `HANDOVER_2026-07-30.md`)
**2026-07-30 (Opus 4.8). HEAD `f3a650a` (+ a CLAUDE.md docs commit); pushed, origin in sync. TWO big flips this session:
`reextract_fast_enabled` (LIVE DB setting, revert `UNFLIP=1` via `reextract_flip_smoke.js`) + the WORKSHEET TYPE-PRESENCE
fix (4 CODE kill-switches default ON — kill each with its env =0). Dev `npm start` is STALE — restart to load. Installer
at `2b8bdb2` predates all this work. Live DB `%APPDATA%\ScanFinder\docusnap.db` — backfill `--apply` WAS RUN (backed up
+ reversible).**
· **✅ WORKSHEET mis-typed as PO/SO — FIXED + FLIPPED ON.** herald traced: (a) the PO keyword "order to" → `order\s*to`
  prefix-matched "Order Total" (14 docs); (b) phash noise (a worksheet locks closer to a DIFFERENT supplier than to its
  OWN template) routed 6 to the UNGUARDED keyword-fingerprint arm → template SO stamped by fingerprint. 4 slices, all ON:
  1a `f2d18ae` `TYPE_KEYWORD_BOUND` · 1b `2300afb` `TYPE_PRESENCE_GATE` (+ Python `_type_heading_tokens` twin, parity-
  pinned) · 2 `21519f9` `TYPE_PRESENCE_VETO_KW` (the kw-fingerprint arm) · nudge `85c7f0b` `TYPE_HEADING_NUDGE` (harvest
  "Worksheet" → Add-type prompt) · flip `f3a650a`. realdoc **BYTE-IDENTICAL 5×** (type 100%, M_type 0, auto-file 82).
  herald→gary→Oracle SIGN-OFF-W/COND all met. NOT retroactive: the 20 existing rows need Add-"Worksheet"-type + reprocess;
  de-confirm #120. Memory `project_worksheet_type_presence_20260730`.
· **Cross-contamination FIXED + FLIPPED ON** (`d9ec7d5`+`2b8bdb2`, kill `SHAPE_WITHHOLD_SUPPLIER_SCOPED`). iris PROVED
  (isolation, NOT phash/anchor) it was the learned-shape `('')` doc-type aggregate = one supplier's ref convention
  hard-nulling stranger refs at Stage 4.5. A `('')`-only verdict now FLAGS-not-NULLS; supplier-scoped withhold
  byte-unchanged. Gate score_demo A warm ref **55→89%**, realdoc **M=0**. Stage-2 residual = **DO-NOTHING** (`23a8f2e`,
  Oracle-traced narrow/corpus-inert). Memory `project_shape_withhold_supplier_scoped_20260730`.
· **Slice 1 learn-on-commit FLIPPED ON** (`8c487e4`, kill `template_learn_on_confirm`). Backfill `--apply`'d on the live
  DB (backup `docusnap.backup-2026-07-30T13-18-45-930Z.db` + snapshot beside it, reversible) — healed the frozen
  Copperfield templates; PROVEN POs resolve to their PO template (`probe_held_pos.py`).
· **Security F1+F2** (`0b63794`, + Sammy re-audit): F1 baked the offline-verify licence keys into `pinnedKeys.js`
  (loose `config/license.json` was forgeable; kill `LICENSE_PINNED_KEYS`); F2 `activate.php` seat-race `FOR UPDATE`;
  H-1 backup-restore guard + M-1 device_fp + L-5 XML. Detail: gitignored `SECURITY_AUDIT_2026-07-29_LOCAL.md`.
· **Teach fixes:** label-detect **frame-math fix** (`1ef3e50` — both label-band `ds` now honour `TEACH_NATIVE_CROP`;
  owner-smoked, labels detect now) · only-current-box overlay + Straighten text button (`c1d128f`) · all-captured
  header cleanup (`d35f42c`). · **Import "couldn't be read" banner** details+dismiss (`4b40284`).
· **✅ Fast on-open re-extract (Slice B) — DONE, BOTH GATES PASS, FLIPPED ON.** `reextract_fast_enabled='true'` in the
  LIVE DB (a DB state, not a commit; revert `UNFLIP=1` via `stress_test/reextract_flip_smoke.js`). B-1 `312674b` (IPC
  `reextract-fields-fast` in processing/handler.js — where the spawn plumbing lives — + fill-only `mergeReextractRows`;
  pin `test_reextract_merge.js` 13/13). B-2 `faaf584` (renderer `_selectDoc` → debounced/doc-guarded trigger + ⟳ pill
  suggestions; `.value`-only, no input event = Oracle C4). Gates: **C2 `39c35d3`** correctness (imageless vs full,
  80 docs → 40 candidates **100% AGREE**, 0 flips) · **C5 `f79980b`** ~284ms vendor/python cold spawn. **Server smoke
  PASS `41f71d5`** (gate enabled, 8 forced-empty fills — all supplier_name via template-fixed value; ref/date correctly
  anchor-abstained). Fire-rate 0 on a stable corpus. LEFT: renderer ⟳-pill VISUAL confirm on next app RESTART (running
  dev app is stale; a stable-corpus open shows none — force an empty field on a templated doc to see one); Slice C
  warm worker deferred. Memory `project_reextract_fast_20260730`.

## ARCHIVE: CLAUDE.md 2026-08-01 DAY + OVERNIGHT and 2026-07-31 NIGHT prior-session blocks (moved out 2026-08-02 NIGHT to keep CLAUDE.md lean)

### Prior session (2026-08-01 DAY) — validation family live + type-refuse deadlock cured
**2026-08-01 day (Fable 5, owner present). `4965984`, PUSHED. READ
`HANDOVER_2026-08-01_DAY.md`** (the overnight handover carries that half). Realdoc at wrap:
299 docs, type/supplier 100%, ref 97.0%, date 99.7%, M=9 (residual = interior stroke substitutions,
6 exemplars, ALL proven pre-existing — the dominant remaining class; second-witness investigation =
top accuracy lever).
· **Validation family ALL ON** (`1411d50`/`6649723`/`570833b`/`6237398`): S-A `DATE_IN_REF_FLAG` ·
  S-B `REF_LENGTH_OUTLIER_GUARD` (+ `REF_LENGTH_WITNESS_RECONCILE` — heal the doubled-digit merge
  from the ledger on its mechanical fingerprint; flag-with-suggestion/Accept otherwise) · S-C
  `BLIND_GEOM_DISAGREE_RECONCILE` (Tier-A NARROWED for anchor_registration — documented in the
  invariants above + extraction-pipeline.md) · `REG_MIN_INLIERS_GATE` (refuse n_inliers<3 vacuous
  fits). Engine pass order PINNED: suffix-reconcile → S-C → S-A → prefix-outlier → S-B(+witness).
· **Type-refuse LEARNING DEADLOCK cured** (`11b7ae9`, herald→Oracle): refuse ⇒ null template_id ⇒
  learn-on-commit bailed ⇒ young template never warmed ⇒ refused forever. R1
  `TEMPLATE_LINK_ON_CONFIRM` (confirm resolves+links via reuseByEstablishedName; scope_sweep
  excluded, pinned) + R3 `FINGERPRINT_COUNTERPARTY_MARKERS` (buyer-issued "Supplier :" truncates
  harvest, word-boundary) + honest note ("confirming will teach this layout") +
  `scripts/link-confirmed-templates.js` retro-heal (applied ×2, 37 orphans linked, backups beside
  DB). R2 cohort admission BANKED (pendingfeatures, revival evidence named).
· **Live note suppressor repaired** (`cea79ef`): the on-open strip existed; the reword broke its
  matcher. `_STALE_TYPE_NOTE` = ONE shared regex both copies (test_stale_note_matcher.js). Oracle:
  display-only SIGNED; persisting a note-clear on open SENT BACK (autoCommitFullConfidence seam).
· Smaller: graduation banner names the TYPE (`115ba62`) · pick-bar hides the Mark-Reviewed pill
  (`db9fb18`) · veto-note neutral copy + `REEXTRACT_UNPIN_BLANK_SUPPLIER` branding-blank ⟳ pill
  (`930842e`) · `DATE_ROLE_GENERIC_LABEL` bare-'Date' for date roles (`d3db1e4`).
· **GOTCHA (bit twice)**: a running dev app's MAIN process predates same-session JS commits —
  confirms through a stale app skip new learning arms (python is fresh per spawn). Check app start
  time vs commit time first.
· Memories: `project_deadlock_reconcile_20260801` · `project_validation_slices_20260801`.

### Prior session (2026-08-01 OVERNIGHT) — dpi dig → suffix-reconcile ON + catch-up slices 1+2 + validation designs
**2026-08-01 overnight (Fable 5, autonomous while owner slept). PUSHED, origin in sync. READ
`HANDOVER_2026-08-01_OVERNIGHT.md` FIRST.** Arc: the owner's "Worksh Eet" garbled-nudge screenshot →
dpi sweep (150/200/240/250/260/275 all garble a heading somewhere; only 225/280/300 clean; NO flawless
res exists) → cross-res escalation designed then Oracle-PARKED (its trigger provably unreachable for
the class — label-confirmed reads are shape-exempt) → the real fixes shipped instead.
· **`36a4a32` CLIPPED-SUFFIX RECONCILIATION ON** (kill `CANDIDATE_SUFFIX_RECONCILE`): label-confirmed
  clip 'V-69523' healed by adopting the discarded fuller keyword read from the always-on candidate
  ledger (suffix + digit-identity + shape-pass + confirmed-prefix). ref 91.8→94.5%, M 8→7 zero new.
  NO corrected_to emitted (reprocess-merge operator-grade seam deliberately dodged).
· **`15e9846` garbled-anchor remediation**: `scripts/sweep-garbled-anchors.js` purged the 07-30
  'Inwotce No.' row (backup beside live DB). Then **#141 re-met the registration audit condition on
  CLEAN landmarks** — see THE BIG FINDING in the handover (Tier-A fiat-located quality-blind win).
· **Catch-up Filing slices 1+2 built** (design signed 07-31): `376ed23` mig 57 `confirmed_via` +
  human-only trust window / corrections-SPAN (byte-identical gate vs mig-applied DB copy) ·
  `621a105` `_reextractFastCore` + `sweep-scope-candidates` READ-ONLY IPC + `sweepPredicate.js`
  (DARK — `scope_sweep_enabled` OFF). **Slices 3 (renderer consent UI) + 4 (gates+flip) = next
  owner-present session.**
· **`0495458` template hardening**: mapping geometry validation (anchor==target PINNED allowed —
  teach issuer mapping), reassign target-missing refusal, HONEST audit outcomes + adversarial suite.
· **BANKED awaiting Oracle (do NOT build unvetted): gary's S-A/B/C/D validation slices** —
  `pendingfeatures.md` "Validation slices S-A/B/C/D" (date-in-ref flag · ref length profile ·
  blind-geometry disagreement reconciliation · registration fit audit + S-B2 confidence lever).
· Realdoc at wrap: 202 docs, ref 96.5%, type/supplier 100%, M=5 (all GT-poison-suspect class).
· Owner in-app TODO: `ocr_dpi` 200→300 (still speed-test value = the original garble source);
  teach one-step visual smoke. Memory `project_overnight_20260801`.

### Prior session (2026-07-31 NIGHT) — veto + merge fix + teach + needless-flags + catch-up design
**2026-07-31 (Opus 4.8, three sessions). HEAD `a308e0b`, PUSHED, origin in sync. Dev app may be running
(owner `npm start`). Installer `5b5d344` predates the WHOLE day — rebuild to ship. READ
`HANDOVER_2026-07-31_NIGHT.md` first (night); `_EVENING.md` + `HANDOVER_2026-07-31.md` carry the
morning/afternoon arcs. NEXT AGREED TASK: build Catch-up Filing slice 1 —
`docs/designs/CATCHUP_FILING_2026-07-31.md` is the SIGNED design (do not re-litigate its rulings).**
· **Issuer collision cured end-to-end**: `20d6be3` TEMPLATE_FIXED_NAME_PRESENCE_VETO (un-named branding
  branch BLANKS an off-page name-printing supplier stamp; templates.js threads `supplier_prints_name`)
  + `72fe746` REPROCESS_ANNOTATED_EMPTY_WINS (reprocess merge resurrected engine-blanked values —
  annotated empty now WINS; operator `corrected_to` outranks; doc column mirrored; realdoc is BLIND to
  this merge, gate = `test_reprocess_annotated_empty.js`) + `ea4101a` customer-plain note copy.
  Memory `project_template_fixed_name_presence_veto_20260731`.
· **Teach**: `934df8a` ONE-step value+label confirm + clip-gated label pass-2 re-read (the "oe ee No."
  decapitation garble; pure helpers in `shared/anchorLabel.js`; probes green). Memory
  `project_teach_label_reread_20260731`.
· **Needless flags — 3 slices ON** (`0f33e20` TYPE_AMBIG_COHESION · `4a058a6` HEADING_BAND_REREAD ·
  `d8768fe` TEMPLATE_IDENTITY_GEOM_WITNESS): cross-supplier phash band can't manufacture "several
  document types"; rung-2 single-pass title re-read cures the PSM-3+supp-merge DOUBLED-heading garble
  (doc-180 SO@65→PO@95 on same pixels); "Company inferred…" note sheds when `pick_issuer_geometry`
  agrees. Combined gate `stress_test/demo_notes_gate.js` ALL PASS (Desktop\Demo Docs sample). NOT
  retroactive — heal queue via Reprocess all. Memory `project_needless_flags_20260731`.
· **Catch-up Filing DESIGN SIGNED OFF, NOT BUILT** (barry→gary→Oracle W/COND): consent-gated batch
  filing of stale-scored queue docs after same-scope confirms. Key rulings: `confirmed_via` migration —
  sweep confirms EXCLUDED from graduation; corrections-SPAN revocation; candidacy fingerprint;
  banner+list+untick v1. Memory `project_catchup_filing_design_20260731`.
· Gotchas added: machine env `TESSERACT`=install DIR (WinError 5 if executed — own env keys in
  harnesses); `_doctype_fixed_supplier` = production DEAD GUARD (`key` vs `field_key`) — do NOT fix
  casually; `ocr_dpi=200` live was owner speed-testing (fixes proven at 200).


## 2026-08-04 (day) — C6 scorer + jitter finding [moved verbatim from CLAUDE.md at the 08-05 wrap]
**2026-08-04 day (Opus 4.8). HEAD `81a3a83`, PUSHED, tree clean. READ `HANDOVER_2026-08-04.md`
FIRST.** SFDEV chord fixed (`d642117` — Ctrl+Shift never text entry; Ctrl+Shift+I never existed).
Teach-time word-snap ON (`698ddec`, `teach_box_word_snap` default ON — read-back display is the
gate). `NAME_UNCLIP_RECONCILE` built DARK (`c9f253f` — cut-glyph rule + 4.5-starvation pin; flip
HELD). S2 leak fixed (`5f9f0d5` — getFieldFormats excludes provisional by default; training file
opts in). **Customer-corpus GT scorer SHIPPED** (`stress_test/customer_corpus_score.js` +
`teach_from_gt.py`): cold/TEACH/TEACH_JITTER arms, 9 GT lanes, deterministic sample. **Slice-2
2b+2c FLIPPED** (`universal_verify_numeric`/`_flag` — zero fires, zero flag noise across all
arms). Teach-once quantified: cold→taught ref 45→70 · date 68→92 · issuer 0→75 · type 83→100.
**THE JITTER CRATER (next arc's charter):** 18% right-cut taught boxes → ref 70→22, date 92→21,
heal stack rescues ~nothing; provisional-seeding parity (`81a3a83`) DISPROVED consent as the
cause; **born-digital word-geometry gap = suspect #1** (digital 12.5% vs scanned 32.1% under
damage — the text-layer path yields NO word boxes; synthesize them from pypdfium2 char positions).
[NOTE 2026-08-05: the born-digital suspect was OVERTURNED next session — see the 08-05 block.]


---

# ARCHIVE APPEND — per-session state blocks 2026-08-01 → 08-13 (moved out of CLAUDE.md on 2026-08-15)

> These blocks were collapsed to a pointer list in CLAUDE.md to keep it lean. Preserved here VERBATIM.
> Each also has its own `HANDOVER_*.md` in the repo root.

### Prior — 2026-08-13 NIGHT2: **READ `HANDOVER_2026-08-13_NIGHT2.md` FIRST.** HEAD **`3327a22`**,
PUSHED, tree clean. Owner ordered ONE plan to "completely integrate the features and fixes without
touching currently working features in a negative fashion", weighing the customer's experience and
"as little clicks as possible after teach". Plan approved with four owner decisions, executed in six
phases: **11 commits, migrations 64/65/66/67, four new switches ALL DEFAULT OFF, and one migration
that turns SEVEN previously-dark switches ON for NEW INSTALLS ONLY.**
**(1) `332bf68` PHASE 0 — the safety net had gone red and nobody knew** (468/484, 16 red vs 15 on
08-10). One was a PRODUCT bug: **`PRAGMA table_info` on a MISSING table returns `[]`, so migration 62
threw `no such table` inside `runJsMigrations` and ABORTED APP STARTUP** on any DB stamped past 19
without `field_label_overrides`. Third appearance of that class. A stale pin was repaired (it demanded
the inline five-sentinel literal the machine-feed slice deliberately replaced with `machine_vias`) and
three drifted fixtures fixed ⇒ **red is now 11, the documented genuine set**.
**(2) `76e28b2` #464 + #535 EXAMINED — on BOTH the stored confirmed value is CORRECT and the PIPELINE
is wrong** (the opposite of the other five baseline rows). #535 = B→P, flagged, contained. **#464
prints £2,363.76, commits `2,368.76` at 90 with an EMPTY note ⇒ would auto-file — and the trace shows
`subtotal+tax` computed the printed total EXACTLY while a 2%-of-total tolerance (47.38) released a
delta of 5.** Filed at the top of `pendingfeatures.md`; fix must FLAG, never adopt.
**(3) `7dfb580`+`7db3f21`+`6ba880e` PHASE 1 — THE APP SPEAKS (ships ON).** Teach read-back on every
path incl. **the EMPTY and THROWN reads, which produced nothing at all** (all nested inside
`if (text)`); message on the persistent `#anchor-readout`, not a toast; `showToast` sticky-**LEVEL**
guard (an `ok` may not overwrite a live `warn` — deliberately NOT a queue); the wizard's `.catch(_ok)`
failure-as-success removed; new `learning.findNearMatchIdentity` + `check-identity-near-match`
(substrate = HUMAN confirms only, ≥3); confirm names the filed name + folder (the backend always
returned them and the renderer discarded them); File All Ready gets a count from **the loop's own skip
rule** + a persistent summary; the issuer clear names each field and offers a working Undo.
**`_purgeOne` had TWO data defects, both red-proved: the filed PDF was never unlinked (resolveFilePath
returns working_path FIRST) and, with no working copy, it targeted THE CUSTOMER'S OWN SOURCE SCAN.**
Bin actions counted RENDERED ROWS (`if (!n) return` = the silent no-op); stamp default corner →
bottom-right; not-taught dot no longer error-red.
**(4) `097a5fb` PHASE 2 — mig 64 provenance (`template_fields.fixed_source`) + mig 65
`template_identity_hold_siblings` (OFF).** **The writer enumeration is BETTER than the design assumed:
`create`/`update`/`mergeInto` all funnel through the ONE `_upsertFields`** (pinned, incl. the call-site
COUNT); graduation only ever CREATEs; `setFieldFixedValue` stays ungoverned ON PURPOSE — it is the only
route by which a wrong frozen identity can be corrected. Hold: a different identity commits but
siblings get **70 WITH A NOTE**, and **the NOTE is the hold, not the confidence** (`< 70` review
threshold — the slice-3 B2 lesson).
**(5) `c353518` PHASE 3 — mig 66 + `template_buyer_issued_type_scope` (OFF); SLICE 3 REFUSED BY ITS OWN
CENSUS.** 6514 corroboration records: `vat_no` **120 stamped / 0 contradicted** (and `_PRECISE_VAL_TYPES`
is `{mac_address, ip_address}`, so VAT was never in scope), while the 121 contradictions that DO exist
are `keyword="DELIVER TO"` and `crop="Jordwind…"` — caption fragments and garbles OF THE STAMPED NAME.
It would hold ~121 correct documents and catch nothing. **Do not rebuild without re-running the census.**
**(6) `ca90294` PHASE 4 — CENSUS F, then migration 67.** 1076 live confirmed docs through the real
`isAutoFileEligible`: shipped defaults **919/1076 (85.4%)** → `graduation_window=5` **999/1076 (92.8%)**;
**`corroboration_autofile` measured INERT here (919→919)** and is promoted on the Oracle sign-off, not
on a number — the annotation says so. Promotes the import-arc five + window=5 + corroborated route as
ROWS with `INSERT OR IGNORE` (a hand-disabled switch stays disabled, pinned). **Census F scores a
MATURE install and confirmed rows have their notes cleared, so it CANNOT model the import-time refusal
that holds a new customer's documents** — that number is the recorded 70/200 → ~184/200 import arc.
**(7) `02918b4` PHASE 5 — duplicate senders + the rename can finish.** Report-only detector in Learning
Repair (live: 11 scopes, 0 pairs). **Its own pin made it STRICTER than the write guard:**
`Northgate`/`Southgate` is d=2 at 0.889 and PASSES `name_proximity` — fine at the guard's seam, wrong
on a screen that offers a merge. Now 1 edit, or 2 only with a **digit inside an alphabetic token**.
`renameSupplier` now also moves `template_fields.fixed_value` — **the gap that made a rename quietly
undo itself on the next import**.
**(8) `1f2b386` PHASE 6 — the lexicon, WEAK-only (`name_lexicon_low_distinct`, OFF).** The four-line
root cause: `format_anomaly_checker`'s `len(samples) < 3` is on the DISTINCT set while `learning.js`
emits on distinct≥3 **OR** count≥3, so Python discarded exactly what JS sent (Census E: 33 of 36
scopes). Admitted as a **name lexicon and nothing else**, marked `low_distinct`, and **the engine
refuses STRONG for it** — the suite DEMONSTRATES why (`Southgate` vs a 3-doc `Northgate` lexicon IS
rewritten and reports STRONG). **B7 unconditional:** the STRONG branch stamps `<method>+name_repair`
and `getFieldFormats` excludes it — **the METHOD is the carrier because `validation_note` and
`corrected_to` are both cleared on confirm**, and it is written on the `method` key because the JS
persists `data.method`. **ORDERED DEPENDENCY: arm `identity_scope_post_repair` FIRST** or the panel
says "auto-corrected" while the file lands in the wrong folder.
**(9) `3327a22` CHRIS ROUND 5** (`docs/CHRIS_FULL_APP_REVIEW_2026-08-13.md`, round-5 section; sandbox
left on **CDP 9223 PID 26060**). Verdict moved: round 4 *"the condition is back on"* → **"yes — and the
condition is lighter, but it hasn't come off"**, held by the recycle bin, NOT the teach. **The graft
drew the SAME template as round 4**, recorded this time, so his `188/12` repeating EXACTLY is a stable
number, not seeding noise; **migration 67 fired on the fresh install and seeded all 7 keys.** FIXED:
teach speaks + refuses a bad box · cleared fields named with a working Undo · red dots · stamp
placement · Empty bin · credit-note typing · the Restore-all trap. **HIS WORST CARD IS NOT OURS AND IS
UNSOLVED: a restored document with NO PAGE** — doc #40's `working_path` points at
`userData\inbox\40.pdf`, the row is back in the queue, **the file is gone while 156 others remain**,
and `Confirm & File` stays enabled (`sweepInboxOrphans` and `_purgeOne` both RULED OUT). **Card 3 is
OURS: the near-match challenge never fired because its substrate is human confirms and a FRESH install
has none** — the design's Tier B (`template_fields.fixed_value` may trigger ASK) was not wired.
NOTHING from his round implemented.
**OWED: no corpus arm ran this session** (OFF is byte-identical by construction, but that is not a
measurement) · **no owner UI smoke** · `teach_identity_near_match_keep`'s sandbox replay.

### Prior — 2026-08-13 AFTERNOON: **READ `HANDOVER_2026-08-13_AFTERNOON.md` FIRST**, then the
arc's controlling design **`docs/designs/TEACH_POISONING_ARC_2026-08-13.md`** (Oracle's NINE blocking
conditions + the ordering). HEAD **`dc4bf1d`**, **3 COMMITS UNPUSHED**, tree clean, migration still 63,
**no live-DB write, nothing flipped**. Owner-directed attack on the class Chris has reported for four
rounds: **a teach commits a garbled company silently, freezes it, stamps 20 siblings at 95, files 12.**
Six agents; **Oracle SENT THE CONSENSUS BACK** (9 conditions) and found the root cause below all three
advisors: **`templates.js:1195` — the writer NEVER COMPARED WARRANTS**, so 38 confirmations lost to one
draw-box read. Shipped in Oracle's order: **(1) `98d4fbb`** a machine-initiated clear no longer
impersonates an operator correction (LIVE data loss — it wrote `display_value=''` + `was_corrected=1`
through `learning.js:325`; in the repaint branch the screen showed CORRECT values while the row was
blanked). **Oracle's own backend guard was WITHDRAWN** — `getFieldFormats` reads
`(corrected_value || display_value)` and `''` is falsy, so it would leave a DELIBERATELY deleted value
feeding learning for ever; and **B2c was REFUTED at source** (`clearAnchors` is inside
`if (corrected_value)`). **(2) `175d853`** `identity_scope_post_repair` (OFF) — `_supplier_name` (the
FOLDER + learning scope key) was captured before Stage 4.5 could heal the issuer; ADDS a late
re-derivation, moves nothing. **(3) `dc4bf1d`** `teach_identity_near_match_keep` (OFF) + new
`database/modules/name_proximity.js` — a near-miss keeps the incumbent; **a genuinely different company
still displaces it (pinned — else a wrong frozen name is uncorrectable)**. **MEASURED: Census E —
33/36 (91.7%) of name-like scopes hold ONE distinct confirmed value**, so the lexicon slice's `>=0.9`
STRONG bar is a TAUTOLOGY there ⇒ **WEAK-only is mandatory**. B9 census: **the live install is CLEAN**
(0 near-matches, 0 split scopes) — Chris's poison was sandbox-only. B3 arm: 1076 docs byte-identical,
but **0 re-derivations fired ⇒ VACUOUS as an efficacy test** (its trigger is disabled by the same
lexicon defect). **OPEN: B8 "the teach speaks" (no migration, highest value) and 4b "hold the
siblings".** GOTCHAS: **never edit pipeline Python while an arm runs** (workers import per shard — cost
a full arm); **`git stash push -- Docusnap/<path>` silently no-ops** because git's toplevel is
`C:\GIT Projects`, so a verification run after it proves nothing.

### Prior — 2026-08-13 NIGHT: **READ `HANDOVER_2026-08-13_NIGHT.md` FIRST.** HEAD **`53db7eb`**,
PUSHED. Owner ordered the slice-3 B2 gate, then slept; the Chris round ran autonomously. **No flag
flipped, no live-DB write, no migration (63), NO production code changed.**
**(1) THE SLICE-3 ORACLE B2 GATE IS BUILT AND RUN** (`1766c62`, new
`stress_test/name_demote_b2_gate.js`): 914 replayable docs, OFF vs ARMED, import path, 200 DPI,
slice 2 armed in both arms. **demoted-and-wrong at DOC level = 0 · collateral 0 · class rate 2/914,
both correct · census 0 declines.** Not vacuous — it resolves corpus GT for 1335/1336 docs and
scores 124 of the 914 as wrong in BOTH arms. **A2 = YES:** no conf is minted so the field stays at
70, but the review threshold is `< 70` (documents.js:209) so 70 does NOT trip
`below_threshold_valued_count` — both docs go `flagged → auto-file ELIGIBLE`; and with
`autofile_gate_unify` ON, `_maybeAutoFile` defers to the predicate, so Python saying
`needs_review:true` does NOT hold them. **Releasing this note FILES the document.** **B2 clause 1 is
NOT met** — the #259 shape is absent from the corpus, so the gate spoils a released doc's ref
(unnoted, same conf) and re-asks the real predicate: **STILL ELIGIBLE, nothing else holds it.** The
"or the census must catch it" branch IS met by SHIPPED code (`note_demoted` persists in
`extractions.corroboration`). `name_corrob_note_demote` stays OFF — owner + an Oracle read of the
counterfactual.
**(2) THE BIGGER FINDING — `realdoc_regression.js` HAS NEVER RUN THE APP'S FLAGS.** handler.js
spawns with `_autoTitleEnv + _ocrDpiEnv + _anchorCropEnv + _reconcileEnv` (:2008-2014) = **63 env
vars** here; realdoc passes NONE. Stack that on realdoc replaying **CONFIRMED docs only** and on
`--reprocess-manifest` **modelling REPROCESS** (Stage 0.5 answers before a Stage-2 noting rung can
fire) = three blinders. **That artefact produced the recorded "the note does not re-form on harness
replay — import-batch-specific" claim for BOTH slice 2 and slice 3.** Clear all three and both
classes fire on the FIRST document, on the owner's own exhibits (slice 2's total 3,864.72→3,564.72
demote and slice 1's date demote both captured). Struck in `pendingfeatures.md`. realdoc gained
**`RR_APP_ENV=1`, DEFAULT OFF** (it changes every historical baseline in that file). **OWED and now
possible: a slice-2 OFF-vs-ON arm over the same 914 docs** — slice 2's "evidence complete" verdict
rested on the struck claim.
**(3) CHRIS ROUND 4** (`53db7eb`, `docs/CHRIS_FULL_APP_REVIEW_2026-08-13.md`; sandbox left on CDP
9223 PID 16240). FIXED since round 3: Processing 63→24 toggles in plain English · junk-fragment
company suggestion gone · Split PDF speaks · a "type it as printed" box on the dead-end panel.
**UNCHANGED: the teach surface says NOTHING on success or failure** — and this round it cost real
files. **VERIFIED IN THE SANDBOX DB: a teach OVERWRITES a template's FROZEN identity value**
(`template_fields.fixed_value='B8ramblewood Joinery Ltd'`, `is_variable=0`), which then stamped **20
Quillstone POs via `template_fixed` at 95 with an EMPTY validation_note**; 20 confirmed, **12 filed
to disk** under the misspelling, and the garble became a learning SCOPE key. **The catching signal
is NEAR-MATCH TO A KNOWN COMPANY, not name shape** — `B8ramblewood Joinery Ltd` passes any
plausibility check by construction, so `teach_issuer_plausibility_warn` is the wrong instrument for
this class. **DO NOT chase his "40 docs under the owner's company at 95% with the owner's VAT" as a
regression: `seed-taught-state.js` grafts exactly ONE template and which one is ARBITRARY** — round
4 drew live template 13 (Bramblewood/purchase_order, `supplier_name`+`vat_no` frozen), i.e. the
KNOWN still-open buyer-issued class; round 3 drew a different row. Same cause inflates his 188-vs-147
and 19-vs-5 counts. **Record which template grafts every round or the comparison is not one.** Also
new: teaching one field silently empties two others · "Empty bin" promises to delete filed PDFs and
doesn't · File All Ready has no count and no summary · credit notes type as Invoices while the fix
switch ships OFF · stale recycle bin (he counted ZERO swallowed dialogs). He praised the approval
workflow end to end and the practice run — which says *"Read 'INV-1042' from your box"* every time,
the exact sentence the real teach has never said. Verdict slipped: round 3 *"without a condition
attached to my documents' safety"* → round 4 *"the condition is back on."* NOTHING IMPLEMENTED.

### Prior — 2026-08-13: **READ `HANDOVER_2026-08-13.md`.** The NIGHT2 queue EXECUTED:
HEAD **`e752b95`** PUSHED, 3 commits, zero SEND BACKs (gary ×3 → Oracle ×3, all W/COND applied).
**Slice-1 date-demote owed gates CLOSED** (live 5/5 correct + 200-DPI targeted arm fired 6 demotes
byte-identical — flip bar demoted-and-wrong=0 met; the first armed arm was VACUOUS: realdoc runs
python at 300 DPI while the app runs ocr_dpi=200 — set `OCR_RENDER_DPI=200` for class arms).
THREE new dark slices, ALL DEFAULT OFF + toggles: **`df3f668` slice 2** `recon_total_note_demote`
(adjusted-total note releases on penny-exact SIGN-agreeing crop witness + arithmetic re-verify; NO
conf minting; PASS-2 subtotal note survives — 34 pins; flip evidence complete, say the §2 caveats) ·
**`f6fea09` slice 3** `name_corrob_note_demote` (W1 crop minus template_fixed/'+corrected' AND W2
keyword + D1 recorded guard-rejection + D2 unanimity; supplier_name NEVER; **B1 production change:
anchor rejection recorder ALWAYS ON (`_rejected_reads`), Stage-2b parallel predicate now takes
`force_serial` — never key it on on_reject**; 39 pins; **FLIP BLOCKED on B2** #259-class replay) ·
**`e752b95` machine-feed slice 1** `learning_exclude_machine_confirms` (NEW shared
`database/modules/machine_vias.js` — FIVE sentinels; templates.js had DRIFTED to 2/5 while
_autoFileDoc drives learnTemplateOnCommit (Oracle C1, now armed-blocked); C2 carve-out: human
corrections stay counted; `machine_value_counts` additive+inert; 16 pins; census groupsDie 0,
Quillstone backup gate 0.888→0.900 PASSES; **FLIP BLOCKED on the armed realdoc arm — RUNNING at
wrap, read `%TEMP%\rr_machine_armed_diff.txt` FIRST ACTION** — + C5 unify round-trip pin).
Full-902 OFF arm md5-identical (both slices + B1 dark). Oracle also found
`test_xcheck_corrob_demote.py:158-160` is a DEAD pin (vacuous — filed for repair-or-delete).
Priors below.

### Prior — 2026-08-12 NIGHT2: **`HANDOVER_2026-08-12_NIGHT2.md`.** The import arc
EXECUTED: corpus auto-file **70/200 → ~184/200 (92%)**, all live-proven, HEAD **`fa1c0cb`** PUSHED,
13 commits, zero SEND BACKs. FIVE new toggles, **ALL OWNER-FLIPPED ON**: `autofile_gate_unify`
(pre-gate defers to the ONE predicate; `missing-required` refusal; `auto_graduated`/`auto_threshold`
via-stamps — 165-file cohort stamped, backup beside live DB) · `far_lowconf_valued_only` (isFlagged
two-tier, all five consumers) · `type_election_title_first` (address captions never headings;
Meadowvale healed live) · `reprocess_shadow_stale_drop` (stale shadow rows die on reprocess) ·
`xcheck_corrob_note_demote` (corroboration STEP 3 slice 1, DATES only — live re-verify DONE
2026-08-13, 5/5 correct, gates closed). VAT-reg guard: 3 garble variants fixed (speckle/cc-floor-8/
doubled-cc, reggie-vetted). Name-lexicon POISON remediated live (Quillstone 0.888→0.955 STRONG;
Castellan single-key — CONFADOPT unblocked; `repair-poison-name-confirms-20260812.js` RUN).
gary rulings that supersede filed designs: the CONFUSABLE-SNAP tier is WRONG LAYER (`_is_confusion`
has no letter↔letter arm; the 4.5 STRONG repair owns the class — evidence supply was the failure);
corroboration-clears-notes ALREADY SHIPS (E2). The queued slices (note-demote 2+3,
machine-files-feed-learning) EXECUTED 2026-08-13 — see LATEST. Trace console: every-step rows +
top-left; SFDEV dialog focus fixed.

### Prior — 2026-08-12 NIGHT (early): **`HANDOVER_2026-08-12_NIGHT.md`** — the import-arc measure
(70/200, the three-gate decomposition, CJB-5054 filed) that NIGHT2 executed. Read for the original
gate trace + owner goal verbatim.

### Prior — 2026-08-12 EVENING (owner present): **READ `HANDOVER_2026-08-12_EVENING.md`.**
HEAD **`3852d7c`**, PUSHED, tree clean. **THE DAY BLOCK'S "reprocess NEVER auto-files" WAS WRONG** —
the renderer's `autoCommitFullConfidence` (shipped 2026-06-29) swept the ENTIRE queue through
auto-file after EVERY batch reprocess; the 08-11/12 graduation flips detonated it: a 14-doc group
reprocess filed **101 docs across six suppliers as HUMAN confirms** (via NULL, owner's username,
feeding the human graduation window + saveCorrections hint learning). **FIXED `0177716`**
(eric→Oracle SIGN-OFF-W/COND): queue-wide sweep REMOVED no restore door; server-owned batch-scoped
CONSENT BAR (consume-reprocess-completion gated+computes offer; payload-less
`reprocess-autocommit-accept` files via INTERNAL `via='auto_reprocess'` — sentinel set now
{scope_sweep, auto_reprocess}; excluded from the human window trust.js:538; skips template/hint
learning; 'Auto-filed (reprocess)' username; in banner+search stat). Setting
`reprocess_autocommit_offer` DEFAULT ON (Oracle-granted; consent-gated). 27 new pins + trust
§23(c2) both-sides; all suites green; **UI UNSMOKED**. **Live remediation RUN** (owner `!`): 101
docs stamped `auto_reprocess` (backup `docusnap_pre_sweepstamp_20260812.db`); re-measure:
**Pelican/invoice + Veltrix/sales_order graduation REVOKED (recent-correction — the inflated
windows were burying real corrections)**; owed censuses must treat the cohort as SUSPECT.
Also: **graduation-freeze replay gate PASSED** (61 docs → template_fixed@95/98, zero cross-scope);
**import-vs-reprocess type disparity TRACED to the TYPE ELECTION** (`'bill to'` heading-eligible +
leftmost-segment-only heading test + config-order tie-break; design at pendingfeatures TOP, NOT
built; plain reprocess can never self-heal — cached text pins the wrong election).

### Prior — 2026-08-12 DAY (owner present): **READ `HANDOVER_2026-08-12_DAY.md` FIRST (incl. its
POST-WRAP ADDENDUM).** HEAD **`3a751d0`**, PUSHED, tree clean. Post-wrap: **RAW-CROP WITNESS built**
(`3a751d0` — the 08-11 recipe-ladder I→1 spec, C1-C6; flags OFF; heal-gate arms OWED before flip;
C4: never flip the sep-guard alone), **backfill APPLY verified** (tpl 14/15 issuer frozen), and the
NEXT ARC filed at pendingfeatures TOP: **"why was the Lid→Ltd Stage-4.5 repair silent?"** (root-cause
FIRST; the confusable-snap tier only if 4.5 can't own taught reads). Heaviest feature day on record: SIX Oracle passes, zero
SEND BACKs, THREE commits, ~90 new pins, four realdoc arms md5-identical. All flags DEFAULT OFF +
toggles; **the OWNER flipped**: graduation_window=5 · graduation_freeze_issuer ·
template_identity_on_page · supplier_pin_self_discharge. Shipped dark: **(1) per-sender field
editor** (`5623102` — "Save as template"+"Edit type" RETIRED from Review; identity-only mint C1;
`resolveVisibilityTemplateIds` = the ONE scope authority C3; un-hide clears matched-template too);
**(2)** `e94f2f5`: reconcile SHADOW-ATTRIBUTION (corroborated total keeps earned conf, note
reworded never cleared) · VAT `@ 20%` rate-skip (reggie REFUTED the label theory — it's the column
SEGMENT) · **graduation ISSUER FREEZE** (graduation templates were IDENTITY-MUTE = auto-file
unreachable on hint/logo scopes; C6 deliberately narrowed issuer-only; **flip WITH
identity-on-page**; backfill census: tpl 14+15, APPLY OWED) · **self-discharging pins** (natural
read == pin ⇒ released on reprocess; keyword_override excluded) · graduation-window dial ·
currency never magnitude-compared in Learning Repair · inert containment predicate; **(3)**
`6bd591f` **CONFIRMED_DOMINANT_ADOPT** (junk-flagged name yields to the scope's SINGLE ≥5×-confirmed
literal; owner-ruled STRICT variability; B2 memory-family record blocks corroborated route; B3
adopted rows never learn — dominance can't vote for itself; 2nd `_override_eligible` carve-out).
**CORRECTED CLAIMS (⚠ ITSELF CORRECTED 08-12 EVENING: a renderer door DID auto-file after batch
reprocess — see LATEST): auto-file fires at IMPORT ONLY — reprocess NEVER auto-files** (3 eligible docs
sit in the queue for exactly this; exits = File All Ready + scope sweep, and `scope_sweep_enabled`
is OFF in the live DB — the 08-02 "ON" record is STALE). Live data: 18 supplier pins cleared
(backup `live_backup_20260812_pinclear.db`). OWED: backfill APPLY + replay · editor UI smoke ·
3 censuses (discharge/adopt/attrib) before any flip · tpl 11 cleanup + Ironclad C7/re-teach.
GOTCHA: PowerShell `&` does NOT wait for electron.exe unless PIPED — `$LASTEXITCODE` stale.

### Prior — 2026-08-12 OVERNIGHT (autonomous): **READ `HANDOVER_2026-08-12_OVERNIGHT.md`.**
HEAD **`afe8da0`** + docs commit, PUSHED. No flips, no live-DB writes. THREE things happened:
**(1) "Pelican did autofile" VERIFIED FALSE at source** — every Pelican filing is a HUMAN
`review_confirmed` (incl. a File-All-Ready burst); the only machine auto-file ever is 20
Meadowvale notes @95 graduation (08-10). **0016 is HELD CORRECTLY at 99**: its invoice_number is
the serif I→1 class (crop rung beat the correct mapping read — the corroboration record captured
the disagreement) + the frozen trailing-dash supplier. Tell the owner: the hold is the system
working. **(2) The NAME-BOX FLUSH-EDGE CLIP slice SHIPPED** (`afe8da0`, Oracle SIGN-OFF-W/COND):
fix (a) teach-side trailing-pad floor 0.004 (boxSnap+valueLocate, asymmetry PINNED — right only;
left snug = label-tail, vertical snug = row-below) + fix (b) `TEMPLATE_NAME_EDGE_GROW` DEFAULT
OFF (toggle exists; nested under `template_abs_edge_guard`; right-cut only, last-token repair,
page-present witness with NO short-token skip, FLAG-ONLY ≤70+note, declines SILENT). Gates: OFF
md5-identical · armed +22 heals/0 losses · census 29 heal/14 decline, **1 direct/28 superseded**
(the @70 result un-squats the clipped 90 read; correct keyword/fixed/hint wins unnoted — flip
buys ~zero review volume). **Oracle C1, SAY BEFORE ANY FLIP: it does NOT fix the Ironclad 'Ltc'
exhibit** (overhang 0.0010 < the untouched 0.004 floor) — that page needs a RE-TEACH under the
new pad, or the **C7 stored-box repair arm** (OPEN, owner decision, backlog top). C3 owner-watch
(90→70 un-squat's 71-89 window can swap wrong-for-wrong unnoted, 'SITE ADDRESS' @78); C6: never
arm `NAME_UNCLIP_RECONCILE` alongside. Hidden-field-drop corpus arm (owed) RAN CLEAN: 30 ghost
serials dropped in GT-certified-absent scopes, 0 collateral. **(3) CHRIS ROUND 3
(`docs/CHRIS_FULL_APP_REVIEW_2026-08-12.md`): THE BLEED IS FIXED, BOTH VARIANTS** — his exact
repeat of the owner-issued-PO poison touched 0/20 Oakhaven, garble contained+flagged on 5
same-supplier docs, zero VAT crossover, first unconditional two-week verdict. 14 prior findings
FIXED (Approve arm, locate glow, reprocess warning…). His top NEW finds (owner vet queue,
NOTHING implemented): the teach-time plausibility warn NEVER SPOKE — DIAGNOSED: the warn block
(`review/renderer.js` ~:3634) is nested inside `if (detected)` so a garbled read that also fails
anchor capture is SILENT (also explains the ⊕ saying nothing on success); and the RECYCLE-BIN
VIEW GOES STALE (open bin during Delete-All reads "empty", Restore-all no-ops silently — fresh
entry restored all 152). Screenshots `~/Desktop/TESTING/_chris3_screens/`; sandbox left on CDP
9223 PID 132896.

### Prior — 2026-08-11 LATE: **READ `HANDOVER_2026-08-11_LATE.md`** (the whole
evening→midnight arc; `_EVENING.md` = the afternoon). HEAD **`dc285a3`**, PUSHED, tree clean.
Owner's app RUNNING on this code. EIGHT gated arcs live: dock resolved · trace crops named ·
**picker history ranking** ("confirmed N times", owner-seen) · **sample-angle BACKFILL APPLIED**
(the 'Ltc' root cause = stale `sample_deskew_angle` on pre-round-trip teaches; tpl 5/7 written,
tpl 9 HELD; backup beside the live DB) · **corroborated auto-file BUILT + all flip gates run +
Oracle UNLOCK + owner-flipped ON** (volume-only substitution; memory+hint refused so
frozen-issuer scopes still need graduation; cold poison recreation 21/21 Stage-0 refusals — the
wrong claim no longer forms even with the frozen identity on-page; never flip alongside
`CODE_SEPARATOR_STRUCTURE_GUARD`) · Review's positive-only agreement badge REMOVED (owner
ruling: absence reads as alarm; Stage-1 keyword is SAME-LINE only so label-above cells never
corroborate) · **reprocess THREAD-CAP parity** (`_reprocessThreadCap` from CONFIG concurrency —
Tesseract is thread-count-nondeterministic on boundary glyphs; cap=1 here = deterministic) ·
**currency SYMBOL-CUT stand-down** (`6a78c69` — snug box cutting only '£' no longer flags;
Pelican totals 78→98; Oracle C1 = NON-alphanumeric prefix, the serif 1→l channel pinned).
**PICK UP FIRST: the NAME-BOX FLUSH-EDGE CLIP** (pendingfeatures top): `boxSnap.js` pads
name boxes ~0.002 < sibling drift — the snap itself mints flush boxes; Oracle's recorded
name-grow revival condition ("class survives the repair") is now MET on the Ironclad exhibit.
GOTCHA: Bash-heredoc JS loses a backslash escape level — better-sqlite3 silently CREATES an
empty phantom DB at the mangled path ("no such table" = print the resolved path first).
**The child-window DOCK is RESOLVED (`5391c52`, LIVE-SMOKED)**: 5th iteration = restore-then-hide +
visibility-guarded undock (a hidden window cannot be "back in front") + juggle flag drained in
setTimeout(0) + drain-time chip failsafe + deterministic undock in the restore IPC. Smoke: no
stub, chip persists, restores PAINTED, two-chip selective restore, no spontaneous restore (12s).
Incidental pre-existing: createWindow parents children to the FOCUSED window — Review opened while
Settings has focus dies with Settings on close. The four failed iterations stay documented at
`wireChildDock`. **Owned windows can NEVER have taskbar buttons** — setSkipTaskbar flips
on them cause spontaneous restores. Also shipped: teach capture-step FLOW REWORK (one question
panel, valueSource provenance, typed-issuer commits from pick, NO-HIT typo recovery, stale-box
suppression); typed corrections run the LOCATE flow (box-wrong re-targets, OCR-misread keeps box);
two-way date-coherence warns; chrome-word issuer carve-out ('Order' warns, BP/IBM immune);
**migration 63** (the `addMissingColumns`-only-runs-in-migration-2 trap AGAIN — owner hit
`no column named corroboration` live; delete+insert now ONE transaction; `runJsMigrations` was
never exported — runMigrations is the entry); **hidden-field drop** (`template_hidden_field_drop`
OFF — declared-absent fields never filled, merge stops resurrecting, corrected_to sacred; wizard
skip asks "usually / Never — stop looking"; **corpus arm still OWED**); **SFDEV settings gate**
(~47 toggles behind ONE persisted unlock, gate INVISIBLE until Ctrl+Shift+D,M in Settings; split
list = DEV_SWITCH_IDS; slice-2 proven-flag promotion = separate per-flag review). Owner-confirmed
live: straighten round-trip boxes track values (A4 ✓); corroboration badge showing.

### Prior — 2026-08-11 DAY 2: **READ `HANDOVER_2026-08-11_DAY2.md` + `OWNER_TEST_SCRIPT_2026-08-11.md` FIRST**
Branch **`feat/teach-side-overnight`**, HEAD **`8c6237e`**, PUSHED, tree clean. Owner's 4-part
order all delivered; Oracle vetted all four changes (no SEND BACK), every blocking condition
closed same-session. **MIGRATION 62 exists in code** (61+62 apply on next app start — live DB was
still 60 this morning; the previous handover's "migration 61" line was stale).
**(1) LIVE serials teach REPAIRED** (data, no commit): 2 caption-committing mappings + 2 frozen
serials fields deleted; backup `_measure/live_backup_20260811_120903.db`; 24 docs keep the old
value until reprocessed.
**(2) CHRIS r2: findings 1,3,4,5,7,8 + verify-list FIXED** (4 commits). Approve was NEVER broken
backend-side — it is an owner-approved two-step ARM whose armed state was invisible (no
self-approval rule exists; the review doc's triage hypothesis was WRONG). Finding 1 =
`ca0bb49` young-identity corroboration: the wordmark abstain ADMITTED unconditionally and the
garble claim came through the KEYWORD arm (trace-proved); a young frozen-supplier template
(frozen-string confirms <3) must now be NAMED on the page. Youth stays keyed on the FROZEN-STRING
count DELIBERATELY — the bound-doc alternative reads File-All-Ready'd poison as mature (21 docs in
the sandbox). Residuals (a) name-drift keeps a wordmark young, (b) frozen-garble/corrected-dominant
split-brain — PINNED. Slices 2+3 designed in `pendingfeatures.md`, NOT built.
**(3) TAUGHT LABEL → KEYWORD at TEMPLATE scope** (mig 62, flag `teach_label_becomes_keyword` OFF,
NOW HAS A TOGGLE): rebuild in ONE transaction that THROWS rather than stamps (Oracle ship-blocker);
backup restore REMAPS template_id through tmplMap, orphans DROPPED never widened (second
ship-blocker); scoped rows apply only when THAT template matched; ⊕ path SKIPS with no template;
admin list shows "replaces built-ins"/"<template> only" tags.
**(4) CORROBORATION RECORD + SURFACE shipped, record-only** (owner principle, step 1+2 of the
ordered plan; step 3 = moving decisions is DELIBERATELY not built). `_build_corroboration_emit`
buckets by method family; **`template_fixed` = its own `memory` family INSIDE the emit only** —
never re-tune the shared `_crosscheck_witness_bucket` (live in the flipped crosscheck reconcile).
New `extractions.corroboration` column; survives reprocess merge; Review "✓ Two independent
readings agree" (positive-only, note-suppressed); SFDEV ★FINAL shows the amber disagreement (the
Oakhaven stamped-VAT-vs-page-VAT class made visible). Base arm 185 docs BYTE-IDENTICAL = the
record-only proof. Kill `FIELD_CORROBORATION_EMIT=0`.
**(5) LIST FIELD TYPE built** (owner idea; flag `list_field_scan` OFF + toggle + bridge): value =
'A; B; C'; `_search_for_label(collect=True)` — ONE scan, shared guards, shared `_post_label_value`
pipeline; method `keyword_list`; the collect scan ALONE writes list fields (mapping/anchor/late-
rescue/hint skips — pinned invariant narrowing); never freezes; never a ref/date role; Stage-4.5
rail + corrector skip; trust untouched (list blocks sub-100 auto-file, accepted v1); teach
surfaces refuse at teach time. Corpus layout evidence settled Oracle's fork:
`gen_customer_test.py:523` prints one 'Serial No: <sn>' line PER serial. Residuals named:
vertical-column reads element 1; no count witness v1. Gates: pre/post-refactor byte-identical AND
armed-zero-list-fields byte-identical (185 docs each).
**GOTCHAS:** electron.exe does NOT support `--check` (silently fails every file — use plain
`node --check`); git toplevel is `C:\GIT Projects` and the unanchored `templates/` ignore rule
makes `git add` warn about `src/modules/templates` (the tracked handler commits fine); the 08-10
coldstart2.json is a 66-doc subset, NOT comparable to 185-doc runs; harness `safe()` returns []
on unmigrated snapshots for new getForExtraction columns; labelkw backfill arms construct rows
WITHOUT template_id.

### Prior — 2026-08-11 DAY: **READ `HANDOVER_2026-08-11_DAY.md` FIRST**
Branch **`feat/teach-side-overnight`**, HEAD **`75d29ce`**, PUSHED, tree clean. Owner present.
**MIGRATION IS NOW 61** — every older line in this file saying 60 is stale from here.
**(1) CHRIS'S "CONFIDENT NONSENSE" GAP CLOSED** (`810ea8f`, DEFAULT ON, kill
`teach_issuer_plausibility_warn`). A ⊕ teach read `@a eens Ee`, showed a green success toast, flagged
nothing, and made two output folders. **Every guard in this product was pointed at ABSENCE and none
at CONFIDENT NONSENSE** — the app warns on an EMPTY issuer and said nothing on a gibberish one. Both
teach surfaces now warn. **`isPlausibleSupplierName` was MEASURED AND REJECTED for this job — it
rejects BP and IBM** on a ≤​3-char all-caps rule; the shipped predicate never judges a single-token
value, which is what makes BP/IBM/3M/H&M immune. 0 false positives over 22 real names.
**(2) A CONFIRMED TEACH LABEL NOW REPLACES THE GENERIC KEYWORDS** (`48bcc48`, **migration 61**,
`field_label_overrides.exclusive`, DEFAULT OFF, `teach_label_becomes_keyword`). Owner-reported: a
correct taught `po_number` mapping coexisted with a Stage 1 keyword hunting `'ref'`. The store was
already wired to Python; **the only writers were the admin Settings screen and the preset seeder** —
the missing piece was a WRITE. **REPLACE, not add: precedence is not exclusivity**, because
`extract_fields` falls THROUGH to the shipped labels when the override does not hit. **BOTH teach
paths write it** — the wizard does NOT use `save-field-anchor` (6 anchors-with-labels vs 38 mappings
with `anchor_text`), which the arm caught.
**(3) THE ARM: `labelkw` red, `labelkw_fixed` CLEAN.** Only `serials` moved (empty → WRONG via
`keyword_override`); with the bad serials teach removed, **all nine lanes byte-identical to base**.
**The regression was the TEACH, not the feature** — the most-committed `serials` value on this
install is literally `"Serial No:"` ×23, the caption. **Still broken in the LIVE DB.**
**(4) THREE OF MY OWN CLAIMS WERE WRONG AND ARE CORRECTED IN THE HANDOVER:** "18 overrides" was 38;
`templates.getAll` returns **`field_mappings`** not `mappings` (a whole arm removed 0 rows and was
caught ONLY by its own guard); and the backfill read the DB instead of the mutated state, so a
"repaired" arm produced the unrepaired result — **a mutator arm must measure the state it mutated.**
**(5) OWNER DIRECTION, AND IT OUTRANKS THE INDIVIDUAL FIXES:** *"it is more about CORROBORATION
than merely getting it right... otherwise there is a chance, from time to time the wrong value will
be selected."* The trace above is a NEAR MISS, not a success: the two rungs answered DIFFERENT
questions so they could never agree, and a 5-point margin decided it. **A margin is not evidence.**
The vocabulary exists (`_anchor_corroborates`, `_template_identity_corroborated`, "no
different-method-family rail agrees") but only inside specific guards — **agreement is invisible to
field selection today.** Encode INDEPENDENCE OF METHOD FAMILY, never a witness count: caption-located
vs geometry-located is independent; two preps of one crop is NOT (5:1 false:true, Oracle 2026-08-03,
re-proved this week when two preps agreed on the wrong `P1`); full-page vs crop is WEAK. **It also
revises my own arm verdict: a lane can be byte-identical and still be far better EVIDENCED, because
the scorer counts values and cannot see corroboration.** Order: record it, surface it, only then let
it move a decision; do NOT wire it to auto-file in the same slice. Read
`HANDOVER_2026-08-11_DAY.md` §"THE DIRECTION THE OWNER SET" before any extraction work.
**(6) I REFUSED TO WRITE THE LIVE DB while the app held it** (`no such table: settings`, then
`SQLITE_CANTOPEN`, on a file that exists). No flip happened; the arm later said it would have been
wrong anyway. **GOTCHA: a commit message containing backticks breaks the Bash heredoc — use
`git commit -F <file>`.**

### Prior — 2026-08-11 OVERNIGHT: **`HANDOVER_2026-08-11_NIGHT.md`**
Branch **`feat/teach-side-overnight`**, autonomous night run, owner asleep. **NOTHING FLIPPED, no
live-DB write, no destructive action.** Migration still 60.
**(1) DO NOT FLIP `CODE_SEPARATOR_STRUCTURE_GUARD` ALONE — this reverses last night's advice.**
`ocr_corrector.value_to_template` keeps `/` as a literal, so once the guard is armed and confirms
make 10-char values the majority, the scope's learned template becomes `UD/DD/DDDD` and
`try_correct` (`LETTER_TO_DIGIT['I']='1'`) rewrites a CORRECT `PI/26/6000` back to `P1/26/6000` at
`min(95,90+20)=95`, method `+corrected`, **no note** (`engine.py:6688-6701`). Masked today only by a
length mismatch. **The guard is the fuse; operator confirms arm it.** Flip it WITH the `I`→`1` fix,
after it. gary found it, Oracle ruled the order.
**(2) `I`→`1` ROOT-CAUSED + ORACLE-SIGNED (4 BLOCKING) + DELIBERATELY NOT BUILT.** The ladder ranks
rungs by mean word confidence, which is NOT comparable across preprocessing recipes — sharpening
raises certainty while destroying the antialiasing grey that separates a serif `I` from `1`. Raw
greyscale reads it correctly **5/5 and is not a rung**. **Oracle C1: the obvious fix heals ZERO
documents** — both ladder exits return the string AFTER `_repair_single_token`, so the witness
compares 10 chars against 8 and discards; the comparison must move inside the rung loop.
**Corrected my own claim:** "every rung scores below 60" is FALSE on 2 of 5 (verified via the
ladder's own `_read_lines_full`) — 2 exit via the GATE, so a comparator-only fix heals ≤3/5.
**Owner asked about 2-bit B&W: measured, it makes it WORSE** (1-bit Otsu x2 scores 79-85 while
wrong vs raw 45-56 while right). Full spec in `pendingfeatures.md`, ready to build cold.
**(3) FIRST WHOLE-SUITE RUN EVER: 457 files, 442 pass, 14 genuinely red** (`stress_test/run_all_suites.py`
— `pytest tests/` aborts, so each file runs in its own process). **ALL reproduce at `455d4a7`, zero
regressions.** **CLAUDE.md's "4 pre-existing failures" was STALE by ~4x.** One shared cause: three
fixtures die on `logo_detail_hash` (migration 47 drift). Two worth attention: `test_v1_contract.js`
CRASHES and `test_apiclient.js` fails a no-leak assertion. None fixed — blind test-repair papers
over real regressions. Baseline: `~/Desktop/TESTING/_measure/suite_results_20260810.json`.
**(4) CHRIS RE-RAN HIS VET — SPLIT DECISION** (`docs/CHRIS_FULL_APP_REVIEW_2026-08-11.md`). A clean
supplier teach is **19/19 with zero bleed** (the thing he'd have quit over). But teaching a
**purchase order the OWNER issued** still leaked onto 20 Oakhaven delivery notes — **verified on
disk**, and the VAT number crossed over too. `template_identity_on_page` needs a layout to NAME its
company; an owner-issued PO carries the owner's name and the supplier's notes carry the owner's
address as recipient, so the guard is satisfied. **The 08-10 DAY fix closed the supplier case and
left the buyer-issued case open.** **NOTE: that flag is in `PROVEN_ON_DEFAULTS`, so a FRESH install
has it ON and the owner's own DB does NOT.** His sharpest line: *"every guard in this product is
pointed at absence; none at confident nonsense"* — a teach read `@a eens Ee`, showed a success
toast, flagged nothing, and made two junk output folders. Also: **Approve silently does nothing**
(Reject works).
**(5) Oracle C6 done:** embedded scans are **150 DPI native, rendered at 200** — no free resolution,
and "raw" is already resample #1, so the `I`→`1` result rests on a synthetic chain. Generalisation to
a real scanner is HYPOTHESIS.

### Prior — 2026-08-10 EVENING2: **`HANDOVER_2026-08-10_EVENING2.md`**
Branch **`feat/teach-side-overnight`**, HEAD **`8ee7456`**, PUSHED, tree clean. Owner present.
Migration was 60 at that point (**now 61** — see the 08-11 DAY block). **Nothing flipped; NOTHING smoke-tested in the UI.**
**(1) A TYPED TEACH VALUE NOW CAPTURES A POSITION** (`3f21ddb`, default ON, operator-gated): the
typed string is searched for in the page's own word geometry, the hit is DRAWN and the operator
approves it, and it then commits through the SAME `store()` as a drawn box — an ordinary Stage 0.5
MAPPING, so `doCommit` needed no special case. No hit ⇒ the old `fixed_value` path, byte-identical.
Words come from the **PIPELINE's** `reconstruct_page_text`/`words_out`, not the zone ladder. Matching
is EXACT-after-normalisation, no fuzzy tier, one visual row. **A hit returns `{box, text, wordCount}`
and NOTHING else — PINNED with `vat_no='VAT'` as the fixture. A box is evidence about WHERE, never
WHETHER.** Kill `teach_typed_value_locate`. **Limit seen live: a mangled read can't be located
(`GB651002784` → `'GB85'`+`'1002784'`), so the census's 89.5% is an UPPER BOUND.**
**(2) A PRINTED SLASH INSIDE A REFERENCE WAS BEING DELETED** (`1ad36de`). The owner's *"doesn't
appear on this page"* note was **TRUE**; the value was wrong. `anchor._repair_single_token`
(fn `:2650`, guard `:2686`; reached from `template_mapping` via `_ocr_crop_laddered` at
`anchor.py:3228` — NOT `template_mapper.py:3638`, which is the test-stub path) re-reads a spaceless
code containing `/` with a whitelist that **cannot emit `/`** and accepts on matching alphanumerics —
true of every code whose separators are PRINTED. **The backlog's own analysis was WRONG and is
corrected in place: it named the comparison local and missed that the function RETURNS `alt`.** Fix =
a SHAPE rule (≥2 groups of ≥2 alnum keeps its separators; a one-char group is the artefact
signature); `|`/`\` never structural. Kill `CODE_SEPARATOR_STRUCTURE_GUARD`, DEFAULT OFF.
**(3) CORPUS GATE GREEN** (`8ee7456`): **ref 25 ok/3 wrong → 27/1 (89%→96%), all eight other lanes
BYTE-IDENTICAL incl. winning-rung distribution, 14→12 failing cells, 0 regressions.** **The residual
is the proof** — doc 0025 carried TWO defects and now reads `P1/26/9923`, so the arm SHOWS the
`I`→`1` is a separate upstream OCR defect. Its confidence moved 95→90, still over the 88 floor.
**(4) NON-UK VAT NUMBERS RECOGNISED** (`d9768c5`, `VAT_EU_FORMATS`, DEFAULT OFF) — per-country
structures with exact element counts, never a generic two-letter rule (which readmits the garbles).
**Live census: 56 distinct values, 0 flipped refused→accepted.** `vat_eu` ships as a separate INERT
list; the flag is what merges it. **THERE ARE THREE CONSUMERS OF `validation_patterns`, NOT TWO** —
Python (`keyword.load_patterns`) and the renderer (`get-validation-patterns`) widen; `trust.js`
`_sharedValidationPatterns` (freeze_guard + the auto-file checksum) deliberately does NOT, and that
is PINNED. **NO corpus arm, deliberately: the corpus is UK-only and a flat lane cannot distinguish
"inert because UK" from "never armed" — Oracle upheld this but named the arm that IS valid (a
REJECTED-candidate census; the committed-value census is blind to what the gate refuses).**
**(5) `FILING_VALUE_SANITY_FLAGS` IS `'true'` IN THE LIVE DB** — the note below recording it as
bridged-but-OFF was STALE. Verify a flag's state in the DB before calling an arm inert.
**(6) OWNER: `deskew_on_import` is `'true'` AGAIN and it is NOT inert** — `engine.py:5253` is
`elif (TEACH_ANGLE_COMPOSE_SCAN and not raw_pages ...)` and import-deskew populates `raw_pages`, so
`teach_angle_compose_scan` (also `'true'`) is **armed and structurally unreachable**.
**(7) 2026-08-10 EVENING3 — BOTH ORACLE PASSES RUN: SIGN OFF WITH CONDITIONS, NEITHER FLIPPABLE YET.**
**VAT C1 was a SHIP-BLOCKER, now fixed:** `NO` is also the English caption word "No", the separator
class swallowed a trailing full stop, and a UK VRN is exactly NINE digits — Norway's own count — so
`No. 651 0027 84` (a UK number carrying its label tail) validated as Norwegian at coverage 1.00 and
would have committed SILENTLY. The MVA/MWST suffix is now MANDATORY; pin run RED first; census
unchanged (56/10/46/0). Also fixed: the renderer cached the MERGED patterns, so a flip needed a
restart and left the pipeline wide while the warning stayed narrow (C4). **C2 DISCHARGED:**
rejected-candidate census (`VAL_CENSUS_DIR`, arm `valcensus`) - **2036 gate decisions, 230 `vat_gb`
refusals, 61 distinct, ZERO newly accepted by the widening.** The refused population contains three
literal caption tails (`'No GB 903331842'`, `'NoGB 903331842'`), so the mechanism C1 fixes is REAL
on this data; it does not fire only because these suppliers print `GB` after the caption. **This
corpus holds the MECHANISM, not the TRIGGER - the pre-C1 list would also have accepted 0 of the 61.**
**Separator guard: layer and root cause CONFIRMED** (Oracle ruled AGAINST making the re-read
unreachable from the template rung). Applied C3 (my commit shipped a FALSE CITATION —
`template_mapper.py:3638` is DEAD in production; the live reach is `anchor.py:3228`), C5 (currency
excluded), C4/C6/C7 pins. **C1 ANSWERED, and it is worse than either branch Oracle predicted:** armed, the owner's exhibit
commits `P1/26/6000` — separators restored, `I`→`1` still wrong — and **the note CLEARS on 3 of 5
live Pelican documents**, because their full-page OCR carries the SAME misread so Gate C now
matches. The guard turns "wrong value + warning at 95" into "wrong value + NO warning at 94", which
clears the 88 auto-file floor. **Tell the owner what they will actually see before they flip, and
do not flip alongside a lowered `auto_file_threshold`.** The `I`→`1` defect now has its own entry.
**C2 ANSWERED TOO — BOTH BLOCKING CONDITIONS DISCHARGED.** New outcome counter
(`SEPGUARD_CENSUS_DIR`, inert unless set) over both corpus arms: **91 reached, 91 repaired in base,
91 kept / 0 repaired armed — and 91 of 91 are FALSE POSITIVES.** The artefact class the repair
exists for occurs **ZERO** times; on this data the function has never once done its job and has
deleted a printed character 91 times. Inverse census on the live install
(`stress_test/census_separator_kept.py`): 887 values carry a structured separator, **0** have the
artefact signature. **State it honestly: cost is zero because NEITHER dataset contains the class it
disables — the flat lanes prove nothing about that cost; the census does.** What is left before a
flip is a JUDGEMENT, not a measurement (the cleared warning above). Method in `pendingfeatures.md`.
**OUTSTANDING: the two measurements above, and the whole UI smoke list.**

### Prior — 2026-08-10 EVENING: **`HANDOVER_2026-08-10_EVENING.md`**
Branch **`feat/teach-side-overnight`**, HEAD **`6acf4e2`**, PUSHED, tree clean. Owner present.
**UI/UX + COPY ONLY — no extraction-layer change, no flag flipped, no migration.** The whole
UX/product group in `pendingfeatures.md` is closed or honestly re-scoped.
**(1) THE BACKLOG WAS LYING IN FOUR PLACES.** Core Search re-skin (`d7ab2e2`+`23109fb`),
document-detail DTO (`b747676`) and focus-sweep slice 1 (`01a2a43`) were **already shipped and never
ticked**; the custom-stamp entry claimed the approver's note "is not printed on the stamp" — **FALSE
and never true of the shipped code** (`pdfStamp.js:87`/`:111-114`, `workflowService.js:319`). All
four corrected. **Check an entry at source before building it.**
**(2) OWNER CAUGHT A REAL MISS:** my first TM-Straighten commit made the *mapping* overlay
frame-aware but missed `drawRegistrationPreview` — the overlay actually in use when checking a
template. `redrawTplCanvas` has **THREE exits** (`tplPreviewMode`, `tplLandmarkMode`, normal); a
change to "the overlay" must address all three. Fixing it exposed that `currentTplPageB64` fed the
resolver **whatever `tplImg` was showing** — after Straighten, the straightened bitmap, i.e. a page
production never sees, whose results would then have been DOUBLE-transformed. Now pinned to the RAW
page.
**(3) `minimizable:false` on child windows rested on a STALE comment** — `NON_MODAL_CHILD`
(`main.js:499`) contains every member of `CHILD_WINDOWS` (`:498`), so `modal` is always false and
there is no "locked main shell". Minimise re-enabled + a docked chip on the main window; restore is
sender-guarded; kill switch **`CHILD_DOCK=0`**. **If a child is ever made modal again, revisit the
dock in the same change.**
**(4) TEACH NO LONGER SELLS THE POSITION-LESS ROUTE.** The big accent "Always the same on every
document? → Set a fixed value" card is GONE; manual entry is a quiet top-of-step hatch that states
what the choice costs. Issuer copy now says the value may be drawn ANYWHERE printed, **footer
included**. **NOT CHANGED: what a typed value persists** — still `{value, target:null, anchor:null,
status:'fixed'}` ⇒ no geometry. That is an OPEN backlog entry with the deciding measurement named.
**(5) STAMP: placement + size** (normalised TOP-LEFT-origin `box`, flip to pdf-lib's bottom-left
happens once inside `stampPdf`; clamped at render; new `stamp_placement` setting where **UNSET means
the built-in corner**) **+ the two-approvals-share-one-path wart FIXED** (per-route filenames;
legacy copies still resolve because every reader uses the stored `route.stamped_path`). Notes now
ELIDE — over `MAX_NOTES` used to produce **no stamped copy at all, silently**.
**(6) Ageing chip** on open mailbox routes (no schema/scheduler/new toast events); `created_at` has
no zone marker so it is parsed as **UTC explicitly**. Core only — the detached client did not get it.
**(7) TM tightness: `search_expansion` now explains both failure modes + "tested N days ago".** The
other knobs (registration on/off, label-lock strictness, absolute-vs-relocate) are **NOT columns** on
`template_field_mappings` — a migration + per-mapping rung overrides, i.e. EXTRACTION work, not UI.
**GATES:** pdfStamp 9→13 checks, workflow ×4, workflow-IPC, entitlement, settings-wiring — all green.
**NOTHING WAS SMOKE-TESTED IN THE UI.** Owner must eyeball Straighten+registration-preview on a
tilted sample and a box drawn-while-straightened round-tripping.
**(8) TWO FLAGS HANDED OVER AS "AWAITING THE OWNER'S FLIP" COULD NOT BE FLIPPED** (`cb79586`).
`TEMPLATE_FORMAT_FAIL_YIELD` + `CUSTOMER_PO_LABELS` were read straight from `os.environ`
(`engine.py:2158`, `keyword.py:1031`) with **no Settings bridge**, and `npm start` injects no env —
so they had shipped OFF for ever. **Same class as the five bridged on 08-09 NIGHT, one day later.**
Now bridged (DEFAULT OFF) + PINNED in `test_settings_wiring.js`. **A flag is not "awaiting a flip"
until a toggle exists that flips it — check that pin before writing the phrase.**
**(9) TYPED TEACH VALUES: MEASURED, direction decided** (`stress_test/fixed_value_locatable.js`,
read-only). **17/19 measurable fixed values (89.5%) ARE printed on their own sample page**
(`supplier_name` 7/7, `vat_no` 6/6, `account_no` 3/3) ⇒ they were typed because the READ was wrong,
so the fix is to find the typed string in the page's word geometry and store the box. **CONDITION:
presence ≠ correctness** — two of the 17 are known-wrong (`vat_no='VAT'`, `'Pelican Office
Interiors -'`), so capturing geometry must NOT raise a value's confidence. A box is evidence about
WHERE, never WHETHER.
**GOTCHA: `ELECTRON_RUN_AS_NODE=1` is REQUIRED** for most JS suites — without it the Electron binary
launches a GUI and hangs until the tool times out.

### Prior — 2026-08-10 DAY: **READ `HANDOVER_2026-08-10_DAY.md`**
Branch **`feat/teach-side-overnight`**, HEAD **`65abd6f`**, PUSHED. Owner testing an installer.
**INSTALLER BUILT:** `dist\ScanFinder Setup 2.0.0-r20260810-0915-29425c9.exe` with **43 reading
improvements ON by default (migration 60)** — written as SETTINGS ROWS so the toggles render as on;
`deskew_on_import` + `template_fixed_seed_agreement_keep` deliberately excluded. **It predates the
account-number, cold-start and teach-parity fixes** — rebuild before the next test pass.
**(1) THE WRONG-COMPANY MISFILE IS FIXED** (`ebd2096`+`fba4374`, OFF, Oracle SIGN-OFF-W/COND, all six
conditions applied). Cause was NOT the logo: a buyer-issued template's fingerprint is the OWNER's own
address block, printed on every document the business RECEIVES, scoring 0.80 against every supplier.
Fix = a layout may only claim a document that NAMES its company. 160 kept / 40 refused / **0 right
matches lost**; fresh-import gate: wrong senders 18→1, account 36→19, ref 37→54, date 44→61, po_ref
6→23. **Oracle caught two real defects in my first version: I used the cosmetic template NAME as the
identity (an admin RENAME would have silently killed matching for ever), and I vetoed the WINNER
instead of filtering the POOL ("teaching a second supplier broke the first one").**
**(2) STICKY BINDING FIXED** (`29425c9`) — reprocess honoured a wrong binding for ever; now the
memory must pass the same test. Reprocess path: wrong senders 18→1, all other lanes unchanged.
**(3) ACCOUNT NUMBERS** (`efbbd20`) — `account_no` inherited a generic bank containing the bare
caption `Ref`, so "Job Ref JB-8887" became the account number on 20 pages that have none. 19 wrong→0.
**(4) COLD-START SENDER** (`c629d32`) — the document TITLE was outranking the company name
(`GOODS DELIVERY NOTE` 2.21× vs 2.05×, ratio 1.078 < the 1.10 bar ⇒ abstain). The type-heading
exclusion was EXACT-match, so one extra printed word missed it. Correct suggestions 19→36, none→0.
**(5) TEACH ↔ SETTINGS PARITY** (`9903dbb`) — the wizard gains **Add from catalog…** + **Edit this
type…**, both the SAME code as Settings (catalog extracted to `shared/doctype-catalog.js`).
**(6) SERIALS REVERTED, and the revert is the finding** — the format gate killed the caption commits
but swapped an obviously-junk value at 35 for a plausible `'CJB-5900'` at 90. The taught box reads the
WORKSHEET NUMBER; format cannot separate two codes of the same shape.
**CORPUS ANSWER:** `SINGLE` is born-digital BY DESIGN; `IMPORT`/`IMPORT2` are 400/400 image-only, so
every figure this week is on the scanned path. New `TESTING\SCANNED` + `SCANNED_HARD` via
`stress_test/make_scanned_set.py` (teach FROM a scan; the corpus never tilts past 1.6°).
**GOTCHAS:** `teach_run_ab.js` passes `known_template_id` (models REPROCESS) so it is STRUCTURALLY
BLIND to identification fixes — use `TEACH_FRESH_IDENTIFY=1`. Two of my probes lied before the code
did (empty exclusion set; a false `PROFORMA INVOICE` claim). Bind source pins by the code BLOCK, not
a character count — a fixed window had already shrunk past what it checked.

### Prior — 2026-08-10 OVERNIGHT: **`HANDOVER_2026-08-10_NIGHT.md`**
Branch **`feat/teach-side-overnight`**, HEAD **`bc157d9`**, PUSHED. Autonomous run, agents + Oracle.
**(1) THE HEADLINE IS A DEFECT, NOT A FIX: ONE ORDINARY CONFIRM STAMPS THE WRONG COMPANY ON 18 OTHER
COMPANIES' DOCUMENTS AT 95% AND FILES ONE OF THEM IN THE WRONG FOLDER.** Confirming a single
Quillstone purchase order created a template with `supplier_name` frozen; it then matched **Oakhaven
delivery notes** (different company, different type) and stamped Quillstone at 95 via
`template_fixed`. Found TWICE independently — Chris at the screen, the harness in the DB. Chain
verified at source; `TEMPLATE_FIXED_NAME_PRESENCE_VETO` was inert because it needs >=3 confirms and
there was 1. **NOT FIXED — advisor round + Oracle first; four candidate directions in
`pendingfeatures.md` (top entry). DO THIS FIRST.**
**(2) VAT FIXED** (`92c7013`): `vat_no` had NO format — it fell back to the generic ref rule, which
is a length check that accepts 'VAT'/'3PL'/'1RE'. Now a shipped field with UK patterns + labels +
the Review on-blur twin. **100 ok/26 wrong/54 empty → 171/0/9 on 200 docs, every other lane
byte-identical.** 21 of the 26 were a template's frozen `fixed_value` = the caption 'VAT' →
`TEMPLATE_FREEZE_QUALIFY` (OFF) + `database/modules/freeze_guard.js`.
**(3) SIX SECURITY HOLES CLOSED** (`4ef1d1c`/`c45ff27`/`bdb0325`/`ab246f5`): `LICENSE_PINNED_KEYS=0`
was a complete offline licence bypass; `%SystemRoot%` made a 5-minute repeatable free trial; a
packaged build now refuses `--remote-debugging-port`; the failed-key brake **permanently locked out
paying customers**; one person could take signups offline worldwide; `processing.log` was recording
customer names/VAT/totals/paths with no toggle (now redacted unless Diagnostic Logging is on).
**(4) ORACLE SENT ONE BACK AND FOUND A DEAD GUARD:** arming the fuses in `npm run build` is REVERTED
(signing trap: afterPack runs after signing). **`config/keyword_patterns.json` is NOT in `app.asar`**
— `trust.js` loaded it repo-relatively, so its strict-type re-check has NEVER fired in a packaged
build. Fixed in `trust.js` + `freeze_guard.js` via `process.resourcesPath`.
**(5) NEW INSTRUMENT — `stress_test/readable_census.py`**: scores only values ACTUALLY PRINTED. The
account number is printed on 60 of 200 docs; the lane is **100% on those** and INVENTS a value on 40
pages that carry none. On printed values: customer 99 · total 97 · vat 96 · account 100 · po_ref 92 ·
issuer 78 (40 misses = untaught suppliers) · serials 68.
**(6) FIVE MEASURED FLAGS WERE UNREACHABLE** (env-only, `npm start` injects none) and are now bridged:
`STAGE05_REF_CODE_GATE`, `KEYWORD_GENERIC_CAPTION_EXCLUSIVE`, `TYPE_TITLE_OWNER_PRECEDENCE`,
`FILING_VALUE_SANITY_FLAGS`, `LETTERHEAD_ISSUER` (the cold-start sender reader — sender was blank on
all 60 docs from unseen suppliers). **"still OFF" was true when written and is now STALE — verified
2026-08-10 EVENING2, ALL FIVE are `'true'` in the live DB** (54 settings are). Read the DB, not this
line, before calling an arm inert.
**GOTCHAS:** never measure against a DB another agent is using (snapshot to `TESTING/_measure/`); a
mutator arm inherits NO env unless named in `ARM_ENV`; a probe without `pytesseract.tesseract_cmd`
reports absence about everything. `CAPTION_VALUE_REFUSE` shipped INERT (0 docs change).
**OWNER: `deskew_on_import` is TRUE again in the live DB** — standing ruling against it, and it
silently disables `TEACH_ANGLE_COMPOSE_SCAN`.

### Prior — 2026-08-09 NIGHT: **`HANDOVER_2026-08-09_NIGHT.md`**
Branch **`feat/teach-side-overnight`**, HEAD **`71bce9b`**, PUSHED.
**(1) THE HARNESS WAS MEASURING THE WRONG PIPELINE.** `teach_run_ab.js` mirrored only settings whose
value is literally `'true'`, so numeric `ocr_dpi` was dropped and Python fell back to 300 while the app
renders at **200** (`_ocrDpiEnv`, handler.js:91-96, applied at every extraction spawn). **Every absolute
figure in every prior handover was taken at the wrong DPI**; A/B deltas are unaffected. FIXED.
`trace_one_doc.js:65-66` has the same gap, NOT fixed.
**(2) Oracle C3/C4/C6/C7 CLOSED** (`c027d86`). C3 was built exactly as signed, MEASURED, and REFUTED —
adopt-on-proof scored 111/6/3 vs the unproven arm's 119/1/0, costing 8 heals and MINTING 6 wrong values
(a credit note reverted to its VAT row, a minus sign lost). Premise fails because on the DERIVED rung
the reference read is itself wrong 28 times in 120. Shipped INVERTED: refuse on EVIDENCE OF LOSS, not
absence of proof. Residual: the shipped guard is INERT on this corpus (0 docs change).
**(3) FOUR FLAGS NOW BRIDGED** (`11d3f46`, `a3b4938`) — they were env-only and `npm start` injects no
env, so the two headline wins of the 08-09 arc were unreachable in the product. **FLIP ALL FOUR
TOGETHER OR NONE**: the teach-side pair alone costs 25 totals.
**(4) ISSUER ROOT-CAUSED.** `noreg` diagnostic arm: registration OFF ⇒ issuer **118/22 → 140/0/0**. The
taught boxes were right on all 22; the arbiter discarded them. WHY only this field:
`template_field_mappings.anchor_text` is **NULL with dx=dy=0 for `supplier_name` on all seven
templates** (a letterhead name has no caption), so `_extract_one`'s drift guard is skipped,
`anchor_stable` can never be True, and the global transform is the only drift compensation.
**ORACLE FINAL: the layer MOVED — fix the ARBITER** (`template_mapper.py:2231` must require anchor
evidence AVAILABLE-and-failed, not merely absent). **gary's decline-branch is SUPERSEDED, do not build
it.** Secondary: the owner's region-scoped presence confirm. **Logo ruled (b) keep-seed-but-flag, never
accept silently** — the phash has no separating power on scans and re-consuming it is circular.
**(5) `deskew_on_import` was ON and is now OFF again** (owner-instructed, 20:18). While on it populated
`raw_pages`, which makes `TEACH_ANGLE_COMPOSE_SCAN` unreachable (`engine.py:5089` is an
`elif ... not raw_pages`) — so the +18 issuer/+36 customer win was OFF and an unmeasured path ran.
**Remember the interaction: turning import-deskew on silently disables COMPOSE_SCAN.**
**CORRECTION to the anti-deskew record:** the "2.0° floor → heal vanished (0/1127)" argument is
**VACUOUS** — the corpus never tilts past 1.6°, so a 2.0° floor deskews nothing. The real argument is
wrong-layer (rotate the box, not the page) plus one real-paper exhibit.
**(6) An 11-agent read-only audit ran** — 32 findings. Auto-file has **NEVER fired on this install**
(0 of 360, max overall_confidence 95, threshold 100), so the money/issuer risk is LATENT. At conf==100
`docTrustGate` is SKIPPED entirely. `credit_sign_note`'s raw-marker arm is a DEAD GUARD (`raw_value`
never assigned). `total_amount` has ZERO rows here — the real key is a custom field named `total`.
**CORRECTION: the 08-09 EVENING handover's headline is wrong** — that arm scores **119 ok / 1 wrong /
0 empty**, not "119/0 wrong/1 empty". Nordwind quote 0015 commits `'2.205.60'` (conf 50 + note).

### Prior — 2026-08-09 EVENING: `HANDOVER_2026-08-09_EVENING.md`
Branch **`feat/teach-side-overnight`**, HEAD **`81c8c4c`** (over `7951156`). The money slice:
**totals 89 ok / 28 wrong / 3 empty → 119 / 0 wrong / 1 empty, 30 healed, 0 regressed, all eight
other lanes byte-identical**, replaying the owner's LIVE taught state over 200 documents. Two
mechanisms: `_label_drifted`'s vertical tolerance is floored at `_DRIFT_FLOOR = 0.02` while body text
runs ~0.013/row, so a one-row label move reads as "not drifted" and the box keeps the **VAT row**
(19 of 23 wrong totals were exactly truth ÷ 6 — the arithmetic fingerprint); and money is
right-aligned so a longer value overflows LEFT, with the repair primitive (`_snap_box_to_words`)
scoped to exclude currency. Flags `TEMPLATE_DRIFT_ROW_PITCH` + `TEMPLATE_CURRENCY_EDGE_GROW`, both
DEFAULT OFF, env-only (**no Settings bridge**), and `TEMPLATE_CURRENCY_EDGE_GROW` is inert unless
`template_target_word_snap` / `template_abs_edge_guard` are ON.
**Oracle: SIGN OFF WITH CONDITIONS — C1 + C2 CLOSED, C3 STILL BLOCKING** (give the derived rung the
digit-suffix proof the absolute rung already requires, or census it); C4/C6/C7 outstanding. Ruled
NOT wrong layer; `realdoc_regression.js` is NOT a precondition (one call site, and the live DB's 7
confirmed documents make it vacuous). **A derived money read has NO guard but geometry** — flat
confidence 90 clears the 88 auto-file floor, `currency ∈ _SELF_VALIDATING_TYPES` kills the shape
check, and Stage 4's arithmetic is flag-only/total-role-only.
**GOTCHAS:** `TESTING\_sandbox\userData\docusnap.db` is a STALE taught state (its totals lane scores
1% for unrelated reasons) — the real one is the live `%APPDATA%\ScanFinder\docusnap.db`; use the
sandbox only as a SECOND state for collateral. A green pin proves nothing until you show it can fail
(two of mine were rejected upstream of the leg they claimed to test — use a *code* as the control).
`_DRIFT_FLOOR` is a page-scale constant used as a row-scale predicate in THREE places; the
registration arbiter is still unfixed, and a False drift verdict also vetoes it via `anchor_stable`.
**NEXT SESSION: a workflow-mode audit — the corrected prompt is in the handover, ready to paste.**

### Prior — 2026-08-09 morning: `HANDOVER_2026-08-09.md`
Branch **`feat/teach-side-overnight`** (revert point `8b8b458`). Teach-side arc, all flags DEFAULT OFF.
**MEASURED on 140 unseen siblings of 10 taught documents: date 140/0 (100%), customer 138/2 (99%),
issuer 121/19 (86%), ref 120/20 (86%)** — from 116/21, 88/52, 88/49, 107/29 that morning. No correct
value lost by any fix. **The corpus was REGENERATED today** (the old one re-rolled labels per
document — an artefact the generator fixed on 08-06 in `c74071d`), so every teach-side figure from
before today understates the product; deltas between arms still stand.
**Shipped:** `TEACH_ANGLE_COMPOSE_SCAN` (place the taught box on the page's own tilt, no pixel
rotated — the biggest win), `TEMPLATE_FIXED_ISSUER_REPAIR` (42 of 135 documents read something other
than the curated issuer), three teach-side gates (`4e5c21c`), Chris's findings 1/2/3/5 (`119f28a`),
and the SFDEV "All boxes" overlay that found most of this.
**OVERTURNED — do NOT flip `deskew_on_import`:** straightening at import measured +213 cells with
zero regressions, and Oracle ruled WRONG LAYER. The corpus tilts every page ≤1.6°, inside Tesseract's
self-tolerance and inside the band doc-561 proved HARMFUL, and adds noise AFTER rotating so it cannot
contain the harm case. Re-run at a 2.0° floor the entire heal vanished (0 of 1127 cells). Fix
placement, not pixels — which is what `TEACH_ANGLE_COMPOSE_SCAN` does.
**INCOMPLETE, pick up first:** `TEMPLATE_CURRENCY_EDGE_GROW` — money is right-aligned so a longer
value overflows LEFT (`'£10,603.44'` read as `'0,603.44'`); currency is absent from the edge guard's
gate. Wired and unit-correct but DOES NOT FIRE — find where the guard bails.
**GOTCHA:** `py_compile` is not verification — it never resolves a name. A constant defined before
its dependency passed compile, raised NameError at import, and returned 140 empty documents in every
lane. Import the module. And a DB probe must use `mode=ro`, never `?immutable=1` (it ignores `-wal`).

## Prior — 2026-08-08 OVERNIGHT (autonomous): `HANDOVER_2026-08-08_OVERNIGHT.md`
Branch **`feat/teach-side-overnight`** (revert point `8b8b458` on `feat/reprocess-throughput-autostraighten`).
The owner ran a controlled TEACH-SIDE test — teach 1 document per issuer x 10 issuers, import 20
scanned siblings each — and it was scored against corpus ground truth for the first time. **The 98%
goal was NOT met: date 83 / total 72 / ref 64 / issuer 60 / customer 53 / vat 51 / po_ref 35 /
account 28 / serials 0.** The remaining gap is GEOMETRY (a taught box reading the wrong row/column
on a drifted scan), not rules — do not spend another night on rule slices.
**Shipped dark + measured (`4e5c21c`):** `STAGE05_REF_CODE_GATE` (a taught box committed its own
caption 'Ref' as the reference — Stage 1's digit gate never reached Stage 0.5),
`KEYWORD_GENERIC_CAPTION_EXCLUSIVE` (one code captured into THREE fields — every ref-role field is
seeded the same generic caption bank), `TYPE_TITLE_OWNER_PRECEDENCE` (**the silent one**: type
election is a bucket SUM, so an install-created type owning one phrase loses to a built-in owning a
whole vocabulary, and a template taught against it binds to a slug its siblings can never detect as
— 35 documents matched NO template and the operator got no signal at all).
**REFUTED BY MEASUREMENT — do NOT flip `TEMPLATE_FREEZE_ISSUER_ONLY`:** the freeze defect is real
(a field is frozen from a sample of ONE and stamped at 95), but unfreezing moved po_ref 35→50% and
**vat_no 51→16%** — a VAT number IS a genuine per-supplier constant whose taught mapping often
fails, and the stamp was carrying it. Ships OFF with a reversible sweep so the decision stays open.
**New instruments:** `stress_test/teach_run_ab.js` (replay 200 siblings under a mutated learning
state or env arm, ~6.5 min) + `stress_test/score_teach_run.py` (per-scope/per-field, counts EMPTY
separately from WRONG) + `scripts/teach-sandbox.js` snapshot/restore. **OUTSTANDING: the Chris
replication arm of the owner's instruction was not run.**

## Current session state (2026-08-08 EVENING, owner present) — ORACLE ×2 · SEC-17 FAIL-OPEN fixed · teach label-pick · 2 live pattern defects · 2 owner decisions shipped · Pelican `customer_name` diagnosed
**READ `HANDOVER_2026-08-08_EVENING.md` FIRST** (NOT `HANDOVER_2026-08-08.md`, a MISDATED older
file; `_DAY` is the earlier half of the same day). **HEAD `87c3057`, 13 commits, ALL PUSHED.
NOTHING NEW FLIPPED** — the owner said they will flip when the arc finishes.
**(0) THE NAME_UNCLIP ARM RAN AND IS A TRUE NEGATIVE — do NOT flip `NAME_UNCLIP_RECONCILE` for the
Pelican class.** 110 docs × 2 arms: HEALED 0 · REGRESSED 0 · collateral 0. Structurally inert, three
declines: C2's floor `len(wl)<4` vs a 2-char remnant `'lt'`; C3's `_uv_text_page_present` SKIPS
tokens with alnum core <4 (its docstring's example is literally `'Ltd'`) so it never tests the cut
token; and C1 needs a CROP witness but a teach leaves NO `field_anchors` row. **The better finding:
`supplier_hints` holds the correct value at `usage_count=10` and `keyword_override` reads it too,
yet the clipped taught read beats both at 95 — `hint*` is its own witness family, excluded from
C1's `{keyword, crop}`. The system knows the answer twice over and cannot apply it.**
**(1) SEC-17 Oracle pass found a LIVE FAIL-OPEN IN THE SHIPPED FIX** (`917a009`) — SIGN OFF W/COND,
3 BLOCKING, ruling **LEAVE IT ON**, severity down to **LOW**. `_realCanonical` returned the RAW path
on ENOENT while the ROOT was canonicalised (two frames, one comparison), so a MISSING leaf under a
junction still passed; the shipped comment's "openPath would fail anyway" holds for `open-file` but
NOT `show-in-explorer`, which reveals the CONTAINING directory. Fixed by an ancestor walk. B2: the
pin's FAIL-CLOSED line asserted the OPPOSITE of its label and the `return null` branch was ENTIRELY
unpinned. 20 pins, zero skips. **B3 STILL OPEN + BLOCKING for release** (the refusal is SILENT —
both channels are `ipcMain.on`; discharge by a visible distinct refusal OR a MEASUREMENT on a
dehydrated-OneDrive-offline file). **C5 SEAM: containment is NOT total** — door 2 of
`_isOpenablePath` matches `stored_path` TEXTUALLY, so a doc filed through a junction opens fine.
**(2) TEACH LABEL PICK** (`1eb96fb`+`b41cad6`) — `autoLabel` picked by ARRIVAL ORDER; now calls the
shared Oracle-signed `pickLabelCandidate` the Review ⊕ tool has used since 07-11 (that module's own
comment recorded teach's gap as "C5"). Oracle GRANTED default ON after refuting the regression he
looked for, then found a real smaller one — **T1**: the scored-out path replaced a LOCATED box with
the synthetic strip. 27 pins.
**(3) TWO LIVE VALIDATION DEFECTS** (`c15f679`) — `iban` rejected every conventionally-printed IBAN
(while `trust.js` ACCEPTED it, so the renderer warned on correct values); the `ip_address` IPv6 leg
accepted `09:30:15` as **TYPE-AUTHORITATIVE** (`_PRECISE_VAL_TYPES`) and rejected `fe80::1`, the
example the UI prints. **The new JS pin caught a gap in my own IPv6 fix** that `re.search` had waved
through — the Python pin now asserts WHOLE-VALUE coverage.
**(4) OWNER DECISIONS SHIPPED** — `delivery_number`→`reference_code` (`3dc162c`, **migration 59
CONFIRMED APPLIED** on restart; of 126 distinct values exactly ONE lacks a digit: `'Delivery'`, the
bug itself; **extraction deliberately does NOT move** and that is PINNED). `ocr_type` **RETIRED**
from the UI (`2a85838`; column stays defaulted; the dev CLI was REPOINTED to the field's real type).
**(5) DATA-TYPE WIDENING = ORACLE SEND BACK** — do NOT build as specified. B1–B6 + G2/G6 in
`pendingfeatures.md`. **B2 struck a claim I had written: `STRICT_TYPES` is NOT the rail** (it checks
FORM; a wrong-PARTY value is well-formed and passes, and a strict type `continue`s past the
cold-scope check). `guessType` AUTO-SELECTS the broken types, so it is NOT as latent as filed.
**(6) OWNER-REPORTED, DIAGNOSED: Pelican `customer_name` wrong 66/72** (`d0ef6a2`) — ONE mis-sized
taught box on tpl 33: `tw=0.1627` ends FLUSH with the last glyph (drift shears the `d` →
`'Bramblewood Joinery Lt'`), and `th=0.0151` ≈2.2 line-heights admits the address row
(`'Unit 4, Sawpit Lane'`). **Word-snap AND abs-edge-guard are both ON but EXCLUDE NAMES by design**
(`template_mapper.py:308`), and the healer that owns names, `NAME_UNCLIP_RECONCILE`, is OFF. Clipped
commits at 95 and beats a CORRECT `keyword_override` at 83. **The obvious fix is WRONG — measured:
`TEMPLATE_FREETEXT_GUARD_PARITY` heals 1 of 66** (values score 0.67-0.75 vs the guard's 0.5 floor).
New read-only harness `stress_test/name_unclip_ab.js`.
**MY OWN CORRECTIONS THIS SESSION — do not re-derive them wrongly:** the free-text template-rung
population is **93 of 99** on docs 738+, NOT the "~1 read in 24" I recorded (the near-inert verdict
survives only on YIELD, never quote the reachability figure); the "Discount typed Percentage"
example is WRONG (`discount` is a shipped key — use `unit_price`/`account`); my currency-sign line
cites were STALE (`keyword.py:1509` + `_clean_value` `:1768-1772`); and `STRICT_TYPES`-as-rail (above).
**GOTCHA: `pytest tests/` ABORTS** — the suite mixes pytest and script-style files and one
`sys.exit`s at import. Four pre-existing failures verified identical with this session stashed.

### Prior wrap — Current session state (2026-08-08 DAY, owner present) — NIGHT3 slices BRIDGED + ORACLE-GATED · teach MULTI-PAGE shipped · SEC-17/18 · 4 self-corrections
**READ `HANDOVER_2026-08-08_DAY.md` FIRST** (NOT `HANDOVER_2026-08-08.md` — that filename is one of
the MISDATED older files). **HEAD `078569e`, 11 commits, ALL PUSHED.** Owner order was: Oracle the
shadow slice → bridge the two flags → the stale-shadow drop → then "finish teach wizard + template
manager anchor/value detection; all data types, not a subset; custom == built-in; keywords 100%".
**(1) `TRUST_SHADOW_ROW_SKIP` Oracle SIGN-OFF-W/COND, both BLOCKING conditions answered** (`e18859c`):
C1 raw-string sign check — `#718`/`#726` both carry the minus, and `credit_sign_coherence` is already
live; C2 new read-only harness `stress_test/shadow_row_skip_ab.js` — **its first run was VACUOUS**
(0 shadow rows/60 docs; "type lacks the money role" selects almost everything and mostly picks pages
with no totals), retargeted it moves exactly `#718`+`#726`. C3 `roleKeys` now from `COMPANY_KEYS`
(drift with `foreignFields.ownFieldPredicate` pinned impossible); C4 one read per doc/batch via
`opts.shadowRowSkip`; **C5 the flip is a SETTING read INSIDE `trust.js`** (env wins both ways for
harness arms) — `_reconcileEnv` does NOT reach it; C6 two FALSE comment citations corrected
(`review/renderer.js:2313` CONSUMES shadow rows for the verified badge; the "at100 precedent" never
existed). **C7: NOT sequenced behind `REPROCESS_SHADOW_STALE_DROP`.** Gate: post-edit ARMED realdoc
**byte-identical** to pre-edit armed; dark vs armed differ by ONE line (536/538); wrong-value 17
identical list. STILL OFF. **(2) Bridges** (`7ab9bcc`) + pin `test_settings_wiring.js` (`0c64dc3`) —
every addressed id must exist, divs must balance, each bridge must keep all three legs.
**(3) TEACH MULTI-PAGE SHIPPED** (`5ad0220`+`078569e`) — nav + real `page_number` in ONE commit;
sandbox smoke PASSED 4/4 (wrote `page_number:1` even when committing from page 1) and found a stale
unconfirmed read-back on page change, fixed. **(4) `resolve_geometry` page pad** (`6c85157`) —
shipped **ON** (`TEMPLATE_PREVIEW_PAGE_PAD=0` kills), Oracle GRANTED the default-ON deviation.
**(5) Free-text guard parity + fall-through cap** (`1f8ff9c`) — DARK, and **MEASURED NEAR-INERT**:
3 realdoc arms byte-identical; `supplier_name` is NEVER read by a template rung (logo/hint outrank
it), 1 template-rung free-text read in 24 docs. Correct in principle; **do not present as a heal**.
**(6) SECURITY `915c412`** — SEC-17 reparse-point containment (junction inside an approved root beat
the textual check; `realpath` was nowhere in `src/`) shipped **ON**, OPEN path only; SEC-18 explicit
`nodeIntegration`/`sandbox`. SEC-19..22 OPEN in **`SECURITY_BACKLOG.md`, which is GITIGNORED** —
`pendingfeatures.md` holds the only tracked pointer.
**FOUR OF MY OWN CLAIMS WERE REFUTED AND CORRECTED — do not re-derive them wrongly:** landmark
starvation is NOT caused by `_excludeBoxesFor` (13 of 15 starved templates have ZERO mappings, so the
exclude list was empty; and landmarks feed ONLY Stage-0.5 relocation, so just tpl 30 pays anything);
the teach `page_number:0` hardcode was TRUTHFUL (the wizard was page-1-only) — a missing FEATURE, not
a bug; the free-text truthy `val_type` comes from six SHIPPED CONFIG keys, NOT `_TYPE2VAL`, so
BUILT-INS skipped the guards and CUSTOM fields got them (inverted from my first report); and the OCR
DoS limits DO exist and are thorough (300 pages/500 MB/10 000 px + a 300 s watchdog).
**Also corrected: `REPROCESS_SHADOW_STALE_DROP` IS gateable** — `mergeReprocessRows` is a pure
function whose sibling switch states in-code that the unit battery is the gate.
NEXT: Oracle on SEC-17 · the landmarks-are-page-0-while-mappings-can-be-page-2 question · four owner
decisions (`ocr_type` wire-or-delete, `delivery_number` retype, signing, restricted Python account).
GOTCHA: a SANDBOX APP IS STILL RUNNING on port 9223 (PID 47032). `007` is NOT a registered subagent —
spawn general-purpose + persona.

### Prior wrap — Current session state (2026-08-07 NIGHT3, autonomous) — delivery defect FIXED · 3 slices DARK, all gates GREEN
**READ `HANDOVER_2026-08-07_NIGHT3.md` FIRST. HEAD `359f2c7` + handover; ALL PUSHED. Executed the
NIGHT2 plan under the owner's standing "run on auto and safely, no regressions".** Three slices built,
**ALL DEFAULT OFF, no flips, no confirms, no live-DB writes** (the Pelican docs are as the owner left
them). **(1) `TEMPLATE_INLINE_ROW_OVERLAP` (`d3cca7c`)** — `_target_inline_with_anchor` reused
`_DRIFT_FLOOR=0.02` (a DRIFT constant, ~1.5-3 line pitches) as a SAME-ROW tolerance, admitting the
label-ABOVE layouts its own docstring excludes, so `_pick_fuller_code`'s inline-disagreement branch
committed the caption `'Delivery'` (a dictionary word outscores a code on LSTM conf). Fix =
`tol=(anchor_h+target_h)/2`, the geometric definition. ONE predicate gates BOTH reconcile call sites;
`_inline()` is a third unswitched door, guarded ONLY where a stored offset exists (legacy dx=dy=0 keeps
`_inline()` PRIMARY — **pinned trade-off**). **Pelican arm D: 5 healed / 0 regressed** with both
reconciles still ARMED (= NIGHT2's arm C without the sledgehammer); collateral date+customer 0 moved;
realdoc 714 byte-identical (**not vacuous — `#728`/`#732` are on that template and correctly untouched**);
census 3/38 mappings change, all template 33. **(2) `REF_ROLE_DIGIT_GATE` (`7a02422`)** — the digit
predicate was right, its ARMING was a hardcoded pair; widened to the REF ROLE via
`_infer_validation=='alphanumeric'` (newly armed: credit_note/delivery/invoice/reference_number).
**Corpus 0 T→F / 7 F→T, ref 45.4%→47.9%**, all other lanes identical; 0/713 confirmed values rejected.
The heals FALL THROUGH TO THE CORRECT VALUE (`'Meadowvale'`→the real code), better than designed.
**(3) `TRUST_SHADOW_ROW_SKIP` (`5948f9c`)** — `docTrustGate` judged filability on INVISIBLE
`shadow_reconcile` rows → `unverifiable-value:<field>` deadlock, sealed twice. **realdoc auto-file
536→538, wrong-value auto-files UNCHANGED at 17.** The harness-overlay trap was fixed FIRST and the
threading verified in isolation. **CROSS-CUTTING PROOF: post-edit baseline (all 3 OFF) ==
pre-edit baseline, byte-identical, 714 docs.** **NOTHING IS FLIPPABLE YET** — no Settings bridge was
added (outside the plan); the two extraction flags need the `_reconcileEnv`+toggle pattern
(precedent `60606d9`), and `TRUST_SHADOW_ROW_SKIP` needs an owner decision because it is a JS-side
`process.env` read that a `_reconcileEnv` bridge does NOT reach. **PLAN DEVIATION — the NIGHT2 plan's
"Oracle → thread → build" for the shadow-row slice ran WITHOUT the Oracle pass (advisors may not be
spawned unsolicited this session). Gates green ≠ signed off — run Oracle before that one flips.**
**✓ RESOLVED 2026-08-08 — the shadow-row Oracle pass WAS run: SIGN OFF WITH CONDITIONS, both BLOCKING
conditions answered and C3-C8 implemented (`e18859c`). The other two slices (`TEMPLATE_INLINE_ROW_OVERLAP`,
`REF_ROLE_DIGIT_GATE`) are now BRIDGED to Settings but STILL have no Oracle pass — bridging made them
reachable, not approved.**
NEXT: `REPROCESS_SHADOW_STALE_DROP`
(designed; ~~**realdoc cannot gate it** — the reprocess merge isn't exercised there~~ **← CORRECTED
2026-08-08: it IS gateable. `mergeReprocessRows` is a PURE function with an existing unit battery,
and its sibling switch `REPROCESS_ANNOTATED_EMPTY_WINS` states in-code that realdoc is structurally
blind to that merge and THE UNIT BATTERY IS THE GATE. It does not need a new harness. Oracle also
ruled it is NOT a prerequisite for `TRUST_SHADOW_ROW_SKIP` — it fixes a stale "✓ mathematically
verified" BADGE, which is not a gate input.**). GOTCHAS: the
corpus scorer's `TAG` defaults to `base` so untagged runs overwrite ONE jsonl; it records `<lane>_got`
only when WRONG, so a heal reads as `'X' -> None` in a naive diff (read `verdicts`).

### Prior wrap — Current session state (2026-08-07 NIGHT2) — VAT-reg guard SHIPPED+FLIPPED · delivery defect DIAGNOSED · 2 designs ready
**READ `HANDOVER_2026-08-07_NIGHT2.md` FIRST. HEAD `5ee4718` + handover; ALL PUSHED. Owner approved an
autonomous night run: "run on auto and safely, no regressions".** (A) **SHIPPED + OWNER-FLIPPED LIVE:**
`vat_reg_not_amount` + `net_misread_total_flag` (`d575668`/`60606d9`/`2a1ae7d`) — a letterhead VAT
REGISTRATION NUMBER was read as a TAX AMOUNT (`number_format` rule 3 mints a decimal from the 3-4-2
grouping: `651 0027 84` -> `0027.84`), poisoning `subtotal+tax` so ~12 CORRECT docs carried "the total
doesn't add up". Gate: corpus 0 T->F + 0 values moved + `vat_no` untouched · **0 new `reconcile_pick`** ·
realdoc **byte-identical** n=699 · Castellan 19 fires/16 notes cleared/0 gained. As production runs it:
**false alarms 39->0, true flags 16->26**. Oracle SIGN-OFF-W/COND ×2; its BLOCKING C1 (credit-sign note
outranks net-misread; the net rail is sign-BLIND) fired on live data (#722). (B) **DELIVERY DEFECT
DIAGNOSED, NOT BUILT:** one wrong-column inline witness reaching the value through TWO reconcile call
sites (`:1241` `TEMPLATE_INLINE_CODE_RECONCILE_DRIFT`, `:1880` `TEMPLATE_INLINE_CODE_RECONCILE`) + a third
UNGUARDED door (`:1283` `_inline()`); admitted because `_target_inline_with_anchor` misuses
`_DRIFT_FLOOR=0.02` as a same-row tolerance. **Arm C (both off) heals 5/5, 0 regressions** —
`stress_test/inline_reconcile_ab.js`. Fix = `tol=(anchor_h+target_h)/2` at `:936` + the same guard in
`_inline()`, flag `TEMPLATE_INLINE_ROW_OVERLAP`, 3 pins. (C) **DESIGNS READY:** gary's shadow-row
auto-file deadlock (`unverifiable-value:subtotal` on an INVISIBLE row — sealed twice; **thread
`extraction_method` into `realdoc_regression.js`/`sweepPredicate.js` FIRST or the gate is vacuously
green**) and reggie's 5 taught-label/taught-value slices (**Slice 1 = widen `PO_REF_DIGIT_GATE` to the
REF ROLE — kills `'Your PO'`/`'Delivery'` system-wide**). (D) **OWNER-SPOTTED, high value:** the TEACH
SAMPLE doc never receives its taught values (`#736` displayed the right value, stored `'Your PO'`,
seeded Learning History with it) — the inverse of "teaching must never hurt". `delivery_number` is type
`text` with NO `validation_patterns.text`, so that field has no format gate at all; retyping it is an
OWNER DECISION. GOTCHAS: a FLAT corpus lane is not a pass — verify the guard ARMED (diff the jsonl);
`realdoc_regression.js` writes a FIXED filename (copy between arms); 4 pre-existing Python failures,
verified identical with the session's files stashed.

### Prior wrap — Current session state (2026-08-07) — date-crop premise REVERSED + SFDEV crop fix + credit-note type family + debug-table spec
**READ `HANDOVER_2026-08-07.md` FIRST. HEAD `2a9a556`; 5 commits, ALL PUSHED.** Two halves. **(A)** Built the
date-crop READ root fix but a 4-doc probe REVERSED its premise: root is NOT the deskew frame — the TIGHT
taught box CLIPS the leading glyph on BOTH frames (every angle); a padded WINDOW+psm6 recovers it.
`837b7d6` **`TEMPLATE_PAD_WINDOW_READ`** (dates only, OFF): a taught date's padded re-read flags a confident
parsed-value disagreement (never swaps; geometric neighbour guard). gary+reggie→Oracle W/COND; NF M=0 + 1
corpus true-positive. **`DATE_CROP_DESKEW_READ` design is SUPERSEDED (banner added) — do NOT build the
raw-frame election.** `63e0cb3` **SFDEV crop fix** (dev): the trace now shows the WINNING rung's crop
(`target_geom` bbox-match, badged "← read"), not the first same-stage abs crop. **(B)** Owner ran a fresh-DB
new-customer test (import→teach→review) → surfaced the credit-note-typed-Invoice class; root-caused THREE
distinct causes, all fixed DARK under ONE owner toggle (`heading_absent_reread` → 3 env flags via
`_reconcileEnv`): `66c526a`/`4026222` **rung-3** (`HEADING_ABSENT_REREAD`) — the `--dpi` pass DROPS a large
title (proven), a pixel pre-gate + band re-read recovers it; Oracle W/COND, gate type +1/0-mis-type,
owner-watch C2 (recovered type ungraduated-100 floor, watch it graduating to 95). `2a9a556` **#2**
(`HEADING_TITLE_GAP_COLLAPSE`, keyword.py) — a wide-TRACKED title `'CREDIT    NOTE'` splits at the
column-break marker → scores as a mention; fix collapses whitespace ONLY inside the matched type-phrase span
(herald); gate type +2/date +1/0-regress; **+ #3** (`REPROCESS_HEADING_GEOM`, process_docs.py) — a cached
reprocess never builds page-0 geometry so heading rungs are inert; one bounded page-0 pass when no trusted
heading. **All 4 new switches default OFF, byte-identical off; env bridges in `handler.js _reconcileEnv`.**
Harness can't bit-reproduce app OCR drops/tilt misreads → gates prove NO-REGRESSION, heals are OWNER-WATCHED.
**NEXT: BUILD the SFDEV bulk debug-table** (owner-designed queue-wide field grid → `debug_values.json` + winning-
rung slices, saved only on reprocess-with-SFDEV-open — full spec in the handover). A sandbox instance is
RUNNING with all heading flags. **`_CLEAN_DATE_CONF`=94 defeats the merge cap → the validation_note is the sole
auto-file block (trust.js:466); pin the DECISION, never `conf==88`.** Prior wrap (08-06 DAY2, HEAD `8ddbc80`,
4 taught-read flips + snap-union shelved): `HANDOVER_2026-08-06_DAY2.md`.

## Prior wrap (2026-08-05 day) — jitter-crater arc CLOSED (A/B/C/D dark, gates green); settings-bridge + owner flip
**2026-08-05 (Fable 5, autonomous). Commits `b63bd86`·`8f631b8`·`2ddd5fa`·`fafd8b4`, PUSHED. READ
`HANDOVER_2026-08-05.md` FIRST.** The 08-04 born-digital charter was OVERTURNED (Oracle UPHELD,
`docs/oracle_log.md` 2026-08-05): the crater = ABSOLUTE-RUNG CLIPPED-CLEAN-READ COMMITS (cut
taught box reads a clean partial → passes shape_mode='ignore' → commits 78-90 silently; every
shipped heal keys on page-vs-taught DISAGREEMENT so nothing fires — armed rerun byte-identical);
digital-worse = crisp partials PASS the gate, scan garble FAILS into the heal ladder; PLUS 34% of
harness taught mappings had value-as-label poisoned anchors (harness-only; wizard defended).
**BUILT DARK + GATED GREEN:** A harness label fidelity (audit 48→0 value-as-label) · B
`TEMPLATE_DATE_CLIP_GATE` (date-clip fragments rejected pre-salvage; '07-01-20' 2-digit PINNED
accepted) + UNSWITCHED parse_date year<1000 floor (live) · C `TEMPLATE_ABS_EDGE_GUARD` (word-edge
predicate on the abs rung → word-bounded GROW → edge-directional comparator → independent-WITNESS
(cut word's locate text ⊂ grown) → consent ladder → defer-cap fall-through floor; stored mapping
never mutated; names EXCLUDED — NAME_UNCLIP owns them) · D `TEMPLATE_LABEL_DIGIT_EXACT` (digit
needles can't fuzzy-lock a different value). **GATES:** clean arm ZERO T→F + 21 pure heals (ref
70.1→74.7, date 91.3→93.4) · right-jitter ref 85.7/66.1 · date 91.1/83.9 · po_ref 100/78.6 ·
job_ref 100/100 (dark: 12.5/19.6 · 3.6/26.8 · 14.3 · 0/57) · left-jitter ref 69.6/62.5 · realdoc
543 baseline==armed (silent 14==14, M_type 0). Oracle caught the DEAD WYSIWYG pin
(test_template_target_word_snap.py:108 empty slice — rebuilt behaviourally). **NEXT: handler.js
env-bridge + Settings toggles for the 3 switches → owner flip.** Owner checks pending: teach-snap
feel · docket_10 `clip_decline` · C2b copy. Residuals: left-cut DATE digital 46.4 · issuer-under-
jitter 0 by design · test_template_rescue(1) pre-existing. GOTCHAS: electron.exe never .cmd ·
never edit mapper py mid-arm · `git add -A` from ROOT stages `Backup/` · no inline `py -c` · the
edge-clean wiring pin inspects the module prefix before the first `def` — mapper kill-switch
getenv lines stay in the top flag zone, functions below.

## Prior session state (2026-08-03 NIGHT wrap) — perfect-catch arc: SIX flips live, all Oracle-gated
**2026-08-03 day+evening+overnight (Opus 4.8 → autonomous night). HEAD `1ab4606`, PUSHED. READ
`HANDOVER_2026-08-03_NIGHT.md` FIRST (owner-morning list + the night's engineering story), then
`HANDOVER_2026-08-03.md` (the morning crosscheck-outlier arc).** Owner goal locked: teach once →
perfect catch on CLEAN siblings for ALL anchored values, silently (rule: minimal customer
interaction, max auto-file — memory `feedback_minimal_interaction_autofile`).
**LIVE flips (all advisor→Oracle→gate, Settings→Processing toggles):** `crosscheck_outlier_reconcile`
(morning, `09685d9`) · `universal_verify_restore` (Slice-2 2a ref/date universal verify, `eb2834f`;
2b numeric + 2c flag DARK behind `UNIVERSAL_VERIFY_NUMERIC`/`_FLAG` pending the Customer-corpus GT
scorer — Oracle C6) · `template_code_edge_clean` (punctuation label-tail heal, `5e78a8d`, fork RULED
reggie witness-equality) · `template_target_word_snap` (Slice B — derived rungs snap the seated box
to word geometry; own gate +1 ref/+1 date heal + 5 false-flag drops, M identical) ·
`template_code_frag_clean` + `template_clip_commit` (`df80601`/`1ab4606` — the rb_531 class:
`_pick_fuller_code`'s disagreement branch stamped a FACTUALLY FALSE "manually mapped value differs"
note on a never-shape-checked clean value, + the α-variant silent dirty commit; healed via
label-suffix fragment strip + 3-leg clip commit + the PROVISIONAL consent channel — taught-doc
skeletons in a SEPARATE index, S2-isolated from every veto path, consumed only by
`_shape_consents`). `_pick_fuller_code` branch order is LOAD-BEARING (un-clip → frag → C2a → conf
race; pinned). Pins: `test_template_frag_clip.py`(29) + `test_template_target_word_snap.py`(18) +
`test_template_code_edge_clean.py`(24) + `test_universal_postmerge_verify.py`(61).
**OWNER-MORNING (pendingfeatures NIGHT entry):** RESTART app then reprocess Northgate dockets ·
C2b honest disagreement copy (owner voice) · teach-time box word-snap (UI-visible, gary-designed) ·
`_seed_field_patterns` ref_field_key threading (gated follow-up) · rehearsal-read + annealing
designs · Slice-2 2b/2c GT scorer. Chris the customer-sim rated KEEP (priority+framing impact).
**GOTCHAS:** harnesses via `node_modules/electron/dist/electron.exe` NEVER `electron.cmd`; never
edit `template_mapper.py` while a realdoc arm runs (workers import per shard); `git add -A` from
repo ROOT stages the untracked `Backup/` tree — stage explicitly; dev diagnostic logs =
`repo/Debug/diagnostic_<UTC>.jsonl` NOT userData; advisor files now carry prior-art rule + track
records — keep accruing at wraps.

### Prior session (2026-08-02 wrap) — Chris fix cycle · clamp+sweep+workflow ON · de-pathing · teach-first PLAN
**2026-08-02 (Fable 5, overnight autonomous + owner day/evening). HEAD `5652487`, PUSHED, tree
clean. READ `HANDOVER_2026-08-02_NIGHT.md` FIRST (wrap + NEXT-SESSION ORDER), then
`HANDOVER_2026-08-02_OVERNIGHT.md` (overnight/day detail). NEXT ARC (owner-set): (1)
template-system FINE-TUNING + SFDEV every-step trace (pendingfeatures entries — two live
exhibits; build the trace FIRST, it is the arc's observability), (2) teach-first plan owner
go/no-go, then S0 corpus gate (`docs/designs/TEACH_FIRST_FLOW_2026-08-02.md`).**
· **Chris fix cycle**: r1 cards SHIPPED (`29c4927`) · r2 panel-vetted fixes (`ac2d924` — dead
  Document-Actions panel = global `_btn` collision, pinned `test_no_global_collisions.js`;
  invisible empty-states `display:''` class; truthful soft-delete dialogs) · r4/r5 via the FULL
  SANDBOX (`/christest` skill; `DOCUSNAP_USERDATA` dev-only hook, CDP 9223, seeded license,
  PrintWindow capture `scripts/capture-window.ps1` — CDP screenshots hang on this build).
· **Flips (owner-ordered)**: label-tail clamp BUILT+ON (`53513cf`, `ANCHOR_LABEL_LEFT_CLAMP`;
  Oracle ACCEPT-AS-RESIDUAL on #218, amended letter "zero UNRESIDUALED flips", W1-W3 watch bars)
  · catch-up slice-4 gates GREEN + `scope_sweep_enabled` ON · workflow suite ON
  (`WORKFLOW_FEATURE_ENABLED=true`) + two-step Approve arm (`32b4c38`) + secure stamped viewer
  (route-id, party-or-admin) + doc history + audited export.
· **De-pathing**: search ROWS projected + has_file, raw shell channels admin/edit (`a58bc10`);
  Document-detail DTO BUILT (`b747676`) — `get-document-detail` = `dto.projectDocumentDetail`
  (/v1 shape verbatim), full read Review-only; pins `test_search_detail_depathed.js`.
· **Customer Doc Test corpus** on Desktop (10 unique issuers + Bramblewood owner co, 5 types,
  Digital+Scanned renditions, ground_truth.json; generator `stress_test/gen_customer_test.py`).
  The teaching run surfaced the two template exhibits that named the fine-tuning arc.
· **Teach-first PLAN signed** (barry+gary → Oracle; EXTRACTION-INERT — S4 deleted, auto-reprocess
  flagship → S1.5 consent heal; the sell: ⊕ path EXCLUSIVELY arms the ownership validation cap).
· Diag-log completeness shipped (startup context · uncaughtExceptionMonitor · ipc-handle wrap ·
  renderer-error sink cap 50) — "check log and know exactly what the problem is".
· GOTCHAS: stale-main bit AGAIN (new IPC missing in running main = eternal spinner — restart for
  main-JS commits) · PS5.1 `-replace`/Set-Content mojibakes UTF-8 (python for text surgery) ·
  `git commit -F <file>`, never `-m @'…'@` here-strings.

### Prior session (2026-08-01 NIGHT) — D1 live · live-fill fixed · catch-up slice 3 · Chris
**2026-08-01 evening (Fable 5, owner present). HEAD `8d66041`, PUSHED, tree clean. READ
`HANDOVER_2026-08-01_NIGHT.md` FIRST — it carries the NEXT-SESSION ORDER (owner-set, EXECUTED 2026-08-02): (1) vet +
implement Chris's round-1 cards (triage table in the handover, NOTHING implemented yet), (2) build
the label-tail crop CLAMP (Oracle SIGNED W/COND, build-ready — `pendingfeatures.md` "Label-tail
crop CLAMP" has C1-C7 + G1-G6 verbatim), (3) owner eyeballs the 3 GT-poison exhibits → Learning
Repair, (4) catch-up slice 4 gates → flip.**
· **D1 digit-disagreement flag ON** (`8c4ddea`, kill `DIGIT_DISAGREE_FLAG`): distinct-stage ledger
  witness differing by 1-2 digits on an identical skeleton → flag+suggestion, ref-role only, LAST
  in the pinned note chain; census 300 docs 0.00% false (`stress_test/census_digit_disagree.js`);
  comparator SHARED with banked D2 (`suffix_reconcile.digit_substitution_diff`). D2 second-render
  witness REFUTED by bake-off ×2 (5:1 false:true) — banked with revival bars. #86/#154/#285 =
  GT-POISON (pixels eyeballed twice — pages print the "wrong" values).
· **Blank-supplier live fill CURED end-to-end** (`ac96929`+`30fb97c`+`5f1bc80`): unpinned blank
  docs re-identify via the guarded JS identifier (fresh-pick-only admission, anti-recollision
  pinned); the bb-exception now cracks the anchor-abstain wall (marker widened to BOTH veto
  copies /(confirm|set) the correct company/); the stale note display-hides while the ⟳
  suggestion shows. Owner-verified live (18-doc Saltmarsh batch pill-fills; 36 auto-committed).
· **Catch-up Filing slice 3 BUILT dark** (`78d2fc5`): accept/undo IPCs + consent bar; INTERNAL
  `{via:'scope_sweep'}` 4th arg (never payload-suppliable); machine confirms skip saveCorrections;
  undo server-checks `confirmed_via`. Slice 4 gates before any flip; env `SCOPE_SWEEP=1` = trial.
· **Chris The Customer** advisor + `customer-experience-review` skill (`b357a30`) + working
  Playwright/CDP driver (launch `npm start -- --remote-debugging-port=9222`, connectOverCDP).
  Round 1: 100% citation accuracy, found a real grammar bug (renderer.js:2567 "1 field that
  were"). His suggestions NEVER change code without owner vet.
· **Label-bleed crop class root-caused** (007: label-blind +20px pad + 141px scan jitter ⇒ 13/16
  crops intrude the label tail; fate trifurcates; ws09 = near-miss wrong-value class; corpus-wide
  47 recovered rows / 4+ suppliers). Clamp fix Oracle-signed (C1 frame trap: expected-value-left
  from the LOCATED label + stored offset, never the taught box). NOT BUILT.
· GOTCHAS: stale-main-process bit thrice more (restart for main JS; window REOPEN suffices for
  renderer-only); an Edit once wrote a NUL byte into renderer.js (grep suddenly says "binary
  file" → scan for \x00, repair via python byte-surgery); `documents` has NO updated_at column.


<!-- moved from CLAUDE.md LATEST on 2026-08-22 evening (verbatim) -->
## ⏭ LATEST — 2026-08-22 OVERNIGHT: **READ `HANDOVER_2026-08-22.md` FIRST** (the "teach 1 → import N
→ it files itself" arc), then `HANDOVER_2026-08-20_EVENING.md`, `_2026-08-20.md`, `_2026-08-19.md`.
**Built DARK, mig 79 seeds all five switches OFF** (each is its own revert): `scope_sweep_auto_accept`
(Slice 1, scope-local auto-accept of the post-confirm sweep + receipt/Put back) · `letterhead_fragment_abstain`
(Slice 0: no more "Cleaning"/"Security" as a company; census 34 abstained all wrong, 0 correct lost) ·
`quiet_reread_enabled` (Slice 3: `quietLane.js` — after a TAUGHT confirm or a graduation MINT the sender's
template-less held docs are re-read on a below-normal lane, invisible to `_anyProcessingBusy`, killed at
every foreground door, merge-gated via `applyReprocessResult(opts.expect)`) · `role_field_dominant_class`
(a ROLE field judged by its dominant shape when one confirmed outlier collapsed the strict class — the
Veltrix `VX$22033` brick) · plus the shipped `scope_sweep_enabled`. **Slice 2 (Tier-1.5 recompute) is
DEAD by measurement** (`TESTING/_measure/s2_histogram.js`: 0/22, 0/378, ceiling 0.5%). Chris rounds 13/13b in
`docs/CHRIS_FULL_APP_REVIEW_2026-08-22.md`. Traps: `applyReprocessResult` returns the result object on
success and `{dropped}` only with `opts.expect`; `_stageReprocessDocs`/`_runReprocessShard` are the ONE
staging+spawn for foreground + lane (thread-cap identity lives there); `getById` is `SELECT *` (no
`type_slug`); a 5th confirm via File-All graduates without minting a template (`onScopeGraduated` is
non-bulk only — NEXT fix). The 08-20 block below is historical.
**Chris ROUND 10 ran (all nine switches ON): the class fix WORKS end to end** — 15 typed
corrections down to an honest 4; 410 docs, 356 filed, ZERO wrong folder/value; one correction fixed
six siblings, Undo put all six back, the `P1L/` control was refused; first round Chris says yes
with no "but". 3 of 7 new cards fixed same night (`815631c`: Approve's SILENT 8s two-step revert —
reported four rounds; sweep offer now "File up to N"; the class-fix reprocess guard kept a stale
note against the discarded read — note now follows the value). **OPEN cards: #3 "Company inferred"
note held 52/90 remaining docs (cost 39 wave-2 auto-files — the biggest UX lever); #2 "never seen
this sender" on the 40th doc (cause UNVERIFIED); #4 £-less money freeze; #7 notice stack/counters.**
Card 6b is NOT a bug: Gate C truthfully flags an OCR misread of a correct value; the rescue leg
declined because dominance is STARVED on a fresh install — the starvation's customer face.
HEAD `815631c`, ALL PUSHED. Mig 75 (`learning_exclude_rewrite_markers`, DARK) shipped + both
censuses green (zero de-graduations both DBs — flip precondition MET, owner decision pending).
**Two things a new session must not re-derive:**
1. **THE MACHINE-CONFIRM STARVATION (measured).** `learning_exclude_machine_confirms` removes every
   `auto_threshold`/`scope_sweep`/`auto_graduated` confirm from the substrate `getFieldFormats`
   COUNTS. Round-9 DB: Pelican `invoice_number` has **27 confirmed `PI/` values but the learned
   corpus counts 4**; whole install **38 human vs 331 machine = 89.7% invisible**. So the dominance
   bars (≥5 extractable prefixes, ≥5 dominant, ≥0.90 share) licensing the P adopt lane, the
   dominant-value snap and the prefix guard **cannot arm on a scope the app files well** — the better
   the auto-filing, the blinder the reading. **RULED (Oracle SPLIT, 08-20): slice 0 SHIPPED** (mig 75
   `learning_exclude_rewrite_markers` DARK — a value a REWRITE created may not be evidence for that
   rewrite; classFixService now unions machine history REFUSAL-ONLY, unconditional); **slice 1
   (un-starving the readers) SENT BACK — NOT built**, its killing pin is in the repo. The invariant:
   refusal tests may see all evidence; licensing tests human-attested only; neither may see
   rewrite-created rows; split the input, never amplify a shared index.
   **Always measure what learning KNOWS through `getFieldFormats`, never off raw `extractions`** (it
   also drops any group with <3 contributing documents — a count of 0 can mean "no group").
2. **The P1/PI class correction shipped DARK** (`ref_class_fix_enabled`, migration 74, +
   `REF_PREFIX_CONFUSABLE_ADOPT` widened): correct one reference by a single confusable glyph inside
   its code prefix and the sender's other QUEUED documents follow, reported after with an Undo.
   Traps recorded in `memory/project_ref_class_fix_20260819.md` — `corrected_to` is a TRAP as a badge
   carrier (trust.js counts it as flagged behind a user-visible toggle); `updateExtractionValue`
   never rewrites `extraction_method`; `mergeReprocessRows` (`handler.js:975`) takes the fresh row
   wholesale and silently reverts propagated values.

## ARCHIVED 2026-08-23 — the CLAUDE.md '(previous) 2026-08-22 EVENING' block, verbatim

## (previous) 2026-08-22 EVENING: **READ `HANDOVER_2026-08-22_EVENING.md`** (state, the shipped
table, the owner vet queue, traps, how to resume), then `HANDOVER_2026-08-22.md` (the overnight arc, the
afternoon wordmark slice, rounds 13/13b/14), then `HANDOVER_2026-08-20_EVENING.md`. Chris rounds 13/13b/14/15(/16) verbatim in
`docs/CHRIS_FULL_APP_REVIEW_2026-08-22.md`; every Oracle verdict + gate in `docs/oracle_log.md`.
**Chris 15 (the owner's 22 real scans + Demo Docs): YES — 57 filed, zero wrong folder/value, "nothing went
missing and nothing needed a trick".** What shipped today (each behind its own switch; mig 79–84):
- **Mig 83 `keep_processed_originals` ON for EVERY install** — filing no longer unlinks the Processed
  original (`documents.drained_at` + backfill; THE ONE gate in `reviewService.confirm`; un-drained → drained
  at confirm, never unlinked); `process-folder` refuses a folder holding filed originals with "Import it
  anyway?"; the purge dialogs say what is NOT deleted. The owner's run-1 "lost scans" were this mechanism
  — nothing was lost (all 11 in Output; Windows CopyFile keeps the scan's mtime, so `find -newer` misses them).
- **`shared/reviewReadiness.js` = THE review-queue classifier** (Home's "N ready" == File All's N);
  Home headline "N senders file by themselves" = `scopeReadiness.isReady`. `shared/offerPrune.js` retires
  stale offer bars. The badge refreshes on any broadcast (a send-back counts nowhere — stale render).
- **Type nudge**: the issuer READ is never offered as a type (`TYPE_NUDGE_ISSUER_EXCLUDE`, garble-tolerant);
  line 0 is admissible with a known issuer (`TYPE_NUDGE_L0`, census +16 correct / 0 new wrong). Residual:
  junk-caps scraps ("Poo"/"Ment"/"Print") still offered — Chris 15 card 3.
- **Q2 ROOT CAUSE of "the teach does nothing" (measured):** a template born from ONE scan freezes that
  scan's fingerprint; three OCR-garble tokens capped every sibling at EXACTLY 0.70 < 0.75. Fix = the
  one-sample SEED SUPPORT PRUNE at birth (`templates.pruneSeedFingerprint`: df=0 tokens dropped; G1
  issuer-protect; G2 reward licence ≥2 recovered same-LAYOUT held docs — the same-layout leg is what stops
  a buyer-issued seed being licensed by other suppliers' pages; floor; all-or-nothing half-cap); both birth
  paths; `fingerprint_seed_support_prune` / `FINGERPRINT_SEED_SUPPORT`; **mig 84 ON for new installs**.
  Chris 15: teach from the worst scan → `kept 7 recovered 20` → the teach-time re-read did 19/19 (round 14: 0).
- **Q3 the LAYOUT arm (DARK, `quiet_reread_on_layout`)**: an authoritative anchor / mapping WRITE re-reads
  the scope's template-carrying held siblings (the manual "Reprocess N" population, press removed) — only
  with `template_identity_on_page` ON and a judgeable scope name (≥2 name-arm tokens; JS mirror pinned to
  the Python generic set); a first-filled REQUIRED role field is HELD "Read from your new box — confirm
  once." unless page-corroborated; valued→empty merges as empty. Chris 16 = its own round.
- **Chris 15 card 2 FIXED (`8c0f26b`)**: `learnTemplateOnCommit` intersected the DB fingerprint but the
  Python matcher reads the template FILE — both callers now rewrite it (`TEMPLATE_FILE_SYNC_ON_COMMIT=0`).
  **TRAP FOUND:** in dev, `templatesDir` was the repo `templates/` folder shared by the owner's app and every
  sandbox — fixed for `DOCUSNAP_USERDATA` sandboxes; rounds ≤15 carry a contamination caveat.
**OPEN (owner/Oracle vet):** Chris 15 card 1 — once Q2 makes the teach-time re-read work, siblings bind
BEFORE any confirm at overall 91–93 under the ungraduated floor 100 and the 'ready' arm (template-less only)
never re-reads them → "✓ files by itself" over a pile that waits for File All. Direction: a READY-crossing
re-read of TEMPLATE-CARRYING docs with oc < floor (the Q3 boundary, same guards). Also: the junk-caps type
nudge; the young-scope "differs from the usual format" false alarms; the offer bar that auto-accepts 1.5 s
later; the DONE card's count. **Traps:** `PYTHONIOENCODING=utf-8` for script-style Python tests (cp1252 `→`
= a false exit 1); `src/modules/templates/` is gitignored by the `templates/` line — `git add -f`; the repo
root is `C:\GIT Projects` (worktrees land at `<path>/Docusnap/`); bash heredocs strip a backslash level —
write patch scripts with the Write tool. The 08-20 machine-confirm starvation + P1/PI class-fix notes
live in `HANDOVER_2026-08-20_EVENING.md` + `memory/project_*_20260819.md`.


## (archived from CLAUDE.md on 2026-08-27) 2026-08-26 NIGHT (identifier-registry arc + Chris R5 cards + switch inventory/flip): HANDOVER_2026-08-26_NIGHT.md
Branch feat/teach-side-overnight, HEAD f2349f9, commits LOCAL/NOT pushed. THE FRESH SESSION IS TO BUILD THREE FEATURES: (1) CLASS F — one general "corroboration clears a verification-doubt note" rule (gary-AUDITED, NOT built; edge-cut 31901 exhibit; the rule must LIFT the field to 90 not just pop the note; allowlist + >=2-distinct-family + shape-pass + deny-by-default seam; pendingfeatures.md:51); (2) LANDMARK BOX SNAP — BUILT, UNCOMMITTED in settings/renderer.js addLandmarkFromRect — add a pin + commit; (3) TARGETED FIELD RE-SLICE after a teach — DESIGN-STAGE (needs advisor+Oracle). Shipped: Chris R5 cards 1-6 (position_teach_nudge + issuer_suggest_on_blank_confirm DEFAULT-ON via mig 89), row-badge->classify(), quiet-lane 2 workers, the supplier hard-identifier registry slices 1a+1b DARK (identifier_registry — Oracle SIGN-OFF-W/COND, do NOT flip until a REAL-customer-VAT corpus + M=0 + Oracle ratify). Switch inventory: only 6 DARK remain. d811cce=features, f2349f9=mig 89.

---
# Archived from CLAUDE.md at the 2026-08-30 NIGHT wrap (verbatim)
## (previous) 2026-08-30 DAY: **READ `HANDOVER_2026-08-30.md`.** Branch `feat/teach-side-overnight`, **HEAD `0ff8b42`,
NOT pushed** (owner reviews then pushes). Uncommitted: only `CLAUDE.md`. **Dev app RUNNING** (I relaunched `npm start` on the
real DB). **NEXT SESSION'S JOB = the CORROBORATION RE-SLICE ARC** (owner APPROVED) â€” read
`docs/designs/CORROB_RESLICE_SWEEP_2026-08-30.md`: **fix #1** discount a format-INVALID corroboration witness (small â€” clears
the Nordwind-0023 total flag, since keyword already read `2,363.76` + it reconciles), then **fix #2** the owner's capped
corroboration-gated **re-slice sweep** for total/ref/date (higher-DPI zone RE-RENDER + PSM/binarise/Â£-strip/straighten ladder,
STOP on corroboration, adopt only then, â‰¤~4-6 tries, review-bound). oscar/reggie/007 â†’ Oracle â†’ DARK switch â†’ OFF/ON census.
**SHIPPED this session (all NOT pushed):** (1) **deskew re-read PIVOTED + shipped `4607cc6`** (DARK `DESKEW_REVIEW_RETRY` /
setting `deskew_review_retry_enabled`, floor 0.3Â°): a 200-DPI census FALSIFIED the field-scoped slice arm (fired 0Ã— â€” the
garbled names read 88-96%, never *withheld*) so it was REMOVED (`ocr/deskew_reread.py` + its pin gone, `engine.py` back to
single-pass); replaced by a **review-bound whole-page straighten retry** in `process_docs.py` (after `engine.extract`, only on
a doc already `_needs_review` + page skew â‰¥ floor, re-OCR straightened, adopt WHOLE only if `_overall_confidence` strictly
higher, forced `needs_review` â€” never auto-files a straightened read, can't demote a clean auto-file). Gate: **5/20 Nordwind
identities healed, 0 regressions**; pin `test_deskew_review_retry.py` 13/13; withhold path unchanged. (2) **Settings toggle
`8333023`** (standard visible Processing row) + `deskew_review_retry_enabled` set TRUE on the live DB for testing â€” **RESTART to
see the toggle**; behaviour already active (handler reads the setting live at spawn). (3) **Live-DB switch audit:** all **148**
mig-93 "should be on" switches already ON, `dev_switches_unlocked` already true (dev switches visible in Processing) â€” nothing
to flip. **CORRECTED stale claim:** the mid-session "every Nordwind ref/date is empty (template gap)" was a SANDBOX artifact
(`scratchpad/live_e44gate.db` lacks the owner's live learning) â€” on the live app they fill; NOT a defect. **Traps:** the
`!= '0'` switch idiom reads an EMPTY string as ON (a switch-A/B OFF arm must be explicit `'0'`); harness must set
`OCR_RENDER_DPI=200` (product DPI; harness defaults 300); `git commit -F <file>` ONLY. **The Electron 44 upgrade (PR #12) is
DONE + VM-confirmed** â€” no longer the pending job. Prior:

---
# Archived from CLAUDE.md at the 2026-09-01 EVENING compaction (verbatim) — the '(previous)' session-state blocks 2026-09-01 DAY → 2026-08-15, newest first

## (previous) 2026-09-01 (rollout hardening + M=7 resolved): **READ `HANDOVER_2026-09-01.md` FIRST**, then
`HANDOVER_2026-08-31_NIGHT2.md`. Branch `feat/teach-side-overnight`, **HEAD = origin = `3690e39` — ALL PUSHED**, tree
clean; nothing running. Installer `dist\ScanFinder Setup 2.0.0-r20260901-0830-11c1598.exe` (signed; owner testing for a
customer rollout). **NIGHT2 + 09-01 span:** (1) **DESKEW_CORROB_AUTOFILE arc BUILT DARK** (`aa61350`, Oracle C1-C7): a
straighten-CHANGED field auto-files (skips its "confirm once" hold) ONLY as a VERIFIED corroborated rescue — ≥2
independent page families incl. a KEYWORD witness agree (`_corrob_licensed_keyword`), matches its learned skeleton
(engine `_shape_ok`), AND the raw `was` was not credible (empty/skeleton-False — Oracle C4: the straightened corrob
record is BLIND to the raw pass). Option A = Python skip in `_deskew_retry_apply_holds`, `isAutoFileEligible`
untouched; nested under `corroboration_autofile`. Pin `test_deskew_corrob_autofile.py` 12, import smoke 14/14, OFF
byte-identical. **DO NOT FLIP** — owner-machine census from the COLD import state (the retry fires only in the warming
phase; a reprocess of now-warm docs reads clean). SFDEV toggle `deskew-corrob-autofile-toggle`. Design
`docs/designs/DESKEW_CORROB_AUTOFILE_2026-08-31.md`. (2) **BATCH-IMPORT CRASH FIX** (`40ef134`, eric+oscar+Oracle):
RAM-aware worker cap + `runWorker` spawn-failure resilience (silent crash = unhandled `error` on the only spawn with
no handler); pin `test_import_concurrency_cap.js` + smoke `TESTING/_measure/import_crash_smoke.js`. (3) **Quick-check
dropdown focus fix** (`b95ccf5`, E44 native-select — `_baOpen` now arms the proven focus edge). (4) **minimise/docked
windows stop popping back** (`cb29ffb` — the 12s createWindow backstop force-showed on `!isVisible()`, which a
minimised/docked window also reports; guarded on `_revealed`+`!isMinimized()`). (5) **`deskew_review_retry_enabled`
default-ON for fresh installs** (mig 101, `ae6d20f`). (6) **TOGGLE AUDIT** (`11c1598`): fresh-install config = the
owner's validated production set (customer ON · DARK arcs OFF+gated · dev/telemetry/diag locked · onboarding on); gated
25 technical reading-internal toggles behind SFDEV (shipped ON but were customer-visible). (7) **M=7 DATE CLASS = a
MEASUREMENT ARTIFACT, not a bug:** 007 rendered + main verified — the app reads the dates CORRECTLY; #1453/#1649/#364
were POISONED GT (now corrected in `Desktop\ScanFinder Test Corpus\ground_truth.json` + a `.poisoned-bak`). Oracle: DO
NOTHING on code (reggie's page-witness guard = the WRONG-LAYER twin of Gate A `FILING_SANITY_PAGE_MATCH_V2`, which
false-flagged ~7× in Chris r7). `trust_role_disagreement_refuse` (#1423's disagreement class) is ALREADY default-ON
(mig 93, not "DARK"). **Traps:** never name-kill electron (the packaged app runs alongside; electron≠ScanFinder); a dev
`npm start` locks repo node_modules → EBUSY the native rebuild (close it first); `git commit -F` only (backticks in
`-m` shell-substitute). Prior:
## (previous) 2026-08-31 (DB-encryption integration pass): **READ `HANDOVER_2026-08-31_NIGHT.md` FIRST.** Branch
`feat/teach-side-overnight`, **HEAD `2aaf6a3` (code `19432cb` + docs `2aaf6a3`), origin at `c183792` — 5 commits UNPUSHED** (owner pushes).
**THE DB-ENCRYPTION INTEGRATION PASS IS BUILT (`19432cb`, DARK/inert — plaintext boot byte-identical; do NOT
rebuild).** eric-lifecycle-reviewed + Oracle SIGN-OFF-W/COND (a DISJOINT `.db-migrate-code` arm keeping the
downgrade tripwire byte-identical). BUILT: the `main.js` whenReady boot gate (5 actions:
plaintext/open-cached/prompt-code/tripwire/migrate) before the first `getDb()`; the Unlock/Recover window
(`src/windows/unlock/`, closes via `app.exit(0)` — the pre-key boot has no tray/before-quit and `getDb()`
throws on the unkeyed DB); the tripwire (`showErrorBox`+`app.exit(1)`, never opens plaintext); the
sender-scoped `unlock-recover` IPC (read-write verify); the **opt-in Settings→Advanced ceremony** (mint →
masked code Show/Copy/Print → typed "I HAVE SAVED IT" → arm → relaunch); `dbKey.mintCode`/`armMigration`/
`loadMigrateCode`/`clearMigrateCode`; `dbStartup` migrate row + C1 self-heal; `dbBootMigrate.js` (fail-toward-
plaintext, pinned). Pins green under E44: `test_db_startup` 6→11, `test_db_boot_migrate` 18. **REMAINING =
OWNER-machine only:** the migration DRILL (`db.backup()` first → click "Turn on encryption" → confirm →
relaunch → silent open; delete `.db-key` → Unlock by code), the DPAPI-loss + DOWNGRADE drills (restore
`.pre-encrypt` → must LOUD-tripwire), packaged-boot + gate-5b on E44, perf<10% + verifyAuditChain//v1,
realdoc-605 OFF byte-identical. **DEFAULT-ON = DEFERRED (owner); opt-in only. The first "Turn on encryption"
click IS the drill — it encrypts the live DB (crash-safe).** Prior NIGHT (crypto core):
**Dev app RUNNING on ELECTRON 44** (live PLAINTEXT DB, mig 100). All three EVENING build-specs got built +
Electron 44 merged + DB encryption pivoted, in one session: **(1)** `TEMPLATE_LOCATE_ROLE_QUALIFIER`
(`e65959c`, DARK mig 99, the Net-Total locate steal — demote role-qualified 'total' in `_locate_anchor` +
the born-digital twin; `test_locate_role_qualifier.py`) · **(2)** `TEMPLATE_FRAGMENT_CONTAINMENT_YIELD`
(`2bf7609`, DARK mig 100, CAD8⊂CAD832694 — a Stage-1 sibling leg adopts a keyword read that strictly
prefix-contains a taught fragment, ref-family/never-money, cap 88 + neutral note; `test_fragment_
containment_yield.py`) — **both DARK/OFF, flip gates (realdoc-605) queued.** · **(3) ELECTRON 31.7.7 → 44
MERGED** (`0ed6f20` from `chore/electron-44`; **Node 24**, better-sqlite3-multiple-ciphers **^13**, argon2
0.45.1, Rung-A/B fuses) — re-gated (crypto suites + real-DB read) + PUSHED; **owner still owes** a packaged
boot + gate-5b on the MERGED tree; `client/`+`cert-tool/` need `npm install` if built. · **(4) DB-AT-REST
ENCRYPTION — pivoted to CODE-AS-PASSPHRASE, crypto core COMPLETE + pinned** (`684de90`+`a683975`): the
printed 125-bit RECOVERY CODE *is* the key (multiple-ciphers passphrase mode, `cipher=chacha20`, pinned
`kdf_iter`, salt-in-DB-header) so **a lone `docusnap.db` copy + the code opens on any PC** (the owner's
requirement, pinned twice). `.db-key` = a no-prompt DPAPI cache of the code only; `.db-recovery`/argon2
GONE. Files: `dbKey.js` (the `applyKey`/`applyRekey` pragma choke point) · `dbMigrateEncrypt.js`
(crash-safe, rekey in DELETE mode) · `dbStartup.js` (the decision table, Oracle C4) · seam
(`setEncryptionKey(code)`+`temp_store=MEMORY`) · `db-crypto-tool.js`. Pins all green under E44 (dbKey 16 ·
cipher 10 · migration 18 · startup 6 · secretStore 14). `src/database.js` DELETED. **Oracle SIGN-OFF-W/COND
(10 conditions) at the foot of `docs/oracle_log.md`; full spec `docs/designs/DB_ENCRYPTION_ARC_2026-08-31.md`.**
**REMAINING = the INTEGRATION pass** (do NOT rebuild the crypto core): the whenReady unwrap gate + the
Unlock/Recover window + the combined "Keep these safe" dialog (Show/defer/reinforce, admin+DB codes) +
slice-3 tripwire/default-on + the OWNER migration drill. **Owner decisions logged:** regenerate-code =
DEFERRED (it's a full re-encrypt); email-the-code OUT; SMTP for non-secret workflow notifications = a
future barry feature. **DB encryption is INERT** (no key set → plaintext, byte-identical). Prior EVENING:
**(previous) 2026-08-31 EVENING: `HANDOVER_2026-08-31_EVENING.md`** (the three build specs — now built). **THE DAY:** the adversarial night run (Hard Set 400 PDFs, 0 wrong
would-files, Chris YES) → teach-first practice run + 20-page User Guide (Chris r2 YES ×2) → **ALL THREE Hard
Set cards BUILT+Oracle-cycled+GATED+FLIPPED live, then mig 98 (`0ddd268`) force-defaults the six gated
switches ON everywhere** (never strict-money) → live import demo 20/20 fills + clean purge → **Terms FINAL**
(`127ec74`, LEGAL_VERSION 2026-08-31) → installer `dist\ScanFinder Setup 2.0.0-r20260831-1247-0ddd268.exe`
(owner testing on machine 2) → **three afternoon designs, all Oracle S-O-W/COND, NOTHING BUILT — the next
session's job on the owner's pick:** (1) `TEMPLATE_LOCATE_ROLE_QUALIFIER` (Net-Total locate steal — demote
role-qualified 'Total' occurrences via keyword's `_total_role_collision` vocab INSIDE `_locate_anchor` + a
page-wide leg; carriers-override + born-digital-twin gaps conditioned); (2) `TEMPLATE_FRAGMENT_CONTAINMENT_
YIELD` (CAD8⊂CAD832694 — a merge leg adopting a ≥85 format-valid keyword read that strictly prefix-contains
a shapewarn'd mapping fragment; ref-family only, NEVER money, always noted; the sanctioned successor to the
08-09 Q2 rejection); (3) **DB-at-rest encryption** (mc-fork alias + DPAPI `.db-key` + printed Recovery Key,
hexrekey-on-copy migration, slices 0-3; four seam ship-blockers conditioned incl. secretStore's fail-open
write). Verdicts+conditions = the three 08-31 entries at the foot of `docs/oracle_log.md`. **Traps refreshed:**
builds need EVERY electron closed (EBUSY); NEVER taskkill by cmdline substring (self-match killed the owner's
app — recovered); Start-Transcript beats Start-Process redirects for detached runners; `@N%` trace badges =
page-Y not confidence; APPDATA can be empty in electron-as-node children. Prior:
## (previous) 2026-08-31 NIGHT (the adversarial-corpus night run): **READ `HANDOVER_2026-08-31_MORNING.md` FIRST.**
Branch `feat/teach-side-overnight`, night commits `1e1461f` (gen) · `1cbaad3` (scorer) · `1590d03` (scorer fixes +
score report) · `363dd26` (class cards) · `6ba8782` (Chris) · wrap, **NOT pushed** (owner reviews then pushes).
**PIPELINE UNTOUCHED — no switch flipped, no live-DB/app/Desktop write; everything ran on a `db.backup()` copy.**
Built + scored the **Hard Set** (`Desktop\Hard Set\`, 10 classes × 20 × digital+scan, 7 synthetic issuers,
`stress_test/gen_hard_set.py` + `score_hard_set.js`): **600 doc-arm scores, wrong+would-file = 0 everywhere** —
every wrong read flagged or EMPTY-held (`below-floor` honest). Chris (fresh sandbox 9223, 60 docs): 0 cold
auto-files, File All truthfully 0, **teach-heals-boxed-cells CONFIRMED** (one Thornfield lesson → 8 sibling dates,
3 paper styles, 0 bleed), verdict YES — `docs/CHRIS_FULL_APP_REVIEW_2026-08-31.md`. Three DARK card designs await
the owner's pick (`docs/designs/HARD_SET_CLASS_CARDS_2026-08-31.md`): **oscar** — boxed label-above-value cells:
Stage-1's right-leg steals the NEIGHBOUR cell's caption (keyword.py:2062-2139), below leg unreached + column-blind;
cell-below arm, cap 85; **`ref_role_digit_gate` is the ONLY guard against cold-committing "Date" as ref @95**;
**reggie** — credit-sign: `£-x` heals (MONEY_SIGN_CAPTURE) but `-£x`/parens/trail/`CR` die at keyword
`_clean_value` (all flagged; arm 2 dead on keyword reads — `raw_value` never set); **gary** — the 7 warm
buyer_issued_po "silent-wrong" reads are the **07-12 doctrine working** (issuer = letterhead buyer; GT flaw —
dual-accept), real residual = warm silence licensed by ANY maturity (convention-licensed-silence design). GT flaws
to fix before re-use: thermal invoice→receipt, buyer dual-accept, component signs. Scorer traps pinned in
`docs/HARD_SET_REPORT_2026-08-31.md` (synthetic doc id must be TRUTHY or the would-file lane dies silently;
EMPTY≠SILENT). NIGHT_RUN.md ledger updated (TONIGHT cleared, 5 DONE entries, 5 new queue items — top: GT fixes,
"ready" language war, heading-words-in-ref presentation). Sandbox LEFT RUNNING 9223 (PID 36960). **NEEDS OWNER
(morning): pick which card(s) to build (my ranking oscar → reggie → gary); vet Chris cards 1+2; Receipt preset
decision; then push.** **DAY-2 (owner asked, then slept): practice run reworked TEACH-FIRST** (`3e47cd4` + r2
fixes — teach sim of the real 3 Invoice details → import → Review-as-CORRECTION type-over; tour cards 4/5/6
reframed) **+ the full 20-page USER GUIDE rebuild** (`2a9b4d7` — 5 new pages where-things-go/export/approvals/
learning/admin, 5 old-voice rewrites, manifest re-pointed, `check:help` fully green 153 keys, `test_help_nav`
ALL PASS) — **Chris round 2 on sandbox2 (PID 33988, LEFT RUNNING): BOTH VERDICTS YES**, his 4 build-defect
cards fixed same night (Esc soft-lock, done-row dupe, 3-detail parity, teach-intro label copy), help-mode
one-shot = owner choice in pendingfeatures; teach/index.html intro now says value-only-label-found-for-you.
RESTART the live app to load tutorial/tour/help. **DAY-2 LATE MORNING: ALL THREE CARDS BUILT DARK +
ORACLE-CYCLED + GATED** (`docs/designs/DARK_ARCS_GATES_2026-08-31.md` = the evidence dossier; verdicts in
`docs/oracle_log.md`): `keyword_cell_below` (`ece65b1`+`829afed`, SEND BACK→C1-C6; Hard Set boxed ref/date
0-15→85-100%, realdoc-605 byte-identical) · `money_sign_parens`/`money_sign_cr` (`9dd5139`+`e0fe39d`,
S-O-W/COND; C1 = either capture FORCES CREDIT_SIGN_COHERENCE in `_reconcileEnv`, pinned
`test_money_sign_coupling.js`; credit totals 24→65%, realdoc byte-identical) · `buyer_issued_convention_note`
(`5d1dd84`+`f72eee5`, S-O-W/COND; 'logo' in the tuple; stripped-warm 7/7 noted, live unchanged, 0 unlicensed
live POs). Migs 95-96-97 seed all OFF; dev-gated rows in DEV_SWITCH_IDS. **TERMS FINAL (`127ec74`)**:
LEGAL_VERSION 2026-08-31, draft banner gone, product-fit additions (device release, MoR refunds, min-version
updates, third-party notices, docs-stay-yours, General/assignment). **Installer built:** `dist\ScanFinder Setup
2.0.0-r20260831-0918-127ec74.exe` (owner testing on a second machine). Traps refreshed: the build needs EVERY
electron closed (better-sqlite3 EBUSY on the ABI rebuild), and NEVER kill processes matched by command-line
substring (the query matches your own shell — it took the owner's app down; relaunched, nothing lost). Prior:
## (previous) 2026-08-30 NIGHT: **READ `HANDOVER_2026-08-30_NIGHT.md` FIRST.** Branch `feat/teach-side-overnight`,
**HEAD `91ca11b`** (two commits after `0ff8b42`: `fccaf55` Python arc, `91ca11b` settings/JS/docs), **NOT pushed**
(owner reviews then pushes). Uncommitted: `CLAUDE.md` only. **THE RE-SLICE ARC IS BUILT, DARK, ORACLE-SIGNED (C1-C14 applied) — but its two premises were FALSIFIED
by measurement first:** the product ladder reads Nordwind 0023's taught total box as **`29,242.76` @90 (a format-VALID
garble)**, not `£9 32632.76`; and **DPI is not the lever — vertical headroom is** (pad 0 fails at 200-600 DPI; a padded
PSM-7 re-read DEGRADES clean zones; **R8 = pad 0.5×h, no upscale, 20 px white border, PSM 6 + in-band line pick = 20/20
incl. 0023 @92**). So the sweep became a **WITNESS-PRODUCER**: `reslice_witness_sweep` (engine stage 4.7, TOTALS only)
re-reads the taught zone on a noted, penny-reconciled total and injects an AGREEING read as a `mapping`-family ledger
candidate so the signed `_demote_recon_total_corroborated_note` can release the note; commits nothing; not review-bound
(Oracle). Also DARK: `corrob_discount_invalid_witness` (currency-only record hygiene; JS role refusal scans
`disagree ∪ discounted`), `template_format_fail_yield_strict_money` (**never flip in this arc** — it pre-empts the
sweep's release path, C10/C11). **Deskew retry dead guard FIXED:** `raw2["_needs_review"]=True` held nothing (`autofile_
gate_unify` is ON on every mig-93 install) → per-field "Read differently after straightening — was X, now Y — confirm
once." (+ emptied fields, + `corrected_to`); and the retry NEVER fires on a note-only hold (keys on engine
`_needs_review`) — its 5/20 heals were a sandbox artefact (empty ref/date). **Gate MET:** Nordwind OFF vs pre-edit baseline
0/20 diffs; ON = 0023 released, 19 byte-identical; **full realdoc four-arm A/B (off/sweep/discount/all) on ONE PAPER PER
DOCUMENT × 605 (the owner: "most docs are dupes" — 1,940 files = 618 byte-distinct = 605 papers; `RR_IDS` from
`_dedup_ids.py`) at 200 DPI with the app env: accuracy + fill identical on every field, M = 7 UNCHANGED (baseline wrong
would-files — the leading-digit date class + two poisoned GT rows), would-file 570 → 571 (#1840 = 0023), 1 fire, 0 wrong
releases; discount arm byte-identical (inert on today's reader).** Full Python + JS suites: every red (9 + 20)
reproduces on `0ff8b42`. **Flip order: sweep → discount → never strict-money.** **OWNER CONVENTION (08-30): repo `NIGHT_RUN.md` = the
overnight test/check QUEUE + DONE ledger — add anything worth testing/checking as you notice it; at the end of every
night run move the work to DONE with its result + "repeat only if"; never repeat DONE work unless that condition
holds. "Going to bed" = start the newest `docs/designs/NIGHT_RUN_*.md` at once.** **⏭ NEXT SESSION'S JOB (owner-queued,
prompt written): the ADVERSARIAL TEST CORPUS night run — paste `docs/designs/NIGHT_RUN_2026-08-31_ADVERSARIAL_CORPUS.md`
(build `stress_test/gen_hard_set.py` — 10 classes × digital + scan renditions — score cold/warm with
`score_hard_set.js`, advisor class cards, `/christest` on the scan set, handover; NO pipeline fixes unless DARK +
Oracle + realdoc-605 gated).** RESTART
for mig 94 + the three dev-gated Processing rows. Pre-existing red: `test_settings_wiring.js` stamp-* ids. Traps: the
`!= '0'` idiom (harness OFF arm = explicit `'0'`); `money_strict_shape` accepts a rejoinable space-split (`£9 242 76`)
by contract; `git show HEAD:Docusnap/<path>`; `buildTrainingArgs(db, () => cfg).args`. Prior:
## (previous) 2026-08-30 DAY: **READ `HANDOVER_2026-08-30.md`.** Branch `feat/teach-side-overnight`, **HEAD `0ff8b42`,
NOT pushed** (owner reviews then pushes). Uncommitted: only `CLAUDE.md`. **Dev app RUNNING** (I relaunched `npm start` on the
real DB). **NEXT SESSION'S JOB = the CORROBORATION RE-SLICE ARC** (owner APPROVED) — read
`docs/designs/CORROB_RESLICE_SWEEP_2026-08-30.md`: **fix #1** discount a format-INVALID corroboration witness (small — clears
the Nordwind-0023 total flag, since keyword already read `2,363.76` + it reconciles), then **fix #2** the owner's capped
corroboration-gated **re-slice sweep** for total/ref/date (higher-DPI zone RE-RENDER + PSM/binarise/£-strip/straighten ladder,
STOP on corroboration, adopt only then, ≤~4-6 tries, review-bound). oscar/reggie/007 → Oracle → DARK switch → OFF/ON census.
**SHIPPED this session (all NOT pushed):** (1) **deskew re-read PIVOTED + shipped `4607cc6`** (DARK `DESKEW_REVIEW_RETRY` /
setting `deskew_review_retry_enabled`, floor 0.3°): a 200-DPI census FALSIFIED the field-scoped slice arm (fired 0× — the
garbled names read 88-96%, never *withheld*) so it was REMOVED (`ocr/deskew_reread.py` + its pin gone, `engine.py` back to
single-pass); replaced by a **review-bound whole-page straighten retry** in `process_docs.py` (after `engine.extract`, only on
a doc already `_needs_review` + page skew ≥ floor, re-OCR straightened, adopt WHOLE only if `_overall_confidence` strictly
higher, forced `needs_review` — never auto-files a straightened read, can't demote a clean auto-file). Gate: **5/20 Nordwind
identities healed, 0 regressions**; pin `test_deskew_review_retry.py` 13/13; withhold path unchanged. (2) **Settings toggle
`8333023`** (standard visible Processing row) + `deskew_review_retry_enabled` set TRUE on the live DB for testing — **RESTART to
see the toggle**; behaviour already active (handler reads the setting live at spawn). (3) **Live-DB switch audit:** all **148**
mig-93 "should be on" switches already ON, `dev_switches_unlocked` already true (dev switches visible in Processing) — nothing
to flip. **CORRECTED stale claim:** the mid-session "every Nordwind ref/date is empty (template gap)" was a SANDBOX artifact
(`scratchpad/live_e44gate.db` lacks the owner's live learning) — on the live app they fill; NOT a defect. **Traps:** the
`!= '0'` switch idiom reads an EMPTY string as ON (a switch-A/B OFF arm must be explicit `'0'`); harness must set
`OCR_RENDER_DPI=200` (product DPI; harness defaults 300); `git commit -F <file>` ONLY. **The Electron 44 upgrade (PR #12) is
DONE + VM-confirmed** — no longer the pending job. Prior:
## (previous) 2026-08-29: **READ `HANDOVER_2026-08-29.md`.** Branch `feat/teach-side-overnight`, **HEAD `59923ed`,
PUSHED (in sync with origin; git auth now works via GCM/credential-manager)**. Uncommitted: `CLAUDE.md` + **three report
docs left for owner review**. ⏭ **NEXT SESSION'S PRIMARY JOB = execute the ELECTRON 31.7.7 → 41 UPGRADE** per
`docs/ELECTRON_41_UPGRADE_PLAN.md` — **Oracle SIGN-OFF-WITH-CONDITIONS** (conditions are the "⚖ Oracle gate" block at the
top of that doc): a mandatory BLOCKING **gate 5b (in-place DPAPI continuity)** — launch the E41 build against a `db.backup()`
copy of a real **E31-written** `%APPDATA%\ScanFinder` via `--user-data-dir`, assert `verifyAuditChain` ok + `canStamp` true +
NO `tamper_detected` + LAN pinned-CA handshake (the audit-HMAC key + LAN TLS keys are the ONLY DPAPI blobs; the licence token
is a JWS, so the gate can't break it); NEVER run gates against the LIVE profile; diff test-failure SIGNATURES not names;
worktree only; the `argon2` source-build is the likely gate-1 failure; also bump `client/` + `cert-tool/`. Oracle suggests
targeting **newest-supported (44) over 41** for runway — owner's call. **SHIPPED THIS SESSION (all pushed):** (1) themes
**Light Festive + Spooky** + seasonal revisions (`c4d1033`, `589b93e`; core + client; new `patterns/festive-light.svg` +
`spooky.svg`); (2) **PHP licensing admin console — full redesign** (Warm-Archive left-sidebar chrome `2c54c11` with
`admin_nav()` neutered; dashboard `40bc2b6`; section-page `admin_page_head()`/`admin_chips()` `59923ed`; `--accent-ink`
invisible-toggle fix `c094c4d`; **2FA now OPTIONAL by default** `dc178be` — `admin_2fa_required()` reads opt-in
`LICENSING_ADMIN_REQUIRE_2FA`, the owner's choice to fix a deploy-time lockout; a **KNOWN security downgrade**, see the audit).
Owner deployed to IONOS. **SECURITY AUDIT** (5 agents + Oracle) → `docs/SECURITY_REVIEW_2026-08-28.md` (UNCOMMITTED, sensitive):
top item = **no document-level access control** (HIGH; CRITICAL for multi-user/LAN; **single-user desktop SAFE** — app runs as
the logged-in user; `doctype_grants` scaffold in `accessService.js` unbuilt — one fix across read+enumerate+write, both
transports); local-DB licence-forgery **impossible**; website login **sound**; **NO LLM → prompt-injection N/A**; A1 = the
`/v1` client login doesn't enforce the forced temp-password reset the core does. **CHRIS vet** →
`docs/CHRIS_FULL_APP_REVIEW_2026-08-29.md` (UNCOMMITTED): verdict **YES**, 8 cards (top = first-batch "Sender not identified"
wall; CHRISBOT is same-buyer-skewed). Chris sandbox LEFT RUNNING: core CDP **9223**, client **9224** (user Sam). **Traps:**
`git commit -F <file>` only; Electron-as-Node prints nothing unless wrapped; licensing backend is a SEPARATE deploy (owner
uploads code, NEVER `keys/`); PHP lint `C:\wamp64\bin\php\php8.0.30\php.exe -l`. Prior:
## (previous) 2026-08-28 NIGHT: **READ `HANDOVER_2026-08-28_NIGHT.md` FIRST.** The **WORKFLOW + STAMPING redesign is BUILT
end-to-end** (slices 0–4) and live in the core app AND the detached client — design + Oracle conditions in
`docs/designs/WORKFLOW_STAMPING_REDESIGN_2026-08-28.md` (**§9 authoritative**). Owner smoke-tested it: "works, needs some
tuning (later)." Branch `feat/teach-side-overnight`, **11 commits `eba2ef2` … `86de7d7`, NOT pushed** (owner reviews then
pushes), tree clean. Both apps RUNNING on the latest code (dev `npm start` core on the real DB + `electron client`).
**Stamping =** a per-user `can_stamp` permission that is a SIGNED grant on the DPAPI audit chain (NO flippable column;
`stampPermission.canStamp` is FAIL-CLOSED + verifies `verifyAuditChain` at check-time; a forged INSERT → refused +
`tamper_detected`), an append-only `stamp_events` record (source+artifact SHA-256 + a cross-linked signed audit row, original
PDF never touched, CUMULATIVE, prints No.N + date/time), click-to-place in Search + the client. Approve/reject now need
`can_stamp`; ROUTING is NOT gated (a standard user sends for approval) but you **can't route FOR APPROVAL to a non-stamper**
(`RECIPIENT_CANNOT_STAMP`). Residual: tamper-EVIDENT not tamper-PROOF vs the core PC's own admin (accepted). Pins:
`test_stamp_permission.js`, `test_stamp_service.js`, `test_stamp_workflow_gate.js`, `test_workflow.js`, `test_v1_workflow.js`
(all green). Also: Search preview zoom pixelation FIXED — root cause was `will-change:transform` cached-layer upscaling +
`object-fit` (NOT DPI); matched the Review viewer's CSS (`d27ac26`), render scale 6, controls moved to top. **Help voice
rewrite PARKED** (Quick start + Teach rewritten + voice signed off "perfect"; the rest in `pendingfeatures.md`). **First
actions:** owner reviews + pushes; owner's client-UI tuning; optional Settings "Integrity check" (Oracle §5.3, deferred);
resume help. **Traps:** `git commit -F <file>` ONLY (here-string + `<<EOF` heredoc both break); restart mechanic (kill
dev-start node + electron PIDs individually, relaunch via `Start-Process cmd -ArgumentList '/c','npm start'` +
`-RedirectStandardOutput`, NOT an embedded `1>` redirect) — full list in the handover. Prior:
## (previous) 2026-08-28 DAY: **`HANDOVER_2026-08-28.md`** — export (Home → CSV/`.xlsx`/JSON) + memory-inventory + help
slice 1 + two Pelican extraction fixes (`5430bed`, both `ref_prefix_confusable_adopt_length_note` +
`tier_a_date_plausibility` flipped ON in the live DB). Superseded by tonight's build.
## (context) 2026-08-27 NIGHT2 → 08-28: **`HANDOVER_2026-08-27_NIGHT2.md`** — the owner's §7 night prompt is BUILT —
2 commits `ce4c7f5` (EXPORT: Home "Export data" → CSV/`.xlsx`/JSON of confirmed doc data; new dependency-free
`src/lib/xlsxWriter.js` so the 4-dep tree + licence gate stay untouched) + `d2cf9fe` (MEMORY INVENTORY: Settings →
Learning is now READ-ONLY click-to-browse, typed tools preserved under "Advanced"), NOT pushed. barry+bob+eric → Oracle
SIGN-OFF-W/COND, all conditions applied; 4 pins green. **Then 2026-08-28 owner-feedback follow-ups (same branch, NOT
pushed):** `b04f202` export gains a **Document-date** range beside Date-filed + a clearer Options layout + exported
dates follow **Settings → Processing "Date format (region)"** (`region_date_order`); `6da3f96` audit-log "View" buttons
right-aligned; `8b3a35d` **HELP SYSTEM rebuild slice 1** — plain-speak SPINE + Check pages (teach-first) + a
"User Guide…" Home menu item + rebuilt `help-nav.js` manifest + deep-link pin (per
`docs/designs/HELP_SYSTEM_REBUILD_PLAN_2026-08-27.md`, D1–D11 at recommended defaults). **OWNER MORNING: (1) QUIT + RELAUNCH the live app
(a full restart — I killed it by accident with a broad `Stop-Process -Name electron`, restarted it on 9222 but on an
EARLIER commit; tonight's main-process changes + the 3 pending fixes load only on a fresh start; the classifier then
blocked me from restarting again, correctly); (2) OPEN A REAL `.xlsx` IN EXCEL — the hand-rolled writer's pin is a Node unzip that does
NOT certify Excel; (3) render-smoke export + memory-inventory + help; (4) read the guide's Quick start + Teach and SIGN
OFF THE VOICE (plan D11) before help slices 2–3.** **2026-08-28 LIVE session (owner testing): export UI polish
(`b27c356`/`083c8e8` opt-in defaults + responsive count + even cards; `b04f202` document-date range + region date
format), audit View right-align (`6da3f96`), and TWO DARK extraction fixes `5430bed` (gary+007→Oracle SIGN-OFF-W/COND)
for the Pelican `PI`→`P1` confusable class: `ref_prefix_confusable_adopt_length_note` (route the ref-length note to the
P adopt arm) + `tier_a_date_plausibility` (an implausible authoritative date — a date-shaped ref — loses Tier-A to the
mapping). FOCUSED gate (157 Pelican docs, 200 DPI): 5 ref + 20 date heals, 0 regressions, +20 wouldFile. OWNER FLIP
after a restart: set both settings true + Reprocess; the full-corpus M=0 head pass was STOPPED mid-run (duplicate-heavy
corpus) — `scratchpad/rr_gate_full.cmd` finishes it if wanted. See `HANDOVER_2026-08-27_NIGHT2.md` §5c.** Deferred
(`pendingfeatures.md`): export presets/PDF-copy/long-format; Learning Repair v2 editor+canvas; help slices 2–3 +
screenshots; 007's own-reference-collision date guard (next arc). Prior:
## (previous) 2026-08-27 NIGHT: **`HANDOVER_2026-08-27_NIGHT.md` — its §7 was the OWNER'S NIGHT PROMPT (export
feature + memory-inventory rebuild), now BUILT above; §3 light-text realdoc gate still open.**
Branch `feat/teach-side-overnight`, 14 code commits `48de395` … `a62edbd` (+ docs), NOT pushed. **Live app RUNNING on CDP 9222
on `5b4bf27` (mig 92 applied 20:26; owner turned `ocr_light_text_recovery` ON ~20:45) — the last three main-process fixes need a
restart; Chris sandbox 9223 DOWN.** Late finds: **Gate-C v2 never saw the sender** (`5f66276`; the gate ran before
`results._supplier_name` was written → the backed I/1 tolerance never fired in production); **the harness has always run at
300 DPI while the product runs 200** — at 200 the corpus reads date 96.9 / ref 98.7 with 23 wrong would-files (vs 99.1 / 14
at 300) → owner decision on `ocr_dpi`; a junk old DATE vs a valid read is a fill, not a "Read differently" (`d2ee3a7`); the
zero-filed receipt + "being viewed by someone" = the owner (`a62edbd`); the serial pass on the owner's live re-import:
34/37 → with the slot ladder 36/37 expected. Owner: *"surely ref, date and supplier must
be required by nature?? continue with the queued items."* **(1) `48de395` THE ROLES ARE REQUIRED BY NATURE** (Oracle S-O-W/COND):
the shared doc-type editor's CREATE road wrote `required=0` on the identity/ref/date fields it supplied (every seeded type has 1)
and the edit toggle is LOCKED + `updateField` refuses it — so the evening's "tick required" remedy was IMPOSSIBLE; the SCORER
(`overall_confidence`: required fields ELSE every field, unread = 0) fell to every field and one unread List field held every
Castellan worksheet at 81 < 95 (the 07-27 Northgate 72% cap = same class). Fix = `document_types.assertStructuralRequired` at
every writer (ensureStructuralRoles / updateType re-point / backup restore) + **mig 92** + an unconditional startup heal; scorer
unchanged. Gate: 165 worksheets OFF→ON would-file 43→164, 0 value diffs, 0 wrong gained. Custom types' roles now get the S3-C5 +
first-fill holds. **Owner: restart, then Reprocess the held Castellan worksheets.** **(2) `5b4bf27` LIGHT-TEXT RECOVERY, DARK
`ocr_light_text_recovery`** (oscar + 007 → Oracle S-O-W/COND): a threshold-200 → PSM 3 supplementary full-page read merged only
where PSM-3/PSM-6 left nothing, placed INTO the base rows, `med_h` frozen, `words_out["words"]` stays base-only (`light_words`
carries the recovered ones), digit tokens need conf ≥ 80. **Recipe: FOUR levels {200,210,220,230} — a level sweep on the owner's own scans showed NO single level reads every
serial (one value's conf swung 8→90→64→92 across 200/205/215/220 on the same page); the union reads all ten values on four
exhibits, a digit-bearing string needs two agreeing levels (the one garble appeared at one level only).** Real pipeline on the
owner's docs 11/13/1504 with the switch ON: serial_number fills on all three (`keyword_list` @85). **Switch still OFF on the live DB** (a CDP flip was refused by
the tool's classifier) — the owner turns it on in Settings → Processing → "Also read faint small print on scans"; a re-import
then shows the serials; already-filed docs keep their old text until re-read; scanned-page OCR time roughly triples. **FLIP conditions (not built): the corroboration exclusion for light-line keyword reads,
an `ocr_recipe` stamp + ONE `ocrCacheUsable` predicate (a plain Reprocess reuses `ocr_text` — a flip heals nothing until
re-OCR), the `vat_reg_not_amount` dependency.** Gates (realdoc at **`OCR_RENDER_DPI=200` — the harness never mirrors
`_ocrDpiEnv`**, + the census) → handover §3. Help-system work now logged in `pendingfeatures.md`. **Traps:** Electron-as-Node
prints nothing from the PowerShell tool (wrap in `cmd /c` + redirect); copy the live DB with `db.backup()`, never a file copy.

## (previous) 2026-08-27 EVENING: `HANDOVER_2026-08-27_EVENING.md`
Branch `feat/teach-side-overnight`, **HEAD `cab9fbc`** (code `38d5af2`; 17 commits ahead, NOT pushed). **Live app RUNNING on
CDP 9222 on this code; Chris sandbox on 9223.** Shipped: the List-field Review PILLS slice (Oracle SIGN-OFF-W/COND, all ten
conditions; pins 27+41+8 green; census debris 478→0) + **Chris r8's TOP card fixed the same evening** (the ⊕ label picker's
nearest token "No" became a doc-type keyword and filed the JOB SHEET number as the serial → ONE `cleanCaption` shared by
⊕/wizard/IPC; a generic tail is EXTENDED to the page phrase "Serial No" or REFUSED on all three roads). **THE REAL BLOCKER,
measured:** scanned worksheets' grey 7.5-pt "Serial No: …" lines are NOT recognised by Tesseract at 200/300 DPI in any PSM
(`probe_ocr_loss.py`) but a **threshold-200 pass recovers them at conf 90–93** (`probe_contrast.py`, `band_scan_200.png`) →
**NEXT ARC = a light-text supplementary pass in `reconstruct_page_text` (DARK switch, oscar/007 → Oracle, gates in the
handover §2).** Also: Service Worksheet has NO required fields, so the unread List field scores 0 and every Castellan
worksheet HOLDS at overall 81 < 95 — **FIXED the same night (mig 92): the roles are required by nature — the editor's create road never set the flag and the toggle is LOCKED, so "tick required" was impossible; the writers now assert it + a startup heal. Owner: restart, then Reprocess the 96.**
Help-system rebuild PLAN written (`docs/designs/HELP_SYSTEM_REBUILD_PLAN_2026-08-27.md`; eleven owner decisions, D11 first;
the help window is NOT modal; the Mailbox is live). New harness lever: `RR_IDS=…` reprocesses only those confirmed docs on the
untouched live DB. **Traps:** the shell guard refuses any command containing `Remove-Item` + a quoted spaced path (the whole
command never runs); `git commit -F <file>` only; Electron-as-Node argv[2]; never "focus" the realdoc harness by demoting docs
on a copy (un-graduates every scope).

## (previous) 2026-08-27 DAY (Chris round 6 fixes): `HANDOVER_2026-08-27_DAY.md`
Branch `feat/teach-side-overnight`, resumed from `6787291`; **code commit `d6c1f17`** (+ docs commits after it; 8+ commits
ahead of origin, NOT pushed — owner reviews then pushes).
Owner: "read the handover and continue … continue with chris's fixes". **Built + pinned (every behaviour change DARK):**
**Card 1 HIGH** = a `buyer_issued` PO template (fingerprint = the OWNER's name+address) won the WHOLE-PAGE text arm at 7/9 on
three other suppliers' papers (those words print in every BILL TO block; doc 6 untyped — "GOODS DELIVERY NOTE" is one extra
real word → no trusted heading → the type-scope guard had nothing to refuse on; roads = the quiet lane's kw selector + a single
Reprocess) → **`template_buyer_issued_letterhead_scope`**: a marked template is recognised by TEXT only over the LETTERHEAD band
(`template_matcher.header_band_text` = the fingerprint harvest's own truncation, ONE helper; JS twin
`branding_fingerprint.headerBandText`) in `_match_by_keywords`, the rescue arm, the JS mirror (`findByKeywordFingerprint` →
lane selector + wizard/graduation-link/reextract roads), plus a go-forward HEAL on the engine honour path
(`sticky_binding_declined reason='letterhead'`). **Oracle SEND BACK → corrected:** `_identity_refuses` stays WHOLE-PAGE
(configuration B — a PO taught with the counterparty as issuer — prints its identity below the band). Gates ALL MET: refactor 0
diffs/1242 docs; 0 empty bands / 0 <0.75 among the 113 PO docs; **realdoc OFF vs ON byte-identical on 1242 docs (would-file
1168→1168, 0 wrong gained, per-template counts identical)**; **fired path on a fresh Chris sandbox: the lane selected nobody
(`done_ids ""` vs r6 `"4,2"`), Reprocess did not re-badge, IMPORT 200 → 0 inbound docs on the PO template** — flip = owner's call.
**Card 3** the Import chip asks the ONE predicate (`review_hold`; engine `needs_review` = required-empty OR field<70 ≠
`isAutoFileEligible`). **Card 5** no Use/Keep when the page vouches for neither value. **Card 6** no countdown at 0 confirms.
**Card 7** stale verdict dropped on type/issuer change; Delete All → "Queue cleared — N in the recycle bin" (STICKY messages —
Chris r7c caught the one-shot being consumed before the delete's IPC re-render); empty panel clears ⊕/Teach; an unsaved type
change shows a neutral "Type changed to X — check the fields" lead (his card A). Chris r7c: card 7 (a)(b)(d) FIXED as seen,
(c) re-fixed; new vet cards A2/B/C/D/E in `pendingfeatures.md`. **Card 2** verified: `trust_role_disagreement_refuse` is ON live, was OFF in his sandbox — no code. Pins:
`test_chris_r6_ui_cards.js`, `test_buyer_issued_letterhead_scope.py` 43, `test_buyer_issued_scope.js` §4 (28), wiring rows.
**LIST FIELD = TEACH ITS CAPTION (built ~14:30, owner spec):** the wizard keeps a List field teachable; one value box → the
caption beside it → a preview of every value that caption collects on the page → at save the NEW IPC `teach-list-caption`
(Admin+Edit, list-typed only) writes it as an ADDITIVE doc-type-wide `field_label_overrides` row ("if it isn't already there");
no box stored; the taught doc files with all the previewed values. A List field's LABEL alone ("Serial Number") never matches
a printed "Serial No:" — the caption teach is what makes it collect. The Review ⊕ road does the same (a `{listCaption}`
record in `pendingAnchors` → `teach-list-caption` at confirm; the field is filled with every value the caption collects,
`shared/listCaption.js` = the ONE preview). Pin `test_teach_auto_field_rows.js` (34). **REVIEW PILLS (pm; panel barry/gary/
reggie/eric/bob/Chris-lens → Oracle SIGN-OFF-W/COND, all ten conditions built):** a List field's box in Review is now PILLS over
the hidden store input (the ONE value confirm reads / the ONE `corrections` writer; every mutation dispatches its `input`
event; state reaches the pills via CSS sibling combinators) — click-to-edit, ✕ with ↺ put-back, "+ One it missed" = the ⊕
caption teach (merge rule current ∪ (preview − (original − current))), "Edit as text", "Undo changes", "N found on this
document". A pill edit teaches THIS DOCUMENT ONLY (no hint — `_isListTypedField` skips in `saveCorrections` +
`replantConfirmHints`); three guards refuse a field RULE on a list key (`showFieldRuleMenu`, `save-field-rule`, engine
field_rules). Collector: union across TAUGHT captions in page order, collect-only tail bound (`LIST_CAPTION_TAIL_BOUND`),
code digit gate + caption-vocab arm (`LIST_ELEMENT_DIGIT_GATE`), LONGEST CAPTION WINS PER LINE, own-label-only seed for a
list-typed ref-role field. Pins `test_list_field_scan.py` 27 · `test_list_field_pills.js` 34 · `test_list_field_learning_skip.js`
8; census: one taught caption debris 478→0, no shape loses a serial. Residual: a taught caption + the own-label seed do NOT
union (teach both spellings). **Chris r8 → FIXED same evening:** the ⊕ label picker's nearest token ("No") became a doc-type
keyword and filed the JOB number as the serial → ONE `cleanCaption` shared by ⊕/wizard/IPC, a generic tail is EXTENDED to the
page phrase ("Serial No") or REFUSED on all three roads. **TWO FINDINGS FOR THE OWNER (not code):** (1) your scanned Castellan
worksheets' page text has NO "Serial No:" lines (OCR row-rebuild loss; the born-digital twin has them) → caption teach collects
nothing on scans → OCR arc queued; (2) adding the List field to Service Worksheet (no required fields → every field scored,
unread = 0) sank every Castellan worksheet to overall 81 < floor 95 → **all 96 now HOLD; remedy = tick *required* on
Issuer/Date/Reference for that type** (system fix → Oracle). **App must be restarted for the pills.** QUEUED (owner): a complete HELP SYSTEM overhaul plan
(teach-then-import is now the recommended route; quick start; plain speak; screenshot markers) + a Help button on the Home
screen menu.
**LIVE FLIPS 13:35 (owner: "flip the switches and start the app"):** `corrob_verification_doubt_clear`, `learning_exclude_docs`,
`learning_repair_console`, `learning_repair_forget`, `barcode_inventory`, `barcode_field`, `template_buyer_issued_letterhead_scope`
set `true` on the live DB by direct UPSERT (no audit rows — see the handover); app restarted on CDP 9222, **DB at mig 91** (mig 89
also defaulted `issuer_sibling_fill` + `position_teach_nudge` + `issuer_suggest_on_blank_confirm` ON). Owner still owes the class-F
live heal check (Reprocess SuperStore 31901 with SFDEV trace → `corrob_note_resolve cls=F`). **Traps:** quote `-File` paths inside the
`Start-Process` argument; a dropped advisor resumes via SendMessage; a detached suite reads pins mid-edit (version-skew reds).

## (previous) 2026-08-27 MORNING (the autonomous overnight run): `HANDOVER_2026-08-27_MORNING.md`
Branch `feat/teach-side-overnight`, **HEAD `b0e94f4` (+ the handover docs commit), 7 commits LOCAL/NOT pushed** (owner reviews then pushes). Built while
the owner slept, every switch DARK (default OFF), each advisor→Oracle→pins→gate: **(1) CLASS F** the general
"corroboration clears a please-check note" rule (`corrob_verification_doubt_clear`; Oracle C1-C4 in code; **corpus gate
PASSED NON-VACUOUSLY on the owner's DB: 24 edge-cut notes cleared, all 24 correct — the SuperStore 3190x class — would-file
1168→1192, 0 wrong gained, M 12 unchanged**; flip order enforced: `corrob_note_recompute_fc` first); **(2) landmark box snap**
committed `9861d37` (+pin); **(3) targeted field re-slice → gary+oscar: WRONG LAYER** (full-page OCR already cached on a
reprocess; a field-only write poisons the re-read holds; cheaper lever = flip `quiet_reread_on_layout`); **(4) LEARNING
REPAIR v2** — the old forget was a HALF-forget (the live-derived model kept counting): mig 90 `documents.learning_excluded_at`
+ ONE predicate `machine_vias.learningExcludedSql` in 17 readers (default ON, inert until stamped) · `learningScopeService`
selector (`learning_repair_console`) · `learningRepairService.forgetScope` + exact-row Undo (`learning_repair_forget`; C1
retract-once stamps, C2 shared-template refusal, C5 lane reason `repair`) — a HUMAN confirm clears both stamps; **(5)
BARCODES** — `barcode_inventory` (zxingcpp per OCR page, mig 91 `document_barcodes`, search) + `barcode_field` (a
"Barcode / QR code" field type whose ONE writer is the decode, Stage 1.5, LIST-style ownership skips, confirm-once note);
**(6) LIST field audited = properly implemented for inline repeated captions** (column layout = element 1 only, documented);
`;` in an element now refused. **Full suite: every red is pre-existing except two source pins updated (`8cb80ac`).**
**OWNER DECISIONS (ranked in the handover):** flip F after the SFDEV live heal of 31901 · the three Learning-Repair UX
defaults + whole-sender forget · flip the layout arm vs fund a quick-read pill · the barcode symbology/role/required Qs ·
barry's sweep (PDF text layer — may the filed PDF differ from the original? · exact-dup skip · accountant export). **Chris's
round (CHRISBOT 472 docs, fresh sandbox CDP 9223 PID 3060, new switches armed): 279 filed, 0 wrong company, 0 wrong type,
149 by itself (warm batch 116/200 vs 98 last round), every scary button truthful, "Start fresh"+Undo clear, verdict YES.**
His two cards on tonight's code FIXED (`d0d74fb`: barcode row renders when none found + never the Date role; console
exact-scope suspects + honest "N filed · none still teaching"). VET QUEUE: Card 1 HIGH — a buyer-issued-PO teach re-badged
three other suppliers' papers as Bramblewood POs @95 with "Nothing looks wrong" (held; `template_buyer_issued_type_scope`
was ON and didn't stop it → detection arc); Card 2 wrong date @94 no warning (scanned statement); Card 3 Import table
"Ready" vs Review holding; Cards 5-7 + the Settings "Processing wall" (wants Recommended/Advanced). Report + triage:
`docs/CHRIS_FULL_APP_REVIEW_2026-08-26.md` + the handover foot. Trap: `_fold_shape` makes every digits-only skeleton `#` — LENGTH-BLIND.

## (previous) 2026-08-26 NIGHT (identifier-registry arc + Chris R5 cards + switch inventory/flip): `HANDOVER_2026-08-26_NIGHT.md`
Branch `feat/teach-side-overnight`, **HEAD `f2349f9`, commits LOCAL/NOT pushed** (owner reviews then pushes).
**⏭ THE FRESH SESSION IS TO BUILD THREE FEATURES — top of queue in the handover:** (1) **CLASS F** — one general
"corroboration clears a verification-doubt note" rule (gary-AUDITED, NOT built; edge-cut 31901 exhibit; the rule
must LIFT the field to 90 not just pop the note; allowlist + ≥2-distinct-family + shape-pass + deny-by-default
seam; `pendingfeatures.md:51`); (2) **LANDMARK BOX SNAP** — ✅ BUILT this session, UNCOMMITTED in
`settings/renderer.js addLandmarkFromRect` — just add a pin + commit, don't rebuild; (3) **TARGETED FIELD
RE-SLICE** after a ⊕ teach — DESIGN-STAGE (needs advisor+Oracle). Shipped this session: Chris R5 cards 1-6
(`position_teach_nudge`+`issuer_suggest_on_blank_confirm` now DEFAULT-ON via **mig 89**, live DB flipped),
row-badge→classify(), quiet-lane 2 workers, and the **supplier hard-identifier registry slices 1a+1b DARK**
(`identifier_registry` — learn VAT/company-no at confirm, match→suggested_supplier; Oracle SIGN-OFF-W/COND, do
NOT flip until a REAL-customer-VAT corpus + M=0 + Oracle ratify — the synthetic corpus can't test checksum
precision). Switch inventory: only 6 DARK remain. `d811cce`=features, `f2349f9`=mig 89.

## (previous) 2026-08-26 DAY (resumed a mid-task C2 revision → Oracle re-vet → gate met): `HANDOVER_2026-08-26.md`
Branch `feat/teach-side-overnight`. The prior session left a half-finished, un-vetted WIDENING of the
`issuer_sibling_fill` **C2** safety on disk. That session finished + gated it (folded into commit `d811cce`).
- **The correction (`issuerSiblingFillService.js`):** the mid-task widening (logo≤13 OR `keywordOverlap≥0.60`)
  was buggy (dead keyword arm: `_KW_MIN=KEYWORD_THRESHOLD=75` vs a 0..1 fraction; un-threaded fingerprint) AND
  changed an Oracle-signed safety with no re-vet. **Oracle re-vet = SEND BACK → corrected in place:** the
  keyword arm now uses the app's ONE same-template comparator `brandingFp.convergesByBranding(src,sib,0.80)`
  (distinctive tokens, ≥3 shared floor, SYMMETRIC ratio) — NOT raw `keywordOverlap` (which the premise falsely
  claimed "mirrors handler.js:1635"; that 0.60 is an AND-guard on top of logo≤13, and raw overlap re-opens the
  two-senders-same-garble collision: asymmetric + name-token inflated). Logo arm stays ≤13. Added a
  mature-sibling identity re-check (`supplierNamesDisjoint(C, establishedIdentity(...))`). `reviewService.js`
  now threads the parsed `keyword_fingerprint` array into the pre-claim `src` capture.
- **GATE MET (owner may flip DARK→on):** census **0 / 1,250,932** cross-supplier convergences on the owner's
  1668-doc backup (87.1% same-supplier); PIN h2 with a measured RED-on-old(1.00/0.83 admit)/GREEN-on-new
  (0.375/0.625 refuse) proof; Chris R4 Saltmarsh fired 0→17; Chris R5 full 452-doc CHRISBOT run = 215 filed,
  **0 wrong-company misfiles**, every bad read HELD (leak-checked: nothing left the sandbox).
- **Also fixed Chris Card 6** (`renderer.js`): the Put-back tooltip/dialog said "copies already written to your
  filing folder" on an in-Review sibling-fill/class-fix undo where NOTHING was filed — now kind-aware.
- **Vet queue (Chris R4/R5, NONE safety, NOT built):** Card 1 draw-a-box-nudge (typing teaches identity not
  field POSITION — Pelican 41-blank pileup) · Card 2 buyer-issued-PO steer · Card 3 cold-batch expectation ·
  Card 4 no-sender Unknown-Company scatter · draft Terms (legal). **`issuer_sibling_fill` stays DARK.**

## (previous) 2026-08-25 (resumed after an accidental close: mid-task arcs + a full Chris fix loop): **READ `HANDOVER_2026-08-25.md` FIRST**
Branch `feat/teach-side-overnight`, **origin at `034a3ad`, 13 commits AHEAD + LOCAL/NOT pushed** (owner reviews then
pushes). The session was closed mid-commit; I read the 08-24 handover, committed the uncommitted mid-build work,
then ran the loop Chris→fix→Chris→(recommendation)fix→Chris. **(1) Resumed + committed 3 DARK/OFF-inert arcs:**
`c1d5c08` the Quick-check grid FRONT-END (UI half of `eef96bd`); `d687f31` two DARK detection arcs
(`name_dominant_snap` — a ≤1-edit legal-suffix slip "…Lid"→"…Ltd" silent-adopts + auto-files; and
`branding_strip_reg_boilerplate` — strip {vat,reg,registered,company} so a wrong logo-collision supplier can't win
own_ratio on a "VAT Reg…" line, doc-732). **BOTH detection arcs are OWNER-VET-QUEUE — DARK, need corpus OFF==ON +
Oracle before any flip.** **(2) Chris fix loop (3 rounds, `docs/CHRIS_FULL_APP_REVIEW_2026-08-25.md`):** round 1
→ 7 cards, strong yes; rounds 2+3 verified fixes live, zero regressions. **FIXED (`200e68d`+`97d3527`):**
- **Card 1 (HIGH) invalid-date SILENT MISFILE** — a present-but-unparseable date-ROLE value passed the
  empty-required Confirm gate and filed to `Company/Unknown Year/Unknown Month` with no signal. **gary + Oracle
  both WRONG-LAYER:** the renderer-only + `validation_patterns` idea was a FIG LEAF (looser than `filing.parseDate`
  — passes "15/12/202","15/12/25",slash-ISO,full-month; false-blocks OCR-spaced). Fix gates on `filing.normaliseDate`
  (the EXACT folder-builder parser) at EVERY door: `reviewService.confirm` (pre-claim refuse → interactive toast /
  File-All skip / /v1), `_autoFileDoc` (hold → closes the conf-100/`strict_100_autofile`-off auto-file hole),
  `batchAuditService.validateEdit` (aligned — was the same fig leaf), renderer `validateConfirm` (early pre-block via
  `_parseDrawnDate`). Pins: `test_normalise_date_predicate.js` (16, both sides), `test_reviewservice.js` (refusal
  replaces the old "left as typed" pin), `test_batch_audit_correct.js`.
- **Card 3 (MOD-HIGH)** Quick-check re-file renamed `Invoice.…`→`Document.…` (`getWithExtractions`→`getById` SELECT *
  has no `type_slug` → null slug → builder fell back to "Document"): resolve slug from `document_type_id` via
  `doctypes.getAll`. **Card 5** Cards leaked dev codes (`_baFieldMeta` drops method). **Card 7** Empty bin orphaned
  the `.metadata/*.xml` (`_purgeOne` removes it). **Card A** (round-2) OCR-spaced date showed a spurious "Not a valid
  date" while filing fine — the on-blur `fieldValidationError` now accepts what `_parseDrawnDate` accepts (agrees with
  button+builder; only relaxes).
**Card-1 corpus gate NOT run** — the fixes are confirm/file-time only, don't touch the extraction/`isAutoFileEligible`
READ path `realdoc_regression` measures (byte-identical by construction); predicate pinned 16/16. **OWNER VET QUEUE
(not built):** the 2 DARK detection arcs · Card 2 Terms "NOT YET IN FORCE"/[SOLICITOR:] (legal) · Card 4
letterhead-name-over-abstain (census+Oracle; same class as `branding_strip_reg_boilerplate`) · Card 6 stale
queue-row refresh · grid↔activity-strip flip coupling · green-pill/red-note cosmetic pairing. **Sandbox LEFT RUNNING**
CDP 9223 PID 19928 (`chris`/`plumber2026`, newest code).

## (previous) 2026-08-24 OVERNIGHT (autonomous: corroboration fix + a Chris round): `HANDOVER_2026-08-24.md`
Branch `feat/teach-side-overnight`, **origin at `034a3ad`, 4 overnight commits AHEAD + LOCAL/NOT pushed** (owner
reviews then pushes). Ran while the owner slept. **(1) `9c21ed6` the Pelican-565 corroboration fix** (Oracle
SIGN-OFF-W/COND): the record discarded a genuine independent mapping/crop agreement when the winner was bare
`anchor` (the full-page text/keyword-family reader) — fold bare anchor→keyword in the LOCAL `_corrob_bucket`
(shared bucket untouched; fraud stays closed by same-family skip; `agree_strong` closes the r19-unmask seam so a
bare-anchor line never masks a keyword-regex dissent). Kill `CORROB_ANCHOR_AS_KEYWORD=0`. 26 pins green; realdoc
A/B +2 correct heals, 0 new wrong, M_type=0. Go-forward: held docs reprocess to heal. **(2) Chris full vet** →
strong yes; fixed **#6** (`33a9f6b`, "anchor"→"label" copy) + **#3** (`670ffc7`, the orphaned-doc-while-twins-
auto-file: below-floor+graduated hold panel now guides to Reprocess, not "lower the bar"; + honest presence
comments — the desktop heartbeat is DEAD, presence is a leaky 60s beat, NOT a mid-edit guard) + **Card 2**
(`81719c1`, the nudge pointed "tools rail" → repointed under "This document"). Chris re-verify: #6 + #3 FIXED live.
**OWNER VET QUEUE (not built):** #1 Terms "NOT YET IN FORCE"/[SOLICITOR:] notes (legal, your domain) · #2
first-batch-all-hold (the misfile-safety arc — biggest friction, biggest risk) · **#3-A** the ZERO-CLICK orphan
fix (Oracle-signed DARK `sweep_retrigger_on_view_release` — re-trigger the quiet-reread LANE on doc-close only;
has a window-close-mid-edit trade-off to weigh) · #4 hold-summary double-counts one field (needs below-threshold
field-KEY plumbing from getReviewQueue) · #5/Card 1 OCR misses a printed date/banner issuer (the 007/oscar arc) ·
Card 3 clipped teach-box commits an invalid date with no warning. Sandbox left running on CDP 9223.

## (previous) 2026-08-23 EVENING (live test on a FRESH wiped DB): `HANDOVER_2026-08-23_EVENING.md`
Branch `feat/teach-side-overnight`, **HEAD `0b62235`, 63 commits ahead, NOT pushed.** The owner wiped the live DB
and ran a hands-on session; ONE commit built the fixes (all OFF byte-identical, Oracle-gated): **(1)** activity-strip
UX (two-line chips, ✕/click-to-close, always-a-receipt File All incl. 0-filed; `reviewEvents` dedups `dropped`);
**(2)** put-back re-file via File All (`putback_refile_on_file_all`, **mig 87** `refile_declined_at`+`putback_refiled_at`)
— a glanced-then-put-back doc re-files on the explicit click when it STILL passes the strict predicate
(`isAutoFileEligible({bypassPutBack})`), never via any machine path; undo-loop hard-holds; **(3)** two bugs (tab badge
was `queue.length`→DB count; class-fix bar ✕ + clears on doc change); **(4)** detail-veto single-supplier immunity
(`logo_detail_veto_single_supplier_immune`) — the 256-bit veto crops top-left + hashes a wordmark LETTER, false-
abstaining a dist-2 lock (Oakhaven 543/544); a call-site helper suppresses it ONLY for a corroborated single-supplier
lock tripped by a MARGINAL rival (>48), a DECISIVE rival (≤48, doc-193/buyer) still vetoes. **Verified:** 543/544 →
template 2 on the real app; realdoc A/B OFF-vs-ON byte-identical (supplier 100%, 0 new wrong-supplier, M_type=0);
all targeted+related suites green. **Live fresh DB** = `%APPDATA%\ScanFinder\docusnap.db` (mig 87, app running, all
new switches ON except `trust_company_key_own_scope`). **Deferred:** 531 (skew/coarse near-miss); the 12 wrong-date
auto-files (leading-digit date class — next accuracy arc); notification consolidation; the 5 garble/type-split vet
switches. **The overnight re-freeze/flip owner-owed items are MOOT (DB was wiped).**

## (previous) 2026-08-23 OVERNIGHT (Chris rounds 17→20 fix loop): `HANDOVER_2026-08-23_MORNING.md`
(the standard wrap: verification state, first actions, deferred conditions), then `HANDOVER_2026-08-23.md`
(its OWNER STEPS + the switch table), then `docs/CHRIS_FULL_APP_REVIEW_2026-08-23.md` (rounds 18/19/20 verbatim +
triage tables). Branch `feat/teach-side-overnight`, **~60 commits ahead, NOT pushed** (owner's standing rule).
**Round 20 verdict: the wrong-date self-file class is FIXED as seen — 73 filed, 0 wrong by the app, every wrong
read Chris could provoke was held with the right value one click away; Ironbridge/Larkspur waited for their
confirms.** Six new DARK switches (table in the handover); do NOT flip `trust_company_key_own_scope` live (holds 45
of the owner's docs). Owner owes: the re-freeze script on the live DB; the flip order; the r20 vet cards.
Round 17 (fresh sandbox, every switch ON) → 8 cards → agents → Oracle-gated → one commit each
(`99b90f1` … `740a243`, table in `docs/CHRIS_FULL_APP_REVIEW_2026-08-22.md` "Round 17 TRIAGE"); rounds 18–20
ran on the fixes. Headlines:
- **THE IDENTITY UNFREEZE CLASS (`11ca0ba`, a bug, no switch):** `_fieldsWithMultipleConfirmedValues` judged
  the company key TYPE-WIDE — ≥2 distinct confirmed suppliers on a TYPE unfroze EVERY template's identity at
  its next write (the "Gay" / "DOCUMENT" folders). Now per template by DOMINANCE (`templates.getDominantSupplier`);
  a NULL-over-frozen write is loud (warn + audit `template_identity_unfrozen`). **Owner step:**
  `node scripts/refreeze-template-identity-20260823.js --apply --templates-dir <repo templates/>` on the live DB
  (dry run found 5: Silverbeck, Veltrix, Castellan, Harrowgate, Nordwind; realdoc base vs re-frozen = identical, M=0).
- **Holds that never rendered (`99b90f1`):** the refused-confirm return dropped `nearMatch`/`typeSplit`. Rider
  `320433f`: one kept slip no longer silences the type-split ask ('mixed' needs ≥2 of the second type); a blank
  issuer is 'missing', never 'ready' (`issuer_blank`).
- **Garble/fragment (`72a75bd`, `875a433`, `9ae6c2b`):** wide debris leg DARK `template_fixed_debris_wide`;
  JUNK kind of the letterhead suggestion; `hasTemplate` requires the template's identity to BE the scope;
  the near-match SUB-RUN arm (`name_proximity.tokenSubrunIdentity`) asks with the full name first.
- **Review UX (`e9106aa`, `2cf5f26`):** tile yields under the strip + derives from status/door; File All
  records ONE bulk chip (ledger key `approved|bulk`, merge into the newest SAME-KEY event in the gap);
  import banner self-heals; Reprocess copy; "Sent back from Search"; `markUndone` + "Already back in Review.".
- **OWNER CARD 1 — THE READY ARM (`740a243`, DARK `quiet_reread_on_ready_templated`):** at the ready crossing
  the lane also re-reads the scope's OWNED-template held docs with `overall_confidence < scopeTrust().floor`
  (layout-arm guards + the C3.3 hold "Read after learning — confirm once."). **Cannot help an all-generic
  name (DS) — skipped + audited; tell the owner.** `_ownedTemplateRows` is the shared population query.
- **ROUND 18 → the fix loop continued (one commit each, Oracle-gated):** A1 **a wrong date self-filed** (447: blank
  at import, first-filled by the teach-time re-read, swept at the ready crossing) → `371ef2d` the FIRST-FILL
  RELIABILITY hold (DARK `quiet_reread_first_fill_reliability_hold`): hold every first-fill at merge, release at
  `_finish` unless the box proved unreliable in that job (K=1 `FIRST_FILL_UNRELIABLE_K`; witnesses = S3-C5 / loss /
  engine yield); the "— confirm once." family now survives the READY arm (`_ownedTemplateRows`) and a same-value
  Reprocess (`mergeReprocessRows`, `REPROCESS_CARRY_LANE_HOLD=0` kills); S3-C5 rows carry `corrected_to = was`.
  A3 **Put back must stick** → `19e91b0`+`061ca82` mig 86 `documents.put_back_at` (stamped by every human "look
  again" door — `deconfirmDocument`/requeue; the ONE predicate refuses `'put-back'`; a machine via is refused
  pre-claim `PUT_BACK`; only a human claim clears; the auto accept files as "Auto-filed (after your confirms)").
  A4 `7b8c8e1` the `confirm-review` IPC whitelist dropped `typeSplit`. A2/A6/5/7/copy `8b5ae1a`, A7 `615263c`.
  Census `TESTING/_measure/first_fill_reliability_census.js`: DS 0 held, Copperfield held, K=1≈K=2.
- **ROUND 19 → (04:00–04:40):** A2/A3/A4 FIXED; A1 fixed on the lane road but **four wrong dates self-filed via the
  manual "Reprocess N"** (N1) and **Ironbridge filed 18 on zero confirms** (N2). **THE MEASUREMENT THAT MATTERED:** the
  corroboration record called EVERY date a "disagreement" (`_cmp_norm` is separator-blind: `17-12-2026` vs
  `17/12/2026`) → no date was ever corroborated and the keyword family's CORRECT read on the four wrong rows was
  invisible → `6b77f30` date-aware compare (`FIELD_CORROBORATION_DATE_FOLD`) + the every-road `docTrustGate`
  refusal `disagreeing-read:<role>` (DARK `trust_role_disagreement_refuse`). N2 mechanism: the TYPE-wide
  `supplier_name` group was `constant` at 2 names (Copperfield + Ironbridge's own wizard confirm) → `69a65de`
  DARK `trust_company_key_own_scope` (a company key never borrows the type's names; the badge and the gate agree).
  P1 `5979bdc` **`src/modules/processing/rereadHolds.js` = ONE road for re-read holds** (the lane delegates; the
  manual batch + single-doc Reprocess write the same holds, DARK `reprocess_holds_as_lane`; C1: the S3-C5 baseline
  is the row's TYPE-VALID `corrected_to` else its display — never offer 'INV-29273' on a date). P3 `9dc7bf4` the
  layout arm re-reads noted docs (a new box is new evidence); N4/N5/N6/N8 `67aef42` + `65ff83d`. **Realdoc on the
  owner's copy (current app env): 381/416, M=1 (#413, a leading-digit date with no page witness — the next arc);
  the ON arm holds 45 more via `trust_company_key_own_scope` (do not flip) and exactly 1 via the disagreement
  refusal. The 389→381 "drift" was BISECTED: the round-17 HEAD reproduces 381/M=1 — tonight's code is exonerated.**
- **ROUND 20 → `0929e33` File All's loop skips on the ONE classifier (it filed the 9 put-back docs its dialog
  excluded); the identity never gets a one-click Use of its old garble; no duplicate S3-C5 note; `8bc3f32` the lane
  hint carries the job reason. Verdict: 73 filed, 0 wrong by the app.**
**Traps this session:** `core.autocrlf=true` → renderer.js etc. are CRLF on disk (tests slicing `
}
` must
normalise; patch scripts must open with `newline=""`); bash heredocs strip a backslash level (write tests with
the Write tool); hand-rolled test schemas lack mig columns (`pragma_table_info`); the `chris-the-customer`
agent type was NOT registered — spawn general-purpose + Read the persona file. Pre-existing reds unchanged:
`test_authoritative_anchor`, `test_v1_contract`, `test_doctype_surface_parity`, `test_teach_multipage`;
Python `test_identity_fusion` + 6 script-style.


## (previous) 2026-08-22 NIGHT: **READ `docs/designs/TYPE_SPLIT_AND_ACTIVITY_STRIP_PLAN_2026-08-22.md` FIRST**
(the plan + the STATUS table at its foot), then `HANDOVER_2026-08-22_EVENING.md`. Branch `feat/teach-side-overnight`,
HEAD `44b6661`, NOT pushed. Three arcs landed tonight, every switch DARK unless stated:
- **The garbled-issuer arc `c5a4050`** (a one-line box over a stacked wordmark read `NOCUMENT` and minted a sender):
  `template_fixed_seed_fragment_garble` (P4 tolerates one edit per ≥6-char READ token; band leg never fuzzed),
  `identity_suggest_canonical` (the "Letterhead may read X" note now carries X in `suggested_supplier` → the
  branding button; the Stage-4.5 token repair `Use "DOCUMENT"` is cleared), `review_group_by_letterhead` (a garble
  groups under its letterhead company + a confirm-time hold). Adversarial census 16,809 pairs → 0 keeps.
- **The type-split arc** (17 Nordwind quotes held by Fix A after ONE mis-confirm bore a purchase_order rival):
  A1 `40f47e3` name-precedence BUG FIX (a template took the machine's pre-confirm read as its name) · A2 `e2fa804`
  `type_ambiguity_unsupported_waiver` — decided ENTIRELY in the engine (process_docs' B1 block is skipped on a
  reprocess of a typed doc), realdoc M=0/M_type=0, would-auto-file 389→410 · A3 `c67f8e1` `type_split_confirm_gate`
  ON (asks once: "Nordwind files as Quote (24 so far). File this one as a Purchase Order?"; the wizard asks BEFORE
  it promotes) · A4 `a4cbd84` catalog `title_aliases` + **mig 85** (Quote → Quotation/Estimate …; with A4 alone the
  live copy's held quote resolved clean) · A5 `7fdfa80` `heading_absent_census.py`: on the owner's DB the printed
  type banner is DROPPED from page text on 105/416 docs and a blind top-band grey OCR recovers 18/18 @96 — NOT a
  colour mechanism; fix = its own arc · A6 `7fdfa80` `type_ambiguity_ripple` (rides the quiet lane).
- **The activity strip** (the top-left tiles re-total `recent_auto_filed` and never expire): B1 `3676415`
  `src/lib/reviewEvents.js` ledger (merge-in-place per batch, `review_events` PROTECTED, four doors incl. the human
  File N, event-id IPC, chunked honest undo) · B2 `44b6661` `review_activity_strip` — chips above the document,
  newest left, click-anywhere closes the panel only · B3 (retire the tiles) = Oracle SEND BACK, not started.
**Owed:** a Chris round with the new switches ON; then the new-install flips. **Owner remedy for Nordwind:** delete
template 12 → retype doc 135 as Quote → Reprocess 17 — or just restart (mig 85) and Reprocess.
**Pre-existing reds:** `test_teach_multipage.js` (its own comment matches its regex), `test_authoritative_anchor`,
`test_v1_contract`, `test_doctype_surface_parity`; Python `test_identity_fusion` + 6 script-style. **Trap:** this
checkout is `core.autocrlf=true` — any source-contract test slicing on `
}
` must normalise CRLF first; Python
`open(p,'w')` patch scripts and bash heredocs both mangle backslashes — use the Write/Edit tools for test files.

## (historical) 2026-08-15: **READ `HANDOVER_2026-08-15.md` FIRST.** HEAD **`717058b`**, 11 commits
**PUSHED to origin**, tree clean. The corroboration arc shipped + validated; owner flipped all reading
switches on their live DB and made it the new-install DEFAULT (mig 70); Chris re-ran on the new defaults.
**⏭ TOP OF QUEUE (owner said "yes, build it"): the hold-siblings FIRST-BATCH REGRESSION.** Chris's re-run:
`template_identity_hold_siblings` (now DEFAULT-ON via mig 70) fires on a FIRST teach, not just a genuine
identity CHANGE — after teaching 10 fresh, ALL 200 imports carry "the sender for this layout was changed to
'X' — confirm it here too" @70 (`template_fixed`), and **File All Ready offers 0** (first night filed 154 in
one click). **FIX (approved, NOT built):** gate the hold-siblings mark on "a prior frozen identity existed AND
differs", never a first teach (`template_identity_hold_siblings` read in `templates.js` + bridged
`TEMPLATE_IDENTITY_HOLD_SIBLINGS`); + run a DRAWN-box teach control (Chris used typed-locate → freezes
fixed_value from 1 confirm, the young-identity trigger; first night he drew boxes, no such note); and/or don't
count the sender-confirm note as a File-All blocker. **MIG 70:** new installs default all reading switches ON
except `deskew_on_import` (arc keys UPSERT-forced true; others INSERT OR IGNORE); the 8 corrob switches
SFDEV-gated (`DEV_SWITCH_IDS`). **Chris re-run WINS vs first night:** Oakhaven slash-drop FIXED (20/20),
false "net disagrees" gone, trailing-period + `]` fixed, Pelican I/1 better (~55% correct), **mature auto-file
~55%→~93.5%.** Chris's buyer-issued mis-teach (Quillstone as issuer on a Bramblewood PO) → filed under
Quillstone, NO bleed, containment held. Live-DB backup: `TESTING/_measure/live_backup_20260815_autofile_arc.db`.
**THE FINDING (owner's intuition, PROVEN): the DB already knows the answer.** `extractions.corroboration`
records which independent method families read the same value; the confirmed corpus records the dominant
value/prefix. But `trust.js isAutoFileEligible` refuses UNCONDITIONALLY on any note/`corrected_to` and on a
ref/date <88. 20 held docs → 7 classes (A inferred-co · B I/1 invoice# · C corroborated-total · D `]`→1
account · E name-suggestion · F ref-not-on-page · G ref<88), each DB-answerable except F.
**BUILT (workflow `ws8i3wjq1`: 6-reader map → design → Oracle SIGN-OFF-W/COND; ALL DEFAULT OFF, migration 69):**
ONE predicate — `_corrobLicensed` (≥2 independent PAGE families {mapping,crop,keyword}, memory+hint EXCLUDED as
near-circular) AND value==dominant-confirmed. **Gate (`1d1cdab`, trust.js):** `critfield_corrob_floor_relax`
(G — clears the 88 floor iff licensed + learned-shape match; Oracle seam: crop+mapping are common-mode, the
shape match is the 2nd leg) · `vacuous_corrected_to_ignore` (B — a `corrected_to`==`display_value` no-op stops
flagging, null-safe). **Engine (`cb69795`):** `_resolve_corroborated_notes` wired as `_d4` in the `_d1|_d2|_d3`
recompute guard — THE KEY PLACEMENT: a cleared note there ALSO drops its `overall_confidence` penalty, so the
doc clears the floor on reprocess (a stored-row clear can't — the penalty is baked at extraction). Arms
A/B/C/D/E each gated + fail-toward-Review; `_corrob_licensed` mirrors trust.js (pinned cross-language).
**Remediation (`scripts/remediate-corrob-queue-20260815.js`):** stored-row backlog delivery (dry-run default).
**VALIDATED on the REAL pipeline (Chris mature-reprocess, 7141316): the arms CLEAR NOTES + ADOPT VALUES
correctly, ZERO misfiling** — Chris filed 7, all correct. **⚠ CORRECTION to an earlier over-claim: the
`verify_heal.py` "≥10/20" was WRONG** — it omitted the engine's format-confidence penalty (`fc_delta`) AND
assumed graduation. The HONEST measurement (real `isAutoFileEligible` over the mature sandbox, arms ON): of
17 still-held docs, **only 3 are `flagged` (a note the arms can clear); 14 are `below-floor`** — a CONFIDENCE
DEFICIT (overall 76–85 < floor; Pelican floor 100 = NOT graduated), NOT a note. **The arms clear notes/adopt
values; they do NOT raise overall_confidence past the floor.** So the arc auto-files docs held ONLY by a note
AT ≥floor confidence (a minority); the Pelican I/1 (oc 84) + most Silverbeck (oc 77) stay held by below-floor
regardless of the note-clear. **The bigger backlog lever is SEPARATE from this arc: why a CORRECT Pelican
invoice reads at overall 84 (the fc_delta format penalty), and Pelican not being graduated (floor 100).**
**33 new pins green; whole suite 483/494 = the 11 documented pre-existing reds, ZERO new. OFF is inert by
construction.** **The fix's real value: correctness (right value/folder, no spurious flag) — NOT a big
backlog auto-file jump. OWED before any live default-ON flip: the OFF==ON md5 corpus arm + Oracle ratify.**
**THE "overall-84" PENALTY — DIAGNOSED + FIXED (`3f64c10`, `corrob_note_recompute_fc`, DEFAULT OFF):** a
CORRECT Pelican invoice reads 84 because its `invoice_number` note is counted as a format MISMATCH by
`format_consistency_delta` (−12). Clearing the note SHOULD lift it, but the demoter recompute guard REUSED
the STALE `fc_delta` → **every note-demoter (these arms AND the shipped recon/name/xcheck slices) was
COSMETIC** (note cleared, penalty stayed). The fix recomputes the delta off POST-demote results when armed
(verified: 1716 84→96). **THE LINCHPIN — it is what makes note-demotes actually reduce the review pile.**
**BUT Pelican still won't auto-file:** `scopeTrust`=`{floor:100, reason:'recent-correction', corrections:3}`
— graduation is blocked by recent corrections (by-design safety), so 96<100→held. To auto-file the Pelican
I/1 docs, BOTH must happen: (1) the fc flip (84→96) AND (2) the scope must GRADUATE (recent corrections age
out). corroboration_autofile can't rescue it (Pelican invoice_number is single-method → `independent_agree:false`).
**CHRIS ROUND 2026-08-15 ran** (`docs/CHRIS_FULL_APP_REVIEW_2026-08-15.md`; fresh sandbox CDP 9223, 7 switches
ON, SINGLE+IMPORT+IMPORT2 per TEACH_ORDER). **A fresh install has NO confirmed history, so the corroboration
arms are largely inert there** — his run measures the teach/import UX + base rate + detection issues. **Wave 1:
0/200 auto-file** — `auto_file_threshold` unset → defaults to **100%** while taught reads land 87–95%, so every
CORRECT read sits in Review (File-All-Ready then files 154/200 in one click). **Wave 2 (after that manual batch
GRADUATED the suppliers): ~55% auto-file, correct folders.** **OWNER-VET QUEUE (nothing implemented):**
**#1 the 100% default files nothing out of the box — default ~90 or prompt after the first batch (bigger than
this arc, orthogonal to it).** #2 buyer-issued PO steers "Document Issuer" at the OWN letterhead (Quillstone PO
= Bramblewood letterhead — the known buyer-issued class). #3 Pelican I→1 + ⊕ can't fix an OCR misread
(re-reads same pixels) — CONFIRMS class B; the app already computes the "wider reading" it only warns about.
#4 Oakhaven slash-drop flags 19/20 on a cosmetic "/" (the separator class). #5 stale recycle-bin view (recurs).
Chris CONFIRMED the round-4/5 recycle-bin fixes (Empty bin deletes PDFs; restore returns page-intact).
**CHRIS ROUND 2 (owner asked to re-run under REAL config): a SANITIZED COPY of the live DB (1258 confirmed,
all 30 owner flags + 7 fix flags ON, paths repointed + leak-checked, users cleared). Reprocessed the 24 held
docs → filed 7, ALL correct, ZERO misfiling.** Method fingerprints prove A/C/D/E fired on the real pipeline
(`+corrob_clear`×22, `+snap_corrob`×2, `+name_corrob_adopt`×4, `template_identity_corroborated`×4). **B FOLLOW-UP — RESOLVED 2026-08-16 as a NON-BUG (code-vintage artifact):** the mature-sandbox batch
reprocess ran 15:56; the B fix (`7141316`) was committed 19:00 — the batch simply ran the OLD leg.
Env/args parity across all 3 spawn paths verified; `mergeReprocessRows` is INNOCENT (used_new stores
the fresh row wholesale). The "trace mergeReprocessRows" lead was FALSE — do not chase it again.
Verdict: never filed a wrong value/folder — tidy the note copy and it's an unconditional yes.

