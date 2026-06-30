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
- **eric** (`agents/eric.md`) — Electron expert: main/renderer architecture,
  secure IPC + preload/contextBridge, BrowserWindow/webContents lifecycle,
  child-process management, packaging/electron-builder, code signing, perf/memory.
- **reggie** (`agents/reggie.md`) — regex & extraction-pattern expert: analyses/
  tightens/loosens field regexes and validation rules (invoice/PO/sales-order
  numbers, VAT, dates, totals, codes, IDs) and anchored label→value extraction;
  precision-first; keeps the renderer `RegExp` and Python `re` patterns aligned
  (the shared `validation_patterns` in config/keyword_patterns.json). Returns a
  fixed report shape (Facts / Proposed pattern / Match examples / Integration point
  / Risks / Smallest change).
- **007** (`agents/007.md`) — elite OCR ENGINEER (deeper than oscar on geometry):
  separates the READING axis from the PLACEMENT axis, follows the coordinate frame,
  proves FACT vs HYPOTHESIS, fixes the reusable layer. For the hardest OCR positioning
  bugs (label→value drift, registration / coordinate-frame mismatches) + end-to-end
  OCR-pipeline review; same OSS-licence hard rule as oscar. (Led the Stage 0.5
  inline-harvest drift fix with oscar + eric — see OCR_WORKFLOW_REVIEW.md.)

**Skills** in `.claude/skills/`: a set of Python engineering skills
(`testing-strategy`, `code-quality`, `performance`, `api-design`, `packaging`,
`security-audit`, etc. — gary's toolkit), `ocr-document-processor` (oscar's
OCR knowledge pack: SKILL.md + scripts; note its requirements.txt lists PyMuPDF —
use pypdfium2 here instead), and `ocr-engineering` (007's deep OCR pack: coordinate
frames, anchor→offset math, merged-row inline harvest, registration-as-fallback,
debug triage). `scan-finder-frontend-design` covers the website/UI.

---

## What this is
Windows desktop app (ships as **Scan Finder** / `ScanFinder.exe`; internal
identifiers, DB `docusnap.db` and `%APPDATA%\DocuSnap` remain "DocuSnap"):
scans documents → OCR → extracts fields → files them intelligently.
Electron + Python backend + SQLite. Fully offline capable.

---

## Business / company details
**Six Mile Software** is a **trading name (sole trader) — NOT a registered limited
company** (no Ltd, no Companies House number as of 2026-06). **Scan Finder** is the
product. Use these for the website (footer, contact, legal/terms), the licensing emails,
and anywhere a business identity is needed:
- **Trading name:** Six Mile Software  *(do NOT append "Ltd" or imply incorporation /
  a company number until one is actually registered)*
- **NEVER surface the proprietor's personal name** anywhere public (site, footer, emails,
  Terms/Privacy). Present the business as **"Six Mile Software" + the virtual address +
  licensing@scanfinder.co.uk only.** (The clean route to full name‑privacy + compliance is
  to incorporate **Six Mile Software Ltd** — then only the company name/number/registered
  office appear; until then, lean on Polar being the seller of record, below.)
- **Address:** Office 1874, 92 Castle Street, Belfast, N. Ireland, BT1 1HE
  (virtual business address)
- **Product:** Scan Finder · **domain:** scanfinder.co.uk · **licensing/email sender:**
  licensing@scanfinder.co.uk
- **Seller of record:** **Polar** (Merchant of Record) — Polar is the legal seller for
  purchases, so the customer's purchase contract + VAT/tax sit with Polar, not Six Mile
  Software. The website/emails still carry the Six Mile Software identity for support.
- Revisit this whole block (and add the company number) **if/when a limited company is
  incorporated**.

---

## Stack
| Layer | Tech |
|---|---|
| Desktop shell | Electron 31, Node.js, better-sqlite3 |
| UI | Vanilla HTML/CSS/JS; **native OS window frames**; shared light/dark theme (`src/windows/shared/theme.css`) |
| LAN add-on | TLS `/v1` API (Node `https`) + detached Electron search client; certs via node-forge (`src/services/certService.js`) — see Detached search client |
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
│   │   ├── processing/handler.js        # folder import, reprocess, OCR region, logos; BACKEND 100% AUTO-FILE (_maybeAutoFile/_autoFileDoc, hooked in _handleFileMessage): a fully-typed, un-flagged, overall_confidence===100 doc files itself the moment it's processed — MANUAL import + WATCH folder + background alike (window need not be open), reusing filing.commitDocument + documents.confirm, gated by auto_file_full_confidence; records ids in a rolling `recent_auto_filed` setting; emits 'doc-auto-filed'. (Reprocess-All keeps the renderer-side review.autoCommitFullConfidence.)
│   │   ├── processing/processing_mode_handler.js # mode get/set, fast-mode suggestion
│   │   ├── review/handler.js            # queue, confirm, defer, delete, pages; Advanced→"View learning history" (get-field-value-history / purge-field-value / rename-field-value, admin/edit, audited) → learning.getFieldValueHistory/purgeFieldValue/renameFieldValue: list the confirmed values learned for a (supplier,doctype,field) scope (same final values getFieldFormats samples); PURGE a value that shouldn't exist (e.g. a "Booking" drift artifact) from extractions+corrections+supplier_hints so it stops polluting the learned shape; RENAME a value (oldValue→newValue across extractions+corrections, drops the stale hint) to fix an OCR slip ("$O2"→"SO2"). Review toolbar ⚙ Advanced button → flyout → sortable modal (click a heading to sort). Modal is NON-blocking (no backdrop, positioned left): the right fields pane stays lit + clickable and clicking a field LIVE-RELOADS the table for that field (focusin→loadLearningHistoryFor, active field highlighted .lh-active-field). Per-row ✎ inline-edit (rename) + 🗑 delete-confirm; "Fix likely slips" button = renderer computeSlipFixes: a value differing from a ≥80% per-position column consensus at exactly ONE char that's a likely OCR slip (_likelySlip: a symbol where alnum expected, or a known confusion $↔S/0↔O/1↔I…) and whose corrected form matches the dominant shape or an existing value → proposes old→new, applies on confirm via renameFieldValue. Guarded by database/modules/test_field_value_history.js
│   │   ├── filing/handler.js            # folder structure, rename, XML metadata
│   │   ├── settings/handler.js          # doc types, fields, key-value settings
│   │   ├── templates/handler.js         # Admin Template Viewer — browse/pin samples, anchor→target mapping CRUD; Learning Recovery reassign (link-only, reversible) + MERGE (templates.mergeInto: fold a fragment's doc-links/missing-mappings/fields/landmarks/sample/identity into a canonical row, sum confirmed_count, delete source — IRREVERSIBLE; the cure for near-duplicate "same logo, drifted phash" template fragmentation). Guarded by database/modules/test_template_merge.js
│   │   ├── search/handler.js            # document search
│   │   ├── api/handler.js               # TLS /v1 API for the detached client + cert wizard + enroll (see Detached search client)
│   │   ├── workflow/handler.js          # desktop mailbox/approval IPC (entitlement+role gated; reuses workflowService)
│   │   └── licensing/handler.js         # license gate decideAccess() + trial/activate/revoke/enforcement IPC (see Licensing)
│   ├── lib/license/{client.js,token.js,fingerprint.js}  # backend HTTP client · offline JWS verify · device fp_hash
│   ├── services/{searchService,previewService,workflowService,entitlementService,certService,sessionService}.js  # transport-agnostic core (see Detached search client)
│   └── windows/
│       ├── main/{index.html,renderer.js}      # DASHBOARD + NAV RAIL (2026-06-28 redesign, replaced the launchpad). LEFT RAIL = single nav: Home · Import · Review(badge) · Search · Teach · Settings + a rail CLOCK (time large/date small) + "Local only" + a Dark-mode quick toggle at the very foot. CONTENT = a view-router (showView 'home'|'import'); Review/Search/Teach/Settings still open as their own maximised child windows. HOME = attention-led dashboard in ONE auto-fit card grid (repeat(auto-fit,minmax(260px,1fr)) → no empty cells; full-width banners use .dash-span); content column centred + width-capped (clamp(1100px,92vw,1320px)). Cards: Needs-your-attention (review+deferred+stuck counts → Open Review, or "all caught up"); Documents-filed pulse (today/week/month from confirmed_at); Import quick-start; Auto-import (watch status + on/off switch + pick-folder, admin-only); Getting-smarter (suppliers+layouts learned); Where-your-files-go (output folder + Open folder via the open-folder IPC); trial banner (licenseGetDiagnostics, "N of 14 days", calm/warn/crit); first-run setup checklist (auto-hides); Recent activity (recent confirmed; refreshes live on confirm via refreshDashboardIfHome). updateAttention() is the CHEAP count-event repaint; refreshDashboard() (the searchDocuments query) runs on load / Home-open only. IMPORT VIEW = folder picker + Process/Stop + session stats + live results table (Company/Date/Reference/Status) + progress strip; "Filed"/"Needs review" rows open THAT doc via openReviewWindowAt(db_id). Processing text shows "Multi-page document (N pages)" via the file_pages event. Reprocess-All progress is a BANNER (review window).
│       ├── splash/{index.html,splash.js}      # cosmetic startup splash — shown in whenReady, closed once login loads
│       ├── review/{index.html,renderer.js}    # incl. zoom/pan preview + hidden admin Template Wizard (⚓): draw anchor/target → save via existing template-mapping IPC; "Show where it reads" overlays (amber) the RESOLVED anchor/target on the current page via test-template-mapping → template_mapper.resolve_geometry (so the operator sees the mapping TRACK a shifted scan, vs the static drawn boxes). FIXED-VALUE MODE is a segmented pill ("Read it from the document" / "Always use the same value"), wording mirrored in Settings → Template Manager. ⊕ teach shows a post-draw READOUT BAR (detected label + value + [← Left]/[↑ Above] direction toggle — see Stage 2 "⊕ AUTO-ANCHOR LABEL SEARCH"). THREE teaching surfaces framed by ROLE so they're legible to non-technical users: Fix a field (⊕) · Teach a document (teach wizard) · Fine-tune a layout (Template Wizard, advanced fallback) — see Help "Which should I use?" (help/templates.html #which-tool). "TEACH THIS DOCUMENT" CTA (2026-06-28, renderTeachCta, centred above the preview): shown ONLY for a genuinely-unseen doc — HIDDEN when a template matched (template_id), when the recheck finds a drifted template (`_templateRecheck.matched` — reprocess fixes it, no action), or when ANY field was read by a learned method (keyword/keyword_override/anchor/template_mapping); a recognised sender (logo/keyword) gets a one-time confirm. Launches the Teach wizard at the doc (skips doc-selection). A `doc-types-changed` broadcast (settings/handler on type create/add/presets) refreshes the Review type dropdown + Settings list + main results-table key map live (preload `onDocTypesChanged`).
│       ├── teach/{index.html,renderer.js}      # guided "Teach a new document" wizard (non-technical) — see Teaching wizard
│       ├── settings/{index.html,renderer.js}  # incl. Admin Template Viewer + License/Activation-Test tab
│       ├── search/{index.html,renderer.js,search-results.js,search-preview.js,search-actions.js}  # built search UI; entitlement-gated confidence/mailbox/workflow actions (see Detached search client)
│       ├── dev-inspector/{index.html,renderer.js}  # hidden read-only processing inspector (Ctrl+Shift+D+M, pw SFDEV) — see Dev inspector
│       ├── onboarding/{index.html,renderer.js} # first-run setup wizard — see First-run wizard
│       ├── license/{index.html,renderer.js}   # activation/trial screen shown when the gate locks
│       ├── help/                              # User Guide window (index + content pages, help.css, help-nav.js) — native frame, themed
│       └── shared/{theme.css,theme.js,helpmode.js}  # centralised palette/components · theme toggle · data-help-key help-mode
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
│   │   ├── template_mapper.py           # Stage 0.5: admin-drawn anchor→target zone mapping; absolute-first read → inline-harvest/relocate off the located label (label_box) → registration fallback
│   │   ├── registration.py              # "register, then read": NumPy similarity/affine RANSAC fit (taught landmarks→page) + confidence; no OpenCV
│   │   ├── keyword.py                   # Stage 1: regex pattern matching (incl. job_no 4-4-1 shape, separator-normalised)
│   │   ├── anchor.py                    # Stage 2: spatial anchors + logo match
│   │   ├── ocr_corrector.py             # Stage 2.5: learned OCR misread correction
│   │   ├── llm.py                       # Stage 3: phi3:mini via Ollama (dormant — 'ai' mode not exposed in UI)
│   │   ├── validator.py                 # Stage 4: cross-field validation
│   │   ├── value_quality.py             # name/company/address quality (name_quality, is_name_like_field) — JS mirror in learning.js. is_name_like_field EXCLUDES technical addresses (mac/ip/hardware/network "address") — they are CODES, not names, so the name-quality/_name_field_code_reject gates must not strip their legitimate value ("D4:F0:C9:25:9B:64", "192.168.1.200"); else a labelled mac_address/ip_address anchor can never fill (the value's relocated read is rejected as "no real word")
│   │   ├── text_normalise.py            # deterministic compare-time normaliser (NFKC/dash/quote/lower/ws/edge); JS twin database/modules/text_normalise.js
│   │   └── name_match.py                # Stage 4.5 token-level canonical NAME repair (lexicon + positional repair); suggestion-only
│   ├── ocr/{tesseract.py,region.py,landmarks.py,text_enhance.py,born_digital.py}  # region.py: interactive draw-tool zone-OCR (review ⊕ picker, Template Wizard read-back, Template Manager) + --boxes label-position capture; LIGHT-FIRST ladder mirroring anchor._crop_and_ocr (light greyscale+upscale-small-only read first, heavy autocontrast+sharpen only when light is EMPTY) so a drawn box reads the SAME as extraction and clean born-digital crops aren't mangled into junk ("Serial number"→"be_7"); MULTI-LINE AWARE (2026-06): a drawn box that covers a value WRAPPING onto 2+ lines (a work address "Beaumont Care Homes Ltd -"/"Jordanstown") is re-segmented with PSM 6 (block mode) after the ladder and rebuilt line-by-line (top→bottom, space-joined) — PSM 7 (single-line) won the ladder first and MANGLED a multi-line crop into one garbled line ("p sverablseti Care Homes Ltd -"); a single-line crop keeps the ladder text byte-identical; the PSM-6 data is computed once + reused by --boxes. Guarded by tests/test_region_light_first.py (multi-line case); landmarks.py: derive registration landmarks from sample page; text_enhance.py: degraded text-line re-read (denoise+Sauvola+unsharp), text-only gate-triggered escalation; born_digital.py: read EXACT text + word boxes from a PDF's embedded text layer (pypdfium2 BSD), skipping OCR for generated PDFs (gated by born_digital_enabled)
│   ├── logo/fingerprint.py
│   └── render/pages.py                 # PDF→PNG rendering — shared by review/search/template preview (see Gotchas). --thumb = single low-res page-1 thumbnail for list thumbnails (previewService.getThumbnail)
├── config/keyword_patterns.json        # editable pattern library
├── config/license.json                 # client license config: base_url, product_id, public_keys (PUBLIC keys only)
├── client/                              # detached LAN search/mailbox Electron client (apiClient.js pins the CA) — see Detached search client
├── cert-tool/                           # standalone TLS cert-generator GUI (node-forge)
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
                  page_count  ← migration 37: captured at import; drives the Review
                  multi-page icon + the "Multi-page document" processing text. NULL
                  for pre-migration rows (no icon until reprocessed)
                  STATUS: pending|needs_review|deferred|confirmed|deleted|error
