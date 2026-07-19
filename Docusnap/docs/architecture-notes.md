# Architecture notes (moved out of the CLAUDE.md directory map, 2026-07-19)

> Verbatim archive of the long per-file annotations that used to live inline in the CLAUDE.md
> directory map. Each block below is the ORIGINAL map line, unedited (tree glyphs included).
> The map now carries a one-line summary + a pointer here. Read the matching block BEFORE
> changing the file it describes.

## src/modules/processing/handler.js

```
│   │   ├── processing/handler.js        # folder import, reprocess, OCR region, logos; BACKEND 100% AUTO-FILE (_maybeAutoFile/_autoFileDoc, hooked in _handleFileMessage): a fully-typed, un-flagged, overall_confidence===100 doc files itself the moment it's processed — MANUAL import + WATCH folder + background alike (window need not be open), reusing filing.commitDocument + documents.confirm, gated by auto_file_full_confidence; records ids in a rolling `recent_auto_filed` setting; emits 'doc-auto-filed'. (Reprocess-All keeps the renderer-side review.autoCommitFullConfidence.) CONFIGURABLE THRESHOLD (2026-07, `auto_file_threshold` setting, default 100 = full-confidence-only, Settings → Processing slider 80-100): a doc auto-files when overall_confidence ≥ the threshold. The type + un-flagged gate is the real safety — BELOW 100 the backend ALSO requires `needs_review` false (fully typed, no field flagged), and the renderer bulk path keeps its `!review_flag_count` filter — so lowering the slider only lets a clean, confident doc skip Review, never a flagged one. Pairs with the "confidence grows with learning" boosts: a regular supplier's reads climb toward ~98%, so a user who sees perfect docs at 98% can set the slider to 98 and have them auto-file.
```

## src/modules/review/handler.js

```
│   │   ├── review/handler.js            # queue, confirm, defer, delete, pages; Advanced→"View learning history" (get-field-value-history / purge-field-value / rename-field-value, admin/edit, audited) → learning.getFieldValueHistory/purgeFieldValue/renameFieldValue: list the confirmed values learned for a (supplier,doctype,field) scope (same final values getFieldFormats samples); PURGE a value that shouldn't exist (e.g. a "Booking" drift artifact) from extractions+corrections+supplier_hints so it stops polluting the learned shape; RENAME a value (oldValue→newValue across extractions+corrections, drops the stale hint) to fix an OCR slip ("$O2"→"SO2"). Review toolbar ⚙ Advanced button → flyout → sortable modal (click a heading to sort). Modal is NON-blocking (no backdrop, positioned left): the right fields pane stays lit + clickable and clicking a field LIVE-RELOADS the table for that field (focusin→loadLearningHistoryFor, active field highlighted .lh-active-field). Per-row 📄 "docs" toggle = learning.getDocumentsForFieldValue (get-documents-for-field-value IPC, admin/edit, read-only): reveals the CONFIRMED source documents that carry that learned value (same scope + final-value expression getFieldValueHistory groups by), each with an "Open in Review" button → renderer `_navigateToDoc(id)` loads the FILED doc in-place for re-checking (Edit-in-place, status stays confirmed; the allowRefile path re-files on confirm — so a bad learned value like "$4" can be traced to its docs + corrected). Per-row ✎ inline-edit (rename) + 🗑 delete-confirm; "Fix likely slips" button = renderer computeSlipFixes: a value differing from a ≥80% per-position column consensus at exactly ONE char that's a likely OCR slip (_likelySlip: a symbol where alnum expected, or a known confusion $↔S/0↔O/1↔I…) and whose corrected form matches the dominant shape or an existing value → proposes old→new, applies on confirm via renameFieldValue. Guarded by database/modules/test_field_value_history.js
```

## src/modules/templates/handler.js

```
│   │   ├── templates/handler.js         # Admin Template Viewer — browse/pin samples, anchor→target mapping CRUD; Learning Recovery reassign (link-only, reversible) + MERGE (templates.mergeInto: fold a fragment's doc-links/missing-mappings/fields/landmarks/sample/identity into a canonical row, sum confirmed_count, delete source — IRREVERSIBLE; the cure for near-duplicate "same logo, drifted phash" template fragmentation). Guarded by database/modules/test_template_merge.js
```

