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

## Subagents & skills (advisors the user invokes by name)
Defined in `.claude/agents/*.md`; invoked via the Agent tool. All three are
ADVISORY — they diagnose/recommend and DO NOT implement unless explicitly asked.
Implementation stays with main Claude Code. Brief them with full context (a fresh
spawn starts cold) and relay their findings to the user.
- **bob** (`agents/bob.md`) — senior software & product advisor. Receives a
  report/diagnostic/plan, translates to plain English, splits fact vs assumption,
  flags risks, gives ranked options + a recommendation. Use after producing a
  report when the user wants options before implementation.
- **gary** — Python engineering analyst (root-cause analysis, testable fix design,
  test strategy). Not a defined agent file; spun up as a general-purpose agent and
  named by the user. Briefed to use the Python skills below. (Validated the
  absolute-target-first root cause for the worksheet date/name failures.)
- **oscar** (`agents/oscar.md`) — OCR expert: efficient OCR pipelines
  (preprocessing, Tesseract PSM/OEM/lang, per-field crop recipes, confidence,
  tables/searchable-PDF, accuracy-vs-throughput). HARD RULE: only recommends
  open-source tools that are free for commercial use, and states the licence —
  e.g. flags PyMuPDF (AGPL) and steers to pypdfium2, which this project uses.

**Skills** in `.claude/skills/`: a set of Python engineering skills
(`testing-strategy`, `code-quality`, `performance`, `api-design`, `packaging`,
`security-audit`, etc. — gary's toolkit) and `ocr-document-processor` (oscar's
OCR knowledge pack: SKILL.md + scripts; note its requirements.txt lists PyMuPDF —
use pypdfium2 here instead). `scan-finder-frontend-design` covers the website/UI.

---

