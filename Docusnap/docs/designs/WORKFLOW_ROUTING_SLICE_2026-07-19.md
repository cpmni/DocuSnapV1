# WORKFLOW ROUTING SLICE — build record (closes SEAM A; Barry reframe)

**Date:** 2026-07-19 · **Status:** BUILT + VERIFIED (Barry brainstorm → gary+eric → Oracle SIGN OFF WITH
CONDITIONS C1–C6 + owner decisions D1/D2, all folded; uncommitted). Default OFF (`WORKFLOW_AMOUNT_ROUTING`),
doubly dark under the master `WORKFLOW_FEATURE_ENABLED` const ⇒ byte-identical.

## The reframe (Barry + owner)
**Review = a data-completeness gate; routing = a separate business step that fires whenever a doc is FILED**
— auto-filed OR reviewed. Slice 3 wired routing only into the manual confirm path, so clean high-value docs
that auto-file silently skipped it (SEAM A). This slice fires routing at the FILING SEAM for every filed doc,
generalizes rules to **type** (not just amount), and adds a **workflow settings area** (rule builder + dry-run).

## Stages (all built + verified)
- **1 — engine** (`amountRouting.js`): null-total shadowing fix + honest hold (C1), type-only rules skip the
  amount trust-gate, route-to-self allowed / role-resolved-to-confirmer still SoD-blocked (C3), immutable
  `matchedRuleSummary` (C6), pure `dryRunRules` (C5).
- **2 — DB layer**: `matched_rule_summary` column + idempotent migration; `workflow.summarizeRule`;
  **`workflowService.assignSystem`** — the NULL-"Auto-filed"-sender route (the human `assign` refuses a machine
  actor), via a shared `_validateAssignTarget` (assign byte-identical, C4); rule CRUD.
- **3 — the wiring (SEAM A closure)**: routing fires in `_autoFileDoc` (via `assignSystem`, entitlement-parity
  deps C2) AND in `reviewService.confirm` on BOTH bulk and non-bulk (Oracle D2 — the "File All Ready" seam A');
  `!isRefile` + `hasActiveRoute` keep it one-route-max; both detached + fail-open.
- **4 — settings UI**: a hidden, entitlement-gated **Workflow** Settings tab — the plain-English rule builder
  (*"When a [type] is filed [and it's £X or more], send it to [person] to approve."*), the rules-as-sentences
  list (toggle/edit/delete), and the inline **dry-run** ("show me what this would do" over the last 30 filed
  docs, read-only — never creates a route). IPC in `workflow/handler.js` (admin + entitled + audited).

## Owner decisions (D1/D2) folded in
- **D1 — APPROVAL-ONLY v1.** An FYI/"just see it" route still edit-locks the doc (Oracle), contradicting
  "nobody's blocked". The engine supports `acknowledge`, but the rule builder offers **approve only** in v1.
  FYI ships when a follow-up makes acknowledge routes non-locking. (Barry: FYI is the more-loved half — do it next.)
- **D2 — bulk "File All Ready" routes now** (SEAM A' closed): routing fires on bulk confirm too.

## KNOWN LIMITATIONS / pre-live checklist (before `WORKFLOW_FEATURE_ENABLED` flips)
- **E1 — admin force-close/cancel-route.** A system (auto-file) route is NOT human-recallable (null sender),
  and an admin editGuard-override frees the *doc* but does NOT close the *route* (Oracle corrected gary here).
  So a system route to a later-deactivated recipient would workflow-lock the doc with no close path. **Add an
  admin cancel-route before enabling.**
- **E2 — "£X or more" copy** is honest only while the builder makes min-only rules (it does). If a max is ever
  offered, the copy must become a range.
- **Deferred (fast-follows, Barry order):** FYI/non-locking (D1) · suggested-rule starter kit · route-to-an-area
  (shared tray via the existing claim model) · supplier condition · "why it routed" surfaced on the doc view.

## Files
`amountRouting.js` · `workflowService.js` (assignSystem, _validateAssignTarget) · `workflow.js` (matched_rule_
summary, summarizeRule, rule CRUD) · `documents.js` (getExtractedTotalContext) · `index.js` (migration) ·
`processing/handler.js` (_autoFileDoc hook + _autoFileRouteDeps) · `reviewService.js` (bulk restructure) ·
`review/handler.js` (summarizeRule dep) · `workflow/handler.js` (rule IPC) · `preload.js` · settings
`index.html` + `renderer.js` (Workflow tab). Tests: `test_amount_routing.js`, `test_autofile_route.js` (SEAM-A),
`test_workflow.js` (assignSystem), `test_workflow_route_rules.js` (rule CRUD + captureTotalContext).

## Verification — GREEN
All safety pins pass: dropped-decimal-never-routes, type-only-skips-gate, no-shadow, route-to-self vs SoD,
master-dark, fail-open, byte-identical-off. Battery green: `test_amount_routing`, `test_autofile_route`,
`test_workflow`, `test_workflow_snapshot`, `test_reviewservice`, `test_v1_workflow`, `test_workflow_ipc`,
`test_route_decisions`, `test_workflow_route_rules`, `test_access_service`, `test_print`. Settings HTML
div-balanced; renderer `node -c` clean. **Corpus M=0 by construction** — no extraction/filing/trust-DECISION
code changed (`trust.currencyConsistentForField` is additive/inert; routing runs strictly after a completed file).
