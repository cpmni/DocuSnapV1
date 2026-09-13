# HANDOVER 2026-09-13 EVENING — preview perf, scan find, date-precedence fix, client Quick File, search-parity PLAN

Branch `feat/teach-side-overnight`. **HEAD `a35051c`; origin CURRENT (0 ahead — everything pushed).** No
installer built this session. One uncommitted file at wrap: `docs/designs/CLIENT_SEARCH_PARITY_PLAN_2026-09-13.md`
(the resume plan — commit it first thing, see FIRST ACTIONS). Long owner-driven live-vet session.

## TL;DR
Shipped a batch of Search/Quick File UX + one extraction fix, all committed + pushed, all pinned:
- **Big docs open fast** — page-1-first for ANY pdf + a cheap page-count probe (no more all-pages render / ~15s nav wait).
- **In-document Find works on SCANNED docs** — an OCR word-box fallback in `pdf_find.py` (oscar+gary, cached).
- **Date-precedence bug FIXED** — `mig 166 template_date_invalid_yield_lowconf` (DARK, Oracle SIGN-OFF-W/COND).
- **Quick File** — drag-drop now works (preload-resolved paths), pane restyled, centered, Document Types names un-truncated.
- **Spreadsheet columns drag-resizable** in Search preview.
- **Client Quick File built end-to-end** — new `/v1/documents/intake` upload (Oracle-vetted) + client UI; live-tested (client filed a doc on the core).
- **PLAN (not built): client search parity + pop-out** with a shared-module/auto-replicate architecture — the resume point.

## COMMITTED this session (newest first; all pushed)
- `a35051c` style(client-quickfile): match the core pane in the client (card + dashed pick zone + outline glyph).
- `1e2fdc7` feat(client-quickfile): client Quick File VIEW + IPCs (Stage 2) — nav (writers), pick→read-in-main→base64→POST; paths stay in client main (token map).
- `44b430f` feat(client-quickfile): **`/v1/documents/intake`** upload + `GET /v1/documents/intake/doc-types` + contract 1.1.0→**1.2.0** (Stage 1, server). Oracle SIGN-OFF-W/COND. DARK behind `direct_intake_enabled` + search add-on. Capped body reader (Content-Length pre-check→413, in-flight→429), `fileKinds.isUploadIntake` SAFE-subset (drops .doc/.xls/.ppt/.rtf/.odt/.eml/.msg — no MOTW on uploads + commitDocument strips ADS), temp minted+cleaned, filename basename-sanitised, audit via:'client'. Pin `test_v1_intake.js` (18). Contract/handshake pins bumped.
- `6785960` fix(search): spreadsheet column resize actually widens (table-layout:fixed + grow the table width on drag).
- `751e9a7` docs+test(date-yield): Oracle pin d (note quotes both values) + logged the flip gate & anchor-leg twin.
- `a9ca638` feat(search): drag-resizable .xlsx columns (colgroup + resize handles).
- `2cc3a27` **fix(extraction): impossible taught date yields to a sub-90 keyword date (mig 166, DARK).** ROOT CAUSE (gary, verified at source): the impossible-date yield already returns 'impossible' for a garbled taught date, but `_kw_ok` gates on keyword conf >= `_KEYWORD_TRUST_FLOOR`(90) and a SEEDED custom date field STRUCTURALLY reads 85 (keyword.py base_confidence 80 +5 inline) → the clean keyword date can never overturn the garble. Fix: `_date_yield_fires(reason,conf_ok)` relaxes the floor for `impossible` ONLY (future keeps it), KW leg ONLY (anchor leg untouched). Auto-file-NEUTRAL (always noted/held). `TEMPLATE_DATE_INVALID_YIELD_LOWCONF` env, mig 166 seed OFF, in `TEST_SWITCH_KEYS`. Pin `test_taught_date_invalid_yield.py` (42). Oracle SIGN-OFF-W/COND.
- `1d36017`,`dbab0f0` style(quickfile): restyle the core pane (drop card, outline glyph, tidy inputs, remove redundant subtext).
- `f846cd2`,`7c26d4b` fix(quickfile): drag-drop drop was silent → resolve dropped paths in the PRELOAD's own `[data-intake-drop]`-scoped drop listener (a File through contextBridge is a proxy → webUtils returns '' renderer-side); `onQuickFileDrop` callback.
- `aad26aa` perf(search): page-count probe (`pages.py --count`) → instant nav for unknown-count PDFs (Quick File docs have no stored page_count).
- `144dc17` fix(search): export `previewService.getDocumentPage` (was defined, never exported — lazy preview threw "not a function"; pin false-passed on the `getDocumentPages` substring, tightened).
- Earlier same-session (pushed before this batch, see `git log`): `5ff8f22` page_count on the detail DTO (big-doc fast open), `15c8c2d`/`04b3c99` lazy per-page preview (page-1-first for ANY pdf), `811f5fc` scanned-page OCR find, `3aadf5a` Quick File centered, `dd8e4c0`/`c11952b` Document Types field names un-truncated (Settings + Teach), `f33b58c`/`2293a6d` pendingfeatures logs.

