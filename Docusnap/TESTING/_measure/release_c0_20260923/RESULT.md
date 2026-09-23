# Oracle C0 — confusable RELEASE yield census on the owner's DB (2026-09-23 night)

**Question (Oracle C0, FLIP blocker):** among documents whose reference carries the Gate-C confusable soften note,
how many would the RELEASE actually free — i.e. are NOT held by trust.js `_pageFamilyDisagrees` anyway? Categories:
(i) a page family still disagrees after the mig-191 suppression → trust.js holds regardless; (ii) taught + on-shape
winner, the suppression lifted the page family; (iii) no page family ever disagreed. Yield = (ii)+(iii); ≈0 → retire.

**Arm:** every CONFIRMED doc in a read-only COPY of the live DB (`stress_test/out/c0_live_copy/`, gitignored; copied
2026-09-23 17:30, mig 207, 747 confirmed → 727 resolvable files), `stress_test/realdoc_regression.js` at
`RR_APP_ENV=1` (the app's own switch state: Gate C + all three softeners + `ref_confusable_flag` + both role-disagree
belts ON; glyph switches OFF), `OCR_RENDER_DPI=200`, `RR_CONSENSUS` with the new `corrob` field. 18 minutes.
Analysis `analyse_c0.js`; raw rows `stress_test/out/c0_release/full.jsonl` (not in repo — real values).

## Result
| | count |
|---|---|
| docs reprocessed | 727 |
| refs carrying the confusable soften note | **9** |
| (i) still page-family-held (crop WRONG, page families RIGHT) | **8** — all Print Tracker: 5× `RFH0738865` read for the printed `RFHO738865` (`anchor_crop+corrected`, disagree = crop+keyword+mapping `RFHO…`), 3× `HS71Y07217` read for `H571Y07217` (`anchor_inline`, disagree = keyword+mapping) |
| (ii) taught + on-shape, suppression lifted the page family | **1** — #45 Copperfield `PO-22954` (`template_mapping` conf 90; keyword `, P0-22954` in `suppressed_taught_role`; overall 81 = the note's own −12 fc penalty) |
| (iii) no page family ever disagreed | 0 |
| **YIELD** | **1 of 9 soften docs = 1 of 727 (0.14%)** |

Gate reasons across all 727: ok 517 · disagreeing-read 82 · below-floor 62 · flagged 52 · weak-critical-field 14.
Soften share of all ref notes: 9 of ~90 noted refs (the largest ref-note class is "taught position and the full-page
read disagree", 27).

## Reading
- **On the owner's real data the soften note is a TRUE positive 8 times out of 9** — the crop misread a glyph (0 for
  O, S for 5) and the whole page had it right. On those the RELEASE can never fire: PP disagrees (the mig-207 hold
  catches it), and even on a PP agree the C2 page-family guard abstains. The Oracle's P1 premise catch was right and
  load-bearing.
- **The one crop-RIGHT soften (#45) is exactly the RELEASE's target** — a taught supplier's early document, held only
  by the note (the fc penalty drags 93 → 81). The release would file it correctly at conf 90 ≥ the owner's threshold.
- The general and filtered censuses (0 common-mode) were measured on the census tool's word-geometry crops, which are
  mostly RIGHT; the pipeline's taught/anchor crops on the owner's Print Tracker are the WRONG-crop population. Both
  are true; they answer different questions (safety vs yield).
- Warm-DB caveat: confirmed literals + the mig-206 disarm + the history softeners already clear the repeat cases
  (the 3 Vellum `SO-` docs carry no note today), so this understates the cold-first-docs yield of a freshly taught
  supplier — which is the #45 class.

## Verdict (for the Oracle / owner)
Yield is **1, not 0** — small but real, and it is the exhibit class the owner raised (Chris 09-08/09). Recommendation:
**keep mig 211 built DARK, do not flip on this evidence alone**; the DOWNGRADE (mig 210) already fixes the copy on all
9. Revisit with the C10 realdoc OFF-vs-ON arm (FALLBACK+RESOLVE=1 both arms) only if the owner wants the first-docs-
after-teaching friction removed; the flip needs the Oracle's C10 numbers either way. Broader finding for the owner:
`disagreeing-read` holds 82 of 727 confirmed docs on reprocess — the page-family disagreement gate, not the soften
note, is the dominant hold on Print Tracker; that is a separate arc (a confusable-aware `disagree` fold, own vet).