## src/services/ (presenceService · reviewService)

```
│   ├── services/{searchService,previewService,workflowService,reviewService,presenceService,entitlementService,certService,sessionService}.js  # transport-agnostic core (see Detached search client). presenceService = the "Currently being reviewed by <name>" signal: an in-memory Map<docId,Map<viewerKey,{username,displayName,lastSeen}>> SHARED SINGLETON (shared()) the desktop + /v1 API both publish to; TTL ~60s self-expires a crashed/disconnected viewer; ADVISORY ONLY (the atomic confirm is the authority, so stale presence can't cause a wrong outcome). heartbeat/release/releaseAll/viewers(excludeSelf). Guarded by src/services/test_presence.js. reviewService = createReviewService({deps}) → queue/deferred/counts/confirm/defer/restore, shared by the desktop IPC + (Phase 3) the /v1 client API; explicit actor {username,role} (auth+workflow-lock enforced at the edge). CONFIRM CLAIMS the doc atomically (documents.confirmIfReviewable) BEFORE filing so two confirms can't both file it (loser → ALREADY_FILED w/ the winner's name); re-file (already-confirmed) skips the claim — but ONLY when the caller passes an explicit `payload.allowRefile` intent (desktop renderer sets it ONLY when the doc was opened while ALREADY confirmed = "Edit in Review"; the /v1 client NEVER sets it, server-decided). Without that intent a confirm that RACED from the review QUEUE into an already-filed doc runs the atomic claim and loses cleanly (ALREADY_FILED), instead of the old last-writer-wins SILENT OVERWRITE of reviewer #1 (2026-06-30 audit finding; `documents.confirmIfReviewable` carries an unused `allowRefile` CAS branch, but reviewService gates the claim-SKIP on intent rather than routing through it — a claim-before-file would null the existing stored_path). CENTRAL DATE NORMALISATION (2026-07): confirm normalises every DATE-typed field's value (doc-type `date_field_key` + any type='date' field) to the core's canonical DD-MM-YYYY ONCE, via filing.normaliseDate (the same parseDate/formatDate the filename builder uses), BEFORE both filing and learning.saveCorrections — so whatever a client (desktop or /v1) submits ("Aug 03 2012", "2012-08-03", "3/8/2012") the STORED value, the FILENAME and the LEARNING corpus all agree, and no client re-implements date parsing (the "corrected date in the client isn't in the core's format" fix). Unparseable values are left as typed (never dropped). Electron-only steps (source-move, landmark capture, taught-confirm promote, count broadcast) are INJECTED hooks → desktop path byte-identical. SNAPPIER CONFIRM (2026-07-09): the best-effort learning hooks captureSample + onTaughtConfirm (each SPAWNS a Python landmark subprocess — the bulk of the felt Confirm→next-doc pause) are now DETACHED (fire-and-forget AFTER all persistence + notifyCounts), so confirm RETURNS immediately; confirmReview STAYS awaited so the atomic claim + fail-toward-review hold (the Oracle ruled a full-optimistic renderer WRONG LAYER — it would open a silently-gone-doc hole). releaseDelayMs dropped to 0; the renderer backgrounds the logo save. Pinned so a re-added `await` can't re-freeze the UI. Guarded by src/services/test_reviewservice.js + database/modules/test_documents_cas.js
```

## src/windows/main/ (dashboard + nav rail)

