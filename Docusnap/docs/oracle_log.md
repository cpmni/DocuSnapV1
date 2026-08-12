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
