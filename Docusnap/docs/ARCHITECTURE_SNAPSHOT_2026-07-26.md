# ScanFinder — Current-State Architecture Snapshot & File Inventory (2026-07-26)

Report only — no code changed. Purpose: a fresh, verified view of the system to ground a future
native C++ port assessment. Sources: `package.json`, `src/main.js`, `src/preload.js`, `MODULES.md`,
`CLAUDE.md`, and direct directory/line-count inspection of the working tree at commit `eeb257d`.
Naming: the product is **ScanFinder**; internal identifiers (package name `docusnap`, DB
`docusnap.db`, preload namespace `window.docusnap`, legacy `%APPDATA%\DocuSnap` migration shim)
still say DocuSnap. Same project.

---

## Task summary
Produce a current-state architecture map and planning-grade file inventory for ScanFinder, verify
which older notes are still reliable, and list the questions that must be answered before any C++
port planning starts. No code changes, no rewrite recommendations.

## Likely files (read for this report)
- `package.json` — stack, deps, packaging (read in full)
- `src/main.js` (1,535 lines — head + structure) — startup flow, module registration
- `src/preload.js` (475 lines — head + counts) — the IPC bridge surface
- `MODULES.md` — the old module reference (VERIFIED STALE — see below)
- `CLAUDE.md` — the living project memory (maintained daily; largely current)
- Directory listings + line counts of `src/`, `database/`, `python_backend/` (no full-file reads)

## Risks (sensitive areas confirmed present in the current tree)
- **Auth/roles**: `src/modules/auth/`, `src/services/{authService,accessService,sessionService}.js`,
  argon2 password hashing, admin/edit role gates enforced main-process-side.
- **File deletion/mutation**: review delete (soft-delete + audited), filing rename/move,
  `secure_delete`, output-root containment checks (`src/modules/filing/`, `path_overlap.js`).
- **Local DB**: better-sqlite3 opened synchronously in the MAIN process; no renderer DB access.
- **Audit**: audit log + `database/modules/audit_archive.js`.
- **Subprocess execution**: Python spawned per batch/reprocess (`process_docs.py` + helpers),
  Tesseract invoked from Python; temp-file argument passing.
- **Packaging/startup**: NSIS installer, license gate before the app shell, legal-acceptance gate,
  one-time `%APPDATA%\DocuSnap`→`ScanFinder` data-folder migration at boot (`main.js:16-40`).
- **Offline behaviour**: fully offline-capable; licensing verifies tokens OFFLINE (Ed25519 JWS
  against pinned public keys); forced-update gate is deliberately fail-OPEN when offline.
- **Extraction/learning**: the Python pipeline + learned data (anchors/hints/templates/logos) —
  the core IP and the largest single body of logic.

---

## Current architecture snapshot

### 1. Current stack
| Layer | Current reality |
|---|---|
| Desktop shell | **Electron 31** (Node main process), Windows-only (`win32` targets, NSIS) |
| UI | **Vanilla HTML/CSS/JS** per window — NO framework (no React/Vue); shared `src/windows/shared/theme.css|theme.js` (11 named themes), native OS window frames |
| Process model | 1 main process (all business logic) + N renderer windows (16 window folders) + short-lived **Python 3.12** subprocesses for OCR/extraction + optional TLS API server in-process |
| Database | **SQLite** via **better-sqlite3 12** (synchronous, main-process only); JS-driven migrations (current schema version **54**), `database/migrations/` holds only `001_initial.sql` — everything since is code migrations in `database/index.js` |
| Native Node deps | `better-sqlite3`, `argon2` (both ABI-rebuilt by electron-builder), `node-forge` (TLS cert generation), `pdf-lib` (JS-side PDF ops, e.g. stamping) |
| Python side | Bundled **embeddable Python** in `vendor/python` for packaged builds (`python312._pth` — sys.path quirk documented), `py -3.12` in dev; **pytesseract + Tesseract 5** (external install at `C:\Program Files\Tesseract-OCR` in dev), **pypdfium2** for PDF rendering (deliberately NOT PyMuPDF — AGPL banned), Pillow, pypdf |
| Packaging | electron-builder **24.13.3**, NSIS x64, `buildRev` stamp (`scripts/build-rev.js`), license-compliance gate (`scripts/check-licenses.js`) and vendor-python check wired into `npm run build`; `extraResources` ships `python_backend/`, `config/`, `vendor/`, legal + third-party notices |
| Companion artifacts | `client/` — a SEPARATE Electron app (LAN search/mailbox client, CA-pinned TLS); `cert-tool/` — standalone cert-generator GUI; `licensing-backend/` — separate PHP 8 + MySQL activation server (deployed independently; not part of the desktop build) |