extractions     — document_id(FK), field_key, raw_value, display_value,
                  confidence, was_corrected, corrected_to, extraction_method
corrections     — document_id(FK), field_key, original_value, corrected_value,
                  supplier_name, document_type
supplier_hints  — supplier_name, document_type, field_key, hint_value, usage_count
                  HINTS FILL EMPTY FIELDS ONLY (engine._apply_hints, usage_count≥2,
                  conf=min(90,60+usage*5)). EVIDENCE-BASED VARIABILITY GUARD (2026-06): a
                  field with ≥2 DISTINCT confirmed values in-scope is variable IN FACT and is
                  SKIPPED — so a per-document free-text field (e.g. customer) never gets the
                  most-frequent past value stamped on a new doc when its anchor read nothing
                  ("McConnell Kelly Solicitors" onto a "Dunroamin Caravan Park" doc). The
                  schema is_variable flag only covered ref/date fields; this evidence check
                  mirrors review/handler.js _buildTemplateFields. Stable fields (one recurring
                  value) still benefit.
field_anchors   — supplier_name, document_type, field_key, anchor_label,
                  direction(right|below|above), page_zone, x_norm, y_norm,
                  w_norm, h_norm, usage_count, confidence,
                  last_authoritative_at  ← migration 20: set on an EXPLICIT ⊕
                  re-teach. ⊕ TEACH PERSISTS ON COMMIT, NOT ON THE DRAW (review/
                  renderer.js, 2026-06): the drawn anchor is STAGED in `pendingAnchors`
                  (keyed by field, mirroring `corrections`) and only written by
                  saveFieldAnchor in confirmCurrentDoc after a successful confirm
                  (re-keyed to the confirmed supplier); an un-confirmed teach (skip/
                  defer/doc-change/reprocess) discards it, so an accidental wrong pick
                  leaves NO learned trace. The field VALUE still fills immediately;
                  only the learning is deferred. (Erase a committed mistake via
                  Settings → Learning Recovery → Clear anchors, scoped to supplier/
                  doctype; or just re-teach — authoritative sweeps the old.)
                  saveAnchor's authoritative branch TRUSTS the drawn
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
template_logo_hashes — template_id(FK cascade), phash, UNIQUE(template_id,phash)  ← migration 26
                  MULTI-REFERENCE logo identity: a template carries a SET of logo
                  phashes, not one. Per-scan DPI/enhance drift shifts a recomputed
                  phash double-digit Hamming, so a single frozen logo_phash made a
                  drifted same-supplier scan spawn a near-duplicate template. Stage 0
                  (_logo_candidates) and JS findByLogoHash now take the MIN distance
                  over the set (legacy fallback: [templates.logo_phash]); templates.
                  logo_phash stays the seed/primary. On confirm, templates.update
                  APPENDS the scan's hash when it's drifted-but-related (dist to
                  nearest ref in (2,13]); set capped at 8 (evict most-redundant
                  non-primary). _upsertTemplate reuses on a 7-13 "convergence" band
                  gated by same doc-type-slug + ≥0.60 keyword overlap, so the set
                  CONVERGES instead of fragmenting; the matcher accept gate stays ≤6.
                  mergeInto folds hash sets. Guarded by test_template_logo_hashes.js
                  + tests/test_logo_phashes_multiref.py.
settings        — key, value (key-value store; incl. registration_enabled —
                  default ON, gates the Stage 0.5 registration rung;
                  born_digital_enabled — default ON, gates PDF text-layer extraction;
                  name_wordness_flag — default ON, gates the free-text NAME wordness
                  review FLAG (handler.js buildTrainingArgs → process_docs --name-wordness
                  → engine.set_name_wordness): a supplier/customer read that doesn't read
                  like a name (document-chrome stoplist + ref-code bleed + char-trigram
                  garble via extraction/wordness.py, PLUS history-gated name_match
                  truncation/fragment flag + word_like self-calibration) is flagged for
                  review (note + conf≤70), NEVER rejected/rewritten. Inert without the
                  shipped extraction/data/char_trigrams.json. See test_harness/WORDNESS_NOTES.md;
                  first_run_completed — 'true' once the setup wizard finishes/skips
                  (migration 24 stamps it for already-configured installs so existing
                  users are never re-onboarded))
migrations      — version, applied_at
license_tokens  — kind(seat|trial), subject, token_blob(JWS), state, not_after,   ← migration 16
                  grace_until, kid  (client cache of the signed token; deletable)
device_registrations — fp_hash, product_id  (local mirror; backend is source of truth)
users           — …, totp_secret, totp_enabled  ← migration 28 (detached-client MFA
                  only; nullable/inert — the in-process desktop login never reads them)
