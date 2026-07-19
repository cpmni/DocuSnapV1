# WORKFLOW SLICE 2 — concrete build plan (decision snapshot)

**Date:** 2026-07-19 · **Status:** BUILT + VERIFIED (gary SIGN OFF WITH CHANGES §10 + Oracle SIGN OFF WITH
CONDITIONS C1–C6 §11, all folded in; commits pending owner go-ahead). Default OFF ⇒ byte-identical.
**Parent spec:** `docs/designs/WORKFLOW_SUITE_2026-07-18.md` §5 (data model) + §9 (slice list). Builds on
Slice 1 (`WORKFLOW_SLICE1_BUILD_2026-07-18.md`, BUILT). Everything stays DARK behind the master
`WORKFLOW_FEATURE_ENABLED=false` — Slice 2 does NOT flip it (Slice 6). Additionally gated by its own
default-OFF `WORKFLOW_DECISION_SNAPSHOT`, so OFF ⇒ byte-identical is structural.

**Slice-2 scope (per §9):** an append-only `route_decisions` table + a snapshot written ONCE at resolve
+ a read/export path. **The WHY:** "reprocess-after-approval preserves the £ recorded at the decision" —
once a document is approved/rejected/acknowledged, an immutable record captures the supplier + reference +
total *as extracted at the instant of resolve*, so a later reprocess that changes the extracted total can
never rewrite what was recorded. It is also the substrate the Suite audit/export leans on. **Precise
semantic (Oracle C5, §11):** the value is captured *at the instant the decision is recorded* — NOT "what the
approver first opened" (an admin edit-lock override could reprocess a locked open-route doc mid-flight); no
consumer may treat it as a human-verified amount without a mid-flight-change guard.

---

## 0. Verified fact base (from the code, this session)

1. **Resolve seam** — `src/services/workflowService.js` `resolve(db, actor, routeId, {decision, comment,
   expectedVersion})`: after role/state/decision checks it runs `wf.updateState` (optimistic-version CAS) →
   `wf.setDocWorkflowStatus` → `audit(...)` → fire-and-forget PDF stamp (approve/reject) → `fresh =
   wf.getRoute` → `_notify(newState, fresh, actor)` → `return {ok:true, route:fresh}`. `newState` ∈
   `approved|rejected|acknowledged`. Best-effort injected hooks already exist (`audit`, `notifyWorkflow`
   wrapped so a throw never fails the action, `stampDecision`).
2. **DB layer** — `database/modules/workflow.js` is pure SQL. `getRoute` returns the `LIST_SELECT` join
   (documents → `supplier_name, reference_number, doc_date, doc_status, type_name, type_slug`). No update/
   delete of decisions exists (append-only will be enforced by *absence* of a mutator).
3. **Schema home** — the workflow schema block is UNSTAMPED + idempotent at the end of `runJsMigrations`
   (`database/index.js` ~986-1026): `CREATE TABLE IF NOT EXISTS`, no CHECK/version stamp (dark/experimental).
   `route_decisions` belongs in that same block (additive/inert). Highest STAMPED migration = 50.
4. **The extracted total lives in `extractions`**, not on `documents`: keyed `field_key IN
   ('total_amount','total','grand_total')`, stored as a DISPLAY STRING (`"£1,046.16"`). `overall_confidence`
   IS a `documents` column.
5. **Slice 4 (later) STAMPED-rebuilds `document_routes`** (CHECK + FK + grouping columns). Anything that
   FK-references `document_routes(id)` couples to that rebuild → argues for NO enforced FK here (see §A).
6. **Test harness** — `src/services/test_workflow.js` builds an inline `:memory:` schema + injects `audit`/
   `stampDecision`; `check(label,cond)` assertions; run under Electron-as-Node. Slice-2 service tests extend
   that `freshDb()` with `route_decisions`, an `extractions` table, and `documents.overall_confidence`.

---

## 1. Stage A — the `route_decisions` table (unstamped workflow block)

