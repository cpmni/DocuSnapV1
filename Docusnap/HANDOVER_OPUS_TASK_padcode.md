# TASK BRIEF (for the next session) — fix the Larkspur `po_number` PREFIX CLIP

> Scope is ONE task. Do not expand it. Read this whole file, then the "READ FIRST" list, before touching code.
> Start point / revert bookmark: git tag `bookmark-2026-08-09-padcode` (commit `95e400d`), branch
> `feat/reprocess-throughput-autostraighten`, pushed to origin. `git reset --hard bookmark-2026-08-09-padcode`
> returns here.

---

## THE ONE TASK
The taught `po_number` on the **Larkspur Interiors purchase_order template (id 30)** reads the value CLIPPED:
`PO-40351` comes out as `40351`, and on one doc garbles to `IM.ANKI1`. Make the pipeline read the FULL code.
Deliver it as a **DEFAULT-OFF, gated, owner-flippable** change, gary→Oracle vetted, gates green. That is the
whole job. Nothing else.

## OPERATING RULES — RE-READ THESE AT THE START OF EVERY WORK STEP
These exist because the last two sessions **forgot facts they had already established** and **asserted system
state without checking it**. Both cost hours.
1. **VERIFY AT SOURCE before you assert ANY system state** — a DB column/value, a flag default, a file's
   contents, which code path runs. Run the query / read the code / list the dir. NEVER infer it. (The last
   session claimed the box was "label-less" from a column that does not exist, and built an entire fix for the
   wrong class.)
2. **Keep a written FACTS list as you go, and RE-VERIFY a fact before you act on it.** You have a habit of
   contradicting or forgetting things you stated earlier in the same session. Treat your own earlier statements
   as unverified until re-checked at source.
3. **One change, behind a DEFAULT-OFF env flag, byte-identical when OFF.** Prove OFF is byte-identical.
4. **Advisor gate before building anything substantive:** brief `gary` (design) then `oracle` (vet). Give them
   the CORRECT, re-verified premise — the last Oracle vet used a wrong premise (see below) and signed off a
   mis-targeted design.
5. **The harness CANNOT bit-reproduce the app's clip.** Which doc clips shuffles run-to-run (DPI ±1). Gates
   prove NO-REGRESSION + DIRECTIONAL recovery only; the heal is **owner-watched live**. Never say "the app is
   fixed" from a harness pass.
6. **STOP AND SECOND-GUESS** at the six junctures in `CLAUDE.md` (especially #6: asserting state → verify at
   source first).
7. **Token discipline:** read only the files named here + what a step forces you to. Do not scan the repo.

## DO NOT (anti-drift — these are out of scope)
- Do NOT touch the merge layer (`engine.py` `_stage05_format_fails` / `TEMPLATE_FORMAT_FAIL_YIELD`) — that arc
  is DONE and committed (`1bea059`). It already declines this clip on purpose (a clipped `40351` is
  format-VALID). This is a READ-layer task.
- Do NOT "fix it" by re-teaching the box, or by editing the live DB, or by tuning to these 8 docs' coordinates.
  The fix must be a reusable SYSTEM change.
- Do NOT widen to other suppliers/fields/types, or flip any owner setting. Deliver DARK; the owner flips.
- Do NOT rewrite `_inline_code_reconcile` or the edge-guard family wholesale. Smallest correct change only.
- Do NOT trust this document's "facts" blindly — re-verify each at source (Rule 1).

## READ FIRST (in this order, nothing else yet)
1. This file.
2. `HANDOVER_2026-08-09_CONT.md` → the section **"Pad-window CODE slice … OFF-TARGET (premise error)"**. It has
   the premise error, the real bug, and the corrected direction. This is the most important read.
3. `CLAUDE.md` → the "Working rules" (six junctures) + the extraction-pipeline invariants.
4. `docs/oracle_log.md` → the two 2026-08-09 entries (format-fail-yield) + the 2026-08-06 **PAD-WINDOW DATE
   READ** entry (the date slice this task mirrors). (The pad-window-CODE slice is NOT yet logged there — add it
   when you wrap.)
