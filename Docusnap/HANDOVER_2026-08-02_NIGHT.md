# HANDOVER 2026-08-02 NIGHT (session wrap; follows HANDOVER_2026-08-02_OVERNIGHT.md — read that for the overnight/day arc)

Branch `feat/reprocess-throughput-autostraighten` · last commit **`5652487` PUSHED, tree clean**
(untracked = old handovers + owner backup dirs only, pre-existing) · installer still `5b5d344`-era
(predates the whole week — rebuild to ship) · owner present all evening.

## TL;DR
Evening arc on top of the overnight/day file: **teach-first flow consulted and PLANNED** (barry +
gary parallel → Oracle vet → signed plan `docs/designs/TEACH_FIRST_FLOW_2026-08-02.md`, oracle_log
entry) · **Document-detail DTO BUILT** (`b747676` — single-doc click de-pathed, full read
Review-only) · **two-step Approve arm BUILT** (`32b4c38`, owner go) · **template-system fine-tuning
declared the owner's NEXT MAJOR ARC** (banked with two live exhibits + the SFDEV every-step trace
order) · five owner live-repro items banked to pendingfeatures.

## NEXT-SESSION ORDER (owner-set, in this order)
1. **Template-system fine-tuning arc** — owner: "We will work on fine tuning the template system
   soon." Entry: pendingfeatures "Template-system FINE-TUNING + 'all methods, then verify'" (two
   exhibits: SFDEV trace showing only template_mapping+keyword with mapping reads wrong; Northgate
   PO _02 showing anchor_inline-only, no mapping, no keyword, correct value still flagged).
   Investigation list is in the entry.
2. **SFDEV EVERY-STEP trace** — owner order, explicitly "next session, NO code this session":
   every stage/rung per field emits attempted-or-skipped(reason); inspector renders the full
   ladder; `--trace`-gated so normal processing stays byte-identical. Entry in pendingfeatures.
   **This is the observability the fine-tuning arc will be judged against — likely build it FIRST.**
3. **Teach-first plan → owner reads `docs/designs/TEACH_FIRST_FLOW_2026-08-02.md`** and decides.
   If approved, S0 (corpus two-arm gate) is the first build — harness only. Do NOT start S1+
   without S0 numbers. Sequencing seam: S1/S1.5 land AFTER catch-up slice 4 (consent-bar pattern
   reuse — Oracle).

## Committed this evening (all pushed)
- `a58bc10` de-pathing + role gate + Chris r5 agreed set (overnight file §8).
- `32b4c38` two-step arm on Approve ("Confirm — approve and stamp with your name", 5s revert) —
  Chris r5 card 3, bob ruling, owner go.
- `b747676` **Document-detail DTO**: NEW `get-document-detail` IPC (previewService.getDocumentDetail
  → `dto.projectDocumentDetail` — the /v1 trust-boundary shape reused verbatim); search preview /
  mailbox click / resubmit fetch the PROJECTED detail; `get-document-with-extractions` (full read)
  now `requireRole('admin','edit')` — Review-only BY DESIGN (consumes folder_path + ocr_text).
  Pins: `src/windows/search/test_search_detail_depathed.js`. Regression suites green.
- `4c384a2`/`7b195e3`/`56fe202`/`ce97db6` pendingfeatures banks (owner live repros): focus-fix
  field sweep + forward convention · core Search re-skin to client design · search preview
  eternal-spinner hardening · Home Open-Mailbox deep-link.
- `b8cfe26` template fine-tuning arc banked (+ overnight handover §9 + checklist item 6).
- `5652487` **teach-first PLAN** + oracle_log adjudication + SFDEV every-step entry.

## Teach-first plan — the 30-second version (full: the design doc)
Reframe SIGNED: teach = primary response to a NEW LAYOUT; import-first is STRUCTURALLY FORCED
(wizard doc-picker reads the review queue — teach/renderer.js:1034). Programme is
**EXTRACTION-INERT** after Oracle surgery: S4 vouchers DELETED (Stage-0.5 reads already
corroborate — engine.py:2952), barry's auto-reprocess flagship SENT BACK (bypasses the
renderer-side pending-edits guard) → S1.5 consent-gated heal button, de-jargon precondition STALE.
Key sell: the ⊕ path EXCLUSIVELY arms the ownership validation cap (wizard never writes
field_anchors) — "Every fix teaches it — and arms a check." Build order S0 → C2 (wizard type-pick
guard — the one new-harm path) → S1 dark+PIN → S3 banner → S2 ⊕-conflict surfacing → S1.5.
Rejections PINNED: gate-first · teach>1-toward-W · fourth positional validator.

## Verification state (honest)
- DTO: pin suite + 5 regression suites green (contract, workflow-IPC, hold-reason,
  initial-selection, collisions). Owner hit the stale-main eternal spinner LIVE before restarting
  the dev app (main predated `b747676`) — restart cleared it; hardening banked.
- Two-step arm: source-level checks only; owner exercised the workflow live earlier (r5 flow).
- Teach-first: PLAN ONLY — nothing built, no code touched by the consult.
- NOT verified this session: Chris r1 cards in live UI (renderer loads on next Review open);
  pre-existing `test_anchor_crop_crosscheck.py` case-7 RED still awaiting its this-week triage.

## Needs the USER
- Read the teach-first plan; go/no-go on S0.
- Standing queue from the overnight file: vet Chris r5 remaining flags (terms WORKING-DRAFT gate) ·
  GT-poison exhibits eyeball (doc86/154/285 + doc218) → Learning Repair · W1-W3 clamp watch bars ·
  Customer Doc Test teaching run continues (it's what surfaced the template exhibits).
- Reproduce-first before building (likely Chris-driver artefacts): approve-note-box discrepancy,
  batch-reprocess feedback.

## Key facts / running state
- **Switches now ON** (flipped by owner order this day): `ANCHOR_LABEL_LEFT_CLAMP` ·
  `scope_sweep_enabled` · `WORKFLOW_FEATURE_ENABLED=true` (entitlementService, code const).
- Owner's dev app: running post-restart (has `b747676` main). Chris sandbox: separate userData via
  `DOCUSNAP_USERDATA` env (dev-only hook), CDP 9223, seeded license — `scripts/seed-chris-sandbox.js`;
  window capture via `scripts/capture-window.ps1` (PrintWindow; CDP screenshots hang on this build).
  `/christest` skill = the sandbox vet procedure.
- Corpus: `C:\Users\cmccu\Desktop\Customer Doc Test\` (Digital + Scanned sets, ground_truth.json,
  10 issuers + Bramblewood owner co; generator `stress_test/gen_customer_test.py`).
- Live DB: `%APPDATA%\ScanFinder\docusnap.db` (read-only rule). Tests: JS via Electron-as-Node,
  Python via `py -3.12` (see reference_running_test_suite memory).
- Chris review docs: `docs/CHRIS_FULL_APP_REVIEW_2026-08-02.md` (rounds 2-5 verbatim).
