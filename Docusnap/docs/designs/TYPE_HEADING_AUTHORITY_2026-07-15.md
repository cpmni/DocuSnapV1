# Design — make a printed HEADING authoritative for the document TYPE (system-wide)

**Status: DESIGNED, Oracle SIGN-OFF-WITH-CONDITIONS (2026-07-15), NOT BUILT.** Advisors oscar+reggie+gary
converged; Oracle vetted. Build to the 6 conditions below (C1 is a ship-blocker). Kill-switched, fail-toward-review.

## The bug (verified live on the Copperfield/Northgate corpus — built-in AND custom types)
- A **Purchase Order** (heading "PURCHASE ORDER", no "invoice" text) types as **Invoice**.
- **Worksheets** (custom type, heading "WORKSHEET") type as **Sales Order** (one as Invoice).
Wrong type → wrong required fields → can't file / mis-filed.

## Root causes (3, all verified)
1. **Type decided by the logo/template match, not the heading.** A supplier issuing many types on ONE
   letterhead has same-logo SIBLING templates; the logo can't separate them → a 0.4° skew flips which
   sibling wins. A post-extract override (`process_docs.py:711-730`, gated only on `not authoritative`,
   NOT on `title_trusted`) stamps the template's type as final.
2. **The heading-authority safety net doesn't fire.** `identify_template`'s trusted-title REFUSE
   (`template_matcher.py:182`) nulls a wrong-type match when `title_trusted` — but `title_trusted` fails:
   - **(oscar) the enhancement pass erodes a large RED heading:** `extract_text_and_images`→`preprocess_for_ocr`
     `convert('L')` maps brand-red glyphs to mid-grey ~76-91 (vs black body ~10-30), then the threshold
     thins/erases them → detect reads a weak wrong type ("Delivery Note @70" vs a clean read's "PO @88").
     Reprocess re-serves the degraded cached `documents.ocr_text` → re-fails.
   - **(reggie) a column-merged heading scores low:** `reconstruct_page_text` emits "PURCHASE ORDER␣␣␣␣Order
     No. PO-88280" as ONE line; the STRICT scoring test (`keyword.py:440` `line==phrase`) fails → weight
     1.0 not 2.0 → PO loses `best_type` to a body-mentioned type → the correct heading flag (test 2 is
     already column-aware) is discarded because `headings.get(best_type)` reads the winner's flag.
3. **(gary, owner-flagged) confirm-path template creation is TYPE-BLIND.** `_upsertTemplate` (`handler.js:811`)
   `let templateId = doc.template_id || null` trusts the Stage-0 (wrong-type) link and only runs the
   type-scoped reuse/create `if (!templateId)`; line 828 `templates.update()` reinforces the wrong-type
   sibling; no guard that the link's type == the CONFIRMED type. So a corrected worksheet keeps reinforcing
   the sales_order template and **no worksheet template is ever born** → self-reinforcing. (16 owner
   worksheet docs are mislinked — DATA cleanup, separate.)

## The 4-part fix (each kill-switched; default on unless noted)
- **A (oscar) — detector gets an UNENHANCED page-0 read.** Keep the enhanced `ocr_text` for ALL field
  extraction + persistence (byte-identical). Only when enhancement was applied AND the enhanced pass found
  NO trusted heading, do ONE extra `reconstruct_page_text(pages[0])` (raw image already in `page_images`,
  no re-render) and let `detect_document_type` prefer a trusted heading from EITHER text. Additive; near-zero
  cost on plain first import (enhance_params None) and born-digital. Env kill switch. Files:
  `ocr/tesseract.py` (extract_text_and_images 315+, reconstruct_page_text 151, preprocess_for_ocr 271),
  `ocr/engine.py` read_page 30, `process_docs.py:506` (detect call; raw page-0 in `page_images`).
- **B (reggie) — column-aware SCORING heading test for type-NAME/alias banners only.** Replace the strict
  `is_heading` at `keyword.py:440`: `eligible[type] = {name.lower()} ∪ {aliases}`; leftmost column segment
  (`_COL_BREAK_RE` split, keyword.py:319); `_segment_is_heading(seg0, phrase, caption_ok=False)` — add an
  optional `caption_ok` param (default True preserves the exposed-flag path) so scoring uses the tighter
  variant (numeric-code + punctuation `# - : |` ok; caption WORDS no/ref/number excluded). NON-name bucket
  phrases keep the strict test (byte-identical). Leave `_line_is_heading_like` (449) UNTOUCHED. Monotone
  (a real heading only ever scores stronger); custom types identical (the name IS the phrase). Kill switch
  `HEADING_SCORE_COLUMN_AWARE`. Fires: "PURCHASE ORDER␣␣Order No.…", "WORKSHEET 38", "WORKSHEET␣␣Date…".
  Does NOT fire: mid-body "…purchase order…", "Invoice Number␣␣12345", "Item␣␣Purchase Order␣␣Qty",
  "Bill To␣␣Acme". Files: `keyword.py` (440-441 scoring, 322-339 _segment_is_heading, 388-407 name fold).
- **C (gary import) — the EXISTING refuse does the live work once A+B assert title_trusted; NO new
  precedence code needed for the live path.** OPTIONAL defence-in-depth (gary recommends; Oracle: fine but
  it is byte-identical in every traced path — documentation, NOT a safety): gate the override at
  `process_docs.py:726` on `not (title_trusted and detected_slug and tmpl_type_slug != detected_slug)`,
  env `HEADING_TYPE_AUTHORITY`.
- **D (gary confirm, ROOT C) — `_upsertTemplate` type-link guard.** After `handler.js:811`: if
  `doc.template_id` exists and its `document_type_slug` (non-null) != the confirmed `document_type_slug`,
  set `templateId=null` (fall through to the type-scoped reuse/create) and set `retypedLink=true`. Change
  the relink at `handler.js:850` from `if (!doc.template_id)` to `if (!doc.template_id || retypedLink)` so
  the doc re-points to the correct-type template. No need to drop stale extraction rows (`getFieldFormats`
  scopes by document_type_id, which changed). Kill switch `TEMPLATE_TYPE_LINK_GUARD`. Files:
  `src/modules/review/handler.js` (_upsertTemplate 756-880), `database/modules/templates.js` (findByLogoHash 369-393).

## Oracle conditions (2026-07-15) — build to these
- **C1 (SHIP-BLOCKER).** When the trusted-title refuse (`template_matcher.py:182`) discards a template
  because the trusted title's type differs from the matched template's type, the doc MUST fail toward
  review — persist a type-uncertainty `validation_note` (mirror `_flag_type_ambiguity` so `trust.js:443-448`
  `flagged` blocks it), for ANY refuse (single- or multi-template cluster). Otherwise a FALSELY-trusted
  heading (e.g. a doc whose only type-name text is a leftmost mid-body table column header) → refuse → no
  template → no ambiguity flag → **wrong-TYPE auto-file at overall==100** (docTrustGate skipped at 100).
  B widens this surface, so the hold is required. Same kill switch as the feature; no trust.js change.
- **C2 (pin the seam).** Unit-pin both monotonicity invariants: (a) every line the strict scorer counts
  (`line==phrase`) still scores 2.0 under `_segment_is_heading(seg0, phrase, caption_ok=False)`; (b) a
  score-driven `best_type` ⟹ `heading=True` (test-2 ⊇ test-3). So a refactor can't drop the winner below
  `type_conf>=70` or desync the two heading tests.
- **C3 (precision fixture, in the CORPUS not just a unit).** A doc with a leftmost mid-body table column
  exactly a type-name (statement/remittance "Purchase Order | Date | Amount") must (a) NOT flip best_type
  when a real heading outscores it, and (b) when the real heading is absent, fail toward review via C1.
- **C4 (D correctness).** (a) relink even though `doc.template_id` was set (the `retypedLink` fix at :850);
  (b) only detach when the existing template's slug is non-null AND differs (don't detach from legacy
  null-slug templates); (c) unit-pin: a worksheet confirm of a doc mis-linked to a sales_order template
  borns/reuses a WORKSHEET template AND sales_order `getFieldFormats` does NOT include this doc.
