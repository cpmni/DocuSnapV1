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
- 2026-08-02 (teach-first flow, barry+gary consensus vet): **SIGN OFF on the reframe + slices,
  with surgery.** Premise ruling: "teach-on-first-encounter, import-first stays" is not advisor
  drift — it is STRUCTURALLY FORCED (the wizard's doc-picker reads the review queue,
  teach/renderer.js:1034; literal teach-before-import is impossible), and the plan must say so in
  one honest sentence rather than offer a dead option. Three corrections, one per party: (1) gary's
  S4 (mappings as 2.6b vouchers) = DO NOTHING — assumption (i) wrong at the guard that matters: the
  MAIN ownership-corroboration already admits Stage-0.5 reads (`_is_stage05_located` in the voucher
  predicate, engine.py:2952-2954); the 2.6b LATE path is anchors-only by structural necessity (it
  re-runs anchors precisely because no template matched — no frame for a mapping to run in). S4
  deleted ⇒ the whole programme is EXTRACTION-INERT. (2) barry's auto-reprocess-on-wizard-commit
  flagship = SEND BACK: bypasses the reprocess-discards-edits guard (renderer-side confirm on
  Review's own buttons, docs/history.md:18-19 — a main-fired reprocess wipes staged edits with no
  dialog); rebuilt as S1.5 operator-triggered consent-gated "Re-read the N similar" (skip
  open/claimed, pending-edits check, honest heal count). (3) barry's de-jargon precondition =
  STALE (wizard copy already clean — grepped; downgrade to audit). His own find both advisors
  missed: the owner's "targets add validation" layering is ALREADY shipped and EXCLUSIVE to the ⊕
  path — the ownership cap arms only off field_anchors rows (engine.py:2890-2896), the wizard never
  writes one ⇒ "wizard teaches reading; a ⊕ fix arms the check". New seam: S1's batch-end surface
  collides with Catch-up Filing's consent bar (two consent idioms from one trigger class) —
  sequence after slice 4, reuse its pattern. New guard C2: wizard step 2 badges/preselects the
  DETECTED type + mismatch confirm (wrong-type pick = the one new-harm path steering creates;
  verified no guard exists today, teach/renderer.js:192-206,250; Back/Cancel verified truly safe —
  zero persistence pre-doCommit). Conditions C1 (S1 routes through the EXISTING CTA tier predicate,
  Tier-B no-card PIN), C3 (S1.5 shape above), C4 (S2 surfacing-only, keep-both default, retire =
  explicit Learning-Recovery semantics, never touch last_authoritative_at silently — auto-retire
  would disable the Tier-A supremacy the 07-26 re-teach fix depends on). Concurs on all three
  rejections (gate-first · teach>1-toward-W [mig-57 seam from the other side] · fourth positional
  validator). Build order: S0 corpus two-arm gate → C2 → S1 dark+PIN → S3 → S2 → S1.5. Plan:
  docs/designs/TEACH_FIRST_FLOW_2026-08-02.md.
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

---

## 2026-08-03 — Prefix-garble adopt (Northgate PO-17039) + SFDEV lost-reason
**VERDICT: SIGN OFF WITH CONDITIONS.** The consult: 007 (read-vs-placement), reggie (shape/prefix),
gary (engine seam + SFDEV) → Oracle. Case: a tight Stage-0.5 template_mapping crop reads 'PO-17039'
as '»0-17039'@90 and WINS over the correct keyword 'PO-17039'@93 (Stage-0.5 shape-exempt); Stage-4.5
strips to '0-17039', S-B flags it. Verified LIVE in the diag log (not just the harness).
- **Fork ruling:** reggie's S-B length-witness arm is the right layer (a SECOND adopt fingerprint in an
  arm that already single-witness-adopts on a mechanical fingerprint); do NOT co-ship gary's S-C
  Stage-0.5 extension — S-C runs before S-B and its single-witness FLAG would pre-empt the heal (order
  collision). Adjudicated: ship reggie's alone (C4).
- **Premise correction Oracle caught:** the "keyword capped 85 so can't auto-file" claim is FALSE for a
  strong labelled read — keyword@93 commits at 93 and AUTO-FILES, so the adopt DOES remove a working
  human checkpoint; a false-heal is a silent misfile. Accepted only because corroboration is
  distinct-stage + confirmed-prefix + `all_prefixed` + default-OFF. Comment fixed (C3).
- **Verify-at-source gate (flip-flippable):** the keyword ledger conf must be ≥88 — confirmed 93 in the
  live diag. `all_prefixed` is the SOLE separator (a garbled 'PO-'→'0-' is mechanically identical to a
  genuine numeric-leading ref once 4.5 strips the debris) — pinned both directions (C2).
- Conditions C1 (tight fingerprint + digit belt), C2 (dominance guard), C3 (comment), C4 (no S-C
  co-ship), C5 (kill switch default OFF) all applied. Pins: test_suffix_reconcile §4, test_ref_length_
  outlier §7. Realdoc OFF-vs-ON byte-identical (zero regression). Shipped 0d747d0; flipped ON after gate.
- Piece 2 (SFDEV lost-reason): SIGN OFF — state-derived ("kept 'X' from <method>"), no-overclaim pinned.
- **Oracle-surfaced follow-up (not his ruling, my finding):** the realdoc/trace harness does NOT fire
  Stage-0.5 template_mapping, so the corpus gate is BLIND to the template_mapping-garble class — the heal
  is only observable in the live app. Harness fidelity is a real gap (see pendingfeatures).

---

