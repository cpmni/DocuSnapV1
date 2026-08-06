# HANDOVER — 2026-08-09 (cont.) — format-fail-yield REDESIGNED (gate GREEN) + Your-PO label gap shipped

**Branch** `feat/reprocess-throughput-autostraighten` · **HEAD `e656329`** · continues `HANDOVER_2026-08-09.md`
(same arc). Two DEFAULT-OFF slices shipped, both gate-proven, **both await OWNER FLIP**. NOT pushed.

---

## TL;DR
Executed the 08-09 NEXT ACTIONS. (1) The gate-FAILED `TEMPLATE_FORMAT_FAIL_YIELD` was REDESIGNED and now
gates GREEN with the ref regression GONE and po_ref +29. (2) The "Your PO" shipped-label recall gap (lead #2)
is shipped as `CUSTOMER_PO_LABELS`. gary → Oracle → reggie all consulted; the corpus gate + doc-level
monotonicity + realdoc M-check are the arbiters and all pass.

## Commits (on top of 08-09's `e335cb7`)
- **`1bea059` feat(ocr) — TEMPLATE_FORMAT_FAIL_YIELD REDESIGN** (supersedes the failed `fcc0d5b`). Default OFF.
- **`e656329` feat(ocr) — CUSTOMER_PO_LABELS** ("Your PO"/"Customer PO"/"Cust PO" → po_number). Default OFF.

## What the redesign changed (engine.py `_stage05_format_fails` ~1949, merge ~5291, floor 1942)
The 08-06 helper keyed on the `_shapewarn` TAG (L1) + a learned-shape veto (L2). Root of the ref −1.0
regression: a CORRECT taught ref shapewarn'd on a thin shape → L1 fired → the challenger side used the LOOSE
`alphanumeric` pattern (re.search) so garbage keyword reads ("The"/"Tel 01632…"/"25-07-2025") passed → garbage
adopted. po_ref 0-fire: the seeded "Your PO" inline challenger is **conf 85**, below the old floor 88 (the
handover's "conf 93" was the shipped `po_number` field, not the corpus `po_ref` — a stale premise; the SAMPLE=60
trace corrected it).
REDESIGN (gary → Oracle SIGN-OFF-W/COND): a PURE, DETERMINISTIC content check.
- REF-FAMILY (incl. `po_ref`/`job_ref` via a LOCAL `endswith('_ref')` predicate — the global `_is_ref_field`
  misses them and broadening it hits ~6 call sites incl. two safety gates) judged by the HARD, digit-bearing,
  anchored **`reference_code`** pattern + a full-date guard.
- CURRENCY keeps strict L3 (leading-glyph + `parse_amount`).
- **L1 + L2 DROPPED** (sanctioned deterministic-content category, not a learned-shape veto; removes the
  `_make_format_lookup` query). Floor **88→85**. Swap unchanged: cap 88 + validation_note → Review (fail-safe
  at trust.js:466).

## Gate evidence (the arbiter — the previous design FAILED here)
NEW DOCS STABLE TYPE, SAMPLE=300 SEED=7 both, TEACH, `TEMPLATE_FORMAT_FAIL_YIELD=1` vs `new_teach`:
```
lane      teach   ffy2   delta   doc-level T->F / F->T
ref        80.2   82.6   +2.4      0 / 7      (was -1.0 on the OLD design)
po_ref     51.4   80.6  +29.2      0 / 21
total      29.6   30.6   +1.0      0 / 2
account_no 29.2   29.5   +0.3      0 / 1
date/issuer/customer/type/job_ref/vat_no  FLAT   0 / 0
```
**Doc-level MONOTONIC — 0 T→F on EVERY lane** (Oracle condition 2; swap set ⊂ improvements). Baseline saved
`stress_test/out/customer_score_new_ffy2.{md,jsonl}`. Realdoc (632 confirmed, flag ON) **M-set IDENTICAL to
OFF baseline (17==17 pre-existing skew/OCR/poison floor, M_type 0)**. Pin `test_stage05_format_yield.py`
rewritten (26 green). Oracle log updated (`docs/oracle_log.md`).

## CUSTOMER_PO_LABELS (keyword.py ~954, mirrors PO_ORDER_NO_LABELS)
Adds `["Customer PO No","Customer PO Number","Customer PO","Cust PO No","Cust PO","Your PO No","Your PO
Number","Your PO"]` to po_number behind the flag, No-suffix first (Larkspur rule). Value gates unchanged
(PO_REF_DIGIT_GATE + alphanumeric). EXCLUDED (reggie): the "Your Order" family (pre-existing son double-fill —
"our"⊂"your", `Our Order No` has no leading boundary) and "Your Ref" (too generic). Realdoc M=17==baseline,
M_type 0. Pin `test_customer_po_labels.py` (13 green). **NOTE the field-presence dependency:** the default
Invoice type has no po_number field, so the flag is inert there until that type carries po_number OR the
dedicated customer_po_number field lands (pendingfeatures). The Customer-corpus can't measure the gain (it
models po_ref as a separate seeded field).

