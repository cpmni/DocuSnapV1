# Client Search Parity + Pop-out — design & sliced plan (2026-09-13)

eric-designed. **Oracle 2026-09-13: SIGN OFF WITH CONDITIONS for S0 as re-proposed** (see `docs/oracle_log.md`
2026-09-13 — the plan AS WRITTEN below would have been SEND BACK on three facts; the amendments in the box
supersede the matching sections). Owner mandate: bring the detached **client** search up to the **core**
search window's feature set, pop search out into its own window, AND build it so **every future change to
the core search replicates to the client automatically** (no fork that rots).

> ## AMENDMENTS (Oracle-vetted, binding — supersede the sections below where they differ)
> - **Location is `src/windows/shared/search-ui/`, NOT `src/shared/`.** `scripts/harden-js.js` keeps only
>   `src/windows/**` on disk and `verify-release-artifact.js` PLAINTEXT_FORBIDDEN never flags `src/shared/` — a
>   file there is neither protected nor refused. Pins for the module live at `src/windows/shared/test_search_ui_*.js`
>   (run-pins discovers one level under `src/windows/` only).
> - **Module style = plain `<script>` globals + an adapter global `window.SearchTransport`** loaded BEFORE the shared
>   scripts (core: `src/windows/search/coreTransport.js`, a PURE pass-through to the preload bridge — same method
>   names + positional arity, no catch/envelope; client: its own adapter, S1). Not ESM `initSearchUI(transport)`.
>   The `--smoke-windows` probe and `test_no_global_collisions` depend on this posture.
> - **Transport surface = the IO audit, not the table below.** The shared UI touches 24 bridge methods + `stamp.can`
>   + `onBinChanged`; three have NO `/v1` backing (`repairDeconfirm` send-back, `restoreAllDeleted`, the desktop-local
>   Explorer/Open File/Print trio). **caps** = `singlePage pageCount find spreadsheet bin restoreAll sendBack
>   localFile review print stamps settings` (absent = true; `_cap()` in searchState.js); each gates ONE decision.
> - **Markup + CSS sharing is REQUIRED by the mandate but is its own slice S0b, BEFORE S1**, gated by a headless
>   old-vs-new DOM-equivalence + computed-style diff (`#app.outerHTML` + display/flex/height of
>   `#app,#body,#results-pane,#preview-pane,#preview-sidebar`) — a `<div id="search-root">` WRAPPER inside `#app`
>   would break the `#app{flex column;100vh}`→`#body{flex:1}` height chain; inject as direct children / replace the
>   placeholder. CSS cascade order theme → searchUI → components is load-bearing.
> - **Committed generated copy** (`client/renderer/shared/search-ui/`, `scripts/sync-client-search.js`, client
>   `prestart`/`predist`) — not symlink (Developer Mode / winCodeSign trap), not extraResources (outside the asar +
>   the navGuard root), not a bundler. Checker `scripts/test_client_search_sync.js` is CRLF-normalised, banner-aware,
>   mirror semantics.
> - **`shared/thumbs.js` is NOT loaded by the core Search page any more**; the module ships `searchThumbs.js` on its
>   OWN global `window.SearchThumbs` (two scripts assigning `window.Thumbs` = load-order roulette).
> - **Q-F: the pop-out becomes the client's ONLY search**; the in-pane search (`client/renderer/renderer.js:985-1224`)
>   reduces to a launcher in S1 (its preview kept for the mailbox decision path until S4). Mounting the shared module in
>   the SAME page as renderer.js is the `_btn` collision class (`confLevel` is declared in both).
> - **S1 conditions:** pop-out CSP `style-src 'self' 'unsafe-inline'` (the client's `style-src 'unsafe-inline'` blocks a
>   linked stylesheet); **`theme.css` joins the sync set + a shared client theme-boot** (the client's hand-copied token
>   sheet lacks `--sans/--accent-bg/--accent-border/--err-bg/--warn-bg/--ok-bg/--doc-bg` → highlights render
>   TRANSPARENT); **`client-current-user` IPC** (no `/v1/auth/me`; main caches `{role,username,displayName}` from the
>   login response, cleared on logout; null → read-only, fail-safe); logout + main-window close KILL the pop-out;
>   connection-lost/restored broadcast to ALL windows; a client twin of the collision pin; a cap false for a
>   REMEDIABLE reason (contract drift) shows one line "Some tools need a newer ScanFinder on the core PC" — inherently
>   desktop actions just hide.
> - **S2 conditions:** `client-find` NOT `guarded()` + a long `timeoutMs` + timeout → a visible "Find took too long on
>   this scan" (apiClient's 20 s idle timeout matches `isNetworkError` → a slow scanned find would show "Connection
>   lost"); server caps the `/v1` OCR-fallback page count + returns `kind:'partial'`; `/page/:index?scale=` clamps
>   scale (cap 4) + index ≥ 0; `FIND_MAX_INFLIGHT` + `q ≥ 2`; never log `q`; contract 1.2.0→1.3.0 MINOR with
>   `CLIENT_CONTRACT` lockstep; `binRestoreAll` = cap false or a new endpoint.
> - **S0 STATUS: BUILT 2026-09-13** (this session) — see the commit + `docs/oracle_log.md`.

