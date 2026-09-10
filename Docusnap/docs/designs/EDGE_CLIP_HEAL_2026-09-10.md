# Taught-box edge-clip heal — `template_edge_clip_heal` (DARK, mig 151)

**2026-09-10.** Owner north-star: *"as many reliable autofiles as possible — if we could reliably get
clean slices I believe we will be close to success."* Owner edge-ink lead: *"can we do a check for dark
pixels on the edges, that would indicate we are slicing through text??"* — this is that check, in its
robust (geometry) form.

Advisors: **007** (root cause + fix design, rendered end-to-end at 200 DPI on the live DB) → **Oracle
SIGN OFF WITH CONDITIONS C1-C7** (see `docs/oracle_log.md` 2026-09-10). Build DARK; **flip owner-gated**.

---

## The bug (one class, three exhibits)
A field taught by drawing a box (Stage 0.5 anchor→target mapping) is read on a sibling scan by composing
the taught box to the scan's level (`net = θ_teach − θ_scan`, `_compose_box_to_level`). On a **tilted**
scan the composed **axis-aligned** box severs ONE edge glyph. 007 reproduced (word-boxes from full-page
psm6):

| doc | field | net° | clip | committed garble |
|---|---|---|---|---|
| 140 | delivery_number | −1.1 | left edge bisects the "D", 9.0px | `YN-38626` @95 |
| 139 | delivery_number | +2.1 | left edge bisects the "D", 7.9px | `YN-79533` @95 |
| 139 | customer_name | +2.1 | right edge cuts "d" of Ltd, 3.3px | `Bluefin Marine Li` @91 |

Two verified reframes:
1. **The compose is net-positive, not the villain.** The *stored* box on these siblings reads pure
   garbage (sits on the "Deliver To" label row); the compose repositions it onto the value and kills
   ~90% of the skew offset. What's left is a **3-9px residual** — inter-scan translation the page-centre
   rotation can't model + ±0.2° detector noise × the box's ~0.35·W radius — **irreducible for any single
   global-rotation model**. So the cure is a clean READ window, not a compose fix.
2. **Clip direction is position-dependent:** right-column field (x≈0.85) → LEFT clip; left-column field
   (x≈0.14) → RIGHT clip; net sign flips either way. A widen must be symmetric horizontally + row-bound
   vertical.

## Why every existing defense misses (007 ran each on live data; Oracle verified the mechanism)
- `_find_edge_cut_words`/`_abs_edge_guard` (mig 131): needs overhang ≥ ~0.6·glyph_width (~8-9px). Clips
  are 3-9px → `(None,None)`.
- `_widen_code_read`/`template_code_read_widen` (mig 141): fires only when the tight read is shape-**invalid**;
  a clipped `YN-#####` folds shape-**valid** like `DN-#####` → never fires (also needs ≥3 confirms; this
  template has 1).
- `_maybe_pad_code`/`_maybe_pad_date_flag`: gate on `pad_conf ≥ tight_conf + 15`. The clip garble is
  **high** OCR-confidence (~90+); the correct pad read is 88-90 → margin defeated. **OCR confidence is the
  wrong arbiter.** Additionally `_maybe_pad_code` is two-sided-consent-gated: both `YN-#####` and
  `DN-#####` are shape-confirmed → `consent_tight="confirmed"` → the swap is **blocked by design** — because
  it heals a *dropped-glyph* (length change), not a *same-length substitution*.

All edge-heal switches are ON on the -TEST install and the wrong value still commits → a genuine
firing-condition gap, **not** an unflipped switch.