## OWNER ACTIONS
1. **FLIP decision (both DARK):** `TEMPLATE_FORMAT_FAIL_YIELD` (teaching-never-hurts, +po_ref/+ref/+total,
   monotonic, M-safe) and `CUSTOMER_PO_LABELS` (real-world "Your PO" recall). Both byte-identical OFF; bridge
   via `handler.js _reconcileEnv` + a Settings toggle when flipping (as the prior dark flags).
2. `git push` (2 commits, NOT pushed).

## NEXT (deferred — see pendingfeatures.md 2026-08-09 cont.)
- The po_ref/total residual is now proven a **READ-layer** problem (format-VALID wrong values: clipped-prefix,
  magnitude/sign) — the taught box must relocate/adapt. A separate gated arc; the merge-layer fuller-code swap
  was rejected by gary+Oracle (pinned OUT).
- Dedicated `customer_po_number` cross-reference field (clean model for CUSTOMER_PO_LABELS).
- "Your Order" po_number labels + the son `Our Order` leading-boundary fix (separate slice).

## Pad-window CODE slice — RESOLVED 2026-08-06 by the LABELLED sub-slice (read this box first)
> **STATUS: the "OFF-TARGET" problem described below is FIXED.** The corrected fix was designed
> (gary), adversarially vetted (Oracle, SIGN OFF W/COND C1..C7), built DARK and gated GREEN.
> - New sub-flag **`TEMPLATE_PAD_WINDOW_CODE_LABELLED`** — a STRICT SUBSET of `TEMPLATE_PAD_WINDOW_CODE`;
>   both default OFF, both now bridged from Settings via `handler.js _reconcileEnv`
>   (`template_pad_window_code` / `template_pad_window_code_labelled`). **The parent had NO bridge before,
>   so it was never actually owner-flippable.** App RESTART to load the bridge.
> - **Gates:** sweep REPEATS=3 → #625 `-48009` → `PO-48009` in ALL 3 repeats, 0 regressed, 0 false flags,
>   0 bad swaps · Customer corpus 288 docs → 0 doc-level T→F, every lane byte-identical, 0 auto-file
>   losses on correct values, 6 fires all on already-wrong values · realdoc armed == baseline (M=15,
>   M_type 0) · 34 pins green.
> - **The measured blast radius: 7 labelled+code mappings; label-less+code = 0** — i.e. the ORIGINAL
>   parent slice was inert on this install and could never have fired regardless of the premise error.
> - **The mechanism behind the R5 decline was NOT what the section below says** (see "THE REAL BUG"):
>   it is not that the label OCRs poorly in general. For needle `'order no.'` the FOOTER prose scores
>   **0.875** on `_label_score`'s partial-credit branch and BEATS the true caption's **0.75** (OCR read
>   `Order`→`Orden`). The `if needle in haystack: return 0.0` guard does NOT fire because `'number'`
>   begins `n-u`, so `'order no'` is genuinely not a substring of `'order number'` — **two reviewers
>   misread this; check it before rebutting.** Filed as a separate larger lever in `pendingfeatures.md`.
> - Full reasoning + all 7 Oracle conditions: `docs/oracle_log.md` 2026-08-06 entry.
> The historical account below is kept verbatim for context — treat its "REAL BUG" line as superseded.

