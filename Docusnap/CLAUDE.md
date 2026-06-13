# DocuSnap v2 — Project Memory for Claude Code

> Read this file before every response. Do not summarise it back to the user.
> Read only the specific source files needed for the current task.

---

## Working rules (read before any fix)

**Token conservation — hard requirement**
- Smallest possible scope: read the fewest files necessary; never scan the
  whole repo unless a narrow, targeted investigation has proven insufficient.
- Stage non-trivial work into incremental edits — prefer a focused change
  over a broad rewrite. Keep investigation and responses concise and
  non-repetitive.

**Extraction/anchoring fixes are system fixes, not document fixes**
Any issue touching field detection, anchors, OCR regions, keyword matching,
validation, supplier/template learning, or extraction accuracy is a reusable
*application-level* weakness until proven otherwise — assume it also affects
unseen suppliers, layouts, and future templates, not just the document on screen.
- Fix the reusable layer — matching strategy, learning rules, normalisation,
  thresholds, validation — not the symptom on one sample document.
- No one-document hacks: filename-based exceptions, sample-specific
  coordinates, or narrow conditionals tuned to a single case (allowed only
  with a documented architectural reason).
- State explicitly how the fix helps future unseen documents/templates. If it
  mainly helps the sample in front of you and doesn't clearly improve the
  broader system, stop and redesign the approach.
- Verify beyond the single failing document: note likely impact on other
  templates/layouts and regression risk; prefer multi-sample or manual
  cross-checks over a single-document confirmation.

---

## What this is
Windows desktop app: scans documents → OCR → extracts fields → files them intelligently.
Electron + Python backend + SQLite. Fully offline capable.

---

## Stack
| Layer | Tech |
|---|---|
| Desktop shell | Electron 41 (`^41.7.2`), Node.js, electron-builder `^26` |
| Native deps | better-sqlite3 `^12.10`, argon2 `^0.44` (password hashing) — rebuilt per Electron ABI |
| UI | Vanilla HTML/CSS/JS, frameless windows, dark/light theme |
| OCR | Tesseract 5 via pytesseract + pypdfium2 (render/preview/OCR); pypdf for PDF splitting |
| AI extraction | phi3:mini via Ollama (Stage 3 — `ai` mode is selectable in Settings again; Ollama not bundled in installer, user-installed) |
| Database | SQLite via better-sqlite3 |
| Auth | Local accounts (argon2id), roles admin/edit/readonly, in-memory session |
| Platform | Windows only |

> Python deps are not pinned in a `requirements.txt` — dev uses system Python 3.12;
> packaged builds bundle `vendor/python`. A fuller, source-cross-checked companion
> to this file lives at `docs/DEVELOPER_MANUAL.md` (this file remains source-of-truth).

---

