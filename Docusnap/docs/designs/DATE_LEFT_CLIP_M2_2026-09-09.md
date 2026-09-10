# Silent wrong-date auto-file (sales_order #77/#78) — 007 diagnosis + fix design

**Date:** 2026-09-09 night · **Status:** RECOMMENDED FIX BUILT DARK 2026-09-10 (mig 152 `role_disagree_refuse_at100`,
owner-authorised; Oracle C6/C7 of the edge-clip arc named this the lowest-blast-radius safety, "land it regardless").
The belt runs the `_pageFamilyDisagrees` role leg at `overall==100` (roleDisagreeOnly), NOT the over-blocking full
at100 gate; HARD dep `trust_role_disagreement_refuse` ON; seed OFF in TEST_SWITCH_KEYS; pin
`database/modules/test_role_disagree_refuse_at100.js` (all green, incl. an OFF pin documenting the live misfile).
Complementary B (make a 94 role drag `overall` below 100) + Complementary C (cure the read) remain open. Found by the night-run
123-doc anomaly sweep (`TESTING/_measure/night_20260909/`). 007 (general-purpose + persona) root-caused it with
pixel renders + end-to-end engine repro. Scratch: `scratchpad/007_dateclip/`.

## The finding
Two Copperfield **sales_order** docs would AUTO-FILE a WRONG date at high confidence, no flag (the cardinal sin):
- **#77** `sales_order_15`: page prints `19/03/2026`; read `09-03-2026` (`template_mapping_salvaged`, conf 98).
- **#78** `sales_order_11`: page prints `11/10/2026`; read `01-10-2026` (`template_mapping`, conf 94).
Both drop the **leading `1` of the day**. GT is correct (matches the page) — NOT poisoned.

## DPI nuance — M=2 for 300-DPI installs, M=1 at product 200 DPI
The realdoc harness runs at its **default 300 DPI** (omits `OCR_RENDER_DPI` — the documented "harness 300 vs
product 200" trap). Re-run at both DPIs:

| doc | @300 (harness) | @200 (product) | compose OFF |
|---|---|---|---|
| #77 `19/03` | `09-03` WRONG | `19-03` **CORRECT** | correct |
| #78 `11/10` | `01-10` WRONG | `01-10` **WRONG** | correct |

So **#77 is a 300-DPI artifact** (correct at product 200); **#78 is a real silent misfile at 200.** A **new**
install (mig-138 `ocr_dpi=200`) sees only #78; an **older/upgraded** install (no `ocr_dpi` row → 300 default)
sees BOTH → M=2 is real there.

## Root cause — PLACEMENT (compose left-clip), FACT/reproduced
1. Both docs = ONE template (tpl 4, Copperfield sales_order), ONE `order_date` mapping (target x=0.807,
   w=0.110), `sample_deskew_angle=0.3°` (REAL — the 2026-09-07 NULL-angle cause does NOT apply).
2. `teach_angle_compose_scan` (**customer default-ON**, @DEFAULT_FLIP mig 70) composes the box by
   `net = θ_teach − θ_scan`. On tilted siblings (θ_scan 1.1°/1.4°) `net = −0.8°/−1.1°` → box shifts **right
   ~11–15px** (`_compose_box_to_level`, engine.py:859).
3. The shifted left edge **clips the leading `1`** → a single-digit day → `.1/10/2026` → normalises to
   `01-10-2026`@94 (confident, valid-shaped, WRONG).
4. **Compose OFF ⇒ both correct at 200 AND 300.** Compose is the direct cause — but it is net-POSITIVE
   (+18 issuer / +36 customer on tilted siblings); the clip is a narrow-right-column side effect.

## Why every existing defense missed it (the seams)
The correct value IS available (`_read_pad_window_date` recovers it @96; the **keyword family reads it right and
is recorded as `disagree`**) — yet nothing flags:
- **Edge-cut grow (mig 131):** needs a word straddling the crop edge; a clean full-clip leaves a complete token → never fires.
- **Pad-date containment flag (mig 132):** defeated — (a) it inspects the already zero-padded value (`01` = 2 digits, `len==1` false); (b) the `_salvaged` suffix excludes #77 (template_mapper.py:2348).
- **Pad-window disagreement Case 3:** needs `pad_conf ≥ tight+15`; the clipped tight read is high-conf (94/98) so the correct pad read (96) can't clear the margin.
- **`trust_role_disagreement_refuse`** (ON, built verbatim for this class): PROVEN to refuse #78 — **but bypassed at `overall_confidence==100`** (isAutoFileEligible only calls docTrustGate at 100% if `strict_100_autofile` is on, default off; trust.js:1226-1234).
- **Secondary:** `overall_confidence` emits **100** despite the required `order_date`=94 — that 100 routes the doc to the gate-free path.

## Fix design (fail-toward-review; APPROVAL-CLASS — build with the owner + Oracle gate)
**Recommended (smallest, gate-layer):** run the role-disagreement refusal at `overall==100` — decouple the
precise `_pageFamilyDisagrees` check (docTrustGate:930-932) from the over-blocking `strict_100_autofile` full
gate. High-precision (fires only when an independent PAGE family read a DIFFERENT value on a ref/date role,
date-fold-exact), proven to catch #78, correct value even surfaced. Seam: only ADDS a refusal at 100% (risk = a
100% doc whose role legitimately differs across families — rare, date-fold-precise → held for a human). Test:
unit (date role `disagree` at overall 100 → refused; agree/absent → files) + realdoc `wouldAutoFile(ON) ⊆
wouldAutoFile(OFF)` + M=0 + pin `test_role_disagreement_refuse_at100`.

**Complementary B (keep the value CORRECT, not just held):** investigate why `overall_confidence==100` when the
required `order_date`=94 (validator.overall_confidence is a required-field average — a 94 required field should
drag it below 100). If fixed, the EXISTING sub-100 gate already refuses — no new gate logic.

**Complementary C (cure the read):** wire mig 143 `template_pad_date_adopt` to fire on a keyword-corroborated
pad disagreement (bypass the +15 margin) → files the CORRECT date; AND when composing a NARROW date/code target
box, widen the READ window left by the compose displacement so the leading glyph can't be severed. (There is a
ref analogue — mig 141 read-widen — but no DATE analogue, because a clipped date stays shape-valid.)

## Blast radius
General: any narrow right-aligned date box on a sibling more tilted than its teach sample, under
`teach_angle_compose_scan` (a shipped default). DPI-marginal (200 vs 300 flips #77). Exposure depends on
per-sibling tilt + the customer's `ocr_dpi`.
