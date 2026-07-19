# Resolved QA / audit findings & build-stage history — extracted from CLAUDE.md
> Deep reference split out of the always-loaded CLAUDE.md (2026-07-03) to keep the root
> memory lean. Read this when a task touches this area. Nothing here was changed — verbatim move.

### RESOLVED QA FINDINGS (2026-07-02 audit — all 11 fixed + tested; see `NIGHT_QA_AUDIT_2026-07-02.md`)
The overnight read-only adversarial audit's **11 findings are now all FIXED**. Landing notes:
- **#1 (HIGH) backup restore re-typing / opaque FK abort** — `backupService.applyBackup` no
  longer delete-by-id + reinsert-original-id for parents the EXCLUDED `documents` table
  references. Parents (document_types by `slug`, template_groups by `name`, templates by `slug`)
  are UPSERTed by NATURAL KEY preserving the LOCAL id → a surviving doc is never silently
  re-typed and never FK-aborts; children (fields, template_*) are scoped-replaced with the
  parent FK remapped via an old→new id map; a `templates.sample_document_id` whose doc is
  absent here is NULLed. Guarded by `src/services/test_backup_retype.js`.
- **#2 (HIGH) no-ref/date type dead-end** — `review/renderer.js validateConfirm` requires a
  ref/date role only when it's actually assigned (`dt?.ref_field_key || null`, no
  `invoice_number`/`invoice_date` literal fallback); the dangling-role warning now fires only
  for a role that IS set but points at a missing field — honouring the backend's "reference optional".
- **#3 (HIGH) reprocess discards edits** — `hasPendingReviewEdits()` guards both Reprocess +
  Reprocess-All with a confirm() when corrections / a manual type override / a staged ⊕ teach are
  pending (skipped for programmatic `.click()` re-extracts via `e.isTrusted`).
- **#4 (MED-HIGH) batch freeze** — the working-copy COPY (async `fs.promises.copyFile`) and the
  `pdf_rotate` cold-start (async `spawn`) are moved OFF the synchronous `file_done` path into a
  deferred `setImmediate` chain (copy→rotate→drain→auto-file); DB writes stay synchronous. The
  batch awaits all per-file IO (`pendingFileIo`) before flushing drains.
- **#5 (MED) File-All-Ready wrong-doc race** — `confirmCurrentDoc` takes an `expectId` and bails
  if `currentDoc.id` changed; the bulk lock now includes single Delete, and per-row ×/row-clicks
  are gated on `bulkFiling`.
- **#6 (MED) empty issuer** — warn-and-allow: an amber note + a deliberate confirm in single
  mode; a bulk File-All skips a blank-issuer doc instead of silently filing under "Unknown Company".
- **#7/#9 (root cause) slug/key derivation** — ONE shared `database/modules/slug.js`
  (`safeSlug`/`uniqueSlug`: NFKD-fold → collapse → trim → cap → fallback → uniqueness suffix)
  used by `addType`/`addField`/`presetSlug`/`create-doc-type-with-fields`/`addCustomField`; symbol/
  non-Latin names get a unique fallback slug (no UNIQUE collision). `buildXml` hardened with
  `key.split('_').filter(Boolean)` + `if(!tag) continue`, and the whole XML write is try/caught so
  an XML defect can't strand a copied file. Guarded by `test_slug.js`. (Existing rows are NOT
  re-slugged — learned scope keys off the stored slug.)
- **#8 (MED) watch/output overlap** — `src/modules/path_overlap.js` `foldersOverlap`; `set-watch-folder`
  returns `{ok:false,error}` on overlap with output/Processed (renderers surface it), and
  `process-folder` refuses importing the output/Processed tree. Guarded by `test_path_overlap.js`.
- **#10 (LOW) empty-sanitised supplier** — filing substitutes `Unknown Company` when the resolved
  `{supplier}` level sanitises to empty (`buildFilenameStem` pre-check), never dropping the company
  folder. Guarded in `test_filename_pattern.js`.
- **#11 (LOW) search From>To** — inline note in the search bar when From date > To date.
- Verified SOUND (don't re-audit): CAS confirm, SQL-injection (search is parameterized),
  clock-rollback HWM, corrupt-file per-file isolation, window-lifecycle destroy-guards.


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


---

# Resolved known-bug blocks (moved out of CLAUDE.md 2026-07-19, verbatim)

### ✅ RESOLVED (2026-07-09) — the 2026-07-08 real-doc harness RED was NOT a code regression. See `HANDOVER_2026-07-09.md`.
Isolated (baseline `main` vs branch on the SAME live DB): the RED was (1) ONE accidental AUTHORITATIVE
⊕ teach — `field_anchors` id=24, Cloud VPS `invoice_number`, label "Invoice" — which (per
`learning.saveAnchor`) swept every other supplier's invoice_number anchor AND bled cross-supplier,
false-locating on the generic caption "Invoice" to crop-read a wrong-but-valid neighbour (City Office
`1828987`@87), overriding the correct keyword read (`152567`@98); and (2) partly-POISONED test GT (user
mis-confirmed page-numbers/fragments while bug-hunting — #404 GT `22163`/`16-03-2026` but the doc's own
OCR+filename say `22162`/`03-06-2026`; #896 GT `1/2`; #962/#1012 GT `102`). `main` was actually WORSE on
safety (would-auto-file-wrong=25 vs the branch's 1). **True silent-wrong-auto-file = 0.** FIX SHIPPED
(branch `fix/autofile-critical-field-floor`): a filing-critical per-field confidence floor in
`trust.js` `isAutoFileEligible` (`critical_field_conf_floor`, default 88, 0=off) — a present ref/date
value must itself clear the floor to auto-file, at every floor incl. 100; HOLD-only, so it can't cause a
wrong auto-file; took would-auto-file-wrong 25→1 (the 1 = poisoned #404). The branch
`fix/ocr-multicol-precedence` (oscar grouping + reggie guard) is NOT the cause and is safe to build.
DAYTIME cause fix (reggie, not done — delicate): stop a NAMED cross-supplier authoritative read that
located only via a WEAK/generic caption from being auto-trusted as "same layout" in `anchor.py`
(`anchor_crop_relocated` is always `located_ok=True`, so it skips the cross-supplier guard). Cleanup:
Settings → Learning → Learning Recovery (clear the Cloud VPS anchor), or `py
stress_test/_clean_mistaught_anchor.py delete`.

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


