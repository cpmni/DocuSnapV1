# WORKFLOW SLICE 1 — concrete build plan (v1 single-hop reveal-readiness)

**Date:** 2026-07-18 · **Status:** PLAN — pending advisor (gary/eric) + Oracle gate, then owner go-ahead.
**Parent spec:** `docs/designs/WORKFLOW_SUITE_2026-07-18.md` (Oracle SIGN OFF WITH CONDITIONS C1–C8; owner
answered all 8 decisions "as recommended"). This doc turns §9 Slice 1 into file-level stages, grounded in an
8-reader code map (2026-07-18, this session) of the ACTUAL dark mailbox.

**Slice-1 scope (per §9):** (a) remove the half-wired `paid` state, (b) reject→revise→resubmit loop,
(c) pull-model notifications. Everything REMAINS DARK behind `WORKFLOW_FEATURE_ENABLED=false`
(entitlementService.js:37) — Slice 1 does NOT flip it (that is Slice 6 / Oracle C8, atomic with the backend
SKU). OFF ⇒ byte-identical is therefore structural for every user-facing stage; the only code that runs on
today's installs is the paid data-heal (see A2, deliberately unconditional) and the reprocess guard (E,
inert without routes).

---

## 0. Verified fact base — corrections to the parent spec (from the code map)

1. **`reassign` DOES NOT EXIST** (spec §4 lists it as built). `createWorkflowService` returns
   inbox/sent/assigned/completed/assign/claim/resolve/recall only. The core's "Forward…" button is an
   assign-form add-on (a SECOND route), not reassignment. Slice 1 does NOT build reassign — spec correction only.
2. **`paid` is in NEITHER state list.** `database/modules/workflow.js:20-21` OPEN_STATES excludes it (lock
   releases — fine) but CLOSED_STATES/`listCompleted` ALSO exclude it → a paid route vanishes from
   inbox/assigned/completed and survives only in the sender's unfiltered Sent list. The paid→approved data
   migration therefore *improves* visibility (rows resurface in Completed).
3. **`documents.workflow_status` can be `'paid'`** (workflowService.js:152 writes the raw newState) and is
   NEVER cleared by any code path — the migration must cover this column too.
4. **No CHECK constraints exist on `document_routes`** (states are comments only, database/index.js:994-1012),
   and the workflow schema block is deliberately UNSTAMPED/idempotent at the end of runJsMigrations
   (index.js:986-1026; rationale comment 988-992). Highest stamped migration = 50.
5. **The client has NO poll loop** for counts (spec §8 says "extend the /v1 mailbox poll" — there is none to
   extend). `refreshBadges` (client/renderer/renderer.js:1337-1356) is event-driven only. The client DOES
   already have "Waiting on you"/"Awaiting others" Home cards (:897-901).
6. **The core has ZERO workflow notification surface**: no counts IPC, no badge, no dashboard card, no
   Recall button, and the core mailbox NEVER displays `resolution_comment` — the sender cannot see a
   rejection reason in the core UI at all (the client does show it, renderer.js:1272).
7. **`test_workflow_ipc.js` needs NO production change to go green**: it already fakes the auth module via
   require.cache; the same pattern can stub entitlementService. (It fails today crashing on
   FEATURE_NOT_LICENSED, a recorded known-fail.)
8. **Two OPEN routes on one doc can coexist** (assign has no dedupe; "Forward…" DEPENDS on this). Slice 1
   must NOT add an active-route dedupe (spec §5 defers dedupe to the Slice-4 group level).
9. **`reprocess-document` has NO editGuard** (processing/handler.js:1246-1260) — an open approval route does
   not stop reprocess from rewriting the extractions under the approver. Desktop confirm/defer/restore/delete
   and /v1 confirm/defer/undefer ARE guarded.
10. **Stamped-copy endpoint party-scope is any-state route-party** (api/handler.js:661) — consistent with
    Oracle C3 (closed-route parties keep the stamped copy, lose the live doc). No change.
11. **Complete `paid` inventory** (all sites): workflowService.js 129/137/146/158 (+comments 128/135/156);
    pdfStamp.js:22 `DECISION_STYLE.paid`; search-workflow.js:90 button; search/index.html:86 CSS;
    client/renderer/renderer.js:1066+1298 buttons, :1305 comment; client/renderer/index.html:191 CSS;
    test_workflow.js:100-106 pins. `/v1` api/handler.js is state-agnostic (zero `paid` refs).

