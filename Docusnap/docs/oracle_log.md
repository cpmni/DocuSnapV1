# The Oracle — trial log

The Oracle (`.claude/agents/oracle.md`) vets the CONSENSUS of the specialist advisors (007, gary,
oscar, reggie, eric) before a fix ships: he hunts anomalies/missed cases, sanity-checks the OCR &
office-doc reality, and asks whether the average user is actually served. This log records each time he
was used and whether he EARNED HIS KEEP — did he catch something real the specialists missed, or just
echo them? Reviewed periodically to decide if he stays.

Columns: date · topic · specialists' consensus (1 line) · Oracle verdict · **did he add value?** (a
concrete catch / a false alarm / no-op echo) · outcome.

| # | Date | Topic | Consensus (in) | Oracle verdict | Added value? | Outcome |
|---|---|---|---|---|---|---|
| 1 | 2026-07-09 | Cross-supplier authoritative-anchor bleed → crop drift (Anconia teach lands on City Office layout, reads `$0`/`1828987`) + OCR-debris-prefix recovery (`". = 317437"`) + clean-crop whitelist | Agree root cause (`located_ok` proves caption exists, not same layout) + stop destructive sweep (gary Slice 1). FORK: gary=supplier-scope priority (Slice 2) vs 007=geometry position-check suffices. reggie=recover-and-flag. oscar=whitelist-with-preservation-guard, confident-clean, runs before reggie. | SIGN OFF WITH CONDITIONS. Ruled the FORK **for gary** (keep Slice 2) with a concrete same-corner scenario 007's check can't discriminate. 6 conditions. | **YES — strong.** Caught a DANGEROUS INTERACTION no specialist saw: oscar's confident-clean REMOVES the credibility-rejection safety, so a drifted cross-supplier crop reading a *different valid number* could clean to high conf → auto-file wrong (resurrects M=1). Also caught a coordinate-frame bug in 007's helper (offset captured vs label TOP-LEFT, helper compared CENTRE → off by ½ label box) + weak-for-same-corner + no-offset direction-blindness. | Conditions folded in. SHIPPED (branch fix/anchor-bleed-crop-ocr): reggie recovery + Slice 1 (sweep scope) + Slice 2 (supplier-aware priority) + 007① placement gate (Oracle's offset-frame correction, per-axis tol, scoped to cross-supplier). **Corpus VALIDATED: ref 96.3%→99.4%, regressions 46→8 (all poisoned GT), true silent-wrong-auto-file = 0** (the harness's 4 M-docs read 152567 correctly — proven by their own original filenames; GT was mis-confirmed "1/2"). oscar's confident-clean whitelist DEFERRED per his M=1 warning (reggie's flagged recovery covers the read). |

| 2 | 2026-07-09 | A trained (Anconia) cross-supplier anchor still CROPS the wrong place on Cloud VPS #1129 (reads "OO", rejected; keyword 122785 wins so field is correct). Proposed: gate the cross-supplier anchor's crop ATTEMPT on placement — "skip the anchor ENTIRELY (rigid + relocate + registration)". User's explicit ask: don't encroach on the shipped fixes. | Single-agent proposal (Claude) — Oracle vetting for encroachment. | **SEND BACK.** "Skip entirely" ENCROACHES: it kills the label-relative INLINE/relocate read that 007① + `_is_blind_cross_supplier_anchor` deliberately keep — the path that fills a genuine SHARED-layout field whose caption sits at a shifted position → silent empty field on unseen suppliers (masked here only by keyword). Scope the skip to ABSOLUTE reads (rigid crop + registration) only; keep inline/relocate; keep post-crop gate additive; emit a skip trace reason. Bonus: found `anchor_registration` is currently UNGATED by 007① — the scoped skip closes that residual hole. | **YES — strong (2nd time).** Prevented shipping a silent-empty-field regression on unseen cross-supplier layouts + found the ungated-registration residual. His 6 conditions became the implementation. | Implemented exactly (C1 absolute-only skip; C3 additive; C6 trace reason `cross_supplier_placement_skip`). #1129 skips cleanly, #1110 unaffected; harness M=0 re-validated. |

| 3 | 2026-07-09 | User challenge: "why allow anchors to read cross-supplier at all? layouts per supplier will mostly be different." Proposed ROOT fix: `_anchor_matches` admits cross-supplier only for IDENTITY fields; POSITIONAL fields (invoice_number/date/total) no longer admitted cross-supplier. Changes the 2026-07-06 guarded design (which kept admission broad + read-guarded). | Single-agent proposal (Claude), user-directed. Oracle vetting encroachment + the trade-off. | **SHIP-WITH-CONDITIONS.** No encroachment (identity re-resolution untouched; prior fixes coherent as defence-in-depth; same-supplier byte-identical). Lost-inline-read trade-off ACCEPTABLE (degrades to Review, never wrong value). WARRANTED beyond tidiness: closes a false-locate residual the pre-crop skip CANNOT (it rides the inline path). 4 conditions. | **YES (3rd time).** Confirmed safe with concrete mechanism-level tracing (engine runs anchors once on first-guess supplier; re-resolution doesn't re-run Stage 2 → named the mis-guess edge). Caught that my comment OVERSELLS `__global__` as an operator opt-in (it's only a teach-time fallback) — a real doc-accuracy fix. | Comment softened (C2); read-guard kept (C4); harness gate (C3) pending; mis-guess engine-test (C1) noted as follow-up. |

