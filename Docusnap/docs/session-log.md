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

