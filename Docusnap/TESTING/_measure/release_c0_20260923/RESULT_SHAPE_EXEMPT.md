# Thesis check — "apply the learned-shape veto to taught reads" (2026-09-23 late) — REFUTED on the owner's data

**Thesis (from the clipped `30-82482` discussion):** a taught / label-confirmed read that violates the scope's learned
skeleton carries no shape note today because `engine.py` ~:12081 skips the Stage-4.5 shape flag for
`anchor._LABEL_CONFIRMED_METHODS` (`anchor_inline`, `anchor_crop_relocated`, `anchor_registration`) and every
`_is_stage05_located` read; therefore a clipped taught read could file wrong, and re-applying the veto (review-bound)
would be a cheap protection.

**Verified TRUE:** the skip exists (comment + code at :12076-12082; `_label_confirmed` at :11758); `shape_signature`
distinguishes letters from digits (`SO-82482`→`@@-#####`→folded `@@-#`; `30-82482`→`##-#####`, a two-group shape,
unchanged) so `check_value` WOULD flag it; the exemption dates from `88b7080` and has no pin test.

**Measured (`shape_exempt_census.py` over the 727-doc C0 run + `dump_formats.js`, the engine's own format index):**
| | count |
|---|---|
| taught / label-confirmed ref reads that VIOLATE the learned shape (no note today) | **20** |
| … of which the read is WRONG vs the confirmed value | 19 (harness `correct=False`) |
| non-exempt reads violating the shape | 0 |
| taught reads matching the shape | 279 |

**Verified at the DB (`query_worksheets.py`, `via_census.py`) — the 19 "wrong" are RIGHT:** all 20 are Castellan
service worksheets. The taught box reads the **Job Sheet No `CJB-####`** — the reference the owner taught the box for
(mig-186/191 arc, 09-19/20). The CONFIRMED values they are scored against are **`JB-####`, the Job Ref, a different
number on the same page**: 15 confirmed by the machine `scope_sweep` (2026-09-12 21:34, one batch — EXCLUDED from
learning, `learning_exclude_machine_confirms=true`, verified), **4 confirmed by hand on 2026-09-12 21:29-21:34, before
the box was taught**, and 1 human correction `JB-6189`→`CJB-6391` on 2026-09-13. So the learned history is 4×`@@-#` +
1×`@@@-#` → the count-gated shape set is {`@@-#`} → every correct `CJB-` taught read "violates" it.

**Conclusion:** on the owner's data the exemption is LOAD-BEARING, not a hole — removing it (even review-bound) would
have held 19 correct Castellan reads and caught 0 wrong ones. The clipped-and-shape-violating taught read (`30-82482`)
did not occur once in 727 documents. **Step 1 is withdrawn.** The protection for the clip class belongs at the SLICE
(step 2), and history-vs-read conflicts belong to the Paddle + history tie-breaker (step 3).

**Side finding for the owner (decision needed):** 19 of the 20 Castellan worksheets are FILED under the Job Ref
(`JB-…`) as their reference, not the Job Sheet No the box was later taught for; the 4 hand-confirmed `JB-` values are
what the learned history now says a Castellan reference looks like. Options: Learning Repair on those 4 (send back /
re-key to `CJB-`), then a reprocess-ALL — which WOULD re-file the 19 under `CJB-` automatically (18 reprocess with
`reason=ok`; reprocess-ALL auto-files via `consume-reprocess-completion`) — or leave them (the search still finds
them; only the filename/reference differs).
