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

---

## ADDENDUM 2 — MORNING 2026-09-14: Chris cards 1-8 BUILT (owner: "Continue with Chris's fixes in the recommended order")

**Commits (all pushed, origin current):** `0129053` card 1 · `ff49223` cards 2/4/6/7 (shared screen) · `0f58ecb`
cards 3/5/8 (client) · the docs commit. Per-card outcomes table at the end of `docs/CHRIS_FULL_APP_REVIEW_2026-09-14.md`.

**What changed, in plain terms**
1. **Permanent delete from the client now really deletes the file** — the filed PDF and its xml note, not just the app's
   working copy. Both apps share one helper for it (`review/handler.purgeDocumentFiles`); the desktop path is unchanged.
   New pin `src/modules/api/test_v1_purge_files.js`.
2. **The bin lets go** — a document you permanently delete leaves the preview; a Home search or "open this document"
   that arrives while the window is in the bin or the mailbox leaves that view first (`SearchQuery.setQuery` /
   `SearchPreview.openDocById` are now the ONLY entry points for that — the core's Quick-find and the client's Home
   search, recent row and live push all go through them).
3. **Client Quick File on a fresh install** lists the catalog presets (admin) and explains itself when there is nothing
   to pick; the core sets a preset up on first use (`new:<slug>` on the intake POST, admin only, idempotent).
4. **"Can stamp" reaches an open Search window** — the popup re-asks when it opens.
5. **Home "Awaiting others"** counts routes still waiting, not the ones already approved/rejected.
6. **A read-only person with a request waiting** gets a "✉ Waiting on you…" button (Got it / Approve; no stamp/send
   panels). The client's main-window mailbox already offered "Got it" regardless of role (verified in code).
7. **Stamp history** shows local time (DD-MM-YYYY HH:MM) and the person's display name.
8. **Titles:** the client's main window is "ScanFinder Client" (the pop-out keeps "ScanFinder — Search"); native
   dialogs say "ScanFinder Search Client".

**Verification:** `npm run test:pins` **360/361** — the one red, `src/services/test_ref_class_fix.js`, is the pre-existing
flaky pin (87/87 when run alone; a timing-sensitive byte-identical compare under the parallel suite) · the four search
pins green (purge-files 5, functional core 77, pop-out 209, sync 32) · `--smoke-windows` **14/14** run in DEV against a
throwaway userData (`SCANFINDER_SMOKE_DIR=<dir> electron.exe . --smoke-windows`) · the owner's core (`TEST_BUILD=1`, /v1
on 8765) + client were RESTARTED on this code at 04:02 (the client will show its login screen — the old session died
with the old core).

**Harness notes:** core-side bin mutation stubs (`purge-document` etc.) were missing (the drive now purges from the
rail); the read-only popup check stubs `stamp.can` false; the "searches ran exactly twice" pins are "exactly 3" now
(initial + `setQuery` + back-from-bin — the first-paint re-decoration is still not a fetch).

**Still owed (unchanged):** the `/v1` MINOR for the pop-out's hidden workflow bits · the mig 166 flip gate · the owner's
answer on the "doesn't open" moment (§3 above) · the 34-blank-pages question (`pendingfeatures.md`).

