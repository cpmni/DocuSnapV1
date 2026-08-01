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