## Directory map
```
docusnap2/
├── src/
│   ├── main.js                          # IPC router + window/auth-gate orchestration; delegates to modules
│   ├── preload.js                       # contextBridge API bridge (full API surface)
│   ├── modules/
│   │   ├── logger.js                    # file logger (processing.log), shared via ctx
│   │   ├── auth/handler.js              # login, roles, first-run setup, recovery codes, audit, user mgmt
│   │   ├── auth/password.js             # argon2 hashing, temp/recovery code generation
│   │   ├── processing/handler.js        # folder import, reprocess, stop, split-pdf, OCR region, logos
│   │   ├── processing/processing_mode_handler.js # mode get/set, fast-mode suggestion
│   │   ├── review/handler.js            # queue, confirm, defer, delete, pages, enhanced preview, promote-to-template
│   │   ├── watch/handler.js             # watch-folder polling/auto-import (admin-configured)
│   │   ├── filing/handler.js            # folder structure, configurable filename pattern, XML metadata
│   │   ├── filing/filename_pattern.js   # token grammar, buildFilename(), duplicate resolution
│   │   ├── settings/handler.js          # doc types, fields, key-value settings, theme, Learning Recovery
│   │   ├── templates/handler.js         # Admin Template Viewer — samples, anchor→target mapping, groups, OCR-auto
│   │   └── search/handler.js            # document search
│   └── windows/
│       ├── login/{index.html,renderer.js}     # auth screen (first-run, sign-in, forced change, recovery)
│       ├── main/{index.html,renderer.js}
│       ├── review/{index.html,renderer.js}
│       ├── settings/{index.html,renderer.js}  # incl. Template Viewer, File Naming, Learning Recovery, Users
│       ├── search/{index.html,renderer.js,search-{query,state,results,preview,actions}.js}
│       └── shared/theme.js                     # reads 'theme' setting, applies before first paint
├── database/
│   ├── index.js                         # open(), runMigrations() (SQL files + JS migrations 2–14, out-of-order)
│   ├── migrations/001_initial.sql       # base schema; later changes are JS migrations in index.js
│   └── modules/
│       ├── document_types.js            # doc type + field CRUD, seedBuiltInTypes()
│       ├── documents.js                 # document CRUD, search(), getReviewQueue()
│       ├── learning.js                  # hints, anchors, logos, settings, Learning Recovery queries/clears
│       ├── templates.js                 # template CRUD, field mappings, groups, OCR-auto, sample linkage
│       └── auth.js                       # users, recovery_codes, audit_log CRUD; VALID_ROLES
├── python_backend/
│   ├── process_docs.py                  # main extraction CLI entry point, streams JSON to stdout
│   ├── pdf_splitter.py                  # split PDF by page ranges (pypdf) → split-pdf IPC
│   ├── render_pages.py                  # CLI: PDF→base64 PNG for review (Electron spawns this)
│   ├── logo_fingerprint.py              # CLI: extract/match logo perceptual hashes
│   ├── ocr_region.py                    # CLI: focused OCR on a base64 zone crop
│   ├── extraction/
│   │   ├── engine.py                    # ExtractionEngine — staged pipeline orchestration (see below)
│   │   ├── template_matcher.py          # Stage 0: learned-template identification + field seeding
│   │   ├── template_mapper.py           # Stage 0.5: admin-drawn anchor→target zone mapping extraction
│   │   ├── keyword.py                   # Stage 1: regex pattern matching
│   │   ├── anchor.py                    # Stage 2: spatial anchors + logo match
│   │   ├── ocr_corrector.py             # Stage 2.5: learned OCR misread correction
│   │   ├── llm.py                       # Stage 3: phi3:mini via Ollama (dormant — 'ai' mode not exposed in UI)
│   │   ├── validator.py                 # Stage 4: cross-field validation
│   │   └── format_anomaly_checker.py    # Stage 4.5: history-based format anomaly check + correction candidates
│   ├── ocr/{tesseract.py,region.py}     # tesseract.py also exports preprocess_for_ocr()
│   ├── logo/fingerprint.py
│   ├── render/{pages.py,preview_enhance.py} # pages.py: PDF→PNG (review/search/template); preview_enhance.py: OCR-preprocess preview
│   └── tests/                           # pytest suite (format anomaly, anchors, templates, splitter, etc.)
├── docs/DEVELOPER_MANUAL.md             # expanded, source-cross-checked companion to this file
└── config/keyword_patterns.json         # editable pattern library
```

---

