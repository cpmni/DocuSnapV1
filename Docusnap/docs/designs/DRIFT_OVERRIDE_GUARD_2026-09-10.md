# DRIFT-OVERRIDE MATCH GUARD — the customer_name postcode-drift root-cause fix (mig 157, DARK)

007 → **Oracle SIGN-OFF-W/COND C1**. Built DARK. Kill switch `template_drift_override_guard` /
env `TEMPLATE_DRIFT_OVERRIDE_GUARD`, in `TEST_SWITCH_KEYS`. Byte-identical OFF. This is the **placement
root-cause fix** the owner asked for ("read the name, don't detect the postcode and flag it") — it makes the
non-name guard (mig 156) a near-vacuous last-resort backstop.

## The defect (007, reproduced live)
`Vellum & Crane` sales_order template (id 12), `customer_name`. The "Customer" block: label, then NAME
(`Larch & Hollow Cafe Co`, y≈0.224), street, city (`Chester`), postcode (`CH1 2HU`, y≈0.263). The taught
mapping is a thin one-line box on the NAME. Doc #243 auto-filed `customer_name = CH1 2HU`.

Root cause: `template_mapper._extract_one`'s early **drift guard** (`:2841`) — if `_locate_anchor("Customer")`
finds the label DISPLACED (`_label_drifted`), it relocates and **RETURNS that, discarding the absolute read**.
On #243 the crop OCR failed to segment "Customer" as a matchable line (a segmentation lottery — it reads
cleanly on #245/#249), so `_locate_anchor` fell to the nearest above-threshold fuzzy word: **"Chester"** (the
city line), which scores **0.667** vs "customer" — above `_FUZZY_MATCH_THRESHOLD=0.6`. "Chester" sits ~2.5
lines below the taught anchor → phantom `_label_drifted` → `_geometric` seats the read on the postcode line →
`CH1 2HU`. The absolute read of the taught box was **`Larch & Hollow Cafe Co` @95** — thrown away for a 0.667
guess. Intermittent = the label-word segmentation lottery.

## The fix
A drift-override that DISCARDS a credible absolute read must be justified by a CREDIBLE label match. In the
drift branch (`template_mapper.py:2841`), when the guard is ON the override requires the taught label
(`_label_is_the_taught_one`, exact/inline) OR `_locate_anchor` `match_score ≥ _DRIFT_OVERRIDE_MATCH_FLOOR`
(0.8). A weak cross-word match does **not** relocate.

**Oracle C1 (load-bearing):** a weak match must **fall through with `anchor_stable=False`**, NOT set it True —
so the independent **registration arbiter** (a global page-transform signal that does not depend on the label
OCR lottery) still arbitrates a genuinely-drifted page. Setting `anchor_stable=True` there would kill the one
drift catch that survives a failed label read — a latent silent-wrong-file. The restructure: the
relocate/return sits inside `if _do_strong:` within the `if _label_drifted:` block; the `elif drift_located:`
(not-drifted) arm keeps its `anchor_stable=True`. On #243 (not genuinely drifted, `box_divergence≈0`) the
arbiter won't fire → the absolute name stands. C1 is strictly-better-or-neutral: never hurts #243, closes the
counter-case (a real drift whose label garbles to 0.6-0.8) wherever landmarks exist.

The floor 0.8 sits in the measured gap (spurious cross-word 0.667 < 0.8 ≤ genuine garble 0.824, from
`_locate_anchor`'s composite `match_score`). **C2:** `_exactness_census` now logs `match_score` so the floor
can be PLACED from real data, not the 2-point gap.

No teach-time signal, no geometry change; works from the existing `match_score` + `_label_is_the_taught_one`.

## Prior art (no overlap)
Distinct from mig-155 `anchor_axis_lock` (DOWNSTREAM — how `_relocate_and_read` SEATS once relocation runs;
this governs WHETHER it runs) and the parked Larkspur below-relocate arc (Stage-2 tight-crop glyph recovery).
This is UPSTREAM — it prevents the false relocate from ever starting. The mig-156 non-name guard is now the
silent backstop for whatever this can't prevent.

## Verification
- Pins GREEN: `test_drift_override_guard.py` (floor + `_label_is_the_taught_one` + the C1 structure incl. the
  **P3 seam pin** — the weak-match fall-through does NOT set `anchor_stable=True`, so the reg arbiter stays
  live) + `test_migration157_drift_override_guard.js`; `TEST_SWITCH_KEYS` → 41; release gate clean.
- **LIVE CONFIRMATION** (the only artifact that proves the heal — the class isn't in the 605 corpus):
  reprocess #243 — OFF `customer_name = "CH1 2HU"` @94; **ON `customer_name = "Larch & Hollow Cafe Co"` @94**.
  #245/#249 byte-identical (they exact-match the label → unaffected). OFF byte-identical.
- **⚑ FLIP GATE (owner-owed):** realdoc M=0 on the 605 corpus (no-regression only — the class isn't in it)
  + the `match_score` census (C2) to confirm the 0.8 floor cleanly separates the wrong (low-score cross-word)
  overrides from the right (high-score garbled-label) ones + a live-DB re-run across the customer's docs.