document_routes — document_id(FK cascade), from/to_user_id+username,
                  action_required(approve|acknowledge), state(pending|claimed|approved|
                  rejected|acknowledged|recalled), comment, resolution_comment,
                  claimed_by_*, resolved_at, version  (mailbox/approval; see Detached
                  search client). documents.workflow_status = denormalised latest state.
                  Ensured UNCONDITIONALLY in runJsMigrations — NOT version-stamped.
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
             2's rigid-crop-then-relocate model.
             INLINE HARVEST + label_box (template_mapper._relocate_and_read, 2026-06 —
             the real "anchor and data point aren't linked" drift fix; led by agent 007
             + oscar, frame-cleared by eric): the SHARED relocation helper now reads a
             key/value row the way Stage 2 (anchor.py) always has. (1) INLINE HARVEST —
             when the located label's OCR line is "label …gap… value" ("Ticket No.
             2605-0769-1"), the value words are read STRAIGHT off the line
             (_locate_anchor.inline_value), gated like a crop read, no extra OCR. (2)
             label_box GEOMETRY — the geometric fallback derives off the TIGHT label_box,
             NOT the whole OCR LINE box (which overshoots the value and made the
             relocation refuse/misderive → fall to the registration transform → read the
             row ABOVE); _located_too_wide now only guards the legacy no-label_box case.
             CLEAN ABSOLUTE READ IS AUTHORITATIVE (2026-06, REVISED): _extract_one
             relocates ONLY when the label is found DISPLACED (_label_drifted) — or when
             the absolute read FAILED its gate (falls through to the registration arbiter /
             late fallback). It NO LONGER fires the harvest "regardless of drift" on every
             key/value row: that re-read the whole OCR LINE and could REPLACE a clean drawn-
             box read with a garbled line read on a NON-drifted page ("Beaumont Care Homes
             Ltd - Comber" → "pantionahe MUGS Liu COTVCE"), then lose to a junk keyword. On
             a clean page the operator's drawn box already sits on the value, so its
             absolute read (the same one the live draw tool reads at 100%) STANDS; genuine
             drift the per-label test misses is caught by the registration arbiter below.
             (Stage 2's inline harvest was already correctly rigid-first — gated by
             _should_replace, only overriding a WEAK rigid read — so it was unchanged.)
             Guarded by tests/test_inline_harvest.py + test_template_mapper_drift.py. (DEFERRED, see OCR_WORKFLOW_REVIEW.md:
             resolve_geometry/_extract_one CAPTURE POLLUTION — all rungs capture
             kind="target", so the diagnostic green box can show a non-winning rung; and
             tie _label_drifted's coarse fixed _DRIFT_FLOOR to line height for label-ABOVE
             layouts.)
             DRIFT GUARD (closes the old absolute-first trade-off for LABELLED
             mappings): a stationary drawn box on a shifted page (e.g. a mapping
             taught on a CROPPED scan, then run on the UNCROPPED reprocess where
             every row moves down) reads a credible-but-WRONG neighbouring line,
             which shape_mode='ignore' can't catch — so it used to commit and
             short-circuit relocation. Now, BEFORE accepting the absolute read,
             when the mapping has a real anchor_text and the anchor LABEL is found
             DISPLACED beyond a per-axis tolerance (_label_drifted: box-centre
             distance vs half the drawn box per axis, floored; only on a genuine
             matched_text, never proximity-only), the value is re-derived from the
             label's ACTUAL position via the drift-invariant stored offset
             (_relocate_and_read, shared by this early branch and the late
             single-label fallback) and preferred. The pre-cached LOCAL locate is
             reused; only a large shift that missed it triggers ONE page-wide
             locate, and ONLY when the absolute read was non-empty — so a clean
             page (label at its spot) pays no extra OCR and behaves byte-identically
             (absolute, conf 90). A failed relocation falls through (no worse than
             before). Blank/legacy NULL-anchor_text mappings are unaffected.
             DRIFT SAFETY GUARDS (so relocation can't trade one failure for
             another): (1) _located_too_wide — relocation REFUSES a "label" match
             that spans far more than the drawn anchor box (≥2.5× its width, min
             0.30 page-width): cross-column form rows OCR-merge into one line
             ("Ticket No. … Work Address Beaumont…"), and relocating off that row's
             left edge reads the wrong column (garbage). On refusal it falls
             through (early branch) / omits the field (late path) instead of
             committing junk. (2) _is_ocr_debris — the shared gate rejects
             fragmented free-text OCR junk ("aan EE ..... 4 4.3 Fs . J... .";
             replacement-char reads) so it can't scrape past the lax free-text
             credibility and commit — forces fall-through to registration or a
             clean absolute read. Both guarded by test_template_mapper_drift.py.
             ANCHOR-LABEL AUTO-CAPTURE (wizard, review/renderer.js): so every new
             mapping HAS a label to track, when the Template Wizard ANCHOR LABEL is
             left blank the drawn anchor box is OCR'd (existing ocr-region recipe),
             sanitised (sanitizeAnchorLabel mirror — drop refs/dates/serials), and
             populated into the VISIBLE, editable input before save; empty/failed
             OCR → null (legacy). Guarded by tests/test_template_mapper_drift.py.
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
             _STAGE05_LOCATED_METHODS.
             REGISTRATION ARBITER (the rung is no longer fallback-only): the
             registration read body is factored into _read_registration (shared),
             and an ARBITER runs BEFORE the absolute-read return — after the
             per-field _label_drifted guard. When a page transform is fitted AND
             registration.box_divergence(transform, target_box) (normalised
             centre-distance between the drawn box and its transform-mapped image)
             exceeds the same "still on this row?" band _label_drifted uses
             (max(h*0.5, _DRIFT_FLOOR)), the page is registered DIFFERENTLY from the
             taught frame, so the stationary absolute box is reading the wrong row —
             a credible-but-WRONG type-valid neighbour that shape_mode='ignore'
             can't catch and the per-label guard misses on a generic/merged-row
             label. The registration read is then preferred; a failed reg read falls
             through to absolute (no worse than before). CLEAN pages → transform ≈
             identity → divergence ≈ 0 → arbiter never fires → absolute fast path
             BYTE-IDENTICAL (only cost: one apply_box, no OCR). Guarded by
             tests/test_registration_arbiter.py. NOTE the prerequisite is that the
             matched template HAS landmarks — a template pinned to a sample whose
             files were since removed (or never backfilled) has none; Settings →
             Template Manager → "Regenerate landmarks" (regenerate-template-landmarks
             IPC → generateLandmarks, no re-pin) or "Import Sample…" (clean original)
             recomputes them. generateLandmarks now also SEEDS logo_phash from the
             sample (landmarks.py --emit-phash → compute_logo_hash; stored ONLY when
             the template has none, never overwriting an established phash) so a
             sample-pinned template becomes matchable — closing the empty-phash
             ORPHAN class (templates that can never match, e.g. blank create-template
             rows). (Stage 2 anchor arbiter: DONE — see the Stage 2 reorder note below.) This REPLACED the old translation-only
             consensus-drift fallback: page_geometry.py (content-free page-corner
             "landmarks"), _consensus_drift and _drift_fallback were REMOVED — a
             real content-landmark transform strictly supersedes a corner prior +
             translation guess. SHARED GATE (_gate_value): one helper applied by
             the absolute path, the registration rung AND the single-label path —
             order = date-salvage (C1) → _crop_is_credible (the field's REGEX/TYPE,
             always enforced) → _format_rejects (the LEARNED-SHAPE consensus vs
             confirmed history — statistics, NOT the field's type).
             MANUAL-ANCHOR PRECEDENCE (rung-aware shape gating): a hand-drawn
             mapping is a deliberate human OVERRIDE of learned history, so it must
             win on regex/TYPE alone — it must NOT be vetoed by the learned-shape
             check. _gate_value takes a shape_mode: the ABSOLUTE drawn-box read uses
             'ignore' (skip _format_rejects entirely — the operator's own box on a
             non-drifted page can't column-bleed, so regex/type is the right and
             OCR-safe qualifier); the DERIVED rungs (registration + single-label
             relocation, where column-bleed actually happens) use 'flag' — a
             type-valid value that fails the learned shape is KEPT but capped at
             conf ≤70, tagged "..._shapewarn" and given a validation_note for
             review, instead of being silently dropped. ('drop' is the legacy hard
             reject, kept as the default for any other caller.) This fixed the bug
             where a type-valid manual value was silently dropped by _format_rejects
             and the WRONG auto/keyword value then won on reprocess. Auto tiers
             (Stage 2 anchor / keyword) keep FULL type+shape gating — unchanged.
             engine._is_stage05_located() is now a PREFIX test (template_mapping* /
             template_registration*) so every suffix combo — _salvaged, _shapewarn,
             _expanded — gets the same protection (keyword can't demote it; a
             non-authoritative auto-anchor can't clobber it). Guarded by
             tests/test_template_mapper.py (test_gate_value_shape_modes,
             test_manual_anchor_shape_precedence).
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
           LABEL-MATCH BOUNDARY GUARD (_label_pattern, 2026-06): a SINGLE-word ALPHABETIC
           label now carries the same word-boundary guard as _type_keyword_pattern
           ((?<![a-z0-9])…(?![a-z0-9])) so a short caption can't anchor on a SUBSTRING of a
           longer word — "Total" inside "Subtotal" (the silent subtotal-filed-as-total bug),
           "Date" inside "Mandate", "From" inside "Frome". Multi-word labels are already
           specific (unchanged); the only loss is a label glued straight onto its value with
           no separator ("Date2026"). Fixes SHIPPED extraction for every supplier, not just
           presets. OVERRIDE VALIDATION-BY-ROLE (merge_label_overrides + _infer_validation):
           a per-install field-label override seeded onto a field with NO shipped pattern
           entry used to be accepted BLIND (extract_fields gates only when a "validation" key
           is present). It now gets a format gate inferred from the field-KEY role (mirrors
           engine._is_ref_field/_TYPE2VAL: *_date→date, *_number/_no/_ref/reference→
           alphanumeric, amount/total→currency; free-text/name → none) — so a custom ref/date
           field (remittance_number, statement_date, …) is validated, not blind. Both guarded
           by tests/test_keyword_label_guard.py.
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
           LABEL LOCK — labelled free-text follows its LOCATED label (anchor.py, 2026-06,
           REVISED): a rigid crop reads ABSOLUTE coordinates, so on a variable-layout doc
           (rows shift — Print Tracker alerts, worksheets) it lands on a NEIGHBOURING row and
           reads a plausible free-text word that PASSES the loose gate ("TK-8375M" on the
           Description row when the Customer "McMahon Associates" sat one row down), so the
           relocate rung (fires only on a failed/weak rigid read) never runs and the WRONG
           row commits at high confidence — the anchor knew its label but never used it. The
           operator's model: if the LABEL locates, the value sits at located-label + the
           stored offset, full stop — NO drift-magnitude gate. So for FREE-TEXT fields with a
           real anchor_label + a stored offset, whenever the label LOCATES (`_dlb` present)
           the value is re-read beside it (inline harvest, else a crop at located-label +
           offset) and PREFERRED — but ONLY when that read is itself credible AND actually
           DIFFERS from the rigid read. On a clean page the label is at its learned spot, so
           located-label + offset ≈ the rigid box → same value → no replacement →
           byte-identical. This REPLACED the old _value_drifted_from_box THRESHOLD (which
           could miss a sub-threshold one-row drift, the "customer→TK-8375M" bug): the value
           now LOCKS to the label, not to a drift magnitude. Structured fields
           (pattern-validated) + legacy NULL-offset anchors untouched; reuses line_cache (a
           clean on-row read pays one locate). Guarded by tests/test_anchor_drift_guard.py.
           COMPLETENESS GUARD (2026-06, multi-line interaction): the label-lock relocate must
           NOT replace a MORE-COMPLETE rigid read with a TRUNCATED one — when the rigid value
           STARTS WITH the relocate candidate and is LONGER, the rigid is kept (the multi-line
           case: the rigid joined "Beaumont Care Homes Ltd - Jordanstown" via the continuation
           but the relocate crop got only "…Ltd -", and a bare-difference replace was swapping
           the good join for the truncation + flagging it "looks shorter"). A genuinely
           DIFFERENT relocate (the rigid drifted to a wrong row) does not prefix-match, so it
           still wins — the drift fix is preserved.
           ⊕ AUTO-ANCHOR LABEL SEARCH (review/renderer.js captureAnchorContext): the
           left-label search scans the WHOLE row to the left of the value (was a fixed 300px
           window), one line tall — so on wide two-column key/value rows a TIGHT value box
           finds its far-left label ("Make") instead of falling through to the row ABOVE.
           The above-strip is now one line tall too (was 60px → bled into ~2 rows). A
           DIRECTION TOGGLE on the post-teach readout bar ([← Left]/[↑ Above]) re-detects
           the label in the chosen direction (captureAnchorContext forceDir) for label-above
           layouts or a wrong auto-pick; the readout also flashes the detected anchor box.
           sanitizeAnchorLabel still rejects a value-shaped "label".
           CREDIBILITY GATE (engine.extract): a Stage-2 candidate may not OVERRIDE
           an existing incumbent unless credible for the field class — date fields
           require validator.parse_date(); ref fields (_is_ref_field: ..._number/
           ..._no/reference) reject low-info values (lone "a") AND a digit-free
           candidate ("Booking") cannot displace a digit-bearing incumbent. Guards
           OVERRIDES only — an empty field is still filled (validator then flags).
           Reusable/shape-based, never supplier- or document-specific.
           DIGIT-PARITY RESURRECTION GUARD (anchor.py, 2026-06, reggie+oscar-reviewed):
           the registration + relocate rungs QUALIFY a credible read against the learned
           shape and, when the shape veto rejects it, RESURRECT it anyway (`if not q: q=gval`)
           — to keep a legitimately-variable CODE (a new MAC/serial that differs in shape
           from history). That over-reached: it also resurrected a DIGIT-FREE word read off a
           NEIGHBOURING row ("Field"/the Ticket Type value, or "Booking") on a reference field
           whose every confirmed value is NNNN-NNNN-N — a clean wrong-row read that then
           SUPPRESSED the inline-harvest that DOES read the real "2605-0769-1" (the registration
           transform fits a GLOBAL similarity whose ~2%-page residual exceeds the tight row
           pitch in a dense label block, so a globally-good fit sits a row off locally).
           anchor._digit_free_on_digit_field (+ format_anomaly_checker.shape_requires_digit:
           class digits_only OR every learned shape signature contains '#') now REFUSES the
           resurrection when the read is digit-free AND the field's history is uniformly
           digit-bearing → the incumbent stays empty → the inline-harvest/relocation seats the
           real digit-bearing value (or empties → review). Digit-bearing reads (MAC/serial/the
           real ref), alpha-only ref schemes, and thin/varied history are all untouched
           (byte-identical). The rungs also only attempt the replace when the candidate is
           truthy now (`if q and _should_replace`). Guarded by tests/test_ref_digit_guard.py.
           STAGE 2 ANCHOR ARBITER — REORDER (2026-06, DONE; oscar+reggie+geometry-validated):
           the label-based DRIFT-RECOVERY / inline-harvest rung now runs BEFORE the GLOBAL
           REGISTRATION rung (registration moved to AFTER relocate, just before the text
           fallback). The LOCAL precise label read is tried first; registration is the fallback
           its own design always intended — it fires only when relocate left value None/weak
           (relocate only assigns inside its credibility+format+_should_replace gates, so a
           failed/uncredible relocate leaves value None, which registration's existing
           `not value` trigger already covers — NO extra trigger clause). Fixes the digit-
           BEARING wrong-row class the digit-free guard above couldn't: a global similarity
           fit's ~2% page residual exceeds the tight row pitch in a dense label block, so the
           mapped box lands a row off and reads a credible-but-WRONG fragment ("849-4" from
           "2605-0849-1") that then SUPPRESSED its own correction. PLUS a new
           anchor._partial_of_uniform_shape guard ANDed into BOTH resurrection sites
           (registration + relocate-crop): refuses resurrecting a digit-bearing FRAGMENT whose
           shape is a strict contiguous sub-run of a SINGLE uniform learned shape ("###-#" of
           "####-####-#") — closing the label-UNfindable residual — while a genuinely-new
           differently-shaped code is untouched. CLEAN pages byte-identical (a strict-credible
           rigid read skips both rungs regardless of order). Guarded by
           tests/test_anchor_arbiter_reorder.py (+ refreshed test_anchor_registration stub,
           the multiline harness still 0 false-joins). (Deferred follow-ups: _qualify_against_format
           arg parity on the inline path for mac/ip; routing 4-4-1 refs to the precise
           job_reference val_type; a Stage 2 box_divergence arbiter.)
           AUTHORITY PRECEDENCE (engine.extract — the cross-stage winner order):
           authoritative ⊕ anchor > Stage 0.5 mapping > admin label
           (keyword_override) > other (passive anchor / keyword / inline /
           relocated) > generic seed (template_fixed/template_anchor) > hints,
           each gated on validity. TWO 2026 fixes: (1) Stage 2 TIER A — an
           authoritative anchor (data["authoritative"], from last_authoritative_at)
           that clears the credibility gate wins OUTRIGHT regardless of resolved
           method or confidence (was anchor_crop-ONLY via is_taught_override, so a
           re-teach reading its value via anchor_inline/relocated/registration
           could lose a confidence contest to the label it was meant to override).
           (2) Stage 1 — a valid admin label (keyword_override) beats ANY incumbent
           on authority EXCEPT a Stage 0.5 mapping (is_override_authority broadened
           from template_fixed/template_anchor-only to `not _is_stage05_located`);
           mapping > label is the chosen ordering. Guarded by
           tests/test_precedence.py + test_label_overrides.py #9.
           OCR-QUALITY CONFIDENCE (anchor.py, 2026-06): a crop's confidence used to
           ride usage_count alone, so a garbled read ("Aaiumant Care Homes Ltd -
           Galaorm") scored in the 90s. anchor._read now returns (text, mean,
           min_word_conf); _crop_and_ocr threads them out via `meta`. For FREE-TEXT
           fields ONLY (val_type None/text/multiline — a structured value is validated
           by its REGEX, and Tesseract under-reads dash-separated digits, so a valid
           ref "2602-0768-1" must NOT be capped) the field confidence is capped at
           mean+5, and an authoritative anchor's outright Tier-A / is_taught_override
           win is GATED on ocr_min_conf ≥ _TIER_A_OCR_MIN(70): a garbled authoritative
           read falls through to the confidence contest (its capped conf loses to a
           clean keyword), while a clean/inline read (ocr_min_conf None) still wins.
           Guarded by tests/test_precedence.py (garbled yields / clean still wins) +
           the fence that a passive anchor_crop can't displace keyword_override.
           ── 2026 RELIABILITY PASS (find → follow → read, across doc types) ──
           PREVIEW-SCALE FREE-TEXT READ (anchor._noise_smooth_retry + the
           _ocr_crop_laddered fast-path, 2026-06 — "read it the way the draw tool does"):
           the on-screen ⊕/target draw tool reads value crops off the ~108 DPI PREVIEW PNG
           (render/pages.py scale 1.5) and reads DEGRADED scans CLEANLY, while extraction
           renders at 300 DPI — which AMPLIFIES scan noise into a credible-but-GARBLED name
           ("Beaumont Care Homes Ltd - Holywood" → "oceaumont Care homes Lid - nolywooa")
           that passes the loose free-text gate, so the ladder commits garbage and the
           heavy SHARPEN rung only makes it worse. TWO reasons the draw tool wins, both
           reproduced: (1) the low preview resolution, and (2) a hand-drawn box has
           vertical HEADROOM (the stored tight box clips glyph tops/bottoms). So for
           FREE-TEXT crops (val_type None/text/multiline) the ladder's FIRST step now
           RE-CROPS from the page with headroom (±0.5·h) and downscales to ≈the preview
           scale (_PREVIEW_DOWNSCALE 0.4 → ~120 DPI); a confident read (min substantial-
           word conf ≥ _PREVIEW_ACCEPT_MIN 55, passing the gate) is taken OUTRIGHT — both
           CLEANER and FASTER (smaller image, fewer/cheaper passes) than the 300 DPI rungs.
           Bench-proven on doc 146 to recover the EXACT "Beaumont Care Homes Ltd - Holywood"
           (min 92) the tight 300 DPI crop reads as junk. Needs page+box (threaded from
           BOTH _crop_and_ocr paths); absent (a test stub) → ladder unchanged. NUMERIC/code
           crops and the FULL-PAGE OCR keep the high-res read (detail/keyword completeness;
           the full-page text is cached on reprocess anyway). A residual low-conf preview
           read falls through to the full-res ladder below; a still-shaky free-text rung
           there triggers the same downscale as a retry. Gated to free-text, so clean/
           structured reads are unaffected. Guarded by the OCR/drift suites.
           LIGHT-FIRST OCR LADDER (_crop_and_ocr): the unconditional heavy prep
           noted above is REPLACED by a ladder — light (greyscale, upscale-small-
           only, NO autocontrast/sharpen) PSM 7 → light PSM 6 → heavy _prep PSM 7/6
           → text_enhance — each scored by ONE image_to_data pass and accepted by
           verify_fn (or a conf floor). The heavy upscale+sharpen was DESTROYING
           clean high-res crops ("Beaumont Care Homes Ltd" → "nara"/""); the heavy
           rung still runs for tight degraded serials, so the separator fix is
           preserved. _repair_single_token runs on every rung. SAME LADDER IN
           region.py: the interactive draw-tool OCR (review ⊕ picker, Template
           Wizard read-back, Template Manager — all via ocr-region/ocr-region-boxes)
           was the un-migrated outlier still doing unconditional autocontrast+
           SHARPEN, so a DRAWN box read worse than extraction and mangled clean
           born-digital crops (corrupt anchor label "be_7" + wrong/empty value).
           region.py now reads LIGHT first (greyscale+upscale-small-only, no
           autocontrast/sharpen) PSM 7→6 and escalates to the heavy recipe only
           when the light read is EMPTY; --boxes mapping is unchanged (upscale
           scale constant). So the supersedes-line above ("region.py" sharing the
           heavy recipe) is historical. Guarded by tests/test_region_light_first.py
           (renders the failure shape, asserts a faithful+clean read; skips without
           Tesseract).
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
           INLINE-HARVEST COLUMN CLIP (template_mapper.cluster_value_words, 2026-06 —
           007's fix): the harvest read the WHOLE OCR line (full page width) and took
           EVERY word after the label, so a far heading/column on the same row LEAKED
           into the value ("ABC12345" → "ABC12345 DOCUSYS MODEL NAME"; "JL ABC12345").
           The drawn box WIDTH was discarded on this path and the only re-narrowing was
           clean_crop_segment's 4-SPACE split (a 1-3 space column boundary defeats it).
           cluster_value_words now splits the post-label words into HORIZONTAL-GAP
           columns (break where the inter-word gap > 1.2× median word height — a true
           inter-COLUMN gap, DPI-invariant; mirrors the renderer's nearestLeftCluster)
           and returns the column nearest/after the label's right edge. Wired at BOTH
           inline-harvest locator sites (template_mapper._locate_anchor + anchor.
           _locate_in_text_lines). Additive: one column / no wide gap / missing word
           boxes → byte-identical; full-width search strip (the "far value column"
           capability) untouched. Guarded by tests/test_inline_column_bleed.py.
           OPERATOR FIELD-CLEANUP RULES (the residual-case override): a Review
           right-click toolkit (review/renderer.js field-input contextmenu, gated
           canEdit) teaches per-(supplier,doctype,field) cleanup rules to strip a leaked
           heading/column OCR still bled in. Three options w/ tooltips + before→after:
           "Keep only the main value" (rule_type keep_block — engine keeps the single
           validation-pattern / digit-bearing token, dropping neighbour words either
           side), "Remove this text from future scans" (remove_text — reggie's anchored
           literal matcher, leading/trailing), "Just fix this one" (one-off, no rule).
           Staged in pendingFieldRules, COMMITTED ON CONFIRM (mirrors pendingAnchors),
           reversible in Learning Recovery ("Field rules" group + clear). Stored in
           field_rules (migration 36); loaded via --field-rules-file → engine.
           set_field_rules; applied in the Stage 4.5 winner loop (EARLY, independent of
           learned format) by python_backend/extraction/field_rules.py (apply_keep_block
           / apply_remove_text — pure, guarded, never empties); honest was_corrected +
           corrected_to + "auto-trimmed, was: …" note, NOT review-forced. Guarded by
           tests/test_field_rules.py + database/modules/test_field_rules.js.
           MULTI-LINE CONTINUATION (Phase 1, 2026-06, oscar+reggie-designed): a free-text value
           that WRAPS onto the next line (a work address whose first line ends "…Ltd -" + a
           second line "Comber") is read + joined, gated so a single-line read stays
           byte-identical. TRIGGER (name_match.should_continue_line, pattern-primary +
           history-guarded): continue when line 1 ends with a trailing dash -/–/— AND history
           doesn't confirm it complete (conforms_to_lexicon / learned shape), OR when
           is_truncated_name says the read is short vs expected_len. STORAGE: reuse field_rules
           with rule_type='multiline_continue' (token_norm = trailing chars, default "-") — NO
           migration; engine.set_field_rules SPLITS these into self._multiline_index (consulted
           by the READ step via _make_multiline_lookup), NOT the Stage 4.5 apply loop. READ+JOIN
           (anchor.py): clean_crop_segment factored to _clean_one_line (its first-line return is
           byte-identical); _crop_and_ocr, when the field has a rule + should_continue_line fires,
           extends the crop ~1.3 line-heights, PSM-6 re-reads via _read_block_lines, takes the
           next line under the geometry guard (_lines_adjacent: same-left/≥50% x-overlap + gap ≤
           0.9 line — stops swallowing an unrelated row), join_continuation (keep " - " separator
           / de-hyphenate a word-break / single-space a plain wrap), then _continuation_ok
           (verify_fn + not-still-truncated + length cap) else KEEP line 1. Covers the rigid /
           relocate / registration rungs (all call _crop_and_ocr). Gate: multiline_enabled setting
           (default ON, --multiline; INERT without a rule). NOT a validation_pattern → no JS
           mirror. TEACH UI (Phase 2, done): a Review field RIGHT-CLICK toggle "This field can wrap to the
           next line" (showFieldRuleMenu → _stageMultilineRule, name-like fields, staged in
           pendingFieldRules → saveFieldRule on confirm) + a TALL-BOX auto-rule (a ⊕ draw whose
           zone-OCR reads 2+ lines auto-stages the rule, silent: region.py --boxes now returns a
           `lines` count, runZoneOcr reads via ocrRegionBoxes) + a Settings → General "Read values
           that wrap onto the next line" toggle (multiline_enabled). Stage 0.5/template_mapper +
           born-digital next-line still deferred (Stage 2 anchor crop covers the common case).
           Guarded by tests/test_multiline_continue.py + the region.py multi-line test.
           PRECISION/RECALL GUARDS (2026-06, bulletproofing — test_harness/multiline_measure.py,
           a 400-doc real-OCR stress test across suppliers/logos × single-line/dash-wrap/
           complete/drift/word-break/comma: 0 FALSE-JOINS, ~99% recall): (1) name_match.
           matches_stable_prefix — should_continue_line only fires when the read is a PLAUSIBLE
           PREFIX of the learned name (shares the canonical first token), so a DRIFTED ref code
           ("2604-0511-1") or a wrong word can't trigger a join; (2) a TRUE word-break hyphen
           ("…Gar-", a LETTER immediately before the trailing dash) continues regardless of the
           completeness check (a separator dash "…Ltd -" with a SPACE before stays history-gated);
           (3) _lines_adjacent uses the line PITCH (top→top ≤ ~2.5 line-heights), not the tight
           glyph-box gap (which under-stated line height and made a normal wrapped line look
           "far" → never joined); (4) clean_crop_segment's city-comma cut skips a TRAILING comma
           (last word) so "Greenfield Nursing Home," isn't truncated to "Greenfield Nursing"; (5)
           the LABEL LOCK completeness guard (see above) keeps a more-complete rigid join over a
           truncated relocate.
           ANCHOR-LABEL SANITISATION (learning.sanitizeAnchorLabel, migration 23):
           strip document-specific tokens (reference numbers/dates/serials) from an
           auto-detected ⊕ label so it GENERALISES across documents
           ("2605-0769-1 Work Address" → "Work Address"); on change the now-
           mismatched drift offset is NULLed. Migration 23 cleans existing rows
           (deletes any whose label is entirely document-specific).
           FIELD-NAME LABEL GUARD — DETECTED vs PHANTOM (learning.saveAnchor, 2026-06):
           the guard that drops an anchor label equal to the FIELD KEY (a phantom
           "supplier_name" caption the page never prints → blind-crop) used to fire on
           ANY match — which wrongly nuked a REAL detected caption for a well-named
           custom field (field `make` → on-page "Make", `serial_number` → "Serial
           number", `mac_address`/`ip_address`/`model`), leaving it a label-less blind
           crop that DRIFTS a row on variable-layout docs (Print Tracker alerts: every
           anchor read the neighbouring row). Now the ⊕ capture marks a label OCR'd FROM
           THE PAGE with `label_detected:true` (review/renderer.js, both left+above
           paths); saveAnchor drops the field-name label ONLY when `!label_detected`
           (the synthesised fallback), so a real caption that merely equals the field
           key is KEPT + locatable + keeps its offset. The IPC passes the flag through
           untouched. (customer→"Entity"/date→"Estimated depletion" were unaffected —
           their captions differ from the key.)
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
             cross-field format consistency (see Stage 7).
             FREE-TEXT GUARD (engine.extract): the learned-SHAPE check may FLAG but
             NEVER withhold/trim a free-text field's value — fields typed
             text/multiline/untyped AND not _is_ref_field (text_field_keys). Names
             & addresses vary legitimately, so a value that misses a rigid learned
             shape is kept + tagged "format differs from the usual — please verify"
             (conf ≤70, review-forced) instead of being NULLed. Without this, a
             customer history all shaped "Beaumont Care Homes Ltd - <Site>" learned
             an alphanum_sep shape that hard-nulled a valid "Beaumont Care Homes Ltd
             -" (no site) → empty Customer field. Ref fields typed plain "text"
             (e.g. reference_number) are EXCLUDED via _is_ref_field so structured
             codes keep full shape enforcement (withhold on mismatch). Guarded by
             tests/test_stage45_text_preserve.py.
             CONFORMANCE OVERRIDE (2026-06, name_match.conforms_to_lexicon): the
             learned-SHAPE check still FALSE-FLAGGED a legitimate "new site" whose
             length was never confirmed (a customer "...Ltd - <new long site>" fails
             the accepted character-shapes once a few sites recur ≥_SHAPE_ACCEPT_MIN).
             The per-field name_lexicon is a MORE precise model (stable prefix +
             variable tail), so when every STABLE prefix token matches the canonical
             AND the value reaches the learned expected_len, the "format differs" flag
             is SUPPRESSED. expected_len (the longest content-position run a ≥0.6
             majority of docs reach — history always "<prefix> - <site>" ⇒ 5) is the
             TRUNCATION GUARD: a value SHORT of it ("...Ltd -" with the site cut off)
             does NOT conform and stays flagged. Guarded by tests/test_name_match.py.
             EDGE-JUNK CLEANING (value_quality.strip_name_edges): a keyword/label
             capture has no crop-path cleaning, so OCR edge junk ("--« Beaumont Care
             Homes Ltd -") entered verbatim and — as keyword_override (highest
             authority) — WON, then only got charset-flagged. strip_name_edges drops a
             leading non-alphanumeric run + trailing whitespace/disallowed symbols
             (EDGES only — interior + a legitimate trailing " -" preserved), applied
             both (a) AT CAPTURE in the Stage 1 keyword loop (so the junk never
             becomes the answer and the trace shows a clean winner) and (b) as a Stage
             4.5 catch-all for the winner. Name-like free-text only. Guarded by
             tests/test_value_quality.py.
             PATTERN-BASED FIELD CORRECTION (Phase 1 — commit 09a4c62; name repair is
             now TWO-TIER, 2026-06): two helpers run in the Stage 4.5 loop on the
             WINNER value. (1) TOKEN-LEVEL NAME REPAIR (name_match.py +
             text_normalise.py): for name-like fields, builds a per-(supplier,doctype,
             field) token lexicon from confirmed value_counts (stable token = doc-freq
             ≥0.6 AND ≥3 docs, deterministic canonical surface) and repairs garbled
             KNOWN tokens to their canonical spelling while keeping the VARIABLE tail
             verbatim ("eeaument care homes - lisburn" → "Beaumont Care Homes -
             lisburn") — never whole-value snaps, never injects a learned token,
             positional + thin-evidence guards, idempotent. SHORT-TOKEN RULE: a 3-char
             ALPHABETIC stable token that is NEAR-UNIVERSAL (doc_freq ≥0.9) repairs a
             SAME-LENGTH single substitution ("Lid"→"Ltd") — tighter than the ≥4-char
             fuzzy path so "Co"→"Go" stays exact-only and a real different suffix
             "Inc" (dist 3) is kept. TWO TIERS by evidence (repair_name_value(details=
             True) → (repaired, strong)): a STRONG repair (every changed token at a
             near-universal position) AUTO-APPLIES — value+display_value corrected,
             was_corrected, a "Corrected to learned spelling (was: …)" note, NOT
             review-forced; a WEAK repair stays SUGGESTION-ONLY (corrected_to + note +
             conf≤70 + review). Review surfaces an auto-apply with a calm green "✓
             auto-corrected" badge (no Accept button), detected by value==corrected_to;
             a suggestion keeps the amber note + Accept. Runs INDEPENDENT of
             check_value's anomaly verdict (a garbled name is coarse-class FREETEXT
             and won't trip it); the lexicon is attached to fmt_entry in
             build_format_class_index (additive name_lexicon key, even for freetext
             name fields). text_normalise.py is a deterministic compare-time
             normaliser (NFKC→dash/quote fold→.lower()→explicit-class ws collapse→
             edge-trim) with a byte-identical JS twin (database/modules/
             text_normalise.js, parity-tested via tests/normalise_corpus.json). (2)
             CHARSET VALIDATION (config field_charsets, BACKEND-ONLY — NOT served via
             get-validation-patterns): per field TYPE, flags unexpected OCR symbols
             (format_anomaly_checker.charset_disallowed) as a note + conf cap; skips
             date/currency, defers to a pre-existing note (one note per field).
             Guarded by tests/test_{name_match,text_normalise,field_charsets}.py +
             test_text_normalise.js.
             SHAPE FAMILIES + shape_match_score (Phase 2, ADDITIVE/DIAGNOSTIC —
             commit 0277a85): format_anomaly_checker.shape_families() folds the
             learned shape set (separator-run near-dups merged), counts, sorts, caps
             at 6 → additive fmt['shape_families']; shape_match_score(value,fmt) →
             1.0 exact / 0.8 learned-shape substring / 0.0 else. Pure, no behavior
             change (classify_format/check_value/propose_correction untouched); the
             foundation for a later candidate-override phase (not yet wired). Guarded
             by tests/test_shape_match_score.py.
  Stage 4.6: CANDIDATE OVERRIDE (Phase 3, DEFAULT-OFF — commit b58ef06): a gated
             post-merge resolver (engine._resolve_candidates) that may prefer a
             clearly-more-credible RETAINED candidate over the merge winner. An additive
             per-field ledger (self._field_candidates, built only when the setting is on
             via _remember_candidates at the Stage 0/0.5/1/2/2.5/3 merge points — winner
             selection byte-identical) feeds it. Runs between Stage 4.5 and metadata;
             NEVER touches an authoritative anchor / Stage 0.5 located / keyword_override
             winner, defers to an existing note. Challenger must clearly beat the incumbent
             on shape_match_score (shaped) or value_quality.name_quality (name). Setting
             `candidate_override` = off (default, byte-identical) | suggest (corrected_to
             only) | auto (replace value, only for `candidate_override_fields` types);
             process_docs --candidate-override plumbing. Guarded by
             tests/test_candidate_resolver.py.
```

**Three modes** (stored in settings as `processing_mode`):
- `fast`  — stages 1+2 only, sub-second, any hardware
- `smart` — stages 1+2, then 3 only if invoice_number/invoice_date/total_amount
             missing or below 70% confidence. DEFAULT.
- `ai`    — stages 1+2+3 always

**Locate reads at a capped width, not ×2-upscaled** (2026-06 — the biggest per-doc OCR
win): the anchor/landmark LOCATE (`template_mapper._ocr_lines` → `image_to_data` for word
boxes) used the value-crop prep `_prep`, which UPSCALES ×2 — ballooning a 2481px page to
~4962px so a full-page locate took ~3.8s (the dominant cost on import AND reprocess, and it
runs even with the OCR-text cache because the locate is a SEPARATE pass for word boxes).
The locate only needs to MATCH label/landmark text and return NORMALISED boxes, so it now
uses `_prep_for_lines` which CAPS the width at ~1100px (≈120 DPI): the SAME lines are found
in ~1.1s (2.7× faster, ~2.7s/doc). Geometry-neutral (boxes normalise to the prepped size);
registration uses normalised landmark positions so the fit is unchanged. Guarded by the
template-mapper/drift/registration suites.

**Reprocess reuses the stored full-page OCR text** (2026-06): the full-page OCR is
~1.9s/page and re-reads the SAME pixels every reprocess for a result that never
changes — only the learned data does. So reprocess now passes the doc's already-stored
`documents.ocr_text` and `extract_text_and_images(..., cached_text=...)` RENDERS the page
images (~0.25s, needed for crop/logo/zone OCR + registration) but SKIPS the full-page OCR
(~90% faster on that step). Per-field crop reads + born-digital `page_text_lines` still
re-run, so accuracy is unchanged (the field VALUES come from the crop reads against the
NEW learned anchors, not the full-page text). SINGLE reprocess: `--cached-ocr-file`
(written into the temp folder); BATCH (Reprocess All): `ocr_text` per-doc in the
`--reprocess-manifest` (doc_overrides). GATED OFF when a manual/template ENHANCE is active
(the OCR read would differ) or the stored text is empty → full OCR. First import (no
manifest/cached file) is byte-identical. Self-populating: a reprocess still stores
`ocr_text`, so a doc whose stored text was empty is cached after its first reprocess.

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

**Drain to Processed/ + file-handle release** (handler.js, 2026-06-28): a processed
original is moved out of the intake folder into `Processed/` (or `Errors/`) once a
verified working copy exists (`drain_processed`, default on). Two reliability fixes:
(1) the Python worker now CLOSES each pdfium document per file (ocr/tesseract.py
`extract_text_and_images`/`pdf_to_images`, born-digital page-0) so the source PDF's
handle is released before drain — Windows can't rename an open file. (2)
`drainOriginalToFolder` distinguishes a genuine cross-volume move (EXDEV → copy+
unlink) from a TRANSIENT LOCK; a still-locked file is left in place (drained next
run) and NEVER left as a duplicate. The INLINE attempt (`_drainNowOrDefer`, on the
main thread per file_done) passes `{retry:false}` → ONE non-blocking attempt (no
Atomics.wait); a locked file is queued (`_pendingDrains`) and flushed by
`_flushPendingDrains` after the worker exits (manual batch: Promise.all; watch:
per-file proc close), which retries (`retry` default true). The EXDEV branch guards
its unlink: if the source is locked it deletes the just-made copy so no duplicate is
left. `file_done` is persisted SYNCHRONOUSLY in the stdout handler (not setImmediate)
so `msg.db_id` is set BEFORE the message is mirrored (the results-table "open this doc
in Review" needs it) — wrapped in try/catch so a per-doc DB error can't skip the
progress mirror/count. Guarded by test_drain_original.js (EXDEV-locked + retry:false
no-duplicate cases).

**Document SEPARATION pre-pass** (`_separateBatchDocuments`): before the worker pool,
each PDF is OCR-scanned to split a multi-document file (e.g. ten one-page alerts in
one PDF). Runs as a BOUNDED PARALLEL pool (≤ CPU cores, per-proc Tesseract thread
cap) with live "Preparing N/M" progress; the stop handler ALWAYS sets
`_cancelRequested` and `process-folder` BAILS after the pre-pass if cancelled (so
Stop is immediate, not stuck behind a launched worker). Gated by
`auto_separate_enabled` (default on).

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

**Auto-promote a template on a TAUGHT confirm** (`review/handler.js` confirm-review, 2026-06-28):
`_upsertTemplate` was removed from *every* confirm, but a confirm where the user TAUGHT fields
(⊕ targets — `taught_fields` non-empty, non-bulk) now calls it: the operator is clearly
building a reusable layout, so a template is created/refreshed and `_buildTemplateFields`
freezes the non-variable TYPED fields (e.g. **Document Issuer**, `is_variable` 0) as
`fixed_value`s. This is what makes a typed issuer FILL on the next document's reprocess
(previously: drawn targets in Review + a typed issuer + Confirm created NO template, so the
issuer had no learned artifact). Plain (un-taught) and bulk "File All Ready" confirms still
create no template, by design. Best-effort + non-fatal — never fails the confirm.

**Born-digital keyword-fingerprint backfill** (`templates/handler.js` `generateFingerprint`
+ `python_backend/template_fingerprint.py`, 2026-06): a template can be born with an EMPTY
keyword_fingerprint — a BORN-DIGITAL doc (e.g. a Print Tracker email alert) whose stored
`documents.ocr_text` was never captured yields nothing to `extract_keyword_fingerprint` at
promote time, so the template is matchable ONLY by its logo phash. That phash is unreliable
for these: the logo crop is the top-left corner `(0,0→w/2,h/5)`, and on alerts that render a
`From/Sent/To/Subject` email header above the banner it hashes the HEADER → drifts 12-34
Hamming vs the accept gate (conf≥60 ⇒ dist≤6) → "No template match" → the whole cascade
(wrong supplier via the logo fallback, fixed-anchor drift). The fix RE-DERIVES the fingerprint
from SEVERAL of the template's documents (born-digital aware, the same text path processing
uses) and keeps only the STABLE words present in a MAJORITY (≥60%) — dropping per-doc
recipient/entity noise ("Karen"/"McConnell") and keeping the branding ("PRINT","TRACKER",
"printtrackerpro","Sent","Subject"). Cross-sample so it's layout-agnostic (also strengthens
invoice/worksheet fingerprints). Runs: (1) a lazy STARTUP BACKFILL (~14s) over every template
with docs but no fingerprint — fixes existing ones with no re-teach; (2) `promote-to-template`
(so a teach-created born-digital template isn't born empty); (3) an admin "Regenerate
fingerprint" button (Template Manager, force overwrite, beside "Regenerate landmarks") +
`regenerate-template-fingerprint` IPC. FILLS an empty fingerprint only (never clobbers a
stabilised one) unless forced.

**Field variability is EVIDENCE-based, not schema-guessed** (`_buildTemplateFields`
in review/handler.js): a confirmed field is frozen as a template `fixed_value`
ONLY when it's truly constant. The schema heuristic (`_annotateFieldVariability`)
was invoice-centric — it froze any non-ref/non-date field, which wrongly pinned a
worksheet `customer` to one stale value. Now a field with ≥2 DISTINCT confirmed
values for the doc type is treated as variable and never frozen (the cost of a
false "variable" is a harmless re-extract; a false "fixed" commits a wrong value
on every other doc). Self-heals an already-frozen field on the next confirm.

**Admin-LOCKED fixed values** (migration 31, `template_fields.fixed_locked`): a
fixed value an admin explicitly sets in the Template Wizard is a DELIBERATE,
protected override — distinct from the auto-derived non-variable seed above.
`fixed_locked = 1` → template_matcher emits method `template_fixed_locked` (vs the
overridable `template_fixed`); `_upsertFields` preserves the locked value across
confirmed-history rebuilds; `setFieldFixedValue` sets/clears the flag. engine.extract
guards it from ordinary keyword/anchor/identity-rescue overrides (it still yields to
a curated Stage 0.5 mapping and to `keyword_override`, and an authoritative ⊕ anchor
still wins via Tier A). Guarded by `database/modules/test_fixed_locked.js` +
test_precedence.py.

**Fixed Supplier Name is IMMUNE to the logo fallback** (engine `_doctype_fixed_supplier`,
2026-06): a doc type whose Supplier Name (`supplier_name`) is an admin-fixed template
field has a DETERMINISTIC supplier, so a logo guess must never fill it. The logo
supplier fallback runs only `if not supplier_name` — but when NO template matched the
fixed value was never seeded, so a polluted/colliding logo phash filled `supplier_name`
with a WRONG supplier (the "City Office NI on a Print Tracker doc" bug: the same logo
learned under several recipient companies, `findLogoMatch` returns the global-closest).
Now, before the logo fallback, when the doc type IS known the engine looks up that doc
type's fixed Supplier Name across ALL templates for its slug (prefers a LOCKED value;
uses a plain fixed value only when every candidate AGREES — ambiguous → skip, never
guess) and seeds it (method `template_fixed[_locked]`), skipping the logo. Returns None
when there's no unambiguous fixed value, so every other doc type's logo path is
byte-identical. Reusable for any fixed-supplier doc type, independent of template-match
reliability. Guarded by tests/test_fixed_supplier_immune.py.

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

**EMPTY required fields weigh the score down** (`validator.overall_confidence`,
2026-06-28): when the scored fields come from the type's SCHEMA, an expected
(required) field that is EMPTY now counts as **0** in the average — so a doc with
one good field and several empty required fields no longer reads as high/green (the
"72% with two empty fields" bug). The hard-coded fallback (no `field_defs`) keeps
the old present-only average (those keys may not exist for a type). Guarded by
tests/test_confidence_empty_fields.py. (KNOWN TRADE-OFF: a type whose required
date/ref is legitimately ABSENT on some layouts will be over-flagged — there's no
"required but sometimes absent" notion yet.)

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
- Output root stored in settings table as `output_folder` (set on Settings →
  General; NOT changed by the rules below).
- Duplicate: append `-DUPLICATE` (then `-DUPLICATE-2` etc)
- **OUTPUT STRUCTURE is now BUILDER-driven** (Settings → "Output Structure" tab,
  renamed from "File Naming"; `src/modules/filing/filename_pattern.js`), both
  token "block" builders (click-to-insert + custom text + live preview):
  - **Subfolders** = `output_folder_pattern` setting — a token string where `/`
    starts a new subfolder level. Default `{supplier}/{year}/{month}` = the legacy
    Company/Year/Month layout, so installs that never change it are byte-identical.
    `buildFolderSegments` token-substitutes + Windows-safes EACH level (illegal
    chars stripped, reserved device names defused) and DROPS empty levels; the
    handler still enforces the output-root containment check on the joined path.
  - **Filename** = `filename_pattern` setting (default `{docType}.{date}.{ref}` =
    `DocType.DD-MM-YYYY.RefNo.pdf`) — the existing `buildFilename` engine, unchanged.
  - Builder blocks (`FIELD_TOKENS`): Company `{supplier}` · Document Type `{docType}`
    · Date `{date}` · Reference `{ref}` · Year `{year}` · Month `{month}`. The
    same builders appear in the first-run wizard's "Output organization" step.
  - filing/handler.js IPCs: `get-output-structure-info` (blocks + defaults),
    `preview-output-path` ({folderPattern,filenamePattern} → sanitised segments +
    filename). Guarded by test_filename_pattern.js.

---

## Default document types
| Type | slug | ref_field_key | date_field_key |
|---|---|---|---|
| Invoice | invoice | invoice_number | invoice_date |
| Sales Order | sales_order | sales_order_number | order_date |
| Purchase Order | purchase_order | po_number | po_date |

**STRUCTURAL fields (Document Issuer / Date / Reference) are PERMANENT** (migration 27,
`document_types.js`): every type has three locked roles — the COMPANY/identity
field (`COMPANY_KEYS` = supplier_name | customer_name), the `date_field_key`, and
the `ref_field_key`. The identity field's DISPLAY label is **"Document Issuer"** for
BOTH keys (migration 38, 2026-06-28 — one unambiguous label so an operator never
enters variable data like a customer name in the identity field; supersedes the
migration-35 "Supplier Name"/"Customer Name" split and the migration-27 "Company").
Label-only — the internal KEYS (supplier_name/customer_name) + learning schema are
untouched. (Deferred: customer_name may later become a SEPARATE recipient field on
issuer-style types, with supplier_name as the sole identity — a data-model change.)
They drive filing
(`Company/Year/Month/DocType.Date.Ref`) AND all per-supplier learning
(logo_fingerprints/hints/anchors/corrections/template identity key off the company
scope value), so the FIELD can't be deleted, disabled, renamed or retyped — but the
per-document VALUE stays editable (correcting a mis-read is what feeds learning).
The internal key stays `supplier_name`/`customer_name` (only the display LABEL
changed — "Supplier Name"/"Customer Name") so the learning schema is untouched. `is_structural` is annotated on each
field (getWithFields/getAllWithFieldsAll) for the Settings UI (locked toggle, no
delete, 🔒). `updateField`/`deleteField` enforce it server-side;
`create-doc-type-with-fields` injects a Company field if the caller omits one.
Guarded by `database/modules/test_structural_fields.js`. (NOTE a latent nuance: the
engine's universal scope key is `supplier_name`, but sales orders carry the company
as `customer_name` — label-only unification here; a key reconciliation is deferred.)

**PRESET DOCUMENT-TYPE CATALOG** (Settings → Document Types → "Add from catalog…";
`database/modules/document_types.js` `PRESET_CATALOG`/`getPresetCatalog`/`addPresetTypes`):
a shipped library of ready-made types a business TICKS to add — Purchase/Sales Invoice,
Remittance Advice, Credit Note, Delivery Note, Statement, Receipt, Quote. Ticking one
ATOMICALLY creates the type + fields + structural roles (reuses
`create-doc-type-with-fields`/`ensureStructuralRoles`) AND seeds its likely field-label
aliases into `field_label_overrides` (per-install, doc-type-scoped — see
`keyword.merge_label_overrides`), so Stage-1 anchored extraction has a head start with NO
teaching. Slug is DERIVED from the name (`presetSlug`, mirrors `addType`); idempotent
(re-add = no-op); catalog types are `built_in=0` (fully removable). The two invoice
DIRECTIONS carry the correct company identity — **Purchase Invoice → `supplier_name`, Sales
Invoice → `customer_name`** — so filing/learning scope is right from the start. reggie-
reviewed labels: only DOC-SPECIFIC captions + the NOVEL ref/date fields are seeded;
canonical fields (supplier/customer/invoice_*/total) defer to the shipped
`keyword_patterns.json` `field_patterns` (single source of truth, no drift); bare generics
("From"/"Date"/"Amount"/…) dropped (un-shipped fields had no Stage-1 gate — now closed by
the override validation-by-role above, but the lists stay tight). Phase 2 (DEFERRED): narrow
DETECTION by the enabled-type set so "tick only what I use" also cuts cross-type confusion
(today the shipped `document_type_keywords` buckets always score regardless of `enabled`).
Guarded by `database/modules/test_doctype_presets.js`.

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
mailbox UI) · `cert-tool/` (standalone cert-generator GUI) ·
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

**Tests** (Electron-as-Node): `src/services/test_{certservice,workflow,entitlement,
session}.js`, `src/modules/api/test_{cert_wizard,v1_ca,v1_enroll,v1_workflow,v1_*}.js`,
`src/modules/review/test_workflow_lock.js`, `src/modules/workflow/test_workflow_ipc.js`,
`client/test_apiclient.js`.

---

## UI conventions
**Shared theme** — every window's palette + components are centralised in
`src/windows/shared/theme.css` (loaded by all windows) + `theme.js`. **SIX named
themes** (2026-06-28): Light · Warm Paper · Nordic Slate (light family) · Dark ·
Midnight · Graphite (dark family). Each is a `:root[data-theme="X"]` token-override
block; **Warm Paper is the default**. `theme.js` sets BOTH `data-theme` (palette)
AND `data-mode` (light|dark family) on `<html>` — `color-scheme` + the logo swap
key on `data-mode` so all dark themes get native dark scrollbars/logo. `--on-accent`
token = text colour on a filled accent (lets Midnight's amber use near-black text).
Subtle background patterns are pure CSS gradients (CSP-safe — NO `url(data:…)`, which
`img-src 'self'` blocks) on the shell `--bg` only (Warm=dots, Slate=grid, Midnight=
glow; others flat). Picked via Settings → General → Appearance `<select>`; the
account menu + the main-window rail-foot toggle are a quick Light⇄Dark flip
(mode-aware). `set-setting('theme',…)` persists + broadcasts `theme-changed` live.
Windows reference the tokens and no longer define their own `:root`.
```css
/* light (default) — the client palette */
--bg:#f4f6fa  --surface:#ffffff  --surface2:#eef1f7  --surface3:#e4e8f1
--border:#e4e7ef  --border2:#d2d8e4
--accent:#3b7df0  --accent2:#2f6fe0  --accent-bg:#e7f0ff
--ok:#1f9d63  --warn:#b07816  --err:#d64545
--text:#1b1f2a  --muted:#69728a  --doc-bg:#eef1f7
--r:12px --r-sm:9px --r-pill:999px        /* rounded buttons / inputs / cards */
Font: IBM Plex Sans (UI) + IBM Plex Mono (values/code) — SELF-HOSTED woff2
(latin subset, OFL-1.1) in src/windows/shared/fonts/ + @font-face in theme.css.
NO Google-Fonts CDN (was a per-window offline/privacy leak); every window's CSP
is now font-src 'self'. Don't reintroduce a CDN <link>.
```
- **Native OS window frames** (`main.js` `frame:true`). The old custom drag
  titlebars are hidden globally (`html #titlebar,.titlebar{display:none!important}`
  in theme.css). The main window's bar is renamed `#topbar` and kept as a real toolbar.
- **Self-contained child windows** (review/settings/search/teach/dev-inspector):
  opened **modal** to the focused parent, **`skipTaskbar`** (no second taskbar
  icon), start **maximised** with user resize remembered (`applyWindowState` →
  `window-state.json`).
- **Settings & Review use a left-sidebar shell**; buttons/inputs are the rounded
  client-style components from theme.css.
- **Help-mode** (`src/windows/shared/helpmode.js`): elements tagged `data-help-key`
  highlight and deep-link into the User Guide window (`src/windows/help/`).
- **List thumbnails** (`src/windows/shared/thumbs.js`): page-1 PDF thumbnails in the
  Review queue, Search results, and the Teach doc-picker, lazy per visible row
  (IntersectionObserver) + a per-window in-memory cache. ONE shared IPC
  `get-document-thumbnail` → `previewService.getThumbnail` → `render/pages.py --thumb`
  (single low-res page; reuses pypdfium2 — no new dep). GOTCHA: the observed element
  must have a layout box — `display:none` starves IntersectionObserver, so the teach
  card uses a `visibility:hidden` overlay (review/search use a visible placeholder box).
- **About box** (core: user-menu "About ScanFinder…"; client: sidebar "About"): app +
  Electron version + copyright (read from package.json `build.copyright`) + a
  "Third-Party Licenses" button that opens the bundled notice via `shell.openPath`.
  IPC `get-app-about`/`open-third-party-licenses` (core), `client-about`/
  `client-open-licenses` (client). See License compliance.
- **Review queue** mirrors the Search results list: plain scroll + click (no arrow
  rail; ↑/↓ keys still cycle), and a **draggable splitter** makes the file column
  width adjustable (persisted in localStorage).

---

## IPC reference

### Renderer → Main (invoke — returns promise)
```
pick-folder, pick-output-folder, process-folder(folderPath)
get-document-types, get-all-doc-types
add-document-type(data), update-document-type(id,changes)
add-field(data), update-field(id,changes), delete-field(id)
get-validation-patterns                # validation_patterns from config (cached) — Review on-blur field validation
create-doc-type-with-fields({name,fields[],ref_field_key,date_field_key})  # transactional; teaching wizard
get-doctype-catalog, add-doctype-presets(slugs[])   # preset doc-type catalog (admin) — see Preset document-type catalog
get-teach-target                       # docId the teach window was opened at (pulled once on load)
get-review-queue, get-deferred-queue, get-review-count, get-deferred-count
get-document-with-extractions(id), get-document-pages(id,folderPath,filename)
get-document-thumbnail(id,folderPath,filename)   # page-1 low-res thumb (shared/thumbs.js)
get-app-about, open-third-party-licenses          # About box: version + open the bundled notice
confirm-review(payload), defer-document(id), restore-deferred(id)
delete-document(id,filePath), reprocess-document({docId,folderPath,filename})
ocr-region(base64), save-field-anchor(data)
extract-logo-hash(base64), match-logo-hash(base64), save-logo-fingerprint(data)
search-documents(params)
get-setting(key), set-setting(key,value)
get-output-structure-info, preview-output-path({folderPattern,filenamePattern})  # Output Structure builders
settings-backup-export({password}), settings-backup-preview({password}), settings-backup-apply({path,password})  # admin; see Settings backup
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
process-trace(ev)                      # dev-inspector + (when its console is active) the REVIEW window; never the main window. See Dev inspector / Review trace console
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
- **On-blur field validation** (`appendFieldRow`): an edited field is validated on
  focus-out against the field's regex/TYPE, using the SAME `validation_patterns`
  the Python extraction qualification uses — fetched once via the new
  `get-validation-patterns` IPC (reads `config/keyword_patterns.json`) and compiled
  to `RegExp` in the renderer, so UI and pipeline can't drift apart (`field.type` →
  validation key mirrors engine.py's `_TYPE2VAL`; also reuses the learned
  `digit_only_fields` signal already attached to the doc). WARN-ONLY: sets a
  lightweight inline red note (`.field-validation-warn`) + invalid border; NEVER
  disables Confirm (an operator can still file an OCR edge case — mirrors
  extraction's review-not-reject philosophy). Synchronous, no IPC/reprocess on
  blur, no re-render or focus change (so clicking Confirm can't race it); the
  warning clears eagerly on `input` and is re-evaluated only on blur (no mid-type
  flashing). free-text/`multiline_text` have no constraint.

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
- **Steps (6):** welcome + offline/privacy note → **output folder** (the ONLY
  required step: pre-filled `Documents\Scan Finder` via `onboarding-suggested-folder`,
  write-validated by `onboarding-validate-folder` which mkdirs + probes; ALSO carries
  the **"Copy processed scans to another folder?"** question) → **output
  organization** (the same folder + filename block builders as Settings → Output
  Structure, pre-filled with defaults) → theme (light/dark, live) → performance
  (threads presets + speed/accuracy mode) → done. "Skip setup" accepts defaults but
  still secures a writable output folder. (Adding a step = bump STEPS + NEXT_LABEL
  and renumber the `data-step` panels in onboarding/index.html.)
- Writes go through the EXISTING `set-setting` path (theme broadcasts live via
  `theme-changed`); the wizard owns only the FLAG + the window/shell swap. The
  output-organization step writes `output_folder_pattern` + `filename_pattern`.
- **Copy-after-processing** (`copy_after_processing_enabled` / `_folder` settings):
  the wizard collects the toggle + destination, but the DOWNSTREAM copy behaviour is
  a deliberate SEPARATE follow-up — nothing consumes these keys yet (the deferred
  "backup-with-retention" subsystem is the real copy+prune workstream, NOT a phantom
  toggle).

---

## Settings backup / restore (admin)
`src/services/backupService.js` + Settings → **Advanced → Backup & Restore**. Exports
the operational config to ONE password-encrypted file and restores it after reinstall.
- **Crypto**: scrypt KDF → AES-256-GCM over gzipped JSON (authenticated, so a wrong
  password / tampering fails cleanly). Binary file `MAGIC|ver|salt|iv|tag|ciphertext`;
  password never stored. No new dependency (node `crypto`).
- **Scope INCLUDED**: settings (minus any `licens*` key), document_types, fields,
  templates + template_fields/field_mappings/landmarks/logo_hashes/groups,
  field_label_overrides, field_anchors, supplier_hints, corrections, logo_fingerprints.
  **EXCLUDED**: users, recovery_codes, audit_log, device_registrations, license_tokens,
  client_seats, document_routes, documents, extractions, migrations.
- **Restore**: ONE transaction with `PRAGMA defer_foreign_keys=ON`; `settings` is
  MERGED (upsert — never wipes device/licensing keys), every other whitelisted table
  is REPLACED (delete + insert with original IDs). Two-step UI: preview(decrypt+counts)
  → confirm → apply; restart recommended. Forward-compatible (only restores columns
  that still exist). Guarded by test_backupservice.js.
- **DEVICE-BOUND IMPORT (anti-trial-stacking)**: the export embeds the licensing device
  fingerprint (`device_fp` = `computeFpHash(product_id)`, already a SHA-256 — never the raw
  machine id) in the payload. On import (`-preview` AND `-apply` both gate, via
  `settings/handler._deviceImportAllowed`), a backup from a DIFFERENT machine is REFUSED
  unless THIS machine holds an active paid SEAT (`licensing.getActiveToken().kind==='seat'
  && state!=='revoked'`) — so a fresh trial on a new VM/PC can't import another machine's
  learned data/settings to dodge the trial, but a paying customer can still migrate to a new
  PC (activate there first, then import). Same-machine restore (matching fp) always allowed;
  legacy backups (no `device_fp`) and dev boxes with no license config are NOT blocked. A
  denied apply is audited (`outcome:'failure', reason:'device_mismatch'`).
- IPCs (admin): `settings-backup-export` / `-preview` / `-apply`.

## Main window — "Review your documents" CTA
After a batch finishes, a green "✓ Review your documents" button appears in the sidebar
below Process Documents (where Stop was) and opens the Review window. Shown only when
`stats.done > 0`, reset on each run start, gated like the Review nav (hidden for
read-only). Complements the "View Results" 3-field table, doesn't replace it.

## Help-mode + modals gotcha
`shared/helpmode.js`'s active capture-phase click interceptor (shows help INSTEAD of
activating a control) used to swallow clicks inside in-page modals — a destructive
typed-confirm dialog (Erase ALL data) then looked broken (couldn't click/type). Fix:
help-mode skips any element under `[data-help-ignore]`; the custom modals
(showTypedConfirmDialog, showSecretDialog) set it. SEPARATELY, those modals now defer
`input.focus()` to `requestAnimationFrame` (focusing an element the same tick it's
appended is dropped by Chromium → "no flashing cursor") + a click-to-focus fallback.

## Teaching wizard (guided, non-technical)
`src/windows/teach/` — a dedicated, linear "Teach a new document" wizard for
first-time/non-technical users; opened from the main launchpad card "Teach a
document" (Admin+Edit) or `open-teach-window-at(docId)`. Steps: welcome → choose
the scanned doc (from the review queue) → pick or CREATE a doc type (friendly
field setup + plain-English "main number"/"date" key questions) → point out each
field by drawing a box around its VALUE (live OCR read-back; the wizard
auto-detects the nearby label as the anchor) → review → commit → honest learning
explainer.
- **Auto-flow (2026-06):** after a value read-back is confirmed it auto-advances
  value → anchor → next field (no manual "mark the label"; "Skip label →" keeps the
  auto-detected anchor). A field that doesn't vary per document can be set as a
  **fixed value** (inline text, no drawing) → saved on commit via
  `setTemplateFieldFixed` (locked, survives rebuild — see Admin-LOCKED fixed values).
  `autoLabel()` requires ≥3 alpha chars from the left band (drops noise). Field type
  selector offers Text/Date/Currency/Number. (All curly-quote HTML attrs must stay
  STRAIGHT — smart quotes silently break the injected buttons' class/id.)
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
- **Review trace console** (same key combo Ctrl+Shift+D+M, pw SFDEV, inside the
  REVIEW window — `src/windows/review/{index.html,renderer.js}`): a hidden
  right-side drawer for debugging extraction PRECEDENCE. Reuses the SAME trace
  stream — no new schema. On unlock it calls `review-trace-set(true, pw)` (verified
  in main, opens NO window) which sets `ctx.reviewTraceActive`; processing/handler
  then enables `--trace` (`traceWanted()`) and tees `process-trace` to the review
  window too (`routeTrace`). Per field it lists each stage's candidate
  (stage·value·confidence·method), won/lost (+reason), anchor_reject reasons,
  Stage 2.5 transforms (denoise/correct, from→to), Stage 4/4.5 validation rows
  (the note + value change behind a held/flagged/emptied value — e.g. a Stage 4.5
  withhold), and the final winner. "Reprocess (trace)" reuses the existing reprocess flow;
  events are buffered live (a reprocess runs under a temp filename, so no filename
  filter), with a `devGetSessionDoc` pull for already-processed docs.
  REVIEW-CONSOLE ADDITIONS (2026-06): (a) CLICK-TO-HIGHLIGHT — clicking a candidate/
  reject/validate/final row whose slice was captured draws the crop region on the
  page over a dedicated `#trace-canvas`. The candidate→slice match is by EXACT
  extraction METHOD (METHOD_TO_SLICE), never the coarse merge stage; coordinate
  convention is explicit (`_CENTRE_BASED_SLICE_STAGES` = anchor_crop/relocate/
  registration are centre-based; template_mapping + the inline harvest's inline_box
  are top-left); inline winners now emit a region (anchor.inline_box) so the WINNER
  is highlightable; a method with no crop region draws no box (honest). (b) REGEX
  SCORE — an "rx N%" badge on every value where a pattern check applies (% of the
  value the field's validation_pattern matches), using the SAME validation_patterns
  + a JS mirror of engine `_is_ref_field` coercion (validationKeyFor: a ref field
  typed Number/Currency scores as alphanumeric, not currency — also fixes the on-blur
  validator). (c) VALIDATION "WHY" — each validate row gets a plain-English sub-line
  (value rewritten / suggestion / kept+flagged, plus a reading of the note).
  (d) ANCHOR BOX ALONGSIDE THE VALUE (2026-06) — clicking a row now draws BOTH the value
  box (amber) AND the field's located anchor/label box (blue) together (drawTraceBbox gains
  a `keep` layered-draw; anchorSlice() pulls the kind="anchor" slice). For Stage-2 anchors
  the backend emits an `anchor_label` slice for the located label EVEN when the rigid crop
  succeeded (anchor.py, trace-only) — so you can SEE a label that didn't locate / located on
  the wrong row. Highlight dwell is 30s (was 3.5s; still clears on next click/page/doc).
- **Extraction trace** (`type:"trace"` stdout, separate `process-trace` channel,
  routed to the inspector + the review console when active): emitted by
  `engine.extract(trace=…)` ONLY when `process_docs --trace` is set, which handler
  adds ONLY while the inspector/review-console is open or diag logging is on →
  normal processing is byte-identical (no overhead/output). Events:
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

## License compliance (third-party OSS) — see `COMPLIANCE.md` (canonical)
The shipped product bundles permissive/notice-style OSS (no GPL/AGPL); the only
copyleft is weak/file-level (FFmpeg LGPL-2.1 via Electron, a couple of MPL-2.0
files). Compliance is automated:
- **`THIRD-PARTY-LICENSES.txt`** (core, repo root) + **`client/THIRD-PARTY-LICENSES.txt`**
  ship via each app's `build.extraResources`; surfaced in-app via the About box.
- **`scripts/check-licenses.js`** — prebuild GATE (wired into `npm run build`, also
  `npm run check:licenses`). Enumerates the Node prod-dep tree + bundled
  `vendor/python` packages, classifies each license ALLOWED / DENIED(copyleft) /
  UNKNOWN against an allowlist, exits 1 on any DENIED/UNKNOWN so a dependency bump
  can't silently ship a bad license. Dual `A OR B` passes if either side is allowed
  (elections: node-forge→BSD-3, expand-template→MIT, rc→MIT, packaging→Apache-2.0).
  MPL-2.0 is allowed (we ship unmodified source). Exports its collectors.
- **`scripts/gen-third-party-notices.js`** — rewrites the notice's INVENTORY section
  from the gate's data + re-stamps the product version (package.json) and date; leaves
  the curated copyright/license-text sections alone.
- **Release**: on the build machine (where `vendor/python` exists) bump versions →
  `npm run check:licenses` → `node scripts/gen-third-party-notices.js` → `npm run build`.
- When a new license FAMILY appears, add its text to section 3 of the notice + its
  name to the intro list (the generator does NOT manage section 3). Editing the
  notice's whole license text in one Write trips the API content filter — author the
  short parts, then APPEND long texts (fetched to files) via a script.

## Dev workflow
```bash
cd C:\docusnap2
npm start          # dev mode — uses system Python + Tesseract; licensing enforcement OFF
npm run build      # → dist\ScanFinder Setup <ver>-r<rev>.exe  (rev = scripts/build-rev.js, or $BUILD_REV)
```
Dev uses `py -3.12 script.py`, packaged uses bundled Python venv.
Tesseract hardcoded to `C:\Program Files\Tesseract-OCR\tesseract.exe` in dev.

**Build notes**: electron-builder **v26** (the old `win.sign` / `win.signingHashAlgorithms`
keys are removed — don't re-add them). `postinstall` runs `install-app-deps`; native deps
(`argon2`, `better-sqlite3`) are auto-rebuilt for the Electron ABI during build. Installer is
**unsigned** → SmartScreen "More info → Run anyway" on the VM. Run gate tests with
Electron-as-Node, not plain node (native-module ABI).

**Versioning (policy: manual SemVer + automatic build stamp — Eric+Gary consensus).**
THREE INDEPENDENT axes: the core app version, the client app version, and the `/v1`
contract version (`API_CONTRACT_VERSION` in `src/modules/api/handler.js` — the real
client↔server compatibility signal; never gate licensing on it). Bump `package.json`
`version` **manually, at release only**, git-tagged (MAJOR breaking/licensing-tier · MINOR
feature/add-on · PATCH fix) — do **NOT** auto-bump per build (it churns git + pollutes the
number licensing/support reads). Every build is still made DISTINCT + traceable by an
automatic stamp: `scripts/build-rev.js` `buildRev()` = `<UTC yyyymmdd-hhmm>-<git short sha>`
(or `BUILD_REV` verbatim), carried by both `nsis.artifactName`s as `-r${env.BUILD_REV}` →
e.g. `ScanFinder Setup 2.0.0-r20260622-1133-9f158c5.exe`, AND baked into the packaged
`package.json` via `--config.extraMetadata.buildRev` so the **About box** self-reports
`Version <ver> (<rev>)` (unpackaged dev reads the live git sha). Release ritual: bump
`version` → `git tag` → `BUILD_REV=<version> npm run build` (optionally branch artifactName
to drop the `-r<ver>` for a clean `ScanFinder Setup 2.1.0.exe`).

Delete `%APPDATA%\DocuSnap\docusnap.db` to reset DB during development (also clears users,
cached license tokens, and the enforcement setting).
Delete `python_backend/**/__pycache__` if Python changes don't take effect.
Packaged build remembers prior login/trial because that DB persists across reinstalls
(NSIS `deleteAppDataOnUninstall:false`). Licensing enforcement is ALWAYS ON (no env/setting/
dev bypass) — dev must run against a real backend trial/seat for the machine's fingerprint.
