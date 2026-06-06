# DocuSnap v2 — Project Memory for Claude Code

> Read this file before every response. Do not summarise it back to the user.
> Read only the specific source files needed for the current task.

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
| AI extraction | Ollama + phi3:mini (optional, on-demand) |
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
│   │   ├── processing/ollama_handler.js # AI status, mode switching, model pull
│   │   ├── review/handler.js            # queue, confirm, defer, delete, pages
│   │   ├── filing/handler.js            # folder structure, rename, XML metadata
│   │   ├── settings/handler.js          # doc types, fields, key-value settings
│   │   └── search/handler.js            # document search
│   └── windows/
│       ├── main/{index.html,renderer.js}
│       ├── review/{index.html,renderer.js}
│       ├── settings/{index.html,renderer.js}  # needs rebuild
│       └── search/index.html                  # placeholder
├── database/
│   ├── index.js                         # open(), runMigrations(), runJsMigrations()
│   └── modules/
│       ├── document_types.js            # doc type + field CRUD, seedBuiltInTypes()
│       ├── documents.js                 # document CRUD, search(), getReviewQueue()
│       └── learning.js                 # hints, anchors, logos, getSetting/setSetting
├── python_backend/
│   ├── process_docs.py                  # CLI entry point, streams JSON to stdout
│   ├── ollama_manager.py                # status check + model pull streaming
│   ├── extraction/
│   │   ├── engine.py                    # ExtractionEngine class, 4-stage pipeline
│   │   ├── keyword.py                   # Stage 1: regex pattern matching
│   │   ├── anchor.py                    # Stage 2: spatial anchors + logo match
│   │   ├── llm.py                       # Stage 3: phi3:mini via Ollama
│   │   └── validator.py                 # Stage 4: cross-field validation
│   ├── ocr/{tesseract.py,region.py}
│   ├── logo/fingerprint.py
│   └── render/pages.py
└── config/keyword_patterns.json        # editable pattern library
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
```

---

## Extraction pipeline
```
process_docs.py → ExtractionEngine.extract()
  Stage 1: keyword.py    — regex patterns from keyword_patterns.json (~60-70% fields)
  Stage 2: anchor.py     — learned label positions + logo supplier ID
  Stage 3: llm.py        — phi3:mini, ONLY for missing fields (smart/ai mode)
  Stage 4: validator.py  — date normalise, currency infer, maths cross-check
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
```

### Renderer → Main (send — fire and forget)
```
window-minimise, window-maximise, window-close
show-in-explorer(path), open-file(path)
open-review-window, open-settings-window, open-search-window
notify-review-complete
```

### Main → Renderer (events)
```
review-count-changed(n), deferred-count-changed(n)
processing-mode-changed(mode)
pull-progress({status,completed,total})
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
- Processing mode: Fast/Smart/AI radio buttons → `set-processing-mode`
- AI status indicator: shows if Ollama running + model available
- Download AI Model button (only shown if not available) → `pull-ai-model`
  with progress bar during download
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

Python uses `py -3.12` in dev, `vendor/python/Scripts/python.exe` when packaged.

---

## Dev workflow
```bash
cd C:\docusnap2
npm start          # dev mode — uses system Python + Tesseract
npm run build      # produces dist\DocuSnap Setup 2.0.0.exe
```
Dev uses `py -3.12 script.py`, packaged uses bundled Python venv.
Tesseract hardcoded to `C:\Program Files\Tesseract-OCR\tesseract.exe` in dev.

Delete `%APPDATA%\DocuSnap\docusnap.db` to reset database during development.
Delete `python_backend/**/__pycache__` if Python changes don't take effect.