```
│       ├── main/{index.html,renderer.js}      # DASHBOARD + NAV RAIL (2026-06-28 redesign, replaced the launchpad). LEFT RAIL = single nav: Home · Import · Review(badge) · Search · Teach · Settings + a rail CLOCK (time large/date small) + "Local only" + a Dark-mode quick toggle at the very foot. CONTENT = a view-router (showView 'home'|'import'); Review/Search/Teach/Settings still open as their own maximised child windows. HOME = attention-led dashboard in ONE auto-fit card grid (repeat(auto-fit,minmax(260px,1fr)) → no empty cells; full-width banners use .dash-span); content column centred + width-capped (clamp(1100px,92vw,1320px)). Cards: Needs-your-attention (review+deferred+stuck counts → Open Review, or "all caught up"); Documents-filed pulse (today/week/month from confirmed_at); Import quick-start; Auto-import (watch status + on/off switch + pick-folder, admin-only); Getting-smarter (suppliers+layouts learned); Where-your-files-go (output folder + Open folder via the open-folder IPC); trial banner (licenseGetDiagnostics, "N of 14 days", calm/warn/crit); first-run setup checklist (auto-hides); Recent activity (recent confirmed; refreshes live on confirm via refreshDashboardIfHome). updateAttention() is the CHEAP count-event repaint; refreshDashboard() (the searchDocuments query) runs on load / Home-open only. IMPORT VIEW = folder picker + Process/Stop + session stats + live results table (Company/Date/Reference/Status) + progress strip; "Filed"/"Needs review" rows open THAT doc via openReviewWindowAt(db_id). Processing text shows "Multi-page document (N pages)" via the file_pages event. Reprocess-All progress is a BANNER (review window). CARD SET EXPANDED + CUSTOMISABLE (2026-06-30): two-tier grid — TOP (Quick find · Needs-attention · Documents-filed · Filed-automatically=auto-file % · Getting-smarter · Did-you-know tips · Recent-activity) + FILES & FOLDERS (Auto-import · Import · Where-your-files-go · Storage=free disk via fs.statfsSync · Backup=last-backup-at · Search-clients); the data cards are fed by the `get-dashboard-extra` IPC. Each card is individually toggleable in Settings → **Appearance → Home screen** (`dashboard_hidden_cards` JSON array of card ids → `applyDashboardCardPrefs` toggles `.card-hidden`; `dashboard-cards-changed` broadcast repaints live). The FIRST-RUN DEFAULT hides Quick find/Filed automatically/Storage/Backup/Search clients (seeded in `onboarding-complete`, unset-only — see First-run wizard). DRAG-TO-REORDER (2026-07): grab a card's `.dash-card-head` to move it WITHIN its section grid — the others FLIP-dock smoothly around the drop (a fixed floating card follows the cursor over a `.dash-ph` placeholder that holds the slot). Cards can't cross sections (the drop-target search is scoped to the drag's own grid). Only the multi-card grids carry `data-grid` ("top", "files") and are sortable; the recent banner grid is not. Order persists per section in `localStorage['dashboard_card_order']` ({grid→[ids]}) and is re-applied on load via applyDashCardOrder (SAME-window UI pref, so localStorage not a DB setting). Header handles are delegated on the grid so they survive card content refreshes.
```

## src/windows/review/ (review window UI)

```
│       ├── review/{index.html,renderer.js}    # incl. zoom/pan preview + hidden admin Template Wizard (⚓): draw anchor/target → save via existing template-mapping IPC; "Show where it reads" overlays (amber) the RESOLVED anchor/target on the current page via test-template-mapping → template_mapper.resolve_geometry (so the operator sees the mapping TRACK a shifted scan, vs the static drawn boxes). FIXED-VALUE MODE is a segmented pill ("Read it from the document" / "Always use the same value"), wording mirrored in Settings → Template Manager. ⊕ teach shows a post-draw READOUT BAR (detected label + value + [← Left]/[↑ Above] direction toggle — see Stage 2 "⊕ AUTO-ANCHOR LABEL SEARCH"). THREE teaching surfaces framed by ROLE so they're legible to non-technical users: Fix a field (⊕) · Teach a document (teach wizard) · Fine-tune a layout (Template Wizard, advanced fallback) — see Help "Which should I use?" (help/templates.html #which-tool). "TEACH THIS DOCUMENT" CTA (2026-06-28, renderTeachCta, centred above the preview): shown ONLY for a genuinely-unseen doc — HIDDEN when a template matched (template_id), when the recheck finds a drifted template (`_templateRecheck.matched` — reprocess fixes it, no action), or when ANY field was read by a learned method (keyword/keyword_override/anchor/template_mapping); a recognised sender (logo/keyword) gets a one-time confirm. Launches the Teach wizard at the doc (skips doc-selection). A `doc-types-changed` broadcast (settings/handler on type create/add/presets) refreshes the Review type dropdown + Settings list + main results-table key map live (preload `onDocTypesChanged`).
```