```sql
CREATE TABLE IF NOT EXISTS route_decisions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id              INTEGER,            -- the document_routes row resolved (NO enforced FK — see below)
  document_id           INTEGER,            -- denormalised so the record survives independent of the route
  actor_user_id         INTEGER,
  actor_username        TEXT,
  decision              TEXT,               -- 'approved' | 'rejected' | 'acknowledged'
  comment               TEXT,
  snapshot_json         TEXT,               -- JSON of what the approver saw (fields below)
  snapshot_total_amount TEXT,              -- the extracted total display string at decision time
  chain_position        INTEGER NOT NULL DEFAULT 1,   -- Slice 4 fills for multi-step; 1 for single-hop
  on_behalf_of_user_id  INTEGER,           -- Slice 5 (delegation); NULL in v1
  on_behalf_of_username TEXT,
  decided_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_route_decisions_doc   ON route_decisions(document_id);
CREATE INDEX IF NOT EXISTS idx_route_decisions_route ON route_decisions(route_id);
```

**NO enforced FK on `route_id`/`document_id` (proposed).** Rationale: (a) it is an append-only AUDIT log
that must survive Slice-4's `document_routes` stamped rebuild without cascade/rebuild coupling; (b) it must
NEVER cascade-delete. `document_id` is denormalised so the record stands even if the route later changes.
*(Open decision — gary to confirm vs. an FK + a documented Slice-4 preservation obligation.)*

## 2. Stage B — DB functions (`database/modules/workflow.js`)

