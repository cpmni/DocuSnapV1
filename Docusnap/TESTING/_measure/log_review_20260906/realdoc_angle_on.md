# Real-doc regression — 30 confirmed docs reprocessed vs their confirmed values
(0 confirmed docs had no resolvable file and were skipped.)

## Early-warning disagreements: 1
type/supplier/ref/date compared against the confirmed values as each document landed.
A SUPERSET of the gate: a disagreement that was correctly flagged for review is not a
failure. The gate numbers are the SILENT wrong values and wrong auto-files below.
```
  #471 doc471.pdf — ref 'P1/26/6000'->'PI/26/6000' · date '26-01-6000'->'05-01-2026'
```

| Field | correct | scored | accuracy |
|---|---|---|---|
| type | 30 | 30 | 100.0% |
| supplier | 30 | 30 | 100.0% |
| ref | 29 | 30 | 96.7% |
| date | 29 | 30 | 96.7% |
| total | 0 | 0 | - |
| subtotal | 0 | 0 | - |

**Regressions (a confirmed value the pipeline no longer reproduces): 2** — of which 0 SILENT (wrong + no review flag).
- #471 invoice ref: want 'P1/26/6000' got 'PI/26/6000' [flagged]
- #471 invoice date: want '26-01-6000' got '05-01-2026' [flagged]

## Per-field fill rate (non-empty), by document type
A withholding change must not drop any of these. supplier_name is called out separately:
it is the learning-scope key AND the filing folder, so a drop there is the worst kind.
- invoice · invoice_date: 14/14 (100.0%)
- invoice · invoice_number: 14/14 (100.0%)
- sales_order · customer_name: 16/16 (100.0%)
- sales_order · order_date: 16/16 (100.0%)
- sales_order · sales_order_number: 16/16 (100.0%)

**ISSUER FILL RATE (supplier_name) — watch this one first:**
- invoice · supplier_name: 14/14 (100.0%)
- sales_order · supplier_name: 16/16 (100.0%)

**Auto-file soundness (#6): 25/30 reprocessed docs would auto-file; 0 would auto-file a WRONG value (must be 0).**

**Wrong-TYPE auto-file (M_type, Oracle C3): 0 (must be 0 — would auto-file under the WRONG document type; a subset of M above, tracked + gated separately).**

**Banner heading re-reads adopted (BANNER_HEADING_REREAD): 0 (red-channel recovery FIRED + adopted a trusted type; 0 = never fired on this corpus, NOT proof of safety).**

**Gate-failure re-reads adopted (GATE_REREAD): 0 (review-bound — can't auto-file; 0 = the feature never fired, not "safe").**

**c2 taught-field ownership caps (TAUGHT_FIELD_OWNERSHIP): 0 (HOLD-only — value untouched, review-bound; this is the review-VOLUME delta, not an accuracy change).**