## The mandate's answer (enforced auto-replication)
The search UI becomes ONE canonical source both apps drive through an injected **transport**. Drift is made
impossible to ship by two guards + a generated client copy (the client is a separate electron-builder app
with its own asar and a navGuard that hard-restricts `file://` to `client/renderer/` — `client/main.js:72-78`
— so it cannot `require`/`<script src>` a file under `src/` at runtime; single-source is preserved by a
single canonical location + a generated, drift-guarded client copy).

## Canonical location
```
src/shared/search-ui/
  searchUI.js        ← bootstrap: exports initSearchUI(transport, { mount, state })
  searchResults.js   ← moved from src/windows/search/search-results.js
  searchQuery.js     ← moved from search-query.js
  searchPreview.js   ← moved from search-preview.js
  searchActions.js   ← moved from search-actions.js
  searchUI.css
```
- **Core** — `src/windows/search/index.html` loads `../../shared/search-ui/*.js` (same asar) + `coreAdapter.js`
  filling the transport 1:1 from `window.docusnap.*` (already-unwrapped) → `initSearchUI(coreTransport,…)`.
- **Client** — new pop-out `client/renderer/search/index.html` loads the GENERATED copy under
  `client/renderer/shared/search-ui/*.js` + `clientAdapter.js` filling the transport from `window.scanfinder.*`,
  unwrapping the `{status,json}` envelope → payload.

## Packaging (how the client bundles it)
- `scripts/sync-client-search.js` copies `src/shared/search-ui/**` → `client/renderer/shared/search-ui/**`,
  stamping a `// GENERATED — edit src/shared/search-ui` banner. Wired as the client's **prebuild** step →
  every client build regenerates the copy. electron-builder packs it with zero extra config (client `files`
  already include `renderer/**`; the copy sits inside the navGuard root).
- **Drift-guard #1 (staleness):** `scripts/check-client-search-sync.js` hash-compares the copy vs source and
  **exits 1 on drift** (client prebuild + CI; same posture as `scripts/check-licenses.js`).
- **Drift-guard #2 (no-direct-IPC pin):** `src/shared/search-ui/test_no_direct_ipc.js` fails if any shared
  file contains `window.docusnap`, `window.scanfinder`, `ipcRenderer`, or `require(` — the shared UI reaches
  IO ONLY through the injected `transport` + DOM. Add to `npm run test:pins`. This structurally prevents a
  future edit from re-hardcoding `window.docusnap.*` and quietly re-forking the client.

