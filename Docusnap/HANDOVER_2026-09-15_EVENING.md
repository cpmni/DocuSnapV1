# HANDOVER 2026-09-15 EVENING — cold start for the next session (Claude Opus 4.8)

Branch `feat/teach-side-overnight`. **HEAD `8ec76de`; origin at `38bbb88` (HEAD is 1 commit ahead —
the docs commit `8ec76de` is UNPUSHED; everything else is pushed).** Tree clean (no uncommitted CODE).
Migration version **171** (unchanged this session — no new migrations). Full pin gate `npm run test:pins`
= **377/377 GREEN** (376 + the new `test_date_parse.js`).

**Two installers built this session (signed, hardened core), carrying every fix below:**
- core `dist\ScanFinder Setup 2.0.0-r20260915-1820-38bbb88.exe` (build:release; boot smoke exit 0
  testBuild:false; windows 14/14; bytecode present, no plaintext modules)
- client `client\dist\ScanFinder Search Client Setup 1.0.2-r20260915-1824-38bbb88.exe`

Owner-driven live-vet session on a VM LAN setup: built Departments D2 + D-C11, a date-validator fix, two
LAN-blocker fixes (client crash + core address), and scoped a new feature (Review over the client).

## TL;DR — what shipped (6 commits; 5 pushed, the last docs commit unpushed)
1. `acd0b29` **Departments D2** — the visibility sweep + per-doc write gates + count-broadcast collapse (DARK).
2. `fddc003` **D-C11** — processing/handler count broadcasts routed through the viewer-scoped helper (was
   missed from acd0b29; committed here).
3. `16fba41` **core `127` LAN bug** — dedicated `client-api-set-config` writer for host/port/cert.
4. `7200a60` **client crash** — `lib/` + `windowBounds.js` added to the client build allowlist.
5. `38bbb88` **date-year validator** — one shared parser for the auto-file gate + the confirm door.
6. `8ec76de` **docs** — the client-Review parity plan + backlog entry (UNPUSHED).

## Committed work — per fix

### Departments D2 + D-C11 (`acd0b29` + `fddc003`) — DARK (`departments_enabled` off)
Oracle SIGN-OFF-W/COND, all conditions met. Byte-identical on every current install (read gate is
data-driven, inert until real departments exist).
- **Reader sweep:** 12 list/count readers in `documents.js` + `reviewService` queue/deferred/counts take a
  `viewer` and append `departmentVisibility.visibleDocSql`. Default `undefined` fail-closes to shared-only
  when configured (a forgotten site under-shows, never leaks). Call sites pass the actor (desktop
  `getCurrentUser()`; /v1 `actorOf(session)`).
- **Per-doc WRITE gates:** `_assertDocAccess` on defer/delete/restore-deferred; a new `_assertDeletedDocAccess`
  (department `decision` DIRECT) on restore-document — because `accessService:81` short-circuits deleted→false
  for non-admins.
- **`SYSTEM_ACTOR`** sentinel in the primitive for explicit unfiltered system reads (one deliberate use: the
  pre-login filing-housekeeping count in review/handler.js). Greppable + pinned.
- **D-C11:** one `src/lib/countBroadcast.js` helper (viewer-scoped, resolves the desktop operator); all ~14
  review/deferred/stuck broadcasts route through it; startup reconcile stays global via SYSTEM_ACTOR; the /v1
  confirm callback pushes the CORE operator's scoped count to the desktop badge.
- **Cond 5:** `requeueConfirmedDocsForScope` + `classFixService` are DELIBERATELY department-blind (scope-wide
  learning) — comment + pin.
- Files: `database/modules/{departmentVisibility,documents}.js`, `src/lib/countBroadcast.js`,
  `src/services/{reviewService,batchAuditService,classFixService}.js`, `src/modules/{api,review,processing,
  search,settings}/handler.js`. Pins: `test_department_visibility.js` §1-§15 (all green).
- **STILL OWED before the `departments_enabled` FLIP:** the denial matrix (role×status×transport×surface),
  **D2b** (/v1 intake dept tagging — else a LAN upload bypasses departments), **D3/D4** (taggers + Settings UI).
  Full plan: `docs/designs/DEPARTMENTS_D2_PLAN_2026-09-15.md`.