## Verification state (honest)
- All named pins GREEN: `test_v1_intake.js` 18, `test_taught_date_invalid_yield.py` 42, `test_fast_first_page.js` 13→14, `test_find_in_document_box.js` 16, `test_quickfile_drop.js` 14, `test_quickfile_pane.js` 15, `test_pdf_find.py` 10, SEC-17 `test_path_containment.js`, `test_v1_contract/handshake/review`. Release-migration gate + runtime-arming pins green.
- **Client Quick File — LIVE end-to-end PASSED:** (1) a throwaway harness POSTed a real .pdf + .docx to the running `/v1` server with REAL filing → files landed in the Output tree, DB rows confirmed+intake='direct', no learning rows, searchable, .doc refused 415. (2) The actual CLIENT app (launched, connected to the core, logged in as Chris) showed the Quick File nav + filed a doc on the core — owner confirmed "it works."
- NOT verified: the date-precedence fix's real-exhibit efficacy (needs a reprocess of the live Print Tracker doc — the fix is armed in the running TEST build; reprocess to see "October 10, 2026" replace the garble). Full `npm run test:pins` not re-run this session (targeted pins + gates only).
- Correction to a mid-session claim: the "clipped 3-digit year" theory for the date bug was WRONG — the taught garble ("202€") already classifies 'impossible' (parse+salvage both None); the real blocker was the 90 conf floor. gary confirmed at source.

## FIRST ACTIONS (fresh session)
1. **Commit the design doc:** `git add docs/designs/CLIENT_SEARCH_PARITY_PLAN_2026-09-13.md && git commit && git push` (it's the only uncommitted tracked-worthy file).
2. **Client search parity + pop-out — the resume build.** Read `docs/designs/CLIENT_SEARCH_PARITY_PLAN_2026-09-13.md` (eric-designed, ORACLE-VET PENDING). Owner chose "save the plan + start fresh." **Oracle-vet the plan first** (the shared-module/staleness architecture + the OCR-`find` `/v1` endpoint), then build **S0** = extract `src/shared/search-ui/` + the transport interface + core adapter (core BYTE-IDENTICAL) + both drift-guards (no-direct-IPC pin + sync/staleness check). Nothing else starts until S0 is green.
3. Optional owner item: reprocess the live Print Tracker date doc to confirm mig 166 heals it in the running TEST build.

## Deferred (designed, not built) — load-bearing conditions
- **Client search parity (S0–S4)** — `docs/designs/CLIENT_SEARCH_PARITY_PLAN_2026-09-13.md`. Auto-replication is enforced by: single canonical `src/shared/search-ui/` + a GENERATED client copy (`scripts/sync-client-search.js`, client prebuild) + a staleness check that FAILS the build on drift + a pin that the shared dir touches no `window.docusnap`/`window.scanfinder`/`ipcRenderer`/`require`. The 4 `/v1` endpoints mirror the existing `/pages` one (the fns already exist in previewService.js). `find` = first OCR read on /v1 → own in-flight cap. Contract → 1.3.0.
- **mig 166 flip gate (customer default)** — NOT set-equality alone (auto-file-neutral → M=0 is tautological): must classify each changed date heal-vs-mislead against GT on the real corpus, + zero date-accuracy drop, + a fresh Oracle look (it relaxes the 2026-08-06 Oracle 90-floor). `pendingfeatures.md`.
- **mig 166 anchor-leg twin** — the same 85<90 block exists on the anchor leg; deferred, own exhibit + gate (Oracle: rarer + higher-risk; the KW-leg-only scope is pinned). `pendingfeatures.md`.
- **Client Quick File graduation** — stays DARK until the QuickFile write-side guards (D2 sweep) land, same as the desktop lane.
- **Explorer "File in ScanFinder" right-click** — Oracle SEND BACK (can't gate a registry verb on the runtime switch; belongs in the installer). Revisit at Quick File graduation. `pendingfeatures.md`.
- **Client fast-preview over the network / in-doc-find A2-A3** — mostly SUBSUMED by the search-parity plan (the 4 /v1 endpoints). `pendingfeatures.md`.

## Needs the USER
- Ctrl+R the running CLIENT to see the restyled Quick File pane.
- (Optional) reprocess the live Print Tracker date doc to see mig 166 heal it.

## Key facts / running state
- **RUNNING:** the CORE dev app at `TEST_BUILD=1` (restarted ~19:41, contract 1.2.0, mig 166 armed) AND the detached CLIENT app (launched via `client\node_modules\electron\dist\electron.exe .` — the `electron .` shim was stuck on a re-download; the binary is present, launch it directly). 8 electron procs total. Kill filters: core = cmdline `*GIT Projects\Docusnap*` AND NOT `*Docusnap\client*`; client = `*Docusnap\client*`.
- Live DB `%APPDATA%\ScanFinder\docusnap.db` is BLOCKED to Claude's script tools (copy to scratch to inspect).
- Migrations at **166** (mig 166 = template_date_invalid_yield_lowconf). `/v1` API_CONTRACT_VERSION = **1.2.0** (client CLIENT_CONTRACT lockstep).
- Pins: `node <file>` for JS, `ELECTRON_RUN_AS_NODE=1 electron <file>` for native-ABI/pytest via `py -3.12 -m pytest`.
- Advisors this session: oscar (scan-find recipe), gary (scan-find design + date root cause), eric (client Quick File + search-parity plan), Oracle (date fix + client Quick File — both SIGN-OFF-W/COND). Chris NOT run for the client (harness builds the core only; the client-app GUI was owner-tested live instead).
