# Flip census — 2026-09-21 night (batch, @ HEAD mig 198)

Autonomous night run. Corpus: a migrated copy of `Desktop\Flip Corpus 700\warm_700.db` (163→198), 400
learning-excluded test docs. Baseline = `RR_APP_ENV=1` (the faithful operating point). Switch lever = SHELL
ENV (uppercase key). Method + comparator reused from `flip_corpus_20260912/rerun_20260916/`.

Baseline health: **187/400 would-file**, M_type 0 — matches the deterministic 09-16/09-19 baseline shape.

## Design of the run
Two UNION arms (batch safety + fire detection), because the 45-key dark list is mostly geometry/OCR arcs the
synthetic corpus can only SAFETY-test (the 09-19 night already found "the corpus is exhausted for the remaining
switches — safety-only"). A union that changes nothing proves no subset fires; a union that changes something is
then attributed by per-switch isolation.
- **HEAL arm** = every still-OFF reading / reference / date / geometry / restriction switch ON together (37).
- **FRICTION arm** = the 3 auto-file looseners ON together (`optional_soft_flag_autofile`,
  `corrob_autofile_band88`, `filing_sanity_confusable_prefix_autofile`).
- **Excluded (logged, NOT censused):** `format_class_join` (known wider blast radius — needs a code look),
  `segment_pair_hold` (needs the C12 Rejoin button first + is segmentation, inert on single-doc realdoc),
  `deskew_corrob_autofile` (owner's call). Also inert in realdoc by nature: `departments_enabled` (feature
  master), `ref_badge_verify_state` (presentation-only), `sweep_inview_recheck` (UI), `quick_reprocess_enabled`.

## HEAL union vs baseline — **M = 0** (safety PASS)
- **6 HEALS** (wrong OFF → correct ON), all reference/date clip-recovery:
  - #14 credit_note date `42-11-2025` → `12-11-2025` [keyword] (a clipped leading digit yields to the keyword date)
  - #40 invoice ref `# CAS508205` → `CAS508205` [template_mapping] (stray `#`/shape-warn cleared)
  - #487 statement ref `A-229` → `A-2291` [template_mapping_readwiden]
  - #610 sales_order ref `SO-1950.` → `SO-19503` [template_mapping_readwiden_edgecut]
  - #612 sales_order ref `SO-5878` → `SO-58788` [template_mapping_readwiden]
  - #616 sales_order ref `SO-9106.` → `SO-91065` [template_mapping_readwiden_edgecut]
- **file→hold: 0** · **hold→file: 1** — #434 credit_note `flagged → ok`, ref+date BOTH correct (the readwiden
  fix of its `ACC-229]`→`ACC-2291` account_no cleared the flag → a correct auto-file, not a wrong one).
- 11 field value changes, ALL improvements (readwiden fixing clipped account_no/statement/SO numbers; #457
  customer_name `BILL TO`→`CH1 2HU`+nonname_flag — a non-filing field, held). 1 note change: #656 a false
  "doesn't appear on this page" → truthful "confirmed on the straightened page — confirm once" (still held).
- **Verdict: the HEAL batch is SAFE (M=0) and the code-widen / edge-clip / date-clip family FIRES cleanly**
  (6 heals, 0 wrong, the one new auto-file correct). Attribution → the isolation arms below.

## FRICTION union vs baseline — **M = 0**, 0 wrong new auto-files
- 0 value changes, 0 note changes, file→hold 0, **hold→file: 7** — #193 quote, #434 credit_note, #499
  credit_note, #512/#515/#516 delivery_note, #585 invoice — **every one with ref=true AND date=true** (the
  filing-critical fields correct in all 7). The looseners lifted a soft/optional or corroborated-band hold on
  docs whose ref+date were already right. **0 wrong auto-files** → the friction-group bar is met at the union.

## Per-switch isolation (to attribute a flip to ONE switch) — PENDING
Running `isolate_run.sh`: `template_code_read_widen` (readwiden), `template_edge_clip_heal` (edgecut). Results
appended below when the arms finish.

| switch | mig | M | heals (GT-correct) | file→hold | hold→file | verdict |
|---|---|---|---|---|---|---|
| **template_code_read_widen** | 141 | **0** | 4 (#487 `A-229`→`A-2291`, #610 `SO-1950.`→`SO-19503`, #612 `SO-5878`→`SO-58788`, #616 `SO-9106.`→`SO-91065`) + 3 account_no clip fixes | 0 | 1 (#434, ref+date correct) | safety PASS + real GT-correct fires |
| **template_edge_clip_heal** | 151 | **0** | 1 (#612 `SO-5878`→`SO-58788`) | 0 | 0 | safety PASS, narrow fire |

Both isolate to **M=0 with GT-correct heals and no wrong change** — the strongest flip-candidates in the batch.

## Flip decision — **0 flips tonight; logged as flip-ready-candidates for the owner**
The census clears the plan's batch bar (M=0 + real fires + only heal/correct-file). BUT each firing switch's
OWN named flip gate (`docs/oracle_log.md`) is stricter than this synthetic run and is NOT met by it:
- **template_edge_clip_heal (mig 151)** — Oracle SIGN-OFF-WITH-CONDITIONS C1–C7; the flip VERIFICATION GATE
  explicitly requires the **605 REAL corpus** + a **pixel-adjudicated adversarial fire census** (hand-verify
  recovered==page truth) + code-guard conditions (C5 the 88-floor relax must require `_corrobLicensedKeyword`;
  C6 ISSUER → FLAG tier only). A synthetic 400-doc M=0 does not discharge C1–C7.
- **template_code_read_widen (mig 141)** — its `dark_switches.js` flip gate names the **605 corpus + Oracle**;
  no Oracle *flip* sign-off is on record. Same shortfall.
- **FRICTION group** (7 correct held→filed, 0 wrong) — changes AUTO-FILE behaviour (higher stakes) and each
  carries named preconditions (`optional_soft_flag_autofile` needs the `_flaggedSoftAware`/lane-hold-never-soft
  code precondition; `corrob_autofile_band88` needs a reach census + both-ON-with-mig-142 gate).

Auto-flipping any of these as a customer default would skip the advisor/Oracle gate they were held behind — the
"non-DARK customer-default = approval-class / dangerous → stop the item" line of the autonomy protocol. So they
are **LOGGED for the owner** with this evidence (mirrors the 09-12 "flip-ready, logged for morning" precedent).

**Recommendation to the owner:** the **code-widen / edge-clip family** (mig 141 + 151) is the strongest
candidate — synthetic M=0 + 4/1 GT-correct ref heals, no wrong reads, review-bound. To flip it, run its named
605-corpus + pixel-adjudicated adversarial fire census (its build conditions look satisfied in code; confirm
C5/C6) → Oracle → flip. The FRICTION group is safe on this corpus (0 wrong auto-files) but is a bigger behaviour
change; treat separately.

**Net for the remaining dark list:** the batch is SAFE at HEAD (M=0 across a 37-switch union), which is itself a
useful assurance that the whole built-but-off pile would not misfile on this corpus. The corpus stays "efficacy-
exhausted" for the geometry arcs (they need real exhibits), consistent with the 09-19 finding.