### Date-year validator (`38bbb88`) — Oracle SIGN-OFF-W/COND, all conditions met
Root cause: `trust._validDate` checked month+day but **never the year**, so `October 14, 202` (OCR-clipped
year) counted valid → (a) a gap in the auto-file date gate, (b) the owner's live "Read differently after
learning — check which is right" noise note (the rereadHolds:110 suppression guard read the clipped date as a
real alternative).
- Fix: extracted filing's `parseDate`/`normaliseDate`/`formatDate` into a shared **`database/modules/date_parse.js`**
  (one source of truth); `trust.validDate = parseDate(v) != null`; filing re-exports `normaliseDate`
  byte-identically. Year now required (4-digit, or month-name 2-digit pivot 69; 3-digit refused) + calendar
  round-trip (non-leap 29-Feb now refused).
- **Pinned trade-offs (deliberate):** numeric 2-digit year `9/8/25` now INVALID (aligns to the confirm door);
  non-leap 29-Feb invalid.
- Files: `date_parse.js` (new), `trust.js`, `filing/handler.js`, + pins `test_scope_trust.js` §10,
  `test_date_parse.js` (new — drift guard + byte-identical vectors + re-export identity),
  `test_reread_holds_required_roles.js` §4 (owner exhibit, RED-before/GREEN-after),
  `test_validation_pattern_surfaces.js` (repointed 4 source-contracts to date_parse.js).