---

## 1. Stage A — remove `paid` + data heal (Oracle C1)

**A1 — code removal.**
- `src/services/workflowService.js`: DECIDE=['approve','reject'] (129); drop `paid` mapping (146); stamp
  condition `approve|reject` (158); error string "cannot approve or reject" (137); fix comments 128/135/156.
- `src/services/pdfStamp.js:22`: delete `DECISION_STYLE.paid` (stampWorkflowDecision already no-ops on
  unknown decisions — belt for any stale caller).
- UI: delete the Mark Paid button `src/windows/search/search-workflow.js:90`; the two client buttons
  `client/renderer/renderer.js:1066`/`1298`; fix the :1305 comment; delete CSS chips
  `src/windows/search/index.html:86` + `client/renderer/index.html:191`.
- Result: decision `'paid'` (desktop IPC AND /v1 — both pass the string verbatim to resolve) now returns
  INVALID via the existing decision allowlist. No transport change needed.

**A2 — data heal (Oracle-conditioned placement).** UNSTAMPED + idempotent (NOT stamped migration 51 —
dark-period/dev DBs can carry paid rows regardless of stamp level and re-running is free), placed **at the
TOP of `runJsMigrations` (database/index.js), BEFORE any stamped block**, guarded by
`tableExists('document_routes')` + `hasColumn('documents','workflow_status')` (fresh DB ⇒ guard no-ops; the
table is created later that boot and no paid rows can exist). **This mechanically discharges the C1 seam
forever** (Oracle condition 1): any future Slice-4 build necessarily contains this code, so on the first
boot of ANY dark-era DB the heal runs before the CHECK-adding stamped rebuild — no reliance on a prose note:
```sql
UPDATE document_routes SET state='approved' WHERE state='paid';
UPDATE documents SET workflow_status='approved' WHERE workflow_status='paid';
```
Preserves resolved_at/resolution_comment — and deliberately does NOT bump `version` (paid is terminal, no
CAS can act on it; PINNED in tests so nobody "fixes" it). Audit ONE row per boot ONLY when changes>0
(action `workflow_paid_migrated`, action_category `workflow` passed explicitly, metadata `{routes:N, docs:M}`
— sanitiser-safe key names, values arrive as strings), the audit write itself in try/catch (an audit failure
must never abort migrations), `user_id:null` (system action). Historic `workflow_paid` audit rows stay
(history). The Slice-4 stamped rebuild still writes its own paid→approved UPDATE as **belt-and-braces**
(any CHECK-adding rebuild must handle nonconforming rows or it bricks boot) — but with the top-of-function
placement that is defence-in-depth, not memory-dependent (Oracle F1, upgrading gary's recorded-note seam).
The heal self-heals restored/worktree DBs every boot — the reason it beats a run-once stamped migration 51.

**A3 — tests (gary-specified, file by file).**
- `src/services/test_workflow.js` — replace :100-106 with removal pins: (1) edit-role recipient resolves
  `'paid'` → **INVALID** + route stays `pending` + workflow_status unchanged (the primary re-add tripwire);
  (2) READONLY resolves `'paid'` → **INVALID, not FORBIDDEN** — the decision check at workflowService.js:130
  precedes the role gate at :136, so the old :106 expectation must FLIP, not be copied; (3) readonly
  `'approve'` → FORBIDDEN with `/paid/i` ABSENT from the message (pins the :137 string change); (4) stamp
  belt pin: `DECISION_STYLE.paid === undefined` + `stampWorkflowDecision({decision:'paid',…})` resolves null
  (verified: unknown-decision lookup no-ops at pdfStamp.js:141-142); (5) end-of-suite sweep:
  `COUNT(*) WHERE state='paid'` === 0. The `:123 completed>=3` assertion is PROVEN unaffected (the paid
  routes never counted in listCompleted; the flow yields 6 completed) — optionally tighten to the exact 6.
  Header comment pins the trade-off: *"Mark Paid was removed for v1 (Oracle ruling). Payment tracking, if
  ever wanted, returns as a NEW designed state with its own migration — never by re-adding 'paid' to DECIDE."*
- NEW `database/modules/test_workflow_paid_heal.js` (it tests runMigrations, not the service): :memory: +
  real `runMigrations`; raw-INSERT a `state='paid'` route (with resolution_comment/resolved_at/`version=3`)
  + a `workflow_status='paid'` doc; re-run migrations → approved/approved, comment+resolved_at preserved,
  **version===3 unchanged (pin)**, healed route appears in `listCompleted`; exactly ONE
  `workflow_paid_migrated` audit row (parse stored metadata form); third run → still exactly one
  (idempotency + no-audit-on-no-change); fresh-DB control → ZERO such rows (byte-identical normal installs).
  **Oracle additions:** (i) **ORDERING pin** — the test must genuinely FAIL if someone moves the heal back
  below the stamped blocks (seed a paid row into a DB stamped at current max, then instrument/assert the
  heal executed before the stamped loop); (ii) **doc-only orphan case** — `workflow_status='paid'` with NO
  paid route → healed.
- `src/modules/api/test_v1_workflow.js` — POST resolve `decision:'paid'` → INVALID (pins the transport seam:
  api/handler.js:683 passes the string verbatim; the service allowlist is the only wall, and that suffices).
- `src/services/test_access_service.js` — add `rejected`/`acknowledged`/`approved` route states (closed ⇒
  deny) — closes the map's matrix gap; a healed paid row becomes exactly `approved`.

## 2. Stage B — reject → revise → resubmit (never a dead-end)

No schema change (linkage via audit metadata; `route_group_id` stays Slice 4).
- **B1 — show the reason in the core.** `search-mailbox.js` `_routeItem`: render `resolution_comment` as a
  "Reason: …" line for rejected (and generally resolved) routes — parity with the client (:1272). **Through
  `escHtml`** (user-typed text; eric).
- **B2 — "Send again" affordance.** On a REJECTED route row (core Sent/Completed + client Sent): a button
  that opens the existing assign form PREFILLED (same recipient, same action_required, empty note) and passes
  `resubmitOf: <routeId>` through `workflow.assign`. `workflowService.assign` accepts the OPTIONAL field and
  records it in the audit details/metadata only (`resubmit_of=<id>`). Service behaviour otherwise unchanged
  (a fresh pending route; workflow_status back to 'pending' — already the case). **Prefill target = the route's
  `to_username` (the original RECIPIENT) — generalise `_assignForm`'s `senderUsername` param
  (search-workflow.js:103-113) rather than reusing it as-is, or the wrong person gets pre-selected (eric).**
- **B3 — core Recall parity.** The service + preload already support recall; the core UI has no button.
  Add "Recall" on the core Sent row while `state==='pending'` (mirror client renderer.js:1289-1290).
- **B3b — action-bar hygiene (eric, required with B1-B3):** (i) `_run` (search-workflow.js:38-43) currently
  refreshes ONLY on success — on failure (esp. CAS CONFLICT) the stale bar/version stays and the user retries
  into the same CONFLICT forever: refresh+rerender in a `finally`, and strip Electron's
  "Error invoking remote method …" prefix before display; (ii) new row buttons (Recall/Send again) MUST
  `stopPropagation` (row click loads the doc — stamp-link precedent search-mailbox.js:67-70).
- **B4 — tests.** Service: assign with `resubmitOf` audits the linkage; without it → no `resubmit_of` key
  (byte-identical); every existing precondition (FORBIDDEN/NOT_ROUTABLE/INACTIVE_RECIPIENT) still fires with
  it present; **garbage `resubmitOf` semantics PINNED (gary): no lookup, still ok:true, recorded as-is —
  advisory lineage only** (a failed best-effort audit loses it silently; acceptable for advisory data, said
  in a code comment). Renderer logic stays untested per house status quo — the service pins carry the
  invariants. *(Metadata-only vs column resolved by gary: column-now would double the Slice-4
  idempotent-creator/stamped-rebuild shape-parity surface (C7) and might bake the wrong grain — Slice 2 may
  want the link at decision level. Nothing real to backfill later: the feature is dark, population ~empty.)*

## 3. Stage C — pull-model notifications

*(This stage was revised per eric's review, 2026-07-18 — his GO-WITH-CHANGES items are folded in below.)*
- **C1 — change signal via ONE shared main.js helper.** New injectable hook `notifyWorkflow` on
  `createWorkflowService` (default no-op — the `audit` hook pattern) fired AFTER successful
  assign/claim/resolve/recall with `{event, route, actor}`, **invoked inside the service's own try/catch**
  (a throwing hook must never fail an approve). BOTH handlers (desktop workflow/handler.js AND the /v1
  api/handler.js instance) wire it to a SINGLE new main.js helper `notifyWorkflowEvent({event, route, actor})`
  exposed on ctx. The helper owns: (a) the fan-out — **`notifyAllWindows('workflow-counts-changed')`, NOT
  `notifyMainWindow`** (which hits main+review only, main.js:710-713, and would silently starve the SEARCH
  window — the /v1 cross-user path is the headline case; eric); (b) the toast decision (C4); (c) one shared
  trailing-debounce state (~2s, keyed by affected-user+direction) so a bulk /v1 loop of 20 assigns produces
  ONE aggregated toast + a bounded ping rate. Event carries NO data — invalidation ping; renderers re-pull.
- **C2 — core counts source.** `database/modules/workflow.js` gains cheap COUNT functions
  (`countInbox`/`countOpenSent` + `countSent`/`countAssigned`/`countCompleted` for C6's endpoint — one
  source, three consumers). A tiny dedicated **`get-workflow-counts` IPC** (requireLogin, entitlement-gated,
  current-user scoped, best-effort) serves the card + repaints. `get-dashboard-extra` gains only the
  `{entitled}` show/hide flag for the card block (its full pipeline runs `fs.statfsSync` + five blocks —
  NEVER the per-event repaint path; eric).
- **C3 — Home "Waiting on you" card.** New `#dash-workflow` .dash-card in the top grid (main/index.html),
  painted by its own `renderWorkflowCard()` (fed by `get-workflow-counts`), entitlement-driven show/hide
  (`dash-clients` precedent, renderer.js:238-244), registered in Settings `DASH_CARD_SECTIONS`, click →
  opens the Search window mailbox. Repaint on `workflow-counts-changed` (new preload listener
  `onWorkflowCountsChanged`) **debounced** (the `_dashRefreshTimer` idiom, main/renderer.js:1129-1134).
  The Search window also listens: **debounced** `SearchMailbox.refreshIfActive()` (its `render()` has no
  concurrency guard — overlapping renders interleave DOM; eric) + `SearchWorkflow.refresh()`.
- **C4 — Windows toast (running core only), inside the C1 helper.** If the affected user (route
  `to_user_id` on assign / `from_user_id` on resolve) IS the current desktop session user → one
  `new Notification` ("New approval request from <sender>" / aggregated "N documents routed to you").
  Guard set (eric): `Notification.isSupported()` + whole-path try/catch (maybeShowTrayHint precedent,
  main.js:655-668; AppUserModelId already set, main.js:58) + **`isQuitting` skip** (main.js:130) +
  **null-session skip** (core alive in tray after logout) + **self-action skip**
  (`actor.userId === affectedUserId`) + setting `workflow_toasts_enabled` default `'true'` (observable only
  when entitled ⇒ dark today). Toast is OS-level: no window dependency, no focus steal, no print-dialog
  interference. **Oracle condition 3: the null-session / self-action / `isQuitting` guards are evaluated at
  debounce FIRE time, not enqueue time** — a toast queued 1s before logout must not fire into the wrong
  state (windows are destroyed at showLoginScreen but a Notification is OS-level and would still show).
- **C5 — at-login digest.** In `openMainShell()` (main.js:181-200 — the single post-all-gates choke point;
  its three call sites are mutually exclusive per entry, no first-run double-fire). Best-effort: entitled &&
  `countInbox>0` ⇒ ONE toast "N document(s) waiting for your approval". **Module-level `_digestShown` latch,
  cleared in `showLoginScreen()`** (kills any re-entry doubt incl. a future license-reval re-entry; eric).
  **Do NOT couple to ready-to-show** (documented can-never-fire mode — the function carries a 12s backstop
  for exactly that); a flat ~3s setTimeout at most.
- **C6 — client badge poll + counts endpoint.** New additive **`GET /v1/workflow/counts`** returning ALL
  FOUR box counts (the client's segmented tabs need four, renderer.js:1345-1347). It sits under the
  `/v1/workflow/` prefix so the existing `WORKFLOW_ROUTE` entitlement gate (api/handler.js:207, :253-259)
  applies automatically; contract is MAJOR-only (api/handler.js:58-62) — no bump (verified). Poll: 60s
  `setInterval` in the CLIENT RENDERER (state + helpers live there; client/main heartbeat stays
  reachability-only), gated signed-in AND workflowEntitled AND connection-alive (subscribe to the existing
  `client-connection-lost/restored` events, client/main.js:184), cleared in `doLogout`, one immediate
  refresh on `restored`. **The poll paints badge numbers ONLY — it must never write `myOpenRoutes`**
  (counts can't; blanking it would kill the decision bar). Full `refreshBadges` stays on
  view-load/action/manual-refresh (preserves `myOpenRoutes` semantics).
- **C7 — tests.** Service: hook fires per action; default no-op safe; a THROWING hook never breaks the
  action (mirror the detached-hook pins in test_reviewservice). Counts functions unit-checked. **Fan-out
  pin (eric): assert the /v1-wired hook reaches a SEARCH-window stub** (so a future "simplify to
  notifyMainWindow" regression fails loudly). /v1 counts endpoint: entitled 200 shape / unentitled 402 /
  **unauthenticated 401 (Oracle condition 4b)**. **Queued-then-logged-out pin (Oracle condition 3): stub
  the session to null between enqueue and debounce-fire → no toast.** `get-workflow-counts` while dark
  returns a clean `{entitled:false}`, never throws (Oracle F8b).

## 4. Stage D — test hygiene (no production change)

Fix `src/modules/workflow/test_workflow_ipc.js` by stubbing entitlementService via require.cache (its own
fake-auth pattern, :15-28) — asserts both OFF (FEATURE_NOT_LICENSED) and ON (full flow) without touching the
hard-coded flag. The suite leaves the "known-fail" list; record in the handover.

## 5. Stage E — reprocess workflow-lock (BOTH doors; gary-corrected)

The invariant is "open route ⇒ doc immutable", and reprocess has **TWO** entry points (gary):
- **E1 — single-doc:** the `requireUnlocked` pattern (review/handler.js:164-174) on `reprocess-document`
  (processing/handler.js:1246): OPEN route blocks for edit; admin overrides, audited. Guard placed **before**
  the premature `outcome:'success'` audit at :1259 (which currently fires pre-work) — a lock refusal audits
  as refused or not at all.
- **E2 — batch:** the review "Reprocess all in queue" is a SEPARATE IPC `reprocess-batch`
  (processing/handler.js:1516, driven by review/renderer.js:5037/5078) — without this the batch silently
  rewrites a locked doc under the approver, straight past E1 (the quieter failure). Semantics:
  **skip-and-report, never abort** — filter locked docs out of the shard, surface "N skipped — in an
  approval workflow" in the summary. **Admin batch ALSO skips (pinned choice):** bulk mutation under an
  approver is exactly the class the lock exists for; the admin override stays a deliberate per-doc act.
- **Inertness (Oracle-rescoped, condition 2, MEASURED):** inert on customer installs (the flag gates both
  transports; the /v1 `checkEntitlement` override is test-injection only). On a dev DB carrying experimental
  routes the guard would fire — the intended invariant, fail-safe (a refusal with a reason, never a silent
  wrong result). **Live dev DB verified 2026-07-18: 0 routes total, 0 open, 0 paid, 0 docs with
  workflow_status — byte-identical holds here too.** Watch-folder/import paths untouched (new docs have no
  routes by construction).
- **E-tests:** locked single-doc reprocess → WORKFLOW_LOCKED (edit) / overridden+audited (admin); batch over
  {locked, unlocked} → unlocked processed, locked skipped+counted, admin batch also skips (the pin).

## 6. What Slice 1 does NOT do (scope pins)

No `WORKFLOW_FEATURE_ENABLED` flip (Slice 6/C8) · no reassign (doesn't exist; spec correction) · no
active-route dedupe (Forward… depends on multi-route; Slice-4 group dedupe) · no CHECK constraints, no
`route_group_id`, no `waiting` (Slice 4) · no `route_decisions` snapshot (Slice 2) · no amount routing
(Slice 3) · no delegation/escalation (Slice 5) · no schema columns at all · no email/SMS/app-closed
notification promises (spec §8) · `detached_client_licensed` landmine stays dead (stale-comment cleanup only,
if trivial).
Go-forward notes (gary — deliberate, don't "improve" later): legacy `*.PAID-stamped.pdf` copies on disk
STAY (`has_stamp` still true; the state-agnostic stamped endpoint serves them; no cleanup) · a stale
dark-era client build showing "Mark Paid" gets a clean INVALID from the server (feature never shipped —
no real fielded clients).

## 7. Verification gates (per house control-test rule)

1. **Baseline (pre-code):** corpus `realdoc_regression.js` → copy to `stress_test/out/workflow_slice1_BASELINE.md`;
   unit suite states already recorded this session (all green; test_workflow_ipc known-fail).
2. **Per-stage:** full workflow-adjacent unit battery green (test_workflow, test_workflow_ipc [after D],
   test_v1_workflow, test_v1_review, test_v1_security, test_workflow_lock, test_access_service,
   test_documents_cas, test_reviewservice, test_entitlement, test_seatpool, test_pdfstamp) + `node -c` on
   every touched renderer file + the div-balance check for touched HTML.
3. **Corpus after each stage:** byte-identical to baseline (nothing here touches extraction/filing; the
   heal touches only workflow columns).
4. **ON-behaviour:** via the injection-stubbed suites (test_workflow_ipc ON-half, /v1 suites) — NOT by
   flipping the source flag.
5. **Call-time reference smoke** (the 77e674e lesson): every new/modified IPC invoked once in a harness,
   not just module-load smoked.

## 8. Advisor gate — RESOLVED (2026-07-18, both GO-WITH-CHANGES, all changes folded in above)

- **gary (GO-WITH-CHANGES):** A2 unstamped heal CONFIRMED (self-heals restored/worktree DBs; a stamped 51
  runs once and misses rows minted later by an old-branch boot) with the C1-not-discharged seam recorded;
  audit semantics confirmed sanitiser-safe; readonly-paid test expectation must flip FORBIDDEN→INVALID
  (decision check precedes role gate — copying the old pin would green a wrong test); `:123` proven
  unaffected; B2 metadata-only confirmed (column-now doubles the C7 shape-parity surface); Stage E extended
  to `reprocess-batch` (the second door) with skip-and-report + no admin auto-override in batch.
- **eric (GO-WITH-CHANGES):** ONE shared main.js `notifyWorkflowEvent` helper for toast+fan-out wired by
  BOTH handlers (the plan's original /v1→notifyMainWindow wiring would have starved the Search window —
  the cross-user headline case); trailing ~2s debounce/aggregation for bulk; toast guards isSupported +
  try/catch + `isQuitting` + null-session + self-action; digest via `_digestShown` latch cleared in
  `showLoginScreen`, never coupled to ready-to-show; new `GET /v1/workflow/counts` (all four box counts,
  auto-gated by the WORKFLOW_ROUTE prefix, MAJOR-only contract → no bump, verified); poll in the client
  RENDERER gated signed-in+entitled+connection-alive, cleared on logout, poll paints badges only (never
  `myOpenRoutes`); card repaint via tiny `get-workflow-counts` IPC + debounce (never per-event
  `get-dashboard-extra` — statfsSync trap); B-UI: `_run` refresh-on-failure/CONFLICT + invoke-prefix strip,
  stopPropagation on row buttons, escHtml the Reason line, Send-again prefills the RECIPIENT.

## 9. ORACLE VERDICT (2026-07-18): SIGN OFF WITH CONDITIONS — all four folded in above

Premise checks all verified in code (no-reassign real; paid-invisibility real; heal-restores-visibility
semantically correct since workflow_status is last-writer denormalised). Forks ruled: **C1 seam needs the
STRUCTURAL fix now** (heal at the top of runJsMigrations — F1, supersedes the recorded-note approach);
**E2 ships IN Slice 1** with skip-and-report (more observable than the existing missing-file `continue`
precedent; abort-on-first-lock would punish a 200-doc batch for one routed doc). F2: INVALID-before-
FORBIDDEN ordering leaks nothing (only the route's own recipient can reach the decision check). F3: fan-out
helper verified cycle-free (ctx-closure pattern); the throwing-hook pin forces the try/catch into existence.
F6: spec §8's "extend the poll" was factually wrong (no poll exists) — creating one is a correction, not
creep. F8: keep `textContent` for error displays; dark `get-workflow-counts` returns `{entitled:false}`.
**Conditions:** (1) heal at top-of-runJsMigrations + ordering pin in the heal test; (2) inertness claim
rescoped + live-DB count recorded (DONE — measured 0/0/0/0); (3) toast guards at fire time + the
queued-then-logged-out pin; (4) heal doc-only-orphan case + counts-endpoint 401 pin.
