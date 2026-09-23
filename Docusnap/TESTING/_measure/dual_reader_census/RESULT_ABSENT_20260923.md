# Filtered `_absent` dual-reader census — VERDICT (2026-09-23 evening)

The Oracle's ONE open gate for the confusable RELEASE (paddle-agree → clear the soften note → auto-file):
re-measure the dual reader on exactly the Gate-C SOFTEN-firing set and count "crop WRONG and PP agreed"
(common-mode). Tool: `census_absent.py` over the prior run (`Desktop\TEMPTEST_dual_reader\detection_log.csv`);
results `Desktop\TEMPTEST_dual_reader_absent\` (`SUMMARY_ABSENT.md`, `absent_log.csv`, `contact_sheet_absent_01.png`,
`slices\`). Predicates are the engine's own (`_nearest_confusable_page_token`, `_one_digit_letter_confusable`);
page text is the product's `reconstruct_page_text` at DPI 200.

## Population
| step | count |
|---|---|
| ref rows re-measured | 1,323 |
| crop read page-ABSENT as a whole token | 64 |
| **SOFTEN set** (absent + one-glyph digit/letter confusable page form) | **18** (6 suppliers; SO-/PO- refs + 2 Pelican PI/26/…) |
| PP AGREES with the crop (the RELEASE would fire) | 14 |
| PP DISAGREES (reads the page form) | 4 |

## Pixel adjudication (every slice on the contact sheet read by eye)
- **All 14 PP-agree rows: the crop read is CORRECT** (`PO-22954`, `PO-55445`, `PO-50471`, `SO-42953`, `PO-10035`,
  `PO-33769`, `SO-82482`, `SO-85196`, `PO-44289`, `PO-49453`, `SO-16775`, `SO-47966`, `SO-38467`, `SO-40544`). In every
  one the WHOLE-PAGE pass was the wrong side (`P0-`/`S0-`/`PO-S5445`), i.e. today's soften note holds a correct value.
  **Common-mode (crop wrong + PP agreed) = 0 / 14.**
- **All 4 PP-disagree rows: the crop read is WRONG and PP read the printed form** (`P1/26/9923`→`PI/26/9923`,
  `P1/26/9785`→`PI/26/9785`, `S0-87377`→`SO-87377`, `S0-85711`→`SO-85711`). The DISAGREEMENT hold (mig 207) catches
  exactly these; the RELEASE never fires on them.
- Perfect separation on this set: **PP agreement ⇔ the crop is right.**

## Synthetic CLIP arm (stress only — Oracle rejected synthetic pins as a gate; reported for honesty)
Each soften slice re-cropped with its left edge shaved by ~55% of one glyph (a clipped taught box), both readers re-run.
- 18 clipped · both AGREE 7 · of those, 6 agreed on the ORIGINAL value (the clip was absorbed by both) · **1 both WRONG**:
  `SO-82482` clipped → Tesseract `30-82482`, PP `30-82482`. A clipped `S` read as `3` by BOTH engines = the "PP shares
  the loss on the same clipped pixels" shape the Oracle named.
- Would it reach the RELEASE today? No: `S`↔`3` is NOT a `_CONFUSE_TO_DIGIT` pair, so the soften never fires on it
  (the scary ABSENT note stays, doc held). The pairs that ARE in the map (`S`↔`5`, `O`↔`0`, `I`↔`1`) all resolved
  correctly under the clip: where Tesseract read `50-`/`$0-`, PP read `SO-` (disagree → held).
- Design consequence for the RELEASE (Seam 6 in `docs/designs/CONFUSABLE_RELEASE_SEAMS_2026-09-23.md`): the RELEASE
  should carry a flush-edge / clip guard (abstain when the value's first or last glyph box touches the crop edge), or
  be scoped to producers with a page witness. Owner/Oracle call.

## Correction to the general census's disagreement claim (oscar, 2026-09-23, verified in `SUMMARY.md:38-40,63-67`)
"The 98 disagreements are Tesseract-wrong/Paddle-right" was an overstatement: at least 8 Ironclad STATEMENT date
rows are PADDLE-wrong — the census tool merged the reference and the date into one crop (`ITH-0093 | 04-08-2025`),
Tesseract read it right, Paddle garbled the long gappy line (`ITH-009304-08-20205`, dropped space + hallucinated
digit) at PP conf 0.42-0.85. That is Paddle's one measured failure shape (long multi-token lines) and it sets a PP
confidence floor (~0.90) for any DISAGREEMENT hold — every PP-right disagreement in the census had PP ≥ 0.903.

## Verdict
**GATE MET: 0 common-mode among the 14 releasable rows.** Caveats: N=18 is small; SO-/PO-dominated (the two Pelican
`PI/26/…` rows both went the safe way); crops are the census tool's word-geometry boxes, not the pipeline's taught
boxes (the clip arm is the proxy for that gap, and it found the one synthetic both-wrong). The RELEASE may be BUILT
DARK; its flip still needs the R1-R6 re-vet with the clip finding in front of the Oracle.