## src/windows/welcome/

```
│       ├── welcome/{index.html,renderer.js}    # first-run familiarisation TOUR (6-card concepts carousel; owned child of main, reopenable from user menu) — see First-run wizard. LAST-CARD FORK (2026-07): primary "Try a practice run" (→ welcomeDone('practice') → main opens the tutorial AFTER welcome closes so it parents to the shell, not the closing tour) + secondary "Import my documents".
```

## src/windows/tutorial/ (sandboxed practice run)

```
│       ├── tutorial/{index.html,renderer.js,fixtures.js}  # SANDBOXED beginner "practice run" (2026-07) — Import→Review→teach→Confirm over 3 bundled watermarked sample docs, ENTIRELY in-renderer over pre-baked fixtures. NO real DB/learning/output touched (structural isolation — no wired write path; per bob+eric). Reuses the real Review UI look. DRAW-A-BOX TEACH SIM: arm a field → drag a box round its value on the HTML-rendered doc → it "reads" the value in (mirrors the ⊕ target tool; the low field on doc 2 must be taught to proceed) — pure simulation, not real OCR. Only disk side-effect: `tutorial-file-sample` copies a bundled PDF into %TEMP%/scanfinder-practice for the "before→after filing" reveal (`tutorial-open-folder` opens it directly — the generic open-folder guard blocks TEMP; wiped on window close + before-quit). Backend: src/modules/tutorial/handler.js. Entry points: welcome-tour fork + Home "Practice run" card (dash-practice, toggleable + draggable) + user-menu "Try a practice run"; `practice_run_completed` softens the card copy once done. Samples ship via extraResources; .gitattributes pins *.pdf binary (autocrlf would corrupt the xref).
```

## database/modules/trust.js (supplier graduation / auto-file gate)

```
│       └── trust.js                    # supplier GRADUATION / safe eventual auto-file: a (supplier,doc-type) scope earns a 95 auto-file floor (TRUSTED_FLOOR; lowered from 98 in 2026-07 — clean template_fixed/anchor learned reads genuinely PLATEAU at 95-97, so a 98 floor sat just ABOVE where graduated suppliers actually land and never fired; the numeric floor is a coarse gate, docTrustGate is the real safety) after W=10 CLEAN confirmations. isAutoFileEligible = the ONE predicate BOTH auto-file sites share (backend _autoFileDoc/_maybeAutoFile + renderer via get-auto-file-eligible), gated per-doc by a STRUCTURAL safety gate (docTrustGate) in TWO regimes: sub-100 (a graduated discount read) gets the FULL gate (template + EVERY valued field verifiable); at 100 (Slice 7, `opts.at100`) gets a LENIENT gate — NO template requirement + skips a genuinely-unverifiable field (freetext / no-history / ambiguous 'constant' shape), so a legit variable free-text field (per-doc customer name) + logo-only 100% suppliers still auto-file, BUT a deterministically-invalid strict value (bad calendar date / checksum-failing IBAN·VAT / dropped-decimal total) OR a value violating a STRUCTURED learned shape (a code field learned as xxxx-xxxx-x reading the word "Information") is now blocked at 100 too (the old gate-free path let it through). Verified: 0 regression on 289 live 100% docs. scopeTrust/docTrustGate/classifyLearnedShape/validDate/validIban(mod-97)/validVatGb/currencyDpConsistent (a 0-dp total against an all-2-dp learned history = dropped-decimal 100× error → blocked; #9/reggie T4)/matchesTypePattern (a STRICT-typed value must also match its SHARED config validation_pattern at the gate, not just lack a note — #9/reggie T5; each strict type routed once: date=calendar, iban/vat=checksum, currency=dp, others=shared regex, no-pattern types like 'number' stay trusted); STRICT_TYPES excludes 'alphanumeric'; master switch supplier_graduation_enabled + per-scope graduation_optout; listGraduatedScopes feeds the Settings roster. Guarded by database/modules/test_scope_trust.js + the real-doc soundness gate in stress_test/realdoc_regression.js (M=0 = no would-auto-file-a-wrong-value)
```

