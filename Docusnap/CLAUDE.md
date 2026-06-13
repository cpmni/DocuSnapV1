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
| Desktop shell | Electron 31, Node.js, better-sqlite3 |
| UI | Vanilla HTML/CSS/JS, frameless windows |
| OCR | Tesseract 5 via pytesseract + pypdfium2 |
| AI extraction | phi3:mini via Ollama (dormant — `ai` mode not exposed in shipped UI; not bundled in installer) |
| Database | SQLite via better-sqlite3 |
| Platform | Windows only |

---

## Directory map
```
docusnap2/
├── src/
│   ├── main.js                          # IPC router — thin, delegates to modules
│   ├── preload.js                       # contextBridge API bridge
│   ├── modules/
│   │   ├── processing/handler.js        # folder import, reprocess, OCR region, logos
│   │   ├── processing/processing_mode_handler.js # mode get/set, fast-mode suggestion
│   │   ├── review/handler.js            # queue, confirm, defer, delete, pages
│   │   ├── filing/handler.js            # folder structure, rename, XML metadata
│   │   ├── settings/handler.js          # doc types, fields, key-value settings
│   │   ├── templates/handler.js         # Admin Template Viewer — browse/pin samples, anchor→target mapping CRUD
│   │   ├── search/handler.js            # document search
│   │   └── licensing/handler.js         # license gate decideAccess() + trial/activate/revoke/enforcement IPC (see Licensing)
│   ├── lib/license/{client.js,token.js,fingerprint.js}  # backend HTTP client · offline JWS verify · device fp_hash
│   └── windows/
│       ├── main/{index.html,renderer.js}      # incl. empty-state launchpad (Begin Import · Search · Settings)
│       ├── splash/{index.html,splash.js}      # cosmetic startup splash — shown in whenReady, closed once login loads
│       ├── review/{index.html,renderer.js}
│       ├── settings/{index.html,renderer.js}  # incl. Admin Template Viewer + License/Activation-Test tab
│       ├── search/index.html                  # placeholder
│       └── license/{index.html,renderer.js}   # activation/trial screen shown when the gate locks
├── database/
│   ├── index.js                         # open(), runMigrations(), runJsMigrations()
│   └── modules/
│       ├── document_types.js            # doc type + field CRUD, seedBuiltInTypes()
│       ├── documents.js                 # document CRUD, search(), getReviewQueue()
│       ├── learning.js                 # hints, anchors, logos, getSetting/setSetting
│       ├── templates.js                # template CRUD, field mappings, sample-document linkage
│       └── licensing.js                # client license_tokens cache (cacheToken/getActiveToken/clearSeatToken)
├── python_backend/
│   ├── process_docs.py                  # CLI entry point, streams JSON to stdout
│   ├── extraction/
│   │   ├── engine.py                    # ExtractionEngine — staged pipeline orchestration (see Extraction pipeline below)
│   │   ├── template_matcher.py          # Stage 0: learned-template identification + field seeding
│   │   ├── template_mapper.py           # Stage 0.5: admin-drawn anchor→target zone mapping extraction
│   │   ├── keyword.py                   # Stage 1: regex pattern matching
│   │   ├── anchor.py                    # Stage 2: spatial anchors + logo match
│   │   ├── ocr_corrector.py             # Stage 2.5: learned OCR misread correction
│   │   ├── llm.py                       # Stage 3: phi3:mini via Ollama (dormant — 'ai' mode not exposed in UI)
│   │   └── validator.py                 # Stage 4: cross-field validation
│   ├── ocr/{tesseract.py,region.py}
│   ├── logo/fingerprint.py
│   └── render/pages.py                 # PDF→PNG rendering — shared by review/search/template preview (see Gotchas)
├── config/keyword_patterns.json        # editable pattern library
├── config/license.json                 # client license config: base_url, product_id, public_keys (PUBLIC keys only)
└── licensing-backend/                   # separate PHP 8 + MySQL activation server (WAMP/IONOS); see Licensing
    ├── public/{index.php, v1/*.php, admin/*}  # health · /v1 trial_start|activate|validate|revoke|status · admin web page
    ├── lib/{db.php, jws.php, admin_auth.php}   # PDO+JSON helpers · Ed25519 signing · admin gate+CSRF+bright chrome
    └── schema.sql · keys/ (gitignored seeds + admin_password.hash) · scripts/{Configure,Verify}-WampBackend*.ps1
```

---