## What this is
Windows desktop app (ships as **Scan Finder** / `ScanFinder.exe`; internal
identifiers, DB `docusnap.db` and `%APPDATA%\DocuSnap` remain "DocuSnap"):
scans documents → OCR → extracts fields → files them intelligently.
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
│       ├── main/{index.html,renderer.js}      # incl. empty-state launchpad (Begin Import · Search · Settings · Teach a document)
│       ├── splash/{index.html,splash.js}      # cosmetic startup splash — shown in whenReady, closed once login loads
│       ├── review/{index.html,renderer.js}    # incl. zoom/pan preview + hidden admin Template Wizard (⚓): draw anchor/target → save via existing template-mapping IPC
│       ├── teach/{index.html,renderer.js}      # guided "Teach a new document" wizard (non-technical) — see Teaching wizard
│       ├── settings/{index.html,renderer.js}  # incl. Admin Template Viewer + License/Activation-Test tab
│       ├── search/index.html                  # placeholder
│       ├── dev-inspector/{index.html,renderer.js}  # hidden read-only processing inspector (Ctrl+Shift+D+M, pw SFDEV) — see Dev inspector
│       ├── onboarding/{index.html,renderer.js} # first-run setup wizard — see First-run wizard
│       └── license/{index.html,renderer.js}   # activation/trial screen shown when the gate locks
│   (createWindow opens every panel HIDDEN and reveals on ready-to-show — no
│    empty-background "black box" flash; startup/login flow passes show:false and
│    reveals manually, so it's untouched)
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
│   │   ├── template_matcher.py          # Stage 0: learned-template identification + field seeding (same-logo siblings disambiguated by keyword fingerprint)
│   │   ├── template_mapper.py           # Stage 0.5: admin-drawn anchor→target zone mapping; absolute-first read, then registration transform, then single-label refinement
│   │   ├── registration.py              # "register, then read": NumPy similarity/affine RANSAC fit (taught landmarks→page) + confidence; no OpenCV
│   │   ├── keyword.py                   # Stage 1: regex pattern matching (incl. job_no 4-4-1 shape, separator-normalised)
│   │   ├── anchor.py                    # Stage 2: spatial anchors + logo match
│   │   ├── ocr_corrector.py             # Stage 2.5: learned OCR misread correction
│   │   ├── llm.py                       # Stage 3: phi3:mini via Ollama (dormant — 'ai' mode not exposed in UI)
│   │   └── validator.py                 # Stage 4: cross-field validation
│   ├── ocr/{tesseract.py,region.py,landmarks.py,text_enhance.py,born_digital.py}  # landmarks.py: derive registration landmarks from sample page; text_enhance.py: degraded text-line re-read (denoise+Sauvola+unsharp), text-only gate-triggered escalation; born_digital.py: read EXACT text + word boxes from a PDF's embedded text layer (pypdfium2 BSD), skipping OCR for generated PDFs (gated by born_digital_enabled)
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
                  supplier_name, doc_date, reference_number,
                  working_path  ← migration 17: app-managed import copy in
                  userData/inbox/<docId><ext>; preferred by preview/reprocess/
                  confirm so they don't depend on the source folder surviving
                  STATUS: pending|needs_review|deferred|confirmed|deleted|error
extractions     — document_id(FK), field_key, raw_value, display_value,
                  confidence, was_corrected, corrected_to, extraction_method
corrections     — document_id(FK), field_key, original_value, corrected_value,
                  supplier_name, document_type
supplier_hints  — supplier_name, document_type, field_key, hint_value, usage_count
field_anchors   — supplier_name, document_type, field_key, anchor_label,
                  direction(right|below|above), page_zone, x_norm, y_norm,
                  w_norm, h_norm, usage_count, confidence,
                  last_authoritative_at  ← migration 20: set on an EXPLICIT ⊕
                  re-teach. saveAnchor's authoritative branch TRUSTS the drawn
                  box outright (no tolerance/blend) and makes it the SINGLE
                  anchor for (field_key, document_type) by sweeping every other
                  row for that field+doctype ACROSS ALL SUPPLIERS — the doc-type
                  is the layout; a teach corrects the field for that layout, not
                  for one resolved supplier. anchor._filter_anchors then puts
                  authoritative anchors in their OWN bucket ahead of all passive
                  ones BEFORE supplier-priority, so an explicit teach can never
                  lose to a stale auto-learned anchor that merely happens to be
                  tagged to the supplier the template/logo resolved (the bug that
                  made re-teaching look broken); among teaches the most recent
                  wins. Passive auto-learn (no flag) still usage-weight-blends,
                  but with PER-AXIS tolerance (h sets the vertical threshold, not
                  max(w,h)) so a one-line correction isn't mistaken for jitter.
                  offset_dx_norm/offset_dy_norm  ← migration 21: drift-invariant
                  label→value vector captured on the ⊕ teach (see Stage 2 note).
                  NOTE: supplier_name is a LEARNING SCOPE key (resolved via
                  logo/template/optional field), never a required document field.
logo_fingerprints — supplier_name, phash, ahash, match_count
template_landmarks — template_id(FK cascade), label_text, x/y/w/h_norm, ocr_conf,  ← migration 22
                  page_number. 3-5 stable/unique/well-spread words auto-derived
                  from a template's sample page (ocr/landmarks.py); RE-located on
                  each incoming page to fit the Stage 0.5 registration transform
                  (registration.py). Additive/inert — a template with no rows uses
                  the existing anchor/offset path unchanged.
settings        — key, value (key-value store; incl. registration_enabled —
                  default ON, gates the Stage 0.5 registration rung;
                  born_digital_enabled — default ON, gates PDF text-layer extraction;
                  first_run_completed — 'true' once the setup wizard finishes/skips
                  (migration 24 stamps it for already-configured installs so existing
                  users are never re-onboarded))
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
             SAME-LOGO DISAMBIGUATION (identify_template): the logo identifies the
             SUPPLIER, not the doc type — a supplier that sends several layouts
             under ONE letterhead has several templates with near-identical logos.
             identify_template no longer returns on the first logo hit; it gathers
             ALL close logo candidates and, when >1 fall in the same-logo cluster,
             picks the one whose KEYWORD FINGERPRINT matches the page (what tells a
             "Purchase Order" from a "Service Worksheet"). A lone candidate keeps
             the fast logo short-circuit. The winner carries its own slug.
             DOC-TYPE SLUG RESOLUTION (the format/qualification gates key on
             document_slug; a null slug silently DISABLES them → wrong-row crops
             commit and drift relocation never fires). Sources, in precedence:
             (a) REPROCESS passes the document's already-assigned doc-type slug
             (handler --known-doc-slug → process_docs uses it over re-detection,
             which fails on a clipped scan) — ALWAYS WINS; (b) FRESH SCAN:
             process_docs adopts a confidently-MATCHED TEMPLATE's doc type + FIELD
             SET over weak keyword name-detection (the template is the stronger
             type signal), so slug, fields and the doc-type-scoped anchors all
             agree; (c) when a template matches and the caller still resolved no
             slug, engine.extract adopts matched_tmpl.document_type_slug.
             ALSO FIXED: build_format_class_index
             (format_anomaly_checker) used to drop every EMPTY-SUPPLIER entry, so
             the document-agnostic doc-type-scoped groups getFieldFormats emits
             ('', slug, field) never entered the index — the gate was effectively
             OFF for supplier-independent setups (only visible on a drifted crop,
             since a clean crop reads the right value anyway). Now it requires only
             doc_type + field_key; supplier may be empty.
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
             ABSOLUTE-TARGET-FIRST (template_mapper._extract_one): the EXACT drawn
             target box is read FIRST — the same region the Template Wizard's live
             zone-OCR (region.py) read at teach time — and only if that read fails
             the gates does it relocate. Previously a located anchor ALWAYS
             re-derived the crop from located-label + offset (with an estimated
             inset), so the drawn box was never read on a clean page; an imprecise
             tight-bbox for a short/generic label (e.g. "Ticket Logged") slid the
             derived crop off the value → "Not found"/garbage even with no drift,
             while live "targeted selection" of the same box always read clean.
             Now first-instance extraction MATCHES targeted selection. The
             offset/inset arithmetic stays ONLY in the relocation fallback, so the
             "PROFILE"→"ROFILE" leading-inset clip cannot reappear. Mirrors Stage
             2's rigid-crop-then-relocate model; same accepted trade-off (a
             heavily-drifted page could read a wrong-but-credible value before
             relocating — guarded by the same credibility+format gates).
             REGISTRATION RUNG ("register, then read", registration.py): the rung
             BETWEEN the absolute fast-path and the single-label refinement. When
             the matched template carries taught LANDMARKS (template_landmarks,
             migration 22 — auto-derived from the sample page by ocr/landmarks.py,
             3-5 stable/unique/well-spread words; captured on sample-pin and
             backfilled for existing templates), they are RE-located on this page
             and a robust similarity/affine transform is fitted ONCE per page
             (registration.fit_transform — NumPy + RANSAC, NO OpenCV) mapping the
             taught frame onto the incoming page. Each taught target box is mapped
             THROUGH the transform, so a shifted/skewed/SCALED scan still finds the
             value regardless of registration — the headline capability. Gated by
             the registration_enabled setting (default ON; INERT without landmarks,
             so templates without them behave exactly as before); a too-few/poor
             fit (RANSAC inliers/residual) falls through. Confidence comes from the
             fit quality (registration.registration_confidence). Method tier
             template_registration[_expanded][_salvaged]; engine protects these via
             _STAGE05_LOCATED_METHODS. This REPLACED the old translation-only
             consensus-drift fallback: page_geometry.py (content-free page-corner
             "landmarks"), _consensus_drift and _drift_fallback were REMOVED — a
             real content-landmark transform strictly supersedes a corner prior +
             translation guess. SHARED GATE (_gate_value): one helper applied by
             the absolute path, the registration rung AND the single-label path —
             order = date-salvage (C1) → _crop_is_credible → _format_rejects.
             DATE SALVAGE (C1): when a
             date crop FAILS the strict date credibility pattern (OCR spacing
             around separators, or a date wrapped in junk), it is rescued/
             normalised via validator.salvage_date (the same recovery Stage 4 uses)
             instead of being dropped; salvaged dates are capped at conf 70 and
             tagged method "..._salvaged". A clean date passes untouched at full
             confidence. Salvage handles spacing/embedded-junk, NOT glyph misreads
             (a year OCR'd "202G" still falls to review). engine.py protects the
             located salvaged methods via _STAGE05_LOCATED_METHODS.
  Stage 1: keyword.py    — regex patterns from keyword_patterns.json (~60-70% fields)
  Stage 2: anchor.py     — learned label positions + logo supplier ID
           DOC-TYPE SCOPING (_anchor_matches): a learned anchor is keyed
           (supplier, document_type, field_key). It used to fire on SUPPLIER match
           ALONE — so a supplier that sends several doc types had its
           purchase_order anchors (po_number/po_date) and invoice anchors fire on
           its worksheets too (a Frankenstein field set, which made doc-type
           autodetection look broken). Now a TYPED anchor may NOT cross into a
           DIFFERENT known doc type, even for the same supplier (the doc type is
           the layout). Only enforced when BOTH types are known; if detection
           couldn't resolve the doc type, the broad supplier fallback is unchanged.
           DEGRADED TEXT-LINE ESCALATION (ocr/text_enhance.py): for text/multiline
           fields only, when a crop read FAILS the credibility/format gate the SAME
           crop is re-read with a heavier recipe (denoise + Sauvola adaptive
           threshold + mild unsharp, taller pad) and committed only if it then
           passes — recovers a degraded company-name line ("Beaumont Care Homes" →
           "pe fomes") the noise-amplifying base recipe mangled. Gate-triggered, so
           numerics/clean reads/the wizard+label paths are byte-identical. Dev-only
           anchor_reject trace records what each rung READ + which gate dropped it.
           CROP OCR RECIPE: anchor._crop_and_ocr now uses the SAME recipe as the
           ⊕ target-draw tool (region.py) and Stage 0.5 (template_mapper._prep):
           greyscale→upscale→autocontrast→sharpen + PSM 7 (was a plain 2× resize
           + PSM-6-only read, which was lower quality and inserted spurious
           separators — a serial "H7R5326676" committed as "H/7R5326676" even
           though the identical crop read clean via the target tool). PLUS
           _repair_single_token: when a SINGLE-token value (no spaces, not a date)
           comes back with a stray "/" "\" "|", it re-reads the same prepped crop
           in a few modes (PSM 7+alphanumeric-whitelist, PSM 8, PSM 8+whitelist)
           and keeps the first whose glyphs are otherwise identical (strips junk
           separators, never changes characters). SHARED: template_mapper._crop_and_ocr
           (Stage 0.5, the admin anchor-wizard path) calls the same repair, so both
           crop paths behave identically. Reusable for every supplier/field.
           SHARED SEGMENT CLEANING (anchor.clean_crop_segment, B1): both crop paths
           also share ONE segment-selection helper — column-gap split, city-comma
           cut, and a SHAPE-AWARE postcode/year trim for free-text fields. The trim
           only fires when ≥2 alphabetic words precede the 4+ digit run
           ("Ann Blume 10115 Berlin"→"Ann Blume"), so a name/address whose OWN token
           is the number ("Unit 4 1024 Park", "Site 4012") is no longer amputated to
           a fragment (the old blanket \s+\d{4,} split). Non-text/ref fields keep
           their digits. template_mapper._clean_value delegates to it.
           DRIFT RECOVERY (_relocate_value_by_label): the ⊕ crop is tried at the
           stored coords FIRST (fast path); if that read fails its credibility/
           learned-format gate (a shifted/clipped scan moved the value off the
           rigid box), anchor.py RE-FINDS the taught label on this page (reusing
           template_mapper._locate_anchor — local then page-wide) and re-derives
           the value crop ADJACENT to where the label actually landed, so the
           value FOLLOWS the label's displacement (method anchor_crop_relocated).
           Coordinates are only a HINT; the label drives the read — same anchor+
           relative model as Stage 0.5, brought to ⊕ anchors. Runs only after the
           rigid crop failed, and the relocated value still must clear the same
           credibility + format gates. Generic to every supplier/field.
           DRIFT-INVARIANT OFFSET (migration 21, field_anchors.offset_dx/dy_norm):
           the ⊕ teach captures the located LABEL's box (ocr-region-boxes →
           region.py --boxes; renderer labelOffsetFromBox) and stores
           offset = value-centre − label-top-left, page-normalised. Relocation
           places the value at located-label + offset (exact) instead of the
           coarse adjacency guess. Because label and value shift together, the
           offset is the SAME taught on a clipped/shifted scan as on a clean page
           — so correcting a field on a bad scan no longer re-points the canonical
           anchor and poisons normal-page extraction. Legacy rows (NULL offset)
           fall back to the geometric guess. (Stage 2 — cross-field consensus
           resite via a shared drift module — deferred.)
           CREDIBILITY GATE (engine.extract): a Stage-2 candidate may not OVERRIDE
           an existing incumbent unless credible for the field class — date fields
           require validator.parse_date(); ref fields (_is_ref_field: ..._number/
           ..._no/reference) reject low-info values (lone "a") AND a digit-free
           candidate ("Booking") cannot displace a digit-bearing incumbent. Guards
           OVERRIDES only — an empty field is still filled (validator then flags).
           Reusable/shape-based, never supplier- or document-specific.
           ── 2026 RELIABILITY PASS (find → follow → read, across doc types) ──
           LIGHT-FIRST OCR LADDER (_crop_and_ocr): the unconditional heavy prep
           noted above is REPLACED by a ladder — light (greyscale, upscale-small-
           only, NO autocontrast/sharpen) PSM 7 → light PSM 6 → heavy _prep PSM 7/6
           → text_enhance — each scored by ONE image_to_data pass and accepted by
           verify_fn (or a conf floor). The heavy upscale+sharpen was DESTROYING
           clean high-res crops ("Beaumont Care Homes Ltd" → "nara"/""); the heavy
           rung still runs for tight degraded serials, so the separator fix is
           preserved. _repair_single_token runs on every rung.
           KEY/VALUE PLACEMENT + INLINE HARVEST: the locator used to return the
           whole OCR LINE box, so in a "label …big gap… value" row geometric
           placement seated the value crop PAST the value (clip/empty). Now
           _ocr_lines keeps per-word boxes; template_mapper._locate_anchor returns
           the matched LABEL-word box AND harvests the value straight off the
           located line; anchor._locate_for_relocation searches a FULL-WIDTH row
           strip so a far value column is captured, and the rung HARVESTS the value
           (method anchor_inline) before any crop. This is what makes a drifted
           worksheet customer and a never-seen key/value report read correctly.
           GATED RESCUE (_strict_credible / _should_replace): a label-anchored
           harvest replaces a rigid read ONLY when the rigid value FAILS a strict
           gate (single-token for code fields, so high-DPI garbage like "cield wu"
           or a clipped date yields) — a strictly-credible rigid read is never
           displaced (no unconditional override).
           ANCHOR-LABEL SANITISATION (learning.sanitizeAnchorLabel, migration 23):
           strip document-specific tokens (reference numbers/dates/serials) from an
           auto-detected ⊕ label so it GENERALISES across documents
           ("2605-0769-1 Work Address" → "Work Address"); on change the now-
           mismatched drift offset is NULLed. Migration 23 cleans existing rows
           (deletes any whose label is entirely document-specific).
           VAL_TYPE FROM FIELD TYPE (engine.extract): field_patterns is seeded from
           each CUSTOM field's DB type (date/currency/alphanumeric only — text left
           untouched so name/address reads don't change) and the doc-type reference
           field is coerced to a code type, so the credibility/rescue gates work for
           custom document types (which carry no keyword-config entry).
           BORN-DIGITAL (ocr/born_digital.py — pypdfium2 BSD-3/Apache, NOT PyMuPDF):
           a generated PDF's embedded text layer gives EXACT text + word boxes (no
           OCR) for the full text (extract_text_and_images, positional reading
           order) AND the anchor locate/harvest (page_text_lines threaded
           process_docs → engine.extract → extract_with_anchors →
           _locate_in_text_lines). Detected by GLYPH COUNT + an alpha-ratio hybrid
           guard; INERT for image-only/scanned pages (fall back to OCR). Gated by
           born_digital_enabled (default ON).
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