- **C5 (the gate).** `realdoc_regression` full corpus: (a) A+B+C off → byte-identical (type+fields+conf);
  (b) on → **per-doc type-regression count == 0** (no correctly-typed doc becomes wrong — NOT merely "net
  accuracy up"), type-accuracy up on the target class, **M==0**, no per-field ref/date/supplier drop.
  **CONFIRM the harness M counts a wrong-TYPE auto-file (right value, wrong folder)** — the standing M is
  value-oriented and may be BLIND to it; if so, EXTEND it, else C1/C3 are ungated. (c) live E2E on the
  ACTUAL Copperfield PO + Cascade/Copperfield worksheet: assert the 4-space column break is emitted,
  `title_trusted` flips True, type resolves correctly. (d) D: the C4c unit pin + a live confirm E2E
  (worksheet confirm borns a worksheet template; a second worksheet then matches it).
- **C6 (throughput, non-blocking).** Part A adds a 2nd page-0 OCR pass on enhanced+no-heading docs
  (letterhead-only docs are not rare). Confirm batch-time regression is within budget; keep the kill switch.

## Correction to record (Oracle)
Chain 3(b) phrasing: the EXPOSED heading flag (`_line_is_heading_like`, keyword.py:342-355) is ALREADY
column-aware — the PO flag IS set True. What's lost is the SCORE (strict test → weight 1.0), so PO loses
`best_type` and `headings.get(best_type)` reads the winner's False flag. B fixes SELECTION, invents no flag.

## Compose / seam
A+B set title_trusted; C's refuse then makes the heading win over the logo-sibling; D borns the correct-type
template so the cluster self-separates (once ONE worksheet template exists, `detected_slug` preference
selects it directly, no refuse). C × `_type_ambiguity`/REF_PREFIX_RETYPE are mutually exclusive on
`title_trusted` (verified). D RELIES ON the import path HOLDING a mistyped doc for review (so a human
corrects it) — the `_type_ambiguity` HOLD is load-bearing; C1 extends that hold to the false-heading branch.
