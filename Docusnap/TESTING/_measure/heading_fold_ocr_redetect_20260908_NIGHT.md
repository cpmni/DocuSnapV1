# TYPE_UNINSTALLED_HEADING_FOLD — OCR re-detect A/B (2026-09-08 NIGHT, item 4)

**Question (night plan item 4):** run the OCR re-detect over an adversarial corpus with
`TYPE_UNINSTALLED_HEADING_FOLD` OFF vs ON — winner changes must be exactly the uninstalled-heading docs.

## What ran
- Harness: `stress_test/score_hard_set.js` (records `got.type` per doc), config DB
  `TESTING/_measure/reset_arm_20260908/arm137.db`, `OCR_RENDER_DPI=200`, app env mirrored.
- Corpus: the adversarial **Hard Set** (`Desktop\Hard Set`), both renditions.
- Arms: `TYPE_UNINSTALLED_HEADING_FOLD=0` vs `=1`; diff of detected `got.type` + `wouldFile` per doc.

## Result
| Rendition | docs | TYPE changes OFF→ON | wouldFile changes OFF→ON |
|---|---|---|---|
| digital | 200 | **0** | **0** |
| scan    | 200 | **0** | **0** |

**SAFETY confirmed at the OCR level:** flipping the switch produces zero detected-type changes and zero
filing changes on 400 adversarial docs (clean digital AND garbled scan). The switch does not misfire on
installed-type documents.

## Why 0 (not a null result)
`arm137.db` installs `invoice, sales_order, purchase_order, delivery_note, worksheet` — **no `statement`
type**. The Hard Set's ten classes are all invoice-family STRESS variants (multicol_money, table_total,
small_print, edge_date, buyer_large, continental, logo_siblings, degraded, multipage, credit_sign) — there
is **no uninstalled-heading (e.g. Statement) class** in this corpus. The fold has nothing to fold here, so
0 changes is the correct SAFETY outcome, not evidence of a dead arc.

## EFFICACY (separate, already MET)
The fold's efficacy — the Ironclad→Statement case (Chris's "Statement typed Invoice" exhibit) — was proven
by the **2026-09-06 text census** on the live corpus: 20/20 Ironclad → Statement, 521 unchanged (see the
NIGHT_RUN DONE ledger, 2026-09-06). That is the "exactly the uninstalled-heading docs" evidence.

## Owner follow-up (optional, logged)
A full OCR re-detect over the 605 test corpus (`Desktop\ScanFinder Test Corpus`) with a type set that
EXCLUDES the heading type would confirm efficacy at the OCR level (not just text). It is a longer arm and
is currently carried by the 09-06 text census; run it only if belt-and-suspenders OCR-level efficacy is
wanted before the flip. The flip itself is approval-class (owner's call).