## 2026-08-03 — oscar fix B: structured crop-OCR (cap-height + quiet-zone + drop-SHARPEN + whitelist)
**VERDICT: SIGN OFF WITH CONDITIONS.** Consult: oscar (recipe) + 007 (geometry) + gary (seam) → Oracle.
Case: tight ~13px Stage-0.5 mapping crop mis-reads codes/dates (PO-17039→»0-17039; 19/06/2026→09-06-2026;
#494 PO-66063→PO-68063). Shipped adopt heals prefix-from-peer only; digit-sub + date uncured → fix the READ.
- **Fork ruled: whitelist OUT of slice 1** (prep-only: cap-height upscale + read-time quiet-zone + drop
  SHARPEN). Whitelist = a separately-gated slice 2 that must add its OWN corroboration checkpoint.
- **Seam 2 traced (the catch):** the Stage-0.5 absolute path is GATELESS at the ladder (verify_fn=None,
  template_mapper.py:1504) AND shape_mode='ignore' (:863) skips _format_rejects; structured exempt from the
  ocr_conf cap (:449) → a whitelist-snapped valid-shaped WRONG code commits at 90 → auto-file. The only
  backstop (inline reconcile) reads the SAME whitelisted crop → both snap identically = same-pixel agreement,
  not corroboration. Shared ladder inherits the WEAKEST downstream gate. Prep-only preserves fail-toward-review.
- Premise fixes: date parse/salvage only normalise (can't correct 19→09 — heal depends on the prep);
  stale comment template_mapper.py:939 "Off by default" → reconcile defaults ON (fixed). Baseline = current
  HEAD (crop-flips ON), do NOT revert them.
- Conditions C1 prep-only/no-whitelist · C2 preserve SHARPEN fallback rung · C3 reconcile ON + comment · C4
  whitelist=gated slice 2 · C5 kill switch default OFF per-call.
- **BUILD + GATE OUTCOME:** slice 1 shipped (fe? see git), STRUCT_CODE_READ. Faithful realdoc OFF-vs-ON:
  +1 ref heal (#218 SO-68195 digit-sub read RIGHT), would-auto-file-wrong set IDENTICAL (true M=0), zero
  accuracy drop, no new regressions. #494 unhealed but UNCHANGED (fall-through, not cleaner-but-wrong).
  Flipped ON — strictly-safe net improvement. Slice 2 (whitelist) + #494 (second-render/harder digit-sub)
  deferred. Pins: test_struct_code_read.py.

---

## 2026-08-03 — Crosscheck-outlier reconcile (doc-09: a correct ref lost to a lone fresh-locate garble)
**VERDICT: SIGN OFF WITH CONDITIONS.** Consult: 007 + reggie (proposed in-crosscheck Layer A) + gary
(proposed post-merge Layer B) → Oracle. Case: `anchor.py` authoritative-crop cross-check does a FRESH
full-page locate-OCR that can ITSELF garble a valid ref, then flips the correct value to that lone
outlier on `_reads_disagree` ALONE (doc-09 = NorthgateTextiles_purchase_order_09, GT PO-83150). E2 only
owns the opposite (flip-corroborated / City-Office) direction.
- **Fork RULED: Layer B (post-merge engine), NOT Layer A (in-crosscheck).** The raw `ocr_text` shares
  source pixels with the crop (correlated, weak witness); the distinct-stage LEDGER (0.5_mapping,
  1_keyword) is the genuinely-independent one and is engine-only. Post-merge is the designated seam
  (engine.py:4332) + the established G1/Fix-A pattern.
- **C1 (SHIP-BLOCKER, MET):** the crosscheck OVERWRITES value/method in place → the ledger's 2_anchor
  becomes the post-flip garble, so B-as-specified only heals mapping-backed docs; a ⊕-anchor-only
  sibling stays broken (a document fix). Preserve the pre-flip crop as an independent crop-family
  witness (`anchor.py` stashes `_crosscheck_original`, GATED; consumed+popped by the pass).
- **C2 (MET):** `_method_family` folds every `anchor*` into one bucket → bare-anchor/registration would
  falsely count. New `_crosscheck_witness_bucket` excludes registration/bare-anchor/the-flip + requires
  ≥1 crop-family leg; page-presence a separate AND. So a silent drop-flag never rests on two correlated
  full-page reads.
- **Silent-keep (drop flag) APPROVED** (given C2) — restore fires only on ≥2 independent families +
  page-present, honouring oscar's "two independent reads agree" bar; mirrors E2's re-base to 90.
- **Phasing ENDORSED:** ship Slice-1 = Layer B at the current crosscheck scope; do NOT widen the fire-
  gate (that arms more independent-OCR flips). Slice-2 = a UNIVERSAL post-merge verify (ledger +
  ocr_text, per-type predicate, lone-absence-never-vetoes) reaches text/numeric/all-custom with NO new
  OCR. Residual §4C (crop+mapping+keyword+page all share one misread) ACCEPTED — same class G1/Fix-A
  already accept; pinned as HYPOTHESIS.
- **BUILD + GATE OUTCOME:** shipped `09685d9` (`CROSSCHECK_OUTLIER_RECONCILE`). Faithful
  --reprocess-manifest realdoc (522 docs) OFF-vs-ON: ref 96.2%→96.6% (+2 heals #344/#353, both
  anchor_crop_crosscheck→anchor_inline, corr False→True), M=12==12 (silent-auto-file set IDENTICAL),
  zero accuracy drop, exactly 2 docs changed, City-Office untouched. Flipped ON. Slice-2 deferred to
  owner go/no-go. Pins: test_crosscheck_outlier_reconcile.py.

---

## 2026-08-03 — Slice-2: UNIVERSAL post-merge verify (owner GO; all field types "where possible")
**VERDICT: SIGN OFF WITH CONDITIONS.** Consult: gary (two-tier design) + reggie (per-type predicates)
+ 007 (OCR-divergence ground-truth) → Oracle. Design: ONE post-merge pass beside Slice-1 (after :5980,
before G1), Slice-1's 4-condition gate skeleton verbatim, per-tier AGREE/PRESENT primitives.
Tier R (RESTORE): ref/code (+all-digit cores via numeric presence — reggie traced a REAL shipped gap:
`250000` falsely "present" on a page printing `1,250,000`), date (locate-and-parse presence), numeric
whole-number + percentage. Tier F (FLAG-only, note names the disagreeing value): text (token AGREE,
total edit budget 1; per-token presence — whole-value 48-cap is a polarity bug on long values),
email/website (structural @/. — core-join falsely assembles `johndoeacmeco` from a letterhead),
postcode/vat/iban. EXCLUDED: currency (totals-maths pass owns; invoices repeat amounts → wrong-but-
corroborated is the NORM), supplier_name (identity lane). 007's constant: same-pixels-different-
postprocess witnesses are 5:1 false:true (D2 bake-off) — Tier-III never counts.
- **Fork D-1 RULED: reggie** — restore emits `anchor_inline@90` + a trace transform event carrying the
  true witness method + deposed value. Emitting the witness's REAL method would MINT authority (a
  mapping witness ⇒ `template_*` ⇒ `_is_stage05_located` ⇒ authoritative-band it never earned).
- **Fork D-2 RULED: currency exclusion CONFIRMED**; corollary — numeric restores WHOLE-NUMBER canonicals
  only (decimal-tailed alternatives flag at most): keeps qty/count, excludes money-shaped `number`.
- **S-1 (SHIP-BLOCKER):** Stage-2.5b learned-misread correction (:5026) sets NEITHER `was_corrected`
  NOR a note — only a `+corrected` method suffix — so the consensus eligibility list would let Tier R
  UN-FIX a correction (corrected value page-ABSENT by construction; the garble page-present + "agreed"
  by correlated glyph misreads). Exclude `+corrected`/`+snapped` winners.
- **S-2 (SHIP-BLOCKER):** gary's D1-ordering seam was STALE — D1/content-nature flags run at :5603,
  BEFORE post-merge; a restored value gets ZERO content-nature vetting. Mandatory: (a) confusable-
  substitution demotion (identical skeleton, ≤2 confusable digit subs via D1's shared comparator →
  never restore, flag only); (b) re-run deterministic content-nature checks (date-in-ref, ref-length,
  prefix-outlier) on the restored value or flag instead.
- **S-3:** the D-1 witness-method hazard above (authority minting) — why reggie's emit wins.
- **C6:** the 522-doc realdoc GT covers ref/date only — it CANNOT FAIL on 2b/2c. Gate needs a
  numeric/text GT arm (Customer Doc Test corpus ground_truth.json) + hand-verify every census hit.
- **C7 (owner premise):** "all types where possible" ships with currency + supplier_name deliberately
  excluded — the go/no-go must SAY so (stated to owner 2026-08-03).
- Census-first endorsed; staged dark flips 2a (ref-widen) → 2b (numeric) → 2c (flag tier);
  switches `UNIVERSAL_VERIFY_RESTORE` / `UNIVERSAL_VERIFY_FLAG`.

---

## 2026-08-03 (evening) — Teach-mapping edge-debris heal (Slice A) + word-snap (Slice B) + barry screen
**VERDICT: A = SIGN OFF W/COND, fork RULED reggie (witness-equality); B = SIGN OFF W/COND (design,
build after A, SEPARATE flip window); barry ideas screened per-idea.** Consult: reggie + gary
(parallel) + barry (product) → Oracle. Incident: teach-wizard template 26 value box ~7px right of
label "Delivery Note No."; +1.3-1.5° siblings bleed the label-tail dot → `'. DN-60902'` class;
`_pick_fuller_code` agree branch (:590) discards the computed clean inline read; drift path commits
`template_mapping_shapewarn`@70 + note; under-tolerance rotation = SILENT clean@90 commit on the
absolute path. Stale ":715 DARK by default" comment (drift reconcile defaults ON) caught by both
specialists — the :939 twin was corrected 08-03, this copy missed.
- **Fork ruling (reggie over gary):** (1) the :593 un-clip branch already commits inline surfaces
  COLD on weaker evidence — cold-inert would be incoherent in the same function; (2) gary's
  shape-arbitration has a BOOTSTRAP seam — cold-inert lets dotted confirms become the ≥3-confirm
  shape his predicate needs; (3) the strip is bounded (committed string must verbatim-equal an
  independent-geometry read); (4) internal-separator disagreements still route to review.
- **A conditions:** A-C1 pin cold `#12345`→`12345` as named-deliberate; A-C2 pin spaced/em-dash/
  sigil-with-history/dotted-inline/absolute-silent-class; A-C3 strip-nonempty + verbatim-only
  commit; A-C4 fix the stale comment in-commit, switch default OFF; A-C5 gate enumerates every doc
  LEAVING the hold set (M-unchanged alone is the wrong phrasing when the fix releases holds);
  A-C6 heal trace event (diag-only), no method-string change.
- **B conditions:** B-C1 label-cut in the LOCATED frame per rung (the clamp frame-trap); B-C2
  wrong-row pins + enumerate fail-through→commit conversions; B-C3 invariant pins (majority-inside,
  narrow-box exclusion, 4× union cap, geometry-absent byte-identical); B-C4 `TEMPLATE_TARGET_WORD_SNAP`
  OFF + SFDEV seated→snapped; B-C5 A stays permanently beside B.
- **barry screen:** #4 tidy-files-without-review SAFE RULE = verbatim independent-geometry
  corroboration (the A bar) or located-at-taught + ≥3-confirm shape; enforced by the MAPPER not
  attaching the note (never a trust.js note-class bypass); receipt persists to audit regardless.
  #5 self-heal refit = located-frame + versioned + ≥N distinct docs. #7 dots read the EXISTING
  ledger (never new crosschecks). #11 needs template_id attribution on corrections. Shared spine =
  ONE per-field agreement+tidy event at the engine post-merge choke point. Owner rule applied
  (2026-08-03): minimal customer interaction — visibility ideas route to SFDEV, not customer UI.

---

## 2026-08-03 NIGHT — B flip + rb_531 false-note class (frag strip · C2a clip commit · provisional channel)
**VERDICT: B FLIP SIGNED (B-F1 met — decomposition: shared-535 delta = +1 ref heal #540, +1 date
heal #535 '21-11-2096'→'2026', 5 flag-drops on correct values, M identical; the +6/+6 headline was
corpus growth). rb_531 premise CONFIRMED (:~750 disagreement branch stamps shape_warn
UNCONDITIONALLY on a never-shape-checked inline value — the note is factually FALSE; plus the
α-variant: fragment+full-core commits DIRTY clean@90 via the absolute rung). Fork RULED COMPOSITE:
gary C1 label-suffix fragment binding (≤2 letters + separator, case-insensitive suffix of the
mapping's OWN anchor_text tail) + consent LADDER (confirmed verdict FINAL → provisional taught
skeleton → reggie's 1-letter floor). C2a + #3 SIGNED W/COND.**
Consult: gary (route trace) + reggie (predicates) + barry round-2 + Chris (customer-sim; "a hold
with nothing to fix is a tax", trust 7→2 — quoted in the briefs by owner instruction).
- **S1 (caught by Oracle):** C2a's locate-token leg can compare the locate text WITH ITSELF when
  `_read_inline_box` falls back to `located['inline_value']` — a manufactured witness. Mandatory
  ladder-provenance bit; fallback-sourced inline disqualifies C2a. BUILT (3-tuple return + pin).
- **S2:** provisional channel = separate index + ONE consent helper (`_shape_consents`); never a
  format_lookup wrapper (would leak a 1-count taught skeleton into every veto path). BUILT — engine
  strips provisional rows before EVERY established builder; invisibility pinned.
- **S3:** the pre-flip gate must run the COMPOSED config (B+A+frag+clip ON) — a B-OFF baseline
  measures a config that never ships. RUN as ordered.
- **S4:** the strip's two witnesses share the label-boundary decision (decapitation class
  'NO-12345' under "Order No.") — the consent ladder is mandatory, not decorative; taught
  'NO-#####' skeleton refuses stripped '#####'. PINNED.
- **S5:** `_pick_fuller_code` branch order now load-bearing (un-clip → frag → C2a → conf race) —
  source-order PINNED.
- barry #4 post-merge flag-refute: WRONG LAYER, parked (C2a fixes at source with more evidence).
  ocr_type confirmed production-INERT; JS role-aware seeding + BOTH edit-surface selects = admin-
  only GO (built); `_seed_field_patterns` ref_field_key threading = separate gated follow-up.
  C2b honest disagreement copy = owner-morning. Teach-time box snap (barry #1) = owner-morning
  (UI-visible teach flow).
- Switches: `TEMPLATE_CODE_FRAG_CLEAN` / `TEMPLATE_CLIP_COMMIT` (settings `template_code_frag_clean`
  / `template_clip_commit`), default OFF. Pins `test_template_frag_clip.py` (29 checks).
- **NIGHT BUILD + GATE OUTCOME:** all conditions built (S1 provenance bit, S2 separate-index +
  single consent helper + engine-side provisional strip before every established builder, S4
  decapitation pin, S5 source-order pin — `test_template_frag_clip.py`, 29 checks). B FLIPPED ON
  (`template_target_word_snap=true`). Composed gate (B+A+frag+clip ON, 540 docs) vs the B+A
  baseline: BYTE-IDENTICAL (M 10==10, zero changed docs, zero drop) → frag+clip FLIPPED ON
  (`template_code_frag_clean` / `template_clip_commit` = true) per the standing instruction; the
  corpus's derived-rung instances were already healed by B, so frag/clip guard the ABSOLUTE rung
  (live-jitter class) with unit-pinned heal evidence. Settings toggles shipped for all three.

---

## 2026-08-04 — NAME_UNCLIP built (dark) · Customer-corpus scorer SHIPPED · Slice-2 2b/2c FLIPPED
- **NAME_UNCLIP_RECONCILE** (reggie → Oracle SIGN-OFF-W/COND): built per both conditions — the
  cut-glyph rule ('Studio'.startswith('Stuc') is FALSE; one edge-glyph substitution at the cut) and
  the corrected premise (Stage-4.5 wordness note IS Python-side and STARVES the heal on
  lexicon-rich scopes — pinned). Carve-out documented at _override_eligible. 23 pins ALL PASS;
  realdoc no-harm arm GREEN (0 changed docs, M 10==10). DARK: its corpus gate needs a TAUGHT arm
  (cold install fires no Stage-0.5) — scorer increment 2.
- **Customer-corpus GT scorer** (`stress_test/customer_corpus_score.js`) — the Oracle-C6 gate:
  cold-install throwaway DB, stratified deterministic sample of the 11,000-doc Desktop corpus,
  9 lanes incl. names/numeric/structured/custom, per-fire census capture, env-switch arms.
  Cold baselines (288 docs): ref 45.1 · date 67.7 · total 41.2 · type 83.0 · vat_no ~0 (custom
  structured fields have NO seeded label aliases — fine-tuning-arc item) · issuer 0 (suggest-only
  first-contact design).
- **Slice-2 2b + 2c FLIPPED ON** (`universal_verify_numeric` / `universal_verify_flag`): base vs
  2b vs 2c arms all BYTE-IDENTICAL on the corpus (0 fires, 0 flag noise) + realdoc no-harm.
  Honest note: neither gate could FAIL yet (no number-TYPE fields in the corpus; no cold
  text-fire exhibits) — the flip evidence is symmetric pins + double no-harm + measured-zero
  noise; the classes arm for live jitter docs. The 2c flag-noise fear (Chris's reflex-confirm
  ledger) measured ZERO.
- SFDEV chord fixed (Ctrl+Shift is never text entry); teach-time box word-snap shipped ON
  (owner-approved read-back display = the gate); C2a decline instrumentation live
  (clip_decline reasons in SFDEV).
- **TAUGHT + JITTER arms (the scorer earning its keep, same day):** taught arm (GT-derived
  mappings via teach_from_gt.py + faithful manifest): cold→taught ref 45→70 · date 68→92 ·
  issuer 0→75 · type 83→100 (288 docs). **JITTER arm (targets right-cut 18% — the human
  cutting-draw disease) CRATERED the taught pipeline (ref 70→22, date 92→21, issuer 75→0) and
  the ENTIRE shipped heal stack rescued ~nothing.** Three mechanisms identified for the next
  arc: (1) CONSENT STARVATION — clip-commit's shape ladder needs learned/provisional history a
  fresh install lacks (consent always 'none' → C2a structurally dead cold); (2) BORN-DIGITAL
  WORD-GEOMETRY GAP — digital scores WORSE than scanned under damage (ref 12.5 vs 32.1; second
  sighting) — the text-layer path starves every word-geometry heal; (3) MAPPER-HEAL CENSUS
  BLINDNESS — the mapper heals log nothing (diag markers only), so fire-counting needs
  instrumentation. NAME_UNCLIP flip: **HOLD** — jitter shows the lever is the substrate, not
  more heals; also the corpus has NO non-supplier name field, so unclip is structurally
  unexercisable there until customer-name GT exists.

## 2026-08-05 — Jitter-crater reframe: premise overturn + A/B/C/D slices (gary + 007 → Oracle)

**Consensus in:** the 08-04 charter ("born-digital word-box synthesis = arc #1; the text-layer path
yields NO word boxes") was investigated at rung level and REFRAMED: (1) the crater's binding
mechanism = ABSOLUTE-RUNG CLIPPED-CLEAN-READ COMMITS (cut taught box reads a clean partial on crisp
pages → passes `_gate_value` shape_mode='ignore' → commits template_mapping 78-90, no note; the whole
heal ladder keys on page-vs-taught DISAGREEMENT and this class is stored-box damage on an UNDAMAGED
page, so nothing fires — armed-env rerun j120armed == j120s byte-identical); (2) digital-worse-than-
scanned = crisp renders make clean partials that PASS the gate while scan garble FAILS it and falls
through to label/keyword heals (j120s wrong-answer classes: digital ref 33/49 clean-prefix-of-GT,
issuer 44/56); (3) 34% of harness taught mappings had poisoned/absent anchor labels
(teach_from_gt.find_label picks neighbouring VALUES as labels — the live wizard's anchorLabel.js is
defended) — the crater partly measured harness infidelity; (4) date validation + parse_date accept
3-digit/cut years → Stage-4 expands fragments to confidently-wrong dates. Slices: A harness label
fidelity · B date-clip gate + parse_date year floor · C TEMPLATE_ABS_EDGE_GUARD (read-time word-edge
predicate + word-bounded GROW + re-read + per-type comparator + _shape_consents ladder, abs rung,
codes+dates, names excluded) · D _label_score digit-exactness guard. Fork: gary demote-to-ladder vs
007 grow.

**Oracle verdict:** premise overturn UPHELD (born-digital synthesis demoted to follow-up; every claim
traced — template_mapper has no born-digital branch, word geometry obtainable at Stage 0.5 on digital
renders; only real text-layer hole = `_page0_geom` letterhead, disproven as the crater by t300 issuer
90.3% digital). **A SIGN OFF · B SIGN OFF W/COND · C SIGN OFF W/COND · D SIGN OFF W/COND.** Fork
RULED for 007's GROW on code (:881-882 derived rung re-seats at DRAWN width → demote re-clips for
position-only mappings and silently demotes taught authority ignore→flag).

**Added value? YES — ship-blocker class.** (1) Found the WYSIWYG pin at
`test_template_target_word_snap.py:108` is a DEAD GUARD — `asrc.find('FAST PATH…')` >
`asrc.find('def _read_registration')` (markers at :1044 vs :974) → empty slice → the "absolute rung
untouched" assertion passes VACUOUSLY forever (the CLAUDE.md dead-guard trap; C-C0 = rebuild it
behaviourally before touching the fast path). (2) Caught TWO seams the consensus missed: B-starves-C
composition (date-clip rejecting abs_text first means C's abs-rung predicate never runs — C's
predicate must be gate-outcome-independent, grown text re-gated through B) and B over-rejecting
complete dates with trailing debris ('07-01-2026.' — B-C1 4-digit-year exemption). (3) Marked the
<0.1% clean false-fire estimate HYPOTHESIS (legacy pre-snap teaches fire more; realdoc M=0 is the
real guard, not t300 zero-fires).

**Conditions:** A-C1..C3 (sanitizer parity · value_as_label ≤2/310 pin · re-baseline BEFORE
attribution, retire old crater numbers) · B-C1..C4 (4-digit exemption · raw-text predicate, no
salvage resurrection · pins incl. '07-01-20' stays ACCEPTED · kill switch TEMPLATE_DATE_CLIP_GATE
default OFF, parse_date floor unswitched but rides realdoc gate) · C-C0..C5 (dead-pin rebuild first ·
gate-independent predicate · left-grow bound = located label_box right edge + 0.002, right ≤2.0×
drawn · never mutate stored coords (pin) · names excluded, issuer lane declared out of scope ·
rb_531 + frag/edge-clean pins green) · D-C1..C3 (own kill switch default OFF · wrong-date-lock +
"VAT No 1" pins · _match_label_run reach named in tests). **Sequencing approved: A → re-baseline →
D+B → C.** Gates: t300 byte-identical + ZERO predicate fires (counted) · jitter ref/date/po_ref climb
BOTH renditions + digital/scanned asymmetry narrows · LEFT-cut jitter variant · realdoc 535 M=0.

**Outcome:** ALL FOUR SLICES BUILT + GATED GREEN same session (commits b63bd86 A · 8f631b8 B+D ·
2ddd5fa C · fafd8b4 C-v2). C's first contract regressed the clean arm (18 T→F) — three probed root
causes fixed in v2 (defer-cap fall-through so the floor never pre-empts the inline reconcile ·
edge-directional comparator (left cut = suffix discipline) · independent-witness corroboration of
the grown read against the cut word's locate-pass text · junk-wrapped complete-4-digit-year date
skip). FINAL GATES: clean t300s→t300c3 ZERO True→False + 21 pure heals (ref 70.1→74.7%, date
91.3→93.4%) · right-jitter j120n3 ref 85.7/66.1 date 91.1/83.9 po_ref 100/78.6 job_ref 100/100
(dark baselines 12.5/19.6 · 3.6/26.8 · 14.3 · 0/57) · left-jitter j120L3 ref 69.6/62.5 (was
3.6/17.9) · realdoc 543-doc baseline==armed on every axis (ref 95.6, date 99.3, silent 14==14,
wrong-auto-file 11==11 standing, M_type 0). Switches DARK pending settings-bridge + owner flip.

## 2026-08-05 (later) — Deskew degradation: S1/S2 vet + the same-day REFUTATION

**Consensus in (007):** live doc 561 reads its taught box perfectly RAW but garbles after its own
+1.9° deskew; root-cause hypothesis = third-resample phase erosion + BICUBIC ringing; slices S1
supersample-rotate (4 lines, geometry-identical) · S2 raw-frame witness extension to template
methods · S3 pdfium matrix render (reserve) · S4 raw-preferring frame election (bank dark).

**Oracle verdict:** S1 SIGN OFF W/COND C1-C5 (C1 = region.py's private duplicate rotate must route
through the shared helper — the "operator validates pixels the pipeline never reads" seam; C2
megapixel clamp; C5 default ON only after the C4 gate) · S2 SEND BACK w/ revival bar + preapproved
C6-C10 (method-name authority: adopted method must stay startswith template_mapping; note
whitelist exact _EDGE_CUT_NOTE; the THIRD teach surface — the teach window's own Straighten —
named + pinned) · S3 reserve · S4 do-nothing. Corrected 007 twice: THREE deskew-aware teach
surfaces not two; "display shares the helper" was FALSE (region.py:126 private rotate).

**Outcome — H REFUTED same session:** S1 built (shared helper + region.py C1 unification +
deskew_angles_out + 11 pins incl. the analytic SIGN pin, tests/test_deskew_ss_rotate.py) and
probed on doc 561: the supersampled rotation garbles the SAME header the SAME way ('Demers/Nene/
Nes/DEOL'). The degradation is NOT interpolation quality — suspect #1 is the scan's noise field
smearing into strokes under ANY rotation (raw+tilted reads perfectly; Tesseract self-tolerates
≤~2°). Per C5, DESKEW_SS_ROTATE ships DEFAULT OFF; the C1 unification stays (behaviour-identical
with SS off). The S4 raw-preferring election / read-path angle floor now hold the evidence bar —
next arc's charter, NOT built. Owner interim: Straighten-all OFF on the affected batches.

**Added value? YES** — C1 caught a real divergence seam (owner would have validated teach reads
against display pixels the pipeline never sees), and the falsifiable-gate discipline (his C4/C5)
is exactly what caught the refutation before a default-ON ship.

## 2026-08-05 (late) — DESKEW_RAW_CROPS gate OUTCOME: RED — the election pivots to a canonical-level-frame design

**The C3/C4 gate did its job.** Deskew-forced taught pair (dsk_off/dsk_on, SAMPLE=112): refs climbed
(scanned 58.9→66.1, job_ref 85.7→100) but date −5.3, issuer −5.4, customer −23.8 scanned; per-doc
diff = 24 T→F vs 16 F→T, the regressions dominated by CAPTION-GRABS ('INVOICE TO'/'BILL TO'/
'CUSTOMER' committed as customer_name). MECHANISM: the corpus teaches on LEVEL digital docs → stored
raw coords are a level frame; a scanned sibling's RAW frame is tilted ±1.6° — the election
reintroduced the tilt mismatch deskew exists to normalise. Deskew's placement normalisation is
LOAD-BEARING; the compound teach-tilt case ruled "acceptable residual" is in fact the corpus's (and
the customer's) MAIN case. Election stays DARK; no flip.

**Corrected mechanism record (band probe):** a CORRECTLY-PLACED, slightly-generous crop on the
deskewed 300-DPI frame reads 'DN-98447' fine — the earlier "any rotation garbles any read" claim
was overbroad (the failing mapper crops were misplaced in x AND y; the genuine pixel casualty is
the full-page ~120-DPI locate pass). The dominant defect is FRAME MISMATCH.

**The pivot (next arc, Oracle review required):** ONE CANONICAL LEVEL FRAME — the owner's hint
("look at how Review/target teach does it — works on straighten every time") decoded: Review works
because box and pixels share the straightened frame end-to-end. The pipeline's actual bug is the
teach-time back-transform-to-raw: coords stored in the teach doc's OWN tilted frame match nothing
(deskewed sibling off by θ_teach; raw sibling off by θ_sib−θ_teach). Candidate designs: (a) teach
stores LEVEL-frame coords + processing deskews to level (save-path change + legacy migration or
epoch marker); (b) persist θ_teach per template/anchor and compose at read time; (c) re-detect the
teach sample's angle on demand (sample_document_id is stored). Owner rule stands: NO PIPELINE
SHARING (the display/teach rotation stays decoupled — pinned in test_deskew_ss_rotate.py).

## 2026-08-05 (night) — TEACH_ANGLE_COMPOSE outcome: GREEN on the faithful corpus

Slice 1 built per C1-C6 (`c29b797`), then two gate findings fixed in `036ba26`: (1) the MAIN
corpus's scanify rotated expand=True — grew pages + shifted content by angle-dependent margins, a
geometry no real scanner produces; the lvl pair's digital crater was THIS artifact, not the
design (faithful expand=False side corpus "Customer Doc Test NF" now carries the gate; SCAN_EXPAND=1
restores the old shape for comparability); (2) corner-AABB composition BLOATED wide boxes by
w·sinθ (caption line pulled into free-text crops) — the teach surfaces persist LEVEL w/h and
back-transform only the point, so the exact inverse rotates the CENTRE and keeps w/h (NO-BLOAT
pin, 1e-12). **FAITHFUL GATE nf_off→nf_on2 (tilted teach + deskew forced): ref 59.4→72.5 /
68.1→82.6 · date 85.5→98.6 / 84.1→95.7 · issuer 44.9→66.7 / 53.6→73.9 · po_ref 77.8→94.4 /
88.9→100 · job 100/100 — every taught structured lane climbs on BOTH renditions.** Named
residual → follow-up slice with its own Oracle round: the caption-commit class on wide free-text
recipient boxes (customer scanned 22.2% — captions vary per sibling; needs the known-caption
vocab veto extended to the mapper's free-text gate). Next: owner flip decision after the Chris
sandbox reprocess of the owner-trained docs (Straighten ON + TEACH_ANGLE_COMPOSE=1).

---

2026-08-06 — compose-box word-snap (morning round #1) — VERDICT: SEND BACK / WRONG LAYER.
Premise false: the abs-rung nicked-code/date class is NOT unhealed today — _abs_edge_guard
runs on the composed target_box (engine.py:4604 -> _extract_one:1245), gate-outcome-independent,
catches 12-95%-inside nicks (_find_edge_cut_words:1618-1630) WITH corroboration + fail-to-review.
Compose-snap is a 2nd, pre-read, consent-less healer on the same class/rung — the code's own
rule forbids it ("two dark healers racing one class breeds M=1s", template_mapper.py:254).
Incremental accuracy over the compose-on/snap-off baseline (nf_on2) ~= 0; only effect = converting
edge-guard REVIEW FLAGS into SILENT commits of un-corroborated cross-document placement guesses.
SEAM (Claude's "adopt 007" resolution OVERTURNED): 007's "pass snapped box to edge-guard" opens a
silent-truncation hole — _snap_box_to_words is a re-fit that can SHRINK (drop a multi-token value's
tail); the excluded tail is fully outside the snapped edge -> no cut -> edge-guard no-fires ->
truncated value commits at full confidence. gary's un-mutated-box wiring recovers it (safe
direction). If ever built: gary wiring + pass located.label_box (not None) + pin the truncation
fail-safe + fix the dead-guard-green gate (NF lacks space-separated in-scope values; needs a
synthetic multi-token nick fixture + snap-application census>0 + False->True heal count).
RIGHT FIX (right layer): add a word-snap-union GEOMETRY WITNESS to _abs_edge_guard's consent
ladder — a composed nick whose grown-read extent AGREES with the snap union heals CLEAN (rewrite)
through the existing ladder even without confirmed/provisional shape (the teach-once case); an
un-corroborated composed nick still FLAGS <=70. One healer, preserves fail-toward-review, no
shrink/over-grab silent commit. Claude action: pre-read compose-snap NOT shipped (kept OFF/dark
pending the gate's False->True number as warrant); enabler (teach-commit sample-angle write) stands
(independent, un-objected). Chris Kyle run to use the SHIPPED config (compose + edge-guard, NO
compose-snap) so the crop review measures the real system.

  GATE CONFIRMED THE SEND-BACK (2026-08-06, NF corpus SET=both SAMPLE=228 SEED=7, shipped flags
  both arms): nfc_off (compose on, snap OFF) -> nfc_on (compose-snap ON): date +3 (97.8->98.7);
  account_no -6 (32.5->29.8, all on LEVEL digital docs); job_ref -4 (100->66.7). NET -7, no real
  gain. The regressions ARE Oracle's predicted modes: job_ref is space-separated (4-4-1) ->
  multi-token shrink-truncation; account_no on level digital -> compose fires mode-level even on
  level siblings, snap re-fit over-grabs/shrinks. Compose-snap REVERTED in full (mapper + engine
  tag + dedicated pin file); enabler (teach-commit sample-angle write) retained. RIGHT FIX stands
  for a future round: snap-union geometry witness INSIDE _abs_edge_guard's consent ladder.

## 2026-08-06 (later) — snap-union geometry WITNESS in `_abs_edge_guard` (the deferred RIGHT fix) — SIGN OFF WITH CONDITIONS, then SHELVED DARK on a net-negative gate
Built the fix Oracle named this morning: when the edge-guard's grown code read `gv` is corroborated by
the LOCATE-tier words inside the grown box (exact `_code_norm` union == gv, edge-anchored to the un-cut
side of the TAUGHT box), promote a no-history (teach-once) nick to a CLEAN heal instead of flagging @70.
- **Advisor consensus** (007 + gary + reggie): right layer = the mapper edge-guard (keyword read
  unavailable at Stage 0.5; engine-reconcile = the "two healers" trap). Witness = cached locate tier
  (no new OCR). EXACT union equality, NO glyph fuzz (reggie: confusable/edit-≤1 admit the sequential
  neighbour). New dedicated switch `TEMPLATE_SNAP_UNION_WITNESS`, default OFF, nested in the guard.
- **Oracle FORK RULING**: occupancy-only (gary/reggie) is INSUFFICIENT — 007's directional un-cut-edge
  anchor is load-bearing (it is the only element certifying located-at-taught-POSITION, not just
  reading). But 007's 0.5·g coincidence is a reading tolerance mis-used as placement — softened to
  `R-cut: -g ≤ (ux1-tx1) ≤ 0.25·W`, `L-cut` mirror, `LR: no clean promotion`; + contiguity ≤1.5·g;
  occupancy≥0.6 secondary; frame = target_box. SEAM caught: witness must skip ONLY frag and still flow
  through the neg-witness veto + `refused` guard. Built to spec; pins green incl. the straddle- and
  LR-rejection (`tests/test_template_snap_union_witness.py`, 15/15).
- **GATE = SEND-BACK (net-negative), the residual Oracle NAMED bit for real.** NF both-arms
  (SET=both SAMPLE=228 SEED=7, shipped flags): witness ON = ref −1, account_no −1 (both on Ironclad
  statement_0042), ZERO gains. Determinism confirmed (OFF re-run byte-identical). Fire trace: most
  fires are no-ops frag already heals; the witness-ONLY promotions skew WRONG — e.g. `po_ref
  '19-12-2025' → '25-12-2025'` (a CODE box sitting on a DATE, "healed" one wrong value to another).
  The design cannot distinguish "grow recovered the clipped TRUE value" (the goal) from "box is on the
  WRONG field, both tiers agree on a wrong value" — geometrically identical, and not rare enough. The
  motivating VIN-O0U5D case is NOT in the corpus (live Kyle docs), so best case unproven-positive.
- **DECISION: SHELVED DARK.** Code + pins kept, default OFF, byte-identical off. NOT flipped. The class
  is a cross-doc PLACEMENT-transfer failure ("reading fine everywhere; placement transfer is the failure
  class") — a read-time value-swap healer is the wrong instrument (007: "a reading failure CAUSED by a
  placement failure"). Next: fix the PLACEMENT (prefer the label-relocated + word-snapped derived read
  when the absolute box is edge-cut), not another read-time healer. No more read-time swap healers on
  this class without a placement-layer redesign first.

## 2026-08-06 (later still) — Stage-0.5 PLACEMENT pivot: edge-cut → LABEL-RELOCATE — SIGN OFF WITH CONDITIONS, GATE GREEN (+1/0-regress), committed dark
The pivot after the witness shelved net-negative: stop patching the READ, fix the PLACEMENT. The
delivery_number VIN-O0U5D class is a cross-doc placement-transfer failure — a taught ABSOLUTE box
seats a hair off on a sibling (sub-`_DRIFT_FLOOR`), CLIPS the value → garble; the horizontal
edge-guard grow structurally cannot recover a VERTICAL seat clip. Fix: when the guard can't clean-heal
a cut, re-seat off the LOCAL located label + stored offset + word-snap (`_relocate_and_read`, the
reliable placement primitive) and prefer it. Switch `TEMPLATE_EDGE_CUT_RELOCATE`, default OFF.
- **Advisors** (007 + gary AGREE): right layer = the edge-guard non-rewrite dispatch; the re-seat
  cures BOTH axes (label-origin Y + `_snap_box_to_words` both-axis lock) where the horizontal grow
  cures neither; edge-cut trigger >> lowering `_DRIFT_FLOOR` (3 sites, diffuse blast radius).
- **Oracle FORK RULING + 4 catches**: (A) locate scope → 007 (LOCAL `located` only; a page-wide locate
  buys the wrong-repeated-occurrence M=1 and drift is already owned by the drift branch). (B) accept →
  SPLIT: gary's 3-part (credible + not-shapewarn + materially-different) chooses the review PRE-FILL,
  but a CLEAN commit needs consent/frag-tie/witness. Caught: (0) the y-cure is ENTIRELY
  `_snap_box_to_words` — CO-REQUIRE `TEMPLATE_TARGET_WORD_SNAP` (verified ON in prod), else inert;
  (1) the flagged `{'result'}` branch RETURNS before any post-dispatch relocate → intercept BOTH
  non-rewrite outcomes; (2) "prefer verbatim" clean-commits a teach-once value @90 = silent auto-file
  → CAP to FLAGGED @70 pre-fill, clean only via confirmed/provisional consent; (4) doc_06 garble shares
  NO glyphs with truth so the frag-tie can't clean it — the witness clean-UPGRADE is a deferred,
  ISOLATED Stage-2 (own switch, own re-seat-frame gate), not un-shelved here.
- **BUILT to spec**: helper `_edge_cut_relocate` (Rule A local-only, co-require word-snap, prefer→
  FLAGGED, clean only via shape consent); dispatch intercepts both non-rewrite outcomes; byte-identical
  off. Pins `tests/test_template_edge_cut_relocate.py` (15/15 incl. Rule-A never-page-wide-locate,
  teach-once→FLAGGED, same-garble guard, shapewarn-reject, co-require, OFF byte-identical, dispatch
  intercept). Edge-guard/witness/word-snap/compose suites unchanged.
- **GATE GREEN**: NF both-arms (TEACH=1 SET=both SAMPLE=228 SEED=7, shipped flags): **+1 gain, 0
  regressions** — po_ref on Ironclad DELIVERY_NOTE_0093 (scanned) OFF wrong-`edgegrow` → ON correct
  (a real cross-doc placement-clip heal on a delivery doc, the exact class). 13 `_relocated` fires, all
  FLAGGED pre-fills → review (M=0). ref/date/total/issuer/customer/vat_no/account_no/job_ref all
  unchanged. Committed DARK + owner env-bridge + Settings toggle. Owner flip + owner-watched doc_06
  reprocess confirmation pending (the standalone harness couldn't bit-reproduce doc_06's OCR context).
- **OPEN (named, not implied fixed — Oracle Cond 6)**: a PURE-vertical-inside-column clip with NO
  horizontal word cut never arms `_find_edge_cut_words` → this fix never triggers. Needs a separate
  row-seat-mismatch sensor. Logged in pendingfeatures.md. And Stage-2 (witness CLEAN upgrade on the
  re-seated box) remains a deferred own-gate round.

## 2026-08-06 (final round) — C2a trailing-glyph SLACK (Larkspur worksheet_12 WS-1493S→WS-14939 false shapewarn) — SIGN OFF WITH CONDITIONS
Pinned via a faithful traced reprocess: worksheet_12 reference_number commits the CORRECT `WS-14939`
but @70 `template_mapping_shapewarn` with the factually-false "manually mapped value differs from the
usual format" note. Cause (`_pick_fuller_code`, template_mapper.py C2a leg (i)): the abs box read
`WS-1493S` (trailing `9`→`S` CLIP-misread, rigid_conf 44); the label-anchored INLINE read `WS-14939`
(conf 91) is double-witnessed (full-res ladder + ~120-DPI locate) and shape-`confirmed` (all 37 confirmed
Larkspur worksheet refs are WS-#####), but leg (i) demands a byte-EXACT prefix — `ws14939` doesn't start
with `ws1493s` — so it declines `not_a_strict_prefix` and false-flags the correct value. The edge-guard's
own `_frag_matches` already grants this 1-trailing-glyph slack; C2a lacked it (the asymmetry = the bug).
- **Consensus (gary+reggie)**: 1-trailing-glyph slack on leg (i); legs (ii) ladder + (iv) locate_token==ni
  (both tiers read the full value incl. the trailing glyph) + (v) shape-consent SUBSTITUTE for C2a's missing
  geometric cut evidence; trailing-only; new switch `TEMPLATE_CLIP_COMMIT_EDGE_SLACK` nested under
  `_CLIP_COMMIT_ON`, default OFF; reggie rejected a confusable table (clip garble, not font confusion);
  convergent with the edge-guard (both commit WS-14939) — not the two-healers trap.
- **Oracle FORK → reggie length-preserving** (`len(ni)==len(_core2) and ni[:-1]==_core2[:-1] and
  ni[-1]!=_core2[-1]`); gary's `startswith(_core2[:-1])` admits arbitrarily-longer ni — rejected.
- **4 catches folded in**: C2 floor on the SHARED (len-1) prefix (the dissenting glyph isn't corroboration);
  C3 conf MARGIN (~15, gate-tunable) not a bare `>` (the plain guard gives ZERO protection against the
  named residual — both tiers misread the true glyph identically while the LOW-conf rigid caught truth →
  guard satisfied BECAUSE rigid is low-conf; a real clip reads low so a genuine heal keeps a big gap
  (worksheet_12 gap=47); None-conf declines; margin slack-path only); C4 isolate the live pin with
  edge-guard OFF so the gate fails without the slack; C5 pin both trade-off directions.
- **Residual ACCEPTED**: bounded to one glyph, length-preserving, ⊂ the existing 2-tier clean-clip envelope,
  human checkpoint preserved at the near-tie boundary via the margin (fail-to-review).
- **BUILT to spec + GATE**: pins `test_template_frag_clip.py` (10 edge-slack + nesting, all green).
  ISOLATED live pin (edge-guard OFF): slack OFF → WS-14939 @70 shapewarn; slack ON → WS-14939 @95
  template_mapping CLEAN. NF both-arms gate pending. Committed dark + env bridge + Settings toggle.