### 2. Runtime architecture
- **Startup flow** (`src/main.js`, 1,535 lines, deliberately a thin router):
  appData rename shim (DocuSnap→ScanFinder) → `app.disableHardwareAcceleration()` (documented GPU
  compositing fix) → AppUserModelID → module imports → app ready → splash → **login window**
  (in-process auth; argon2) → **license gate** (`licensingModule.decideAccess()` — MAIN process is
  the sole decider; non-allow routes to the license window) → **legal-acceptance gate** (version-
  stamped `LEGAL.txt`) → first-run **onboarding wizard** (once; `first_run_completed`) → **main
  shell**. `close_to_tray` default on; primary windows hide instead of close.
- **Windows** (16): `main` (dashboard + nav), `review`, `search`, `settings`, `teach`,
  `dev-inspector` (hidden, password-gated), `onboarding`, `welcome` (tour), `tutorial` (sandboxed
  practice), `login`, `license`, `legal`, `help`, `splash`, `update-lock`, plus `shared/` (theme,
  helpmode, thumbs). Child windows are modal, `skipTaskbar`, destroyed on close; primary windows
  are reused (a documented reuse-without-reload trap for renderer edits).
- **Main-process responsibilities**: ALL business logic and DB access; window lifecycle; IPC
  routing (**263 `ipcMain` handlers** across `src/modules/`); Python child-process management;
  watch-folder service; TLS `/v1` API server (`src/modules/api/handler.js`) when the LAN add-on is
  enabled; licensing enforcement; audit logging.
- **Preload/API bridge** (`src/preload.js`, 475 lines): single `contextBridge` namespace
  `window.docusnap` exposing ~**269** wrapped `invoke`/`send`/event subscriptions. Also swallows
  drag-drop navigation (audit M4) pairing with the main-process `will-navigate` guard
  (`src/lib/navGuard.js`). Renderers have NO Node access.
- **Renderer responsibilities**: pure UI per window (`index.html` + `renderer.js`); zoom/pan
  preview, queue rendering, draw-tools (⊕ teach, template wizard). The corpus/regression harness is
  structurally blind to renderer code — a documented testing boundary.
- **IPC/communication shape**: request/response `ipcMain.handle` (promise-based), fire-and-forget
  `send`, and main→renderer events (`process-progress`, `process-trace`, `review-count-changed`,
  `license-state`, `theme-changed`…). Python→main: **line-delimited JSON over stdout**
  (`{"type":"file_begin"|"file_done"|"log"|"trace"...}`), large inputs passed as **temp JSON files**
  (Windows arg-length limit) — `--fields-file`, `--anchors-file`, `--templates-file`, etc.
- **Services layer** (`src/services/`, 18 services + tests): transport-agnostic core shared by
  desktop IPC AND the TLS `/v1` API — `reviewService` (atomic claim-then-file confirm),
  `searchService`, `workflowService`, `presenceService`, `entitlementService`, `certService`,
  `sessionService`, `backupService`, `previewService`, `accessService` (authz), `repairService`/
  `repairSuspects` (Learning Repair), `pdfStamp`, `seatPool`, `dto` (the frozen /v1 projection).

### 3. Core modules (current, verified on disk)
`src/modules/` — one folder per domain, each registering its own IPC via `register(ctx)`:
| Module | Purpose | Kind |
|---|---|---|
| `processing/` | folder import, reprocess, OCR region, logos, BACKEND AUTO-FILE (`_maybeAutoFile`), Python spawn plumbing | business + external-process |
| `review/` | queue, confirm/defer/delete, pages, Learning History, advanced repair | business |
| `filing/` | output structure builder, rename, XML metadata, containment checks | business + FS |
| `settings/` | doc types/fields CRUD, key-value settings | business + data |
| `search/` | document search | business |
| `templates/` | Admin Template Viewer, merge/cleanup tooling, learning recovery | business |
| `auth/` | login, users, roles, recovery | security |
| `licensing/` | `decideAccess`, trial/activate/revoke, enforcement, update banner | security |
| `api/` | the TLS `/v1` LAN API + cert wizard + enrolment | external surface |
| `watch/` | watch-folder ingestion | business + FS |
| `workflow/` | mailbox/approval routes (dark behind `WORKFLOW_FEATURE_ENABLED`) | business |
| `print/` | print flow (Electron 31 native-dialog limitation documented) | shell |
| `tutorial/` | sandboxed practice-run support | UI support |
| plus `logger.js`, `diaglog.js`, `telemetry.js` (opt-in, off), `path_overlap.js` | cross-cutting | infra |

