# Workflow — FYI/acknowledge non-locking slice (2026-07-19)

**Status: BUILT 2026-07-19 (same session as the sign-off) — Oracle SIGN OFF WITH CONDITIONS C1–C8,
all folded in.** Verification: 20-suite gate green (12 workflow + 8 neighbour suites) incl. the new
batteries — editGuard ack/approve/mixed/env-polarity/'countersign'/NULL-action pins, delete-close
(pending+claimed→recalled+tombstone, CAS race, counts, empty⇒no-notify), /v1 delete C1 pair
(edit-role 409 / admin override closes+audits / FYI passes), batch-reprocess FYI pass + env restore,
rule IPC action allowlist (ack verbatim · missing→approve · garbage refused), summarizeRule grammar,
auto_closed toast-free + main.js ordering pin. BUILD FINDING: bare `<> 'acknowledge'` evaluates NULL
for a NULL action and would silently UNLOCK it — the shipped predicate carries an IS NULL arm
(fail-toward-lock covers NULL like any unknown; pinned). KNOWN while the owner's temp
`WORKFLOW_FEATURE_ENABLED=true` flip is in the tree: `test_entitlement.js` master-disabled pins fail
(pre-existing local-testing state, NOT this slice — clears when the flag reverts to false).
C1 (ship-blocker) /v1 delete gains editGuard (edit-role vs approval-locked ⇒ WORKFLOW_LOCKED; admin
override proceeds + close + audit) · C2 recoveryService close INSIDE its transaction, audit/notify
AFTER commit; bulk doors notify once per batch; zero-closed ⇒ no audit/notify · C3 test-comment
pinning why bulk delete-close ≠ skip-and-report (delete = visible cancellation, reprocess = silent
rewrite) · C4 eventDirection deliberate-omission comment + main.js badge-before-aggregate ordering
pin · C5 readonly-CAN-acknowledge / readonly-CANNOT-decide test pair · C6 resolution_comment must
RENDER on Completed rows (both mailboxes) · C7 snapshot comment re-anchor + "inbox shows live
fields" note · C8 doc-only: restore-from-bin leaves the route closed (sender re-routes); any-route
dedupe means an open FYI blocks a rule-triggered approval (audited noop, revisit with dedupe).
Placement rulings: hasActiveApprovalRoute (pure SQL) lives in database/modules/workflow.js; the
WORKFLOW_ACK_LOCKS env read lives in the SERVICE layer (lock policy ≠ data module). Barry (product)
+ gary (backend) + eric (UI/IPC) consensus preceded the vet.
Feature remains dark behind `WORKFLOW_FEATURE_ENABLED` (entitlementService.js:37). Baseline: all 9
workflow suites green pre-change (flag ON locally).

## 1. Product frame (Barry)
An approval is a GATE; an FYI is a POSTCARD — postcards never block. FYI that freezes the doc kills
trust in the whole feature. Decisions: (D-A) acknowledge routes never lock edit/reprocess/delete;
(D-B) one-route-max dedupe stays ANY-open-route v1 — but the `already-routed` refusal must be audited
(today it returns silently); no pierce/replace logic; (D-C) delete of a doc with an open route must
not leave a silent hole or a stuck route — close the route honestly at delete time (tombstone in
Completed), NOT a vanish; (D-D) wording: "for approval" / "for information" in the rule builder +
helper line "Approval holds the document until they decide. For-information never holds anything —
filing carries on as normal."; mailbox shows "For your information" + a "Got it" button (display
layer ONLY — DB/IPC value stays `acknowledge`). Keep-outs: approval-pierces-FYI, read-receipts
(auto-ack on open), FYI reminders, FYI stamping.

## 2. The lock split (gary)
- New `workflow.hasActiveApprovalRoute(db, docId)`:
  `state IN ('pending','claimed') AND action_required <> 'acknowledge'` —
  **polarity is NOT-acknowledge, not IS-approve** (fail-toward-lock: a future third action stays
  LOCKED until deliberately exempted). Values are a validated two-member set today
  (workflowService.js:141/169 are the only insertRoute callers).
