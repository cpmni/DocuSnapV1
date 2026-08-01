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
- After case 5 (2026-07-12, logo-collision wrong-supplier identity fix): **KEEP — 5-for-5.** Vetting the
  oscar+gary consensus on a branding cross-check for the Cascade⇄Thornbury misfile, he (a) traced the
  auto-file path to establish that the load-bearing block is the `validation_note` (trust.js:443), NOT
  the ≤69 cap or overall_confidence — so the note is mandatory and must survive to the extraction row;
  (b) caught a ship-blocking HOLE in the exemption set — exempting `template_fixed_locked`/`keyword_override`
  would have left the very template path that stamps `template_fixed_locked` exempt from the guard meant
  to catch it (condition: exempt only `manual` + accepted_issuers); (c) corrected the trigger framing —
  gary's "own-branding-absent" is NARROWER than stated (a brand-new supplier has no fingerprint → exempt),
  making it the right smallest-safe trigger over oscar's collision-gate; (d) found a bootstrap bug in the
  save-guard (first-ever print would be refused → a supplier could never learn a logo); (e) fixed the
  placement (after the identity-conflict block, skip if it already adopted, to dodge a stale-var false-flag)
  and the polluted-GT gate shape. Every one of these was a real defect the first-draft consensus missed.
  Pattern holds: he verifies at the mechanism level and catches the seam. Route identity/precedence/
  auto-file changes through him.
- 2026-07-31 night (cross-res escalation re-read + "Faster 225 dpi" preset): **KEEP — the sharpest catch
  yet.** gary+oscar consensus: escalation rung in `_maybe_gate_reread` + hard-coupled 225 preset. Verdict
  SIGN OFF W/COND (mechanism, 300-base, dark) + DO NOTHING (preset PARKED). He TRACED
  `format_anomaly_checker._fold_shape` and overturned gary's claim (built on the STALE first docstring
  paragraph) that letter-bearing shapes keep digit count — the fold collapses ANY single-digit-run shape
  (`'@@-#####'`→`'@@-#'`), so the 225 digit-duplication class passes shape, the escalation trigger can
  never fire on it, and the "M≤8 at 225" gate could go green while the failure class stays live ("a green
  gate that cannot fail on the failure mode is worse than none"). Also: ruled the lane-A fork FOR gary
  (files clean) but closed the one non-⊆-300 hole with prefix-membership (C2); found the engine
  `corrected_to` acquiring operator-grade veto in the 07-31 reprocess merge (C6); ordered oscar's crop
  fix FIRST so it can't invalidate the escalation baselines; killed the uncommitted UI preset swap.
  One-liner from the verdict: "the specialists' consensus was one stale docstring away from shipping a
  speed preset whose only guard against its own signature failure could never fire." Full conditions:
  `pendingfeatures.md` cross-res section.
  **2nd pass same night — the amended verdict that redirected the whole build.** Confronted with the
  traced #121 lineage (keyword read the ref correctly and LOST to a registration read placed 76px off;
  label-confirmed = shape-exempt = both his own approved fixes unreachable), he re-verified both claims
  in code, ABANDONED his own prior warrant explicitly, and redirected to the merge layer: the shipped
  `36a4a32` clipped-suffix reconciliation (adopt-superset under lane-A-grade constraints, no new OCR)
  — plus the ruling ORDER (data remediation of the garbled 07-30 taught anchors BEFORE any
  registration-algorithm work; "do not rework the registration algorithm off one poisoned exemplar")
  and the honest call that the 225 measurement is now confounded in BOTH directions. Gates: OFF
  byte-identical; ON ref 91.8→94.5%, M 8→7 zero new members. His close: "the class we designed a
  cross-resolution engine to heal turns out to be a read the pipeline already made correctly and threw
  away — the fix was never at a different resolution, it was at the merge."