`database/modules/` (~20 domain modules + ~60 co-located `test_*.js`): `documents`, `document_types`
(preset catalog, structural roles), `learning` (hints/anchors/logos/settings), `templates`,
`trust` (graduation + THE auto-file eligibility predicate), `auth`, `licensing`, `audit_archive`,
`branding_fingerprint`, `logoDetail`, `templateMerge`, `label_overrides`, `slug`, etc.

`python_backend/extraction/` (22 modules; the pipeline): `engine.py` (4,941 lines — staged
orchestration Stage 0→4.6), `anchor.py` (3,607), `template_matcher.py`, `template_mapper.py`,
`keyword.py`, `validator.py`, `format_anomaly_checker.py`, `ocr_corrector.py`, `registration.py`,
`identity_fusion.py`, `letterhead.py`, `name_match.py`, `value_quality.py`, `text_normalise.py`,
`chrome_band.py`, `wordness.py`, `number_format.py`, `field_rules.py`, `title_pick.py`.
Support: `ocr/` (tesseract wrapper — rebuilds page text from word GEOMETRY, region draw-tool OCR,
orientation/OSD auto-rotate, landmarks, text_enhance, born_digital, segmentation), `render/pages.py`
(PDF→PNG previews + thumbs), `logo_hash.py` + `logo_detail.py` (64-bit page phash + 256-bit
isolated-mark hash), `pdf_splitter.py`, `pdf_rotate.py`, `filing_slips.py`, `segment_docs.py`.

### 4. Data and persistence
- **DB**: `%APPDATA%\ScanFinder\docusnap.db` (legacy path auto-migrated). Access ONLY through
  `database/index.js` (open + migrations) and `database/modules/*`. Synchronous better-sqlite3.
- **Architecturally-significant tables**: `documents` (+`working_path` inbox copy, `template_id`,
  `detected_type_name`, workflow status), `extractions`, `document_types`/`fields` (structural
  roles: issuer/date/ref are permanent), `corrections`, `supplier_hints`, `field_anchors` (⊕ teach
  learning; slug-keyed), `logo_fingerprints`, `templates` + `template_landmarks` +
  `template_logo_hashes` + `template_hidden_fields` (mig 54), `settings` (key-value), `users`
  (+TOTP columns), `license_tokens`, `device_registrations`, `document_routes` (workflow),
  `migrations`.
- **Settings/config**: the `settings` table is the runtime config store (thresholds, toggles,
  theme, output patterns). Shipped config: `config/keyword_patterns.json` (the shared
  extraction/validation pattern library — SINGLE SOURCE for Python `re` + renderer `RegExp`) and
  `config/license.json` (backend URL + pinned PUBLIC keys). `window-state.json` in userData.
- **File-system conventions**: output tree is builder-driven —
  `OutputRoot/{supplier}/{year}/{month}/DocType.DD-MM-YYYY.Ref.pdf` + `.metadata/*.xml`
  (patterns `output_folder_pattern` / `filename_pattern`); working copies in `userData/inbox/`;
  duplicate suffix `-DUPLICATE[-n]`; `processing.log` in userData.

### 5. External tools and subprocesses
- **Python** (`process_docs.py` + `render_pages.py`, `ocr_region.py`, `pdf_splitter.py`,
  `pdf_rotate.py`, `segment_docs.py`, `filing_slips.py`, `template_fingerprint.py`): spawned per
  operation; dev `py -3.12`, packaged `vendor/python/python.exe` (embeddable — the documented
  `sys.path` trap). Everything import/reprocess/preview/split depends on it.
- **Tesseract 5**: external Windows install invoked via pytesseract from the Python side (dev path
  hardcoded; packaged resolution — see open questions). OCR is unavailable without it; born-digital
  PDFs bypass OCR via the text layer.
