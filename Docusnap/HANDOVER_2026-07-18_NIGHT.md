# HANDOVER — 2026-07-18 NIGHT

**Branch:** `feat/reprocess-throughput-autostraighten` · **all pushed through `252c058`** (working tree has only
pre-existing dirt: `.gitignore`, `stress_test/out/accuracy_baseline.md`, plus this handover + the design doc
committed alongside it). **No installer rebuilt since `r20260718-0818-bea1028`** — several features shipped
since; rebuild before any packaged test.
**Supersedes** `HANDOVER_2026-07-18_EVENING.md` (Filing Slips day). Read this first.

> **NOTE FOR A LOWER MODEL / HIGH EFFORT:** this session ran a heavy advisor+Oracle process. The SAFE
> remaining work for a lower model is **Print-Slice 2** and **workflow notifications** (well-scoped, additive,
> kill-switched). **DO NOT** attempt the Workflow Suite ENGINE slices (schema migration, multi-step CAS,
> licensing flip — Oracle conditions C1–C8) without the advisor+Oracle gate and, ideally, a stronger model —
> they touch security, a stamped DB migration, and shared confirm paths. When unsure, STOP and hand back.

## TL;DR — what shipped this session (newest first)
1. **PRINT + PRINT PREVIEW (BUILT, default OFF).** `252c058` in-app Print Preview modal; `b9e8c03` Print-Slice 1
   (driver-dialog print of the original). Owner-requested. Kill switch setting `printing_enabled` (default OFF).
2. **WORKFLOW SUITE — DESIGNED (Oracle C1–C8) + SLICE 0 (authz) BUILT.** `f8299d4` = the SEC-03 fix. The rest of
   the suite is designed, NOT built. Full spec: `docs/designs/WORKFLOW_SUITE_2026-07-18.md`.
3. **GENERIC DOCUMENT TYPE + AUTO-TITLE — ALL 6 SLICES BUILT, default OFF.** `6d54b2f`→`4a4abe4`. Spec
   `docs/designs/GENERIC_DOCTYPE_2026-07-18.md`. Owner-confirmed live earlier.
4. Minor: `78e50fa` Import action-buttons top-aligned; `2deed1b` prior-session Option-A duplicate-filing core
   committed (inert, unwired); a Settings hierarchy restyle (`a14bd08`, from the afternoon).
5. **NEW advisor agent `barry-the-brainstormer`** registered (`.claude/agents/`).

## Committed this session (all pushed)
- **`f8299d4` — Workflow Slice 0 / authz (SECURITY).** NEW `src/services/accessService.js`
  `canAccessDocument(db, user, docId)` — the ONE fail-closed per-document read gate, shared by /v1 + desktop.
  Enforced at all 6 by-id read seams (api/handler.js detail :456 / pages :468 / thumbnail :494; review/handler.js
  get-document-with-extractions :388 / pages :434 / thumbnail :459). Fixed the desktop client-path-trust bug in
  BOTH pages AND thumbnail (resolve server-side from the doc row). `database/modules/workflow.js` +
  `isOpenRouteParty`. Kill switch `ACCESS_GATE_ENABLED` DEFAULT ON. Route-party grant = OPEN routes only (Oracle
  C3). Test `src/services/test_access_service.js` 28/28; corpus byte-identical; neighbour suites green.
- **`b9e8c03` — Print-Slice 1.** NEW `src/modules/print/handler.js` (`print-document`, `print-available`). Bare
  offscreen PDF BrowserWindow + `webContents.print`. Server-side path via `documents.resolveFilePath`. Goes
  through `canAccessDocument`. Audited (`document_printed`). Review #doc-toolbar Print button + Settings→Processing
  "Printing" toggle. Kill switch setting `printing_enabled` DEFAULT OFF + env `PRINTING_ENABLED`. Test
  `src/modules/print/test_print.js` 11/11.
