# Label-hit census — `keyword_label_tail_bound` (mig 219) flip gate item (i)

**Question (Oracle C6, gate item i):** over the cached OCR texts, list every scalar hit the tail bound
would refuse; confirm none is a clean correct value (a real ref/date/amount lost).

**Method:** `census_vt.py` — for every non-deleted doc with stored `ocr_text`, for every multi-word
alphabetic-tail label in that DB's `field_label_overrides` + `fields.label`, run
`keyword._search_for_label(lines, label, ['right','below'], val_type=<field's inferred class>)` with
`KEYWORD_LABEL_TAIL_BOUND` OFF vs ON, and record every extraction that changes. `precedence.py` then
replays the REAL label order for the affected fields (the shipped, reordered list) to check the field's
actual outcome, not the isolated-label result. Corpora: the owner's live copy (`live727.db`, 758 texts)
= safety; Chris's 09-24 copy (`chris-sandbox-20260924.db`, 200 texts) = efficacy. (DB copies in job
scratch; re-copy from `%APPDATA%\ScanFinder\docusnap.db` + the sandbox to re-run.)

## Result — PASS

### Currency exclusion added mid-census (the one real loss found)
The first pass flagged **37 `Total Due` docs** on the owner's 727 where OCR glued the amount as a
currency CODE — `'Total DueGBP 21,778.54'` — which the letter-only lookahead `(?![a-z])` refused → a
real statement balance lost. The card-4 class is REFERENCE labels prefix-hitting a TYPE heading, never
money, so the engine now skips the bound for `val_type == 'currency'`. Re-run: the 37 `Total Due`
losses are **gone**.

### Owner live copy (758 texts) — all remaining changes, val_type-aware
| n | label | val_type | OFF value class | example |
|---|---|---|---|---|
| 97 | Delivery No | alphanumeric | heading-collision garble | #1 OFF=`'te No. DN-51070'` ON=None |
| 41 | Delivery No | alphanumeric | caption/boilerplate debris | #43 OFF=`'tes.'` ON=None |
| 13 | Credit No | alphanumeric | issuer ADDRESS (the card-4 bug) | #429 OFF=`'Meadowvale Creamery, Low Lane - Butterwick, BW7 2JD'` ON=None |
| 3 | Credit No | alphanumeric | OCR garbage | #435 OFF=`'anannnan'` ON=None |
| 1 | Credit No | alphanumeric | heading | #449 OFF=`'DORAN |'` ON=None |

**Every refused OFF value is garbled / a heading / an address / boilerplate — none is a clean correct
value.** No money label appears (currency excluded).

### Real precedence check (`precedence.py`) — the isolated "loss" is not a field loss
- **#1** (a real delivery note, `DELIVERY DOCKET  Delivery Note No. DN-51070`, confirmed ref `DN-51070`):
  the reordered **"Delivery Note No"** wins FIRST in BOTH arms → reads `'. DN-51070'` **identically** OFF
  and ON. The bound never touches it ("delivery note no" is followed by "."). The isolated `Delivery No →
  None` never reaches the field.
- **#43 / #45 / #47** (PURCHASE ORDERS, confirmed ref `PO-…`) carry the boilerplate "…on all
  correspondence and delivery notes." OFF: `Delivery No` prefix-hits "delivery notes" → `'tes.'` garbage;
  ON: None. `delivery_number` is not even a PO field — and where attempted, **ON is strictly better**.

### Chris efficacy copy (200 texts)
The 13 `Credit No → 'Meadowvale Creamery … BW7 2JD'` = the exact card-4 bug (the issuer address filed as
the credit-note number). ON refuses → the doc holds for review instead of minting a wrong reference.

## Verdict
- Safety: **no clean correct value is lost** on the owner's 727 (real delivery notes fill via "Delivery
  Note No" identically; money excluded; garbage/boilerplate correctly becomes empty).
- Efficacy: the card-4 wrong-ref reads are refused.
- Gate item (i) MET. Owed before flip: (ii) realdoc M=0 (needs a confirmed-doc DB harness; the text census
  + precedence replay strongly indicate M=0) and (iii) Hard Set P==K==N. Then Oracle → owner flip.
