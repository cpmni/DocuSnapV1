# DocuSnap v2 — Project Memory for Claude Code

> Read this file before every response. Do not summarise it back to the user.
> Read only the specific source files needed for the current task.

---


## Extended reference (read the relevant doc on demand)
This file is the lean index. Deep detail lives in `docs/` and is loaded ONLY when a task
touches that area — read the pointed-to doc BEFORE working in it:
- `docs/extraction-pipeline.md` — full Stage 0–4.6 internals, drift/registration/label-lock/
  slip-fix/multiline design, OCR recipes, performance + confidence calibration. **Read before
  ANY extraction/anchoring/OCR/validation change.**
- `docs/licensing.md` — license gate internals, offline token verify, PHP backend, admin 2FA, Legal/Terms gate.
- `docs/detached-client.md` — the `/v1` TLS API, cert wizard, entitlement/workflow gates, presence, harnesses.
- `docs/features.md` — first-run wizard, welcome tour, settings backup, Learning Repair, teaching wizard, dev inspector.
- `docs/history.md` — resolved QA/audit findings + build-stage history (Settings/Review/Search/Stage-7 rebuilds).

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
│   │   ├── processing/handler.js        # folder import, reprocess, OCR region, logos; BACKEND 100% AUTO-FILE (_maybeAutoFile/_autoFileDoc, hooked in _handleFileMessage): a fully-typed, un-flagged, overall_confidence===100 doc files itself the moment it's processed — MANUAL import + WATCH folder + background alike (window need not be open), reusing filing.commitDocument + documents.confirm, gated by auto_file_full_confidence; records ids in a rolling `recent_auto_filed` setting; emits 'doc-auto-filed'. (Reprocess-All keeps the renderer-side review.autoCommitFullConfidence.) CONFIGURABLE THRESHOLD (2026-07, `auto_file_threshold` setting, default 100 = full-confidence-only, Settings → Processing slider 80-100): a doc auto-files when overall_confidence ≥ the threshold. The type + un-flagged gate is the real safety — BELOW 100 the backend ALSO requires `needs_review` false (fully typed, no field flagged), and the renderer bulk path keeps its `!review_flag_count` filter — so lowering the slider only lets a clean, confident doc skip Review, never a flagged one. Pairs with the "confidence grows with learning" boosts: a regular supplier's reads climb toward ~98%, so a user who sees perfect docs at 98% can set the slider to 98 and have them auto-file.
│   │   ├── processing/processing_mode_handler.js # mode get/set, fast-mode suggestion
│   │   ├── review/handler.js            # queue, confirm, defer, delete, pages; Advanced→"View learning history" (get-field-value-history / purge-field-value / rename-field-value, admin/edit, audited) → learning.getFieldValueHistory/purgeFieldValue/renameFieldValue: list the confirmed values learned for a (supplier,doctype,field) scope (same final values getFieldFormats samples); PURGE a value that shouldn't exist (e.g. a "Booking" drift artifact) from extractions+corrections+supplier_hints so it stops polluting the learned shape; RENAME a value (oldValue→newValue across extractions+corrections, drops the stale hint) to fix an OCR slip ("$O2"→"SO2"). Review toolbar ⚙ Advanced button → flyout → sortable modal (click a heading to sort). Modal is NON-blocking (no backdrop, positioned left): the right fields pane stays lit + clickable and clicking a field LIVE-RELOADS the table for that field (focusin→loadLearningHistoryFor, active field highlighted .lh-active-field). Per-row 📄 "docs" toggle = learning.getDocumentsForFieldValue (get-documents-for-field-value IPC, admin/edit, read-only): reveals the CONFIRMED source documents that carry that learned value (same scope + final-value expression getFieldValueHistory groups by), each with an "Open in Review" button → renderer `_navigateToDoc(id)` loads the FILED doc in-place for re-checking (Edit-in-place, status stays confirmed; the allowRefile path re-files on confirm — so a bad learned value like "$4" can be traced to its docs + corrected). Per-row ✎ inline-edit (rename) + 🗑 delete-confirm; "Fix likely slips" button = renderer computeSlipFixes: a value differing from a ≥80% per-position column consensus at exactly ONE char that's a likely OCR slip (_likelySlip: a symbol where alnum expected, or a known confusion $↔S/0↔O/1↔I…) and whose corrected form matches the dominant shape or an existing value → proposes old→new, applies on confirm via renameFieldValue. Guarded by database/modules/test_field_value_history.js
│   │   ├── filing/handler.js            # folder structure, rename, XML metadata
│   │   ├── settings/handler.js          # doc types, fields, key-value settings
│   │   ├── templates/handler.js         # Admin Template Viewer — browse/pin samples, anchor→target mapping CRUD; Learning Recovery reassign (link-only, reversible) + MERGE (templates.mergeInto: fold a fragment's doc-links/missing-mappings/fields/landmarks/sample/identity into a canonical row, sum confirmed_count, delete source — IRREVERSIBLE; the cure for near-duplicate "same logo, drifted phash" template fragmentation). Guarded by database/modules/test_template_merge.js
│   │   ├── search/handler.js            # document search
│   │   ├── api/handler.js               # TLS /v1 API for the detached client + cert wizard + enroll (see Detached search client)
│   │   ├── workflow/handler.js          # desktop mailbox/approval IPC (entitlement+role gated; reuses workflowService)
│   │   └── licensing/handler.js         # license gate decideAccess() + trial/activate/revoke/enforcement IPC (see Licensing)
│   ├── lib/license/{client.js,token.js,fingerprint.js}  # backend HTTP client · offline JWS verify · device fp_hash
│   ├── services/{searchService,previewService,workflowService,reviewService,presenceService,entitlementService,certService,sessionService}.js  # transport-agnostic core (see Detached search client). presenceService = the "Currently being reviewed by <name>" signal: an in-memory Map<docId,Map<viewerKey,{username,displayName,lastSeen}>> SHARED SINGLETON (shared()) the desktop + /v1 API both publish to; TTL ~60s self-expires a crashed/disconnected viewer; ADVISORY ONLY (the atomic confirm is the authority, so stale presence can't cause a wrong outcome). heartbeat/release/releaseAll/viewers(excludeSelf). Guarded by src/services/test_presence.js. reviewService = createReviewService({deps}) → queue/deferred/counts/confirm/defer/restore, shared by the desktop IPC + (Phase 3) the /v1 client API; explicit actor {username,role} (auth+workflow-lock enforced at the edge). CONFIRM CLAIMS the doc atomically (documents.confirmIfReviewable) BEFORE filing so two confirms can't both file it (loser → ALREADY_FILED w/ the winner's name); re-file (already-confirmed) skips the claim — but ONLY when the caller passes an explicit `payload.allowRefile` intent (desktop renderer sets it ONLY when the doc was opened while ALREADY confirmed = "Edit in Review"; the /v1 client NEVER sets it, server-decided). Without that intent a confirm that RACED from the review QUEUE into an already-filed doc runs the atomic claim and loses cleanly (ALREADY_FILED), instead of the old last-writer-wins SILENT OVERWRITE of reviewer #1 (2026-06-30 audit finding; `documents.confirmIfReviewable` carries an unused `allowRefile` CAS branch, but reviewService gates the claim-SKIP on intent rather than routing through it — a claim-before-file would null the existing stored_path). CENTRAL DATE NORMALISATION (2026-07): confirm normalises every DATE-typed field's value (doc-type `date_field_key` + any type='date' field) to the core's canonical DD-MM-YYYY ONCE, via filing.normaliseDate (the same parseDate/formatDate the filename builder uses), BEFORE both filing and learning.saveCorrections — so whatever a client (desktop or /v1) submits ("Aug 03 2012", "2012-08-03", "3/8/2012") the STORED value, the FILENAME and the LEARNING corpus all agree, and no client re-implements date parsing (the "corrected date in the client isn't in the core's format" fix). Unparseable values are left as typed (never dropped). Electron-only steps (source-move, landmark capture, taught-confirm promote, count broadcast) are INJECTED hooks → desktop path byte-identical. Guarded by src/services/test_reviewservice.js + database/modules/test_documents_cas.js
│   └── windows/
│       ├── main/{index.html,renderer.js}      # DASHBOARD + NAV RAIL (2026-06-28 redesign, replaced the launchpad). LEFT RAIL = single nav: Home · Import · Review(badge) · Search · Teach · Settings + a rail CLOCK (time large/date small) + "Local only" + a Dark-mode quick toggle at the very foot. CONTENT = a view-router (showView 'home'|'import'); Review/Search/Teach/Settings still open as their own maximised child windows. HOME = attention-led dashboard in ONE auto-fit card grid (repeat(auto-fit,minmax(260px,1fr)) → no empty cells; full-width banners use .dash-span); content column centred + width-capped (clamp(1100px,92vw,1320px)). Cards: Needs-your-attention (review+deferred+stuck counts → Open Review, or "all caught up"); Documents-filed pulse (today/week/month from confirmed_at); Import quick-start; Auto-import (watch status + on/off switch + pick-folder, admin-only); Getting-smarter (suppliers+layouts learned); Where-your-files-go (output folder + Open folder via the open-folder IPC); trial banner (licenseGetDiagnostics, "N of 14 days", calm/warn/crit); first-run setup checklist (auto-hides); Recent activity (recent confirmed; refreshes live on confirm via refreshDashboardIfHome). updateAttention() is the CHEAP count-event repaint; refreshDashboard() (the searchDocuments query) runs on load / Home-open only. IMPORT VIEW = folder picker + Process/Stop + session stats + live results table (Company/Date/Reference/Status) + progress strip; "Filed"/"Needs review" rows open THAT doc via openReviewWindowAt(db_id). Processing text shows "Multi-page document (N pages)" via the file_pages event. Reprocess-All progress is a BANNER (review window). CARD SET EXPANDED + CUSTOMISABLE (2026-06-30): two-tier grid — TOP (Quick find · Needs-attention · Documents-filed · Filed-automatically=auto-file % · Getting-smarter · Did-you-know tips · Recent-activity) + FILES & FOLDERS (Auto-import · Import · Where-your-files-go · Storage=free disk via fs.statfsSync · Backup=last-backup-at · Search-clients); the data cards are fed by the `get-dashboard-extra` IPC. Each card is individually toggleable in Settings → **Appearance → Home screen** (`dashboard_hidden_cards` JSON array of card ids → `applyDashboardCardPrefs` toggles `.card-hidden`; `dashboard-cards-changed` broadcast repaints live). The FIRST-RUN DEFAULT hides Quick find/Filed automatically/Storage/Backup/Search clients (seeded in `onboarding-complete`, unset-only — see First-run wizard). DRAG-TO-REORDER (2026-07): grab a card's `.dash-card-head` to move it WITHIN its section grid — the others FLIP-dock smoothly around the drop (a fixed floating card follows the cursor over a `.dash-ph` placeholder that holds the slot). Cards can't cross sections (the drop-target search is scoped to the drag's own grid). Only the multi-card grids carry `data-grid` ("top", "files") and are sortable; the recent banner grid is not. Order persists per section in `localStorage['dashboard_card_order']` ({grid→[ids]}) and is re-applied on load via applyDashCardOrder (SAME-window UI pref, so localStorage not a DB setting). Header handles are delegated on the grid so they survive card content refreshes.
│       ├── splash/{index.html,splash.js}      # cosmetic startup splash — shown in whenReady, closed once login loads
│       ├── review/{index.html,renderer.js}    # incl. zoom/pan preview + hidden admin Template Wizard (⚓): draw anchor/target → save via existing template-mapping IPC; "Show where it reads" overlays (amber) the RESOLVED anchor/target on the current page via test-template-mapping → template_mapper.resolve_geometry (so the operator sees the mapping TRACK a shifted scan, vs the static drawn boxes). FIXED-VALUE MODE is a segmented pill ("Read it from the document" / "Always use the same value"), wording mirrored in Settings → Template Manager. ⊕ teach shows a post-draw READOUT BAR (detected label + value + [← Left]/[↑ Above] direction toggle — see Stage 2 "⊕ AUTO-ANCHOR LABEL SEARCH"). THREE teaching surfaces framed by ROLE so they're legible to non-technical users: Fix a field (⊕) · Teach a document (teach wizard) · Fine-tune a layout (Template Wizard, advanced fallback) — see Help "Which should I use?" (help/templates.html #which-tool). "TEACH THIS DOCUMENT" CTA (2026-06-28, renderTeachCta, centred above the preview): shown ONLY for a genuinely-unseen doc — HIDDEN when a template matched (template_id), when the recheck finds a drifted template (`_templateRecheck.matched` — reprocess fixes it, no action), or when ANY field was read by a learned method (keyword/keyword_override/anchor/template_mapping); a recognised sender (logo/keyword) gets a one-time confirm. Launches the Teach wizard at the doc (skips doc-selection). A `doc-types-changed` broadcast (settings/handler on type create/add/presets) refreshes the Review type dropdown + Settings list + main results-table key map live (preload `onDocTypesChanged`).
│       ├── teach/{index.html,renderer.js}      # guided "Teach a new document" wizard (non-technical) — see Teaching wizard
│       ├── settings/{index.html,renderer.js}  # incl. Admin Template Viewer + License/Activation-Test tab
│       ├── search/{index.html,renderer.js,search-results.js,search-preview.js,search-actions.js}  # built search UI; entitlement-gated confidence/mailbox/workflow actions (see Detached search client)
│       ├── dev-inspector/{index.html,renderer.js}  # hidden read-only processing inspector (Ctrl+Shift+D+M, pw SFDEV) — see Dev inspector
│       ├── onboarding/{index.html,renderer.js} # first-run setup wizard — see First-run wizard
│       ├── welcome/{index.html,renderer.js}    # first-run familiarisation TOUR (6-card concepts carousel; owned child of main, reopenable from user menu) — see First-run wizard. LAST-CARD FORK (2026-07): primary "Try a practice run" (→ welcomeDone('practice') → main opens the tutorial AFTER welcome closes so it parents to the shell, not the closing tour) + secondary "Import my documents".
│       ├── tutorial/{index.html,renderer.js,fixtures.js}  # SANDBOXED beginner "practice run" (2026-07) — Import→Review→teach→Confirm over 3 bundled watermarked sample docs, ENTIRELY in-renderer over pre-baked fixtures. NO real DB/learning/output touched (structural isolation — no wired write path; per bob+eric). Reuses the real Review UI look. DRAW-A-BOX TEACH SIM: arm a field → drag a box round its value on the HTML-rendered doc → it "reads" the value in (mirrors the ⊕ target tool; the low field on doc 2 must be taught to proceed) — pure simulation, not real OCR. Only disk side-effect: `tutorial-file-sample` copies a bundled PDF into %TEMP%/scanfinder-practice for the "before→after filing" reveal (`tutorial-open-folder` opens it directly — the generic open-folder guard blocks TEMP; wiped on window close + before-quit). Backend: src/modules/tutorial/handler.js. Entry points: welcome-tour fork + Home "Practice run" card (dash-practice, toggleable + draggable) + user-menu "Try a practice run"; `practice_run_completed` softens the card copy once done. Samples ship via extraResources; .gitattributes pins *.pdf binary (autocrlf would corrupt the xref).
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
│       ├── licensing.js                # client license_tokens cache (cacheToken/getActiveToken/clearSeatToken)
│       └── trust.js                    # supplier GRADUATION / safe eventual auto-file: a (supplier,doc-type) scope earns a 95 auto-file floor (TRUSTED_FLOOR; lowered from 98 in 2026-07 — clean template_fixed/anchor learned reads genuinely PLATEAU at 95-97, so a 98 floor sat just ABOVE where graduated suppliers actually land and never fired; the numeric floor is a coarse gate, docTrustGate is the real safety) after W=10 CLEAN confirmations. isAutoFileEligible = the ONE predicate BOTH auto-file sites share (backend _autoFileDoc/_maybeAutoFile + renderer via get-auto-file-eligible), gated per-doc by a STRUCTURAL safety gate that applies ONLY when overall_confidence<100 (a full-100 read files gate-free — else legit variable free-text fields block 100% docs). scopeTrust/docTrustGate/classifyLearnedShape/validDate/validIban(mod-97)/validVatGb; STRICT_TYPES excludes 'alphanumeric'; master switch supplier_graduation_enabled + per-scope graduation_optout; listGraduatedScopes feeds the Settings roster. Guarded by database/modules/test_scope_trust.js + the real-doc soundness gate in stress_test/realdoc_regression.js (M=0 = no would-auto-file-a-wrong-value)
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
│   │   ├── validator.py                 # Stage 4: cross-field validation
│   │   ├── value_quality.py             # name/company/address quality (name_quality, is_name_like_field) — JS mirror in learning.js. is_name_like_field EXCLUDES technical addresses (mac/ip/hardware/network "address") — they are CODES, not names, so the name-quality/_name_field_code_reject gates must not strip their legitimate value ("D4:F0:C9:25:9B:64", "192.168.1.200"); else a labelled mac_address/ip_address anchor can never fill (the value's relocated read is rejected as "no real word")
│   │   ├── text_normalise.py            # deterministic compare-time normaliser (NFKC/dash/quote/lower/ws/edge); JS twin database/modules/text_normalise.js
│   │   ├── name_match.py                # Stage 4.5 token-level canonical NAME repair (lexicon + positional repair); suggestion-only
│   │   └── identity_fusion.py           # text-led SUPPLIER identity (page chrome vs known-supplier gazetteer; rapidfuzz dual-gate). DORMANT/SHADOW: engine.extract(identity_shadow=True)→_shadow_identity() records resolved-vs-text_led agree/conflict, changes NOTHING (off by default = byte-identical). Measure via process_docs --identity-shadow (emits file_done.identity_shadow) / rich_field_runner. Sandbox 100% precision/0 silent-wrong; real-engine bounded run 0 false-conflict. Promotion (conflict→needs_review + add rapidfuzz to requirements + check-licenses allowlist) PENDING — see HANDOVER_2026-07-07.md
│   ├── ocr/{tesseract.py,region.py,landmarks.py,text_enhance.py,born_digital.py}  # tesseract.py FULL-PAGE OCR text is rebuilt from image_to_data word GEOMETRY (reconstruct_page_text, 2026-07, routed via ocr/engine.py TesseractEngine.read_page): Tesseract's page segmentation (plain image_to_string) treats a wide right-column gap as a COLUMN break, so a right-aligned totals block OCRs as two detached columns — labels ("Subtotal:"/"Total:") on their own lines, values ("$387.74") stranded elsewhere — and the line-based keyword matcher can't pair them, so total/subtotal read EMPTY on scanned pages (born-digital pages keep exact word positions and never hit this path). Words are grouped into VISUAL ROWS (y-centre band) so a label + its far-right value stay on ONE line; a wide intra-row x-gap emits a 4-space column break so keyword.py's existing column-split guard still separates genuine columns. Same recognised words as image_to_string — only their grouping into reading lines changes; falls back to image_to_string on any error (never reads worse). Took scanned subtotal/total from ~63% → 100% in a 400-doc bench with no regression. Guarded by tests/test_ocr_engine.py. region.py: interactive draw-tool zone-OCR (review ⊕ picker, Template Wizard read-back, Template Manager) + --boxes label-position capture; LIGHT-FIRST ladder mirroring anchor._crop_and_ocr (light greyscale+upscale-small-only read first, heavy autocontrast+sharpen only when light is EMPTY) so a drawn box reads the SAME as extraction and clean born-digital crops aren't mangled into junk ("Serial number"→"be_7"); MULTI-LINE AWARE (2026-06): a drawn box that covers a value WRAPPING onto 2+ lines (a work address "Beaumont Care Homes Ltd -"/"Jordanstown") is re-segmented with PSM 6 (block mode) after the ladder and rebuilt line-by-line (top→bottom, space-joined) — PSM 7 (single-line) won the ladder first and MANGLED a multi-line crop into one garbled line ("p sverablseti Care Homes Ltd -"); a single-line crop keeps the ladder text byte-identical; the PSM-6 data is computed once + reused by --boxes. Guarded by tests/test_region_light_first.py (multi-line case); landmarks.py: derive registration landmarks from sample page; text_enhance.py: degraded text-line re-read (denoise+Sauvola+unsharp), text-only gate-triggered escalation; born_digital.py: read EXACT text + word boxes from a PDF's embedded text layer (pypdfium2 BSD), skipping OCR for generated PDFs (gated by born_digital_enabled)
│   ├── logo/fingerprint.py
│   ├── ocr/orientation.py              # AUTO-ROTATE (90/180/270) via Tesseract OSD (osd.traineddata, Apache-2.0; bundled). detect_rotation(img)→CW° to upright (0 on low conf/failure/sparse — never guesses; conf≥2.0, OSD on a width-capped copy ~120 DPI). correct_image(img,r)=img.rotate(360-r) (PIL is CCW; pypdf is CW + additive → page.rotate(r) verbatim — the two opposite signs are PROVEN in tests/test_orientation.py; a wrong sign corrupts every doc). Integrated in tesseract.extract_text_and_images(auto_rotate, rotations_out): first import only (gated off under cached_text/reprocess), born-digital pages SKIPPED (upright). process_docs --auto-rotate emits file_done.page_rotations; processing/handler _rotateWorkingCopyIfNeeded runs pdf_rotate.py (pypdf in-place /Rotate, atomic .part→rename) on the inbox WORKING COPY before drain/auto-file, so the FILED copy + every reprocess inherit upright from one detection. Gated by auto_rotate_enabled (default ON; original is drained to Processed/ UNTOUCHED → mis-rotation recoverable). Settings → toggle.
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
                  shipped extraction/data/char_trigrams.json. OPERATOR OVERRIDE (2026-07,
                  `accepted_name_values` settings JSON): a Review "✓ This name is correct"
                  button (on a wordness-flagged name field) → accept-name-value IPC →
                  learning.addAcceptedName adds the exact value to an allowlist fed to the
                  engine (buildTrainingArgs --accepted-names-file → engine.set_accepted_names);
                  a name in that set is EXEMPT from the wordness + truncation flags forever
                  (the cure for a legit acronym company like "Cloud VPS" whose "VPS" token
                  reads low on the char model). The button also clears the flag on the current
                  doc immediately. See test_harness/WORDNESS_NOTES.md;
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
`process_docs.py` → `ExtractionEngine.extract()` runs a staged pipeline:
- **Stage 0** `template_matcher.py` — match a learned template, seed fields (same-logo suppliers
  disambiguated by keyword fingerprint; doc-type slug resolution — a null slug silently disables
  the format/qualification gates).
