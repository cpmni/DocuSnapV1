# HANDOVER — 2026-07-18 NIGHT2 (the Workflow-Slice-1 + print-saga session)

**Branch:** `feat/reprocess-throughput-autostraighten` · **last PUSHED = `c9d32ec`** · **11 commits UNPUSHED**
(5 Workflow Slice 1 + 6 print). **Nothing pushed this session — ask the owner before pushing.**
**Installer:** STALE — still `r20260718-0818-bea1028`; several features shipped since, rebuild before any
packaged test. **Uncommitted = pre-existing dirt only** (`.gitignore`, `stress_test/out/accuracy_baseline.md`,
untracked older handovers + `stress_test/_*.js` scratch). No new uncommitted source.
**Running at wrap:** a dev `npm start` (owner's, background task `bbdfn0kez`).
**Supersedes** `HANDOVER_2026-07-18_NIGHT.md` (which was this session's READ-FIRST). Model note: this session
ran on **Fable 5**; owner is returning to **Opus**.

## TL;DR
1. **WORKFLOW SLICE 1 — BUILT, all 5 stages committed, all dark behind `WORKFLOW_FEATURE_ENABLED=false`.**
   The substantive, well-verified work of the session: removed the half-wired `paid` state (+ boot heal),
   reject→revise→resubmit, pull-model notifications, reprocess workflow-lock. Full advisor+Oracle gate.
   Corpus byte-identical to baseline; 18-suite battery green (incl. the previously-known-fail
   `test_workflow_ipc.js`, now green). Spec: `docs/designs/WORKFLOW_SLICE1_BUILD_2026-07-18.md`.
2. **PRINT — a long iterative saga; landed at "modal works, feature is functional-but-imperfect".** The
   current custom modal prints, has a reactive preview, no longer locks, and its driver dialog stays in
   front. The **clean native-dialog rebuild is DESIGNED + Oracle-signed but BANKED** (owner chose not to
   build it now): `docs/designs/NATIVE_PRINT_2026-07-18.md`.
3. **SEC-03 marked FIXED** in `SECURITY_BACKLOG.md` (was fixed by Slice-0 `f8299d4`; bookkeeping only).

---

## COMMITTED — Workflow Slice 1 (5 commits, `e66bc04`→`42a671b`)
Plan + gate record: `docs/designs/WORKFLOW_SLICE1_BUILD_2026-07-18.md` (8-reader code map → gary+eric
GO-WITH-CHANGES → Oracle SIGN OFF WITH CONDITIONS 1-4, ALL folded). Everything stays DARK behind
`WORKFLOW_FEATURE_ENABLED=false` (entitlementService.js:37) — Slice 1 does NOT flip it (that's Slice 6).

- **`e66bc04` Stage A — remove `paid` + boot heal.** `paid` was half-wired (in NEITHER OPEN_STATES nor
  CLOSED_STATES → a paid route was invisible in inbox/assigned/completed). Removed from
  workflowService DECIDE/mapping/stamp/role-msg, pdfStamp DECISION_STYLE, the 3 "Mark Paid" buttons + 2 CSS
  chips (core + client). **Boot HEAL** paid→approved at the **TOP of `runJsMigrations`** (database/index.js),
  BEFORE any stamped block (Oracle C1 — mechanically un-brickable), idempotent, audited-on-change
  (`workflow_paid_migrated`), version NOT bumped. NEW `database/modules/test_workflow_paid_heal.js` (heal /
  idempotency / doc-only orphan / fresh-DB control / **source-ordering pin**). KEY TRAP fixed: readonly+`paid`
  now → INVALID (decision check precedes the role gate), NOT the old FORBIDDEN.
- **`19f5624` Stage D — `test_workflow_ipc.js` green** via a require.cache entitlement stub (zero production
  change; the June-era known-fail is GONE).
- **`a27767b` Stage B — reject→revise→resubmit.** Core mailbox now shows the rejection REASON (it never did);
  "Send again" prefills the original RECIPIENT + threads `resubmitOf` (audit-details-only lineage, no schema);
  core Recall parity; `_run` always-refreshes (a CAS CONFLICT no longer strands a stale bar).
- **`34c7417` Stage C — pull-model notifications.** ONE shared main.js `notifyWorkflowEvent` sink wired by
  BOTH transports (fan-out via `notifyAllWindows` — NOT notifyMainWindow, which would starve the Search
  window; pinned). Pure `src/lib/workflowNotify.js` (2s debounce + FIRE-TIME toast guards incl.
  queued-then-logged-out, Oracle C3). Home "Waiting on you" card via a tiny `get-workflow-counts` IPC
  (never the heavy get-dashboard-extra on the repaint path). At-login digest (latch cleared in
  showLoginScreen). NEW `GET /v1/workflow/counts` + client 60s badge poll (paints badges only, never
  myOpenRoutes). Count fns MIRROR the list queries (pinned).
- **`42a671b` Stage E — reprocess honours the workflow lock (BOTH doors).** Single-doc `reprocess-document`
  editGuard (before the premature success-audit); batch `reprocess-batch` SKIP-AND-REPORT (`lockedSkipped`,
  surfaced in the Review banner+toast). **Admin batch ALSO skips — pinned, no bulk override.** NEW
  `src/modules/processing/test_reprocess_lock.js`.

---

## COMMITTED — Print (6 commits, `bf98389`→`9eb4377`) — an iterative UX saga
The owner drove a long exploration to get a clean native Windows print dialog. **The net conclusion is
important:** Electron 31 CANNOT give the native/classic Windows print dialog from `webContents.print`
(it always raises Win11's modern dialog with the "This app doesn't support print preview" empty pane — a
**Windows-11** behaviour, NOT Electron-specific: the same message appears from a .NET app calling the modern
dialog). AND there is NO permissively-licensed off-the-shelf PDF-print tool (all GPL/AGPL or $thousands
quote-only SDKs — researched + verified). So the current modal is the pragmatic state; the clean dialog needs
the banked native-render design.

- **`bf98389`** removed the custom modal for a direct dialog (owner-directed), then **`e5dca3c`** RESTORED it
  as "option (a)" (owner liked the preview): custom modal with printer/copies/duplex/colour/range/N-up +
  "Full printer dialog…" button. `pagesPerSheet` threaded through the handler.
- **`055af49`** — REACTIVE preview (mono greys the pages, range shows only those pages, N-up lays them out) +
  removed the dead `disable-print-preview` switch (it did NOT reroute Electron's programmatic print —
  physically verified) + **banked the native-print design** (`docs/designs/NATIVE_PRINT_2026-07-18.md`,
  Oracle SIGN OFF WITH CONDITIONS C1-C7).
- **`8a5df3d`** — parent the offscreen print window to Review so the driver dialog stays IN FRONT (Bug 2);
  clarify that the printer dropdown drives the quick Print button, the full dialog picks its own printer
  (Bug 1 = genuine Electron limitation, deviceName not honoured for the shown silent:false dialog); **kill a
  hidden bug** — the 20s load-timeout was never cleared on load, so leaving the dialog open >20s destroyed
  the window under the user.
- **`d935498`** then **`9eb4377`** — **the modal no longer locks on ANY path.** THE finding: Electron's
  `webContents.print` callback is UNRELIABLE — it does NOT fire on a user cancel, on a virtual printer's
  "Save as" prompt (Microsoft Print to PDF), OR (owner-reported) even on a normal Ricoh job. So the modal is
  now callback-independent: silent:false re-enables immediately; silent:true reports the outcome if/when the
  callback lands but a 4s watchdog re-enables regardless.

---

## Verification state — HONEST ledger
- **Workflow Slice 1 — well verified.** Every stage: corpus `realdoc_regression.js` **byte-identical** to
  `stress_test/out/workflow_slice1_BASELINE.md` (76 docs, M=0/M_type=0). 18-suite battery green
  (test_workflow, test_workflow_ipc, test_v1_workflow, test_v1_review, test_v1_security, test_workflow_lock,
  test_access_service, test_documents_cas, test_reviewservice, test_entitlement, test_seatpool, test_pdfstamp,
  test_workflow_paid_heal, test_reprocess_lock, test_split_plan, test_slip_pack, test_print, + notify). Dark
  behind the master flag ⇒ OFF is structural. Live dev DB verified 0 routes (Oracle C2). **Trustworthy.**
- **Print — modal is fixed; FUNCTIONAL PRINT IS UNVERIFIED.** `test_print.js` 11/11, syntax + div-balance
  clean on every commit. BUT: because Electron's callback is unreliable, we **cannot confirm from in-app
  signals whether a print actually spooled**. ⚠ **The open question the owner was about to answer: does paper
  actually come out of the Ricoh?** If yes → print is functional (imperfect feedback only) → acceptable. If
  no → the current approach is the wrong foundation and the banked native-render design is the real fix.
- **Mid-session claims that were WRONG (corrected in-flight — record so they aren't repeated):**
  (1) A code comment/commit claimed the print callback "fires reliably on the silent path" — FALSE, corrected
  in `9eb4377`. (2) eric asserted the callback fires on cancel — FALSE (owner-verified). (3) The initial
  native-print design put temp renders under roaming `userData` (POSIX assumption) — Oracle overturned to
  LOCAL `app.getPath('temp')`. (4) The `disable-print-preview` switch was tried and did nothing (reverted).

---

## FIRST ACTIONS for the fresh (Opus) session
1. **Answer the print question with the owner: does the Ricoh actually print paper?** (See ledger.) That
   single fact decides whether print is "functional — move on" or "needs the banked native-render build".
2. **Decide on the 11 unpushed commits** — the owner has NOT pushed. Offer to push the branch.
3. **Roadmap (the real product value):** Filing Slips **slice 5** (watch-folder parity — design pass with
   advisors+Oracle FIRST, required before any Filing-Slips default-ON flip) OR **Workflow slice 2** (the
   `route_decisions` append-only snapshot; see WORKFLOW_SUITE_2026-07-18.md Oracle conditions).
4. If print is judged worth finishing cleanly → build the banked `NATIVE_PRINT_2026-07-18.md` (Oracle C1-C7).

## Deferred / BANKED (designed, NOT built — load-bearing conditions)
- **Native classic-dialog print** (`docs/designs/NATIVE_PRINT_2026-07-18.md`): render PDF→PNG (pypdfium2) →
  Windows' CLASSIC PrintDialog (`UseEXDialog=$false`, no preview pane) via a helper. **Oracle overturns baked
  in:** LOCAL temp not roaming userData (C1); ship a **compiled C# helper** not a `.ps1` (C2 — a Group Policy
  ExecutionPolicy OVERRIDES `-ExecutionPolicy Bypass`, so a `.ps1` silently won't run in managed orgs); disk
  precheck + lower page cap for 300-DPI (C3); **virtual/file-printer control** — audit-always + warn +
  admin-hard-block `restrict_virtual_print`, default the block ON (owner's own Edge-veto logic) (C4); child
  Set + killAll on before-quit + distinct `virtual_declined`/`virtual_blocked` audit outcomes (C5);
  same-commit UI swap (C6); KEEP the vector `webContents.print` path as a fallback (C7). Owner-PROVEN the
  classic dialog appears (a spike, `scratchpad/print-image-test.ps1`, `UseEXDialog=$false`).
- **REJECTED (do not revisit):** the `PreferLegacyPrintDialog` registry toggle — eric WRONG-LAYER/TOO-RISKY
  (system-wide mutation from an unsigned app for a cosmetic message; revert can't run on cancel; AV surface;
  cross-app race). The reg KEY is real (research-verified) but the toggle approach is unshippable.
- **Workflow Suite Slices 2-6** (`docs/designs/WORKFLOW_SUITE_2026-07-18.md`, Oracle C1-C8): decision
  snapshot · amount-threshold routing · multi-step · delegation/escalation · packaging flip
  (`WORKFLOW_FEATURE_ENABLED=true` atomic with the backend SKU, C8).
- **Filing Slips slice 5** (watch-folder parity) + real MFD pilot — before any slips default-ON.

## Needs the USER
- **Does the Ricoh print paper?** (the decisive open question above).
- Owner smoke of the reactive print preview (mono/range/N-up) — quick.
- Standing from prior handovers: generic-doc live smoke; real MFD Filing-Slips pilot.

## Key facts / paths
- Live DB `%APPDATA%\Roaming\ScanFinder\docusnap.db` (read-only Python `?mode=ro`). Highest stamped migration
  50; the workflow schema block is UNSTAMPED/idempotent at the end of runJsMigrations; the Slice-1 paid heal
  is at the TOP of runJsMigrations.
- Switches: `WORKFLOW_FEATURE_ENABLED=false` (dark), `printing_enabled` (default OFF) + env
  `PRINTING_ENABLED`, `ACCESS_GATE_ENABLED` (default ON). Slice-1 adds `workflow_toasts_enabled` (default on,
  observable only when entitled).
- Tests: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <path>` (JS); `py -3.12 <path>` (Python).
  Corpus: `stress_test/realdoc_regression.js` → `stress_test/out/realdoc_regression.md`; Slice-1 baseline
  `stress_test/out/workflow_slice1_BASELINE.md`. Build: `npm run build` (close the dev app — EPERM otherwise).
- Advisors are registered subagent_types (bob/gary/oscar/eric/reggie/oracle/barry-the-brainstormer); 007 =
  general-purpose + persona. Memory updated: `project_workflow_suite_design`, `feedback_print_driver_audit`.