## python_backend/extraction/ocr_corrector.py

```
│   │   ├── ocr_corrector.py             # Stage 2.5: learned OCR misread correction (same-length char subs) + Stage 2.5d DOMINANT-VALUE SNAP (reggie, 2026-07): count-weighted — snaps a code read to its DOMINANT confirmed literal (≥5 count AND ≥80% share) when it matches after collapsing internal whitespace (branch A, zero-risk) or ONE known OCR-confusion substitution (branch B, kill-switch SNAP_ALLOW_SUBSTITUTION). Fixes what try_correct can't: an inserted SPACE ("1 102V03NL1"→"1102V03NL1") + a slip on a field whose consensus template was POLLUTED by a mis-confirmed artifact (derive_template is count-blind, so a 31× canonical was drowned by a 1× "11O2…"). Skips name fields + fixed/override reads + a read already equal to a confirmed value; variable fields self-exclude. build_dominant_index/lookup_dominant/snap_to_dominant; guarded by tests/test_dominant_snap.py
```

## python_backend/extraction/value_quality.py

```
│   │   ├── value_quality.py             # name/company/address quality (name_quality, is_name_like_field) — JS mirror in learning.js. is_name_like_field EXCLUDES technical addresses (mac/ip/hardware/network "address") — they are CODES, not names, so the name-quality/_name_field_code_reject gates must not strip their legitimate value ("D4:F0:C9:25:9B:64", "192.168.1.200"); else a labelled mac_address/ip_address anchor can never fill (the value's relocated read is rejected as "no real word")
```

## python_backend/extraction/identity_fusion.py

```
│   │   └── identity_fusion.py           # text-led SUPPLIER identity (page chrome vs known-supplier gazetteer; rapidfuzz dual-gate). DORMANT/SHADOW: engine.extract(identity_shadow=True)→_shadow_identity() records resolved-vs-text_led agree/conflict, changes NOTHING (off by default = byte-identical). Measure via process_docs --identity-shadow (emits file_done.identity_shadow) / rich_field_runner. Sandbox 100% precision/0 silent-wrong; real-engine bounded run 0 false-conflict. Promotion (conflict→needs_review + add rapidfuzz to requirements + check-licenses allowlist) PENDING — see docs/handovers/HANDOVER_2026-07-07.md
```

## python_backend/ocr/ (tesseract.py · region.py · landmarks.py · text_enhance.py · born_digital.py)

```
│   ├── ocr/{tesseract.py,region.py,landmarks.py,text_enhance.py,born_digital.py}  # tesseract.py FULL-PAGE OCR text is rebuilt from image_to_data word GEOMETRY (reconstruct_page_text, 2026-07, routed via ocr/engine.py TesseractEngine.read_page): Tesseract's page segmentation (plain image_to_string) treats a wide right-column gap as a COLUMN break, so a right-aligned totals block OCRs as two detached columns — labels ("Subtotal:"/"Total:") on their own lines, values ("$387.74") stranded elsewhere — and the line-based keyword matcher can't pair them, so total/subtotal read EMPTY on scanned pages (born-digital pages keep exact word positions and never hit this path). Words are grouped into VISUAL ROWS (y-centre band) so a label + its far-right value stay on ONE line; a wide intra-row x-gap emits a 4-space column break so keyword.py's existing column-split guard still separates genuine columns. Same recognised words as image_to_string — only their grouping into reading lines changes; falls back to image_to_string on any error (never reads worse). Took scanned subtotal/total from ~63% → 100% in a 400-doc bench with no regression. Guarded by tests/test_ocr_engine.py. region.py: interactive draw-tool zone-OCR (review ⊕ picker, Template Wizard read-back, Template Manager) + --boxes label-position capture; LIGHT-FIRST ladder mirroring anchor._crop_and_ocr (light greyscale+upscale-small-only read first, heavy autocontrast+sharpen only when light is EMPTY) so a drawn box reads the SAME as extraction and clean born-digital crops aren't mangled into junk ("Serial number"→"be_7"); MULTI-LINE AWARE (2026-06): a drawn box that covers a value WRAPPING onto 2+ lines (a work address "Beaumont Care Homes Ltd -"/"Jordanstown") is re-segmented with PSM 6 (block mode) after the ladder and rebuilt line-by-line (top→bottom, space-joined) — PSM 7 (single-line) won the ladder first and MANGLED a multi-line crop into one garbled line ("p sverablseti Care Homes Ltd -"); a single-line crop keeps the ladder text byte-identical; the PSM-6 data is computed once + reused by --boxes. Guarded by tests/test_region_light_first.py (multi-line case); landmarks.py: derive registration landmarks from sample page; text_enhance.py: degraded text-line re-read (denoise+Sauvola+unsharp), text-only gate-triggered escalation; born_digital.py: read EXACT text + word boxes from a PDF's embedded text layer (pypdfium2 BSD), skipping OCR for generated PDFs (gated by born_digital_enabled)
```

