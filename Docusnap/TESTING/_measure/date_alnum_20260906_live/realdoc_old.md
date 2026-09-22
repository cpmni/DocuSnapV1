# Real-doc regression — 453 confirmed docs reprocessed vs their confirmed values
(0 confirmed docs had no resolvable file and were skipped.)
⚠ #81: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='W2E8X06407' file='doc00822120260901152813_split_p16-1.pdf')
⚠ #82: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='C738M125203' file='doc00822120260901152813_split_p18-1.pdf')
⚠ #88: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='G696J500513' file='doc00822120260901152813_split_p22-1.pdf')
⚠ #89: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='W2S8745899' file='doc00822120260901152813_split_p27-1.pdf')
⚠ #92: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='782923124N3M2' file='doc00822120260901152813_split_p30-1.pdf')
⚠ #118: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='H573429209' file='doc00822120260901152813_split_p21.pdf')
⚠ #180: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='W2S7828006' file='doc00822120260901152813_split_p17-3.pdf')
⚠ #190: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='1984800049' file='doc00822120260901152813_split_p24-3.pdf')
⚠ #259: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='1984800049' file='doc00822120260901152813_split_p25-5.pdf')
⚠ #263: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='C738M820492' file='doc00822120260901152813_split_p3-5.pdf')
⚠ #266: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='RGS0512662' file='doc00822120260901152813_split_p33-5.pdf')
⚠ #269: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='H7R5427479' file='doc00822120260901152813_split_p4-5.pdf')
⚠ #273: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='VG37308169' file='doc00822120260901152813_split_p8-5.pdf')
⚠ #287: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='C738JB00279' file='doc00822120260901152813_split_p20-6.pdf')
⚠ #262: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='752923124N3M2' file='doc00822120260901152813_split_p30-5.pdf')

## Early-warning disagreements: 5
type/supplier/ref/date compared against the confirmed values as each document landed.
A SUPERSET of the gate: a disagreement that was correctly flagged for review is not a
failure. The gate numbers are the SILENT wrong values and wrong auto-files below.
```
  #92 doc92.pdf — ref '782923124N3M2'->'752923124N3M2'
  #141 doc141.pdf — ref '1G25802868'->'1625802868'
  #243 doc243.pdf — ref '1G25802868'->'1625802868'
  #288 doc288.pdf — ref 'HS73429209'->'H573429209'
  #471 doc471.pdf — ref 'P1/26/6000'->'PI/26/6000' · date '26-01-6000'->'05-01-2026'
```

| Field | correct | scored | accuracy |
|---|---|---|---|
| type | 453 | 453 | 100.0% |
| supplier | 453 | 453 | 100.0% |
| ref | 448 | 453 | 98.9% |
| date | 452 | 453 | 99.8% |
| total | 19 | 24 | 79.2% |
| subtotal | 0 | 0 | - |

**Regressions (a confirmed value the pipeline no longer reproduces): 6** — of which 4 SILENT (wrong + no review flag).
- #92 print_tracker ref: want '782923124N3M2' got '752923124N3M2' [SILENT]
- #141 print_tracker ref: want '1G25802868' got '1625802868' [SILENT]
- #243 print_tracker ref: want '1G25802868' got '1625802868' [SILENT]
- #288 print_tracker ref: want 'HS73429209' got 'H573429209' [SILENT]
- #471 invoice ref: want 'P1/26/6000' got 'PI/26/6000' [flagged]
- #471 invoice date: want '26-01-6000' got '05-01-2026' [flagged]

## Per-field fill rate (non-empty), by document type
A withholding change must not drop any of these. supplier_name is called out separately:
it is the learning-scope key AND the filing folder, so a drop there is the worst kind.
- credit_note · credit_note_date: 7/7 (100.0%)
- credit_note · credit_note_number: 7/7 (100.0%)
- credit_note · total_amount: 0/7 (0.0%)
- delivery_note · customer_name: 20/20 (100.0%)
- delivery_note · delivery_date: 20/20 (100.0%)
- delivery_note · delivery_number: 20/20 (100.0%)
- invoice · invoice_date: 18/18 (100.0%)
- invoice · invoice_number: 18/18 (100.0%)
- print_tracker · customer: 308/308 (100.0%)
- print_tracker · date: 308/308 (100.0%)
- print_tracker · make: 308/308 (100.0%)
- print_tracker · model: 308/308 (100.0%)
- print_tracker · reference_number: 308/308 (100.0%)
- purchase_order · po_date: 20/20 (100.0%)
- purchase_order · po_number: 20/20 (100.0%)
- quote · quote_date: 20/20 (100.0%)
- quote · quote_number: 20/20 (100.0%)
- quote · total_amount: 20/20 (100.0%)
- sales_order · customer_name: 60/60 (100.0%)
- sales_order · order_date: 60/60 (100.0%)
- sales_order · sales_order_number: 60/60 (100.0%)

**ISSUER FILL RATE (supplier_name) — watch this one first:**
- credit_note · supplier_name: 7/7 (100.0%)
- delivery_note · supplier_name: 20/20 (100.0%)
- invoice · supplier_name: 18/18 (100.0%)
- print_tracker · supplier_name: 308/308 (100.0%)
- purchase_order · supplier_name: 20/20 (100.0%)
- quote · supplier_name: 20/20 (100.0%)
- sales_order · supplier_name: 60/60 (100.0%)

**Auto-file soundness (#6): 361/453 reprocessed docs would auto-file; 4 would auto-file a WRONG value (must be 0).**
- #92 print_tracker would-auto-file but WRONG on: ref
- #288 print_tracker would-auto-file but WRONG on: ref
- #426 credit_note would-auto-file but WRONG on: total
- #433 credit_note would-auto-file but WRONG on: total

**Wrong-TYPE auto-file (M_type, Oracle C3): 0 (must be 0 — would auto-file under the WRONG document type; a subset of M above, tracked + gated separately).**

**Banner heading re-reads adopted (BANNER_HEADING_REREAD): 0 (red-channel recovery FIRED + adopted a trusted type; 0 = never fired on this corpus, NOT proof of safety).**

**Gate-failure re-reads adopted (GATE_REREAD): 0 (review-bound — can't auto-file; 0 = the feature never fired, not "safe").**

**c2 taught-field ownership caps (TAUGHT_FIELD_OWNERSHIP): 4 (HOLD-only — value untouched, review-bound; this is the review-VOLUME delta, not an accuracy change).**