- **Stage 0.5** `template_mapper.py` — admin-drawn anchor→target zone mappings. Absolute-target-first
  read → inline-harvest / relocate off the located label → registration fallback ("register, then read").
- **Stage 1** `keyword.py` — regex patterns from `keyword_patterns.json` (~60-70% of fields); label
  word-boundary guards (e.g. "Total" must not match inside "Subtotal").
- **Stage 2** `anchor.py` — learned label positions + logo supplier ID; drift recovery, label-lock,
  digit-parity guard, slip-fix, inline harvest, multi-line continuation.
- **Stage 4** `validator.py` — date normalise/salvage, currency infer, cross-field maths.
- **Stage 4.5** `format_anomaly_checker.py` — coarse-class + learned-shape consistency vs confirmed
  history; free-text guard; token-level name repair; format-weighted overall confidence.
- **Stage 4.6** candidate override — gated, DEFAULT-OFF.

**Two modes** (`processing_mode`): `fast` (stages 1+2, sub-second) · `smart` (DEFAULT; currently
identical to fast — kept distinct for future use).

⚠ **Critical invariants — always honour these (full rationale in the doc):**
- engine.extract() returns a FLAT dict mixing field dicts `{value,confidence,method}` with `_`-prefixed
  metadata (`_supplier_name`, `_overall_confidence`, …). Pop `_` keys BEFORE iterating fields; call
  `sanitise_extractions()` after popping, before emitting.