**Bounded parallel processing** (setting `processing_concurrency`, 1–5, default 1):
`process-folder` (processing/handler.js) runs a worker POOL — N Python procs,
each handling a disjoint round-robin SHARD of the folder's files (passed via the
backward-compatible `--files-file` arg in process_docs.py; absent → scan whole
folder). Parallelizes only the CPU-bound OCR/extraction ACROSS documents, never
within one. concurrency=1 keeps the exact original single-proc path. Safe because
ALL DB/file writes stay on the single-threaded JS event loop via
`_handleFileMessage` (better-sqlite3 is synchronous) — Python workers never touch
the DB, only read a per-batch training-data snapshot and emit JSON. Pool emits ONE
aggregate `{type:start,total}` (per-worker starts suppressed) so the renderer's
progress bar isn't clobbered. `_currentBatchProcs[]` + `isBatchRunning()` track all
workers; stop kills every tree. Watch-folder stays serial and defers via
`isBatchRunning()`.

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

**Field variability is EVIDENCE-based, not schema-guessed** (`_buildTemplateFields`
in review/handler.js): a confirmed field is frozen as a template `fixed_value`
ONLY when it's truly constant. The schema heuristic (`_annotateFieldVariability`)
was invoice-centric — it froze any non-ref/non-date field, which wrongly pinned a
worksheet `customer` to one stale value. Now a field with ≥2 DISTINCT confirmed
values for the doc type is treated as variable and never frozen (the cost of a
false "variable" is a harmless re-extract; a false "fixed" commits a wrong value
on every other doc). Self-heals an already-frozen field on the next confirm.

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
then `needsOnboarding()` → on a clean install the **first-run setup wizard** (see First-run
wizard), otherwise the main shell; a non-`allow` gate routes to the **license window**
(`src/windows/license` — Start/Resume Trial · Enter key + Activate · Release · Check again).

