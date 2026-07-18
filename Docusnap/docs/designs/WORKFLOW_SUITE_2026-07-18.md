# WORKFLOW SUITE + DOCUMENT PRINT — design (Barry-chaired panel, Oracle-signed)

**Date:** 2026-07-18 · **Status:** DESIGNED, NOT BUILT. Workflow suite: Oracle **SIGN OFF WITH CONDITIONS (C1–C8)**, folded in. Print subsystem: eric-designed, explorer-verified. Owner approved the plan; **8 open owner decisions remain (see §Decisions) — build held pending answers + the owner-in-loop staged go-ahead** (one decision, readonly-as-recipient, shapes the Slice-0 authz predicate).
**Panel:** barry (chair/vision) · eric (architecture + print) · gary (engine/data) · security analyst (authz) → Barry synthesis → Oracle. Grounded in 3 code explorers + a 4-beat web-research digest (DocuWare/M-Files/Laserfiche/FileHold · Teams/PandaDoc/DocuSign · paperless-ngx/Mayan/Alfresco · practice/packaging).

---

## 1. What it is + the demo
The Workflow Suite ("**ScanFinder Approvals**") **completes and frames a single-hop approval mailbox that already exists** — wired end-to-end (`document_routes` with CAS versioning, a cross-system edit-lock, decision PDF stamping, audit trail, a per-user workflow seat pool, and TWO front-ends: the core Search-window mailbox + the detached-client mailbox on one transport-agnostic `workflowService`) — held dark behind `WORKFLOW_FEATURE_ENABLED=false` (`entitlementService.js:37`). We are not building an engine; we complete one, fix the authorization hole that makes routing safe, and add one flagship the market can't match.

**The demo:** import a supplier invoice → **Send for approval** → it lands in the manager's client inbox already showing the vendor and the **£ total ScanFinder extracted** → Approve → stamped PDF + immutable audit line, sender's badge turns green. Fifteen seconds, zero config. "The amount is already there, for free" is the whole pitch — every competitor sells extraction and approval separately and re-keys the amount.

## 2. Architecture verdict (decided)
**Engine + authz + seat caps + CAS live in the CORE main process; approvers act through the DETACHED CLIENT they already run; the admin/filer uses the core Search-window mailbox. No third standalone app.** One `workflowService` already serves both transports (desktop IPC `workflow/handler.js` + `/v1` `api/handler.js`) with an explicit `{userId,username,role}` actor; both mailbox UIs exist. A third binary = new signing/update/enrolment/CSP surface to reproduce a shipped mailbox — refuse it. The core is the single SQLite source of truth (seat caps + the CAS double-resolve guard run in one process).

## 3. Slice 0 — AUTHZ PREREQUISITE (ships before any routing reveal)
Routing on the unfixed holes is a **regression**: assigning a doc asserts "confidential to its parties," yet six read paths authenticate the session but never authorize the document — any signed-in principal incl. `readonly` can id-walk field values, full page images, and thumbnails of `needs_review`/`deferred`/soft-`deleted` docs search withholds (SEC-03 + desktop twins).

