# Real-doc regression — 605 confirmed docs reprocessed vs their confirmed values
(0 confirmed docs had no resolvable file and were skipped.)
⚠ #1880: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='PI/25/3861' file='Pelican-Office_invoice_0031-15.pdf')

## Early-warning disagreements: 10
type/supplier/ref/date compared against the confirmed values as each document landed.
A SUPERSET of the gate: a disagreement that was correctly flagged for review is not a
failure. The gate numbers are the SILENT wrong values and wrong auto-files below.
```
  #221 doc221.pdf — ref 'PL/25/3699'->'PV25/3699'
  #331 doc331.pdf — supplier 'Castellan Security Systems'->'Oakhaven Electrical Wholesale'
  #364 doc364.pdf — date '26-01-9687'->'16-07-2026'
  #953 doc953.pdf — date '01-06-2025'->'17-06-2025'
  #1032 doc1032.pdf — ref 'SO-73799'->'PO-81784' · date '07-06-2026'->'14-03-2025'
  #1050 doc1050.pdf — date '05-01-2026'->'15-01-2026'
  #1092 doc1092.pdf — supplier 'Ticket Type'->'DOCUMENT SOLUTIONS'
  #1423 doc1423.pdf — date '19-08-2026'->'26-01-1792'
  #1453 doc1453.pdf — date '08-01-2025'->'18-01-2025'
  #1649 doc1649.pdf — date '04-08-2026'->'24-08-2026'
```

| Field | correct | scored | accuracy |
|---|---|---|---|
| type | 605 | 605 | 100.0% |
| supplier | 603 | 605 | 99.7% |
| ref | 603 | 605 | 99.7% |
| date | 598 | 605 | 98.8% |
| total | 108 | 108 | 100.0% |
| subtotal | 0 | 0 | - |

**Regressions (a confirmed value the pipeline no longer reproduces): 11** — of which 8 SILENT (wrong + no review flag).
- #221 invoice ref: want 'PL/25/3699' got 'PV25/3699' [flagged]
- #364 invoice date: want '26-01-9687' got '16-07-2026' [SILENT]
- #331 delivery_note supplier: want 'Castellan Security Systems' got 'Oakhaven Electrical Wholesale' [SILENT]
- #953 invoice date: want '01-06-2025' got '17-06-2025' [SILENT]
- #1032 sales_order ref: want 'SO-73799' got 'PO-81784' [flagged]
- #1032 sales_order date: want '07-06-2026' got '14-03-2025' [SILENT]
- #1050 invoice date: want '05-01-2026' got '15-01-2026' [flagged]
- #1092 service_worksheet supplier: want 'Ticket Type' got 'DOCUMENT SOLUTIONS' [SILENT]
- #1423 invoice date: want '19-08-2026' got '26-01-1792' [SILENT]
- #1453 sales_order date: want '08-01-2025' got '18-01-2025' [SILENT]
- #1649 sales_order date: want '04-08-2026' got '24-08-2026' [SILENT]

## Per-field fill rate (non-empty), by document type
A withholding change must not drop any of these. supplier_name is called out separately:
it is the learning-scope key AND the filing folder, so a drop there is the worst kind.
- credit_note · credit_note_date: 41/41 (100.0%)
- credit_note · credit_note_number: 41/41 (100.0%)
- credit_note · total_amount: 41/41 (100.0%)
- delivery_note · customer_name: 62/62 (100.0%)
- delivery_note · delivery_date: 62/62 (100.0%)
- delivery_note · delivery_number: 62/62 (100.0%)
- invoice · invoice_date: 203/203 (100.0%)
- invoice · invoice_number: 203/203 (100.0%)
- purchase_order · po_date: 51/51 (100.0%)
- purchase_order · po_number: 51/51 (100.0%)
- quote · quote_date: 27/27 (100.0%)
- quote · quote_number: 27/27 (100.0%)
- quote · total_amount: 27/27 (100.0%)
- sales_order · customer_name: 125/125 (100.0%)
- sales_order · order_date: 125/125 (100.0%)
- sales_order · sales_order_number: 125/125 (100.0%)
- service_worksheet · date: 56/56 (100.0%)
- service_worksheet · reference_number: 56/56 (100.0%)
- service_worksheet · serial_number: 51/56 (91.1%)
- statement · customer_name: 40/40 (100.0%)
- statement · statement_date: 40/40 (100.0%)
- statement · statement_number: 40/40 (100.0%)
- statement · total_amount: 40/40 (100.0%)

**ISSUER FILL RATE (supplier_name) — watch this one first:**
- credit_note · supplier_name: 41/41 (100.0%)
- delivery_note · supplier_name: 62/62 (100.0%)
- invoice · supplier_name: 203/203 (100.0%)
- purchase_order · supplier_name: 51/51 (100.0%)
- quote · supplier_name: 27/27 (100.0%)
- sales_order · supplier_name: 125/125 (100.0%)
- service_worksheet · supplier_name: 56/56 (100.0%)
- statement · supplier_name: 40/40 (100.0%)

**Auto-file soundness (#6): 571/605 reprocessed docs would auto-file; 7 would auto-file a WRONG value (must be 0).**
- #364 invoice would-auto-file but WRONG on: date
- #331 delivery_note would-auto-file but WRONG on: supplier
- #953 invoice would-auto-file but WRONG on: date
- #1092 service_worksheet would-auto-file but WRONG on: supplier
- #1423 invoice would-auto-file but WRONG on: date
- #1453 sales_order would-auto-file but WRONG on: date
- #1649 sales_order would-auto-file but WRONG on: date

**Wrong-TYPE auto-file (M_type, Oracle C3): 0 (must be 0 — would auto-file under the WRONG document type; a subset of M above, tracked + gated separately).**

**Banner heading re-reads adopted (BANNER_HEADING_REREAD): 0 (red-channel recovery FIRED + adopted a trusted type; 0 = never fired on this corpus, NOT proof of safety).**

**Gate-failure re-reads adopted (GATE_REREAD): 0 (review-bound — can't auto-file; 0 = the feature never fired, not "safe").**

**c2 taught-field ownership caps (TAUGHT_FIELD_OWNERSHIP): 0 (HOLD-only — value untouched, review-bound; this is the review-VOLUME delta, not an accuracy change).**