## Transport interface (the ONLY IO the shared module may touch)
`initSearchUI(transport, ctx)`. All methods return UNWRAPPED payloads (the core's existing contract); the
client adapter unwraps + error-normalises.
```
transport.caps = { singlePage, pageCount, find, findOcr, spreadsheet, resizableGrid, stamps, entitlementFields }
transport.search(params)              -> { confirmed:[docRow], uncommitted:[docRow] }
transport.getDocumentDetail(id)       -> { id, supplier_name, type_name, reference_number, doc_date, status,
                                           overall_confidence, extractions:[{field_key,display_value,confidence,validation_note}] }
transport.getPages(id,{scale})        -> string[]         // full render; ALWAYS available
transport.getPage(id,index,{scale})   -> string|null      [caps.singlePage]
transport.getPageCount(id)            -> number|null       [caps.pageCount]
transport.find(id,query)              -> { kind, pages, matches:[{page,x0,y0,x1,y1}] }   [caps.find]
transport.getSpreadsheetGrid(id)      -> { sheets:[{name,rows:string[][]}], truncated }|null [caps.spreadsheet]
transport.getThumbnail(id)            -> string|null
transport.stamp = { canStamp(), stampTypes(), stampList(id), stampPlace(id,body), stampedDoc(id) }  [caps.stamps]
```
Boxes = page-fraction (0..1, top-left) — never paths; images = base64 data-URLs; grid = values-only (DTO-safe).

## Capability flags (shared UI hides what a transport can't do)
- Core adapter: every cap `true` (in-process).
- Client adapter: caps from (a) negotiated server contract (`connect()` returns serverVersion, `apiClient.js:116`):
  `find/singlePage/pageCount/spreadsheet = serverContract >= 1.3.0`; (b) entitlement (`entitlementFields =
  ent.search.entitled`, `stamps = ent.workflow.entitled`); `findOcr` follows `find`.
- Runtime belt: any client-adapter method that gets 404/426/402 flips its cap false + returns the graceful
  empty shape; the shared UI hides the Find box / xlsx tab / stamp button when a cap is false (never a dead
  control, never a throw). The core renderer already tolerates these nulls (search-preview.js:100, :517).

## The four `/v1` endpoints (the client adapter's backing)
LEAD FINDING: the four capabilities ALREADY exist as transport-agnostic fns in `src/services/previewService.js`
(getDocumentPage :207, getDocumentPageCount :242, findInDocument :337 incl. the scan-OCR fallback via
deps.tesseract, getSpreadsheetGrid :386; exports :399). Each new endpoint mirrors the EXISTING
`/v1/documents/:id/pages` handler (api/handler.js:540-567): match path, requireSession, accessService gate
(:528-531), server-side path resolution (F-02, never trust client paths), call the fn with pageDeps(), return
a path-free DTO. They fall inside `FEATURE_ROUTE` (:248) → auto entitlement-gated.

| endpoint | calls | extra deps | DTO |
|---|---|---|---|
| `GET /v1/documents/:id/page/:index?scale=` | getDocumentPage | none | `{page:dataUrl|null}` |
| `GET /v1/documents/:id/page-count` | getDocumentPageCount | none | `{count:int|null}` |
| `GET /v1/documents/:id/find?q=` | findInDocument | `findScript:.../render/pdf_find.py`, `tesseract:ctx.tesseractPath()` | `{kind,pages,matches:[{page,x0,y0,x1,y1}]}` |
| `GET /v1/documents/:id/spreadsheet` | getSpreadsheetGrid | `{fs,path}` | `{sheets:[{name,rows}],truncated}|null` |

**`find` is the first OCR-bearing READ on /v1** → give it its OWN in-flight cap (mirror ocr-region's
OCR_MAX_INFLIGHT/_ocrInFlight/429, api/handler.js:77-78,611,620-626; a scanned find OCRs EVERY page). Add
`FIND_MAX_INFLIGHT` (~2-3) + a `q` length floor (>=2, reject early, no spawn). Contract MINOR bump 1.2.0 -> 1.3.0
(handshake checks MAJOR only → a skewed pair warns, not blocks; keep apiClient.js:26 CLIENT_CONTRACT lockstep).

## Pop-out window (client)
Second independent top-level BrowserWindow (not child/modal), same webPreferences as the main window
(contextIsolation:true, sandbox:true, preload: preload.js — client/main.js:97-102). The global ipcMain
handlers mean any window loading preload.js inherits the whole `window.scanfinder` bridge; the session token
stays main-only (apiClient closure, apiClient.js:54) — CONFIRMED the pop-out gets full function with zero
token exposure. Single-instance (module `searchWin` ref, focus if alive else create, null on 'closed'); persist
bounds (search-window-state.json); show:false + ready-to-show; replicate the grabFocus wiring (client/main.js:117-120).
**SEAM:** connection-watch events (`client-connection-lost/restored`) are sent to `win` only (client/main.js:216-218)
— must broadcast to ALL live windows or the pop-out misses the overlay. pageCache (main, docId-keyed) is shared
automatically + cleared on logout.

## Slices
- **S0 — Extract shared module + transport + core adapter.** Move the 4 modules to src/shared/search-ui/;
  mechanically replace EVERY window.docusnap.* with transport.*; gate Find box / grid tab / confidence band on
  transport.caps.*; core bootstrap builds coreTransport (pass-through, all caps on). Both drift-guards. Core
  BYTE-IDENTICAL. Foundation — nothing else starts until green.
- **S1 — Client pop-out window** consuming the SAME module via clientAdapter, backed only by endpoints that
  already exist on /v1 (search/detail/pages/thumbnail/stamps). caps singlePage/pageCount/find/spreadsheet=false
  → UI hides them. Ships a real shared-code pop-out immediately. (Window plumbing above.)
- **S2 — Four /v1 endpoints** + MINOR bump → client caps flip on → lazy page/zoom/find parity lights up
  automatically (shared UI unchanged).
- **S3 — Spreadsheet grid + resizable columns.**
- **S4 — Stamps** in the pop-out (caps.stamps; /v1/workflow stamp routes + client IPCs already exist,
  client/preload.js:54-59).

## Assumptions to verify before S2 (eric flagged)
- The /v1 listener ctx has `tesseractPath` + `resourcePath` populated (ocr-region uses ctx.tesseractPath() at
  handler.js:629 → both exist, but confirm in the ctx bootstrap before wiring find).
- `window.SearchState` definition (referenced search-preview.js:12,50) — the pop-out must create/populate it
  (esp. `.entitled`) from the client's entitlement() result.
- A full grep of searchQuery/searchResults/searchActions for `window.docusnap` before S2 (rename set — only
  the search-preview surface was fully confirmed).

## Test plan
Drift-guard #2 pin (no direct IPC in shared dir); drift-guard #1 (hash-equal); adapter units (clientAdapter
unwrap {status,json}→payload; 404/426/402→empty shape + cap false; coreAdapter pass-through); capability tests
(serverContract 1.2.0→caps.find=false, no Find box; 1.3.0→Find box); endpoint conformance (accessService
denial→403/404; unauth→401; path-free DTO; find FIND_MAX_INFLIGHT+1→429; q<2→early reject no spawn); window
(single-instance; closed nulls ref; conn-lost broadcasts to all live windows).
