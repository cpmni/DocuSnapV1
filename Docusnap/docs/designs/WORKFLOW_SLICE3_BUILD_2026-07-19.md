# WORKFLOW SLICE 3 — build record (amount-threshold routing, the flagship)

**Date:** 2026-07-19 · **Status:** BUILT + VERIFIED (gary SIGN OFF WITH CHANGES + Oracle SIGN OFF WITH
CONDITIONS C1–C6, all folded; uncommitted pending owner go-ahead). Default OFF ⇒ byte-identical; doubly
dark under the master `WORKFLOW_FEATURE_ENABLED` const.
**Parent:** `docs/designs/WORKFLOW_SUITE_2026-07-18.md` §5/§9 (C4). Builds on Slices 0–2.

## What it does
After a document is confirmed, auto-create an approval route from the £ ScanFinder extracted ("invoices
over £5,000 → route to a manager"). Behind default-OFF `WORKFLOW_AMOUNT_ROUTING`.

## The gate (gary → Oracle) — both plan-breakers gary caught, all Oracle conditions built
- **Note-clear timing (gary #1, Oracle A1):** `reviewService.confirm` clears the total's `validation_note`
  (:167) BEFORE the detached hook (:209). So the trust context is captured in the (:151,:167) window via
  `captureTotalContext` (a gated hook; no-op → null when off ⇒ byte-identical), reading the note+confidence
  from the SAME highest-confidence total row (`documents.getExtractedTotalContext`).
- **Corrected-total confidence (gary #2, Oracle):** a human-corrected total keeps stale machine confidence,
  so `was_corrected` (derived from the CORRECTIONS PAYLOAD, `totalKey in corrections`, not the sticky row)
  BYPASSES the note/confidence floor — but STILL must pass `currencyDpConsistent` (a human odd value falls
  to manual, never mis-routes).
- **The trust predicate (gary/Oracle B):** NARROW + total-only (`docTrustGate` is too broad and never checks
  the total's confidence; the auto-file critical floor is ref/date-only). `totalSafeToRouteOn` composes:
  `totalToPennies != null` AND `trust.currencyConsistentForField` (reuses the SAME `_scopeFormats →
  _currencyDpConsistent` the auto-file gate uses) AND (was_corrected ? ok : no-note AND conf≥
  `critical_field_conf_floor`).
- **Pennies parser (Oracle A2):** string-based, never float; DECIMAL PADDING (`£5000.5`→500050); 3+dp /
  ambiguous / garbage → null → manual; negatives parse but never match a ≥0 band.
- **Re-file / lock guard (Oracle B1):** the hook is gated `!isRefile` AND `startDefaultRoute` early-returns
  on `hasActiveRoute` — an "Edit in Review" of a settled doc can't spawn a second route or re-lock it.
- **Runtime master gate (Oracle):** `startDefaultRoute` checks the REAL entitlement
  (`checkClientEntitlement(db).workflow.entitled`, false while the `WORKFLOW_FEATURE_ENABLED` const is
  false) at call time — a dark build can NEVER create a route that would strand a locked doc.
- **Role + SoD (Oracle D1):** resolve `target_role` → active members: 0 or ≥2 → HOLD+audit (multi-member
  routing deferred to Slice 4); exactly-1 → route unless that one is the confirmer → SoD HOLD+audit. The
  confirmer's `userId` is threaded into the confirm actor (`sess.id`). Practical v1 path = `target_user_id`
  (a named manager), since most manager ROLES have ≥2 people.
- **Hold semantics (Oracle C4-#1):** a just-filed doc CAN'T be re-flagged (note wiped; not in the review
  queue). v1 records an AUDIT reason only for every hold/malformed path; the `needs_routing` lane marker is
  a documented fast-follow (deferred rather than risk a new `workflow_status` value on unverified consumers).
- **Fail-open, detached:** route creation runs in confirm's `!bulk` detached block, try/caught — can never
  slow or fail the confirm, touch `documents.status`, or reach production while dark.

## KNOWN LIMITATIONS (Oracle — on the pre-default-ON checklist, must be resolved before flipping)
- **SEAM A — auto-file / bulk / /v1 bypass (the important one).** Routing is wired into
  `reviewService.confirm`'s non-bulk block. But a clean, confident, high-value invoice from a GRADUATED
  supplier **auto-files** (never hits confirm), bulk Reprocess-All confirms pass `bulk:true`, and `/v1` is a
  no-op. So the exact high-value docs an org most wants approved can silently skip the control. SAFE (no
  wrong route is ever created), but the flagship is INCOMPLETE until this is addressed — routing docs with no
  human eyes on the total is a higher-risk, separate slice. **Product decision owed before default-ON.**
- **New-supplier currency gap (accepted, Oracle E1/E2):** `currencyDpConsistent` can't judge under 5 samples,
  so a NEW supplier's dropped decimal passes → OVER-routes (dropped decimals read HIGH), toward MORE human
  oversight = the safe direction. Frame in-product as a "fail-toward-more-oversight convenience, NEVER a
  guarantee every high-value doc is caught" (the total isn't a filing-critical field, so the prior human
  confirm is only a partial backstop). Pinned as INTENDED so a future dev doesn't "fix" it into a silent drop.
- **Deferred (pinned, name each):** rules-management UI (dev/test-seeded in v1) · multi-member role routing ·
  `/v1`-triggered routing · bulk/auto-file routing · multi-step (`step_order` unused) · multi-currency band
  awareness · the `needs_routing` hold-lane surface.

## Files
- `database/index.js` — `workflow_route_rules` table (own guard, `CHECK` target present, no FK on
  target_user_id, pennies).
- `database/modules/workflow.js` — `insertRouteRule` / `listActiveRouteRules`.
- `database/modules/documents.js` — `getExtractedTotalContext` (same-row value/conf/note).
- `database/modules/trust.js` — `currencyConsistentForField` (reuses `_scopeFormats`+`_currencyDpConsistent`;
  additive/inert to existing trust/auto-file decisions).
- `src/services/amountRouting.js` — `totalToPennies`, `findMatchingRule`, `totalSafeToRouteOn`,
  `captureTotalContext`, `startDefaultRoute`, `amountRoutingEnabled` (call-time env).
- `src/services/reviewService.js` — 2 injected hooks (default no-op); capture before the note-clear;
  detached `!isRefile` route call.
- `src/modules/review/handler.js` — desktop wiring of both hooks with real deps; `userId: sess.id` threaded.
- Tests: `src/services/test_amount_routing.js` (parser/matcher/predicate/orchestrator — all safety pins) +
  `database/modules/test_workflow_route_rules.js` (table + CHECK + the pre-clear `captureTotalContext`).

## Verification gate — GREEN
Slice-3 suites pass (incl. the dropped-decimal-never-routes pin, was_corrected-bypass, master-dark,
idempotency, SoD, single-member-routes-vs-ambiguous-holds, decimal-padding). The regression battery
(`test_reviewservice`, `test_workflow`, `test_v1_workflow`, `test_workflow_ipc`, `test_documents_cas`,
`test_route_decisions`) is green — **`test_reviewservice` proves the confirm path is byte-identical with the
default no-op hooks.** Corpus M=0 by construction (no extraction/filing/trust-decision code changed — the new
`trust.currencyConsistentForField` is inert until amountRouting calls it).
**LIVE-VERIFY GAP (like the print driver-dialog):** the full confirm→route creation is NOT auto-tested
end-to-end (the master const is false, so a route can only be created with a stubbed entitlement; the wiring
is exercised via unit deps + the real `captureTotalContext`). Verify a real auto-route once the feature is
entitled. Fail-open means a wiring bug degrades to "no route + a console warning," never a crash or wrong route.