## The fix — placement-arbitrated, at the READ window
Insert at the `_extract_one` commit path (template_mapper.py ~2864/2882, the pad-check block) for every
taught field that committed a value. The machinery already exists — this is **integration**, not greenfield:
- **Recover:** the existing row-bounded padded re-read — code/ref → `_read_pad_window_code`; non-issuer name
  → new `_read_pad_window_name` (same window, psm6 `image_to_data`, contiguous run nearest box-centre via
  `cluster_value_words`, anchor-tail cut via `_pad_label_glued`). Window pads BOTH edges
  (`min(0.8·bw,0.06)` horiz, `0.5·bh` vert = row-bound). Pad is NOT tied to compose displacement (the read
  layer doesn't know it; a generous row-bound pad + token selection is strictly more robust).
- **No-op if `recovered == tight`** (box fit → byte-identical).
- **Certify by PLACEMENT** — reuse **`_snap_union_witness`** (already does exact-union + contiguity +
  directional un-cut-edge anchor + ≥0.6 occupancy against the *taught* box), but source its words from the
  **pad window's own fresh `image_to_data`** (full-page `_ocr_lines` grouping was measured to miss the code
  row), **converted to the page-normalized frame first (C4)**. The un-cut-edge anchor IS the neighbour guard
  — a right-neighbour or the label can never satisfy it. 007 verified it passes both exhibits and rejects a
  neighbour.
- **Decide, fail-toward-review:**
  - **Certified + clean clip-containment** (un-cut side matches, only the cut-side glyph differs —
    `DN-38626`[1:]==`YN-38626`[1:]; or `_name_grow_shape_ok`) AND the field is **code/ref or a non-issuer
    name** → **ADOPT** recovered, method `_edgeclipheal`, cap **87** (`_PAD_CODE_PROVISIONAL_CAP` < 88).
  - **Certified but garbled both sides, OR a healed ISSUER (`supplier_name`)** → **FLAG**: keep committed,
    cap ≤70, `corrected_to = recovered`, note.
  - **Not certified / two equidistant candidates / LR both-cut** → **today's behaviour, byte-identical**.

## Oracle conditions (binding before flip) — carried verbatim into the build
- **C1 note-first:** never lift a value already carrying `validation_note` / `_edge_suspect` / raw-witness /
  `_edge_healed` (mirror the `if result.get("validation_note"): return` 2535 + `not _edge_healed` 2881 guards;
  preserves the `TEMPLATE_NAME_CUT_DEFER_CAP` belt on doc 67).
- **C2 one decision point / one pad read:** replace the `_PAD_DISAGREE_MARGIN` gate for the certified-clip
  class only; otherwise fall through to the existing pad logic. No double-mutation of `_r`; reuse the single
  pad read (no triple-OCR).
- **C3 date overlap:** DO NOT add a third date mutator — scope `_edgeclipheal` to code-substitution +
  non-issuer-name completion. The M=2 dropped-digit date clip stays on the mig-143 `_pad_date_witness` route.
- **C4 coordinate frame:** convert the pad-window word boxes (crop-pixel) to the same page-normalized frame
  as `target_box` before `_snap_union_witness`. Pin a fixture where a crop-offset mis-conversion flips the
  certification.
- **C5 corroboration lift needs a DIFFERENT crop:** an adopted `_edgeclipheal` ref whose 88-floor relaxes
  must require `_corrobLicensedKeyword` (page-text witness), not the box-crop common-mode `_corrobLicensed`
  (two box-crops are common-mode on the same clip; the dominant-shape leg does NOT distinguish `DN-38627`
  vs `DN-38626`). Target it to the method family (add `extraction_method` to the relax read); do NOT widen
  the 08-15 relax globally. **(trust.js work.)**
- **C6 issuer at overall==100:** `supplier_name` is not in `critKeys` and docTrustGate is bypassed at
  `overall==100`, so a silent issuer adopt @87 could auto-file un-gated → healed issuer FLAG-only until the
  M=2 Complementary-B ("capped field drags `overall` < 100") lands.
- **C7 keep the M=2 belt:** `_edgeclipheal` does NOT subsume "run `trust_role_disagreement_refuse` at
  `overall==100`". Ship both; land the M=2 overall==100 secondary safety regardless of this arc (lowest
  blast radius of the lot).

Excluded: **currency** (the totals `_skip_rigid` regime). **dates** (C3).