- **`252c058` — Print Preview.** Electron does NOT render Chromium's print-preview pane (known limitation — the
  "This app doesn't support print preview" the owner saw; no config fix). So we render our OWN in-DOM modal in
  Review (reusing the already-loaded `pageImages`) + a printer picker (NEW `list-printers` IPC →
  `getPrintersAsync`). **Print uses `silent:true` to the chosen device = the real driver with its saved settings
  (opts override / omitted opts inherit driver defaults) — NOT a generic bypass** (eric's load-bearing fact). A
  "Printer settings…" button = `silent:false` full driver dialog escape hatch. The real vector PDF always spools;
  renderer sends only `{docId, source, options}`, never a path/images.
- **Generic Document slices `6d54b2f`…`4a4abe4`** (see the EVENING handover + `project_generic_doctype_design`
  memory). Default OFF; corpus OFF+ON byte-identical; new default filename pattern gained `{title}`.

## Verification state — honest ledger
- **Corpus baseline** for this whole session = `stress_test/out/generic_doctype_BASELINE.md` (76 confirmed docs,
  M=0/M_type=0). EVERY slice above re-ran it and diffed **byte-identical** (authz + print are read/UI-only and
  never touch extraction/filing; generic slices gate OFF and prove ON decision-identical). Out files are gitignored.
- **Unit gates:** `test_access_service.js` 28/28 · `test_print.js` 11/11 · generic batteries green · neighbour
  suites (v1 review/workflow, workflow service, previewservice, reviewservice, workflow-lock, documents-CAS) green.
- **NOT auto-verified (manual, need the owner + hardware):** the physical print spool + driver-default fallback
  for duplex/colour (needs a real duplex printer); the Review preview still renders after the Slice-0 path change
  (should — legit reads unchanged; eyeball on restart). The owner had the app open on `b9e8c03` (pre-preview) —
  **restart to get the preview modal.**
- **Pre-existing unrelated failure:** `src/modules/workflow/test_workflow_ipc.js` fails because it needs the dark
  `WORKFLOW_FEATURE_ENABLED` flag on to assert entitlement — NOT touched by anything this session.

## FIRST ACTIONS for the next session
1. If continuing PRINT: **Print-Slice 2 (stamped source)** — in `src/modules/print/handler.js`, the
   `source:'stamped'` branch currently returns `{ok:false, reason:'stamped_not_available'}`. Wire it: resolve
   `document_routes.stamped_path` server-side (mirror `api/handler.js:638` party-scope) + render/print it. BUT
   this only matters once the workflow produces a stamp — so it naturally follows a workflow slice. LOW-RISK once
   a stamp exists.
2. If continuing WORKFLOW: **Slice 1 (v1 single-hop reveal)** — remove the half-wired `paid` state (Oracle C1:
   migrate existing `paid` rows to `approved` BEFORE any CHECK), add the reject→revise→resubmit loop, wire
   notifications (pull model — badges/at-login digest/Windows toast). **This is where the risk climbs** — read
   `docs/designs/WORKFLOW_SUITE_2026-07-18.md` §5/§9 and honour the Oracle conditions; run the advisor+Oracle gate.
3. Owner smoke tests still open: print preview on a real printer; the generic-doc live smoke (Settings→Processing→
   "Unrecognised documents" ON → import an arbitrary letter → General Document + title + scan-date prefill).

## Deferred / designed-not-built (with the load-bearing conditions)
- **Workflow Suite Slices 1–6** (`docs/designs/WORKFLOW_SUITE_2026-07-18.md`): the mailbox foundation ALREADY
  EXISTS behind `WORKFLOW_FEATURE_ENABLED=false`; the suite completes it. Oracle conditions C1 (paid-migrate
  before CHECK) · C2 (FK ON DELETE SET NULL + pre-sanitize) · C3 (route-party OPEN routes only — already in
  Slice 0) · C4 (amount routing keys off a trust-passing total, integer pennies) · C5 (escalation sweep
  CAS-guarded) · C6 (SoD at assign AND resolve) · C7 (confirm hook post-commit/detached/fail-open) · C8
  (packaging flip atomic in one build). Owner answered all 8 open decisions "as recommended".
- **Print-Slices 2–4** (stamped source · silent quick-print · /v1 client-local print).
- **Filing Slips:** real MFD pilot still the open gate (synthetic passed). **Generic Doc:** owner live smoke.
- Standing: `SECURITY_BACKLOG.md` SEC-01…20 (SEC-03 now FIXED by Slice 0 — update the backlog); template-merge
  refinement; Barry's home-edition roadmap.

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db`. Switches this session: `printing_enabled` (default OFF) +
  `PRINTING_ENABLED` env; `ACCESS_GATE_ENABLED` (default **ON** — security); `filing_slips_enabled`,
  `generic_fallback_enabled`, `auto_title_enabled` (all default OFF).
- Tests: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <path>` for JS; `py -3.12 <path>` for Python;
  corpus `stress_test/realdoc_regression.js` (report `stress_test/out/realdoc_regression.md`; baseline
  `generic_doctype_BASELINE.md`).
- Build: `npm run build` (close the dev app first — EPERM on better_sqlite3.node otherwise). New vendored deps
  this era: `segno`, `zxing-cpp` (Filing Slips) — already in `vendor/python`.
- Advisors are registered subagent_types (bob/gary/oscar/eric/reggie/oracle/**barry-the-brainstormer**); 007 =
  general-purpose + persona. Memory: `project_workflow_suite_design`, `project_generic_doctype_design`,
  `project_filing_slips_design`, `feedback_print_driver_audit`.