## Database tables
```
document_types  — name, slug, built_in, ref_field_key, date_field_key
fields          — document_type_id(FK), key, label, type, required, built_in
documents       — document_type_id(FK), original_filename, stored_filename,
                  stored_path, folder_path, status, overall_confidence,
                  supplier_name, doc_date, reference_number
                  STATUS: pending|needs_review|deferred|confirmed|deleted|error
extractions     — document_id(FK), field_key, raw_value, display_value,
                  confidence, was_corrected, corrected_to, extraction_method
corrections     — document_id(FK), field_key, original_value, corrected_value,
                  supplier_name, document_type
supplier_hints  — supplier_name, document_type, field_key, hint_value, usage_count
field_anchors   — supplier_name, document_type, field_key, anchor_label,
                  direction(right|below|above), page_zone, x_norm, y_norm,
                  usage_count, confidence
logo_fingerprints — supplier_name, phash, ahash, match_count
settings        — key, value (key-value store)
migrations      — version, applied_at
license_tokens  — kind(seat|trial), subject, token_blob(JWS), state, not_after,   ← migration 16
                  grace_until, kid  (client cache of the signed token; deletable)
device_registrations — fp_hash, product_id  (local mirror; backend is source of truth)
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
             GROUP-SHARED MAPPINGS: when the matched template has NO enabled
             mappings of its own but belongs to a group, it BORROWS enabled
             field_mappings from a grouped sibling that has them
             (engine.select_mapping_source; borrowed anchors are still
             re-validated on this page). Template groups are otherwise
             organisational only.
  Stage 1: keyword.py    — regex patterns from keyword_patterns.json (~60-70% fields)
  Stage 2: anchor.py     — learned label positions + logo supplier ID
  Stage 3: llm.py        — phi3:mini, ONLY for missing fields (smart/ai mode)
  Stage 4: validator.py  — date normalise/salvage, currency infer, maths cross-check
  Stage 4.5: format_anomaly_checker.py — coarse-class + learned-shape consistency
             vs confirmed history; engine then weights _overall_confidence by
             cross-field format consistency (see Stage 7)
```

**Three modes** (stored in settings as `processing_mode`):
- `fast`  — stages 1+2 only, sub-second, any hardware
- `smart` — stages 1+2, then 3 only if invoice_number/invoice_date/total_amount
             missing or below 70% confidence. DEFAULT.
- `ai`    — stages 1+2+3 always

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

