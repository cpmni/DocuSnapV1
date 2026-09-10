# ANCHOR_AXIS_LOCK — additive width-invariant label-column read (mig 155, DARK)

007 + reggie + gary → **Oracle SIGN-OFF-W/COND**. Built DARK. Kill switch `anchor_axis_lock` /
env `ANCHOR_AXIS_LOCK`, in `TEST_SWITCH_KEYS`. Byte-identical OFF. Owner constraint: change NO existing
mechanism — this is a **complementary candidate**, not a modification.

## The problem (007 root cause, verified)
`Vellum&CraneStationers_delivery_docket_20.pdf`, `customer_name` taught off "Deliver To". Value
`Halcyon Leisure Group` reads correct (@90) but the READ-BOX visibly drifts RIGHT. Cause: the anchor
stores the value box **CENTRE**, and `offset_dx_norm = value-centre − label-left ≈ ½·taught-width`. The
taught sample (Brightwater Dental Practice, 27ch) is wider than this value (21ch), so the box is pinned
~3ch right of the actual value; the `+20px` free-text headroom is why it still reads clean → **latent
fragility** (the free-text twin of the mig-141 code-clip bug). A sibling with a bigger block shift slides
the value out of the box → wrong read.

## The fix — an ADDITIVE candidate
A new `anchor_axis_locked` candidate reconstructs the value's **left edge from the LOCATED label column**
(width-invariant), grows to the value row's own column boundary, and competes only where no authoritative
read won. It NEVER changes an existing rung.

- **Emitter** `anchor.py._axislock_read` (new, ~4342), hooked in the label-lock rung (~889, inside
  `if _dlb:`, after the position-veto at :725-731 — so it inherits `_dloc` + the veto). Free-text / name
  fields only (`is_name_like_field`), direction below/above/right, offset present.
  - Left edge `col_left = label_box.x + offset_dx − w/2` (the `_label_left_limit` formula, reimplemented
    because that fn returns None for free-text/below).
  - Right edge from the value row's OWN column: below/above OCR a full-width strip at the value row
    (`template_mapper._ocr_lines`), pick the line nearest the value-centre-y, `cluster_value_words(row,
    expect_x=col_left)` (the med_h*1.2 gap split — reggie's SOLE precision defence against a merged
    neighbour); `right` reuses the located `inline_box` (already column-bounded).
  - Full existing gate stack: `strip_name_edges` · `_name_field_code_reject` · `_crop_is_credible` ·
    `_qualify_against_format` · `_name_junk_shaped` · `_is_bare_label` · `_is_caption_band_read`.
  - **C4 emit-gate:** emit ONLY when the read is a strict SUPERSET/LONGER than the incumbent (the clip
    signature) OR the field is EMPTY. A shorter/equal read (multi-line recipient truncation) → no emit.
  - Stashes a transient `_axislock_candidate` on the result dict at the `_crosscheck_original` emit site
    (~1695). Never sets value/method here. `try/except → None` (fail-safe).
- **Reconciler** `engine.py._reconcile_axislock_winners` (new, ~2535), called in the post-merge tail
  (~12033) AFTER `_adopt_pad_date_winners`, BEFORE `_universal_postmerge_verify`. For each field carrying
  the stash (always popped):
  - **Precedence:** replaces only when `_override_eligible(incumbent)` is True — never an authoritative
    ⊕ anchor, a Stage-0.5 mapping, or an admin label. So on the motivating exhibit (authoritative
    `anchor_crop`) the candidate is **popped + discarded → INERT**. The arc heals the PASSIVE/empty clip.
  - **Review-bound:** cap ≤87 (empty-fill or superset agreement) / ≤69 (a longer DISAGREEING read →
    stronger review); ALWAYS carries `AXISLOCK_VERIFY_NOTE`. Never auto-files (see C1).
  - **Kept OUT of `_field_candidates`** (C3): never a corroboration witness.