### TEST INSTALLERS built 09:03-09:06 (owner: "build the core and the client with all new features enabled, for testing")
- **Core:** `dist\ScanFinder Setup 2.0.0-r20260914-0803-39ae9ab-TEST.exe` (352.5 MB) — `npm run build:test`
  (`build-release.js nsis --test`: plain JS, `TEST_BUILD=1`, `extraMetadata.testBuild=true` → all **50** DARK keys in
  `database/dark_switches.js TEST_SWITCH_KEYS` arm at runtime, incl. `direct_intake_enabled` (Quick File),
  `departments_enabled` and mig 166's `template_date_invalid_yield_lowconf`). Gates: check-release-migrations OK
  (50 keys guarded), vendor-python, licences, bytecode compile, no-shipped-py-source. Packaged binary: `--smoke-boot`
  identity `{"testBuild":true,"buildRev":"20260914-0803-39ae9ab-TEST"}`, `--smoke-windows` 14/14. ⚠ Lesson: the
  release verifier (`verify-release-artifact.js`) was run on it and REFUSED on source-protection (a test build ships
  plain JS by design — `build:test` deliberately skips the verifier) and renamed the installer `*.REFUSED.exe`; renamed
  back, content untouched. Vet test builds with the packaged `--smoke-boot` / `--smoke-windows` only.
- **Client:** `client\dist\ScanFinder Search Client Setup 1.0.2-r20260914-0805-39ae9ab.exe` (106 MB) — `npm run dist`
  (predist re-synced the shared search screen); contract 1.3.0 in lockstep with the core.
- To build, EVERY Electron from the repo was closed (owner's dev core + client AND the night sandbox — 19 procs);
  **nothing was relaunched** so the owner can install the test core over the dev DB (`%APPDATA%\ScanFinder`, already
  armed by the dev runs) without a single-instance/DB collision. Relaunch dev = `TEST_BUILD=1 npm start` + `client\
  node_modules\electron\dist\electron.exe .` (recipe in memory `project_dev_restart_singleinstance_trap`). The sandbox
  is GONE (was on old code; re-seed with `scripts/seed-chris-sandbox.js` if needed).

---

## ADDENDUM 3 — 2026-09-14 (later morning): item 3 BUILT — `/v1` contract 1.4.0, the pop-out's last workflow bits

**Owner: "go ahead with item 3."** Oracle SIGN-OFF-W/COND (`docs/oracle_log.md` 2026-09-14), conditions built in the
same commit. Contract + gates in `docs/detached-client.md`; plan `docs/designs/CLIENT_SEARCH_PARITY_PLAN_2026-09-13.md`
S5 status.

**What changed, in plain terms**
- The client's search window now has everything the core's has for approvals: who approved / rejected / saw a
  document and when (with a "View stamped copy" link that opens the stamped page in the window), a "Sent to X —
  awaiting their approval" note on a document that is out with someone, an admin's two-click "Cancel route" on it,
  and "+ New stamp" for admins. An older core simply hides them (the client asks the core's version first; it never
  sends a request the core can't answer).
- FINDING on the way: the "Sent to X" note and the admin cancel had been DEAD on the core too since the 28 Aug popup
  redesign (the code that drew them inline was never called again). They now live in the popup's Send panel, so both
  apps got them back. The dead inline code is marked and queued for removal (`pendingfeatures.md`).
- Two things the Oracle caught before commit: (1) a cancelled route was about to be blamed on the sender in the
  history ("RECALLED alice — Cancelled by Admin") — fixed: the sender is named only for their own recall; (2) one
  document hidden from a user (deleted under them, or department-restricted) would have silently switched those
  controls off for the rest of the session on the client — fixed: a hidden document just shows nothing for itself.

**Server** `src/modules/api/handler.js` (all under `/v1/workflow/*`): `GET …/documents/:id/routes` + `…/history`
(admin/edit, accessService, projected — no sender comment, no path), `POST …/routes/:id/cancel` (admin at the route
AND in the service, CAS version → 409, closed → 400 INVALID, audited tombstone), `POST …/stamp-types` (admin; the
catalog module validates). `API_CONTRACT_VERSION` **1.4.0**. **Client:** `apiClient.js` (CLIENT_CONTRACT 1.4.0 + 4
methods), `main.js` (4 guarded IPCs), `preload.js`, `clientTransport.js` (caps version AND role gated — reads
admin/edit, cancel + new stamp admin; `docRead` for the per-doc reads; `stampedOverlay` in-window viewer),
`search/index.html` overlay CSS. **Shared popup** `searchStamp.js`: routed banners + two-step cancel in the Send
panel; history rows name the actor (OC2-correct) + link the stamped copy; `searchWorkflow.js` header marks the dead
provider.

**Verification:** `npm run test:pins` **361/361**; `test_v1_workflow` end-to-end over the REAL client transport (role
denials, path-free projection, CAS 409, INVALID, tombstone + audit row, stamp-type validation codes);
`test_client_search_popout` **365** across five harness runs (A1 parity · A2 lite 1.2.0 · A3 workflow · A5 workflow as
EDIT · A4 workflow vs a 1.3.0 core — the 1.4.0 channels never called); core functional **82**; sync 32. Harness gained
`--role`, a stateful workflow world (a closed stamped route + two `recalled` producers on doc 1, an open route on doc
2, a hidden doc 3 that answers 404) and a null-safe `click` (a missing target is a recorded failure, never a lost
report).

**Installers REBUILT on this commit (`2dbe494`, 10:30-10:32)** so the owner's test carries item 3 — these SUPERSEDE
the 09:03 pair (which lack contract 1.4.0; core 1.3.0 + client 1.4.0 would just hide the new bits):
- core **`dist\ScanFinder Setup 2.0.0-r20260914-0930-2dbe494-TEST.exe`** (352.5 MB; packaged `--smoke-boot` identity
  `{"testBuild":true,"buildRev":"20260914-0930-2dbe494-TEST"}`, `--smoke-windows` 14/14);
- client **`client\dist\ScanFinder Search Client Setup 1.0.2-r20260914-0932-2dbe494.exe`** (106.1 MB; contract 1.4.0).
Install the core first, then the client; nothing is running at wrap (no dev core / client / sandbox).

---

## ADDENDUM 4 — 2026-09-14 (midday): the CONTENTS panel + Search viewer SPEED (contract 1.5.0)

**Owner:** "I meant the bookmarks/outline … click a link to jump to that page — add the contents panel. Please explore
how we can speed the viewer in search up." Oracle SIGN-OFF-W/COND (`docs/oracle_log.md`), conditions built.

**What changed, in plain terms**
- **Contents panel** (both apps): a PDF that carries bookmarks shows them in the details column above the fields,
  nested; click one → that page. A document with none shows nothing extra. It loads after the first page paints,
  so it never slows the open. An entry pointing past the pages we know about (a document whose page count was never
  recorded and is still being counted) is greyed with a tooltip and explains itself if clicked — never a dead button.
- **Speed — measured first** (`TESTING/_measure/viewer_speed_20260914/report.json`): every page / thumbnail / count
  is a separate Python process — **0.26-0.29 s just to start**. Drawing page 1 is 0.09-0.15 s. **Turning a SCAN page
  into a PNG at the viewer's resolution was 0.84 s and 4-5 MB per page** (5.5-7 MB over the wire); the same page as
  a JPEG is 0.03 s and ~1 MB. Thumbnails: 0.35 s each, all fired at once.
- **Built:** (1) scan pages now travel as JPEG (text/vector pages stay lossless PNG; the core decides per page from
  the PDF's image objects): a scan page **1.3 s → 0.48 s, 5.6 MB → 1.2 MB**; Review / teach / OCR crops untouched.
  (2) At most two thumbnails render at a time, newest visible row first, rows that scrolled away are skipped and
  re-asked when they come back.
- **Next speed step (Oracle-ruled, not built):** ONE Python call for the first paint (`--page-info` = page 1 + the
  page count + the bookmarks together — today up to three processes); only after that a persistent render worker,
  and only for the small reads, with the lifecycle rules in the Oracle log. Both in `pendingfeatures.md`.

**Server / client:** `render/pages.py --format png|jpeg|auto` (+ `--quality`) for the single-page render, `--outline`
(pypdfium2 `get_toc()`); `previewService.getDocumentPage(format)` + `getDocumentOutline` (re-validated entries);
desktop `get-document-outline` IPC + the page IPC's 4th arg; `/v1` page read `?fmt=auto|jpeg` + `GET
/v1/documents/:id/outline` (same gates as `/page`); **contract 1.4.0 → 1.5.0** (`CLIENT_CONTRACT` lockstep; the
client's Contents cap needs both sides ≥ 1.5.0; an older core just keeps sending PNG). Shared viewer:
`SEARCH_RENDER_FORMAT='auto'`, `#preview-outline` panel (`searchMarkup.js`/`searchUI.css`/`searchPreview.js`),
`searchThumbs.js` queue (LIFO, cap 2, forget gone rows).

**Verification:** `npm run test:pins` green (full number in the commit); new pins `python_backend/tests/
test_pages_outline_format.py` (run under BOTH `py -3.12` = pypdfium2 5.9.0 and `vendor\python\python.exe` = 5.10.1 —
the vendored API is what ships) and `src/windows/shared/test_search_thumbs_queue.js`; `test_v1_preview_reads`
(fmt forwarding, outline gates + re-validation), `test_fast_first_page`, `test_core_transport`; core functional 90,
pop-out 392 across five runs (the Contents click renders the target page; hidden vs a 1.2.0 / 1.3.0 core).
**Installers REBUILT on this commit (`9cbe928`, 11:05-11:09) — these SUPERSEDE every earlier pair today:**
- core **`dist\ScanFinder Setup 2.0.0-r20260914-1005-9cbe928-TEST.exe`** (352.5 MB; packaged `--smoke-boot` identity
  `{"testBuild":true,"buildRev":"20260914-1005-9cbe928-TEST"}`, `--smoke-windows` 14/14; the packaged `pages.pyc`
  answers `--outline` and `--format auto` under the vendored Python);
- client **`client\dist\ScanFinder Search Client Setup 1.0.2-r20260914-1008-9cbe928.exe`** (106.1 MB; contract 1.5.0).
Install the core first, then the client; nothing is running at wrap.

---

## ADDENDUM 5 — 2026-09-14 (afternoon): ONE process for the first paint + a 3-page READ-AHEAD (contract 1.6.0)

**Owner:** "go ahead with the --page-info single spawn — can we prefetch 2 or 3 pages after the one in view to ensure
page skipping is seamless?" Oracle SIGN-OFF-W/COND (`docs/oracle_log.md`), C1-C5 built.

**In plain terms**
- Opening a PDF in Search now asks Python ONCE for page 1, the page count and the bookmarks together (it used to be up
  to three separate starts). No count probe, no separate bookmarks read.
- As soon as a page is on screen, the NEXT THREE pages render in one background call; a page you reach while that
  call is still running waits for it instead of starting another. Flipping forward is instant once they land. On a
  document you reached through a search term, the read-ahead starts after the term highlight, so the highlight is
  never delayed by it.
- Older cores: the client falls back to the per-page reads (and the 1.5.0 bookmarks read); an older client just
  keeps using the per-page reads against a new core.

**Server / client:** `render/pages.py --page-info --page N --also a,b,c` → `{pages, outline, images}`;
`previewService.getDocumentPageInfo` (also deduped / whitelisted / capped 8, images filtered to the asked indexes and
to `data:image/` strings); desktop `get-document-page-info` IPC; `/v1 GET /documents/:id/page-info` (same gates as
`/page`, `also` capped at 4 per request); **contract 1.5.0 → 1.6.0**; client apiClient / main / preload /
clientTransport (cap `pageInfo`, a `docRead`). Shared viewer `searchPreview.js`: the first paint via page-info (no
`also`), `_prefetchAhead` (PREFETCH_AHEAD = 3, one batch in flight per selection, identity-guarded latch, re-armed
from the page in view), `_pageJobs` (a page reached mid-batch awaits it), the stamped ⇄ original swap guard, the
file's count wins over a stale row, `_prefetchHold` until the find lands.

**Verification:** `npm run test:pins` green; the harness gained `--race` (both apps: a late batch from a previous
selection never frees the latch; the re-arm is sequential) and the pop-out pin an A6 run against a 1.5.0 core (the
fallback path) + A7 (the race); exact call-count pins (two page-info calls for doc 1: the first paint, one batch; no
per-page read, no count probe, no outline read); `test_v1_preview_reads` covers the route (sanitised `also`, clamps,
image filtering, non-PDF without a spawn, 404/401); the Python pin under both interpreters.
**Installers REBUILT on this commit (`6f735bb`, 11:39-11:44) — these SUPERSEDE every earlier pair today:**
- core **`dist\ScanFinder Setup 2.0.0-r20260914-1039-6f735bb-TEST.exe`** (352.5 MB; packaged `--smoke-boot` identity
  `{"testBuild":true,"buildRev":"20260914-1039-6f735bb-TEST"}`, `--smoke-windows` 14/14; the packaged `pages.pyc`
  answers `--page-info` under the vendored Python);
- client **`client\dist\ScanFinder Search Client Setup 1.0.2-r20260914-1043-6f735bb.exe`** (106.1 MB; contract 1.6.0).
Install the core first, then the client; nothing is running at wrap.

---

## ADDENDUM 6 — 2026-09-14 (afternoon): the owner's two answers → two small fixes; the date-format audit

**Owner: "no to the folder — I believe it didn't drop back to login yesterday, can't exactly remember."**
- **Importer refuses the app's own folders.** `process-folder` now refuses `.sf_separated_originals` / `.metadata` (the
  folder or anything below it) with a plain message — `processing/handler.js isAppManagedFolder` (module scope,
  exported) + pin `src/modules/processing/test_import_app_managed_folder.js`. The 34-blank-pages question is closed.
- **The pop-out "doesn't open" — a second, real cause found and closed.** The stale-session story was unconfirmed, so
  I looked again: the pop-out restored its last position from `search-window-state.json` WITHOUT checking that the
  position is still on a connected screen. A position saved on a monitor that is now gone (undocked laptop, second
  screen off) — or a window dragged almost entirely off the desktop — makes Electron create the window OFF-SCREEN: it
  runs, nobody sees it. Fix: `client/windowBounds.js sanitizeBounds` (pure; a saved position is kept only when ≥120 px
  each way lies inside some display's work area, else dropped so Electron centres the window; the size is clamped to
  the largest work area) wired into `openSearchWindow` with a stderr line when a position is dropped. Pinned in the
  pop-out pin (unit cases + the wiring). Minimised → restore was already handled.
- **Date formats (test customer: "23rd Aug 2026" not recognised while teaching)** — audit in the session reply; the
  gap is on the JS side (`filing/handler.js parseDate` — the canonical normaliser at confirm / filename / /v1 / Quick
  File — strips NO ordinal and takes no 2-digit year or `-`/`/` month-name shapes) and in
  `config/keyword_patterns.json validation_patterns.date` (the credibility gate + the Review badge — no ordinal, no
  `D-Mon-YYYY`); Python `validator.parse_date` already handles both. Fix = align JS + config with Python (reggie +
  Oracle first — the patterns are shared JS/Python). NOT built yet.

**Installers REBUILT on this commit (`99959c2`, 12:59-13:03) — these SUPERSEDE every earlier pair today:**
- core **`dist\ScanFinder Setup 2.0.0-r20260914-1159-99959c2-TEST.exe`** (352.5 MB; packaged `--smoke-boot` identity
  `{"testBuild":true,"buildRev":"20260914-1159-99959c2-TEST"}`, `--smoke-windows` 14/14);
- client **`client\dist\ScanFinder Search Client Setup 1.0.2-r20260914-1202-99959c2.exe`** (106.1 MB; contract 1.6.0).
Install the core first, then the client; nothing is running at wrap. Still owed: the dead-provider tidy-up · the Oracle's non-blocking notes (banner + assign form
stacking; 403 wording; the S2 reads' 404 flip) · the owner's answer on "content tables" (PDF reader question,
`pendingfeatures.md`) · everything in the earlier lists.

## ADDENDUM 7 — 2026-09-14 (late afternoon): the DATE FORMATS fix BUILT (mig 167 `date_forms_wide`) — the test customer's "23rd Aug 2026"

**Owner: "go ahead and align the date formats … should we strip all special characters … 23, aug 26 · 23-aug-26 …
could also be 23rd 24th 1st … check whether what I am saying is valid."** Checked, and it is valid with ONE tightening:
we do not strip characters, we ACCEPT any single one of `, . / \ -` (or none) between the three parts of a WRITTEN-OUT
date, because "strip everything" would turn "Aug 2026" into "Aug 20 26" and "1,234.56" into a date. Numeric dates are
not widened at all (the month NAME is the guard). reggie designed it; the Oracle vetted it (`docs/oracle_log.md`
2026-09-14, SIGN OFF WITH CONDITIONS — C1-C4 built, C5 = the flip gate).

**The rule (every surface, identical):** day (optional `st/nd/rd/th`) · month name keyed on its first three letters
(optional trailing dot; "Sept" works) · 2- or 4-digit year (a 3-digit clip stays refused; 2-digit pivots at 69 like
Python's `%y`) · between the parts optional spaces and AT MOST ONE of `, . / \ -`; letters⇄digits may be glued (an
OCR "23Aug2026") but digits→digits NEVER ("Aug 2026" must not read as 20 Aug 26); a leading day name ("Sunday,") is
dropped. And a REAL calendar date only — "31 Apr 2026" / "31/04/2026" / "2026-02-30" are refused everywhere (JS `Date`
used to roll them forward silently; the Python engine never did).

**Where it lives:**
- **Unswitched (a human's value):** the desktop CONFIRM door `filing/handler.js parseDate` (confirm, filename, `/v1`
  confirm, Quick File, `_autoFileDoc`); the Review drawn/typed reader `_matchStrictDate` + `_parseDrawnDate`; the Review
  badge / on-blur check AND the Quick-check grid through ONE helper `_widenDatePatterns` (Oracle C2); the Teach wizard's
  `_parsesAsDate`.
- **DARK on the engine side (mig 167 `date_forms_wide`, `TEST_SWITCH_KEYS` 50 → 51, env `DATE_FORMS_WIDE` from
  `processing/handler.js`):** `validator.parse_date` (`_wide_month_form` rebuilds the match as "D Mon YYYY" for the
  existing strptime lists), `anchor._crop_is_credible` + `keyword.py` (`_validate` qualification + the G4 guard) merge the
  new config `validation_patterns.date_wide`. OFF = byte-identical (pinned). A TEST build arms it with everything else.
- **Pins:** ONE shared vector file `python_backend/tests/date_forms_vectors.json` (accept → canonical DD-MM-YYYY; refuse
  lists per side) read by `python_backend/tests/test_date_forms_wide.py` (OFF + ON; green under `py -3.12` and
  `vendor\python`), `src/modules/filing/test_normalise_date_predicate.js` (57) and
  `src/windows/review/test_validation_pattern_surfaces.js` (170 — the pure renderer functions `_matchStrictDate`,
  `_widenDatePatterns`, `_parsesAsDate` are LIFTED from the source and RUN against the vectors; both regex fragments
  literal-pinned in the three JS readers; the Python separator constants pinned). Count pins 51. `npm run test:pins`
  **363/363 green.**

**⚑ FLIP GATE for the engine half (Oracle C5, owner's call after it passes):** realdoc 605 M=0 + `wouldFile`
set-equality OFF vs ON; the `VAL_CENSUS_DIR` crop/keyword acceptance census OFF vs ON with EVERY new acceptance
hand-verified against the rendered page; run with mig 166 in its shipping state (OFF) so the two date arcs are measured
apart. Until then a customer install keeps the wider forms at the human doors only — which is exactly the customer's
case (he typed / taught the date and was refused).

**The customer needs the new build** — his core is a week old; the fix is at the confirm door, which only a new
installer carries. **Installers REBUILT on `18bd9a2` (13:54-13:57) — these SUPERSEDE the 12:59 pair and are the pair to
ship him:**
- core **`dist\ScanFinder Setup 2.0.0-r20260914-1254-18bd9a2-TEST.exe`** (352.5 MB; packaged `--smoke-boot` identity
  `{"testBuild":true,"buildRev":"20260914-1254-18bd9a2-TEST"}`, `--smoke-windows` 14/14; verified the asar carries the
  wide `parseDate`, `_realDMY`, `_widenDatePatterns`, mig 167 and the config `date_wide` patterns; all 51 DARK keys arm
  at first run — a TEST build, not hardened);
- client **`client\dist\ScanFinder Search Client Setup 1.0.2-r20260914-1256-18bd9a2.exe`** (106.1 MB; contract 1.6.0).
Install the core first, then the client; nothing is running at wrap (no repo Electron was relaunched).