5. `python_backend/extraction/template_mapper.py`, only these spans:
   - `_read_pad_window_date` and `_read_pad_window_code` (the padded readers)
   - `_maybe_pad_date_flag` and `_maybe_pad_code` (the decision fns)
   - `_inline_code_reconcile` (def ~1006) — the labelled-box recovery ladder that is FAILING
   - `_extract_one` — the abs-commit block and the relocate path (where the pad calls are wired)
6. `python_backend/tests/test_template_pad_window_code.py` (17 pins — the current contract) and
   `stress_test/crop_recipe_sweep.js` (the A/B harness + the ground-truth PO numbers).

## ESTABLISHED FACTS — RE-VERIFY EACH AT SOURCE (command given) BEFORE RELYING ON IT
| Fact | Verify with |
|---|---|
| The Larkspur po_number mapping is **labelled**: `anchor_text='Order No.'` (NOT label-less). The column is `anchor_text`; `anchor_label` does NOT exist. | `python -c "import sqlite3,os;db=os.path.join(os.environ['APPDATA'],'ScanFinder','docusnap.db');c=sqlite3.connect(f'file:{db}?mode=ro',uri=True);c.row_factory=sqlite3.Row;[print(dict(m)) for m in c.execute('select field_key,anchor_text,target_x_norm,target_w_norm from template_field_mappings where template_id=30')]"` |
| Template 30 = Larkspur Interiors / purchase_order. | same DB, `select id,name,document_type_slug from templates where id=30` |
| The current `_maybe_pad_code` is scoped to LABEL-LESS boxes (`if not mapping.get("anchor_text")` at the call site) → it never fires on this labelled box. | Read the call site in `_extract_one` (grep `_maybe_pad_code(`) |
| `_inline_code_reconcile` runs on this labelled box and returns **None** on the clip (so the clipped abs read wins). | Re-trace: add an env-gated log at the `rc = _inline_code_reconcile(...)` call and reprocess the docs (see the traced-sweep recipe the last session used, now removed — re-add temporarily) |
| The owner already has **all 22 crop-recovery flags ON** (so the existing machinery is exhausted). | `python` query over `settings` for the flag keys (see `HANDOVER_2026-08-09_CONT.md` list / `handler.js` `_reconcileEnv`) |
| Ground-truth PO numbers (8 docs): #625 PO-48009 · #630 PO-91914 · #632 PO-82956 · #635 PO-19649 · #637 PO-40351 · #638 PO-60906 · #639 PO-41508 · #640 PO-90621. | encoded in `stress_test/crop_recipe_sweep.js` `DEFAULT_GT`; #637/#640 were recovered from a padded PIL crop probe — spot-check by eye if unsure |
| `TEMPLATE_PAD_WINDOW_CODE` defaults OFF; OFF is byte-identical. | `grep _PAD_WINDOW_CODE_ON template_mapper.py`; run the pin test |

## THE PLAN — bounded, verify at EACH step (do not skip a gate)
**Step 1 — Reproduce + localise (NO code change yet).** Re-add a temporary env-gated trace at the
`_inline_code_reconcile` call site AND at the relocate path, run `crop_recipe_sweep.js` on the 8 docs, and
establish PER DOC: which rung commits the clipped value (abs-commit? relocate/geometric? edge-guard?), and for
the abs-commit ones, WHY `_inline_code_reconcile` returned None (label not located? inline read also clipped?).
**Write the per-doc rung table down.** Do NOT assume it's all one rung — the last trace showed only #625 reached
the reconcile; the others took different paths. This step decides WHERE the fix must live.

**Step 2 — Design (gary), on the RE-VERIFIED premise.** Candidate direction (verify it survives Step 1): the
pad-window code read is geometry-only (pads the box, re-reads — it does NOT need the flaky `Order No.` locate),
so it is the right backstop. The pad call currently sits ONLY at the abs-commit site AND is scoped to
label-less. Reaching the abs-commit implies `_inline_code_reconcile` already returned None (`if rc is not None:
return rc` runs first), so **dropping the `not anchor_text` scope there cannot override a healthy reconcile** —
it only backstops a failed one. If Step 1 shows the clip commits on the RELOCATE rung too, the pad call must be
added there as well (same post-reconcile reasoning). Ask gary to confirm the placement + whether the consent
gate / suffix rule / min-suffix floor still hold for a labelled box, and to name the seam. Brief gary with the
CORRECTED premise (labelled box, reconcile returns None) — NOT "label-less".