- **pypdfium2**: all PDF rasterisation (extraction renders + previews + thumbnails).
- **No cloud services**: fully offline product; the only network surfaces are the OPTIONAL LAN
  `/v1` TLS API and the licensing backend (activation/validation), both explicitly bounded.

### 6. Security-sensitive boundaries (renderer never trusted)
- **Auth/roles**: argon2-hashed users in SQLite; role checks (admin/edit) enforced in MAIN at the
  IPC handler layer (`accessService` — SEC-03); the renderer can only request.
- **Licensing**: `decideAccess()` main-only; offline Ed25519 JWS verify against pinned keys;
  enforcement always-on in packaged builds; secrets never logged; fingerprint = SHA-256(product_id
  | MachineGuid) never leaves main.
- **/v1 LAN API**: 2-tier TLS (CA signs server cert; clients pin the CA), TOTP MFA, session
  revocation, DTO projection (never leaks `stored_path`/`working_path`), entitlement-gated.
- **File mutation**: soft-delete with audit; output-root containment (`path_overlap.js`); backup
  restore is device-bound (anti-trial-stacking); `secure_delete` setting.
- **Navigation/CSP**: per-window CSP (`'self'`, fonts self-hosted), `navGuard` will-navigate
  lockdown + preload drop-swallow; no `nodeIntegration` in renderers (contextBridge only).
- **Audit**: user-facing actions audited; `audit_archive` for retention. (Gap noted 2026-07-26:
  one admin template-maintenance path wrote no audit rows — recorded in the audit doc.)
- **Secrets at rest**: `src/lib/secretStore.js` (CA key encryption, audit H1).

---

## Most important files (planning inventory)

**Architecture-defining**
- `src/main.js` — startup, gates, window lifecycle, module registration (1,535 lines)
- `src/preload.js` — THE renderer↔main contract (~269 bridged calls, one namespace)
- `database/index.js` — DB open + the entire migration history (schema v54) (1,336 lines)
- `database/modules/trust.js` — auto-file safety core (graduation, `isAutoFileEligible`,
  `docTrustGate`) — the single most consequential business-rules file on the JS side
- `python_backend/extraction/engine.py` — pipeline orchestration (4,941 lines)
- `python_backend/process_docs.py` — the Electron↔Python contract (CLI args + JSON-stdout protocol)
- `CLAUDE.md` + `docs/extraction-pipeline.md` + `docs/architecture-notes.md` — living design docs

**IPC / API surface**
- `src/preload.js` + every `src/modules/*/handler.js` (263 handlers) — desktop IPC
- `src/modules/api/handler.js` + `src/services/dto.js` — the frozen `/v1` LAN contract
  (`API_CONTRACT_VERSION`)

**Windows/views** (each `src/windows/<name>/{index.html,renderer.js}`)
- `review/` (largest/most complex renderer: queue, preview, teach tools, trace console),
  `search/` (+3 split JS files), `settings/`, `teach/`, `main/`, `onboarding/`, `dev-inspector/`,
  `shared/` (theme.css/theme.js/helpmode.js/thumbs.js)

**Database schema/migrations**
- `database/index.js` (JS migrations 2..54 inline) + `database/migrations/001_initial.sql`
- `database/modules/*.js` — the effective data-access layer (documents/learning/templates/...)

**Python / external processing**
- `python_backend/extraction/*` (all 22 — engine/anchor/template_matcher/keyword/validator are the
  big five), `ocr/tesseract.py` (geometry-based text reconstruction — load-bearing), `ocr/region.py`,
  `render/pages.py`, `logo_hash.py`, `logo_detail.py`, `config/keyword_patterns.json`

**Native-port-relevant hotspots**
- Duplicated JS↔Python logic twins that a port must unify or re-duplicate:
  `text_normalise.py` ↔ `database/modules/text_normalise.js`; `logo_detail.py` ↔
  `database/modules/logoDetail.js`; `value_quality.py` name rules ↔ `learning.js` mirror;
  shape/slip logic ↔ `src/windows/shared/slipFix.js`; `validation_patterns` shared JSON.
- Native Node deps to replace: better-sqlite3 (→ direct SQLite), argon2, node-forge (cert gen),
  pdf-lib (stamping).
