# Taught-direction supremacy package — CLOSED DESIGN (build after the night batch commits)

**Status:** ✅ **c2 BUILT 2026-07-11 EVENING+** (own commit). `engine._flag_taught_field_ownership`
+ shared `keyword.build_caption_vocab`/`value_is_caption` + `tests/test_taught_field_ownership.py`
(23 units). ⚠ Design premise CORRECTED at build: `field_anchors.document_type` stores the **SLUG**,
not the NAME — c2 uses `document_slug` for `anchor_admissible` (a NAME-framed call silently empties
`owned`; pinned). Identity exclusion is PER-TYPE (supplier_name always; customer_name only when sole
issuer — it's a RECIPIENT field otherwise, NOT via the stale `_IDENTITY_FIELD_KEYS`). A/B (same
2495-doc DB): net SAFETY WIN — M 12→9 (caught 3 taught-field ref misreads), per-field IDENTICAL
(HOLD-only), +128 docs (5%) review-bound.

✅ **G3b BUILT 2026-07-11 EVENING++** (own commit). `keyword._search_for_label` caption_guard (kills a
caption-valued candidate at right/below generation) + `extract_fields` threading + engine arming
(name-like ∧ ≠supplier_name, customer-side only). Reuses the c2 shared vocab.
`tests/test_known_caption_guard.py` 18/18; wiring confirmed live (caption_guard_keys=['customer_name']).
A/B (same 2495-doc DB): perfectly NEUTRAL on scored fields (M 9=9, per-field identical) — the design's
neutrality gate (customer_name unscored).

✅ **D1 BUILT 2026-07-11 EVENING+++** (own commit) — **package COMPLETE (D2 = DO NOTHING).**
`anchorLabel.js` pickLabelCandidate/scoreLabelCandidate + comma-orphan in labelLooksSuspicious;
`review/renderer.js` captureAnchorContext reads BOTH strips then picks (no left-first early return),
field-scoped bank = labelFor. `test_anchor_label.js` D1 battery green. Renderer-only, no corpus A/B.
NEEDS A RESTART. Original design below.

**Status (original):** Oracle verdicts per-slice (2026-07-11): **c2 SIGN OFF WITH CONDITIONS · G3b SIGN OFF
WITH CONDITIONS (customer-side only) · D1 SIGN OFF WITH CONDITIONS · D2 DO NOTHING** (keep the
total sweep; salvage only its comma-orphan rule into D1). Build as THREE separate kill-switched
commits (c2 → G3b → D1), after the night batch lands. Cycle: gary + reggie parallel → Oracle.

## The incident (diag-traced, 2026-07-11)
(Bramble & Finch, sales_order, customer_name): a ⊕ re-teach saved a GARBLED label 'esha, i'
dir=right (the LEFT strip wins via captureAnchorContext's left-first EARLY RETURN — the clean
'Customer' caption above is never OCR'd; 'esha' passes labelLooksSuspicious); its authoritative
save swept the good 'Customer'→below anchor (sweep is total + label-quality-blind). On the next
doc the garbled anchor can't locate → blind rigid @50 → LOST a confidence contest to a Stage-1
keyword read 'SO #'@83 (Tier-A needs `located`). KEY FACT (gary F6 = reggie F1, Oracle-verified):
the SHIPPED customer_name pattern (base 78 + 5 right-boost = 83) carries NO role_caption → the
G1/G2/G3 party guards NEVER RAN; and G3's noun-tail vocab misses 'SO #' anyway. Charset guard
caught '#' downstream → 70+note → review (fail-safe held; value junk).

## The slices

**c2 — TAUGHT-FIELD OWNERSHIP GUARD** (engine seam ~2606, beside the recipient guard, BEFORE
identity rescue; kill switch TAUGHT_FIELD_OWNERSHIP_ENABLED): a NON-identity field whose FINAL
method is exactly `'keyword'` (keyword_override exempt BY CONSTRUCTION — Oracle corrected gary's
premise: the shipped doctrine exempts overrides everywhere) + a same-scope AUTHORITATIVE anchor
exists → HOLD-ONLY cap ≤69 + note + review. Value never touched; never overwrites a note.
ORACLE CONDITIONS: (1) skip empty/None values (a 4.5-withheld keyword field must not get a
confusing cap); (2) the hint-agreement exemption must be TRUE _apply_hints parity — same
VARIABILITY GUARD (exempt only where hints WOULD fill: ≥2 distinct confirmed values in scope =
never exempt) AND deny when the hint value is itself in G3b's caption vocab (closes the
twice-mis-confirmed-'SO #'-hint poison loop) — both pinned; (3) ownership admission via
`anchor.anchor_admissible(anchor, final_supplier, document_type_NAME)` + last_authoritative_at
+ field_key + EXPLICIT exclusion of '__unknown__'/'' (field_anchors.document_type stores the
NAME not the slug; anchor_admissible ADMITS '__unknown__' — a hand-rolled slug comparison = a
dead guard that greens every test; pin that the wrapper alone admits '__unknown__'); (4) cap
mechanics mirror the recipient guard (69 self-sufficient, no dead _needs_review set, note order
vs the dup guard deterministic + pinned); (5) note must name the way out: "this field has a
taught position that couldn't be confirmed on this page — the value came from a generic caption
match; please verify (re-teach ⊕, or Settings → Learning Recovery)". Full keyword SUPPRESSION
(the user's literal rule) = slice 2 behind a corpus count of owned-field keyword winners
(one-line escalation at the same seam). "Blind authoritative beats keyword by class" REJECTED —
the Tier-A located gate is load-bearing. Multi-page residual (taught p1, value legitimately on
p2 → capped every time) accepted + test-noted.

**G3b — KNOWN-CAPTION VALUE GUARD** (keyword.py ~55 lines; kill switch
KNOWN_CAPTION_GUARD_ENABLED): for name-like/party fields, a candidate VALUE that IS a known
caption dies at generation (right :797 + below :820 sites, fail-toward-empty). Vocab = the
run's post-merge label banks (shipped ∪ overrides ∪ seeds) + field DISPLAY labels (field_defs
threaded, one line engine.py:1538) — the guard's reach GROWS with the banks. Matching:
token-tuple equality on normalise_for_tokens forms ('SO #'→('so',)) OR joined-form equality
ONLY for multi-token/punctuated candidates ('S.O.No.'→'sono'); NEVER containment/prefix
('Order Solutions Ltd'/'Total Office Supplies'/'SONO' all survive). ORACLE CONDITIONS:
(1) CUSTOMER-SIDE ONLY slice 1 — supplier_name excluded EXPLICITLY (NOT via
_IDENTITY_FIELD_KEYS: anchor.py:2372 still contains customer_name pre-migration-44 — reusing it
SILENTLY NEUTERS the fix; pin "customer_name IS armed"); supplier arming later behind its own
supplier-delta A/B (reward cosmetic — junk @40-45 already review-bound — risk = the widest
scope key in the app); (2) replace the retired "shipped patterns byte-identical" pin with a
DELTA pin (unchanged EXCEPT caption-vocab kills); (3) empty-token-tuple never matches (a
'#'-only label normalises to ()); bare 'SO' single-token dies by rule 1 — pinned; (4)
kill-switch-off test reproduces the old 'SO #' fill; (5) report honesty: customer isn't
corpus-scored — the corpus gate proves NEUTRALITY only; positive evidence = the BF_sal_13-1
E2E + battery. Accepted residual: a company named EXACTLY one caption word dies (hand-type
remains). Prefix rule ('Order Number SO-66820' glued) NOT built (dup-guard + wordness net it).