## python_backend/ocr/orientation.py

```
│   ├── ocr/orientation.py              # AUTO-ROTATE (90/180/270) via Tesseract OSD (osd.traineddata, Apache-2.0; bundled). detect_rotation(img)→CW° to upright (0 on low conf/failure/sparse — never guesses; conf≥2.0, OSD on a width-capped copy ~120 DPI). correct_image(img,r)=img.rotate(360-r) (PIL is CCW; pypdf is CW + additive → page.rotate(r) verbatim — the two opposite signs are PROVEN in tests/test_orientation.py; a wrong sign corrupts every doc). Integrated in tesseract.extract_text_and_images(auto_rotate, rotations_out): first import only (gated off under cached_text/reprocess), born-digital pages SKIPPED (upright). process_docs --auto-rotate emits file_done.page_rotations; processing/handler _rotateWorkingCopyIfNeeded runs pdf_rotate.py (pypdf in-place /Rotate, atomic .part→rename) on the inbox WORKING COPY before drain/auto-file, so the FILED copy + every reprocess inherit upright from one detection. Gated by auto_rotate_enabled (default ON; original is drained to Processed/ UNTOUCHED → mis-rotation recoverable). Settings → toggle.
```

# Database table design notes (moved out of the CLAUDE.md Database tables block, 2026-07-19)

> Same convention as above: each block is the ORIGINAL CLAUDE.md text, unedited.

## document_types.title_aliases (migration 43)

```
document_types  — name, slug, built_in, ref_field_key, date_field_key,
                  title_aliases  ← migration 43 (JSON array TEXT, nullable): extra printed-title
                  phrases that ALSO detect this type (a supplier that prints "Work Sheet" for a
                  type named "Worksheet"). Folded into the type's NAME-keyed bucket in
                  keyword.detect_document_type (result stays the NAME → detected_slug/heading-trust
                  unchanged; NO aliases = byte-identical). Validated by document_types.normaliseTitleAliases
                  (hard-reject an alias == ANY existing type name; drop <3-char/numeric/over-long;
                  cap 20). Edited via the "Also appears as" chips in the shared doctype-editor. Guarded
                  by database/modules/test_document_types_aliases.js + tests/test_detect_type_aliases.py
```

## supplier_hints — fill-empty-only + evidence-based variability guard

```
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
```

## field_anchors — teach-on-commit, authoritative sweep, per-axis blend

```
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
```

## template_landmarks (migration 22)

```
template_landmarks — template_id(FK cascade), label_text, x/y/w/h_norm, ocr_conf,  ← migration 22
                  page_number. 3-5 stable/unique/well-spread words auto-derived
                  from a template's sample page (ocr/landmarks.py); RE-located on
                  each incoming page to fit the Stage 0.5 registration transform
                  (registration.py). Additive/inert — a template with no rows uses
                  the existing anchor/offset path unchanged.
```

## template_logo_hashes — multi-reference logo identity (migration 26)

```
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
```

## settings — notable keys (registration/born-digital/name-wordness/accepted names/first-run)

```
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
```