- 2026-08-01 (S-A/B/C/D validation slices, 3rd round of the arc): **KEEP.** Vetted gary's four
  designs with a verification ledger (re-traced Tier-A, located-by-fiat, the shape-resurrect, the
  n≤sample vacuous-fit) rather than trusting the brief. Signed all four W/COND; ruled the
  keyword_override asymmetry CORRECT (label authority ≠ value authority); ruled one-witness FLAG
  right and untouched wrong; tightened ADOPT with distinct-FAMILY witness counting + non-
  authoritative adoption at witness confidence; caught that S-C-before-S-A ordering is load-bearing
  (no stale date-flag on a healed value) and demanded the order be PINNED; demanded the authority-
  invariant narrowing be DOCUMENTED (CLAUDE.md + extraction-pipeline.md) "or a future dev fixes it
  back"; killed S-B2 with the sharpest observation of the round — +3 on a capped-85 read lands at
  exactly the 88 floor, a confidence-inflation arm engineered to cross the auto-file bar on
  population evidence. Built same day (`1411d50`): every gate met exactly as he specified — S-A
  audit = precisely #141/#142, S-B flood = 0, full stack ref 96.5→97.5%, M pinned set zero new.
  His close: "every slice that ships does so as a flag or a corroborated adoption, never a silent
  rewrite."
- 2026-08-01 (stroke-substitution fix directions, 4th round of the validation arc): **KEEP.** Vetted
  007's measured evidence pack (8 exemplars, ~30 reads/doc render matrix, three-chain census) for the
  interior-digit-substitution residual. Signed **D1 in-band digit-disagreement flag W/COND** (ref-role
  only — date fields are a structural false-fire hazard, two dates on one page differ only in digits
  by construction; LAST in the pinned pass order; same-skeleton ≤2-digit-position comparator; census
  fire-rate bar ≤3% hard/≤2% target BEFORE build); **conditional GO on D2** after catching that its
  proposed mechanism could not reproduce its own measured heals (the 283/299 heals came from the
  LOCATE chain at a different downsample geometry, not the value-box crop — matrix.json shows the
  crop still wrong at 400/600; re-specced as second-downsample line-locate+harvest witness, bake-off
  between 400→1100 and 600→1100 chains); **DO NOTHING on D3** (locate-chain value ban inverts the
  July-31 arbiter premise, resurrects the clip class the traces themselves show — banked full-res
  re-LOCATE as the principled future path). Biggest catch: **re-drew the class boundary** — read the
  600-DPI exhibits himself and reclassified #154/#285 as GT-poison (pages print well-formed
  'DN-38884'/'WS-43842'; 30/30 unanimous high-conf reads = correct-OCR-vs-wrong-GT fingerprint, same
  as #86), shrinking the true OCR class to 4 docs and killing 3 phantom M rows; ruled remediation
  in-app via Learning Repair (de-confirm → correct → re-confirm) FIRST — "a pixels-mismatching
  confirmed row is live learning poison, not a scoring nit" — before any gate baselines. Also found
  anchor.py:1037 nulls ocr_conf on inline harvests = structurally exempt from the Tier-A garble gate
  (worse than briefed), and the 283@300 keyword-agrees-wrong trace = never add a skip-witness-on-
  keyword-agreement optimisation. Main session verified his two load-bearing exhibit reads
  independently — eyes agree. Verdict logged pre-build; census is the next step.
- 2026-08-01 (label-tail crop clamp, evening): **KEEP.** Vetted 007's measured root cause of the
  learned-crop label-bleed class (the fixed label-blind +20px pad + 141px scan jitter ⇒ 13/16 crops
  intrude the label tail; batch fate trifurcates on what the tail OCRs as; the recurring 2-doc hold
  = the ≤2-char-debris band; worse bleeds auto-file via inline rescue; ws09 = the near-miss
  wrong-value class). **SIGN OFF W/COND on the located-label left-edge clamp at crop derivation**,
  dark until gated. His catches: C1 the FRAME TRAP (a taught-box comparison silently no-ops on the
  worst-drift docs — expected-value-left must derive from the LOCATED label + stored offset, pinned
  with a fixture a taught-frame implementation fails); C4 the fourth unclamped crop site (:861
  cross-check — a clamped-clean rigid vs tail-dirty cross-check is a manufactured disagreement);
  C3 the free-text ladder re-crop bypass (v1 = structured types only); C5 in-crop degenerate must
  revert to unclamped, never refuse. Confirmed the sub-88 recovered checkpoint shrinks but never
  lifts (G2 pins it); ws09 mechanically cannot worsen (max() moves the edge rightward only, G3).
  Sequencing: clamp → oscar's matte (label-aware, bounded by the clamp) → full-res re-LOCATE
  independent; caption-prefix strip stays DARK as the no-locate spare. Gate = his (realdoc M=0,
  zero value flips, Saltmarsh 20/20, pins) + G1 OFF==ON outside the class, G5 throughput, G6
  total flag count must not rise.