**D1 — TEACH LABEL-PICK COMPARISON** (renderer + anchorLabel.js, teach-time only): run BOTH
strips (left + above), pick via pure pickLabelCandidate: score 2 = matches a known caption —
FIELD-SCOPED bank (this field's own labels + display label, NOT the global bank — Oracle: a
global bank lets a neighbouring row's 'Date' outscore the true unknown left caption), 1 = not
suspicious, 0 = suspicious; tie → LEFT (status-quo pin); both 0 → position-only (empty label,
never staged garble). The comma-orphan rule (label ending ", <single letter>" = fragment)
lands in SHARED labelLooksSuspicious (retro-benefits the existing suspicious→position-only
downgrade). Pins: tie→LEFT, both-0→position-only, the incident fixture ('esha, i' left vs
'Customer' above → above wins). Cost: one extra region-OCR per teach.

**D2 — DO NOTHING.** The sweep stays total. Rationale: first-value-wins means a surviving
clean sibling is consulted only when the new anchor reads NOTHING (rare — a blind rigid crop at
a taught position almost always reads something); the survivor path opens a NEW silent-wrong
class at full Tier-A confidence (the old WRONG clean anchor resurfacing exactly after the user
tried to correct it — fails AWAY from review); and it breaks the shipped "just re-teach — the
sweep clears the old" recovery semantic (the three live garbled worksheet customer anchors all
pass today's suspicion predicate, so D2 wouldn't even fire on them). If sweep protection is
ever revisited: survivors must be demoted to passive AND review-bound — own design, own Oracle.

## Gates
Three kill-switched commits, each: realdoc_regression M=0 + zero per-field drop + at-100/
auto-file churn eyeball (c2 lowers overall on owned fields — read the REVIEW-VOLUME delta, not
just M). E2E: BF_sal_13-1 ends junk-free (G3b kills 'SO #') → blind @50 fill-if-empty → review;
a clean re-teach ends Tier-A. gary's test suites as designed + the Oracle condition pins.
CX note (intended cost, user's own rule): teaching a field converts generic keyword fills into
review-bound reads whenever the taught read fails — the note text names the escape.

Files: python_backend/extraction/keyword.py (219, 460, 677-704, 745-820), engine.py (1531-1538,
1757-1838, 2606-2615, 2720-2745 _apply_hints parity), anchor.py (342-343, 1044-1084, 2372
_IDENTITY_FIELD_KEYS trap, 2510/2551 anchor_admissible), config/keyword_patterns.json (205-244,
504, 514 — read-only vocab), src/windows/review/renderer.js (2341-2441, 2484-2489),
src/windows/shared/anchorLabel.js (115-168), database/modules/learning.js (451-457 — UNTOUCHED).
New tests: tests/test_taught_field_ownership.py, G3b battery in test_custom_field_seeding.py,
test_anchor_label.js §pickLabelCandidate + comma-orphan.
