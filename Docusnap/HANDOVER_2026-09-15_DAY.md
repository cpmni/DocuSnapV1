# HANDOVER 2026-09-15 DAY — cold start for the next session (written for Claude Opus 4.8)

Branch `feat/teach-side-overnight`. **HEAD `60e37c0`; origin CURRENT (all pushed, 0 ahead / 0 behind);
no uncommitted CODE (only the pre-existing `M handover.md` + untracked scratch/DB/doc files).** Migration
version **170**. Full pin gate `npm run test:pins` = **373/373 GREEN** (the run-order flake
`test_ref_class_fix` passed this run too). NO installer built this session (owner's call — see below).

This was the morning-after session following the 2026-09-15 NIGHT run (`HANDOVER_2026-09-15_NIGHT.md`).
Owner-driven live-vet loop against their own running core + detached client.

## TL;DR — what shipped today (5 commits, all pushed)
1. **`ac967e8` — security: enforce the two 2026-09-15 fixes by default (mig 169).** Both fixes shipped
   DARK the night before; mig 169 seeds them '1' (INSERT OR IGNORE, fail-secure) so every install — new
   AND existing, on next start — enforces: `v1_force_password_change` (a never-changed temp-password /v1
   session is refused) + `backup_import_seat_only` (a backup restore needs a verified paid seat). Value
   '1' (read `=== '1'`), NOT the 'true' engine-switch convention. Pin `database/test_security_defaults.js`
   (10/10). '0' still turns each off (kill switch preserved).
2. **`81b1c3e` — client fixes + teach ON by default.**
   - **mig 170 `@DEFAULT_FLIP 170`: teach_over_client_enabled ON by default** (UPSERT 'true' — mig 168
     seeded 'false', so INSERT OR IGNORE would be a dead guard). Remote teaching from the search client
     now works out of the box; still admin + entitlement + license gated at /v1. Pin
     `database/test_teach_default_on.js`.
   - **Client teach thumbnails FIXED.** Root cause: shared `thumbs.js` reads
     `window.docusnap.getDocumentThumbnail`, but the client bridge is `window.scanfinder` → `window.docusnap`
     was undefined → every teach doc-picker thumbnail was blank. Fix: expose a MINIMAL `window.docusnap`
     shim on the client (`client/preload.js`) with just `getDocumentThumbnail` (unwraps the /v1
     `{status,json:{thumbnail}}` envelope). The search list uses its own `SearchThumbs`+transport, untouched.
     **LIVE-CONFIRMED working by the owner.**
   - **Client close-to-tray** (mirrors the core): the X hides the main window to a tray icon; the app quits
     only via tray **Exit** / before-quit. (`Tray`, `Menu`, `isQuitting` in `client/main.js`.)
   - **Removed the stale client "Get certificate from server…" button** (`fetch-ca-btn` + handler; the
     handler just re-clicked Connect). The QR / connect-and-check-ID flow replaces it.
   - `test_v1_teach.js`: force the switch OFF before the commit disabled-path check (mig 170 now defaults
     it on).
3. **`60e37c0` — red address prompt + pre-filled default port.**
   - Core Settings "Search client access": a **red inline prompt above the IP field** when access is
     switched on with the address (or port) empty (an empty host silently binds loopback — no LAN client
     can reach it). Reverts the toggle, focuses the field, clears as you type.
   - **Pre-fill the default port 8765** as a real (editable) value in BOTH the core Settings port field
     and the client connect screen (both already fell back to 8765 internally). Owner: "most people will
     just type what they see anyway."

## S4 (client-PC upload-to-teach) — LIVE-VERIFIED this session
Drove S4 end-to-end over a real /v1 server (sandbox core with teach ON, driven directly by HTTP — the
native file-picker can't be scripted, so the driver POSTed a base64 PDF): login → **`POST /v1/teach/stage`
(real OCR import, 3.4 s, docId returned, needs_review, NOT filed)** → **`POST /v1/teach/commit` (template +
mapping minted, exemplar FILED to disk, ledger `done`, audit complete)** → idempotent replay (same
templateId, no dup). Graduation gate untouched (`confirmed_count:0`). The whole server chain works; only
the client renderer's native picker glue was skipped (Chris round B already source-verified that).

## Security audit (owner asked "are the logged-in details secure, not cached to a probeable file?")
Full read-only audit, verified at source. **Result:**
- **CLIENT = clean.** The /v1 session token lives ONLY in the client MAIN process memory (closure-local in
  `apiClient.js`), never written to any file, never reachable by the renderer (contextIsolation + sandbox).
  No password stored. On-disk client files are only: server address, the server's PUBLIC CA cert, window
  bounds, a random client-id. Nothing to log in as the user.
- **CORE = mostly clean, ONE caveat.** Passwords = Argon2id (safe even if the DB is copied). Session =
  in-memory only (no auto-login file). **Caveat:** the DB file `%APPDATA%\ScanFinder\docusnap.db` is
  **plaintext by default**; `users.totp_secret` sits in it in **cleartext** (only matters if a user enables
  2FA). Windows keeps that folder private to the signed-in user, but a **local admin / malware-as-user**
  could copy it. Whole-DB encryption is BUILT but OFF (the DB_ENCRYPTION_ARC).
- Two hardening gaps flagged → **this is task 2a/2b for the next session** (see below).

## FIRST ACTIONS for the fresh session
1. **The hardening decision (deferred to this session by the owner).** Pick the path, then build it:
   - **2a / Option A — whole-DB encryption (RECOMMENDED, the real fix).** Encrypts the entire DB at rest
     (protects password hashes + TOTP secret + audit). Mostly built (the arc from 2026-08-31,
     `docs/designs/DB_ENCRYPTION_ARC_2026-08-31.md`, Oracle 10 conditions). **The trade:** a printed
     RECOVERY CODE the user must keep — lose it + the Windows profile = data unrecoverable. Clean for a
     NEW install (test user) = encrypted from first boot, no migration; the owner's existing DB runs the
     opt-in ceremony. Because it can lose data + is customer-bound, finish it as a proper mini-arc (advisor
     + Oracle pass on the remaining owner-supervised slices, then the safety drills).
   - **2b / Option B — narrow: encrypt only `users.totp_secret`** with the existing `secretStore` DPAPI
     util (`src/lib/secretStore.js:24-25` flags this as the intended-but-deferred next use). Small,
     contained, no recovery code. Closes just the one cleartext-secret gap.
   - A subsumes B. Owner leaned toward A but had not committed at wrap. **ASK which path first — it forks
     the work.**
2. **When ready, build the FULLY-HARDENED TEST pair** (owner directive: "next builds fully hardened, but
   wait until these fixes are ironed out"). Core `npm run build:test` uses the plain road — for FULLY
   HARDENED use the **`build:release`** path (source protection .pyc / HARDEN_JS, see
   `project_source_protection_20260907`). Then client `cd client && npm run dist`. Do NOT build until the
   hardening (task 1) is in.
3. **Owner-owed DARK flip gates (unchanged, still owed):** migs 166 / 167 (engine half) / 159 / 156 / 143.

## Owner decisions locked this session
- teach-over-client: **ON by default** (mig 170).
- The two security fixes: **enforced by default** (mig 169).
- Next builds: **FULLY HARDENED** (`build:release`), **held** until the fixes are ironed out.
- Client "Get certificate from server…" button: **removed.** The core "Generate / re-issue certificate"
  button is **intentional** (under Advanced — re-issue / own-cert; the managed cert auto-creates on a LAN
  host when access is switched on). NOT removed; a relabel to "Re-issue certificate" was offered, owner
  didn't take it up.

## Verification state (honest)
- Full gate 373/373 green (twice — once mid-session at 372+flake, once at wrap at 373 with the flake
  passing). The flake is `src/services/test_ref_class_fix.js` ARM B — a documented run-order flake, green
  3/3 in isolation; NOT caused by any change this session (proven by stash-compare).
- S4: live-verified (above) — the substance ran; only the client picker UI was not driven.
- Thumbs: owner live-confirmed working after the `window.docusnap` shim.
- Red prompt + port pre-fill: renderer changes, settings-wiring pin green + syntax-checked; owner to
  eyeball live (both apps were restarted at wrap so they're loaded).
- Security audit: read-only, verified at source (a background general-purpose agent).

## Running at wrap
- **Core dev app** (`npm start`, task id changes) — owner's REAL DB (`%APPDATA%\ScanFinder`), migs 169+170
  applied on their live install. **Detached client** (`cd client && npm start`) — both restarted at wrap
  so all renderer changes are loaded.
- To restart cleanly: kill electron to 0 + the `dev-start` node launcher (leave the 2 Playwright-MCP node
  procs alone); the client's electron is under `client\node_modules\electron` (distinct from the core's
  root `node_modules\electron`) so you can restart one without the other.

## Key facts / paths
- Live DB `%APPDATA%\ScanFinder\docusnap.db` — BLOCKED to Claude's script tools (copy to scratch to
  inspect; live writes via the owner or a relaunch). Migration version **170**.
- Pins: `npm run test:pins` (373 files, ~106 s). One: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <path>`.
  New pins this session: `database/test_security_defaults.js`, `database/test_teach_default_on.js`.
- Release-migration gate: a UPSERT-to-'true' migration MUST carry `// @DEFAULT_FLIP <N>` on its own line
  directly above `if (!applied.has(N))`, or `scripts/check-release-migrations.js` refuses the build.
- Memory: `project_v1_backup_security_fixes_20260915.md` (updated), `project_teach_over_client_20260914.md`
  (S4 live-verified + mig 170 default-ON + client thumb shim + tray + cert-button + port/red-prompt).