- `insertRouteDecision(db, d)` — INSERT only (append-only by construction; no update/delete sibling).
- `listRouteDecisions(db, documentId)` — ordered read (the export/history reader).
- (Add both to the module's export object.)

## 3. Stage C — snapshot content

- `snapshot_total_amount` = the doc's extracted total DISPLAY STRING — a small lookup
  `SELECT COALESCE(display_value, raw_value) FROM extractions WHERE document_id=? AND field_key IN
  ('total_amount','total','grand_total') … LIMIT 1` (else NULL). Fidelity to "what the approver saw", not a
  computed number. *(Open decision — gary: also store a normalised integer-pennies form now for Slice-3
  amount-routing reuse, or leave normalisation to Slice 3?)*
- `snapshot_json` = `JSON.stringify({ document_id, supplier_name, reference_number, doc_date, type_name,
  total, overall_confidence, action_required, resulting_state })` — pulled from `wf.getRoute(fresh)` (join
  fields) + the total lookup + a `documents.overall_confidence` read. Display fields only (not the full
  extraction set) — smallest record that satisfies "the £ + who/what/when the approver saw".

## 4. Stage D — the write seam (in `resolve()`)

- Placed AFTER the successful `updateState` + `setDocWorkflowStatus` + `audit` (so the snapshot's
  `resulting_state` is the committed new state and no row is written on a CAS CONFLICT).
- Gated by `WORKFLOW_DECISION_SNAPSHOT` (env flag, default OFF, read at call time — matches the extraction-
  pipeline kill-switch idiom and is testable ON via env injection without flipping the master).
- Fires for `approved | rejected | acknowledged`. `chain_position=1`, `on_behalf_of=NULL` (forward-compat
  placeholders Slice 4/5 fill).
- **Best-effort, never fails the resolve** — wrapped in try/catch mirroring the `notify`/`audit` pattern (a
  snapshot write failure must not roll back an approval; the `document_routes` row + audit remain the source
  of truth). *(Open decision — gary: env flag + thin `wf.insertRouteDecision`, or an injected
  `deps.recordDecision` hook like `notifyWorkflow`? Leaning env-flag for the OFF-byte-identical gate; a dep
  hook is only better if it makes the throwing-never-fails-resolve pin cleaner.)*

## 5. Stage E — export / read (v1 scope)

- `listRouteDecisions` + a small read surface (show decision history + its snapshot in the existing mailbox
  detail / audit view). **Defer** a formal CSV/file export to a later sub-slice — keep Slice 2 to the durable
  record + a way to see it. *(Open decision — gary/owner: is "export" in §9 load-bearing enough to build a
  file export now?)*

## 6. Stage F — kill switch / dark posture

`WORKFLOW_DECISION_SNAPSHOT` default OFF ⇒ zero writes ⇒ byte-identical (the empty table is inert). The
master `WORKFLOW_FEATURE_ENABLED=false` keeps `resolve()` unreachable in production regardless, so Slice 2
is doubly dark. The table CREATE is unconditional/idempotent (additive), matching the Slice-1 unstamped block.

---

## 7. Open decisions for the gate (gary → Oracle)

1. **FK vs no-FK** on `route_id`/`document_id` (§A) — audit-log durability across the Slice-4 rebuild vs
   referential integrity. **Load-bearing** (bakes the data model).
2. **Total storage form** (§C) — display string only, or + normalised integer pennies for Slice-3 reuse.
3. **Write-seam mechanism** (§D) — env flag vs injected `recordDecision` hook.
4. **resolve() ordering** — snapshot AFTER `updateState` success (proposed). Confirm no race/ordering trap.
5. **Export scope** (§E) — read+display now, file export deferred.

## 8. Verification gate (house control-test rule)

1. **Baseline (pre-code):** `stress_test/realdoc_regression.js` → M=0 expected byte-identical (nothing here
   touches extraction/filing). Copy to `stress_test/out/workflow_slice2_BASELINE.md`.
2. **Per-stage:** the workflow-adjacent unit battery green (`test_workflow`, `test_workflow_ipc`,
   `test_v1_workflow`, `test_access_service`, `test_documents_cas`, `test_reviewservice`) + `node -c` on any
   touched JS.
3. **ON-behaviour via injection/env**, NOT by flipping the master flag.
4. **New tests:**
   - DB-layer (real `runMigrations`, `:memory:`): `route_decisions` created; `insertRouteDecision` writes
     the row; `listRouteDecisions` reads it back ordered; fresh DB has the table (idempotent, additive).
   - Service (`test_workflow.js`, extend `freshDb` with `route_decisions`/`extractions`/`overall_confidence`):
     flag ON ⇒ resolve writes exactly ONE decision row with the correct snapshot (supplier/ref/date/total/
     state); flag OFF ⇒ ZERO rows (byte-identical); a THROWING `insertRouteDecision` never fails the resolve
     (mirror the notify/audit best-effort pins); CAS CONFLICT ⇒ no snapshot row.
   - **PINS (a future dev can't silently regress):** (i) append-only — the snapshot survives a simulated
     reprocess that changes the doc's total (row unchanged); (ii) OFF ⇒ zero `route_decisions` rows across a
     full resolve flow.

## 9. What Slice 2 does NOT do (scope pins)

No `WORKFLOW_FEATURE_ENABLED` flip (Slice 6) · no amount routing / `workflow_route_rules` (Slice 3) · no
multi-step / grouping columns / `waiting` (Slice 4) · no delegation/escalation (Slice 5) · no `document_routes`
schema change (the `chain_position`/`on_behalf_of` columns live on `route_decisions`, not on routes) · no
formal file/CSV export (deferred) · no recall snapshot (recall is the sender withdrawing, not an approver
decision — out of scope unless the gate says otherwise).

---

## 10. GARY GATE (2026-07-19) — SIGN OFF WITH CHANGES (folded in; supersedes §7's "open" framing)

The five §7 decisions are RESOLVED:
- **FK (A): none.** `document_routes.document_id` is already `ON DELETE CASCADE` to documents
  (`database/index.js:1025`), so ANY FK here would either cascade-destroy the immutable audit on doc-delete
  or block Slice-4's stamped rebuild. `route_id` + `document_id` are plain indexed soft-refs. **Reciprocal
  Slice-4 obligation (document in the Slice-4 spec now): preserve `document_routes.id` across the rebuild**
  (copy id explicitly) so the soft-refs stay valid — it needs the ids anyway for `documents.workflow_status`.
- **Total (C): display string only; DEFER `snapshot_total_pennies`.** No trusted numeric normalizer exists
  today (documents.js inlines the SQL parse); an append-only row can never be corrected — the worst place to
  freeze a dropped-decimal parse (the exact class trust.js already guards); and Slice-3 amount-routing reads
  the LIVE total at route creation (spec line 66), NOT the snapshot. Add the pennies column later via an
  idempotent `ALTER TABLE ADD COLUMN` (NULL-inert) using Slice-3's normalizer, only if an "approvals over £X"
  report ever needs it. Deferring costs nothing.
- **Write seam (D): env flag read at CALL TIME** (`process.env.WORKFLOW_DECISION_SNAPSHOT`, mirroring
  `accessService.gateEnabled()`), short-circuiting a call to the injectable `wf.insertRouteDecision`. NO new
  `deps.recordDecision` hook — the throwing-never-fails-resolve pin is deliverable through the existing
  `deps.dbWorkflow` injection. Snapshot assembly goes in a pure `buildDecisionSnapshot(...)` helper (DB-free,
  unit-testable without a DB).
- **Ordering: AFTER the CAS guard** (`workflowService.js:168`, `if(!changed) return fail('CONFLICT')`).
  Writing before it would leave a phantom snapshot for a version-race loser in an append-only log. Build from
  the `route` join already in hand + the computed `newState`/`resolvedAt`/`decision` locals — NOT `route.state`
  (stale), NOT `fresh`.
- **Export (E): read + display now, file exporter deferred.**

Added by gary:
- **Append-only made STRUCTURAL (recommended):** `CREATE TRIGGER IF NOT EXISTS route_decisions_noupd BEFORE
  UPDATE OR DELETE ON route_decisions BEGIN SELECT RAISE(ABORT,'route_decisions is append-only'); END;`
  (idempotent; the table is never rebuilt, so it obstructs nothing). *(Oracle asked to confirm no future-
  migration obstruction — pending §11.)*
- **Go-forward-only:** dark-era + Slice-1 `paid`→`approved`-healed routes get NO snapshot; no backfill (there's
  no historical "what they saw" to reconstruct). Stated honestly in the spec.
- **Immutability caveat (one spec sentence):** the snapshot is the total **at the decision instant**, not "the
  pixels the approver first opened" — an admin edit-lock OVERRIDE (`editGuard` → `overridden:true`,
  `workflowService.js:47`) could reprocess a locked open-route doc between first view and decision. Low severity
  (admin, audited); "resolve-instant" is the defensible definition of "what was approved."

**Seams gary named:** (1) the invariant "total at resolve == total the approver saw" RELIES on the workflow
edit-lock (`hasActiveRoute` + `editGuard` + the Slice-1 reprocess-lock) blocking reprocess while a route is
open — do not weaken it. (2) "exactly one snapshot per committed decision" RELIES on writing after the CAS
guard. (3) Slice-3 has NO dependency on the snapshot (reads the live total) — resist ever making it read
`route_decisions`.

---

## 11. ORACLE GATE (2026-07-19) — SIGN OFF WITH CONDITIONS (C1–C6), all folded in + BUILT

No SEND BACK. gary's consensus verified sound on every load-bearing call (no-FK/soft-ref, display-string
total, env-at-call-time, write-after-CAS-guard). Premise HOLDS: the audit records only the transition (no
field values) and the stamp is fire-and-forget/unqueryable, so a snapshot-at-resolve is the correct minimal
substrate; DO-NOTHING is inferior. Fail-safe confirmed: both callers invoke `resolve()` outside any
transaction, the CAS `UPDATE` autocommits before the snapshot, and the try/catch means a snapshot throw can
never roll back the decision, never touch `documents.status`, and is unreachable in production (master off).

