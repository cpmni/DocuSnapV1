# RESOLVE-THE-ISSUER — "Use '<name>'" button + operator supplier pin

**Date:** 2026-07-16 · **Status:** BUILT + tested under control-test-first working conditions (owner
directive). Advisor + Oracle designed (workflow `wf_bd226912-b1b`, SIGN-OFF-WITH-CONDITIONS). **NOT pushed.**
**Kill switch:** `SUPPLIER_PIN` (env, default on) disables all of Part B → byte-identical.

## Problem
A colliding-logo doc (e.g. MarloweMedicalSupplies_invoice_11.pdf) is mis-identified as another supplier
(Ridgeway Plant Hire) — the branding cross-check flags it and even DETECTS the true name, but that name was
being thrown away, and drawing/typing the correct supplier + hitting Reprocess **reverted** (the reprocess
re-runs the colliding logo match). Also: the queue badge showed a misleading **100%** on such a flagged doc.

## What shipped (staged, each kill-switched, control-tested vs a captured baseline)
Control baseline (295 confirmed docs, HEAD `c60a54e`): type/supplier/ref/date = 99.7/99.0/99.0/99.0%,
**M=1** (`#135` delivery_note ref), **M_type=0**, 9 regressions. Every extraction-touching stage's
kill-switch-OFF run was diffed against this and must be byte-identical.

- **Stage 0 — honest badge** (`review/renderer.js`, display-only): a flagged/un-fileable doc shows **"Check"**
  instead of a bare `100%` (the overall score ignores the flagged 69% issuer). Clean/low badges unchanged.
- **Stage A1 — "Use '<name>'" button** (`engine.py` already emits `suggested_supplier`; new persistence via
  **migration 49** `extractions.suggested_supplier` + `insertExtractions`/handler carry + `SELECT *`; the
  button in `appendFieldRow` on the branding note, regex DISJOINT from the issuer-accept button). Clicking
  fills the issuer via the customer-picker path (persists on Confirm). **Verified:** persistence round-trip +
  the `candidates` regression both green; **no Python touched → corpus byte-identical by construction.**
- **Stage B1 — operator supplier pin** (`engine.py` `pinned_supplier` param): the pin OVERRIDES the
  logo/template supplier — injected before the three `if not supplier_name` fill blocks (scopes the stages to
  the pin) AND re-asserted at the final re-resolve (Oracle C4). Method `operator_pin` + a validation_note keep
  it **review-bound at every floor** (a pin can never auto-file). Writes NO logo/hint learning. `process_docs
  --known-supplier` threads it. **Verified:** `test_supplier_pin.py` 11/11 (override / survive re-resolve /
  review-bound / branding-suppress C5 / kill-switch-off byte-identical); **corpus byte-identical to baseline**
  (harness passes no pins → M=1, M_type=0, 9 regressions unchanged).
- **Stage B2 — type/template re-scope** (`processing/handler.js` reprocess, Oracle C1): when the pin DIFFERS
  from the doc's current supplier, SUPPRESS the stale `--known-template-id`/`--known-doc-slug` (they belong to
  the wrong supplier) so the engine re-detects type + re-matches template for the pinned supplier.
- **Wiring** (B-slice 2): **migration 50** `documents.supplier_pin`; `resolve-issuer` IPC (mirrors
  accept-issuer, admin/edit, audited) + `preload.resolveIssuer`; the button writes the pin; **pin CLEARED on
  confirm** (both `confirm` + `confirmIfReviewable` — once learned, a stale pin must not override later).
  **Verified:** `test_supplier_pin_persist.js` 7/7 (migration / write / clear-on-confirm / null-inert).
- **Stage B3 — batch Reprocess-All pin** (`process_docs.py` `doc_overrides` + `processing/handler.js` manifest
  builder): the pin is carried PER-DOC in the reprocess manifest with the **no-global-leak** rule (mirrors
  `known_doc_slug_authority`, Oracle 2026-07-09) + the B2 template/type suppression on a supplier change.
  Byte-identical when no pin. **Verified:** `test_doc_overrides_pin.py` 5/5; **corpus BYTE-IDENTICAL to
  baseline** (the tuple arity 5→6 change is non-causal on the no-manifest path).

## Two findings from the control gate (Oracle C3 collision-poison probe)
1. **`logo_fingerprints.detail_hash` is NULL for ALL suppliers** (Ridgeway 5 prints, Marlowe) — the confirm
   enrolment plants the 256-bit detail into TEMPLATES, not `logo_fingerprints`. So the "256-bit self-heal via
   the logo resolver" (Slice D) is **partly inert** for these suppliers. **→ The pin fixes THIS doc, but B is
   NOT described as self-healing future docs** (they stay review-bound = fail-safe). This is a SEPARATE
   pre-existing gap (likely the deeper root of the Marlowe/Ridgeway collisions) — logged for its own look.
2. Because nobody's detail is enrolled in `logo_fingerprints`, the specific poison Oracle feared (Marlowe's
   detail enrolled, Ridgeway's NULL → collision re-opens) **can't happen** — and the pin enrols nothing
   anyway. So B is safe from the logo-poison angle.

## DEFERRED — B-safety (Oracle C2: Resolve→Confirm-WITHOUT-reprocess poison seam)
If the operator resolves then Confirms **without reprocessing**, the other fields were read under the OLD
scope and could be learned under the new supplier. **Deliberately deferred** (owner asleep, "do it safely"):
it touches the SHARED confirm/learning path (highest blast radius — a botched change breaks confirming for
EVERY doc), whereas the poison it guards is bounded, review-bound, recoverable (Learning Repair), pre-existing
(any supplier correction + confirm-without-reprocess has it), and **avoided by the intended flow: resolve →
Reprocess → Confirm** (the reprocess re-scopes to the pinned supplier via B1). Recommended next session: a
kill-switched guard in the confirm path that suppresses non-manual field learning when the pin differs. Until
then: `SUPPLIER_PIN=0` disables all of Part B, and the reprocess-first flow is safe.

## Revertibility
Every change is kill-switched (`SUPPLIER_PIN`) or additive (Stage 0/A1 display + nullable migrations 49/50 —
inert if unused). The feature is one revertible commit; migrations only ADD nullable columns (no data loss on
revert). Not pushed — left local for owner review.