- Supplier identity must reflect the LATEST reliable `results['supplier_name']`, not the first guess —
  engine re-resolves it once, after every stage, before persisting hints/anchors/logos.
- Manual/authoritative anchors (⊕ teach, Stage 0.5 mapping, `keyword_override`) win on regex/TYPE alone
  (`shape_mode='ignore'`) and must NOT be vetoed by the learned-shape check; auto tiers keep full type+shape gating.
- Extraction/anchoring fixes are **system fixes, not document fixes** — fix the reusable layer, no
  one-document hacks (see Working rules).

📖 **FULL detail — read before ANY extraction/anchoring/OCR/validation/confidence change:
`docs/extraction-pipeline.md`** (every stage's internals + fix history, the drift/registration/
label-lock/slip-fix/inline-harvest/multiline designs, OCR ladder & crop recipes, `_gate_value`
shape modes, authority precedence, performance notes, and the accuracy/concurrency/load harnesses).

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

**DANGLING STRUCTURAL ROLE — self-heal + Confirm resilience** (2026-07): a type's
`ref_field_key`/`date_field_key` can end up pointing at a field that no longer exists
(the Reference field was deleted, or a type was created with a role key that never
matched a real field). That made Review's Confirm gate IMPOSSIBLE to satisfy — the
required key matched NO field, so Confirm sat disabled with nothing on screen to fill
(the "won't let me file, no empty field visible" trap). Three guards: (1)
`repairStructuralRoles()` CLEARS a dangling role to NULL on the UI type-list loads
(`getAllWithFields`/`getAllWithFieldsAll`) so the Settings dropdown shows it as unset +
re-pickable (not auto-repointed — guessing ticket_no vs serial_number is the user's
call); (2) `updateType` REFUSES to set a role to a field key that doesn't exist (can't
create a new dangling role); (3) the Review renderer's `validateConfirm` DETECTS a
dangling role (required key with no matching field) and shows a clear note ("This
type's Reference field isn't set up. Choose it in Settings → Document Types") instead
of a silent block. Guarded by `test_structural_fields.js`.

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
Optional device-bound license gate: trial + paid-seat. **OFF in dev, ON by default in packaged builds;
enforcement is ALWAYS ON in every build** (no env/setting/dev bypass). The MAIN process is the sole
decider — `enterMainApp()` → `licensingModule.decideAccess()` (`src/modules/licensing/handler.js`); the
renderer can only REQUEST entry (`license-enter-app`), never self-grant. A non-`allow` gate routes to the
license window (`src/windows/license`). Tokens verified OFFLINE (`src/lib/license/token.js`) against pinned
Ed25519 public keys (alg EdDSA, kid pinned). Fingerprint = SHA-256(product_id | Windows MachineGuid)
(`fingerprint.js`) — raw value never leaves main. Config in `config/license.json` (`base_url`/`product_id`/
PUBLIC keys only; bundled via extraResources → rebuild installer after editing). Backend = separate PHP 8 +
MySQL server (`licensing-backend/`, `/v1/{trial/start,activate,validate,revoke,status}` + admin web page).
⚠ Secrets: never log/echo account or activation keys; never re-display a one-time key; never expose
`account_key_hash` or the raw fingerprint.

## Legal / Terms acceptance
Version-stamped acceptance gate from ONE bundled `LEGAL.txt` (repo root; **DRAFT** — solicitor items
outstanding). Surfaced in three places: installer NSIS licence page · first-run / version-bump gate
(`src/windows/legal/`, shown by `enterMainApp()` after the licence gate, before onboarding, enforced in
MAIN) · re-read (About box + Settings → Advanced → Legal). Acceptance stored LOCALLY only
(`settings.terms_accepted = {version,hash,app_version,accepted_at}` — no telemetry, no external calls).
Bump `LEGAL_VERSION` (main.js) + the file's `Version:` header to re-prompt everyone.

📖 **FULL detail: `docs/licensing.md`** (decideAccess specifics, offline verify order, backend endpoints
+ owner-email-on-trial, admin 2FA/TOTP, config keys, and the Legal gate internals + IPC).

## Detached search client (LAN add-on)
A separate Electron search/mailbox client runs on other LAN PCs and talks to the core over a TLS `/v1`
API (`src/modules/api/handler.js`, Node `https`). It is an **entitlement-gated add-on**
(`src/services/entitlementService.js`, `detached_client_licensed` setting) that ALSO upgrades the core
app's own Search; the core works fully standalone with the add-on off. Core services are
transport-agnostic (`searchService`/`reviewService`/`workflowService`/`presenceService`/`sessionService`)
so the desktop IPC and the `/v1` client share one implementation.

Key pieces:
- **/v1 API** — search/preview, review-over-/v1 (queue/counts/confirm/defer via the shared claim-then-file
  `reviewService`), doc-types, presence ("Currently being reviewed by <name>"), workflow routes, enroll/CA.
  DTO projection returns ONLY the frozen contract fields (never `stored_path`/`folder_path`/`working_path`).
- **Managed 2-tier TLS** (`certService.js`, node-forge) — a CA signs a server cert; the client pins the CA.
- **Mailbox/approval workflow** — present but HIDDEN pre-release behind `WORKFLOW_FEATURE_ENABLED=false`.
- **TOTP MFA** (client-only) + **/v1 session revocation** on admin deactivate/role-change/password-reset.

⚠ Security invariants (preserve): real TLS verification, NO silent self-signed bypass in the client UI;
pin the **CA** (`ca.crt`), not `server.crt`; `ca.key` NEVER crosses any endpoint; enrollment needs a
fingerprint/pairing integrity check.

📖 **FULL detail: `docs/detached-client.md`** (every `/v1` endpoint + contract version, cert wizard,
entitlement/workflow gates, presence/reviewService internals, the client targeting-OCR path + open bug,
theming/keyboard-focus fixes, the concurrency/accuracy/import-load stress harnesses, and all tests).

## UI conventions
**Shared theme** — every window's palette + components are centralised in
`src/windows/shared/theme.css` (loaded by all windows) + `theme.js`. **ELEVEN named
themes**: the core SIX (2026-06-28) — Light · Warm Paper · Nordic Slate (light
family) · Dark · Midnight · Graphite (dark family) — PLUS a **Seasonal** group
(2026-07): Spring · Summer (sunshine-yellow) · Autumn · Winter (icy-blue) light +
**Festive** (dark, evergreen-green with a holly-RED accent + gold). Each is a
`:root[data-theme="X"]` token-override block; **Warm Paper is the default**. The
seasonal themes carry faint repeating **SVG-tile artwork** (leaves/suns/snowflakes/
holly) served as CSP-safe `'self'` files from `shared/patterns/*.svg` (NEVER
`data:` URIs — `img-src 'self'` blocks those), `background-attachment:fixed`, baked
low opacity. `DARK_THEMES` in theme.js gates the dark family (incl. `festive`). `theme.js` sets BOTH `data-theme` (palette)
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
- **Settings tab structure (11 tabs, 2026-06-30 reorg — the "General" junk-drawer is
  GONE):** a `Setup` cluster — **Files & filing** (folders + output structure) ·
  **Document Types** · **Processing** (mode/parallel/OCR/separation/name-checks + the
  import toggles auto-file/multiline/auto-rotate + Review confidence threshold) ·
  **Appearance** (theme + Home-screen cards + window behaviour) — then an
  `Administration` cluster (side-head divider) — **Templates** (the `#tpl-dock` viewer
  only) · **Learning** (Keyword Label Overrides at top + Learning Recovery + memory
  inventory) · **Learning Repair** (see below) · **Users** (accounts + recent activity) · **Audit** (the audit log) ·
  **Licensing** (licence + activation + seats; `#wf-section` workflow stays HIDDEN) ·
  **Search client** (the `#client-api-*` access card) · **Advanced** (Backup & Restore
  + Diagnostic Logging + Re-run setup). The renderer (`settings/renderer.js`) tab-click
  handler is generic on `data-tab`→`panel-<slug>`; only these slugs carry lazy-init —
  `learning`→`loadMemoryInventory`, `audit`→`loadAudit`, `searchclient`→
  `initClientApiSection`. Every control is wired by element ID, so a section moves
  between tabs intact. (Done via two reviewed worktree passes; guarded by the
  div-balance + tab↔panel pairing checks.)
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
get-processing-mode, set-processing-mode(mode)
check-fast-mode-suggestion(supplierName)
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

### FIXED (residual noted) — cross-supplier POSITIONAL anchor bleed (2026-07-06)
A ⊕-taught AUTHORITATIVE anchor for a POSITIONAL field (e.g. `invoice_number`) was applied ACROSS
suppliers: `_anchor_matches` admits it on doc-type match, `_filter_anchors` ranks authoritative teaches
ahead of supplier-priority, and the read-stage guard was IDENTITY-ONLY — so Anconia's `INVOICE NUMBER`
anchor (pinned top-right) blind-read the top-left "Invoice To" on a City Office invoice (LATENT: masked
by the multi-method net until keyword doesn't fire). FIX (007-reviewed): the read-stage guard
`_is_blind_cross_supplier_anchor` (renamed from `_is_blind_cross_supplier_identity`, anchor.py) now
drops a BLIND (`not located_ok`) read from a NAMED different supplier for ANY field — a LOCATED read
(taught label found here → same layout) is still kept for every field (authoritative-wins holds), and
same-supplier / global-scoped anchors are kept (a global positional's fixed-position blind read is
intended). Key insight: `located_ok` (does the taught label appear on THIS page?) IS the per-read
"same layout?" signal, so no template-scoping was needed. Guarded by `test_identity_anchor_scope.py`;
A/B `realdoc_regression` 738 docs, 0 regressions, M=0, no per-field accuracy drop.
RESIDUAL (mostly closed 2026-07-06): the false-locate — a cross-supplier layout sharing the SAME
caption at a DIFFERENT position, so the rigid ABSOLUTE crop reads a wrong-but-valid value — is now
cross-read against the label's REAL inline value for FREE-TEXT/CURRENCY (the LABEL LOCK) and for
REF + DATE (the authoritative-crop cross-check, `anchor.py`, extended to dates with a calendar-aware
compare); on disagreement the located read wins + flags for review. Remaining sliver (low-severity): a
value printed BELOW its label (inline harvest empty) on a cross-supplier false-locate isn't cross-read
— needs the geometric `_place_from_located` path (the deferred "fixed-positioning-from-label" idea).


### Resolved QA / audit history — see `docs/history.md`
The 2026-07-02 read-only adversarial audit's **11 findings are all FIXED + tested**; the per-item landing
notes (backup natural-key upsert, no-ref/date confirm dead-end, reprocess-discards-edits guard, batch
file-copy off the file_done path, File-All-Ready expectId race, empty-issuer warn, shared `slug.js`,
watch/output overlap block, etc.) plus the "verified SOUND, don't re-audit" list have moved to
**`docs/history.md`**. Read it before re-touching backup restore, confirm gating, slug derivation, or path-overlap.

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


## Features to build / build history — see `docs/history.md`
The staged build specs (Stage 2 Settings rebuild · Stage 5 Review rebuild · Stage 6 Search window ·
Stage 7 field-format cross-referencing) are largely **DONE**; their specs and the durable "built
additions" notes have moved to **`docs/history.md`**. Still genuinely OUTSTANDING there:
- **Stage 7 Stage 3** — persistent learned format model (`field_format_rules` table, migration 12,
  `--format-rules-file`): overrides the inferred class once `confirmed_count ≥ 10`. Not yet built.

## Fast Mode suggestion
After confirming a doc, call `check-fast-mode-suggestion(supplierName)`.
If returns non-null, show toast: "Switch to Fast Mode? You've confirmed N docs
from [supplier]. Fast Mode processes instantly."
Buttons: "Switch to Fast Mode" → `set-processing-mode('fast')` | "Not now"

---


## First-run wizard · Settings backup · Learning Repair
- **First-run wizard** (`src/windows/onboarding/`) — a linear setup wizard shown ONCE on a clean install,
  AFTER the licensing gate; gated by the `first_run_completed` setting (migration 24 stamps already-
  configured DBs so existing users are never re-onboarded — NEVER infer "clean install" from empty state).
  Only required step = a writable output folder. Followed by a 6-card welcome/familiarisation TOUR
  (`src/windows/welcome/`, its own `welcome_seen` flag; reopenable from the user menu).
- **Settings backup / restore** (admin; `src/services/backupService.js`; Settings → Advanced) — exports
  operational config to ONE password-encrypted file (scrypt → AES-256-GCM over gzipped JSON). Includes
  settings (minus `licens*`), doc types/fields, templates, anchors, hints, corrections, logos; EXCLUDES
  users/recovery/audit/licensing/documents. **Device-bound import** (anti-trial-stacking): a backup from a
  different machine is refused unless this machine holds an active paid seat.
- **Learning Repair** (admin Settings tab, `panel-repair`) — un-poison a doc type by browsing its confirmed
  docs and sending a bad one back to Review (replace-in-place, no `-DUPLICATE`). Grounding fact: learning is
  derived LIVE from `confirmed` docs (`getFieldFormats` filters `status='confirmed'`), so de-confirm/soft-
  delete is the real lever — clearing learning tables alone doesn't un-poison. Precision-first suspect
  detectors (`src/services/repairSuspects.js`): outlier docs (phash) + anomalous values (shape/name/charset).

📖 **FULL detail: `docs/features.md`** (wizard steps + gate flow + copy-after-processing keys; backup
crypto/scope/restore transaction/IPC; Learning Repair detectors/scope-split/IPC/UI).

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


## Teaching wizard · Dev inspector
- **Teaching wizard** (`src/windows/teach/`) — a dedicated linear "Teach a new document" wizard for
  non-technical users (Admin+Edit): welcome → choose the scanned doc → pick or CREATE a doc type → point
  out each field by drawing a box around its VALUE (live OCR read-back; the wizard auto-detects the nearby
  label as the anchor) → review → commit. Each field is saved as a **Stage 0.5 anchor→target MAPPING**
  (value-box-only + auto-label — works on document #1, registration covers drift), NOT a Stage 2 ⊕ anchor.
  Commit sequence is DEFERRED to the last step (promote-to-template → save-template-mapping per field →
  confirm-review) so Back/Cancel are safe.
- **Dev inspector** (hidden, read-only — no DB writes, no learning) — in the MAIN window press
  **Ctrl+Shift+D then M**, password `SFDEV`. An answer-first extraction-provenance view + a Review-window
  **trace console** (same key combo, inside Review) for debugging extraction PRECEDENCE. The `--trace` /
  `--slice-dir` flags are added ONLY while the inspector/console is open (or diag logging is on), so normal
  processing is byte-identical. OCR slices saved to one temp dir, served base64, cleared on close.

📖 **FULL detail: `docs/features.md`** (teach auto-flow / fixed-value / artifact / commit sequence;
dev-inspector three-column UI, telemetry mirror, trace event types, click-to-highlight slices, per-field
winning-lineage reconstruction, and the known main-app follow-ups).

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

**Build notes**: electron-builder is pinned **`^24.13.3`** (installed = 24.13.3 — an earlier note
saying "v26" was inaccurate; verify with `require('electron-builder/package.json').version`). Avoid
re-adding the legacy `win.sign` / `win.signingHashAlgorithms` keys. For a future MSIX/Store SKU see
`MSIX_SETUP.md` (consider upgrading electron-builder for the `appx` target). A TEST `.appx`
builds via `electron-builder --win appx` (placeholder identity `SixMileSoftware.ScanFinder` /
`CN=Six Mile Software`) — but it REQUIRES **Windows Developer Mode ON** (or an elevated shell):
electron-builder extracts its bundled `winCodeSign` toolset using SYMLINKS, which Windows blocks
without that privilege, so `makeappx.exe` never lands and the build dies `spawn UNKNOWN`/`ENOENT`.
The resulting `.appx` is unsigned (Store signs on submission; for local sideload self-sign a cert
whose subject == the appx Publisher, then `Add-AppxPackage`). An opt-in document-data-FREE
diagnostics/error-reporting feature is DESIGNED but NOT built — see `DIAGNOSTICS_PLAN.md`
(Phase 0 first; strict enumerated allowlist, no field values even masked, consent-gated).
`postinstall` runs
`install-app-deps`; native deps
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
