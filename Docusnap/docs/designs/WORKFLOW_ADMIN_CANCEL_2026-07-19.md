# Workflow — E1 admin cancel-route (2026-07-19)

**Status: BUILT 2026-07-19 (same session) — Oracle SIGN OFF WITH CONDITIONS OC1–OC4, all folded.**
Verification: 19-suite gate green (test_entitlement excluded — known flag-flip failure). New
batteries: service (~20 checks: the recall-can't-reach-it hole pinned, non-admin FORBIDDEN ×2,
claimed cancels, lock release, inbox count, admin_cancelled once + aggregate-ignores, never
stamps/snapshots with env armed, INVALID/NOT_FOUND/CONFLICT, gary-C1 two-route stamp pair,
dedupe-freed, deleted-recipient, OC3 soft-deleted-doc route, OC2 comment triple, recall-stays-
narrow trade-off pin) + IPC (~8: role gates on all three IPCs, OC4 projection no stamped_path/
comment, OC3-ii deleted-doc row listed with doc_status, end-to-end cancel). BUILD NOTE: the
'paid' blocks in test_workflow.js deliberately leave open routes on doc 1 — the battery settles
them first (test-setup, not product behaviour). Rulings: no
closed_reason column now (audit actions are the machine provenance; column mandatory at producer
#4 OR first localisation of the comment strings); Settings list IS E1, in-slice; deleted-doc rows
INCLUDED labeled via doc_status (fail-toward-visible healing surface); ~5s arm window accepted
(resolve re-fetches → a mid-cancel approver gets truthful INVALID "already recalled", not the
CONFLICT lie — verified); admin/edit read + admin-only cancel coherent. OC1 renderer error
lifecycle: the async container carries `.wf-routed` FROM CREATION + population is append-only so
a `.wf-err` survives. OC2 discriminator pin test (NULL / "Document deleted by…" / "Cancelled
by…") + no-code-branches-on-comment-text comment. OC3 pins: cancel succeeds on a soft-deleted
doc's route (no ROUTABLE_STATES check ever on the cancel path) · open-routes includes deleted-doc
rows · open-routes carries the same projection guard (no stamped_path). OC4: `comment` DROPPED
from the doc-routes projection (banner never renders it; don't ship the sender's note to edit
renderers). gary GO-WITH-CHANGES (C1–C4) + eric folded per §2–4.
The last pre-launch "document stuck" hole. Feature dark behind `WORKFLOW_FEATURE_ENABLED`.

## 1. The hole (verified)
`recall` is sender-only + pending-only (workflowService.js:332-333). So: a SYSTEM route
(`assignSystem`, `from_user_id` NULL) is recallable by NOBODY; a CLAIMED route by no one at all;
a route to a later-deactivated recipient can never resolve — an approve route then locks the doc
forever (admin editGuard override frees individual actions, never the route). A null-sender route
also appears in nobody's Sent box, so it has NO discovery surface today.

## 2. Service (gary-corrected)
`adminCancelRoute(db, actor, routeId, { reason, expectedVersion })` in createWorkflowService —
SEPARATE from `recall` (whose narrow semantics drive the Sent-box button and are PINNED: do not
widen) and from `closeOpenRoutesForDeletedDoc` (differs on every axis: one-route vs all, attributed
vs system, service-audits vs caller-audits; shared mechanic is already `wf.updateState` CAS).
- Role gate IN THE SERVICE (`actor.role !== 'admin'` → FORBIDDEN) as well as the IPC — belt+braces.
- Accepts state ∈ {pending, **claimed**} (claimed is exactly the stuck case); else INVALID/NOT_FOUND.
- CAS close to `'recalled'` (existing vocabulary; Send-again keys on 'rejected' only — safe) with
  **resolution_comment ALWAYS non-null** (C3 — it is the producer discriminator vs sender-recall
  NULL vs delete-close "Document deleted by…"): `Cancelled by <name> (administrator)` +
  optional `: <reason>` (reason optional per gary Q3 — required-reason adds friction at the jam;
  the UI offers no input v1, the service accepts it for the API/tests).
- **C1 multi-route stamp**: `setDocWorkflowStatus('recalled')` ONLY if `hasActiveRoute` is now
  false (a doc can carry several open routes — manual assign has no dedupe); else leave
  `workflow_status` to the surviving route. (recall/resolve share the blind-stamp defect —
  pre-existing, display-only, editGuard never reads workflow_status; NOT this slice.)
- Audit `workflow_route_cancelled` (route id, to_username, reason-present in details).
- **C2 notify `'admin_cancelled'`** — a DISTINCT deliberately-unlisted event (badge-ping only,
  no toast; the auto_closed pattern), added to the eventDirection omission comment + aggregate
  pin. NOT 'recalled' (would couple admin cancels to any future sender-recall toast decision).
- Never stamps / never snapshots (verified by construction — both live only inside `resolve`).
- Cancel works when the recipient is deactivated OR the user row is deleted (getRoute joins
  documents+types only, never users — pinned).

## 3. IPC + preload (eric)
- `workflow-admin-cancel` (`requireRole('admin')` + assertEntitled + service re-check).
- `workflow-doc-routes` (`requireRole('admin','edit')` + assertEntitled + **accessService.
  canAccessDocument — a NEW by-id read seam; skipping it reopens SEC-03 as a 7th hole**) —
  returns OPEN routes for a documentId, PROJECTED shape `{id, to_username, from_username,
  action_required, state, comment, created_at, version}` (C4 — no stamped_path, no SELECT *).
- `workflow-open-routes` (admin; the Settings list): ALL open routes joined with filename/
  supplier, same projection + document_id + a display name. Also access-gated per doc? — it is
  admin-only and list-wide; admin passes canAccessDocument by role, no per-doc gate needed.
- Preload: `workflow.adminCancel(id, version)` · `workflow.docRoutes(documentId)` ·
  `workflow.openRoutes()` — verbatim invoke shapes.

## 4. UI (eric)
- **Search preview banner**: `_provide`'s assign-form branch returns a self-populating container
  (`_routeOrAssign(doc)`) — async `docRoutes(doc.id)`, staleness-guarded (`node.isConnected` +
  `selectedDoc.id`), renders NOTHING until resolved (never swap a form under typing hands). Open
  route(s) not mine → one banner per route: "Routed to <to_username> — awaiting
  <approval|information>" (textContent only) + admin-only **[Cancel route]** as a TWO-STEP inline
  button ("Confirm — remove from <name>'s inbox", ~5s auto-revert; NO native confirm() — the
  Search window is an unarmed focus-desync site). Else → the existing assign form. Error re-show
  selector at search-workflow.js:53 gains `.wf-routed`. After-cancel refresh rides `_run` +
  the existing workflow-counts-changed listener chain unchanged (verified end-to-end; the
  recipient's decision bar disappears within the 400ms debounce, silent — no toast, v1-accepted).
- **Settings → Workflow "Open routes" admin list** (eric #5 — the REAL E1 discovery surface for
  null-sender routes; IN this slice): flat list under the rules — filename · to · awaiting · age ·
  [Cancel] (same two-step + same IPC), `loadWorkflowRules` style, refreshed on tab open + after
  cancel.

## 5. Seams
- Cancel ends the recipient's `isOpenRouteParty` visibility grant at once (same as delete-close;
  correct — the Completed tombstone remains). HYPOTHESIS (manual smoke): detached client
  mid-preview of a doc whose route is cancelled under it.
- Cancel frees the doc for the routing dedupe (`hasActiveRoute` → false) — intended, pinned.
- A cancelled human-sender route still shows in the sender's Sent as `recalled` + the
  "Cancelled by <admin>" comment (renders via the FYI-C6 Reason line) — sender learns, free.
- RESIDUAL (accepted, documented): a stranded open route on an ALREADY-deleted doc (pre-FYI-slice
  legacy) is closable by the service but reachable by NO UI in this slice (Search won't surface a
  deleted doc; the Settings list joins live docs — decide: filter deleted docs OUT (v1) and note
  the residual, or show them greyed; v1 = show rows whose doc is deleted TOO, since the list join
  can include doc_status and that IS the healing surface for legacy strands — Oracle to confirm).
- Desktop-only; no /v1 change; the client's Recall stays sender-only.

## 6. Tests (gary; ~19 new)
`test_workflow.js` +~13: non-admin(edit+readonly) FORBIDDEN · headline system-route cancel
(recall FORBIDDEN first, then cancel OK + comment prefix + resolved_at) · claimed cancels ·
closed→INVALID · missing→NOT_FOUND · stale version→CONFLICT untouched · lock-release
(editGuard locked→ok) · C1 two-routes stamp pin · snapshot-env ON writes ZERO route_decisions +
stamp stub uncalled · notify spy fires 'admin_cancelled' once + aggregate returns input ·
counts (inbox −1, completed +1) · dedupe-freed (fresh assign succeeds) · deleted-recipient row ·
TRADE-OFF PIN: recall STAYS sender-only+pending-only ("admin cancel is the deliberate escape
hatch; do not widen recall"). `test_workflow_ipc.js` +~4-6: admin-cancel rejects non-admin +
unentitled; doc-routes admin/edit-gated + access-gated + projected shape (no stamped_path) +
open-only; open-routes admin-only. No corpus run (zero extraction files; dark ⇒ byte-identical).