- Exactly TWO read sites change: `workflowService.editGuard` (:46 — fixes all six lock call sites at
  once: review defer/restore/delete/confirm, single reprocess, repair-deconfirm, 3× /v1) and the
  batch-reprocess skip (`processing/handler.js:1568`).
- UNCHANGED consumers (pinned): dedupe (`amountRouting.js:121` + both deps builders), visibility
  `isOpenRouteParty` (any-route; accessService.js:66), all counts/badges (per-user, state-scoped).
- Kill switch: env **`WORKFLOW_ACK_LOCKS`** (`1/true/on` RESTORES old locking; default unset = new
  behaviour), read at call time (decisionSnapshotEnabled pattern). Default-new is safe because the
  feature is dark in production ⇒ zero routes ⇒ both polarities byte-identical. NO settings-table
  toggle (one authority for a lock policy). The delete-close helper is UNGATED (fail-toward-visible).

## 3. Delete-close (gary) — also fixes a PRE-EXISTING strand hole
FACTS: `delete-document` = soft delete (`status='deleted'`, row+files kept) — the
`document_routes ON DELETE CASCADE` fires only on hard purge. Soft-delete has SIX doors; only
`delete-document` is edit-guarded. Unguarded today: `delete-all-review`/`delete-all-deferred`
(review/handler.js:648), `repair-delete` (settings/handler.js:406), **`POST /v1/documents/:id/delete`
(api/handler.js:594 — no editGuard at all, remote)**, `recoveryService.setAside` (:84). At each, an
open route (approve OR ack) is stranded pending-forever in the recipient's inbox against a deleted
doc; a later purge cascade-vanishes it with no record.
- New standalone export `workflowService.closeOpenRoutesForDeletedDoc(db, { documentId,
  deletedByName })` → loops open routes → `updateState` CAS (row's own version; `changes===0` ⇒ a
  concurrent resolve won ⇒ skip) to state **`recalled`** (existing vocabulary — NO new state) with
  `resolution_comment = 'Document deleted by <name>'` + `resolved_at`; `setDocWorkflowStatus('recalled')`
  when anything closed. DB-only; CALLER audits (`workflow_route_closed_on_delete`) + notifies —
  the editGuard precedent. NOT inside `documents.softDelete` (wrong layer — data modules carry no
  business rules).
- Wiring: (must) `delete-document` after softDelete; (should, same slice — closes the pre-existing
  approve strand, flag in the commit as a pre-existing-hole fix) the five unguarded doors.
- Purge untouched. Go-forward only: already-stranded routes on previously-deleted docs are NOT
  healed (manual recall / a later one-shot heal — not this slice).
- Notify: `ctx.notifyWorkflowEvent({ event: 'auto_closed' })` (eric) — an UNKNOWN event name is
  deliberately badge-ping-only (`workflowNotify.eventDirection` → null ⇒ no toast), riding the
  existing `workflow-counts-changed` channel → Home card + Search mailbox repaint. No new channel;
  detached client lags ≤60s on its poll (accepted). [gary's draft said notify 'recalled'; the
  panel-reconciled choice is `auto_closed` — no toast for a route that died with its document.]

## 4. Dedupe audit (gary)
`already-routed` at amountRouting.js:121 now calls `_routeAudit(deps, docId, meta, 'noop',
'already-routed')`. The `disabled`/`not-entitled` returns (:119-120) STAY silent — they fire on every
confirm in a dark build (audit-spam guard, pinned by test).

