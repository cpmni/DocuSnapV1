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

---

## ADDENDUM — NIGHT RUN 2026-09-13 (`docs/designs/NIGHT_RUN_2026-09-13_LATE.md`; ledger in `NIGHT_RUN.md`)

**Commits (all pushed):** `8b374ce` red-pin hygiene + first-paint pips · `5195bfa` the "session ended" message always
shows when the pop-out closes on a 401 · `593335f` the real-core evidence + driver scripts · this docs commit.

### 1. `npm run test:pins` → **360/360 GREEN** (first fully green run)
- `render/pdf_find.py` was missing from the compile gate's `SPAWN_ENTRIES` (`scripts/compile-python-bytecode.js`) —
  a real packaging-gate gap (it is spawned by the desktop find-in-document AND the new /v1 find). Added.
- TEST_SWITCH_KEYS count pins 49 → 50 (mig 166's `template_date_invalid_yield_lowconf` is present, verified).
- `test_activity_strip` card 8: `repairService` gained a Quick-check send-back door between the two the pin knew — the
  pin now allows further named doors.

### 2. First-paint confidence pips — FIXED (shared module, both apps)
`SearchResults.redecorate()` re-renders the LAST result set once the entitlement is known (results-first ordering
kept; pinned: `search-documents` runs exactly twice in the harness session — initial + back-from-bin, never a third).

### 3. "The search window in the client doesn't open" — proven OK on REAL core code (20/20)
`TESTING/_measure/night_20260913/POPOUT_REAL_CORE.md`. A sandbox dev core (seeded licence + two users, `TEST_BUILD=1`,
real `/v1` on 8797) + the REAL client over CDP: refusal before sign-in (with a message) · open · 2 rows · role/entitlement
· S2 caps ON · theme follows · logout closes it · **a core restart under a signed-in client → the stale token makes the
pop-out appear-and-vanish and drops the client to its login screen** (correct; the message was SKIPPED when the heartbeat
had already signed out → fixed `5195bfa`, now always says "Your session ended — the search window closed") · read-only
user (403 on the writer-gated `/v1/doc-types` no longer matters). **Likeliest reading of the owner's report:** the
stale-session path — the main session restarted the core twice while the owner was testing. Morning question for the
owner: at that moment, had the client dropped to its login screen?

### 4. Chris (sandboxed, BOTH apps) → `docs/CHRIS_FULL_APP_REVIEW_2026-09-14.md` (report verbatim + triage table)
Verdict YES; the pop-out opened 4/4 for him (two users), Find on scanned pages / stamp / approve over the network all
worked. **8 cards, NOTHING implemented (owner vets):**
1. **APPROVAL-CLASS, morning #1 — the `/v1` purge leaves the filed PDF + `.metadata` xml on disk** while saying "and its
   file". PRE-EXISTING: `api/handler.js _purgeDocFiles` still deletes `[resolveFilePath(doc), working_path]` (the working
   copy only) — the desktop's `_purgeOne` got the stored_path + xml fix on 2026-08-13; the /v1 lane never did. Fix = route
   the /v1 purge/purge-all through the same helper + a /v1 pin. A destructive path → your go.
2. The client pop-out's bin view "won't let go": (a) a purge from the rail/menu clears the selection but not the pane —
   on the core the `bin-changed` push clears it, the client has no push; (b) a Home deep-link arriving in bin mode
   searches the deleted queue ("Pelican 0 / 0" beside "The recycle bin is empty"). Shared-module fix, small.
3. Client Quick File lists no types on a fresh install — the core pane offers the catalog presets (create-on-first-use);
   the client renders `installed` only. Client Quick File lane.
4. Granting "Can stamp" doesn't reach an open Search window (canStamp read once at init) — re-read when the popup opens.
5. Client Home "AWAITING OTHERS" counts approved routes (no state filter). 6. Read-only FYI items have no "Got it" in the
   client's main-window mailbox. 7. Stamp history prints the UTC hour + raw username. 8. Titles: the client's main window
   shares the pop-out's title; dialogs say "scanfinder-client".
Also noted: a 34-page stack imported from `.sf_separated_originals` came in as 34 BLANK pages (a driver choice of folder,
but worth a look); Demo Docs has no .xlsx/.docx so the grid path was not exercised by Chris (it is by the harness).

### Running at wrap
- The OWNER's core (`TEST_BUILD=1`) + client are RUNNING on the latest code (client relaunched on `5195bfa`).
- The SANDBOX is left running for you to poke: core CDP 9223 (`/v1` on 8797, users `nightadmin`/`Night-Admin-9`,
  `nightreader`/`Night-Reader-9`), client CDP 9226; everything under `scratchpad\night-sandbox\` (session-mortal).
  Kill filters: cmdline `*remote-debugging-port=9223*` (core) / `*9226*` (client).

### Approval-class (logged, not done)
The `/v1` purge fix (card 1) · the `/v1` MINOR for the pop-out's hidden workflow bits · the mig 166 flip gate · any
customer-default flip · the client `npm run dist` in lockstep (contract 1.3.0).
