# Anchor-crop placement-axis recovery — CLOSED DESIGN (build after the night batch commits)

**Status:** Oracle **SIGN OFF WITH CONDITIONS — both slices** (2026-07-11; C1-C6 blocking).
User proposal ("widen the box 20% / move it 20% / pixel-perfect slices") decomposed by 007 into
three failure geometries needing OPPOSITE cures. Cycle: 007 (general-purpose + persona) → Oracle.

## The decomposition (007, 15 FACTs, Oracle-verified)
- (a) EDGE-CLIP/INTRUSION (the '. = 317437' debris class): box roughly right; extra ink entered
  via the unconditional +20px runtime pad (anchor.py:2274-2275) and/or a sloppy drawn box. The
  live class is INTRUSION, not truncation (the valid token was fully present — trim succeeded).
- (b) WRONG-ROW/WANDERED: inline-harvest/relocate row-picks — NO crop involved; widening adds
  MORE junk. DEFERRED to the standing relocate-geometry design (slice 1's plumbing = its
  instrumentation).
- (c) EMPTY/SLIVER: no retry.
Widen-20% REJECTED (blanket widening re-implements the existing pad bigger; harmful on (b)).
Move-20% REJECTED (blind translation = false-locate generator; evidence-based moves exist:
label-relocate + registration, both re-gated).

## SLICE 1 — read-time snap-to-glyph retry (anchor.py; kill switch SNAP_RETRY_ENABLED)
On a credibility-FAILED crop read of val_type ∈ {alphanumeric, reference_code}: discriminator
(S1 ink projection/sliver; S2 word boxes of the failed read — requires extending `_read` with an
optional boxes out-param, boxes are computed and DISCARDED today at anchor.py:1911-1932; S3
_partial_of_uniform_shape; S4 label-locate agreement; S5 debris-token content) → on INTRUSION
evidence ONLY, ONE re-crop snapped to the union of value word boxes (excluding edge-hugging
micro-debris) + small margins, within the SAME crop instance, one _ocr_crop_laddered pass, same
verify_fn, adopt only on verify PASS.

**ORACLE CONDITIONS (blocking):**
- C1: georetry NEVER enters the `_rec_confident` tier (that tier's premise — glyph preservation
  by construction — is false for a fresh OCR pass). ALWAYS ≤70 + was_corrected/corrected_to +
  a DISTINCT note ("Re-read tightly around the detected text — please verify"). No born-digital
  lift in slice 1. A doc carrying a georetry read is auto-file-ineligible at every floor incl.
  100 (trust.js:443-448 note/corrected_to block — verified).
- C2: S4 MANDATORY in verification mode — the retry requires a NON-EMPTY stored label located
  at the taught position under the existing located-gate semantics (incl. _named_cross_supplier
  + _located_at_taught_position + the C2 weak-core exception, anchor.py:1060-1072). LABEL-LESS
  anchors — authoritative OR passive — get NO retry. (The hole this closes: a PASSIVE anchor is
  located_ok=True unconditionally (anchor.py:1043-1045) — a passive label-less wrong-row snap
  matching a coarse learned shape would ride to 87 NOTE-FREE = silent plausible wrong value,
  the Cloudpeak invoice#-vs-PO# class.)
- C3: INTRUSION-ONLY — truncation evidence (S2 value-token-at-edge or S3) → NO retry (an
  in-crop snap can't recover glyphs outside the crop; a pattern-passing PARTIAL would be
  adopted). Empty read/no boxes → no retry (never substitute ink-band bounds — the sliver-
  hallucination class stays closed). The format-reject branch (:453-467, the "Bookinc"
  wrong-row signature) is NOT hooked — credibility-fail branch only.
- C4: RUNG-FRAME MAPPING — the ladder upscales internally (_light_prep ≥2× for <300px crops,
  anchor.py:1892-1894; the heavy rung _tm._prep 2× always, template_mapper.py:1215-1216); the
  S2 boxes come back in the RUNG IMAGE's frame and must be scale-mapped to the original crop;
  boxes must come from the rung that PRODUCED best_seg, not the last rung tried. (007's F13
  "no frame trap in-crop" was incomplete — the trap is inside the ladder.)
- C5: composition — `_rec_sig = None` on georetry (the accepted-debris allowlist must never
  accept a georetry read; its Accept button never renders on the distinct note; its C1
  crosscheck-rail lift unreachable). Trim-first order pinned (_slipfix → _recover_clean_token →
  snap-retry; trim success → NO re-read). Gate-reread method gates disjoint (verified);
  adoption counts reported SEPARATELY in the harness.
- Should (non-blocking): kinship-lite on adoption (adopted value shares most alnum content
  with the failed read).
Slice 1b (directional micro-grow on truncation evidence) stays RECORDED, DEFAULT OFF.

## SLICE 2 — teach-time value-box snap (review renderer runZoneOcr; no engine surface)
The ⊕ draw already gets per-word boxes (region.py --boxes, mapped to crop px :196-198) and
uses only lines>=2. Snap the STORED rect to the union of words whose tokens appear in the
accepted value text; <50% token match → keep the drawn rect (fail-open); ASYMMETRIC — snap
left/top/bottom, KEEP THE DRAWN RIGHT EDGE (values grow rightward; the operator's right slack
is information); offset (value-centre − label-top-left) recomputed from the snapped centre —
one sloppy draw currently poisons BOTH the rigid box and the offset replay (renderer.js:
2252-2307); snapped box REDRAWN on screen. Label strip already glyph-snapped (no-op). NO
migration — old anchors self-heal on re-teach, covered by slice 1 at read time meanwhile.
**C6 (blocking):** snap ONCE, BEFORE `lastTeachCtx` is written (renderer.js:2028) — the
direction-flip path (reDetectAnchor re-stages from lastTeachCtx.rect, :2545-2552) would
otherwise silently REVERT the snap; all consumers (initial capture, reDetectAnchor, offset
math, redraw) see only the snapped rect. Docs honesty: caption exclusion holds only when the
accepted text excludes captions (normalizeDrawnValue only normalises currency/date). 2b (teach
wizard / Template Wizard target draws) after ⊕ proves out.

## Gates (C7/C8)
Per-slice commits, post-batch queue (C8 — the direction-supremacy design doc exists:
docs/designs/DIRECTION_SUPREMACY_DESIGN_2026-07-11.md; whichever of the two builds SECOND
re-runs the first's pins). 007's unit list stands + the condition units (passive-label-less
no-retry; truncated-partial never adopted; <300px rung-scale snap correctness; georetry-≤70
at floor 100; accepted-signature never lifts georetry; direction-flip preserves the snap).
Corpus A/B: M=0, zero per-field drop, georetry adoption count separate from gate-reread's,
every adoption eyeballed; E2E: the live PO3618-class doc (slice 1); re-teach on MP_sal_35/
MP_wor_47 + phantom-label suite green (slice 2). Licence: numpy BSD-3 already bundled; no new
dependencies.
