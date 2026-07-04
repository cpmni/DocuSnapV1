# Handover — extraction robustness + idiot-test fixes
Branch: feat/tray-stage1 · Updated: 2026-07-04

## Goal
Harden extraction (ambiguous labels, totals reconciliation, learning anti-poison, O→0) and make
the first-run UX idiot-proof. Long session; ALL work below is UNCOMMITTED (nothing lost on close —
files are on disk; this captures the why). Repo root is `c:\GIT Projects\`; git paths show a
`Docusnap/` prefix.

## In progress — UNCOMMITTED (this session)
- **Format-gate "trust-first" hardening pass (2026-07-04) — audit + 2 fixes, 4 deferred.** Three
  independent passes (main + gary + reggie) confirmed ONE recurring class: the Stage 4.5 format gate
  OVER-FIRES on legitimately-variable data — it WITHHOLDS/TRUNCATES/flags a VALID value because its
  shape/separator is under-represented. Unifying invariant: *never withhold or truncate a value that
  satisfies the field's TYPE regex on shape grounds; flag softly instead.* **FIXED + COMMITTED:**
  (1) a REGRESSION I introduced — `_numeric_family_regex` `\d[\d,\s]*` let `\s` span the gap between
  two amounts (`extract_accepted_shape("12.50 34.00")`→`"12.50 34"`, silent magnitude corruption) and
  stripped a leading `-` (credit `-84.40`→`84.40`); now `\d+(?:[,\s]\d{3})*` + optional `-`.
  (2) `_fold_shape` now folds a SINGLE running-number group behind a letter prefix (`INV001` vs `INV1234`
  → `@@@#`), the most common invoice/PO/SO number shape — was withheld; multi-group refs stay exact.
  **IDENTIFIED, DEFERRED (no clean/safe fix yet — real but lower-severity):** #3 `extract_accepted_shape`
  can truncate a longer valid value to a short accepted shape; #4 a valid alternate SEPARATOR (`AB-126`
  vs `AB/###`) is withheld; #5 non-identity name fields (`buyer_name`) still take the entity-mixing
  global fallback (soft-flag only; generalising the identity exemption BREAKS the legit `Lid→Ltd`
  consistent-customer repair — see test_stage45); #6 a ref field with date-shaped values misclassified
  `date_like`. A broad engine "type-valid ⇒ never withhold" guard was TRIED and REVERTED: refs are
  typed `text` (loose regex) in the real DB, so it let a MALFORMED ref (`9999-9999`, missing its 3rd
  group) through — the shape gate is needed exactly there. gary's property/matrix test design
  (`type-valid value never nulled/magnitude-altered`) is the follow-up to guard the whole class.
- **Supplier IDENTITY not vetoed by the GLOBAL name format (2026-07-04).** `engine.py` Stage 4.5:
  the `supplier_name`/`customer_name` identity field was validated against the doc-type-GLOBAL
  ('' supplier) format, which aggregates DIFFERENT suppliers. A corpus 90% "SuperStore" learned
  that single name's shape (`@@@@@@@@@@`) + position-0 prefix ("SuperStore") as "the usual" and
  flagged every OTHER supplier ("City Office NI") as "format differs". NEW `_IDENTITY_FIELD_KEYS`
  ({supplier_name,customer_name}) SKIP the global fallback (`fmt_entry` resolution) — the identity
  is compared ONLY to its own supplier's scoped history; a garbled identity still caught by name-
  quality/wordness. NON-identity name fields keep the global fallback (canonical repair intact).
  Same "dominant-shape veto on variable data" class as the numeric fold. Verified: City Office NI
  conf 70→98, no flag. Guarded by a new case in `test_stage45_text_preserve.py`.