- **Verification:** 377/377 pins + a 700-corpus no-regression census (dates 100%, supplier 100%, M_type 0; the
  36 "wrong" are the documented `total`-field rounding noise; #166 is the pre-existing baseline silent). The
  census fixture (`Desktop\Flip Corpus 700\warm_700.db`) was 3 days stale (pre-`intake` column) so it was
  COPIED to scratch + migrated before running — the owner's file was NOT touched.

### Core `127` LAN bug (`16fba41`) — the one to understand
Symptom: on the INSTALLED build, typing a LAN IP (or `0.0.0.0`) in Search Client Access + toggling on still
showed `Running · http://127.0.0.1:8765`. Root cause: `client_api_host`/`port` are **protected settings**
(`src/lib/protectedSettings.js` — `startsWith('client_api')`), so the UI's generic `set-setting` write was
REFUSED and swallowed in try/catch → the address never persisted → the server used the 127 default.
- Fix: a dedicated admin-only `client-api-set-config` IPC (`api/handler.js`, the direct path the protection's
  own comment intends) + preload `clientApiSetConfig` + the settings renderer routes host/port/cert through it
  (never the refused generic door). Backup/generic-door protection UNCHANGED (not weakened).
- Files: `src/modules/api/handler.js`, `src/preload.js`, `src/windows/settings/renderer.js`, pin
  `src/lib/test_protected_settings.js` (renderer must not use the generic door for `client_api_*`; must use the
  dedicated writer — RED before / GREEN after).
- ⚠ **Security-adjacent** (touches protectedSettings). It RESTORES intended behaviour without weakening the
  backup/self-grant guard; I judged it safe + built it. A retro eric/Oracle nod before wide customer
  distribution is advisable but not blocking (it's already in the shipped installer).

### Client crash (`7200a60`)
Packaged client crashed on startup: `Cannot find module './lib/certVerify'`. The `client/package.json` `files`
allowlist omitted `lib/` AND `windowBounds.js` (both required by `main.js`). Added `lib/**/*` (minus tests) +
`windowBounds.js`. **Verified in the built asar:** `\lib\certVerify.js` + `\windowBounds.js` present.

## Verification state — honest
- `npm run test:pins` = 377/377 green (ran multiple times; the known run-order flakes `test_ref_class_fix` /
  `test_v1_teach_equivalence` pass standalone and are not caused by this session's changes).
- Date fix: pins + 700-corpus census both green (details above).
- Both installers built clean (core boot+window smoke; client asar contents verified).
- The core-127 fix + date fix + client fix were verified by pins + the census + the asar check; **not yet
  live-tested by the owner on the VM** (the new installers were built at wrap; the owner installs + tests next).
- Corrected mid-session mistakes: (1) first blamed the `127` on a bad value/env — it was the protected-settings
  door; (2) barry/I first framed the client-Review draw-a-box as lower-fidelity than the desktop — Oracle showed
  the desktop is ALSO low-DPI, so crop-scale parity (216-DPI page render) is the real gate, not a full-DPI rebuild.

## FIRST ACTIONS for the fresh session
1. **Push `8ec76de`** if the owner wants the docs commit up (`git push origin feat/teach-side-overnight`).
2. **Owner live-test on the VM** with the two new installers: core → Search Client Access → type `0.0.0.0`
   → Tab → On (now saves; auto-TLS); client → starts (no crash) → connect to the core's LAN IP. Confirm the
   date note is gone on the exhibit doc.
3. Then the standing queues (unchanged): Departments **D2b + D3/D4** before the flip; the **flip census** on the
   4 proven dark switches (156/159 re-confirm, deskew_corrob re-run; watch_separate is a soak, no 700-census);
   or start **Client-Review S0** (see the deferred section).

## Deferred (designed/scoped, not built)
- **Review over the search client** — SCOPE VETTED (barry + Oracle SIGN-OFF-W/COND this session).
  Full staged plan: **`docs/designs/CLIENT_REVIEW_PARITY_PLAN_2026-09-15.md`** + backlog entry in
  `pendingfeatures.md`. Client UI, core does the work, on the EXISTING search seat (no new flag). v1 = queue +
  preview + field editor + draw-a-box + confirm/defer. Load-bearing conditions so it can't be built wrong:
  S0 is a FOCUSED carve of the 9,400-line `review/renderer.js` (NOT byte-identical); draw-a-box crops from the
  216-DPI `/v1 /page` (parity, not full-DPI — full-DPI would be WRONG-LAYER); implement the held-gate
  acknowledge round-trips (else a remote reviewer is stranded on a legit doc); surface the confirm ripple
  (class-fix/issuer-fill fire on the core, undo is desktop-only); handle the OCR 429. Gate per the plan.
- **Departments flip** — needs D2b + D3/D4 + the denial matrix (`docs/designs/DEPARTMENTS_D2_PLAN_2026-09-15.md`).
- **Dark-switch flip census** — 4 proven switches (`docs/DARK_SWITCH_LEDGER.md` + `TESTING/_measure/
  flip_corpus_20260912/CENSUS.md`); harness needs `RR_APP_ENV=1` baseline + the migrated corpus copy (the
  Desktop fixture is pre-`intake`, copy+migrate to scratch first — recipe in this session's work).

## Needs the USER
- Live-test both installers on the VM (action 2 above).
- Decide whether to push `8ec76de`.
- The seat model is INTENTIONAL: seats are sticky/admin-release (no auto-expiry) by owner design (friction →
  seat sales). Nothing to change there. If a client won't connect: it needs a SEARCH seat (the licence grants
  1 search + 4 workflow); Release a stale seat in Settings → Client Seats.

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db` (i.e. `C:\Users\cmccu\AppData\Roaming\ScanFinder`) — BLOCKED to
  Claude's script tools; copy `.db`+`-wal`+`-shm` to scratch to inspect (done twice this session). Migration **171**.
- Pins: `node scripts/run-pins.js` (377 files, ~150s). One-off: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <path>`.
- Census: `RR_DB=<db> RR_IDS=<ids> OCR_RENDER_DPI=200 RR_APP_ENV=1 RR_ALLOW_ARMED=1 TESS=<tess> electron.exe
  stress_test/realdoc_regression.js`; the 700 corpus needs migrating first (pre-`intake`).
- Builds: core `npm run build:release` (hardened), client `cd client && npm run dist`. Both need dev electron
  instances closed (EBUSY) — at wrap there were ~4 electron + ~5 ScanFinder processes (installed app + dev +
  Playwright-MCP + Chris sandbox); the builds succeeded regardless (no dev core in the tree was locking).
- New pins this session: `database/modules/test_date_parse.js`; extended `test_department_visibility.js` (§9-§15),
  `test_scope_trust.js` §10, `test_reread_holds_required_roles.js` §4, `test_protected_settings.js`.
- Memory updated: `project_client_review_multiuser.md` (corrected stale "DONE"/gap claims).