## 5. UI/IPC (eric) — display layer only, /v1 contract unchanged
- Rule builder: `index.html:1430` span→`<select id="wf-b-action">` (for approval|for information);
  :1432 helper line (Barry's); :1417 intro widened. `renderer.js` `_wfBuilderPayload` +
  `wfResetBuilder` + **`wfEditRule` prefill (:129-143 — MUST read `r.action_required`; without it,
  editing an FYI rule silently converts it to approve on save)**.
- Handler: `workflow/handler.js:100` — server-side allowlist in `_validateRule`: missing → 'approve'
  (stale-renderer back-compat); explicit value ∉ {approve,acknowledge} → validation error. The D1
  approve-pin is deliberately FLIPPED (renderer trust replaced by the handler allowlist).
- `summarizeRule` (workflow.js:214): GRAMMAR — template is "send it to X to ${act}"; restructure to a
  phrase: acknowledge → "…send it to X for information."; approve byte-identical ("…to approve.").
  Stored per-route summaries stay immutable (Oracle C6) — no migration, old sentences keep "just see it".
- Mailbox copy (core `search-workflow.js:87/106/129/139`, `search-mailbox.js:50` + client twins
  `client/renderer/renderer.js:1047/1068/1229/1275/1310`): "For your information", button "Got it",
  state chip label may read "seen" but CSS class keeps raw `r.state`. Sent/Completed already render
  acknowledged routes (copy-only). Home card copy: "waiting for your decision" → "waiting for you"
  (main/renderer.js:263).
- No preload change (rule payloads pass through verbatim; assign already names actionRequired).
- `WORKFLOW_LOCKED` has ONE emitter (editGuard) — post-split its "approval workflow" copy is true by
  construction; no renderer branches on the code.

## 6. Seams (named per house rule)
- RELIES ON upstream: `action_required` two-member validated set; `updateState` CAS; never-throw
  notify wrapper; `listCompleted` includes 'recalled'.
- DISABLES downstream: the FYI edit-lock — doc mutation mid-FYI-route becomes ROUTINE (was
  admin-exceptional). Absorbed by the Slice-2 snapshot contract ("fields AT THE INSTANT OF RESOLVE",
  workflowService.js:63-68) — comment must be re-anchored to the widened window. Ack carries no
  decision authority + never stamps (stamp gated decision approve/reject, :266) ⇒ no wrong-value
  commitment path. Delete-close ends the isOpenRouteParty grant the moment the inbox item closes (no
  orphan visibility on a deleted doc).
- OPEN QUESTION for Oracle: ack resolve is allowed for ANY role incl. readonly
  (workflowService.js:229-231) and neither renderer gates the button (`_canDecide` not applied) —
  deliberate ("everyone" flavour) or gate?
- HYPOTHESES (manual smoke, harness can't reach): detached client mid-view of an FYI doc
  deleted+closed under it; workflowNotify debounce shape-agnostic to the new event (one-line check).

## 7. Tests (gary; counts approximate)
- `test_workflow.js` 69→~81: ack ⇒ editGuard ok (THE PIN: "FYI never edit-locks — do not re-lock");
  approve ⇒ locked; ack+approve both open ⇒ locked; `WORKFLOW_ACK_LOCKS=1` ⇒ ack locks (polarity
  pin); unknown action 'countersign' raw row ⇒ STILL LOCKED (pins <> 'acknowledge'); delete-close
  battery (pending+claimed→recalled+comment+resolved_at; CAS race skip; countInbox −1 / countCompleted
  +1; notify fired).
- `test_amount_routing.js` 55→~59: dedupe fires on open ACK route (pins any-route dedupe);
  already-routed audits 'noop'; disabled/not-entitled still silent (spam pin).
- `test_reprocess_lock.js` 10→~13: batch does NOT skip ack-routed doc; single reprocess passes; env
  restores skip; existing approve pins (incl. admin-batch-skips :117) unchanged.
- `test_workflow_ipc.js` +~3: rule stores 'acknowledge' verbatim; garbage → 'approve'; D1 pin flip
  commented with this slice's name.
- eric: summarizeRule grammar pin; delete fires notify once (spy), not on route-less delete;
  `workflowNotify.aggregate(null,{event:'auto_closed'})` returns input (no-toast pin).
- NO corpus run: zero extraction/trust/engine files touched; routing change is audit-only on a
  detached fail-open path; dark ⇒ no routes ⇒ byte-identical. Gate = the 9 workflow suites + the
  18-suite battery.