**Enforcement is ALWAYS ON** — `enforcementActive(db)` in `src/modules/licensing/handler.js`
returns `true` unconditionally. The old relaxations are REMOVED: the
`DOCUSNAP_LICENSE_ENFORCEMENT` env override, the `license_enforcement_enabled` setting
branch, and the unpackaged/dev-mode (`app.isPackaged`) bypass are gone, and the runtime
toggle IPC (`license-set-enforcement`) is hard-gated to a no-op. There is NO "start with
licensing off" path in any build (dev runs against a real backend trial/seat). `decideAccess`
always proceeds to the token/backend gate. A valid cached trial/seat token always passes, so
legit users open normally.

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

**Admin 2FA** (`public/admin/{login,2fa}.php`, `lib/admin_auth.php`): optional TOTP
(RFC6238, dependency-free pure PHP — backend has NO composer), two-stage login
(`admin_login`→'ok'|'need_2fa'|'fail'), bcrypt-hashed recovery codes, secret+codes at
rest in `keys/admin_2fa.json` (outside docroot), 5-min inactivity timeout. QR uses a
**self-hosted** vendored `public/admin/qrcode.min.js` (MIT qrcodejs — no CDN); manual
key/URI entry is the fallback when the file is absent. **When editing admin_auth/login/
2fa/qrcode, redeploy to `C:\wamp64\www\licensing\public\admin\`.**

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
create-doc-type-with-fields({name,fields[],ref_field_key,date_field_key})  # transactional; teaching wizard
get-teach-target                       # docId the teach window was opened at (pulled once on load)
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
dev-inspector-unlock(pw)               # pw checked in MAIN (=== 'SFDEV'); opens dev-inspector window
dev-inspector-running                  # read-only bool (isBatchRunning)
dev-get-session-docs, dev-get-session-doc(key)  # read-only in-memory dev-session registry (no DB)
dev-get-slice(path)                    # base64 of a temp OCR crop; path MUST resolve under ctx.devSliceDir
split-pdf(file,ranges,outDir,docId,every)  # pypdf split; `every` N = split every N pages (1=each), else ranges
onboarding-suggested-folder, onboarding-validate-folder(folder)  # first-run wizard (mkdir+probe writability)
```