## Dependency
HARD dep **`template_pad_window_code`** (`TEMPLATE_PAD_WINDOW_CODE`) — the edge-clip branch lives INSIDE
`_maybe_pad_code` and reuses its single pad read, so `_EDGE_CLIP_HEAL_ON = _PAD_WINDOW_CODE_ON and
env(TEMPLATE_EDGE_CLIP_HEAL)`. Inert (strict subset, byte-identical) without the parent. (An earlier draft
said `template_pad_window_read` — that gates the DATE reader; the CODE reader is `template_pad_window_code`.)

**Labelled-box caveat (arm for the flip test):** the commit block calls `_maybe_pad_code` only when
`(not anchor_text) or _pad_labelled_ok`, and `_pad_labelled_ok` needs `template_pad_window_code_labelled`
ON (plus no inline witness / not expanded / not edge-healed). So to heal a **labelled** code clip (e.g. a
`Delivery No.`-anchored delivery_number) the flip test must arm **`template_pad_window_code` +
`template_pad_window_code_labelled` + `template_edge_clip_heal`**. A label-less code box needs only the
first + third.

## Slices — what shipped
- **Slice 0 (DONE):** mig 151 `template_edge_clip_heal` seed OFF + TEST_SWITCH_KEYS entry.
- **Slices 1-4 CODE heal (DONE 2026-09-10):**
  - `_EDGE_CLIP_HEAL_ON` + `_EDGE_CLIP_MIN_INTACT` + `_EDGE_CLIP_FIRES` module flags (template_mapper.py).
  - `_read_pad_window_code(..., return_geom=True)` returns the winning token's **page-normalized** box
    (C4 crop-pixel→page-norm conversion); existing callers byte-identical (2-tuple default).
  - `_clip_edges` (which side overhangs) + `_clip_contained` (only the cut-side glyph differs, `_EDGE_CLIP_MIN_INTACT`
    un-cut glyphs match).
  - The decide branch **inside `_maybe_pad_code`** (C2 one decision point / one pad read): certify via
    `_snap_union_witness([{words:[cand_box]}], cand_box, …, target_box, edges)` → ADOPT the recovered code,
    method `_edgeclipheal`, cap 87. Note-first + healed-method-suffix guard (C1). `_pad_label_glued` reject (C4).
  - JS env plumbing `template_edge_clip_heal → TEMPLATE_EDGE_CLIP_HEAL` nested in the code-reader block.
  - trust.js **C5**: the 88-floor relax requires `_corrobLicensedKeyword` (page-text) for the `_edgeclipheal`
    method family (added `extraction_method` to the critRelax SELECT); every other method unchanged.
- **Slice 5 (DONE):** pins `test_edge_clip_heal.py` — see below.
- **DEFERRED — the NAME half (own slice):** issuer FLAG-only (C6) + non-issuer name ADOPT. Needs a new
  `_read_pad_window_name` (row-bound psm6 `image_to_data`, contiguous run nearest centre via
  `cluster_value_words`, anchor-tail cut via `_pad_label_glued`) AND a **name-specific** placement witness —
  `_snap_union_witness` is code-only (`_code_norm` internally), and `_name_grow_shape_ok` supplies the RIGHT-cut
  completion shape. Logged rather than rushed onto the core read path; the switch, once flipped, heals codes
  in v1. Issuer, when built, is FLAG-only while the docTrustGate `overall==100` bypass stands (C6).

The CODE heal is the owner's delivery_number exhibit (the auto-file-relevant field); the NAME clip
(`Bluefin Marine Li`, doc139 customer_name) is a display-quality field and rides the deferred slice.

## Flip gate (owner-gated; Oracle C5/C7 + the verification gate)
Realdoc OFF==ON outside the fire set; **M=0** (zero new silent wrong commits AND zero new wrong auto-files);
`wouldAutoFile(ON) ⊆ wouldAutoFile(OFF) ∪ {keyword-corroborated-to-truth}`; zero per-field accuracy drop;
the adversarial fire census (every adopt == page truth, hand-checked; ZERO corroboration-lifted on
box-crop-only families under C5); the constructed adversarial neighbour set; throughput budget → Oracle.