| 4 | 2026-07-09 | 3-column header (Anconia #1344) misgroups: value 317437 splits from its INVOICE NUMBER label → keyword reads wrong "ACME" (anchor rescues → field correct), crop reads with debris → flagged. Q: fix the page-wide OCR grouping, or a targeted symptom fix? Claude recommended NOT touching grouping (high blast radius). | Claude proposal (avoid grouping; do oscar confident-clean B). Oracle GO/NO-GO. | **TARGETED-SYMPTOM-FIX(B); do NOT touch reconstruct_page_text now.** Confirmed grouping change = high blast radius (feeds all 1216 docs' keyword pairing) + code already under suspicion → needs baseline-vs-branch isolation + M=0/zero-accuracy-drop gate first. | **YES (4th).** Corrected Claude's "low-reward": the SAME grouping defect is the prime suspect for the null/fragment misses (179914→null) where the anchor doesn't rescue — so grouping IS worth fixing, just not blind/now. Flagged that B dropping the flag on same-pixel agreement is weak (systematic misread reproduces) → require learned-shape/value corroboration + located + glyph-preservation before dropping the human checkpoint. Pointed the real win at a per-supplier anchor-PLACEMENT slice (low blast radius), not keyword/grouping. | IMPLEMENTED B (grouping untouched per verdict). The Oracle's "null-miss" concern was already resolved by reggie's recovery (Anconia 179914/179915 now READ correctly), so the only residual was the flag. B realized simpler+safer than oscar's whitelist re-read: a debris-recovered read commits CONFIDENT (drops "please verify") only when LOCATED-at-taught-position (3a) AND its class-level shape matches the learned shape (3c); glyph-preservation (3b) is satisfied BY CONSTRUCTION (`_recover_clean_token` only strips NON-alnum debris, never force-fits a glyph) — so NO whitelist re-read, NO force-fit risk, NO extra OCR pass. Conf stays 85 (<88 floor) → no auto-file (human still confirms). Verified: #1344/#1093/#1125 confident/no-flag; #1129 cross-supplier unaffected. Tests: test_recover_clean_token.py (+_matches_learned_shape). **Harness PASSED: ref 99.5% (held), true silent-wrong-auto-file = 0.** Commit 52b9bc1. |

## Brief refinement (2026-07-09, after 4 cases)
His `.claude/agents/oracle.md` brief was REWRITTEN from this track record. The original framed him
narrowly as an OCR/office-doc/CX reviewer, but his ship-blocking catches were systems-level and the
brief prompted none of them explicitly. Added as first-class, always-run checks: (1) **the SEAM**
between individually-correct fixes (case 1 — the oscar/007 interaction); (2) **vet the PREMISE** of the
ask, not just the proposal (case 3 `__global__` overselling, case 4 "low-reward"); (3) **verify at the
mechanism level — trace, don't trust**, incl. same-frame/units checks (case 1 offset-frame, case 3
engine ordering, the `#` vs `######` shape mismatch); (4) **blast radius & warrant** — do-nothing / wrong-
layer options (case 4 grouping); (5) **fail toward review**, never drop the human checkpoint on same-pixel
agreement; (6) **cosmetic-on-the-sample vs real-on-the-siblings**; (7) **name the verification gate**.
Verdict set widened to include DO NOTHING / WRONG LAYER. His identity now leads with systems/precedence
engineering, keeping the OCR/office-doc/CX depth that makes his catches concrete.

## Running assessment
_(updated as cases accrue — keep/retire recommendation)_
- After case 1: **KEEP — clear value.** On his first outing he caught a cross-cutting interaction bug
  (oscar's fix silently disarming the safety 007's fix relies on) that each specialist missed because
  each only saw their own slice — exactly the seam a vetting layer exists to cover. He also found a
  concrete coordinate-frame error and settled the fork with a distinguishing scenario, not a hand-wave.
  Net: he changed the implementation plan for the better and prevented a likely M=1 regression. Continue.
- After case 2: **KEEP — value confirmed a second time.** Caught that "skip the anchor entirely" would
  encroach on the shipped inline/relocate path (a silent-empty-field regression on unseen suppliers,
  masked locally by keyword) — exactly the "don't encroach" check the user asked for — and surfaced a
  latent ungated-registration hole as a bonus. He is 2-for-2 on catching real, ship-blocking issues the
  first-draft proposal missed. Verdict: he pays for himself; keep him in the loop for any change that
  touches shared/precedence code.
- After case 3: **KEEP — 3-for-3.** On an architectural change he traced the engine ordering to confirm
  no encroachment, judged the trade-off with a concrete realistic scenario (not a hand-wave), and caught
  a documentation-accuracy error (overselling `__global__`) that would have misled a future maintainer.
  Consistent pattern: he verifies at the mechanism level and catches the seam the first-draft missed.
  **Established practice: route any change touching anchor admission / precedence / cross-cutting safety
  through the Oracle before merge.**
- After case 4: **KEEP — 4-for-4.** On a GO/NO-GO he (a) confirmed the right call (don't touch page-wide
  grouping), (b) corrected a factual overstatement in the human's framing ("low-reward") with the
  concrete null-miss evidence, (c) flagged that same-pixel read-agreement is weak corroboration, steering
  the fix to shape/value-set corroboration + a preserved human checkpoint. The resulting fix was simpler
  AND safer than the first-draft plan. Verdict: unambiguous keep; his judgement has changed the outcome
  for the better on every case so far.