**New `src/services/accessService.js` — `canAccessDocument(db, user, docId, {workflow}) → {allow, reason}`, pure/injectable, shared by both transports, fail-closed, ordered:**
1. doc missing ⇒ deny `not_found`
2. `admin` ⇒ allow (incl. deleted)
3. **route-party grant** — user is `from_user_id`/`to_user_id` on an **OPEN** route (`pending|claimed|waiting`) for the doc ⇒ allow (above the status test so a party sees a routed `needs_review` doc). **[Oracle C3: OPEN routes only — closed-route parties get the immutable snapshot/stamped copy, not the live doc; ends the grant with the route, prevents readonly-access accretion.]** _(Owner decision #4 gates whether a readonly user may be a recipient at all — if recipients are restricted to `edit|admin`, this case narrows.)_
4. `status==='deleted'` ⇒ deny non-admin
5. writer (`admin|edit`) ⇒ allow any non-deleted
6. `readonly` ⇒ allow only `confirmed`
7. else / null user / unknown role ⇒ deny

**Six enforcement seams** (after the auth line, before the `previewService` read): `/v1` detail (`api/handler.js:457`), pages (`:469`), thumbnail (`:495`); desktop `get-document-with-extractions` (`review/handler.js:388`), `get-document-pages` (`:434`), `get-document-thumbnail` (`:459`). Deny encoding: `/v1` → 404 `not_found` / 403 denied; desktop → throw/null.
**Same slice — path-trust bug (BOTH IPCs, per Oracle):** desktop `get-document-pages` (`review/handler.js:439`) AND `get-document-thumbnail` (`:461`) join client-supplied `folderPath`+`filename` verbatim (arbitrary-host-file read) — resolve `working_path → stored_path → folder_path+original_filename` from the doc row, ignore client paths.
**Live-role re-read on the WRITE path** (`resolve`/`claim`/`recall`): re-read the actor's current role from `users` rather than the token role.
Kill switch **`ACCESS_GATE_ENABLED` default ON** — the deliberate exception to house "default OFF" (security fails closed).

## 4. Feature tiers
- **v1 "it just works"** (mostly built): ad-hoc Send-for-approval, two-list inbox, Approve/Reject-with-comment/Acknowledge, recall, reassign, CAS guard, edit-lock, PDF stamping, audit. **New:** Slice-0 authz · reject→revise→resubmit loop (never dead-end) · notifications · remove `paid`.
- **Suite tier** (earns the separate licence): sequential + parallel routes (first-to-respond / all-must-approve), out-of-office delegation ("X on behalf of Y" in audit), overdue escalation, default-route-on-doc-type, and **the flagship — amount-threshold routing off the extracted `total_amount`** (roles not names). Segregation-of-duties across all tiers.
- **REFUSE (with failure mode):** BPMN/flow designers + scripting (why SMBs bounce off Alfresco/Power Automate); conditional-branch engines beyond amount/type; org-chart/manager lookup; chains >3 steps; e-signature ceremony; web-form portals.

## 5. Data model + engine
- **Multi-step on `document_routes`, not a new steps table:** add `route_group_id` (backfill = row id), `step_order NOT NULL DEFAULT 1`, `step_mode NOT NULL DEFAULT 'any'` (`any`=first-to-respond / `all`=all-must-approve), `on_behalf_of_user_id/_username`, `due_at`, `escalate_to_role/_user_id`; add state `'waiting'`. Materialise the whole plan up front (no insert race). `hasActiveRoute` extends to `pending|claimed|waiting`. Legacy single hop = one-row group, byte-identical; cap `step_order ≤ 3`.
- **Audit snapshot — new append-only `route_decisions`:** `route_id, actor_user_id/username, decision, comment, snapshot_json, snapshot_total_amount, chain_position, on_behalf_of, decided_at`. Written once at resolve; never updated/deleted. Reprocess-after-approval preserves the £ the approver saw.
- **Amount-threshold routing — new `workflow_route_rules`:** `document_type_id(nullable), min_amount, max_amount(nullable=∞), target_role OR target_user_id (prefer role), action_required, step_order, active`. Evaluated by `startDefaultRoute(db, doc)` **after a successful confirm** (post-commit, detached, fail-open), gated `WORKFLOW_AMOUNT_ROUTING` default off. **[Oracle C4: fire ONLY when the total carries no validation/review note, is `currencyDpConsistent` with learned history, and clears `critical_field_conf_floor` — reuse the `trust.js` gate; compare bands in integer pennies, inclusive-min/exclusive-max. A cleanly-parsed-but-wrong total (dropped decimal) must never silently mis-route.]** No match ⇒ manual send; malformed/absent total ⇒ manual + review flag; empty target role ⇒ hold + audit.
- **Delegation + escalation (no cron):** `delegations(user_id, delegate_user_id, starts_at, ends_at, active)` applied at assign time. Escalation = a **sweep** on startup/login and mailbox-open: overdue open routes flip to the escalation target, **CAS-guarded [Oracle C5: `WHERE state IN ('pending','claimed') AND version=@v`]**, re-routes to a human only — never auto-approve/reject.
- **CAS aggregation:** wrap `resolve` in a synchronous better-sqlite3 `db.transaction()` — the writer is serialised, so the resolving actor CAS-updates their row, recomputes the step (any `rejected` sibling ⇒ short-circuit; `all` ⇒ advance at zero-unresolved; `any` ⇒ first approve advances), and flips the next step `waiting→pending`. No two finals both advance.
- **`paid` — REMOVE for v1:** delete from `DECIDE` (`workflowService.js:129`), the mapping (`:146`), stamp branch (`:158`), and the desktop "Mark Paid" button. **[Oracle C1: the stamped migration must first `UPDATE document_routes SET state='approved' WHERE state='paid'` (audited) BEFORE applying the CHECK, or dark-period `paid` rows brick the rebuild.]**
- **Migration safety:** `document_routes` pre-exists idempotently + unversioned — stamped rebuild adding `CHECK(state IN (…,'waiting'))` (no `paid`), `CHECK(action_required IN ('approve','acknowledge'))`, FK on user cols **[Oracle C2: `ON DELETE SET NULL` + pre-sanitize NULLing any `to/from_user_id` with no matching `users.id`]**. **Keep the idempotent creator and the stamped shape identical** (split-brain trap); migration no-ops if `route_group_id` present. Dedupe at group level, not a global one-active-route uniqueness.

## 6. Licensing / packaging (no price numbers)
Separate module via the token features map: (1) `WORKFLOW_FEATURE_ENABLED=true`, (2) `WORKFLOW_BUNDLED_WITH_CLIENT=false` so `workflow.entitled` derives from `detached_workflow_seats`, (3) backend = **data only** (a Polar SKU + `workflow` in the per-feature SUM in `validate.php`; the JWS already signs the features map). Build on `detached_workflow_seats` + the token features map, **never the dead `detached_client_licensed` landmine**. **Meter participants (seats), not processes** (the ApprovalMax trap). **[Oracle C8: ship `ENABLED=true` + `BUNDLED=false` + the backend SKU in the SAME build — never `ENABLED=true` with `BUNDLED=true`. Verified no existing customer stranded (master switch off today).]** Honest caveat: client-side gates are soft, made real by the signed-token sync (≤7-day grace) — a bounded revenue leak, never a data/correctness risk; `accessService` protects data regardless of entitlement.

## 7. Print subsystem (new — owner-requested; eric-designed)
No print path exists today (`shell.openPath` hand-off only). Requirement: print the filed PDF **through the customer's installed printer driver and its settings** (not a fixed Windows print path), audit every print, and choose **original** vs **stamped** copy.
- **Mechanism (driver-honoring):** a per-job **bare JS-free PDF window** — `new BrowserWindow({show:false, webPreferences:{plugins:true, contextIsolation:true, nodeIntegration:false, preload:undefined}})`, `loadURL(file://<main-resolved pdf>)` (Chromium PDF viewer), then `webContents.print({silent:false}, cb)`. `silent:false` raises the **OS/driver print dialog** = the customer's driver dialog (tray/duplex/paper/quality/copies). The app CSP doesn't apply (top-level document is the PDF from a main-resolved `file://`, no app JS); keep `will-navigate`/`setWindowOpenHandler` denials. Create-per-job, destroy-per-job, all closes `isDestroyed()`-guarded; wait on `did-finish-load` + settle, abort+audit on load timeout. Reject the shell `print` verb. Optional later: `silent:true` to a `getPrintersAsync()` device.
- **Original vs stamped — IPC `print-document({docId, source, route_id?, deviceName?, pageRanges?})`; renderer supplies only `docId`+`source`, NEVER a path.** `original` → `documents.resolveFilePath` (`database/modules/documents.js:547`) / the `previewService` ladder; `stamped` → `document_routes.stamped_path` resolved in main, rendered `exact:true`. No stamp ⇒ `{ok:false, reason:'no_stamp', canPrintOriginal:true}`. **Desktop stamped-print MUST apply the same party-scope as `/v1 .../stamped` (`api/handler.js:646`).**
- **Authz:** a print is a READ — calls `canAccessDocument` before resolving a path. Original print can ship on `requireLogin()` (all roles); stamped print waits on `canAccessDocument` + party scope.
- **Audit (every intent, incl. bails + cancels):** `logAudit(db, {action:'document_printed', action_category:'document', target_type:'document', target_id:docId, document_id:docId, outcome, metadata:{source, printer, pages, copies, silent, route_id}})`. `success` = **spooled to the driver** (not proof of physical print); cancel ⇒ `'cancelled'`; else `'failure'`. **Metadata gotcha:** the audit sanitiser redacts keys matching `fingerprint`/`token` — don't name print-metadata keys that way.
- **Transport:** desktop-only in v1 (the client's printer is client-side; it has no raw-PDF access, only PNG pages). Client-local print = a later slice (new party-authorized `/v1 .../file` endpoint + a `print-logged` beacon). Interim: client "View stamped copy" prints from the OS viewer.
- **Kill switch `printing_enabled` default OFF** for control-test; flip default-ON after (additive, user-initiated).

## 8. Notifications — pull model (no always-on server)
Live badge counts (extend the `/v1` mailbox poll), a Home "Waiting on you" card, an at-login digest, and a Windows toast fired by the running core (`Notification`, `main.js:659`) for the admin/filer while open. Promise in-app + toast while the core runs; do NOT promise email/SMS or app-closed notice. Server-push (SSE/long-poll) is deferred.

## 9. Slices & kill switches (per-slice gate = OFF byte-identical + ON only-intended-change)
0. **Authz** — `accessService` at all six seams + both desktop path-trust fixes + write-path live-role re-read. `ACCESS_GATE_ENABLED` **default ON**. Before any routing reveal.
1. **v1 single-hop reveal** — remove `paid`, reject→revise→resubmit, notifications. `WORKFLOW_FEATURE_ENABLED` / `detached_workflow_seats>0`.
2. **Decision snapshot** — append-only `route_decisions` + snapshot at resolve + export. `WORKFLOW_DECISION_SNAPSHOT`.
3. **Amount-threshold routing (flagship)** — `workflow_route_rules` + `startDefaultRoute` post-confirm hook (fail-open) + trust-gated total. `WORKFLOW_AMOUNT_ROUTING`.
4. **Multi-step** — grouping columns + `waiting` + transactional aggregation. `WORKFLOW_MULTISTEP`.
5. **Delegation + escalation** — `delegations` + assign-time application; `due_at`/CAS-guarded sweep. `WORKFLOW_DELEGATION`, `WORKFLOW_ESCALATION`.
6. **Packaging flip** — `WORKFLOW_BUNDLED_WITH_CLIENT=false` + backend SKU + entitlement card (atomic per C8).

**Print track (parallel — original print has no workflow dependency):**
- **Print-Slice 1** — desktop print, original: `print-document` IPC + bare PDF window + `silent:false` driver dialog + full audit + `documents.resolveFilePath` + `requireLogin`. `printing_enabled` **default OFF**. Ships anytime.
- **Print-Slice 2** — stamped source + party-scope + no-stamp fallback + `canAccessDocument`. Depends on Slice-0 authz + a workflow-produced `stamped_path`.
- **Print-Slice 3 (optional)** — silent quick-print to default.
- **Print-Slice 4 (later)** — `/v1` client-local print + `.../file` endpoint + `print-logged` beacon.

## 10. Invariants & test plan
- **Authz denial matrix through the REAL invocation** (call the handler / hit the route, not the predicate in isolation): `role{admin,edit,readonly} × status{needs_review,deferred,confirmed,deleted} × membership{none,to,from}` at all six seams; workflow-critical rows — readonly+needs_review+open-recipient = ALLOW; +no-route = DENY; +CLOSED route = DENY live / ALLOW snapshot.
- **Workflow-OFF byte-identical:** all switches off ⇒ confirm hook no-op, filing byte-identical, `stress_test/realdoc_regression.js` **M=0**; a legit writer's own-doc confirm/file untouched.
- **Real-invocation service tests** (`src/services/test_workflow.js`, Electron-as-Node): sequential advance; parallel-any first-approve; parallel-all last-approver + one-reject short-circuit; double-resolve CONFLICT; amount match/no-match/malformed→manual + dropped-decimal→held; delegation on-behalf; escalation sweep no-op vs interleaved resolve; **paid→gone** (seeded `paid` migrates to `approved`, appears in `listCompleted`); FK deleted-user rebuild leaves NULL party + intact audit.
- **Path-trust pins:** desktop pages AND thumbnail ignore a `folderPath` outside the doc row.
- **SoD:** assign/resolve where actor == submitter refused (admin override audited); single-member-target-role auto-route holds.
- **Print:** real driver-dialog spool = manual verify; auto-tests cover original/stamped resolution + no-stamp fallback, the audit row on success/cancel/failure, the renderer-supplies-no-path pin, the same party-scope on desktop stamped-print as `/v1`, and `printing_enabled` OFF ⇒ no print surface.

## 11. Open owner decisions (recommended default in bold)
1. **v1 scope line:** single-hop only, sequential/parallel strictly suite-tier **(rec)** — or acknowledge-only FYI-to-several in v1?
2. **Approve-only "casual approver" seat** as a low tier **(rec)** — or one workflow seat tier? (Packaging shape.)
3. **Delegation trust:** on-behalf-of for full approvals in v1, or **acknowledge-only first (rec, SoD-safer)**?
4. **Readonly as recipient:** allow view+acknowledge only **(rec)** — or restrict recipients to `edit|admin`? _(shapes accessService rule 3.)_
5. **Print:** always the driver dialog **(rec)** or also a silent quick-print-to-default?
6. **Client (`/v1`) printing in v1, or defer** **(rec defer)**?
7. **Record cancelled print dialogs as audit rows** **(rec yes)**?
8. **Print a stamped copy on a recalled/rejected route, or refuse?** Owner policy.
_(Barry's route-party grant lifetime Q was Oracle-resolved: OPEN routes only, closed-route parties get the snapshot — baked into §3.)_

## 12. Oracle verdict (2026-07-18) — SIGN OFF WITH CONDITIONS
Architecture right (complete the mailbox, don't build an engine); Slice-0 authz correctly sequenced ahead of routing; fail-safes mostly sound. Forks ruled: `paid` → REMOVE; route-party grant → OPEN routes only. Premise held with two corrections folded in above (the `/v1` pages/thumbnail already resolve paths server-side — the path-trust bug is desktop-only and in BOTH pages AND thumbnail IPCs). Conditions C1–C8 (all above): C1 reconcile `paid` rows before the CHECK; C2 FK `ON DELETE SET NULL` + pre-sanitize; C3 route-party grant scoped to OPEN routes; C4 amount routing keys off a trust-passing total, integer pennies; C5 escalation sweep CAS-guarded; C6 enforce SoD at assign AND resolve; C7 confirm hook post-commit/detached/fail-open + idempotent-creator/stamped-shape parity + no-op on already-new-shape; C8 packaging flip atomic in one build. Verification gate: the authz denial matrix through real invocations + path-trust pins on pages AND thumbnail + `paid→gone` + parallel-all last-approver/one-reject + amount fail-safe + realdoc M=0 with all switches OFF → green ⇒ ship Slice 0, then reveal.
