# Real-doc regression — 15 confirmed docs reprocessed vs their confirmed values
(0 confirmed docs had no resolvable file and were skipped.)

| Field | correct | scored | accuracy |
|---|---|---|---|
| type | 15 | 15 | 100.0% |
| supplier | 15 | 15 | 100.0% |
| ref | 15 | 15 | 100.0% |
| date | 15 | 15 | 100.0% |
| total | 0 | 1 | 0.0% |
| subtotal | 0 | 0 | - |

**Regressions (a confirmed value the pipeline no longer reproduces): 0** — of which 0 SILENT (wrong + no review flag).

## Per-field fill rate (non-empty), by document type
A withholding change must not drop any of these. supplier_name is called out separately:
it is the learning-scope key AND the filing folder, so a drop there is the worst kind.
- credit_note · credit_note_date: 1/1 (100.0%)
- credit_note · credit_note_number: 1/1 (100.0%)
- credit_note · total_amount: 0/1 (0.0%)
- print_tracker · customer: 13/13 (100.0%)
- print_tracker · date: 13/13 (100.0%)
- print_tracker · make: 13/13 (100.0%)
- print_tracker · model: 13/13 (100.0%)
- print_tracker · reference_number: 13/13 (100.0%)
- sales_order · customer_name: 1/1 (100.0%)
- sales_order · order_date: 1/1 (100.0%)
- sales_order · sales_order_number: 1/1 (100.0%)

**ISSUER FILL RATE (supplier_name) — watch this one first:**
- credit_note · supplier_name: 1/1 (100.0%)
- print_tracker · supplier_name: 13/13 (100.0%)
- sales_order · supplier_name: 1/1 (100.0%)

**Auto-file soundness (#6): 13/15 reprocessed docs would auto-file; 0 would auto-file a WRONG value (must be 0).**

**Wrong-TYPE auto-file (M_type, Oracle C3): 0 (must be 0 — would auto-file under the WRONG document type; a subset of M above, tracked + gated separately).**

**Banner heading re-reads adopted (BANNER_HEADING_REREAD): 0 (red-channel recovery FIRED + adopted a trusted type; 0 = never fired on this corpus, NOT proof of safety).**

**Gate-failure re-reads adopted (GATE_REREAD): 0 (review-bound — can't auto-file; 0 = the feature never fired, not "safe").**

**c2 taught-field ownership caps (TAUGHT_FIELD_OWNERSHIP): 1 (HOLD-only — value untouched, review-bound; this is the review-VOLUME delta, not an accuracy change).**