**Step 3 — Oracle re-vet.** The prior Oracle sign-off assumed label-less scoping (to avoid overriding a healthy
reconcile). Tell Oracle the premise changed and why the post-reconcile position makes label-less scoping
unnecessary. Get SIGN OFF / …W/COND before building.

**Step 4 — Build (smallest change).** Likely: remove/relax the `not anchor_text` guard on the pad call(s) per
the vet. Update `test_template_pad_window_code.py` to add a LABELLED-box case (currently it only covers the
decision fn; add a case proving the call now fires on a labelled box after reconcile-None). Keep all 17 existing
pins green.

**Step 5 — Gate (all three, with the OWNER'S live env — the flags-ON interaction is the real test).**
- `crop_recipe_sweep.js` with `TEMPLATE_PAD_WINDOW_CODE=1`: must RECOVER the clipped docs it can reach, **0
  regression** on the others. (Add the recipe delta as the last session did.)
- Customer corpus (`po_ref`/`po_number` **M=0**, doc-level **0 T→F** — use `scratchpad/monotonicity.py` pattern
  over the per-doc jsonl).
- Realdoc: armed **== baseline** (~17 floor, `M_type 0`), flag ON.
Remove any temporary trace before committing.

**Step 6 — Wrap.** Commit DARK with an honest message; add the pad-window-CODE entry to `docs/oracle_log.md`;
update `HANDOVER_2026-08-09_CONT.md`; save a memory. Owner flips the flag after eyeballing the live app.

## EXACT GATE COMMANDS (run from repo root `c:/GIT Projects/Docusnap`)
```
# pin test
py -3.12 python_backend/tests/test_template_pad_window_code.py

# crop sweep (reads the owner's live flags; add TEMPLATE_PAD_WINDOW_CODE=1 as a recipe delta in the file)
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe stress_test/crop_recipe_sweep.js

# Customer corpus (isolate PAD_WINDOW_CODE vs the new_ffy2 baseline; keep FORMAT_FAIL_YIELD=1 as that is now live-intended)
CORPUS_DIR="C:/Users/cmccu/Desktop/NEW DOCS STABLE TYPE" ELECTRON_RUN_AS_NODE=1 SAMPLE=300 SEED=7 SET=both TEACH=1 \
  TEMPLATE_FORMAT_FAIL_YIELD=1 TEMPLATE_PAD_WINDOW_CODE=1 TAG=padcode2 \
  node_modules/electron/dist/electron.exe stress_test/customer_corpus_score.js
# then diff per-lane vs stress_test/out/customer_score_new_ffy2.md and doc-level vs *_new_ffy2.jsonl

# realdoc (flag ON vs OFF, M-set must be identical)
ELECTRON_RUN_AS_NODE=1 TEMPLATE_PAD_WINDOW_CODE=1 node_modules/electron/dist/electron.exe stress_test/realdoc_regression.js
```
Gotchas: run the JS harnesses via `node_modules/electron/dist/electron.exe` (NEVER `electron.cmd`). Python is
`py -3.12`. Windows cp1252 stdout can't print `→`/emoji/`£` — use ASCII in test prints. Do NOT edit
`template_mapper.py` while a corpus/realdoc/sweep arm is running (workers import it per shard). `git add` only
your files — `CLAUDE.md` and `test_template_target_word_snap.py` carry PRE-EXISTING owner edits; leave them.

## SUCCESS CRITERIA (all required)
1. The clipped Larkspur docs the fix's rung can reach read the FULL `PO-…` in `crop_recipe_sweep.js`, 0
   regression.
2. Customer corpus M=0 + 0 T→F; realdoc armed==baseline.
3. All pins green; OFF byte-identical; gary+Oracle signed on the corrected premise.
4. You did NOT expand scope, edit the merge layer, re-teach, or flip a setting.

## IF STEP 1 CONTRADICTS THE PREMISE
If the trace shows the clip does NOT commit at the abs-commit rung (e.g. it commits inside a relocate/edge path,
or `_inline_code_reconcile` returns a value that a LATER stage clobbers), then the "drop the label-less scope"
direction is wrong — STOP, write down what you actually observed, and re-design from the real rung. Do not force
the pad-window fix where the evidence doesn't put the bug.