## Pad-window CODE slice (TEMPLATE_PAD_WINDOW_CODE) — BUILT, DARK, but OFF-TARGET (premise error) — DO NOT rely on it yet
Owner asked to extend the date-only pad-window read to CODE fields (the read-layer residual). Built + gated,
BUT a verification error mis-targeted it — read the whole story before touching it:
- **Commits after 1c25e10:** `template_mapper.py` (helpers `_read_pad_window_code` + `_maybe_pad_code` + flag
  `TEMPLATE_PAD_WINDOW_CODE`, call at the abs-commit site ~1780), `tests/test_template_pad_window_code.py`
  (17 pins green), `stress_test/crop_recipe_sweep.js` (the reusable crop A/B harness). All DARK / byte-identical
  off. Corpus gate: PAD_WINDOW_CODE **0 change / M=0 / 0 T→F** (safe). Realdoc NOT re-run (inert).
- **THE PREMISE ERROR (mine):** I told gary+Oracle the Larkspur `po_number` box is "pure absolute, label-less"
  — read from a NON-EXISTENT column (`anchor_label`). VERIFIED AT SOURCE the real column: `template_field_mappings.anchor_text
  = 'Order No.'` — **the box IS labelled.** So the slice, scoped by Oracle to LABEL-LESS boxes (`not anchor_text`),
  **never fires on Larkspur** → the crop sweep showed **0 recovery**. gary+Oracle's design is sound for a genuinely
  label-less box; it's the targeting that's wrong.
- **THE REAL BUG (traced):** the labelled box's recovery ladder `_inline_code_reconcile` (template_mapper.py:1006,
  ON by default) RUNS and returns **None** on the clip (trace: #625 abs=`-48009`, anchor `Order No.` located,
  rc=null). It depends on cleanly LOCATING `Order No.` + reading the inline value; on the marginal siblings the
  label OCRs poorly (the padded probe read the label region as just `". "`), so the clipped abs box wins. This is
  a DIFFERENT bug than the slice was built for.
- **THE CORRECTED FIX (evidence-backed, NOT yet built):** DROP the `not anchor_text` scope on the `_maybe_pad_code`
  call. It sits at the abs-commit point, which is only reached AFTER `_inline_code_reconcile` already returned None
  (`if rc is not None: return rc` first). So firing pad-code there — regardless of anchor_text — does NOT override
  a healthy reconcile (the reconcile already gave up); it backstops it. And pad-window is GEOMETRY-only (pads the
  box, re-reads) so it doesn't need the flaky label locate. NEEDS: Oracle re-vet on the CORRECTED premise (the
  label-less scoping was to avoid overriding a healthy reconcile — moot at the post-reconcile position) + re-gate
  on crop_recipe_sweep.js (should then actually recover on Larkspur). Owner was about to switch to Opus; this is
  the bookmark to revert to if the re-scope goes wrong.
- **GROUND TRUTH for the sweep:** Larkspur PO po_numbers #625 PO-48009 #630 PO-91914 #632 PO-82956 #635 PO-19649
  #637 PO-40351 #638 PO-60906 #639 PO-41508 #640 PO-90621 (encoded in crop_recipe_sweep.js DEFAULT_GT; #637/#640
  recovered from a padded PIL probe). The harness CANNOT bit-reproduce the app's marginal clip (which doc clips
  shuffles run-to-run; DPI ±1) — recovery is directional + owner-watched, same as the date slice.
- **Owner has ALL 22 crop-recovery flags ON already** (the sweep reads them from settings) — the existing
  machinery is exhausted on this marginal box; that's why a new backstop is needed.

## Gotchas reaffirmed
- **VERIFY SYSTEM STATE AT SOURCE (working rule #6).** The `anchor_label` vs `anchor_text` column error above cost
  a full build aimed at the wrong class. The template mapping column is `anchor_text` (the label phrase);
  `anchor_label` does not exist. Query the DB, don't infer "label-less" from a wrong column.
- Corpus field key is `po_ref` (seeded label "Your PO", type reference → validates loose `alphanumeric`);
  `_is_ref_field('po_ref')` is FALSE ("ref" ≠ "reference"). This is why the redesign needed the local
  `endswith('_ref')` predicate + the `reference_code` gate (loose alphanumeric passes "Account").
- Realdoc gate is `armed==baseline` (a ~17 pre-existing silent/skew/poison floor), NOT absolute M=0.
- `CLAUDE.md` + `test_template_target_word_snap.py` carry PRE-EXISTING owner modifications (M at session
  start) — left untouched, not staged.