- The services layer (`src/services/*`) — cleanest seam in the JS side; already transport-agnostic.
- Test estate: ~60 `database/modules/test_*.js` + ~25 `src/services/test_*.js` (run
  Electron-as-Node) + `python_backend/tests/*` + `stress_test/` harnesses (`realdoc_regression.js`
  corpus gate, probes) — the regression safety net any port must preserve or replicate.

**Top-level folders**
- `src/` app · `database/` data layer · `python_backend/` extraction · `config/` shipped config ·
  `client/` separate LAN client app · `cert-tool/` cert GUI · `licensing-backend/` PHP server ·
  `scripts/` build/compliance gates · `stress_test/` harnesses · `docs/` design docs ·
  `assets/` icons/fonts/tutorial samples · `vendor/` embeddable Python (build machine) ·
  non-shipping: `dist/`, `night_audit/`, `sandbox/`, `_archive/`, `Debug/`, `Samples/`, `output/`

---

## What appears outdated in old notes

1. **`MODULES.md` is badly stale — do not plan from it.** It shows 5 modules and 4 windows; the
   tree has **19 module entries and 16 windows**, plus a whole `src/services/` layer, `src/lib/`,
   auth/licensing/api/watch/workflow/templates/print modules, and the client/cert-tool/
   licensing-backend siblings — none of which it mentions. It also claims numbered SQL migration
   files (reality: one SQL file + JS migrations to v54) and still titles the project "DocuSnap v2".
2. **`CLAUDE.md` is largely CURRENT** (maintained continuously; session-state block updated
   2026-07-26) but is a LAYERED document: the "(prior) Session state" blocks are historical and
   individually superseded — read only the top block as current truth. Its directory map is
   accurate at module level; per-file design detail lives in `docs/architecture-notes.md`.
3. **Older HANDOVER_*.md files** are point-in-time snapshots — reliable for the day they describe,
   not for current shape (e.g. anything predating the 2026-07-26 logo-identity work, the mig-54
   field hiding, or the ScanFinder rename shim).
4. **Naming drift is cosmetic but pervasive**: package name, DB filename, preload namespace, and
   many comments say DocuSnap; product, installer, userData folder, and AppUserModelID say
   ScanFinder. Any port inventory must treat them as one system.
5. Older notes describing **Fast/Smart processing modes** as a user choice are outdated — the
   choice was collapsed 2026-07-08 (plumbing retained for tolerance).
6. Older security notes predating the 2026-07-21/22 audit remediation are superseded (H1/M1-M5
   fixed; H2 LAN-pairing TOFU remains the one open design).

## Questions that still require deeper inspection (before C++ port planning)

1. **Tesseract in the packaged app** — is Tesseract bundled under `vendor/` or an install-time
   prerequisite? (Dev path is hardcoded; the packaged resolution path needs one targeted read of
   the processing handler/vendor checks.) Decides the OCR-engine strategy for a port.
2. **Renderer scale** — line/complexity inventory of `src/windows/*/renderer.js` (review/search/
   settings are known-large) to size the UI rewrite honestly (no framework = no framework lock-in,
   but lots of hand-rolled DOM logic).
3. **The exact `/v1` contract** — enumerate `API_CONTRACT_VERSION`, endpoints, and DTO fields if
   the LAN client must survive a core port unchanged.
4. **The duplicated-logic ledger** — a precise list of every JS↔Python twin (normalisers, hashes,
   shape rules, slip-fix, name quality) with drift-pin tests; these become single implementations
   in a native port and are the highest-value consolidation targets.
5. **Migration condensation** — whether a port starts from a fresh schema-v54 DDL (likely) and
   what data-migration guarantees existing installs need (DB file is the customer's asset).
6. **Learned-data portability** — formats of `field_anchors`/`templates`/hashes (normalised
   coordinates, hex hash strings) are engine-agnostic in principle; confirm no
   Python-pickle/impl-specific artifacts exist anywhere (none seen at table level).
7. **Performance baseline** — current per-doc timings (OCR warm pool, parallel flags) to set
   port acceptance targets.
8. **Windows-only assumptions** — MachineGuid fingerprint, `%APPDATA%` paths, NSIS, print
   limitations, icacls-free ACL stance: enumerate before choosing a C++ UI/toolkit story.
9. **The corpus gate's portability** — `stress_test/realdoc_regression.js` drives the Python CLI
   directly; a port needs an equivalent harness early or it flies blind against 570 ground-truth
   docs.
