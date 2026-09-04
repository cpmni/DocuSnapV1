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

## 2026-08-06 — TEMPLATE_DATE_INVALID_YIELD (engine kw-merge date precedence) — SIGN OFF WITH CONDITIONS
Pinned via faithful trace: LarkspurInteriors_invoice_08 invoice_date commits `33/04/2026` @30
(template_mapping, flagged) — an IMPOSSIBLE date (`parse_date` None; a 1.8°-tilt glyph-misread of the
taught box's `03/04/2026`) — which SUPERSEDED the valid keyword `03/04/2026` @93. Cause (engine.py
kw-merge): the located-mapping block (:4985) `continue`s at :5001 for any Stage-0.5 incumbent; the
date-validity guard at :5002-5005 is unreachable AND is the MIRROR direction (valid incumbent vs invalid
incoming). Invalid-incumbent/valid-incoming had NO handler → the impossible taught date won on authority.
- **Consensus (gary+reggie)**: new predicate + a guarded branch inside the located block; when the taught
  date is unparseable AND unsalvageable and a >=90-conf keyword read IS a valid date, yield to it FLAGGED
  to Review. New switch `TEMPLATE_DATE_INVALID_YIELD`, default OFF. reggie's `salvage_date(taught) is None`
  conjunct closes the false-invalid class (spaced `03 / 04 / 2026` / junk-suffixed VALID dates are
  recovered by salvage; verified `salvage_date('33/04/2026')`=None so the bug still fires). parse_date is
  calendar-STRICT (no rollover) → catches the whole impossible family (33/04, 31/02, 32/xx, 29-Feb-non-leap).
- **Oracle SIGN OFF WITH CONDITIONS (all folded in)**: premise verified at source; SEAM confirmed —
  `validate_and_adjust` floors a clean date's confidence to `_CLEAN_DATE_CONF`=94 (so the `_CONFLICT_CAP`
  is cosmetic), BUT `{**data}` preserves the `validation_note`, which is the FLOOR-INDEPENDENT auto-file
  block (trust.js:466 / engine.py:3338 / handler.js:295) → REVIEW-bound at any conf. Rulings: risk #1
  (parse false-negative) bounded by salvage+90-floor+note; risk #2 (Stage-2 re-contention) bounded, no
  worse than status quo — REJECTED gary's "preserve provenance" (would re-grant shape_mode='ignore');
  method stays keyword. Conditions: place after `_kw_ok`/before `_blind_reg` swap with own continue (done);
  env FIRST conjunct + OFF byte-identical (done); pin the FINAL emitted extraction + auto-file DECISION,
  never `conf==88` (green-but-false trap); both-invalid pins validator:511-514 flagged @≤30 (done).
- **RESIDUAL (Oracle C6, pendingfeatures)**: a misread landing on a DIFFERENT VALID date (tilt 03→08,
  order-flip) parses → NOT caught. This fix heals ONLY the impossible-date subset; the crop/tilt read is
  the complementary real cure (deskew/OCR arc).