## Database tables
> Schema = `migrations/001_initial.sql` + JS migrations 2–15 in `database/index.js`
> (numbered out of execution order; each guarded by `applied.has(n)` + column/table checks).
> DB lives at `%APPDATA%\DocuSnap\docusnap.db` (WAL, foreign_keys ON).
```
document_types  — name, slug, built_in, enabled, ref_field_key, date_field_key, sort_order
fields          — document_type_id(FK), key, label, type, required, built_in,
                  enabled, confidence_threshold, sort_order
documents       — document_type_id(FK), original_filename, stored_filename,
                  stored_path, folder_path, status, overall_confidence,
                  supplier_name, doc_date, reference_number,
                  template_id(FK), logo_phash, keyword_fingerprint, ocr_text
                  STATUS: pending|needs_review|deferred|confirmed|deleted|error
extractions     — document_id(FK), field_key, raw_value, display_value,
                  confidence, was_corrected, corrected_to, extraction_method,
                  validation_note (Stage 4.5 reason), anchor_label
corrections     — document_id(FK), field_key, original_value, corrected_value,
                  supplier_name, document_type
supplier_hints  — supplier_name, document_type, field_key, hint_value, usage_count
field_anchors   — supplier_name, document_type, field_key, anchor_label,
                  direction(right|below|above), page_zone, x_norm, y_norm,
                  w_norm, h_norm, usage_count, confidence
logo_fingerprints — supplier_name, phash, ahash, crop_zone, match_count
field_format_rules — supplier_name, document_type, field_key, format_class,
                  allowed_separators, confirmed_count, sample_values
                  (Stage 7 Stage 3 — persistent learned format model; migration 15)

# Templates system
templates       — name, slug, document_type_slug, supplier_name, logo_phash,
                  keyword_fingerprint, confirmed_count, sample_document_id(FK),
                  group_id(FK), ocr_auto_enabled, ocr_auto_params
template_fields — template_id(FK), field_key, anchor_label, direction,
                  fixed_value, is_variable
template_field_mappings — template_id(FK), field_key, page_number, anchor_text,
                  anchor_{x,y,w,h}_norm, target_{x,y,w,h}_norm, offset_d{x,y}_norm,
                  ocr_type, search_expansion, region_hint, enabled,
                  last_test_{value,confidence,status,at}
template_groups — name (organisational metadata only; no shared-anchor behaviour)

# Authentication (migration 7)
users           — username(UNIQUE,NOCASE), display_name, password_hash(argon2),
                  role(admin|edit|readonly), is_active, must_change_password, last_login_at
recovery_codes  — user_id(FK), code_hash, is_used, used_at  (one-time admin recovery)
audit_log       — user_id(FK), action, target_type, target_id, details, created_at

settings        — key, value (key-value store: output_folder, processing_mode,
                  theme, filename_pattern, watch_folder, watch_folder_enabled, …)
migrations      — version, applied_at
```

---

## Extraction pipeline
```
process_docs.py → ExtractionEngine.extract()
  Stage 0:   template_matcher.py — match a learned template, seed fields from it
  Stage 0.5: template_mapper.py  — admin-drawn anchor→target zone mappings
             (Settings → Templates → "Map a Field"; only runs when the matched
             template has enabled mappings AND page images are available).
             Returns the same result shape as anchor.extract_with_anchors();
             engine.py merges it into results by confidence comparison — the
             same approach Stage 2 uses for its anchor results below.
  Stage 1: keyword.py    — regex patterns from keyword_patterns.json (~60-70% fields)
  Stage 2: anchor.py     — learned label positions + logo supplier ID
  Stage 3: llm.py        — phi3:mini, ONLY for missing fields (smart/ai mode)
  Stage 4: validator.py  — date normalise, currency infer, maths cross-check
```

