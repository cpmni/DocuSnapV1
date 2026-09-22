# Real-doc regression — 20 confirmed docs reprocessed vs their confirmed values
(0 confirmed docs had no resolvable file and were skipped.)
⚠ #404: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='null' file='Meadowvale-Dairy_credit_note_0015.pdf')
⚠ #413: GT override SKIPPED (identity mismatch — DB reset / re-confirmed / other machine? db-ref='null' file='Meadowvale-Dairy_credit_note_0018.pdf')

| Field | correct | scored | accuracy |
|---|---|---|---|
| type | 20 | 20 | 100.0% |
| supplier | 20 | 20 | 100.0% |
| ref | 7 | 7 | 100.0% |
| date | 7 | 7 | 100.0% |
| total | 4 | 18 | 22.2% |
| subtotal | 13 | 13 | 100.0% |

**Regressions (a confirmed value the pipeline no longer reproduces): 0** — of which 0 SILENT (wrong + no review flag).

## Per-field fill rate (non-empty), by document type
A withholding change must not drop any of these. supplier_name is called out separately:
it is the learning-scope key AND the filing folder, so a drop there is the worst kind.
- credit_note · credit_note_date: 20/20 (100.0%)
- credit_note · credit_note_number: 20/20 (100.0%)
- credit_note · total_amount: 16/20 (80.0%)

**ISSUER FILL RATE (supplier_name) — watch this one first:**
- credit_note · supplier_name: 20/20 (100.0%)

**Auto-file soundness (#6): 2/20 reprocessed docs would auto-file; 1 would auto-file a WRONG value (must be 0).**
- #426 credit_note would-auto-file but WRONG on: total

**Wrong-TYPE auto-file (M_type, Oracle C3): 0 (must be 0 — would auto-file under the WRONG document type; a subset of M above, tracked + gated separately).**

**Banner heading re-reads adopted (BANNER_HEADING_REREAD): 0 (red-channel recovery FIRED + adopted a trusted type; 0 = never fired on this corpus, NOT proof of safety).**

**Gate-failure re-reads adopted (GATE_REREAD): 0 (review-bound — can't auto-file; 0 = the feature never fired, not "safe").**

**c2 taught-field ownership caps (TAUGHT_FIELD_OWNERSHIP): 14 (HOLD-only — value untouched, review-bound; this is the review-VOLUME delta, not an accuracy change).**