### Renderer → Main (send — fire and forget)
```
window-minimise, window-maximise, window-close
show-in-explorer(path), open-file(path)
open-review-window, open-settings-window, open-search-window
open-teach-window, open-teach-window-at(docId)   # guided teaching wizard (Admin+Edit)
onboarding-complete, open-onboarding   # first-run wizard: set first_run_completed+open shell / re-run (admin)
notify-review-complete
license-enter-app                      # REQUEST entry; main re-decides via decideAccess
```

### Main → Renderer (events)
```
review-count-changed(n), deferred-count-changed(n)
processing-mode-changed(mode)
pull-progress({status,completed,total})
reprocess-progress(msg), process-progress(msg)
process-trace(ev)                      # dev-inspector ONLY (never to main window); see Dev inspector
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

## First-run wizard (clean-install setup)
`src/windows/onboarding/` — a linear setup wizard shown ONCE on a clean install,
AFTER the licensing gate allows (so a locked user never sees it). Gated by the
`first_run_completed` setting (`!== 'true'` → show); migration 24 stamps the flag
on any already-configured DB (has an `output_folder`) so existing users are never
re-onboarded — NEVER infer "clean install" from empty state.
- **Gate/flow (main.js):** `enterMainApp()` → gate `allow` → `needsOnboarding()` →
  `showOnboarding()` (else `openMainShell()`). `onboarding-complete` sets the flag
  + opens the shell. `open-onboarding` (admin) re-runs it from Settings → General
  ("Re-run setup"). Reads fail-open — a read error never blocks app entry.
- **Steps:** welcome + offline/privacy note → **output folder** (the ONLY required
  step: pre-filled `Documents\Scan Finder` via `onboarding-suggested-folder`,
  write-validated by `onboarding-validate-folder` which mkdirs + probes) → theme
  (light/dark, live) → performance (threads presets + speed/accuracy mode) → done.
  "Skip setup" accepts defaults but still secures a writable output folder.
- Writes go through the EXISTING `set-setting` path (theme broadcasts live via
  `theme-changed`); the wizard owns only the FLAG + the window/shell swap.
- **Backup-with-retention was deliberately deferred** — a real backup subsystem
  (copy + prune, sensitive deletion path) is its own workstream, NOT a phantom
  toggle that claims to run backups it doesn't.

---

## Teaching wizard (guided, non-technical)
`src/windows/teach/` — a dedicated, linear "Teach a new document" wizard for
first-time/non-technical users; opened from the main launchpad card "Teach a
document" (Admin+Edit) or `open-teach-window-at(docId)`. Steps: welcome → choose
the scanned doc (from the review queue) → pick or CREATE a doc type (friendly
field setup + plain-English "main number"/"date" key questions) → point out each
field by drawing a box around its VALUE (live OCR read-back; the wizard
auto-detects the nearby label as the anchor) → review → commit → honest learning
explainer.
- **Artifact (per Oscar):** each field is saved as a Stage 0.5 anchor→target
  MAPPING (value-box-only; auto-label), so it works on document #1 and
  registration covers drift — NOT a Stage 2 ⊕ anchor (avoids two competing
  artifacts).
- **Commit sequence (deferred until the last step so Back/Cancel are safe):**
  `promote-to-template` (creates the template + pins this page as the sample →
  auto-generates landmarks) → `save-template-mapping` per field →
  `confirm-review` (files + learns). Reuses existing IPC; the only new backend is
  `create-doc-type-with-fields` (transactional). The dense Review renderer is
  untouched — the teach window has its own small canvas drawer.

---

## Dev inspector (hidden, read-only)
Hidden developer tool for diagnosing extraction. **Read-only — no DB writes, no
learning, no mutation; invokes no role-protected handler.**
- **Open**: in the MAIN window press **Ctrl+Shift+D then M** (~1s, ignored in text
  fields) → password modal → main checks `=== 'SFDEV'` (`dev-inspector-unlock`,
  pw never logged) → opens `src/windows/dev-inspector`. Available in dev AND
  packaged, gated only by the password.
- **UI — "answer-first" provenance view** (`src/windows/dev-inspector/{index.html,
  renderer.js}`, renderer-only; uses only existing IPC, touches no main-app code):
  three-column shell — LEFT a **session-docs card picker** (in-memory registry,
  resets on restart; filter box + "Follow live document" toggle; coloured status/
  type chips + mini confidence bar; reprocess temp-names `reprocess_<ms>.<ext>`
  prettified to `↻ Reprocess HH:MM:SS`), CENTER the per-field provenance area,
  RIGHT live status (current file/activity/progress) over a page-evidence pane.
  Raw log demoted to a collapsed bottom drawer.
- **Telemetry mirror**: `processing/handler.js` ADDITIVELY tees `process-progress`/
  `reprocess-progress` to the inspector (`notifyDevInspector`) — user console
  unchanged. Drives the live-status card + the doc header summary (resolved
  per-field, NOT the misleading invoice_number convenience).
- **Extraction trace** (`type:"trace"` stdout, separate `process-trace` channel,
  routed only to the inspector): emitted by `engine.extract(trace=…)` ONLY when
  `process_docs --trace` is set, which handler adds ONLY while the inspector is
  open → normal processing is byte-identical (no overhead/output). Events:
  `stage_start|stage_end|candidate|merge(decision win/lose +vs)|transform(2.5)|
  validation(4/4.5)|final|slice`. JS `reprocess_merge` event also surfaces the
  reprocess-merge keep/replace decision.
- **Per-field WINNING LINEAGE** (renderer reconstruction): each field collapses to
  `name + final value + winning-stage badge + "+N other candidates"`; expanded it
  shows a ★FINAL box then a vertical, colour-per-stage **lineage chain** (win
  merges → 2.5 transforms shown in-chain as `from → to` → value-changing
  validations → final), with losers + their reason (`lower confidence (X%<Y%)`
  else honest `superseded (reason not recorded)`) tucked in an "Other candidates"
  expander. Transforms render as chain NODES, so a value cleaned up into the final
  answer reads as the chain's origin — never struck-through (fixes the old
  value-equality "supersede" mislabel). Because the engine does not yet DECLARE a
  winner or per-decision reasons, the chain carries an **"approx" badge** and
  degrades gracefully. Flagged fields (validation note / corrected_to / final
  note) auto-expand. States handled: trace-not-captured banner (opened mid-run),
  live-streaming (debounced re-render), no-crop fields (honest "matched on OCR
  text layer"), AI stage absent, validation-forced-review. **Known main-app
  follow-ups (out of scope of the window):** engine winner-declaration + reason
  strings; and the reprocess identity stamp — reprocess copies to a temp name so
  the trace + dropdown register under it while JS `reprocess_merge` events key on
  the ORIGINAL filename and can orphan (renderer shows them when present, but the
  binding fix lives in `handler.js`).
- **OCR slices**: with `--slice-dir` (added with `--trace`), the anchor crop
  (`anchor_crop`, kind=target) and template-mapping crops (`template_mapping`,
  kinds anchor+target) are saved as temp PNGs; the page-evidence pane shows them
  for the selected field (value/target crops first, then anchor), each labelled
  from its OWN slice event's stage/page/bbox. **Temp only**: one main-owned dir
  `<temp>/ds-devslices`, served base64 via path-validated `dev-get-slice`, cleared
  on inspector close + app before-quit. Never persisted/filed/learned.
- Tests stub OCR-dependent stages (`tests/test_stage2_winner_consistency.py`,
  `test_job_no_pattern.py`); do the same for new trace/gate logic.

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
(NSIS `deleteAppDataOnUninstall:false`). Licensing enforcement is ALWAYS ON (no env/setting/
dev bypass) — dev must run against a real backend trial/seat for the machine's fingerprint.