**Three modes** (stored in settings as `processing_mode`, selectable in
Settings → Processing Mode):
- `fast`  — stages 1+2 only, sub-second, any hardware
- `smart` — DEFAULT. **Currently identical to fast** — the conditional Stage-3
             fallback is disabled in code (`engine._should_use_llm` returns true
             only for `ai`; the docstring keeps `smart` distinct "for future
             use"). If you re-enable it, that's the place.
- `ai`    — stages 1+2, then Stage 3 (LLM) **always**, to fill fields the
             earlier stages missed. Requires Ollama running with `phi3:mini`;
             if unreachable, `engine.warmup()` silently downgrades to fast.
             Best for unfamiliar suppliers with no learned template. Slower
             (seconds/doc). The Settings AI option shows a live availability
             probe (`get-ai-status` → Ollama `/api/tags`).

**Critical**: engine.extract() returns a flat dict mixing field data dicts
`{"value":..,"confidence":..,"method":..}` with plain metadata values
`_supplier_name`, `_document_type`, `_overall_confidence`, `_needs_review`,
`_mode_used`, `_document_slug`. Always pop _ keys BEFORE iterating fields.

**sanitise_extractions()** in process_docs.py strips _ keys and normalises
all values to proper dicts. Call this after popping metadata, before emitting.

**Supplier identity — don't freeze it early**: `supplier_name`/`_supplier_name`
must reflect the LATEST reliable `results['supplier_name']`, not the first
guess. Stage 0's template match (or the logo fallback) only seeds a
provisional value; Stage 1/2 can legitimately override it with something more
accurate (e.g. a taught `anchor_crop` reading the real page beats a
near-duplicate-logo template guess). engine.py re-resolves `supplier_name`
once, after every stage that can touch it has run, before persisting
hints/anchors/logos — otherwise the learning corpus gets silently written
against a stale identity.

---

## Filing system
```
OutputRoot/
└── CompanyName/
    └── 2025/
        └── December/
            ├── Invoice.15-12-2025.INV-001.pdf
            └── .metadata/
                └── Invoice.15-12-2025.INV-001.xml
```
- Filename: built from a **user-configurable pattern** (Settings → File Naming,
  stored as `filename_pattern`; admin-only). Tokens: `{docType} {date} {ref}
  {supplier} {year} {month} {originalName}`. Default `{docType}.{date}.{ref}`
  → `DocType.DD-MM-YYYY.RefNo.pdf`. Each token is sanitised individually and
  empty tokens collapse dangling separators; invalid patterns fall back to default.
  See `filing/filename_pattern.js`.
- Duplicate: append `-DUPLICATE` (then `-DUPLICATE-2` etc)
- Output root stored in settings table as `output_folder`
- Source file removal is deferred (review/handler schedules `removeSourceFile()`)
  to avoid locked-file failures while the preview still holds the original.

---

## Authentication & roles
Local accounts only (no cloud). `auth/handler.js` is the **single enforcement
boundary** — renderer-side control hiding is UX only; every role-gated IPC calls
`requireRole(...)` / `requireLogin()` server-side.
- **App opens to the login window**; the main shell only appears after a session
  is established (`auth-enter-app`). Session is in-memory, single shared instance
  (re-login each launch by design). `main.js` swaps login ⇄ main windows.
- **First run**: no users → first-run setup creates the initial **admin** and
  shows a one-time **recovery code** (argon2-hashed, stored in `recovery_codes`).
- **Roles**: `admin` (all settings, users, templates, watch folder, review),
  `edit` (review/process, no settings), `readonly` (Search only). Window openers
  in `main.js` gate by role.
- **Hardening**: argon2id hashing (`auth/password.js`), per-account progressive
  rate-limit on failed logins, dummy-hash compare for unknown users (timing),
  generic error messages, last-active-admin protection, full `audit_log`.
- Admin tools: create user (issues temp password, forces change), reset password,
  enable/disable, role change, view audit log, one-time-code admin recovery.

---

## Watch folder (auto-import)
`watch/handler.js` — admin-configured drop folder (e.g. scanner output) is
**polled** (not `fs.watch`, unreliable on SMB shares) every 5s; a file is
accepted once size/mtime are stable for 10s, then run through the same pipeline
as a manual import (serialised, one at a time, yields to a running batch import).
Settings: `watch_folder`, `watch_folder_enabled`. Resumes on app start if enabled.
Pure debounce decision is `classifyPoll()` (unit-tested).

---

## Default document types
| Type | slug | ref_field_key | date_field_key |
|---|---|---|---|
| Invoice | invoice | invoice_number | invoice_date |
| Sales Order | sales_order | sales_order_number | order_date |
| Purchase Order | purchase_order | po_number | po_date |

---

## UI conventions
```css
--bg:#0c0e14  --surface:#13161f  --surface2:#1a1e2a
--border:#252836  --border2:#2f3347
--accent:#4f8ef7  --accent2:#6ea8ff
--ok:#3ecf8e  --warn:#f7b84f  --err:#f76f6f
--text:#e2e6f0  --muted:#7a82a0
Font: IBM Plex Sans (UI) + IBM Plex Mono (values/code)
Frameless windows — custom titlebar with -webkit-app-region:drag
```

---

## IPC reference

> Canonical list is `src/preload.js` (`window.docusnap.*`). Most handlers are
> role-gated server-side — see Authentication & roles. (`get-ai-status` is back
> with the re-added AI mode option; `pull-ai-model` / in-app model download was
> NOT restored — users install Ollama + `phi3:mini` themselves.)

### Renderer → Main (invoke — returns promise)
```
# Auth
auth-get-status, auth-get-current-user, auth-first-run-setup(data)
auth-login(data), auth-logout, auth-change-password(data)
auth-set-new-password-after-reset(data), auth-recover-admin(data)
auth-list-users, auth-create-user(data), auth-set-user-role(data)
auth-set-user-active(data), auth-admin-reset-password(data), auth-get-audit-log(limit)
# Processing
pick-folder, pick-output-folder, process-folder(folderPath), stop-processing
reprocess-document({docId,folderPath,filename,enhanceParams}), split-pdf(file,ranges,outDir,docId)
# Doc types & fields
get-document-types, get-all-doc-types, get-all-doc-types-all
add-document-type(data), update-document-type(id,changes)
add-field(data), update-field(id,changes), delete-field(id)
# Review queue
get-review-queue, get-deferred-queue, get-review-count, get-deferred-count
get-document-with-extractions(id), get-document-pages(id,folderPath,filename)
get-enhanced-preview({folderPath,filename,page,enhanceParams})
confirm-review(payload), defer-document(id), restore-deferred(id)
delete-document(id,filePath), delete-all-review, delete-all-deferred
promote-to-template(data), check-template-match-for-document(id), notify-review-complete
# Zone OCR & learning
ocr-region(base64), test-template-mapping(pageB64,mapping), save-field-anchor(data)
extract-logo-hash(base64), match-logo-hash(base64), save-logo-fingerprint(data)
# Processing mode
get-processing-mode, set-processing-mode(mode), get-ai-status, check-fast-mode-suggestion(supplier)
# Watch folder
pick-watch-folder, get-watch-folder-config, set-watch-folder(folder), set-watch-folder-enabled(bool)
# File naming
get-filename-pattern-info, preview-filename-pattern(pattern)
# Search
search-documents(params)
# Templates (admin, in Settings)
get-templates, get-template-detail(id), create-template(data), rename-template(id,name)
delete-template(id), get-template-sample-candidates(id), set-template-sample(id,docId)
reassign-template-documents(fromId,toId), set-template-ocr-auto(id,enabled)
pick-template-sample-file, import-template-sample-file(id,filePath)
save-template-mapping(id,mapping), set-template-mapping-enabled(id,key,enabled)
delete-template-mapping(id,key), record-template-mapping-test(id,key,result)
set-template-field-fixed(id,key,value)
get-template-groups, create-template-group(name), delete-template-group(id)
set-template-group(tid,gid), get-template-siblings(id)
# Settings & Learning Recovery
get-setting(key), set-setting(key,value)
get-learning-recovery(params), get-memory-inventory, reset-all-learning
clear-learning-anchors(params), clear-learning-hints(params), clear-learning-corrections(params)
clear-learning-format-rules(params)
# Window navigation (invoke)
get-review-target, get-settings-template-target
```

### Renderer → Main (send — fire and forget)
```
window-minimise, window-maximise, window-close
show-in-explorer(path), open-file(path)
auth-enter-app, auth-show-login
open-review-window, open-review-window-at(docId)
open-settings-window, open-settings-window-at-template(templateId)
open-search-window, notify-review-complete
```

### Main → Renderer (events)
```
auth-session-changed(user), theme-changed(theme)
review-count-changed(n), deferred-count-changed(n)
processing-mode-changed(mode)
navigate-to-doc(id), navigate-to-template(id)
reprocess-progress(msg), process-progress(msg)
```

---

## Process-progress message types (Python → Electron stdout)
```json
{"type":"start","total":N}
{"type":"file_begin","filename":"..."}
{"type":"file_done","success":true,"status":"needs_review|confirmed|error",
 "original_filename":"...","overall_confidence":85,"needs_review":true,
 "document_type":"Invoice","supplier_name":"...","extractions":{...},
 "invoice_number":"...","invoice_date":"...","total_amount":"..."}
{"type":"log","text":"...","level":""|"warn"|"err"}
```

---

## Feature status (what's shipped)
The early bug-fixes and build stages below are **all done and shipped** — kept
here as a map of the system, not a TODO list.

- **Resolved early bugs**: `sanitise_extractions()` (`process_docs.py`) +
  `validator.py` _-key guarding fixed the `str has no attribute get` crash;
  `keyword_patterns.json` date regex range fixed. (See pipeline section — these
  behaviours are now load-bearing, don't regress them.)
- **Settings window** — General (output folder, Fast/Smart/AI mode + AI
  availability probe, threshold),
  Document Types + Fields sub-panel, plus File Naming, Template Viewer, Learning
  Recovery, and Users tabs. Admin-only.
- **Review window** — tabbed Review Queue / Deferred (live badge counts), doc-type
  dropdown, required-field gating, delete/defer/restore, delete-all, OCR-zone
  picking, enhanced-preview, promote-to-template.
- **Search window** — live debounced search, confirmed + uncommitted results,
  preview pane, open-in-explorer / open-file / Edit-in-Review. Available to all
  roles (read-only's only surface). Split across `search-*.js`.
- **PDF splitting** — `split-pdf` IPC → `pdf_splitter.py` (pypdf page-ranges) for
  multi-document scans.
- **Enhanced OCR preview** — `get-enhanced-preview` → `render/preview_enhance.py`
  applies `preprocess_for_ocr()` for a preview without running Tesseract; the same
  params can be persisted per-template (`ocr_auto_enabled`/`ocr_auto_params`) and
  re-applied automatically on reprocess.
- **Learning Recovery** (Settings) — inspect/clear the learned corpora (anchors,
  hints, corrections, logos) scoped by supplier/doc-type; memory inventory;
  `reset-all-learning` dev wipe.

### Field format cross-referencing (Stage 7) — partially shipped
`format_anomaly_checker.py` runs as **Stage 4.5** in `engine.py`. Compares each
field value against up to 3 sampled confirmed historical values for the strict
`(supplier_name, document_type, field_key)` group (min 3 distinct values, else
pass through). Infers a coarse format class; violations lower confidence, add a
`validation_note`, and force `needs_review`. Reuses the `formats_data` /
`--formats-file` pipeline.
- **Format classes**: `digits_only | upper_alphanum | alphanum | alphanum_sep |
  date_like | currency_like | freetext` (consensus disagreement → `freetext`).
- **Stage 1 (anomaly detection) — DONE**: migration 11 (`extractions.validation_note`),
  insert/reprocess paths carry the note, review renders it as amber mono text.
  Test suite: `tests/test_format_anomaly_checker.py`.
- **Stage 2 (correction candidates) — DONE**: `propose_correction()` (letter↔digit
  maps, separator stripping for `digits_only`) proposes a fix as a **candidate,
  not a rewrite** — `corrected_to` set, `was_corrected` stays False, review forced.
  Only when the fix passes the format check, ≤2 chars changed, ≤25% of length.
- **Stage 3 (persistent learned model) — DONE**: migration 15 adds the
  `field_format_rules` table (keyed `supplier_name, document_type, field_key`).
  `learning.updateFormatRules()` materialises rules from confirmed history on
  every confirm (via `confirm-review`); `getFieldFormatRules()` exports them
  through `--format-rules-file`; `engine.set_formats()` overlays them onto the
  inferred index via `format_anomaly_checker.merge_format_rules()` — persisted
  rule wins per key, absent keys fall back to per-run inference. Clearable on its
  own in Learning Recovery (`clear-learning-format-rules`) without touching
  anchors/hints/logos/templates/OCR-auto. `check_value`/`propose_correction`
  unchanged. Tests: `tests/test_format_rules_pipeline.py`,
  `database/modules/test_format_rules.js`.

---

## Fast Mode suggestion
After confirming a doc, call `check-fast-mode-suggestion(supplierName)`.
If returns non-null, show toast: "Switch to Fast Mode? You've confirmed N docs
from [supplier]. Fast Mode processes instantly without AI."
Buttons: "Switch to Fast Mode" → `set-processing-mode('fast')` | "Not now"

---

## Python invocation pattern
All Python scripts called with temp files for large data (avoids Windows
ENAMETOOLONG limit on CLI args):
```javascript
const file = path.join(os.tmpdir(), `ds_name_${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(data));
// pass --name-file file to Python
// cleanup in proc.on('close')
```

Python uses `py -3.12` in dev, `vendor/python/python.exe` when packaged.

---

## Dev workflow
```bash
cd "C:\GIT Projects\Docusnap"
npm start          # dev mode — uses system Python + Tesseract
npm run build      # electron-builder --win --x64 → dist\DocuSnap Setup 2.0.0-r<rev>.exe
```
`npm run build` sets `BUILD_REV` (default `local`) into the NSIS artifact name.
`postinstall` runs `electron-builder install-app-deps` to rebuild native addons
(better-sqlite3, argon2) against the current Electron ABI — required after an
Electron major bump (see recent `chore(deps)` commits).
Dev uses `py -3.12 script.py`, packaged uses bundled `vendor/python/python.exe`.
Tesseract hardcoded to `C:\Program Files\Tesseract-OCR\tesseract.exe` in dev.

Delete `%APPDATA%\DocuSnap\docusnap.db` to reset database during development.
Delete `python_backend/**/__pycache__` if Python changes don't take effect.