**Template identity is stabilised on confirm, not overwritten**: confirming a
document MERGES its fingerprint into the template's stored identity instead of
replacing it (`templates.stabiliseFingerprint`/`chooseLogoPhash`). The keyword
fingerprint becomes the INTERSECTION of recurring tokens across confirmed
samples (with a floor so one noisy sample can't erase a known-good identity);
an already-established `logo_phash` is kept rather than reclobbered each confirm.
Prevents one garbled scan from poisoning Stage 0 matching for a whole supplier.

**Validator date rules (Stage 4)**: dates normalise to DD-MM-YYYY; a valid date
embedded in OCR junk is salvaged (`salvage_date`, review-forced). The date
sanity check is FUTURE-ONLY — old archival dates are expected and never flagged;
only dates clearly in the future (> ~1 year) are anomalous.

**Document confidence is format-weighted (Stage 4.5)**: after the per-field
average, `validator.format_consistency_delta` adjusts `_overall_confidence` —
penalise any field that failed its format check; boost only when several
WELL-SUPPORTED fields all match (conservative — sparse/unverified docs get no
boost). Adjusts the displayed score only; per-field notes and needs_review are
unaffected.

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
- Filename: `DocType.DD-MM-YYYY.RefNo.pdf`
- Duplicate: append `-DUPLICATE` (then `-DUPLICATE-2` etc)
- Output root stored in settings table as `output_folder`

---

## Default document types
| Type | slug | ref_field_key | date_field_key |
|---|---|---|---|
| Invoice | invoice | invoice_number | invoice_date |
| Sales Order | sales_order | sales_order_number | order_date |
| Purchase Order | purchase_order | po_number | po_date |

---

## Licensing & activation
Optional license gate: trial + paid-seat, all device-bound. **OFF in dev, ON by default in
packaged builds.** The MAIN process is the sole decider — the renderer can only REQUEST
entry (`license-enter-app`), never self-grant.

**Flow**: login → `enterMainApp()` (main.js) → `licensingModule.decideAccess()` → `allow`
opens the main shell, otherwise the **license window** (`src/windows/license` — Start/Resume
Trial · Enter key + Activate · Release · Check again). Enforcement only changes what
`decideAccess` returns; when off it always returns `allow` (unchanged launch behaviour).

**Enforcement resolution** — `enforcementActive(db)` in `src/modules/licensing/handler.js`:
1. env `DOCUSNAP_LICENSE_ENFORCEMENT` (on/off) — dev/recovery escape hatch, **wins**;
2. setting `license_enforcement_enabled` ('true'/'false') — admin toggle (Settings → Activation);
3. unset → `_ctx.app.isPackaged` (installed build enforces, dev stays off).
A valid cached trial/seat token always passes the gate, so legit users open normally.

**decideAccess specifics**: best-effort online `validate()` (short timeout) refreshes the
cached token; a REACHABLE backend returning no grant **clears** the stale seat token, so a
server-side release/revoke locks on the next online check; OFFLINE falls back to the cached
token within its 7-day grace. Clock-rollback defended by a monotonic high-water mark
(`license_time_hwm` in settings). Tokens verified OFFLINE in `src/lib/license/token.js`
against pinned public keys: alg must be EdDSA, kid pinned, signature, then product/fp/
expiry/grace/state. Fingerprint = SHA-256(product_id | Windows MachineGuid)
(`src/lib/license/fingerprint.js`) — raw value never leaves main, never sent.
⚠ Non-sysprep'd VM **clones share MachineGuid** → same fp_hash.

**config/license.json**: `base_url` (per-environment — change for WAMP→prod, no code
change), `product_id`, `public_keys` (PUBLIC only). Bundled via extraResources → **rebuild
the installer after editing it**.

**Backend** `licensing-backend/` (PHP+MySQL): `/v1/{trial/start,activate,validate,revoke,
status}`. account_key stored only as SHA-256; tokens signed with the Ed25519 seed in `keys/`
(outside docroot). Admin web page `public/admin/` — session + CSRF, single bcrypt password
in `keys/admin_password.hash`, BRIGHT-ONLY theme — manages products/accounts/entitlements/
seats and issues **temporary licenses** (= an entitlement with `expires_at`; one-time key
shown once). Deploy/verify via `scripts/Configure-WampBackend.ps1` / `Verify-WampBackend-Ready.ps1`
(the Configure script now fails loudly on mysql errors).

**Tests** (Electron-as-Node): `database/modules/test_license_*.js`. Gate tests **stub
`ctx.licenseTransport`** to stay hermetic (no real backend) — do the same for any new one.

**Secrets**: never log/echo account or activation keys; never re-display a one-time key
after issuance; never expose `account_key_hash` or the raw fingerprint.

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

### Renderer → Main (invoke — returns promise)
```
pick-folder, pick-output-folder, process-folder(folderPath)
get-document-types, get-all-doc-types
add-document-type(data), update-document-type(id,changes)
add-field(data), update-field(id,changes), delete-field(id)
get-review-queue, get-deferred-queue, get-review-count, get-deferred-count
get-document-with-extractions(id), get-document-pages(id,folderPath,filename)
confirm-review(payload), defer-document(id), restore-deferred(id)
delete-document(id,filePath), reprocess-document({docId,folderPath,filename})
ocr-region(base64), save-field-anchor(data)
extract-logo-hash(base64), match-logo-hash(base64), save-logo-fingerprint(data)
search-documents(params)
get-setting(key), set-setting(key,value)
get-ai-status, get-processing-mode, set-processing-mode(mode)
pull-ai-model, check-fast-mode-suggestion(supplierName)
license-get-status, license-start-trial, license-activate(data), license-revoke(data)
license-test-activate(data)            # admin local test — never mutates real state
license-get-enforcement, license-set-enforcement(on)   # admin-gated; Settings → Activation
```

### Renderer → Main (send — fire and forget)
```
window-minimise, window-maximise, window-close
show-in-explorer(path), open-file(path)
open-review-window, open-settings-window, open-search-window
notify-review-complete
license-enter-app                      # REQUEST entry; main re-decides via decideAccess
```

### Main → Renderer (events)
```
review-count-changed(n), deferred-count-changed(n)
processing-mode-changed(mode)
pull-progress({status,completed,total})
reprocess-progress(msg), process-progress(msg)
license-state(gate)                    # pushed to the license window with the blocked-state reason
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

## Known bugs (fix these first)

### BUG 1+2 — `str object has no attribute get`
**File**: `python_backend/process_docs.py`
**Cause**: engine.extract() returns _ prefixed metadata as plain strings mixed
with field dicts. After popping _ keys, some may remain or validator iterates them.
**Fix**: Add and call `sanitise_extractions()` after all _ keys are popped:
```python
def sanitise_extractions(raw: dict) -> dict:
    clean = {}
    for key, data in raw.items():
        if key.startswith('_'):
            continue
        if isinstance(data, dict):
            clean[key] = data
        elif data is not None:
            clean[key] = {"value": str(data), "confidence": 50, "method": "unknown"}
        else:
            clean[key] = {"value": None, "confidence": 0, "method": "unknown"}
    return clean
```
Also update `validator.py` `validate_and_adjust()` to skip _ keys and
normalise non-dict values as defensive belt-and-braces.

### BUG 3 — Regex `bad character range /-\.`
**File**: `config/keyword_patterns.json`
**Fix**: In `validation_patterns.date`, change `[/-\.]` to `[/\-.]`

---

## Features to build (in order)

### STAGE 2 — Settings window rebuild
**File**: `src/windows/settings/index.html` + `renderer.js`
Three tabs: General | Document Types | Fields

**General tab**:
- Output folder: text display + Browse button → `pick-output-folder` IPC
- Processing mode: Fast/Smart radio buttons → `set-processing-mode`
  (AI mode and Ollama model-download UI were removed — not shipped)
- Global confidence threshold slider

**Document Types tab**:
- List all types from `get-all-doc-types`
- Toggle enable/disable per type
- Add custom type button
- Click type → opens Fields sub-panel
- Per type: set ref field key, date field key (dropdowns of that type's fields)

**Fields sub-panel** (within Document Types tab):
- Shows fields for selected doc type
- Add field: label, key (auto from label), type dropdown, required toggle
- Edit: threshold slider per field
- Delete custom fields only (built-in fields show lock icon)
- Reorder via up/down buttons

### STAGE 5 — Review window rebuild
**File**: `src/windows/review/index.html` + `renderer.js`

**Tabbed layout**:
```
[Review Queue (4)]  [Deferred (2)]
```
Tab badges update via `review-count-changed` and `deferred-count-changed` events.

**Review Queue tab** (existing layout, these additions):
- Document Type dropdown at top of fields panel
  - Populated from `get-document-types`
  - Auto-filled from extraction, user can change
  - Changing type reloads field list for that type
- Required fields highlighted red if empty (type, date, ref)
- Confirm button disabled until type + date + ref all filled
- Delete button with confirmation dialog → `delete-document(id, filePath)`

**Deferred tab**:
- List of deferred docs: filename, date deferred, supplier if known
- Per item: [Review Now] [Delete]
- Review Now: `restore-deferred(id)` → switch to Review Queue tab → load that doc

**Built additions (durable)**:
- Single confirm is factored into `confirmCurrentDoc({bulk})`, shared by the
  Confirm button and a **"File All Ready"** queue-footer action that bulk-files
  every queue doc whose Confirm would be enabled (type + required filled);
  not-ready / digit-mismatch docs are skipped for manual review. No backend
  bulk endpoint — it reuses the per-doc `confirm-review` path.
- The up/down rail beside the queue list **cycles the selected document**
  (prev/next within the active Review/Deferred list via `selectDoc`, clamped at
  ends), not viewport scrolling.

### STAGE 6 — Search window
**File**: `src/windows/search/index.html` + `renderer.js`

```
[Company] [Reference] [From Date] [To Date] [Type ▼]  [Search]
─────────────────────────────────────────────────────────────────
Results (left pane)              │  Preview (right pane)
─────────────────────────────────│─────────────────────────────
CONFIRMED (12)                   │  [document image]
  Acme Supplies                  │
  Invoice.01-12-2025.INV-001     │  Company: Acme Supplies Ltd
  £1,250.00  [Invoice]           │  Ref: INV-001
                                 │  Date: 01-12-2025
UNCOMMITTED (2)                  │  Total: £1,250.00
  scan001.pdf — Needs Review     │
                                 │  [Open in Explorer] [Open File]
                                 │  [Edit in Review]
```
- Live search with 300ms debounce
- `search-documents({company,reference,dateFrom,dateTo,docType,includeUncommitted:true})`
- Uncommitted items open inline commit panel (mini review)
- Edit in Review: opens review window with doc pre-loaded

### STAGE 7 — Field format cross-referencing
**Files**: `python_backend/extraction/format_anomaly_checker.py` (new),
`python_backend/extraction/engine.py`, `database/modules/learning.js`,
`database/index.js` (migration 11 — `extractions.validation_note`, landed Stage 1;
Stage 3 will need migration 12 for `field_format_rules`)

During processing, compare each extracted field value against up to 3 sampled
confirmed historical values for the same `(supplier_name, document_type, field_key)`
group. Infer a coarse format class from history; if the new value violates it, lower
confidence, add a `validation_note`, and force `needs_review`. Conservative correction
candidates are proposed in Stage 2 but never silently applied — always review-forced.

**Format classes** (inferred from sample consensus — disagreement → `freetext`, no constraint):
`digits_only` | `upper_alphanum` | `alphanum` | `alphanum_sep` | `date_like` | `currency_like` | `freetext`

**Shape consistency (within-class, added)** — beyond the coarse class, a learned
per-`(supplier,doctype,field)` SHAPE signature (digit/letter group lengths +
separator positions, `shape_signature`) is compared to the value: a structurally
wrong but in-class value (e.g. an extra digit group, a missing/extra separator)
is flagged low-severity. Learned only when the WHOLE recent pool shares one shape
(keeps false positives low; shape-varying history → no shape constraint).

**Scoping rules** — strict `(supplier_name, document_type, field_key)`; minimum 3 distinct
confirmed values required; if history is absent or thin, pass through unchanged.

**Data source** — reuses existing `formats_data` / `--formats-file` pipeline already
loaded by the processing handler. No new IPC or Python arg until Stage 3.

**Stage 1 — COMPLETE**
- `format_anomaly_checker.py` (Stage 4.5 in `engine.py`), `getFieldFormats()` recency ordering,
  migration 11 (`extractions.validation_note TEXT`), `insertExtractions` updated,
  both insert paths in `handler.js` carry `validation_note`, reprocess merge restores note
  alongside restored value, review `appendFieldRow` renders note as amber mono text
- 37-test suite passes (`python_backend/tests/test_format_anomaly_checker.py`)
- Polish deferred (non-blocking): user-facing wording for `validation_note` strings;
  define how Stage 2 correction candidates share/extend the same note area

**Stage 2 (conservative correction candidates)**
- `propose_correction()` applies LETTER_TO_DIGIT / DIGIT_TO_UPPER maps and removes
  unexpected separators from `digits_only` fields only when evidence is strong
- Correction is a **candidate, not a rewrite**: `display_value` unchanged, `corrected_to`
  holds the proposed fix, `was_corrected` stays `False`, `needs_review` forced
- `validation_note`: `"format anomaly: correction candidate — {corrected_to}"`
- Correction only proposed when corrected form passes format check AND ≤2 chars changed
  AND ≤25% of value length affected

**Stage 3 (persistent learned format model — migration 12)**
- New `field_format_rules` table: `(supplier_name, document_type, field_key)` → `format_class`,
  `allowed_separators`, `confirmed_count`, `last_updated`
- Written by `learning.js` inside `saveCorrections()` transaction on every confirm
- Read by Python via new `--format-rules-file` arg; overrides inferred class once
  `confirmed_count ≥ 10` (bootstrapping grace period below that threshold)
- Confirming a value that expands the character class updates `format_class` in-place

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
cd C:\docusnap2
npm start          # dev mode — uses system Python + Tesseract; licensing enforcement OFF
npm run build      # → dist\DocuSnap Setup <ver>-r<BUILD_REV>.exe  (BUILD_REV defaults 'local')
```
Dev uses `py -3.12 script.py`, packaged uses bundled Python venv.
Tesseract hardcoded to `C:\Program Files\Tesseract-OCR\tesseract.exe` in dev.

**Build notes**: electron-builder **v26** (the old `win.sign` / `win.signingHashAlgorithms`
keys are removed — don't re-add them). `postinstall` runs `install-app-deps`; native deps
(`argon2`, `better-sqlite3`) are auto-rebuilt for the Electron ABI during build. Installer is
**unsigned** → SmartScreen "More info → Run anyway" on the VM. Run gate tests with
Electron-as-Node, not plain node (native-module ABI).

Delete `%APPDATA%\DocuSnap\docusnap.db` to reset DB during development (also clears users,
cached license tokens, and the enforcement setting).
Delete `python_backend/**/__pycache__` if Python changes don't take effect.
Packaged build remembers prior login/trial because that DB persists across reinstalls
(NSIS `deleteAppDataOnUninstall:false`). To force the activation gate in dev: launch with
`DOCUSNAP_LICENSE_ENFORCEMENT=on`; to bypass it: `=off`.
