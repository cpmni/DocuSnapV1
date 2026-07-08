# DocuSnap v2 — Module Reference

## Architecture Overview

```
docusnap/
├── src/
│   ├── main.js                     ← Electron entry point (thin router)
│   ├── preload.js                  ← IPC bridge (renderer ↔ main)
│   ├── modules/                    ← Business logic, one folder per domain
│   │   ├── processing/handler.js   ← Folder import, OCR, reprocess
│   │   ├── review/handler.js       ← Review queue, confirm, defer, delete
│   │   ├── filing/handler.js       ← Folder structure, rename, XML
│   │   ├── settings/handler.js     ← Doc types, fields, app settings
│   │   └── search/handler.js       ← Document search
│   └── windows/                    ← UI per window
│       ├── main/                   ← Main application window
│       ├── review/                 ← Review queue window
│       ├── settings/               ← Settings window
│       └── search/                 ← Search window
├── database/
│   ├── index.js                    ← Open DB, run migrations
│   ├── migrations/                 ← SQL migration files (numbered)
│   └── modules/                    ← DB operations per domain
│       ├── document_types.js       ← Doc types + field definitions
│       ├── documents.js            ← Document records + search
│       └── learning.js             ← Hints, anchors, logos, settings
├── python_backend/
│   ├── process_docs.py             ← Entry point (called by Electron)
│   ├── extraction/
│   │   ├── engine.py               ← Orchestrates all 4 stages
│   │   ├── keyword.py              ← Stage 1: pattern matching
│   │   ├── anchor.py               ← Stage 2: spatial anchors + logo
│   │   └── validator.py            ← Stage 4: cross-field validation
│   ├── ocr/
│   │   ├── tesseract.py            ← Page OCR + PDF rendering
│   │   └── region.py               ← Zone selection OCR
│   ├── logo/
│   │   └── fingerprint.py          ← Logo hash extraction + matching
│   └── render/
│       └── pages.py                ← PDF → base64 images for preview
└── config/
    └── keyword_patterns.json       ← Editable extraction pattern library
```

---

## Module Details

### `src/main.js` — Entry point
Thin router only. Creates windows, registers module handlers.
**Do not add business logic here.** Each module registers its own IPC handlers
via `module.register(ctx)`.

### `src/modules/processing/handler.js`
Handles: folder import, single-file reprocess, OCR region, logo operations.
Key IPC: `process-folder`, `reprocess-document`, `ocr-region`, `extract-logo-hash`.

### `src/modules/review/handler.js`
Handles: review queue queries, confirm, defer, restore, delete, document pages.
Key IPC: `get-review-queue`, `confirm-review`, `defer-document`, `delete-document`.

### `src/modules/filing/handler.js`
Handles: creating folder structure, renaming files, writing XML metadata.
Called internally by `review/handler.js` — no direct IPC.
Output structure: `OutputRoot/Company/Year/Month/DocType.Date.Ref.pdf`
Metadata: `OutputRoot/Company/Year/Month/.metadata/DocType.Date.Ref.xml`

### `src/modules/settings/handler.js`
Handles: document type CRUD, field CRUD, key-value app settings.
Key IPC: `get-document-types`, `add-document-type`, `add-field`, `set-setting`.

### `src/modules/search/handler.js`
Handles: full-text search across confirmed and uncommitted documents.
Key IPC: `search-documents`.

---

## Database Modules

### `database/modules/document_types.js`
CRUD for document types (Invoice, Sales Order, etc.) and their field definitions.
`seedBuiltInTypes()` runs on first launch to create defaults.

### `database/modules/documents.js`
CRUD for processed documents. Includes `search()` for the search window.
Status flow: `pending` → `needs_review` → `confirmed` (or `deferred`/`deleted`/`error`)

### `database/modules/learning.js`
All learning-related data:
- `insertExtractions()` — per-field values + confidence + method
- `saveCorrections()` — user corrections → `supplier_hints` table
- `saveAnchor()` — structural anchor positions
- `saveLogoFingerprint()` — perceptual hash for logo matching
- `getSetting() / setSetting()` — app key-value settings

---

## Python Extraction Pipeline

### Stage 1 — `extraction/keyword.py`
Rule-based pattern matching. Reads `config/keyword_patterns.json`.
Handles 60-70% of fields on well-structured documents.
Fast: typically < 100ms per document.

### Stage 2 — `extraction/anchor.py`
Learned spatial anchors. Uses saved `field_anchors` records to find values
by their position relative to known label text.
Also handles logo-based supplier identification.

### Stage 4 — `extraction/validator.py`
Cross-field validation:
- Date format normalisation → DD/MM/YYYY
- Subtotal + VAT ≈ Total check (flags mismatches)
- Date sanity check (not more than 10 years in past/future)
- Currency symbol → code inference (£ → GBP etc.)

---

## Adding a New Module

1. Create `src/modules/mymodule/handler.js` with a `register(ctx)` function
2. Add `require('./modules/mymodule/handler').register(ctx)` in `src/main.js`
3. Add any new IPC channels to `src/preload.js`
4. Add any new DB operations to `database/modules/`
5. If new tables needed, create `database/migrations/00N_description.sql`

---

## Adding a New Document Type

Via Settings UI: Settings → Document Types → Add Type

Or directly in `database/modules/document_types.js` → `BUILT_IN_TYPES` array.
Each type needs: `name`, `slug`, `ref_field_key`, `date_field_key`, `fields[]`.

---

## Adding Keyword Patterns

Edit `config/keyword_patterns.json`:
- `document_type_keywords` — phrases that identify a document type
- `field_patterns` — labels and directions for each field
- `validation_patterns` — regex patterns for field value validation

Changes take effect immediately on next document import (no rebuild needed).

---

## Stage Flow Summary

```
New document arrives
        │
        ▼
  OCR (Tesseract)
        │
        ▼
  Doc type detection (keyword scan of top quarter)
        │
        ▼
  Stage 1: Keyword extraction ──────────────────────── ~60-70% of fields
        │
        ▼
  Stage 2: Anchor matching (learned layouts) ────────── additional fields
        │
        ▼
  Stage 4: Validation (cross-field checks)
        │
        ├── Confidence OK? → Confirm automatically
        │
        └── Low confidence? → Review queue
                                    │
                                    ▼
                             User reviews + corrects
                                    │
                                    ▼
                             Corrections saved as hints + anchors
                             Logo fingerprint saved
                                    │
                                    ▼
                             File → OutputRoot/Company/Year/Month/
                             XML  → .metadata/ subfolder
```
