# HANDOVER — 2026-08-08 OVERNIGHT (autonomous) — teach-side run measured, 3 fixes shipped dark, 1 design REFUTED by measurement

**Branch `feat/teach-side-overnight`. Revert point: `8b8b458` on `feat/reprocess-throughput-autostraighten`.**
Everything tonight is on the new branch and every behaviour change is DEFAULT OFF, so the revert is
either `git checkout feat/reprocess-throughput-autostraighten` (abandon) or simply leaving the
switches off (keep the code, keep today's behaviour).

---

## READ THIS FIRST — the goal was not met, and here is the honest number

The target was **98% on teach + targeting**. It is not there. Best measured state after tonight's
fixes, over 200 scanned siblings of 10 taught documents:

| field | after | field | after |
|---|---|---|---|
| date | 83% | vat_no | 51% |
| customer | 53% | account_no | 28% |
| ref | 64% | po_ref | 35% |
| issuer | 60% | serials | 0% |
| total | 72% | | |

What tonight actually bought: **+9 correct reads and 33 confidently-wrong values converted to
empty** (review instead of a silent misfile), with **no lane going down**. The gap to 98% is not one
more fix — the remaining failures are the taught box reading the wrong row/column on drifted scans,
which is a geometry problem, not a rules problem. See NEXT.

I did not run the Chris loop. Three fixes needed measuring end to end, the freeze design needed
refuting, and a Chris replication needs a fresh sandbox plus UI-driven teaching that I could not
have validated properly in the time left. Choosing verified measurement over an unverifiable
fifth artefact was the right trade, but it does mean **the Chris arm of your instruction is
outstanding**.

---

## What shipped (commit `4e5c21c`, all DEFAULT OFF, byte-identical off)

| switch | defect | measured |
|---|---|---|
| `STAGE05_REF_CODE_GATE` | a taught box read its own CAPTION and committed it — expected `HTS-SO-12013`, got the literal `'Ref'` at conf 70. Stage 1 has refused codeless references since 08-07 but that gate lives inside `keyword.extract_fields`; all six Stage-0.5 rungs were unprotected. Guard added at `_gate_value`, the choke point they share. | Harrowgate ref 80% → 85% |
| `KEYWORD_GENERIC_CAPTION_EXCLUSIVE` | one code captured into THREE fields: `sales_order_number`, `account_no` and `vat_no` all committed `'VXS79871'`. Every ref-role field is seeded with the same generic caption bank; the free-text branch dedupes siblings, the ref branch does not. | account_no wrong 51→29, vat_no wrong 65→54 |
| `TYPE_TITLE_OWNER_PRECEDENCE` | **the silent one.** Type election is a bucket SUM: an install-created type owns one phrase, a built-in owns a whole caption vocabulary, and `ORDER CONFIRMATION` is itself a Sales Order phrase — so the install type cannot win, even on a tie (`max` returns the first maximal key). A template taught against such a type binds to a slug its siblings can never detect as. | issuer 56% → 60%; Veltrix 0%→30%, Silverbeck 40%→50% |

Tests: `python_backend/tests/test_teach_side_gates.py` (17 pins, every ON case has an OFF twin) and
`database/modules/test_freeze_issuer_only.js` (13 pins).

---

## The design that measurement REFUTED — do not flip it

`TEMPLATE_FREEZE_ISSUER_ONLY` ships **off and is not recommended.** eric's design is sound and the
defect is real: `_buildTemplateFields` decides a field is a supplier CONSTANT from a sample of ONE
taught document and stamps it on every sibling at `template_fixed` conf 95 — above the 88 auto-file
floor. Your templates carry `po_ref 'PO-78567'`, `serials 'PO-43906'`, `account_no 'ACC-2291'`.

The arm refuted the fix:

```
             base    freeze-issuer-only
po_ref        35%  →   50%    (+6 correct)
vat_no        51%  →   16%    (-70 correct, empties 32→95)
```

A VAT number **is** a genuine per-supplier constant whose taught mapping often fails to read, and
the stamp was carrying it. eric argues (correctly) that on a mature install `supplier_hints` would
carry it instead once `usage_count>=2`, and that the loss is transient. That may be true, but it is
not true in the regime you care about — a fresh teach — and "NO REGRESSIONS" was the constraint.
**Re-measure before ever flipping it.** The arm is one command (below).

I also corrected a FALSE comment in that function claiming the freeze "self-heals on the next
confirm". It does not — the builder is only reached via `_upsertTemplate`, and neither an ordinary
confirm nor the auto-file path rebuilds, so every stamped value is re-confirmed as evidence that the
field is constant. **The freeze manufactures its own proof.**

---

## New instruments (these are the reusable part)

- **`stress_test/teach_run_ab.js`** — replays the 200 sibling documents through the real pipeline
  under a mutated learning state or an env-flag arm, 8 shards, ~6.5 min per arm. This is what made
  tonight measurable: it turns "should we ship this?" into a number before the code is written.
  `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe stress_test/teach_run_ab.js base fixes`
  Arms: `base`, `unfreeze`, `retarget`, `unfreeze+retarget`, `refgate`, `exclusive`, `typeowner`, `fixes`.
- **`stress_test/score_teach_run.py`** — scores an arm (or the live sandbox DB) against
  `ground_truth.json`: per scope, per field, ok/wrong/**empty** separately, plus which rung won.
  `py -3.12 stress_test/score_teach_run.py --json <arm>.json --label <name>`
- **`scripts/teach-sandbox.js`** — snapshot/restore. `snapshot` is safe while the app runs (SQLite
  online backup); `restore` refuses while it is running. Snapshots already taken:
  `clean-start`, `phase1-after-import`, `owner-teaches-baseline`.

**One scorer caveat to fix before trusting it further:** it resolves a scope's ref/date field keys
from the MANIFEST's type, not from the type the document actually detected as. For the two scopes
whose type is in dispute that makes those lanes read as empty. It does not affect the other eight.

---

## What your run found that is NOT yet fixed

1. **`serials` 0%, and it is a capability gap, not a bug.** Ground truth is a LIST
   (`['CT-3766614','CT-7446380']`); one drawn box cannot capture a variable-length list, and the
   whole `template_fields`/`fixed_value` model is single-valued. Needs a multi-value field type.
2. **`customer` 53%, `po_ref` 35%, `account_no` 28%** — dominated by the taught box reading the
   wrong row or column on a drifted scan. This is the same family as the caption-harvest fixed
   earlier today, and it is where the remaining 35 points live.
3. **`'Neltrix Automotive Parts'`** — the issuer name was learned from an OCR misread at teach time
   and is now the stored identity AND the learning-scope key. gary's point stands: at teach time the
   system is structurally defenceless (the dominant-value snap needs 5 confirms, there is one), so
   the only correct layer is the operator — the issuer row on the summary step must be explicitly
   confirmed, not one grey row among ten.
4. **Two teaches were orphaned and nothing said so.** `TYPE_TITLE_OWNER_PRECEDENCE` fixes the cause
   going forward; it does not add a detector. gary designed one (a template with mappings whose
   `confirmed_count` never grows while documents with its logo keep arriving) — not built.

---

## NEXT, ranked

1. **Verify the no-regression arm finished clean** (it was running at hand-over; result appended
   below if it landed). Then decide the three switches — they are measured, pinned and reversible.
2. **Run Chris** on a fresh sandbox to replicate the teach flow. My instruments measure the
   PIPELINE; only Chris measures the EXPERIENCE, and your run already proved the experience is where
   the damage starts (you missed the skip control, and two teaches silently did nothing).
3. **Then go at the geometry**, not more rules. Points 1-3 above are 35 of the missing 38 points.
4. `pendingfeatures.md` carries the un-built advisor slices: gary's teach-time divergence warning,
   the unused-template detector and `templates.retargetType`; reggie's `SEED_TYPE_TIGHTENS_VALIDATION`
   and the role-qualifier stop list.

## Gotchas earned tonight

- **Never edit a Python extraction file while an arm is running** — workers import per shard. Cost me
  one arm.
- `template_mapper` reads its kill switches at IMPORT time (house style: flag zone above the first
  `def`), so a test arm must `importlib.reload` it.
- The realdoc report's live progress lines are deliberately NOT in the md — completion order varies
  between runs and made an arm-to-arm diff unreadable the first time it was used.
- Ground truth calls the rendition `'scan'`, not `'scanned'`; and its `issuer` column names the
  COUNTERPARTY, so for buyer-issued purchase orders it is inverted against the app's Document Issuer
  role. The scorer handles this (`BUYER_ISSUED`) — verified at the pixels, not assumed.
