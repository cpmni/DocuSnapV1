# Pending Features & Deferred Work

> Running backlog. When a feature/fix is discussed but NOT implemented right away, add it here with
> the notes/details agreed + anything pertinent (symptom, code pointers, the fix direction, gates,
> and any advisor rulings). Newest at top of each section. Remove an item when it ships (note the commit).

---

## 2026-08-28 — WORKFLOW + STAMPING REDESIGN (design complete, Oracle SIGN-OFF-W/COND; awaiting owner sign-off + build)
**Design doc:** `docs/designs/WORKFLOW_STAMPING_REDESIGN_2026-08-28.md` (raw notes `scratchpad/workflow_redesign_notes.md`). Advisors: current-state map + eric (security) + barry (UX) + Oracle (vet). NOTHING built.
**Owner asks:** one "Send or stamp…" button in Search → a popup (Send-to-someone / Stamp-it-yourself / History) that fixes the "1 feature or 2?" busy corner; stamping promoted to first-class (today it's only a side-effect of approve/reject); user places the stamp by clicking whitespace; REMOVE the Settings 3×3 `stamp_placement` card, REPLACE with a custom stamp-type catalog (creatable); a new per-user STAMP PERMISSION (Settings→Users) "not easily flipped by a DB edit"; Search defaults to the stamped version + "view original"; full detached-client parity.
**Two invariants:** routing-only-to-intended-recipient (already solid — validated active recipients, actor-scoped views, to_user_id gates, both transports); immutable+attributable stamps (who/what/when).
**Design (Oracle-vetted):** permission = signed grant EVENTS folded into the existing DPAPI-keyed audit hash chain (NO can_stamp flag); append-only `stamp_events` record cross-linked into `audit_log` (self-chain over-built — audit link is the anchor); `stamp_types` catalog snapshotted at placement; cumulative render from records; click-to-place sends coords-only to main; new `/v1/workflow/...` stamp routes + contract bump + ported client.
**Oracle HARD GATES:** (1) `canStamp` verifies at CHECK-TIME (`secretStore.available()` true DPAPI AND `verifyAuditChain().ok`) — triggers block UPDATE/DELETE but NOT INSERT, and nothing auto-verifies today (`verifyAuditChain` only on a manual button); (2) stamp routes MUST live under `/v1/workflow/...` or the URL-prefix entitlement gate leaks (search-only client stamps free). CONDITIONS: artifact survives re-file (app-managed doc-id-keyed, not a filing sidecar — re-file orphans it); ONE stamped-read gate (by-route vs by-doc diverge on approved-but-unconfirmed); desktop self-stamp gates on `requireStampPermission`+`canAccessDocument` NOT `assertEntitled` (else the standalone owner can't self-stamp); self-stamp write ATOMIC; reword `source_sha256` (detects out-of-band byte edits, NOT reprocess); DTOs strip `artifact_path`; test harness injects `secretStore.__setSafeStorage`.
**RESIDUALS owner accepts:** stamping globally disabled if the audit chain can't verify (incl. benign key-loss / DB-restore); tamper-evident not tamper-proof vs the core PC's own admin; stamped PDF is a copyable on-disk derivative.
**5 OWNER DECISIONS before build:** (1) stamps stack (cumulative, recommended) vs each stamps original; (2) distinct "Can stamp" grant (recommended) vs one combined workflow permission; (3) accept fail-closed stamping on DPAPI-less/headless host; (4) approve the default 6 stamps (PAID/APPROVED/REJECTED/RECEIVED/ON HOLD/VOID) + catalog; (5) forward intents = for-approval / for-info only. **Delivery = 5 gated slices (§7), each Oracle-signed before flip; dark/add-on-gated by default.**

## 2026-08-28 — HELP REWRITE v2 + HEADER/MENU HELP + TOOLTIPS (PARKED mid-session, owner: "park this … mark the help work for later today")
Branch `feat/teach-side-overnight`. Owner's four asks this session + a method rule. **Everything below is UNCOMMITTED on disk** (node --check clean; HTML well-formed).

**Owner asks:** (1) rewrite the help VOICE — professional but layman, full sensible explanations, **KILL the "instruction + a footnote telling how you'll know it worked" pattern** (this REVERSES the plan §7 "How you know it worked" rule + Quick start's `.qs-know` footnote column). (2) A Help button in the HEADER of every window → deep-links to that window's section. (3) A Help button in the Home MENU + **REMOVE it from the Home header**. (4) **All tooltips** populated with clear descriptions. **Method rule:** for EACH section, read the code + code-notes until the exact behaviour is nailed, THEN write it — but for a simple non-technical worker.

**Built today (uncommitted):**
- `main/index.html`: removed `#btn-help-guide` from `#topbar` (kept the `?` `#help-mode-toggle` — uniform across all windows; ask owner if they want it gone too). `main/renderer.js:792`: removed the now-dead handler. The "User Guide…" menu item (`#menu-user-guide` → `openHelpWindow('home')`) already existed.
- HEADER help buttons **already exist** in Review/Settings/Search/Teach (`#btn-help-guide` → `openHelpWindow('review'|'settings'|'search'|'teach')`) — ask #2 already satisfied for windows that have a header. Header-less windows (welcome/tutorial/onboarding/license/update-lock/legal) skipped by design.
- `shared/helpmode.js`: NEW `window.populateHelpTitles(texts,root)`, called from `initHelpMode` — copies each interactive `[data-help-key]` control's help text into `title=` when it has none. **Auto-populates hover tooltips on all 173 `data-help-key` controls across the 5 core windows** from the existing HELP_TEXTS maps (accurate, in sync). Curated titles untouched.
- `help/quick-start.html` + `help/teach.html`: REWRITTEN to the new professional-layman voice, footnotes removed. **Teach label truth-fix:** the user draws the VALUE box only; the label auto-detects and is merely checked (`teach/renderer.js:929`). NEVER tell users to draw the label box.

**Verified mechanics (write the remaining pages from THESE, not the old text — owner: old text mostly redundant):**
- Graduation: `graduation_window='5'` (owner-flipped default, `database/index.js:139`; const fallback `TRUST_WINDOW=10`); **zero** corrections tolerated in the window; `TRUSTED_FLOOR=95`, `UNTRUSTED_FLOOR=100` (`trust.js:37-51`). Window counts HUMAN confirms only.
- Pass mark `auto_file_threshold=90` on a fresh install (`index.js:1688`; unset=100). Floor formula (`trust.js:1040`): `floor = (graduated||corroborated) ? min(userThr,95) : userThr`. **At the default 90 the floor is 90 whether graduated or not** — graduation's FLOOR effect only bites when the user raises the pass mark above 95.
- **The real early-hold is verification, not the floor:** a brand-new sender's docs are HELD at import (no confirmed history to verify ref/date against; `docTrustGate` sub-100 regime), even at floor 90. As clean confirms accumulate (~the window) enough history exists → its ready docs auto-file. **So the "N more to file by itself" badge is roughly truthful — RETRACTED my earlier "badge over-promises at 90" claim.**
- Background is ON for every install (mig 80 forces `scope_sweep_enabled`+`scope_sweep_auto_accept`+`quiet_reread_enabled` true). After EVERY human confirm `scheduleScopeAutoAccept` files that sender's docs passing `isAutoFileEligible` (the ONE predicate, `processing/handler.js:3716`) — the attempt starts on the FIRST confirm, not the 5th. Activity strip + quick-check grid OFF by default.
- **Exact on-screen copy + file:lines** for every user-visible surface (countdown badge `review/renderer.js:1985-2017`; per-doc reason strip `:3207-3212,3248`; consent bar `renderSweepConsentBar :7202-7279`; auto-file receipt bar `:540-580`; Home card `main/renderer.js:218-259`; quiet-reread hint `:9380-9398` + hold notes `rereadHolds.js:27-35`; Put back `:579,7274,772` + returned-doc hold `:3179-3181`; Settings sliders `settings/index.html:605-642`) — captured in this session's agent report; re-derive from those lines.

**LEFT TO DO (the parked work):** (a) Update Quick start step 6 + write `files-by-itself.html` around the TRUE background behaviour above (teach → confirm → sweep files ready ones after each confirm → receipt bar + Home card + Put back), quoting the verified copy. (b) Verify-then-rewrite the remaining spine pages to the new voice: index (home/paths), set-up, import, review, fix-a-detail; then the deeper pages (document-types, search, settings, learning, admin, troubleshooting, shortcuts, glossary). (c) Tooltip stragglers = non-`data-help-key` text buttons (Cancel/Save/Print…) if owner wants truly-all. (d) `help-nav.js` manifest/anchors + `npm run check:help` + `test_help_nav.js` green + a deep-link pin. (e) The plan's D1–D11 still nominally open (esp. D11 voice sign-off). Prior plan doc: `docs/designs/HELP_SYSTEM_REBUILD_PLAN_2026-08-27.md`.

## 2026-08-27 NIGHT — FIELD-TYPE REGISTRY + SURFACE EXHAUSTIVENESS (owner: "a common attribute function so anything that changes in future changes across the board … would a code refactor take care of this?")
**Exhibit:** the Serial Number (List) field is missing from Quick check. `batchAuditService.buildGrid` builds columns from extraction
ROWS (the grid unions the keys it finds) while Review builds fields from the type's SCHEMA; the engine writes no row for an empty
List read → 184/186 worksheets have no `serial_number` row → no column. Same class as the wizard's own `_splitListFields`.
**The class:** field TYPES are handled by scattered per-surface conditionals (`=== 'list'`: 25 sites / 7 JS files + 4 Python;
`barcode` the same) — editor, Teach, Review pills, freeze skip, hint skip, rule guards, Quick check, search, XML/export, /v1 —
each decides alone; a new type/attribute = N hand edits with nothing enumerating them.
**Refactor (targeted, one axis — YES):** (A) ONE field-type registry `shared/fieldTypes.js` + a Python twin (or one JSON both read):
per type — label/tip · teach mode (box / caption / none) · Review widget (input / pills / picker) · Quick-check widget ·
`alwaysPresent` (a schema field gets a row/column even when read empty = the Quick-check fix) · variable (never freezes) · role
eligibility · learnable by hint/anchor/rule · search/export/XML shape (joined vs per element) · strict for trust · validation
pattern; every `=== 'list'` site becomes a registry read. (B) an EXHAUSTIVENESS test generated from the registry: every surface ×
every type must have an explicit branch (no silent default) and "which fields exist" comes from the schema everywhere — the
mechanism `test_settings_wiring.js` already is for switches; `test_doctype_surface_parity.js` (RED, ignored) goes green inside it.
**Not covered / other axes:** roles are already one predicate (`isStructuralKey`) — the 08-27 required-flag bug was a WRITER not
asserting an invariant (fixed: one writer + a startup assert); switches have the wiring pin. Rule: one definition, consumers read
it, an enumeration test that fails on a missing branch — per axis, never a whole-app rewrite. **Size:** one focused session;
gate = realdoc byte-identical (no read changes) + UI pins + the Quick-check serial column as the first red→green.

## 2026-08-27 — HELP SYSTEM REBUILD (owner-vet: eleven decisions; plan written, NOTHING built)
Plan: `docs/designs/HELP_SYSTEM_REBUILD_PLAN_2026-08-27.md` (`a9256dd`) — gap map of the 12 current help pages (stale claims with
file:line, zero-coverage list, dead deep links), a teach-first architecture A0–G3 (teach-then-import is the recommended route), a
7-step Quick start with a "you'll know it worked when" column, `[SHOT]` markers S1–S15 (S15 = owner), glossary, delivery slices,
an acceptance checklist. App change asked for: a "User Guide…" item in the Home account menu (`#user-menu`, above "Show welcome
tour" → `openHelpWindow('home')`; keep the top-bar Help). **Blocked on the owner's answers to D1–D11 (§12 of the plan; D11 first =
approve the voice on Quick start + Teach before the rest is written).** Facts already corrected at source while planning: the help
window is NOT modal (`main.js:502`); the Mailbox is LIVE for add-on holders; the sweep/consent bar is ON for every install (mig 80).

## 2026-08-27 — BARCODE ANCHOR: pick the right code by POSITION (owner: "when a doc has multiple codes I'd like to anchor the correct one to a point on the page so that one is always found" — "add to the list")
**Today:** the decoder already records every symbol's page box (`x/y/w/h_norm`, the anchor-crop frame; stored in
`document_barcodes`), but Stage 1.5 (`engine.py` ~7719-7750) picks by COUNT only — one code-like decode → the field @100 +
confirm-once; several → EMPTY + "Several barcodes on this page: A · B · C — type the right one" (`barcode_ambiguous`); ⊕ is
refused on a barcode field (`review/renderer.js` ~4503) and the wizard pulls it from the draw list (`teach/renderer.js
_splitListFields`) because a box would never have been consulted.
**Design (small; own switch riding `barcode_field`; gary → Oracle first):** (1) TEACH — allow ⊕ / the wizard box on a
barcode-typed field; store the box as the field's anchor REGION per sender × type (`field_anchors`, marker label
`__barcode__`, no new table); teach-time read-back from the inventory: "✓ Code128 INV-… sits in your box" (no OCR).
(2) READ — at Stage 1.5, with ≥2 code-like decodes and a taught region, take the decode whose box overlaps the region
(same drift tolerance the registration path gives anchors) → value @100 + confirm-once (auto-file later via B2 learning);
exactly one inside → picked; zero or ≥2 inside → today's ambiguous hold. SEAM to put to gary/Oracle: a single decode FAR
from the taught spot — pick it but note "not where you taught it" vs hold. (3) B3 — click a decoded barcode on the page
overlay instead of drawing (the inventory has the boxes). Size ≈ engine 40 lines + Review ⊕/read-back 30 + wizard 10 + pins.

## 2026-08-27 — Chris round 6 leftovers (owner-vet; the fixed cards are in `docs/CHRIS_FULL_APP_REVIEW_2026-08-26.md` TRIAGE)
- **Card 1 residuals (gary's named seams; the letterhead-scope arc `template_buyer_issued_letterhead_scope` is BUILT
  DARK):** (1) **the mark seam** — only PO-ref types are ever `buyer_issued` (`templates.markBuyerIssued`), so the
  owner's OTHER outbound layouts (sales orders / invoices / quotes THEY send, same letterhead, same poisoned
  fingerprint) are protected by neither this arc nor the type guard; an own-company mark (widening `buyer_issued` to
  "self-issued") would be covered by the arc for free — needs a census of the owner's outbound types first.
  (2) **the logo arm's text gate is whole-page too** (`engine.py _branding_own_ratio`, banks keyed by supplier not
  template): on a genuine phash collision with the owner's letterhead the owner's branding is on every inbound page →
  'accept'. Not this exhibit (phashes far apart); its own slice. (3) **band OCR variance** — a sibling whose first
  recipient/counterparty marker lands earlier than the sample's can score below 0.75 → Review (never a wrong company);
  measured by the realdoc per-template match count OFF == ON. (4) A template fingerprint harvested BEFORE the 08-01
  counterparty markers may hold the sample's counterparty name → its own POs dip → Review; R1 intersect heals on confirm.
  (5) **Oracle condition 7 (next slice):** surface `sticky_binding_declined` (both reasons: identity not on the page /
  `letterhead`) as a REVIEW NOTE — "This layout's letterhead isn't on this page — read without it" — today the reason is
  stderr + a trace event only, and the Review "Template available" pill (JS logo/presence, whole-page) can contradict a
  Python decline; the pill/graduation roads should read the same predicate Python uses.
- **Chris round 7c new cards (2026-08-27, owner-vet):** **A2** a TYPE change in the Review dropdown is PERSISTED without a
  confirm (the row regroups at once; moving away and back shows the new type with its fields "Not found" until the type is
  switched back) — say so once, or offer an Undo beside the dropdown (the "Ready to file" contradiction half is FIXED: a
  neutral "Type changed to X — check the fields" lead). **B** overtyping a HIGH-confidence issuer read (Castellan @95)
  offers "Apply 'X' to 20 & re-read" for a name printed on none of them — keep the offer for a BLANK sender; for a
  high-confidence read ask "This page seems to say 'Castellan…'. Use 'X' for this one only, or for the 20 others too?"
  (`offerIssuerRipple`; the re-read's page checks are the safety today). **C** the "Teach this document" card says "We
  recognise this sender but haven't learned this layout yet" beside a "Sender not identified" row — key the copy off the
  blank-sender case ("We don't know this sender yet — teach it once, or type the company name"). **D** after Delete All the
  right column keeps the binned document's (disabled) Reprocess / bin / Confirm buttons and the sender button — hide them
  with the panel (`clearDocPanel`). **E** with a drawn/typed sender in the box the blue box still says "The Document Issuer
  box is still empty… Read at 0%" until confirm (the blur path repaints only on a DIFFERENT settled issuer).
- **Card 6, second half — group machine-guessed senders under "Sender not identified (guess: X)"** (the r4 Card 3
  "N more to file by itself" WORDING question is still open too). Built today: the countdown badge renders NOTHING for a
  sender whose every pending scope has `confirms` = 0 (`_senderReadinessLabel`). The GROUPING change (queue header +
  `groupQueueBySender`) is a bigger UX decision — a guessed name still files as a folder if confirmed as-is.
- **Card 2 follow-through:** `trust_role_disagreement_refuse` is ON on the owner's live DB but was OFF in the Chris
  sandbox; arm it in `arm_sandbox.js` for the next round so the "the page reads X two ways" hold is exercised. The
  "_| 24-06-20" crop read salvaged to "24-06-2025 @94" is the leading-digit/month date class (owner accuracy queue).
- **"Also noticed" (uncarded, copy):** the sender-confirm question is labelled "Needs a quick check — 1 field was
  flagged by a formatting check" (it is an "is this the sender, not the customer?" question); before a type is chosen
  the field labels read INVOICE DATE / INVOICE NUMBER on a delivery note (the default type's labels) — consider
  role-neutral labels ("Date" / "Reference") until a type is set; "Fields read by: Unknown".
- **Settings (Chris, every round):** the Processing "wall" of ~50 switches → a Recommended/Advanced split; move
  "Clear ALL learning memory" / "Erase ALL data" off the Learning tab (beside the per-sender ticks) under Advanced;
  hide the `supplier_name`-style key codes in Document Types for non-SFDEV users; Terms still "WORKING DRAFT".

## 2026-08-26 NIGHT — follow-ups from the overnight build (all owner-vet; nothing here is built)
- **Barcode field B2 — LEARN at confirm** (symbology + length-set + prefix per (sender,type,field); a new small
  table, never `supplier_hints`/`field_anchors`) so a barcode field can AUTO-FILE — tonight's slice B holds every
  doc with a confirm-once note by design. **B3** teach pills (click a decoded barcode on the page in ⊕/Teach).
  **B4** barcode ↔ OCR-ref corroboration as a NEW family in `_corrob_record_bucket` + `trust._corrobLicensed`
  (census first — Oracle C1 pattern: a new family moves auto-file both ways). reggie's rules ready to build:
  `validation_patterns` keys (barcode_gtin/sscc/gsin/code39/text), GS1 mod-10 twins (Py+JS), a GS1 AI tokenizer
  (`gs1.py`/`gs1.js`, `TextMode.Plain` for FNC1), HRI witness via `_page_presence_corroborated` + a case-preserving
  confusable sibling. Owner Q: which symbologies do customers print? may a barcode be the ref/filename role? ever
  `required`?
- **LIST field — TEACH ITS CAPTION: ✅ BUILT in the WIZARD 2026-08-27 (owner spec: "capture 1 value and the label is
  drawn; every iteration of that keyword populates the list; the label is added, if not already there, to the keywords
  for the field of that doc type; teach displays all the captured values before confirmation").** The wizard keeps a
  List field teachable; one value box → the caption beside it (`autoLabel`) → the confirm panel previews every value the
  caption collects on the page (`_listPreviewValues`, a JS twin of the inline collector) → "Looks right" → at save
  `teach-list-caption` (Admin+Edit, list-typed only) writes the caption as an ADDITIVE doc-type-wide override
  (`field_label_overrides`, template_id 0; `merge_label_overrides` CREATES the keyword entry for a custom key) and the taught
  doc files with all the previewed values; no box is stored. Pin `test_teach_auto_field_rows.js`.
  **✅ The Review ⊕ road too (built ~15:00):** ⊕ on a List field boxes ONE value → the caption beside it is staged as a
  `{listCaption}` record in `pendingAnchors` (so every reset / unsaved-changes guard applies) → the field is filled with EVERY
  value the caption collects on the page (`shared/listCaption.js`, the ONE preview both windows use) + the bar says so → at
  confirm the record routes to `teach-list-caption` (never `saveFieldAnchor`). No caption read → nothing staged, the bar says
  a list is taught by its caption. Residual: the preview is the inline (same-line) shape only — a caption ABOVE a column
  previews element 1, like the collector.
  **✅ REVIEW PILLS (built 2026-08-27 pm; panel barry/gary/reggie/eric/bob/Chris-lens → Oracle SIGN-OFF-W/COND, log
  `docs/oracle_log.md`):** the list field's text box is now a PILLS view over the (hidden) store input — click a pill to edit
  it, ✕ removes it (stays greyed with ↺ put back), "+ One it missed" = the ⊕ caption teach (merge rule current ∪ (preview −
  (original − current)) — never resurrects a removed entry, never drops a typed one), "Edit as text", "Undo changes", receipt
  "N found on this document". Learning from a pill edit is THIS DOCUMENT ONLY (no hint — `saveCorrections`/`replantConfirmHints`
  skip a list-typed field); the caption teach is the only future-facing lever. Guards: the right-click cleanup toolkit,
  `save-field-rule` and the engine field_rules loop all refuse a list key. Collector: union across TAUGHT captions in page
  order, caption tail bound (collect-only, `LIST_CAPTION_TAIL_BOUND`), digit gate for a list of codes + caption-vocab arm
  (`LIST_ELEMENT_DIGIT_GATE`), longest caption wins per line, own-label-only seed for a list-typed ref-role field.
  **Residuals / deferred (named, not hidden):** (a) a taught caption and the field's OWN-LABEL seed do NOT union (Oracle
  cond 1 = override-only; synthetic mixed "Serial No"/"Serial Number" pages score 8/60 until both are taught — teach both, or
  a follow-up unions the own-label seed for list-typed fields); (b) a caption ABOVE a column still yields element 1 (header-row
  pages: 0/60 exact either arm — a column collector is its own arc); (c) no count witness / no within-document shape
  consensus (an amber "looks different" edge on an odd pill — a non-note channel so it never blocks filing; census first);
  (d) trust: `docTrustGate` may hold a list field on a graduated sender via the none/constant/code classes and one corrected
  serial counts as a scope correction — trust-count exemption + `getFieldFormats` element split = slice 2 (census first,
  Oracle-flagged); (e) the receipt never names the caption (the stored row carries no verified caption —
  `extractions.anchor_label` is never set for a keyword read); (f) search/export per element (barry).
  **Found by the evening gates + Chris r8 (2026-08-27) — NOT built, owner vet queue:**
  (g) **BUILT DARK 2026-08-27 (night) — `ocr_light_text_recovery` / `OCR_LIGHT_TEXT_RECOVERY`** (oscar recipe + 007 geometry;
  recipe: FOUR threshold levels {200,210,220,230} merged per spot, a digit string needs two agreeing levels — a single level
  (200) won the sandbox sweep but read 1 of 7 serials on the owner's own scans; the union reads all ten values on four exhibits;
  rows-first placement with a frozen `med_h`; the real pipeline fills `serial_number` on the owner's docs 11/13/1504). FLIP conditions live in
  the night handover: the corroboration common-mode exclusion (a light-line keyword read is not an independent family), the
  `documents.ocr_text` Reprocess cache (a flip heals nothing until re-OCR), the VAT-reg footer relying on `VAT_REG_NOT_AMOUNT`.
  Original finding kept below for the record. **OCR TEXT-LOSS ARC (blocks the serial feature on SCANS):** the stored page text of the scanned Castellan worksheets has NO
  "Serial No: …" lines (live docs 11/13/1504; sandbox doc 217 vs the born-digital doc 2 of the SAME PDF, which has both) — the
  OCR / visual-row rebuild (`ocr/tesseract.py`) drops the small lines under each item row (only "i"/"cd" debris survives). Same
  class as the 08-22 "type banner dropped from page text on 105/416" census. **MEASURED (evening):** Tesseract returns ZERO
  "Serial"/"CT-" words for the scanned page at 200 AND 300 DPI in PSM 3/6/11 — the pixels are plainly there
  (`TESTING/_measure/list_field_20260827/band_scan_200.png`: 7.5-pt grey rgb(90,90,90) on a tinted row) — while a global
  threshold at 200 → PSM 3 reads `Serial 93 · No: 93 · CT-8051702 91 · CT-8813265 90` (`probe_contrast.py`). Design + gate in
  `HANDOVER_2026-08-27_EVENING.md` §2: a third supplementary source in `reconstruct_page_text` (threshold ~200, empty-region
  merge under the existing `_center_in_any` rule, conf ≥ 50), DARK `ocr_light_text_recovery`, oscar/007 → Oracle; gates =
  realdoc OFF==ON + fingerprint-diff census + recovered-words census + the serial exhibit healing + a Chris round. Until then
  a caption teach collects nothing on scanned worksheets.
  (h) **BUILT 2026-08-27 (night) — structural roles are REQUIRED BY NATURE** (owner: "surely the main fields ref, date and supplier
  must be required by nature"): the real mechanism was not the scorer but the WRITER — the shared doc-type editor's create road
  (`seedCreate` → `create-doc-type-with-fields`) wrote `required=0` on the identity + ref/date fields it supplied (every SEEDED
  type has `=1`), the edit-mode toggle is LOCKED ("always required") and `updateField` refuses the change, so the "tick
  required" remedy was impossible in the UI. `document_types.assertStructuralRequired` now asserts the flag at every create /
  role re-point / backup-restore road + **migration 92** heals existing installs (live: the 3 `service_worksheet` rows). The
  scorer is unchanged (the flag is the ONE source); an optional List field is simply not scored unless the operator requires it.
  (i) **within-document shape consensus exhibit** (Chris r8 card 2): `Serial No:    T-8325384` (OCR misread, no "C") sat beside
  `CT-8116138` with no mark — the deferred (c) above now has its exhibit.
  (j) "Never on these documents?" link copy reads as a riddle (Chris r8 card 5) → "This field isn't on these documents — hide it".
- **LIST field residuals (audited 2026-08-26):** a caption ABOVE a vertical COLUMN reads element 1 only (the
  collector is per-line label→value); no count witness; search indexes the joined string (no per-element snippet);
  chips UI + long-format CSV export + repeated `<Value>` XML elements (barry). Tonight shipped only the `;`
  separator refusal at the writer + the renderer split narrowed to `;`.
- **DATE-from-REFERENCE own-collision guard (007's arc, Oracle-scheduled NEXT after the 2026-08-28 `5430bed` date fix):**
  a date whose digit-skeleton equals a confusable fold (I↔1 / O↔0 / S↔5) of the doc's OWN resolved reference is not
  credible AS the date — refuse it. Closes the silent-misfile residual `tier_a_date_plausibility`'s ~3y future-bound
  CANNOT catch: a near-future serial→date (a ref ending 2026-2029). Needs the reference resolved before the date
  arbitration (its own ordering seam) + a confusable-skeleton compare. Probe 2026-08-28: 0 of 1909 confirmed refs fold
  to a <3y date, so it's a rare-sibling follow-up, not build-now. Companion (higher blast radius, separate arc): stop
  certifying the bare anchor TEXT-FALLBACK as `located` "by construction" (`anchor.py:1472`) + column-bound the
  merged-row read to the located label's x-span (007's structural root; needs its own full-corpus gate).
- **HELP SYSTEM rebuild — SLICE 1 BUILT 2026-08-28 (`8b3a35d`; plan `docs/designs/HELP_SYSTEM_REBUILD_PLAN_2026-08-27.md`):**
  the plain-speak SPINE + Check pages (index/quick-start/set-up/teach/import/review/fix-a-detail/files-by-itself) on the
  teach-first route + a "User Guide…" Home menu item + rebuilt `help-nav.js` manifest + pin `test_help_nav.js`. STILL TO
  DO (slices 2–3, after the owner signs off the VOICE on Quick start + Teach — plan D11): rewrite document-types, search,
  settings, admin, learning, troubleshooting, shortcuts, glossary, other-PCs; capture screenshots S1–S14 on the Chris
  sandbox (owner supplies S15 only); the popup→guide "More in the guide →" links + print/readability polish (slice 4);
  clear the 20 pre-existing `check:help` popup-text gaps (separate copy pass).
- **MEMORY INVENTORY click-to-browse — BUILT 2026-08-27 night2 (`d2cf9fe`):** Settings → Learning is now a READ-ONLY
  click-to-browse scope list → detail (reuses `learning-scopes {suspects:false}` + `get-learning-recovery`); the typed
  search + cleanup tools + raw table are preserved under an "Advanced" disclosure; deep-link `rpOpenScope` into Repair.
  See `HANDOVER_2026-08-27_NIGHT2.md`. STILL DEFERRED = the v2 sections below.
- **Learning Repair v2 LATER sections (barry, Oracle-trimmed):** the remembered-values editor (dominant/hints/
  corrections per field with rename/forget via the existing Review IPCs; the sender name ONLY through
  `renameSupplier`), the layouts canvas (reuse `redrawTplCanvas` read-only + "Fix where it reads" deep-link to the
  wizard — never a second box editor), rename/merge as its own arc (`renameSupplier` misses field_rules /
  identifiers / templates.name / accepted-issuer / graduation_optout; collision → MERGE routes into the irreversible
  `templates.mergeInto`), a WHOLE-SENDER forget (logos + identifiers + accepted-issuer), "Recently forgotten" list
  from the snapshots, the Learning tab's raw inventory table → SFDEV-only. Owner Qs: S×T vs whole sender; stay-filed
  vs back-to-Review after a forget; never move files + an explicit "Re-file N" button.
- **Barry's expected-feature sweep (2026-08-26, ranked):** 1 searchable-PDF text layer on the FILED copy (L2,
  must — every peer does it; invisible-text overlay via pypdf from the `image_to_data` word boxes; owner Q: may the
  filed PDF differ from the original bytes, given originals are kept?) · 2 barcode (built A+B tonight) · 3 exact-
  duplicate skip at import (SHA-256 of the original bytes; L1 quick win; stops `-DUPLICATE` breeding) · 4 export /
  accountant pack — **the EXPORT TOOL is BUILT 2026-08-27 night2 (`ce4c7f5`): Home → Export data → suppliers/types/
  fields → CSV (BOM, formula-safe) / real .xlsx (dependency-free `src/lib/xlsxWriter.js`, inlineStr = reference numbers
  survive) / JSON. STILL DEFERRED: column presets (owner Q: Xero/Sage/QuickBooks column maps), copy-the-PDFs alongside,
  List long-format (one row per element).** · 5 supplier/customer LIST IMPORT as a witness (seeds the gazetteer + identifier registry day one;
  a list match is a witness never a trump) · 6 LIST finish. Rejected/deferred with reasons in the round notes:
  email-in, print driver (Send-To shortcut + drag-drop instead), tags, retention, handwriting, TWAIN.

## 2026-08-26 — ONE general "corroboration clears a verification-doubt note" rule (class F) — ✅ BUILT DARK 2026-08-26 NIGHT
**Built** (`CORROB_VERIFICATION_DOUBT_CLEAR` / `corrob_verification_doubt_clear`, DEFAULT OFF; Oracle SIGN-OFF-W/COND,
`docs/oracle_log.md` 2026-08-26 NIGHT): allowlist of write-site constants, ≥2 distinct page families + un-noted
witness, exact learned skeleton (+ the length leg the pin found), totals/currency refused, re-read mark needs a
keyword witness, flip-order guard in `_reconcileEnv`. 39 pins. **OWED before flip (owner): the C5 gate** — the
held-queue census on a DB copy (docs whose note is an allowlisted mark → reprocess with F ON → eyeball every `cls=F`
clear), the SFDEV live heal of SuperStore 31901, the clip positive control. The audited entry below is kept for the
record.

## 2026-08-26 — TARGETED field re-slice after a ⊕ box teach (skip the full re-OCR) — owner idea — ⚠ ADVISORS: WRONG LAYER (2026-08-26 NIGHT)
**gary + oscar (independent, converged):** the premise is partly STALE — on a reprocess the full-page OCR is ALREADY
skipped (cached `ocr_text`, `handler.js:4125`); what re-runs is render + every crop stage + Stage 2/4/4.5, so a
field-only read saves ~2-3× per sibling (≈3-5 s → 1-2.5 s), not 10× (the page-wide word pass + render + spawn are the
floor). And a field-only WRITE poisons the `rereadHolds` baseline (the later full read sees the value already stored →
no first-fill hold, no S3-C5 = the Oracle C3.3 misfile re-opened), has ONE family (never corroborates → never heals a
note → "nothing cleared"), and bypasses the on-page identity test. **Ruling: WRONG LAYER for the filing road.** Smallest
honest slice = a SUGGESTION-ONLY "quick read" pill (no DB write; Review offers "Use") — build only AFTER a timing
measurement of one lane job over the Pelican/DOC-SOL siblings vs a `--field-read` pass. **The cheaper lever already
exists: flip the Oracle-signed layout arm `quiet_reread_on_layout` (DARK) after its own Chris round** — armed in
tonight's Chris sandbox for that evidence. Owner decision.
**Owner:** *"when a doc is taught and lands in review, after a couple of commits some linger. If I draw a
box round a value, are we auto-reslicing the other docs in that group? A 'Reprocess all X' clears the queue
but it seems unnecessary to re-OCR the whole doc."*
**Current behaviour (verified this session):** a ⊕ box / template-mapping write triggers the quiet re-read
lane's LAYOUT arm (`quietLane.js`, reason `'layout'`, gated `quiet_reread_on_layout` DARK + `template_identity
_on_page`) to re-read the sender's held template-carrying siblings — BUT via `_runReprocessShard`, a FULL
re-OCR of each page (demoted background), identical to the foreground "Reprocess N from sender." There is NO
targeted single-field re-read: nothing applies the new box to the ALREADY-STORED page words/image for just
that field. So (a) siblings only auto-update if the DARK arm is armed + on-page-identity on, else they linger
until a manual Reprocess; and (b) even then it re-OCRs the whole page for a one-field change.
**Fix direction:** a lightweight "apply this new mapping to the group" path that re-reads ONLY the changed
field's target zone from each sibling's stored working-image via `ocr/region.py` zone-OCR (or the stored word
geometry / `documents.ocr_text` where the value is textually present), updates that one field + its holds, and
skips Stages 0-4 full re-OCR. Reuses the Stage-0.5 mapping's absolute-target read. Big perf win on large
same-layout batches (the Pelican/DOC-SOL case). Gate: fail-toward-review (a zone re-read that can't verify
holds), OFF byte-identical, must land the SAME value a full reprocess would (pin against the full path on a
sample). Pointers: `python_backend/ocr/region.py` (zone-OCR), `python_backend/extraction/template_mapper.py`
(absolute-target read), `src/modules/processing/rereadHolds.js` + `quietLane.js` (the re-read road it would
join), `documents.working_path`/`ocr_text`. Advisor+Oracle before build. NOT built.

---

## 2026-08-26 — Manual-landmark boxes don't SNAP to the words (owner-spotted) — ✅ SHIPPED `9861d37`
**Shipped 2026-08-26 NIGHT:** `addLandmarkFromRect` now runs the shared `BoxSnap.snapBoxToWords` under the
same `template_box_word_snap` gate as the mapping path, fail-closed to the drawn box; pinned in
`test_settings_wiring.js`. (Entry kept for the record; remove on the next sweep.)
**Symptom (screenshot):** Settings → Templates → "Manual landmarks (advanced)" on the SuperStore sample —
the drawn landmark boxes (Rate / Bill / INVOICE / Discount / Quantity) sit LOOSE/offset from the printed
words rather than snapping tight to them. The owner: *"the boxes don't snap to the values as expected."*
**Likely cause:** the MAPPING-box draw path word-snaps to the printed words (shared `BoxSnap.snapBoxToWords`,
`settings/renderer.js` ~3977-4025, `snap*` gated by `template_box_word_snap`, default ON — added 2026-08-10),
but the MANUAL-LANDMARK draft path (`tplLandmarkDraft` / `renderLandmarkList` :3192 / `redrawTplCanvas`,
draw handler ~3179-3283) does NOT run that snap — so a hand-drawn landmark stays loose and stores/displays
loose. Secondary possibility to rule out: the landmark OVERLAY in `redrawTplCanvas` uses a slightly different
norm→pixel transform than the doc render (a scale/frame offset), which would show even a well-stored box as
misaligned. **Fix direction:** apply the same `BoxSnap.snapBoxToWords` tighten to a freshly-drawn landmark box
(mirror the mapping-box snap at ~3977-4025 — same `template_box_word_snap` gate, snap in the straightened
frame), AND verify the landmark overlay transform matches the doc render. Landmarks re-locate by WORDS at read
time, so a word-tight box also improves registration. Pointers: `src/windows/settings/renderer.js` (~3179-3283
landmark draw, ~3977-4025 mapping snap), `src/windows/shared/boxSnap.js`, `template_landmarks` table. Low risk
(admin viewer only; no filing impact). NOT built.

---

## 2026-08-26 — ONE general "corroboration clears a verification-doubt note" rule (class F) — audited
**Owner-spotted exhibit:** SuperStore invoice_number **31901** held @78% by "*The taught box's edge cuts through
the printed value… the fuller reading could not be verified*" — yet `template_mapping_edgecut`=31901 AND
`keyword`=31901 (two independent PAGE families agree). Owner: *"clear corroboration here — why won't it clear?
are there OTHER messages that should be demoted so we aren't whacking 1 at a time?"*
**AUDITED (gary, 2026-08-26 — full table in the round notes).** `engine.py:_resolve_corroborated_notes` has 6
note-clear classes (A-E,P); NONE covers this class. The general answer:
- **Bucket (b) — SHOULD clear on genuine ≥2-family agreement but has NO rule (the whack-a-mole set):**
  `_EDGE_CUT_NOTE` (template_mapper:524; written :1915/:2460/:3374) · `_FT_FALLTHROUGH_NOTE` "read from the
  surrounding line rather than the taught box" (:784/:1105) · `_NAME_GROW_NOTE` (:582/:3335, name-risk — gate
  separately) · the value-already-rewritten-clean family ("corrected to the learned format…/trimmed to the
  expected format…/re-read from the page… please verify"; anchor:1638/1647, engine:9272/6729).
- **ONE general rule retires them all (not case-by-case) — new class F, DARK env:** clear a note iff (1) its
  MARK ∈ an allowlist `_VERIFICATION_DOUBT_NOTE_MARKS` (bucket-b marks, MIRRORED to write sites à la
  classFixService CLEARABLE_NOTE_MARKS so a reword goes inert) AND (2) `_corrob_licensed(rec)` — ≥2 DISTINCT
  page families {mapping,crop,keyword} agree on the committed value, none disagreeing AND (3) the value passes
  its LEARNED SHAPE (`format_anomaly_checker.check_value`; NO shape → refuse, fail-closed) AND (4) licensed on
  FAMILY AGREEMENT alone, NOT value==dominant (an invoice# is unique per doc) AND (5, recommended) the agreeing
  witness is UN-noted (Oracle-B3 `noted` bit — else a flag-only @70 read stands in as the 2nd family).
- **The seam keeps bucket (c) safe (3 layers, verified):** distinct-family requirement + same-family skip
  (`engine.py:1800`/`:4172`) — a self-agreeing common-mode misread can NEVER license (answers the owner's
  worry); the shape-pass leg auto-excludes every "format differs"/shape-mismatch note; the allowlist is
  DENY-BY-DEFAULT so disagreement / invalid-date / identity/type / "couldn't-confirm-anywhere" (Fix A) /
  sign+reconciliation notes are never sweepable. Keep DISAGREEMENT notes in their own `_d1`-style arm (witness-
  sides-with-committed + dissent recorded), NEVER in F. Keep TOTALS in `_d2` (oracle_log:737 — F must not
  co-arm with the recon-total demoter).
- **⚠ CORRECTION to the earlier draft of this entry:** clearing the note does NOT drop the per-FIELD confidence
  CAP — only the OVERALL format penalty (the recompute guard). The edge-cut caps invoice_number ≤70
  (template_mapper:2458/1914) and `trust.js:1104-1120 weak-critical-field` reads the FIELD confidence directly
  (70<88 → still held). **So class F must ALSO LIFT the field to 90** (like `_d1` `_CROSSCHECK_CORROB_CONF`),
  not just pop the note — matters doubly for a NON-critical capped code field (account_no) that
  `critfield_corrob_floor_relax` doesn't cover.
- **Gate:** DEFAULT-OFF env; OFF==ON byte-identical; realdoc M=0 + zero per-field accuracy drop; PINS — F clears
  `_EDGE_CUT_NOTE` + lifts to 90 on a 2-family agreement/shape-pass; a SINGLE-family (or disagreeing, or
  shape-failing) record KEEPS the hold; the allowlist↔write-site mirror; a genuine clip (box VXS986 vs page
  VXS98624, families DISAGREE) stays in review. Harness can't bit-reproduce the live edge-cut misread → prove
  no-regression on the corpus, watch the actual heal on the live doc via SFDEV before flip. Advisor+Oracle
  before flip. Pointers: `engine.py:1800/3517/4101/9974-10005/1084`, `template_mapper.py:524/582/784/2458`,
  `trust.js:1055-1064/1104-1120`, `classFixService.js:60-65`.

---

## 2026-08-25 — FLIP DECISION for the two DARK detection arcs (RATIFIED, owner-gated, NOT flipped)
Oracle ratify `docs/oracle_log.md` 2026-08-25 (`97f2da2`). Corpus A/B (realdoc, 1078 confirmed docs,
OFF vs both ON) = byte-identical (would-file 1049=1049, M 11=11, 0 supplier changes) → proves NON-DESTRUCTION,
NOT the heal (both arcs inert on the clean corpus; the triggers aren't in confirmed data).
- **`branding_strip_reg_boilerplate` — SIGN OFF.** Cleared to flip **owner-manual per-DB now**
  (`set-setting branding_strip_reg_boilerplate true`). Promote to a NEW-INSTALL DEFAULT (migration) only
  after the held/misfiled reprocess shows doc-732 (Oakhaven→Castellan @94) now abstains/flags instead of filing.
- **`name_dominant_snap` — SIGN OFF W/COND.** The LLC↔LLP valid-form-swap hole is CLOSED (`97f2da2`).
  Owner-manual per-DB only; new-install default **deferred** until real `+name_snap` fires are eyeballed
  correct on the held queue.
- **THE MERGE GATE for any default-on:** a HELD/MISFILED reprocess diff (NOT the confirmed corpus) must be
  non-empty AND 100% correct. Empty → keep DARK (no measured benefit; name_snap would add silent-adopt
  surface for nothing). Census helper: `scratchpad/census_template_issuer.js` pattern + the rr_diff on dumps.

---

## 2026-08-15 — SEPARATOR SHEETS: one GENERIC split-sheet, not numbered (owner idea)
Owner: *"on the separator sheets, we don't need them by number. 1 generic sheet should be enough for
the app to know to split."* Today's split-PDF flow (✂ Split-PDF in Review, `split-pdf` IPC → pypdf,
`every N` or explicit ranges) is manual. The idea: a customer inserts a **single generic separator
page** (a printable marker sheet the app ships) between documents in a batch scan; on import the app
DETECTS that marker page and splits the multi-page PDF into separate documents at each marker — no
numbered/indexed sheets, no per-document configuration. Direction: (1) ship one printable marker sheet
(a distinctive full-page mark / QR / barcode the OCR or a cheap image check recognises reliably); (2)
on import, scan each page for the marker; a marker page is a CUT POINT (and is itself discarded, not
filed); (3) each run of pages between markers becomes one document through the normal pipeline. Relates
to the existing Split-PDF + the Filing-Slips design. NOT built — spec + advisor pass (oscar/007 on the
marker-detection reliability under scan noise) before building.

## 2026-08-13 — BUYER-ISSUED SLICE 3 (the stamp-contradiction rail): **MEASURED AND REFUSED — DO NOT BUILD AS DESIGNED**
Slice 2 SHIPPED (migration 66 + `template_buyer_issued_type_scope`, DEFAULT OFF). Slice 3 was
designed as: *a `template_fixed` stamp of a `_PRECISE_VAL_TYPES` field contradicted by a DIFFERENT
well-formed same-type value on the page ⇒ note + hold below auto-file.* Its own design named the
gate — *"`extractions.corroboration` already records this disagreement, so the rail can be MEASURED
from recorded rows before it acts"* — and the measurement refuses it **twice, independently**.
**CENSUS (read-only, snapshot of the live DB, 6514 rows carrying a corroboration record):**
```
field            stamped  agreed  contradicted
supplier_name       1038    1037           192
vat_no               120     120             0     <-- the field the rail was FOR
customer_name          5       0             5
account_no             2       0             0
```
**(1) INERT WHERE IT WAS AIMED.** `vat_no` is stamped 120 times and contradicted **ZERO** times.
A rail keyed on VAT contradiction fires on nothing. **And `_PRECISE_VAL_TYPES` is literally
`frozenset({"mac_address", "ip_address"})` (`anchor.py:2563`) — `vat_no` is not in it** — so the
slice as written would have been inert for VAT *by construction*, before the data even spoke.
**(2) NOISY WHERE IT WOULD ACTUALLY FIRE.** Restricted to page-reading families (crop/keyword),
121 rows contradict: **116 `supplier_name` + 5 `customer_name`, and the "contradiction" is junk** —
`keyword="DELIVER TO"` (a caption fragment, ×100+ on the owner's own POs) and
`crop="Jordwind Refrigeration Ltd"` / `"lordwind…"` (an OCR garble of the SAME name that is
stamped). Every listed exhibit is a document where the STAMP IS CORRECT. Building this would hold
~121 correct documents for review and catch nothing — an unpaid-for tier, the exact thing Census C
exists to kill.
**THE HONEST FRAME (same as the VAT-EU C2 finding): this install holds the MECHANISM but not the
TRIGGER.** Chris's exhibit is real — Oakhaven prints `GB 660 1173 45` while the stamp said
`GB 512 8846 27` — but it only exists where a buyer-issued template claims another company's
document, and the live install has no such template (B9 census: CLEAN). Slice 2 attacks that cause
directly; slice 3 would have been a second guess at the symptom.
**REVIVAL CONDITION, so this is not re-litigated from memory:** re-run
`scratchpad/census_stamp_contradiction.js` (recreate from this entry) on an install that HAS a
buyer-issued template claiming foreign documents. The rail is justified only if the contradicted
population is dominated by rows where the STAMP is wrong — not by caption fragments and garbles of
the stamped value itself. On today's data that number is 0 of 121.

## 2026-08-13 — THE ARITHMETIC KNOWS THE TOTAL AND A 2% TOLERANCE THROWS IT AWAY (#464, traced, NOT built)
**The only wrong-value MONEY auto-file in 1076 corpus documents, and the page's own numbers already
prove it wrong.** Doc #464 `Nordwind-Refrigeration_quote_0023-1.pdf` prints **`Total (inc VAT)
£2,363.76`**; the pipeline commits **`2,368.76`** (a single `3`→`8` substitution) via `anchor_inline`
at 85, final **90**, note **null** ⇒ would auto-file. Verified by eye on the page and by
`trace_one_doc.js 464 total` at the app's own env + `OCR_RENDER_DPI=200`.
**The rail SAW it and released it** (trace `reconcile` event, seq 120):
`subtotal 1969.80 + tax 393.96 = computed 2363.76`, `delta 5`, **`tol 47.38`** (2% of the total)
⇒ `reconciles: true`, `verdict "OK — reconciles / plausible"`. The computed value is EXACTLY the
printed total, to the penny, and a percentage tolerance sized for rounding swallows a digit
substitution 500× larger than a penny.
**Two more signals were present and unused on the same document:** the corroboration record says
`independent_agree:false` with the `mapping` family disagreeing (`'co 222.72'` — the taught box is
also junk on this layout, a separate teach-quality issue), and `net_misread_flag` skipped for its
own unrelated reason.
**Fix direction (NOT built, needs the advisor + Oracle gate):** when `subtotal + tax` computes a
value that differs from the read total but reconciles ONLY through the percentage tolerance, and the
read differs from the computed value by a SINGLE character substitution, that is not rounding — it is
a misread with an arithmetic witness. v1 should **flag + hold below auto-file** (note naming both
numbers), NOT silently adopt: `subtotal`/`tax` can themselves be misread, and a derived money read
has no guard but geometry (2026-08-09). Adoption is a separate, later decision with its own census.
Own flag, DEFAULT OFF; gate = corpus OFF-arm byte-identity + `auto-filed-and-wrong = 0` at document
level through `isAutoFileEligible`. Related but distinct from `recon_total_note_demote` (`df3f668`),
which RELEASES a note on penny-exact agreement — this is the same arithmetic used in the other
direction.
**Also recorded from the same trace:** #535 `Silverbeck-Cleaning_sales_order_0011.pdf` prints
`SB-ORD42102`, the pipeline reads `SP-ORD42102` (a `B`→`P` substitution, the serif-confusable family)
— but it IS flagged, so it cannot auto-file. Contained, no action beyond the record.

## 2026-08-13 — DEAD STRUCTURAL PIN in test_xcheck_corrob_demote.py (Oracle-found, repair-or-delete)
`test_xcheck_corrob_demote.py:158-160` (the "no independent_agree write in the demoter window" structural
check) is VACUOUS — an OR of two disjuncts where the second (`'independent_agree' not in window`) is
permanently False (slice-1's own docstring at engine.py:2862 + comment :2937 contain the string) and the
first's `{0,4000}`/`{0,2000}` char budgets can never bridge def-name → violation → terminator, so it is
essentially always True. Net: the pin passes today by budget accident and would STILL pass if a demoter
wrote `independent_agree = True` — the exact bug it claims to prevent. The REAL guard is the behavioural
pin at :74-75 (`'independent_agree' not in corrob`). Repair (rewrite as a behavioural assertion or a
correct AST/string scan) or delete; do NOT touch in the slice-2 commit (Oracle C2, 2026-08-13 slice-2 pass).

## ✅ SHIPPED 2026-08-13 — NOTE-DEMOTE SLICE 2 (adjusted-total, money) — `df3f668`, DEFAULT OFF
gary → Oracle SIGN-OFF-W/COND C1-C5, all applied. Flag `RECON_TOTAL_NOTE_DEMOTE` / toggle
`recon_total_note_demote`. Pins test_recon_note_demote.py 34/34; slice-1 suite 26/26 untouched.
Gates: OFF arm md5-identical; armed changes nothing (M=0); ~~**the adjusted-total note does NOT
re-form on harness replay** (recon census 0 rows over 73 Nordwind docs incl. needs_review — the
anchor_inline misread is import-batch-specific) → class-exercised acceptance = the owner's live
reprocess after flip (08-07 precedent: gates prove NO-REGRESSION, heals owner-watched).~~
**← STRUCK 2026-08-13 LATE. THAT WAS THE SAME HARNESS ARTEFACT AS SLICE 3** (realdoc never mirrors
the app's 63-var spawn env, and `--reprocess-manifest` lets Stage 0.5 answer before the noting rung
runs — see the B2 block below). Re-run through `name_demote_b2_gate.js` with the app env mirrored
and `B2_FRESH=1`, the class re-forms on the FIRST document: `recon_demote_census.jsonl` on #1217
reads `{"field":"total","committed":"3,564.72","demoted":true,"witness":"template_mapping",
"witness_conf":90,"committed_conf":93,"arith":true,"rejected":"3,864.72"}` — the owner's own
exhibit, demoted correctly (the doc scores 0 wrong vs corpus GT). **Slice 2 is therefore
harness-gateable after all; its OWED work is now a slice-2-OFF-vs-ON arm over the same 914-doc
population, which was never run because the class was believed unreachable.** (Slice 1's
`xcheck_demote_census.jsonl` fires on the same doc too — `quote_date` 26-03-2025 demoted over a
rejected 26-08-2025, correct vs GT.) SAY AT
FLIP: no confidence minting (a 78 stays 78 — release may not un-park under the floors); PASS-2
docs stay held by the surviving subtotal note; the classic drift exhibit (no crop backing) is
deliberately NOT demoted. Slice-1 owed gates CLOSED same session (full-902 base==armed;
200-DPI arm 6 demotes fired, census 6/6 + live 5/5 correct). Original exhibit: Nordwind quote
0021-4 total 3,864.72→3,564.72 (mapping @90 + arithmetic 2,970.60+594.12).
**✅ SLICE 3 (names) SHIPPED 2026-08-13 (same session, DEFAULT OFF) — B1-B3 all applied in-build:**
flag `NAME_CORROB_NOTE_DEMOTE` / toggle `name_corrob_note_demote`; pins test_name_corrob_demote.py
39/39 (incl. B1 predicate-recorder-independence pin, W2-mandatory pin, template_fixed-masquerade pin,
supplier_name pin, no-mint pin, B3 interaction pin); keyword-clear + name-lock suites green; OFF arm
md5-identical; armed changes nothing; ~~**the name note does NOT re-form on harness replay** (name
census 0 rows over the nr-widened Nordwind arm) → live acceptance at owner flip, same 08-07 precedent
as slice 2~~ **← STRUCK 2026-08-13 LATE: that was a HARNESS ARTEFACT, not a property of the class —
see the B2 result immediately below.** B2 BUILT AND RUN — result below; the flag still ships OFF
pending the owner's read of what it actually buys and costs. Design record further down.

**▶ B2 GATE BUILT + RUN 2026-08-13 LATE — `stress_test/name_demote_b2_gate.js` (new instrument).**
*The harness finding that comes first, because it invalidates a claim in this file and in two
handovers:* **`realdoc_regression.js` has never mirrored the app's spawn env.** `handler.js`
spawns every import/batch extraction with `_autoTitleEnv + _ocrDpiEnv + _anchorCropEnv +
_reconcileEnv` (handler.js:2008-2014) = **63 environment variables on this install**, i.e. ~47
shipped toggles the owner has ON. realdoc passes NONE, so every realdoc arm runs a DIFFERENT
product configuration (flags default OFF inside Python). Combined with realdoc replaying
**CONFIRMED docs only** (the live carriers of this note are 4 DELETED + 1 `needs_review`) and with
`--reprocess-manifest` pinning the template so Stage 0.5 answers the name before the Stage-2
relocate guard can note it, the class was **structurally unreachable** — which is why it was
written off as "import-batch-specific". Mirror the env + drop the manifest and it fires on the
first document. `realdoc_regression.js` now takes `RR_APP_ENV=1` (DEFAULT OFF — turning it on
changes the baseline of every historical arm in that file, so it is opt-in and must be stated).
**RESULTS — wide arm, 914 replayable docs (every doc on the install with a file, ANY status),
OFF vs ARMED, `B2_FRESH=1` (import path), 200 DPI, slice 2 armed in BOTH arms so the delta is
slice 3 alone; report `stress_test/out/b2_wide.md`:**
- **Class rate 2/914.** Demotes fire on #442 (confirmed) + #1217 (needs_review), both
  `customer_name='Bramblewood Joinery Ltd'`, both **correct vs corpus GT**. Census: 2 demoted,
  **0 DECLINED**, 0 rows in the OFF arm.
- **Collateral 0** — no other field differs between the arms on any of the 914.
- **GATE: demoted-and-wrong at DOC level on newly-unparked auto-files = 0.** The instrument is
  NOT vacuous: it resolves corpus GT for 1335/1336 docs and scores 124 of the 914 as carrying at
  least one wrong value — identically in both arms.
- **A2 ANSWERED = YES, and it is the headline for the owner.** With no confidence minted the field
  stays at 70, but the field-level review threshold is `< 70` (documents.js:209), so 70 does NOT
  trip `below_threshold_valued_count`: both docs go `flagged → auto-file ELIGIBLE` and leave the
  "needs a look" bucket. And with `autofile_gate_unify` ON (live), `_maybeAutoFile` no longer bails
  on `needs_review` — it defers to the predicate — so python still saying `needs_review:true` does
  NOT hold the doc. **Releasing this note files the document.**
- **B2 clause 1 is NOT met, and this is the finding to hand Oracle.** The #259 SHAPE (name note the
  sole hold while a sibling is silently wrong) does not occur in the population, so the harness asks
  the real predicate about a deliberately spoiled doc (§4b counterfactual): corrupt the ref-role
  value, no note, same confidence ⇒ **STILL ELIGIBLE — nothing else holds it.** The accidental
  safety Oracle worried about is real: today the phantom name note is the only thing standing
  between these docs and the filing cabinet, and it is not evidence about the ref.
- **The "or the census must catch it" branch IS met, by SHIPPED code, not new code:** the demote
  writes `note_demoted` into the field's corroboration record, which is PERSISTED
  (`extractions.corroboration`) and surfaced in Review/SFDEV — verified present on both docs with
  the witness pair (`template_mapping` + `keyword_override`) and 2 recorded guard-rejections each.
  Every release is queryable after the fact with no env-gated census.
- **What the owner is deciding, in one line:** a 2-in-914 release rate, both correct, both auditable
  — against the fact that after the release nothing else holds the doc if a sibling is silently
  wrong. Recommend an Oracle read of the counterfactual before the flip.
Design record below:
Exhibit (owner, live Nordwind quote 0021-4 customer_name): mapping@90 + keyword_override@78 +
anchor_crop@70 ALL read 'Bramblewood Joinery Ltd'; the two dissenters guard-REJECTED ('DELIVERY
ADDRESS' inline_off_taught_position, 'scone' name_guard_junk_candidate); the caption-disagreement
note (anchor.py:800-802, attaches :1661, 70-cap :1432) stands. **Design:** hoist note to
`anchor.NAME_GUARD_DISAGREE_NOTE` (:185 beside XCHECK_DISAGREE_NOTE; cross-pin the literal in
test_name_guard_keyword_clear.py:22); new `_demote_name_guard_corroborated_note` after slice-2's,
`_d3` into the shared B1 recompute. Eligibility: is_name_like_field + type∈{None,text,multiline_text}
+ **key != supplier_name (PINNED — identity machinery gets own slice or never)** + method=='anchor_crop'
EXACT + note exact-equal + not junk-shaped. Equality `_values_normalise_equal(...,False)` NO fuzzy —
clipped 'Lt' never equals 'Ltd', pinned both directions. Witness = BOTH **W1** crop-side ledger
(slice-1 bars + mapping located carve-out, MINUS method startswith template_fixed — the F8
memory-masquerade hole: template* buckets as mapping — and minus '+corrected'/'+confirmed_adopt')
AND **W2** keyword/keyword_override un-noted ≥70 normalise-equal (mandatory — Oracle Q1 ruled; breaks
the flush-clip crop↔crop common mode; committed value is crop-side so full-page agreement IS
pixel-independent — the INVERSE of slice 1's Gate-C geometry). Dissent legs: **D1** rejection recorded
for the field (new additive `self._rejected_reads` plumbing — see B1) + **D2** ledger unanimity (no
un-noted ≥60 candidate normalise-UNEQUAL, any family). NO confidence minting (money posture; the dark
NAME_GUARD_KEYWORD_CLEAR mints at :6462 — this is strictly safer). note_demoted gains rejected_reads
list. Flag `NAME_CORROB_NOTE_DEMOTE` OFF + toggle `name_corrob_note_demote` + bridge + wiring pin;
census own `name_demote_census.jsonl` in XCHECK_DEMOTE_CENSUS_DIR.
**Oracle conditions: B1 BLOCKING** — the always-on `_on_reject` closure as designed breaks
`anchor.py:1745-1747` (parallel dispatch keys on `on_reject is None` → forced-serial = a READ-DETERMINISM
change, Tesseract thread-count-nondeterministic; the deskew→COMPOSE_SCAN interaction class): rework the
predicate to key serial on trace/slice_capture only, PIN the predicate recorder-independent, closure keeps
the `cap=None` kwarg (:439-440 rebind), both engine sites (:6367,:7042), trace event only under _trace,
reset per doc. **B2** flip gate: armed #259-class replay (sole-hold release over a sibling misread → doc
still held) + demoted-and-wrong=0 measured DOC-LEVEL on unparked auto-files (Oracle ruled #259 NOT
discharged by design — needs the gate); 101-doc auto_reprocess cohort = SUSPECT GT. **B3** interaction
pin: extend engine.py:975-981 comment to name this slice; pin both-ON idempotence with
NAME_GUARD_KEYWORD_CLEAR (merge clear fires first, weaker bar + mints — demoter no-ops). Q3 ruled: ship
even if A2 false (note release may not un-park under far_lowconf two-tier — census must ANSWER A2, tell
the owner which product they flip). Q4 unanimous-wrong printed name = accepted census-monitored residual.
**Non-blocking backport observation: slice 1 (dates) shares the F8 hole** — template_fixed buckets as a
mapping witness for DATE demotes too (frozen dates rare; consider W1 exclusions backport).

## 2026-08-13 — MACHINE-FEED ARC: ✅ SLICE 1 BUILT same session (DEFAULT OFF) — C1/C2/C6 in-build; C3+C4 DISCHARGED by census; flip gates remaining below
**Built:** shared `database/modules/machine_vias.js` (MACHINE_VIAS ×5 + SQL fragment; trust.js:595 +
learning.js + templates.js all reference it — the drift class is dead); learning.js getFieldFormats
armed filter (setting `learning_exclude_machine_confirms` read inside learning.js, env
`LEARNING_EXCLUDE_MACHINE_CONFIRMS` wins both ways — the shadow-row-skip C5 pattern; via-column
presence-guarded; **C2 carve-out built**: a row with a human corrections.corrected_value stays counted)
+ additive `machine_value_counts` emit (armed-only, consumed by NOTHING — repo-scan pin);
**C1 built**: templates.js learnTemplateOnCommit blocks ALL FIVE vias when the flag is armed (legacy
2-value filter stays unconditional). Toggle + wiring pin (SETTING_SWITCHES). Battery
`database/modules/test_machine_confirm_learning.js` 16/16 (off-byte-identical, falsifiable NULL-via
control, C2 pin, env-both-ways, pre-mig-57 no-throw, sentinel-set + inert + template-leg pins);
test_scope_trust ALL PASS. **C3 DISCHARGED = ZERO**: the only census hits are customer_name and the
2.5d snap SKIPS name fields (engine.py:7569) — no code-field scope loses `known` immunity live; the
snap also writes a note (not silent). **C4 DISCHARGED**: the one flip = Bramblewood|purchase_order|
customer_name freetext→constant('Quillstone Print & Packaging') — direction FAVOURABLE (exclusion
un-shields the garble class; the lost values are the 2 garbles + the 4 wrong-party Bramblewood rows
already queued for owner ruling). Script: scratchpad machine_c3_c4_census.js.
**ARMED REALDOC GATE RAN (2026-08-13 wrap, post-stamp live DB, 902 docs): M=0 BOTH COUNTS.**
Values IDENTICAL (same 484 pre-existing replay regressions, same docs/values); auto-file IDENTICAL
(14 would-file, same 3 pre-existing wrong dates #400/#976/#1176; ZERO new wrong auto-files).
**Counted cost (the Oracle wrong-direction edge, SAY AT FLIP):** 54 wrong reads lost their review
FLAG (231→285 silent) — ONE class, the Pelican invoice-ref separator-stripped replays
('PI/25/3699'→'PI253699' + two I→1): the field's learned shape was machine-fed, exclusion kills the
shape warn. ALL 54 stay review-bound (zero crossed into auto-file) — cost = lost warning copy in
Review, never a silent file. Reports: %TEMP%\rr_machine_armed_report.md + _diff.txt.
**REMAINING before flip:** C5 gate-unify round-trip pin (armed exclusion + unify-ON stamp);
Quillstone gate ✅ PASSED (backup 0.888 all-rows → 0.900 human-only STRONG); C6 ✅ rode `e752b95`;
C1 small census (post-stamp docs that drove template learning). Slice 2 (refusal-side unions from
machine_value_counts) = own pass. Oracle ruling record below:

## (ruling record) 2026-08-13 — MACHINE-FEED ARC: gary design + Oracle SIGN-OFF-W/COND (C1-C6)
gary consumer map + Oracle pass both run 2026-08-13 (agents; census run same day). **Design (slice 1):**
flag `learning_exclude_machine_confirms` DEFAULT OFF (+toggle + env winning both ways, the
trust_shadow_row_skip C5 pattern, setting read INSIDE learning.js); when armed + via column exists, add
`AND (COALESCE(d.confirmed_via,'') NOT IN (<MACHINE_VIAS>) OR c.corrected_value IS NOT NULL)` to the
learning.js:1272 getFieldFormats query (the OR leg = Oracle C2 human-correction carve-out, RETAIN ruled —
preserves the remediation mechanism; a correction row is a human act, machine confirms never write one);
extract shared `MACHINE_VIAS` constant {scope_sweep, auto_corroborated, auto_reprocess, auto_graduated,
auto_threshold} (FIVE, not four) used by learning.js + trust.js:595 + templates.js:1122; emit additive
`machine_value_counts` key consumed by NOTHING in slice 1 (pinned inert — slice 2 restores refusal-side
evidence from it). Rejected: down-weight (garble ×20 crosses any bar); per-consumer split (~10 drift seams).
**LIVE CENSUS (post-remediation): totalGroups 65 · groupsDie 0 (NO group starves) · shapeFlips 1 ·
domMachineMaj 20 (name-like groups w/ machine-majority dominant) · confadoptDrop 0 · strongFlips 0.**
Script: scratchpad machine_learning_census.js (session 4223d9fa).
**Oracle conditions:** **C1 BLOCKING (this arc):** templates.js:1122 filters only scope_sweep/auto_reprocess
(2 of 5) and `_autoFileDoc` DOES call learnTemplateOnCommit (handler.js:4517) — every auto_graduated/
auto_threshold/auto_corroborated file TODAY drives template learning incl. the frozen-string confirm counts
keying the young-identity guard; Oracle position: EXCLUDE (extend MACHINE_VIAS there), own small census
(post-stamp docs that drove template learning), may ride slice 1 or ship as slice 1.5 — cannot stay unruled.
**C2** (blocking before flip): the correction carve-out above, pinned either way. **C3** (blocking before
flip): snap-known-loss census — scopes where dominant stays armed post-exclusion AND ocr_corrector `known`
(engine.py:7275 immunity) loses machine-only values = potential SILENT REWRITE window (fail-toward-WRONG);
zero required, else ship the slice-2 known-union first. **C4** (blocking before flip): name + direction the
one live shapeFlip, pin it. **C5:** pin the gate-unify dependency (armed exclusion + unify-ON stamp
round-trip; exclusion is BLIND when autofile_gate_unify OFF — via stamps NULL at handler.js:4458) + toggle
copy says "requires Auto-file gate unification ON". **C6** (ride slice 1): fix CONFADOPT docstring
engine.py:2703 ("≥5 human confirms" is FALSE — code counts ALL confirmed rows) + the stale learning.js:1298
comment in the same commit. Rulings: shape-loss ACCEPTED (no per-consumer split); CONFADOPT refusal union =
acceptable residual (confadoptDrop 0) but snap known-union NOT (C3); cold-start thinning ACCEPTED (pin);
Learning History = ANNOTATE never exclude ("not used for learning" tag when armed). Flip bar: census +
realdoc M=0/zero-drop on POST-STAMP snapshot + Quillstone pre-remediation backup doc_freq crosses 0.9 STRONG
(docusnap_pre_namerepair_20260812.db — real gate, fails on the bug) + starvation pin + C2-C5. Original entry:

## (superseded original) 2026-08-12 NIGHT — MACHINE AUTO-FILES FEED THE NAME LEXICON/VALUE-COUNTS (found via the Quillstone poison; own arc, NOT built)
**Mechanism (provenance-verified):** a conf-100 machine auto-file of a GARBLED read becomes
status='confirmed' and feeds getFieldFormats value_counts -> the 4.5 name lexicon, dominance
buckets, CONFADOPT counts. Live damage: 'Quilistone' x3 + 'Quiltstone' x1 auto_threshold confirms +
'Branblewood' x3 auto_graduated echoes diluted the Quillstone customer lexicon to doc_freq 0.888 <
the 0.9 STRONG bar — the machine's own mistakes disarmed the repair that would have fixed them
(the T3/window-exclusion principle one level down: the route manufactures the evidence it
consumes). Design question: exclude (or down-weight) machine-confirmed rows (confirmed_via IN the
sentinel set) from getFieldFormats value_counts/lexicon inputs — precedent: CONFADOPT B3 already
excludes '+confirmed_adopt' rows unconditionally. BLAST RADIUS: every learning consumer (formats,
shapes, noise profiles, corrector indices) — needs gary census (how much learning volume is
machine-derived now that auto-file volume is real) + Oracle. Interim mitigation: the
repair-poison-name-confirms remediation script (shipped, owner-consented APPLY owed).

## 2026-08-12 NIGHT — IMPORT AUTO-FILE PRE-GATE vs THE SHARED PREDICATE — ✅ BUILT DARK `83dc89e` (same night, gary+eric → Oracle SIGN-OFF-W/COND; see docs/oracle_log.md 2026-08-12 NIGHT)
**Shipped:** flags `autofile_gate_unify` (T1 pre-gate defers to predicate + T2 missing-required
refusal + T3 auto_graduated/auto_threshold via stamps) and `far_lowconf_valued_only` (all five
isFlagged consumers → valued-only tier), both OFF + toggles; pin suite
`test_import_autofile_gate.js` 33/33; census instrument `stress_test/census_parked_eligible.js`
(live BEFORE: 51/74 parked-eligible, 49 = empty-optional-only). **FLIP BLOCKED on the historic
cohort stamp (Oracle): run `scripts/stamp-machine-autofiles-20260812.js` APPLY=1 app-closed,
owner-consented — 165 via-NULL machine files; snapshot-verified ZERO revocations.** The
needs_review trace below is superseded (source-verified: validator.py:960 any-below-threshold leg;
all 13 engine _needs_review writers persist notes). Original entry kept for context:

## (superseded original) 2026-08-12 NIGHT — IMPORT AUTO-FILE PRE-GATE vs THE SHARED PREDICATE: the last two-gate disparity (owner-ordered slice, NOT built)
**Symptom (live, owner-hit):** a fresh Castellan import left 20 docs @95 in the queue that
`trust.isAutoFileEligible` judges ELIGIBLE (trusted scope, floor 95, zero flags, basis graduated) —
they never auto-filed and nothing re-asks. **Verified mechanism:** `_maybeAutoFile`
(`processing/handler.js:4326-4329`) pre-gates on the Python `file_done` message: sub-100 docs are
refused whenever `msg.needs_review` is true — a BROADER signal than the predicate (it fires on an
empty field / below-threshold field confidence, which the predicate correctly ignores for
non-structural fields). The authoritative gate never gets asked; the doc parks forever. On the
exhibits the only hole is an EMPTY `vat_no` (@0) — **probable trigger, NOT source-verified: before
building, trace exactly what sets `needs_review` in the Python emit** (engine/process_docs) on one
of docs 737-756.
**Fix direction:** for graduated (sub-100-floor) candidates, let the import path defer to
`trust.isAutoFileEligible` instead of bowing out on `msg.needs_review` — the predicate already
carries the flag/structural/verifiability safety (same "two auto-file sites must not diverge"
principle: Oracle 2026-08-12 consent-bar ruling, the retired get-auto-file-eligible comment, and
`_autoFileDoc` itself). Keep the conf pre-filter (`< preFloor` bail) — it is cheap and consistent.
NOTE the seam: `needs_review` ALSO carries per-field below-UI-threshold signals the predicate never
sees — decide deliberately whether a below-threshold FIELD (not a flag) should hold a graduated
doc, and pin the answer. Flag DEFAULT OFF + toggle + wiring pin; own advisor+Oracle pass.
**Gates:** realdoc arm (dark md5-identical; armed = would-file delta only on the disparity class) ·
census of queue docs eligible-but-parked before/after · zero new wrong-value auto-files (M=0).
**Interim exits (no code):** File All Ready, or group-reprocess → the `0177716` consent bar offers
them; or per-sender editor "Never on these documents?" on the empty field.

## 2026-08-12 EVE — TYPE ELECTION — ✅ BUILT DARK same night (herald design → Oracle SIGN-OFF-W/COND; see docs/oracle_log.md 2026-08-12 NIGHT entry 2)
**Shipped:** ONE toggle `type_election_title_first` (OFF) → three keyword.py kill switches
`TYPE_CAPTION_MENTION_ONLY` (`_ADDRESS_CAPTIONS` frozenset — PARTY-address captions ONLY, Oracle C5
boundary) · `TYPE_HEADING_ANY_SEGMENT` (top-band gated) · `TYPE_TIE_HEADING_PREF` (STRICT
strong-head key). Pins `tests/test_type_election.py` 19/19; census
`stress_test/type_election_census.py` over 926 stored texts: f1 and f2 EACH heal exactly the
9-doc Meadowvale class, 0 flips elsewhere, 0 fix-2 admits, 0 regressions. Plain reprocess
self-heals the queued 5 after the flip (machine-authority override — verified). **Oracle C3, say
at flip: human-confirmed mistypes do NOT self-heal (Learning Repair / manual re-type); flip this
BEFORE measuring gate-unify. C2 owner-watch: first statement-heavy supplier is the fix-2 admit
exposure (0/926 today). C4 residuals: despace/fuzzy recovery still seg0-only (a letter-SPACED
title in a non-left column still misses — same family, unhealed); TYPE_TITLE_OWNER_PRECEDENCE
ownership test still seg0-only.** Original trace below:

## (superseded original) 2026-08-12 EVE — TYPE ELECTION: address caption 'bill to' outvotes the printed CREDIT NOTE title (traced, design ready, NOT built)
**Owner-reported disparity: import types Meadowvale `-2` credit-note pages as INVOICE; a straighten-reprocess flips them to credit_note.**
Traced end-to-end (agent FINDINGS: scratchpad session 30ca4b35 `disparity\FINDINGS.md`; both premises REFUTED —
title never dropped, heading flags played no role, threading identical). Mechanism, all FACT-labelled:
`config/keyword_patterns.json` Invoice bucket contains the ADDRESS caption `'bill to'`; on tilted scans it OCRs
alone on its own line → passes the strict whole-line heading test (`keyword.py:946`) → 2× + `head=True` ⇒ Invoice
~6.0 conf 90 heading=TRUE, while 'CREDIT NOTE' shares its row with the letterhead and the column-aware heading
test checks only the LEFTMOST segment (`keyword.py:943`) ⇒ mention-only ~5.7; 3 of 5 were EXACT TIES and `max()`
takes config insertion order = Invoice (`keyword.py:965`). The trusted wrong heading then pre-gates OFF all
heading re-read rungs + `REPROCESS_HEADING_GEOM` (`process_docs.py:573/:598/:628/:668`) and makes
`identify_template` REFUSE the credit_note template ("Couldn't match … saved Invoice layout", `engine.py:8118`).
Deterministic per route; plain reprocess can NEVER self-heal (cached text pins the election — arm B); only
deskew re-reads (arm C byte-matches live #609's flip). **Fix design (own advisor+Oracle gate before build):**
(1) address-block captions (`bill to`, `billed to`, …) mention-only — never heading-eligible (alone heals all 5);
(2) heading test checks EVERY column segment, not seg0; (3) tie-break prefers the heading-backed candidate over
config order. **Gate: full-corpus TYPE census, M=0 outside the healed class.** Wrong layers (do not build):
heading rungs, template refuse, threading, DPI, deskew.

## 2026-08-12 EVE — LIVE-DATA REMEDIATION of the 101 sweep-filed docs (OWED, owner-vetted, app closed)
Shipped `0177716` fixes the DOOR (consent bar); the DATA is still wrong: the 12:36:29-46 UTC cohort (101 docs,
audit `review_confirmed` burst) sits with `confirmed_via` NULL under the human username — INFLATING human
graduation windows across every touched scope while corroboration_autofile + floor-95 flips are LIVE, and their
`saveCorrections` hint learning ran (usage counts polluted; CONFADOPT ≥5× literal counts suspect — Oracle catch).
Plan (Oracle-ordered, AFTER `0177716` is running): backup live DB → stamp the cohort
`confirmed_via='auto_reprocess'` (NEVER 'scope_sweep' — the Undo-all mass-revert path is via-checked,
`handler.js:3001`) → re-measure scopeTrust on affected scopes → THEN run the owed censuses (pin-discharge /
CONFADOPT / shadow-attribution) treating this cohort as suspect. Hint-usage rollback = owner decision (list the
101 filed paths for spot-check; they never entered `recent_auto_filed`, so the banner cannot re-surface them).

---

## 2026-08-12 — PLAUSIBLE-WORD NAME GARBLE vs DOMINANT LITERAL: why was the Lid→Ltd repair silent? (owner-reported, NEXT ARC — root-cause FIRST)

**Exhibit (post-reprocess Meadowvale credit_note 0011):** customer = 'Bramblewood Joinery **Lid**'
@95 High, UNFLAGGED — one confusable char (t→i-class) from the scope's 38×-confirmed single literal
'Bramblewood Joinery Ltd'. CONFIRMED_DOMINANT_ADOPT correctly refuses (not junk-flagged — 'Lid' is
a word; Oracle's named residual the same morning). Owner: fuzzy-match this class.
**STEP 1 — ROOT CAUSE, not a feature: 'Lid'→'Ltd' is the LITERAL textbook example of the shipped
Stage-4.5 token repair** (name_match.py canonical-token repair; the Review "auto-corrected" badge's
own documented example). It did NOT fire on this doc. Find why before building anything: does it
defer to taught-position (template_mapping) reads? is the supplier-scoped lexicon empty here? did it
run suggestion-only and get dropped? One trace answers it.
**STEP 2 (only if 4.5 structurally can't own taught reads): the confusable-snap tier** — value
within ONE confusable substitution (same length, `_is_confusion`) of the scope's SINGLE dominant
confirmed literal (count ≥5, owner's STRICT variability guard — any second distinct key refuses) ⇒
snap or FLAG-first, WITHOUT the junk-flag prerequisite. Same licence structure as
CONFIRMED_DOMINANT_ADOPT and the raw-crop witness; needs its own gary+Oracle pass (it rewrites an
UNFLAGGED 95 read — stronger claim than anything shipped 2026-08-12). Record-first discipline
applies: census the class size before any swap tier.

## 2026-08-12 — DOMINANT CONFIRMED LITERAL SHOULD OUTVOTE A FLAGGED READ (BUILT DARK same day — `confirmed_dominant_adopt` OFF + toggle; gary spec + Oracle SIGN-OFF-W/COND B1-B5, all applied; 22 py pins + 3 JS pins green; flip needs the CONFADOPT census + would-adopt-vs-GT 100%)

**Owner rule (two live exhibits, same session):** when the committed value is FLAGGED as junk AND a
picker candidate normalise-equals the scope's dominant confirmed literal at high count, ADOPT the
literal — no picker, no confirm demand. "Surely 20 confirms is confirmation it is correct."
**Exhibit A** — Ironclad statement 0011 (THE flush-edge-clip template): taught-box garble
'Sramblewood Joinery Ltg' committed @70 ("doesn't read like a name") while candidate 'Bramblewood
Joinery Ltd' (page-read, **confirmed 20×**) sits in the picker. **Exhibit B** — Meadowvale credit
note 0011: keyword grabbed the ACCOUNT NUMBER 'MDW.-315' into customer ("looks like a
reference/code") while 'Bramblewood Joinery Ltd' (**confirmed 38×**) is candidate 1.
**Three shipped guards, none owns the case:** Stage-2.5d dominant-value snap (count-weighted
adoption ≥5-count/≥80%-share — SILENT in both; investigate why: substitution-distance rule?
name-field exclusion? kill SNAP_ALLOW_SUBSTITUTION state?); the disambiguation picker (surfaces,
never decides); the name-relocate disagreement guard (holds clean keyword, but only for
relocate/caption-bleed methods — a straight template_mapping/keyword junk read sails past).
**Design direction:** the snap's charter extended to the candidate layer — committed value flagged
+ candidate == dominant confirmed literal (count ≥ N, share ≥ 80%, same normalise family as the
snap) ⇒ adopt the literal; note the adoption honestly; review-hold only if something ELSE flags.
Interacts with: corroboration record (adoption = memory family — never fabricate independence),
the C7/re-teach decision for Ironclad's box (still the durable per-template cure, STILL OPEN),
never-clears-notes standing rule (adoption REPLACES the flagged value — the flag premise dies with
the value, same premise-failure argument as the containment ruling). NOT BUILT.

## 2026-08-12 — AFTERNOON BATCH STATUS (owner mandate "do the fix and address everything"): FIVE slices BUILT DARK + two live tools
All gates in `docs/oracle_log.md` (2026-08-12 afternoon entry). BUILT, flags DEFAULT OFF + toggles:
`reconcile_shadow_attribution` · `vat_rate_at_skip` · `graduation_freeze_issuer` (flip WITH
`template_identity_on_page` — checklist in the toggle copy) · `supplier_pin_self_discharge` ·
plus `graduation_window` slider (default 10, owner wants 5) and the Learning-Repair currency fix +
the INERT `substantial_containment` predicate (consumer slice = separate arc). Backfill census RUN:
tpl 14+15 eligible (`scripts/backfill-graduation-issuer-freeze.js`, APPLY=1 app-closed, owner-timed).
**OWED / owner-timed:** backfill APPLY + replay gate · pin-discharge census arm (18-pin backup copy,
AFTER backfill) · realdoc dark+armed arms (running at wrap — see handover for the verdict) ·
Template Manager right-column height cosmetic (owner-reported, unfixed) · label-above keyword design
(unbuilt) · un-pin UI control + ripple copy (unbuilt, part of the pin arc).

## 2026-08-12 — GRADUATION TEMPLATES ARE IDENTITY-MUTE: freeze the issuer at graduation birth (BUILT DARK 2026-08-12 — see AFTERNOON BATCH STATUS above)

**Live exhibit (owner, post-reprocess):** Oakhaven delivery_note graduated (17 human confirms, 16
clean) and minted tpl 14 at the 10th confirm (`onScopeGraduated` → graduationTemplate). Reprocess:
all 3 queue docs BIND to tpl 14 — but `supplier_name` still reads `hint_text_match` @85 (hint cap =
min(90, 60+5×usage)) / `logo` @72, overall 85/72 < the 95 graduated floor. **Auto-file structurally
unreachable on any layout whose identity comes from hint/logo — graduation defeats its own purpose.**
Verified at source: tpl 14 field rules ALL `is_variable:1, fixed_value:null` (graduationTemplate's
`_variableOnlyFields` — correct anti-freeze caution for DATA fields, wrongly silencing the issuer);
promote-born tpl 6 (Silverbeck) has `supplier_name fixed_value` set and seeds template grade 95.
Harrowgate tpl 15 = same graduation birth, same defect pending.

**Fix direction:** graduation birth freezes the ISSUER ONLY — `supplier_name` fixed_value = the
graduated scope's ESTABLISHED identity (dominant confirmed issuer over ≥W human confirms — evidence
FAR stronger than a promote's single curated doc). Exactly the Oracle-C1 identity-only shape the
sender-field-editor mint ships with (2026-08-12) — after this, all three birth paths agree: teach
promote (full curated payload), editor mint (identity-only), graduation (identity-only). Guards
already in place: young-frozen-identity corroboration requires the name ON PAGE for young frozen
strings (ca0bb49); identity-on-page veto governs claiming. Backfill arm for EXISTING graduation-born
templates (tpl 14, 15 + census for others) — the sample-angle-backfill pattern (census → backup →
apply → replay gate). **Interim owner route (no code): Template Manager → set the supplier_name
fixed value manually on tpl 14/15, reprocess the groups.**

## 2026-08-12 — SELF-DISCHARGING SUPPLIER PINS (BUILT DARK 2026-08-12, Oracle W/COND — see AFTERNOON BATCH STATUS above; census arm owner-timed)

**The defect (owner, live):** the issuer RIPPLE ("apply 'Harrowgate Timber Supplies' to the other 19")
writes an `operator_pin` per doc, and a pin is review-bound by design ("a pin can never silently
auto-file", Oracle) with confirm as its ONLY discharge. Designed for ONE doc; the ripple applied it
to a BATCH with one click, so a customer who accepts the app's own offer buys N mandatory manual
confirms — on docs that would otherwise be auto-file-ready once the scope graduates. Live exhibit:
Harrowgate sales_order graduated (12 confirms, 11 clean) while its 8 remaining docs sit pinned+noted.
**Owner principle, PIN IT IN REVIEWS: a convenience that mints obligations is not a convenience —
a feature that batch-APPLIES must batch-DISCHARGE, or state the price before applying.**

**Agreed design — a pin releases when provably redundant.** At reprocess, the natural identity
resolution already runs (the pin re-asserts at the end, `engine.py:5573` + `:6429`). New rule: if the
natural read (template/logo/hint/keyword — everything the scope has since learned) normalise-equals
the pin value, commit the NATURAL read (earned confidence, no note) and CLEAR `documents.supplier_pin`
(JS-side, post-process). Disagree or read nothing ⇒ pin holds + note stays (the case pins exist for).
Oracle's rule survives: the discharged doc auto-files on the MACHINE's independent read, never on the
operator-supplied value. This is the corroboration direction applied to pins: human said X, system
independently learned X, holding for the human to re-say X serves nobody. Flag DEFAULT OFF +
`_reconcileEnv` bridge + toggle; owner flips.
**Gates:** census over the 18 live pinned docs (10 Bramblewood + 8 Harrowgate) — discharge rate +
zero discharges where natural ≠ pin; pin the disagree-holds case; realdoc byte-identical OFF.

**Alongside (same arc):** (a) ripple prompt copy states the cost until this ships ("each filled
document still needs one confirm"); (b) small un-pin control on the issuer note (reverse of Resolve —
deletes the pin, doc reverts to natural reading on next reprocess), admin/edit, audited.

**Interim relief (no build):** DB-side pin clear (backup first, app closed) + group reprocess — offered.

## 2026-08-12 — Containment witness for name corroboration (OWNER IDEA, design stage — reggie+gary+Oracle before build)

**Exhibit:** Nordwind quote 0026-1 (doc 454, bound to the garbage tpl 11) — keyword read "Bramblewood
Joinery Ltd" (clean, 78, won) vs `anchor_crop_relocated` "ne ay - Bramblewood Joinery Ltd" (24, lost;
"ne ay" = partial-glyph fragments of a chopped address row inside the mis-sized taught box — the
Pelican customer_name class). NAME-RELOCATE DISAGREEMENT guard held the keyword + capped 69 + noted —
correct. But the comparator is normalized EQUALITY only (`_cmp_norm` at `engine.py:995`): the system
cannot see that the dirty read CONTAINS the clean value, i.e. the taught box witnessed the same name
plus junk — the VALUE is actually doubly-witnessed (mapping-family + keyword-family = the strong
independence pair).

**Owner question ruled on: would containment work for corroboration? Direction: YES for the RECORD,
NO for the flag.** (a) Token-level containment, contained value must be SUBSTANTIAL (multi-token /
majority of tokens — else "Ltd" ⊂ anything corroborates everything); (b) direction-aware: clean ⊂
dirty corroborates the CLEAN value while proving the dirty READ/box needs attention; (c) feeds the
corroboration record (`independent_agree` via a `contained` qualifier). Prior art to reuse:
`caption_bleed` leading-token check, name-grow page-present witness (cut word's locate text ⊂ grown
token), `_name_relocate_should_hold` (`engine.py:955-1008`, pins in
`test_name_relocate_disagreement.py`).

**OWNER FOLLOW-UP (same day): "containment true + template exists → accept as 100% read?" RULED:
goal endorsed, 100 refused.** (1) conf==100 makes `docTrustGate` lenient BY DESIGN and 100 = the
operator-confirmed grade — never minted from a heuristic (the 88-floor principle: confidence is
earned, notes do the blocking). (2) "Template exists" is a weak license — tpl 11 exists and is the
poisoned party in the very exhibit. (3) "Accept" would be corroboration-clears-notes by the back
door (standing condition, shadow-attribution entry above). **The agreed shape instead:** substantial
containment = `independent_agree` in the record; the NAME-RELOCATE note's premise ("two DIFFERENT
names") is then factually false so the guard does not fire — clean value keeps its EARNED confidence,
no blocking note (this is premise-failure, not note-clearing); the mis-sized-box signal moves to a
NON-blocking surface (trace/census + template health); the already-ON corroborated auto-file route
then files these docs naturally. Closes the 08-08 finding "the system knows the answer twice over
and cannot apply it." Needs its own gate: pin that a non-containment genuine disagreement still
flags; census the containment class size before flip.

## 2026-08-12 — Review field-editing entry point: template-first, "Save as template" retired (OWNER PROPOSAL, design stage — advisor+Oracle gate before build)

**Owner direction (verbatim intent):** the first time a customer opens a doc with unnecessary fields,
they will want to change the fields for it — so the Review entry point for field editing should ALSO
create a template when none exists. Template Manager is an ADVANCED admin tool, reached via Settings
only; ordinary users shouldn't see template machinery, and **the Review window should be the same for
everyone**. Replace the "Save as template" button with something like "Edit this doc's fields" (wording
TBD, better than that). If no template exists yet, the button elevates the doc to a template FIRST —
with a prompt to double-check the supplier name, because **the supplier name at mint time becomes the
template identity** (live exhibit same morning: tpl 11 "Reg No GB 903" — a VAT-reg caption garble
minted a duplicate Nordwind quote template that now outclaims the real tpl 4 on re-imports).

**Current state (verified):** "✏ Edit type" = admin-only deep-link to Settings → Document Types,
TYPE-scoped fields/roles (`review/renderer.js:414-422`, `index.html:1054`). "Save as template" =
`promote-to-template` → `_upsertTemplate` (+ sample pin, landmarks, fingerprint,
`review/handler.js:1007-1053`). Templates otherwise mint only on taught confirm (`onTaughtConfirm`) or
scope graduation (`onScopeGraduated`, 10 clean confirms).

**Design notes / seams for the vet:**
- Supplier-confirm prompt should reuse the shipped plausibility predicate
  (`teach_issuer_plausibility_warn` arc — BP/IBM-immune) so a garbled name gets warned at the mint
  prompt, not silently baked into a template identity. Same class as Chris r3 finding 1.
- "Unnecessary fields" removal is per-template FIELD scope (hidden-field drop
  `template_hidden_field_drop`, template field visibility) — NOT global type edits; the new flow must
  route the user's intent to template scope, not `document_types.fields` (a type edit would strip the
  field from EVERY supplier's docs of that type).
- Role split RESOLVED (owner + verified at source 2026-08-12): `open-review-window` is BLOCKED in main
  without admin/edit (`main.js:1538`) — Read Only never reaches Review (their surface is Search), so
  the button needs NO extra role logic; "Review same for everyone who can open it" holds automatically.
- The retired "Save as template" affordance: check the welcome tour / help copy that references it
  (tour card 5 already flagged by Chris as over-promising).
- Seam with `_upsertTemplate` identity rules: mint must land on an EXISTING same-supplier+type template
  when one exists (reuse band) — never fragment (the tpl 11 class this proposal exists to prevent).
- "Edit type" button fate: recommendation (2026-08-12) = REMOVE from Review; the whole-type editor
  (every supplier's docs of the type — big blast radius) lives in Settings only. One button, one job,
  no second scope in Review. Owner leaning same way; confirm at vet.

**CHRIS DESIGN-STAGE REVIEW DONE (2026-08-12, 7 finding cards — owner vet queue). Verdict: direction
right, every risk a copy/affordance fix, "would keep using after two weeks: yes". His conditions:**
1. **Name prompt = editable pre-filled field, NEVER Yes/No** — a "No" with nowhere to fix the name is
   a dead end and recreates the Reg-No-GB-903 incident on a click-through. His copy: "Check the
   sender's name first / [editable name] / Scan Finder will use this name to recognise their documents
   and to file them. You can change it later in Settings. / [That's right — continue] [Cancel]".
   VERIFY before promising "change it later": rename safety post the 08-10 identity-not-cosmetic-name
   fix — if rename isn't safe, drop the promise.
2. **Button wording ranking:** "Change what's read from this sender's documents" (or with the real
   name substituted — "Change what's read from Nordwind's documents") > "Adjust fields for this
   sender" > "Edit this doc's fields" (WORST — narrates as one-doc value editing). One sender noun
   across the whole flow.
3. **Editor header must state exact scope** ("Nordwind Refrigeration Ltd — Delivery Notes" + "Other
   document types from this sender aren't affected", only if true) — else hidden fields bleed across
   types in the user's head = the support email.
4. Empty-field affordance: small link on any empty field — "Never on these documents?" — opening the
   same editor with that field ready to switch off (one door in the panel, one on the wound).
5. **Save moment states what happens to docs already in the queue** ("Applies from now on — the ones
   waiting stay as they are", or offer the re-run if cheap).
6. Keep one quiet line where "Save as template" lived stating the app remembers senders (the removed
   button was the only standing hint per-sender memory exists).
7. **Hidden = switch set to off, not absence** — hidden fields stay listed greyed with "Show again";
   undo lives where the do lived.
Also: keep a "To change this for every sender, go to Settings → Document Types" line INSIDE the new
editor (the rare whole-type case stays findable after the "✏ Edit type" removal). Decision budget:
3 first time, 2 after, 0 added to routine filing.

**OWNER APPROVED all 7 Chris cards 2026-08-12. eric mechanics pass DONE (in-Review modal;
resolution-first mint via promote-to-template; write the EXISTING `template_hidden_fields` store,
mig 54; live-update = `_resolveFieldVisibility()` on toggle; 2 new IPCs `get-sender-field-editor` +
union-aware `set-sender-field-hidden`; widen `set-template-hidden-field` admin→admin+edit; build
order = 5 slices — full report in session transcript). ORACLE: SIGN OFF WITH CONDITIONS ×5 — full
entry in `docs/oracle_log.md` 2026-08-12. Headline: eric's two seam-3 mitigations are ONE gate
(young-identity nested inside `TEMPLATE_IDENTITY_ON_PAGE`, `template_matcher.py:611` — both OFF on
the owner's DB), so **C1: editor mint is IDENTITY-ONLY** (no frozen field rules from the unreviewed
sample; pin zero non-issuer fixed_value rows); C2 owner told + recommend flipping
`template_identity_on_page`; C3 un-hide write-set = display read-set ∪ matched template id, audited,
containment residual pinned; C4 audit both hide IPCs + flip-checklist line; C5 first toggle after a
typed-name mint must visibly affect the open doc. Chris's queue copy confirmed FALSE, eric's
correction stands both flag states. **BUILT 2026-08-12 (owner go), ALL FIVE CONDITIONS APPLIED.**
Gates: pins `test_editor_mint_identity_only.js` (C1) + `test_sender_field_hidden.js` (C3) PASS ·
`test_build_template_fields` / `test_upsert_type_link` / `test_upsert_generic_skip` /
search no-global-collisions ALL PASS · review index.html divs 128/128 · **realdoc A/B on a live-DB
snapshot: feature vs stashed-base md5-IDENTICAL (142 docs, 0 silent wrong, 0 wrong-type
auto-file)**. REMAINING: the owner UI smoke list (Oracle gate) — needs a FULL APP RESTART (new
main-process IPCs): cancel = zero template rows · first-time-sender mint → toggle → visible hide on
the open doc · "Show again" on a doc matched to a garble-named sibling (tpl 11 is the live case) ·
Settings-side hide still live-updates Review · untyped-doc disabled state · generic-type friendly
refusal. A/B GOTCHA recorded: electron.exe is GUI-subsystem — PowerShell `&` does not wait and
`$LASTEXITCODE` is stale unless the call is PIPED; gate on printed output.

**ADDED OWNER REQUIREMENT (2026-08-12, mid-eric-pass, relayed to him):** when a doc's field set
changes, the CURRENTLY-IN-VIEW doc in Review must LIVE-UPDATE — today the operator must hit
Reprocess to see the field list change. Design split: (a) visibility refresh = renderer re-render
from existing extractions + new field defs, no Python; (b) a shown-again field with no stored
extraction row shows its normal empty state (re-extraction only via the doc-level Reprocess, offered
honestly). Chris card-5 save copy stays honest: in-view doc updates live, rest of queue does not.

## 2026-08-12 — Learning Repair: exclude currency magnitude from the "might not belong" shape check (owner-requested)

**Owner exhibit:** Pelican invoice, Total 479.04 flagged *"looks unusual for this type — the others
usually look like '1,357.92'"*. Mechanism verified: Detector B1 structured shape-miss
(`src/services/repairSuspects.js:182`) — `shapeSignature('1,357.92')` ≠ `shapeSignature('479.04')`
because the thousands comma is part of the shape, and comma presence is pure MAGNITUDE. Owner ruling:
some totals could be pence, some could be £100,000 — both correct on the doc; a money field has NO
meaningful magnitude/shape prior.

**Fix direction:** for currency-class fields (type `currency`, incl. the custom `total` key — check how
it's typed, the 08-09 note says the real live key is a custom field named `total`), replace the B1
dominant-shape comparison with a magnitude-invariant CURRENCY-FORMAT validity check: value must parse
as valid money (optional thousands groups + exactly 2 decimals). `'479.04'` and `'1,357.92'` both pass;
`'2.205.60'` (the real Nordwind 0015 garble class) still FAILS — so the true-positive catch is kept,
only the magnitude false positive dies. **Keep B3 unchanged** (letters/control chars in currency —
highest precision, still valuable). `number`-typed fields: decide at build whether same treatment
(quantities have the same magnitude-variance argument).

**Test:** pin both directions — 479.04-vs-1,357.92 mixed-magnitude pool produces NO suspect;
'2.205.60' in the same pool still flags. Precision-first per the detector's own charter.

## 2026-08-12 — RECONCILE FLAG MISATTRIBUTION: shadow subtotal flags the corroborated total (BUILT DARK 2026-08-12, Oracle W/COND C1-C5 — flip needs the census evidence)

**Live exhibit (owner at screen):** Silverbeck sales_order 0016 — page prints Net £387.75 / VAT £77.55 /
TOTAL DUE £465.30. `total` 465.30 read by TWO independent families (template_mapping 90 won + keyword 93,
both matched "TOTAL DUE" — the STRONG geometry-vs-caption pair). Shadow `subtotal` (method
`shadow_reconcile`, invisible, uneditable, un-learnable) misread 387.75 as **3875.75**; Stage-4 reconcile
flagged the CORRECT total ("total is less than the subtotal"), capped 50. Same mechanism family as the
vat_reg arc (poisoned invisible operand flags the correct total, oracle_log:1123) and the Python twin of
`TRUST_SHADOW_ROW_SKIP`.

**gary FACTS (verified at source):** reconcile admits ANY parseable subtotal — no method/corroboration
check on operands (`validator.py:655-662`); attribution hard-coded to `total_key` (`:695-700`,
`_RECONCILE_CAP=50` at `:641`); shadow rows minted by `_shadow_reconcile_components`
(`engine.py:3129-3157`), bypass the candidate ledger so their corroboration is always
`independent_agree:False`; the total's corroboration record ALREADY proves the doubly-witnessed side but
is built AFTER Stage 4 (`:7967`). Confirming the doc is SAFE — format learning excludes the method at SQL
(`learning.js:1288-1292`), confirm payload carries visible fields only.

**Design (gary, ranked #1 — candidates (b) digit-slip gate and (c) blunt shadow exclusion REFUTED, see
his report):** flag **`RECONCILE_SHADOW_ATTRIBUTION`** DEFAULT OFF + `_reconcileEnv` bridge + toggle.
Inside the existing contradiction branch only; fires iff a note would be set AND total's corroboration
says `independent_agree:True` AND **every valued operand** is `shadow_reconcile` (any real type-field
operand ⇒ today's behaviour). When fired: KEEP a note (stays the auto-file block) but state EVIDENCE
neutrally ("net/subtotal line read £3875.75; total £465.30 read identically by two independent methods"),
SKIP the 50-cap, never touch values, emit `reconcile_attrib` trace. Plumbing: `validate_and_adjust`
optional `corroboration=` kwarg; engine builds a pre-Stage-4 copy of `_build_corroboration_emit` only
when armed; persisted emit untouched; NEVER re-tune `_crosscheck_witness_bucket`. **This is corroboration
STEP 3's first consumer** (record→surface→decide honoured: no value moves, note retained, human
checkpoint kept) — needs owner sign-off; stays OFF.

**Seam / standing condition:** the cap-drop leaves the any-noted-field rule in trust.js as the ONLY
auto-file barrier on this class — **never arm together with any future "corroboration clears notes"
mechanism**. Verify before build: `_cmp_norm` strips currency ("£465.30" vs "465.30" must normalise
equal, else guard inert); hint-learning payload scope.

**Test plan (gary):** `test_reconcile_shadow_attribution.py` — 6 pins incl. trade-off pin (real visible
operand ⇒ unchanged) + true-positive pin (wrong single-family total + correct shadow ⇒ flag+cap intact);
JS seam pin extending `test_trust_shadow_row_skip.js` (new note text at 90 refused by docTrustGate);
corpus gate OFF byte-identical + ARMED zero value changes + noted-total count identical; census
instrument (vat_reg pattern) bucketing every contradiction by (total corroborated? × all-shadow?) = the
flip evidence.

## 2026-08-12 — `vat_tax` label starvation on `VAT @ 20%` captions (separate entry, do NOT bundle)

Silverbeck 0016 trace shows `MISSING(tax)` while the page prints "VAT @ 20% £77.55". Shipped labels have
`"VAT 20%"`/`"Tax (20%)"` but no `@`-form (`keyword_patterns.json:292-314`); ASSUMPTION (one probe
settles: run `keyword.extract_fields` on the doc's OCR for `vat_tax`) that the `@` defeats the match. Not
this flag's cause (3875.75+77.55 ≠ 465.30 regardless) but starves the reconcile + verified badge
system-wide; already named in the net-misread arc (oracle_log:818-819). reggie pass on the label matcher,
own flag, own rejected/accepted census over corpus OCR.

## 2026-08-11 LATE-NIGHT — NAME-BOX FLUSH-EDGE CLIP: (a)+(b) SHIPPED (Oracle SIGN-OFF-W/COND); C7 stored-box repair arm OPEN

**(a) teach-side + (b) read-side BOTH BUILT** (see the overnight commit; oracle_log 2026-08-11
LATE-NIGHT entry). (a) `boxSnap.js` + `valueLocate.js` trailing-edge pad floored at 0.004
(TRAIL_PAD; asymmetry pinned — left/vertical stay snug). (b) `TEMPLATE_NAME_EDGE_GROW` DEFAULT
OFF, toggle `name-edge-grow-toggle`, nested under `template_abs_edge_guard`: right-cut only,
last-token-only repair, page-present witness (cut word's locate text == grown last token, NO
short-token skip), FLAG-ONLY <=70+note, silent declines. Gates: OFF md5-identical · armed +22
lane heals / 0 losses · census 29 heal / 14 decline (1 direct commit, 28 superseded un-squats).

**STILL OPEN from the Oracle verdict:**
- **C1 owner expectation (BLOCKING at flip, discharged by SAYING it):** the flip does NOT change
  Ironclad 0028-1 — its overhang (0.0010) is under the untouched 0.004 floor. That page is cured
  by a RE-TEACH under the new snap pad, or by C7.
- **C7 — stored-box repair arm (owner decision, NOT built):** widen EXISTING live name-box
  trailing edges to the new 0.004 floor — the sample-angle-backfill pattern (census → plan →
  backup → apply → replay gate). Fix (a) only protects future teaches; without C7 the live flush
  boxes heal only where sibling drift clears the floor.
- **C3 owner-watch:** the 90→70 un-squat opens a 71-89 window for un-noted mid-confidence junk
  (observed once: 'SITE ADDRESS' @78 keyword, wrong→wrong, zero lane cost). Watch via
  NAMEGROW_CENSUS_DIR; v2 candidate (namegrow loser taints a different-valued winner with a
  review flag) — do NOT build without a fresh measurement.
- **C6 standing rule:** never arm `NAME_UNCLIP_RECONCILE` alongside this leg without a fresh A/B
  — two owners of one class.
- Full-shear under-reach recorded: a box excluding the last word ENTIRELY (token-count change)
  declines by design; census 'declined' rows measure the size of that class later.

---

## 2026-08-11 — OCR thread-count nondeterminism: reprocess paths ALIGNED, import residual + option-2 open

Owner-observed live: a single reprocess read `ACC-2291`, Reprocess-All read `ACC-229]` — SAME doc,
same DPI. Cause: Tesseract's LSTM scores boundary glyphs differently under different OpenMP thread
counts (upstream-documented), and the single spawn ran UNCAPPED while batch workers ran at
cores/shards (itself varying per batch size). **SHIPPED (owner "option 1"): one shared cap
`_reprocessThreadCap` = cores / min(configured concurrency, 10) on BOTH reprocess paths**, pinned
in `tests/test_reprocess_threadcap.js`. Residuals, both deliberate: (a) **first-IMPORT workers
keep their own per-shard cap** — an import-vs-reprocess boundary-glyph flip remains possible
(pin allows exactly that one surviving formula); (b) **run-to-run identity is NOT guaranteed** —
that is `OMP_THREAD_LIMIT=1` everywhere ("option 2", declined for speed). Revisit option 2 if
determinism ever outranks single-doc latency; extend the cap to the import path if the
import-vs-reprocess flip is observed live.

---

## 2026-08-11 — Stage-1 keyword is SAME-LINE only, so label-above layouts can never corroborate

Owner-reported live (Silverbeck sales order 0020): `sales_order_number` mapping matched
"SALES ORDER NO" and won — and NO keyword rung fired at all, so no "two independent readings
agree". `'Sales Order No'` IS in the shipped label bank; the caption just sits ABOVE the value in
a boxed table cell, and Stage-1 keyword matches label+value on the SAME reconstructed text line
only. Every stacked-cell field on box-form layouts (this doc's order number AND order date) is
structurally invisible to the keyword family — which bounds BOTH the corroboration badge and the
new corroborated auto-file route (such docs fail closed to Review, today's behaviour, no harm).
**Directions if coverage is wanted** (extraction work, own advisor+Oracle gate): (a) Stage-1
label-above extension (capture the value from the NEXT line below a matched bare caption —
precision risk: a bare 'Date' caption above a column of dates; needs the same guards the anchor
path has); (b) let the anchor-CROP family witness (no ⊕ anchors exist on wizard-taught installs —
same evidence gap NAME_UNCLIP hit); (c) the slice-2 `page_presence` witness (already named in the
corroboration design). NOT built; recorded so the "why no badge here?" question has an answer.

---

## 2026-08-11 — tpl 9 (Pelican) sample-angle row HELD out of the backfill (Oracle apply-condition 1)

The angle census says tpl 9 stored 0 / detected **-0.30** — exactly the apply floor, one
noise-width from the 0.2 detection minimum — and its ONLY lane outcome in the 118-doc gate replay
was negative: `Pelican-Office_invoice_0016-1.pdf` `account_no` `'ACC-2291'` → `'ACC-229]'`.
Oracle: a floor-row whose only evidence is negative is HELD, "correct in principle does not
outrank measured net-negative at the detector's noise floor." Condition-2 capture: the regressed
value commits at **70, FLAGGED** "unexpected characters (]) — please verify", needs_review —
nothing silent — and its corroboration record carries the disagreeing memory value `ACC-2291`.
**To revisit:** more Pelican lane evidence (heals ≥ regressions) or a better angle measurement;
apply via `scripts/backfill-sample-angles.js --apply --plan` with tpl 9 added to the plan. The
Pelican `customer_name` exhibit remains a box-SIZE defect (flush edge + 2.2 line-heights) whose
lever is a re-teach under the now-ON teach snap, not this angle.

---

## 2026-08-11 — compose-scan reads a NULL sample angle as "level" (absence-of-measurement = measurement-of-zero)

`engine.py` (~:5426, the `TEACH_ANGLE_COMPOSE_SCAN` branch) defaults a NULL `sample_deskew_angle`
to 0.0 and composes with it, where the deskew-side branch correctly stays inert on NULL. After the
2026-08-11 angle backfill the NULL set is only missing-sample-file templates, so the exposure is
small — but the honest behaviour would be "no measurement → no compose" there too. **Oracle ruled
this a SEPARATE owner decision (backfill slice C4), deliberately not changed in that slice.**
Decide: fail-inert on NULL (mirroring the deskew branch) vs keep 0.0. One-line change either way;
pin whichever is chosen.

---

## 2026-08-11 — NAME-CROP EDGE CLIP: owner's padding hypothesis MEASURED TRUE, blind pad REFUTED
**⚠ SUPERSEDED same evening — Oracle ruled WRONG LAYER for the grow (do not build).** The true root
cause was the STALE `sample_deskew_angle=0` on pre-round-trip templates (compose-scan misplacing
every composed box by the sample's undeclared tilt): with the true angle hand-set the class went
5/19 → 16/19 exact and the every-pad-garbled doc healed. Fixed by the sample-angle BACKFILL slice
(scripts/backfill-sample-angles.js, census + gate + pins). Re-measure with the probe only if the
class SURVIVES the backfill; the sections below stand as the measurement record. Also still open
from that ruling: 007's `_PREVIEW_DOWNSCALE=0.4` effective-DPI probe (comment at anchor.py:3019
says 300→~120 but the app renders 200→~80 effective — the interior 'Branblewood' m→n class).

**Owner, on the third `Ltc` exhibit:** *"the padding for the supplier name needs to be slightly
bigger. if you think about it d with the line clipped from it looks like a c."* Measured with
`stress_test/pad_probe_customer.py` (read-only; taught tpl-7 `customer_name` box re-read at
graduated pads through the mapper's OWN `_ocr_crop_laddered`, at the app's 200 DPI) over 20 live
Castellan docs:

| pad | true `Ltd` |
|---|---|
| pad-0 (as taught) | 9/20 |
| top +0.004 | 10/20 |
| **right +0.008** | **14/20** |
| top+bot +0.004 | 11/20 |
| all +0.004 | 12/20 |
| all +0.008 | 13/20 |

**The owner is right about the mechanism** — the `d`'s right-hand stem is clipped by the box's
RIGHT edge (right pad alone is the strongest single heal), and pad-0 reproduces the live garble
class, proving probe fidelity. **But a BLIND pad has a proven regression mode in the same table:**
`all +0.008` read **`BILL TO` at conf 94** on doc 365 — the pad admitted the caption row above
(the 2026-08-01 label-bleed class, which the label-tail CLAMP exists to kill), and right-pad
leaves trailing junk (`Ltda` ×2). Bigger padding trades one defect for two known ones.

**DIRECTION (not built — advisor + Oracle gate first):** not a pad — a **word-bounded right-edge
grow for NAME fields**, i.e. exactly what `TEMPLATE_ABS_EDGE_GUARD`/word-snap already do for
codes, which **exclude names by design** (`template_mapper.py:308`, "NAME_UNCLIP owns them") while
NAME_UNCLIP_RECONCILE is OFF and measured structurally inert (0/110). The exclusion seam is the
thing to revisit: grow the LAST word of a name crop to its word boundary with the edge-guard's
existing witness ladder (cut word's locate text ⊂ grown), never a blind margin. Gate: this probe
re-run (pad table must become word-grow ≥14/20 with ZERO label-bleed) + the teach-side corpus arm.
Interim mitigation ALREADY SHIPPED (`0816b28`): the picker now ranks + labels the ≥3×-confirmed
value first, so the operator sees "`Ltd` — you've confirmed this N times" above the garble.

---

## 2026-08-11 — BUYER-ISSUED IDENTITY, slices 2+3 (slice 1 SHIPPED `ca0bb49`; these are DESIGNED, not built)

Slice 1 (young-identity corroboration in `_identity_refuses`) closed the OBSERVED leak — Chris's
garble template riding the wordmark abstain at n<=1. Two designed remainders from gary's pass:

- **Slice 2 — `templates.buyer_issued` mark (closes Route A, which exists in NO corpus).** A
  *correctly* taught buyer-issued template (operator enters their OWN company as the issuer) passes
  the presence test on every inbound page, because the owner's name is printed on everything the
  business receives (as recipient). Design: additive `templates.buyer_issued` column (migration),
  written at template creation/confirm when the source doc is buyer-issued (JS twin of
  `engine._buyer_issued` — type's `ref_field_key == 'po_number'` or trusted PO heading); a marked
  template is refused by TEXT arms for a doc whose TRUSTED detected title declares a different
  type. Go-forward-only; kill `TEMPLATE_BUYER_ISSUED_TYPE_SCOPE`, DEFAULT OFF. Coverage is
  unit-level only until a corpus exhibit exists — say so in the gate.
- **Slice 3 — the VAT-contradiction rail (Chris's own proposal; catches the LOGO-arm residual the
  identity guard is deliberately scoped out of).** A `template_fixed` stamp of a
  `_PRECISE_VAL_TYPES` field contradicted by a DIFFERENT well-formed same-type value printed on the
  page → review note + hold below auto-file. Never blank, never unfreeze (unfreezing VAT was
  measured 51→16% on 08-08 and is REFUTED). The live exhibit is already in today's trace: Oakhaven
  prints `GB 660 1173 45` (keyword, 87) while the stamp said `GB 512 8846 27` (template_fixed, 95)
  — the new corroboration RECORD (`extractions.corroboration`) now captures exactly this row, so
  the rail can be measured from recorded disagreements before it acts on them.

## 2026-08-11 — CHRIS r2 FINDING 6: a printed HEADING ("SUPPLIER") becomes the company on 19 documents

**Symptom:** one ⊕ teach on a Quillstone PO; after reprocess, 19 siblings read the block-heading
caption as the company — queue groups "SUPPLIER ×13", "UPPLIER ×5", "rans ×1". All 19 carry a
Check flag (held — the safe state), unlike the identity-leak class. **Why the shipped guards miss
it:** `issuerReadLooksImplausible` (810ea8f) never judges a single token (BP/IBM immunity), and
"SUPPLIER"/"UPPLIER" are single tokens; the G3b known-caption value guard arms CUSTOMER-SIDE
name fields only — `supplier_name` is explicitly excluded; `CAPTION_VALUE_REFUSE` shipped inert.
**Fix direction (NOT built):** the anchor-read supplier path should refuse a value that IS a known
caption for the field it fills (the caption vocab already exists per-run —
`keyword.build_caption_vocab`), scoped to the ANCHOR/template rungs, refuse-to-empty (falls to the
cold-start letterhead suggest, which names the real company). Needs its own measurement: the
08-10 `captionrefuse` arm exists and measured the class (`account_no` 40 no-source commits,
serials 19) — re-run it before building. Severity medium: flagged-and-held today.

## 2026-08-10 — A TYPED TEACH VALUE CAPTURES NO LOCATION (UI done; the STORAGE question is OPEN)

**Owner, verbatim:** *"we need to lose this and add an option in the top to type manually if not
selectable on the page - note that the supplier may exist in selectable form in the footer and that
is OK. My worry is that by typing manually, we haven't captured a location for the data, making
matching harder in future."*

**SHIPPED (`c877aac`) — the UI half only.** The prominent accent card "📌 Always the same on every
document? → Set a fixed value" is gone from under the page on every field; manual entry is now a
quiet link-weight control at the TOP of the step, worded as the exception; the typing panel states
what the choice costs before you type; and the issuer prompt + intro copy now say the value can be
drawn anywhere it is printed, **the footer included**.

**SHIPPED 2026-08-10 EVENING — DIRECTION 1 IS BUILT.** When the operator types a value, the wizard
now searches the page's own word geometry for that string (`src/windows/shared/valueLocate.js`, new
`ocr-page-words` IPC → `region.py --page-words` → the PIPELINE's `reconstruct_page_text` words). A
hit is DRAWN on the page and the operator says whether that is the place; accepting stores through
the same `store()` the drawn-box path uses, so the field commits as a normal Stage-0.5 MAPPING and
`doCommit` needs no special case. No hit — or "Save as a typed value" — keeps the old `fixed_value`
path byte-identically. Kill: setting `teach_typed_value_locate` = 'false'. Pins:
`src/windows/shared/test_value_locate.js` (12 checks). **What remains open is below.**

**The ORIGINAL statement of the problem, kept because directions 2-4 still stand.** A typed value
used to persist as `state.results[key] = {value, target:null, anchor:null, anchor_text:null,
status:'fixed'}` (`teach/renderer.js` `showFixedInput`) → the `fixed_value` path: **no geometry at
all**, nothing for a future document of the same layout to match against, and the value reused as-is
on every document of the type.

**Why this is more than a nicety — the `fixed_value` path has a bad record on this corpus.** Three
separate defects this week all ran through a frozen fixed value stamped at high confidence:
the wrong-company misfile (a buyer-issued template's frozen `supplier_name` stamped onto 18 other
companies' documents at 95 via `template_fixed`); `vat_no`'s frozen `fixed_value` being the literal
caption `'VAT'` on 21 of 26 wrong reads; and `serials` committing `'Serial No:'`. Every one of those
is the same shape: a value with no position, frozen from a sample of one, asserted confidently.
Reducing how often the wizard mints one is therefore a genuine accuracy lever, not just tidier UI.

**Directions to weigh:**
1. ~~**Capture a location even when the value is typed.**~~ **BUILT (see above).** Match policy
   settled as EXACT-after-normalisation with no fuzzy tier, compared in two forms (whitespace-
   collapsed and whitespace-free, so `'PI/26'`+`'/6000'` still matches `PI/26/6000`); a run is only
   ever assembled within ONE visual row. Multiple hits are not resolved by a heuristic — every
   occurrence is offered to the operator in reading order (the owner's letterhead-and-footer case).
   **Known limitation, seen live during the build:** when OCR mangles the value (`GB651002784` read
   as `GB85` + `1002784`), a strict matcher cannot find it and the field falls back to a typed
   value. That is the fail-closed choice — a near-miss box is worse than no box — but it means the
   89.5% census figure is an UPPER BOUND on what this recovers in practice.
2. **Separate "typed because OCR failed" from "genuinely not on the page".** Only the second should
   ever become a position-less constant. Today they are indistinguishable in the stored row.
3. **Stop a sample-of-one typed value being asserted at 95.** Related to `TEMPLATE_FREEZE_QUALIFY` /
   `freeze_guard.js` (already built for the VAT class) — a typed value with no corroboration is the
   weakest evidence in the system and currently carries near the highest confidence.
4. **Ask the operator where it applies.** "Is this the same on every document of this type, or just
   this one?" — the old card ASSUMED the first and never asked. The wizard now no longer advertises
   the assumption, but it still cannot record the answer.

**MEASURED 2026-08-10 EVENING — `stress_test/fixed_value_locatable.js` (read-only, live-DB
snapshot). DIRECTION 1 IS THE FIX.**

```
Fixed values (template_fields.fixed_value, non-empty): 22
  PRINTED on its own sample page :   17   (89.5% of measurable)
  NOT on the page                :    2   (10.5% of measurable)
  no pinned sample document      :    3   (unmeasurable)
  measurable total               :   19

  field            printed  absent
  supplier_name          7       0
  vat_no                 6       0
  account_no             3       0
  serials                1       1
  po_ref                 0       1
```
Nearly every typed value IS on its own page — it was typed because the READ was wrong, not because
the value is absent. **`supplier_name`, `vat_no` and `account_no` are 16 for 16.** So the premise
holds: search the page's word geometry for the typed string and store the box, and most manual
entries become positioned teaches for free.

**THE CATCH THE CENSUS ALSO FOUND — presence is not correctness, and direction 1 must not bless a
bad value.** At least two of the 17 "printed" rows are values we already know are WRONG:
- tpl 9 `vat_no = 'VAT'` — the caption-freeze defect (fixed for extraction by `92c7013`, but this
  frozen row is still sitting in the DB). It scores as "printed" because the caption **is** on the
  page, so a naive geometry search would happily pin a box around the word "VAT" and give a wrong
  value a POSITION and therefore more credibility than it has now.
- tpl 9 `supplier_name = 'Pelican Office Interiors -'` — the trailing-dash clip.
**So the design gains a hard condition: capturing geometry for a typed value must not by itself
raise that value's standing.** Either capture the box and leave confidence where it is, or gate
capture on the value passing its field's format/quality check. A found box is evidence about
WHERE, never about WHETHER.
**How the shipped version answers it:** `locateValueInWords` returns `{box, text, wordCount}` and
nothing else — no score, no confidence, no verdict — and that is PINNED (check 10 asserts the exact
key set, using `vat_no='VAT'`, one of the two known-wrong values, as the fixture). The committed
value stays exactly what the operator typed. Standing is not raised anywhere; what changes is that
the template READS the position on each future document instead of re-asserting a constant, which
is the mechanism all three frozen-value defects shared. **Not claimed: that the resulting read
carries a LOWER confidence than `template_fixed` did — it may not, and that was not measured.**

Two further notes from the run: the 2 genuine absentees are `serials = 'Serial No:'` (a caption,
i.e. the known serials defect) and `po_ref = 'PO-59430'` — so the "genuine constant" bucket may be
empty of *legitimate* constants entirely, which would weaken direction 4's premise. And tpl 11 has
3 fixed values with NO pinned sample, so a real implementation needs an answer for templates whose
sample is gone.

**Caveat on the number: n=22 on one install.** The test is also deliberately GENEROUS — it asks
"is this string anywhere in the sample's `ocr_text`", which is an UPPER BOUND on what a word-box
search could find. Re-run it on a second taught state before treating 89.5% as the population rate.

---

## 2026-08-10 — OWNER-REPORTED: KEEP THE PRE-NORMALISATION VALUE SO THE PAGE-PRESENCE CHECK COMPARES LIKE FOR LIKE

> **⚠ ROOT-CAUSED 2026-08-10 EVENING, AND IT OVERTURNS THIS ENTRY'S DIRECTION. The slash-removal
> site IS located, the note was TELLING THE TRUTH, and the value is the thing that is wrong.**
> `anchor._repair_single_token` (`anchor.py:2650`, predicate `:2647`, guard `:2686`; reached from
> the winning `template_mapping` rung via `anchor._ocr_crop_laddered` at `anchor.py:3228`)
> re-reads a spaceless token that
> contains `/` using `tessedit_char_whitelist=A-Za-z0-9-` — a whitelist that **physically cannot
> emit `/`** — and accepts the result when its alphanumerics match. That acceptance test is
> satisfied by every code whose separators are PRINTED, so `PI/26/6000` was re-read as `PI266000`,
> compared equal, and committed with a character silently deleted. Its only protection is a
> guard for DATE-shaped tokens (`\d{1,4}[./-]\d{1,2}…`), which a letter-prefixed reference misses.
> **CORRECTION to this entry's own analysis below: it recorded `anchor.py:2666` as building "a
> COMPARISON target, not a committed value". The `target` local is indeed a comparison target — but
> the function RETURNS `alt`, the whitelisted re-read, and that IS the committed value.**
> **MEASURED (live install, read-only census over documents whose page text is stored): 36 committed
> `invoice_number`s had lost a separator their own page text still prints — all 36 through
> `template_mapping`.** The `I`→`1` half is a genuinely separate, upstream OCR misread: the PAGE
> TEXT itself reads `P1/26/3711`, so `_repair_single_token` did not cause it.
> **FIXED behind `CODE_SEPARATOR_STRUCTURE_GUARD` (DEFAULT OFF, bridged + toggled + pinned).** A
> token that splits into ≥2 groups of ≥2 alphanumerics is a structured code and keeps its
> separators; an artefact wedged into an unbroken run leaves a one-character group
> (`H/7R5326676`) and is still repaired. Keeps the separator on **36 of 36**; `|` and `\` are never
> treated as structural. Seam checked: `validation_patterns.alphanumeric` already permits `/`, so
> the kept separators do not trip the field's own format gate.
> **WHAT REMAINS OF THIS ENTRY.** The raw-twin design below is NOT the fix for this exhibit — it
> would have silenced a correct warning about a genuinely wrong value. It still has merit as a
> general reduction of Gate C's false-flag rate, and item 3 (populating the dead `extractions.raw_value`
> column, which would revive `credit_sign_note`'s dead guard) stands on its own. Re-cost both once
> the guard is flipped and the false-flag rate is re-measured.
> **CORPUS ARM RUN 2026-08-10 EVENING — GATE GREEN.** `teach_run_ab.js base sepguard` over a
> SNAPSHOT of the live taught state (`TESTING/_measure/live_20260810.db`, never the DB the app is
> using), 195 documents, 200 DPI, live settings mirrored so `base` is the owner's real behaviour and
> `sepguard` minus `base` is exactly `CODE_SEPARATOR_STRUCTURE_GUARD`.
> **ref 25 ok / 3 wrong → 27 ok / 1 wrong (89% → 96%). Every one of the eight other lanes is
> BYTE-IDENTICAL — same ok/wrong/empty and the same winning-rung distribution. Two heals, zero
> regressions. Failing cells 14 → 12.**
> The three baseline ref failures were `PI251029`, `PI255450` (separators stripped) and `P1269923`
> (separators stripped AND the `I`→`1` misread). Armed, only the last survives, as **`P1/26/9923`** —
> **the arm SHOWS, rather than asserts, that the `I`→`1` is a separate upstream OCR defect this
> change does not touch.** The owner-reported false "doesn't appear on this page as written" note is
> gone on the two documents whose value is now right, and correctly persists on the one still wrong.
> Residual worth knowing: on that document the committed confidence moved 95 → 90, still above the
> 88 auto-file floor, so the remaining wrong value is no better protected than before.
> **Still outstanding: an Oracle pass.**

**Owner, verbatim:** *"we need a way to retain the data obtained before special characters are
removed from a value so it can be cross checked in the background in review — we see a note here to
say the data doesn't exist on the page. This is correct but it is because the slashes were removed
before populating the field."*

**Exhibit (owner screenshot, live queue).** `Pelican-Office_invoice_0023-1.pdf`, a Pelican Office
Interiors SALES INVOICE. The page prints **`PI/26/6000`** in the *Invoice Number* box (and again in
the payment terms line: *"Please quote PI/26/6000 on all remittances"*). The field committed
**`P1266000`** at High · 95%, and Review shows:
> `'P1266000' doesn't appear on this page as written — please check the reference before filing.`
The note is **factually true and behaviourally useless**: the value is the right value, run through a
normalisation the page-presence test then judges it against the un-normalised page. The operator is
sent to check a reference that is correct.

**What I verified at source (not inferred):**
- The note is emitted at `python_backend/extraction/engine.py:4113` — **Gate C** of
  `_filing_value_sanity`, whose test is a WHOLE-TOKEN membership check: it splits the page on
  whitespace, strips a fixed edge-punctuation set (`.,;:()[]{}"'`) off each token, casefolds, and
  asks whether the committed value is in that set (`:4110-4111`). `PI/26/6000` is one whitespace
  token, and interior `/` is not in the edge-strip set — so the page token stays `pi/26/6000` while
  the committed value is `p1266000`. **The comparison never had a chance.**
- The gate is guarded by `FILING_VALUE_SANITY_FLAGS` (`:4071`). CLAUDE.md records that flag as
  bridged-but-OFF; the owner's screenshot shows the note firing, so **it is ON in the live install** —
  confirm which before measuring anything, or an arm will look inert when it is merely unarmed.
- The gate is FLAG-ONLY by design and its own comment already anticipates disagreement between a
  crop read and the full-page pass. So this is a **false-flag-rate** defect, exactly the axis the
  comment says gets measured — not a filing-correctness one.
- `_clean_value` (`keyword.py:1862`) is **NOT** the site that drops the slashes: its only
  separator-normalising branch is `job_reference` (the 4-4-1 shape, `:1881-1884`) and this field is
  an `alphanumeric` ref. Every other normaliser I found is EDGE-anchored (`^…|…$`) and cannot touch
  an interior character — `keyword.py:241`, `suffix_reconcile.py:48`, `template_mapper.py:355`
  (`_CODE_EDGE_DEBRIS`), `text_normalise.py:38`, `validator.py:285`. The one unanchored stripper,
  `anchor.py:2666` `re.sub(r"[^0-9A-Za-z]", "", segment)`, builds a COMPARISON target, not a
  committed value.
- **Therefore the interior-slash removal site is NOT yet located, and the entry does not claim one.**
  Note the exhibit also carries an `I`→`1` substitution (`PI` → `P1`), which no normaliser explains —
  so at least part of this read is an OCR misread and the true mutation may be
  read-then-normalise, not normalise-alone. **First diagnostic step: SFDEV-trace this document and
  read the winning rung's RAW crop output**, before designing anything. Do not assume the owner's
  "slashes were removed" is the whole mechanism — it is the visible half.

**The owner's ask, restated as the fix direction.** Carry the pre-normalisation string alongside the
committed value, and give every background cross-check the choice of which one to compare. Concretely:
1. **A raw twin on the field dict.** The extraction result dicts already flow as
   `{value, confidence, method, …}`. Add the untouched pre-clean string (one key, set at the point
   each rung commits) and thread it through the merge so it survives to `results`.
2. **Gate C compares BOTH.** Present-as-written passes if EITHER the committed value or its raw twin
   matches a page token, and a third arm should compare with all non-alphanumerics removed on BOTH
   sides (`pi266000` vs `p1266000` still differs here, which is the useful signal — it isolates the
   `I`→`1` misread from the punctuation loss, and THAT is a note worth showing).
3. **The DB already has the column and it is dead.** `extractions.raw_value` exists in the schema,
   and CLAUDE.md's 08-09 audit records `credit_sign_note`'s raw-marker arm as a **DEAD GUARD because
   `raw_value` is never assigned** (`validator.py:364,387-389` reads it; nothing writes it). Populating
   it is the same slice as (1) and would revive that guard for free — **check whether reviving it
   changes credit-note behaviour before shipping, or this lands as a silent second change.**
4. **Then reconsider the note's copy.** Even when the check is right, "doesn't appear on this page as
   written" describes the test, not the risk. If the punctuation-blind compare matches, the honest
   note is about the FORMATTING differing from the page, not about the value being absent.

**Watch-outs / seams.** (a) A raw twin must never become a *candidate* — it is evidence for checks
only, or a garbled pre-clean string will find its way into a field. (b) The whole-token test is
deliberately whole-token (its comment explains that a substring test would hide the `VXS986` ⊂
`VXS98624` clip class) — a punctuation-blind arm must not quietly become a substring test and reopen
that. (c) Anything that changes what Gate C flags needs the false-flag census the gate's own comment
demands, on the scanned corpus, before it is recommended. (d) Same class, same page: `VAT NUMBER`
reads the bare caption `VAT` at High·95% while the letterhead prints `VAT GB 774 2093 55` — that is
the vat_no lane, already fixed by `92c7013` behind a default-OFF flag; this document may simply
predate the flip.

---

## 2026-08-10 — ONE ORDINARY CONFIRM STAMPS THE WRONG COMPANY ON 18 OTHER DOCUMENTS
### STATUS: FIXED behind `TEMPLATE_IDENTITY_ON_PAGE` (`ebd2096` + `fba4374`), DEFAULT OFF.
### ORACLE: SIGN OFF WITH CONDITIONS — all six applied and re-gated. Ready for the owner to flip.

**THE OWNER'S LIVE INSTALL IS CLEAN — verified: 0 of 147 documents carry a supplier that disagrees
with their own filename.** The defect is LATENT there, not active: it needs a template built from a
document the business ISSUES ITSELF, and the live database has no `purchase_order` template. It
fires the first time the owner confirms one of their own purchase orders.

**THE FIX** refuses a TEXT-arm template match unless the template's own company name appears
somewhere on the page. Measured on 200 documents: 160 right matches kept, 40 wrong matches refused,
**zero right matches lost**. Gate on a fresh import: wrong senders 18 -> 1, wrong account numbers
36 -> 19, and 17 references / 17 dates / 17 order numbers RECOVERED (they had been read off the
wrong layout's geometry). Full reasoning in `git show ebd2096`.

**ORACLE'S SIX CONDITIONS, all applied in `fba4374`** — two of them were real defects in my first
version, not polish:
  * **C1** I read the cosmetic `templates.name` as the identity. This codebase has ruled twice that
    it is not one. An admin RENAME would have stopped a template matching its own documents for
    ever, silently, and an auto-generated "Purchase Order Template" name would have PASSED the guard
    on every purchase order ever printed. Now uses the confirmed issuer, then the frozen fixed value,
    then abstains.
  * **C2** I vetoed the winning candidate instead of filtering the pool. With two templates built
    from the buyer's own purchase orders — same poisoned fingerprint, both scoring 1.00 — vetoing the
    winner means the CORRECT template is never reached: "teaching a second supplier broke the first
    one". Now an admission filter before ranking.
  * **C3** refuse only where the supplier's own confirmed history says it normally prints its name
    (ratio >= 0.80). A pure-wordmark letterhead is carved out by measurement rather than by hope.
    Explicitly NO 3-confirm floor — that floor is what slept through this defect.
  * **C4** the refusal is logged. **C5** the logo-arm carve-out is not a guarantee and no longer
    reads like one. **C6** there IS a 0.75 keyword floor; what is missing is a margin, and a margin
    would have been vacuous here.

**WHAT THE FIX DOES NOT DO, and this is the part still open:** it stops a wrong binding being MADE.
It does not undo one already made — see the sticky-binding entry below. And it does not repair the
poisoned fingerprint itself: that template's recognition words are still the owner's own address
block, still matching everything; the guard only stops it being acted on. Oracle is ruling on whether
that is the right layer or a compensation.



**Found twice the same night, independently: by Chris at the screen, and by the harness in the
database.** Not built, not designed — it needs an advisor round and an Oracle pass before anyone
touches it, because it sits across three subsystems that are each individually defensible.

**WHAT HAPPENS.** A customer imports 200 scans and confirms ONE Quillstone purchase order — an
ordinary confirm, no teaching. That confirm creates template 12 with `supplier_name` FROZEN
(`is_variable = 0`, `fixed_value = 'Quillstone Print & Packaging'`) from that single document. The
template then matches **Oakhaven Electrical delivery notes** — a different company AND a different
document type — and stamps `Quillstone Print & Packaging` as the issuer at **confidence 95 via
`template_fixed`**, on pages whose own letterhead reads "Oakhaven Electrical Wholesale" in 24-point
type and whose VAT number the app reads correctly off that same letterhead.

**IT REACHES THE DISK.** Chris confirmed one exactly as any user would (the account number was
right, nothing on screen suggested the company was wrong) and it filed to
`Output/Quillstone-Print-&-Packaging/2025/January/Delivery-Note.13-01-2025.OED26662.pdf`, with
`<SupplierName>Quillstone Print & Packaging</SupplierName>` beside `<VatNo>GB 660 1173 45</VatNo>` —
Oakhaven's VAT number — in the XML sidecar. **The issuer decides the output folder AND the whole
learning scope.** The only thing holding the other 17 back was an unrelated punctuation flag on a
reference number; clear that and they follow.

**MEASURED COST:** issuer 141 ok / 19 wrong / 40 empty on 200 documents, where the same corpus
scored 140 / 0 / 60 before the three confirms. Twenty correct-but-empty became nineteen confidently
wrong.

**THE CHAIN, verified at source in the sandbox database:**
1. an ordinary confirm auto-creates a template (graduation) from ONE document;
2. `_buildTemplateFields` freezes `supplier_name` from that one document — legitimately, since the
   issuer is a genuine per-supplier constant and five shipped guards need that seed to exist;
3. the template matches an unrelated supplier's pages (the 64-bit logo phash hashes LAYOUT, not the
   mark — the long-standing finding in `project_logo_hash_unreliable`), and the type gate does not
   stop a `purchase_order` template matching a `delivery_note`;
4. the frozen value commits at 95, above the 88 critical floor and above the 95 auto-file
   pre-filter, with `template_fixed` — the one method every credibility rail deliberately exempts.
**Every link is defensible on its own. The composition files a customer's document in another
company's folder.**

**WHY THE EXISTING GUARDS DID NOT CATCH IT.** `TEMPLATE_FIXED_NAME_PRESENCE_VETO` — which exists for
exactly this class and WOULD have blanked it — requires >= 3 confirmed documents for that supplier
(`TEMPLATE_NAME_PRESENCE_MIN_SAMPLE`). There was one. So the guard is inert precisely during the
window when a new install is most exposed: the first few confirms.

**DIRECTIONS, none of them chosen yet** (an advisor round should rank these, not me at 4am):
- the cheapest-looking: a template may not stamp an issuer onto a document whose own page carries a
  DIFFERENT company name — the page-vs-template disagreement is already computable
  (`_flag_branding_conflict` has the machinery, and `chrome_band.issuer_chrome` has the band);
- the sample floor: `TEMPLATE_NAME_PRESENCE_MIN_SAMPLE` is the thing that made the guard inert. A
  first-confirm template is exactly the case that needs it MOST. Consider a distinct rule for a
  template with `confirmed_count <= 1` rather than lowering the floor globally (the 2026-08-08
  measurement is a warning about widening this class of guard);
- the type gate: should a `purchase_order` template ever match a `delivery_note` at all?
- the seed: should an auto-graduated template from ONE confirm freeze the issuer at 95, or hold it
  at a review-bound confidence until a second document agrees?
**Do not just raise a threshold.** Each of these is a different layer, and CLAUDE.md's standing rule
applies: fix the reusable layer, and name what the fix relies on and what it disables.

**MEASURED OVERNIGHT (2026-08-10, Oracle C2's arm, 67 surviving documents).** Forcing
`TEMPLATE_NAME_PRESENCE_MIN_SAMPLE=1` — i.e. letting the presence veto judge a supplier with a single
confirm — **DOES catch this defect**: the one wrongly-stamped document still present in that run
(`Castellan Security Systems` on an Oakhaven delivery note) is BLANKED and routed to review. The
other 19 blanks are documents that were already empty, so nothing correct was lost on this corpus.
That is real evidence for the "distinct rule for a one-confirm template" direction — the guard for
this class already exists and is simply asleep during the window that matters. It is NOT yet a
recommendation: 67 documents, one exhibit, and the corpus cannot show what a low floor costs on an
install with many suppliers and thin scans. Re-measure on a full corpus before believing it.

## 2026-08-10 — A WRONG TEMPLATE BINDING IS STICKY: REPROCESS NEVER RE-IDENTIFIES
### STATUS: FIXED (`29425c9`) — a remembered binding the PAGE CONTRADICTS is no longer honoured.
### Gated on the reprocess path, where the two arms were previously byte-identical:
### issuer 29 ok / 18 wrong -> 29 / 1, every other lane unchanged. Reprocess now HEALS it.
### Still open below: what else a user can do about a wrong binding, and whether the other
### re-identify triggers (type disagreement, an explicit "wrong layout" action) are worth it.

Found while gating the wrong-company misfile above, and it explains something the customer
simulation reported independently.

**Reprocessing a document does not re-examine which template it belongs to.** The reprocess path
passes `known_template_id` and the extractor honours it, so a document bound to the WRONG template
stays bound to it for ever, however many times it is reprocessed. Chris pressed "Reprocess all in
queue" specifically to make his teaching take effect; it could never have healed the 18 documents
already labelled with the wrong company — and, worse, that is exactly the button a user reaches for
when they notice something is wrong.

**It also made the corpus harness structurally blind to an entire class of fix.**
`stress_test/teach_run_ab.js` models reprocess, so it passes the known ids too. My first gate on the
misfile fix returned two BYTE-IDENTICAL arms and the guard looked inert — when in fact identification
was never re-run, so the guard was never reached. `TEACH_FRESH_IDENTIFY=1` now drops the known ids
and models a fresh IMPORT. **Any future change to WHICH template is chosen must be gated with it, or
the gate is vacuous by construction.**

**The open question is not "should reprocess re-identify" — it is what a user can DO about a wrong
binding.** Reprocess is the obvious lever and it is inert. Candidates, unranked: re-identify when the
document's own detected type disagrees with the bound template's type; re-identify when the bound
template's company is not named on the page (the same predicate the misfile fix already uses); an
explicit "this is the wrong layout" action in Review; or Learning Recovery reassignment, which
exists but is admin-only and template-scoped rather than document-scoped. Needs a design pass — the
naive version (always re-identify on reprocess) throws away the deliberate binding a teach created,
which is the thing reprocess was built to preserve.

---

## 2026-08-10 — SERIALS: A FORMAT GATE MADE IT WORSE, AND THE REVERT IS THE FINDING

Built, measured, REVERTED. Recorded so nobody builds it again.

`serials` was committing the literal caption `'Serial No:'` on 8 documents (template_fixed, conf 35)
plus a garbled `'al No: NW-79!'`. The obvious fix is the one that worked twice this week for vat_no
and account_no: ship the field with its own captions and a format. I built it — a `serial_list`
pattern accepting one code or a comma/semicolon/slash-separated list, verified against the real gate
in both directions (it refuses `'Serial No:'` and accepts `'NW-6338572, NW-4685760, NW-7945815'`,
which a plain `alphanumeric` type does NOT — the commas put it under the coverage floor, so the
obvious typing would have refused every legitimate multi-value read).

**And the lane did not move: 0 ok / 12 wrong before, 0 ok / 12 wrong after.** What changed is WHICH
wrong value:

    before   'Serial No:'   template_fixed  conf 35    <- obviously junk to a human
    after    'CJB-5900'     template_mapping conf 90   <- looks exactly like a real serial number

The caption commits died and the field fell through to the taught mapping, which is reading the
WORKSHEET NUMBER. So the change traded an obviously-wrong value at low confidence for a
plausibly-wrong one at high confidence. By this project's own standard — a plausible wrong value is
more dangerous than an obvious one, because the operator's glance is the last check — that is a
REGRESSION in safety even though the score is identical. Reverted.

**THE ACTUAL DEFECT IS THE TAUGHT BOX**, not the format: on the Castellan worksheets the serials
mapping reads `CJB-xxxx`, the worksheet number, which is printed near the serial block. A format
gate cannot separate two codes of the same shape. Whoever picks this up should start at the taught
geometry (is the box on the wrong row? does it drift on siblings?), not at the captions — and should
know that the caption class is already gone the moment the box is right.

Note for scale: on the 67-document measurement subset only 3 documents have serials printed at all,
so this lane is the least statistically meaningful in the corpus. Do not spend a night on it before
the fields that appear on every page.

---

## 2026-08-10 — NON-UK VAT NUMBERS ARE NOW REFUSED (Oracle C7)
### STATUS: FIXED behind `VAT_EU_FORMATS` (DEFAULT OFF, bridged + toggled + pinned).
### Per-country structures with exact element counts — never a generic "two letters plus 8-12
### characters" rule, which is what would readmit the garbles. **MEASURED on the live install:
### 56 distinct `vat_no` values ever committed, 10 accepted before and after, 46 refused before
### and after, ZERO flipped refused→accepted.** All 20 real non-UK forms pass, spaced and
### unspaced; `comsssie42` / `ee05351042` / `VAT` / `3PL` / `1RE` still refused; UK identical.
### **The renderer widens from the SAME setting** (`get-validation-patterns` in review/handler.js),
### which is the `iban` lesson — a backend-only widening would still warn an operator that their
### correctly typed Irish number is wrong. **CORRECTED BY ORACLE C3 (below): that is TWO of THREE
### consumers.** `trust.js` reads the same config directly and deliberately does not widen.
### **THE LIMIT, which format cannot fix:** a garble that matches a real country structure exactly
### IS accepted — `'ee053510429'` (nine digits, a valid Estonian shape) passes, while the measured
### `'ee05351042'` (eight) does not. Same lesson as the serials entry.
### **DEVIATION, pinned:** Romania is officially 2-10 digits; it ships floored at SIX, because a
### 2-digit body in a filing field is junk. A shorter real RO number falls to review.
### **ORACLE: SIGN OFF WITH CONDITIONS (2026-08-10) - 4 BLOCKING. C1/C3/C4 APPLIED; C2 OUTSTANDING.**
### **C1 WAS A SHIP-BLOCKER AND IS FIXED.** `NO` is not only Norway's country code, it is the
### English caption word "No" - and `keyword.py:1409` (`_VAT_ID_LEADIN`) already records that as
### what sits immediately left of a VAT number's digits. The separator class swallowed a space AND
### a full stop, both consumers compile IGNORECASE, and a UK VRN is exactly NINE digits - Norway's
### own element count. So `No 651 0027 84` / `No. 651 0027 84` (a UK number carrying its own label
### tail, this repo's most-measured defect class) validated as Norwegian at coverage 1.00 and would
### have COMMITTED SILENTLY where today it falls to review. Fixed by making the MVA suffix
### MANDATORY (and MWST|TVA|IVA for CHE) - a more specific rule, not a looser one. The pin was run
### RED against the pre-fix config before it went green. Live census re-run: still 56 values,
### 10 accepted / 46 refused / **0 flipped**, so the narrowing cost nothing on real data.
### **C3: THE "BOTH CONSUMERS WIDEN" CLAIM WAS INCOMPLETE - THERE ARE THREE.**
### `trust.js` `_sharedValidationPatterns` reads the config directly and does NOT widen, feeding
### freeze_guard arm B (a correct `DE123456789` is declined a freeze with a misleading reason
### `'format'`) and the auto-file `vat_gb` HMRC mod-97 checksum (a correct Irish number could never
### auto-file). Both fail toward review, so it is recorded and PINNED
### (`database/modules/test_freeze_guard.js`, with a UK control) rather than widened - widening it
### changes what gets FROZEN and what AUTO-FILES, which is a different decision.
### **C4: FLIPPING THE TOGGLE NEEDED AN APP RESTART, AND THAT WAS THE DEFECT ITSELF.** The renderer
### cached the MERGED patterns while Python re-reads the setting per spawn, so for one restart the
### pipeline was wide and the operator warning narrow - the exact UI/pipeline disagreement the
### widening exists to remove. Now caches the RAW config and merges per call. New behavioural pin
### `src/modules/review/test_validation_patterns_merge.js`, shown RED (4 checks) against the old
### cached-merge before going green.
### **C2 IS DISCHARGED (2026-08-10 EVENING3).** New rejected-candidate census: both `vat_no`
### rejection sites (`keyword._validate`, `anchor._crop_is_credible`) gained an env-gated logger
### (`VAL_CENSUS_DIR`, inert unless set), run over the 200-doc corpus as arm `valcensus`.
### **2036 gate decisions, 519 refusals, 230 of them `vat_gb`, 61 distinct refused strings.
### RE-TESTED AGAINST THE WIDENED SET: ZERO newly accepted.** C2's pass criterion is met on the
### population the committed-value census could not see.
### **AND THE REFUSED POPULATION VINDICATES C1 WITHOUT TRIGGERING IT.** Three of the 61 are literal
### caption tails - `'No GB 903331842'`, `'NoGB 903 331842'`, `'NoGB 903331842'` - so the "No"
### caption really does get captured into `vat_no` crops on real documents. It survives here only
### because these suppliers print the `GB` country code after the caption, which breaks the Norway
### pattern at the `G`. **Stated honestly: this corpus contains the MECHANISM but not the TRIGGER.**
### Re-tested explicitly, the PRE-C1 optional-suffix list would also have accepted 0 of the 61 - so
### C1 is not justified by this corpus, it is justified by the one printed layout away from it
### ("VAT No 651 0027 84" with no country code, which is ordinary UK practice).
### **Control:** the `valcensus` arm scores ref 25 ok / 3 wrong, identical to `base`, so the
### instrument does not perturb what it measures.
### Advisory and also outstanding: an operator-affirmation hatch for a value the table cannot know
### (model on `accepted_name_values`); `guessType` maps /vat/ to `currency` (`doctype-editor.js:78`),
### its own defect; and the "VAT number (GB)" type label lies once armed.

`vat_no` gained a real format on 2026-08-09 NIGHT (`92c7013`) and the shipped patterns are **UK
ONLY**: `GB` + the 3-4-2 grouping, the 12-digit branch-trader form, the GD/HA government form, and a
bare 9- or 12-digit run. That was deliberate - the corpus and the customer base are UK, an
international arm buys zero measured recall here, and a generic "two letters plus 8-12 characters"
arm would let six of the measured OCR garbles straight back in (`comsssie42`, `ee05351042` and
friends: 'CO' and 'EE' are real country codes).

**THE COST, stated so a customer does not discover it first.** A UK business receiving an invoice
from an Irish, German or French supplier now gets `vat_no` **empty, and a review**, and an operator
who types `IE1234567FA` by hand gets an on-blur warning telling them their correct value is wrong.
It fails toward review, so it is not a blocker - but **this is the same class that was fixed for
`iban` on 2026-08-08**, where the backend accepted a conventionally-printed IBAN while the renderer
warned on it. Do not let it sit.

**THE FIX IS DESIGNED AND HELD.** reggie's Tier 2 is a CLOSED per-country table with per-country
lengths (DK/FI/HU/LU/MT/SI 8 digits, DE/EE/EL/GR/PT 9, BE/PL/SK 10, HR/IT/LV 11, SE 12, plus the
shaped forms for AT/CY/ES/FR/IE/NL and the ranges for BG/CZ/LT/RO). Verified against the measured
garbles: with the closed table ZERO of them are readmitted - it is the GENERIC arm that readmits
six. The RO branch is the loosest and would be the one to watch.

**Ship it the day a real EU supplier arrives, with that supplier's own number as the test case** -
not before, because a pattern nobody can test against real paper is a pattern that will be wrong in
a way nobody notices. The full per-value verdict table is in the 2026-08-09 NIGHT advisor round.

---

## 2026-08-09 NIGHT — two residuals left by the issuer fix (`587f5ac` + `045b176`)

Both surfaced BY the gate, neither is a blocker for the pair, and both are recorded rather than
tuned because each is a decision, not a bug fix.

**(1) SHIPPED — a confirmation no longer costs confidence** (`TEMPLATE_FIXED_SEED_AGREEMENT_KEEP`,
default OFF). An exact re-read of the curated `fixed_value` now KEEPS the seed (95, `template_fixed`)
instead of being applied as a refinement at 78. **Read the commit before flipping it: the blast
radius is total** — all 145 corpus documents then commit their issuer as `template_fixed`@95, and
document-level >= 88 goes 28 -> 124 with the wrong-value-carrying subset 13 -> 60. Zero values change,
zero suppliers blanked. It removes a confidence penalty that was accidentally acting as a safety net
for the `account_no` defect; fix that first, and do not flip this alongside a lowered
`auto_file_threshold`.

**(2) ORACLE G3 IS NOT MET BY THE PAIR (it is met by the arbiter fix alone).**
`arbiter` + `issuer_region_presence` moves TWO documents (Castellan worksheets 0012 and 0030) above
the >= 88 field-confidence band, because their issuer is now correct at 95 — and both still carry a
PRE-EXISTING wrong `account_no` (`'JB-6875'`/`'JB-5027'`: the JOB REF read as the account code).
Neither fix creates or alters a wrong value, and the population at >= 88 carrying a wrong value falls
21 -> 13, but the bar was ZERO GAINED. Auto-file cannot fire on this install at all (threshold 100,
max `overall_confidence` 95), so the exposure is latent. **Owner/Oracle decision, not mine.**
The underlying `account_no` defect is worth 40 wrong cells corpus-wide and is its own slice.

## 2026-08-09 — SFDEV: show the WINNING KEYWORD (the caption the app actually matched)
### STATUS: BUILT 2026-08-10 EVENING3. Dev-only, no flag (the whole surface is trace-gated).
### The caption rides `step` / `candidate` / `merge` / `anchor_reject` as `caption`, read from the
### rung's OWN result key (Stage 1 `label`, Stage 0.5 + Stage 2 `anchor`) and never re-derived.
### Shown in the dev-inspector ladder, its LOST-rung line, the winning-lineage chain, the
### "Other candidates" list, the Stage-2 reject rows, the Review trace console, and the bulk grid.
### **VERIFIED END TO END on live document 482 and 525** (`trace_one_doc.js`), not just wired:
### `vat_no` carries `caption: "VAT Reg No"` on the keyword rung, the 0.5 mapping rung, and the
### already-resolved Stage-2 row.
### **ONE SUPPRESSION IS LOAD-BEARING:** Stage 0.5 passes `anchor_text or field_key`, so a mapping
### with no taught label carries the FIELD KEY in the caption slot. Showing that would invent a
### printed line — `_caption` drops it, and the drop is pinned.
### **WHAT THIS IS NOT: the caption is not persisted** — see the dead-column entry directly below,
### which is why the bulk grid's captions are session-scoped.

**Owner request, verbatim:** *"in SFDEV i would like to see the winning keyword so i know what the
app used to derive the value."*

**Why it matters.** The dev inspector's ladder already names the winning RUNG (`keyword`,
`template_mapping`, `anchor_crop`, …) but not WHICH CAPTION that rung matched. When a value is
wrong, "Stage 1 · keyword" tells you the stage and nothing about the cause — whereas "matched
`Your PO`" versus "matched `Account No`" is usually the whole diagnosis. This session's C7 census
made the same point quantitatively: declines are dominated by a label being answered by the wrong
printed line (`'Your PO'` -> `'Invoice Number Date Your PO Account No'`), which is invisible today.

**THE DATA ALREADY EXISTS — this is plumbing + display, not a new capture.**
- `python_backend/extraction/keyword.py:121` states it outright: *"Every keyword read records the
  exact caption it matched (`results[key]['label']`)"*, and `:1191` and `:1207` already RANK on
  `results[k]['label']`, so it is populated and load-bearing, not incidental.
- Stage 0.5 has the equivalent: `_mapping_result(...)` is passed `mapping.get("anchor_text") or
  field_key` and the result dict carries it as `anchor` (`template_mapper.py`, `_relocate_and_read`
  / `_read_registration`).
- Stage 2 anchor reads carry their own label likewise.

**Leads for the build.**
- Display seam: `src/windows/dev-inspector/renderer.js:164` renders the ladder row and already
  prints `st.method` in a `<span class="conf">`. The winning caption belongs beside it — and the
  LOST-rung line just below (`:166-167`, "the taught anchor read X but lost to Y") is where it pays
  off most, because a lost rung's caption is exactly what you need to know.
- Transport seam: the ladder is built from `process-trace` events (`renderer.js:303-306` shows the
  event kinds, incl. `anchor_reject`). Check whether `label`/`anchor` already survives into the
  trace payload; if it does this is display-only. If not, thread it at the emit site rather than
  re-deriving it in the renderer.
- Same value belongs in the SFDEV bulk debug-table (`debug_values.json`) so a queue-wide grid can be
  sorted by winning caption — that is how a systemic mis-caption gets spotted rather than a
  per-document one.
- Stage 2 `anchor_reject` rows should name the caption too, for symmetry.

**Scope note.** Dev-only surface (`Ctrl+Shift+D`, `M`, pw `SFDEV`), so no customer-facing copy and
no `feedback_minimal_interaction_autofile` tension. Read-only display of data already computed;
`--trace` is only added while the inspector/console is open, so normal processing stays
byte-identical.

**NOT BUILT — logged on the owner's "add to list" convention.**

---

## 2026-08-10 — ORACLE ON `CODE_SEPARATOR_STRUCTURE_GUARD`: SIGN OFF W/COND, 2 MEASUREMENTS LEFT

**Verdict: SIGN OFF WITH CONDITIONS — 3 BLOCKING.** Root cause, layer and direction all confirmed;
it ruled explicitly AGAINST making the whitelist re-read unreachable from the template rung (that
would remove a real repair from the rung that reads most codes — the defect is the ACCEPTANCE TEST,
which is where the guard sits). `realdoc_regression.js` is NOT required (one call site; the live
DB's 7 confirmed documents make it vacuous — consistent with the 08-09 EVENING ruling).

**APPLIED:**
- **C3 — the commit shipped a FALSE CITATION while correcting one.** `anchor.py:2632` is inside
  `_value_drifted_from_box`; the function is `:2650`, predicate `:2647`, guard `:2686`. And
  `template_mapper.py:40` → `:3638` is **DEAD IN PRODUCTION**: `_crop_and_ocr` returns at `:3623`
  through `_ocr_crop_laddered` whenever `ocr_text_fn is _ocr_text`, which is the default and what
  `engine.py` passes; only a test stub reaches the later call. The live reach is `anchor.py:3228`
  (and `:3012`). Corrected in the code comment, the test docstring, `CLAUDE.md`, this file and the
  handover. **The standing rule applies to my own work.**
- **C5 — currency excluded from the keep**, so the blast radius is exactly the code fields the
  guard was measured on. **Oracle's own example was wrong and the correction is pinned:**
  `1234/56` never reaches the repair in either state (the pre-existing date-shape guard claims it).
  The shape that DOES reach it is `10603/44` — the misread of the 08-09 `£10,603.44` exhibit —
  because five digits before the separator take it clear of the date shape.
- **C4 — the accepted cost is pinned:** `AB12/34567` (a genuine artefact landing mid-token, ≥2
  alnum either side) is NO LONGER repaired. The "one-char group is the artefact signature" premise
  is a prior from one docstring exhibit, not a measured property. The class is narrower than it
  looks — the repair only ever fired when the re-read DROPPED the character, never when it
  substituted a glyph — but nobody has counted it. **Do not tighten the predicate to compensate:
  that is what re-breaks the 36 measured invoice_numbers.**
- **C6 — the 95→90 is explained and recorded.** Not the guard touching a confidence path: Stage
  2.5b withdraws a conformance boost (`ocr_corrector.py:274` `boost_table {0: 8}`, applied at
  `engine.py:6693`) that the install's own SEPARATOR-FREE learned history — history generated by
  this very defect — used to grant. 90 clears the 88 floor. **Do not "restore" the 95.**
- **C7 — `re.fullmatch`** on `_STRUCTURED_CODE_SEP`.

**C1 IS ANSWERED — AND THE ANSWER IS WORSE THAN EITHER BRANCH ORACLE PREDICTED.**
Measured 2026-08-10 EVENING3 on the six live Pelican documents that still have their file, base
vs armed, via `trace_one_doc.js` over the live snapshot:

| doc | armed value | conf | the "doesn't appear on this page" note |
|---|---|---|---|
| 0023 (**the owner's exhibit**) | `P1/26/6000` | 95 → 94 | **CLEARED** |
| 0022 | `P1/26/3711` | 90 → 94 | **CLEARED** |
| 0029 | `P1/26/1792` | 90 → 94 | **CLEARED** |
| 0025 | `P1/26/9923` | 95 → 90 | persists |
| 0019 | `P1/26/2247` | 95 → 90 | persists |
| 0030 | `\| PI/25/54451` | 70 | a DIFFERENT note (edge-cut), different rung |

**It is Oracle's case (a): the crop really does read `P1`, so the `I`→`1` is upstream and armed the
exhibit commits `P1/26/6000` — still wrong, because the page prints `PI/26/6000`.** (Confirmed by
0030, same supplier and layout, which reads the prefix `PI` correctly on a different rung.)

**BUT THE NOTE CLEARS ANYWAY ON THREE OF FIVE, AND THAT IS THE FINDING.** Gate C can only ask
whether the committed value appears in the PAGE'S OWN OCR TEXT. On 0023/0022/0029 the full-page
read carries the SAME `I`→`1` misread as the crop, so once the separators are restored the value
matches the page text exactly and the warning goes. On 0025/0019 the full-page read got the `I`
right, so the mismatch survives and the warning stays.

**So on this supplier the guard converts "wrong value + warning at 95" into "wrong value + NO
warning at 94" on three documents in five.** The warning that was protecting them was firing for
the WRONG REASON — the separator — and fixing the separator removes it while the real defect goes
unflagged. Nothing here says the guard is wrong (deleting a printed character is a real bug and it
is really fixed); it says the guard was silently propped up by a false-positive warning, and
removing that prop exposes how little protects this class.

**CONSEQUENCE FOR THE FLIP, and it is Oracle's §3.4 made concrete:** 94 clears the 88 auto-file
floor with no note. Latent on this install (`auto_file_threshold` 100, auto-file has never fired)
but LIVE on a customer install with the slider at 88–90 — those three would auto-file a wrong
reference. **Do not flip this alongside a lowered `auto_file_threshold`.**

**CORRECTION TO MY OWN HANDOVER.** `HANDOVER_2026-08-10_EVENING2.md` says the note "correctly
persists on the still-wrong one". True of 0025 — the only still-wrong document the CORPUS arm had —
and false on three of the five live ones. A single corpus residual was generalised into a rule.

**WHAT THE OWNER WILL SEE** if they flip and open the exhibit: the reference reads `P1/26/6000`
and the warning is gone. The separators are back; the `I` is still wrong. Say this to them plainly
BEFORE they flip, or the missing warning reads as the fix having worked completely.

**C2 IS ANSWERED, AND THE ANSWER IS STRONGER THAN THE CONDITION ASKED FOR.**
`_repair_single_token` gained an env-gated outcome counter (`SEPGUARD_CENSUS_DIR`, inert unless
set; `stress_test/teach_run_ab.js` arms `basecensus` / `sepcensus`). Both arms over the 195-doc
corpus on the live taught state:

```
base   (guard OFF):  91 reached with a separator-bearing token  ->  91 REPAIRED
armed  (guard ON) :  91 reached                                  ->  91 kept, 0 repaired
```

**Every one of the 91 repairs is a FALSE POSITIVE.** Classified by the guard's own predicate: 91 of
91 are structured codes (26 distinct values, all `PI/25/...` / `PI/26/...` forms), and **the
artefact class the repair exists for occurs ZERO times.** So the answer to "does the repair's
true-positive path fire on this corpus at all" is no: on this data the function has never once done
the job it was written for, and has silently deleted a printed character 91 times.

**Inverse census on the live install** (`stress_test/census_separator_kept.py`, new, read-only):
2160 extraction rows, 887 committed values carry a structured separator, and **0** have the
artefact signature (committed WITH a separator the page prints WITHOUT). The guard would wrongly
keep 0 of them.

**THE HONEST READING, and it must be stated this way.** The guard's measured cost is zero on both
the corpus and the live install — but that is because NEITHER CONTAINS A SINGLE INSTANCE of the
class it disables. The eight byte-identical lanes therefore say nothing about that cost, exactly as
Oracle suspected; what rules it out here is the census, not the lanes. A mid-token artefact
(`AB12/34567`) remains possible on paper and is pinned as an accepted cost in
`test_code_separator_structure.py`. **Do not report this as "the guard has no cost."**

**Control:** the census arm scores ref 27 ok / 1 wrong, identical to the plain `sepguard` arm, so
the instrument does not perturb what it measures.

**BOTH BLOCKING CONDITIONS ARE NOW DISCHARGED (C1 above, C2 here).** What remains before a flip is
a judgement, not a measurement: the guard removes a warning from three of five live Pelican
documents whose value is still wrong for an unrelated reason, and 94 clears the 88 auto-file floor.

**Also worth knowing, not blocking:** on the 36 healed documents the Gate C note clears, so they
become auto-file ELIGIBLE at 90. Latent on this install (threshold 100, never fired) but live on a
customer install with the slider at 88–90. And arming the guard does NOT un-poison the install —
off the template rung, a corrected value read by keyword/anchor on a scope with ≥3 separator-free
confirms is still nulled (`engine.py:7181-7229`); only new confirms or Learning Repair fix that.

---

## 2026-08-11 — OWNER PRINCIPLE: THE RUNGS SHOULD CORROBORATE, NOT MERELY COMPETE

**Owner, verbatim, on the SFDEV trace where the mapping matched `JOB SHEET NO` at 90% and the
keyword matched a bare `Ref` at 85%:** *"it got the right value but it is more about corroboration
than merely getting it right. all the mechanisms should work in the best way possible to enable us
to confirm the values obtained. otherwise there is a chance, from time to time the wrong value will
be selected."*

**HE IS RIGHT, AND IT REFRAMES SEVERAL THINGS IN THIS BACKLOG.** That trace is not a success story.
The two rungs were answering **different questions** — one hunting the taught caption, one hunting a
generic `Ref` — so they could never AGREE; they could only compete, and the outcome was decided by a
5-point confidence margin. A margin is not evidence. When it tips the other way (the mapping fails,
the page is dirtier, the generic caption happens to sit nearer a plausible value) the wrong rung
wins and **nothing in the system notices**, because nothing was ever asked to agree.

### What exists today, verified at source
The vocabulary is already here, but only inside specific guards, never as a governing rule:
- `_anchor_corroborates` (engine.py ~:278) — CORROBORATE-ONLY, used by the ownership cap.
- `_template_identity_corroborated` (~:203) — identity/template claiming.
- "no different-method-family rail agrees" (~:368) — the closest thing to the owner's principle,
  and it is a REFUSAL condition for one guard, not a general signal.
- An existing doctrine at ~:142: *"confirmation grants no new authority — so agreement should
  license KEEPING what is already there"*.

**What does NOT exist:** anything that rewards, records or surfaces the fact that two INDEPENDENT
rungs reached the same value. `_merge_outcome` is value+method equality; the disambiguation picker
sorts chosen-first then confidence; `_build_candidate_emit` never asks whether the candidates agree.
Agreement is currently invisible.

### THE DISTINCTION THAT MUST NOT BE LOST, or this gets built wrong
This repo has a hard, Oracle-ratified rule that **same-pixel agreement is worthless**:
`docs/oracle_log.md` 2026-08-03 measured same-pixels-different-postprocess witnesses at **5:1
false:true**, and the 2026-08-11 `I`→`1` work re-proved it (light and heavy preps AGREE on the wrong
`P1` on 2 of 5 documents — correlated error, not corroboration).

**Keyword vs template_mapping is a genuinely different case.** They locate the value by different
means — caption search versus taught geometry — so when they land on the same string that IS
independent evidence. The rule to encode is therefore about **independence of METHOD FAMILY**, not
about counting witnesses:
- caption-located (Stage 1 keyword) vs geometry-located (Stage 0.5 mapping) → INDEPENDENT, agreement counts
- two preps of the same crop, or a re-read of the same box → NOT independent, agreement counts for nothing
- full-page OCR vs a crop of that same page → PARTIALLY independent (it caught the separator class,
  and it also FAILED on the `I`→`1` class where both carried the same misread — see the sepguard C1
  finding). Treat as weak.

### WHY THIS IS THE REAL ARGUMENT FOR `teach_label_becomes_keyword`
Pointing the keyword rung at the taught caption does not merely stop it reading `Ref`. **It makes
two independent rungs answer the same question, so that their agreement becomes available as
evidence for the first time.** That is a better justification than the one currently in this file,
and it explains why the corpus arm measured nothing: the scorer counts final values, and
corroboration is invisible to it. **A lane that is byte-identical can still have become far better
evidenced.** Any future arm for this should count AGREEMENT, not just correctness.

### DIRECTIONS (nothing built; this is a principle, and it needs the advisor + Oracle gate)
1. **Record it first, spend it later.** Emit per-field: which method families produced a value, and
   whether the independent ones agree. The `_field_candidates` ledger already collects the
   candidates — this is a derived read of it, and it is inert by construction.
2. **Then surface it** — in SFDEV (beside the caption, which is what made this visible at all), and
   in Review as the honest version of "verified": *"two independent readings agree"* rather than a
   bare confidence percentage. The owner's standing rule is minimal interaction, so this is
   information, not a new prompt.
3. **Only then let it move a decision** — agreement licenses KEEPING or raising trust; DISAGREEMENT
   between independent families is the flag. That ordering matters: a corroboration signal that
   starts by changing outcomes cannot be measured against the outcomes it changed.
4. **Interaction to check before any of it:** auto-file already has `docTrustGate`; adding a
   corroboration input there is the obvious payoff and the obvious risk. Do not wire it to auto-file
   in the same slice that introduces it.

**NOT BUILT.**

---

## 2026-08-11 — OWNER-REPORTED (x2): THE APP ALREADY KNOWS THE ANSWER AND DOES NOT CONSULT IT

Both raised from a live screen: an Ironclad statement whose `customer_name` picker offered
**`Bramblewood Joinery Ltc`** (chosen, 70%, *"doesn't read like a name — please verify"*) against
**`Bramblewood Joinery Ltd`** — the owner's OWN company, confirmed on hundreds of documents.

---

### (1) THE DISAMBIGUATION PICKER NEVER CHECKS WHETHER A CANDIDATE IS A VALUE WE ALREADY KNOW

**VERIFIED AT SOURCE.** `engine._build_candidate_emit` orders the options with exactly this key:

```python
reps.sort(key=lambda c: (0 if _cmp_norm(c.get("value")) == chosen_norm else 1,
                         -(c.get("confidence") or 0), str(c.get("value"))))
```

**Chosen-first, then confidence, then alphabetical. There is no consultation of confirmed history,
`supplier_hints`, `corrections`, or `accepted_name_values` anywhere in the emitter.** So a one-glyph
misread that happens to have won is presented FIRST and described neutrally, while the value the
install has confirmed hundreds of times is second and unmarked.

**THIS IS A REPEAT OF A KNOWN CLASS, which strengthens the case.** 2026-08-08 recorded the same
shape: *"`supplier_hints` holds the correct value at `usage_count=10` and `keyword_override` reads it
too, yet the clipped taught read beats both at 95 — the system knows the answer twice over and
cannot apply it."* Same defect, different surface.

**Why `Ltc` beat `Ltd` is worth stating precisely, because it rules out the easy fix:** they differ
by ONE glyph and both are well-formed, so no format/shape gate can separate them — exactly the
lesson the serials and VAT entries already record. The ONLY discriminator available is *"we have
seen this exact string confirmed before, many times, and never the other one."*

**DIRECTION (not built).** A candidate that EXACTLY matches (under `_cmp_norm`) a value previously
CONFIRMED for this field in scope should (a) sort first, and (b) be labelled as such —
*"Bramblewood Joinery Ltd — you've confirmed this 214 times"*. Ranking alone probably suffices;
auto-picking is a separate, larger decision (Stage 4.6 `_resolve_candidates` already exists for
that and is gated `off`).

**TRAPS, each of which has bitten this repo before:**
- **Scope it.** `customer_name` was UNLINKED from identity at migration 44 and mig 45 PURGED its
  learning, so `supplier_hints` may hold nothing for it — check before relying on that table.
  Confirmed `extractions` rows are the more reliable source here.
- **The variability guard.** `supplier_hints` deliberately skips any field with >=2 distinct
  confirmed values in scope; a recipient name on a buyer's documents is near-constant, so it should
  qualify — but verify rather than assume.
- **Do not let this auto-commit.** The picker is suggestion-only by design (`project_disambiguation_
  picker`: "pick never files"). Ranking and labelling change no value.
- **Frequency, not mere presence.** A single past confirm of a garble would otherwise promote it.

---

### (2) A CONFIRMED TEACH LABEL NEVER BECOMES THE KEYWORD FOR THAT FIELD

**Owner, verbatim:** *"When we draw an anchor and set the label can we set that confirmed label
value as the only keyword on that doc for that field — some are picking up the correct template
mapping eg po number but the keyword for that field is looking elsewhere at 'ref'."*

**VERIFIED AT SOURCE, and he is right.** The mechanism already exists and is fully wired into
extraction: `field_label_overrides` (migration 19, `doc_type_slug` + `field_key` + `label`), read by
`label_overrides.getForExtraction` and threaded to Python as `--label-overrides-file`
(`processing/handler.js:1007`). **But the ONLY writers are the admin Settings screen
(`settings/handler.js:269`/`:275`) and the preset-catalog seeder.** Nothing on the teach or confirm
path ever writes one.

So a ⊕ teach persists `anchor_label` into `field_anchors`, which drives **Stage 2 anchoring** — and
Stage 1 keyword carries on using the generic caption bank, which is why a correct `po_number`
template mapping coexists with a keyword hunting `'ref'`. The operator has told the app the caption
and the app only half-listens.

**BUILT 2026-08-11 (`48bcc48`, migration 61, DEFAULT OFF `teach_label_becomes_keyword`) — and the
owner's SFDEV trace later CONFIRMED the mechanism live:** on a Castellan service worksheet the
mapping matched `"JOB SHEET NO"` and WON at 90% while the keyword rung matched a bare `"Ref"` at
85% and lost. Traced: `_REF_ROLE_CAPTIONS = ["Reference No", "Reference", "Ref No", "Ref"]`
(`keyword.py:396`, applied `:490`) is seeded onto every ref-role field, and `worksheet_number` has
NO shipped `field_patterns` entry, so it inherits the generic bank including bare `Ref`. The wrong
keyword costs nothing while the mapping holds; the exposure is documents where the mapping fails.

**DIRECTION (as built).** On confirm, when a taught mapping/anchor carries a non-empty
`anchor_label`, write the doc-type-scoped override for that field. The plumbing is already there;
this is a WRITE that is missing, not a new subsystem.

**THE HARD PART IS THE WORD "ONLY", and it needs a decision before code.** `addLabelOverride` ADDS
to the bank; the owner asked for the confirmed label to be the *only* keyword. Exclusivity is a
different and riskier semantic — and it already has a relative: `KEYWORD_GENERIC_CAPTION_EXCLUSIVE`
(shipped, default ON via migration 60) exists because *"one printed code was captured into THREE
fields — every ref-role field is seeded the same generic caption bank"*. Whatever is built here
must be reconciled with that flag rather than layered on top of it blindly.

**FURTHER TRAPS:**
- **The table has NO supplier column.** It is doc-type-scoped, so an override learned from one
  supplier's statement applies to every supplier's statements. That may be wanted (a caption is
  usually a document-type convention) but it MUST be a stated decision — `field_anchors` is
  supplier-scoped and this is not.
- **The issuer teaches with an EMPTY label ON PURPOSE** (Oracle-signed 2026-07-10: a phantom label
  makes the teach silently do nothing). So `supplier_name` must be excluded, or the write must skip
  empty labels — which is the same thing, but say which.
- **A mis-read label would be learned as a keyword.** Chris's round produced `"Statement Re"`
  (missing the f) as a confirmed label. Feed that into the keyword bank and it is wrong for every
  future document of that type. Pair this with the plausibility guard shipped in `810ea8f`, or gate
  the write on the label being located on the page.

**Both NOT BUILT — logged on the owner's "add to list" convention.**

---

## 2026-08-11 — THE SAFETY NET HAS 14 RED GATES, AND NOBODY KNEW BECAUSE THE SUITE CANNOT BE RUN

**Measured, not estimated.** New runner `stress_test/run_all_suites.py` executes every test file in
its OWN process (which is what `pytest tests/` cannot do — a script-style file `sys.exit`s at import
and kills collection for everything after it). First full run, 2026-08-11:

```
457 files   442 pass   15 fail        (8 python + 7 js; one of the 15 is a runner artefact)
```

**ALL 15 REPRODUCE IDENTICALLY at `455d4a7`**, the commit this session started from — verified in a
separate git worktree with the same interpreter and the same `node_modules`. **Zero regressions from
any of tonight's work.** They are pre-existing, and several are long-standing.

**CLAUDE.md's "four pre-existing Python failures" is STALE and was understating by nearly 4x.** The
real figure is 14 genuine red gates (15 minus the artefact). The line has been repeated across
handovers as reassurance; it should not be quoted again without a re-run.

### The artefact (fixed in the runner, not a defect)
`python_backend/test_mapping.py` is a CLI diagnostic requiring `--image-file`/`--mapping-file`; it
exits 2 when run bare. Now in the runner's `SKIP_FILES`.

### Family 1 — THREE fixtures whose schema has drifted behind the migrations (one shared cause)
`database/modules/test_accept_correction.js` · `test_page_count.js` · `test_recycle_bin.js`
all die with `SqliteError: table documents has no column named logo_detail_hash` — the column
migration 47 adds. These fixtures build their schema by a route that does not run the full migration
set, while the production code they exercise now writes that column. **Test-infrastructure rot, not
a product defect** — but it means three gates over correction-acceptance, page counting and the
recycle bin have been asserting nothing for some time. Likely one shared fix (migrate the fixture).

### Family 2 — ELEVEN genuine assertion failures, each asserting something real
| file | what it says |
|---|---|
| `tests/test_label_overrides.py` | 2 FAILED — *"auto-learned anchor does NOT override the hand-drawn mapping"*. This is the anchor-vs-mapping PRECEDENCE ladder, which several shipped fixes depend on. |
| `tests/test_anchor_crop_crosscheck.py` | 3 FAILED — the crop-vs-page disagreement comparator. |
| `database/modules/test_authoritative_anchor.js` | 2 FAILED — authoritative ⊕ teach precedence + usage-weight blending. |
| `tests/test_template_rescue.py` | 1 FAILED — wrong-type rescue guard. |
| `tests/test_engine_detail_thread.py` | 1 FAILED — detail-hash threading when there is no page image. |
| `tests/test_identity_fusion.py` | 1 FAILED — `test_verdict_conflict_agree_abstain`. |
| `tests/test_network_field_authority.py` | collection ERROR — `_run.<locals>.<lambda>() got an unexpected keyword argument 'trace'`: the test's stub has drifted from a signature that gained `trace`. |
| `tests/test_reprocess_manifest.py` | collection ERROR — `ValueError: too many values to unpack (expected 5)`: a return arity changed under the test. |
| `client/test_apiclient.js` | 1 FAILED — *"getDocument -> 200, type_slug=invoice + no leak"*, i.e. the detached client's DE-PATHING contract. |
| `src/modules/api/test_v1_contract.js` | CRASHES at `:160` — the `/v1` contract gate does not even complete. |
| `src/windows/shared/test_doctype_surface_parity.js` | 1 FAILED — *"the edit button is hidden while creating a new type"*. |

**Two of these are worth the owner's attention specifically:** `test_v1_contract.js` is the gate on
the frozen `/v1` contract and it is CRASHING, and `test_apiclient.js` is failing on a no-leak
assertion — the de-pathing work of 2026-08-02 exists precisely so paths never reach the client.
Neither is evidence of a live leak (both may be stale fixtures, like family 1), but a *security-
adjacent gate that does not run* is indistinguishable from one that passes until someone looks.

### WHAT I DID NOT DO, deliberately
I did not fix any of them. They are pre-existing, it is the middle of the night, and blind
test-repair is exactly how a real regression gets papered over — several of these could equally be a
correct test catching a real defect introduced weeks ago as a stale fixture. Each needs the
"is the test wrong or is the code wrong?" question answered individually, at the source.

**Suggested order when picked up:** family 1 first (one shared fix, three gates back), then the two
collection ERRORs (a changed signature/arity is usually a five-minute fix and until then those files
assert NOTHING), then `test_v1_contract.js`, then the precedence pair
(`test_label_overrides` + `test_authoritative_anchor`) which are the highest-value assertions in the
list.

**Baseline artefact:** `~/Desktop/TESTING/_measure/suite_results_20260810.json` (per-file rc, style,
duration and output tail). Re-run with `py -3.12 stress_test/run_all_suites.py`. Compare against that
file rather than against memory.

---

## 2026-08-10 — ROOT-CAUSED: THE `I`→`1` MISREAD IS THE OCR LADDER PICKING THE MOST CONFIDENT
## WRONG READ. The correct read is already being produced and then discarded.

**The defect.** Every Pelican reference commits with its letter `I` read as the digit `1`: the page
prints `PI/26/6000`, the field commits `P1/26/6000`. Isolated once the separator guard removed the
second defect stacked on top of it.

**THE CROP IS PERFECT.** Rendered and read by eye first (007's rule): `slice_12_target.png` on doc
0023 is a clean, tight, high-contrast `PI/26/6000`. This is not placement, not drift, not the taught
box. It is a READING failure on legible pixels.

**MECHANISM, measured on the exact crops the pipeline used** (five live Pelican documents, PSM 7,
mean word confidence as `_read_lines_full` computes it):

| prep | 0023 | 0025 | 0019 | 0022 | 0029 | verdict |
|---|---|---|---|---|---|---|
| **raw greyscale** | `PI` 56 | `PI` 76 | `PI` 66 | `PI` 45 | `PI` 53 | **CORRECT 5/5** |
| light (upscale+autocontrast) | `PI` 26 | `P1I` 33 | `PI` 10 | `P1` 73 | `P1` 33 | 2/5 |
| heavy (`_prep`, +SHARPEN) | `P1` 36 | `PI` 58 | `P1` 50 | `P1` 70 | `P1` 50 | 1/5 |
| struct (`_struct_prep`) | `P1` 55 | `P1` 73 | `P1` 53 | `P1` 54 | `P1` 55 | 0/5 |

**THE READ THE PIPELINE NEEDS IS ALREADY BEING PRODUCED AND IS THEN THROWN AWAY.** Stage 0.5 calls
`_ocr_crop_laddered` with `verify_fn=None`, so the gate is `conf >= 60` (`anchor.py` `_gate`). When
no rung clears 60 the ladder falls back to `anchor.py:3304-3305` —
`if rseg and rconf > best_conf: best_seg = rseg` — returning the HIGHEST-CONFIDENCE rung at `:3341`.
On 0023 that is heavy at 36 over light at 26: **the wrong read wins precisely because it is more
confidently wrong.**

**CORRECTED 2026-08-11 (Oracle, and I verified it myself before accepting it).** An earlier version
of this entry said "every rung on this crop scores below 60". That is FALSE on 2 of the 5, and the
error was load-bearing. Re-measured through the ladder's OWN `_read_lines_full` rather than
`image_to_string`, which is a second correction — the two disagree on layout assembly:

| doc | exit taken | winning rung |
|---|---|---|
| 0023 | sub-floor | struct/psm7 |
| **0025** | **GATE (>=60)** | struct/psm7 |
| 0019 | sub-floor | struct/psm7 |
| **0022** | **GATE (>=60)** | light/psm7 |
| 0029 | sub-floor | struct/psm7 |

**So a fix confined to the confidence comparator heals at most 3 of 5.** Any fix must sit at BOTH
exits. (And the struct rungs exist at all only because migration 60 seeds `struct_code_read`; pin
the both-exits behaviour, never the per-document split, which that toggle changes.)

**THE REAL LESSON, and it generalises far past this supplier: Tesseract's mean word confidence is
NOT COMPARABLE ACROSS PREPROCESSING RECIPES.** Sharpening and upscaling make the engine more certain
while destroying the evidence that separates a serif `I` (full-width top and bottom serifs) from a
digit `1` (angled flag, narrower foot) at ~20px cap height. The ladder treats those numbers as
commensurable and they are not. Any field whose crop scores under 60 on every rung is exposed to
the same inversion — this is not a Pelican bug.

**OWNER ASKED: would pre-binarising the page (2-bit / 1-bit B&W) help? MEASURED — NO, it makes it
worse**, and for the same reason:

| variant | 0023 | 0022 | 0029 |
|---|---|---|---|
| raw greyscale | `PI` **correct** 56 | `PI` **correct** 45 | `PI` **correct** 53 |
| 1-bit Otsu | `P1` 53 | `P/26/3711` 0 | `PH26/1792` 6 |
| 1-bit Otsu, x2 upscale | `PI` 64 | `P1` **84** | `P1` **79** |
| PIL `convert('1')` (dithered) | `PYoereo08` | `''` | `PUTT o?` |

Binarising is **the same mistake in a new coat**: it raises confidence to 79–85 while being WRONG,
against raw at 45–56 being RIGHT. Tesseract/Leptonica ALREADY binarise internally (adaptive Otsu),
so a global pre-threshold only discards the antialiasing grey that carries the `I`/`1` distinction —
and a global threshold is strictly worse than the adaptive one on uneven scan lighting. Dithering is
catastrophic. **Do not add a binarisation prep. The evidence points the other way: LESS processing.**

**CAVEAT THAT KILLS THE ONE-LINE FIX.** "Just use the raw crop" is wrong. On doc 0030 — same
supplier, same page layout, but an EDGE-CUT taught box — raw reads `'| PL/IS/S45)'` and the struct
prep is the only one that gets `PI/25/5445`. So the preps earn their place on degraded/clipped
geometry. The defect is not "the wrong prep is used", it is **"the rungs are ranked by a number that
does not mean the same thing on each of them"**.

**DIRECTIONS, none built — this is the extraction ladder, it serves every field, and it needs the
advisor + Oracle gate before a line is written:**
1. **Add raw/greyscale as a rung.** Cheapest, and it would win here — but only if (2) or (3) also
   lands, because raw would still lose the confidence race on 0022 (raw 45 vs light 73).
2. **Break the cross-prep comparison.** Rank sub-floor rungs by something prep-invariant — agreement
   between rungs, or conformance to the field's own validation shape — rather than by raw
   confidence. On this class the shape is identical for `PI` and `P1`, so AGREEMENT is the stronger
   signal: raw+light agree on `PI` on 3 of 5.
3. **Consult the field's learned history**, which `ocr_corrector` already exists to do — EXCEPT that
   this install's confirmed history is itself full of `P1` values, so it would currently learn the
   wrong direction. Check `getFieldFormats` for this supplier before relying on it.
4. **NOT a whitelist.** The value is mostly digits; excluding digits is not available.

### ADVISOR + ORACLE PASS RUN 2026-08-11 — SIGN OFF WITH CONDITIONS (4 BLOCKING). NOT BUILT.

**Design chosen: gary's RAW WITNESS.** Read the crop once with NO preprocessing. That read is a
WITNESS, never a candidate: it may change the committed string ONLY when it differs from what the
ladder was already returning by exactly ONE confusable-glyph substitution AT THE SAME LENGTH. Scope
`verify_fn is None` (the gateless Stage-0.5 caller) + `val_type in {alphanumeric, reference_code}` +
`crop.width < 300` (at/above that `_light_prep` IS raw, so a witness pass would be a duplicate).
Confusable pairs reuse `ocr_corrector._is_confusion`, never a new table. It cannot change length,
structure, or emptiness, and cannot introduce a value the ladder was not already about to commit —
that bounded blast radius is why it beat the alternatives.

**oscar's `_struct_prep` no-resample floor was REJECTED, and by measurement not preference:** his
threshold fires at an ink band >= 20px and the measured band is 18–19px, so it never fires on the
exhibit; and it leaves CONFIDENCE as the arbiter, which is the bug. On 0022 a perfect native struct
read (~45–55) still loses to light at 73. A fix that keeps `rconf` as the decider cannot heal a
class whose defining property is that the correct read is the LEAST confident one.

**C1 — BLOCKING, AND IT MAKES THE SLICE INERT AS SPECIFIED.** Both ladder exits return the string
AFTER `_repair_single_token` (`anchor.py:3303`). Today, with `CODE_SEPARATOR_STRUCTURE_GUARD` OFF,
that function deletes the printed slashes — pinned at `test_code_separator_structure.py:88`, and the
owner's exhibit committed **`P1266000`**, not `P1/26/6000`. So the comparison the design performs is
raw `PI/26/6000` (10 chars) vs ladder `PI266000` (8) → different length → discarded → **zero
documents healed.** My own write-up above describes the POST-sepguard state, not today's.
**Fix: move the comparison INSIDE the rung loop, onto the `clean_crop_segment` output, BEFORE
`_repair_single_token`.** Consequence to pin: with the adopted `PI/26/6000` the repair's own
agreement test then fails, so the separators survive too — a second lane moving under a flag named
for the first, which must be counted, and which makes the two flags INDEPENDENT rather than ordered.

**C2 — BLOCKING. Two tiers, `_FLAG` before `_ADOPT`** (precedent `UNIVERSAL_VERIFY_RESTORE`/`_FLAG`).
FLAG keeps today's value, attaches `corrected_to` + a note naming the ambiguity, and caps below 88.
ADOPT performs the swap and stays OFF until the census is read. This is the only thing that bounds a
SYMMETRIC rule — it can equally flip a CORRECT winner to a wrong raw read — that has no independent
corroborator: the page text carries the same misread, the learned history is poisoned, and a second
read of the same pixels is the "same-pixel agreement" this repo already measured at 5:1 false:true.

**C3 — BLOCKING. Census both directions and per-pair**, over both corpus arms AND the born-digital
`SINGLE` arm (a spurious fire on crisp crops is the strongest possible refutation). Required before
ADOPT: **zero** cases where the ladder was right and raw was wrong, plus per-pair evidence for every
pair enabled. **Enable only pairs the census evidences** — `_is_confusion` also covers `O/0`, `S/5`,
`Z/2`, `B/8`, `G/6`, `T/7`, case-only and symbol pairs, none of them measured, and `O/0` is a
glyph-DESIGN confusion rather than an antialiasing one, so there is no reason to assume raw wins it.

**C4 — BLOCKING, and it changes what the owner should be told: DO NOT FLIP `CODE_SEPARATOR_
STRUCTURE_GUARD` ALONE.** Verified: `ocr_corrector.value_to_template` keeps `/` as a literal, so once
confirms make 10-char values the majority the scope's template becomes `UD/DD/DDDD`, and
`try_correct` (`LETTER_TO_DIGIT['I']='1'`) rewrites a CORRECT `PI/26/6000` back to `P1/26/6000` at
`min(95,90+20)=95`, method `+corrected`, **no note** (`engine.py:6688-6701`). **Sepguard is the fuse;
operator confirms arm it.** Ruling: flip the two TOGETHER, sepguard AFTER the witness. Pin the bomb;
fixing 2.5b is a separate, higher-blast-radius slice.

**C5 — non-blocking. Amend Gate C**, or the heal ships a FALSE "doesn't appear on this page" note on
the very documents it fixes: on 3 of 5 the full-page OCR carries the same misread, so a corrected
`PI/26/6000` will fail a page-presence test the wrong value passes. Right value, hostile message.

**C6 — non-blocking. Measure `tessdata_best` and the embedded-image native DPI** (both read-only).
Installed model is standard `tessdata` (4.1MB integer LSTM). Licence Apache-2.0, so shipping is
allowed — but **do not ship it as a drop-in**: swapping the model re-bases every confidence constant
in the product (the 60 ladder floor, the 88 auto-file floor, `_TIER_A_OCR_MIN`,
`_PREVIEW_ACCEPT_MIN`, `_CLEAN_DATE_CONF=94`), which is a whole-product recalibration.

**A caveat on the whole measurement base, from Oracle:** the corpus is SYNTHETIC — scanify rasters
at 150 DPI while the app renders at 200, so "raw greyscale" is already resample #1, the prep is #2,
and Tesseract's internal line normaliser is #3. That double resampling is the likely mechanism, and
it strengthens the less-processing direction — but **generalisation to a real 300-DPI scanner is
HYPOTHESIS, not measurement.**

**GATE when it is built:** ref lane **27 ok / 1 wrong → 28 / 0** with witness + sepguard armed
TOGETHER, plus a separate witness-only arm that must ALSO move the lane (that arm is the proof C1
landed). Out-of-scope lanes byte-identical; in-scope lanes zero regressions, each movement explained
— note `keyword._infer_validation` maps `*_no`/`*_ref`/`reference*` to `alphanumeric`, so `po_ref`,
`account_no`, `vat_no` and serials are IN scope by design and "all eight other lanes byte-identical"
is NOT an achievable bar. **Count `validation_note`s per lane, not just values** — a heal that trades
a wrong value for a new note class is not free and the current scorer cannot see it. Measure the
wall-clock delta. Pins must exercise the REAL ladder including `:3303`, not a stub that bypasses it.

**NOT BUILT TONIGHT, deliberately.** With C1–C4 applied this is a two-tier flag, a bidirectional
per-pair census, a Gate C amendment and a pin set that has to drive the real ladder — a substantial
slice. Half-building it unattended, in the extraction path, would breach the owner's "safely, no
regressions". It is fully specified above and ready to build cold.

**WHY IT MATTERS MORE THAN A SINGLE WRONG FIELD:** on three of five live documents the full-page OCR
carries the SAME misread, so Gate C's page-presence check matches and the warning CLEARS — leaving a
wrong reference at confidence 94 with nothing flagging it. Fixing this removes the only real
objection to flipping `CODE_SEPARATOR_STRUCTURE_GUARD`.

**Probes kept:** `stress_test/probe_crop_recipes.py` (per-prep read + confidence on any saved slice,
including the binarisation variants).

**NOT BUILT.**

## 2026-08-10 — `extractions.anchor_label` IS A DEAD COLUMN, AND SWITCHING IT ON IS CUSTOMER-FACING

**Found while building the SFDEV caption feature above; verified at source and in the live data.**

**The fact.** `extractions.anchor_label` (migration 14) is `NULL` on **all 3262 rows of the live
install** — every method, including `anchor_crop` (69 rows) and `template_mapping` (1364). Both
insert sites map it as `anchor_label: data.anchor || null`
(`processing/handler.js`, `applyReprocessResult` + the import path), but `file_done` **PROJECTS a
fixed field set** in `process_docs.py:1067-1087` — `value` / `confidence` / `method` plus four
conditional keys (`validation_note`, `corrected_to`, `suggested_supplier`, `candidates`) — and
`anchor` is not among them. So `data.anchor` has always been `undefined`. The write has never fired.

**Why it is not just dead weight.** `review/renderer.js:2743` renders it to the CUSTOMER as
*"From anchor: &lt;label&gt;"*, gated on `method === 'anchor' || method === 'anchor_crop'`. Feeding
the column would therefore switch on a provenance line that has **never appeared in the product's
life** — a customer-visible change arriving as a side effect. That is why the SFDEV feature above
deliberately routes the caption through the dev TRACE instead, and why the gate is now pinned in
`test_debug_table.js` (it fails if the gate is loosened to admit keyword reads).

**The decision the owner owns, not the fix:**
1. **Feed it and show it** — add `anchor`/`label` to the `file_done` projection; the Review line
   starts rendering for anchor reads. Judge the copy first: *"From anchor: Invoice No"* is jargon by
   the `customer-experience-review` banned-word test, and it appears on ~2% of rows, which reads as
   arbitrary. Probably needs rewording before it is worth switching on.
2. **Feed it and keep it dark** — persist for diagnostics only; the bulk grid then works for the
   WHOLE queue instead of this session's traced documents. Costs a Settings bridge to stay honest
   about the display staying off.
3. **Delete the column and the render** — smallest surface, loses the latent feature.

**Do not do (1) casually.** Check the copy against a real screen first. Related: the same class of
"designed, mapped, never fed" is what `credit_sign_note`'s dead `raw_value` guard is waiting on —
if both get fed in one change, two behaviours move at once and neither is attributable.

---

## 2026-08-08 OVERNIGHT — teach-side run: designed-but-NOT-built slices (advisors eric / gary / reggie)

Context: `HANDOVER_2026-08-08_OVERNIGHT.md`, branch `feat/teach-side-overnight`, commit `4e5c21c`.
Three fixes shipped dark and measured; these are the slices the same designs produced that were NOT
built. Each already carries its design, so none needs re-deriving.

- **`serials` is a CAPABILITY GAP, not a bug — a multi-value field type.** Ground truth for serials
  is a LIST (`['CT-3766614','CT-7446380']`); one drawn box cannot capture a variable-length list and
  the whole `template_fields`/`fixed_value` model is single-valued. Scored 0% and will stay 0% until
  there is a repeat-region read + a multi-value field type + a scoring convention. Do NOT fold this
  into a freeze or geometry slice — it rides alone. (eric.)

- **Teach-time TYPE DIVERGENCE caution (gary slice 2).** The taught document already carries the
  pipeline's own answer in `documents.document_type_id`, and the wizard never compares its type
  choice to it (`src/windows/teach/renderer.js:202-233`, `doCommit :1244-1288`). Pre-select the
  detected type's card; if the operator picks another, warn once — *"This document was recognised as
  a Sales Order. If you teach it as an Order Confirmation, documents like it will keep being
  recognised as Sales Orders and this layout may not be used again."* **Warn, never block.** Extract
  the predicate into a loadable module so it is unit-testable rather than living in the renderer.

- **"Taught but never used" DETECTOR (gary slice 3).** The night's worst finding was silent: two
  teaches completed and were never applied, with no signal anywhere. Tier A = the divergence check
  above, re-evaluated at commit into the existing `#done-warn` slot. Tier B = a pure DB predicate —
  a template with >=1 `template_field_mappings` row whose `confirmed_count` has not grown while >=3
  documents since its creation carry a logo inside its hash band yet `template_id IS NULL`. Surface
  as a per-template badge in Settings -> Templates, plus one line on the import-results view. NOT a
  modal and NOT a per-document customer notice (`feedback_minimal_interaction_autofile`).
  **Check first:** `engine.py:7221-7233` already writes *"Couldn't match this document to the
  supplier's saved <Type> layout"*. If that note is on all 35 orphaned docs, the deliverable is
  AGGREGATION and PLACEMENT, not new copy.

- **`templates.retargetType(db, templateId, newSlug)` (gary slice 4).** A template's type binding is
  immutable (`templates.js:1069` takes no slug), so a mis-bound teach strands its mappings,
  landmarks and logo set permanently — re-teaching is the only recovery. Admin, audited, reversible,
  link-only. **Precondition that must be enforced:** every mapped `field_key` must exist on the
  target type or the mappings become silently unread orphans — refuse and name the offending keys.
  Manual and consented ONLY; an automatic retarget is the type gate's inverse and lets a wrong-type
  sibling capture a template.

- **Issuer confirmation on the teach summary step.** `'Neltrix Automotive Parts'` — the issuer was
  learned from an OCR misread at teach time and is now both the stored identity and the
  learning-scope key (`field_anchors.supplier_name`, `supplier_hints.supplier_name`, the filing
  folder), and `reuseByEstablishedName` matches EXACTLY, so a later correct confirm mints a SECOND
  template rather than reusing. At teach time the system is structurally defenceless — the
  dominant-value snap needs a >=5-count confirmed literal and there is exactly one confirm — so the
  only correct layer is the operator. The issuer row must be explicitly confirmed/editable, not one
  12px grey row among ten (`teach/renderer.js:1228-1243`). One keystroke buys back an unrecoverable
  scope. **Ship this WITH any fix that makes a taught template reach more documents** — otherwise a
  bad teach applies its wrong scope to more siblings, not fewer.

- **`SEED_TYPE_TIGHTENS_VALIDATION` (reggie D1-B, Oracle B5 already ruled the shape).** `vat_no` and
  `account_no` have no shipped pattern, so both are seeded `alphanumeric` via `_infer_validation`
  BEFORE the DB type is consulted — which is why `VXS79871` commits into a VAT field at 85 while the
  Review window's on-blur check (which DOES use the DB type) warns on the same value. The DB type
  may override the seeded `validation` **when strictly tighter**, with captions, directions and
  `role_caption` untouched. Needed for the cases where the theft is a DIFFERENT wrong value rather
  than a duplicate — the exclusivity pass shipped tonight cannot see those.

- **`REF_CAPTION_ROLE_STOP` (reggie D1-C).** `_ref_caption_party_conflict` blocks PARTY words
  (`customer/your/supplier/...`) before a bare `Ref`, but not document-ROLE qualifiers, so
  `Order Ref` still feeds a generic-caption steal at the occurrence. Add
  `{order, invoice, delivery, despatch, job, quote, credit, contract, docket, consignment}`.
  Only if the shipped exclusivity pass leaves residual steals.

- **`TEMPLATE_FREEZE_ISSUER_ONLY` — shipped OFF, flip REFUTED, revisit only with a measurement.**
  See the handover: unfreezing moved `po_ref` 35->50% but `vat_no` 51->16%. If it is ever revisited,
  the honest variant is eric's evidence-gated one — freeze only what >=N distinct confirmed
  documents agree is constant — which needs `_fieldsWithMultipleConfirmedValues`
  (`review/handler.js:1314`) re-scoped from doc-TYPE to (supplier, type) first, plus a self-vote
  exclusion (`extraction_method='template_fixed'`) or it can never disarm. Both capped/noted-stamp
  variants were considered and are DOMINATED — a note makes the doc ineligible for auto-file
  anyway (`trust.js:678`), and a sub-88 cap does not block auto-file for non-role keys, so it
  creates a NEW silent-wrong path.

---
## 2026-08-08 — OWNER-REPORTED (mid teach-run): a taught document has no field for something the TYPE defines — "Not needed on this doc"

**Symptom, in the owner's words.** Teaching a *tax invoice* as an Invoice: the type carries a
`serials` field, but that document does not print serial numbers anywhere. The wizard walks every
field of the type and offers no way to say "this one isn't on this document", so the operator is
pushed toward pointing the box at something wrong just to move on. (Caught live during the
2026-08-08 teach run; the owner's instinct was to use the PO number, which would have written a
mapping asserting serials live at the PO number's position — a wrong learning row on 20 test docs.)

**The mechanism already exists — the wizard just doesn't expose it.**
- `template_hidden_fields` (mig 54) + `templates.getHiddenFields`/`setHiddenFields`
  (`database/modules/templates.js:374-438`). Its own comment: *"A DISPLAY/EXPECTATION mask: hide a
  field the TYPE has but THIS supplier's layout lacks, so Review [stops expecting it]"*. The
  Template Manager already renders a per-field hide toggle **including fields with no drawn
  mapping** — the comment at `:417` says that is the whole point.
- Hidden fields also drop out of the document score
  (`template_matcher.hidden_fields_for_scope`, referenced at `templates.js:56`), so hiding is not
  merely cosmetic — it stops an absent field dragging confidence and blocking auto-file.
- HIDE-ONLY, never structural: memory `project_template_field_hiding` records that structural roles
  (issuer / date / reference) must stay unhideable. Any wizard tick must honour that — the three
  structural rows are shown locked in the manager and must be locked here too.

**Today's workaround (correct, already shipped): "Skip for now"** — `rg-skip`
(`src/windows/teach/renderer.js:997`) records `status:'skip'` and writes NO mapping. That is the
right thing to press. What it does NOT do is tell the SYSTEM the field is absent, so the field still
shows empty in Review and still counts against the document.

**Fix direction (not built).** A tick beside each field in the wizard's field step — wording along
the lines of *"This isn't on this document"* / *"Not printed on this document"* (owner to choose;
avoid "not needed", which reads as "I don't want this field" rather than "this layout lacks it") —
collected in `state.results[key].status = 'absent'` and written on commit through the EXISTING
`setHiddenFields` call, in the same deferred commit sequence as the mappings (promote-to-template →
save-mapping per field → hide absent fields → confirm-review). Structural fields must refuse the
tick. Reuse the manager's copy so the two surfaces describe the same thing.

**Gates.** Unit: structural field cannot be marked absent; an absent field writes a
`template_hidden_fields` row and NO mapping; Back/Cancel writes neither (the commit stays deferred).
Behavioural: a taught type with one absent field still auto-files (the absent field must not drag
the score) — that is the claim worth pinning, since it is the reason to do this rather than leave
people on Skip.

---
## 2026-08-08 — OWNER-REPORTED, DIAGNOSED: Pelican `customer_name` is wrong on 66 of 72 — the clip-repair family EXCLUDES names and the name healer is OFF

Owner ran the SFDEV debug table over the live queue and marked the bad cells
(`Debug/debug_table/debug_values.json`, 2026-08-08T17:08Z, 72 docs). Their read was "possibly a
wider detection issue with freetext fields". **That instinct is right about the layer and wrong
about the instrument — and the difference matters, because the obvious fix would have healed 1 of
66.** Everything below is measured, not inferred.

**WHAT WAS MARKED:** 69 cells, all Pelican Office Interiors delivery notes — `customer_name` 66,
`delivery_number` 3. Every `customer_name` cell came from `template_mapping`.

**TWO CLASSES, ONE MIS-SIZED BOX.** Template 33, taught 2026-08-07 21:10, `confirmed_count=1`, and
there are **NO `corrections` rows for this scope**, so nothing has ever taught it otherwise:
- **TRUNCATION (~49+9+ variants):** `'Bramblewood Joinery Lt'` ×49, `'…Joinery L'` ×9,
  `'…Joinery Ltc'` ×2, `'Dramblewood Joinery L'` ×2. Correct is `Bramblewood Joinery Ltd`. The
  taught target is `tw=0.1627` and ends flush with the final glyph — **zero right-hand margin**, so
  any per-scan drift shears the `d`. The SAME box reads correctly on 24 docs at conf 95, which is
  the proof it is marginal rather than simply wrong.
- **WRONG ROW (~12):** `'Unit 4, Sawpit Lane'` ×10 + 2 variants — the address line BELOW the name.
  The target is `th=0.0151` against an anchor of `ah=0.0068`, i.e. **~2.2 line-heights tall**, so it
  spans the name row and the address row; `clean_crop_segment` returns the FIRST line, and when
  registration shifts the box down a row the first line becomes the address.

**WHY NOTHING CAUGHT IT — the reusable finding.** The live settings have
`template_target_word_snap=true` AND `template_abs_edge_guard=true`, and the template was taught
AFTER both shipped. They did not help because **both deliberately EXCLUDE names**:
`template_mapper.py:308-309` — *"Scope = codes + dates (`_SNAP_VAL_TYPES`); NAMES excluded v1
(NAME_UNCLIP_RECONCILE owns that class — two dark healers racing one class breeds M=1s)"*. So every
shipped mechanism that repairs a clipped taught box is scoped away from names, and the one that owns
names, `NAME_UNCLIP_RECONCILE`, is **DEFAULT OFF and has never been flipped.** The clipped value
therefore commits at **95** — above the 88 critical floor — and beats the CORRECT `keyword_override`
read of `Bramblewood Joinery Ltd` sitting right there at **83**.

**THE OBVIOUS FIX IS THE WRONG ONE — MEASURED BEFORE PROPOSING IT.** `customer_name` is free-text
with a truthy `val_type='text'`, so `TEMPLATE_FREETEXT_GUARD_PARITY` (dark) is the slice that makes
the name-quality guard reachable here. But the guard rejects only `name_quality < 0.5`, and these
values score: `'Bramblewood Joinery Lt'` **0.67**, `'…Joinery L'` **0.67**, `'…Joinery Ltc'`
**0.67**, `'Unit 4, Sawpit Lane'` **0.75** — all PASS. Only `'Srambdlewood Joinery L'` (0.33) is
rejected. **Guard parity would heal 1 of the 66.** The values are name-SHAPED; they are merely
clipped, and a quality guard cannot see that. Do not flip it expecting this class to move.

**THE MATCHING MECHANISM, and the match is close to verbatim.** `NAME_UNCLIP_RECONCILE`
(`engine.py:301-312`, reggie design → **Oracle SIGN-OFF-WITH-CONDITIONS 2026-08-04**, five
conditions C0–C5, built, pinned, default OFF) is described as: *"a Stage-0.5 mapping whose drawn box
CUTS a name mid-token ('Kingfisher Print Stuc' — the sliced 'd' misreads as 'c') commits @90 and
silently beats two agreeing independent fuller reads."* This corpus contains
**`'Bramblewood Joinery Ltc'` — the sliced `d` misread as `c`**, the exact stated fingerprint.
Condition check on what is knowable without a run: **C3** (winner remnant page-ABSENT) holds — the
page prints `Ltd`, never `Lt`; **C5** (name-quality no worse) holds — 1.0 vs 0.67. **C1 (two
token-identical fuller witnesses, keyword AND crop) is the one that needs a traced run to confirm**;
`keyword_override` demonstrably produces the full value, the crop witness is unverified.

**ARM RUN 2026-08-08 (`stress_test/name_unclip_ab.js`, 110 docs × 2 arms): COMPLETELY FLAT —
HEALED 0 · REGRESSED 0 · collateral 0. A TRUE NEGATIVE, and `NAME_UNCLIP_RECONCILE` MUST NOT BE
FLIPPED FOR THIS CLASS.** Chased to source; three independent declines in
`_reconcile_name_truncation` (`engine.py:3850-3939`), so it is structurally inert here rather than
misconfigured:
1. **C2 floor** (`:3908`, `len(wl) < 4`) — the winner's final token is `'lt'`/`'l'`, **2 chars
   against a floor of 4**. The design's example remnant `'Stuc'` is exactly 4; `Ltd`→`Lt` is under it.
2. **C3 is blind to the cut token.** `_uv_text_page_present` (`:1573-1588`) SKIPS tokens with an
   alnum core <4 — its docstring's example of a skipped token is literally **`'Ltd'`**. So even with
   C2 widened it would test only `Bramblewood`/`Joinery`, find them on the page, and decline the
   remnant as a "genuine shorter name". The load-bearing guard false-positives on this exact shape.
3. **C1 is unsatisfiable for this scope.** It needs witnesses from BOTH the `keyword` AND `crop`
   families (mapping excluded). **`field_anchors` for Pelican = NO ROWS** — the teach made a
   Stage-0.5 mapping, never a Stage-2 anchor — so a crop witness cannot exist.

**THE REUSABLE GAP THIS EXPOSED, which is worth more than the arm.** `supplier_hints` already holds
`customer_name = 'Bramblewood Joinery Ltd'` for this scope at **`usage_count=10`**, and
`keyword_override` reads it independently 6 times — yet the clipped taught read beats both at 95.
`_crosscheck_witness_bucket` (`:1341`) buckets `hint*` as its OWN family, which C1's
`{keyword, crop}` requirement excludes. **The system knows the right answer in two independent
places and has no mechanism by which either can correct a clipped Stage-0.5 NAME read.** Any next
design should start there, NOT at widening C2's floor — widening C2 alone still dies on C1.

**IMMEDIATE OPERATOR REMEDY, independent of any code:** re-teach `customer_name` on template 33 with
a slightly WIDER and SHORTER box. That is an operator action and is system-wide by design.

> **CORRECTION TO MY OWN 2026-08-08 MEASUREMENT, and it is load-bearing.** I recorded the free-text
> template-rung population as *"~1 read in 24 docs"* and called the guard-parity slice NEAR-INERT on
> reachability grounds. **The reachability half is now badly wrong:** this batch is
> `customer_name|template_mapping` **93 of 99** on documents 738+, and 67 of the 72 in the debug
> table. The 24-doc probe drew from the OLD confirmed corpus, which did not contain this template's
> population. The *conclusion* "near-inert" survives, but for a COMPLETELY DIFFERENT REASON —
> not because the guards are unreachable (they are very reachable now) but because the values are
> name-shaped and score above the guard's threshold. Anyone re-reading the earlier entry should take
> the yield figure, not the reachability figure.

---

## 2026-08-08 — ANSWERED (2026-08-08 later): template LANDMARKS are page-0-only while MAPPINGS can now be page 2+

Surfaced by the teach multi-page smoke run (feature verified working — `5ad0220`, page_number 1
written and confirmed against the DB).

> **ANSWERED AT SOURCE — the teach+reprocess probe below was NOT needed; the code and the live DB
> settle it. Read this box before re-investigating.**
>
> **Q1 — does landmark capture read every page? NO, and it is hardcoded in BOTH derivation paths.**
> `templates/handler.js:82` (`captureSampleWords`) and `:157` (`generateLandmarks`) each spawn
> `landmarks.py` with a literal `'--page', '0'`; `tryCrossSampleLandmarks` (`:115`) never passes a
> page at all and `select_cross_sample`'s signature defaults `page_number=0`. **Worse, and this is
> the load-bearing new fact: `template_sample_words` (migration 34, `database/index.js:735-746`) has
> NO page column**, so the cross-sample corpus is page-blind BY SCHEMA — per-page cross-sample
> landmarks need a MIGRATION, not just an argument change. So a page-2 mapping can never acquire
> landmarks: its registration is dead by CONSTRUCTION, not by starvation.
>
> **Q3 — confirmed.** The `:242-253` backfill is `NOT EXISTS (… WHERE l.template_id = t.id)`, per
> TEMPLATE. A template with page-0 landmarks looks done however many pages it maps.
>
> **SEVERITY IS LOWER THAN THIS ENTRY ORIGINALLY IMPLIED — degradation, never corruption, and today
> zero.** Three separate checks:
> 1. **Page-2 mappings ARE read in production.** `page_images` from `extract_text_and_images` is the
>    FULL page list (bounded only by the 300-page OCR cap), `crop_pages` is parallel to it
>    (`engine.py:4707`) and `extract_with_mappings` indexes `page_images[page_idx]`. The `page_idx >=
>    len(page_images)` skip only ever bit the single-page PREVIEW caller — which is exactly what
>    `TEMPLATE_PREVIEW_PAGE_PAD` (`6c85157`) already fixed. Nothing is silently dropped.
> 2. **Page-0 landmarks can NEVER be mis-applied to page 2.** `lm_by_page` buckets by page and the
>    lookup is `page_transform.get(page_idx)` (`template_mapper.py:609-618, 628`), so a landmark-less
>    page gets `None` and the mapping falls through to the anchor/absolute rungs — the documented
>    "never worse than today" path, not a blind transformed crop.
> 3. **Live blast radius is ZERO.** Read-only census of `%APPDATA%\ScanFinder\docusnap.db`: all 38
>    field mappings are `page_number = 0`; all 96 landmark rows are `page_number = 0` (30 `auto`,
>    66 `cross_sample`); the query "template with a mapping on a page carrying no landmark" returns
>    NO ROWS; and 0 documents have `page_count > 1`.
>
> **Bonus — the corrected starvation claim reproduced independently from the live DB:** 15 of 33
> templates are under `MIN_VERIFIABLE_INLIERS = 3` (6 with zero landmarks, 7 with one, 2 with two),
> and **exactly ONE of them has any field mappings** — template 30, 2 landmarks, 3 mappings, the only
> one paying anything today. This matches 007's refutation in `HANDOVER_2026-08-08_DAY.md` exactly.
>
> **What remains open is therefore a FEATURE, not a defect:** per-page landmark derivation, so that
> multi-page teaching gets drift correction on the pages it taught. Fix shape, smallest-correct:
> derive landmarks for each page that CARRIES A MAPPING (not every page — cost is one OCR spawn per
> page), make the backfill existence-aware per (template, page), and add `page_number` to
> `template_sample_words` before making the cross-sample path page-aware. **It is a NO-OP on this
> corpus by construction** (only page 0 has mappings), which is a gate strength and a gate weakness:
> byte-identical is provable, but the new behaviour can only be exercised against a BUILT multi-page
> fixture. Honour 007 item F / Oracle's standing rule — turning registration ON where it is currently
> off is the documented Castellan mechanism — so **flag-gated and measured, or not at all.**

Observed in the sandbox: template 1 finished with field mappings on `page_number = 1` while ALL of
its `template_landmarks` rows sat at `page_number = 0` ("Northgate", "Description", "Terrace",
"invoice", "you"). Stage 0.5's registration transform buckets landmarks per page
(`template_mapper.py:566-572`) and fits per page, so a page-2 mapping whose page carries NO landmarks
gets no transform — it falls back to the anchor/absolute rungs with no drift correction, exactly the
position the 15 landmark-starved templates are in (see the audit entry below).

NOT PROVEN to misread anything — no page-2 mapping has ever been reprocessed. The questions that
were open (all three now settled in the box above):
1. Does `captureSampleWords`/`select_cross_sample` gather words from EVERY page, or only page 0?
   **ANSWERED: page 0 only, hardcoded in both paths, and the corpus table has no page column.**
2. Should the teach commit trigger landmark derivation for each page it taught a field on?
   **STILL OPEN — this is the remaining feature, and the only part still needing a decision.**
3. `templates/handler.js:242-253`'s backfill is existence-aware per TEMPLATE, not per page.
   **ANSWERED: confirmed, per template.**

**Also from the same run, fixed immediately:** an unconfirmed read-back survived a page switch, so
the panel offered "Value: Northgate Textiles — Looks right →" while the operator was looking at the
Larkspur page. Stored rows were always correct (the box's own page), so it was a trust defect rather
than corruption. Fixed + pinned in the same commit as this entry.

**Also observed, fixture artefact not a bug:** the template was named for the page-2 supplier but
fingerprinted on the page-1 letterhead, so genuine page-1-supplier documents were stamped with the
page-2 supplier's name. Only reachable because the test fixture deliberately staples two different
companies' invoices together; no real document does this. Worth knowing that template IDENTITY and
field GEOMETRY can be sourced from different pages.

---

## 2026-08-08 — desktop security review (owner-supplied checklist) → SEC-17..SEC-22

Owner asked for an audit of a general Electron/Python hardening checklist against this app. The
detail lives in `SECURITY_BACKLOG.md` as **SEC-17 … SEC-22** (that file owns security items; this is
the pointer so the backlog reader finds them). Two were fixed in the same session, four are open.
**Note: `SECURITY_BACKLOG.md` is GITIGNORED and stays on the owner's machine only** — findings are
deliberately not published to the repo history, so this pointer is the only tracked record that
SEC-17..SEC-22 exist. Keep the two in step by hand.

**FIXED — SEC-17 (MEDIUM):** path containment was defeated by a Windows junction/symlink inside an
approved root. `path.resolve` collapses `..` but does not follow a reparse point, and `realpath`
appeared NOWHERE in `src/`. Now canonicalises both sides. **Only the OPEN path is fixed** — the
filing WRITE containment (`filing/handler.js:172`) and `navGuard.js:20` still compare textually and
each needs its own change with its own gate.

**FIXED — SEC-18 (LOW):** `nodeIntegration`/`sandbox` are now stated rather than inherited from
Electron defaults. Zero behaviour change; the point is that a future `webPreferences` edit cannot
silently flip them.

**OPEN — SEC-19 (LOW):** no IPC sender validation on any of 313 channels. Wants ONE shared
`assertSender` helper applied to the destructive handlers first, and an Oracle pass — a wrong
predicate would break every legitimate child window. Severity held down by the existing navigation
lockdown. **OPEN — SEC-20 (LOW):** no dependency CVE scanning (the licence gate is not a vuln gate).
**OPEN — SEC-21 (LOW, owner decision):** Python worker runs with the full user account.
**OPEN — SEC-22 (MEDIUM, owner decision — cost):** installer and binaries unsigned.

**Assessed and found ALREADY COVERED**, recorded so nobody re-opens them: `spawn` with a fixed
executable and an argument array everywhere (no `exec` of user input, `shell` false), scheme-
allowlisted `openExternal`, no `pickle`/`eval`/`yaml.load` and no HTTP server on the Python side at
all, comprehensive OCR DoS caps (300 pages / 500 MB / 10 000 px per axis / 300 s per-file watchdog
wired to a Settings control), no auto-updater to hijack, no archive extraction, no shipped
`openDevTools`. **Correction on the record:** the first pass of this review reported the OCR
resource limits as a probable gap. That was wrong — they exist and are thorough. Verified at source
before the write-up, which is the only reason it was caught.

---

## 2026-08-08 — teach/template anchor+value coverage audit: SIX defects VERIFIED AT SOURCE, none built yet

Owner goal for the day: "finish the teach wizard and template manager anchor and value detection;
verify all data types work, not a small subset; custom fields must detect the same as built-in;
keywords working 100%." A six-area code survey plus read-only live-DB censuses produced the below.
Each line was re-verified by reading the source — none is taken from a summary. **LIVE** = it is
biting the owner's current data; **LATENT** = the mechanism is real but nothing on this install
triggers it yet (still worth fixing, since the owner's ask is forward-looking).

**1. MOSTLY INERT — landmark starvation, 15 of 33 templates.** (Downgraded 2026-08-08 after 007
refuted the stated root cause: **13 of the 15 starved templates carry ZERO field mappings**, so
`_excludeBoxesFor` returned an empty list and the exclusion mechanism never ran on them. The real
causes are `sample_document_id IS NULL` plus fewer than 3 cross-sample docs for the zero-landmark
six, and the recurrence/stability/uniqueness stack collapsing for the one-landmark seven — which
have 6-13 documents of words already banked. SEPARATELY: `registration.MIN_VERIFIABLE_INLIERS = 3`
means a template with 1-2 landmarks has PERMANENTLY DEAD registration, not degraded — 9 templates /
202 docs dead, 6 templates / 121 docs never fitted. BUT landmarks feed ONLY Stage-0.5 mapping
relocation (verified: every consumer), so a template with no mappings pays nothing. Exactly ONE
template is actually paying today: **tpl 30, Larkspur Interiors PO — 3 mappings, 2 landmarks, 12
confirmed docs.** The backfill at `templates/handler.js:242-253` is existence-aware
(`NOT EXISTS ... template_landmarks`), so the seven 1-landmark templates are never revisited; making
it COUNT-aware would re-derive them from data already in the DB. **DO NOT ship that casually** —
turning a dead transform live can MOVE taught boxes, which is the documented Castellan mechanism
that overwrote a correct supplier read on 15 of 22 docs. Flag-gated and measured, or not at all.)
Census: landmark-count → templates =
`{0:6, 1:7, 2:2, 3:2, 4:1, 5:15}`. Six templates have ZERO (Copperfield ×2, Ironbridge, Vellum &
Crane, Thornbury, Stonegate) and therefore no registration fallback at all
(`registration_enabled=bool(template_landmarks)`). Root: `templates/handler.js:58-67`
`_excludeBoxesFor` pushes BOTH `target_*` AND `anchor_*` boxes into `exclude_boxes`, and
`ocr/landmarks.py:65-91` rejects any word overlapping one. The anchor box is the taught LABEL
CAPTION — printed chrome that recurs at a stable position, i.e. the ideal landmark. The docstring
conflates the two. `select_cross_sample` (`landmarks.py:123-137`) ALREADY excludes per-document
values independently (recurs in ≥60% of docs AND centroid stable within `pos_tol=0.015`), so the
geometric anchor exclusion looks redundant against values while being fatal to captions.
**NAMED SEAM, still unanswered:** fitting the transform on the same label the anchor path relocates
off CORRELATES the two rungs — registration stops being independent evidence. Candidate mitigation
(not yet judged): an "independence floor" requiring ≥1 landmark that is no mapping's taught anchor.

**2. LIVE — the bare-label guard is DEAD at Stage 0.5.** `anchor._crop_is_credible` takes a `label`
parameter that arms `_is_bare_label` at ~16 Stage-2 sites; both Stage-0.5 call sites
(`template_mapper.py:802`, `:806`) pass THREE arguments, so `label` is never supplied. Combined with
the absolute rung running `shape_mode='ignore'` and `validation_patterns.alphanumeric` scoring
coverage 1.0 on a plain word, a taught box landing on a CAPTION commits it at confidence 90 with
nothing able to object. This is the deeper root of the delivery-note class the 2026-08-07 arc chased
(`TEMPLATE_INLINE_ROW_OVERLAP` fixed WHICH ROW is read; this is why a caption is ACCEPTED at all).

**3. LIVE — 11 of 38 mappings carry a PHANTOM anchor** (`anchor_text` NULL, census). The teach
wizard, when `autoLabel` finds no label, still stores the mapping with a synthetic 0.12-page-wide
strip left of the value (`teach/renderer.js:998-1003`); downstream `_locate_anchor(needle=None)`
accepts the nearest line and base confidence drops 90 → 78. Root of the miss: teach's `autoLabel`
(`teach/renderer.js:902-997`) tries a LEFT band then an ABOVE band and RETURNS ON FIRST NON-EMPTY —
no scored contest — while the Review ⊕ tool uses the scored `pickLabelCandidate`
(`shared/anchorLabel.js:321-341`). Two different pickers; teach has the weaker one.

**4. NOT A BUG — a CAPABILITY GAP. The teach wizard is page-1-only.** (Corrected 2026-08-08 after
gary refuted the first draft of this entry, which claimed the hardcode caused a wrong-page read.)
`teach/renderer.js:409` resolves `getDocumentPages(...).then(pages => pages[0])` — there is no page
navigation, so the `page_number: 0` hardcode at `:1092` is TRUTHFUL, not corruption. You cannot teach
a page-2 value at all. The work item is therefore a FEATURE: render all pages, add navigation, and
replace the hardcode IN THE SAME COMMIT as the navigation — replacing it alone is a no-op at best.
It must land AFTER item 5, or an operator who teaches on page 2 cannot verify the mapping in either
admin surface and will "repair" a correct mapping by redrawing it.

**5. LIVE for two admin surfaces — "Show where it reads" is silently dead on page 2+.** (Upgraded
from LATENT: the Review wizard `review/renderer.js:7122` and the Settings Template Manager
`settings/renderer.js:3301/3506/3577` ALREADY SAVE `page_number: currentPage`/`tplCurrentPage`, so
both can create page-2+ mappings that extract CORRECTLY in production and cannot be previewed at
all. The teach wizard cannot — see item 4.) `template_mapper.py:530` does
`page_idx = mapping.page_number or 0; if page_idx >= len(page_images): continue`, while
`resolve_geometry` (`:592-630`) passes a ONE-element page list. Both callers already send exactly
the mapping's own page image (`settings/renderer.js` filters to `tplCurrentPage`;
`review/renderer.js` sets `page_number: currentPage`), so any page-2+ mapping is skipped and the
operator is told "Anchor not located / nothing read on this page" about a good mapping.

**6b. LIVE — the free-text guards are armed on the WRONG predicate, and one is fully dead.**
(Added 2026-08-08 from gary's review; my first mechanism was refuted — the truthy `val_type` does
NOT come from `_TYPE2VAL`, which deliberately omits text/multiline_text. It comes from the SHIPPED
config: `keyword_patterns.json` carries `"validation":"text"` on `supplier_name`:205,
`customer_name`:246, `payment_terms`:405, `buyer_name`:549 and `"multiline_text"` on
`supplier_address`:631, `customer_address`:646. Those SIX shipped keys are the whole affected set.)
`template_mapper.py:814/:820/:834` arm the OCR-debris guard, the name-quality guard and a conf floor
with `if not val_type`, while the sibling cap at `:878` correctly uses
`val_type in (None,'text','multiline_text')`. So those six BUILT-IN keys skip all three, while every
CUSTOM text field (`val_type` None) gets all three — the inversion, and it is the opposite way round
from what I first reported. **`val_type='text'` is the least-guarded state in the system** — weaker
than None, since `validation_patterns` has no `text` key either. Headline: `is_name_like_field` fires
on exactly `supplier_name`/`customer_name`/`buyer_name`/`*_address`, so **the name-quality guard is
dead for its entire intended population at Stage 0.5** while Stage 2 applies it to the same keys.

**6b-MEASURED (2026-08-08, after the fix was built) — the free-text guard population is TINY, so
the fix is correct in principle and near-inert in practice on this corpus. Do not oversell it.**
Built as `TEMPLATE_FREETEXT_GUARD_PARITY` + `TEMPLATE_FREETEXT_FALLTHROUGH_CAP` (`1f8ff9c`, both
dark). realdoc 714 docs, three arms — dark, parity, parity+cap — came back **BYTE-IDENTICAL to each
other**. A flat lane is not a pass here, so the flatness was chased to source with a reachability
probe over 24 documents drawn from the 11 templates that carry free-text mappings:

  supplier_name|hint_text_match  17     customer_name|anchor_crop      3
  supplier_name|logo              7     customer_name|template_mapping 1

**15 of 38 mappings are on a free-text key (11 supplier_name, 4 customer_name) — and `supplier_name`
was NOT ONCE read by a template rung.** Logo identification and hint-text matching outrank Stage 0.5
for the issuer, so the taught mapping almost never supplies the value. Exactly ONE template-rung
free-text read occurred in 24 documents. The guards are therefore REACHABLE but the population they
police is ~1 read in 24 docs, which is why every arm is flat.

> **CORRECTION 2026-08-08 (my own claim, from a DB-WIDE census — the 24-doc probe above was too
> small a sample to carry the bolded absolute).** "`supplier_name` was NOT ONCE read by a template
> rung" is true of those 24 documents and FALSE across the install. Full `extractions` census:
> `supplier_name` = hint_text_match 447, logo 128, template_fixed 113, **template_mapping 15**,
> template_identity_corroborated 9, template_identity 5, manual 4, +7 minor; `customer_name` =
> anchor_crop 98, anchor_crop_relocated 93, **template_mapping 22**, keyword 14, keyword_override 4,
> manual 1. So the free-text guard population is **37 template-rung reads DB-wide**, not ~1 in 24 —
> still small against the 688 non-template supplier reads, and the byte-identical realdoc arms still
> stand, but the ordering of magnitude is "small", not "zero". **Do not quote the absolute.** The
> conclusion is unchanged: correct in principle, low yield here, do not present as a heal.

> **NEW CENSUS FACT, and it re-scopes audit item 3.** The 11 PHANTOM-anchor mappings are **100%
> `supplier_name`** — every one of the other 27 mappings across 12 field keys carries a real
> `anchor_text`. So the "teach stores a synthetic strip when `autoLabel` finds nothing" defect has,
> on this corpus, bitten exactly the one field that template rungs almost never win (15 of ~731
> supplier reads). Item 3 is therefore a FORWARD correctness fix — teach's `autoLabel` really is the
> weaker of the two label pickers and should be unified with the scored `pickLabelCandidate` — but
> it is NOT the live drag the "LIVE" tag implies, and it must not be sold as one.

TWO CONSEQUENCES, both corrections to what was believed when the slice was designed:
- The fall-through cap's blast radius is FAR smaller than feared. The worry (mine, and Oracle's C-condition)
  was that capping `_inline()` would flag the issuer on the 11 dx=dy=0 supplier_name templates. It
  cannot: those mappings do not win the field. The two-flag split was still the right call — it is
  what made the effect measurable separately — but the danger it was hedging is not there.
- The guard-parity BENEFIT is correspondingly small on this corpus. The inversion is real, the dead
  name-quality guard is real, and both are worth fixing for correctness and for the owner's
  custom-vs-built-in requirement. But it will not visibly change results here, and nobody should
  present it as a heal. Its value is forward: a template whose taught box IS the winning source for
  a free-text field.

**6. LATENT — most data types have no Stage-1 reader, and picking the RIGHT type makes it worse.**
`keyword.extract_fields` (`:942-945`) skips a field with no `field_patterns` entry;
`seed_field_labels` (`:~338-364`) seeds only role `date`/`alphanumeric`, or role None AND DB type
EXACTLY `'text'`. The currency role is refused outright ("currency deferred"). So a custom field
typed Currency/Number/Email/Percentage/Postcode/IBAN gets no Stage-1 attempt, while the same field
left as Text would be read. Census: live field types are text 13, date 6, reference 1, currency 1
across 6 types (3 user-made); the single affected field is `total_amount`, a SHIPPED key, so the
hole is latent — **do not sell this as an active incident.** Related: four divergent "is this a
reference field" predicates (`engine.py:1237-1243`, `keyword.py:58-66`, `validator.py:~299`,
`review/renderer.js:46-49`) and the fact that the type's DECLARED `ref_field_key`/`date_field_key`
role never reaches Stage 0.5 at all — only the key SPELLING does.

> **DESIGNED 2026-08-08 (gary), and it CORRECTS TWO OF MY CLAIMS ABOVE. Not built — reggie's
> precision ruling and an Oracle pass are still outstanding.**
>
> **CORRECTION 1 — my worked example was wrong, and it was wrong in the flattering direction.** I
> said a field labelled "Discount" typed Percentage gets no reader. `discount` is a SHIPPED
> `field_patterns` key (`config/keyword_patterns.json:355`), so it dies at `keyword.py:340-341`
> (`key in shipped`) long before the type test and is rescued. Same for `currency`, `shipping`,
> `subtotal`, `payment_terms`. The genuinely unattemptable examples are **"Unit Price" → key
> `unit_price`, type `currency`** and **"Account" → key `account`, type `reference`** — both have
> `_infer_validation` = None and a non-`text` type. Use those; the "Discount" example would have
> been refuted the moment anyone tested it.
>
> **CORRECTION 2 — this is NOT as latent as I filed it, because the editor STEERS users into the
> hole.** `doctype-editor.js:77-79` `guessType` auto-selects `currency` for any label matching
> `/total|amount|price|cost|sum|net|gross|vat|tax/` and `reference` for
> `/ref|reference|number|no|invoice|order|po|account/`. So a user typing "Unit Price" or "Account"
> is GIVEN the broken type by default, without ever opening the dropdown. It is latent on this
> install because few custom money/code fields exist, not because the types are rarely chosen.
>
> **Also established:** `merge_label_overrides` (`keyword.py:273-281`) already seeds ANY key
> regardless of DB type — so the ADMIN-OVERRIDE path already does what the DB-label path refuses to,
> which is the real inconsistency. `PRESET_CATALOG` fields ARE rescued (their `labels:[]` flow
> through the same override path), so the hole touches only types made in the **DocType editor** and
> the **teach wizard**. `ROLE_KEY_ALIASES` rescues exact money aliases (`net_amount`, `amount_due`)
> but not `unit_price`/`handling_charge`/`discount_amount`.
>
> **FIX SHAPE:** extend only the fall-through branch (leave the date/alphanumeric role branches
> first and untouched, which keeps `vat_no`/`account_no`/every `*_date` byte-identical); take the
> gate from a NEW leaf module `extraction/field_types.py` that `engine._TYPE2VAL` re-exports **by
> object identity**, so the mapping cannot fork into a 4th copy; 80 for gated types, 75 for
> flag-only, no new confidence band. Flag `SEED_TYPED_FIELD_LABELS`, env-read, **DEFAULT OFF**.
>
> **THE TRAP GARY CAUGHT, and it would have shipped:** `role_caption:'party'` must NOT be applied to
> the new typed seeds. `_PARTY_FOLLOW_STOP` (`keyword.py:1330-1340`) contains `email`, `website`,
> `address`, `number`, `no`, `account`, `vat` — so a field labelled "Email" with `party` would
> REFUSE to read `Email Address: info@acme.co.uk`, its single most common printed caption. Same for
> Website and for Account typed `reference_code`. Absent `role_caption` is the design; the
> ~~fail-toward-review rail is `trust.js` `STRICT_TYPES` (`:86-89`), which already re-validates
> email/postcode/percentage/number/reference_code/iban/vat_gb on the sub-100 auto-file path.~~
>
> > **← THAT RAIL CLAIM IS FALSE. Struck 2026-08-08 on Oracle's BLOCKING condition B2, and it was
> > the ship-blocker for the whole slice.** `STRICT_TYPES` re-validation checks **FORM**
> > (`trust.js:541-566`). The Population-A failure is a perfectly well-FORMED value from the WRONG
> > PARTY — the issuer's email IS a valid email, the letterhead postcode IS a valid postcode — so it
> > passes `_matchesTypePattern` and auto-files. Worse: a strict-typed field hits `continue` at
> > `trust.js:567` and therefore **never reaches** the cold-scope `unverifiable-value` block at
> > `:586`. The code I cited as the rail is the exact path that guarantees a wrong-party value files
> > SILENTLY. **reggie's Rule C1 is the rail, and there is no second one** — which is why C1 is
> > BLOCKING rather than a refinement. (reggie half-saw this — "the shape gate cannot help" — but
> > the two advisors' positions were never reconciled; Oracle found the seam between them.)
>
> **THE SEAM, and it must be an owner-visible decision rather than a silent side effect:** a
> newly-seeded read at 80 becomes an INCUMBENT. A fresh passive anchor scores 78 at usage_count 1
> (`anchor.py:1349`) and an anchor read that was CAPPED TO 70 AND NOTED scores lower still — so the
> keyword read wins **and the anchor's `validation_note` disappears with it**. A document that used
> to hold for review can then auto-file. Mandatory gate measurement: count docs where a winner moved
> `anchor* → keyword` while the anchor arm carried a note. Non-zero ⇒ does not ship without the owner.
>
> **VACUITY — worse than the trap already recorded.** All four `customer_corpus_score.js` EXTRAS
> (`vat_no`, `account_no`, `job_ref`, `po_ref`) are rescued TODAY by the key-role branch (`_no`,
> `_ref`), so a corpus arm is STRUCTURALLY INCAPABLE of moving. The generator needs eight new
> role-None fields (`unit_price` currency · `pallets` number · `account` reference · `ticket`
> reference_code · `contact_email` email · `discount_rate` percentage · `delivery_postcode`
> postcode_uk · `bank_iban` iban), and the DARK arm must be asserted at 0.0% recall on every new
> lane BEFORE the fix is measured. This is the concrete answer to Oracle's earlier "DO NOTHING —
> cannot be gated non-vacuously without a generator change".
>
> **REGGIE'S PRECISION RULING (2026-08-08) — the two advisors AGREE on the trap, independently.**
> reggie reached the `role_caption` verdict by the same `_PARTY_FOLLOW_STOP` mechanism gary did, from
> a different starting point, and adds the rule that makes the widening safe at all:
>
> - **POPULATION A — `email`, `website`, `postcode_uk`, `vat_gb`, `iban` — a bare label hunt is
>   STRUCTURALLY unsafe, not merely risky.** `_search_for_label` scans TOP-DOWN and returns the FIRST
>   accepted occurrence (`keyword.py:1455-1457`), and the letterhead is at the top — so the issuer's
>   email/VAT/postcode does not *sometimes* win a customer-side field, it wins on EVERY document.
>   Identical mechanism to the VAT-reg-as-money incident. The shape gate cannot help: the issuer's
>   email is a perfectly valid email. **Rule C1** — seed these five ONLY if the DB label carries ≥2
>   content tokens with at least one outside the generic type-noun set, so "Email"/"VAT Number" are
>   REFUSED (teach-only, as today) and "Customer Email"/"Supplier VAT Number" are seeded. Mirrors the
>   shipped `PRESET_CATALOG` doctrine at `document_types.js:540-542`. **Rule C2** — those five seed
>   `directions:["right"]` only; "below" from a generic caption walks into the next letterhead line.
> - **POPULATION B** (percentage, mac, ip, number, currency, reference, reference_code, date, text):
>   bare own-label hunt is acceptable; existing `len(label)<3` + sibling dedupe already suffice.
> - **Gate Stage 1 for all 11 structured types.** This does NOT contradict review-not-reject: a
>   Stage-1 rejection discards a candidate the hunt just invented from a bare label and Stages 2/0.5
>   still run afterwards, whereas a `_TYPE2VAL` rejection discards the value the operator physically
>   pointed at. Different decisions. Keep the six flag-only types OUT of `_TYPE2VAL`.
> - **A correction to the doctrine as filed:** "review-not-reject covers them" is only two-thirds
>   true. For those six the BACKEND never evaluates the regex at all (`_val_key` is None; they are
>   not in `_PRECISE_VAL_TYPES`), and the Stage-4.5 charset note flags CHARACTERS, not content — a
>   wrong-but-well-formed email gets no note anywhere. The enforcement is `trust.js` `STRICT_TYPES`
>   at the filing boundary, which is skipped `at100`. Widening seeding WITHOUT gating would add
>   silent wrong values nothing surfaces.
> - **THE AUTO-FILE SEAM, and it cuts against the owner's standing rule.** `docTrustGate` returns
>   `unverifiable-value:<field>` for a value in a field with no confirmed history in scope
>   (`trust.js:586`), so filling MORE fields REDUCES auto-file on cold scopes until history accrues —
>   the same shape as the `TRUST_SHADOW_ROW_SKIP` deadlock, and directly opposed to
>   `feedback_minimal_interaction_autofile`. **The gate for this slice must count AUTO-FILE, not fill
>   rate.**
>
> **THREE LIVE DEFECTS reggie found in passing — each is a bug TODAY, independent of the widening,
> and each is separately shippable:**
> 1. **`validation_patterns.iban` rejects every conventionally-spaced printed IBAN.** `GB29 NWBK 6016
>    1331 9268 19` fails. Live consequence: `trust.js:169` strips whitespace before the mod-97 check
>    and PASSES the value, while the renderer's on-blur scores 0% coverage and WARNS on the same
>    correct value. Proposed: `^[A-Za-z]{2}\d{2}(?:[ ]?[A-Za-z0-9]){11,30}$` — bounded, no nested
>    repetition, still `^…$` so the anchored-pattern pin holds.
> 2. **`validation_patterns.ip_address`'s IPv6 leg is wrong in BOTH directions.** It ACCEPTS
>    `09:30:15` — a clock time — and `ip_address ∈ _PRECISE_VAL_TYPES` (`anchor.py:2503`), so at ≥95%
>    coverage that time would be graded TYPE-AUTHORITATIVE and skip the charset and learned-shape
>    checks. It also REJECTS `fe80::1`, the example the UI itself prints at `doctype-editor.js:53`.
> 3. **`_infer_validation` is consulted BEFORE the DB type** (`keyword.py:342-343`), so a field
>    labelled "VAT Number" typed `vat_gb` is seeded TODAY with the generic ref caption bank
>    `["Reference No","Reference","Ref No","Ref"]` and the loose `alphanumeric` gate — the user's
>    explicit type declaration is ignored in favour of the key spelling. reggie's ruling: DB type
>    wins for the 11 structured types; key-role is retained only for `text`/untyped.
>
> **CURRENCY SIGN — my cited lines were STALE, correcting them here.** Not `keyword.py:1647-1651`
> (that is `_is_doc_chrome_fragment`). Two independent losses: `:1509` strips a leading `-` as a
> separator, and `:1768-1772` `_clean_value` returns `m.group(0)` of the first matching
> `validation_patterns.currency` alternative — **no alternative admits a sign at all**. Fix is a `-?`
> in alternatives [0] and [3] (strictly looser, so every currently-matching string still matches, and
> `currency` routes to `_currencyDpConsistent` not `_matchesTypePattern`, so the filing gate is
> untouched) plus a sign-aware separator strip.
>
> **SEQUENCING:** ship the gated non-money types + flag-only first; **split CURRENCY into slice 2.**
> `_total_role_collision` is armed by the label text being exactly `'total'` (`keyword.py:1447`), not
> by the money role, so a custom currency field labelled "Total Due" seeded at 80 can grab the wrong
> totals-block line — which is why the original author wrote "currency deferred". Also gate against
> `TEMPLATE_FORMAT_FAIL_YIELD` before either flips: it is inert on typed custom fields today only
> because they have no keyword challenger, and this fix gives them one.

> ## ORACLE VERDICT 2026-08-08 on the above consensus: **SEND BACK** — do NOT build it as specified
>
> Three reasons, each verified against the code rather than taken from the advisors: the consensus
> contains a **direct contradiction** between gary's point 1 and reggie's live defect 3; its named
> fail-safe rail is **false for its most dangerous population** (struck above, B2); and the seam
> gate gary makes mandatory is **structurally vacuous on both corpora** — the same trap he correctly
> caught on the recall lane.
>
> **The earlier "DO NOTHING" is DISCHARGED for the recall lane** — "zero live bite" is still true as
> fact but no longer decides, because `guessType` makes the hole forward-facing. Proceed, but not as
> designed.
>
> **BLOCKING conditions before this can be built:**
> - **B1** — reggie's Rule C1 (qualified caption for the five contact types) and C2
>   (`directions:["right"]` only) ship as PART OF THE DESIGN, not as options.
> - **B2** — delete the false rail claim. **Done above.**
> - **B3** — `role_caption` is PER-FAMILY, not blanket-absent. Absent for
>   email/website/postcode_uk/vat_gb/iban/percentage/number/currency; **`'ref'` for `reference` and
>   `reference_code`**. The blanket-absent design throws away a live guard: `'ref'` routes to
>   `_ref_caption_party_conflict` (`keyword.py:1477`), which inspects the word BEFORE the caption —
>   harmless to "Account No: 12345", fatal to "Customer Account 12345". Without it a custom
>   `reference` field gets WEAKER guards than the built-in `account_no`, which is the owner's
>   complaint inverted yet again.
> - **B4** — close the incumbent seam BY CONSTRUCTION, do not merely measure it. Mark the new seeds
>   (`seeded_label`) and add one rule inside the flag at `engine.py:5793`: a seeded-label keyword
>   incumbent never displaces an anchor-family candidate carrying a `validation_note` — keep the
>   anchor AND the note. Oracle traced this narrower and worse than gary stated: `is_taught_override`
>   does not require `authoritative`, so taught reads are safe, but the classes that DO lose are
>   exactly the capped-and-noted ones (`anchor_crop_slipfix` ≤70, `_recovered`, `_crosscheck`), and
>   at `:5793` the loser is discarded WHOLE — value, note and all. The valve is PRE-EXISTING, so file
>   the same exposure on the shipped 2026-07-10 seeds as a separate un-flipped item; do not widen it
>   silently here.
> - **B5** — resolve the contradiction explicitly. **Ruling: narrow reggie's defect 3 to the
>   VALIDATION KEY only** — the DB type may override `validation` when strictly tighter, while
>   captions, directions and `role_caption` stay as the role branch produces them. Under reggie's
>   blanket flip, `vat_no` loses the ref bank and `role_caption='ref'` and is then REFUSED a seed
>   entirely by C1 ("VAT No" is two generic tokens), and `account_no` loses
>   `_ref_caption_party_conflict` — both currently-shipping lanes.
> - **B6** — enumerate the seeded type set in code as a frozenset the pins assert against. If
>   `mac_address`/`ip_address` are in it, fix the unanchored-bleed anomaly FIRST: their patterns are
>   `\b`-bounded not `^…$`, so `_validate` passes on a substring and nothing extracts it, committing
>   `"192.168.1.200  Server rack 4"` verbatim.
>
> **GATE (additions to gary's):** **G2 is the one the plan was missing** — the generator must plant,
> on ≥1 of the eight new fields, a learned anchor whose read lands in the capped-and-noted class,
> or the `anchor*→keyword` note-drop counter is 0 on both arms whatever the code does (realdoc seeds
> nothing new; the synthetic corpus has no anchors at all). **G6** — report the auto-file count SPLIT
> by STRICT vs non-STRICT type, or the two opposite effects cancel and the metric lies: `reference`
> (the type `guessType` picks most often) is NOT strict so it takes the cold-scope drag, while
> email/postcode/vat/iban/percentage ARE strict so they take the silent-wrong risk instead.
>
> **Owner-facing framing Oracle asked for:** where a seed cannot be made safe (a bare "Email" or
> "VAT Number"), **staying empty and teach-only is the correct customer outcome, not a regression.**
> A field that reads nothing is understandable; the supplier's own email silently filling the
> customer-email field on every document is the one outcome the user cannot detect or undo.

**~~Also confirmed:~~ SHIPPED 2026-08-08 (`2a85838`) — `ocr_type` is RETIRED from the UI (owner
decision: wire it or delete it → deleted; the DB column stays, defaulted, and the dev CLI
`test_mapping.py` was repointed to the field's real declared type rather than orphaned; pinned in
`src/windows/test_ocr_type_retired.js`).** It was written by three UI surfaces with three
different vocabularies and read by ZERO production code (`grep ocr_type python_backend/` finds only
tests and the dev CLI `test_mapping.py:75-80`) — production `val_type` comes from
`engine._seed_field_patterns(base, field_defs)` keyed on the TYPE's field definitions. Owner
decision needed: wire it or delete it. And Stage 0.5's terminal cleaner
(`template_mapper._clean_value` → `anchor.clean_crop_segment:2670`) returns the FIRST LINE ONLY, so
a `multiline_text` taught mapping structurally cannot return an address (latent: no live address
mapping exists).

Specialist review was commissioned on items 1+2 (geometry/OCR) and 6+5 (Python design + test
strategy) before any build; nothing above has been implemented.

---

## 2026-08-07 — New doc type should seed its own keyword bucket + teach must mirror the Settings type editor (owner-raised, NOT BUILT)

Two related gaps the owner hit while creating types. Both are about the SAME thing: a type created outside
Settings is a second-class citizen.

**(1) A newly created doc type does not appear in the keyword list.** When the user adds a document type,
its NAME should be seeded into the keyword bucket for that type so it is visible (and editable) on the
keywords screen. Today detection scores types from the SHIPPED `config/keyword_patterns.json`
`document_type_keywords` buckets, which exist INDEPENDENTLY of the types an install actually has
(`database/index.js:1029`, `src/modules/processing/handler.js:43`, and pinned in
`database/modules/test_detected_type_nudge.js` + `src/windows/review/test_review_untyped_reason.js`).
So a custom type starts with NO keyword bucket of its own and the user cannot see or tune what detects it.
Seeding the type's own name is the minimum; the type's `title_aliases` ("Also appears as" chips) are the
natural second source, since an install-created type is identified by its ALIASES, never its internal name.
LEADS / CARE: the shipped buckets are per-install config, and a custom type's keywords must be stored
per-install (never packaged — see `project_customer_config_never_packaged`). Check whether seeding belongs
next to the existing `field_label_overrides` seeding in `addPresetTypes`/`create-doc-type-with-fields`
(`database/modules/document_types.js`), which already does exactly this shape of work for FIELD labels.
Do not let a seeded bucket silently widen detection for an install that never asked — decide whether the
seed is active or merely visible-and-empty until the user fills it.

**(2) The teach wizard's "create a type" must mirror the Settings type editor.** `src/windows/teach/renderer.js:254`
already notes it creates the new type "via the shared editor", so the seam is narrow — but the owner reports
the two surfaces do not offer the same options. Bring the teach path to parity with Settings → Document Types
(fields, structural roles, and whatever (1) adds), so a type taught into existence is identical to one created
in Settings. Verify at source which options actually differ before designing — do not assume from the UI.

Owner-raised 2026-08-07 during the credit-note totals session; not investigated beyond the pointers above.

---

## 2026-08-07 — Credit-note totals: the sign note is PRE-EMPTED, and the reconcile false-flags every signed credit note (NOT BUILT)

Found while the owner eyeballed the first live batch with `credit_sign_coherence` ON (Castellan credit
notes, docs 705-726, template 32). Both items measured against the LIVE DB, read-only. Neither is
caused by the flag; the flag made them visible.

**FIRST — a premise correction that changes the scope of credit-note slice A.** The 08-07 handover says
the minus sign is destroyed at READ. That is TOO BROAD, and slice A should not be designed off it.
MEASURED across the 20 docs in the batch carrying a total:
```
17 totals SIGNED correctly ('-270.60', '-1,025.64', '-1,885.32')  -> ALL method template_mapping
 3 totals POSITIVE (sign lost)                                    -> #721 '1,571.52' and #722
                                                                     '1,566.12' are method keyword
```
So the taught Stage-0.5 `template_mapping` read PRESERVES the leading minus; the Stage-1 `keyword`
path is where it dies (`keyword.py:1647-1651`, the site gary caught). Chris's sandbox produced 16/16
positive because those documents were never TAUGHT, so every read came through the keyword path — the
sample was homogeneous in exactly the variable that matters. Before building slice A, re-measure which
read sites actually lose the sign on a mixed taught/untaught set; the shared-config fix direction
(`validation_patterns.currency` + the `anchor.py:2753` strip-set) still looks right, but the claimed
blast radius does not.

**(1) — PARTLY RESOLVED 2026-08-07 by the VAT-reg fix (`d575668`), for this class only.** With the
phantom tax gone the arithmetic note no longer fires on these documents, so the sign arm reaches
them: live `#722` (+1,566.12) now carries "this looks like a credit note but the total is positive"
instead of the misleading arithmetic note. **The underlying pre-emption is NOT fixed** — the
single-valued note chain and the `validator.py:727` guard are unchanged, so any OTHER note arriving
first still silences the sign check. `2a1ae7d` added a targeted precedence rule for ONE new
pre-empter (the net-misread note, Oracle C1 — it abstains when the sign arm would speak); every
other writer is untouched. Keep this entry open: the general fix is still a ruling on the note chain.

**(1) The sign check never runs on a field that already carries a note — `validator.py:727`.**
```python
if not str(_td.get("validation_note") or "").strip():      # never erase an existing flag
```
Section 2's arithmetic reconcile runs FIRST and writes "the total doesn't add up against the line
amounts — please check" onto the total. On #721/#722 — credit-note typed, total positive, i.e. the
exact class slice C exists to catch — the sign arm is therefore skipped. VERIFIED: zero notes in the
whole DB mention credit/sign/minus/negative, with the flag ON.
Not a safety hole (the doc is still flagged and still blocked from auto-file and from File All Ready),
but the operator is told the WRONG THING: "the arithmetic is off" when the defect is a missing minus.
It also makes the flag look inert when it is merely pre-empted — do not conclude from a silent DB that
slice C does not work.
FIX DIRECTION (needs a ruling, do not just reorder): the note chain is single-valued, and "never erase
an existing flag" is a deliberate, load-bearing property. Options: (a) let the sign note APPEND rather
than replace (the pinned note-chain pattern used by D1's digit-disagreement note); (b) give the sign
check precedence over the reconcile note specifically, on the grounds that a sign incoherence EXPLAINS
the arithmetic failure and is the more actionable message; (c) leave the note, add the sign fact to the
trace only. (b) is the most useful to the operator and the most invasive. Advisor + Oracle before build.

**(2) — SHIPPED DARK 2026-08-07, gate green, awaiting the owner flip.** `VAT_REG_NOT_AMOUNT`
(`d575668`) + bridge/paired toggle (`60606d9`) + Oracle's two blocking conditions (`2a1ae7d`).
Paired with `NET_MISREAD_TOTAL_FLAG` behind ONE Settings row, because removing the phantom tax also
disarms `validator.py:673` (which needs a tax present) and a net-as-gross total would lose a TRUE
flag. Measured as production runs it: **false alarms 39 -> 0, true flags 16 -> 26**. Full reasoning,
both Oracle rounds and every gate number: `docs/oracle_log.md` 2026-08-07.
**Named residual (nothing owns it today):** `Harrowgate-Timber_quote_0046.pdf`, total `L922.14` — an
OCR garble that loses its (accidental) flag. Its owner, the format-fail-yield slice, is DARK, and
`trust.js:486-495` routes currency to `_currencyDpConsistent` ONLY — which `L922.14` passes —
without ever consulting `_currencyish`. The right-layer fix is one line (require `_currencyish(v)`
before the dp check; it can only ever BLOCK, never file more), separate change, own gate.
The original diagnosis is kept below because the mechanism is the reusable part.

**(2) The "doesn't add up" flags are a VAT REGISTRATION NUMBER read as a TAX AMOUNT — not a sign
problem at all.** CORRECTED 2026-08-07 after measuring the components; the first version of this entry
claimed the reconcile compares a negative total against a positive subtotal. **That was WRONG and is
retracted** — `CURRENCY_RE` carries no `-`, so `parse_amount('-270.60') == 270.60` and the reconcile
has always worked on MAGNITUDES. The sign is invisible to it. (Retained deliberately: the same
sign-blindness is what makes `parse_amount` unsafe to "fix" in place — see slice B.)
THE ACTUAL MECHANISM, measured across the batch:
```
doc    total    subtotal   vat_tax     sum      delta     tol    verdict
705   270.60     225.50    0027.84   253.34     17.26    5.41    NOTE
709   989.76     824.80    0027.84   852.64    137.12   19.80    NOTE
721  1571.52    1309.60    0027.84  1337.44    234.08   31.43    NOTE
718   160.32     133.60    0027.84   161.44      1.12    3.21    reconciles (BY LUCK)
```
`vat_tax` is **`0027.84` on all 13 docs that captured one** — an identical constant, conf 90, method
`shadow_reconcile`. It is the LETTERHEAD's VAT registration number: `VAT Reg GB 651 0027 84` ->
`0027 84` -> `0027.84`. It is also the ONLY `vat_tax` value in the entire live DB. So `subtotal + tax`
is short by the real VAT every time and the reconcile correctly reports that the maths fails — it is
being fed a poisoned component, and the note, while useless to the operator, is not itself wrong.
#718 "reconciles" purely by coincidence (133.60 + 27.84 = 161.44 vs 160.32, inside a 3.21 tolerance) —
that is the SAME doc the validator's own comment cites as having AFFIRMED a sign-wrong value. The
7 docs with no captured subtotal skip the guard entirely and carry no note.
WHY THIS IS A SYSTEM BUG, not a Castellan bug: any supplier printing a VAT registration number in the
letterhead is exposed, and a registration number is a stable per-supplier constant, so the wrong value
is CONSISTENT — the most dangerous shape, because consistency reads as corroboration to anything
downstream that counts agreement.
FIX DIRECTION (reggie-shaped, precision-first — a VAT REGISTRATION NUMBER IS NOT AN AMOUNT):
(a) reject a `vat_tax` candidate whose label context is a registration identifier — `VAT Reg`,
`VAT Reg No`, `VAT Registration`, `VAT No` — as opposed to an amount caption (`VAT @ 20%`, `VAT`,
`Tax`); (b) reject the zero-padded `0027.84` FORM outright (money is not printed with a leading zero
pair; this is a digit-group artefact of `651 0027 84`); (c) treat a `vat_tax` identical across many
documents of one supplier as suspect. (a) is the root fix and the other two are cheap corroboration.
Do NOT reach for a tax-vs-subtotal ratio band alone: 27.84/225.50 is 12%, which passes any plausible
band, so that check would not have caught this.
GATE: the Castellan batch (expect the ~12 spurious notes to clear, #718's lucky reconcile to become an
honest one, and no new notes on the 7 subtotal-less docs) + realdoc `armed==baseline` + the customer
corpus total lane, which must not move.

**Also seen in the same batch, not investigated:** #724 total reads `'—-1,455.12'` (an em-dash glued
ahead of the minus — a read-layer debris class, not a sign bug); #715 is a `Castellan-Security_credit_note_*.pdf`
typed **Invoice** with `heading_absent_reread` ON (already confirmed, so it may predate the flip —
check before treating it as a heading-detection miss).

**Repro (read-only, live DB `%APPDATA%\ScanFinder\docusnap.db`):** the three probes are in the session
scratchpad — flags + issuer lineage, totals + notes across 705-726, and the type/note census that
proves the sign arm never fired.

---

## 2026-08-06 — Registration follow-ups after the Castellan incident (NOT BUILT; owner-raised + Oracle C5/C7)

Context: the Castellan supplier corruption is FIXED by the shared vacuous-fit gate
(`registration.is_unfalsifiable`, both call sites). These are the follow-ups that would stop the class
recurring, or make registration WORK rather than merely go quiet. Ranked. **Do not build any of these
off the Castellan exemplar alone** (standing Oracle ruling on registration work).

**(0) `pos_tol` IS TIGHTER THAN THE PAGE JITTER IT MUST TOLERATE — the dominant filter. HIGHEST VALUE.**
MEASURED by replaying `select_cross_sample` over template 32's real corpus (160 words / 4 docs):
```
'security' 4/4 spread=0.0213   'systems' 4/4 0.0218   'bastion' 4/4 0.0208  (ADDRESS)
'house,'   4/4 spread=0.0214   'keep'    4/4 0.0219   'reg'     4/4 0.0213
'vat'      3/4 spread=0.0211   'note'    4/4 0.0188  (the TYPE NAME)  'account' 4/4 0.0166
'deliver'  4/4 spread=0.0146 -> SURVIVES      'qty' 3/4 spread=0.0063 -> SURVIVES
```
EVERY header word clusters at ~0.021 spread. That uniformity is the tell: the words are not moving
independently — the WHOLE PAGE shifts ~0.021 between scans. `select_cross_sample`'s `pos_tol=0.015`
sits just UNDER that, so it rejects the entire letterhead (supplier name, address, VAT/reg line) AND
the document title, then keeps whichever two words happened to jitter least in a 4-doc sample —
`deliver` and `qty`. They survived on measurement noise, not merit, and two landmarks is precisely
the degenerate case that yields an unfalsifiable fit.
THE DEFECT (owner-diagnosed): page shift is NORMAL for scanned documents — glass vs feeder, paper
registration is never perfect — so a landmark's COORDINATE must be an OUTPUT of finding it, not the
criterion for CHOOSING it. The read path already works that way (`_fit_page_transform` text-locates
each landmark via `_locate_anchor`, tight box then page-wide, and uses wherever it lands). Only the
SELECTOR still thinks in fixed coordinates, and that mismatch is the bug: it rejects stable chrome
BECAUSE the page shifted, which is the very thing registration exists to correct.

PROVEN by de-meaning the per-document global offset on the real corpus (measured scanner shift
between these 4 docs: dx 0.0000 / -0.0204 / -0.0076 / -0.0129):
```
word        RAW    verdict     DE-MEANED  verdict
security   0.0213  REJECTED  ->  0.0009    ok
note       0.0188  REJECTED  ->  0.0017    ok     (the TYPE NAME)
systems    0.0218  REJECTED  ->  0.0024    ok
reg        0.0213  REJECTED  ->  0.0036    ok
account    0.0166  REJECTED  ->  0.0039    ok
bastion    0.0208  REJECTED  ->  0.0055    ok     (ADDRESS)
house,     0.0214  REJECTED  ->  0.0079    ok     (ADDRESS)
keep       0.0219  REJECTED  ->  0.0093    ok     (ADDRESS)
pack       0.0592  REJECTED  ->  0.0591  STILL REJECTED   (line-item text: genuinely floats)
pir        0.0956  REJECTED  ->  0.0955  STILL REJECTED   (line-item text: genuinely floats)
```
**Landmarks 1 -> 9.** CRITICAL PROPERTY: de-meaning rescues the chrome WITHOUT admitting a single
floater — `pack`/`pir` move 0.0592 -> 0.0591, i.e. it cleanly separates "the PAGE moved" from "the
CONTENT moved", which is exactly the distinction the raw test cannot make. This also removes the
degenerate 2-landmark case AT SOURCE rather than catching it downstream in the vacuous-fit gate.
FIX DIRECTION: estimate a per-document global offset (median displacement over words common to all
sample docs) and measure the RESIDUAL spread against `pos_tol`. Do NOT simply raise `pos_tol` — that
would admit the genuine floaters (`TOTAL`, line-item text) the tolerance correctly rejects today.
This outranks (1): position-instability alone rejects `keep`/`reg`/`note`/`vat`/`account`, none of
which are inside a taught box.

**(1) LANDMARK STARVATION — narrow `_excludeBoxesFor` to VALUE boxes only. HIGH VALUE.**
`src/modules/templates/handler.js:58-67` pushes BOTH `target_*` and `anchor_*` of every mapping into
`exclude_boxes`, so `select_landmarks`/`select_cross_sample` may not use any taught LABEL as a
landmark. On template 32 that disqualified the letterhead band AND all three captions
(`CREDIT REF`, `CREDIT DATE`, `TOTAL`), leaving only body text — which is why cross-sample, running
with 4 confirmed docs, still returned just `DELIVER` + `Qty`. MEASURED: `CREDIT REF`/`CREDIT DATE`
relocate within **0.0005** of page across these docs (ideal landmarks) while `Qty` cannot be found in
its own taught box. `TOTAL` floats −0.031..−0.111 with line-item count, but `select_cross_sample`'s
`pos_tol=0.015` rejects floaters automatically — so letting labels compete is SAFE.
SEAM (answer before building): if the transform is fitted on the same label the anchor path uses to
relocate a field, the two rungs stop being independent and their errors correlate. Options: allow
label zones only for landmarks NOT consumed by an active mapping on the same field, or allow them and
accept the correlation for the registration rung only.

**(2) ASK FOR A SECOND DOCUMENT (owner-raised).** The plumbing already exists and is PASSIVE:
`captureSampleWords` (reviewService.js:325-330, on confirm) → `tryCrossSampleLandmarks`
(handler.js:105, gated `countSampleDocs >= 3`) → `select_cross_sample`. Nothing ever ASKS the operator
for a 2nd/3rd sibling. UX addition, no new matching machinery: after a teach that yields a thin
landmark set, invite the customer to drop in another doc of the same type "so the system can learn the
layout" — explicitly NOT a re-teach. Pairs with (3): the thin-set condition is the trigger.

**(3) REFUSE TO STORE A <3 LANDMARK SET (Oracle C5, the durable fix).** A set of <3 can only ever
produce an unfalsifiable fit (see `registration.is_unfalsifiable`), so persisting one arms a transform
that the read path must then refuse at runtime. Either refuse to persist it or mark the template
registration-ineligible until cross-sample supplies >=3, and say so honestly (engine.py already knows
the phrasing: "registration inactive — template has no landmarks"). Census at the time of writing:
6 templates have 0 landmarks, 7 have 1, 3 have exactly 2 (tpl 9, 30, 32).

**(4) REGISTRATION AS A WITNESS, NOT AN AUTHORITY (owner-designed; the real architectural fix).**
Owner's model: treat the drawn-box read, the keyword/label read, the logo identity and the fitted
transform as INDEPENDENT WITNESSES and require corroboration ("2 of 3") instead of letting the
transform OVERTURN the operator's box. Why it is right: `anchor_stable` can only be set when a mapping
has `anchor_text`, so a LABEL-LESS mapping (every `supplier_name`) can never defend its own absolute
read — which is exactly how the Castellan junk committed. MEASURED support: in the incident the system
already held TWO correct independent witnesses and used neither — the taught box read
`Castellan Security Systems` on 5/5 docs sampled, and the logo resolved the same supplier at conf 89 on
the one doc with no template (tpl 32 also stores 3 logo hashes; `logo_fingerprints` match_count 3).
Prior art to build on, NOT duplicate: `decide_logo_text_gate` + `LOGO_NAME_PRESENCE_ACCEPT`
(engine.py:955-990) already implements "logo + an independent geometry name read that AGREES confirms
the identity". HARD CONSTRAINT from project history: a logo must NEVER assert alone (pHash is a LAYOUT
signature, same-logo siblings collide, degrades on scans) — it may be one vote, never the deciding one.

**(5) ROTATION-LOCKED / OVERDETERMINED FIT (owner-designed).** A similarity fit is 4 DOF, so 2 points
are exactly determined and the residual is 0 BY CONSTRUCTION — that is what makes a 2-inlier fit
unfalsifiable. On a straightened page, CONSTRAIN rotation (and optionally scale): 2 points then give 4
equations against 2-3 unknowns, the fit becomes OVERDETERMINED, and the residual becomes MEANINGFUL —
a bad correspondence can no longer hide. This is the right shape for any future registration rebuild.
CAVEAT MEASURED: on the Castellan pages a rotation-locked fit was ALSO wrong, because the INPUT
correspondence was false rather than the model being unsuitable — so this fixes falsifiability, not
bad inputs. Pair with (1) and Oracle's deferred rotation-plausibility gate (|theta| <= ~12deg, which
catches the n_inliers>=4-false-inlier corner where confidence reaches 95 and clears the 88 floor —
the one cell neither the vacuous-fit gate nor a landmark witness reaches).

**(6) `_fit_page_transform` FRAME ERROR (deferred slice).** `dst` is built from the located LINE-box
centre (`found["x_norm"] + found["w_norm"]/2`) while `src` is the taught WORD centre — measured
0.0119-0.0182 on this template, and up to half the line width where a landmark heads a wide row. A
systematic per-landmark bias against a 0.02 inlier band, i.e. a manufacturer of the n_inliers==2
collapses the gate now refuses. `found["label_box"]` is the tight word box — but note it is built by
`_match_label_run` using the SAME `_label_score` at the SAME threshold, so it is not an independent
witness, only a better centre. Own switch, own gate.

**STALE ENTRY CORRECTED (Oracle C7):** the older "S-D registration fit audit" entry reads as an open
investigation. H1 (n<=2 vacuous fit) was MEASURED (~43% of docket fits collapsed to 2 inliers) and the
`REG_MIN_INLIERS_GATE` shipped default-ON 2026-08-01 at engine.py's Stage-2 site — and, from
2026-08-06, at the Stage-0.5 site too via the shared predicate. Do not re-investigate it.

---

## 2026-08-06 — `_label_score` partial credit lets a PROSE line outrank a 1-glyph-garbled true caption (NOT BUILT — larger lever)

**Symptom (traced, live, deterministic).** The PAGE-WIDE fuzzy locate in
`template_mapper._inline_code_reconcile` (`template_mapper.py:1037`, `expansion=1.0`) selects the
document's FOOTER SENTENCE as the `'Order No.'` label. On the Larkspur Interiors purchase_order template
(id 30, mapping `po_number`, `anchor_text='Order No.'`) the harvested inline token is
`"on all correspondence and delivery notes."`, `inline_val` comes back null, `_pick_fuller_code` returns
None, and the reconcile declines — leaving a clipped absolute read (`PO-48009` → `-48009`) to commit
unchallenged at confidence 90 with no note.

**MECHANISM — verified by logging every scored line (do NOT restate this as a plain "footer
false-match"; the interesting part is WHY the footer wins):**
```
0.8750  please supply the goods above and quote our order number on all correspondence and deliver
0.7500  purchase order orden no. eo          <- the REAL caption: OCR read "Order" as "Orden"
0.7500  ee order date 08/03/2026
```
- `_label_score('order no.', ...)`: `_core` strips the trailing `.` → needle `'order no'` (len 8).
- The word-boundary branch (`:2644`) misses, and the `if needle in haystack: return 0.0` guard
  (`:2657`) does **NOT** fire — `'number'` begins `n-u`, so `'order no'` is genuinely *not* a substring
  of `'order number'`. (Two reviewers independently misread this; check it before rebutting.)
- So the footer falls through to the partial-credit branch `max(longest/len(needle), ratio())`
  (`:2659-2661`): longest contiguous run `'order n'` = 7/8 = **0.875**, over `_FUZZY_MATCH_THRESHOLD`
  0.6, and it BEATS the true caption's 0.75.
- The caption scores only 0.75 because OCR misread one glyph (`Order` → `Orden`). Its own value is
  garbled to `eo` on this doc, so that row was unreadable regardless.

**The defect, stated precisely:** a long unrelated PROSE line can out-score a slightly-garbled genuine
caption, because partial credit is computed against the NEEDLE's length only and carries no penalty for
the haystack being a 17-word sentence rather than a caption.

**Impact.** `_inline_code_reconcile` is the designed recovery ladder for a LABELLED taught code box; on
this template it is inert on **7 of 8** docs (only #638 matched the real caption
`"PURCHASE ORDER Order No, PO-20008"` at 1.0). Also implicated in #630's `R7_late_relocate` clip
(`914` for GT `PO-91914`) — the same locate feeds `_relocate_and_read`, and #630 is the more suspicious
of the two failures. Expect recurrence across suppliers: `"quote our order number on all
correspondence"`, `"please quote invoice number"`, `"state your account number"` are normal PO/invoice
footer boilerplate, so this is not a Larkspur quirk.

**Evidence / repro.** Per-doc rung trace over `stress_test/crop_recipe_sweep.js` (8 Larkspur PO docs,
owner flags ON, 2026-08-06). Repro: log the sorted `scored` list inside `_locate_anchor` just before
`best_score` (`:2448`) for needle `'order no.'`.

**Why NOT fixed here.** Out of the 2026-08-06 task's fixed scope (that task ships the R6 pad-window
backstop). `_label_score`/`_locate_anchor` are shared by every template and every field — the blast
radius needs its own design + advisor gate.

**Fix direction (UNVETTED — no advisor has reviewed this).** Penalise partial credit by how much of the
HAYSTACK the match explains (a caption needle explaining 8 of 95 chars of a prose line is not a
caption); and/or require a boundary-aligned whole-needle hit before accepting a page-wide
(`expansion=1.0`) locate; and/or make proximity to the taught `anchor_box` a tie-break at a WIDER
epsilon than the current exact-tie `_SCORE_TIE_EPSILON` (1e-6), so 0.875-vs-0.75 across half a page
cannot silently pick the far line. Note `_match_label_run` already tightens WITHIN a line — the defect
is line SELECTION.

**Seam to name before building.** `_locate_anchor` at `expansion=1.0` is the "the label moved a long
way" recovery path — tightening it must not re-break the cropped/heavily-shifted-scan class it exists
for. And raising the bar on partial credit directly trades against garbled-caption recall, which is the
very thing failing here (0.75).

**Gates.** `crop_recipe_sweep.js` (the reconcile should then actually fire on Larkspur), the Customer
corpus (M=0, 0 doc-level T→F), `realdoc_regression.js` armed==baseline. CAUTION: fixing this makes R5
pre-empt R6 on these docs, which changes what the 2026-08-06 pad-window backstop is measured against —
re-run that slice's gates too.

---

## 2026-08-03 — Crosscheck-outlier reconcile (SHIPPED+ON) + Slice-2 universal verify (DEFERRED)

**SHIPPED + FLIPPED ON — `CROSSCHECK_OUTLIER_RECONCILE` (`09685d9`, setting
`crosscheck_outlier_reconcile`).** Symptom: a correct ref (crop+keyword+mapping agree) lost to a lone
fresh-locate garble because `anchor.py`'s authoritative-crop cross-check flips on disagreement ALONE
(doc-09 = NorthgateTextiles_purchase_order_09, GT PO-83150). Fix: post-merge
`engine._reconcile_crosscheck_outlier` restores a ≥2-independent-family (≥1 crop-family) + page-present
alternative over an UNcorroborated flip (re-base anchor_inline@90, drop flag). Oracle
SIGN-OFF-W/COND, conditions C1 (pre-flip crop preserved as `_crosscheck_original`, gated) + C2 (finer
`_crosscheck_witness_bucket` excludes registration/bare-anchor/the-flip, requires a crop leg) MET. Gate
(faithful realdoc 522 docs): ref 96.2→96.6% (+2 heals #344/#353), M=12==12, zero drop. Pin
`test_crosscheck_outlier_reconcile.py`. Advisors 007+reggie+gary. See `HANDOVER_2026-08-03.md`.

**Slice-2: UNIVERSAL post-merge verify — BUILT 2026-08-03 (owner GO; gary+reggie+007 → Oracle
SIGN-OFF-W/COND, docs/oracle_log.md).** ONE pass (`engine._universal_postmerge_verify`, after Slice-1,
before G1) over every eligible winner: RESTORE tiers ref/code+date (stage 2a, switch
`UNIVERSAL_VERIFY_RESTORE`/setting `universal_verify_restore`) and whole-number numeric/percentage
(stage 2b, sub-switch `UNIVERSAL_VERIFY_NUMERIC` — Oracle C6: DARK until a numeric/text GT gate
exists); FLAG tier text/structured (stage 2c, `UNIVERSAL_VERIFY_FLAG` — DARK). EXCLUDED: currency
(totals pass owns) + supplier_name (identity lane). Oracle blockers built in: S-1 `+corrected`/
`+snapped` winners untouchable; S-2 restore-demotion (digit-substitution via D1's shared comparator,
date-shaped-ref, prefix/length outlier, decimal-tail, credibility) — demoted restores FLAG with the
alternative NAMED; never drops an existing note. Pins `test_universal_postmerge_verify.py` (60
checks). Census mode `UNIVERSAL_VERIFY_CENSUS`(+`_FILE`): 522-doc realdoc census = ZERO would-fires
(clean corpus — matches the D1 0.00% precedent); OFF-arm byte-identical to baseline.

**REMAINING (next sessions):**
- **2b/2c flip gate (Oracle C6)** — build a Customer Doc Test corpus scorer (Desktop corpus +
  `ground_truth.json` carries total/vat_no/account_no/po_ref: the numeric/structured/text GT the
  522-doc realdoc lacks — its GT is ref/date-only, so a numeric/text gate CANNOT FAIL there). Then
  census + 3-arm gate → flip 2b, then 2c. Generator `stress_test/gen_customer_test.py`.
- Owner caveat (unchanged): re-test doc-09 LIVE — on the cold path it reads a CHOP `PO-160`
  (clamp/right-grow territory), not the crosscheck flip; grab SFDEV `po_number` lineage if it still
  misreads.

---

## 2026-08-05 (late) — STRAIGHTEN ARC: election gate RED → pivot to CANONICAL LEVEL FRAME (next session #1)

**Owner directive:** teach happens on straightened pages; customers run Straighten ON; taught
templates must read ~100% at ≤2°. **Arc ran:** 007+gary convergent design → Oracle SIGN-OFF-W/COND
→ `DESKEW_RAW_CROPS` election BUILT dark (`7d88dc4`, 18 pins — crop reads on RAW pages) → **gate
RED** (dsk_off/dsk_on pair: refs +7 scanned but customer −24/issuer −5/date −5; per-doc diff =
caption-grabs). ROOT TRUTH the gate exposed: stored teach coords live in the TEACH DOC'S OWN
raw frame (θ_teach baked in) — they match NEITHER the deskewed sibling (off by θ_teach) NOR the
raw sibling (off by θ_sib−θ_teach). Deskew's placement normalisation is LOAD-BEARING; the band
probe proved correctly-placed deskewed crops READ FINE (the earlier "any rotation garbles"
claim was overbroad — the pixel casualty is the full-page ~120-DPI locate, not placed crops).

**THE PIVOT (Oracle review required before build):** ONE CANONICAL LEVEL FRAME — Review/target-
teach works every time because box + pixels share the straightened frame end-to-end. Options:
(a) teach saves LEVEL-frame coords + processing deskews to level (save-path change + legacy
epoch/migration); (b) persist θ_teach per template/anchor, compose at read; (c) lazily re-detect
the teach sample's angle via sample_document_id. Constraints: owner rule NO PIPELINE SHARING
(display/teach rotation stays decoupled — pinned); `DESKEW_RAW_CROPS` + `DESKEW_SS_ROTATE` stay
DARK (both gates red — keep the code, the election infra + angles threading get reused by the
pivot). Evidence: out/customer_score_dsk_{off,on}.* · oracle_log 3 entries 2026-08-05 · the
scorer's DESKEW=1 knob. **Chris test loop ready:** sandboxed reprocess of owner-trained docs
only (no full sweep), read slices+logs — owner-approved scope.

---

## 2026-08-05 — Jitter-crater REFRAMED (Oracle premise overturn): the crater is the absolute rung, not born-digital

**Investigation (rung probe + armed rerun + wrong-answer classes + teach-anchor audit) overturned
the 08-04 item-1 charter.** Verified: (1) the cut taught box reads a CLEAN PARTIAL on crisp pages
('VXC153', '07-01-20-') which passes `_gate_value` shape_mode='ignore' and COMMITS at 78-90 with no
note — every shipped heal keys on page-vs-taught DISAGREEMENT and this class is stored-box damage on
an UNDAMAGED page, so nothing fires (armed-env rerun j120armed == j120s BYTE-IDENTICAL); (2) digital-
worse-than-scanned = crisp partials PASS the gate, scan garble FAILS it and falls through to heals
(j120s digital wrong refs: 33/49 clean-prefix-of-GT); (3) 34% of harness taught mappings had
poisoned/absent labels (value-as-label — FIXED, Slice A shipped, audit 48→0/310); (4) date
validation + parse_date accept 3-digit/cut years and Stage-4 expands them to confidently-wrong
dates. **Born-digital word-box synthesis DEMOTED to follow-up** (template_mapper OCRs the render on
both renditions — word geometry exists at Stage 0.5; the only real text-layer hole is `_page0_geom`
letterhead ranking, disproven as the crater by t300 digital issuer 90.3%).

**Oracle-signed slices (docs/oracle_log.md 2026-08-05 — conditions verbatim there):**
- A harness label fidelity — SHIPPED (see commit b63bd86).
- B `TEMPLATE_DATE_CLIP_GATE` (dark): _date_clip_suspect in _gate_value (reject dangling-separator /
  3-digit-year date fragments; 4-digit-year + trailing debris EXEMPT) + unswitched parse_date
  year<1000 floor. Pins: '07-01-20' clean 2-digit year stays ACCEPTED.
- C `TEMPLATE_ABS_EDGE_GUARD` (dark): read-time word-edge predicate on the ABS rung + word-bounded
  GROW + full-res re-read + per-type comparator + _shape_consents ladder; fallback cap ≤70 + note.
  C-C0 FIRST: the WYSIWYG pin at test_template_target_word_snap.py:108 is a DEAD GUARD (empty-string
  slice — passes vacuously); rebuild behaviourally before touching the fast path. Names EXCLUDED v1
  (NAME_UNCLIP seam); issuer lane declared out of scope for C's gate.
- D `_label_score` digit-exactness guard (dark): digit-heavy needles (share ≥0.5, ≥4 digits) require
  their digit sequence contiguous in the haystack before fuzzy blending ('03-06-2026' must not lock
  '07-01-2026').
**Sequencing: A → re-baseline arms (t300f/j120f) → D+B → C.** Gates: t300 byte-identical + ZERO
predicate fires counted · jitter climbs BOTH renditions + asymmetry narrows · LEFT-cut variant ·
realdoc 535 M=0. Old crater numbers (70→22 etc.) RETIRED — quote only re-baselined ones.

**BUILT + GATED GREEN same session (2026-08-05, commits b63bd86 · 8f631b8 · 2ddd5fa · fafd8b4):**
all four slices dark. Final gates: clean arm ZERO T→F + 21 pure heals (ref 70.1→74.7, date
91.3→93.4) · right-jitter ref 85.7/66.1 · date 91.1/83.9 · po_ref 100/78.6 · job_ref 100/100 ·
left-jitter ref 69.6/62.5 · realdoc 543 baseline==armed (M unchanged 11==11 standing, silent
14==14, M_type 0, +1 auto-file gained). **Settings-bridge BUILT (same session): `_reconcileEnv`
carries all three switches (all 4 spawn sites) + Settings→Processing toggles (edge-guard-toggle ·
date-clip-toggle · label-digit-toggle), div-balance + ID-pairing checked. NEXT: OWNER FLIP only
(tick the three toggles, or set template_abs_edge_guard / template_date_clip_gate /
template_label_digit_exact = true; RESTART the app first — main-JS changed, the stale-main
gotcha).** Known residuals: left-cut DATE lane digital 46.4%
(day-digit cut fragments — suffix date discipline is weaker than codes'); issuer lane 0 under
jitter BY DESIGN (names excluded v1 — the NAME_UNCLIP flip decision owns it); the scorer's
"Heal/verify fires captured (0)" header is stale — fires now counted via jsonl `methods`
(HEAL_RE log capture remains for engine-side heals).

**2026-08-05 LIVE FINDING — DESKEW DEGRADATION is the Larkspur docket class (probe-proven):**
docket_14 (live doc 561) reads 'DN-98447' PERFECTLY on the raw scan render (clean abs @90, no
cut); after the pipeline's +1.9° deskew rotation the same header garbles (locate words 'Dobrery/
Not/Ne:/DN/er!', full-res crop 'IN-JOSS f') — bicubic rotation smears small header print, every
heal starves on broken word geometry, the edge guard correctly flags instead of healing. Prior
art: `project_deskew_field_reread` ("straighten NOT monotone", designed-not-built) +
`project_deskew_raw_witness`; `raw_pages_out` already keeps the raw frames.
**ARC RUN SAME SESSION (007 → Oracle → build → REFUTATION — oracle_log 2nd 2026-08-05 entry):**
S1 `DESKEW_SS_ROTATE` built DARK (`5ae461a`, supersample rotate, 11 pins incl. analytic sign pin)
+ Oracle-C1 one-rotation-implementation unification (region.py private rotate deleted — SHIPPED,
behaviour-identical with SS off) + `deskew_angles_out` threading. **The interpolation hypothesis
was REFUTED on doc 561** — the supersampled rotation garbles identically; suspect #1 = the scan
noise field smearing under ANY rotation (raw+tilted reads perfectly; Tesseract self-tolerates
≤~2°). NEXT ARC (evidence bar MET): the Oracle-banked **S4 raw-preferring pre-extraction frame
election** and/or a **read-path deskew angle floor** (~2-3°, keep display straightening); S3
pdfium matrix render remains reserve; S2 raw-frame witness stays SEND BACK behind its revival
bar (C6-C10 preapproved). KEY FACTS for that arc: all THREE teach surfaces persist RAW-frame
coords (wizard suppresses · ⊕ back-transforms · teach-window Straighten back-transforms);
mapper `target_geom` is deskew-frame (never raw-crop from it); stored DB targets ARE raw-frame.
Interim owner guidance: Straighten-all OFF for these batches.

Still live from 08-04: mapper-heal census — DONE 2026-08-05 (`3b37228` — `_heal` markers + engine
"Stage 0.5 heal:" log lines + HEAL_RE; 95 fires captured on a 48-doc smoke) · customer-name GT
(#4) — GT lane SHIPPED 2026-08-05 (GT enriched in place, generator parity, scorer `customer` lane;
NAME_UNCLIP evidence pair running) · vat_no teach-locator + custom-field alias seeding (#5) · C2b
copy vet · ref_field_key threading · rehearsal read + annealing · born-digital `_page0_geom`
letterhead synthesis (demoted follow-up).

---

## 2026-08-04 (day) — C6 scorer + taught/jitter arms: the NEXT-ARC work list

**Shipped:** customer_corpus_score.js (+ TEACH arm via teach_from_gt.py + TEACH_JITTER) — the
Oracle-C6 gate. 2b/2c FLIPPED (zero noise measured). NAME_UNCLIP built dark (23 pins, no-harm x4;
HOLD). Teach-time box word-snap ON. SFDEV chord fixed. C2a decline instrumentation. S2 leak fix.

**THE JITTER FINDING (headline):** an 18% right-cut on taught boxes craters the taught pipeline
(ref 70->22, date 92->21, issuer 75->0 on 112 docs) and the shipped heal stack rescues ~nothing.
Next-arc list, in dependency order:
1. **Born-digital word-geometry gap** [PROMOTED — the seeding experiment proved consent was NOT
   the binding constraint: seeded jitter arm = same crater (only job_ref 50->64). Digital 12.5%
   vs scanned 32.1% under damage: the text-layer path produces NO word boxes so locate/inline/
   snap/cluster all starve. This is now suspect #1.]
2. **Consent starvation** — RESOLVED for the LIVE app (the teach wizard commit ends in a confirm
   -> count-1 provisional rows flow automatically via the night channel) and for the HARNESS
   (scorer now seeds live-parity provisional rows in TEACH mode). Keep: verify live end-to-end
   once on a real teach.
3. **Born-digital word-box synthesis** — digital WORSE than scanned under damage (2 sightings:
   cold ref 40 vs 50; jitter 12.5 vs 32). The text-layer path skips OCR so snap/inline/cluster
   machinery starves. Candidate: synthesize word boxes from the PDF text layer (pypdfium2 has
   char/word positions) so born-digital docs get BETTER geometry than OCR, not none.
3. **Mapper-heal census instrumentation** — heals are silent (diag markers only); add log lines
   so fire-counting works (the every-step-trace arc).
4. **Customer-name GT** — corpus generator lacks customer values in GT; without them NAME_UNCLIP
   (non-supplier names only) is structurally unexercisable. Generator extension + re-gen.
5. **vat_no teach-locator** — multi-group values ('GB 286 4471 90') miss in teach_from_gt find_value
   (single-run scan); also custom fields get NO label-alias seeding (vat_no ~0 in every arm).
6. Also parked: digital-vs-scanned ref anomaly root-cause; C2b copy vet; ref_field_key threading;
   rehearsal read + annealing.

---

## 2026-08-03 NIGHT (autonomous, owner asleep) — perfect-catch arc: 4 flips, all Oracle-gated

**Owner mandate:** "hash it out between yous, have the oracle vet it and implement when there is
agreement." Goal: teach once -> perfect catch on CLEAN siblings, silently. Full verdicts in
docs/oracle_log.md (NIGHT entry); commits `df80601` + the wrap commit.

**FLIPPED ON tonight (all gated):** `template_target_word_snap` (Slice B — own gate: +1 ref heal,
+1 date heal incl. a century garble, 5 false-flag drops, M identical) · `template_code_frag_clean`
(A2/C1 alnum label-tail fragment strip, consent ladder) · `template_clip_commit` (C2a right-clip
clean commit, 3 corroboration legs incl. the S1 ladder-provenance bit). Composed gate
byte-identical (M 10==10, zero drop). Settings toggles shipped for all three. PLUS the provisional
consent channel (taught-doc skeletons, S2-isolated) + role-aware ocr_type seeding + both
edit-surface selects + advisor prior-art/track-record memory.

**OWNER-MORNING list:**
- **C2b copy** — the SURVIVING disagreement note still reads "manually mapped value differs from
  the usual format" (Chris: blame-shaped, nothing to verify against). Oracle-approved direction:
  name both reads ("the taught box and its anchored re-read disagreed ('o. DN-6742' vs
  'DN-67428')"). User-facing copy -> owner vet.
- **Teach-time box word-snap** (barry #1, gary-designed): snap the STORED boxes at readBack so
  teach geometry == read geometry; owner sees the snapped box before commit. UI-visible teach
  flow -> owner first. Frame trap: ocrRegionBoxes words are crop-px.
- **`_seed_field_patterns` ref_field_key threading** — the REAL production hole for
  unconventional-key ref roles (free-text-gated today). Separate gated follow-up (gate: M
  unchanged; candidate selection can shift when a gate starts withholding).
- **Rehearsal read + template annealing** (barry #3/#6) — design-only, the durability pair.
- Live re-test: reprocess the Northgate dockets after RESTARTING the app (main-JS changed
  tonight — the stale-main gotcha bit once already this evening).

---

## 2026-08-03 (evening) — teach-mapping edge-debris heal (Slice A BUILT) + word-snap (Slice B designed)

**Incident:** teach-wizard template 26 (Northgate delivery_note) value box ~7px right of label
"Delivery Note No."; +1.3-1.5deg siblings bleed the label-tail dot; every read commits '. DN-60902'
(drift rung: template_mapping_shapewarn@70 + "manually mapped value differs" note; under-tolerance
rotation: SILENT clean@90 on the absolute rung). The reconcile's clean inline read was computed then
DISCARDED by _pick_fuller_code's agree branch. Full diagnosis via Debug/diagnostic_*.jsonl.

**Slice A BUILT (dark):** agree-branch edge-debris heal, kill TEMPLATE_CODE_EDGE_CLEAN (default OFF),
setting template_code_edge_clean bridged. Oracle SIGN-OFF-W/COND, fork RULED reggie (witness-equality:
heal iff strip_edges(rigid)==inline VERBATIM + learned shape consents; COLD suppliers heal — the
named-deliberate '#12345'->'12345' pin). Pins test_template_code_edge_clean.py ALL PASS + full mapper
suite green. GATE GREEN (535 docs, OFF==ON byte-identical: M 10==10, ref 515/535 both, zero hold-set leavers) — FLIPPED ON (template_code_edge_clean=true) + Settings toggle "Tidy stray marks from taught reference reads". Heal evidence = unit pins + the traced rb_539 lineage (the harness renders dont reproduce the live dot-bleed).

**Slice B BUILT (dark, 2026-08-03 late):** pins test_template_target_word_snap.py ALL PASS; setting template_target_word_snap bridged (no UI toggle until its flip). REMAINING: its OWN 535-doc gate window (never share As — Oracle) + flip. Design: _snap_box_to_words on derived rungs (drift+registration) — majority-
inside word admission, cluster gap discipline, located-frame label cut (B-C1 frame trap), never admits
untouched words; absolute rung WYSIWYG untouched. Switch TEMPLATE_TARGET_WORD_SNAP. Build AFTER A
ships, SEPARATE flip window (both release the same shapewarn hold). Oracle conditions B-C1..C5 in
docs/oracle_log.md.

**barry ideas (owner rule: minimal interaction, max auto-file — visibility goes to SFDEV):** survive
as silent automation: Wiggle Test (teach-time tilt probe, SFDEV verdict), One-Good-Doc picker,
Self-Healing Box (located-frame + versioned refit + >=N distinct docs), Template MOT (needs
template_id attribution on corrections). SFDEV-only: agreement dots / provenance / tidy receipts
(receipts MUST persist to audit regardless). Kernel rule from #4: a tidy files without review only
when verbatim-corroborated by an independent-GEOMETRY read — enforced by the mapper not attaching
the note, NEVER a trust.js note-class bypass. Shared spine = ONE per-field agreement+tidy event at
the engine post-merge choke point.

**Also spotted (unfixed):** teach wizard seeded ocr_type=text on a reference-role field (template 26
delivery_number) — teach-time type seeding should map the field's real type; separate small fix.

---

## 2026-08-02 OVERNIGHT (autonomous, owner asleep) — SHIPPED / DARK / DEFERRED
Owner directive: build everything buildable, commit each, push at end, flip ON when the advisor+Oracle
+ gate pass green. Then a christest walkthrough. Advisors used: eric (search/UX cluster), reggie
(ref-completion), gary (type-note + bleed). All fixes gated; each commit self-contained.

**SHIPPED + FLIPPED ON (gate-green):**
- **Crop right-grow `ANCHOR_VALUE_RIGHT_GROW`** — `13dbe44`. Proven heal on the Northgate PO demo
  (`stress_test/demo_rightgrow_ab.js`): PO-5898→PO-58987 (HEAL vs GT), 0 collateral. Setting-bridge
  `_anchorCropEnv` (4 spawn sites) + Settings→Processing toggle. Flipped ON in the live DB.
- **Label-tail clamp `ANCHOR_LABEL_LEFT_CLAMP`** — `336585a`. Oracle had already GO'd the flip;
  demo-verified (Saltmarsh PO9974A9C→PO-27425 HEAL, 0 collateral). Same bridge + toggle. Flipped ON.
  NOTE: the harness can't test the LIVE combination of both crop settings ON (it reads env, not the DB
  settings); the corpus reads are crop-OFF. #499 (PO-58987 chop) surfaced crop-OFF in the harness — it
  is the right-grow class and heals with the live flip. Watch W1-W3 (see the clamp section below).
- **Light⇄Dark quick-flip remembers the selected theme** — `418cf80`. theme.js records a per-family
  anchor; the flip round-trips (slate⇄midnight⇄slate, warm⇄dark⇄warm).
- **Search preview honest error state (eternal-spinner cure)** — `bf9fe90`. selectDoc guarded +
  stale-selection token; mailbox/workflow pre-fetches dropped; "No handler registered" → restart msg.
  Pin `test_preview_error_state.js`.
- **Home "Open Mailbox" lands on the mailbox** — `b67688a`. New open-search-window-at channel
  (NOT the taken get-search-target); SearchMailbox.open() set-true idempotent.
- **Core Search re-skin to the client look** — `d7ab2e2`. New `search-components.css` (tinted chips,
  segmented mailbox, lead search icon, pill buttons) over the existing class hooks — no logic/IPC/id
  change. Chris visual round pending (christest).
- **Focus-repair sweep SLICE 1** — `01a2a43`. `shared/dialogFocus.js` (focusField + idempotent
  confirm/alert wrapper); preload `ensureWindowFocusAsync`; workflow Reject note routed; Search/Main/
  Teach armed (were unarmed). Pin extended (+recovered 4 drifted runZoneOcr checks). Full 42-site
  `.focus()` audit + regrow-proof static pin = MULTI-SESSION (per eric).
- **delivery_number breadth + Service Worksheet preset** — `b4105b7`. ~25 delivery-specific captions
  (excludes greedy Note No/Ref No); type-scoped worksheet preset. realdoc M=0, zero new delivery
  regression.

**BUILT DARK (flip pending):**
- **Digital↔scanned bleed — `SAME_SUPPLIER_LAYOUT_GATE`** — `5af13cf`, default OFF, byte-identical.
  gary-designed elif on the same-supplier authoritative rigid read (require caption at taught position,
  looser relocate budget + offset-present precondition; demotion-only). Pin
  `test_same_supplier_layout_gate.py`. **FLIP PRECONDITION: Oracle round (narrows a Tier-A invariant)
  + realdoc M=0 with the switch ON + gary's two-direction integration pin. Do NOT flip yet.**

**DEFERRED with a vetted design (build-ready, owner-gated or needs a live test):**
- **Type-note placement under Document Issuer** (gary): Route 1 (renderer-only display relocation to a
  `.type-scope-note` band by `#doctype-select`, keeps the persisted note on the carrier for the
  auto-file hold, copy-lockstep pin) OR Route 2 (a `note_scope:'type'` marker + migration). Route 1
  recommended for its zero-migration safety. NOT built (budget). engine.py:5889 `_flag_type_ambiguity`.
- **Child-window minimise → in-app dock** (eric): PREMISE CORRECTION — NO current child is modal
  (main.js:480), so no modality surgery. Slice 1 = dock infra + child-minimise/restore-child IPC +
  the trigger (prototype the createWindow `minimize` intercept; fall back to an in-app control if the
  skipTaskbar stub flashes — needs a live Windows test). SEAM: main-hides-to-tray orphans a docked
  child — handle first. restore-child must verify sender===main + name∈CHILD_WINDOWS. NOT built (the
  trigger needs a live flash-test I can't run headlessly).

## 2026-08-03 (day, owner present) — template fine-tune SLICE 1 SHIPPED + two follow-ups
**SHIPPED + FLIPPED ON:** the Northgate PO-17039 class (template_mapping tight-crop reads 'PO-17039'
as '»0-17039'@90, WINS over correct keyword 'PO-17039'@93, → '0-17039'@69 flagged). Verified LIVE in
the diag log. 007+reggie+gary → Oracle SIGN-OFF-W/COND (oracle_log 2026-08-03).
- **`PREFIX_GARBLE_ADOPT`** (`0d747d0`, setting `prefix_garble_adopt`, flipped ON) — a SECOND adopt
  fingerprint in the S-B length-witness arm: `suffix_reconcile.prefix_garble_fingerprint` (garbled
  leading prefix, exact tail preserved) gated by `engine._strong_single_prefix` (`all_prefixed` +
  ≥0.90 + ≥5). Adopts the confirmed-prefix peer's value. Pins: test_suffix_reconcile §4 +
  test_ref_length_outlier §7. Realdoc OFF==ON byte-identical. Bridge `_reconcileEnv` + Settings toggle
  (`4f29fc0`). Do NOT co-ship gary's S-C Stage-0.5 extension (Oracle C4, order collision).
- **SFDEV lost-reason** (`45de1af`) — a LOST rung now names the incumbent ("kept 'X' from
  template_mapping"); state-only, no-overclaim pinned.

### ✓ RESOLVED (for the batch gate) — harness now fires Stage 0.5 via the reprocess manifest (2026-08-03)
`realdoc_regression.js` now passes the per-doc `--reprocess-manifest` (`17d7480`), so the gate fires
Stage-0.5 template_mapping like the app. PROVEN: the `PO-2590`/`PO-5898` chops (template_mapping tight-
crop) now appear where the blind harness read the ⊕ anchor. **This immediately re-validated the crop
flips** (right-grow+clamp) that were meaninglessly "byte-identical" on the blind harness: on the
faithful harness, crop-ON vs crop-OFF (both manifest + prefix-garble ON, 503 docs) = **+3 ref heals
(#483/#499/#503), ZERO new regressions**, ref 96.4%→97.0%. Honest re-baseline (previously masked): ref
96.4% base, 12 would-auto-file-wrong. RESIDUAL (minor): single-doc `trace_one` still reads the anchor
(the batch path fires template_mapping, the single-doc filed-copy path doesn't — a state/path quirk, not
the gate). NEW FINDING (fine-tune arc): the diag's `doc_context` shows the app matching a **"Stonegate
Property Mgmt" template to Northgate docs** — a cross-supplier logo-phash collision; the wrong
template's mapping box is a prime garble source. Investigate under the template fine-tune arc.

### HARNESS-FIDELITY GAP — the corpus gate is BLIND to the template_mapping-garble class (2026-08-03)
`stress_test/realdoc_regression.js` + `trace_one.js` do NOT fire Stage-0.5 `template_mapping` — on the
Northgate PO-17039 working copy they read the ⊕ anchor (anchor_inline@97) while the LIVE app fires
template_mapping and garbles (@90, confirmed in the diag). So EVERY corpus gate this session proved
"no regression on what the harness sees" but is blind to template_mapping heals/regressions — those
are only observable live. Root cause UNKNOWN (template match/registration state? working-copy render
vs raw? the app reprocess passes something the harness snap() doesn't). FIX DIRECTION: make the harness
faithfully reproduce the app's Stage-0.5 (diff the app reprocess spawn args in processing/handler.js vs
the harness snap()), so the template fine-tune arc can be gated by the corpus, not just the live app.
High value — this blind spot undermines every template-class gate.

### ✓ SHIPPED slice 1 (prep-only, ON) — oscar crop-fix B; slice 2 (whitelist) + #494 deferred (2026-08-03)
`STRUCT_CODE_READ` (`d2b8937`, setting `struct_code_read`, flipped ON). oscar+007+gary → Oracle
SIGN-OFF-W/COND (oracle_log 2026-08-03). Slice 1 = PREP ONLY: cap-height upscale
(`region_core._ink_band_height` → scale clamp(34/ib,1,4)) + synthetic read-time quiet-zone (median-grey
border, NOT a wider window) + DROP SHARPEN, in a struct rung PREPENDED to the shared ladder that falls
through to today's rungs on a sub-floor read (Oracle C2). NO whitelist (Oracle fork-ruled it out — the
gateless Stage-0.5 path would auto-file a whitelist-snapped clean-shaped WRONG code). Gate (faithful
manifest harness, OFF vs ON, crop-flips-ON baseline): +1 ref heal (#218 digit-sub read RIGHT),
would-auto-file-wrong set IDENTICAL (true M=0), zero accuracy drop, no new regressions; #494 unhealed but
UNCHANGED (fall-through). Pins test_struct_code_read.py.
**DEFERRED:** (1) **slice 2 = the char whitelist** — must carry its OWN checkpoint (a differently-prepped
non-whitelisted corroboration OR the learned-shape check), NOT committable on shape_mode='ignore' alone
(Oracle C4). (2) **#494 'PO-66063'→'PO-68063'** interior digit-sub — prep alone can't cure; slice-2
whitelist or a second-render witness. (3) **real-asset functional PIN** — capture a ~13px garbling crop.

### oscar crop-fix B — the ROOT fix for the tight-crop garble (007-recommended, incl. po_date)
The garble is a READING failure (007): a ~13px target crop with no left quiet-zone + over-sharpen reads
'PO'→'»0' AND '19'→'09' (doc-18 po_date is ALSO wrong: 09-06-2026 vs 19/06/2026 — same class, but a
date has no prefix so PREFIX_GARBLE_ADOPT can't touch it). Fix B (oscar owns the recipe): cap-height
upscale (~3× for a 13px crop, target ~30-40px), a READ-TIME quiet zone (pad the pixels fed to
Tesseract, NOT the stored box), a char whitelist for structured code types ('»' becomes impossible).
ORDERING SEAM (007): B lands BEFORE any crop-window/geometry change, measured on the IDENTICAL box. B
is the root (cures every code crop incl. no-peer + date cases); PREFIX_GARBLE_ADOPT is the net. Bring
in oscar → Oracle.

---

## UX / product

### ✓ SHIPPED — Light⇄dark quick-flip forgets the selected theme — OWNER 2026-08-02 (next session)
> Resolved by `418cf80` (theme.js records a per-family choice) — see the SHIPPED list at line ~590 of
> this file. Ticked 2026-08-08; the entry is kept for its repro.
**Repro (owner, live):** with a non-default theme selected, the quick Light⇄Dark toggle (account
menu + rail-foot) goes dark, then flipping back lands on the DEFAULT theme (Warm Paper) — the
user's chosen theme is lost. **Expected: the toggle alternates between the CURRENTLY SELECTED
theme and a dark theme, round-tripping back to the selection.**
**Likely mechanism (unverified — verify at source):** the flip handler writes a literal theme name
both ways (`set-setting('theme', 'dark')` / back to the default constant) instead of remembering
the pre-flip selection. Leads: `src/windows/shared/theme.js` (sets `data-theme` + `data-mode`,
`DARK_THEMES` gates the family), the account-menu + rail-foot toggle wiring, `theme-changed`
broadcast.
**Fix shape (design in-session):** remember the last LIGHT theme and last DARK theme
(settings-persisted pair) so the flip maps selection⇄dark-counterpart and back — e.g. Nordic
Slate ⇄ chosen dark, seasonal themes included; minimum bar = flipping back restores the pre-flip
theme exactly. Respect the existing `data-theme`+`data-mode` split (memory
`project_theme_system_gotchas`).

### ✓ DONE — Teach clipped-code reconcile, Slice 2 (the DRIFTED-sibling path)  (2026-07-31, `a4fa107`, ON)
- Slice 1 (`f2e5ee3`/`c70bae7`, `TEMPLATE_INLINE_CODE_RECONCILE`) fixed the FAST path; Slice 2 (`a4fa107`,
  `TEMPLATE_INLINE_CODE_RECONCILE_DRIFT` default ON) extends the reconcile to the DRIFT/relocate path
  (`_geometric`). Routes through `_inline_code_reconcile` wholesale (robust page-wide source — Oracle SEND-BACK of
  the partial `located`-based version, which could DEGRADE a correct geometric read). Gate: `drift_forced_probe.py`
  10/10 + 0 degraded + 3 real drift-garble fixes; realdoc DRIFT==baseline; 4 drift unit/PIN. Memory
  `project_teach_inline_code_reconcile_20260731`.
- **Perf follow-up (optional, still open):** the reconcile does a page-wide locate per clean CODE read; it's `line_cache`-shared
  with the registration landmark fit (≈0 extra OCR on registration-enabled docs), but a doc with a taught code
  field and NO landmarks pays one fresh page-wide OCR. If profiling ever flags it, gate the cross-check on a cheap
  pre-signal (e.g. the local pre-pass `inline_value` disagreeing) before escalating to the page-wide locate.

### ✓ FIXED (pending owner smoke) — Teach wizard label non-recognition  (2026-07-30)
- **Root cause (frame-math bug):** `cropB64` sends the label band NATIVE (ds=1.0 under `TEACH_NATIVE_CROP`),
  but the label-detection code at `src/windows/teach/renderer.js:787/803` recomputed `ds=OCR_TARGET_H/bandHpx`
  (~0.42) WITHOUT honouring `TEACH_NATIVE_CROP` — so `cY` (the value centre fed to `nearestRowTo`) and the
  label word-box→page-norm conversion were scaled ~0.42× against words that are in NATIVE crop px →
  `nearestRowTo` looked in the wrong place → no row → "No label found here" even with the caption right beside
  the value (the Saltmarsh "Order Date" miss). FIX: both `ds` now `TEACH_NATIVE_CROP ? 1.0 : (…)`, frame-
  consistent with the crop. `nearestRowTo`/`nearestLeftCluster` then correctly narrow a wide band (heading +
  caption) to the caption row, so cause (2) is subsumed.
- **Smoke:** reopen Teach on the Saltmarsh PO → draw the Order Date value → "Order Date" should now be detected.
  If a residual remains on a badly-skewed scan (cause 3), look at the band slice next.

### ✓ SHIPPED — Teach wizard: only-current-box overlay + Straighten text button  (2026-07-30, owner)
- Overlay now draws ONLY the field being taught (removed the done-fields loop in `redrawCanvas`); the last
  box clears once the final field confirms (`advanceField` parks `fieldIndex` past the end → `curField()`
  undefined). Display-only — `state.results` untouched.
- The teach `∞` straighten control replaced with Review's icon + "Straighten" text button (`#tz-deskew`,
  auto-width; keeps the `.active` pressed style). `src/windows/teach/{renderer.js,index.html}`. Needs app reopen.

### Template Manager — Straighten button  (added 2026-07-30, owner)
- **Wanted:** a Straighten control in the Template Manager preview (same as Review/teach) so a tilted
  sample can be levelled before drawing/checking anchor→target boxes. `src/windows/settings/` (Template
  Viewer `#tpl-dock`) + reuse `get-page-deskew` + the AnchorLabel transform (as teach does).

### ◐ MOSTLY SHIPPED — Template Manager — visualize + tighten anchor boxes  (added 2026-07-30, owner — EXPLORE)
> **(1) The overlay already existed** and was never ticked: "Preview registration on this doc"
> (`#tpl-preview-registration`) resolves every mapping on the loaded sample and overlays the DRAWN
> box (grey) against where it ACTUALLY lands, labelled with the value and the rung that placed it
> (`REG`/`map`/`anc`). **2026-08-10: made frame-aware** — it drew in raw coordinates only, so with
> Straighten on, the page rotated and every box stayed put (owner-reported). Both the stored and
> the resolved boxes now map into the displayed frame, and the resolver is pinned to the RAW page
> so the preview keeps answering the production question.
> **(3) The per-box test readout already existed too** (`last_test_*` in the Saved Mappings table)
> and now shows WHEN it was tested — a green read from before the box was last moved is not
> evidence that the box works now, and there was no way to tell.
> **(2) Tightness controls — PARTLY DONE, and the rest needs schema.** `search_expansion` is the
> one per-mapping knob that exists; it was a bare slider labelled "Expansion" whose number was
> adjustable without being understandable, and it now names both failure modes (too tight clips the
> value; too loose swallows the neighbouring row or column) with live guidance per band.
> **STILL OPEN, and bigger than it looks:** registration on/off, label-lock strictness, and
> absolute-vs-relocate are **NOT per-mapping columns** — `template_field_mappings` carries only
> `anchor_text`, the two box rects, `offset_*`, `ocr_type` (retired), `search_expansion`,
> `region_hint`, `enabled`, `last_test_*`. Surfacing them per field means a migration AND making
> the extraction rungs honour a per-mapping override, which is an extraction-layer change and needs
> its own Oracle pass + corpus gate. Do not treat it as UI work.
- **Owner questions (answered inline in chat 2026-07-30):** do TM-drawn boxes validate on import? what is
  the TM for? should the drawn zones be VISIBLE on a doc (like Review's "show where it reads") so the user
  sees where the system snaps? what settings tighten a frequently-misfiring box?
- **Direction to design:** (1) a "show where it reads" overlay in the TM preview (reuse the Review overlay
  path + `template_mapper` located-zone output); (2) per-mapping tightness controls (padding/expansion,
  registration on/off, label-lock strictness, absolute-vs-relocate) surfaced per field; (3) a per-box
  test-on-this-sample readout (already partly in `recordMappingTest`). See the chat exploration for the
  full write-up + the FACT-checked answers on how mappings/anchors are actually used at extraction.

### ✓ SHIPPED — Import "couldn't be read" banner: details + dismiss  (2026-07-30)
The amber Import banner now (1) reworded "held for retry (not filed, not lost)"; (2) a **Details** toggle
lists each held doc + WHY (`documents.error_message`, via the existing `getStuckDocs`); (3) a **dismiss (×)**
per-session acknowledge that re-surfaces only when MORE docs fail (`_stuckDismissedAt`). Renderer + markup +
CSS only (`src/windows/main/{renderer.js,index.html}`); errored docs still hold at `status='error'` (never
lost) — dismiss is display-only. Needs an app reopen to render.

---

## UX / product (continued)

### Catch-up filing ("file the rest") — SLICES 1-3 BUILT (dark), SLICE 4 GATES + FLIP REMAIN
**2026-08-01 evening: slice 3 BUILT** (server accept/undo + renderer consent UI; all dark behind
`scope_sweep_enabled` OFF + env `SCOPE_SWEEP`): `sweep-scope-accept` re-validates EVERYTHING
server-side (status/scope/workflow + candidacy FINGERPRINT + the same `_evaluateSweepDoc`
re-run) then files through the ONE shared `reviewService.confirm` with INTERNAL
`{via:'scope_sweep'}` (4th arg — never payload-suppliable; claim stamps `confirmed_via`;
saveCorrections SKIPPED for machine confirms = no hint inflation; learn-on-commit self-guards) ·
`sweep-scope-undo` (server-verified `confirmed_via='scope_sweep'` only → deconfirm, via cleared,
filed copy kept for in-place re-file) · consent bar `#sweep-consent-bar` (offer/filing/done
states, per-doc untick, Review-them queue filter, Not-now per-scope dismiss, Undo all,
kept-back reason chips) · triggers: single confirm + prefix-outlier resume + File-All dominant
scope (debounce 2.5s) · audits scope_sweep_offered/accepted/undone. PINs green:
`database/modules/test_confirmed_via.js` (claim stamps via / human NULL / deconfirm clears /
pre-mig-57 guard) + all seam suites (scope_trust, learn_on_commit, sweep_predicate,
reextract_merge). **SLICE 4 REMAINS before flip: fixture integration gate + demo-corpus gate
(design §test plan) + realdoc OFF assert, then flip `scope_sweep_enabled` per install. Owner
can pre-trial with env `SCOPE_SWEEP=1` (harness lever, not the flip).** gary's header-band
witness design (2026-08-01, awaiting Oracle) slots into `_evaluateSweepDoc` as an AND-only
exclusion later — not part of slice 4.

Original design record (2026-07-31):
- Owner idea: after K same-scope manual confirms, remaining queue docs (correct values, stale
  scores) re-gate against the warmer learning and batch-file behind a per-scope consent
  banner+list with per-doc untick. barry (L3, near top of office backlog) → gary (two-tier
  predicate: free re-gate + imageless consistency re-score; memory-held; files STORED rows via
  reviewService.confirm bulk) → **Oracle SIGN-OFF-W/COND** with two rulings (sweep confirms
  EXCLUDED from graduation via new `confirmed_via` column, values-learning flows;
  banner-consent v1, silent File-All absorption rejected) and two seams both advisors missed
  (corrections-SPAN revocation so human-only windows don't disarm self-revocation; candidacy
  extractions FINGERPRINT so consent can't go stale). **Full agreed design + build slices:
  `docs/designs/CATCHUP_FILING_2026-07-31.md`.** Build in a fresh session, slice 1 first
  (migration + scopeTrust rework — feature-independent).

### Child-window minimise → a visible, pronounced dock (not the lost corner box) — OWNER 2026-08-02
**Owner ask:** re-enable minimise on the child windows (Review/Settings/Search/Teach/dev-inspector).
They used to minimise to a tiny stub at the desktop's bottom-left that vanished into the background and
was hard to find. Want: minimise them to the **bottom-left of the MAIN app**, staying **visible and
pronounced** so they're easy to spot and reopen.
**Why it's off today (repro/root):** parented child windows are created with `minimizable:false` FORCED
(`src/main.js:583` — `...(parentWin ? { minimizable:false } : {})`) precisely BECAUSE they are
`skipTaskbar:true` (`main.js:585`), so a native minimise sends them to the legacy Windows corner stub
with no taskbar entry — "an easy way to 'lose' the window" (comment `main.js:581-583`; same hazard noted
for the main window at `main.js:475-477`). So the feature was deliberately disabled, not missing.
**Leads / design direction (eric to vet; NOT built):**
- Don't use native minimise for a `skipTaskbar` child. Instead `win.hide()` and render an in-app
  **restore dock** — a pronounced pill/chip anchored bottom-left of the MAIN window (`#topbar`/main
  renderer), one per hidden child, click to `show()`+`focus()`. A restore path already exists:
  `createWindow` restores+focuses an existing window when its launcher is clicked (`main.js:548`,
  `475-477`).
- **Modality wrinkle:** most children open MODAL to the parent (`modal=!NON_MODAL_CHILD.has(name)`,
  `main.js:574`) — a modal child blocks the parent, so "minimise and go use the main app" only makes
  sense if minimising also drops modality (or the feature is limited to non-modal children). Decide
  which.
- Alternative already half-built: the **system tray** minimise-to-background path (`main.js:630-697`,
  Stage 1/2) — could dock hidden children there instead of/as well as an in-app dock. Owner wants
  IN-APP + pronounced, so the bottom-left dock is the primary; tray is the fallback discussion.
- New IPC: `window-minimise` currently exists (`main.js:1386`) for the main window; a child variant
  would hide + notify the main renderer to add/remove its restore chip.

### Teach "Confirm what I read" bar — two filled buttons, ambiguous accept — DESIGN PLAN (OWNER 2026-08-02)
**Owner repro (screenshot):** after drawing a field value in the teach wizard the confirm bar shows
TWO large filled-orange buttons — "Looks right →" (accept) AND the selected direction toggle "← Left"
— so it isn't obvious which one accepts-and-moves-on. Owner wants a sleek, smooth redesign.
**Root (verified):** `src/windows/teach/renderer.js` — the Left/Above direction toggle renders the
SELECTED direction as `btn primary` (`:687-688`, `dir==='left'?'primary':'ghost'`), i.e. the same
filled-primary style as the accept button `rb-yes` "Looks right →" (`:692`). All controls sit in one
flat row (`:686-694`: accept · Redraw value · Redraw label · "Label is:" Left/Above) with no visual
separation of VERIFY controls from the single ACCEPT action → two primaries compete for the eye.
**Owner's desired flow:** keep the confirm LABEL + VALUE on the same header (`setPrompt('Confirm what I
read for', f.label)` `:671`, and the "Value: … · Label: … (left of the value)" readout). Make it an
obvious **check-FIRST-then-accept**: (1) check the VALUE is right, (2) check the anchor is LEFT or
ABOVE, (3) THEN one clearly-primary click if you agree.
**Design plan (to vet, NOT built):**
- **Exactly ONE filled primary** on the bar = the accept ("Looks right →" / "Yes, save this field →").
  Everything else steps down to secondary/ghost/segmented.
- **Left/Above = a SEGMENTED TOGGLE** (one pill control, two segments, selected segment softly
  highlighted — NOT `btn primary`). It reads as a CHOICE, not a competing action. Drop the arrow-key
  orange fill.
- **Two zones, ordered check → confirm:** a VERIFY group (value read-back + label + the direction
  toggle + subtle "Redraw value / Redraw label" as text-links or small ghost buttons) then, visually
  set apart (right-aligned or full-width below), the single ACCEPT CTA — so the eye flows value →
  direction → accept.
- Keep label+value in the header per owner. Sleek: quiet secondaries, one confident primary, a little
  breathing room between the verify group and the CTA; consider a faint "① check  ② confirm" cue.
- **Advisor gate before build:** chris-the-customer (his exact domain — decision ambiguity / which
  button) + barry (UX shape) → eric (teach renderer) → Oracle. Renderer-only; no extraction impact.

## Extraction / accuracy

### Cross-contamination residual — Stage-2 `_qualify_against_format` — DO-NOTHING (gary+Oracle, 2026-07-30)
- **Resolved understanding (Oracle traced it):** the Stage-4.5 fix (`SHAPE_WITHHOLD_SUPPLIER_SCOPED`, default
  ON, engine.py:4421/4631) closes the keyword/rigid path. The feared Stage-2 `anchor_crop` null is **largely
  already handled**: `method='anchor_crop'` is set at `anchor.py:586` only AFTER passing `_qualify_against_format`
  at `582`; a clean stranger crop is nulled at **582** (the ENTRY to the relocate/registration recovery chain),
  and the located case is **already resurrected** at `anchor.py:1102-1104`/`1175-1177` by the same
  `_digit_free_on_digit_field`/`_partial_of_uniform_shape` predicates (flagged at Stage 4.5). So `anchor_crop`
  is NOT the danger the earlier note claimed.
- **The genuine residual is a NARROW sliver:** `method='anchor'` text-fallback (+`anchor_crop_recovered`) —
  label readable as a text line but NOT locatable as a box, relocate/registration failed, field `_xsupplier`.
- **Why DO-NOTHING (gary designed a fix; Oracle SIGN-OFF-W/COND → build DARK / fallback DO-NOTHING):** the fix
  (an `xsupplier_lookup` companion threaded to `anchor.py:1253`, keep-clean-reject-garble via the readability
  predicates) is sound + fail-safe (kept value → Stage-4.5 flag → never auto-files), BUT (a) reward is the
  narrow text-fallback sliver only; (b) a kept stranger ref WINS Tier A (engine.py:3552, `located` includes
  `'anchor'`) and DEMOTES a would-be keyword auto-file to a flagged review showing a WRONG value on disagreement
  — a real auto-file-rate regression (never a silent misfile); (c) the FIRING path is CORPUS-INERT (no taught
  anchors in the born-digital harness; real anchors belong to confirmed suppliers), so it can't be validated —
  Oracle's flip gate needs a constructed taught-anchor `_xsupplier` case on the BF_/KO_/… corpus. Not worth the
  demotion downside for a corpus-inert edge on a single-supplier install. Revisit only if a real firing case
  appears on a genuine multi-supplier install. gary's full design + Oracle's conditions (A corrected framing /
  B demotion pin / C taught-anchor gate / D `test_doctype_scoped_format_gate.py` direct-call short-circuit /
  E single `(entry,is_xsupplier)` closure) are in the 2026-07-30 chat.

### Letterhead cold-start supplier reader  (confirmed at scale 2026-07-29)
- **Symptom:** cold (first-contact, no learning) supplier identity reads only from a `Supplier:`/`Bill
  From:` caption. The born-digital demo batch measured **~8%** supplier accuracy cold — name-as-text
  letterheads, footer-only issuers, and text wordmarks all return null. Resolves once learning/templates
  exist, so it's a first-contact gap.
- **Fix direction:** the designed-but-unbuilt `letterhead.py` **suggestion-only** reader (largest text in
  the top band → issuer). Only ever needs to carry doc #1. See memory `project_issuer_band_and_letterhead`.

### S1 band-graduate — real fix (column/geometry-aware issuer window)
- **State:** S1 (`TEMPLATE_IDENTITY_BAND_GRADUATE`, commit `958229c`) is built DARK and proven **INERT**
  on its target: two-column `BILL FROM | BILL TO` layouts put the issuer name AFTER the "BILL TO"
  recipient marker in the linearized text, so `_issuer_hint_band` truncates it out → no shed.
- **Fix direction (deferred, gary+Oracle):** a column/geometry-aware issuer window, OR a `BILL FROM`-
  anchored corroboration window that excludes the recipient column (Oracle C2 is the constraint).
  Memory `project_autofile_s1_band_graduate_20260729`.

### delivery_number / worksheet ref completion  (reggie, 2026-07-29)
- delivery_number went 0% → **45%** after adding its `field_patterns` entry — still partial (more
  label/format coverage + the footer/three-party layouts). worksheet `reference_number` stays **30%** —
  the "Worksheet No"/"Job No" labels must be added at the **type-scoped** layer (preset override / ⊕
  teach), NOT the global `_REF_ROLE_CAPTIONS` seed (reggie: global would collide with `job_no` + blast
  every custom ref field).

### ✓ FIXED — Set A warm cross-contamination  (2026-07-30, d9ec7d5 + flip 2b8bdb2)
- Loading live learning dropped new-supplier ref accuracy (Set A ref 84.7% cold → 50% warm). iris PROVED
  (isolation) it was NOT phash/fingerprint/anchor (all falsified) but the learned-shape `formats` store: the
  doc-type-scoped `('')` aggregate on a single-supplier install IS that supplier's ref convention, hard-nulling
  stranger refs at Stage 4.5. FIX (`SHAPE_WITHHOLD_SUPPLIER_SCOPED`, default ON): a `('')`-only verdict FLAGS
  not NULLS; supplier-scoped withhold byte-unchanged. Gate: score_demo A warm ref 55→89%, realdoc M=0. See
  memory `project_shape_withhold_supplier_scoped_20260730`.

### Name-presence veto residuals  (2026-07-31, Oracle-logged with the TEMPLATE_FIXED_NAME_PRESENCE_VETO sign-off)
- **Bank-less collision survives unflagged:** a collision onto a supplier with **no ≥3-word branding
  fingerprint** exits `_flag_branding_conflict` at the own_ratio-None fail-safe (engine.py ~1959)
  BEFORE the un-named branch — a conf-95 wrong `template_fixed` stamp stands unflagged and CAN
  auto-file. The supplier_prints_name ratio is exactly the evidence that could judge it where the
  bank can't — extend the veto ahead of that early-return (own slice + own gate).
- **`_doctype_fixed_supplier` is a DEAD GUARD in production** (found 2026-07-31 building the veto):
  it reads `f.get('key')` but the templates payload carries `field_key` (template_matcher reads
  `field_key`; only the unit fixture uses `key` — test_fixed_supplier_immune.py greens on a shape
  production never sends). The template-MISS fixed-supplier fill + its logo-immunity have therefore
  never fired live. Fixing = one word, but it ACTIVATES a dormant conf-95 stamp path — needs its own
  vet + gate (and the new veto already covers it once live). Do NOT "fix" casually.
- **Ratio-deflation poison loop:** each wrong-scope confirm under a name-printing supplier drags its
  prints-name ratio toward <0.80 and disarms the veto. Clean at flip (Copperfield 1.0/60,
  Ridgeway 1.0/101 — verified 2026-07-31); re-check at any mass-misfile incident.

### Needless-flag session residuals  (2026-07-31 evening; herald+gary+Oracle)
- **Slice C — `_center_in_any` overlap-fraction fix at source** (ocr/tesseract.py:76-85): the PSM-6
  supp merge's center-point dedupe lets an overlapping supp word through inter-fragment gaps →
  DOUBLED tokens in `ocr_text` for every consumer (the manufactured heading garble rung-2 now
  works around). An overlap-fraction test fixes it at source but changes OCR text corpus-wide —
  own session, own full gate. Do not bundle.
- **Demo-corpus identity residuals (pre-existing, measured in `demo_notes_gate.js`):**
  `SaltmarshSeafoods_purchase_order_01` reads issuer `'altmarsh Seafoods'` (leading-glyph clip);
  `_02` reads `Ridgeway Plant Hire` (cross-supplier identity collision). Both identical OFF/ON —
  the branding-primary redesign class (`project_identity_branding_primary_20260728`), plus the
  refuse-note holds on cross-supplier phash locks (herald's 172/175 — CORRECT protective holds).
- Demo gate + probes live in `stress_test/`: `demo_notes_gate.js` (sampled 2/supplier×type — no
  silent caps, logged), `heading_band_probe.py`, `geom_witness_probe.js`.

### Teach label pass-2 follow-ups  (2026-07-31)
- **Pass-1 type-heading gap:** teach still lacks a pass-1 `labelIsTypeHeading` reject (Review ⊕ has
  one at review/renderer.js:6792); pass-2 rejects headings (`isTypeHeadingLabel`), but a clean
  UNCLIPPED pass-1 heading read would still be offered. Port the reject to teach pass-1 + dedup with
  Review's copy (its test regex-extracts from renderer.js — move both onto the shared pure helper).
- **Review ⊕ two-pass adoption:** review/renderer.js ~3771-3786 builds the same open-loop 1.8× label
  band — same decapitation class, unverified there. Adopt the shared clip-gate + re-read
  (`clusterTouchesClipEdge`/`labelRereadRect`/`cropBoxToPageNorm`) in the ⊕ tool.

### ✓ SUPERSEDED for the V-class — clipped-suffix reconciliation SHIPPED ON (2026-07-31 night, `36a4a32`)
- The section below was AMENDED by Oracle after a traced single-doc run showed the 'V-69523' class is
  an `anchor_registration` box misplacement (~76px right of the value start) whose read WINS over the
  discarded correct keyword read — label-confirmed methods are shape-EXEMPT (engine:4692), so neither
  the crop-matte fix (pixels outside the crop) nor the escalation rung (trigger never fires) could
  touch it. Shipped instead: `_reconcile_clipped_suffix` (kill `CANDIDATE_SUFFIX_RECONCILE`, ON) —
  adopt the fuller keyword read of the SAME token from the always-on candidate ledger (suffix +
  digit-identity + shape-pass + confirmed-prefix membership), flag-only without prefix support.
  Gates: OFF byte-identical; ON ref 91.8→94.5%, M 8→7 zero new members, heals #121/123/124/136/137.
- **Amended Oracle rulings (2nd pass):** XRES escalation = DO NOTHING for now (both rungs; revival
  gate = a MEASURED count of withhold-branch abstains-after-GATE_REREAD on the corpus); oscar crop
  fix DEFERRED pending its own measured heal; **NEXT: garbled-anchor remediation sweep** (07-30-era
  taught rows with garbled labels, e.g. Ridgeway 'Inwotce No.' — re-teach or purge, then re-trace
  #121 on a clean anchor); registration.py fit audit ONLY if the ~0.03-norm misplacement survives
  remediation; 225 preset stays PARKED and the CURRENT 225 measurement is CONFOUNDED both ways —
  re-measure only after guard + remediation (added to C7 preconditions).

### Cross-res escalation re-read + "Faster (225)" preset — Oracle-gated plan (2026-07-31 night)
- **Origin:** live "Worksh Eet" garbled Add-type nudge at owner's `ocr_dpi=200` speed test. Full dpi
  sweep (202 docs, GT=confirmed): 150/200/240/250/260/275 each garble 1-4 tracked headings (different
  docs per res — decorrelated lottery); 225/280/300 clean; 280 only 7% faster (pointless). Realdoc:
  225 = type/supplier 100% (even heals #54, wrong at 300) but ref 90.1% vs 91.8%, **M 8→9** (prefix
  clip 'INV-35900'→'V-35900' crosses into auto-file; digit-dup 'PO-64334'→'PO-643224'). Scratch data:
  session scratchpad `filed*.tsv` / `rr300.txt` / `rr225.txt` (regenerable).
- **Oracle verdict (gary+oscar consensus vetted):** SIGN OFF W/COND on the escalation mechanism at
  **300-base only, dark**; **DO NOTHING (parked)** on the 225 preset. Killer fact (Oracle traced,
  overturning gary's stale-docstring read): `format_anomaly_checker._fold_shape` folds the digit-run
  length of ANY single-run shape — `'@@-#####'`→`'@@-#'` — so the 225 digit-dup class PASSES shape,
  never triggers escalation, and has ZERO in-pipeline guard. Length-invariance is BY DESIGN
  (`project_numeric_shape_fold`); do not revert it.
- **Build order (never bundle):** (1) oscar's crop fix — outward-rounded crop bounds + 12-16px white
  matte on field slices (cures edge-glyph drop at ALL res, incl. the 'V-xxxxx' class living at 300
  today on #121/123/124) — standalone, own switch, own realdoc M≤8 pass FIRST (it changes crop bytes
  everywhere, so it must precede the escalation baselines). (2) Slice 1 field rung `XRES_GATE_REREAD`
  inside `_maybe_gate_reread` (engine.py ~2729-2815/4782): injected `render_page_fn(page_idx,dpi)`
  from process_docs (pypdfium2 + recorded rotations; None for image-imports/born-digital), one cached
  alt render per (doc,page) keyed (dpi,pidx), independent LOCATE at alt res (no frame mapping).
  Lane A files clean ONLY IF: passes the exact failed check AND digits byte-identical AND base is a
  contiguous suffix with alpha-only prefix len 1-3 AND (C1) learned-shapes non-empty + ref/code field
  class only AND (C2) completed prefix ∈ confirmed prefixes via `ocr_corrector.lookup_prefix`
  (membership, not distance) — else lane B (cap 69 + corrected_to + note, customer-plain copy).
  Method stays original tier, never authoritative. (3) Slice 2 heading rung 3 `XRES_HEADING_REREAD`
  (same adopt contract as rungs 1-2; re-green `demo_notes_gate.js` ON+OFF — composes with 4a058a6).
- **Other conditions:** C3 PINs (digit substitution NEVER lane A; agree-but-still-fails = reject;
  never method-authoritative) · C4 RAM (alt-render cache ≤2 pages/doc, freed per doc — slow-PC
  feature must not re-create import RAM starvation) · C5 gates (300+ON vs 300 byte-identical-or-
  better M≤8; OFF byte-identical; probes #131/#121 lane A, #70/#163 lane B, stable no-fire control)
  · C6 merge seam: engine-emitted `corrected_to` (GATE_REREAD lane B, handler.js ~246) currently
  gets OPERATOR-grade veto power in the reprocess merge — add the pinned case to
  `test_reprocess_annotated_empty.js` + fix the comment; do NOT redesign the merge in this feature.
- **C7 preset revival (v2, only then "Faster (225)" returns):** trigger-widening length signal
  (single-group ref digit-run length differs from uniform in-scope confirmed length → fire re-read;
  cross-res agree → clean, disagree → lane B) + oscar's native-dpi-relative base/escalate rule +
  a gate asserting every new-wrong-at-225 doc is healed-or-flagged (absent-from-M-by-luck ≠ pass)
  + evidence on REAL 300-native scans (this corpus is 150-native; 225 there is an upsample — on
  real scans it's a downsample and likely worse). UI swap (150/200→225/300 + write-back snap) was
  edited then REVERTED per verdict — do not commit a Faster preset before C7.

### Validation slices S-A/B/C/D — gary-designed 2026-08-01 overnight, AWAITING ORACLE (not built)
- **Evidence base:** realdoc 202-doc residual M=5 + 8 regressions decomposed into classes; the #141
  delivery_number trace ('21/07/2026' committed to a REF field @88 silent). gary traced the WIN to
  Tier-A (engine.py:3764): the Ridgeway anchor row is an operator ⊕ teach (last_authoritative_at) →
  authoritative=True; Tier-A never consults confidence; `located` is BY FIAT for anchor_registration
  (anchor.py:1376 membership — even after relocate PROVED label_off_taught_position); ocr_min_conf
  is None for non-free-text (anchor.py:1497) → _ocr_clean blind; `alphanumeric` pattern contains `/`
  → a date has coverage 1.0. Registration rung also RESURRECTS a shape-failing read (anchor.py:
  1175-1177) and is _LABEL_CONFIRMED (shape-exempt everywhere). "Distrusted as witness
  (KEYWORD_ANCHOR_CORROB independence-fraud exclusion), trusted as winner" — the one-sided
  contradiction is the primary lever.
- **S-A date-in-ref flag** (kill DATE_IN_REF_FLAG): engine pass beside _flag_prefix_outlier (order:
  suffix-reconcile → S-A → prefix-outlier → S-B); ref-role/reference fields whose value FULLY parses
  as a date (validator.parse_date + full-string 3-component same-separator regex belt) → cap 69 +
  customer-plain note, NEVER null; exempt manual/template_fixed + scopes whose OWN shape accepts it;
  gary deviation FOR ORACLE: keyword_override NOT exempt (label authority ≠ value authority).
  PINs: '20260731'/'21/07'/'DN-24/07/26' NOT flagged; '12.05.11' FLAGGED (pinned trade-off).
  Highest rank: deterministic, near-zero regression surface, holds at EVERY floor (the note is the
  only floor-independent block — trust.js:601 flagged check).
- **S-B ref digit-run LENGTH profile** (kill REF_LENGTH_OUTLIER_GUARD, build OFF): ocr_corrector
  beside the prefix model — digit_run_profile tuples ('7602-1354-4'→(4,4,1)), build_length_index
  with DOMINANT_MIN_COUNT/SHARE + the weight-aware self-heal accept bars; exact tuple match; flag
  cap 69. Catches accretion (#33 'INV-12110') + digit-dup ('PO-643224') that the LENGTH-FOLDED shape
  cannot see (fold BY DESIGN, untouched, pinned). Rollover PIN: 'INV-1000' vs uniform (3,) FLAGS —
  accepted trade-off. Note precedence S-A > prefix-outlier > S-B.
- **S-C blind-geometry disagreement reconciliation** (kill BLIND_GEOM_DISAGREE_RECONCILE, DARK,
  flip=owner+gates): post-merge pass (suffix-reconcile pattern, ledger, no new OCR). v1 scope:
  winner method == anchor_registration EXACTLY (NOT inline/relocated — pinned, protects the
  2026-07-26 Tier-A re-teach fix; NOT rigid anchor_crop — already shape-gated); winner fails own-
  supplier shape; ledger has independent-stage (0_template/0.5_mapping/1_keyword) shape-PASSING
  disagreeing candidate. ADOPT when ≥2 independent stages agree normalise-equal (the #141 case:
  keyword_override@93 + template_mapping@90 both 'DN-24408') — a method inadmissible as corroboration
  witness cannot silently overrule two admissible witnesses; FLAG (cap 69, both values named) when
  only one. Deliberately narrows the authoritative-wins invariant for anchor_registration only
  ("the teach fixed the position, not the value" doctrine) — state in commit + pin.
- **S-D registration fit audit** (investigation only): measure per-fire n_inliers/residual/landmark
  spread/target leverage/provenance (07-30-era landmarks?) vs realised divergence (#141 = 0.047 norm
  vs the 0.02 inlier bar). Hypotheses H1 n=2 vacuous similarity fit / H2 leverage extrapolation /
  H3 stale landmarks / H4 similarity-vs-affine. Cheap gates if evidence: min_inliers=3, leverage
  refusal → keyword fall-through, or trust-cap 69+flag. Fix only on clean separation, zero clean-case
  collateral; else data remediation (re-pin landmarks), not code.
- **S-B2 conforming-profile confidence corroboration** (separate switch, DARK, own Oracle pass —
  never bundle with the flag slices): solo keyword read capped 85 whose digit-run profile AND prefix
  are both confirmed-dominant in a supported scope → +3 (the Stage-4.5 support boost falls 1 short).
  The direct MORE-auto-commits lever, alongside S-C's ADOPT lane and the unbuilt Stage-7 stage 3
  field_format_rules.
- **Expected residual after S-A+B+C:** {#65, #154, #86} interior stroke-level substitutions — only a
  second-render/second-engine witness could reach (the parked xres design's territory).

### Type-note placement — twice-misread as a supplier failure (2026-08-01)
- The type-refuse/ambiguity note attaches to the SUPPLIER row (engine `_flag_type_ambiguity`), so
  it renders under DOCUMENT ISSUER — the owner twice read a fully-resolved issuer@98 as "can't
  resolve the supplier". Follow-up: surface type-level notes beside the TYPE selector / in the
  summary band instead of under the issuer field (renderer placement; the emit could carry a
  `note_scope: 'type'` marker). Small, UX-only.

### Interior digit stroke-substitution — INVESTIGATED + ORACLE-VETTED, ready to build (2026-08-01 evening)
**007 measured pack + Oracle round complete** (oracle_log 2026-08-01 4th round; evidence preserved in
`stress_test/out/stroke_sub_2026-08-01/` — matrix.json ~30 reads/doc at 150-600dpi, per-stage traces,
600-dpi glyph exhibits). Axis = READING (placement clean on every exemplar; oscar crop-matte fix
REFUTED for this class). Substrate: 150-DPI-native JPEG rasters, digits ~10px, JPEG ringing closes
1px counters (2↔3, 9↔3, 5→8/9/3). THREE read chains flip independently (locate ~133dpi 1100px /
crop-ladder / full-page keyword — doc-291's one digit read three ways in one run). Tier-A precedence
commits the error (anchor.py:1037 nulls inline ocr_conf = structurally exempt from the Tier-A garble
gate); on #291 wrong inline@85 beat CORRECT keyword@85 sitting in the ledger at every DPI.
- **Class re-drawn (Oracle + main session both eyeballed exhibits): #86/#154/#285 = GT-POISON** —
  pages print well-formed '24/03/2026'/'DN-38884'/'WS-43842' vs contradicting confirmed values
  (30/30 unanimous high-conf reads = correct-OCR-vs-wrong-GT fingerprint). True OCR class = #65,
  #283, #291, #299 + the healed 259 signature. **REMEDIATION FIRST (owner): eyeball the 3 exhibits,
  then Learning Repair de-confirm → correct to printed value → re-confirm** (confirmed poison feeds
  live shapes/hints/S-B indexes — gt_overrides alone insufficient). Do BEFORE any gate baselines.
- **D1 BUILT + ON (same day): in-band digit-disagreement flag** — kill `DIGIT_DISAGREE_FLAG`.
  `engine._flag_digit_disagreement` LAST in the pinned note chain; comparator =
  `suffix_reconcile.digit_substitution_diff` (SHARED with future D2 — one impl, one pin;
  census-lockstep with `stress_test/census_digit_disagree.js`). Ref-role only; distinct-stage
  witness conf ≥60; 1-2 digit diffs on identical skeleton; flag-only cap 69 + corrected_to + copy
  directing to the DOCUMENT. **Gates all met:** census 300 docs → 1 fire = the #291 true catch,
  0.00% false (bar ≤3%); 31 pins green (`tests/test_digit_disagree.py` — C3 value-never-changed,
  S-B-territory exclusion, suffix-adopt interplay, ref-role-only, order pin); realdoc OFF-vs-ON
  diff = EXACTLY #291 silent→flagged, would-auto-file-wrong 9→8, values byte-identical corpus-wide.
  Census predicate kept ≤2 (0.33% fire-rate — no tightening needed). Dominant-snap exemption
  SKIPPED (census showed zero such cases — revisit only if a snap-winner false-fire ever appears).
- **D2 BAKE-OFF RAN ×2 — REFUTED BY MEASUREMENT, BANKED (do not build on today's numbers).** Oracle
  re-spec (witness = second-downsample-geometry locate read, NOT value-box crop) was probed twice
  over every Tier-A-won ref winner (234-doc then 296-doc corpus; single-token then line-join
  harvest — scratchpad bakeoff_d2{,_v2}.py, results in out/stroke_sub_2026-08-01/): **400→1100 =
  ZERO correct catches** (299 fires with a WRONG third reading 'WS-72098'; 65/283/291 abstain) at
  2.74-3.04% false fires (at/over the 3% hard bar). **600→1100 = ONE correct catch (#65
  'PO-24729')** at 1.30-1.71% false fires — 5 spurious review flags per ~300 docs (incl. two on the
  fresh Thornbury batch: 'PO-95717'→witness 'PO-35717' 9→3 — the substitution physics is chain
  noise both directions), ~0.7s/doc latency on ~every templated doc. **False:true 5:1 — worse than
  the needless-flags class the 07-31 session spent a day removing.** The 283/299 abstains are
  CHAIN-level (the alt-res page genuinely doesn't present the token same-skeleton), not harvest
  fidelity — measured with both harvests. REVIVAL CONDITIONS: a witness chain with measured ≥2-of-3
  class catch at ≤1% false (e.g. label-anchored band harvest may cut false fires — but cannot cure
  the abstains), or the class growing past ~3% of corpus. Honest post-D1 residual: #65/#283/#299
  silent (3 of 382 ≈ 0.8%), #291 flagged live by D1, #86/#154/#285 = owner Learning Repair.
- **D3 REJECTED (DO NOTHING): never-harvest-values-from-locate-pass** — inverts the July-31 arbiter
  premise (crop box routinely swallows label tails/clips prefixes — the traces' own anchor_reject
  lines show it), heals only #291 which D1 already flags, resurrects the clip class. BANKED future
  path instead: full-res re-LOCATE (solve box precision — 007-A's own revival precondition).
- Also REFUTED by measurement: global preprocessing/binarisation changes (no recipe at any DPI read
  the poison-free saturated cases; flips recipe-stable); 400-as-primary (fixed 283/299, broke 65
  worse + 285@400 lost PLACEMENT entirely — DPI non-monotone). Substrate fix out of app reach; a
  low-scan-quality import advisory = future barry idea.

### ✓ SHIPPED AND LIVE — Label-tail crop CLAMP (kill `ANCHOR_LABEL_LEFT_CLAMP`) — 2026-08-02
> Doubly stale, corrected 2026-08-08. It is no longer dark and no longer default OFF: shipped as
> `336585a` (Oracle had already GO'd the flip) and the live DB currently holds
> `anchor_label_left_clamp = true`, verified by a read-only settings query. Heading kept for its
> design notes; the "BUILT DARK / default OFF" claim below is obsolete — read it as history.
**Status: implemented per the signed design (all of C1-C7); 26 pins green
(`python_backend/tests/test_label_left_clamp.py`); gates run via
`stress_test/clamp_gate_diff.js` over two RR_CONSENSUS realdoc runs — see the 2026-08-02
handover for the G1-G6 results. Oracle ADJUDICATED 2026-08-02: ACCEPT-AS-RESIDUAL, GO on the
flip. AMENDED GATE LETTER: "zero UNRESIDUALED flips" (in-class + review-bound both runs +
provably witness-unreachable + logged with watch bars); the one residual = #218 (Vellum
interior 9→0 on the cleaned crop — page prints SO-68195, 600-DPI-verified,
zooms/doc218_600_wide.png). Watch bars W1 (auto-filed anchor_crop ref correction with
1-2-digit same-skeleton diff ⇒ kill pending re-gate) · W2 (stroke-sub residual ~3% revives D2)
· W3 (stroke-sub scopes nearing graduation: confirm against pixels until ocr_dpi 300).
Flip = set env `ANCHOR_LABEL_LEFT_CLAMP=1` (owner call).
Design + conditions kept verbatim below for the record.**
**The label-bleed class (007-measured, Saltmarsh 20-doc batch + corpus):** rigid taught crops are
built label-blind (+20px fixed pad, anchor.py:3282) while scans jitter (141px width spread + skew)
⇒ 13/16 crops intrude the label tail; fate trifurcates on the tail's OCR (clean→files ·
≤2-char debris→recovered@85 HOLDS EVERY BATCH · 3+char→inline rescue files · opposite jitter→
ws09 near-miss WRONG value). 47 recovered rows / 4+ suppliers = corpus-wide tight-gap topology.
Evidence: scratchpad geom_300.json + traces (session 2026-08-01); oracle_log entry.
**Fix (dark, kill `ANCHOR_LABEL_LEFT_CLAMP` default OFF):** located-label LEFT-edge clamp at crop
derivation — (P) caption-band mirror in the LOCATED frame. Conditions C1-C7: C1 expected-value-left
= located label top-left + STORED OFFSET (:3508 convention), never the taught box (frame trap —
fixture pin that a taught-frame impl FAILS); C2 authoritative+real-label+direction right+offset
present+locate+_located_at_taught_position, else byte-identical; C3 structured val_types only
(free-text ladder re-crop bypasses); C4 all four crop sites (:519/:685/:1076/:861 cross-check) or
pin the asymmetry; C5 in-crop degenerate reverts to UNCLAMPED (never refuse); C7 reuse the :1391
locate. Gates G1-G6: OFF==ON byte-identical outside the class · zero recovered rows auto-file-
eligible · ws09 identical ON/OFF · unit pins (merged-box/tight-gap/no-locate/non-right/(P)-twin/
C1-frame) · throughput ≤2-3% · total realdoc flag count must not rise · realdoc M=0 zero value
flips · Saltmarsh 20/20 ref auto-file-eligible 0 recovered. Sequencing: clamp → oscar matte
(label-aware, bounded by clamp) → full-res re-LOCATE independent; caption-prefix strip stays DARK
as the no-locate spare.
- **Cured sub-class (6237398): merged-doubled-digit** — REF_LENGTH_WITNESS_RECONCILE ON heals the
  'WS-1904'-for-'WS-11904' family from the ledger on the artifact's fingerprint (one digit inserted
  adjacent to an identical digit); rollover-drift pinned unadoptable; authoritative winners get
  flag-with-suggestion only.
- **Second live exemplar + a cheaper sub-class (2026-08-01, Vellum worksheet_18):** page prints
  'WS-11904'; anchor_inline read 'WS-1904' (doubled '1' merged — segmentation, not substitution)
  and WON the tie over keyword's CORRECT 'WS-11904' (both @85, anchor tier outranks). S-B FLAGGED
  it live (4-vs-5 digit note — the guard's first real catch). The trace shows the cure candidate:
  an inline-vs-independent-read DIGIT-COUNT disagreement arm — when a same-field ledger candidate
  PASSES the scope's length profile that the winner FAILS, prefer/flag (the S-C pattern extended
  to anchor_inline, currently pinned OUT to protect the 07-26 re-teach fix — that pin needs its
  own Oracle round before any widening). Segmentation drops ARE decorrelated across reads (keyword
  had it right) unlike pure stroke substitutions.
- **Third live exemplar (2026-08-01 ~15:42, owner screenshot, Vellum worksheet_01):** page prints
  'WS-73541'; anchor_inline read 'WS-7354' (TRAILING '1' dropped — the locate-chain 1100px thin-glyph
  loss, 007-measured mechanism) and won Tier-A over keyword's CORRECT 'WS-73541'@85; anchor_crop had
  the right digits but swallowed the label tail ('Vo. WS-73541') → credibility-rejected rx 25%. S-B
  FLAGGED live (4-vs-5 note + WS-73541 suggestion, Accept path used). Correct current behaviour;
  strengthens the digit-count PREFER arm's revival case (correct value passed the length profile the
  winner failed, in-band, twice).

### ✓ SHIPPED — Home "Open Mailbox" deep-link — OWNER 2026-08-02
> Resolved by `b67688a` (new open-search-window-at channel) — see the SHIPPED list at line ~595.
> Ticked 2026-08-08.
**Owner:** "the open mailbox button in home just opens the search window, not the mailbox."
The WAITING-ON-YOU card's button (main/index.html:~842) opens the Search window cold; the
user then has to find and click the Mailbox toggle themselves — the button promises a place
it doesn't take you.
**Fix shape (the open-review-window-at pattern):** a pending "open at mailbox" target —
`open-search-window-at('mailbox')` (main stores the target; the search renderer consumes it
once on load via a `get-search-target` read, or receives a `search-goto` event when the
window is already open) → toggles the Mailbox view (`SearchMailbox` toggle path) on arrival.
Same mechanism generalises later ("open at recycle bin", "open at doc N").

### ✓ SHIPPED — Search preview error-state hardening (eternal spinner) — OWNER 2026-08-02 (live repro)
> Resolved by `bf9fe90` (selectDoc guarded, honest error state, pin `test_preview_error_state.js`) —
> see the SHIPPED list at line ~592. Ticked 2026-08-08.
**Owner:** "when i click a doc in search i see a spinning icon but the doc doesnt load."
**Immediate cause (that session):** stale-main — the running app predated `b747676`'s new
`get-document-detail` IPC while the reopened search renderer already called it; the invoke
rejected ("No handler registered") and NOTHING catches it. Cleared by an app restart.
**The real defect it exposed:** `search-preview.js selectDoc()` has NO error handling — both
awaits (`getDocumentDetail`, then `getDocumentPages`) are bare, so ANY fetch failure (missing
handler, DB hiccup, doc deleted mid-click, IPC error) leaves the placeholder spinner forever
with zero feedback — the exact silent-failure class Chris keeps catching.
**Fix shape:** wrap selectDoc's fetch sequence in try/catch → on failure replace the spinner
with an honest state ("Couldn't load this document — try again or reopen Search." + the
short error) and clear it on the next selection; same guard on the mailbox row click and
resubmit (they share the fetch). Bonus hardening: a renderer-side "handler missing" message
that says "the app was updated — restart to finish" (the stale-main class keeps producing
exactly this symptom after main-process commits; a truthful message turns a mystery into a
one-line instruction). The renderer-error diag forwarders (08-02) already log the rejection —
the log line exists; the SCREEN state is what's missing.

### Custom approval stamp: placement, resize, and the decision note ON the stamp — OWNER 2026-08-02
**Owner:** "can we make the approval stamp custom in that you choose where it goes and can
resize it to fit a blank area on the page. Can we also add the notes from the approval to
the stamp?"
**Today:** `src/services/pdfStamp.js` `stampWorkflowDecision` draws a FIXED stamp (position/
size hardcoded) on the decision copy.
> **CORRECTION 2026-08-10 — step 1 below was ALREADY DONE when this entry was written; the claim
> that the note "is not printed on the stamp" is FALSE and was never true of the shipped code.**
> Verified at source: `stampPdf` accepts `notes`, word-wraps it to the panel width via `wrapText`
> (`pdfStamp.js:87`) and draws it under the By/Date meta lines (`:111-114`), with a `MAX_NOTES = 600`
> guard (`:16`, `:66`); `stampWorkflowDecision` passes `notes: comment || ''` (`:151`); and
> `workflowService.resolve` hands that same `comment` to BOTH `resolution_comment` on the route
> (`:292`) and the stamp call (`:319`), so what is printed is exactly the resolution note. **Only
> steps 2 and 3 remain open.** Residual nit, since it is the one thing step 1 specified that is
> genuinely absent: long notes are TRUNCATED BY REJECTION, not elision — over 600 chars `stampPdf`
> throws, `stampWorkflowDecision` swallows it, and the decision copy is silently NOT STAMPED AT ALL.
> Eliding at the wrap instead would be strictly better and is a two-line change.
**Shape of the work:**
1. ~~**Note on the stamp**~~ — **ALREADY SHIPPED, see the correction above.** (The elide-don't-throw
   nit is the only thing left in this step.)
> **STEP 2 SHIPPED 2026-08-10 (per-install default), STEP 3 STILL OPEN.** `stampPdf` now takes a
> normalised `box {x, y, w}` with a TOP-LEFT origin (matching every other geometry in the app; the
> flip to pdf-lib's bottom-left origin happens once, inside stampPdf) and scales the whole stamp —
> headline, meta lines and panel — from the chosen width, so a bigger stamp stays readable instead
> of growing an empty box. Settings → Licensing gains an "Approval stamp" card: a 3×3 position
> picker, a size slider, and an A4-proportioned live preview in the same coordinates the PDF uses.
> Stored as one `stamp_placement` settings row; **UNSET is meaningful** (it means the built-in
> top-right corner), which is why Reset clears the value rather than writing a corner-shaped one.
> Anything malformed parses back to unset — a bad setting must never stop a decision being stamped.
> Placements are clamped at render, so one saved on A4 cannot push the stamp off a different size.
> **The two-approvals-share-one-path wart is FIXED in the same change**: stamped copies are now
> per-route (`…APPROVED-stamped-r12.pdf`), and the route id is sanitised so it cannot traverse.
> Legacy copies keep resolving — nothing recomputes the path to FIND a file, every reader uses the
> stored `route.stamped_path`. Pinned in `src/services/test_pdfstamp.js` (13 checks).
> **STILL OPEN:** the per-DECISION override (drag/resize the rectangle on page 1 at decision time)
> and step 3's whitespace auto-suggest. The per-install default covers the common case — a business
> stamps the same spot every time — so the interactive picker is now a refinement, not the feature.
2. **Placement + resize** — an interactive step at decision time (or a per-install default in
   Settings → a "stamp position" picker): show page 1 in the stamped-viewer-style pane, drag
   the stamp rectangle to a blank area, resize by corner; persist per-install default
   (settings key) + optional per-decision override. pdfStamp takes {x,y,w,h} normalised.
3. Consider auto-suggest: pick the largest whitespace region on page 1 (cheap raster scan)
   as the default landing spot — "fit a blank area" without the user dragging every time.
**Watch-outs:** the stamped file is a DERIVATIVE (original untouched) — no learning/extraction
impact; the known wart that two approvals on one doc share a stamped path (second overwrite
wins — eric 2026-08-02) should be fixed alongside (per-route stamped filenames); Print-Slice 2
(stamped printing) consumes whatever pdfStamp writes, so land this before/with it.

### ✓ SHIPPED — Core Search re-skin to the detached-client design — OWNER 2026-08-02
> Resolved by `d7ab2e2` (the component port — `src/windows/search/search-components.css`, a RE-SKIN
> layer that changes no ids, no emitted class names and no logic/IPC) + `23109fb` (the follow-up
> markup pass: tabular fields, field-data rows, mono detail). Tinted state chips, the segmented
> mailbox control, the lead search input and pill filter buttons are all live in core. Ticked
> 2026-08-10 after verifying the file exists and carries `.chip-btn`/`.segmented`/`.rolechip`.
> Outstanding follow-up named in the original entry: the Chris VISUAL round, and the reverse
> inheritance (core's cap note / de-pathed rows / secure viewer / teaching empty-states → client).
**Owner:** "the search dialog in the search client looks a lot more modern and graphical than
the search feature in the core app — replicate the design of the search client in the core
app — it looks more robust."
**What the client has that core lacks** (client/renderer/index.html): a designed component
system — tinted state CHIPS (`.chip.confirmed/.pending/.rejected…` pill + rgba state tints),
`.rolechip`, count `.badge`/`.seg-badge`, `.chip-btn` filter pills, `.segmented` control
groups, SVG icon buttons (`mkBtn`+`ico()`), meters — where core's Search window renders a
plainer list (`.result-item` rows, text badges). Both already share theme.css tokens, so this
is a COMPONENT + LAYOUT port, not a palette job.
**Shape of the work:** (1) port the client's component CSS into the core Search window (or a
shared `search-components.css` both import — preferred, stops future drift); (2) markup pass
over the ~8 core search renderers (search-results/preview/actions/mailbox/workflow/query
inline-render their class names — logic and IPCs UNTOUCHED, re-skin only); (3) load the
`scan-finder-frontend-design` skill for the design pass; (4) keep every contract suite +
test_no_global_collisions green; (5) a Chris VISUAL round after (he can screenshot now —
capture-window.ps1) to judge it as a customer.
**Guardrails:** don't fork behaviour between the two apps — where the client's affordance is
better (chips, segmented boxes), core adopts it; where core is ahead (cap note, de-pathed
rows, secure viewer, teaching empty-states), the client inherits LATER (named follow-up).

### ◐ SLICE 1 SHIPPED — Focus-fix FIELD SWEEP + forward convention — OWNER 2026-08-02 (live repro on the workflow note)
> **Slice 1 shipped `01a2a43`** (eric-vetted): `preload.js` gained an AWAITABLE
> `ensureWindowFocusAsync` (invoke, so a programmatic focus can be ORDERED after the widget-focus
> edge — the fire-and-forget send can't be sequenced); new `src/windows/shared/dialogFocus.js`
> exposes `focusField(el)` + idempotent `confirm()`/`alert()` instrumentation; the live repro
> (the workflow Reject note) now routes through `focusField`; Search/Main/Teach load the wrapper
> (they had NONE, so every native dialog in them — including Search's 6 sites — was unarmed).
> Pinned in `src/lib/test_focus_repair.js`.
> **STILL OPEN (steps 1 and 3 below):** the full 42-site programmatic `.focus()` audit, and the
> regrow-proof STATIC PIN (every `confirm(`/`alert(` in a window renderer must have a
> `markFocusSuspect` within N lines; every programmatic `.focus(` on an input must go through the
> shared helper). eric called this multi-session. The forward convention stands regardless.
**Repro (owner, live):** typing "I approve" into the workflow note field (`.wf-note`,
search-workflow.js `_decisionBar`) on a doc routed to them hit the keyboard-focus desync
(no caret / keystrokes dead until clicking out of the app and back).
**Why it slipped past the systemic cure:** the universal repair is a PRELOAD `pointerdown`
chokepoint (preload.js ~:454 — heals every `input/textarea/[contenteditable]` PRESS in every
window). It cannot fire when a field gains focus PROGRAMMATICALLY — and the workflow note does
exactly that (`note.focus()` on the empty-note Reject path), as do other `.focus()` call sites
around the app. Second suspect class: native `confirm()`/`alert()` sites that don't call
`markFocusSuspect()` afterwards (the suspect flag is what forces the deterministic
blurWebView→wc.focus edge on the NEXT press — main.js ~:943-976).
**The sweep (build later):**
1. Enumerate every programmatic `.focus()` on a text control across all window renderers;
   route each through a shared helper that performs the repair edge first (invoke
   `ensure-window-focus` then focus — the same (A)+(B) sequence the chokepoint does), or
   simulate the chokepoint by dispatching through it.
2. Enumerate every native `confirm()`/`alert()` site; ensure each calls
   `window.docusnap.markFocusSuspect()` on return (several new dialogs landed 08-02 —
   delete-all rewords, counted Empty-bin, split guards — verify all).
3. A source-scan PIN (contract-test style): every `confirm(`/`alert(` in a window renderer
   must have a `markFocusSuspect` within N lines, and every programmatic `.focus(` on an
   input must go through the shared helper — so the class can't regrow.
**Forward convention (owner rule): every NEW field or native dialog ships wired to the focus
repair as part of its implementation — reviewers treat a bare `.focus()`/`confirm()` as a
defect.** Memory: `project_focus_repair_mechanism` carries the original design.

### ✓ SHIPPED — Document-detail DTO (finish the de-pathing) — NAMED 2026-08-02 (Oracle C3)
> Resolved by `b747676` — `get-document-detail` is now `dto.projectDocumentDetail` (the /v1 shape
> verbatim), CALLER-AWARE exactly as Oracle demanded: the full read stays Review-only, so Review's
> page preview (`doc.folder_path`) and name-presence check (`doc.ocr_text`) are untouched. Pinned
> in `src/windows/search/test_search_detail_depathed.js`. Ticked 2026-08-10.
> **Still open from the same entry (lower priority, same class):** `get-review-queue` /
> `get-deferred-queue` / `getByIds` still ship `SELECT d.*` into the admin/edit-only Review window,
> and the raw shell channels (`open-file`/`show-in-explorer`) still exist pending a main-side
> `open-filing-slips-pack` IPC.
The search ROW surface is de-pathed (`a58bc10`), but `get-document-with-extractions` →
`previewService.getDocumentDetail` → `getById` `SELECT *` still ships the SELECTED doc's
stored/working/folder paths + full ocr_text to the search renderer on every row click (and to
the mailbox click + resubmit flows). Fix = a caller-aware `dto.projectDocumentDetail` in
previewService. **ORACLE'S EXPLICIT WARNING — this must be CALLER-AWARE, not a global strip:
Review consumes `doc.folder_path` (review/renderer.js:~1261 page fetch) and `doc.ocr_text`
(~2489, ~5099 name-presence) from the SAME IPC — a blanket strip breaks Review's page preview
and name-presence check.** Same class, lower priority: get-review-queue / get-deferred-queue /
getByIds ship `SELECT d.*` into the (admin/edit-only) Review window. Also the true end-state
for the raw shell channels: a main-side `open-filing-slips-pack` IPC, then DELETE
open-file/show-in-explorer (the slips round-trip is their last legitimate caller).

### ◐ APPETISER SHIPPED — Workflow due dates + pending nudges — BANKED 2026-08-02 (Chris r4 card 7, bob-vetted)
> **The ageing chip shipped 2026-08-10** — the night-sized half named at the bottom of this entry.
> Open routes (`pending`/`claimed`) in the mailbox rows now carry "waiting 5 days" past a 3-day
> threshold, warming to the warn tint at a week and switching to weeks past a fortnight. No schema,
> no scheduler, no new notification event types (the toast event list stays PINNED and untouched).
> Silent under the threshold on purpose — a chip on everything is a chip on nothing, and the
> standing rule is minimal interaction. `created_at` is SQLite `datetime('now')` with no zone
> marker, so it is parsed as UTC EXPLICITLY; reading it as local time would shift every age by the
> local offset. **Still open:** the full `due_at` schema + scheduler + overdue surfaces, and the
> same chip in the DETACHED CLIENT's mailbox (core-only today — the client has its own renderer).
Chris's "what paper never managed": a due date on a route ("needs an answer by Friday") + a
gentle nudge for items sitting pending. Full build = `due_at` schema + a scheduler + overdue
surfaces + NEW workflowNotify event types (the toast event list is PINNED — extending it needs
its own Oracle pass). NOT night-sized; product value real but roadmap-tier (his switch-week
conditions were the Reject fix + the approval record, both done/underway).
**Night-sized appetiser (no schema, no scheduler): an ageing chip on open rows/banners —
"waiting 6 days" computed from `document_routes.created_at`, shown past ~3 days.** Roughly half
the nudge value for an evening.

### R2 cohort pick admission — DEFERRED with revival evidence (Oracle 2026-08-01)
- Banked from the type-refuse deadlock arc (11b7ae9 shipped R1+R3+reword instead). R2 = admit a
  band-13 _letterhead_cohort member with document_type_slug == detected_slug into the Stage-0 PICK
  when title_trusted (heals doc #2 of a new type with zero confirms). REVIVAL EVIDENCE: after
  R1+R3 live, the refuse-note class still recurs materially (more than the expected single
  teach-window note per new supplier-type pair) on the demo gate or live. Conditions if revived:
  trusted-title gate only; detail-veto ordering intact; margin-3 untouched for the untrusted path;
  cohort sibling passes the SAME downstream qualification gates (no gate bypass); cohort anchored
  on an in-margin member's non-null dominant_supplier.

### Template-system FINE-TUNING + "all methods, then verify" — OWNER 2026-08-02 (two live exhibits)
Owner-declared next major arc: "We will work on fine tuning the template system soon." Two live
exhibits from the Customer Doc Test teaching run show the per-doc method mix swinging wildly:
- **Exhibit A (SFDEV reprocess):** trace shows ONLY `template_mapping` + `keyword` — no taught/anchor
  methods despite green dots — and the mapping reads are "getting the anchors and the values wrong".
- **Exhibit B (NorthgateTextiles_purchase_order_02.pdf):** the OPPOSITE mix — po_number/po_date won by
  `anchor_inline` (the `anchor_crop` candidate read `'No. PO-2590!'` and was rejected not_credible —
  the label-tail intrusion class), supplier via `hint_t…`; NO template_mapping row at all (identity
  pill says "Remembered positions") and NO keyword candidate in the trace. Value ends CORRECT at 97%
  yet still carries the "couldn't be confirmed anywhere else on the page" flag.
**Why the mix swings (mechanism, partially verified):** the engine is precedence-first-win with
skip-if-credible fast paths — Stage 0.5 only produces when a template MATCHED with mappings for the
field; anchor rungs skip when an earlier read is already credible (anchor.py "already found by
higher-priority anchor" / `_skip_rigid` / fast-happy-path comments); keyword rows appear only when a
pattern produced a candidate. So each doc shows a different winner chain — nothing runs "everything,
every time". A wizard teach lands as Stage-0.5 mappings, so its reads surface AS `template_mapping`
(there is no separate "taught" label); ⊕ Review teaches surface as `anchor_*`.
**Owner's design direction (the banked feature): ALL methods applied, then the data VERIFIED** —
cross-method consensus instead of first-authority-wins. Foundation already exists: the always-on
candidate ledger, 2.6b located corroboration, S-C distinct-stage witness, suffix/length reconcile.
Design questions for the session: full-run cost (every rung every field = real OCR spend — probably
verify-on-disagree or verify-on-flag, not brute force), how consensus interacts with authority
precedence, and whether the corroboration flag should stand down when methods AGREE (Exhibit B's
correct-but-flagged read).
**Investigation list:** why Stage 0.5 missed on Northgate _02 (template match failure on the scan
rendition? mappings not covering the fields? scope key?) · why keyword produced nothing there ·
whether an authoritative ⊕ anchor properly outranks a wrong template_mapping read when both exist
(Exhibit A's complaint) · dev-inspector labelling — surface "taught (wizard)" vs "taught (⊕)" so
green dots and trace rows reconcile for the owner.

### SFDEV EVERY-STEP trace — OWNER 2026-08-02 (next session, NO code this session)
**Owner rule: the dev inspector must show the RESULT OF EVERY STEP so an error can be read
without re-running — "so I know exactly what the system was dealing with". That is the point
of the dev feature.** Today's trace shows the winner chain + competitive candidates; the
skip-if-credible fast paths are mostly SILENT — a stage that never attempted looks identical
to a stage that attempted and lost, which is exactly the confusion behind Exhibit A/B above.
**Build (next session):**
1. Emit a trace event for EVERY stage/rung per field — attempted (candidate + accept/reject +
   reason, as now) AND skipped (`{stage, rung, field, skip_reason}` — "already credible from
   template_mapping", "no template matched", "no anchors in scope", "no keyword pattern hit",
   "cross_supplier_placement_skip", …). The skip REASON is the data.
2. Inspector renders the full per-field ladder: every stage in pipeline order with its
   outcome — produced/won, produced/lost-to-X, rejected(reason), skipped(reason).
3. Cost guard unchanged: events only under `--trace` (inspector/console open or diag logging) —
   normal processing stays byte-identical; skip events are cheap strings, no extra OCR.
4. Pairs with the fine-tuning arc above: the every-step ladder is the observability that the
   "all methods, then verify" design will be judged against.

### Digital ↔ scanned bleed (same supplier, divergent layout)
- **Confirmed (Set B warm):** a digital doc reusing a live name inherits the scanned identity (**supplier
  90%**) but the scanned template's field geometry doesn't fit the digital layout (**ref 29%**, held).
- **gary's least-invasive fix (deferred):** extend the `_located_at_taught_position` layout gate to
  **same-supplier** authoritative rigid reads (today cross-supplier only, `anchor.py:~1404`) → a taught
  absolute box fails toward review when its caption isn't at the taught position on a divergent layout.
  NOT a source-partition (that's wrong for production — same supplier should share learning).

---

## Type detection

### TYPE_PRESENCE_VETO — Slice 0 (band reader) + Slice 2 (auto-type cure)  (night 2026-07-28)
- Slice 0: a title-band PSM-11/upscale reader (`read_title_band`) to erase the veto's ~1.5–2.3%
  fail-safe false-holds and feed the cure. Slice 2: arm-the-refuse so legible titles auto-type correctly
  — **flip LAST**, after the identity fixes soak; biggest regression risk (needs a full-corpus per-doc
  type-flip gate). Memory `project_type_presence_veto_20260728`.

### Identity branding-primary separation  (night 2026-07-28, designed)
- Vellum/Larkspur phash collision (64-bit hash = LAYOUT not mark). Fix = branding-PRIMARY supplier
  separation, coarse recall-only, 256-bit mark corroborates. Vellum PDFs are image scans → Slice B
  (reprocess) cure; Option C (geometry) = fresh-import SUGGEST-only. Memory
  `project_identity_branding_primary_20260728`.

---

## Testing infrastructure

### Install preset types + total/line-item fields
- The live DB has only 5 doc types (invoice/sales_order/purchase_order/delivery_note/service_worksheet)
  and **no total/line-item field on any type**. Install credit_note/quote/statement/receipt (Settings →
  Add from catalog) + add a total field, then re-run `score_demo_digital.js` to cover all 9 demo types +
  money extraction (currently untestable). Can be scripted into a copy DB.

---

## Security / hardening

### Cython engine + arm fuses + asar rungs  (discussed 2026-07-29)
- The extraction engine ships as sourceless `.pyc` (a speed bump — bytecode decompiles back to
  near-source). `.pak` = Chromium resources (non-issue); most `.py` = third-party libs + thin entry
  shims. **Real upgrades (deferred, own session — build-chain change + full smoke):** Cython-compile the
  engine → native `.pyd`; arm the Electron fuses (`HARDEN_FUSES`, RunAsNode/inspector off); the deferred
  asar rungs B/D/F/E (bytenode/obfuscation). Plan: `docs/BUILD_HARDENING_PLAN_2026-07-26.md`. Framing:
  raise the bar, not "uncrackable" — the **licensing gate** is the commercial moat, not code secrecy.

## Pure-vertical-inside-column seat clip — row-seat-mismatch sensor (open; named by Oracle 2026-08-06)
`TEMPLATE_EDGE_CUT_RELOCATE` (the placement pivot) only fires on a CUT-DETECTED clip —
`_find_edge_cut_words` is a HORIZONTAL sensor (left/right box edge straddles a row-band word). A taught
box seated too high/low whose value is fully INSIDE the box's x-range (a pure-vertical clip, no
horizontal word cut) never arms the guard, so neither the grow nor the relocate triggers — it stays
today's behaviour (clean/garbled abs commit). Need a distinct sensor: a full-page word overlaps the
box column but its OWN bbox is vertically mis-centred vs the read box (seat error), independent of any
horizontal cut. Then route it to the same `_edge_cut_relocate` re-seat. Repro leads: template_mapper.py
`_find_edge_cut_words` (horizontal only), `_snap_box_to_words` row-band admission. Own advisor→Oracle→
gate round.

## Stage-2 — snap-union witness CLEAN upgrade on the RE-SEATED box (deferred; Oracle 2026-08-06)
`TEMPLATE_EDGE_CUT_RELOCATE` Stage-1 commits the re-seated value FLAGGED (pre-fill for review) unless it
earns clean via confirmed/provisional shape consent. The shelved `_snap_union_witness` (net-negative on
a GROWN box) is SOUND when corroborating a PLACEMENT-CORRECT re-seated box — that would clean-heal the
teach-once no-history case (e.g. Larkspur delivery_docket_06 DN-58038, whose garble shares no glyphs
with the truth so the frag-tie can't clean it). NOT verbatim reuse: `_snap_union_witness` is written
against `grown`/grow-`edges`; feeding the re-seated box needs new plumbing + its own pins + its own
re-seat-frame regression gate (do NOT ride the headline "silent clean heal" on un-shelved code). Own
switch, own gate round.

## Taught DATE misread landing on a DIFFERENT valid date (owned elsewhere; Oracle C6 2026-08-06)
`TEMPLATE_DATE_INVALID_YIELD` heals only the IMPOSSIBLE-date subset of the taught-date tilt-misread class:
a taught date box that OCR-misreads a glyph such that the result is an unparseable calendar date
('03/04'→'33/04') now yields to a valid keyword date, flagged. But a misread that lands on a DIFFERENT
VALID date ('03/04/2026'→'08/04/2026', or a DD-MM/MM-DD order flip) PARSES — `parse_date` returns a date,
the yield branch is skipped, and the wrong-but-valid taught date can win (and, being a clean date @94,
auto-file). This valid→valid misread class is NOT caught here; it's owned by the shape/witness-reconcile
machinery + the crop-quality/deskew improvement (a tight taught date crop on a tilt is the root reading
fragility). Repro leads: LarkspurInteriors_invoice_08 (the impossible-date instance this fix healed);
engine.py `_invalid_taught_date_yields`. The complementary cure = extend the placement/deskew arc to the
date rung so the taught date box survives the tilt rather than leaning on the keyword fallback. Own round.

## Taught date/code crop read-path frame election (DIAGNOSED, design captured, build fresh — 2026-08-06)
> **⚠ PREMISE SUPERSEDED 2026-08-07 — DO NOT BUILD THE RAW-FRAME ELECTION.** Annotated 2026-08-08.
> A fresh 4-doc probe (filed Larkspur invoices, −0.5°…2.3°) REFUTED the premise below: the deskew frame
> is NOT the lever — the TIGHT TAUGHT BOX clips the leading glyph on BOTH frames at every angle, and raw
> is sometimes WORSE. The fix that actually shipped is `TEMPLATE_PAD_WINDOW_READ` (`837b7d6`, dates only,
> default OFF): a padded row-bounded re-read that FLAGS a confident disagreement and never swaps. See the
> banner at the top of `docs/designs/DATE_CROP_DESKEW_READ_2026-08-06.md` and the memory
> `project_pad_window_date_read`. The text below is retained as REJECTED PRIOR ART only — it is left in
> place because it records the empirical probe and the RED-gate pitfall, not because it is a work item.

ROOT of the taught-date-crop misread class (invoice_08 03→33, invoice_14 2026→2096, and the same-year
03→08 slice the merge-layer yields can't catch). PROVEN empirically (`<scratchpad>/datecrop_probe.py`):
on a 1.8° scan the taught date box read on the DESKEWED frame misreads the leading digit, while the RAW
frame + a small pad + psm6 reads it CORRECTLY — deskew degrades the 0.2–2° read (Tesseract self-tolerates
≤~2°). Fix direction (Oracle-BANKED): a read-path angle floor / raw-preferring frame election for CROP
reads (read raw pixels at level-composed placement via the level→raw inverse), + a psm6+pad rung for tight
code/date crops. CORE-pipeline change; a prior naive attempt (DESKEW_RAW_CROPS) RED-gated on placement, so
it MUST route through teach_angle_compose's level frame + the deskewedNormToRaw inverse. Full multi-slice
design + gate + the RED-gate pitfall: `docs/designs/DATE_CROP_DESKEW_READ_2026-08-06.md`. Owner chose to
build it from a fresh session (core change, not the tail of a marathon). Supersedes the C6 same-year
order-flip residual (that class is THIS fix's job — not another merge-layer guard).

## 2026-08-08 — totals-fix follow-ups + debug-table Slice 2 (owner asleep, autonomous session)
Context: HANDOVER_2026-08-08.md. The SFDEV debug-table shipped + two DEFAULT-OFF totals fixes shipped
(NET_MISREAD_TOTAL_FLAG + TOTAL_GROSS_LABELS, gated M=0, owner to flip). Deferred:
- **Customer field degrades on teach** — teaching ONE credit note drops the recipient field from cold-keyword
  79.6% to taught 41.7% (corpus scorer): the taught fixed box lands on label captions ("BILL TO"/"SITE ADDRESS")
  across variant layouts. All get a name-quality review flag today (safety holds). Design lead: for a taught
  free-text/name field that FAILS its quality gate, fall back to / corroborate with the keyword label-hunt read
  (keyword customer is 79.6%). Needs gary/reggie + Oracle; gate = customer lane up, M=0.
- **Robust shadow vat_tax read** (inline rate "VAT @ 20%") → lets the EXISTING `_reconciliation_pick_total`
  AUTO-CORRECT net→gross (turns the net-misread FLAG into a silent heal). Bigger blast radius; own switch/gate.
- **Extra gross labels (residual)** — reggie flagged "Balance Outstanding"/"Outstanding Balance"/"Balance Owing"
  as payable-but-statement-collision-risky. Add under TOTAL_GROSS_LABELS only after a full-corpus false-flag vet.
- **Debug-table Slice 2 — winning-crop persistence.** Today `debug_values.json` records value/method/conf/wrong;
  the slice-copy backend is built + path-defended but the renderer sends slicePath:null. Slice 2 = accumulate
  each doc's winning-slice-per-field at reprocess-complete while the SFDEV console is open (owner's gate:
  "slices saved only on reprocess with SFDEV open"), reusing the 63e0cb3 target_geom bbox-match. Then Submit
  copies the real crops into the debug dir.

## 2026-08-10 — THE TWO 08-09 FLAGS WERE NEVER REACHABLE; BRIDGED (still DEFAULT OFF)

`TEMPLATE_FORMAT_FAIL_YIELD` and `CUSTOMER_PO_LABELS` were built, measured (gate GREEN / M=0) and
recorded as "awaiting OWNER FLIP" on 2026-08-09 — but **neither had a Settings bridge**. They were
read straight from `os.environ` in `engine.py:2158` and `keyword.py:1031`, and `npm start` injects
no env, so **there was nothing for the owner to flip**: the only way to reach either was a harness
arm. Shipped OFF for ever, silently.

**This is the SAME CLASS as the five flags bridged on 08-09 NIGHT and it recurred one day later.**
Measuring a flag and shipping a flag are two different jobs. **A flag is not "awaiting a flip"
until a toggle exists that flips it** — check `test_settings_wiring.js` before writing that phrase
into a handover again.

Bridged 2026-08-10 via the standard `_reconcileEnv` + toggle pattern
(`processing/handler.js`, `settings/{index.html,renderer.js}`), **both still DEFAULT OFF and
byte-identical off**, and both now PINNED in `test_settings_wiring.js` so the gap cannot reopen.
Settings → Processing carries them as "Don't accept a taught reading that isn't the right shape"
and "Treat 'Your Order' as the customer's order number, not yours". **App RESTART loads a bridge**
(the env is assembled when the extraction process is spawned).

---

## 2026-08-09 (cont.) — format-fail-yield residual (READ-layer) + customer-PO field split + Your-Order son fix
Context: HANDOVER_2026-08-09_CONT.md. This session REDESIGNED `TEMPLATE_FORMAT_FAIL_YIELD` (dark, gate GREEN,
`1bea059`) and shipped `CUSTOMER_PO_LABELS` (dark, M=0, `e656329`). Two new flags await OWNER FLIP. Deferred:
- **Clipped/mis-magnitude taught reads = a READ-layer arc (the real po_ref/total residual).** The merge-layer
  format-fail-yield can only catch FORMAT-INVALID taught reads ("Account"/"L922.14"). The dominant residual is
  FORMAT-VALID wrong values: clipped-prefix ("19979"⊂"PO-19979"), magnitude/sign clips ("£2"/"£-1,329.00").
  These are unfixable at the merge — the taught box must RELOCATE/ADAPT to the shifted value (or route through
  the existing `_pick_fuller_code`/un-clip consent+shape ladder). gary+Oracle BOTH rejected a merge-layer
  fuller-code containment swap (overrides a format-valid authoritative read on a weak heuristic; rb_531 class;
  cold-start dirty). Pinned OUT in test_stage05_format_yield.py ("19979"/"24511" PASS). Own gate + Oracle pass.
- **Dedicated customer_po_number / cross-reference field.** CUSTOMER_PO_LABELS currently piggybacks on
  po_number; a buyer's PO on a seller's invoice is conceptually a DIFFERENT field. Clean model = a dedicated
  field with `role_caption` so the party guards (`_ref_caption_party_conflict`) protect it. Schema + seeding +
  filing/learning change — beyond the smallest fix. (reggie.)
- **"Your Order"/"Your Order No" po_number labels + the son leading-boundary fix.** These captions were EXCLUDED
  from CUSTOMER_PO_LABELS because they activate a pre-existing sales_order_number double-fill: "our" ⊂ "your"
  and the son label "Our Order No" has NO leading word-boundary, so on "Your Order No: X" son already mis-grabs
  X. Fix = add `(?<![a-z0-9])` before the `Our Order` caption (keyword.py `_label_pattern`), THEN add
  "Your Order No"/"Your Order Number" to the po_number block (No-suffix first). Ship as a separate gated slice.
- **CUSTOMER_PO_LABELS field-presence gap.** The default Invoice type has no po_number field, so the flag is
  inert there until either the type carries po_number or the dedicated field above lands. Note in any real-world
  recall claim.

---

## 2026-08-30 EVENING — re-slice witness arc: deferred / follow-ups (owner vet)
Context: `docs/designs/CORROB_RESLICE_SWEEP_2026-08-30.md` (REVISED banner), `HANDOVER_2026-08-30_NIGHT.md`.
- **Refs/dates in the re-slice sweep (slice 2).** v1 is totals-only. The ref/date trigger must be "the zone's own
  read was ABSENT or deterministically format-INVALID" — a valid different zone read is a genuine dissent a padded
  re-read must never out-vote (the `trust_role_disagreement_refuse` seam: an injected agreeing witness would suppress
  the zone's dissent through the family-agreement rule). Reuse `_read_pad_window_date/code` as rung 1 (oscar);
  witness = keyword-family equality (date fold / exact `_cmp_norm`, NO confusable tolerance). The ref crosscheck
  demoter (`_demote_xcheck_corroborated_note`) is DATES ONLY by Oracle B2 ("refs wait for the ladder fix") — 0030's
  `NRQ-2551` hold (three reads agree, one Stage-2 anchor-crop garble `NRO-2591` rejected) is that class.
- **R8 as the PRIMARY money mapping read (census first).** R8 (pad 0.5×h, no upscale, white border, PSM 6, in-band
  pick) read 20/20 Nordwind totals at ~92 incl. the one the shipped ladder garbles; the shipped `_read_pad_window_*`
  recipe differs only by its ×2 `_prep` upscale. Promoting it to the primary currency read is a broad change to a
  shipped path on one template / one DPI of evidence — needs a full-DB census (every currency mapping: R8 vs current
  vs confirmed) + Oracle. Until then it is the witness-only sweep.
- **Deskew retry trigger misses note-only holds.** `_deskew_retry_should_run` keys on engine `_needs_review`
  (required-empty OR field<70); a doc held only by a note never fires it (0/20 on Nordwind). Consider "any note"
  as a trigger (Oracle — cost: every noted doc with skew ≥0.3° re-OCRs).
- **Money fold in `_corrob_values_agree` — NOT built (no measured target).** `_EDGE_RE` + whitespace collapse
  already fold `£`/edge symbols; 19/20 Nordwind totals record `agree:['keyword']`. reggie's design (both strict →
  cents + sign equality; note the sign-flip behaviour change: today `-160.32` ≡ `160.32`) is ready if a census
  finds separator-only dissents (`_db_census.py` found 0 of 10).
- **Total-swap class (garbage zone read WON, no keyword read).** The sweep only WITNESSES a committed value; when the
  garble itself is committed and only the re-read reconciles, nothing swaps (the pick already ran). Would need the
  re-read injected before `_reconciliation_pick_total` — its own gate (0 stored exhibits in the owner's DB).
- **Settings wiring pin pre-existing red:** `test_settings_wiring.js` reports MISSING `stamp-section, stamp-preview-box,
  stamp-preview, stamp-msg, stamp-size, stamp-size-val, stamp-save, stamp-reset` — HEAD's renderer.js addresses them,
  HEAD's index.html lacks them (the 08-28 stamping move). Not this arc's; tidy separately.

---

## 2026-08-30 NIGHT — OWNER-QUEUED NEXT ARC: an ADVERSARIAL test corpus (multi-column + the known weak spots)
Owner (after the re-slice arc): "generate a set of multi columned documents for testing, and examples of other areas you
feel may pose problems." Build on the EXISTING rig `stress_test/gen_demo_digital.py` (reportlab; 6 archetypes; per-doc
`ground_truth.json`) + `stress_test/score_demo_digital.js` (cold/warm) — but render each archetype TWICE: the born-digital
PDF (skips OCR → isolates layout) AND a rasterised SCAN of it (200 + 150 DPI, 1-3° skew, noise, thermal fade) so the
same truth scores the OCR path — the multi-column failures (row rebuild, column bleed) only exist on rasters.
Classes (ranked by measured risk), ~20 docs × ≥3 synthetic suppliers each:
1. Multi-column money rows (`Net | VAT | Gross` on one line; two totals blocks side by side; right-aligned column beside
   a caption column; narrow gaps). 2. Line-item tables with a total INSIDE the table + a repeated footer "Total due"
   (net-as-total / wrong-row). 3. Small print — 8-9 pt totals/refs at 200 DPI (the class R8 was judged unsafe on as a
   primary read). 4. Leading-digit dates flush to an edge/border, `1/12` vs `11/12`, ISO/US orders, month names (the
   baseline M=7 class). 5. Two-column address blocks with the BUYER's name larger than the issuer's (identity +
   buyer-issued steer). 6. Continental/French/Swiss numbers + EU VAT ids on RASTERS. 7. Same-logo siblings
   (invoice/credit/statement) + look-alike logos across suppliers. 8. Degraded scans (skew, faint grey serials,
   thermal receipts, a staple over the ref, a fax header above the letterhead). 9. Multi-page (total on page 2,
   "carried forward" that looks like a total). 10. Credit notes + negatives (`-£`, `(160.32)`, `CR`, trailing minus).
Gate: cold + warm scoring per class; every silent-wrong is a NEW class card for an advisor→Oracle arc.

## 2026-08-31 — Chris Hard Set round UX cards (owner vet; details docs/CHRIS_FULL_APP_REVIEW_2026-08-31.md)
- "Ready" language war: chips "N more ready to file" vs File-All "Nothing is ready to file yet" on one screen; one word per meaning ("7 filled in - each needs one check"); check the group-head counter arithmetic (2+5=7 on a 6-doc group). [Chris card 1, CONFUSION]
- Bare page-furniture word ("Date"/"NOTE") in a ref/date box must never wear a tick/"High" - honest "looks like a heading" copy instead. [card 2, CONFUSION; structural fix = oscar cell-below card]
- Teach-reach chip: after a teach, name the scope ("Applies to Helix Point Diagnostics - Credit Note papers") - a lesson is (field, doc-type)-scoped and nothing on screen says so. [card 3]
- Taught ref-cell sibling re-reads garbled (iwv-...) - candidate: R8 padded re-read recipe on taught zone re-reads for ref roles; census first. [card 4]
- Rock-bottom heading-guess issuers (BILL TO/SHIP TO) route to "Sender not identified" instead of minting a company. [card 5]
- Teach read-back: trim stray cell-edge chars ("| inv-27090"); render the label guess as prominently as the value (a wrong "Rate" label slipped through unseen). [card 6]
- Credit-note confirm line could echo "Total: -2,178.00 (credit)". [card 7; sign retention verified in code - the gap is extraction, see the sign card]
- Deferred row: rename "Review" button to "Back to Review", delete = bin icon. [card 8]