- **BUILT + GATE**: 13 unit pins green (`test_taught_date_invalid_yield.py` — predicate incl. reggie's
  salvage cases + the whole impossible family + valid-taught-preserved + empty-guard + source/placement
  pins). invoice_08 integration: the standalone harness reads the date correctly (03-04-2026, both arms,
  inert — same OCR-context divergence as doc_06), so it proves no-regression on the valid-read path; the
  EXACT misread-heal (33/04/2026 → 03-04-2026 + note) is owner-watched (harness can't bit-reproduce the
  app's tilt misread). NF both-arms gate pending. Committed dark + env bridge + Settings toggle.

## 2026-08-06 (later) — TEMPLATE_DATE_FUTURE_YIELD (deterministically-future taught-date yield) — SIGN OFF WITH CONDITIONS
Extension of the shipped 11aa400 impossible-date yield to the C6 residual's DETERMINISTICALLY-FUTURE
slice: LarkspurInteriors_invoice_14 taught `15/10/2096` (glyph-misread of `2026`, a VALID calendar
date 70y future) wins the kw-merge over the correct keyword `15/10/2026`; parse_date != None so the
impossible branch can't fire. Predicate now returns a REASON string ('' / 'impossible' / 'future');
'future' fires when taught PARSES + is > `_DATE_YIELD_FUTURE_DAYS`(1096) future AND kw is valid AND not
itself > 366d future. New sub-switch `TEMPLATE_DATE_FUTURE_YIELD` default OFF (drops a VALID taught
value → larger blast radius than the impossible arm = drops garbage), independent kill + gate attribution.
- **Consensus (gary+reggie)**: reason-string predicate (accurate per-case note, no false-note class);
  1096 taught trigger on its OWN constant; 366 REUSED as the kw-side guard; separate default-OFF sub-switch.
- **Oracle SIGN OFF WITH CONDITIONS.** Verified at source: (seam#1) yielded kw <=366d → no Stage-4 future
  flag → the yield's note is the sole auto-file block; a non-yielded future taught date → validator:470
  floors to 94 then validator:612 RE-CAPS to 40 + note — NO path auto-files a future date (both halves
  confirmed). KEY RISK RULED ACCEPT: a correct >3y-future taught date dropped for a wrong non-future kw
  is bounded — the doc is ALREADY @40-flagged in baseline, the yield always notes → M PROVABLY CANNOT
  INCREASE; only a worse pre-fill in a rare far-future-taught doc. Threshold RULED 1096 not 366 (glyph
  year-misreads land ~decades out; 366 over-catches annual pre-bills). Sub-switch RULED separate default-OFF.
- **Conditions (all folded in)**: C1 single injectable clock via `validator.days_in_future(value, now)`
  (no `datetime` import into engine's merge; the shared `(d-now).days` formula); C2 the 366 kw-guard
  documented as INTENTIONAL ("yield only to a kw Stage-4 wouldn't itself future-flag"), taught trigger on
  its own 1096 constant; C3 the 'future' note NAMES the dropped taught value (recoverable, mirrors the
  impossible arm); C4 unit pin arms 'impossible' ONLY under INVALID and 'future' ONLY under FUTURE; C5
  UPDATED (not deleted) the 11aa400 pins for bool->str (`reason=='impossible'` + byte-identity); C6 pins
  the reason domain + note-accuracy + placement/first-conjunct/own-continue.
- **BUILT + GATE**: 22 unit pins green (impossible family + reggie's salvage cases preserved; future arm:
  invoice_14 `15/10/2096`→'future'; the PINNED trade-off now+100d→'' authority-preserved; band now+400d→''
  still Stage-4-flagged; future→future no-swap). Date suites (precedence/hard-gate/future-only/clip-gate)
  green. NF both-arms (baseline vs invalid+future) pending — the future arm is inert on the Customer
  corpus (no far-future taught dates), so it should match the INVALID-only +1/0. Exact 2096→2026 heal is
  owner-watched (harness can't bit-reproduce the tilt misread). C6 SAME-YEAR order-flip slice (03→08)
  STAYS OPEN — this fix closes only the deterministically-future slice.


## 2026-08-07 — PAD-WINDOW DATE READ (`TEMPLATE_PAD_WINDOW_READ`) — the date-crop read ROOT (supersedes the DATE_CROP_DESKEW_READ premise)
- **PREMISE REVERSAL vetted.** The banked `docs/designs/DATE_CROP_DESKEW_READ_2026-08-06.md` blamed the
  DESKEW frame ("deskew degrades the small-angle read; raw reads clean") -> an expensive raw-frame
  election (a prior `DESKEW_RAW_CROPS` attempt RED-gated on mis-placement). A fresh 4-doc empirical probe
  (filed Larkspur invoices, angles -0.5..2.3 deg) REFUTED it: the TIGHT taught box CLIPS the value's
  leading glyph on BOTH the raw AND deskewed frame at every angle; a synthetic quiet-zone (`_struct_prep`)
  cannot recover it (ink clipped OUT), only a REAL padded WINDOW + psm6 does; raw is sometimes WORSE (year
  2020, garble). Root = the tight crop, NOT the frame; the raw election was RED-gate-prone AND unnecessary.
- **Consensus (gary + reggie)**: caller-seat pad-window read (NOT the shared ladder -- no
  validation_patterns / Stage-2 blast radius); corroborate-or-flag (never silent-swap); reuse
  `salvage_date_detail` distinct-count + a geometric nearest-centre guard.
- **Oracle SIGN OFF WITH CONDITIONS.** Traced every load-bearing fact (tight-only read; widen-on-empty;
  shape_mode='ignore' + structured conf-exempt -> silent valid-shaped wrong commit; trust.js:466 note is
  the sole auto-file block; a real leading-glyph clip). Two seams caught: SEAM A -- `_edge_cut_relocate`
  can pre-empt the pad backstop (BOTH-ON); SEAM B -- reggie's textual witness-fold is DEGENERATE for dates
  (01/04 vs 02/04 folds to 'reject', killing the motivating case) -> date neighbour-rejection must be
  GEOMETRIC-ONLY. Fork rulings: DROP the witnessless Case-1 adopt (the empty-tight path already falls to
  the correct keyword read -- a silent adopt would REGRESS it); ship Slice 1 (flag) now, don't gate behind
  Slice 2 (keyword-corroborated silent heal, deferred to the engine merge layer); Case-3 flag is
  legitimate (a taught-box self-consistency / read-quality flag, value kept -- NOT a learned-shape veto).
- **Conditions (all folded in)**: C1 no witnessless adopt (Case 1 dropped -- Slice 1 is dates-only Case-2
  no-op + Case-3 flag); C2 date neighbour-rejection GEOMETRIC-ONLY (row-bound pad, nearest-centre,
  abstain-on->=2-equidistant / >1-distinct); C3 kill line = zero false-flags on CORRECT values; C4 pad
  wired at BOTH the abs-commit AND the edge-cut-relocate return; C5 don't stack over an existing note; C6
  default OFF, own switch, byte-identical off; C7 per-word x-geometry via `image_to_data` (not
  `_read_lines_full`).
- **BUILT + GATE**: 21 unit pins green (`test_template_pad_window_read.py`); existing mapper/date suites
  green (byte-identical OFF). Corpus gate (`customer_corpus_score.js` TEACH=1 SET=both SAMPLE=224 SEED=7),
  OFF vs ON AND a BOTH-ON pass (4 shipped flips + edge-guard): every lane +0 (M=0), zero date-verdict
  flips, zero T->F regressions, seam clean. One `_paddisagree` fire (Castellan-Security invoice_0063,
  DIGITAL) is a TRUE POSITIVE: committed `01-07-2025` (GT `14-07-2025`) -- a taught-box misread that
  BOTH-OFF filed SILENTLY and BOTH-ON now FLAGS (value unchanged, routed to review). Oracle's literal C3
  "digital=0" assumed digital reads correctly; here the taught box misreads a digital date (derived from a
  different sibling) -> the fix's target class, NOT a neighbour false-flag. Zero fires on correct dates.
  HONESTY: the harness cannot bit-reproduce the live app tilt misread -> this is a REGRESSION + false-flag
  gate; the recovered-suggestion quality (~=GT) is owner-watched live. DEFERRED: Slice 1b (codes -- already
  owned by inline-reconcile + edge-guard) and Slice 2 (keyword-corroborated SILENT heal).

## 2026-08-06 — Net-misread total FLAG + missing grand-total labels (taught totals read the NET line)
Advisors: gary (engine seam + gate/test) + reggie (total-label precedence + £-neg currency + the label set) →
Oracle. Trigger: the owner's SFDEV debug-table flagged wrong totals on 77 taught Castellan credit notes;
measured vs GT = 55 gross-correct / **10 read the NET line** (some at 90-95% conf → silent-auto-file danger) /
12 garbled. Corpus-wide the TEACH-arm total lane was **30.7%**.
- **Root (traced):** a taught Stage-0.5 total read has ZERO net-vs-gross discipline (`template_mapper.py`
  reads a fixed box / relocates off the literal "TOTAL" anchor, `shape_mode='ignore'`) — the net-vs-gross
  logic lives ONLY in `keyword.py` (`_total_role_collision`). The two existing safeties
  (`_reconciliation_pick_total`, the Stage-4 `_RECONCILE_CAP` flag) BOTH need VAT read correctly; when the
  "VAT @ 20%" line mis-reads/absent, `total_reconciles(net)` FALSELY balances (net ≈ subtotal + 0) so
  neither fires and the net commits silently. SECOND root (measured after a 0-fire gate): keyword's
  `total_amount` label bank MISSES common gross captions ("Total to Pay"/"Total Charge"/"Total (inc VAT)")
  → on those layouts keyword reads NO gross → tanks the total lane AND starves the flag (no gross candidate).
- **Oracle verdict:** **SEND BACK** the original design (its step 2 gated on `total_reconciles`, which is a
  strict SUPERSET of the bug → inert on the vat-missing target); **SIGN OFF WITH CONDITIONS** on the
  corrected `_net_misread_verdict` (keys on `total ≈ subtotal` + a distinct nearest-above VAT-plausible
  [1.01–1.30×] confident [≥70] gross candidate; caps to 50 + review note; **NEVER swaps** — arithmetic/role
  rail, not learned-shape → authoritative-anchor invariant preserved). FLAG, not auto-correct (reggie:
  keyword grand-total is an unsafe REPLACEMENT — "Amount Due £0.00" is tried before bare "Total"), not
  do-nothing. **Leave the switch OFF tonight — the owner flips** (the false-flag rate is the load-bearing
  unknown, measured against a corpus, not a unit test). Oracle's added GATE CONDITION: count FALSE-FLAGS
  (a correct-at-base total newly capped), not just accuracy/M.
- **BUILT (both DEFAULT OFF → byte-identical):** `NET_MISREAD_TOTAL_FLAG` (`engine._flag_net_misread_total`
  + pure `_net_misread_verdict`, after `_reconciliation_pick_total`, before Stage-4) · `TOTAL_GROSS_LABELS`
  (reggie-cleared payable captions injected in keyword.py, config unchanged; mirrors PO_ORDER_NO_LABELS;
  "Charge" residual last). Pins: `test_net_misread_total_flag.py` (14, incl. the critical VAT-missing
  regression pin the original design fails) + `test_total_gross_labels.py`; 7 totals/keyword regression
  suites green.
- **GATE (customer_corpus_score.js, SAMPLE=300 SEED=7 both):** labels cold total **40.6→50.0 (+9.4, scanned
  +16.3)**, every other lane byte-identical (M=0). Both-fixes TEACH arm: total **30.7→34.4 (+3.8)**, every
  other lane IDENTICAL (M=0); the flag fired **4×, all real catches** (Meadowvale net-misreads, some
  previously SILENT), **ZERO false-flags**. HONESTY: the harness can't bit-reproduce the app's exact 10
  Castellan net-misreads (they type "TOTAL", a keyword candidate → the flag WILL fire there) — the
  deterministic role/arithmetic decision is gate-able, the end-to-end taught heal is OWNER-WATCHED.
- **DEFERRED (own switch/gate):** robust VAT read → let `_reconciliation_pick_total` AUTO-CORRECT net→gross
  (bigger blast radius); reggie's residual labels "Balance Outstanding" family (statement running-balance risk).

## 2026-08-09 — TEMPLATE_FORMAT_FAIL_YIELD REDESIGN (hard reference_code gate) — SIGN OFF WITH CONDITIONS (gate GREEN)
Advisors: gary (root-cause + fix design + test strategy) → Oracle (final vet). **Supersedes the 2026-08-06
entry's `SIGN-OFF-W/COND`, which GATE-FAILED.** The 08-06 version (`fcc0d5b`) keyed the taught-read format-fail
on the `_shapewarn` TAG (L1) + a learned-shape veto (L2); on the fair corpus it produced a live **ref −1.0
regression on flip** (a CORRECT taught ref shapewarn'd on a thin shape yielded to a LOOSE-`alphanumeric`-passing
garbage keyword read "The"/"Tel 01632…"/"25-07-2025"), and po_ref **+0.0** (never fired — the seeded inline
challenger is conf 85, below the old floor 88). Left un-touched it was a landmine (dark, but regresses ref on
flip). **Diagnostic trace (SAMPLE=60) confirmed the mechanism** and that the dominant po_ref/total residual is
FORMAT-VALID wrong values (clipped-prefix "19979"⊂"PO-19979", magnitude/sign clips "£2"/"£-1,329.00") — a
READ-layer problem, not merge-layer.
- **REDESIGN (built):** `_stage05_format_fails` is now a PURE, DETERMINISTIC content-nature check. REF-FAMILY
  (incl. `po_ref`/`job_ref` via a LOCAL `endswith('_ref')` predicate — the global `_is_ref_field` misses them
  and broadening it has ~6-call-site blast radius incl. two corroboration/override gates) judged by the HARD,
  digit-bearing, ANCHORED `reference_code` pattern (NOT the loose `alphanumeric` most ref fields default to) +
  a full-date guard. CURRENCY keeps the strict leading-glyph + `parse_amount` check (L3). **L1 (shapewarn tag)
  + L2 (learned-shape veto) DROPPED** → sanctioned deterministic-content category, not a learned-shape veto
  (invariant-preserved; removes the `_make_format_lookup` query). Floor **88→85** (reaches the base-80+right
  seeded inline reads). Swap unchanged: cap 88 + validation_note → Review, never silent/auto-files (fail-safe
  verified at `trust.js:466`).
- **Oracle verdict: SIGN OFF WITH CONDITIONS.** No live seam (helper self-contained to the dark feature;
  dropping L2 removes no safety another path relied on; the local `endswith('_ref')` doesn't touch the global;
  disjoint from the date-invalid-yield + `_blind_reg` sibling blocks in the same gate). Redesign-and-commit-dark
  > revert (revert = pure churn). Condition-2 sharpened the gate from aggregate-`≥` to **doc-level
  monotonicity**. Q2 rejection UPHELD: the merge-layer fuller-code containment swap for clipped-prefix is
  read-layer work (overrides a format-VALID authoritative taught read on a weak heuristic; collides with the
  `_pick_fuller_code` rb_531 class; cold-start dirty) — left for owner + a separate gated arc, pinned so a dev
  can't bolt it on.
- **GATE (NEW DOCS STABLE TYPE, SAMPLE=300 SEED=7 both, TEACH, flag ON vs new_teach):** ref **80.2→82.6
  (+2.4)**, po_ref **51.4→80.6 (+29.2)**, total **29.6→30.6 (+1.0)**, date/issuer/customer/type/job_ref/vat_no
  FLAT. **Doc-level MONOTONIC: 0 T→F on every lane** (ref +7/0, po_ref +21/0, total +2/0, account_no +1/0).
  Realdoc (632 confirmed, flag ON) **M-set IDENTICAL to baseline OFF (17==17 pre-existing skew/OCR/poison floor,
  M_type 0)**. Pin `test_stage05_format_yield.py` rewritten (26 green — pins the 3 regression strings as FAILS,
  a shapewarn'd-but-valid ref as PASS, clipped "19979"/"24511" as PASS = accepted read-layer residual).
  Committed dark `1bea059`; **owner flips.**
- **RESIDUAL (read-layer, out of scope):** clipped-prefix + magnitude/sign taught reads are format-VALID by
  construction — the taught box must relocate/adapt to the shifted value. A separate gated arc.

## 2026-08-06 — PAD-WINDOW CODE READ extended to LABELLED boxes (`TEMPLATE_PAD_WINDOW_CODE_LABELLED`) — SIGN OFF WITH CONDITIONS (gate GREEN)
**Why re-consulted: a PRIOR Oracle sign-off rested on a FALSE PREMISE.** On 2026-08-09 the Oracle signed
`TEMPLATE_PAD_WINDOW_CODE` (95e400d) and scoped it to LABEL-LESS boxes on the ground that "a labelled box is
served by `_inline_code_reconcile`". The engineer had asserted the Larkspur `po_number` box was label-less,
read from a column that does not exist (`anchor_label`). Verified at source: the column is `anchor_text`, and
the mapping IS labelled (`'Order No.'`).
- **Traced root cause (per-doc rung table, real pipeline, owner flags ON, 8 Larkspur PO docs):** #625 commits
  at the ABS rung as `-48009` at **confidence 90 with NO note** — a silent wrong auto-file — while a pad-window
  probe of the SAME box reads `('PO-48009', 91.0)`. `_maybe_pad_code` was skipped ONLY by the `not anchor_text`
  guard. #630 is a DIFFERENT rung (R7 late-relocate, `914`) and is already conf 70 + noted; Oracle ruled it
  explicitly NOT a success criterion. The clip SHUFFLES run-to-run (DPI ±1) — a prior session saw #637/#640.
- **Why the designed backstop was inert (mechanism, verified by logging every scored line — do NOT restate this
  as a plain "footer false-match"):** for needle `'order no.'` the footer prose scores **0.875** and the TRUE
  caption only 0.75 (`purchase order orden no. eo` — OCR flipped one glyph). `_label_score`'s
  `if needle in haystack: return 0.0` guard does NOT fire because `'number'` begins `n-u`, so `'order no'` is
  genuinely not a substring of `'order number'` — **the Oracle and the engineer BOTH misread this at first.**
  The footer therefore wins on the partial-credit branch (`longest/len(needle)` = 7/8). So R5 declines on 7/8
  docs with `inline_val` EMPTY. Filed as a separate, larger lever in `pendingfeatures.md` (NOT fixed here).
- **HEADLINE RISK the Oracle ruled on:** `_mapping_result` gives `90 if full_confidence else 78`, and
  `full_confidence = bool(anchor_text)` — so a LABELLED swap is **auto-fileable** where the label-less 78 was
  review-bound regardless. That retires a stated condition of the prior sign-off. **Verdict: the counterfactual
  ("the WRONG value already occupies that 90 channel") LICENSES the swap but does NOT license awarding it on
  weak evidence** → tier by consent strength (C3).
- **CONDITIONS BUILT (C1/C2 were ship-blocking):** C1 thread the reconcile's outcome to the call site and no-op
  (swap AND flag) when it produced a USABLE inline witness (located + non-empty read) — its None is then a
  deliberate ARBITRATION by a stronger independent-pixel witness; this also cures the "relies on the locate
  defect persisting" seam by construction · C2 admit the labelled scope ONLY on the PURE absolute read (never
  `abs_expanded` — a narrower window cannot "recover" a wider read; never `_edge_healed` — `_edgegrow` carries
  no note so nothing else would stop a pad flag dragging a consented heal to 70) · C3 consent tiering
  ('confirmed' keeps the tier, 'provisional' caps at 87 < the 88 floor — closes the cold-start channel) ·
  C4 reject a padded candidate beginning with a ≥2-char suffix of the label's alnum tail (`No.PO-48009`) ·
  C5 TWO-SIDED consent, BOTH scopes (swap requires padded consented AND tight NOT positively consented) —
  this, not geometry, closes the label-glue hole, because `check_value` consents VACUOUSLY under a FREETEXT
  class or an empty shape set · C6 test integrity · C7 remove all instrumentation.
- **A left-pad geometric CLAMP was REJECTED** (gary, upheld): clamping to the taught anchor edge leaves ~0.01
  of page width (inert on the motivating case); clamping to the LOCATED label would import the broken locate
  into the one primitive whose value is being LABEL-BLIND.
- **BLAST RADIUS MEASURED (Oracle gate (c), was assumed not known):** 7 labelled+code mappings (po_number 3,
  delivery_number 3, invoice_number 1) across Larkspur/Northgate/Ridgeway. **Label-less+code = 0 → the ORIGINAL
  parent slice is inert on this install**; the labelled sub-slice is the whole feature.
- **GATES GREEN.** Sweep (REPEATS=3): baseline 6/6/6 of 8 · +CODE 6/6/6 (inert) · **+CODE+LABELLED 7/7/7,
  recovered #625 in ALL 3 repeats, 0 regressed, 0 shuffling**; fire census 3 fires, all correct swaps, **0 false
  flags / 0 bad swaps**. Customer corpus (288 docs, TEACH=1, SET=both): **0 doc-level T→F, every lane byte-
  identical**; Oracle gate (a) auto-file delta census **0 losses on correct values**; gate (b) 6 fires, all
  FLAGS, all on already-wrong values (suggestions `MDW-315` vs committed `VIDW-315`/`MIUW-3S15` = the right
  answers). Pins: `test_template_pad_window_code.py` (34 green — 17 originals preserved + a BEHAVIOURAL
  anti-restore pin, a C1 witness-suppression pin, and vacuous-consent pins driving the REAL `check_value`).
- **Added value? YES — decisive.** Caught the 78→90 tier change the engineer's brief had missed entirely; found
  the VACUOUS-consent hole (`FREETEXT`/empty-shapes) that made the existing glue defence a mock of itself; drew
  the R5-arbitration line the design had not; caught that C6's old stub was value-BLIND so every SWAP pin would
  silently flip to FLAG under the new rule; and demanded the auto-file census that accuracy/M cannot see.
- Default OFF, strict subset of the parent flag; **owner flips.**

## 2026-08-06 — Castellan `template_registration` supplier corruption — SEND BACK, then SIGN OFF WITH CONDITIONS
**The incident:** owner imported ~22 Castellan Security credit notes, taught ONE, reprocessed. 15 of 22 got a
WRONG `supplier_name` — `'Bramblewood Joinery Ltd'` (the owner's OWN company / the customer block), `'DELIVER TO'`,
`'Draymarket, DM2 6QF'`, line totals. Every wrong doc: method `template_registration`, conf 70-78.
- **What the specialists proposed:** a new landmark-hit witness (`_landmark_hit`, token-ratio) inside
  `_fit_page_transform`, default ON, to reject the false correspondence.
- **ORACLE SEND-BACK — the decisive catch.** The gate ALREADY EXISTED. `engine.py:5376`
  `REG_MIN_INLIERS_GATE` (Oracle-authorized, evidence-met, **default ON since 2026-08-01**) refuses a fit with
  `n_inliers < 3` — but `_fit_page_transform` has **TWO callers** and the condition was INLINED at only the
  Stage-2 one. Stage 0.5 kept consuming exactly the fits Stage 2 refuses. *"The specialists reconstructed, from
  first principles and with excellent forensics, a defect the codebase had already diagnosed, gated and shipped
  — at the other one of the function's two call sites."*
- **ROOT CAUSE (confirmed by live probe over the real PDFs):** template 32 has 2 landmarks, one the 3-char table
  header `'Qty'`. `_label_score('qty','castellan security systems') = 0.667 >= 0.6` — the longest common run is
  `'ty'` (from "securi-TY") and the run fraction is measured against the 3-char NEEDLE — so the page-wide
  fallback locate matched `'Qty'` onto the SUPPLIER LINE. Resulting fit: scale 1.1445, **rotation -166.71 deg**,
  residual 0.000000, n_inliers 2, conf 78; it displaced the taught supplier box by **0.277 of the page**.
  Measured: the taught box read `'Castellan Security Systems'` CORRECTLY on 5/5 docs sampled — the transform was
  PURE LOSS. These pages are not drifting (stable header labels relocate within ~0.0005).
- **THE FIX SHIPPED (Oracle C1):** ONE shared predicate `registration.is_unfalsifiable(transform)` consumed by
  BOTH call sites; applied INSIDE `_fit_page_transform` so no present or future caller can miss it (deviation
  from Oracle's "gate at the call site", taken deliberately because the whole defect was a per-call-site copy —
  engine.py's own gate is kept as a redundant net). Predicate is on **INLIERS, not n_points**: a 5-landmark
  RANSAC can still collapse to a 2-inlier refit (measured residual 1.1e-16, conf 78). Same env var, same
  default-ON as the 2026-08-01 precedent. Caught en route: engine.py never imported `registration` — the call
  would have been a runtime NameError invisible to a module-load smoke.
- **CORRECTIONS the Oracle made to the brief, all re-verified at source:** the 88 `CRITICAL_FIELD_FLOOR` does
  **NOT** protect `supplier_name` (`critKeys` = ref+date only, `trust.js:615`; `roleKeys` at :452 is a different
  set) — severity was understated, not overstated · `select_cross_sample` is **NOT** unused
  (`tryCrossSampleLandmarks`, handler.js:105, preferred by `generateLandmarks`) · `_is_word` already enforces
  `len>=3`, so `'Qty'` passes at exactly 3 · `label_box` is **not** an independent witness (built by
  `_match_label_run` using the SAME `_label_score` at the SAME threshold — a dead guard).
- **ONE ORACLE CLAIM CORRECTED BY ME at source:** it argued cross-sample had never fired for tpl 32 ("zero
  confirmed"). The DB shows **4 confirmed docs and landmark `source='cross_sample'`** — cross-sample DID run and
  still produced the degenerate 2-landmark set. So "confirm 3 docs and re-derive" is NOT the cure it hoped.
- **GATES.** Castellan 21-doc A/B: **4/21 -> 16/21 correct, 12 heals, 0 regressions**, registration wins
  **17 -> 0**, every other taught field byte-identical. Realdoc 695: supplier **692 -> 693**, regressions 60 -> 59,
  **SILENT 26 -> 24**, no new entries (armed strictly ⊆ baseline + 1 heal); `#714 'Bramblewood Joinery Ltd'`
  SILENT healed, `#711` silent -> **flagged**. Pins `test_registration_min_inliers.py` (21) incl. Oracle G5 (the
  shared matcher `_label_score` deliberately UNCHANGED), G6 (both call sites consume the shared helper, and
  engine.py imports it), and a RED-proof (kill switch OFF returns the Transform). 6 neighbouring suites pass.
- **GATE BLINDNESS STATED (Oracle G3):** the Customer corpus fires registration **0 times in 1793 field wins** —
  an M=0 there is VACUOUS for this change. Realdoc traced subset: 21/538 (3.9%), **all on `supplier_name`**,
  which independently confirms the asymmetry — `anchor_stable` requires `anchor_text`, so a label-less mapping
  can never defend its own absolute read, and `supplier_name` is label-less on all 10 templates.
- **Added value? YES — decisive, and it inverted the plan.** Found the shipped gate the whole consult had
  reconstructed from scratch; killed a default-ON change to a shared matching primitive that would have been
  calibrated on one exemplar; caught that the proposed fix silently affects Stage 2 too (where the existing
  n_inliers gate would then blackout 3-landmark templates); and demanded the both-methods census that made that
  visible. Residual (owner-facing, NOT fixed here): `#712` still reads `'tastellan Security Systems'` SILENT at
  95 via `+corrected` — an absolute-read/corrector defect, not registration.

## 2026-08-06 (iteration 2) — curated `template_fixed` supplier vs a MISREAD letterhead — SIGN OFF WITH CONDITIONS
Follow-on to the same fire. Iteration 1 (`63b1807`) closed the vacuous-fit gate at the second call site
(4/21 -> 16/21). This closes the five residuals: `Castellan Security System:` x2, `Cas tellan Security
System:`, **`tastellan Security Systems` @95 SILENT**, and `ba)`.
- **ROOT CAUSE (verified):** Stage 0 seeds the template's curated `fixed_value` at conf 95 method
  `template_fixed` (`template_matcher.py:819-824`); the Stage-0.5 merge (`engine.py:4905-4917`) lets a
  mapping READ displace it on AUTHORITY (`is_curated_refinement`), guarded only by `_ft_mapping_weak`
  (free-text under conf 75). A tight taught crop puts the FIRST and LAST glyphs on the crop boundary,
  the LSTM force-fits them, and the misreads arrive ABOVE 75 and win.
- **THE ORACLE'S SEAM (the reason the worst case was silent):** the more corrupted the string, the more
  completely it EVADES the branding cross-check — `_branding_own_ratio` (engine.py:993) finds no bank
  for `tastellan Security Systems`, returns None = "unjudgeable", and `_flag_branding_conflict`
  fail-safes without flagging. **Corruption buys immunity from the one guard meant to catch it.** That,
  not the veto method names, is the real argument for KEEP-THE-SEED over snap-the-read: keeping the seed
  preserves `method == 'template_fixed'`, which `BRANDING_NAMED_BLANK` (:2983) and
  `TEMPLATE_FIXED_NAME_PRESENCE_VETO` (:3018) key on EXACTLY, and returns the value to the guard's
  jurisdiction. Snapping would have minted a veto-exempt `template_mapping+snapped`.
- **ORACLE CORRECTIONS that changed the design:** (a) **branch A is INERT** — the `:` IS the misread
  final `s`, so an alnum fold never makes these equal; all three are edit-distance 1. gary's proposed
  "flip branch A first, branch B after" would have been a ZERO-YIELD first flip presented as a green
  gate. Ship A+B on one switch. (b) gary's UV-exemption argument was wrong (`engine.py:3989` skips ANY
  method containing `template_fixed`, so both options were UV-exempt) — his conclusion survived on the
  veto legs only. (c) Slice 1 does NOT reach `ba)` (23 edits), so a second guard was mandatory or the
  batch stalls at 20/21.
- **MY MEASUREMENT KILLED gary's SLICE 2:** he proposed demoting junk via `name_quality(value) == 0.0`,
  conditional on short legitimate names not scoring 0.0. MEASURED: `name_quality('BP') =
  name_quality('3M') = name_quality('IBM') = 0.0` — the function is length-biased
  (`value_quality.py:237` needs len>=4). His own fallback (`folded length < 3`) hits `BP` too. Oracle
  replaced it with a deterministic rule that can only fire when the template's OWN curated name is
  >=8 chars, so a genuine `BP` is never at risk.
- **THRESHOLD IS DERIVED, NOT TUNED:** after alnum-folding, the entire residual class is exactly 1 edit
  while the nearest genuinely different string ON THE SAME PAGE (`Bramblewood Joinery Ltd` — the owner's
  own company, printed as the DELIVER TO block) is ~20. A ~19x margin. Plain Levenshtein deliberately,
  not `ocr_corrector._is_confusion`: `C`->`t` is a letter->letter forced fit at a crop edge and is
  absent from the digit/letter confusion maps, so verbatim reuse would have rejected the real case.
- **CONTAINMENT CARVE-OUT (load-bearing, pinned):** a mis-taught leading-glyph-CLIPPED `fixed_value` is
  ALSO exactly 1 edit from the CORRECT read; without the carve-out the rule would discard the correct
  read and freeze the clipped literal — the mirror of the bug it fixes.
- **ACCEPTED TRADE-OFF (C3, pinned):** a `fixed_value` that is itself one glyph wrong stops self-healing
  on the affected templates. Lever = Learning Repair / template viewer. Budget must stay 1.
- **SCOPE CORRECTION I made:** scoped to `supplier_name` only, NOT `_IDENTITY_FIELD_KEYS` — that set
  includes `customer_name`, which is legitimately VARIABLE per document (post-mig-44 COMPANY_KEYS is
  supplier_name only).
- **GATES.** Live-DB Castellan **16/21 -> 21/21**, all five now `template_fixed`@95, every other taught
  field byte-identical. **realdoc n=695: supplier 693 -> 695 = 100.0%**, regressions 59 -> 57, SILENT
  24 -> 23, diff is deletions ONLY. Blast radius measured: exactly **7** templates carry a non-variable
  supplier `fixed_value` (Copperfield x3, Ridgeway x2, Ironbridge x1, Castellan x1) — all live-DB, so
  realdoc exercises 6 beyond Castellan; this gate is NOT blind, unlike iteration 1's corpus arm. Pins
  `test_template_fixed_near_match.py` (27) assert the METHOD not just the value (a value-only assertion
  would go green under the rejected snap implementation). 7 adjacent suites pass.
- **98% MEASUREMENT RULING (both advisors, upheld):** n=21 quantises at 4.76% and the 18-doc sandbox at
  5.6% — **neither batch can express "98%"**. The acceptance number is realdoc's supplier field at
  n=695, which reads **100.0%**.
- **Added value? YES.** Killed a zero-yield staged flip that would have shipped as a green gate; found
  the corruption-buys-immunity seam that explains why the worst case was silent; corrected the
  keep-vs-snap rationale to the one that actually holds; and forced a second guard without which the
  batch would have stalled one document short.
- Both switches default OFF, bridged in `handler.js _reconcileEnv`; **owner flips.**

## 2026-08-07 — CREDIT-NOTE MINUS SIGN (release-blocking, financial safety) — SIGN OFF WITH CONDITIONS
**Incident:** 16/16 credit notes filed with the sign gone (`TOTAL £-160.32` -> `160.32`, a £160.32 credit
becoming a £160.32 charge). THREE carried no warning ("High · 85%", "Nothing was flagged") and bulk
"File All Ready" wrote them to disk; the app then invited the user to LOWER the auto-file threshold.
Customer: *"I would not trust it with credit notes."* Owner also reported "two negatives sum positive".
- **ROOT CAUSE:** the app has no representation of a SIGNED money value — one unstated axiom ("money is
  a non-negative magnitude") encoded twice in separately-maintained regexes. Sign destroyed at READ at
  TWO sites sharing ONE artefact: `anchor.py:2751-2753` (`re.search` span starts at the digits, and
  `.strip(" -:;,")` strips hyphens anyway) and **`keyword.py:1647-1651`** (the Stage-1 twin, ~60-70% of
  fields — **I missed this; gary caught it**, and it is why the fix belongs in the shared CONFIG
  pattern, not in `anchor.py`). Independently at `validator.py:307` `CURRENCY_RE`.
- **The owner's "two negatives" symptom IS the parse defect, not an accumulation bug** — measured
  `parse_amount('-100.00') + parse_amount('-60.32') = +160.32`. The values are magnitudes before any
  addition; there is no double-negation, no abs(), no concatenation.
- **WHY 13 FLAGGED / 3 SILENT:** `total_reconciles` opens `total > 0 and subtotal > 0` — structurally
  incapable of seeing a sign inversion. The three escaped through three UNRELATED arms: no subtotal
  captured; delta 1.12 inside a 3.21 tolerance -> `reconciles=True` = **it AFFIRMED the sign-wrong
  value**; tax and shipping both absent -> NEUTRAL. So the 13 were flagged BY LUCK and the silent rate
  is "3/16 today, unbounded tomorrow" (capture a subtotal next scan and a silent one reconciles).
- **gary's correction that reshaped the design (I had told the owner the opposite; verified):**
  File All Ready **DOES** gate on notes (`renderer.js:4471` `isFlagged`), as does backend auto-file
  (`trust.js:466`, any noted field -> `{ok:false}`). So this is a **DETECTION bug only** — one note buys
  all three protections and NO new gate is needed. Design collapsed from "three gates" to "mint a note".
- **ORACLE'S SEAMS, both of which would have silently defeated the fix:**
  * **SEAM 1** — `text_normalise._EDGE_RE` strips edge non-alphanumerics, so
    `normalise_for_tokens('-160.32') == '160.32'`. **Every shared comparator in the pipeline is
    sign-blind**; a sign check built on one would be a dead guard that greens every test. VERIFIED and
    now PINNED. (Do NOT "fix" `_EDGE_RE` — byte-mirrored in JS and asserted by a golden corpus.)
  * **SEAM 3** — a bare `-?` in the shared pattern MANUFACTURES a new class: `TOTAL-------160.32` and
    `Total-160.32` capture `-160.32`, inverting a CHARGE into a CREDIT. VERIFIED. Requires a
    left-boundary lookbehind. This is the strongest argument for shipping detection BEFORE the read fix.
  * **SEAM 4** — a naive signed `parse_amount` is a NET SAFETY LOSS: `tol = max(total*0.02, 0.05)`
    collapses to 5p on negatives, `total < subtotal - tol` then fires on every well-formed credit note,
    and `- discount` double-negates. B must be MAGNITUDE reconciliation + a separate sign assertion.
- **HARNESS FINDING (mine): this bug was UNCATCHABLE by the gate.** `customer_corpus_score.js`
  `normMoney` strips `-` via `[^0-9.]`, so the total lane compares MAGNITUDES, while the generator emits
  SIGNED credit-note GT (`gen_customer_test.py:642`). Measured: **17 of 36 corpus credit notes have the
  sign lost and score as CORRECT.** That is a THIRD sign-blind comparator (after `_EDGE_RE` and
  `CURRENCY_RE`). Added an ADDITIVE sign census; the score and pass/fail criteria deliberately
  UNCHANGED (altering acceptance criteria is the owner's call).
- **SHIPPED: slice C (detection) only, `CREDIT_SIGN_COHERENCE`, default OFF** (`60f0eca`). Pure predicate,
  3 arms, never negates/swaps; type is evidence about the EXPECTATION, never the VALUE (owner's explicit
  instruction). Type resolved via display name + ALIASES, never an internal slug. **GATES:** 33 pins ·
  Customer corpus 288 docs 0 doc-level T->F, **0 false alarms on invoice-typed docs** · **realdoc n=695
  IDENTICAL to the pre-flag baseline** · money-adjacent suites pass.
- **NOT BUILT (designed + vetted):** A (preserve the sign at read — shared config pattern + the
  `anchor.py` strip-set, ASCII-only, adjacency-strict, leading-sign-only) and B (`parse_amount_signed`,
  never changing `parse_amount` in place). **Oracle: C-only is a correct hotfix state and an
  unacceptable end state** — the user hand-types a minus on every credit note until A lands, so A is a
  committed follow-on, not an option. Owner-decision items recorded: the review-burden trade-off (C
  contradicts `feedback_minimal_interaction_autofile`), remediation of the 16 already-filed documents
  (wrong XML on disk, and their confirmed values are the poison that will make A's signed reads
  shape-mismatch), and suppressing the "lower the auto-file bar" nudge on a batch containing a currency
  note.
- **Added value? YES, decisively.** Killed a fix that would have inverted charges into credits (Seam 3),
  killed a "signed arithmetic" change that would have been a net safety loss (Seam 4), and identified
  that the one guard the design leaned on was sign-blind (Seam 1). gary separately caught the Stage-1
  read site and the File-All-Ready gating, either of which alone would have made the fix half-right.

## 2026-08-07 — VAT registration number read as a TAX AMOUNT (`VAT_REG_NOT_AMOUNT`), paired with `NET_MISREAD_TOTAL_FLAG`

**Consensus in (reggie + gary, independently):** a letterhead's VAT registration number is being
committed as `vat_tax`. Both reached the same layer — an occurrence-level skip in
`_search_for_label`, evaluated on the RAW tail — and both independently insisted the predicate be
FORM-based rather than keyword-based, because one shipped letterhead variant prints a bare
`VAT GB 774 2093 55` with no `Reg`/`No` token and a keyword-keyed guard would miss it SILENTLY.

**The mechanism (traced, agreed by all three):** the bare `"VAT"` label matches the letterhead; the
scan is TOP-DOWN and returns the first accepted occurrence, so the letterhead beats the real
`VAT @ 20%` line below; then `number_format.normalise_currency_spacing` rule 3 ("trailing 2-digit
decimal with the point dropped", for `5,767 71`) MINTS a decimal, because a UK VRN is grouped 3-4-2
and its final group is ALWAYS two digits at end-of-segment: `651 0027 84` -> `651 0027.84`. Only
then does it pass currency validation, and `_clean_value` returns just the match — destroying the
`Reg GB 651` context that would have condemned it. Measured: an identical `0027.84` on all 13
documents of one supplier, conf 90, the only `vat_tax` value in the live DB, poisoning
`subtotal + tax` so ~12 CORRECT documents carried "the total doesn't add up" at conf 50.

**Round 1 verdict: SIGN OFF WITH CONDITIONS** (C1 ordering, C2 role-arming, C3 raw-tail evaluation,
C4 legs, C5 trace, C6 leave `number_format` rule 3 alone, C7 defer A2).
- Ruled the arming FORK **for reggie** (`pk == 'vat_tax'`), against gary's `val_type == 'currency'`:
  arming on the class would also arm the TOTAL, where a genuine OCR-split large amount
  (`Total  1 234 567 89`) trips the grouping leg and the money veto may not survive OCR.
- Caught that the banner letterhead poisons with the bare fragment **`774`**, not `2093.55` — a test
  written against the `0027.84` shape alone would pass while that class still fired.
- Corrected the brief's "the unlock is at100-only": it is bulk **File All Ready**
  (`renderer.js:4471`), the mechanism of the 08-06 incident.
- Added two predicate legs (>=9 digits counted UNGROUPED; a single unbroken >=9-digit run).

**Round 2 (the pairing) verdict: SIGN OFF WITH CONDITIONS — one BLOCKING.** The gate surfaced that
A1 alone costs 4 TRUE flags: removing the phantom tax disarms `validator.py:673` ("the total looks
like the subtotal"), which requires a tax to be PRESENT, so a NET-as-gross total loses its flag.
Proposed pairing with the already-built `NET_MISREAD_TOTAL_FLAG`.
- **C1 (BLOCKING) — a SIGN incoherence outranks a MAGNITUDE one.** `_flag_net_misread_total` runs
  BEFORE Stage 4 and `validator.py:727` refuses to overwrite an existing note, so a net-misread note
  PRE-EMPTS the credit-sign note. `_net_misread_verdict` is sign-BLIND (`parse_amount` drops the
  minus) and a credit note whose taught total box sits on the net row satisfies `total ≈ subtotal`
  with a larger candidate — exactly the net flag's target layout. The note would have read "a larger
  total (£Y) was also found; please check which is the real total", said nothing about the sign, and
  quoted a sign-stripped £Y — so the likeliest operator action files a credit note as a LARGER
  POSITIVE charge. **Confirmed on live data by the G4 census: the net flag DID decide to flag #722
  (a credit note reading +1,566.12) and C1 is what stops it.** Fixed by threading `credit_expected`
  into the helper and abstaining when the credit-sign arm would speak.
- **C2 — co-residency, not flip ORDER.** `credit_sign_coherence` must be ON *whenever*
  `vat_reg_not_amount` is, at every point in time; the two sit on separate Settings rows, so an
  operator could switch the sign detector off later and silently recreate the incident. Arming the
  guard now FORCES `CREDIT_SIGN_COHERENCE` for the run.
- Also flagged a state the instruments could not see (`validator.py:695` writes its note with no
  existing-note guard, so the reconcile note can silently clobber a net note — the doc stays flagged
  either way while the better note degrades). Census run: 1 decided, 1 survived, no clobber.
- On the residual `L922.14`: traced `trust.js` and found currency routes to `_currencyDpConsistent`
  only, which `L922.14` PASSES, and `_currencyish` is never consulted — so the safety net I assumed
  does not exist and its named owner (format-fail-yield) is dark. Recorded as a named residual.

**GATES (all green).** Unit pins end-to-end incl. the banner form, with the OFF path pinned to still
reproduce the bug · corpus 288 docs zero T->F, zero values moved on any lane, `vat_no` untouched
(the arming proof) · **0 new `reconcile_pick`** on corpus AND Castellan (the SEAM-B blocker) ·
realdoc **byte-identical** to baseline with BOTH flags armed (n=699) · Castellan 21 docs: 19 fires,
16 notes cleared, 0 gained, 0 totals changed, supplier column unchanged · G4 survival census clean ·
precedence pin verified to FAIL 3/3 on the pre-C1 build.
**Measured as production will run it** (C2 forces the sign detector on): false alarms **39 -> 0**,
true flags **16 -> 26** — the 11 extra being credit notes whose sign is lost, which the corpus scorer
counts as CORRECT because `normMoney` strips the minus (the known instrument defect; the additive
sign census proves the flags right and the score blind).

**Added value? YES — decisively, twice.** Round 1 ruled a fork on evidence and killed a test that
would have greened while a whole class still fired. Round 2 caught a BLOCKING seam that would have
had the software recommend filing a credit note as a larger positive charge — the exact 08-06
incident, re-opened by the fix meant to help. Neither advisor saw it (reggie was in `keyword.py`,
gary in the consumers; the interaction lives in `validator.py:727`, in neither slice).
**Commits:** `d575668` (guard) · `60606d9` (bridge + paired toggle) · `2a1ae7d` (C1 + C2 + pin).
All default OFF pending the owner flip.

---

## 2026-08-08 — SEC-17 reparse-point containment (`915c412`), reviewed AFTER it shipped default-ON

**In:** no specialist consensus — this was a single-author security fix that shipped ON with no
adversarial pass, and the session handover named "Oracle on SEC-17" as its first action precisely
for that reason. Asked him to vet the premise, trace the predicate for fail-open holes, judge the
deliberate scope split (OPEN path fixed; the filing WRITE containment and `navGuard.js` left
textual), weigh the blast radius on ordinary OneDrive/redirected-folder users, and — since the code
was already live — rule explicitly on whether to revert it to OFF.

**Verdict: SIGN OFF WITH CONDITIONS — 3 BLOCKING, 5 non-blocking. Ruling on the ON/OFF fork: LEAVE
IT ON.** `SF_REALPATH_CONTAINMENT=0` is strictly worse than the shipped state and the false-refusal
risk is bounded and non-destructive (a dead button, never a lost or mis-filed document). But the
commit did not deliver the property its message claimed.

**Added value? YES — decisively, and this is the clearest case yet for reviewing security code even
when the author is confident.**

- **B1, a live FAIL-OPEN in the shipped fix — the very hole SEC-17 exists to close.** `_realCanonical`
  returned the RAW resolved path on ENOENT while `_withinAnyRoot` canonicalises the ROOT: two frames,
  one comparison. With a junction at `Output\peek`, the path `Output\peek\nope.pdf` does not exist,
  realpath throws, the raw string comes back and `startsWith(Output\)` accepts it. He also refuted
  the shipped comment's defence ("refused later anyway — openPath would fail"): true of `open-file`,
  but `show-in-explorer` falls back to revealing the CONTAINING directory, i.e. the junction target.
  **CONFIRMED at source and FIXED (`917a009`)** by walking up to the nearest existing ancestor,
  canonicalising that and re-appending the tail. The new pin's non-vacuity line proves the pre-fix
  code accepted exactly this path.
- **B2, the pin asserted the opposite of its own label.** `test_path_containment.js:86` read "a
  non-existent path is not promoted into a match" while asserting `=== true`, under a FAIL-CLOSED
  heading. He also spotted that the `return null` unverifiable branch was **entirely unpinned** — a
  future dev could change it to `return p` with the whole suite still green, the "dead guard greens
  every test" trap this repo has been burned by before. Both fixed in `917a009`.
- **THE SEAM (C5) — SEC-17 is bypassed end-to-end by the write side it deliberately left textual.**
  `_isOpenablePath` has two admission doors; SEC-17 hardened door 1 only. A document filed through a
  junction (the still-textual `filing/handler.js:172`) has the escaped path RECORDED in
  `documents.stored_path`, and door 2 matches `stored_path` textually — so it opens fine and the new
  check never sees it. Containment is a property of one branch of one predicate, not of the system.
  This is the `registration.is_unfalsifiable` / Castellan failure mode again: a guard written at one
  of several doors into the same decision.
- **PREMISE CORRECTED, downward.** He argued the finding is a **LOW**, not the MEDIUM it was filed
  as: all three doors are admin/edit gated, both IPCs are fire-and-forget with no data returning to
  the renderer, `ALLOWED_OPEN_EXTS` excludes executables, and the attacker needs write access inside
  an approved root already. Yield is "the app opens, on the operator's own screen, a document that
  operator could already read". Consequence he drew: nothing justified shipping ON ahead of review —
  and equally nothing justifies reverting now.
- **The strategically better fix (C6), which nobody had proposed:** every other renderer path channel
  in this app was already de-pathed to resolve server-side from the doc row, and doc-id variants of
  these two channels **already exist**. `open-file`/`show-in-explorer`/`open-folder` are the last
  three legacy raw-path doors. Retiring them deletes the attack surface instead of guarding it, and
  makes SEC-17 moot.
- Plus: a genuine prefix trap in `navGuard.js` (`startsWith(root)` with no separator, so
  `…\src\windowsEvil\` matches) found in passing and unrelated to SEC-17; the observation that the
  kill switch does NOT revert the case-insensitive compare, contradicting its own comment (now
  pinned as an accepted trade-off); and a pre-existing contradiction where Settings permits a UNC
  output folder that `_isOpenablePath` then refuses outright, so UNC-filed documents can never be
  opened.

**Outcome:** B1 + B2 fixed and pushed in `917a009`; 20 containment pins green with zero skips, and
the filing path-hardening / navGuard / anchor-label / teach-multipage / settings-wiring suites all
still green. **B3 (the refusal is silent — both channels are `ipcMain.on`, so an unverifiable path
gives the user no dialog, no toast, nothing) is OPEN and needs either a visible distinct refusal or
a measurement that the OneDrive-dehydrated-offline case cannot reach it.** C4 (shared
`src/lib/pathContainment.js`, with the filing WRITE side adopted behind its own flag because a false
refusal there blocks Confirm and rolls the document back to `needs_review`), C5, C6, C7 and C8 are
recorded in `SECURITY_BACKLOG.md` and pointed to from `pendingfeatures.md`. His manual gate — plant
a junction, request a NON-EXISTENT leaf through it, see whether Explorer opens the target — remains
the honest end-to-end check and has not been run on a real desktop session.

---

## 2026-08-08 — Stage-1 data-type coverage (`SEED_TYPED_FIELD_LABELS`), vetting gary + reggie

**In:** the owner's requirement "all data types, not a subset · custom must detect the same as
built-in · keywords 100%". gary (Python design + tests) and reggie (regex/validation precision)
agreed on: extend only the fall-through branch; single-source the type→validation map in a new
`extraction/field_types.py` re-exported by `engine._TYPE2VAL` by object identity; `role_caption`
ABSENT on the new typed seeds (both reached this independently, via `_PARTY_FOLLOW_STOP`); gate
Stage 1 for the structured types; flag default OFF; split currency out; build the corpus fixture
first. Also asked him to revisit his OWN earlier "DO NOTHING" on this flag, and to rule on a default
I had already shipped.

**Verdict: SEND BACK** for the widening · **default ON GRANTED** for `TEACH_LABEL_PICK` with two
conditions · **SIGN OFF** on both live pattern defects, to ship separately and first.

**Added value? YES — and this is the strongest case in the log for running him on a CONSENSUS
rather than a single proposal, because every one of his three ship-blockers lives BETWEEN the two
advisors rather than inside either.**

- **He found a DIRECT CONTRADICTION the brief listed as "agreed".** gary: leave the date/ref role
  branches untouched, which keeps `vat_no`/`account_no` byte-identical. reggie: DB type wins for the
  11 structured types. Under reggie's flip `vat_no` loses the ref caption bank AND `role_caption`,
  and is then refused a seed outright by reggie's own Rule C1 ("VAT No" = two generic tokens);
  `account_no` loses `_ref_caption_party_conflict`. Both are shipping lanes. Ruling: narrow the flip
  to the VALIDATION KEY only.
- **He falsified the consensus's named fail-safe rail — my write-up's, in `pendingfeatures.md`.**
  "STRICT_TYPES is the rail" is FORM checking; the Population-A failure is a well-FORMED value from
  the WRONG PARTY, so it passes `_matchesTypePattern` and files. And a strict-typed field hits
  `continue` at `trust.js:567`, so it never reaches the cold-scope `unverifiable-value` block at
  `:586`. The cited rail is the exact path that guarantees the wrong value files SILENTLY. Struck
  from the backlog on his condition B2.
- **He caught that gary's mandatory seam gate is VACUOUS** — the same trap gary had correctly caught
  on the recall lane, one level up. realdoc seeds nothing new (the audit's own census says so) and
  the synthetic corpus has no learned anchors, so the `anchor*→keyword` note-drop counter reads 0 on
  both arms whatever the code does. Hence G2: plant a capped-and-noted anchor in the generator, or
  the gate is a green test that cannot reproduce its bug.
- **He inverted my proposed partition.** I asked whether the auto-file drag plus C1 meant dropping
  the flag-only half. No: the dangerous population and the drag population are DISJOINT —
  `reference` (the type `guessType` picks most often) is not strict so it takes the cold-scope drag;
  email/postcode/vat/iban/percentage are strict so they take the silent-wrong risk. A single blended
  auto-file metric shows them cancelling and reads as "no change". Hence G6, split reporting.
- **He rejected the blanket `role_caption: None` both advisors agreed on**, for `reference` /
  `reference_code`: `'ref'` routes to a DIFFERENT guard (`_ref_caption_party_conflict`, which
  inspects the word BEFORE the caption) that `_PARTY_FOLLOW_STOP` reasoning does not apply to.
  Without it a custom `reference` field gets WEAKER guards than the built-in `account_no` — the
  owner's own complaint, inverted again.
- **On the incumbent seam he was narrower AND more alarming than gary:** taught reads are safe
  (`is_taught_override` does not require `authoritative`), but the classes that lose are exactly the
  capped-and-noted ones, and the loser is discarded WHOLE at `engine.py:5793` — value, note and all.
  Remedy: close it by construction inside the flag, and file the pre-existing exposure separately
  rather than widening it silently.
- **He discharged his own earlier DO NOTHING**, explicitly and with a reason: "zero live bite"
  remains true but no longer decides, because `guessType` auto-selects the broken types from the
  label, so a user is given one without choosing.

**On the TEACH_LABEL_PICK default he did the thing that makes him worth running:** he went looking
for the regression that would have made my reasoning wrong — that a both-suspicious pick returning
`direction:null` downgrades a garbled-but-present label into a phantom anchor, i.e. WORSENS the very
audit item the commit fixes — and REFUTED it at source (`showValueConfirm` already nulls a
suspicious `anchor_text` before commit). He then found a real, smaller one I had missed: the
`direction:null` path substituted a synthetic 0.12-page strip for a box the code had actually
located, which is worse geometry for the stored offset and relocation. Fixed as T1 (`b41cad6`),
along with T2, the now-false "teach does NOT share this picker" comment in the shared module.

**Outcome:** widening NOT built; B1–B6 and G2/G6 recorded in `pendingfeatures.md`. Both pattern
defects shipped (`c15f679`) — and the JS pin written for them caught a gap in my own IPv6 fix that
the Python `re.search` assertion had waved through. T1/T2 shipped (`b41cad6`). `ocr_type` retired
(`2a85838`) and `delivery_number` retyped (`3dc162c`) as owner decisions.

## 2026-08-11 LATE-NIGHT — NAME-BOX FLUSH-EDGE CLIP slice (fix a: teach-side trailing pad · fix b: `TEMPLATE_NAME_EDGE_GROW` v1)

**Verdict: SIGN OFF WITH CONDITIONS** — merge clean as built (default OFF, OFF proven md5
byte-identical on the 200-doc replay); the FLIP carries two blocking conditions, both honesty
items, both discharged same-session:
- **C1 (blocking, expectation note):** fix (b) does NOT heal the owner's own Ironclad 0028-1
  exhibit — its overhang is 0.0010 page-norm, under the untouched 0.004 floor (his own recorded
  condition 3). The corpus heals are real because sibling drift (0.003-0.005) straddles the floor;
  the live exhibit is cured only by fix (a) + a re-teach, or the C7 repair arm. MUST be said to
  the owner before the flip.
- **C2 (blocking, direct/indirect split):** of the 29 census heals, **1 is a DIRECT namegrow
  commit** (noted, review volume) and **28 are superseded** — the flagged @70 result un-squats the
  clipped 90 read and a correct keyword/template_fixed/hint wins arbitration unnoted. The flip
  buys ~zero new review volume on this corpus.
- Ruled the equality page-present witness (cut word's locate text == grown last token, NO
  short-token skip) the RIGHT defence — do not widen in this slice. Confirmed all four recorded
  revival conditions genuinely implemented; confirmed no seam with snap-union witness /
  edge-cut-relocate / pad-date / corroborated auto-file / currency legs.
- The real seam named: the 90→70 un-squat opens a 71-89 arbitration window for un-noted
  candidates; measured zero lane cost (every window doc was already wrong @90 in base — arming
  changes WHICH wrong string, not whether), but the 'SITE ADDRESS' @78 caption swap class is
  **owner-watch (C3)** via the census.
- **C4 (applied):** `_candidate_source_label` now prefix-matches `template_mapping*` so suffixed
  variants read "from the taught box" in the picker. **C5 (applied):** `TRAIL_PAD` named in
  valueLocate.js. **C6 (standing rule):** never arm `NAME_UNCLIP_RECONCILE` alongside this leg
  without a fresh A/B — two owners of one class. **C7 (open, owner decision):** the cure for
  EXISTING live templates is a stored-box repair arm (widen name-box trailing edges to the new
  floor — the sample-angle-backfill pattern, backup-first, own gate); fix (a) only protects
  future teaches.
Gates at sign-off: OFF md5-identical pre/post-edit · armed +22 lane heals / 0 losses (issuer +9,
customer +11, vat +2), all other lanes cell-identical · census 43 fires/200 docs (29 heal,
14 silent decline) · 22 Python pins + 11/13 JS pins + wiring pin + adjacent batteries green.

## 2026-08-12 — Review per-sender field editor (DESIGN-STAGE vet; owner + Chris + eric consensus)
**Verdict: SIGN OFF WITH CONDITIONS (5 blocking). Nothing built yet — conditions bind the build.**
- **Headline catch (seam 3):** eric's two named mitigations for mint-from-unconfirmed-doc are ONE
  gate — the ca0bb49 young-identity corroboration is NESTED inside `TEMPLATE_IDENTITY_ON_PAGE`
  (`template_matcher.py:611`); on flag-OFF installs (code default; the owner's own live DB) both
  are off together. Exposure genuinely widened as drafted: `_buildTemplateFields` freezes every
  schema-constant text field (vat_no/account_no/po_ref/serials) from a sample of ONE at
  `template_fixed` @95, and the empty-field "Never on these documents?" link invites the mint on
  doc #1 of an unseen sender, when allValues are raw machine reads (today's promote is clicked by
  someone who just CURATED the values).
- **C1 (ruling):** editor-path mint is IDENTITY-ONLY — `allValues = {supplier_name: <confirmed>}`
  only, no field rules from the unreviewed sample. Residual then equals the ordinary first-confirm
  birth, accepted honestly. PIN: editor mint writes zero non-issuer fixed_value rows.
- **C2:** design letter corrects the mitigation claim; owner told plainly there is NO active guard
  on the frozen issuer on flag-OFF installs + recommendation to flip `template_identity_on_page`
  (already in PROVEN_ON_DEFAULTS) as part of the arc — not a ship-blocker once mint is identity-only.
- **C3:** un-hide write-set = the SAME exported resolver as the display read ∪ `doc.template_id`
  ∪ group siblings (the display union starts with the matched template OUTSIDE the resolver,
  `review/handler.js:557` — resolver-only clear = visible no-op on the open doc); every deleted
  row audit-logged; the containment cross-sender residual (`templates.js:733/763` vs the reuse
  path's deliberate refusal `:786-789`) ACCEPTED + PINNED with a two-sender containment fixture.
- **C4:** audit rows on BOTH the new `set-sender-field-hidden` AND the existing (currently
  unaudited) `set-template-hidden-field`; seam-5×8 line (edit-role hides retroactively gain
  extraction authority) added to the `template_hidden_field_drop` flip checklist.
- **C5:** after a typed-corrected mint the first toggle must visibly affect the open doc —
  `_resolveFieldVisibility` keys on the on-screen issuer (`renderer.js:2660`), so sync the issuer
  field or push the template-id broadcast like the Settings path.
- **Chris-copy ruling:** "the ones waiting stay as they are" is FALSE — `hidden_fields` computed
  live at doc open (`review/handler.js:547-573`); eric's corrected copy TRUE in both
  `template_hidden_field_drop` states; re-vet the copy if that flag ever flips (a doc reprocessed
  while hidden renders Not-found after un-hide — fail-safe).
- Also named: untyped-doc disabled state; cancel = zero writes; generic-type friendly refusal;
  retiring Save-as-template loses the re-pin-sample admin path (Settings `set-template-sample`
  remains — acceptable, stated).
- **Gate:** existing pins green (`test_build_template_fields.js`, `test_upsert_type_link.js`,
  `test_identity_on_page.py`, div-balance, no-global-collisions) · new pins C1/C3 · 185-doc
  realdoc arm byte-identical with the feature merged (no extraction-layer drift) · UI smoke list
  (cancel/mint-toggle-visible/garble-sibling Show-again/Settings-side live-update/untyped/generic).

### 2026-08-12 addendum — sender-field editor BUILT, all five conditions applied, gates green
C1 identity-only mint (pin `test_editor_mint_identity_only.js`) · C3 single-authority write-set
`resolveVisibilityTemplateIds` ∪ matched id (pin `test_sender_field_hidden.js`, containment residual
pinned) · C4 both hide IPCs audited, role admin+edit · C5 toggle repaints from the server-returned
union. Existing pins ALL PASS; realdoc A/B (live-DB snapshot, feature vs stashed base):
**md5-identical, 142 docs, 0 silent wrong, 0 wrong-type auto-file.** Outstanding: owner UI smoke
list (app restart required — new main-process IPCs).

## 2026-08-12 — afternoon batch: THREE Oracle passes, five slices BUILT DARK (owner mandate "address everything, involve the agents")
**(1) RECONCILE_SHADOW_ATTRIBUTION — SIGN OFF W/COND C1-C5, BUILT.** Corroborated total + all-shadow
operands ⇒ note reworded to neutral evidence + 50-cap skipped; note NEVER cleared (the trust.js
any-noted-field rule stays the sole barrier — pinned at conf 90 AND at conf 100 where docTrustGate
is skipped). C1 kwarg-only-when-armed (2-arg stubs safe); pre-Stage-4 corroboration frame verified
drift-free (Stage 4 never writes the candidate ledger); `_cmp_norm` currency normalisation VERIFIED
(£-strip via _EDGE_RE). Census instrument RECONCILE_ATTRIB_CENSUS_DIR (buckets corroborated? ×
all-shadow?) = the flip evidence. Pins: tests/test_reconcile_shadow_attribution.py (12) +
test_trust_shadow_row_skip.js C2 pair + wiring row. Flag OFF + bridge + toggle.
**(2) VAT_RATE_AT_SKIP (reggie) — SIGN OFF, BUILT.** reggie REFUTED the "@ defeats the label"
assumption: bare "VAT" matches; the columned "@ 20%" segment fails the rate-annotation skip's
fullmatch, is taken as the value, and dies at currency validation ⇒ MISSING(tax). Fix = one
char-class ([@(]? + @ in the residue class), only ever consulted while a FOLLOWING segment exists.
End-to-end pins (tests/test_vat_rate_at_skip.py, 9) incl. last-segment-never-eaten. Flag OFF +
bridge + toggle.
**(3) GRADUATION ISSUER FREEZE — SIGN OFF W/COND, BUILT (graduation_freeze_issuer OFF + toggle).**
Oracle ACCEPTED the narrowing of his own C6 to issuer-only: the issuer is DEFINITIONALLY constant
(the scope key scopeTrust graduated on, ≥W human confirms) and the codebase-wide freeze exception.
Two-way pin shipped (can neither extend the freeze nor re-mute the issuer); frozen string = the
scope string, never allValues. Born-mature seam VERIFIED PARTIAL: namePresence counts BINARY-equal
supplier while scopeTrust counts LOWER(TRIM()) — a case-varied scope can land in the YOUNG fallback;
direction SAFE (stricter). FLIP CHECKLIST (blocking at flip): record template_identity_on_page
state — freeze + identity-on-page OFF re-opens the Quillstone class with stronger stamps; flip
together (in the toggle copy). Backfill script scripts/backfill-graduation-issuer-freeze.js with
ALL SIX census clauses (incl. ≥DISTINCTIVE_MIN + no-issuer-mapping exclusion); census RUN read-only:
exactly tpl 14 (Oakhaven) + tpl 15 (Harrowgate) eligible, 2 of 2. APPLY + replay gate = owner-timed
(app closed). Named residual: a scope graduating LATER against a pre-existing variable template
links without freezing — recorded, not widened (C1 never-mutate-on-link outranks completeness).
**(4) SUPPLIER_PIN_SELF_DISCHARGE — SIGN OFF W/COND, BUILT (flag OFF + bridge + toggle).** At the
final re-assert: natural read (page/layout-evidence allowlist; keyword_override EXCLUDED pending a
page-hit proof — memory echoing memory is not corroboration; doctype-'fixed' excluded) normalise-
equals the pin ⇒ natural row kept (earned conf, own notes never stripped) + `_supplier_pin_
discharged` signal → JS clears documents.supplier_pin AFTER the merge commits, audited, race-guarded
(exact match on the CURRENT stored pin). First assert deliberately untouched (Oracle UPHELD — the
pin re-scopes WHERE TO LOOK; all seven accepted_issuers consumers verified suppression-only).
Comparator _accept_norm∘normalize_supplier_name EXACT — anti-fuzzy/subset pins shipped. What still
holds a discharged doc: reprocess NEVER auto-files (_maybeAutoFile import-path only, verified) +
natural-read notes + trust floors. Pins: test_supplier_pin.py +11 · test_supplier_pin_discharge.js
(6) · wiring row. Census arm (18-pin backup copy, AFTER the backfill) = owner-timed.
**Also built same afternoon, no Oracle needed:** graduation_window setting (clamp 3..50, default 10,
5 pins) · Learning-Repair currency magnitude exclusion (both detectors, 4 pins) · containment
predicate substantial_containment (INERT, reggie spec, 10 pins). Build order standing: freeze →
backfill → discharge census.

## 2026-08-12 — CONFIRMED_DOMINANT_ADOPT (owner: "minimise interaction where positive confirmation exists"): SIGN OFF W/COND B1-B5, BUILT DARK same day
gary root cause: Stage-2.5d snap QUADRUPLE-SEALED on exhibit A (name-field skip :7009, method skip
:7010, single-token+digit index gate ocr_corrector.py:424-425, ≤1-confusion distance :388-402);
exhibit B (account number in customer) is a wrong-SOURCE grab beyond any distance corrector. Right
layer = terminal step `_adopt_confirmed_dominant`, placed B5: AFTER the corrob build, BEFORE the
final trace (the inspector must never show the dead junk as final). Oracle rulings: the SECOND
named _override_eligible carve-out ACCEPTED (docstring amended to name both, "only these two");
premise-failure note removal ACCEPTED (the note's referent is destroyed — distinct from the
forbidden corroboration-clears-notes); template_mapping inclusion ACCEPTED (S-A/S-B: the teach
fixed the POSITION); "files silently" claim CORRECTED (format_anomaly_flagged already counted —
exhibits open in Review with the right value pre-filled, no picker, no note; that IS the owner's
win). Conditions applied: B1 adoptee must itself PASS the junk predicates (else picker); B2 the
field's corroboration record rewritten in-step (memory family, independent_agree False, dead value
retained as disagreement — _corrobLicensed refuses STRUCTURALLY); B3 `+confirmed_adopt` rows
excluded from getFieldFormats UNCONDITIONALLY (confirmed_via can't split graduated machine files
from humans — both NULL; Oracle verified _autoFileDoc stamps 'auto_corroborated' only for the
corroborated basis. SEPARATE pre-existing gap filed: graduated/threshold auto-files stamping NULL
count toward the HUMAN graduation window — own arc); B4 STRICT variability pinned (a second
distinct key at ANY count refuses — the multi-party Bill-To/Ship-To residual's bound); B5
placement + both stale comments amended. Build's own bug caught by its pins: `"pin" in m`
matched 'template_maPINg' — the exact substring-consumer trap the rider named. Pins: 22 python
(both exhibits, all refusal gates, picker-suppression via the :2612 note-gate, OFF byte-identical)
+ 3 JS (B3 with a falsifiable control) + wiring row. Census CONFADOPT_CENSUS_DIR (refusal
histogram + adopted-and-filed vs adopted-and-held split; run on the LIVE replay too — the corpus's
customer_name is near-constant by construction and would flatter the residual). FLIP BAR:
would-adopt-vs-GT 100% — a single wrong would-adopt is a no-flip, full stop.

## 2026-08-12 NIGHT — GATE-UNIFY (three-gate disparity, the import arc's Priority 1): SIGN OFF W/COND, BUILT DARK same night (`83dc89e`)
gary+eric consensus, both independently BLOCKING on the via-NULL trust seam (the gap the CONFADOPT
B3 entry above filed as "own arc" — closed here). Oracle premise check upheld the mechanism trace:
the pre-gate's msg.needs_review bail is policy-broader, not information-richer (all 13 engine.py
_needs_review writers persist a validation_note; rows insert synchronously before the gate —
ordering PINNED). Census split ruled the policy: 49/51 parked-eligible docs were EMPTY-OPTIONAL-only
(vat_no/po_ref/account_no @0), 0 valued-below, 0 empty-required. RULINGS: (1) FILE the
empty-optional class — a blank optional files blank, not wrong; a human Confirm files the identical
blank; conditional on T2 (missing-required predicate refusal, exact mirror of
missing_required_labels incl. hidden-field + identity exclusions — Oracle C1: a per-sender
"Never — stop looking" hide must never become the new parking). (2) Valued-below defers to the
predicate; the docTrustGate unverifiable-value refusal is the fail-closed guard — pin PAIR shipped
(breaks-shape refused / matches-shape files; classifier semantics discovered en route: spaced
values classify freetext, <5 samples stay on the non-role lenient path). (3) T3 stamps BOTH machine
bases (auto_graduated/auto_threshold + trust.js:538 exclusions, unconditional — no historic rows);
via-NULL machine confirms filling human W-slots is the sweep-incident mechanism at scale. (4) FAR =
option (i): ALL FIVE isFlagged consumers move to the valued-only tier together (option (ii) trades
a mysterious park for file-despite-warning). (5) HISTORIC COHORT STAMP BLOCKING FOR THE FLIP:
165 via-NULL machine files live (90 graduated Ironclad 40/Meadowvale 50 + 75 threshold Bramblewood
36/Harrowgate 39) — scripts/stamp-machine-autofiles-20260812.js, APPLY verified on a snapshot:
windows shrink to genuine human volume, ZERO revocations. (6) Sequential auto-file dispatch chain
(sync commitDocument I/O × 50-90 docs would stall main). (7) Acceptance restated honestly: Oracle's
~163 assumed trust_shadow_row_skip OFF — VERIFIED ON in the live DB, so the 15 Nordwind are already
predicate-eligible; the 5 type-election mistypes recur on fresh import (own filed arc). Q5 ruled:
the 49 machine files skipping saveCorrections hint learning is directionally SAFE (machine files
feeding learning is what the sweep incident punished; scopes are post-graduation, counts mature).
Gates: pin suite 33/33 (headline: armed + empty vat_no@0 FILES — parking cannot be silently
restored); decision-layer A/B 74/74 identical dark-vs-armed, 0 armed-widenings; zero
extraction-layer changes. Flags autofile_gate_unify + far_lowconf_valued_only, both OFF + toggles.

## 2026-08-12 NIGHT (entry 2) — TYPE-ELECTION TITLE-FIRST (the Meadowvale credit-note-typed-Invoice defect): SIGN OFF W/COND, BUILT DARK same night
herald design (fix 1 option (b) shipped-code `_ADDRESS_CAPTIONS` incl. 'order to' + 6 defensive
analogues — Oracle verified none appears in ANY shipped bucket, all inert today; fix 1 must
suppress the RELAXED :955 exposed-head path too, not just the strict test — the load-bearing
subtlety, pinned; fix 2 any-segment strong-heading gated to the TOP BAND, operates on _work
post-gap-collapse; fix 3 re-keyed onto a new STRICT strong_heads dict — never the relaxed
`headings` dict, whose contract is the template-precedence gate only). Oracle DECLINED the
DO-NOTHING option on fix 3 (an enumerative defence needs the general tie backstop; 6 lines,
tie-only, title-ward). Bonus finding verified mechanically: with fix 1 ON the relaxed head for
Credit Note is already True on cached text → plain reprocess self-heals via
resolve_assigned_type_authority (ks_auth='machine') — the FINDINGS' "plain reprocess can NEVER
self-heal" is false once fix 1 ships. Conditions: C1 stale test citation repointed + the
column-break contract pin created (§0); C2 owner-watch = statement-heavy suppliers (the fix-2
admit class, 0/926 today); C3 say at flip: human-confirmed mistypes don't self-heal; flip
type-election BEFORE measuring gate-unify (removes the known-fixed class from its census); C4
residuals recorded (despace/fuzzy + owner-precedence both still seg0-only); C5 the frozenset
boundary is LOAD-BEARING — party-address captions only, never field captions. Gates: pins 19/19
(exhibit end-to-end pin fails on both bug-absence and OFF-leak — a real gate); census 926 texts,
9 heals (the exact live class incl. the 5 queued), 0 collateral, 0 regressions; all 9 existing
heading suites green. Flags OFF + one toggle `type_election_title_first`.

## 2026-08-12 NIGHT (entry 3) — XCHECK_CORROB_NOTE_DEMOTE (corroboration STEP 3, slice 1): SIGN OFF W/COND, BUILT DARK same night
Owner ordered it after the third same-day exhibit ("still seeing messages where there is
corroboration" — the Nordwind date: mapping@90 + keyword@85 + full-page crosscheck@70 all agree,
the lone taught-crop 2028 REJECTED, yet the Stage-2 "please verify" note held the doc). gary's
load-bearing find: corroboration-clears-notes ALREADY SHIPS default ON (CROSSCHECK_KEYWORD_CLEAR
E2 — the CONFADOPT "forbidden" phrasing was overbroad); E2 refused only because its predicate
checks the instantaneous INCUMBENT, and the record can't express the case (the crosscheck winner
is bucket-excluded → independent_agree False BY CONSTRUCTION) — the LEDGER is the only substrate.
Oracle rulings: boundary sound with amendments — REJECTED the confusable-pair refusal (would make
the slice inert on the ordering class); B1 BLOCKING: terminal placement lands after overall/_
needs_review were computed → recompute at demote (narrow: overall always; needs_review downgraded
only when the demoted note was the doc's LAST and the validator agrees — the 13 direct writers
all cap+note, so their holds survive); B2 BLOCKING: DATE-FIELDS-ONLY (crop witnesses share the
recipe LADDER — the serif I→1 class proves cross-recipe common-mode; the engine.py:975 dark-clear
precedent un-masked a ref misread into a silent wrong file; refs wait for the ladder fix); B3
BLOCKING: ledger gains additive `noted` bit — witness must be un-noted + located + conf ≥80.
STANDING-RULE RULED SCOPED with proof gary missed: E2 was already ON when the shadow-attribution
condition was signed, so the literal reading is incoherent with its own author; operative content
= no mechanism may clear the SHADOW note class and no clear may key on the record's
independent_agree — both structurally satisfied + pinned. C1 note_demoted carries the REJECTED
crop read (re-threaded past Slice-1's pop — the census's retro-audit key, the only instrument
that can observe the disaster class); C2 raw-witness note never unified into the constant
(two-read consensus the value is WRONG); C3 structural exact-equality pin; C4 demoter never
touches independent_agree (floor back door); C5 framing corrected (corrected_to also blocks; both
popped). Partition comment shipped: E2 = flip-corroborated-by-incumbent · Slice-1 = flip-refuted ·
this = flip-corroborated-by-crop-ledger. Pins tests/test_xcheck_corrob_demote.py 26/26; adjacent
crosscheck/corrob/CONFADOPT/wiring suites green (test_anchor_crop_crosscheck 3 fails PRE-EXISTING,
stash-verified). Flag OFF + toggle `xcheck_corrob_note_demote`. FLIP BAR: demote census
(XCHECK_DEMOTE_CENSUS_DIR) — demoted-and-wrong = 0, one is a no-flip; realdoc M=0 owed at flip.

---

## 2026-08-21 — Note A cold-start letterhead PREFILL (slice 0) — SIGN OFF WITH CONDITIONS
gary design → Oracle vet. Problem: a fresh install reads a letterhead company but SUGGESTS (value-less
row + "Use 'X'" button) instead of ASSERTING → 0/200 filled, ~200 clicks (Chris r11 card #4). Premise
VERIFIED at source: all learning is `status='confirmed'`-gated (getFieldFormats learning.js:1486,
nearMatchIdentity :201, getDominantSupplier templates.js:183 — needs a template_id a cold doc lacks);
the Python engine writes no DB; a filled `needs_review` supplier plants/attracts nothing pre-confirm.
Fix: engine.py:9360-9394, behind `LETTERHEAD_PREFILL` (DEFAULT OFF), write pick_issuer's name into
`supplier_name.value`. BLOCKING CONDITIONS (all built): **C1** conf 69 not 70 (held by confidence AND
note; mirrors the logo-detail twin :9277); **C2** a value-present note keeps the "sender, not the
customer" copy, drops `suggested_supplier`, and does NOT arm the isBrandingFlag button (no double
affordance — the value-present convention :9253-9255); **C3** method token `letterhead_prefill` matches
no _resolve_corroborated_notes class nor classFix CLEARABLE_NOTE_MARKS (reprocess cannot shed the note);
**C4** guard-4: no `.value` write when the logo-abstain block already owns the row with a note. **C5**
(separate later slice): batch-confirm / "Apply to N" must not blind-accept prefilled rows. Verified
inert under a pin (value set + re-asserted engine.py:7808 before the prefill guard 9385) and with the
flag OFF (byte-identical). GATE owed before any default-ON flip: OFF==ON corpus md5; pristine-DB
cold-pass PREFILL 0-vs-1 (same suggestion set/names, each prefilled held by conf≤69 AND note, zero
newly auto-file); buyer-branded recipient fixture still noted + ineligible; both-flags classFix pin;
zero supplier_name regression on already-identified docs. Pin: test_letterhead_note_contract.js
(revised, both branches, green). SHIPPED DARK.

## 2026-08-21 — "Apply 'X' to N & re-read" silent no-op (slice 1, Chris r11 card #1) — SIGN OFF WITH CONDITIONS
gary root-cause → Oracle vet. Root cause (verified at source): the correction-ripple re-reads through
the generic runReprocessBatch, whose two `confirm()` gates (renderer.js:7210, :7214) early-return BEFORE
the re-read; a dismissed dialog (a scripted CDP driver auto-dismisses window.confirm; a real user may
Cancel the discard warning) swallows the whole re-read — pins written, the offer removed (looks like
success), nothing re-read. Compounded: the source's "Use X" persists only `supplier_pin` (resolve-issuer
handler.js:586); its value is in-memory (persist-on-Confirm) and the source is excluded from the ripple
set, so the batch's currentDoc refetch repaints it value-less ("source forgot it too"); and deferred
siblings are pinned but were excluded from `queue` so never re-read. No deeper revert — mergeReprocessRows
keeps a valued operator_pin row via `used_new`. Fix: `runReprocessBatch(docs, label, opts)` — opts.preConfirmed
skips both confirms (the "Apply to N" click IS the consent), opts.preserveOpenDoc skips the currentDoc
refetch; the ripple pins `[source, ...siblings]`, re-reads from `[...queue, ...deferredQueue]`, and includes
the source in the re-read ONLY when `_sourceOnlySupplierDirty()`. BLOCKING SEAM CONDITION (built): re-read
the source only when its sole pending edit is the supplier just applied — otherwise a typed date / staged ⊕
teach / manual type would be silently discarded (Nuance B: save-first does NOT protect — used_new clobbers a
valued corrected_to). Do NOT globalise preConfirmed — Reprocess-All keeps its "re-read N?" warning. Verified
no letterhead_prefill interaction (value set under a pin → prefill guard skipped). GATE: swallow-PIN asserts
reprocessBatch FIRED with source+sibling ids (not merely "no early return"); SEAM test (unrelated source edit
preserved, source not re-read); durability (operator_pin X persists); narrowing pin (Reprocess-All still blocks
on confirm→false); deferred fixture; SUPPLIER_RIPPLE=0 inert; realdoc M=0 negative control (VACUOUS here —
renderer/wiring only; the unit+fixture tests are the real gate). Pins: test_issuer_ripple_pins.js (fixture-DB,
green), test_issuer_ripple_contract.js (static contract, green). SHIPPED (no new flag — the ripple is already
gated by SUPPLIER_RIPPLE).

## 2026-08-21 — post-teach follow-up card (Phase 1) + the confirm_persist_values/dedupe flip (Phase 2) — SIGN OFF WITH CONDITIONS → GATE PASSED, FLIPPED
barry (UX) + gary (mechanism) → Oracle. Chris r11 cards #3/#5: teaching gives recognition but not
auto-file. Unlock verified at source: a (supplier, doc-type) scope needs 3 CONFIRMED docs whose role
fields carry valued rows so getFieldFormats emits solid groups and docTrustGate stops refusing
`unverifiable-value` — the first-firing wall on a fresh install (graduation W=5 and corroboration are
inert at bar 90). The teach commit doesn't count today (`confirm_persist_values` OFF).
**Phase 1 (shipped):** a done-screen card computing the honest `needed` from getFieldFormats (C1 =
max over role fields), promising only when queued siblings bring `needed` DISTINCT refs (C2, the
constant-ref lie), navigation-only so the anti-bulk-confirm C5 is moot by construction. Pin
test_teach_followup.js.
**Phase 2 (flipped, mig 78):** `confirm_persist_values` + `format_corrections_dedupe` default-ON PAIRED
(persist mints the taught doc's values so it counts → the card reads "2 more"; dedupe stops one doc's
correction fan-out from self-reaching the bar — they MUST move together). Oracle census methodology
vetted (SIGN-OFF-W/COND: judge on the BOTH arm, real gate not format-solid proxy, mint over NON-machine
confirms under per-type role keys, M-check supplier AND type, scopeTrust invariant = confirmedCount/
corrections fixed + reason moves only ok↔unverifiable-required-field, dedupe de-grad must be <3-distinct
fan-out). **GATE PASSED:** G1 `census_confirm_persist_flip.js` on live-backup (1668 conf) + young (93)
DBs — M-neutral (the only wrong-flags are buyer-issued POs correctly filed under the issuer Bramblewood,
a GT artifact present in base), +16 correct newly-eligible on the young corpus, ZERO de-graduations,
scopeTrust invariant clean, G3 empty-issuer-block = 0 (Refinement B did not bite — 255/263 docs already
carry a populated issuer row). G2 realdoc (RR_APP_ENV=1, both flags, minted copy + dedupe): 0
regressions, M=0, zero per-field accuracy drop, +3 more CORRECT auto-files. Pin test_confirmed_value_rows.js
updated (§7: both default ON, pair moves together); high-risk confirm-path suites green.

## 2026-08-21 — "teach 1 → import N → it files itself" arc (4 slices; barry UX + gary mechanics + eric quiet lane) — PER-SLICE VERDICTS
Owner direction: teach 1, import 100 → fragmented/misdetected senders + "remember to press Reprocess this
supplier" → scared user quits; any background re-read must never hang or disable Review buttons. Two vet
attempts lost (API error; session closed mid-trace); third produced this. Premise re-checked at source:
the shipped sweep bar (`sweep-queue-candidates` handler.js:3117) is Tier 1 (stored rows) — a sibling imported
before the 3rd confirm carries `overall_confidence` baked with `supported_keys=∅` (engine.py:9182-9189 →
validator.py:926-928 +0) so it sits 87-95 and `below-floor` (trust.js:933) holds it even after formats exist.
**Flipping `scope_sweep_enabled` alone does NOT fix the owner's scenario. Slice 2 is the unlock; Slice 1 the
click removal; Slice 3 the tail.**
**Slice 2 (Tier 1.5 fc recompute) — SIGN OFF WITH CONDITIONS, BUILD FIRST.** A JS re-derivation is acceptable
ONLY if there remains ONE number: do NOT overlay into `isAutoFileEligible` (the accept re-check `_evaluateSweepDoc`
:3199 reads the STORED row → every lifted doc drops `below-floor` at accept — drift by construction, the forbidden
two-predicate class). PERSIST `documents.overall_confidence = overall_base + fc(today)`, `overall_base` immutable
provenance, stamp `overall_fc_recomputed_at`. S2-C1 clamp recompute ≤99 (the at-100 gate-free arm trust.js:1029-1037
skips `docTrustGate` — only a real read may claim 100; pin). S2-C2 run JS `valueMatchesShape` + prefix-outlier on
CURRENT rows before any lift; a would-flag field = mismatch (fail toward review). S2-C3 `applyReprocessResult`
(:2491) must also write `overall_base` (pin `base+fc==overall` on merged row). S2-C4 formula twin: validator
`key_fields = required OR all-if-none-required` (gary's "required enabled" drops the fallback), value truthiness vs
`display_value`, no `enabled` filter in Python — ONE shared JSON fixture `(signals[])→delta` for pytest+mocha AND a
realdoc per-doc invariant `_overall_base + JS_twin(rows,formats) == _overall_confidence`. S2-C5 emit `_overall_base`
at the FINAL overall site as `final − final_fc_delta` (the `corrob_note_recompute_fc` linchpin recomputes after
demoters), never the 9174 intermediate. "Never more lenient than a re-read" NOT sound as stated (at-100 arm; re-read
can ADD shape/prefix notes). GATE: reason histogram over the r12 held scope FIRST (<20% lift → DO NOTHING, say so);
S2-C4 invariant green; pristine-DB `taught_autofile_counterfactual.js` teach1→importN→confirm3: auto-filed up,
wrong-folder=0, no doc lifts to 100; realdoc M=0 (valid for the base emit).
**Slice 1 (auto-accept the existing offer) — SIGN OFF WITH CONDITIONS.** The glance is NOT load-bearing for safety
(accept files only what `isAutoFileEligible` passes on stored rows — the SAME predicate the import path files with
no click; Chris filed 154 in one click, glance unexercised). It IS load-bearing against the 08-12 SHAPE: the sweep
is queue-wide (:3134-3139) so auto-accept after one Pelican confirm would file Oakhaven too. S1-C1 SCOPE-LOCAL:
auto-accept ONLY the `(supplier, slug)` of the triggering human confirm (`onAfterConfirm` carries scope); every
other scope stays a bar; pin confirm-on-A files zero B. S1-C2 preconditions checked server-side AT ACCEPT:
`scope_sweep_enabled` AND `learning_exclude_machine_confirms` AND `autofile_gate_unify` (VERIFIED hole: handler.js
:4730-4732 stamps `via:null` when unify OFF → counted HUMAN by the window + the exclusion; unify defaults 'true'
index.js:131). S1-C3 no chain: trigger on `!_via` only, accept confirms carry `via:'scope_sweep'`; pin with a
positive control. S1-C4 receipt not toast: `_recordAutoFiled(db,id,false)`, server-stored bar surviving reopen,
"Put back all" writes NO corrections row (pin scopeTrust corrections unchanged). S1-C5 refuse accept while a quiet
read is in flight for that scope (`_quietLaneActiveScopes` — the lane is invisible to `_anyProcessingBusy()`).
S1-C6 25/pass, ≤8 passes, `setImmediate` yield, skip when busy. Starvation: the exclusion is NECESSARY and with
unify SUFFICIENT; its reader-blindness cost is the 08-20 split-the-input problem — do NOT relax this precondition
to fix it. GATE: pristine-DB Chris round — after the 3rd confirm on X, X's siblings file themselves, other bars
remain, wrong-folder=0, receipt lists exactly the filed ids, put-back restores all; audit C8 pairing.
**Slice 0 (letterhead fragment abstain) — SIGN OFF WITH CONDITIONS.** Traced letterhead.py:140-209: segments scored
by their OWN words' height → a letter-spaced heading degrades to 1-word segments; superset rule (:202-206) rescues
only when the full name recurs. Abstain is the right shape; re-join in the assert path still REFUSED. PREMISE HALF
RIGHT: trust.js:686-689 counts empty-vs-typed as a correction and `TRUST_MAX_CORRECTIONS=0` (:35) — an abstain that
ends EMPTY and is typed is STILL a `recent-correction`; "empty beats a guess" holds for misfile risk, NOT for
graduation unless the text arm then reads the name. S0-C1 MEASURE per abstaining doc: text arm correct / wrong /
None — ship only if correct dominates. S0-C2 blast radius: every doc's issuer → realdoc M=0 NOT vacuous here; zero
per-field drop on Document Issuer; pins r12 #2 positive, `Superstore    INVOICE` picks, `Acme    Widgets Ltd → None`.
S0-C3 adjacent same-row segment must be letterhead-sized by its own words (≥`_GEOM_MIN_RATIO`) — a body-sized
recipient column must not trigger. NAMED, NOT BUNDLED: whether empty→fill should count as a correction at all
(affects every cold-start scope).
**Slice 3 (quiet background re-read lane) — SIGN OFF ON DESIGN, NO-GO ON BUILD (yet).** (a) 08-02 re-ruled: lifted
for this lane ONLY if untouched-only candidate set + presence-skip at START and MERGE (presence heartbeat ~25s vs
TTL 60s review/handler.js:736-760 is a reliable staged-edits proxy) + merge-time status/fingerprint gate + renderer
refreshes LIST only. (b) `applyReprocessResult` defence in depth REQUIRED: no precondition, unconditional
`needs_review` (:2492), `review_acknowledged_at=NULL` (:2501), and the `UPDATE documents` runs OUTSIDE the
delete+insert transaction (:2483-2486 vs :2489) — S3-C1 `opts.expect={status,fingerprint}` verified INSIDE one
transaction that now also holds the UPDATE (else return `dropped`); foreground passes nothing → byte-identical.
S3-C2 `opts.preserveAck`. (c) One consent idiom AGREED: eligible docs ONLY via sweep offer/accept with a DISTINCT
machine via `auto_quiet` in `MACHINE_VIAS_SQL` (undo/audit must tell them apart); never `_reprocessOffer`; pin no
`reprocess_autofiled` audit row from the lane. (d) quietness shape RIGHT (`os.setPriority(pid,10)` + Python ctypes
`BELOW_NORMAL` self-demotion beats the `py.exe` PID race; not `PROCESS_MODE_BACKGROUND_BEGIN`; kill at every
foreground door). S3-C3 measure before flip: Review click→response p95 <100ms with lane running; foreground import
per-doc time == baseline with kill completing BEFORE the batch spawns; kill ≤1.5s + tree reap; lane CPU ≤
`_reprocessThreadCap`. S3-C4 assert the cap equals the import's cap else boundary-glyph flips manufacture phantom
"read differently" holds. S3-C5 changed-read compares ALL required valued fields (a PL→PI snap is a CHANGE, held).
S3-C6 stdout handler re-checks presence+status+fingerprint and applies in ONE synchronous block, no await between.
NO-GO until Slice 2's histogram shows the residual held by a demotable note is ≥15% of the pile.
**Cross-slice seams:** (1) S2 lifts → S1 files with no glance — only with S2-C1+C2; (2) null via → S1 loop re-opens
— S1-C2; (3) lane invisible to busy → accept/merge interleave — S1-C5+S3-C6; (4) reprocess drops `overall_base`
— S2-C3; (5) abstain→empty→typed→recent-correction — S0-C1 decides.
**BUILD ORDER:** Slice 2 (histogram → build → gate, may ship DARK alone) → Slice 1 scope-local (DARK; 1+2 flip
together in ONE Chris round — one user-visible behaviour) → Slice 0 in parallel, own corpus gate, flip with
`TEMPLATE_IDENTITY_GEOM_FRAGMENT_SHED` only if S0-C1 justifies → Slice 3 gated on the histogram, NEVER in the same
Chris round as 1+2 (misfile attribution). barry's copy items (teach card count gated by `canPromise` wording not
number; "File N ready" from `autoFileEligibleIds`) need no Oracle gate. **DO-NOTHING check:** flips + copy alone
(`scope_sweep_enabled` + variant-A wording + the shed flip) remove "go find Reprocess" but NOT the fc deficit — few
docs offered in the owner's scenario. **Smallest step that actually removes "remember to reprocess": Slice 2
persisted recompute + `scope_sweep_enabled` ON with the bar reworded as payoff; then Slice 1 removes the last
click.** (Fresh-install threshold already 90 via mig 71 — verified.)
**GATE (a) RESULT, same night — Slice 2 = DO NOTHING.** `TESTING/_measure/s2_histogram.js` (real
`isAutoFileEligible` before/after a persisted `min(99, base + fc(today))`, `supported` from the REAL
`build_format_class_index` via `s2_supported.py`) + `s2_ceiling.js` (assume every required key supported,
the post-3-confirm state): r12 sandbox 0/22 lifted, ceiling 0; 08-20 night sandbox (410 docs, 13 human
confirms on Veltrix) 0/378 lifted, ceiling 2 (0.5%: two Veltrix docs at base 89 with supplier_name@72).
Base re-derivation reproduced the stored overall with supported=∅ on 222/224 typed docs (twin verified).
The premise is not observed: taught-template siblings carry base ≥95 (template_mapping 95-98 +
template_fixed 95) so they clear bar 90 WITHOUT the boost; what holds them is `unverifiable-value`
until the 3rd confirm (the 08-18 wall), which the shipped Tier-1 sweep already re-gates on stored rows.
The held pile is untyped 164 + no-supplier 190 of 378 = docs imported BEFORE their sender was taught —
a RE-READ class (pre-teach reads carry no template), not a recompute class. Consequence for the order:
Slice 1 flips with `scope_sweep_enabled` alone; Slice 3's "earn its place" number is the pre-teach
residual (94% of the night pile; Chris r12: blank → 94/90 via template_mapping only after reprocess),
not the demotable-note residual (~2%) — its candidate predicate must be "held docs of the taught
sender's scope that carry no template read", trigger = a teach/anchor commit.
**BUILD + GATES, same night (owner: "continue on auto with the recommended settings and complete all of the
slices", 2026-08-21 23:0x) — all DARK, mig 79 seeds the four switches OFF:**
- **Slice 1 BUILT `72f9c7f`** (`scope_sweep_auto_accept`): reviewService `onAfterConfirm` (!_via only) →
  per-scope 1.5 s debounce, single-flight → scope-local offer (`_sweepOfferForScope`, server-recorded +
  audited) → the SAME `_sweepAcceptCore` the consent bar runs (extracted, ONE writer) → `_recordAutoFiled`
  receipt + `scope-auto-filed` broadcast; S1-C2 preconditions re-checked at every pass (sweep + exclusion +
  gate-unify); S1-C5 `_quietLaneActiveScopes`; `sweep-queue-candidates` yields 'auto-accept-running'
  mid-pass. Pins `test_scope_auto_accept.js` (31, fixture DB through the real handler + reviewService:
  scope-local · no chain with positive control · each precondition · lane seam · put-back writes no
  correction). Review receipt bar: "N from X filed by itself after your confirms · Put back".
- **Slice 0 BUILT `fbae2e9`** (`letterhead_fragment_abstain`, env `LETTERHEAD_FRAGMENT_ABSTAIN`):
  `_pick_by_height(neighbour_name_shaped)` abstains on a single-token winner beside a letterhead-sized,
  name-shaped, non-excluded same-row segment; never a re-join. S0-C1/C2 CENSUS (`s0_census.py`, 200 IMPORT
  fixtures, real OCR 200 DPI, the engine's own type phrases): 115 correct unchanged · 34 abstained, EVERY
  one a wrong fragment ('Security'×18, 'Cleaning'×16) → text arm None · **0 correct lost · 0 new wrong**;
  the residual 24 "wrong" are buyer-issued Quillstone POs correctly reading Bramblewood. The Oracle's
  graduation caveat stands (empty→typed is still a correction) but the alternative was a WRONG prefill
  that also needed typing — strictly better on misfile risk and trust, neutral on graduation. Pins
  `test_letterhead_fragment_abstain.py` (15).
- **Slice 3 BUILT `7819858`** (`quiet_reread_enabled`, `quietLane.js`): trigger = a TAUGHT confirm;
  candidates = the sender's held template-less docs by name ∪ `supplierSiblings.findSiblings` by page
  text seeded from the taught doc (pre-teach siblings usually carry no sender); chunk 40; one worker,
  same `_reprocessThreadCap` (S3-C4); BELOW_NORMAL via `os.setPriority` + Python ctypes self-demotion;
  kill at the three foreground doors + 1.5 s poll, defer + resume (S3-C3 semantics); merge gate in one
  synchronous block (S3-C6) + `applyReprocessResult(opts.expect)` verified INSIDE the rows+document
  transaction (S3-C1 — the UPDATE used to run outside it) + `preserveAck` (S3-C2); changed reads held
  with "was X, now Y" (S3-C5); the only filing door is the sweep/auto-accept (S3-(c)); own channel
  `quiet-reprocess`. `reprocess-batch` staging + shard spawn extracted into `_stageReprocessDocs` /
  `_runReprocessShard` (shared, statement-for-statement). Pins `test_quiet_lane.js` (50: pure lane +
  wired handler with a fake Python). DEVIATION noted for the owner: Chris round 13 runs Slices 0+1+3 in
  ONE round (the Oracle asked for 3 apart from 1+2); Slice 2 is dead, and every filing the lane enables
  carries audit rows (`quiet_reprocess_job` done_ids + `scope_sweep_auto_accepted` filed_ids) so a
  misfile is attributable — the owner's one free fix-run covers the risk.
- barry's copy items shipped `8de69d5` + in `7819858`: teach card count + Review link (wording gated by
  canPromise/autoAccept), typed-correction ripple doorway, honest "File N ready" dialog.
- Suites: JS 181 green / 1 pre-existing red; Python 307 pytest green / 1 pre-existing + 6 pre-existing
  script-style reds (all verified red at `6c24ab6` in a worktree).

## 2026-08-22 — Chris round 13 fix-run (F1 role-field dominant class · F2a lane on graduation · F2b auto-accept after sender reprocess · F3 honest badge) — ORACLE — Chris round 13 fix-run (F1 · F2a · F2b · F3)

**VERDICT (per fix):**
- **F1 role-field dominant class — SIGN OFF WITH CONDITIONS.** Ruling on the fork: it does NOT re-open the item="Information" inversion; it is the same verification rule (not an exemption) extended to role fields. But it DOES do the thing the 07-20 comment at `trust.js:302-304` forbade (widen graduation through scopeTrust) — that prohibition is superseded for this PAIRED change only, and the comment must be rewritten.
- **F2a lane on graduation — SIGN OFF WITH CONDITIONS.** A graduation MINT (create or link returned from `_maybeGraduationTemplate`) is a legitimate lane trigger under the 08-21 list: it is a template-creation event, same class as a teach. A bare confirm that yields `skip` remains NOT a trigger.
- **F2b auto-accept after foreground reprocess — SIGN OFF WITH CONDITIONS (one hard one).** Human-initiated + scope-local + same predicate = acceptable trigger, but as proposed it manufactures a lying consent bar. The two doors must be sequenced into one.
- **F3 honest badge — SEND BACK (one-line fix).** `ready = graduated || (hasFormat && hasTemplate)` still lies for the most common customer path. Must be `(graduated || hasFormat) && hasTemplate`.

### Premise check
- Harrowgate mechanism confirmed at source: `docTrustGate` `trust.js:724` refuses `no-template` for any sub-100 doc regardless of graduation; `graduation.apply` (`graduationTemplate.js:220,234`) links ONLY the confirmed doc; nothing re-reads siblings. Premise holds.
- Veltrix mechanism confirmed: `classifyLearnedShape` `trust.js:268-278` all-or-nothing → `'freetext'`; role branch `trust.js:852` → `valueMatchesShape(v,'freetext')` is `false` by design (`:551`). `_codeish` (`:166-169`) rejects `$`, so `VX$22033` is the outlier and is itself refused under F1. Premise holds.
- **Premise GAP the brief missed:** `onScopeGraduated` runs only inside `if (!bulk)` (`reviewService.js:414-443`). A 5th confirm delivered by **File All Ready / the teach card's "File up to N"** graduates the scope and mints NOTHING — no template, no F2a lane, and under F3-as-proposed the badge lights "✓ files by itself" while every sub-100 doc refuses `no-template`. Chris confirmed singly so he didn't hit it; the average customer will.
- "≥5 samples" is ≥5 **DISTINCT** values: `sample_values` is a Set sliced to 20 (`learning.js:1624`). Pin wording must say distinct.

### The seam
1. **F1 ↔ 07-20 graduation prohibition.** The 07-20 rule said widening scopeTrust would be a *silent* widening because the role branch still refused. F1 changes BOTH halves in one commit, so the widening carries its verification leg. Bounded: F1 can only widen a scope whose required field is ≥75% structured; a wobbling issuer (3+ distinct names → freetext, names are never `_codeish`) still blocks graduation, so the graduation-licensed **issuer freeze** (`graduationTemplate.js:196`) and the fuzzy-geom shed are not reachable through F1. State this in the rewritten comment.
2. **F1 → F2a chain.** A scope un-bricked by F1 graduates on its next non-bulk confirm → `decide` creates → F2a lane re-reads siblings → auto-accept files them at dominant-class verification. Protected by S3-C5 (changed required read → note → held). Acceptable.
3. **F2a ↔ enrichment timing.** `_maybeGraduationTemplate` awaits landmarks/fingerprint/sample-angle (`review/handler.js:1763-1766`) — the lane must be scheduled AFTER those, not after `apply`, or the siblings re-read against an unenriched template.
4. **F2b ↔ `_reprocessOffer`.** Batch end → renderer calls `consume-reprocess-completion` immediately → offer computed over N candidates → bar "File N". F2b's pass fires 1.5 s later (`handler.js:3520`) and files those N. Bar still says "File N"; clicking it drops every doc `not-queued` (`:3922`) → "filed 0". That is the silent-revert UX class Chris reported four rounds running. Two doors from one trigger — the 08-21 (c) objection, reproduced.
5. **F2b ↔ lane marker.** If the batch's scope has a lane job queued, the pass refuses `quiet-lane-active` (`:3469`) — fine, `onJobDone` re-asks.

### Anomalies / missed cases
- Dangling-role documents: F1's role branch is also the branch NON-role fields fall into when `_rolesComplete` is false (`:762-763`). Without a precondition F1 would give the real (un-roled) ref field dominant-class verification where the NULL-ROLE GUARD intends strict refusal.
- `scopeTrust`'s corrobProbe loop (`:663-667`) calls `fieldVerifiable` too — if F1 touches only the main loop, the corroboration route and graduation disagree on the same field.
- F2a link-on-confirm: every non-bulk confirm of a template-less doc in a graduated scope returns `link` → re-schedules the lane. Bounded by coalescing (`quietLane.js:82`) and the `template_id IS NULL` candidate set; acceptable, but pin that `skip` never schedules.
- HYPOTHESIS (not measured): Stage 0 must actually MATCH the keyword-only graduation template on the siblings for them to gain `template_id`; seed fields are variable-only (`graduationTemplate.js:195`) so a "read differently" hold is unlikely, and the hold-siblings mark should not fire on a first freeze. Both are re-run gate items.

### Conditions (actionable)
**F1 (gary/reggie):**
- C1.1 ONE helper `_effectiveClass(f)` (strict cls, else `_dominantStructuredClass` when strict==='freetext'), used at all three sites: scopeTrust main loop `:693`, corrobProbe loop `:665`, docTrustGate role branch `:852`. Non-role branch `:847-851` untouched.
- C1.2 Precondition `_rolesComplete` (reuse `:762`) — dangling-role docs keep strict refusal.
- C1.3 Switch read as a SETTING with env override both directions, hoisted once per call and threadable via `opts` (the `_shadowRowSkipEnabled` idiom, `:360-367`) so `autoFileEligibleIds` stays one lookup per batch.
- C1.4 Rewrite the comment at `:302-304` to record the 08-22 paired rule; `classifyLearnedShape` itself stays byte-identical.
- Pins: brief's five, plus (a) 11 codes + `$` outlier graduates ON / not OFF (positive control); (b) 3-distinct-name issuer scope does NOT graduate ON (orthogonality); (c) dangling ref role → refused ON; (d) non-role field byte-identical ON vs OFF; (e) corrobProbe `cleanButForVolume` agrees with the main loop.

**F2a (eric/gary):**
- C2a.1 Schedule only when `res && res.templateId` (create OR link), reason `'graduated'`, `seedDocId = document_id`, placed at the END of `_maybeGraduationTemplate` after enrichment.
- C2a.2 Pin: `skip` decision → `schedule` never called; `create` → called once; `link` → called (coalesces when running).
- C2a.3 Record the bulk gap as the NEXT fix (not tonight): fire `onScopeGraduated` once per human scope at the end of a File-All batch, never for machine vias.

**F2b (eric):**
- C2b.1 HARD: one ordering. Preferred — run the scope-local pass INSIDE `consume-reprocess-completion` before the offer is built, offer = remainder. Acceptable alternative — the debounced pass prunes `_reprocessOffer.docIds` of filed ids and pushes the new count to the window. A bar that can offer already-filed docs is a refusal.
- C2b.2 Scopes computed from POST-merge document rows (supplier may have changed in the batch).
- C2b.3 Pin: batch of 14 eligible → pass files ≤SWEEP_CAP, offer shows 0 (or the remainder), accept files nothing twice.

**F3 (gary):** `ready = (graduated || hasFormat) && hasTemplate`; `graduated && !hasTemplate` is a distinct "needs a re-read/teach" state, not a countdown; W read via trust's own `_configuredWindow`, never a literal.

### Verification gate
- JS suite: 181 green / the 1 pre-existing red, zero new; Python 307 green; realdoc `RR_APP_ENV=1` OFF vs ON, M=0 and zero per-field accuracy drop.
- Chris re-run must show: **Harrowgate** — after the 5th single confirm, siblings carry `template_id`, no "read differently"/"sender changed" notes, a "N from Harrowgate filed by itself" receipt, zero wrong folders; then a File-All-delivered 5th confirm on another untaught sender → badge stays NOT ready (the recorded gap, not a lie). **Veltrix** — the 7 at 91 file with correct folder+filename; a planted `VX$…` sibling stays held with `unverifiable-value`. **Badge** — at no point does ✓ light on a scope where `isAutoFileEligible` then returns `no-template` (probe after every badge change). **Reprocess 17** — one receipt, bar offers only the remainder, "Put back" returns the page.

### REFUSED
Dropping the template requirement from `docTrustGate` for graduated scopes as the "simpler" Harrowgate fix — WRONG LAYER, the template is the layout-identity check. F2a on any confirm in a graduated scope. F2b as an independent second door. F3 as worded.

## 2026-08-22 morning — the round-7 switches' OWED CORPUS ARM (owner: "should these not be on?")
The five mig-71/72 switches (`ref_prefix_confusable_adopt`, `raw_witness_vacuous_suppress`,
`filing_sanity_page_match_v2`, `vat_reg_symbol_confusable`, `money_sign_capture`) owed the OFF==ON
realdoc arm before any default-ON flip (08-16 condition). RAN: `RR_APP_ENV=1 OCR_RENDER_DPI=200` on a
live-DB copy (93 confirmed docs), all five OFF vs all five ON — IDENTICAL tables (type/supplier/date 100%,
ref 98.9%), the same single pre-existing #188 regression in both arms: M delta 0, zero per-field drop.
HONEST CAVEAT: identical tables also mean this corpus exercised none of the five lanes (the vacuous-arm
trap) — the fired-path evidence is Chris rounds 10–13b (every lane seen firing, zero misfiles over ~170
filings). Owner decision: migration 81 force-flips the five + the paired `net_misread_total_flag` ON so a
fresh DB equals the live DB's reading configuration. Migration 80 (same morning) force-flips the
teach→file arc (sweep, auto-accept, fragment abstain, quiet re-read, role-dominant class). Both revert
per-switch via the dev-gated Settings toggles.

## 2026-08-22 — the two-line wordmark slice (P1 letterhead stack abstain + depth rule · P2 quiet-lane hash selection + ready trigger + arm (d) · P3 arm F "please confirm" release) — gary design → ORACLE
**VERDICT**

- **P1(a) vertical-stack abstain — SEND BACK (one mechanism fix, then build).** As designed it is a DEAD GUARD on the primary exhibit: `_is_name_shaped_neighbour` calls `_disqualified`, which rejects any line whose lowercase is in `title_pick.GENERIC_SINGLES` — and that set contains `"document"` (`title_pick.py:44`). So "DOCUMENT" is never name-shaped, `DOCUMENT / TIONS` still returns `'TIONS'` with the flag ON, and gary's own ON pin would be red. `JMENT / JTIONS` would fire; the real one wouldn't.
- **P1(b) address guard — REFUSED (dead guard, confirmed by fact 2). P1(b′) depth rule — SIGN OFF WITH CONDITIONS** (frame + single-token scope + census).
- **P2(c) hash selection — SIGN OFF WITH CONDITIONS, gated on a premise measurement that may turn it into DO NOTHING.** P2(d) template-carrying exception — **ACCEPTED as a method-keyed exception, with two hard conditions** (it engages the SEAM-1 sticky-binding pin for the first time in the lane, and it can silently drop a prior S3-C5 hold). P2 'ready' trigger — **SIGN OFF WITH CONDITIONS** (one readiness module, badge consumes it; bounded cost; reason-set coalescing).
- **P3 arm F — SIGN OFF WITH CONDITIONS.** Page leg REQUIRED (reuse `identity_present_on_page`, not a new predicate); confidence **95, not 85**; `+confirmed_shed` **must** join the mig-75 marker list; `FORMATS_HUMAN_ATTESTED` must include the rewrite-marker exclusion; the logo leg must be shown satisfiable on the exhibit before anyone calls this fired.

**Premise check**

- gary's P1 FACTs hold except the neighbour gate (above). `_MAX_BAND_INDEX` is a BAND index over `chrome_band.issuer_chrome_lines` (first 6 non-blank lines, truncated at a recipient marker — `chrome_band.py:50-66`); `_pick_by_height` iterates `for bl in band_lines` and keys `row_segs` by GEOMETRY row `gi` (`letterhead.py:208-224`). (b′) must be computed from `enumerate(band_lines)`, never `gi` — two frames, off by every line chrome_band dropped.
- P3 `_NAME_GENERIC_TOKENS` (`engine.py:1410-1412`) does NOT contain document/solutions, so the whole-token leg passes "DOCUMENT" — but `template_matcher._GENERIC_NAME_TOKENS` (`:159-164`) does. Two generic sets with different contents; gary's leg happens to use the right one. Pin which set (by name) the leg reads.
- P3's pixel leg: on REPROCESS the engine runs a LIVE match first and falls to `known_id` only when live returns None (`engine.py:6578-6628`). Same-supplier phash drift reaches 36 on scans (`template_matcher.py:587`). Whether the held 9 live-match by `logo*` on a re-read is UNMEASURED — if they fall to `known_id`, P3 is a dead guard on the exhibit. The parked DB exists; one `--trace` reprocess of one held doc answers it. Not optional.
- The overall after shed will NOT get the clean-doc boost gary mentions: `supported_keys` (`engine.py:9183-9186`) is computed from the local `supplier_name` — the FRAGMENT scope ("document") — before the adopt at `:9225`; the `_d4` recompute reuses it (`:9610`). So overall = mean of field confidences +0. With supplier at 85 that is ~91-92 on a three-role doc — above 90, below a graduated floor of 95. That is the real reason 85 is wrong (below).
- `docTrustGate` is method-agnostic for supplier_name on the sub-100 path (`trust.js:847-894`): `fmts.get('supplier_name')` + `valueMatchesShape` — canon ∈ samples passes. So the shed is NOT cosmetic for the gate; it is cosmetic only if overall lands under the floor.
- Premise correction for the owner: on scans the 64-bit phash has "zero separating power" cross-supplier (`template_matcher.py:872-874`). A "quick hash rescan" does not find the sender's docs; it finds docs. Its only honest role is picking which docs to spend a re-read on, and the matcher's text gates decide identity. Say this in the card copy.

**The seam**

1. **P2(d) × SEAM-1 pin (`engine.py:6585-6592`).** The 08-21 lane was signed on "template-less docs only", which kept the `known_id` re-imposition path OUT of the lane. (d) re-reads template-carrying docs for the first time: a live-match miss → `known_id` → `template_fixed`@95 (if the page names it) → sweep files with no glance. The pin's test greens because no new `_maybeAutoFile` call site exists — the dead-guard-greens class. Condition: (d) only while `TEMPLATE_IDENTITY_ON_PAGE` is ON (the sticky binding is declined when the page doesn't name the identity, `:6618`), and the pin comment is rewritten to name the lane's (d) arm as the vetted second door.
2. **P2(d) × S3-C5 hold loss.** `_holdChangedReads` writes its note onto the STORED row after `applyResult` (`quietLane.js:224-232`). A second pass replaces rows wholesale and compares `nd.existing` (now "DOCUMENT SOLUTIONS") with the new read (same) → no hold → the "was 'Patrick'" checkpoint silently disappears and the sweep files. (d) selects exactly that class. Condition: (d) excludes any doc whose required-field rows carry the S3-C5 note marker (or the pass re-attaches it); pin with a positive control.
3. **'ready' × F2a.** `schedule` coalesces by scope key (`quietLane.js:80-91`); 'ready' fires synchronously at `reviewService.js:525`, 'graduated' later after enrichment, so they coalesce — but `reason` is whichever arrived first, and (d) keys on `reason==='ready'`. A 'ready' coalesced into a running 'graduated' job reruns as 'graduated' and skips (d). Condition: `job.reasons` is a Set; (d) keys on `reasons.has('ready')`.
4. **P3 × rewrite-marker exclusion (mig 75).** A human who rubber-stamps a shed doc (File All, or Confirm in Review) writes no corrections row, so the `+confirmed_shed` row would count toward the very bucket that licensed the shed — the B7 loop verbatim, on the human channel (`learning.js:1527-1534`). `identity_variant_adopt` rows today at least carried a "please confirm" note that made the human look; the shed removes that. Condition: `+confirmed_shed` joins the flag-gated list (unanchored `%+confirmed\_shed%`, corrections row re-admits), AND `FORMATS_HUMAN_ATTESTED` = exclusion ∧ via column ∧ gate-unify ∧ `learning_exclude_rewrite_markers` — that is the 08-20 invariant verbatim ("neither may see rewrite-created rows"). P3 therefore cannot arm until the owner flips mig 75; its censuses are green, so that is a decision, not a blocker.
5. **P1 × logo-text gate witness.** `pick_issuer_geometry` is the name-presence accept witness. On the exhibit class the witness went from wrong-name (no accept) to None (no accept) — no change. On a correct single-token issuer at band index 3-5 a (b′) abstain loses an accept → fail toward review. Covered by realdoc `RR_APP_ENV=1` zero issuer drop, not by the census alone.

**Anomalies / missed cases**

- **P1(a) fix:** the vertical-neighbour gate must be `_is_name_shaped_neighbour(seg)` OR (seg is ONE alpha token whose lower is in `template_matcher._GENERIC_NAME_TOKENS` and not in `excluded`). A bare generic company word at letterhead size on its own line IS the stacked-wordmark signature (DOCUMENT / SOLUTIONS / SERVICES / LTD). Keep gary's other legs (adjacent geometry row, in band, exactly one segment, paired, ratio ≥ `_GEOM_MIN_RATIO`). Pins then become live: `DOCUMENT / TIONS → None`, `JMENT / JTIONS → None`, `ACME / Ltd → None`, `Superstore / INVOICE → 'Superstore'`, `Superstore / Statement` (statement ∈ GENERIC_SINGLES, ∉ `_GENERIC_NAME_TOKENS`) → `'Superstore'`.
- **P1(b′):** single-token winners only; `bi > _MAX_BAND_INDEX` → not a candidate at scoring time; positive control = the same token at `bi ≤ 2` still picks; negative = `Patrick` at `bi=5` → None, OFF → `'Patrick'`.
- **P3 negative control is VACUOUS as written** if the 8 Reprocess-filed docs carry a human via: de-confirming one of the 3 leaves 2+8 ≥ 3 and the shed still fires. The control must leave < 3 HUMAN confirms of canon (check `confirmed_via` first) — and add the positive control that pins "never `dominant_supplier_count`": 8 machine-filed + 2 human → 0 sheds.
- **P2(c) population:** on a fresh install most held pre-teach docs are unnamed AND untyped, so "unnamed-or-same-scope, same-type-or-untyped" barely bounds the set. If the ≤6 set covers most of the pile, (c) is a full re-read wearing a selector's badge.

**OCR / geometry & office-doc reality**

The stacked wordmark is the common 2-line logotype (word over word); `reconstruct_page_text` emits each as its own row, so the geometry arm sees two single-token rows, the first a generic word. Treating a generic company word as a stack neighbour is how a human reads it. The depth rule matches how letterheads are laid out (issuer in the top three lines; names deeper in the band are contacts/recipients). Hash selection: same-sender drift up to 36 vs cross-sender MIN 2 on scans — the hash is the weakest signal in the building for THIS job; don't let the card copy sell it as a finder.

**Customer-experience & fail-safe**

P1 trades a wrong prefill for an empty issuer (already the owner's accepted policy). P3 removes a human checkpoint; that is licensed only because every leg is stronger than the `template_fixed`@95 path that files siblings today (page names it + logo-matched layout + canon == template identity + ≥3 human confirms at ≥0.9 share + whole-token fragment). With the page leg, "the re-read agreed" is NOT the corroboration — the page, the layout and three humans are. The (d)/S3-C5 hole (seam 2) would have been a silent wrong-file class; it is the one thing here that would have gone out without a reason attached.

**Conditions / verification gate**

P1 (gary/007):
- C1.1 Replace the neighbour gate as above; name it `_is_stack_neighbour`; (a) and (b′) each under its own env + setting beside `handler.js:631`.
- C1.2 (b′) band-index frame, single-token only; pins as listed, plus the existing 15 in `test_letterhead_fragment_abstain.py` unchanged.
- GATE: `s0_census.py` OFF vs ON — 0 correct lost, 0 new wrong, and report the band-index distribution of the 115 correct picks; realdoc `RR_APP_ENV=1` M=0 + zero Document-Issuer drop (NOT vacuous); `s0_probe.py` over the 22 PDFs — no `TIONS`, no `Patrick`, no re-join.

P2 (eric/gary):
- C2.1 PREMISE FIRST: on `%APPDATA%\ScanFinder_docsol_run1_*`, read the `quiet_reprocess_job` audit row for the 'teach' job. If the 8 were IN `done_ids`, selection was not the gap and (c) is DO NOTHING — the gap is post-read (report what held them). If absent, report WHY `findSiblings` missed them (empty fingerprint / ratio < bar / named "Patrick"); build (c) only if the hash set contains them and (a)∪(b) does not.
- C2.2 (c) selectivity gate on the 410-doc sandbox: per taught template, the ≤6 set must be < 50% of the eligible unnamed/untyped pile, else reframe as "re-read every template-less held doc" and bring that back as its own decision. `LOGO_ACCEPT_DIST` named + pinned both sides; boundary negative control at 7; identity never assigned from a hash.
- C2.3 (d): `TEMPLATE_IDENTITY_ON_PAGE` ON as precondition; exclude S3-C5-noted docs (seam 2); candidate `template_id` ∈ the scope's template set and supplier display_value == scope canon; SEAM-1 pin comment rewritten; `reasons` Set (seam 3).
- C2.4 'ready': ONE `scopeReadiness.isReady` (role-complete, `&& hasTemplate`), consumed by `get-scope-readiness` in the same commit (two readiness notions is the forbidden class; F3's formula stands with `hasFormat` redefined). Bound the cost: no per-confirm double `getFieldFormats` in bulk — once per scope per batch (start/end), and measure File-All-200 wall time delta < 10%. Pins: 3rd fires once, 2nd/4th don't, `via:'scope_sweep'` never, bulk 3rd fires, supplier-only-solid → not ready.

P3 (gary):
- C3.1 Add the page leg: `template_matcher.identity_present_on_page(canon, page)` — the fixed stamp's own test, already threaded as `page`. Negative control: SOLUTIONS stripped from the text → held.
- C3.2 Confidence 95 (parity with the stamp whose evidence this strictly exceeds); 85 parks every graduated-scope doc at 91-92 < 95 — a cosmetic shed on the mature sandbox. Engine pin with `CORROB_NOTE_RECOMPUTE_FC=1`: overall ≥ 95 on a three-role doc; document that `supported_keys` is fragment-scoped (no boost) in the test.
- C3.3 `+confirmed_shed` into the mig-75 list; `machineExclusionArmed` = exclusion ∧ via ∧ unify ∧ rewrite-markers, shared by `getFieldFormats`, the auto-accept precondition (`handler.js:3425`) and the bridge; grep-pin all three.
- C3.4 Logo leg stays as gary wrote it (`keywords*`/`known_id`/`pinned_id` refused) — do NOT widen to keywords without a band-scoped page leg. Fired-path on the parked DB must show `match.method` startswith `logo` on all 9; if it doesn't, P3 returns here, it is not loosened in the build.
- C3.5 Negative control with < 3 human confirms (see anomalies); positive control for the count source; realdoc OFF vs ON M=0 expected VACUOUS — say so in the log.

Chris round 14 (fresh DB, arc + P1/P2/P3 ON, mig 75 flipped, `corrob_note_recompute_fc` ON): (1) 22 worksheets cold — zero `TIONS`/`Patrick`, stacked docs arrive empty-issuer; (2) teach 1 → one 'teach' job whose `done_ids` cover the previously "not identified" set, wrong-folder 0, every "Read differently" hold listed with before-values; (3) confirm 3 → exactly one 'ready' job, the variant-adopt docs shed (`+confirmed_shed`, 95, overall ≥ 95), scope-local auto-accept files them with one receipt, Put back restores all; (4) planted: (i) a 2-human-confirm sender with the same note class stays held; (ii) a sibling with SOLUTIONS illegible stays held (page leg); (iii) a stranger's unnamed doc containing "document" and "solutions" in its body with a colliding hash does NOT file under DOCUMENT SOLUTIONS; (iv) a doc the first pass prefilled wrongly, re-read twice (teach then ready) — its "was 'X'" hold SURVIVES the second pass; (v) a confirmed shed doc does not raise the scope's human count (query `getFieldFormats`, never raw rows).

**REFUSED:** P1(b) as briefed (dead on the real band); any re-join in the assert path; (c) assigning identity or exempting `letterhead_prefill` from S3-C5; (d) on any reason but 'ready' or with the on-page guard off; P3 at 85, P3 without the page leg, P3 reading `dominant_supplier_count` or `machine_value_counts` or note prose, a stored-row JS twin, and any widening of the pixel leg to text-family matches.

Files checked: `C:\GIT Projects\Docusnap\python_backend\extraction\letterhead.py`, `C:\GIT Projects\Docusnap\python_backend\extraction\title_pick.py`, `C:\GIT Projects\Docusnap\python_backend\extraction\template_matcher.py`, `C:\GIT Projects\Docusnap\python_backend\extraction\engine.py`, `C:\GIT Projects\Docusnap\python_backend\extraction\validator.py`, `C:\GIT Projects\Docusnap\python_backend\extraction\chrome_band.py`, `C:\GIT Projects\Docusnap\src\modules\processing\quietLane.js`, `C:\GIT Projects\Docusnap\src\modules\review\handler.js`, `C:\GIT Projects\Docusnap\src\services\reviewService.js`, `C:\GIT Projects\Docusnap\database\modules\learning.js`, `C:\GIT Projects\Docusnap\database\modules\trust.js`, `C:\GIT Projects\Docusnap\database\modules\templates.js`, `C:\GIT Projects\Docusnap\database\modules\supplierSiblings.js`, `C:\GIT Projects\Docusnap\docs\oracle_log.md`.
**BUILD + GATES (same afternoon), per the re-rule:** P1(a)+(b′) built `letterhead.py` (`_is_stack_neighbour`,
the generic-word fix; depth guard in the BAND frame, single-token only) — pins `test_letterhead_stack_abstain.py`
(20). CENSUS OFF vs ON (200 IMPORT fixtures, real OCR, engine type phrases): 115 correct unchanged · **0 correct
lost · 0 new wrong** · 2 wrong→None (the `ITH-0093` reference-as-sender, Chris card 8) · 3 None→CORRECT
('Pelican Office Interiors' — the depth guard removed a deep single-word competitor that had tripped the
lead-abstain). Fired-path on the owner's 22 scans: no `TIONS`, no `Patrick` (doc 10 still yields the two-token
garble 'ROCUMENT OLUTIONS' — held for review by design, outside every rule). **P4 built** (`engine.py`
`_fragment_agreement_keeps_seed`, branch `fragment_agreement`, structural band leg = contiguous run of
issuer-column tokens == the fixed value, read = a proper contiguous sub-run) — pins
`test_fixed_seed_fragment_keep.py` (15 incl. every Oracle control); FIRED-PATH on the parked run-1 copy: held
docs 1 + 13 re-read → `Stage 0.5: kept curated supplier 'DOCUMENT SOLUTIONS' — declined mapping read
'DOCUMENT' (fragment_agreement)` → `template_fixed`@95, no note, overall 100, `isAutoFileEligible` = ok; OFF
control = the note returns. REALDOC OFF vs ON (P1+P4 on a live-DB copy): identical tables, supplier 100% both
arms, same single pre-existing #188. **P2 built**: `database/modules/scopeReadiness.js` = THE readiness
predicate (role-complete solid groups ∥ graduated, AND a template), consumed by `get-scope-readiness` and the
lane; (c′) keyword-fingerprint selection in `quietLane._candidates` at the exported `KEYWORD_THRESHOLD`
(bounds: template-less, same type/untyped, unnamed ∥ own name ∥ `letterhead_prefill`); the 'ready' crossing
(`readyProbe` memoised 10 s per scope, `scheduleReadyReread` fires once when !before && after, machine vias
never) — pins in `test_quiet_lane.js` (A2 + §B4b + contract: 3rd confirm fires once, 2nd/4th don't,
scope_sweep never, supplier-only-solid not ready). P3 DEFERRED, (d) dropped, hash DO NOTHING — as ruled.
Migration 82 defaults the five switches ON (owner's standing decision). Suites: JS 184 green / 1 pre-existing
red; Python 307 green / 1 + 6 pre-existing.

## 2026-08-22 afternoon — Chris round 14 vet queue (Q1 only-copy safety · Q2 teach-time widening · Q3 layout-write re-read · Q4a issuer-as-type · Q4b Home ready count · Q4c stale bars · Q4d sent-back count) — gary design → ORACLE

**Premise facts (traced):** filing MOVES the original: import drains it into `<source>/Processed` (`processing/handler.js:5011-5019` → `drainOriginalToFolder`, `folder_path` rewritten); confirm copies the working copy into Output (`filing/handler.js:205-218`) and `reviewService.confirm:410` schedules `removeSourceFile` on `srcPath` = the Processed original. Only `_autoFileDoc` (import threshold door) skips the removal. Put back keeps `stored_path`; `_purgeOne` unlinks working+stored → the filed copy was the only copy. Owner's run-1 "lost scans" reconciled the same way: all 11 filed PDFs exist in Output (birth 12:08–12:12), 11 held originals in `Processed\Processed` — nothing lost. Four copy lines are false (wizard :151/:153, help/settings :59, Settings :465).

**VERDICTS**
- **Q1 (a′) keep the drained original — SIGN OFF WITH CONDITIONS.** C1.1 ONE gate in `reviewService.confirm` (`getById` carries `drained_at`), no second check at the /v1 callback; pin both doors drained/undrained × ON/OFF. C1.2 under ON: not drained → try `drainOriginalToFolder` at confirm (stamp), never unlink. C1.3 mig 83 adds `documents.drained_at` AND backfills it where `folder_path` basename is `Processed` or equals `processed_folder` (one-time; never consulted at runtime). C1.4 force-flip `keep_processed_originals='true'` for ALL installs (UPSERT) with a Files & filing toggle stating the disk cost. C1.5 fix all four copy lines in BOTH states; bin dialog sentence only when ON. C1.6 seam: extend the `:2088` import refusal to any folder that is the `folder_path` of ≥1 CONFIRMED doc (DB-driven, "import anyway" override) — next commit, before the Chris round. C1.7 pins: `_purgeOne` leaves `folder_path/original_filename`; re-confirm of a put-back doc never touches the Processed original. REFUSED: refuse-to-purge; a `Deleted` folder under Output.
- **Q2 arm (e) folder-key widening — SEND BACK.** `folder_path` is not a batch key (every import from one intake / the watch folder drains to the same Processed dir → the whole held pile, the 08-22 C2.2 class). Premise unmeasured: `findSiblings` is the finder the ripple used minutes later (found 14/19); (c′) keys on a ONE-sample `keyword_fingerprint` that `stabiliseFingerprint` (`templates.js:1019-1026`) only prunes on later confirms — HYPOTHESIS: per-document noise in the seed fingerprint explains 0-at-teach, 20/21-at-ready AND the ripple's 2/14 layout reads. MEASURE on `r14_copy.db`: teach-job audit row; one-sample vs current fingerprint hit rate over the 21 at 0.75; `findSiblings` count from the taught seed. Probable fix = WRONG LAYER → promote-time fingerprint hygiene (strip every token appearing in any TAUGHT VARIABLE value, `review/handler.js:1408-1417` class), own switch + census. REFUSED: folder_path as a key; "N waiting" from any set the re-read cannot identify.
- **Q3 layout-write trigger — SIGN OFF WITH CONDITIONS** (a legitimate second reason: template-carrying reads are stale by definition after a layout write; the manual "Reprocess N" population + manifest, press removed). C3.1 all P2(d) conditions stand (on_page ON at start; exclude "Read differently after learning" rows with the positive control; template ∈ scope AND supplier == scope; SEAM-1 comment rewritten; `reasons` Set). C3.2 NEW skip the arm when `_name_arm_tokens(scope)` is empty (all-generic name → `_identity_refuses` abstains by construction; DOCUMENT SOLUTIONS is exactly that). C3.3 NEW a REQUIRED role field EMPTY→VALUED in a 'layout' job is HELD with a note unless `corroboration.independent_agree` across ≥2 page families (the expected misfile: a drifted ⊕ box first-fills an empty ref with a same-shape neighbour code). C3.4 `schedule` on a running job unions `reasons`; rerun recomputes with the union. C3.5 trigger only on an authoritative anchor/mapping WRITE that changed something, scoped to its (supplier,type); a plain confirm never. C3.6 pin valued→EMPTY merges (held missing-required) with a comment why the old value must NOT be restored. C3.7 own Chris round, after the Q2 replacement; realdoc M=0 (vacuous — say so).
- **Q4a — SIGN OFF WITH CONDITIONS, SPLIT.** The harvest iterates `lines[1:12]` — on 17/22 DS scans "SERVICE WORKSHEET" IS line 0 (title above the wordmark) so the positional skip is the defect; gary's `issuer_chrome_lines` exclude set is a DEAD GUARD (first six lines verbatim → kills every top-band title incl. his own control). C4a.1 two switches: `TYPE_NUDGE_ISSUER_EXCLUDE` (subtractive: issuer-READ equality/containment + EVERY-word generic; default ON) and `TYPE_NUDGE_L0` (additive; default OFF until census). C4a.2 exclude set = the issuer read value only. C4a.3 L0 admissible only when the issuer read is non-empty and line 0 is not it. C4a.4 census over the 200 IMPORT fixtures + 22 scans per arm: subtractive 0 correct lost; L0 0 new wrong. C4a.5 renderer hides/re-renders the card on type change, no switch.
- **Q4b — SIGN OFF WITH CONDITIONS.** ONE pure classifier (`flagged|noType|missing|ready`, ack-exempt included) used by `getReviewSplit` AND `fileAllReady` in the same commit; dashboard "N senders file by themselves" via `scopeReadiness.isReady` with one `getFieldFormats` + memo; Home paint delta <10% on the 410-doc sandbox.
- **Q4c — SIGN OFF.** `auto-accept-running` clears the OFFER and leaves the receipt to `scope-auto-filed`; no "Put back" under 0 filed (pin).
- **Q4d — SIGN OFF (verify-only confirmed):** a sent-back doc counts nowhere; the "4 more" was a stale render — add `refreshScopeReadiness()` to `_refreshQueueFromBroadcast`; pin.

**ORDER:** Q1 → Q4b → Q4c+Q4d → Q4a(subtractive) → Q2 measurement (→ fingerprint slice, BEFORE Q3) → Q4a(L0 after census) → Q3 (dark, own Chris round).

**BUILD + GATES (same afternoon):** Q1 built (`00e0cc3`: mig 83 `drained_at` + backfill + `keep_processed_originals` UPSERT ON; the one gate in `reviewService.confirm`; drain-at-confirm; C1.6 import refusal with override; four copy lines + Files & filing toggle + purge-dialog suffix; pins `test_keep_processed_originals.js` 40/40). Q4b + Q4c + Q4d built (`98ef004`: `shared/reviewReadiness.js` THE classifier behind `getReviewSplit` + File All; Home "N senders file by themselves" = `scopeReadiness.isReady` memoised; `shared/offerPrune.js`; badge refresh on broadcast; pins `test_review_readiness.js` 27/27, `test_offer_prune.js` 19/19). Q4a built: `_harvest_top_band_heading(lines, installed, exclude_texts)` — subtractive arm (issuer-READ token subset/superset with a garble-tolerant token match ≥5 chars ratio ≥0.8, + every-word generic; `TYPE_NUDGE_ISSUER_EXCLUDE` default ON) and the L0 arm (`TYPE_NUDGE_L0`: line 0 admissible only with a non-empty issuer read that line 0 is not); the Review card follows a type choice. **CENSUS (C4a.4) over the r14 sandbox, 221 docs with ocr_text, NO installed types (worst case), the doc's own issuer read as exclude:** OFF offered 48 (3 correct / 45 wrong: 'Service'×20, 'Document'×18, 'Document Olutions', 'Solutions', junk caps 'Poo'/'Ment'/'Sss'/'Print') → subtractive ON offered 8 (3 correct / 5 wrong) = **0 correct lost, 40 wrong removed** → + L0 offered 23 (**19 correct / 4 wrong = +16 correct, 0 new wrong**). Both gates passed → **L0 default ON** (`=0` reverts). Residual wrong offers are pre-existing junk-caps tokens ('Poo', 'Sss') and the partial 'Print' on the Print-Tracker. Realdoc type-detection gate vacuous by construction (the harvest runs only after `doc_type_result is None`). Python 307 + the documented 1 + 6 pre-existing script reds, zero new; JS suite 230 green / 4 red (`test_authoritative_anchor` documented; `test_v1_contract` 3 BAD + `test_doctype_surface_parity` 1 verified red at HEAD `2d25e87` BEFORE this session's edits; `test_ref_class_fix` transient under load, green standalone).

## 2026-08-22 — Q2 RE-RULE on the measurement (one-sample fingerprint dilution) — ORACLE SIGN OFF WITH CONDITIONS
**Measured (r14_copy.db):** the taught doc's own fingerprint (the seed the promote froze) = `["SERVICE","WORKSHEET","Lol","DOCUMENT","OLUTIONS","ILa","Ticket","Location","Work","Address"]` — three OCR-garble tokens with df=0 over the 21 siblings → every sibling scores EXACTLY 0.70 (7/10) < 0.75 → 0 selected at teach (audit #42 done=0); the template's current 5-token intersection → 21/22 (audit #124 'ready' done=17). `findSiblings` from the garbled seed → 0. **Census (`TESTING/_measure/q2_seed_hygiene_census.js`, 220 docs / 11 suppliers, every doc as a one-sample seed, at 0.75):** RAW recall 98.9% · cross 6.98% — VARSTRIP (C2.2's rule) identical, changes nothing — **SUPPORT (drop df=0 tokens) recall 100% · cross unchanged**; exhibit seed → 7 tokens → 20/20. The 6.98% cross = the `quillstone-print→*` buyer-issued class (Quillstone is the BUYER named on every doc), pre-existing, identical across variants.
**Verdict:** SUPPORT replaces VARSTRIP (C2.2 withdrawn — the noise is OCR garble, already-shipped hygiene covers taught variables). The half-cap is NOT the safety: a 10-token seed with one brand token prunes 1/10 under any cap. **C1** prune the value handed to `templates.create` (after the customer strip, after the reuse arms), never a post-hoc UPDATE, never inside `findByKeywordFingerprint`; `documents.keyword_fingerprint` stays raw. **C2** guards: **G1 issuer-protect** (never prune a token that token-matches the confirmed issuer — hygiene condition E's mirror) + **G2 reward licence** (prune only when the pruned fingerprint recovers ≥2 held template-less same-type-or-untyped docs the raw seed did not reach at 0.75, none carrying a non-prefill supplier claim name-disjoint from the issuer); FLOOR kept; half-cap only all-or-nothing. **C3** df via `EXISTS … LIKE` per token, regex-confirmed on LIKE hits; G2 scan restricted to the lane's pool. **C4** `fingerprint_seed_support_prune` + env `FINGERPRINT_SEED_SUPPORT`, default OFF, byte-identical OFF. **C5** one helper, TWO birth paths (`_upsertTemplate` CREATE + `graduationTemplate.apply`). **C6** pins i–ix (exhibit; no-other-docs raw; issuer-protect; reward negative control; contradiction; half-cap; OFF; both paths; the never-re-admit trade-off). **C7** census re-run under G1+G2 OFF vs ON + a G2-refusal column; realdoc vacuous by construction (say so). **C8** Chris 15 teaches from the worst DS scan (typed AND drawn): teach-job done_ids non-empty, siblings carry the template, zero wrong folder, AND the re-read VALUES scored — the first real execution of Slice 3 on a first teach. **C9** default ON for NEW installs only (INSERT OR IGNORE) after C7+C8; never UPSERT existing installs. Misfile path named (same-estate cold doc bound to a brand-stripped drawn-box template → wrong-position reads at template confidence, held at floor 100, not silent) — closed by G1+G2. Known limitation: a DUPLICATE import makes garble df=1 (recall miss, not a hole). Pre-existing, not Q2's: the steady-state DS fingerprint is all-generic (`_name_arm_tokens` abstains) — the rarity-weighting TODO.
**BUILD + GATES (Q2, same evening):** `templates.pruneSeedFingerprint` (G1 issuer-protect · G2 reward licence ≥2 recovered held same-type-or-untyped docs, no name-disjoint non-prefill claim, **plus same-LAYOUT evidence — a recovered doc must carry ≥0.6 of the pruned tokens in its OWN top-band `keyword_fingerprint`** · floor · all-or-nothing half-cap), called from BOTH birth paths (`_upsertTemplate` CREATE → the value handed to `create()`; `graduationTemplate.apply`); switch `fingerprint_seed_support_prune` / env `FINGERPRINT_SEED_SUPPORT`, DARK (dev-gated Settings toggle). **The first final-rule census CAUGHT the named misfile path:** without the same-layout leg three BUYER-issued seeds (Bramblewood letterhead = the address block every supplier prints as the recipient) were licensed by 60 other suppliers' cold documents and their cross hits went 20 → 179 each (6.98% → 8.06%). With the leg (`q2_seed_prune_final_census.js`, 220 docs, cold-reset copy): **OFF recall 98.9% / cross 6.98% → ON recall 100% / cross 6.98% (unchanged)**; outcomes per seed: pruned 6 (all DS garble seeds), all-supported 116, unlicensed 78 (incl. the 3 buyer-issued), too-short 20; exhibit doc 10 → 7 tokens, recovered 20. Pins `database/modules/test_seed_support_prune.js` (i–ix + the end-to-end 0/6 → 6/6 keyword-arm binding + §v-b the buyer-issued body-mention refusal with its same-layout positive control). Realdoc vacuous by construction (the corpus harness never runs the confirm-time create). C8 (Chris 15 from the worst scan, values scored) and C9 (new-install flip) pending.
**BUILD + GATES (Q3, same evening, branch `feat/q3-layout-reread` → merged after Chris 15):** `quietLane.js` — `job.reasons` Set (C3.1/C3.4: a write landing mid-run unions and the rerun recomputes with the union, pinned); the LAYOUT arm in `_candidates`: preconditions at start (`quiet_reread_on_layout` / `QUIET_REREAD_ON_LAYOUT` · `template_identity_on_page==='true'` · ≥2 name-arm tokens, the JS mirror of `_name_arm_tokens` pinned equal to `_GENERIC_NAME_TOKENS` by reading the .py) each audited as `layout_arm: skipped:<why>`; population = held docs carrying one of the scope's OWNED templates (frozen supplier = scope, or the sample doc is the scope's — `scopeTemplateIds` alone admitted a scope-named doc mis-bound to another sender's layout) AND the scope's name, minus S3-C5-noted docs (positive control pinned); C3.3 `_holdFirstFills` — a REQUIRED role field EMPTY→VALUED in a 'layout' job is held with "Read from your new box — confirm once." unless `trust._corrobLicensed(record)` (positive control pinned); C3.6 valued→EMPTY merges as empty, old value NOT restored (pinned + comment). Triggers (C3.5): `save-field-anchor` on an AUTHORITATIVE write whose snapshot changed; `save-template-mapping` on a changed mapping (scope = the template's frozen supplier ∥ sample doc); a plain confirm never. SEAM-1 engine comment rewritten (names the vetted doors; the "exactly one call site" claim withdrawn). Pins `test_quiet_lane_layout.js` (38). Realdoc `RR_APP_ENV=1` OFF vs ON M=0 is VACUOUS by construction (the harness never writes an anchor/mapping) — stated, not run. Own Chris round owed (C3.7) after Chris 15.
**CHRIS 15 (same evening; verbatim in `docs/CHRIS_FULL_APP_REVIEW_2026-08-22.md`):** YES — 57 filed, zero wrong folder/value. C8 met: the teach from the worst scan → `fingerprint_seed_pruned kept 7 recovered 20` → teach job `done=19` (round 14: 0), 18/19 right values (the app right where the owner's filenames were wrong), drawn-box control 19/19. C1 closed (Q1 truth-table all TRUE). Q4a/b/c/d FIXED. **New top card diagnosed:** the Q2-enabled teach-time re-read binds siblings BEFORE any confirm → overall 91–93 under the ungraduated floor 100; the 'ready' arm is template-less-only so nothing re-reads them → the badge says "files by itself" and the pile waits for File All (Saltmarsh's GRADUATION re-read → oc100 → filed). Owner/Oracle item: a READY-crossing re-read of TEMPLATE-CARRYING docs whose oc < floor (the Q3 boundary, same guards) — not built. **Card 2 root-caused + fixed `8c0f26b`:** `learnTemplateOnCommit` intersections never reached the template FILE the matcher reads (DB 5 tokens / file 7 → header-cut copies 0.71); both callers now rewrite the file (`TEMPLATE_FILE_SYNC_ON_COMMIT=0`); plus `templatesDir` isolation for `DOCUSNAP_USERDATA` sandboxes (rounds ≤15 shared the repo dev `templates/` with the owner's app — contamination caveat). Q3 merged `92b60b7` after the round; JS 236 green / 3 pre-existing red.
**CHRIS 16 (Q3's own round, C3.7 — verbatim in the review doc):** YES — the ⊕ fix re-read 17 Pelican siblings by itself at 9 s (`layout_arm: selected:18`), ALL THREE wrong first-fills HELD incl. the neighbour-column "Your PO" value (the named misfile path, closed by C3.3), the S3-C5-noted doc left alone, the generic-named DS scope skipped (C3.2), Ridgeway ⊕ withdrew six false alarms; 34 filed / 0 wrong folders. **Defect found + fixed (`5709a15`):** the C3.3 hold keyed on the JOB's reasons and the wizard's mapping saves coalesce 'layout' into the teach job → the teach-time first-fills were held too (DS: 19 held, 0 ready). Now keyed on the doc's selecting arm (`nd.via === 'layout'`), pinned. OPEN: the wizard accepts a box that reads the field's own label; "High" beside a held first-fill; the header-cut re-import (the pruned seed keeps SERVICE/WORKSHEET legitimately → 5/7; to be traced); round-15 card 1 (READY-crossing re-read of template-carrying docs) unchanged.

## 2026-08-22 evening — THE GARBLED-ISSUER ARC (a one-line box over a stacked wordmark reads `NOCUMENT`) — gary design → ORACLE
**The incident (owner's fresh install, traced in `Debug/diagnostic_2026-08-22T18-02-04-439Z.jsonl` + live DB):** 22 DOCUMENT SOLUTIONS worksheets, one teach (wizard boxes), a few confirms → the Review list shows a sender group "NOCUMENT · 2 documents" beside "DOCUMENT SOLUTIONS · 11". All 21 template-matched docs were seeded `template_fixed` "DOCUMENT SOLUTIONS" @95; the drawn ONE-LINE issuer box over the stacked "DOCUMENT"/"SOLUTIONS" wordmark read `DOCUMENT`/`SOLUTIONS` on 13 (P4 kept the seed), `NOCUMENT` @78 on docs 12/14 (no decline branch: P4 needs exact tokens, near-match/garble compare the WHOLE string, region-presence can't see line 2 → the garble won on authority; identity_fusion flag-only @70), the IDENTICAL `NOCUMENT` @73 on doc 16 (lost only via the <75 weak rule — a coin flip), `DOCUMENT` on docs 4/10 with P4's band leg failed (a handwriting noise line / an in-band garble → variant-adopt @70 + note, right name). SECOND defect: Stage-4.5 WEAK name repair wrote `corrected_to='DOCUMENT'` (a TOKEN repair) before the identity block → the row rendered `Use “DOCUMENT”` + `✓ Issuer is correct` beside a note naming "DOCUMENT SOLUTIONS" — two garble-minting buttons. Owner: "I don't want ANY garble in the review list for supplier names; the name is literally sitting there."
**VERDICTS.** **Slice 1 garble-tolerant fragment keep — SIGN OFF W/COND** C1.1 per-token `_tok_agrees` (READ side only; <6-char tokens exact, ≥6 one edit — the C2 rule in `_identity_geom_fuzzy_match`), band leg + `_name_tokens` untouched; C1.2 SISTER EXCLUSION: a fuzzed token must not exactly equal a token of any OTHER template's identity; C1.3 pins a–g incl. the trade-off pin ("Nocument" alone + a band that prints the full stack keeps the seed — the named, accepted exposure); C1.4 census: newly-kept where a CONFIRMED supplier ≠ fixed value = 0; C1.5 fired path on the parked copy for docs 12/14. **Slice 1b band tolerance — DO NOTHING** (docs 4/10 already land on the right name; a fuzzy band licenses a sister company "DOCUMENT SOLUTION" — the exact band leg is the protection). **Slice 2 suggestion=canonical — SEND BACK → rebuilt:** NOT `corrected_to` (the 08-19 badge trap, and the accept-btn only sets the input); carry the canonical in the persisted `suggested_supplier` (the branding-resolve button: fill + per-doc pin + sibling ripple) and CLEAR `corrected_to`; C2.1 garble-kind gate = `_identity_geom_fuzzy_match(resolved, text_led)` — a whole-token disagreement (buyer-issued PO) is NOT garble-kind → byte-identical, so the ripple can never spread the wrong company; C2.2 adopt path clears corrected_to; C2.3 `isBrandingFlag` admits "letterhead may read", the issuer-accept label NAMES the value ("✓ Keep “NOCUMENT” as the issuer"); C2.4 trust pin: note + corrected_to null → still 'flagged'; C2.5 `_is_degraded_variant` NOT widened. **Slice 3 grouping — SIGN OFF W/COND** C3.1 ONE `reviewGroupKey(doc)` at both grouping sites + `_pickNextDoc` + the confirm/defer advance; C3.2 `getReviewQueue.issuer_suggested` only while the row's note stands (a shed note ungroups); C3.3 CONFIRM-TIME HOLD (value ≠ suggestion while the note stands → the ISSUER_NEAR_MATCH inline Use/Keep, source 'letterhead'); C3.4 pins incl. the Home `_selfFilingSenders` positive control. Q3 ruling: group under the suggestion ONLY for the garble kind. Q4: slice 1 new-install default via INSERT OR IGNORE after census + a Chris round; slices 2+3 may UPSERT once pins are green. The owner's principle ("box says WHERE, seed says WHAT") is sound as the invariant; as a replacement it must be THREE-way (keep / displace on a clean plausibly-different name / HOLD) — own arc, own census, after these measure.
**BUILD + GATES (same evening, ALL DARK):** slice 1 `engine.py` `_FIXED_SEED_FRAGMENT_GARBLE_ON` / `_fragment_tokens_agree` / `_other_identity_tokens` / `_is_exact_token_subrun` (branch `fragment_agreement_garble`), env `TEMPLATE_FIXED_SEED_FRAGMENT_GARBLE`, setting `template_fixed_seed_fragment_garble`; slice 2 `ExtractionEngine._suggest_identity_canonical` + `_identity_garble_of`, env `IDENTITY_SUGGEST_CANONICAL`, setting `identity_suggest_canonical`, renderer regex + label; slice 3 `documents.getReviewQueue.issuer_suggested`, renderer `reviewGroupKey`/`reviewGroupChip` + the hold copy, `reviewService.confirm` letterhead hold (`confirm_held_letterhead_suggestion`), setting `review_group_by_letterhead`. Dev-gated Settings toggles for all three. Pins: `tests/test_fixed_seed_fragment_keep.py` (+18), `tests/test_identity_variant.py` (+12), `src/windows/review/test_letterhead_note_contract.js` (+7), `database/modules/test_scope_trust.js` (+1), `src/services/test_reviewservice.js` (+8), NEW `database/modules/test_review_queue_issuer_suggested.js` (18). **C1.4 census (`TESTING/_measure/fragment_garble_census.py`, six DBs, 4,000+ docs):** adversarial arm = 16,809 (confirmed doc × OTHER template fixed name) pairs → **0 keeps OFF, 0 ON**; newly-kept = exactly the two exhibit docs (owner DB); every other population unchanged. Honest limit: the only stacked-wordmark + garbled-box-read population is the owner's 22 scans (band-line reads on the fixture corpus never garble the way a box crop does). **C1.5 fired path (`trace_reprocess.js` on a copy of the live DB + the dev `templates/`):** OFF reproduces `NOCUMENT` @70 + note; ON → docs 12 + 14 `Stage 0.5: kept curated supplier 'DOCUMENT SOLUTIONS' — declined mapping read 'NOCUMENT' (fragment_agreement_garble)` → `template_fixed` @95, no note. Slice 2 fired path (slice 1 OFF): `corrected_to` NULL, `suggested_supplier` 'DOCUMENT SOLUTIONS'. Realdoc OFF==ON vacuous by construction (the harness never draws an issuer box) — stated, not run. Owed: a Chris round on a fresh DB with all three ON; the new-install flip (mig) after it.

## 2026-08-22 night — THE TYPE-SPLIT ARC (Nordwind: 17 quotes held by Fix A after ONE mis-confirm) — gary design → ORACLE
**Incident:** doc 135 (a quote) confirmed as a Purchase Order → template 12 `'1 Refrigeration Ltd'/purchase_order` born on Nordwind's logo (named from the machine's pre-confirm read — `review/handler.js:1400` takes the param before `allValues.supplier_name`, the inverse of `reviewService.js:426`); `_type_ambiguity` weighs a 1-confirm slug as a 24-confirm slug; the bold "QUOTATION" banner is absent from `ocr_text` on 16/17 pages; "Quotation" has no alias; B1 already pins template 10 via NRQ and C2 forces the hold. **Verdicts:** zero-code remedy SEND BACK on order (retype does NOT detach the PO link — Part D is taught-path only; DELETE template 12 first, then retype 135, then Reprocess 17); S2-js-c name precedence SIGN OFF (bug, no switch; also `reviewService.js:518,570`); S2-py unsupported-rival waiver SIGN OFF W/COND (full-band per-slug max count, both arms, never Lever 3; abstain unless counts live; decide LATE at `engine.py:9669` after the B1 pin, `_type_ambiguous` untouched for B'; leg 2 = the OWN ref's located read carries the pick's dominant prefix — page-anywhere prefix is common-mode with B1; negative control + trade-off pin "delays Fix A from the 1st to the 2nd rival confirm"); S2-js-a type-split ask SIGN OFF W/COND (pure `check-type-split` IPC called by the TEACH WIZARD before promote + Review confirm; reviewService gate as pre-claim backstop; skip machine vias; ISSUER_NEAR_MATCH payload shape); S3 aliases SIGN OFF W/COND (aliases also score as mentions — state it; pin `title_trusted==False` for "Quotation Ref NRQ-…"; realdoc M=0); S4 census SIGN OFF (+ inverted-crop arm + per-word conf); S1 confirm-once ripple SIGN OFF W/COND BUILD LAST (rides the DARK quiet lane; JS pre-check rival <2). Order S2-js-c → remedy → S2-py → S2-js-a → S3 → S4 → S1. Full plan: `docs/designs/TYPE_SPLIT_AND_ACTIVITY_STRIP_PLAN_2026-08-22.md`.

## 2026-08-22 night — THE REVIEW ACTIVITY STRIP (the cumulative top-left tiles) — barry + eric → ORACLE
**Root cause:** `recent_auto_filed` is ONE rolling `{ids, approved, at}` whose `at` is overwritten on every write (`processing/handler.js:5331-5345`) — the tile can only re-total; the human `sweep-scope-accept` (:3386) never records at all; "Put back" on 125 silently undoes 25 (:3728); the sweep receipt self-destructs at 20 s. **Verdicts:** slice 1 ledger+doors SIGN OFF W/COND (C1 merge-in-place per BATCH with a 60 s burst gap — a 200-doc/8-sender import = ONE event, the 2 s trailing flush REFUSED; C3 `review_events` in `protectedSettings._KEYS`; ledger is presentation only, best-effort after filing); slice 2 strip SIGN OFF W/COND (C2 `onReviewEvent` renders the strip ONLY; C5 observe-only click-outside, Esc only with a panel open; C6 events carry `dropped[{docId,reason}]`; C7 undo chunked/honest, >25 asks, ≤7 days, re-checked at click; C8 `--doc-head-h` for the four absolute children; C9 copy: 100 %-import = "filed automatically (matched 100 %)"); slice 3 retire SEND BACK until the trace list closes (+ C4 retire `sweep-scope-undo(docIds)`). Offers NEVER in the strip (C11 class). Owner's prose columns DO NOTHING; the owner's clarified shape = a chip strip (≤10 chips, newest left, scroll, click-anywhere closes the PANEL only) — consistent with C2. Slice 1 may land now dark; slice 2 after the type-split slices (shared seam at `_refreshQueueFromBroadcast` + the queue header). Full plan: the same design doc.
**BUILD + GATES (the type-split arc, same night):** A1 `40f47e3` (name precedence; pin test_upsert_issuer_precedence.js) · A2 `e2fa804` — the waiver moved ENTIRELY into the engine (`_type_waiver_ok(results, match, matched_tmpl, …)`: the Stage-0 match's `rival_slugs ⊆ unsupported_rival_slugs`, matched-after-pin == pick, pick ≥ DOMINANT_MIN_COUNT, own-ref located read carries the dominant prefix) because process_docs' pre-extract identify + B1 block are SKIPPED on a reprocess of a typed doc — the exact "Reprocess N" path; `templates.getAll` marks `counts_live`; realdoc RR_APP_ENV=1 OFF vs ON: M=0, M_type=0, per-field identical, would-auto-file 389→410; live-copy doc 323 OFF held / ON waived; negative control (rival given a 2nd confirmed doc) held; 35 pins incl. the trade-off pin · A3 `c67f8e1` (typeSplit.js predicate; reviewService pre-claim gate, re-file NOT exempt; `check-type-split` IPC for the wizard pre-promote; Review inline hold; ON by default, fail-open; 20 pins) · A4 `a4cbd84` (catalog `title_aliases` + migration 85 `seedPresetTitleAliases`; the caption-only page stays UNTRUSTED at conf 65 — pinned at the title_trusted level, the Oracle's correction honoured; with A4 alone the live copy's doc 323 resolved clean) · A5 `7fdfa80` `heading_absent_census.py`: 416 docs — verbatim 157 / gap-split 154 / DROPPED 105; a blind top-band grey PSM-11 read recovers 18/18 at conf 96, every channel and the inverted crop agree → not a colour mechanism; the prominence pre-gate of HEADING_BAND_REREAD never sees a dropped word · A6 `7fdfa80` (the `typesplit` lane arm; JS pre-check waiver ON + rival unsupported else audit-skip; 16 pins).
**BUILD + GATES (the activity strip, same night):** B1 `3676415` — `src/lib/reviewEvents.js` ring ≤50, MERGE-IN-PLACE per batch (60 s gap; the 200×8 test fails against a trailing flush), `review_events` PROTECTED, throttled broadcast, undo ≤7 days re-checked at click; four doors incl. the human File N; event-id IPC; chunked honest undo; 47 pins · B2 `44b6661` — the chip strip (≤10, newest-left, scroll, panel overlay, click-anywhere closes the panel only, observe-only capture listener, `--doc-head-h` for the four absolute children, C9 copy; the sweep done-phase bar defers to the ledger under the strip); 29 source pins · B3 NOT started (SEND BACK stands). Owed: the Chris round with A2/A3/A6 + B2 ON.

## 2026-08-23 overnight — CHRIS ROUND 17 FIX LOOP (owner asleep; "take chris's recommendations to the agents, plan and fix") — gary / eric → ORACLE-gated
**Round 17 (fresh sandbox, every switch ON; `docs/CHRIS_FULL_APP_REVIEW_2026-08-22.md`)** returned 8 cards. Triage + builds, one commit each (HEAD after: see the handover):
- **card 1 (`99b90f1`)** the refused-confirm return dropped every hold payload (`confirmCurrentDoc` returned `{error, code, prefixOutlier}` only) → the inline near-match / type-split holds never rendered. Now carries `nearMatch` + `typeSplit`. Pin `test_confirm_hold_payloads.js`.
- **card 1 RIDER (`320433f`)** one "Keep" of a mistyped doc silenced the type-split ask forever (`typeSplit.js` said 'mixed' at ONE second-type confirm). Rule: thin < minConfirms; 'mixed' only when a second slug holds ≥2; else split. Pinned in `test_reviewservice.js`.
- **card 2 (`72a75bd` + `875a433` + `11ca0ba`)** (a) the WIDE debris leg of `_fixed_seed_declines_mapping` (`is_debris_read`: a ≤4-alnum / single short proper-substring read of a ≥8-char fixed name keeps the seed) DARK `template_fixed_debris_wide`; (b) the letterhead suggestion's JUNK kind (`_identity_junk_read`) so a 'MENT' read offers the canonical; (c) `scopeReadiness.hasTemplate` requires the carried template's established identity to BE the scope (a DS doc bound to the Ironclad template no longer makes DS "ready"); **THE IDENTITY UNFREEZE CLASS (`11ca0ba`):** `_fieldsWithMultipleConfirmedValues` judged company keys TYPE-WIDE (≥2 distinct confirmed suppliers on the TYPE → every template's identity unfrozen at the next template write) — now per template by DOMINANCE (`templates.getDominantSupplier`: variable iff total ≥2 AND the leader does not hold a strict majority); loud `_identityOverwriteGuard` (warn + audit `template_identity_unfrozen`) on a NULL-over-frozen write; `scripts/refreeze-template-identity-20260823.js` (dry-run default; ≥3 confirms, ≥90 % share, plausible, not locked; rewrites the template FILE too) — live-backup dry run: 5 templates to re-freeze (Silverbeck, Veltrix, Castellan, Harrowgate, Nordwind). **GATE:** realdoc base copy vs re-frozen copy = byte-identical reports (389/416 would auto-file, M=0, M_type=0, per-field tables equal). The owner applies it live (`--apply --templates-dir <repo templates/>`).
- **card 3 (`9ae6c2b` + `f098480`)** the near-match finder's SUB-RUN arm (`name_proximity.tokenSubrunIdentity`: a typed/drawn one-line read that is a proper contiguous token sub-run of a known identity with ≥1 distinctive token asks with the FULL name first); `check-identity-near-match` takes `{value, templateId}`; `source:'prefix-template'` on the doc's own template. Pins `test_near_match_prefix.js`.
- **cards 4 / 5a / 6 / 8 (`e9106aa`, eric batch)** the tile yields under the strip (after the "viewing" back-bar branch) + `get-recent-auto-filed` derives from status+door; File All Ready records ONE bulk chip (`approved|bulk` key; the ledger merges into the NEWEST SAME-KEY event inside the gap — Oracle nod: the scope auto-accept landing mid-loop no longer splits a File All); the import banner self-heals (`get-processing-activity` nulls a stale import activity when nothing is busy; the Review window re-pulls every 30 s); the Reprocess dialog says a clean re-read WILL file when the sender files by itself; Search's send-back note names Search.
- **card 5b (`320433f`)** a blank issuer is never 'ready' (`issuer_blank` on the queue rows; classifier → 'missing'). Pinned with a positive control.
- **card 7 (`2cf5f26`)** an undone event stops offering Put back (`markUndone`); a second press says "Already back in Review.".
- **OWNER CARD 1 (`740a243`, DARK `quiet_reread_on_ready_templated`)** the READY arm of the quiet lane — at the ready crossing, re-read the scope's OWNED-template held docs with overall_confidence < `trust.scopeTrust().floor`, under the layout arm's guards (on-page ON, judgeable name, no prior S3-C5 note) + the C3.3 first-fill hold ("Read after learning — confirm once."). A doc AT the floor is left to the sweep. DS (all-generic name) is skipped + audited — the owner must be told the arm cannot help DS; fallback = badge copy. Pins `test_quiet_lane_ready_templated.js` (16).
**Pre-existing reds unchanged:** `test_authoritative_anchor`, `test_v1_contract`, `test_doctype_surface_parity`, `test_teach_multipage`; Python `test_identity_fusion` + 6 script-style. **Nothing pushed** (owner's standing rule overnight).

## 2026-08-23 overnight — CHRIS ROUND 18 (A1 wrong-date self-file · A3 put back · Q2 S3-C5 display) — gary design → ORACLE
**Premise traced:** C3.3 keyed on `via ∈ {layout, ready}` (`quietLane.js:417`); 447's teach-arm first-fill never examined; the sweep fingerprint hashes the note (`sweepPredicate.js:114`) so a note present at accept drops the doc — but `mergeReprocessRows` `used_new` (`handler.js:1146`) sheds EVERY lane-written note on the next re-read. **A1 — SEND BACK → rebuild:** hold-at-merge on every via, release at `_finish` before `onJobDone` when `unreliable < K` (S3-C5 disagreements + valued→empty losses + the engine's taught-box yield notes, per field); K=1 (a first-fill is single-witness; K stays a named constant, the census decides); drop the crossing-time retro. **THE SEAM:** `_ownedTemplateRows:148` excludes only S3-C5 notes → the READY arm (`740a243`) / manual Reprocess re-reads a held first-fill below floor, the same box reproduces the same value, both holds go silent → silent wrong file. Conditions: exclude the "confirm once" family in both arms (positive control); `mergeReprocessRows` carries a lane hold when the fresh value is unchanged. Residual (i) (blank-everywhere + bad box) accepted TONIGHT ONLY; closure = human vetting of first-fills (≥2 un-corrected confirms release; a correction of a first-fill counts K=1) — the next slice, fused with A3 part 2. **Q2 — SIGN OFF W/COND:** keep the new value displayed; `corrected_to = was` (only when empty) → the existing Use/Keep buttons; confirm-time two-button hold later. **A3 part 2 — SIGN OFF:** no pause, no trigger exclusion (three doors: confirm debounce, lane job-done, F2b); ripple HOLD on rows later. **Put-back `19e91b0` — SIGN OFF W/COND:** machine via refused pre-claim on a stamped doc + clear only on a human claim; Tier-2 `synth` carries the stamp; stamp inside `deconfirmDocument` + `requeueConfirmedDocsForScope` (Search/Repair send-back notes are not durable); recycle-bin restore unstamped by decision; auto-accept stamps a machine username, not the human. **A4/A2/A6 — SIGN OFF** (A6: holding on a foreign field the confirm discards = owner vet item). Gate: the pins (each failing on current code); realdoc vacuous (the harness never runs the lane); census K=1 vs K=2 over the three sandbox DBs.
**BUILD + GATES (round 18, same night):** A4 `7b8c8e1` · A3 put-back `19e91b0` + conditions `061ca82` (stamp in `deconfirmDocument`/requeue; machine via refused pre-claim `PUT_BACK`; clear only on a human claim; Tier-2 synth; auto accept files as 'Auto-filed (after your confirms)') · A2/A6/cards 5,7/copy `8b5ae1a` · A7 `615263c` · **A1 `371ef2d`** hold-at-merge / release-at-finish, K=1 (`FIRST_FILL_UNRELIABLE_K`), witnesses = S3-C5 + loss + engine yield, `_ownedTemplateRows` excludes the "— confirm once." family, `mergeReprocessRows` carries a lane hold on an equal value (`REPROCESS_CARRY_LANE_HOLD=0` kills), Q2 `corrected_to = was`; DARK `quiet_reread_first_fill_reliability_hold`; 30 pins, 18 red against the previous commit. **CENSUS (`TESTING/_measure/first_fill_reliability_census.js`, r17 + r18 sandbox DBs):** DS jobs (both rounds) worksheet_date 0 witnesses / 19 single-family first-fills → 0 held — the hand-off intact; Copperfield 00:37 job invoice_date s3c5=4 + yield=2 → its first-fills hold (447 among them); K=1 vs K=2 differ only on ONE r17 DS `supplier_name` first-fill (s3c5=1). Realdoc arm vacuous (stated). Residual (i) accepted tonight; next slice = human vetting of first-fills + the correction-ripple hold.

## 2026-08-23 overnight — CHRIS ROUND 19 (N1 Reprocess road · N2 18-on-zero-confirms · N3 re-teach re-read) — gary/eric → ORACLE
**Premise traced:** N1 holds — `reprocess-batch` onFileDone (handler.js:4152) runs applyReprocessResult only; `nd.existing` is staged (:3977); `used_new` (:1173) sheds every note on a changed value. **N2 CORRECTED:** the type-wide format did not "verify" a name — `classifyLearnedShape` makes a name group `constant` at ≤2 distinct (trust.js:272) and `valueMatchesShape('constant')` is set membership (:577); Ironbridge's OWN wizard confirm + Copperfield's 7 were the two names, so one confirm self-licensed 18 siblings via the `gs === ''` fallback (:601). Larkspur was the THIRD name → `freetext` → refused until its own 3 confirms (explains Chris's "can't explain the difference"). **N5 INERT as built:** `logAudit` injects `currentSession.id` (auth/handler.js:541) and the Audit screen renders the user join first (settings/renderer.js:5867); `actor.id=null` never reaches the row.
**P1 — SIGN OFF W/COND:** own DARK `reprocess_holds_as_lane`; fieldStats keyed per (supplier|slug|field); release before `_currentBatchProcs = []`; single-doc first-fill of a required role holds with no release; **C1 baseline:** S3-C5 compares against the existing row's type-valid `corrected_to` (the last independent value) else display_value — equal ⇒ no hold, else hold + offer the baseline, never a type-invalid `was` (the Copperfield chain offered 'INV-29273' on a date). Dialog copy must define "clean". Realdoc VACUOUS for merge/lane logic — unit battery + fixture replay is the gate.
**P2 — WRONG LAYER:** the accept loop is not where the leak is; DARK `trust_company_key_own_scope`: a COMPANY_KEY verifies only against its supplier-scoped group in `_scopeFormats`/`docTrustGate`. Pins fail on current code; realdoc byte-identical on the owner's copy expected; r19 census (Ironbridge refused at 02:23:58, Larkspur passes after 3); parity census badge-false ⇒ offer-empty pinned. No second readiness notion at `_autoAcceptScope`.
**P3 — SIGN OFF W/COND:** layout arm only; depends on `REPROCESS_CARRY_LANE_HOLD` (kill ⇒ fall back to exclusion); C1 baseline; verify what "Use" persists. P3(b) wizard warn SIGN OFF + the symmetric ref-step check.
**Measure before any flip:** the 4 wrong dates' `corroboration.disagree` — if keyword disagreed, a `docTrustGate` role-field disagreement refusal is the every-road, realdoc-measurable fix; else the taught date box's leading-glyph clip (08-07 pad-window class) is the next arc.
**Quick:** N4 SIGN OFF (pin: issuer first-fill not reliability-held, date is) · N5 SEND BACK (null `user_id` in the machine-via audit entry at reviewService.js:411; pin the row) · N6 count reason=='put-back' only · N8 reason→copy map; 7-day line from status+door.
**BUILD + GATES (round 19, same night, 04:10–04:40):** (d) MEASURED on the r19 DB — all four wrong dates carried `disagree:[{keyword, <the right date>}]` AND so did every CORRECT date row (`17-12-2026` vs `17/12/2026`): `_cmp_norm` never folded date separators → no date was ever corroborated, real disagreements invisible. `6b77f30`: engine `_corrob_values_agree` (date fold, `FIELD_CORROBORATION_DATE_FOLD=0` kills) + `trust.docTrustGate` refusal `disagreeing-read:<role>` on a PAGE-family disagreement (DARK `trust_role_disagreement_refuse`; every road; fail-open without a record; pins + Review copy). **N2 hypothesis CONFIRMED** (exactly {Copperfield, Ironbridge} human-confirmed before 02:23:58) → `69a65de` DARK `trust_company_key_own_scope` in `_scopeFormats` (pin: the Ironbridge shape OFF eligible / ON refused; badge agrees). **N5 `65ff83d`** `user_id: null` on the machine-via audit entry (pinned). **P3 `9dc7bf4`** layout arm re-reads noted docs (ready arm keeps the exclusion; `REPROCESS_CARRY_LANE_HOLD=0` falls back); the wizard's wrong-kind-of-value warning (it DID render — s55 — Chris's driver clicked past it) now demotes "Looks right" to "Use it anyway". **P1 `5979bdc`** `rereadHolds.js` = ONE road (lane delegates; manual batch via 'manual' + release before `_currentBatchProcs` clears, per-(supplier|slug|field) stats; single-doc via 'manual-single' unconditional); C1 type-valid baseline pinned on the Copperfield chain (offers 03-11-2026, never 'INV-29273'); DARK `reprocess_holds_as_lane`; dialog defines "clean". **Realdoc arm (owner's copy):** OFF (fold=0, refuse=0) = 381/416, **M=1 (#413 sales_order date 04-08→24-08 — the leading-digit class)**; ON arm running at the time of writing. **OPEN — drift:** the same DB copy gave 389/416 M=0 at 00:11 and 381/416 M=1 at 04:20 under the same 89 mirrored env vars; 7 regressions (#15 'ILUTIONS', #17 null ref/date, #18 'NOCUMENT', #81 '41-02-2025', #212 'SE-ORD', #413) — bisect candidates: `72a75bd` (the JUNK suggestion kind, default ON inside `identity_suggest_canonical`, which the owner's copy has ON; the wide debris leg is DARK) — NOT resolved tonight; nothing pushed.
**REALDOC ON ARM (fold + refusal + company own-scope, owner's copy): 338/416, M=1 (#413 NOT caught).** Attribution (`TESTING/_measure/rr_on_reasons_20260823.jsonl`): `unverifiable-value` 45 = the company-key own-scope rule (the owner's scopes lack 3 HUMAN name confirms — machine confirms excluded — the 08-19 starvation class; 10 % review cost → owner vet, not a flip) · `disagreeing-read` 1 (precise) · #413 `order_date` via `template_mapping` @97 with no page witness — the Oracle's "else" branch: the taught date box's leading-glyph clip (08-07 pad-window class) is the next arc. The Oracle's "realdoc byte-identical expected" for P2 was WRONG on this corpus — stated here so it is not re-assumed.

---

## 2026-08-24 — Batch-audit / "Quick check" grid for auto-filed docs (VET of bob/gary/eric consensus)

**Verdict: SIGN OFF WITH CONDITIONS.** Premise holds (auto-filed docs leave the queue unseen; a thin
orchestrator over the EXISTING `reviewService.confirm(allowRefile)` is the lowest-blast shape). **Host: a
MODE inside the Review window, NOT a new window** (the confirm-with-holds handlers ~350 lines live in
review/renderer.js; a standalone window forks a surface that has rotted 3×).

**Two consensus claims traced FALSE:** (a) the `confirmed_via` "flips to human confirm → mass graduation"
risk does NOT exist — `documents.confirm` never writes `confirmed_via`; a corrected auto-doc keeps
`confirmed_via=auto`, so it stays out of the graduation window. (b) type-split (reviewService.js:303) is
`!_via && !bulk`, not `!isRefile` — it is the orchestrator's `bulk:true` that suppresses it.

**Owner requirement is MET, verified at mechanism:** re-file keeps machine `confirmed_via`; machine rows are
excluded from learning by default (`learning_exclude_machine_confirms` ON, mig 70) — BUT the C2 carve-out
(learning.js:1589 `isMachine = excludeMachine && machineVias.has(via) && corrected_value == null`) INCLUDES a
row once `saveCorrections` writes a `corrections` row. So a grid correction reaches format/dominance/prefix/
hints without entering graduation. Load-bearing + fragile → PIN A.

**Seam the consensus missed — anchor-clear amplification:** `saveCorrections` clears the corrected field's
learned anchor unless taught (learning.js:436). This grid fixes VALUE misreads at a CORRECT position; wiping
the anchor per correction at batch scale degrades future extraction (opposite of the goal).

**Blocking conditions:** (1) disallow document_type edits in the grid (route to Review) OR pass `bulk:false`
to keep type-split live — never type edits with `bulk:true`; (2) skip `clearAnchors` for grid value-
corrections (value not position errors) + a before/after anchor census, or gate behind a switch; (3) edge
field-validation must REFUSE an invalid ref/date inline (prove with a bad-date test); (4) per-doc failures
surface with a reason, never silent-skip; (5) preview resolves `stored_path` not `working_path` (auto-file
nulls working_path); (6) `__global__` old-hint delete is a separate opt-in, default scope-only. Also:
disallow ISSUER edits in v1 (route to Review) — near-duplicate-company risk.

**Verification gate:** realdoc `M=0 AND M_type=0` OFF-vs-ON (RR_APP_ENV=1) on a live-DB copy + zero per-field
accuracy drop. PIN A (getFieldFormats + dominant-snap reflect the correction on a machine-via doc with
exclude ON — assert the READER output, not the corrections row); PIN B (issuer + type edits refused/routed);
PIN C (invalid ref/date refused inline); PIN D (grid ev.ids-driven, corrected rows stay visible mid-session);
PIN E (anchor-count census matches the accepted policy).

---

## 2026-08-25 — RATIFY the two DARK detection arcs (name_dominant_snap + branding_strip_reg_boilerplate)

**Context:** both arcs were built the prior session with in-code comments citing "Oracle SIGN-OFF-W/COND
2026-08-24" — but NO log entry existed (phantom citations). This is the real vet, requested by the owner
("ratify the 2 DARK arcs"), backed by a corpus A/B.

**Corpus A/B (realdoc_regression, RR_APP_ENV=1, live confirmed DB, 1078 docs; OFF vs BOTH arcs ON):**
would-auto-file 1049=1049 (delta 0), M 11=11 (same docs), M_type 0, per-doc dump diff = 0 supplier changes,
0 wouldFile flips, 0 +name_snap adoptions. **Both arcs COMPLETELY INERT on the confirmed corpus** — proves
NON-DESTRUCTION, does NOT prove the heal (the confirmed corpus is single-spelling / correctly-identified by
construction, so neither trigger — the legal-suffix slip, the doc-732 reg-collision — is present).

**VERDICT: SIGN OFF WITH CONDITIONS — split the arcs (different risk class).**
- **branding_strip_reg_boilerplate — SIGN OFF.** Fails toward review (worst case: abstain-to-review, never
  a silent mis-pick — K-floor fail-safe traced through the immune path, present-bar, logo-text gate,
  BRANDING_CONFLICT_GUARD, _branding_own_ratio, all return the abstain/absent direction at `_n==0`).
  {vat,reg,registered,company} are genuinely newly-stripped (not pre-existing stopwords); the shared
  `_distinctive_tokens` lands the strip at the doc-732 defeat point. 0/1078 identities changed. Residual
  (small, honest): the strip also shrinks RIVAL banks and could newly-FLAG a correct supplier
  (fail-to-review, not a misfile) — 0 on the corpus.
- **name_dominant_snap — SIGN OFF WITH CONDITIONS.** It converts a REVIEW hold into a SILENT auto-file, the
  one path the single-spelling corpus can't exercise. Containment is otherwise good (STRONG-repair-only,
  exact core, passes `repaired` not a raw dominant, `+name_snap` excluded UNANCHORED from getFieldFormats so
  the self-feed loop is closed). **THE HOLE Oracle found:** a VALID-FORM suffix swap — `llc` and `llp` are
  both in `_LEGAL_SUFFIX_CANON` and one edit apart, so "Anderson LLP" (a distinct partnership) would silently
  adopt confirmed "Anderson LLC". **FIXED this session:** `name_snap_adopt` now refuses when the read's own
  trailing token is itself a distinct canonical legal suffix (`if last_r in _LEGAL_SUFFIX_CANON and
  last_r != last_d: return None`); pinned in test_name_snap.py (LLP->LLC + LLC->Ltd refused, Lid->Ltd keep).

**CONDITIONS:**
1. name_snap: the valid-form-swap exclusion (DONE) is a BLOCKER before any flip.
2. name_snap: owner-manual per-DB flip ONLY; new-install default deferred until real held-doc fires are
   observed correct.
3. branding: cleared to flip owner-manual now; promote to new-install default after doc-732 is confirmed to
   abstain/flag on reprocess (not file Castellan @94).
4. Flip SEPARATELY, branding first (disjoint stages; 0 interaction on the corpus).
5. **Merge gate for default-on (either arc): a HELD/MISFILED reprocess diff (NOT the confirmed corpus) must be
   non-empty AND 100% correct.** The confirmed-corpus A/B proves "won't hurt"; only the held-set reprocess
   proves "will help". Empty held-set diff → keep DARK (no measured benefit, and name_snap would add
   silent-adopt surface for nothing).

---

## 2026-08-25 — First-batch letterhead sibling-fill (issuer_sibling_fill) — VET of gary's design

**Problem:** a new supplier's first import of ~12 identical-layout invoices are each held "confirm the
sender" (letterhead prefill); confirming one only helps docs imported AFTER it, so File All Ready offers 0.

**VERDICT: SIGN OFF WITH CONDITIONS.** The layer is right (an on-confirm per-scope propagation service
modelled on classFixService, not a page-wide rewrite); fail-toward-review posture right; the silent-
auto-file seam is genuinely closed by the existing floor. Conditions (all implemented in `4aa5075`):
- **C1 (BLOCKER) — the premise was wrong.** gary keyed the trigger on `suggested_supplier`, but the
  shipped default is PREFILL mode (mig-77 forces `letterhead_prefill=true` for ALL installs), where the
  engine writes `supplier_name=C @69, method='letterhead_prefill'` and NO `suggested_supplier`. So the
  feature would be DEAD ON ARRIVAL and a suggest-mode test would hide it. Re-keyed to
  `method=='letterhead_prefill'` + `display==C` + note. Fires ONLY when the human ACCEPTED the letterhead
  (norm(confirmed C)==norm(prefilled read)); a CORRECTED confirm never propagates.
- **C2 — same-layout guard (seam 4).** Two DISTINCT senders in one batch whose letterheads garble to the
  same string (both template_id NULL) would otherwise misfile sender-2 under sender-1. Guard: adopt only
  if the sibling's `logo_phash` is within a tight Hamming distance (4) of the confirmed doc's (identical
  siblings ~0-2; distinct logos far; null → 64 → refused). "independent read" is common-mode OCR, not
  corroboration — the phash IS the same-layout proof.
- **C3 — capture pre-claim, thread in** (the LAST-effect hook must not re-read the resolved source row).
- **C4 — no corrected_to (marker badge); raise FIELD confidence to clear below_threshold; leave
  overall_confidence UNTOUCHED.** Seam 2 traced closed: below-floor refusal + (fresh sibling template_id
  NULL → docTrustGate refusal at any sub-100 floor) means no sweep/corrob/import door files a filled
  sibling silently — only the human File-All click. A future dev who recomputes overall on a note-clear
  would open this door; C4 + the PRE-FILL pins guard it.
- **C5 — the gate must run the LIVE config.** Unit pins seed letterhead_prefill rows (not
  suggested_supplier). Plus a fresh-import Chris round (12 identical → confirm 1 → File All offers 11 →
  zero wrong folders → Undo). The confirmed-corpus census is VACUOUS (0 suggested_supplier rows; mature
  docs resolved), so the fresh-import fired-path IS the go/no-go, not a corpus census.
- Seam 3 (graduation): keep the filled siblings COUNTABLE (already true for hand-confirms); the audit row
  records applied count + source decision so a wrong graduation is traceable.
No learning-exclusion (contrast classFix C2): each sibling's own letterhead already reads C, so the fill
confirms its own evidence rather than overriding it.

## 2026-08-25 (retry vet) — issuer_sibling_fill C2 WIDENING (phash 4→13 OR keyword) — SEND BACK → corrected

**Context:** after the sign-off above, C2's same-layout proof was WIDENED (uncommitted) from tight logo phash
≤4 to `phash ≤13 OR keywordOverlap(src,sib) ≥0.60`. Rationale (correct): on real scans a supplier's OWN
identical invoices spread logo-phash 0–28 (`project_logo_hash_unreliable`), so ≤4 rejects most genuine
siblings and the feature barely fires. The code comment claimed "Oracle REVISED" but no log entry existed —
so it was re-vetted here. (First spawn died on a transient network error; clean retry.)

**VERDICT: SEND BACK — then corrected in place (all conditions implemented + gated).** The widening is
warranted (≤4 genuinely too tight) but the KEYWORD arm as built was wrong. Oracle catches:
- **Premise false.** The comment claimed it mirrors `handler.js:1633-1635`, but that `keywordOverlap≥0.60`
  is an AND-guard that only runs ON TOP of a logo already ≤13 (the over-merge guard for the 7-13 band) —
  never a standalone OR that fires on a far/absent logo. The app's ACTUAL logo-independent same-template
  arm is `findByBrandingFingerprint` @0.80 over DISTINCTIVE tokens (≥3 shared floor, SYMMETRIC ratio) via
  `branding_fingerprint.js` — explicitly the "ONE source of truth" comparator. The widening introduced a
  SECOND, weaker same-template comparator in an identity-PROPAGATING path (violates that invariant).
- **Re-opens the collision seam in the weakest form.** In the two-senders-garble-to-the-same-string case
  the fingerprints share the garbled NAME tokens by construction, and the string leg is satisfied by
  construction — so the whole burden falls on C2. Raw `keywordOverlap` is (i) ASYMMETRIC (denominator =
  sibling length → a short garbled subset sibling scores 1.0 — the exact directional bug
  `symmetricDistinctiveOverlap` kills) and (ii) undiscriminating (no distinctiveness filter, no shared
  floor). Admit also CLEARS the note → a wrong admit is a human File-All rubber-stamp, not a held doc.
- **Ruling (a FIX, not obstruction):** keep the OR + logo arm at 13, but replace the keyword arm with
  `brandingFp.convergesByBranding(src, sib, 0.80)`. Strictly better on both axes — recovers genuine
  siblings AND rejects the collisions.

**Conditions — all IMPLEMENTED (uncommitted, feature stays DARK):**
1. Keyword arm → `brandingFp.convergesByBranding(src.keyword_fingerprint, sibKw, 0.80)`; `_KW_MIN` deleted;
   the false "mirrors 1633-1635" comment corrected.
2. Mature-sibling identity re-check: in the `template_id` branch, also refuse when
   `supplierNamesDisjoint(C, establishedIdentity(db, template_id, r.id))` — sibling-fill must not fill a
   mature FOREIGN template's held doc with C (generic reuse gets a downstream re-check; this path had none).
3. Comment/log integrity: this entry (the code no longer wears an unearned "Oracle REVISED" label).

**Gate — the adversarial collision pin is RED on old raw-0.60, GREEN after convergesByBranding (proven,
not asserted):** measured on the real modules — GENUINE old_admit=T/new_admit=T; COLLISION subset
old=1.000→admit / new ratio=0.375→refuse; COLLISION boiler old=0.833→admit / new ratio=0.625→refuse.
Pinned in `test_issuer_sibling_fill.js` PIN h2 (genuine admitted, both collisions refused) + h3 (mature
disagreeing identity refused) + h (branding admits a logo-drifted genuine sibling). Whole suite green.
**STILL OWED before a DARK→on flip (owner):** the fresh-import fired-path Chris round WITH a collision
fixture in the batch (a single-supplier round would pass green while the seam stayed open) + re-confirm the
corpus-census vacuity after the mature re-check. Verdict: **Oracle earned his keep — caught a false premise,
a reintroduced directional bug, and an "ONE source of truth" invariant breach the specialist pass missed.**

## 2026-08-26 NIGHT — CLASS F "corroboration clears a verification-doubt note" (gary audit → built DARK) — SIGN OFF WITH CONDITIONS
**Built:** `engine.py` class F in `_resolve_corroborated_notes` (env `CORROB_VERIFICATION_DOUBT_CLEAR`, setting
`corrob_verification_doubt_clear`, DEFAULT OFF): clear + LIFT the field to 90 iff the note's mark ∈ the write-site
constant allowlist (`_EDGE_CUT_NOTE`, `_FT_FALLTHROUGH_NOTE`, `_SHAPE_TRIM_NOTE`, `_REREAD_NOTE_HEAD`), ≥2 DISTINCT
PAGE families agree with no dissent, an UN-NOTED ≥80 witness from a different page family, the learned shape passes,
no pending corrected_to; never identity/names/human methods. The emit's family bucket hoisted to `_corrob_record_bucket`.
**Verdict: SIGN OFF W/COND — GO on the core rule** (Q1 the bare-anchor second family is legitimate for a mapping
winner; Q2 the clip class is structurally excluded — `_corrob_values_agree` has no prefix/containment fold, so
`3190` vs `31901` lands in `disagree`). **Three seams found + closed the same night:**
- **C1 skeleton + fail-closed:** `check_value` is the COARSE class only; require `shape_match_score == 1.0` on a
  non-FREETEXT/non-CURRENCY class. **Found by the C1 pin itself:** `_fold_shape` collapses EVERY pure-digit skeleton
  to `#` (length-blind) — so ALSO require the value's RAW skeleton to be a learned `shape_families` variant (no
  families → refuse). Pinned (`3190` vs `#####` history → held).
- **C2 totals stay with `_d2`/validator:** the edge-cut note is written for the currency leg too; refuse
  `total_amount` + aliases + currency-TYPED fields. Pinned.
- **C3 re-read mark:** the Stage-4.5 re-read adopted a CROP read while the winner kept its page-text method — for
  that mark only a KEYWORD-family witness counts. Pinned both ways.
- **C4 flip order:** `_reconcileEnv` arms F only when `corrob_note_recompute_fc` is ON (else a lifted field with a
  stale −12 penalty = a mysterious empty hold). Enforced in code.
- **C5 gate before ANY flip (owner):** realdoc OFF vs ON — M=0, M_type=0, zero per-field drop (EXPECTED VACUOUS on the
  edge-cut class — the harness cannot bit-reproduce the live misread); the NON-vacuous arm = a held-queue census on the
  owner's DB copy (docs whose note is an allowlisted mark → reprocess with F ON → eyeball every `cls=F` clear against
  the PDF, 0 wrong); the SFDEV live heal of SuperStore 31901 (field 70→90, doc reaches Ready); a positive control
  (a real clip from the `_EDGE_GUARD_FIRES` census stays held). Pins: `test_verification_doubt_clear.py` 39/39,
  `test_corrob_note_resolve.py` 51/51, emit suites green.

## 2026-08-26 NIGHT — LEARNING REPAIR "start fresh" (barry console + gary semantics) — SIGN OFF WITH CONDITIONS on the mechanism; rename/merge NOT tonight
**Premise verified:** "re-read as a NEW doc WITHOUT un-filing" is achievable — every Python input enters via
`buildTrainingArgs`; the only live-derived feed is `getFieldFormats` (transitively covers the prefix/dominant/
lexicon/confirmed-count indexes). The old "Forget learning" was a HALF-forget (tables cleared, the live-derived model
kept counting). **Rulings:** S×T is the right grain; stay-filed + stamp is the right default; forget never touches disk.
**Built tonight (all DARK):** slice 0 — mig 90 `documents.learning_excluded_at` + ONE predicate
`machine_vias.learningExcludedSql` threaded into every learning-feeding reader (17 sites + the type-ambiguity waiver
counts; NEGATIVE list pinned: search/browse/counters/writers untouched; `_cleanupAutoMoneyFields` deliberately NOT
threaded — a destructive startup guard, not a learning reader); slice 1 — `learningScopeService.listScopes`
(documents ∪ every learning table, never `getMemoryInventory`) + the selector/console UI behind
`learning_repair_console`; slice 2 — `learningRepairService.forgetScope` behind `learning_repair_forget`: snapshot →
scope deletes → per-doc retract ONCE (C1: `learning_retracted_at` stamped while confirmed; `repairService`
send-back/delete skip an already-retracted doc; restore never re-plants an excluded doc; a HUMAN confirm clears BOTH
stamps in `confirmIfReviewable`) → owned templates removed with runtime `PRAGMA foreign_key_list` child enumeration
(C2 fail-closed: a template whose confirmed docs include ANOTHER sender, or another type, is REFUSED and reported)
→ exact-scope stamps (C3) → Undo = exact row restore by id incl. the `__global__` twins + identifier rows (C4) →
lane reason `repair` with the unconditional "Read again after a learning repair — confirm once." hold (C5) →
`<slug>.json` hygiene (C6). Pins: `test_learning_excluded_readers.js` 87/87, `test_learning_repair_service.js` 32/32
(forget→send-back leaves S2's twin; shared template refused; cold scopeTrust with a graduated control; undo
round-trip equality; human re-confirm clears; "Pacmec" untouched by "Acme").
**Owner (not tonight):** whole-sender forget (logos/identifiers/accepted-issuer); rename/merge as its own arc; the
three UX defaults (S×T vs sender; stay-filed vs back-to-Review; never move files + explicit Re-file).

## 2026-08-27 — BUYER-ISSUED LETTERHEAD SCOPE (Chris round 6 card 1; gary design) — SEND BACK on ONE touch point → corrected; NO-GO on a live flip until the gate
**Exhibit (verified at source, Chris sandbox):** template 3 (Bramblewood PO, `buyer_issued=1`, 0 confirms) claimed an
Oakhaven delivery note, a Meadowvale credit note and a Castellan worksheet as Bramblewood POs @95 `template_fixed`
through the WHOLE-PAGE text arm (7/9 fingerprint hits — the owner's name+address sit in every BILL TO block); logo phashes
far apart; doc 6 untyped ("GOODS DELIVERY NOTE" = one extra real word → not a heading) so the type-scope guard had
nothing to refuse on; two roads (the quiet lane's kw selector arm c′ + the single Reprocess).
**Premise:** "a buyer-issued layout may only be RECOGNISED by text in the letterhead band" — HOLDS and is monotone
(hits(band) ⊆ hits(page); `header_band_text` IS the harvest truncation). `buyer_issued` (PO-ref types) is the right
key for the hits lever, the WRONG key for the identity-presence test: the mark says "PO-shaped", not "identity =
letterhead" — configuration B (a PO taught with the COUNTERPARTY as issuer, the founding fixture of
`TEMPLATE_IDENTITY_ON_PAGE`, test_identity_on_page QUILLSTONE) prints its identity BELOW the band and would be refused
on its own paper. Band-scoping `_identity_refuses` also split-brained JS (`nameBearingButAbsent` whole-page) vs Python.
**Corrected in place:** `_identity_refuses` reverted to whole-page for every template; the go-forward HEAL moved to the
engine honour path (`engine.py` after the identity-guard decline): a marked binding is declined when
`_keyword_hit_ratio(known, header_band)` < KEYWORD_THRESHOLD (`sticky_binding_declined reason='letterhead'`) — the
same evidence the recognition lever uses; config-B-safe, wordmark-safe; abstains without a fingerprint. Touch points
kept: `_match_by_keywords` hits over the band for marked templates (after the type-scope guard, whose text is pinned);
the same-type rescue arm band-scoped; JS mirror `findByKeywordFingerprint` (the lane selector + the wizard save-target /
graduation LINK / reextract roads via `identifyByFingerprint`) with `_hasBuyerIssued` column tolerance; V1 rival pin
untouched (V2 already chrome-band). DARK: `template_buyer_issued_letterhead_scope` / `TEMPLATE_BUYER_ISSUED_LETTERHEAD_SCOPE`.
**Conditions → status:** (1) redesign touch point 3 — DONE (above). (2) pins that can go red — config-B marked
fixture admitted + matches its own PO under ON, never claims the inbound paper; the exhibit's marked template refused by
HITS not the guard; the empty-band trade-off (guard admits, honour path declines) — `test_buyer_issued_letterhead_scope.py`
43/43; JS §4 28/28 (`test_buyer_issued_scope.js`); `test_identity_on_page.py` unchanged green. (3) arm C = the live-DB
arm: the owner's DB holds exactly ONE PO-ref template (t8 Bramblewood, config A, 113 bound confirmed docs, already
marked) — realdoc OFF vs ON **MET: byte-identical on all 1242 docs** (would-file 1168→1168, 0 wrong gained, 0 supplier
changes, per-template counts identical incl. t8 113→113; both arms type 100 / supplier 99.8 / ref 99.0 / date 99.0 / total
100; regressions 28/26 silent = pre-existing) — `rr_lh_*`, diff `TESTING/_measure/r6fix_20260827/rr_diff_lh.js`. (4) refactor gate — 0 fingerprint
diffs across 1242 confirmed docs (`fp_gate_census.py`). (5) empty-band census — 0 empty bands, 0 below 0.75 among the
113 PO docs. (6) fired path on a fresh Chris sandbox with the switch ON — **MET** (round 7, DB-verified): after the same Bramblewood
teach the lane job selected nobody (`done_ids ""` vs round 6 `"4,2"`); two Reprocess presses on the Oakhaven note + the
Castellan/Meadowvale confirms show a BLANK supplier before the human typed it (`raw_value null`, `original_value ""`) — no
`template_fixed` stamp; IMPORT 200 → 21 Bramblewood-badged docs = the 21 Quillstone POs, 0 inbound docs on the PO template. (7) next slice:
surface `sticky_binding_declined` as a review note ("This layout's letterhead isn't on this page") — pendingfeatures.
**Residuals named (gary):** the mark seam (outbound non-PO layouts unprotected); the logo arm's whole-page text gate on a
phash collision; band OCR variance across siblings (→ Review, never a wrong company).

## 2026-08-27 pm — LIST FIELD REVIEW PILLS (owner ask; panel barry/gary/reggie/eric/bob/Chris-lens) — SIGN OFF WITH CONDITIONS → BUILT
**Owner ask (verbatim intent):** "a text display of the detected values … with the option to state if there is a problem …
maybe 9 are good but 1 is bad … should it let them manually edit … should there be an option to do something that would
enhance teaching of this field in future". **Panel consensus:** pills as a VIEW over the hidden store input (the ONE value
confirm reads, the ONE `corrections` writer); per-pill edit / ✕ with put-back / "+ One it missed" (= the ⊕ caption teach);
NO dialog taxonomy (a wrong pill is just edited — Chris-lens: "state a problem" is a form nobody fills); "Edit as text"
escape; learning = this document only + the caption teach (the only future-facing lever — a per-element correction has
no scope-wide meaning: the OTHER documents print OTHER serials).
**Verdict: SIGN OFF WITH CONDITIONS.** (1) union across OVERRIDE (taught) captions only, page order — never the generic
bank; (2) the caption tail bound `(?![a-z])` ONLY under `collect=True`, shipped TOGETHER with the union (alone it trades a
visible debris pill for an invisible miss); (3) a digit gate for a list of CODES (inferred 'alphanumeric') + the known-
caption vocab armed for list keys, own switch `LIST_ELEMENT_DIGIT_GATE` DEFAULT ON, not coupled to `REF_ROLE_DIGIT_GATE`;
documented trade = a digitless serial in a `*_number` list; (4) the ⊕ merge rule current ∪ (preview − (original − current))
through the store's `input` event, never `corrections` directly; (5) three guards, one classifier (field TYPE on the slug-
keyed type): `showFieldRuleMenu` early return + `save-field-rule` refusal + the engine field_rules skip (a `remove_text`
rule on one serial would truncate every future list; `keep_block` collapses it to one token); (6) drop the generic ref bank
for a list-typed ref-role field in `seed_field_labels` (a "Reference No" seed would collect the job reference as an
element — the digit gate cannot touch it); (7) `saveCorrections` + `replantConfirmHints` skip a list-typed field (a hint
would replant THIS document's serials onto the next); (8) no hold from this slice (a shape-consensus flag rides a non-note
channel, census first); (9) no trust exemption now (`docTrustGate` none/constant/code classes + the field-agnostic
correction count = slice 2, census first); (10) gate: pins both directions with positive controls, realdoc `RR_APP_ENV=1`
M=0 with the accuracy table unchanged, a generated serial-page census OFF vs ON, a live control on the owner's worksheets,
a Chris round for the copy.
**Conditions → status:** all ten BUILT/pinned — `test_list_field_scan.py` 11→27 checks (union/page order, override-vs-plain
precedence both ways, tail bound ON/OFF + scalar byte-identity + the pairing pin, digit gate ON/OFF + non-code key + the
trade, vocab arm ON/OFF, seed bank ON/OFF, longest-caption-per-line + control), `test_list_field_pills.js` 34 (listCaption
twin, renderer/CSS/handler/engine/learning source contracts), `test_list_field_learning_skip.js` 8 (DB round-trip both
writers + positive controls + fail-open). **Found while pinning, closed:** a taught caption that is a word-PREFIX of
another ("Model" / "Model No") reads the longer caption's tail as a value on the shared line → LONGEST CAPTION WINS PER
LINE (recorded from raw hits before the gates, so a refused long read still owns its line). **Census** (synthetic
worksheets, the app's real seed+merge bank, identical page sets both arms, 360 pages × 6 shapes): with one taught caption
debris 478 → **0**, missed 674 → 674 (the same 60 header-row element-1 residual + 418 plural lines until the plural caption
is taught); with three taught captions exact 300/360 both arms, debris 60 → **0**, missed 60 → 60; no shape loses a real
serial under ON. Two premise traps caught by the pins themselves: "Serial No" does NOT prefix-match "Serial Number"
("Nu" ≠ "No") and the pre-existing short-value (2-char) + ALL-CAPS guards refuse on every path — controls re-chosen so no
pin is vacuous. Realdoc + live control + Chris copy round: see `HANDOVER_2026-08-27_DAY.md` RESULTS.
**Residuals named:** own-label seed vs taught caption do not union (cond 1's letter; synthetic mixed pages 8/60 until both
are taught); caption-above-column = element 1; no count witness; the receipt cannot name the caption (no verified caption
on the stored row); trust slice 2.
**Post-round addendum (Chris r8 + the realdoc gate, same evening):** (1) the ⊕ label picker returns the token NEAREST the
value, so a value-only box stored the caption **"No"** doc-type-wide and the twin's reprocess collected the JOB SHEET number
as the serial at "1 found"; the Review preview had used "No:" (multi-word branch) → preview ≠ store. FIXED inside the slice
(no new switch — it only REFUSES/EXTENDS what a teach may store): ONE `cleanCaption` for ⊕ / wizard / IPC; a generic tail
(`no|nos|number|num|nº|#|ref|reference|id|code|date|qty|quantity`) is extended to the phrase printed left of the drawn value
on the page or refused with the reason; server-side refusal too. Pinned (`test_list_field_pills.js` 41, teach pins). (2) The
realdoc "regression" (96 Castellan worksheets would-file → held) is NOT the collector: an unread optional field on a type
with no required fields scores 0 in `overall_confidence` → 81 < floor 95. Owner remedy = mark the roles required; a system
fix is queued for a separate vet (cond 9 stands — no trust change shipped). (3) The scanned worksheets' page text lacks the
"Serial No:" lines entirely (OCR/row-rebuild loss; the born-digital twin has them) — an OCR arc, not this slice.

---
## 2026-08-30 · Slice-level deskew re-read of flagged fields — SIGN OFF WITH CONDITIONS
Design `docs/designs/DESKEW_SLICE_REREAD_2026-08-30.md` (owner slice refinement + barry + oscar; builds on the
2026-07 `DESKEW_FIELD_REREAD` sign-off). A field-scoped "straightened second opinion": re-read a flagged value's
EXPANDED slice on a deskewed crop, adopt into that field ONLY on ≥2 independent PAGE-family corroboration; else
untouched. Right layer; genuinely discharges the 2026-07 seven vetoes. SIGNED with six pinned conditions (full
set = design §11):
- **LOAD-BEARING C1 (the corroboration bucket).** The deskew read must bucket to the EXISTING `crop` family
  (`_corrob_record_bucket`), NOT a new `deskew` family and NOT an unknown name. A new family lets the raw
  `anchor_crop` (family `crop` ≠ `deskew`) self-corroborate the same-way garble → 2 families → licensed →
  **silent wrong file** (doc-561, "same header garbles the same way under any rotation"). None gates the
  agree-set shut (`engine.py:4447`) → inert. Only `crop` is safe (raw same-family crop SKIPPED at
  `engine.py:4441`) AND useful (only an independent keyword/mapping can license). Two-direction pin.
- **R1–R5 (ref/date — the broadening past the 2026-07 name-only sign-off):** fire only on already-flagged
  ref/date; adopt on ≥2 page families (`_corrobLicensed`, page-family required); silent-file ONLY via the
  two-leg `critfield_corrob_floor_relax` (`_corrobLicensed` AND `valueMatchesShape`) — never corroboration
  alone, never learned-shape alone; a type-valid raw the deskew DISAGREES with routes through
  `rereadHolds.holdChangedReads` S3-C5 two-value "was X, now Y" (not the reassuring note); DATE_FOLD on +
  `parse_date` gate.
- **C2** corroboration-record REBUILD (inject the deskew candidate into `_field_candidates[key]` + re-emit
  before the gate reads it; else fails CLOSED/inert). **C3** class-aware locate+guard (name = label-adjacency
  relocate, NOT `targeted_reread` similarity-to-garble which returns the CAPTION for a caption-bleed name;
  kinship-to-garble gate is ref/date-ONLY — inverted for names). **C4** inverse-map must also undo the ×s
  upscale (÷s) + keep the stored raw w/h. **C5** the manual "Straighten-all" store-worse fix ships as a
  SEPARATE slice/gate (realdoc doesn't exercise the manual reprocess path).
- **Gate:** realdoc M=0 proves inertness, not correctness → add a ≥3° skewed census (fired/adopted/filed counts
  + zero non-two-leg ref/date auto-files) + a negative caption-commit census (the `DESKEW_RAW_CROPS` RED class)
  + the named pins. DARK until met.

---
## 2026-08-30 EVENING · Re-slice WITNESS sweep (totals) + money-format record hygiene + deskew dead guard — SIGN OFF WITH CONDITIONS
Design `docs/designs/CORROB_RESLICE_SWEEP_2026-08-30.md` (REVISED banner). Advisors oscar (ladder) + reggie (strict
predicate / STOP) + 007 (frame + which rectangle) → Oracle. Premises measured on a faithful replay: 0023's zone reads
`29,242.76` @90 (a format-VALID garble, not `£9 32632.76`); the lever is vertical headroom, not DPI; R8 (pad 0.5×h, no
upscale, white border, PSM 6, in-band pick) 20/20 vs padded PSM-7 15/20 with wrong digits → witness-only.
- **Item 1 `RESLICE_WITNESS_SWEEP` — SIGN OFF W/COND.** Admissible for the recon demoter's crop leg; NOT review-bound
  (the demoter's signed posture carries; the census is the flip bar); keep penny-reconcile as the trigger, made
  non-vacuous. **C1** trigger = `RECON_TOTAL_ADJUSTED_NOTE` EXACTLY (closes the class-C shadow-attribution seam —
  one producer, one consumer). **C2** `_penny_reconciles` requires the tax to be READ (0.00 ok) — `subtotal + 0 == total`
  is the 2026-08-06 false balance. **C3** `money_token`: exactly ONE strict amount on the picked line, else abstain (a
  Net/Gross two-amount line could vouch for the gross from the neighbouring column). **C4** witness confidence = the
  amount token's OWN word confidence (min with the line mean), never the caption-inflated line mean. **C5** pin
  PASS-2: total note released, subtotal note survives, doc still held. **C6** pin `prep` non-scaling (band + 20 px) and
  the 0-based page index.
- **Item 2 `CORROB_DISCOUNT_INVALID_WITNESS` — SIGN OFF W/COND, CURRENCY-ONLY in v1.** The JS consumers of a ROLE
  record are LIVE (mig-93 ON set: corroboration_autofile, critfield relax, trust_role_disagreement_refuse). **C7**
  route `discounted` only for currency; the date leg stays in the predicate + pins. **C8** JS `_pageFamilyDisagrees`
  scans `disagree ∪ discounted` (a discounted junk ROLE dissent still refuses; `_corrobLicensed` unchanged). **C9**
  dev-inspector shows `discounted` beside `disagree`.
- **Item 3 `TEMPLATE_FORMAT_FAIL_YIELD_STRICT_MONEY` — SIGN OFF as DARK code, DO NOT FLIP in this arc.** SEAM: on the
  format-invalid zone-read class the strict yield pre-empts item 1's release path (mapping yields at the Stage-1 merge
  with the yield note, capped 88 → the pick early-returns → no RECON note → the sweep never fires → permanently held);
  it wins only on the NON-reconciling sub-class. **C10** seam pin; **C11** flip-order rule: never flip strict-money
  before its own census (fires split reconciling / non-reconciling).
- **Item 4 deskew retry dead guard — SIGN OFF W/COND.** Verified: `_maybeAutoFile` consults `msg.needs_review` only
  with gate-unify OFF (`handler.js:5633-5637`); `autofile_gate_unify` defaults ON (`database/index.js`). **C12** an
  EMPTIED field counts as a change (stub row + note). **C13** the charter is now FIELD-level ("never silently
  auto-files a straightening-CHANGED value"; a same-value lift files normally) — docstring + handover + pin. **C14**
  wiring pin: holds applied BEFORE `raw_extractions = raw2`, the note reaches the emitted extractions. Premise
  correction for the owner: the 5/20 heals were measured on a sandbox whose ref/date were EMPTY (the fire
  condition); live they fill, so the live TRUE setting is mostly inert on note-only holds.
- **R8 as the PRIMARY money read — NO** (one template / one DPI / one font; no upscale on a 9-pt total is the
  tight-crop-starves-the-LSTM class). Licensing census: every taught currency mapping across ≥5 templates at 200 AND
  300 DPI, tight vs R8 vs GT, 0 T→F, 0 new format-valid wrong reads, pad-window suites byte-identical.
- **Gate before any flip:** Nordwind 20 OFF/ON at 200 DPI (0023 released, value unchanged, 19 byte-identical — MET);
  full realdoc `RR_APP_ENV=1` on the live copy, each switch alone AND all-on: M=0, 0 new wrong would-file, 0 per-field
  accuracy drop; `RESLICE_CENSUS_DIR` + `recon_demote_census.jsonl` over the corpus (fires ≥1, released-and-wrong = 0);
  class-C fire count OFF vs ON identical on non-currency fields. Flip order: sweep → discount → (never in this arc)
  strict-money.

## 2026-08-31 — keyword_cell_below (oscar Card 3 implementation) — SEND BACK → conditions applied → re-pinned
Verdict: SEND BACK (layer right, wiring clean, guards good for the boxed geometry; the trigger was an
over-broad proxy firing on two everyday NON-boxed layouts, so "ON = only added fills" failed by
construction). Ship-blockers: (1) trigger conflated boxed rows with wide-gap same-line values (junk
adopt/emptying via the next-label continue) and lone stacked captions (88->85 confidence downgrade
across the critical floor - unpinned because the pins used a blank line/colon); (2) currency ignored
the right-ONLY directions contract (bare "Total" = every line-items header; first item-row line-total
adopt @85). Cracks: G4 defeated by one trailing border glyph; G5 bounds-only vs the design's
alignment guard; row not actually dev-gated; dead 'number' limb.
CONDITIONS (ALL APPLIED, commit 829afed): C1 three discriminators (>=2 caption segments · no digit
after the label on its own line · equal segment counts both lines); C2 ref/date only + 'below' must
be in the label's directions (money = its own future slice with a line-items-header guard); C3 bare
the candidate of border glyphs both ends before every guard; C4 re-pin ON==OFF INCLUDING confidence
on stacked/wide-gap/GBP-row/unequal layouts + G4/G3 re-proven on EQUAL-count grids + naive-adopt
load-bearing proof; C5 toggle added to DEV_SWITCH_IDS; C6 realdoc gate wording = previously-non-empty
fields byte-identical incl. confidence, diffs strictly empty->filled, M unchanged, would-file +
corroboration diffs enumerated + adjudicated under the live switch profile, keyword_override-labelled
cell-below rows surfaced. Post-conditions pin: ALL PASS.
## 2026-08-31 — MONEY_SIGN_PARENS/CR (reggie Card 2 build) — SIGN OFF WITH CONDITIONS → applied
SIGN OFF WITH CONDITIONS. Helper + both mints + pin traced correct; seam A verified quiet
(decline-only, no false note; magnitude-blind reconcile maths protect the signed value from the
recon pick); seam B verified with a bonus (arm 3 now holds captured mis-typed credit notes with
the RIGHT value); downstream '-' consumers safe (no filename token, storage/normalise/on-blur
sign-tolerant, no adopt path). BLOCKING C1: the design's own arm-3 co-residency force (the
vat_reg pattern) was named but not built — captures armed without CREDIT_SIGN_COHERENCE leave the
manufactured-minus class (table-rule '(' misread, bled 'CR') silently negative on invoices.
C2 handoff pin, C3 gate wording (the Hard Set cannot reach mixed-sign penny-reconcile — the unit
pin test_reslice_witness.py:123 is the sole guard for seam A), C4 fix the sign-blind-record
rationale in the twin comments. ALL FOUR APPLIED same session: the co-residency force in
_reconcileEnv + test_money_sign_coupling.js source pin; the arm-3 handoff row in
test_money_sign_parens_cr.py; twin comments corrected in both mints; gate wording carried into
the realdoc adjudication. Flip order: captures only with CREDIT_SIGN_COHERENCE (structural via
the force); parens and CR flip independently of each other.
## 2026-08-31 — BUYER_ISSUED_CONVENTION_NOTE (gary lever 1, DARK) — SIGN OFF WITH CONDITIONS → applied
Traced the hook (engine ~:10227), licence, bridge/mig 97/wiring, pin. The note is structurally
strip-proof: every demoter keys on foreign note constants/methods, class F excludes supplier_name
outright and its allowlist is exact write-site marks, and the only _needs_review reset requires no
note remaining; fill-empty letterhead/identifier/logo-detail paths skip a valued row. Review-bound
real: isAutoFileEligible refuses any noted field at every floor incl. 100. Hints reach the engine
unprojected with the document_type SLUG. Rulings: template_fixed_locked exemption RATIFIED; firing
without _suppressed_issuer RATIFIED (bare "TO:" blocks are the hardest for a human to spot; the
licence quenches). CONDITIONS (applied): C1 'logo' ADDED to the method tuple — the clean-accept
logo fill is an un-noted warm path in the design's own risk cohort (buyer known from invoices =
learned logo) and is harness-unreachable, so no gate can catch it; C2 the hook's _needs_review
newly ARMS the deskew review retry (setting ON live) — the realdoc gate runs one arm with
DESKEW_REVIEW_RETRY='0' (provable note-only diff) + one both-ON arm with enumerated diffs; C3
pins: _is_verification_doubt_note False for both wordings + a functional demoter-survival case
with F armed; C4 honest arithmetic — "up to three human confirms per company+type; machine-swept
scopes earn nothing until a human confirms" (hook comment + owner report corrected). Flip only
after the stripped-copy all-7-noted arm (MET same session) and the realdoc enumeration.
## 2026-08-31 — Taught-total occurrence selection (TEMPLATE_LOCATE_ROLE_QUALIFIER, DARK) — SIGN OFF WITH CONDITIONS (design stage; build awaits owner go)
Premise verified at the pixels and the code: _label_score's space-boundary 1.0 makes 'total' a
perfect hit on "Net Total" (template_mapper.py:3629-3650), the floated totals block (two taught
rows 0.035 apart) makes proximity the wrong arbiter, and oracle_log 08-06 had already ruled
taught totals have zero net-vs-gross discipline with only the FLAG shipped. Design = reggie's
shipped stop-vocabulary (reuse keyword._total_role_collision verbatim; 007's any-preceding-word
rule REJECTED — it demotes Grand/Invoice Total, no-ops the fix on the "Net Total / VAT / Invoice
Total" footer, and splits the locator from keyword's own role logic) + 007's placement inside
_locate_anchor with the local-all-qualified→page-wide leg. DEMOTE never veto; all-qualified pages
byte-identical. Two consensus gaps found and conditioned: the confirm_value CARRIERS override
(anchor.py:677-693 passes the drifted rigid money read; carriers at template_mapper.py:3471-3476
would re-select the Net line above the preference — an armed needle's all-qualified carrier set
must fall back to the preferred floor set) and the born-digital twin's missing page-wide leg
(anchor.py:2316-2317). Reslice-sweep seam verified safe by construction (engine.py:4517-4545
requires an agreeing witness on the exact recon note). Gate: RED-first end-to-end Castellan pin
(-1,578.24, sign intact, no note, drift+veto path, app env), divergence pin, carriers pin, twin
pin, vocab-identity pin, Hard Set dual-rendition classes, realdoc-605 OFF==ON byte-identical +
ON-arm full enumeration (would-files, corrob flips, landmark diffs, 0 new wrong totals, M=7),
combined-arm census with the sweep; flag+reconciliation documented as the retained backstop.
Flip order: joins AFTER sweep/discount; never justified by flipping strict-money.
## 2026-08-31 — DB-at-rest encryption (eric+gary consensus) — SIGN OFF WITH CONDITIONS (design stage; slices await owner go)
Premise sound (owner's passphrase ask rightly converted to DPAPI-wrapped key + printed recovery
key; the "identical vs malware" claim slightly overstated — record the honest passphrase
differentiator in pendingfeatures). Divergences settled: hexrekey-on-copy primary, ATTACH+export
deleted; the package ALIAS accepted with packaged-build proof + a runtime name/cipher pin; audit
archives keyed this arc as the final slice (named residual until then); the merge-backup site is
a BLOCKING gate (expected plaintext output — replace with a keyed copy); the recovery ceremony
needs regenerate + explicit ack + a persistent nudge (re-show correctly impossible — no copy is
stored). Ship-blockers found at the seams: secretStore's by-design FAIL-OPEN WRITE would silently
mint a plaintext DB keyfile (the DB key inverts auditKey's availability-over-secrecy calculus —
require a fail-closed write mode, pinned); an empty/short key makes every migration gate pass on
a plaintext output (assert 32 bytes + a negative-control open-WITHOUT-key must fail + header
magic absent); no downgrade tripwire (key present + plaintext sniff + no manifest = loud fail,
never a silent open); the night-run/reset rituals must change IN THE SAME COMMIT as slice 2
(RUN_AS_NODE cannot unwrap DPAPI — an undocumented ritual change bricks the next autonomous run).
Third DPAPI secret → the E44 gate-5b continuity checklist + the stale "only DPAPI blobs" doc
lines corrected. Gates: slice-0 = suites + realdoc-605 byte-identical on the fork + check-licenses
+ a PACKAGED build boot (alias/ABI proof); slice-2 = the full crash-injection matrix (incl.
kill-during-rekey + EBUSY storm) + C2 negative controls + the backup-cipher pin + a DPAPI-loss
drill through the Unlock/Recover window + perf on the owner's real DB + a full app session on an
encrypted copy incl. verifyAuditChain, canStamp and the /v1 client; slice-3 = fresh-install E2E
+ ceremony-nudge + downgrade-tripwire pins. Existing installs migrate ONLY behind the completed
ceremony — never auto-migrate on update. src/database.js confirmed dead — delete this arc.
## 2026-08-31 — TEMPLATE_FRAGMENT_CONTAINMENT_YIELD (Castellan CAD8 ⊂ CAD832694 — the sanctioned successor to the 08-09 Q2 rejection) — SIGN OFF WITH CONDITIONS (design stage; build awaits owner go)
SIGN OFF W/COND (C1-C8). Forks: (A) the 08-09 "can't bolt it on" pin EXISTS
(test_stage05_format_yield.py:22-24/:79-82) but is HELPER-level — this merge leg never calls
_stage05_format_fails on the incumbent, so the pin stays green and would manufacture false
confidence; amend its docstring + trade-off labels to name this switch (helper checks stay
byte-identical), and the arc's own pin carries the mechanical guard. (B) v1 PREFIX-ONLY: the
proven truncation source is _read_inline_box's split()[0] (mapper :1457-1458) which can only emit
prefixes; the endswith mirror has no exhibit + digit-tail collision exposure — pinned trade-off.
(C) NO page-witness leg: the challenger IS a page read (tautological) and "outside the taught
zone" INVERTS the discrimination; v1 = neutral both-values note + review-bound, v2 strengthener =
challenger-token geometry overlap of the taught zone. Premises verified (precedence :8176/:8261;
rb_531 unconditional shape_warn at mapper :1586-1593; 'CAD8' passes the hard reference_code so
format-fail-yield's decline is correct-by-design). Corrections: BLIND_GEOM_DISAGREE_RECONCILE
defaults '1' since 08-01 (the CLAUDE.md "DARK" line was stale — fixed 655f915); the 08-09
prohibition was prose+helper pins only. THE SEAM CAUGHT HERE: "review-bound by construction"
rests entirely on the class-F deny-by-default allowlist — the new note is un-sweepable today but
nothing pinned it; C3 mandates the note NEVER enters _verification_doubt_note_marks (pin
_is_verification_doubt_note(new)==False + a comment at the allowlist), else a future doubt-clear
flip silently auto-files values the taught mapping disputed. Neutral wording mandated (no causal
"cut short" — false in the same-page-longer-code residual, which adopts WRONG-but-noted and is
accepted + named). Currency exclusion ROLE-wise à la class F C2 + the C10/C11 comment. Gates: pin
(exhibit heals; the three 08-09 regression strings never adopt; currency/date/low-conf/short-core
untouched; OFF byte-identical; pin proven to FAIL with the leg deleted); realdoc-605 OFF
byte-identical / ON M=7 unchanged, zero accuracy drop, hold-set leavers enumerated + eyeballed;
Castellan five as fixtures; a clipped-code class into gen_hard_set. Hold-with-fragment becomes
hold-with-full-value; no new silent file on any traced path.
## 2026-08-31 — DB-at-rest encryption: KEY-MODEL CHANGE to code-as-passphrase (owner-directed; revising the same-day dual-wrap sign-off) — SIGN OFF WITH CONDITIONS
Premise CORRECT and simpler than as-built: raw-hexkey + DPAPI/argon2 dual-wrap can't meet the owner's
"DB backup + printed code resurrects on any PC" (the key is in the sidecar, which backupService never
exports). Passphrase mode (salt-in-header KDF, code = 125-bit key material) meets it with no sidecar;
at-rest security is EQUIVALENT (no key in the file; only attack = 2^125 through the cipher KDF — answered
the owner's "strip the key" Q directly). Honest trade recorded: argon2id(64MB)→PBKDF2, safe ONLY for a
125-bit RANDOM code — guard against a future user-chosen DB password. Seams caught: (1) the whole premise
(salt-in-header portability) is pinned NOWHERE — every existing test runs in one dir with a raw hexkey;
demanded the db-only-to-fresh-dir open-by-code pin. (2) MOST-WORRIED: passphrase representation
convergence — display-vs-normaliseCode mismatch across rekey/cache/open silently BRICKS the DB and passes
a naive same-form pin; mandated normalise-at-boundary + a cross-form round-trip pin. (3) the owner's
PRIMARY case (absent .db-key + ENCRYPTED header = restored backup) is unhandled — loadKey()==null today
also means "fresh plaintext"; demanded a startup decision table (row 4 = prompt for code, never
plaintext-open). (4) rekey refused in WAL (the tool's own comment) — migration must journal_mode=DELETE
before rekey + clean -journal + re-run the crash matrix with a kill-DURING-rekey injection. Pragma swaps
specified: seam key=; migration hexrekey→rekey/verify key; export-plain hexrekey=''→rekey=''; do NOT
cache the derived key (re-introduces raw key at rest). Eliminating .db-recovery loses no safety but makes
"regenerate" a full DB rekey (accept/defer). Combined admin+DB recovery dialog: cryptographically
independent (admin code hashed in-DB + rotates; DB code static passphrase) — acceptable with distinct
labels, rotation caveat, and explicit single-point-of-capture acceptance. 10 conditions; gate = rewritten
pins + realdoc-605 OFF byte-identical/ON zero drop + portability pin + DPAPI-loss drill (admin-reset AND
new-PC) + crash matrix under rekey. Docs (arc + dbKey header) must be rewritten so no one restores the sidecar.
BUILD STATUS 2026-08-31: crypto core rewritten to passphrase mode + all pins green under E44 (dbKey 16,
cipher 10 incl. portability, migration 18 incl. kill-during-rekey + portability, secretStore 14). Remaining:
whenReady wiring + Unlock window + the combined activation dialog + slice-3 tripwire + the owner-machine gates.
## 2026-09-01 — THREE ROLLOUT FEATURES (quiet_reread_silent · sweep_inview_countdown · accept_field_chars_enabled; gary+reggie+eric consensus) — SIGN OFF WITH CONDITIONS (all applied; mig 102 DARK → mig 103 default-ON)
F1 renderer-only defer of the quiet-lane list refresh (flush on nav/confirm/focus; premise corrected —
it does NOT fix the 60s presence-TTL leak, which stays open); F2 replaces the being-viewed hard block
FOR THE SOLE LOCAL DESKTOP VIEWER only via a NEW key-aware presence.onlyViewerIs (the username-based
_onlyMe admits same-user-second-machine), 5→1 countdown + Stop→markPutBack, expiry re-checks
setting/viewer/fingerprint/eligibility then files via the ONE confirm writer; the inviewCountdown
verdict carries no .candidate so _sweepAcceptCore can never silently file it; cancel-on-edit
synchronous; keep sweep_retrigger_on_view_release dark (same seam, don't enable both). F3 charset
accept: restore the field's OWN pre-cap confidence (new extractions.charset_flag_meta {chars,precap} —
the 08-15 fc_delta lesson: a note-clear without the restore is cosmetic), JS overall recompute as a
faithful LOWER BOUND (no boost, no exclude_keys, max(stored,·) — proven ≤ a real reprocess), garble
guard = printable-ASCII-punctuation-only acceptance (rejects every homoglyph class incl. U+2010/2212
+ U+FFFD without a confusables table), legacy meta-NULL rows hold (no recompute), sibling auto-file
via the NORMAL sweep offer path (C8 — never a bespoke filer). Pins: accepted-chars py 11 · charset
service 26 · onlyViewerIs; OFF byte-identical; owner-run before flip: realdoc-605 M=0 + the F3
reprocess-agreement arm. mig 103 defaulted all three ON for the rollout (owner order).
## 2026-09-01 — WATCH PARITY (watch folder through the same import pipeline + comprehensive error logging; eric+gary consensus) — SIGN OFF WITH CONDITIONS, RE-STAGED; Slice-2 proc-registry mechanism SEND BACK
Premise understated three PRE-EXISTING watch bugs that outrank separation: (1) no async spawn-error
handler (the 08-31 uncaughtException crash class, unfixed on watch); (2) no RAM/OMP caps; (3) watch
omits _ocrDpiEnv — a SILENT DPI/accuracy parity break (watch read at a different DPI than import).
Mandated staging: Slice 3 logging → 1a hardening → 1 separation (DARK) → DEFER the shared-core
refactor. SEND BACK co-mingling watch procs into _currentBatchProcs (process-folder wholesale-resets
it → orphans live watch procs; use a separate _watchBatchActive counter when the refactor comes).
Separation must run IN THE WATCH FOLDER over the EXPLICIT stable set (resolves the BLOCKER-2a
strand/re-import objection); the _tracked pre-mark must be race-safe (poll blocked for the whole
separation span); wrong-boundary clean-split can auto-file (corpus can't reach it) → freshly-split
WATCH segments held for review (owner fork, taken); error logging: always-on line = stage·type ONLY
(logger scrub misses bare filenames + value-bearing exception text — both leak), full detail →
diaglog, traceback NEVER to the always-on log; stage tracker in the orchestrator (engine byte-identical).
BUILD 2026-09-01: slices 3+1a+1 shipped (20eca32, 5b06132, f50afa5, 29adce2), pins 13+16+10 green,
watch_separate_enabled DARK; Slice 2 deferred as its own arc.
## 2026-09-01 — CHRIS r-09-01 FIXES (stale garble ripple after correction + clipped-teach overwrite; eric design) — SIGN OFF WITH CONDITIONS (build awaits owner go)
F1: teardown-on-input (named helper, ALSO called from _applyTeachValue which emits no input event) +
_updateSenderFieldsBtn from the input handler + a plausibility guard at offerIssuerRipple's head +
defence-in-depth refusal in apply-issuer-ripple. Premise trimmed: the blur doorway already self-heals
most paths — the stale bar survives only retype-of-dataset.original / bulk / mid-edit; the teardown is
the fix, the predicate is defence-in-depth (NOCUMENT-class single-token garbles PASS the predicate by
the BP/IBM immunity — don't claim the class closed). C1 BLOCKER the server-side refusal must itself
read teach_issuer_plausibility_warn (the IPC gate doesn't cover a direct learning.* call); C2 BLOCKER
scope the F2 write-guard to supplier_name ONLY (the predicate's FP profile is unmeasured on
address/customer keys AND speakIssuerTeach only runs for supplier_name — elsewhere the decline would
silently lie); C3 teardown from _applyTeachValue; C4 amend the warn-only contract comments + annotate
test_issuer_plausibility as load-bearing; C5 ONE checkIssuerRead result threaded; C6 refusal returns a
reason surfaced on the bar; C7 decline-path hygiene (no corrections write/.corrected/note churn on a
declined junk read — atomic decision); C8 the teardown is NOT behind the kill switch. Gate: pure-module
pins both polarities (one must FAIL pre-fix) + source-contract test (dead-guard trap) + realdoc
byte-identical BY CONSTRUCTION (renderer/confirm-time; state in the commit) + a Chris re-verify of both
exhibits + OFF-arm smoke.
## 2026-09-01 — QUICK REPROCESS (owner ask: full vs quick Reprocess All reusing the first pass; gary design) — SIGN OFF WITH CONDITIONS C1-C7 (build awaits owner go)
Premise corrected twice: Reprocess All ALREADY reuses cached ocr_text (manifest :4551) — the real cost
is render + per-field crop OCR; the true "half run" is the sanctioned imageless --reextract, batch-wired.
gary's destructive-seam find CONFIRMED (applyReprocessResult plain-assigns template_id/logo_phash/
detail_hash → an unguarded imageless merge WIPES stored identity) but his list was incomplete (also
overall_confidence + the _supBlanked supplier-NULL arm) and one claim internally FALSE (legacy NULL-stamp
docs would NEVER self-heal — Full reuses cached text too, so they'd never earn a stamp). Architecture
signed: per-doc documents.ocr_recipe STAMP (not a watermark; {dpi,light,bd,bd_used,rev+tesseract-version},
emitted ONLY when full-page text was PRODUCED this run), ONE ocrCacheUsable module at the three hand-offs,
Quick = reprocess-batch partitions by the predicate → --reextract shard + silent per-doc Full fallback,
DARK quick_reprocess_enabled, no hybrid/early-exit in v1. BINDING: C1 a contested keep (stored image-family
value vs a differing fresh text read) EXCLUDES the doc from that run's consent offer + scope auto-accept
(else Quick silently FILES what Full would HOLD — the trust_role_disagreement_refuse doorway never sees
the dissent; the realdoc "zero value divergences" tolerance is blind to it by construction); C2 stored
template binding WINS — fresh identifyByFingerprint fills only null-template + blank-supplier-unpin
(mirror _reextractFastCore exactly; a JS flip has MORE authority imageless than under Full); C3 the
Quick-batch Full-fallback shard OMITS manifest ocr_text so a NULL/stale-stamp doc gets ONE honest re-OCR
that earns its stamp (makes self-heal true + finally delivers the 08-27 light-text flip-heal condition;
its text diffs are a named census arm); C4 preserve the PRIOR overall_confidence when the imageless guard
kept >=1 stored row (the imageless engine scores kept mapping reads as 0 → mass-hold on the best-taught
suppliers); C5 the Quick-vs-Full gate compares BINDINGS (template_id/supplier/type), hold sets,
isAutoFileEligible + would-file parity + Quick idempotence — not just values; C6 tesseract version
mechanically in the recipe, runtime-actual values, rev bump-checklist + cross-language pin that FAILS on
a one-sided bump; C7 pin the imageless merge never NULLs a stored supplier. Deviating from C1-C4 = back
to the Oracle. auto_rotate correctly a NON-invalidator (rotation baked into the working copy at import);
Quick honestly cannot mint a logo identity or run pixel heals (held, never silently wrong).

## 2026-09-03 — FORMAT_VARIANCE_RELAX_REF_INLINE (box-drift disagreement flag, exact confirmed literal)
Verdict: **SIGN OFF WITH CONDITIONS.** `_pick_fuller_code:1625` `inline_disagree_flag` is a SECOND choke
point minting the "manually mapped value differs" note that BYPASSES `_gate_value` — the parent arc
(mig 107) could not reach the Print Tracker exhibit (doc121: rigid box garbage `10RARNNNAD`@44, inline
recovered `1984800049`@96, flagged the disagreement). Fix = same C1a exact-confirmed-literal predicate at
that site → commit CLEAN. Premise + completeness verified at source (only `:1625` bypasses `_gate_value`;
`:1820`/`:1895` carry the parent arc via `_gate_value`, `:1952` read-only). BINDING conditions:
(1) **rigid-credibility guard** — never drop the flag over a CREDIBLE competing rigid read (`rigid_conf`
present AND < 70); closes R2 (a credible box read of THIS doc's own value losing the conf-race to an
inline reading a DIFFERENT confirmed serial → wrong-device auto-file); doc121 rigid=44 unaffected.
(2) pin the R2 negative + the doc138 letter-O near-miss + the doc121 heal. (3) census asserts each
clean-commit == that DOC's OWN prior-confirmed value (not "any literal"). (4) WARM-DB census,
machine-confirm-excluded, realdoc M=0. Sibling flag (independent kill/census), default OFF.
Built `238e13a` (all 4 conditions honoured; guard floor 70) + test force-ON `cd1121f` (mig 110). Pin
`test_pick_fuller_code_literal.py` 16/16.

## 2026-09-03 — FILING_SANITY_REF_CORROB_SOFTEN (Gate-C absent-note → truthful soft note on a corroborated confirmed literal; reggie+gary+main)
Verdict: **SIGN OFF WITH CONDITIONS (C1 ship-blocking).** Gate C's "'752…' doesn't appear on this page as
written" false-alarms doc196 (crop+mapping read the confirmed literal `752…`; full-page pass slipped one
glyph to `782…`; `5↔8` unbacked so v2 can't heal). Ledger final at Gate C (last `_remember_candidates`
:9401; post-Gate-C append :4654 TOTALS-only; ref winner immutable) ⇒ on-demand `_build_corroboration_emit`
SOUND. **C1 (ship-blocker):** do NOT ship plain `_absent=False` (auto-files the FILENAME token over the sole
whole-page reader — crop+mapping on a boxed ref are the same LOCATED BOX, the documented "two preps agreed
on wrong P1" 5:1 same-pixel class; the mirror true=`782` minority / crop+mapping common-mode `8→5` to
confirmed-literal `752` is geometrically identical to doc196 and undistinguishable; variance-relax already
dropped the shape-cap so Gate C is the LAST checkpoint). Take the INLINE credibility-guard analog OR keep
review-bound. **OWNER CHOSE review-bound (lighter checkpoint).** IMPLEMENTED = Oracle §6 fallback: replace
the scary absent-note with a TRUTHFUL non-alarming note, keep it review-bound (a note still blocks auto-file
in trust.js — so auto-file behaviour is byte-identical; the mirror is HELD with an honest "we read 752 here,
782 elsewhere — confirm which" note, never silently filed). C2 keep clauses 3 AND 4 (orthogonal — a longer
clip-container can coexist with a same-length one-glyph variant). C3 exactly-ONE glyph, prefix NOT barred
(doc196 slip at index 1) but that admission is safe ONLY because clause 2 (exact confirmed literal) holds —
pin the coupling. C4 read `emit.get(ref_field_key)` only. C5 gate: RED-first MIRROR pin (true=782 ⇒ held,
never auto-filed) + heal doc196 (soft note) + CLIP still scary + never-confirmed still scary + uncorroborated
still scary + Gate A/B untouched + fail-closed on FIELD_CORROBORATION_EMIT=0 + source-order pin (:9401
last-writer, :2947 blind-geom scope); census scored against INDEPENDENT GT (the "own prior-confirmed value"
criterion is circular) with prod flags asserted (`learning_exclude_machine_confirms`+`autofile_gate_unify`
ON); realdoc M=0 (auto-file unchanged by construction). Mig 111 (109/110 = the INLINE sibling). Separate kill
switch, DARK. Oracle caught: corrob "independence" is same-located-box for this geometry; census circularity;
the machine-confirm-exclusion dependency.

## 2026-09-04 — SINGLE-GLYPH REF RESOLVER (edit the filename token from corroboration; oscar+007+reggie) — SIGN OFF WITH CONDITIONS (v1 = leg-b only, review-bound, DEFAULT OFF; leg-a + re-slice + auto-file DEFERRED)
Fork: build leg-b `unambiguous_near_miss` ONLY, co-located at the existing near_miss_confirmed site (engine.py:10194) so it INHERITS that block's min(conf,70) cap; defer leg-a per-position majority + the re-slice witness + every auto-file relaxation to a census-gated Phase 2.
Premise OVERSTATED (verified at source): arms D(:4042)/E(:4070)/P `_try_prefix_confusable_adopt`(:4310) ALREADY edit a ref from corroboration + pop the note — held by a CONFIDENCE CAP (≤84/69/70), not a kept note; near_miss_confirmed(:10196) ALREADY suggests the confirmed literal (corrected_to+note, capped 70). So leg-b's v1 delta is only PRE-FILL vs SUGGEST — thin unless co-located to reuse the cap AND it hardens the suggestion (refuse the ambiguous ball — the best_n trap).
BELT+SUSPENDERS (catch no specialist made): the resolver must ALSO cap ≤70 so the 88 critical floor is a 2nd gate independent of the note (reggie's "keep note" is a single thread). Note-CLEARER audit (the real threat surface, traced ALL): engine arms A–P each note-TEXT-gated (F = exact/prefix allowlist :1848-1861), JS classFixService.CLEARABLE_NOTE_MARKS (4 substrings + namesOldValue/witnessed), reprocess idempotent; _resolve_corroborated_notes(:11023) runs AFTER :10194 → a NOVEL mark survives all → trust.js blocks auto-file on any note (:1063-1073). SOUND but fragile → PIN in Python+JS that the mark is non-sweepable.
Q3: do NOT re-base the soften (note-only/review-bound; over-count harmless, its MIRROR pin is the guard) — separate pixel-source counter for any future leg-a. Residual (HYPOTHESIS, not in corpus): leg-b CAN mis-snap a NEVER-confirmed real serial one BACKED-glyph from a lone confirmed literal (doc196 SAFE: read∈C + 8↔5 UNBACKED). v1 holds it review-bound naming both forms; auto-file needs a CONSTRUCTED adversarial census vs INDEPENDENT GT (never the circular "edit==a confirmed value"). Mig 113, DARK. Gate: RED-first pins (leg-b heal / 752-782 refuse-both / read∈C refuse / unbacked refuse / short<10 refuse / no-counts refuse / doc196 held / bilingual non-sweepable-mark + edited-value-still-noted-after-clearers / ≤70 cap holds below 88) + realdoc M=0 + OFF==ON byte-identical.