- **Supplier read no longer merges BILL FROM + BILL TO (2026-07-04).** `born_digital._join_words`:
  a born-digital multi-column row ("Profile Construction …gap… ACME Inc") was joined with SINGLE
  spaces, so the `BILL FROM`→below supplier read grabbed BOTH companies ("Profile Construction ACME
  Inc"). Now emits a 4-space COLUMN BREAK for a column-wide gap (matching OCR's reconstruct_page_text)
  so keyword.py's `{4,}`-space guard takes only the value's column. Threshold (`_COLUMN_GAP_MULT`/
  `_COLUMN_GAP_FLOOR`) sits between a wide value gap ("# 2371", joined) and a true column (~0.14, split).
  Reusable for every born-digital field. Guarded by `test_born_digital.py`.
- **Reprocess REGENERATES born-digital text (2026-07-04).** `tesseract.extract_text_and_images`: on
  reprocess (`use_cache`) the stored OCR text was returned verbatim, so a born-digital text-gen fix
  (e.g. the column split) never reached existing docs — the supplier stayed merged after reprocess.
  Born-digital text is a near-free text-layer read, so it's now regenerated FRESH every run; only
  expensive OCR (scanned pages) honours the cache (`all_fresh` gate).
- **Supplier-identity REPAIR tool (2026-07-04).** The per-field learning-history tools can't fix the
  identity field (they're SCOPED BY supplier). NEW `learning.renameSupplier`/`getSupplierScopeCounts`
  (merge-safe rename across documents/hints/anchors/logos/corrections + the stored identity value;
  files not moved) + `get-supplier-scope-counts`/`rename-supplier` IPCs (settings/handler, admin+
  audited) + Settings→Learning Recovery "Rename / fix this supplier" control (preview counts → typed
  confirm). Guarded by `database/modules/test_rename_supplier.js`. See `[[project_numeric_shape_fold]]`.
  STILL OPEN (this supplier chain): scanned totals dropped by Tesseract PSM-3 (sparse right column;
  PSM-6 reads them) — an OCR-pipeline change, not yet done; and an invoice-number rigid-crop drift
  (192074 vs 152574) — separate.
- **Numeric shape fold (2026-07-04) — fixes two "wrong numbers" bugs with ONE root cause.**
  `format_anomaly_checker.py`: the accepted-shape veto (`classify_format`/`check_value`/
  `extract_accepted_shape`, used by `anchor._qualify_against_format`) encoded EXACT digit-count +
  thousands-grouping into each shape, so a corpus skewed to one length/grouping treated a valid
  rarer-length value as an anomaly → TRUNCATED it (currency `4,699.20`→`699.20`, dropping the
  thousands group) or WITHHELD it (`152567` in a 5-digit-dominated corpus → anchor's correct read
  dropped, wrong keyword `Aurora` won). NEW `_fold_shape()` collapses a PURELY-numeric shape to a
  length/grouping-invariant family (`#####`/`######`→`#`; `###.##`/`#,###.##`→`#.#`), applied when
  building `shapes` + in check/extract/`shape_match_score`. Structured/code shapes (letters `@` or
  non-numeric seps `-`/`/`) UNCHANGED → the `####-####-#` drift guard intact. Also widened
  `separators` to always include `,. ` for numeric-family fields (a thousands comma is never an
  "unexpected char" just because the sampled pool was sub-thousand). The READ was always correct;
  the POST-read veto corrupted it. Authoritative reads (⊕/Stage-0.5/keyword_override) already bypass
  it (`shape_mode='ignore'`); only AUTO tiers hit it. Anti-poison proportional floor is untouched —
  only shape GRANULARITY changed. VERIFIED end-to-end: doc 145 subtotal `4,699.20`/total `2,923.13`
  (conf→100), doc 114 invoice_number `152567` (anchor_crop wins). **Fixes on REPROCESS.** Guarded by
  NEW `tests/test_numeric_shape_fold.py` + updated `test_format_shape_consistency.py` /
  `test_shape_acceptance_proportional.py` (now use STRUCTURED shapes, since numeric length folds).
  See `[[project_numeric_shape_fold]]`.
- **"Mathematically verified" badge missed genuinely-balanced invoices (2026-07-04).**
  `review/renderer.js _amountRole`: the tax/total rules use `\b(vat|tax|…)\b`, but the shadow tax
  component's key is `vat_tax` — underscore is a WORD char, so there's no `\b` around `vat`/`tax`
  and it matched NOTHING → tax mapped to no role → `subtotal+shipping ≠ total` → badge hidden on a
  balanced invoice (Profile Construction: 3,449.85+689.97+500=4,639.82). Fix: fold `_`→space before
  matching (`sub[\s_-]?total` patterns unaffected). DISPLAY-ONLY (extractions already correct) →
  fixes on Review-window REOPEN, NO reprocess. Backend reconciliation was fine (exact key aliases),
  so it never flagged — front/back just disagreed.
- **Ambiguous label pick** (Item/Item-Info, Total⊂Subtotal): `template_mapper._label_score` strips edge
  caption punct (`total:`→`total`, robust to OCR-dropped colon) + VALUE-AGREEMENT prefer occurrence whose
  line carries the credible rigid value (`_locate_anchor`/`_locate_in_text_lines` `confirm_value`); reggie
  digit-free guard in `anchor.py` label-lock. Geometric tie-break was tried then REVERTED (fragile at 300 DPI).
- **Totals reconciliation** `validator.py`: role-resolved via `keyword.ROLE_KEY_ALIASES` (shipping/tax/discount
  synonyms, single source, also used by `keyword._pattern_key`); accepts total with shipping/discount IN or OUT
  of subtotal (delivery line inside subtotal); +`vat_tax` labels "Tax Total" etc. in `keyword_patterns.json`.
- **Shadow reconcile** `engine._shadow_reconcile_components`: reads subtotal/VAT/shipping/discount NOT defined
  as fields (method `shadow_reconcile`) so the "✓ mathematically verified" badge works without cluttering the
  type. `learning.getFieldFormats` skips `shadow_reconcile`; not displayed/learned.
- **Verified badge + drawn-value normalize** `review/renderer.js` (totals badge; ⊕ draw strips currency symbol,
  parses date to DD-MM-YYYY per `region_date_order`); `review/index.html` `.field-note.verified`.
- **Anti-poison** `format_anomaly_checker.classify_format`: shape trusted iff `c>=ABS(8) OR c>=max(3,ceil(0.10*N))`
  (was flat `c>=3`, corpus-blind). See `[[project_learning_anti_poisoning]]`, dry-run `tools/poison_gate_dryrun.py`.
- **O→0 correction** `learning.getFieldFormats` (emit `_count>=3`) + `ocr_corrector.derive_template`/`build_format_index`
  (single recurring value, `MIN_CONFIRMED_FOR_SINGLE_SHAPE=3`).
- **Doc-type cleanup** `document_types.js`: reverted auto-added invoice money fields + startup cleanup removes
  `built_in=1` empty money fields (already ran on user's DB → Invoice type clean).
- **Idiot-test UX**: `main/renderer.js` completion msg honest ("N processed — M need review", `batch.review`,
  badge "Confirm to file →"); `validator.needs_review` flags a MISSING REQUIRED field (was skipped → empty company
  read "ready"); `onboarding/index.html` Move-originals reassurance + Step-2 plain framing; `review/renderer.js`
  Document Issuer tooltip.
- **Focus fix** `main.js`/`preload.js`: removed `win.on('focus')→win.focus()` self-call; `ensure-window-focus`
  does `win.blur();win.focus()` gated on `pageHasFocus===false` (native confirm() drops Blink page-focus). ⚠ TEMP
  `[FOCUS]` traces STILL IN both files — strip once satisfied (held clean all session).
- New tests: `tests/test_anchor_ambiguous_label.py`, `test_shape_acceptance_proportional.py`,
  `test_totals_block_extraction.py`, `test_numeric_shape_fold.py`; `test_digits_only_fields.js`
  schema +`extraction_method` col. (`test_shape_acceptance_proportional.py` +
  `test_format_shape_consistency.py` UPDATED for the numeric-fold behaviour.)
- UNRELATED pre-existing untracked (do NOT commit as ours): `NIGHT_*.md`, `SECURITY_AUDIT.md`,
  `assets/Screenshots/*`, `night_audit/*`, `output/`, `stress_test/*` (corpus/harnesses), `../client_app/`.

## Next steps
0. Apply the two 2026-07-04 fixes in the live app: **Reprocess** the queue (SuperStore totals, City
   Office invoice number → numeric-fold fix) and **reopen Review** (Profile Construction et al →
   "mathematically verified" badge). Numbers fix = backend/reprocess; badge = renderer/reopen only.
1. Reprocess a sample invoice: confirm Total no longer grabs Subtotal, verified badge shows, O→0 self-corrects,
   completion message is honest.
2. Optional "Next" UX: two-step model unmissable ON the Import completion (not just skippable tour); Review de-jargon.
3. Strip TEMP `[FOCUS]` traces from `main.js`/`preload.js`.
4. Commit SELECTIVELY (~17 modified + 4 new test/tool files; exclude the unrelated untracked above).

## Gotchas
- Extraction changes apply on REPROCESS (fresh py per doc); renderer on window REOPEN; learning.js/main.js/doc-type
  cleanup on RESTART. Dev app was running (may be closed now).
- Subtotal/total truncation was NOT stale — it was a LIVE numeric-shape-veto bug (see the
  numeric-shape-fold entry above), now fixed. Reprocess to pick up correct values.
- Idiot-test report Artifact: https://claude.ai/code/artifact/f1ba00d0-ee1b-43c1-89dd-3f493c1c5700
- Live DB: `%APPDATA%\ScanFinder\docusnap.db` (read-only sqlite3 for diagnostics).

## Verify
- Py script-style: `py -3.12 python_backend/tests/<name>.py` · pytest-style: `py -3.12 -m pytest <file>` (NOT whole dir — mixed).
- JS: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron database/modules/test_*.js`
- Anti-poison dry-run: `py -3.12 python_backend/tools/poison_gate_dryrun.py`
