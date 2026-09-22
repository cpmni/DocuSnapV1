# FILING_SANITY_CONFUSABLE_SOFTEN (mig 147) — Condition-1 census — 2026-09-09

**Method:** offline replay (zero reprocess). The Gate-C confusable branch is a PURE function of
(committed ref value `rv`, page `ocr_text`) — both stored. Replayed EXACTLY per engine.py:7311-7356
using the engine's own `_nearest_confusable_page_token` + `_one_digit_letter_confusable`. `page_match_v2`
and the two prior softeners are DARK/OFF by default, so the confusable branch is reached directly.
Trigger: `len(page)>200`, `len(rv)>=4`, `_absent = rv.casefold() not in {whole-page tokens}`, then a
digit/letter `_near`. Script: `census.py`.

**Validation:** the same census run against the live DB correctly flags the known exhibit
doc #45 `PO-22954`→`P0-22954` (O/0) and nothing else → the corpus 0 is real, not a dead script.

## Results

| Set | ref-bearing confirmed docs | Gate-C 'absent' fires | RECLASSIFIED scary→soft (benefit) | wouldFile changed |
|---|---|---|---|---|
| ScanFinder Test Corpus (147) | 147 | 0 | 0 | 0 |
| Live DB (Copperfield install) | 82 | 1 | 1 (doc #45 PO-22954/P0-22954) | 0 |

- **(i)** Gate-C confusable-absent notes: **1** total (the exhibit).
- **(ii)** reclassified to the truthful soft note: **1**; **wouldFile change: 0**.
- No false positives (0 non-digit/letter, 0 plain-absent misfires).
- **wouldFile neutrality is structural:** both the scary and soft branches call `_note()` → a
  `validation_note` is set either way → `trust.isAutoFileEligible` blocks in BOTH arms. #45 was
  review-bound/human-confirmed in both; nothing changed filing state.

## Verdict
Meets Oracle Condition-1 (0 `wouldFile` change; note-text-only benefit). The corpus incidence is
genuinely low because the phantom card needs a whole-page digit/letter misread on a ref the crop read
correctly — rare, and precisely what this note-fix calms. Safe to flip `filing_sanity_confusable_soften`
ON for customers. (The AUTO-FILE half remains the separate prefix-history arc — Oracle SEND BACK on the
re-read lever.)
