# Detached search client (LAN add-on) — extracted from CLAUDE.md
> Deep reference split out of the always-loaded CLAUDE.md (2026-07-03) to keep the root
> memory lean. Read this when a task touches this area. Nothing here was changed — verbatim move.

## Detached search client (LAN add-on)
A separate Electron **search/mailbox client** runs on other LAN PCs and talks to the
core app over a TLS `/v1` API. It's an **entitlement-gated add-on** — the SAME gate
also upgrades the core app's own Search. Core app still works fully standalone with
the add-on off. (Design history: `memory/scanfinder-*` + the plan in `.claude/plans`.)

**`/v1` API — `src/modules/api/handler.js`** (Node `https`; `register(ctx)`):
- Starts when `SCANFINDER_API=1` **or** the `client_api_enabled` setting is true; host/
  port/TLS read from settings (`client_api_host` default 127.0.0.1, `client_api_port`
  8765, `client_api_tls_cert`/`_key`/`_ca_fingerprint`/`cert_sans`). Refuses a
  non-loopback bind without TLS. `ctx.allowRemote = host !== 127.0.0.1/localhost`
  (the loopback peer-guard fix for LAN clients).
- **DTO projection** — returns only the frozen `search-documents` contract fields,
  never `stored_path`/`folder_path`/`working_path`; files served as page images by id.
- **Lockstep handshake** blocks on contract drift (exempts `/health` + `/v1/ca`).
- Endpoints: search/preview, `/v1/workflow/{inbox,sent,assigned,completed,recipients}`
  + route create/claim/resolve/recall, **`GET /v1/ca`** (pairing-gated; returns the CA
  PEM + fingerprint for trust bootstrap — NEVER the CA key), **`POST /v1/enroll`**
  (pairing → entitlement(402) → creds(401/429/MFA) → returns CA + session token + user).
- **REVIEW over `/v1` (Phase 3, Admin/Edit, search-entitled)**: `GET /v1/review/{queue,deferred,counts}`
  (path-free `dto.projectReviewQueue` — field VALUES are fetched per-doc via `GET /v1/documents/{id}`),
  `GET /v1/doc-types` (`dto.projectDocTypes` — type dropdown / required-field / on-blur validation),
  `POST /v1/documents/{id}/{confirm,defer,undefer}` (undefer = restore-from-deferred, distinct from
  the recycle `/restore`). confirm routes through the shared `reviewService` (claim-before-file → a
  lost race is **409 ALREADY_FILED** naming the winner; workflow-locked → **409 WORKFLOW_LOCKED**;
  license re-check → 403). **F-02 preserved**: the body carries field VALUES only — `folder_path`/
  paths are IGNORED, the source is resolved SERVER-SIDE from the doc row; the confirm DTO is
  `{success,filename,isDuplicate}` (never filePath/srcPath). API contract bumped **1.0.0 → 1.1.0**
  (server `API_CONTRACT_VERSION` + client `CLIENT_CONTRACT`; lockstep is MAJOR-only so older clients
  just lack the review UI). Guarded by `src/modules/api/test_v1_review.js`.
- **PRESENCE (Phase 4, "Currently being reviewed by <name>")**: `POST /v1/review/{id}/{viewing,release}`
  (viewing heartbeats + returns the OTHER viewers; release on close/nav); the queue/deferred rows also
  embed `viewers` (exclude-self). Backed by `presenceService.shared()` (in-memory, TTL ~60s). The DESKTOP
  publishes to the SAME map: `get-document-with-extractions` heartbeats for a review-able doc opened by a
  reviewer, `review-heartbeat` IPC re-beats it (renderer ~25s timer), `notify-doc-closed`/logout release —
  so a desktop reviewer is visible to clients and vice-versa. ADVISORY only (the CAS confirm is authority).
