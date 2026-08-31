# DESIGN (NOT BUILT) — Late-rescue taught-field displace (the Saltmarsh "every field flagged" fix)

**Status:** gary-designed 2026-07-15 · **Oracle vet PENDING** · **NOT built** (owner asleep, "no code changes").
Owner chose this direction ("fix the false per-field warnings, targeted") over the deeper logo-collision overhaul.

## The problem (root-caused, confirmed empirically)
A supplier whose logo COLLIDES with another's in the coarse 64-bit template phash (measured: **Saltmarsh Seafoods "SS" monogram is 6 bits from Copperfield Electrical's logo, 12-16 bits from its OWN template #30**) gets identified LATE:
1. `identify_template` lands on the wrong (Copperfield) cluster → `ambiguous_type` → the safety nets correctly REFUSE to apply it (no wrong-supplier filing — good).
2. No template applies → the supplier only resolves at **Stage 2.5a** via the text-scan hint (correctly → "Saltmarsh Seafoods").
3. Because the supplier was UNKNOWN at Stage 2, `_anchor_matches` never admitted Saltmarsh's OWN taught anchors, so every taught field (reference_number/date/customer) fell to a plain keyword read.
4. **Stage 2.6 late-anchor rescue is FILL-EMPTY-ONLY** (`engine.py:2932`, `:2960-2962`), so it skips the keyword-filled taught fields → their anchors never run → `_flag_taught_field_ownership` caps EACH @69 + "taught position couldn't be confirmed."

The reads are actually CORRECT (WS-99609, the date, Bluefin Marine Ltd) — just all flagged. The codebase's own comment at `engine.py:2913-2921` names this exact gap and the fix ("let an authoritative LOCATED rescue read displace a plain seeded keyword incumbent, mirroring is_taught_override").

## The fix (gary's smallest-correct design — build to this after Oracle signs off)
Extend Stage 2.6 so a keyword-held authoritatively-taught field runs its own anchor, and a **LOCATED + AUTHORITATIVE** rescue read **DISPLACES** the keyword incumbent (capped ≤85). The ownership guard needs no change — changing the method away from `'keyword'` bypasses it deterministically.

Three edits (kill switch `LATE_RESCUE_TAUGHT_DISPLACE`, default ON):
1. Extract a shared `_authoritatively_owned_fields(anchors, supplier_name, document_slug, field_defs)` from the guard's `owned` derivation (`engine.py:1666-1677`) so rescue + guard stay in lockstep.
2. Relax `rescue_set` value-filter (`engine.py:2928-2932`) to `((not value) OR (LATE_RESCUE_TAUGHT_DISPLACE and method=='keyword' and field_key in owned))`.
3. Add a displace branch in the merge loop (`engine.py:2960`): if incumbent has a value AND kill-switch on AND incumbent.method=='keyword' AND key in owned AND `data.authoritative` AND **`data.located` (LOCATED ONLY — blind never displaces)** AND data.value → adopt `data` capped `min(conf, _LATE_RESCUE_CAP=85)`, mark `late_rescue`, and on value-DISAGREEMENT add a "read from the position you taught… please verify" note (agreement stays clean). Reuse `_cmp_norm` (`engine.py:201`).

**Why displace (not corroborate-only):** displace is deterministic (method change bypasses the guard) and also fixes the DISAGREEMENT case (the located taught read is Tier-A and wins — restoring the "teach displaces keyword" precedence). Corroborate-only relies on `_anchor_corroborates` vouching on `authoritative` alone, which a blind read could fool.

**Safety (gary):** LOCATED-only (blind stays fill-empty); ≤85 cap keeps ref/date below the 88 critical floor; no-template docTrustGate blocks sub-100 auto-file; supplier itself ≤85 in the rescue domain so overall can't be 100 → no new auto-file-wrong path. Same-supplier false-locate risk is the identical risk `is_taught_override` already accepts for early-resolved docs (bounded, capped, review-routed).

## Verification gate (before ship)
- Unit `test_late_anchor_rescue.py`: displace-on-located-taught-keyword; keep-fill-empty-for-blind; don't-displace-a-stronger-method; don't-displace-non-owned; agreement-no-note; **cap-pin ≤85**; kill-switch byte-identical. Revise existing test 3 (the keyword-held owned field is now legitimately in the rescue call).
- Unit `test_taught_field_ownership.py`: after a displace the guard does NOT fire; reverse pin — a blind/kill-switched keyword-held owned field STILL gets @69+note.
- E2E fixture reproducing Saltmarsh #337 (supplier at 2.5a via hint; a located+authoritative reference_number anchor) → after fix method≠keyword, ≤85, no ownership note; kill-switch off → @69+note (proves causation).
- Corpus `realdoc_regression.js` A/B: **M=0 (baseline) + zero per-field accuracy drop**; watch the disagreement set for a false-locate displacing a correct keyword read.

**Pins:** keep-fill-empty-for-blind (no re-broaden to blind), don't-displace-a-stronger-method, cap ≤85, ownership-guard reverse pin.

## Remaining before build
1. Oracle vet of this design (seam + the ≤85/located-only safety + composition with the identity guards).
2. Then build to the spec, run the gate.

## Deeper root (deferred, separate) — the logo collision itself
The 64-bit region phash can't separate Saltmarsh's monogram from Copperfield's (6 bits). The real root fix is Slice D (256-bit isolated-mark detail hash) as the PRIMARY *template* matcher (currently only wired for the logo-fingerprint path). Bigger, needs Phillip + gary + Oracle + re-enrollment. This late-rescue fix removes the UX pain without solving the collision.
