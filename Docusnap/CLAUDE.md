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
│   │   ├── processing/handler.js        # folder import, reprocess, OCR region, logos
│   │   ├── processing/processing_mode_handler.js # mode get/set, fast-mode suggestion
│   │   ├── review/handler.js            # queue, confirm, defer, delete, pages
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
│       ├── main/{index.html,renderer.js}      # incl. empty-state launchpad (Begin Import · Search · Settings · Teach a document)
│       ├── splash/{index.html,splash.js}      # cosmetic startup splash — shown in whenReady, closed once login loads
│       ├── review/{index.html,renderer.js}    # incl. zoom/pan preview + hidden admin Template Wizard (⚓): draw anchor/target → save via existing template-mapping IPC; "Show where it reads" overlays (amber) the RESOLVED anchor/target on the current page via test-template-mapping → template_mapper.resolve_geometry (so the operator sees the mapping TRACK a shifted scan, vs the static drawn boxes)
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
│   │   ├── template_mapper.py           # Stage 0.5: admin-drawn anchor→target zone mapping; absolute-first read, then registration transform, then single-label refinement
│   │   ├── registration.py              # "register, then read": NumPy similarity/affine RANSAC fit (taught landmarks→page) + confidence; no OpenCV
│   │   ├── keyword.py                   # Stage 1: regex pattern matching (incl. job_no 4-4-1 shape, separator-normalised)
│   │   ├── anchor.py                    # Stage 2: spatial anchors + logo match
│   │   ├── ocr_corrector.py             # Stage 2.5: learned OCR misread correction
│   │   ├── llm.py                       # Stage 3: phi3:mini via Ollama (dormant — 'ai' mode not exposed in UI)
│   │   ├── validator.py                 # Stage 4: cross-field validation
│   │   ├── value_quality.py             # name/company/address quality (name_quality, is_name_like_field) — JS mirror in learning.js
│   │   ├── text_normalise.py            # deterministic compare-time normaliser (NFKC/dash/quote/lower/ws/edge); JS twin database/modules/text_normalise.js
│   │   └── name_match.py                # Stage 4.5 token-level canonical NAME repair (lexicon + positional repair); suggestion-only
│   ├── ocr/{tesseract.py,region.py,landmarks.py,text_enhance.py,born_digital.py}  # region.py: interactive draw-tool zone-OCR (review ⊕ picker, Template Wizard read-back, Template Manager) + --boxes label-position capture; LIGHT-FIRST ladder mirroring anchor._crop_and_ocr (light greyscale+upscale-small-only read first, heavy autocontrast+sharpen only when light is EMPTY) so a drawn box reads the SAME as extraction and clean born-digital crops aren't mangled into junk ("Serial number"→"be_7"); landmarks.py: derive registration landmarks from sample page; text_enhance.py: degraded text-line re-read (denoise+Sauvola+unsharp), text-only gate-triggered escalation; born_digital.py: read EXACT text + word boxes from a PDF's embedded text layer (pypdfium2 BSD), skipping OCR for generated PDFs (gated by born_digital_enabled)
│   ├── logo/fingerprint.py
│   └── render/pages.py                 # PDF→PNG rendering — shared by review/search/template preview (see Gotchas)
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
             rows). (Stage 2 anchor arbiter: deferred.) This REPLACED the old translation-only
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
           ── 2026 RELIABILITY PASS (find → follow → read, across doc types) ──
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
             PATTERN-BASED FIELD CORRECTION (Phase 1, SUGGESTION-ONLY — commit
             09a4c62): two helpers run in the Stage 4.5 loop on the WINNER value
             only; both set ONLY corrected_to + validation_note + conf≤70, NEVER
             value/display_value (no auto-correct, no precedence change, no candidate
             swap). (1) TOKEN-LEVEL NAME REPAIR (name_match.py + text_normalise.py):
             for name-like fields, builds a per-(supplier,doctype,field) token
             lexicon from confirmed value_counts (stable token = doc-freq ≥0.6 AND
             ≥3 docs, deterministic canonical surface) and repairs garbled KNOWN
             tokens to their canonical spelling while keeping the VARIABLE tail
             verbatim ("eeaument care homes - lisburn" → "Beaumont Care Homes -
             lisburn") — never whole-value snaps, never injects a learned token,
             positional + thin-evidence guards, idempotent. Runs INDEPENDENT of
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

**STRUCTURAL fields (Company / Date / Reference) are PERMANENT** (migration 27,
`document_types.js`): every type has three locked roles — the COMPANY/identity
field (`COMPANY_KEYS` = supplier_name | customer_name; label relabelled
**"Company"**), the `date_field_key`, and the `ref_field_key`. They drive filing
(`Company/Year/Month/DocType.Date.Ref`) AND all per-supplier learning
(logo_fingerprints/hints/anchors/corrections/template identity key off the company
scope value), so the FIELD can't be deleted, disabled, renamed or retyped — but the
per-document VALUE stays editable (correcting a mis-read is what feeds learning).
The internal key stays `supplier_name`/`customer_name` (only the display LABEL is
"Company") so the learning schema is untouched. `is_structural` is annotated on each
field (getWithFields/getAllWithFieldsAll) for the Settings UI (locked toggle, no
delete, 🔒). `updateField`/`deleteField` enforce it server-side;
`create-doc-type-with-fields` injects a Company field if the caller omits one.
Guarded by `database/modules/test_structural_fields.js`. (NOTE a latent nuance: the
engine's universal scope key is `supplier_name`, but sales orders carry the company
as `customer_name` — label-only unification here; a key reconciliation is deferred.)

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
setting): the SINGLE gate. `checkClientEntitlement(db)` → `{entitled,feature}`; gates
BOTH the detached client API and the in-core enhanced search. Manual/admin for now
(licensing-driven wiring later). Exposed to the renderer via `get-entitlement`.

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
`src/windows/shared/theme.css` (loaded by all windows) + `theme.js` (sets
`data-theme` on `<html>`, persists the choice). **LIGHT is the default** (`:root`);
DARK is the opt-in (`:root[data-theme="dark"]`). The palette is matched to the
detached search client. Windows reference the tokens and no longer define their own
`:root` (the help window's `help.css` was the last self-token holdout — now linked
to theme.css too).
```css
/* light (default) — the client palette */
--bg:#f4f6fa  --surface:#ffffff  --surface2:#eef1f7  --surface3:#e4e8f1
--border:#e4e7ef  --border2:#d2d8e4
--accent:#3b7df0  --accent2:#2f6fe0  --accent-bg:#e7f0ff
--ok:#1f9d63  --warn:#b07816  --err:#d64545
--text:#1b1f2a  --muted:#69728a  --doc-bg:#eef1f7
--r:12px --r-sm:9px --r-pill:999px        /* rounded buttons / inputs / cards */
Font: IBM Plex Sans (UI) + IBM Plex Mono (values/code)
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
  filter), with a `devGetSessionDoc` pull for already-processed docs. Crop-slice
  thumbnails deferred (inspector-only).
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