Conditions — ALL BUILT:
- **C1 — NULL-total robustness.** `documents.getExtractedTotalDisplay` is null-safe; a total-less doc
  (delivery note / acknowledge route) still snapshots with `snapshot_total_amount=NULL`. Pinned
  (`test_workflow_snapshot.js` §8).
- **C2 — doc-delete-preserves-snapshot.** With FK enforcement ON, deleting the parent document cascades the
  route + extractions away but the `route_decisions` row SURVIVES and stays readable — the pin that stops a
  future dev "restoring" an FK and silently destroying the audit (`test_route_decisions.js` §4).
- **C3 — triggers actually block.** Two `BEFORE UPDATE`/`BEFORE DELETE` triggers; a raw UPDATE and DELETE
  both throw (`test_route_decisions.js` §3).
- **C4 — idempotent ensure.** `route_decisions` has its OWN `if(!tableExists('route_decisions'))` guard (NOT
  nested in the `document_routes` block) + all-`IF NOT EXISTS` indexes/triggers; a double `runMigrations`
  no-throw is pinned (`test_route_decisions.js` §2).
- **C5 — semantic named + honest wording + consumer contract.** The captured value is "the extracted fields
  AT THE INSTANT OF RESOLVE", not "what the approver first saw" (an admin `editGuard` override,
  `workflowService.js` admin branch, can reprocess a locked open-route doc mid-flight, changing the whole
  snapshot). Stated in the `buildDecisionSnapshot` code comment + the WHY above; pinned both ways —
  append-only after the decision (§6) and resolve-instant for a pre-decision change (§7). FORWARD CONTRACT:
  no consumer (Slice-3 amount routing, payment auth, export) may treat `snapshot_total_amount` as a
  human-verified amount without a mid-flight-change guard.
