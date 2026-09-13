# HANDOVER 2026-09-13 LATE — client search parity BUILT (S0 → S0b → S1 → S2 → S4): ONE shared search screen for core + client

Branch `feat/teach-side-overnight`. **HEAD `d9cee32`; origin CURRENT (everything pushed).** No installer built.
Owner-directed session ("read the handover and continue with the work") that ran the resume plan end to end,
plus two live-test fixes the owner reported mid-session.

## TL;DR
The mandate from the evening handover — bring the detached client's search up to the core Search window AND make
every future core-search change replicate to the client automatically — is BUILT and pushed as five commits:
- **S0 `48fba8f`** — the Search screen's JS extracted into ONE shared module `src/windows/shared/search-ui/`, driven
  through an injected `window.SearchTransport` (core adapter = pure pass-through to the preload bridge); caps hide what
  a transport can't do; two drift guards (committed generated client copy + hash pin; no-direct-IPC pin); a REAL-renderer
  functional harness. Core byte-identical (Oracle SIGN-OFF-W/COND, `docs/oracle_log.md` 2026-09-13).
- **S0b `ff9f92d`** — the MARKUP + CSS joined the module (`searchMarkup.js` mounts into `#app` as direct children;
  `searchUI.css` + `searchComponents.css`); the core `index.html` is a thin shell. Gate: `#app.outerHTML` BYTE-IDENTICAL
  + identical computed layout (`TESTING/_measure/search_parity_20260913/`).
- **S1 `d0fe6c6`** — the client's search POP-OUT window (`client/renderer/search/`) runs the generated copy over a client
  adapter; theme.css + fonts + patterns synced; single-instance window, deep-links, role via `client-current-user`,
  logout/main-close kill it, connection events broadcast to every window; the in-pane client search is a launcher.
- **S2 `4d502fd`** — four `/v1` preview reads (page / page-count / find / spreadsheet; contract **1.2.0 → 1.3.0**) light
  up lazy pages, Find and the xlsx grid in the pop-out; caps gated on the server handshake; a slow find never reads as
  "Connection lost".
- **S4 `d9cee32`** — approvals + the Send-or-stamp popup + the Mailbox joined the shared module (the owner's live-test
  report: "i dont see the workflow actions on the clients"); + the client Quick File view centred (owner: "very left
  aligned"). The client app was RELAUNCHED on this code for the owner's live test.

## What the owner should test live (the remaining gate)
1. In the CLIENT (running, relaunched on `d9cee32`): sign in → **Search** in the sidebar opens its own window = the core's
   search screen (same rows, preview, page nav, Find, xlsx grid, recycle bin, ↑/↓). Home search box + recent rows
   deep-link into it.
2. Workflow (with the add-on licensed): "🏷 Send or stamp…" on a document → the popup (stamp chips, Send to a colleague,
   History); **Mailbox** button → Inbox/Sent/Completed; an inbox item → its preview → the popup's "waiting on you" Approve/
   Reject. What the pop-out deliberately HIDES (no /v1 backing yet): decision History rows, open-route banners + admin
   Cancel route, "+ New stamp", "View stamped copy", Open in Explorer / Open File / Edit in Review / Print, Send back
   to Review, Restore all.
3. Quick File view in the client: centred column.
4. The CORE Search window: nothing should look or behave differently (that was the gate at every slice).
5. Theme: pick a theme in the client's main window → the pop-out re-themes live.

## Verification state (honest)
- `npm run test:pins` on the S4 tree: see the final line of this session's run (expected 355+/359 green; the 4 reds are
  PRE-EXISTING and unrelated: `test_activity_strip`, the TEST_SWITCH_KEYS 49→50 count pins `test_migration137_test_switch_reset`
  + `test_migration163_deskew_false_absent_reflag`, and `test_compile_python_keep` (pdf_find.py .pyc) — all from the
  09-13 evening session).
