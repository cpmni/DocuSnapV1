# Arc A (FILING_SANITY_CONFUSABLE_PREFIX_AUTOFILE) flip census — 2026-09-09 night

Offline replay on the 123-doc sweep DB (a copy of the owner's live install). Script `scratchpad/a_census.py`.

## Non-vacuous (Oracle C6 satisfied)
6 dominant-backed prefix scopes (all ≥19–21 confirmed refs): Copperfield DN/INV/PO/SO/WS + Ironbridge INV.
So A is genuinely exercised on real ≥5-confirmed graduated scopes — not a vacuous live census.

## The witness fires correctly, M=0, mirror guard holds
- **Confusable Gate-C cases on the corpus: 1** — doc #45 `PO-22954` vs whole-page `P0-22954` (the O/0 exhibit).
- A witness holds on #45 (dominant `PO` backed) → would suppress the note. **M=0** (the committed value is the
  confirmed GT — `PO-22954` is correct; no wrong-value auto-file).
- **Constructed adversarial mirror (Oracle C7):** a genuine `P0-2001` in a 90%-`PO` scope with a confirmed
  `P0-` sibling → **witness = False** (REFUSED). The C2 mirror guard (`any_confirmed_shares_head`, counter==0)
  works on the case the dominance bar can't see.

## THE C1 SEAM — A is INERT in practice (Oracle predicted this)
Doc #45's corroboration: `disagree:[{family:keyword, value:"P0-22954"}]`, `independent_agree:false`, and
`trust_role_disagreement_refuse = true` (mig 93, ON). So even when A suppresses the Gate-C note, the
**keyword page-family disagrees** on the po_number (a filename-deciding ref role) → `trust_role_disagreement_
refuse` HOLDS the doc regardless of the note. Net **arc-live (actually auto-files): 0**.

Decomposition (Oracle C1, required):
- confusable Gate-C cases: **1**
- held by `_pageFamilyDisagrees` anyway (arc inert-in-practice): **1** (#45 — keyword read `P0-22954`)
- reaches auto-file (arc live-in-practice): **0**

## Verdict — DO NOT FLIP A (keep it DARK); it is correct but vacuous
A is correct + safe (M=0, mirror guard verified) but buys **nothing** on the real data: its one confusable
target (#45) is independently held by `trust_role_disagreement_refuse`, and that hold is ARGUABLY RIGHT — a
structured keyword read genuinely disagreeing with the committed value on a filename-deciding ref is exactly
what that gate exists to catch. Making A useful would require resolving the keyword disagree — Oracle already
rejected folding O/0 into `_corrob_values_agree` as WRONG-LAYER (it reopens the mirror everywhere).

So the confusable case is correctly **held by the disagree gate + calmed by the mig-147/148 note softener**
(already shipped, customer default) — which is the right level. A stays a correct-but-dormant DARK arc; it
would only ever activate on a future confusable case that has NO structured page-family disagree. **No flip.**