## C1 — the mig-142 ship-blocker (shipped as CODE with the arc)
On the target class (`customer_name`, optional non-role) the ≤87 cap is **inert** (the 88 floor guards
ref/date only; overall is scored from *required* fields), so the note is the SOLE checkpoint — and mig-142
(`optional_soft_flag_autofile`) dissolves exactly that soft-note class. Without a carve-out, both-ON = a
possibly-wrong axis-lock read auto-filing silently. Fix: `trust.js.isAxisLockNoteRow` keys on the
**`anchor_axis_locked` extraction_method** (a structured sentinel, not the note copy) → the note is NEVER
soft-cleared, at BOTH soft-clear sites (`_flaggedSoftAware` + docTrustGate). Pinned: `test_scope_trust.js
§26` reproduces the misfile (control soft-clears) and proves the carve-out holds (both-ON still blocks).

## Honest limitations (no regression, but bound the efficacy)
- **Inert on the motivating exhibit** — the authoritative read wins there; the arc only helps
  passive/empty siblings.
- **Anchor-family only** — the candidate rides the anchor result dict, so it reaches the reconciler only
  where the anchor family won the merge (the clipped-anchor core case) or the field is anchor-produced. If
  a KEYWORD incumbent won, the candidate is dropped (byte-identical for that field). Safe (narrower than
  the full "beat a weak keyword" design); broadenable later if the census warrants.

## Verification
- Pins GREEN: `python_backend/tests/test_anchor_axis_lock.py` (26 — below-heal, right-mirror,
  exhibit-inert via `_override_eligible`, keyword/Stage-0.5 discarded, disagreement→≤69+note,
  empty-fill→note, C4 superset-only, position-veto, null-offset, OFF byte-identical, not-in-ledger,
  method-persists) + `test_scope_trust.js §26` (C1 both-ON) + `test_migration155_anchor_axis_lock.js`.
  OFF byte-identical re-verified on `test_anchor_name_lock_guard.py` + `test_anchor_drift_guard.py`.
- **⚑ FLIP GATE (owner-owed):** the corpus A/B (`realdoc_regression` RR_APP_ENV=1 OCR_RENDER_DPI=200,
  OFF vs ON): G1 byte-identical-outside-class, M=0 (wouldAutoFile ON⊆OFF + ON-only==GT), placement
  accuracy `|box_centre − glyph_centre|` up on the below/right class, zero regression on
  money/inline/totals-reflow/registration. **C6:** a fire-census on a real docket/free-text corpus —
  **zero real fires ⇒ STAY DARK** (do-nothing-in-practice; not worth the merge-tail blast radius). Include
  a constructed mis-resolved-supplier / abutting-column (gap ≤ med_h*1.2) adversarial. Note the corpus
  gate runs mig-142 OFF, so it is BLIND to C1 — the §26 both-ON pins are the only gate that reproduces it.

## Fire-census RESULT (2026-09-10) — STAYS DARK
Ran the C6 fire-census on the owner's live DB (227 confirmed docs, 81 delivery notes + 42 worksheets — a
DB copy; the 605 Test Corpus is not in a reprocessable DB post-reset). **The corpus holds exactly ONE
below/right free-text taught anchor: Vellum & Crane "Deliver To" `customer_name` below** (the exhibit's
own scope; `delivery_number` right is a ref field → gated out, names-only). Direct OFF-vs-ON reprocess of
that scope's 20 docs: **0 axis-lock wins, 0 committed `customer_name` changes.** The anchor is
AUTHORITATIVE → the reconciler discards the candidate on every doc (`_override_eligible` = false, the
designed inert behaviour). No passive/weak below-label free-text field exists for it to heal.
**VERDICT (Oracle C6): zero real fires ⇒ STAY DARK** — the arc is dormant insurance against the latent
fragility (a future doc whose value slides out of the taught box), not a current heal. It remains built +
pinned + committed DARK; no flip. Census script: scratchpad `axislock_census.js` (session-mortal).