- **C6 — Slice-4 obligation relocated.** "Slice 4 must preserve `document_routes.id` across its stamped
  rebuild" is recorded in the parent spec (`WORKFLOW_SUITE_2026-07-18.md` §5) + a comment on
  `route_decisions.route_id` (`database/index.js`). A rebuild of `route_decisions` ITSELF must use
  DROP+recreate (DROP is DDL, does not fire the triggers; a row-level UPDATE migration is blocked by design;
  the ensure-block recreates the triggers afterward).

**BUILT + VERIFIED 2026-07-19** (uncommitted, pending owner go-ahead):
- `database/index.js` — `route_decisions` table + 2 indexes + 2 append-only triggers (own guard).
- `database/modules/workflow.js` — `insertRouteDecision` / `listRouteDecisions` (INSERT-only, no mutator).
- `database/modules/documents.js` — `getExtractedTotalDisplay` (null-safe total display string).
- `src/services/workflowService.js` — `decisionSnapshotEnabled()` (call-time env), pure
  `buildDecisionSnapshot(...)`, env-gated best-effort write in `resolve()` after the CAS guard.
- Tests: `database/modules/test_route_decisions.js` (DB-layer; round-trip + C2/C3/C4 + append-only-by-absence)
  + `src/services/test_workflow_snapshot.js` (service; 30 checks — OFF=0 / ON=one-per-decision / CAS-loser=0 /
  throwing-recorder-safe / reprocess-preserves-£ / C1-null-total / C5-resolve-instant / env-at-call-time).

**Verification gate — GREEN.** Workflow-adjacent battery (`test_workflow`, `test_workflow_ipc`,
`test_v1_workflow`, `test_access_service`, `test_reviewservice`, `test_documents_cas`) all pass OFF **and**
`test_workflow` passes with `WORKFLOW_DECISION_SNAPSHOT=1` (the snapshot path exercised does not disturb the
`documents.status`-untouched invariant). Corpus `realdoc_regression` = M=0 byte-identical BY CONSTRUCTION
(zero code changed on the extraction/filing/trust/auto-file path; the harness never invokes `resolve()`).

**Deferred (noted):** the read/export UI surface (mailbox/audit display of the decision history) — the
`listRouteDecisions` reader exists and is tested, but the UI wiring is a thin follow-up and invisible while
the feature is dark under `WORKFLOW_FEATURE_ENABLED=false`.