- **TARGETING (Phase 6, correction-only — the client's "draw a box to OCR-fill a field")**: `POST
  /v1/documents/{id}/ocr-region` (`handler.js` ~L520; body `{imageBase64}` → returns `{text}` ONLY).
  Writer-gated (admin|edit) + entitlement, `OCR_MAX_INFLIGHT=3` → 429, temp-PNG unlink + counter-decrement
  on every exit path, F-02 (no paths). Reuses `python_backend/ocr/region.py` UNCHANGED — the client CROPS
  the value region off the page image it already shows (natural-pixel map + glyph headroom), base64s it,
  core OCRs, drops text into the still-editable field. NO anchoring/area-reads/spatial learning — pure
  convenience correction; core extraction/learning untouched. Client side: `apiClient.js` `review.ocrRegion`
  → `main.js` `client-review-ocr-region` → `renderer.js` `rvArmTarget`/`rvFinishDraw` (crop math L703-734;
  empty read → toast "Nothing readable in that box — try again", L734). Committed b442be9. Additive endpoint,
  no contract bump. Guarded by the v1_review suite + `night_audit/v1_stress.js` (all security probes passed).
  ⚠ OPEN BUG (2026-07-01, see handover.md): the client targeting round-trips but region.py returns EMPTY
  text ("nothing readable") on a real drag — crop-frame / preview-resolution suspect, NOT yet fixed.
- Admin IPC: `client-api-{get-status,set-enabled,cert-status,cert-generate,cert-export}`.

**TLS — managed certs + Certificate Wizard** (`src/services/certService.js`, node-forge,
MIT — no OpenSSL bundling):
- **2-tier**: a CA cert (`CA:TRUE`+`keyCertSign`) signs a server cert (IP **and** DNS
  SANs + `serverAuth`); the client pins the **CA** (`ca.crt`) via the https `ca` option.
  A lone self-signed leaf pinned as its own CA fails in Node — don't.
- Enabling LAN access auto-runs **`ensureManagedCert`** (generates under userData/certs,
  sets the cert/key/fingerprint/SANs settings; respects a manually-configured cert
  outside certsDir unless forced). `buildConnectionProfile` exports a `{host,port,tls,
  caFingerprintSha256,caPem}` profile the client imports. CA is **reused on rotate** so
  existing clients stay trusted. `ca.key` is the trust root — **never** served anywhere.
- Settings → **Search client access**: enable toggle + host:port + **Managed TLS
  certificate** panel (status/fingerprint, Generate, Export profile) + an Advanced
  details for manual cert/key paths.

**Entitlement — `src/services/entitlementService.js`** (`detached_client_licensed`
setting): the SINGLE gate. `checkClientEntitlement(db)` → `{entitled,feature,search,
workflow}`; gates BOTH the detached client API and the in-core enhanced search. Manual/admin
for now (licensing-driven wiring later). Exposed to the renderer via `get-entitlement`.
**WORKFLOW IS BUNDLED WITH THE CLIENT LICENCE (2026-06-28, reversible):** the constant
`WORKFLOW_BUNDLED_WITH_CLIENT = true` makes `workflow.entitled = search.entitled` (and
`workflow.seats` default to the client seats unless the backend set `detached_workflow_seats`),
so a client licence enables the approval workflow for BOTH the core (its mailbox/assign UI)
and the detached client. `search`/`workflow` stay SEPARATE result fields — flip the constant
to `false` to UNTIE them (workflow then needs its own seats again). See [[client-seat-pricing]].
**MASTER SWITCH — WORKFLOW HIDDEN PRE-RELEASE (2026-06):** `WORKFLOW_FEATURE_ENABLED = false` in
entitlementService.js forces `workflow.entitled = false` (+ `workflow.disabled = true`) REGARDLESS
of seats, so the mailbox / document-assignment / approval feature is HIDDEN everywhere it gates on
that: the client's Mailbox nav (+ `setView` redirect), the core Search window's `body.workflow-on`
UI (mailbox tab + assign/approve actions), the desktop/`/v1` workflow endpoints (FEATURE_NOT_LICENSED),
and the Settings → "Workflow add-on" section (hidden on `workflow.disabled`). ALL the workflow CODE
(workflowService, document_routes, the handlers, the `/v1` routes — still proven by test_v1_workflow
which injects entitlement) stays intact behind this ONE flag — flip to `true` (or wire to a signed-
token feature claim) to turn it all back on. Keep future workflow work modular behind this gate.

**Mailbox / approval workflow** — `src/services/workflowService.js` +
`database/modules/workflow.js`:
- `document_routes` (+ `documents.workflow_status`) ensured **UNCONDITIONALLY +
  idempotently** in `runJsMigrations` (NOT version-gated, NOT stamped) — a dev DB shared
  across worktrees can be stamped past the version WITHOUT the table, which would break
  the Review confirm path; CREATE-IF-MISSING self-heals. A **separate** state machine
  (`pending→claimed→{approved|rejected|acknowledged}`, `recall` while pending) that
  **never rewrites `documents.status`**; reject reason required; optimistic `version`.
- **`editGuard` = the workflow_lock**: while a doc has an open route, the Review pipeline
  is blocked from mutating it (admin override, audited). `review/handler.js`
  `requireUnlocked()` wraps **confirm/defer/delete/restore**.
- Desktop workflow IPC: `src/modules/workflow/handler.js` (`workflow-*`, entitlement +
  role gated, reuses `workflowService`). Core **Search** gains (entitlement-gated, else
  byte-identical basic search): a confidence signature, **mailbox view**, and workflow
  actions via the existing `search-actions.registerActionProvider` hook.

**TOTP MFA** (migration 28 — `users.totp_secret`/`totp_enabled`, nullable/inert): the
in-process desktop login never reads these; only the client API enforces MFA when
`totp_enabled=1`.

**Components**: `client/` (detached Electron app — `apiClient.js` pins the CA / supports
import-profile + fetch-CA-with-fingerprint-confirm + enroll; connect screen; search +
mailbox UI + **REVIEW UI (Phase 5)**) · `cert-tool/` (standalone cert-generator GUI) ·
`scripts/New-ScanFinderCustomerCert.ps1` (per-customer CLI cert; `MSYS_NO_PATHCONV=1`).
**Client KEYBOARD-FOCUS FIX (2026-06-30) — applies to EVERY text field, current + future:**
`client/main.js` createWindow gives the web page keyboard focus on `did-finish-load` AND on
window `focus` (`grabFocus` → `win.webContents.focus()`, mirroring the core app's grabFocus at
`src/main.js`). Without it Electron leaves the client web page without KEYBOARD focus on Windows,
so a click into a text field shows no cursor / won't type until you click out of the window and
back in (buttons still work — they take the mouse; only typing breaks). This is WINDOW-level, so
**no per-field fix is ever needed** — any new `<input>`/`<textarea>` is covered automatically.
The ONLY per-field caveat: a field you AUTO-focus when a view/dialog opens must defer its
`.focus()` to `requestAnimationFrame` (Chromium drops a focus issued the same tick the element is
shown — see the `totp` field in `renderer.js`). Same root cause + remedy as the core app's
modal-focus note (rAF-deferred focus).
**Client theming (2026-06-28)**: the client carries its OWN copy of the six named themes
(its `renderer/index.html` has `:root[data-theme="…"]` blocks for the client's token set
incl. the extra `--grad1/--grad2/--nav-bg/--card-a/--card-b`; `--on-accent` drives the
accent-text so Midnight's amber reads). A small theme module in `renderer.js`
(applyTheme/currentTheme/toggleDarkMode, persisted in localStorage `sf-client-theme`; sets
`data-theme`+`data-mode` on `<html>`, default Warm Paper) + an in-window **Settings view**
(sidebar `nav-settings` → `#view-settings`, a theme `<select>`) + a sidebar-foot **clock**
and **Dark-mode toggle** (mirrors the main app's rail). Self-contained — does NOT import the
core app's theme.css/theme.js.

**Security invariants (preserve)**: real TLS verification with **no silent self-signed
bypass in the client UI** (only a dev-only `SCANFINDER_CLIENT_ALLOW_SELF_SIGNED=1` env
override); pin the **CA** (`ca.crt`), not `server.crt`; `ca.key` NEVER crosses any
endpoint; enrollment needs an integrity check (fingerprint confirm / pairing code) — no
silent auto-grab. (Host-side TLS tests can be MITM'd by AVG's HTTPS scanning — verify
from the VM; see `memory/avg-https-mitm-local-tls`.)

**/v1 SESSION REVOCATION — admin actions cut client access at once (2026-07-02, found+fixed via
`test_v1_security.js`):** the opaque `/v1` bearer token is verified in-memory (`sessionService`)
and does NOT re-check `users.is_active`/role per request — revocation is by EXPLICIT delete. So
the admin auth handlers now call `sessionService.shared().revokeUser(userId)` on the actions that
must cut a user's access: `auth-set-user-active` (disable), `auth-set-user-role` (any role change),
`auth-admin-reset-password`, and self-service `auth-change-password`. Previously none did, so a
deactivated/demoted user kept live `/v1` access (and their OLD role) until the token expired
(≤12h absolute / 30m idle). The store is now a process SINGLETON (`sessionService.shared()`, mirrors
`presenceService.shared()`): `main.js` seeds `ctx.sessionStore` from it and the API defaults to it,
so the admin IPC and the API server share ONE store. Desktop in-process login (`currentSession`) is a
SEPARATE boundary, untouched. Guarded by `test_v1_security.js` (scoped revoke: the target's token is
rejected, other users' survive) + `test_session.js` (`revokeUser` unit).

**Tests** (Electron-as-Node): `src/services/test_{certservice,workflow,entitlement,
session}.js`, `src/modules/api/test_{cert_wizard,v1_ca,v1_enroll,v1_workflow,v1_*}.js`,
`src/modules/review/test_workflow_lock.js`, `src/modules/workflow/test_workflow_ipc.js`,
`client/test_apiclient.js`, `src/modules/api/test_v1_security.js` (auth/role-gating/F-02
traversal/SQL-injection/malformed-body/entitlement probes + the session-revocation-on-deactivate
check above).

**Robustness suites added 2026-07-02** (all Electron-as-Node, hermetic): `src/modules/filing/
test_filing_edge_cases.js` (reserved device names, >260 long paths, Unicode/RTL/emoji suppliers,
empty-after-sanitise → Unknown Company, traversal containment, on-disk -DUPLICATE chains, re-file
no-suffix, malformed field keys don't crash filing, date normalisation) · `src/modules/processing/
test_working_copy_durability.js` (real-fs `ensureWorkingCopy` + the async #4 twin: atomic
.part→rename, byte-faithful copy, missing-source→null, unsafe-extension sanitise, stale-.part
resilience; + a real-fs `reconcileHolding` pass proving a crash only leaves EXTRA files, never
loses a doc). `ensureWorkingCopyAsync` is now exported for the test.

**Multi-user CONCURRENCY STRESS harness** — `stress_test/concurrency_harness.js` (run:
`ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron stress_test/concurrency_harness.js`; `KEEP=1`
to keep the temp sandbox). Stands up the REAL `/v1` server + real `reviewService`/`filing` against
a FULLY SANDBOXED temp DB + temp import/inbox/output (never the live DB), then drives it with 4
concurrent HTTP "staff" (edit-role) racing the confirm/defer/undefer path — the exact contract the
detached client uses. Proves the claim-then-file design (`documents.confirmIfReviewable` atomic CAS
→ `filing.commitDocument` → rollback-on-failure) is race-safe: 360 docs get a 4-way simultaneous
confirm (1440 requests → exactly ONE 200 + THREE 409 `ALREADY_FILED` each — never a double-file or a
lost doc), plus defer/undefer perturbation races, a concurrent filename-collision burst (`-DUPLICATE`
under contention), and focused adversarial cases (defer-vs-defer, undefer-vs-undefer, re-confirm-an-
already-filed doc = 409 no-overwrite, filing-failure rollback = clean revert never stranded confirmed,
workflow-locked confirm = 409 no-claim-leak, divergent-value confirm = winner's value/location no
blend). The two strongest oracles: a per-working-copy UNIQUE CONTENT MARKER (every filed PDF must
carry ITS OWN doc's bytes — catches cross-doc/overwrite mixups) + a BIJECTION check (DB `stored_path`
set ≡ physical files — catches loss/dupe/orphan in one assertion). End-state invariants: every doc
filed exactly once to its correct `Supplier/Year/Month` location, inbox + the original IMPORT folder
empty, no half-confirmed rows. 35/35 checks green (2026-07-02). Race matrix designed via a software-
testing subagent pass; safe to extend with the deferred barrier-gated-stub filing backend (forces
contenders into the post-claim/pre-copy `await` window — a regression guard for if anyone adds an
`await` inside `commitDocument`, which would reopen the existsSync→copy collision race).

**Extraction ACCURACY regression harness** — `stress_test/accuracy_harness.js` (run:
`ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron stress_test/accuracy_harness.js`). Runs the REAL
Python backend (`process_docs.py`, mode=fast, sharded ×8) over the whole 400-doc synthetic corpus
(`stress_test/corpus/` + `ground_truth.json` — a LOCAL dev artifact, NOT committed: 200 text-layer +
200 scanned, 3 types × 5 companies) against a FRESH temp DB with only the built-in types + the
SHIPPED `keyword_patterns.json` and NO learned data — so it measures out-of-the-box (document #1)
accuracy, the reproducible regression signal (learning only improves on it). Scores type/supplier/
ref/date/subtotal/total split correct/wrong/missing, by variant (text vs scanned) and by type; writes
`stress_test/out/accuracy_baseline.md`. **Baseline (2026-07-02, ~37s):** type 97% · ref 96.5% · date
97% · subtotal 100% · total 100% (text-layer docs ~100% across the board). supplier is 0% BY DESIGN at
baseline (identified by LOGO/learning, not a shipped keyword label — climbs with confirmed docs). The
harness ADDS total_amount+subtotal currency fields to the built-in types before running, because
migration 3 trimmed the built-ins to name/date/ref — without that the money fields have no schema slot
and read 0% (a schema artifact, not an extraction miss). Almost all misses are on SCANNED sales_order/
purchase_order docs whose OCR'd title mis-detects as invoice → the invoice ref/date keys then miss
(cascade a learned template closes). (`stress_test/analyze.js` is the older variant that runs against a
pre-LEARNED `stress.db` instead of a fresh one — use accuracy_harness.js for the clean baseline.)

**Import LOAD & ROBUSTNESS harness** — `stress_test/import_load_harness.js` (run:
`ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron stress_test/import_load_harness.js`). Hammers the
real Python backend under PARALLELISM (sharded ×8, mirrors the manual/watch worker pool) over a
large MIXED batch = ~160 valid corpus docs (text + scanned interleaved) + 8 PATHOLOGICAL files
(zero-byte, random garbage, truncated PDF, plain-text-renamed-.pdf, header-only, uppercase-ext,
Unicode name, 2 MB non-PDF bulk). THE INVARIANT: no input file is ever lost on import — every file
is accounted for by EXACTLY ONE `file_done` (valid→success, corrupt→ISOLATED `status:error`), and one
bad file must NEVER crash a worker and drop the rest of its shard. **Result (2026-07-02, ~41s):**
168/168 file_done, all 8 shards exit 0, 160/160 valid ok, the 4 clearly-corrupt files isolated as
error, 0 lost — proves per-file try/except isolation holds under load (the 2 "parsed clean"
pathological files are the odd/Unicode-named copies that are ACTUALLY valid PDFs). Sandboxed (temp
import folder + fresh in-memory DB snapshot; never the live DB). Residual not covered: a NATIVE
Tesseract/pdfium segfault or an OCR HANG on a crafted page (no per-file timeout — see the audit's
"corrupt file" note) needs a crafted file to trigger.

**Manual renderer-race checklist** — `stress_test/MANUAL_RENDERER_TESTS.md`: step-by-step manual
scripts for the fixes that live purely in the Electron RENDERER and can't be driven headlessly
(File-All-Ready wrong-doc race #5, reprocess-discards-edits warning #3, empty-issuer warn #6,
no-reference-type Confirm dead-end #2, dashboard Auto-import toggle-vs-drag). Each lists the action +
expected result + fail signals. Migrate a case out once it's automatable via a UI-automation harness.

---