- Named gates green: `test_search_window_functional` 71 (core, incl. a `--workflow` run) · `test_client_search_popout` 195
  (PARITY + LITE(1.2.0 core) + WORKFLOW runs) · `test_client_search_sync` 32 · `test_search_ui_no_direct_ipc` ·
  `test_no_global_collisions` (planted-dupe self-test) · `test_core_transport` 34 · `test_v1_preview_reads` ·
  `test_v1_handshake/contract/intake` · `client/test_apiclient.js` (fixed: real schema, lockstep constant — it is NOT in
  the pin runner) · `--smoke-windows` 14/14 · `check:help` search 16 keys (the `settings: db-encryption` gap is pre-existing).
- NOT verified: a human click-through of the client pop-out against the live core (the harness drives the real pages
  over STUBBED IPC; the previous session's live login was the owner's). The core app is running `TEST_BUILD=1` (started by
  this session — the evening handover's "running" state was stale) so the client can connect.

## How the replication works (for the next dev)
- Edit ONLY `src/windows/shared/search-ui/*` (+ `theme.css`/fonts/patterns). Then `node scripts/sync-client-search.js`
  (the client's `prestart`/`predist` also run it). `scripts/test_client_search_sync.js` fails on a stale copy.
- A NEW IO call in the shared code: add it to `window.SearchTransport` in BOTH adapters — `src/windows/search/coreTransport.js`
  (pass-through, same name + arity) and `client/renderer/search/clientTransport.js` (over `window.scanfinder`, unwrap
  `{status,json}`, or cap it off). `test_search_ui_no_direct_ipc.js` fails if the shared code touches a member the core
  adapter lacks; `test_core_transport.js` pins the pass-through shape.
- A control the client can't back: gate it with `_cap('name')` in the shared code (absent = true), set the cap false in the
  client adapter — never a dead button.
- Verify: `node src/windows/search/test_search_window_functional.js` (core) + `node scripts/test_client_search_popout.js`
  (client), both drive the REAL pages over stubbed IPC; `electron.exe scripts/search-window-harness.js [--client]
  [--workflow] [--server-contract 1.2.0] [--dump x.json]` by hand.
- run-pins discovers `test_*.js` ONE level under `src/windows/` — module pins live at `src/windows/shared/test_*.js`.

## Follow-ups (logged in pendingfeatures.md / the plan doc)
- `/v1` MINOR for the pop-out's hidden workflow bits: per-doc history + open routes (`docHistory`/`docRoutes`), admin
  cancel, stamp-type create, a stamped-copy viewer — then flip the client caps.
- Confidence pips missing on the FIRST paint of the core/shared list (pre-existing; entitlement resolves after the
  results-first search) — pinned as-is; tiny fix after the shared module settles.
- The client build must ship in lockstep with the core (contract 1.3.0): `cd client && npm run dist`.
- From the evening handover, still owed: mig 166 flip gate (heal-vs-mislead census + Oracle), Quick File graduation (D2
  sweep), the mig 166 anchor-leg twin, the Explorer "File in ScanFinder" verb.

## Key facts / running state
- **RUNNING:** core dev app `TEST_BUILD=1 npm start` (4-5 electron procs; cmdline `*GIT Projects\Docusnap*` and NOT
  `*Docusnap\client*`) + the client (`client\node_modules\electron\dist\electron.exe .`, cmdline `*Docusnap\client*`).
- Contract: server `API_CONTRACT_VERSION` = client `CLIENT_CONTRACT` = **1.3.0**. Migrations unchanged (166).
- Oracle log 2026-09-13 (the parity plan verdict + all S0/S1/S2 conditions) appended to `docs/oracle_log.md`; the plan
  doc `docs/designs/CLIENT_SEARCH_PARITY_PLAN_2026-09-13.md` carries the binding AMENDMENTS box + per-slice status.
- Docs: `docs/detached-client.md` (the four endpoints + the pop-out), `docs/designs/…PLAN…`, this handover, memory
  `project_client_search_parity_20260913.md`.