- 2026-08-02 (label-tail clamp GATE ADJUDICATION, overnight): **ACCEPT AS RESIDUAL — GO on the
  flip.** The built clamp met every gate except the "zero value flips" letter — exactly ONE flip
  (#218 Vellum sales_order: OFF read the correct 'SO-68195'@85 via the recovery rung on the
  tail-dirty crop; ON reads 'SO-68105'@98 direct — interior 9→0 stroke substitution, deterministic,
  review-bound BOTH runs). Mechanism-traced (he verified the code, the jsonl rows, and the D2
  bake-off ABSTAIN on this exact doc): the clamp didn't MANUFACTURE the misread — it removed the
  defective crop whose accidental rescue was masking the documented Vellum stroke-sub substrate;
  sending back would preserve a defect so its rescue keeps winning (working-rule-4 inverted).
  **AMENDED GATE LETTER (recorded so #218 is not blanket precedent): "zero UNRESIDUALED flips" —
  a flip is acceptable ONLY when (a) in-class, (b) review-bound in both runs, (c) provably
  unreachable by every live AND banked witness, (d) logged as a named residual with watch bars;
  the NEXT flip gets its own adjudication.** Watch bars: **W1** any operator correction of an
  AUTO-FILED ref with winning method anchor_crop and a 1-2-digit same-skeleton diff (D1's
  comparator, offline over corrections) ⇒ kill the clamp pending re-gate · **W2** stroke-sub
  silent residual crossing ~3% revives D2 (unchanged; #218 moves it to ~1.0%) · **W3** when a
  stroke-sub scope (Vellum) nears W=10 graduation, confirms must be checked against PIXELS until
  ocr_dpi 200→300 lands (a casual confirm of a wrong-at-98-unflagged read teaches the poison).
  Delta-scoped comparators RATIFIED (M as NEW-vs-OFF set membership, G2 changed-only, Saltmarsh
  new-only) — valid only over back-to-back same-HEAD runs; the flips comparator stays ABSOLUTE.
  Post-verdict the main session rendered #218's ref region at 600 DPI (zooms/doc218_600_wide.png)
  and the page prints a legible 'SO-68195' — GT CONFIRMED, the flip is real, the residual branch
  stands. Conditions: owner brief carries the #218 line + W1-W3 + the ~36-docs-freed expectation ·
  #218 exhibit joins the GT-poison eyeball pile · this-week triage of the pre-existing
  test_anchor_crop_crosscheck.py case-7 RED (re-fixture to the post-07-09 trigger band or retire
  with a supersession note) · clamp_*.jsonl NUL-scanned (done — clean).
- After case 6 (2026-07-12, PO vendor-caption issuer fix): **KEEP — 6-for-6.** Adjudicating the reggie(flag)
  vs gary(drop) split, he ruled DROP with the *right* reason — not the brief's lead argument (the @40 cap is
  a no-op) but that the value drives the filing/learning SCOPE (engine.py:2259 reads `.value`), so flag
  keeps a real-but-wrong company that a careless confirm learns as the layout's supplier (poison spreads),
  while drop fails to Unknown-Company + no learning (visible, non-poisoning). He corrected a load-bearing
  premise in the brief (the Review confirm gate is WARN-not-block for the issuer, so drop doesn't *force* a
  fill — the real advantage is the failure *nature*), found the one genuine seam drop opens (2.5a re-adopting
  the suppressed vendor from a hint on a mature install → C1), caught a NameError-inducing scope bug in the
  process_docs threading (C2), and specified breadcrumb-to-trace-not-UI (C3). Every condition was a real
  defect or a genuine improvement. Pattern holds: he verifies at the mechanism level and adjudicates on the
  fail-safe axis, not the surface argument.
