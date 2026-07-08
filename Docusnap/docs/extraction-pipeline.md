# Extraction pipeline — extracted from CLAUDE.md
> Deep reference split out of the always-loaded CLAUDE.md (2026-07-03) to keep the root
> memory lean. Read this when a task touches this area. Nothing here was changed — verbatim move.

## Extraction pipeline
```
process_docs.py → ExtractionEngine.extract()
  Stage 0:   template_matcher.py — match a learned template, seed fields from it
             SAME-LOGO DISAMBIGUATION (identify_template): the logo identifies the
             SUPPLIER, not the doc type — a supplier that sends several layouts
             under ONE letterhead has several templates with near-identical logos.
             identify_template no longer returns on the first logo hit; it gathers
             ALL close logo candidates and, when >1 fall in the same-logo cluster,
             picks the one whose KEYWORD FINGERPRINT matches the page (what tells a
             "Purchase Order" from a "Service Worksheet"). A lone candidate keeps
             the fast logo short-circuit. The winner carries its own slug.
             DOC-TYPE SLUG RESOLUTION (the format/qualification gates key on
             document_slug; a null slug silently DISABLES them → wrong-row crops
             commit and drift relocation never fires). Sources, in precedence:
             (a) REPROCESS passes the document's already-assigned doc-type slug
             (handler --known-doc-slug → process_docs uses it over re-detection,
             which fails on a clipped scan) — ALWAYS WINS; (b) FRESH SCAN:
             process_docs adopts a confidently-MATCHED TEMPLATE's doc type + FIELD
             SET over weak keyword name-detection (the template is the stronger
             type signal), so slug, fields and the doc-type-scoped anchors all
             agree; (c) when a template matches and the caller still resolved no
             slug, engine.extract adopts matched_tmpl.document_type_slug.
             ALSO FIXED: build_format_class_index
             (format_anomaly_checker) used to drop every EMPTY-SUPPLIER entry, so
             the document-agnostic doc-type-scoped groups getFieldFormats emits
             ('', slug, field) never entered the index — the gate was effectively
             OFF for supplier-independent setups (only visible on a drifted crop,
             since a clean crop reads the right value anyway). Now it requires only
             doc_type + field_key; supplier may be empty.
  Stage 0.5: template_mapper.py  — admin-drawn anchor→target zone mappings
             (Settings → Templates → "Map a Field"; only runs when the matched
             template has enabled mappings AND page images are available).
             Returns the same result shape as anchor.extract_with_anchors();
             engine.py merges it into results by confidence comparison — the
             same approach Stage 2 uses for its anchor results below.
             GROUP-SHARED MAPPINGS: when the matched template has NO enabled
             mappings of its own but belongs to a group, it BORROWS enabled
             field_mappings from a grouped sibling that has them
             (engine.select_mapping_source; borrowed anchors are still
             re-validated on this page). Template groups are otherwise
             organisational only.
             ABSOLUTE-TARGET-FIRST (template_mapper._extract_one): the EXACT drawn
             target box is read FIRST — the same region the Template Wizard's live
             zone-OCR (region.py) read at teach time — and only if that read fails
             the gates does it relocate. Previously a located anchor ALWAYS
             re-derived the crop from located-label + offset (with an estimated
             inset), so the drawn box was never read on a clean page; an imprecise
             tight-bbox for a short/generic label (e.g. "Ticket Logged") slid the
             derived crop off the value → "Not found"/garbage even with no drift,
             while live "targeted selection" of the same box always read clean.
             Now first-instance extraction MATCHES targeted selection. The
             offset/inset arithmetic stays ONLY in the relocation fallback, so the
             "PROFILE"→"ROFILE" leading-inset clip cannot reappear. Mirrors Stage
             2's rigid-crop-then-relocate model.
             INLINE HARVEST + label_box (template_mapper._relocate_and_read, 2026-06 —
             the real "anchor and data point aren't linked" drift fix; led by agent 007
             + oscar, frame-cleared by eric): the SHARED relocation helper now reads a
             key/value row the way Stage 2 (anchor.py) always has. (1) INLINE HARVEST —
             when the located label's OCR line is "label …gap… value" ("Ticket No.
             2605-0769-1"), the value words are read STRAIGHT off the line
             (_locate_anchor.inline_value), gated like a crop read, no extra OCR. (2)
             label_box GEOMETRY — the geometric fallback derives off the TIGHT label_box,
             NOT the whole OCR LINE box (which overshoots the value and made the
             relocation refuse/misderive → fall to the registration transform → read the
             row ABOVE); _located_too_wide now only guards the legacy no-label_box case.
             CLEAN ABSOLUTE READ IS AUTHORITATIVE (2026-06, REVISED): _extract_one
             relocates ONLY when the label is found DISPLACED (_label_drifted) — or when
             the absolute read FAILED its gate (falls through to the registration arbiter /
             late fallback). It NO LONGER fires the harvest "regardless of drift" on every
             key/value row: that re-read the whole OCR LINE and could REPLACE a clean drawn-
             box read with a garbled line read on a NON-drifted page ("Beaumont Care Homes
             Ltd - Comber" → "pantionahe MUGS Liu COTVCE"), then lose to a junk keyword. On
             a clean page the operator's drawn box already sits on the value, so its
             absolute read (the same one the live draw tool reads at 100%) STANDS; genuine
             drift the per-label test misses is caught by the registration arbiter below.
             (Stage 2's inline harvest was already correctly rigid-first — gated by
             _should_replace, only overriding a WEAK rigid read — so it was unchanged.)
             Guarded by tests/test_inline_harvest.py + test_template_mapper_drift.py. (DEFERRED, see OCR_WORKFLOW_REVIEW.md:
             resolve_geometry/_extract_one CAPTURE POLLUTION — all rungs capture
             kind="target", so the diagnostic green box can show a non-winning rung; and
             tie _label_drifted's coarse fixed _DRIFT_FLOOR to line height for label-ABOVE
             layouts.)
             DRIFT GUARD (closes the old absolute-first trade-off for LABELLED
             mappings): a stationary drawn box on a shifted page (e.g. a mapping
             taught on a CROPPED scan, then run on the UNCROPPED reprocess where
             every row moves down) reads a credible-but-WRONG neighbouring line,
             which shape_mode='ignore' can't catch — so it used to commit and
             short-circuit relocation. Now, BEFORE accepting the absolute read,
             when the mapping has a real anchor_text and the anchor LABEL is found
             DISPLACED beyond a per-axis tolerance (_label_drifted: box-centre
             distance vs half the drawn box per axis, floored; only on a genuine
             matched_text, never proximity-only), the value is re-derived from the
             label's ACTUAL position via the drift-invariant stored offset
             (_relocate_and_read, shared by this early branch and the late
             single-label fallback) and preferred. The pre-cached LOCAL locate is
             reused; only a large shift that missed it triggers ONE page-wide
             locate, and ONLY when the absolute read was non-empty — so a clean
             page (label at its spot) pays no extra OCR and behaves byte-identically
             (absolute, conf 90). A failed relocation falls through (no worse than
             before). Blank/legacy NULL-anchor_text mappings are unaffected.
             DRIFT SAFETY GUARDS (so relocation can't trade one failure for
             another): (1) _located_too_wide — relocation REFUSES a "label" match
             that spans far more than the drawn anchor box (≥2.5× its width, min
             0.30 page-width): cross-column form rows OCR-merge into one line
             ("Ticket No. … Work Address Beaumont…"), and relocating off that row's
             left edge reads the wrong column (garbage). On refusal it falls
             through (early branch) / omits the field (late path) instead of
             committing junk. (2) _is_ocr_debris — the shared gate rejects
             fragmented free-text OCR junk ("aan EE ..... 4 4.3 Fs . J... .";
             replacement-char reads) so it can't scrape past the lax free-text
             credibility and commit — forces fall-through to registration or a
             clean absolute read. Both guarded by test_template_mapper_drift.py.
             ANCHOR-LABEL AUTO-CAPTURE (wizard, review/renderer.js): so every new
             mapping HAS a label to track, when the Template Wizard ANCHOR LABEL is
             left blank the drawn anchor box is OCR'd (existing ocr-region recipe),
             sanitised (sanitizeAnchorLabel mirror — drop refs/dates/serials), and
             populated into the VISIBLE, editable input before save; empty/failed
             OCR → null (legacy). Guarded by tests/test_template_mapper_drift.py.
             REGISTRATION RUNG ("register, then read", registration.py): the rung
             BETWEEN the absolute fast-path and the single-label refinement. When
             the matched template carries taught LANDMARKS (template_landmarks,
             migration 22 — auto-derived from the sample page by ocr/landmarks.py,
             3-5 stable/unique/well-spread words; captured on sample-pin and
             backfilled for existing templates), they are RE-located on this page
             and a robust similarity/affine transform is fitted ONCE per page
             (registration.fit_transform — NumPy + RANSAC, NO OpenCV) mapping the
             taught frame onto the incoming page. Each taught target box is mapped
             THROUGH the transform, so a shifted/skewed/SCALED scan still finds the
             value regardless of registration — the headline capability. Gated by
             the registration_enabled setting (default ON; INERT without landmarks,
             so templates without them behave exactly as before); a too-few/poor
             fit (RANSAC inliers/residual) falls through. Confidence comes from the
             fit quality (registration.registration_confidence). Method tier
             template_registration[_expanded][_salvaged]; engine protects these via
             _STAGE05_LOCATED_METHODS.
             REGISTRATION ARBITER (the rung is no longer fallback-only): the
             registration read body is factored into _read_registration (shared),
             and an ARBITER runs BEFORE the absolute-read return — after the
             per-field _label_drifted guard. When a page transform is fitted AND
             registration.box_divergence(transform, target_box) (normalised
             centre-distance between the drawn box and its transform-mapped image)
             exceeds the same "still on this row?" band _label_drifted uses
             (max(h*0.5, _DRIFT_FLOOR)), the page is registered DIFFERENTLY from the
             taught frame, so the stationary absolute box is reading the wrong row —
             a credible-but-WRONG type-valid neighbour that shape_mode='ignore'
             can't catch and the per-label guard misses on a generic/merged-row
             label. The registration read is then preferred; a failed reg read falls
             through to absolute (no worse than before). CLEAN pages → transform ≈
             identity → divergence ≈ 0 → arbiter never fires → absolute fast path
             BYTE-IDENTICAL (only cost: one apply_box, no OCR). Guarded by
             tests/test_registration_arbiter.py. NOTE the prerequisite is that the
             matched template HAS landmarks — a template pinned to a sample whose
             files were since removed (or never backfilled) has none; Settings →
             Template Manager → "Regenerate landmarks" (regenerate-template-landmarks
             IPC → generateLandmarks, no re-pin) or "Import Sample…" (clean original)
             recomputes them. generateLandmarks now also SEEDS logo_phash from the
             sample (landmarks.py --emit-phash → compute_logo_hash; stored ONLY when
             the template has none, never overwriting an established phash) so a
             sample-pinned template becomes matchable — closing the empty-phash
             ORPHAN class (templates that can never match, e.g. blank create-template
             rows). (Stage 2 anchor arbiter: DONE — see the Stage 2 reorder note below.) This REPLACED the old translation-only
             consensus-drift fallback: page_geometry.py (content-free page-corner
             "landmarks"), _consensus_drift and _drift_fallback were REMOVED — a
             real content-landmark transform strictly supersedes a corner prior +
             translation guess. SHARED GATE (_gate_value): one helper applied by
             the absolute path, the registration rung AND the single-label path —
             order = date-salvage (C1) → _crop_is_credible (the field's REGEX/TYPE,
             always enforced) → _format_rejects (the LEARNED-SHAPE consensus vs
             confirmed history — statistics, NOT the field's type).
             MANUAL-ANCHOR PRECEDENCE (rung-aware shape gating): a hand-drawn
             mapping is a deliberate human OVERRIDE of learned history, so it must
             win on regex/TYPE alone — it must NOT be vetoed by the learned-shape
             check. _gate_value takes a shape_mode: the ABSOLUTE drawn-box read uses
             'ignore' (skip _format_rejects entirely — the operator's own box on a
             non-drifted page can't column-bleed, so regex/type is the right and
             OCR-safe qualifier); the DERIVED rungs (registration + single-label
             relocation, where column-bleed actually happens) use 'flag' — a
             type-valid value that fails the learned shape is KEPT but capped at
             conf ≤70, tagged "..._shapewarn" and given a validation_note for
             review, instead of being silently dropped. ('drop' is the legacy hard
             reject, kept as the default for any other caller.) This fixed the bug
             where a type-valid manual value was silently dropped by _format_rejects
             and the WRONG auto/keyword value then won on reprocess. Auto tiers
             (Stage 2 anchor / keyword) keep FULL type+shape gating — unchanged.
             engine._is_stage05_located() is now a PREFIX test (template_mapping* /
             template_registration*) so every suffix combo — _salvaged, _shapewarn,
             _expanded — gets the same protection (keyword can't demote it; a
             non-authoritative auto-anchor can't clobber it). Guarded by
             tests/test_template_mapper.py (test_gate_value_shape_modes,
             test_manual_anchor_shape_precedence).
             DATE SALVAGE (C1): when a
             date crop FAILS the strict date credibility pattern (OCR spacing
             around separators, or a date wrapped in junk), it is rescued/
             normalised via validator.salvage_date (the same recovery Stage 4 uses)
             instead of being dropped; salvaged dates are capped at conf 70 and
             tagged method "..._salvaged". A clean date passes untouched at full
             confidence. Salvage handles spacing/embedded-junk, NOT glyph misreads
             (a year OCR'd "202G" still falls to review). engine.py protects the
             located salvaged methods via _STAGE05_LOCATED_METHODS.
  Stage 1: keyword.py    — regex patterns from keyword_patterns.json (~60-70% fields)
           LABEL-MATCH BOUNDARY GUARD (_label_pattern, 2026-06): a SINGLE-word ALPHABETIC
           label now carries the same word-boundary guard as _type_keyword_pattern
           ((?<![a-z0-9])…(?![a-z0-9])) so a short caption can't anchor on a SUBSTRING of a
           longer word — "Total" inside "Subtotal" (the silent subtotal-filed-as-total bug),
           "Date" inside "Mandate", "From" inside "Frome". Multi-word labels are already
           specific (unchanged); the only loss is a label glued straight onto its value with
           no separator ("Date2026"). Fixes SHIPPED extraction for every supplier, not just
           presets. ANCHOR/MAPPING LOCATOR BOUNDARY GUARD (template_mapper._label_score,
           2026-07): the SAME "Total"⊂"Subtotal" substring trap lived in the anchor/mapping
           label LOCATOR (shared by Stage 0.5 mappings AND Stage 2 ⊕ anchors via
           _locate_anchor / anchor._locate_in_text_lines) — `needle in haystack` scored a
           PERFECT 1.0 for "total" inside "subtotal", so on a drifted/variable layout the total
           anchor's label search TIED "Subtotal" with "Total" and PROXIMITY picked the wrong row
           (visible as the located-label blue box landing on "Subtotal:"). _label_score now
           requires the needle boundary-aligned ((?<![a-z0-9])…(?![a-z0-9])); a glued sub-token
           scores 0.0 — closing BOTH false-1.0 paths (the `in` check AND find_longest_match's
           whole-needle run) — so a real standalone "Total" wins outright regardless of
           proximity. Reusable for any label that is a substring of a longer on-page label
           (amount⊂"amount due", date⊂"due date"). Guarded by tests/test_template_mapper.py
           (test_label_score_word_boundary). OVERRIDE VALIDATION-BY-ROLE (merge_label_overrides + _infer_validation):
           a per-install field-label override seeded onto a field with NO shipped pattern
           entry used to be accepted BLIND (extract_fields gates only when a "validation" key
           is present). It now gets a format gate inferred from the field-KEY role (mirrors
           engine._is_ref_field/_TYPE2VAL: *_date→date, *_number/_no/_ref/reference→
           alphanumeric, amount/total→currency; free-text/name → none) — so a custom ref/date
           field (remittance_number, statement_date, …) is validated, not blind. Both guarded
           by tests/test_keyword_label_guard.py.
  Stage 2: anchor.py     — learned label positions + logo supplier ID
           DOC-TYPE SCOPING (_anchor_matches): a learned anchor is keyed
           (supplier, document_type, field_key). It used to fire on SUPPLIER match
           ALONE — so a supplier that sends several doc types had its
           purchase_order anchors (po_number/po_date) and invoice anchors fire on
           its worksheets too (a Frankenstein field set, which made doc-type
           autodetection look broken). Now a TYPED anchor may NOT cross into a
           DIFFERENT known doc type, even for the same supplier (the doc type is
           the layout). Only enforced when BOTH types are known; if detection
           couldn't resolve the doc type, the broad supplier fallback is unchanged.
           DEGRADED TEXT-LINE ESCALATION (ocr/text_enhance.py): for text/multiline
           fields only, when a crop read FAILS the credibility/format gate the SAME
           crop is re-read with a heavier recipe (denoise + Sauvola adaptive
           threshold + mild unsharp, taller pad) and committed only if it then
           passes — recovers a degraded company-name line ("Beaumont Care Homes" →
           "pe fomes") the noise-amplifying base recipe mangled. Gate-triggered, so
           numerics/clean reads/the wizard+label paths are byte-identical. Dev-only
           anchor_reject trace records what each rung READ + which gate dropped it.
           CROP OCR RECIPE: anchor._crop_and_ocr now uses the SAME recipe as the
           ⊕ target-draw tool (region.py) and Stage 0.5 (template_mapper._prep):
           greyscale→upscale→autocontrast→sharpen + PSM 7 (was a plain 2× resize
           + PSM-6-only read, which was lower quality and inserted spurious
           separators — a serial "H7R5326676" committed as "H/7R5326676" even
           though the identical crop read clean via the target tool). PLUS
           _repair_single_token: when a SINGLE-token value (no spaces, not a date)
           comes back with a stray "/" "\" "|", it re-reads the same prepped crop
           in a few modes (PSM 7+alphanumeric-whitelist, PSM 8, PSM 8+whitelist)
           and keeps the first whose glyphs are otherwise identical (strips junk
           separators, never changes characters). SHARED: template_mapper._crop_and_ocr
           (Stage 0.5, the admin anchor-wizard path) calls the same repair, so both
           crop paths behave identically. Reusable for every supplier/field.
           SHARED SEGMENT CLEANING (anchor.clean_crop_segment, B1): both crop paths
           also share ONE segment-selection helper — column-gap split, city-comma
           cut, and a SHAPE-AWARE postcode/year trim for free-text fields. The trim
           only fires when ≥2 alphabetic words precede the 4+ digit run
           ("Ann Blume 10115 Berlin"→"Ann Blume"), so a name/address whose OWN token
           is the number ("Unit 4 1024 Park", "Site 4012") is no longer amputated to
           a fragment (the old blanket \s+\d{4,} split). Non-text/ref fields keep
           their digits. template_mapper._clean_value delegates to it.
           DRIFT RECOVERY (_relocate_value_by_label): the ⊕ crop is tried at the
           stored coords FIRST (fast path); if that read fails its credibility/
           learned-format gate (a shifted/clipped scan moved the value off the
           rigid box), anchor.py RE-FINDS the taught label on this page (reusing
           template_mapper._locate_anchor — local then page-wide) and re-derives
           the value crop ADJACENT to where the label actually landed, so the
           value FOLLOWS the label's displacement (method anchor_crop_relocated).
           Coordinates are only a HINT; the label drives the read — same anchor+
           relative model as Stage 0.5, brought to ⊕ anchors. Runs only after the
           rigid crop failed, and the relocated value still must clear the same
           credibility + format gates. Generic to every supplier/field.
           DRIFT-INVARIANT OFFSET (migration 21, field_anchors.offset_dx/dy_norm):
           the ⊕ teach captures the located LABEL's box (ocr-region-boxes →
           region.py --boxes; renderer labelOffsetFromBox) and stores
           offset = value-centre − label-top-left, page-normalised. Relocation
           places the value at located-label + offset (exact) instead of the
           coarse adjacency guess. Because label and value shift together, the
           offset is the SAME taught on a clipped/shifted scan as on a clean page
           — so correcting a field on a bad scan no longer re-points the canonical
           anchor and poisons normal-page extraction. Legacy rows (NULL offset)
           fall back to the geometric guess. (Stage 2 — cross-field consensus
           resite via a shared drift module — deferred.)
           LABEL LOCK — labelled free-text follows its LOCATED label (anchor.py, 2026-06,
           REVISED): a rigid crop reads ABSOLUTE coordinates, so on a variable-layout doc
           (rows shift — Print Tracker alerts, worksheets) it lands on a NEIGHBOURING row and
           reads a plausible free-text word that PASSES the loose gate ("TK-8375M" on the
           Description row when the Customer "McMahon Associates" sat one row down), so the
           relocate rung (fires only on a failed/weak rigid read) never runs and the WRONG
           row commits at high confidence — the anchor knew its label but never used it. The
           operator's model: if the LABEL locates, the value sits at located-label + the
           stored offset, full stop — NO drift-magnitude gate. So for FREE-TEXT fields with a
           real anchor_label + a stored offset, whenever the label LOCATES (`_dlb` present)
           the value is re-read beside it (inline harvest, else a crop at located-label +
           offset) and PREFERRED — but ONLY when that read is itself credible AND actually
           DIFFERS from the rigid read. On a clean page the label is at its learned spot, so
           located-label + offset ≈ the rigid box → same value → no replacement →
           byte-identical. This REPLACED the old _value_drifted_from_box THRESHOLD (which
           could miss a sub-threshold one-row drift, the "customer→TK-8375M" bug): the value
           now LOCKS to the label, not to a drift magnitude. NOW COVERS CURRENCY (2026-07):
           the lock was free-text-only on the "structured fields are pattern-validated"
           assumption — but a CURRENCY value in a stacked totals block is the other case where
           "regex-valid" ≠ "right row": Subtotal/Discount/Shipping/Total are ALL valid
           currency, so a variable Discount line pushes Total down a row and the rigid crop
           reads the Shipping "$111.94" and PASSES the currency gate (the live "total reads
           $111.94 / $10 on a $1,955.03 invoice" bug). RESOLVED BY SKIPPING THE RIGID CROP:
           for a currency anchor with a real label + offset the rigid crop is SKIPPED entirely
           (anchor.py `_skip_rigid`) — its box misses on a variable totals block anyway (garbage
           "Oo" / a wrong-but-valid neighbour) — so value stays None, the label-lock below
           no-ops, and the DRIFT-RECOVERY rung relocates + reads beside the located "Total:"
           label (same credibility+format gates, method anchor_inline). Saves the always-wasted
           rigid OCR + the trace no longer shows a scary "anchor_crop rejected". Trade-off: if
           the label can't be found the total is left for review (a totals label OCRs reliably;
           empty→review beats a wrong rigid). date/ref keep rigid-first (their neighbours are
           rarely same-type + digit-parity/partial-shape guards on the later rungs). Legacy
           NULL-offset currency anchors keep rigid-first. Guarded by tests/test_anchor_drift_guard.py
           + tests/test_currency_label_lock.py. (The label-lock's own currency branch is now
           redundant with the skip and left inert.)
           COMPLETENESS GUARD (2026-06, multi-line interaction): the label-lock relocate must
           NOT replace a MORE-COMPLETE rigid read with a TRUNCATED one — when the rigid value
           STARTS WITH the relocate candidate and is LONGER, the rigid is kept (the multi-line
           case: the rigid joined "Beaumont Care Homes Ltd - Jordanstown" via the continuation
           but the relocate crop got only "…Ltd -", and a bare-difference replace was swapping
           the good join for the truncation + flagging it "looks shorter"). A genuinely
           DIFFERENT relocate (the rigid drifted to a wrong row) does not prefix-match, so it
           still wins — the drift fix is preserved.
           ⊕ AUTO-ANCHOR LABEL SEARCH (review/renderer.js captureAnchorContext): the
           left-label search scans the WHOLE row to the left of the value (was a fixed 300px
           window), one line tall — so on wide two-column key/value rows a TIGHT value box
           finds its far-left label ("Make") instead of falling through to the row ABOVE.
           The above-strip is now one line tall too (was 60px → bled into ~2 rows). A
           DIRECTION TOGGLE on the post-teach readout bar ([← Left]/[↑ Above]) re-detects
           the label in the chosen direction (captureAnchorContext forceDir) for label-above
           layouts or a wrong auto-pick; the readout also flashes the detected anchor box.
           sanitizeAnchorLabel still rejects a value-shaped "label".
           GARBLED-LABEL GUARD + EDITABLE READOUT (2026-07): on a NOISY scan the auto-label
           capture could grab a MISREAD caption ("Serial No."→"verial No.", "Description"→a
           curly-quote-prefixed "escription") — a garbled label never re-locates on future
           pages, so the taught anchor silently reads NOTHING forever (the "won't learn what
           I target" symptom). The readout bar's label is now an EDITABLE input (not static
           text), so any misdetection — including plausible garble like "verial No." — is
           correctable before Confirm (a typed caption → label_detected true); `labelLooksSuspicious`
           (replacement char / junk symbol / long vowel-less token) flips the bar to a
           WARNING ("this label looks misread — check it matches the caption"). A one-off
           cleanup deletes any stored anchor whose label carries a non-ASCII/control char.
           SEPARATELY, a doc-type change in Review now DISCARDS staged ⊕ draws (pendingAnchors/
           pendingFieldRules — each was captured under the PREVIOUS type and is keyed to it),
           so teaching under Invoice then switching to a worksheet can't leak boxes into the
           wrong layout (mirrors what changing DOCUMENTS already does); typed field VALUES are
           kept, only the un-committed drawings clear + a toast prompts a re-draw.
           CREDIBILITY GATE (engine.extract): a Stage-2 candidate may not OVERRIDE
           an existing incumbent unless credible for the field class — date fields
           require validator.parse_date(); ref fields (_is_ref_field: ..._number/
           ..._no/reference) reject low-info values (lone "a") AND a digit-free
           candidate ("Booking") cannot displace a digit-bearing incumbent. Guards
           OVERRIDES only — an empty field is still filled (validator then flags).
           Reusable/shape-based, never supplier- or document-specific.
           DIGIT-PARITY RESURRECTION GUARD (anchor.py, 2026-06, reggie+oscar-reviewed):
           the registration + relocate rungs QUALIFY a credible read against the learned
           shape and, when the shape veto rejects it, RESURRECT it anyway (`if not q: q=gval`)
           — to keep a legitimately-variable CODE (a new MAC/serial that differs in shape
           from history). That over-reached: it also resurrected a DIGIT-FREE word read off a
           NEIGHBOURING row ("Field"/the Ticket Type value, or "Booking") on a reference field
           whose every confirmed value is NNNN-NNNN-N — a clean wrong-row read that then
           SUPPRESSED the inline-harvest that DOES read the real "2605-0769-1" (the registration
           transform fits a GLOBAL similarity whose ~2%-page residual exceeds the tight row
           pitch in a dense label block, so a globally-good fit sits a row off locally).
           anchor._digit_free_on_digit_field (+ format_anomaly_checker.shape_requires_digit:
           class digits_only OR every learned shape signature contains '#') now REFUSES the
           resurrection when the read is digit-free AND the field's history is uniformly
           digit-bearing → the incumbent stays empty → the inline-harvest/relocation seats the
           real digit-bearing value (or empties → review). Digit-bearing reads (MAC/serial/the
           real ref), alpha-only ref schemes, and thin/varied history are all untouched
           (byte-identical). The rungs also only attempt the replace when the candidate is
           truthy now (`if q and _should_replace`). Guarded by tests/test_ref_digit_guard.py.
           SLIP-FIX (anchor._slipfix_to_shape, 2026-06, reggie-designed): a crop read that FAILS the
           credibility gate but is EXACTLY ONE known OCR-confusion substitution from the field's
           UNIFORM learned shape is RECOVERED instead of discarded — "$02"→"S02" when every confirmed
           value is "@##" (the "$"→"S" misread the gate rejects because "$" isn't alnum, leaving the
           field EMPTY; the Stage-2.5 ocr_corrector runs AFTER the gate + skips empties, so 6 commits
           never helped). Fires ONLY when: structured field, single uniform learned shape, exactly one
           position violates it, that char has a known-confusion replacement for the EXPECTED class
           (ocr_corrector.SYMBOL_TO_UPPER {$→S,€→E,£→E} — twin of the renderer's _OCR_PAIRS — / DIGIT_TO_UPPER
           / LETTER_TO_DIGIT), and the result matches BOTH the shape AND the regex. RECOVER-AND-FLAG:
           method anchor_crop_slipfix, conf≤70, was_corrected+corrected_to(==value, shows the "✓ auto-
           corrected" badge)+validation_note, review-forced. Wired at the rigid anchor_crop not_credible
           reject; byte-identical on thin/varied/free-text history (no uniform shape) or >1 substitution.
           Guarded by tests/test_slipfix_to_shape.py.
           STAGE 2 ANCHOR ARBITER — REORDER (2026-06, DONE; oscar+reggie+geometry-validated):
           the label-based DRIFT-RECOVERY / inline-harvest rung now runs BEFORE the GLOBAL
           REGISTRATION rung (registration moved to AFTER relocate, just before the text
           fallback). The LOCAL precise label read is tried first; registration is the fallback
           its own design always intended — it fires only when relocate left value None/weak
           (relocate only assigns inside its credibility+format+_should_replace gates, so a
           failed/uncredible relocate leaves value None, which registration's existing
           `not value` trigger already covers — NO extra trigger clause). Fixes the digit-
           BEARING wrong-row class the digit-free guard above couldn't: a global similarity
           fit's ~2% page residual exceeds the tight row pitch in a dense label block, so the
           mapped box lands a row off and reads a credible-but-WRONG fragment ("849-4" from
           "2605-0849-1") that then SUPPRESSED its own correction. PLUS a new
           anchor._partial_of_uniform_shape guard ANDed into BOTH resurrection sites
           (registration + relocate-crop): refuses resurrecting a digit-bearing FRAGMENT whose
           shape is a strict contiguous sub-run of a SINGLE uniform learned shape ("###-#" of
           "####-####-#") — closing the label-UNfindable residual — while a genuinely-new
           differently-shaped code is untouched. CLEAN pages byte-identical (a strict-credible
           rigid read skips both rungs regardless of order). Guarded by
           tests/test_anchor_arbiter_reorder.py (+ refreshed test_anchor_registration stub,
           the multiline harness still 0 false-joins). (Deferred follow-ups: _qualify_against_format
           arg parity on the inline path for mac/ip; routing 4-4-1 refs to the precise
           job_reference val_type; a Stage 2 box_divergence arbiter.)
           AUTHORITY PRECEDENCE (engine.extract — the cross-stage winner order):
           authoritative ⊕ anchor > Stage 0.5 mapping > admin label
           (keyword_override) > other (passive anchor / keyword / inline /
           relocated) > generic seed (template_fixed/template_anchor) > hints,
           each gated on validity. TWO 2026 fixes: (1) Stage 2 TIER A — an
           authoritative anchor (data["authoritative"], from last_authoritative_at)
           that clears the credibility gate wins OUTRIGHT regardless of resolved
           method or confidence (was anchor_crop-ONLY via is_taught_override, so a
           re-teach reading its value via anchor_inline/relocated/registration
           could lose a confidence contest to the label it was meant to override).
           (2) Stage 1 — a valid admin label (keyword_override) beats ANY incumbent
           on authority EXCEPT a Stage 0.5 mapping (is_override_authority broadened
           from template_fixed/template_anchor-only to `not _is_stage05_located`);
           mapping > label is the chosen ordering. Guarded by
           tests/test_precedence.py + test_label_overrides.py #9.
           OCR-QUALITY CONFIDENCE (anchor.py, 2026-06): a crop's confidence used to
           ride usage_count alone, so a garbled read ("Aaiumant Care Homes Ltd -
           Galaorm") scored in the 90s. anchor._read now returns (text, mean,
           min_word_conf); _crop_and_ocr threads them out via `meta`. For FREE-TEXT
           fields ONLY (val_type None/text/multiline — a structured value is validated
           by its REGEX, and Tesseract under-reads dash-separated digits, so a valid
           ref "2602-0768-1" must NOT be capped) the field confidence is capped at
           mean+5, and an authoritative anchor's outright Tier-A / is_taught_override
           win is GATED on ocr_min_conf ≥ _TIER_A_OCR_MIN(70): a garbled authoritative
           read falls through to the confidence contest (its capped conf loses to a
           clean keyword), while a clean/inline read (ocr_min_conf None) still wins.
           Guarded by tests/test_precedence.py (garbled yields / clean still wins) +
           the fence that a passive anchor_crop can't displace keyword_override.
           ── 2026 RELIABILITY PASS (find → follow → read, across doc types) ──
           PREVIEW-SCALE FREE-TEXT READ (anchor._noise_smooth_retry + the
           _ocr_crop_laddered fast-path, 2026-06 — "read it the way the draw tool does"):
           the on-screen ⊕/target draw tool reads value crops off the ~108 DPI PREVIEW PNG
           (render/pages.py scale 1.5) and reads DEGRADED scans CLEANLY, while extraction
           renders at 300 DPI — which AMPLIFIES scan noise into a credible-but-GARBLED name
           ("Beaumont Care Homes Ltd - Holywood" → "oceaumont Care homes Lid - nolywooa")
           that passes the loose free-text gate, so the ladder commits garbage and the
           heavy SHARPEN rung only makes it worse. TWO reasons the draw tool wins, both
           reproduced: (1) the low preview resolution, and (2) a hand-drawn box has
           vertical HEADROOM (the stored tight box clips glyph tops/bottoms). So for
           FREE-TEXT crops (val_type None/text/multiline) the ladder's FIRST step now
           RE-CROPS from the page with headroom (±0.5·h) and downscales to ≈the preview
           scale (_PREVIEW_DOWNSCALE 0.4 → ~120 DPI); a confident read (min substantial-
           word conf ≥ _PREVIEW_ACCEPT_MIN 55, passing the gate) is taken OUTRIGHT — both
           CLEANER and FASTER (smaller image, fewer/cheaper passes) than the 300 DPI rungs.
           Bench-proven on doc 146 to recover the EXACT "Beaumont Care Homes Ltd - Holywood"
           (min 92) the tight 300 DPI crop reads as junk. Needs page+box (threaded from
           BOTH _crop_and_ocr paths); absent (a test stub) → ladder unchanged. NUMERIC/code
           crops and the FULL-PAGE OCR keep the high-res read (detail/keyword completeness;
           the full-page text is cached on reprocess anyway). A residual low-conf preview
           read falls through to the full-res ladder below; a still-shaky free-text rung
           there triggers the same downscale as a retry. Gated to free-text, so clean/
           structured reads are unaffected. Guarded by the OCR/drift suites.
           LIGHT-FIRST OCR LADDER (_crop_and_ocr): the unconditional heavy prep
           noted above is REPLACED by a ladder — light (greyscale, upscale-small-
           only, NO autocontrast/sharpen) PSM 7 → light PSM 6 → heavy _prep PSM 7/6
           → text_enhance — each scored by ONE image_to_data pass and accepted by
           verify_fn (or a conf floor). The heavy upscale+sharpen was DESTROYING
           clean high-res crops ("Beaumont Care Homes Ltd" → "nara"/""); the heavy
           rung still runs for tight degraded serials, so the separator fix is
           preserved. _repair_single_token runs on every rung. SAME LADDER IN
           region.py: the interactive draw-tool OCR (review ⊕ picker, Template
           Wizard read-back, Template Manager — all via ocr-region/ocr-region-boxes)
           was the un-migrated outlier still doing unconditional autocontrast+
           SHARPEN, so a DRAWN box read worse than extraction and mangled clean
           born-digital crops (corrupt anchor label "be_7" + wrong/empty value).
           region.py now reads LIGHT first (greyscale+upscale-small-only, no
           autocontrast/sharpen) PSM 7→6 and escalates to the heavy recipe only
           when the light read is EMPTY; --boxes mapping is unchanged (upscale
           scale constant). So the supersedes-line above ("region.py" sharing the
           heavy recipe) is historical. Guarded by tests/test_region_light_first.py
           (renders the failure shape, asserts a faithful+clean read; skips without
           Tesseract).
           KEY/VALUE PLACEMENT + INLINE HARVEST: the locator used to return the
           whole OCR LINE box, so in a "label …big gap… value" row geometric
           placement seated the value crop PAST the value (clip/empty). Now
           _ocr_lines keeps per-word boxes; template_mapper._locate_anchor returns
           the matched LABEL-word box AND harvests the value straight off the
           located line; anchor._locate_for_relocation searches a FULL-WIDTH row
           strip so a far value column is captured, and the rung HARVESTS the value
           (method anchor_inline) before any crop. This is what makes a drifted
           worksheet customer and a never-seen key/value report read correctly.
           GATED RESCUE (_strict_credible / _should_replace): a label-anchored
           harvest replaces a rigid read ONLY when the rigid value FAILS a strict
           gate (single-token for code fields, so high-DPI garbage like "cield wu"
           or a clipped date yields) — a strictly-credible rigid read is never
           displaced (no unconditional override).
           INLINE-HARVEST COLUMN CLIP (template_mapper.cluster_value_words, 2026-06 —
           007's fix): the harvest read the WHOLE OCR line (full page width) and took
           EVERY word after the label, so a far heading/column on the same row LEAKED
           into the value ("ABC12345" → "ABC12345 DOCUSYS MODEL NAME"; "JL ABC12345").
           The drawn box WIDTH was discarded on this path and the only re-narrowing was
           clean_crop_segment's 4-SPACE split (a 1-3 space column boundary defeats it).
           cluster_value_words now splits the post-label words into HORIZONTAL-GAP
           columns (break where the inter-word gap > 1.2× median word height — a true
           inter-COLUMN gap, DPI-invariant; mirrors the renderer's nearestLeftCluster)
           and returns the column nearest/after the label's right edge. Wired at BOTH
           inline-harvest locator sites (template_mapper._locate_anchor + anchor.
           _locate_in_text_lines). Additive: one column / no wide gap / missing word
           boxes → byte-identical; full-width search strip (the "far value column"
           capability) untouched. Guarded by tests/test_inline_column_bleed.py.
           CURRENCY THOUSANDS-SEPARATOR REJOIN (anchor._normalise_currency_spacing, 2026-07):
           OCR (and some PDF text layers) render a thousands separator as a SPACE, or split a
           value across word tokens, so "$10,576.31" reads as "$10 576.31" / "$10, 576.31".
           _clean_text_fallback returns the FIRST match of the currency validation pattern (a
           CONTIGUOUS run), so it TRUNCATED at the gap → "$10" (the real "total reads $10 for a
           $10,576.31 invoice" bug, esp. on the anchor_inline path where the totals block
           drifted and the label-relocated read won). A currency value has no internal space,
           so a space/comma+space between a digit and a following 3-digit group is a thousands
           boundary → collapsed back to a comma BEFORE the pattern match (looped for millions
           "$1 234 567" → "$1,234,567"). ALSO rejoins the DECIMAL point split by OCR spacing
           ("$5,767 .71" / "$5,767. 71" → "$5,767.71") and a dropped point with a trailing
           2-digit cents group ("$5,767 71" → "$5,767.71", end-anchored so a 2-digit tail can't
           be mistaken for a thousands group) — else the value truncated to "$5,767". Applied in _clean_text_fallback (anchor_inline) AND
           _clean_one_line/clean_crop_segment (anchor_crop, which used to leave a malformed
           "$10 576.31"). ONLY for val_type=='currency' — free-text/name with internal digits
           is untouched; contiguous/no-space values are returned verbatim. Guarded by
           tests/test_currency_spacing.py.
           OPERATOR FIELD-CLEANUP RULES (the residual-case override): a Review
           right-click toolkit (review/renderer.js field-input contextmenu, gated
           canEdit) teaches per-(supplier,doctype,field) cleanup rules to strip a leaked
           heading/column OCR still bled in. Three options w/ tooltips + before→after:
           "Keep only the main value" (rule_type keep_block — engine keeps the single
           validation-pattern / digit-bearing token, dropping neighbour words either
           side), "Remove this text from future scans" (remove_text — reggie's anchored
           literal matcher, leading/trailing), "Just fix this one" (one-off, no rule).
           Staged in pendingFieldRules, COMMITTED ON CONFIRM (mirrors pendingAnchors),
           reversible in Learning Recovery ("Field rules" group + clear). Stored in
           field_rules (migration 36); loaded via --field-rules-file → engine.
           set_field_rules; applied in the Stage 4.5 winner loop (EARLY, independent of
           learned format) by python_backend/extraction/field_rules.py (apply_keep_block
           / apply_remove_text — pure, guarded, never empties); honest was_corrected +
           corrected_to + "auto-trimmed, was: …" note, NOT review-forced. Guarded by
           tests/test_field_rules.py + database/modules/test_field_rules.js.
           MULTI-LINE CONTINUATION (Phase 1, 2026-06, oscar+reggie-designed): a free-text value
           that WRAPS onto the next line (a work address whose first line ends "…Ltd -" + a
           second line "Comber") is read + joined, gated so a single-line read stays
           byte-identical. TRIGGER (name_match.should_continue_line, pattern-primary +
           history-guarded): continue when line 1 ends with a trailing dash -/–/— AND history
           doesn't confirm it complete (conforms_to_lexicon / learned shape), OR when
           is_truncated_name says the read is short vs expected_len. STORAGE: reuse field_rules
           with rule_type='multiline_continue' (token_norm = trailing chars, default "-") — NO
           migration; engine.set_field_rules SPLITS these into self._multiline_index (consulted
           by the READ step via _make_multiline_lookup), NOT the Stage 4.5 apply loop. READ+JOIN
           (anchor.py): clean_crop_segment factored to _clean_one_line (its first-line return is
           byte-identical); _crop_and_ocr, when the field has a rule + should_continue_line fires,
           extends the crop ~1.3 line-heights, PSM-6 re-reads via _read_block_lines, takes the
           next line under the geometry guard (_lines_adjacent: same-left/≥50% x-overlap + gap ≤
           0.9 line — stops swallowing an unrelated row), join_continuation (keep " - " separator
           / de-hyphenate a word-break / single-space a plain wrap), then _continuation_ok
           (verify_fn + not-still-truncated + length cap) else KEEP line 1. Covers the rigid /
           relocate / registration rungs (all call _crop_and_ocr). Gate: multiline_enabled setting
           (default ON, --multiline; INERT without a rule). NOT a validation_pattern → no JS
           mirror. TEACH UI (Phase 2, done): a Review field RIGHT-CLICK toggle "This field can wrap to the
           next line" (showFieldRuleMenu → _stageMultilineRule, name-like fields, staged in
           pendingFieldRules → saveFieldRule on confirm) + a TALL-BOX auto-rule (a ⊕ draw whose
           zone-OCR reads 2+ lines auto-stages the rule, silent: region.py --boxes now returns a
           `lines` count, runZoneOcr reads via ocrRegionBoxes) + a Settings → General "Read values
           that wrap onto the next line" toggle (multiline_enabled). Stage 0.5/template_mapper +
           born-digital next-line still deferred (Stage 2 anchor crop covers the common case).
           Guarded by tests/test_multiline_continue.py + the region.py multi-line test.
           PRECISION/RECALL GUARDS (2026-06, bulletproofing — test_harness/multiline_measure.py,
           a 400-doc real-OCR stress test across suppliers/logos × single-line/dash-wrap/
           complete/drift/word-break/comma: 0 FALSE-JOINS, ~99% recall): (1) name_match.
           matches_stable_prefix — should_continue_line only fires when the read is a PLAUSIBLE
           PREFIX of the learned name (shares the canonical first token), so a DRIFTED ref code
           ("2604-0511-1") or a wrong word can't trigger a join; (2) a TRUE word-break hyphen
           ("…Gar-", a LETTER immediately before the trailing dash) continues regardless of the
           completeness check (a separator dash "…Ltd -" with a SPACE before stays history-gated);
           (3) _lines_adjacent uses the line PITCH (top→top ≤ ~2.5 line-heights), not the tight
           glyph-box gap (which under-stated line height and made a normal wrapped line look
           "far" → never joined); (4) clean_crop_segment's city-comma cut skips a TRAILING comma
           (last word) so "Greenfield Nursing Home," isn't truncated to "Greenfield Nursing"; (5)
           the LABEL LOCK completeness guard (see above) keeps a more-complete rigid join over a
           truncated relocate.
           ANCHOR-LABEL SANITISATION (learning.sanitizeAnchorLabel, migration 23):
           strip document-specific tokens (reference numbers/dates/serials) from an
           auto-detected ⊕ label so it GENERALISES across documents
           ("2605-0769-1 Work Address" → "Work Address"); on change the now-
           mismatched drift offset is NULLed. Migration 23 cleans existing rows
           (deletes any whose label is entirely document-specific).
           FIELD-NAME LABEL GUARD — DETECTED vs PHANTOM (learning.saveAnchor, 2026-06):
           the guard that drops an anchor label equal to the FIELD KEY (a phantom
           "supplier_name" caption the page never prints → blind-crop) used to fire on
           ANY match — which wrongly nuked a REAL detected caption for a well-named
           custom field (field `make` → on-page "Make", `serial_number` → "Serial
           number", `mac_address`/`ip_address`/`model`), leaving it a label-less blind
           crop that DRIFTS a row on variable-layout docs (Print Tracker alerts: every
           anchor read the neighbouring row). Now the ⊕ capture marks a label OCR'd FROM
           THE PAGE with `label_detected:true` (review/renderer.js, both left+above
           paths); saveAnchor drops the field-name label ONLY when `!label_detected`
           (the synthesised fallback), so a real caption that merely equals the field
           key is KEPT + locatable + keeps its offset. The IPC passes the flag through
           untouched. (customer→"Entity"/date→"Estimated depletion" were unaffected —
           their captions differ from the key.)
           VAL_TYPE FROM FIELD TYPE (engine.extract): field_patterns is seeded from
           each CUSTOM field's DB type (date/currency/alphanumeric only — text left
           untouched so name/address reads don't change) and the doc-type reference
           field is coerced to a code type, so the credibility/rescue gates work for
           custom document types (which carry no keyword-config entry).
           BORN-DIGITAL (ocr/born_digital.py — pypdfium2 BSD-3/Apache, NOT PyMuPDF):
           a generated PDF's embedded text layer gives EXACT text + word boxes (no
           OCR) for the full text (extract_text_and_images, positional reading
           order) AND the anchor locate/harvest (page_text_lines threaded
           process_docs → engine.extract → extract_with_anchors →
           _locate_in_text_lines). Detected by GLYPH COUNT + an alpha-ratio hybrid
           guard; INERT for image-only/scanned pages (fall back to OCR). Gated by
           born_digital_enabled (default ON).
  Stage 4: validator.py  — date normalise/salvage, currency infer, maths cross-check
  Stage 4.5: format_anomaly_checker.py — coarse-class + learned-shape consistency
             vs confirmed history; engine then weights _overall_confidence by
             cross-field format consistency (see Stage 7).
             FREE-TEXT GUARD (engine.extract): the learned-SHAPE check may FLAG but
             NEVER withhold/trim a free-text field's value — fields typed
             text/multiline/untyped AND not _is_ref_field (text_field_keys). Names
             & addresses vary legitimately, so a value that misses a rigid learned
             shape is kept + tagged "format differs from the usual — please verify"
             (conf ≤70, review-forced) instead of being NULLed. Without this, a
             customer history all shaped "Beaumont Care Homes Ltd - <Site>" learned
             an alphanum_sep shape that hard-nulled a valid "Beaumont Care Homes Ltd
             -" (no site) → empty Customer field. Ref fields typed plain "text"
             (e.g. reference_number) are EXCLUDED via _is_ref_field so structured
             codes keep full shape enforcement (withhold on mismatch). Guarded by
             tests/test_stage45_text_preserve.py.
             CONFORMANCE OVERRIDE (2026-06, name_match.conforms_to_lexicon): the
             learned-SHAPE check still FALSE-FLAGGED a legitimate "new site" whose
             length was never confirmed (a customer "...Ltd - <new long site>" fails
             the accepted character-shapes once a few sites recur ≥_SHAPE_ACCEPT_MIN).
             The per-field name_lexicon is a MORE precise model (stable prefix +
             variable tail), so when every STABLE prefix token matches the canonical
             AND the value reaches the learned expected_len, the "format differs" flag
             is SUPPRESSED. expected_len (the longest content-position run a ≥0.6
             majority of docs reach — history always "<prefix> - <site>" ⇒ 5) is the
             TRUNCATION GUARD: a value SHORT of it ("...Ltd -" with the site cut off)
             does NOT conform and stays flagged. Guarded by tests/test_name_match.py.
             EDGE-JUNK CLEANING (value_quality.strip_name_edges): a keyword/label
             capture has no crop-path cleaning, so OCR edge junk ("--« Beaumont Care
             Homes Ltd -") entered verbatim and — as keyword_override (highest
             authority) — WON, then only got charset-flagged. strip_name_edges drops a
             leading non-alphanumeric run + trailing whitespace/disallowed symbols
             (EDGES only — interior + a legitimate trailing " -" preserved), applied
             both (a) AT CAPTURE in the Stage 1 keyword loop (so the junk never
             becomes the answer and the trace shows a clean winner) and (b) as a Stage
             4.5 catch-all for the winner. Name-like free-text only. Guarded by
             tests/test_value_quality.py.
             PATTERN-BASED FIELD CORRECTION (Phase 1 — commit 09a4c62; name repair is
             now TWO-TIER, 2026-06): two helpers run in the Stage 4.5 loop on the
             WINNER value. (1) TOKEN-LEVEL NAME REPAIR (name_match.py +
             text_normalise.py): for name-like fields, builds a per-(supplier,doctype,
             field) token lexicon from confirmed value_counts (stable token = doc-freq
             ≥0.6 AND ≥3 docs, deterministic canonical surface) and repairs garbled
             KNOWN tokens to their canonical spelling while keeping the VARIABLE tail
             verbatim ("eeaument care homes - lisburn" → "Beaumont Care Homes -
             lisburn") — never whole-value snaps, never injects a learned token,
             positional + thin-evidence guards, idempotent. SHORT-TOKEN RULE: a 3-char
             ALPHABETIC stable token that is NEAR-UNIVERSAL (doc_freq ≥0.9) repairs a
             SAME-LENGTH single substitution ("Lid"→"Ltd") — tighter than the ≥4-char
             fuzzy path so "Co"→"Go" stays exact-only and a real different suffix
             "Inc" (dist 3) is kept. TWO TIERS by evidence (repair_name_value(details=
             True) → (repaired, strong)): a STRONG repair (every changed token at a
             near-universal position) AUTO-APPLIES — value+display_value corrected,
             was_corrected, a "Corrected to learned spelling (was: …)" note, NOT
             review-forced; a WEAK repair stays SUGGESTION-ONLY (corrected_to + note +
             conf≤70 + review). Review surfaces an auto-apply with a calm green "✓
             auto-corrected" badge (no Accept button), detected by value==corrected_to;
             a suggestion keeps the amber note + Accept. Runs INDEPENDENT of
             check_value's anomaly verdict (a garbled name is coarse-class FREETEXT
             and won't trip it); the lexicon is attached to fmt_entry in
             build_format_class_index (additive name_lexicon key, even for freetext
             name fields). text_normalise.py is a deterministic compare-time
             normaliser (NFKC→dash/quote fold→.lower()→explicit-class ws collapse→
             edge-trim) with a byte-identical JS twin (database/modules/
             text_normalise.js, parity-tested via tests/normalise_corpus.json). (2)
             CHARSET VALIDATION (config field_charsets, BACKEND-ONLY — NOT served via
             get-validation-patterns): per field TYPE, flags unexpected OCR symbols
             (format_anomaly_checker.charset_disallowed) as a note + conf cap; skips
             date/currency, defers to a pre-existing note (one note per field).
             Guarded by tests/test_{name_match,text_normalise,field_charsets}.py +
             test_text_normalise.js.
             SHAPE FAMILIES + shape_match_score (Phase 2, ADDITIVE/DIAGNOSTIC —
             commit 0277a85): format_anomaly_checker.shape_families() folds the
             learned shape set (separator-run near-dups merged), counts, sorts, caps
             at 6 → additive fmt['shape_families']; shape_match_score(value,fmt) →
             1.0 exact / 0.8 learned-shape substring / 0.0 else. Pure, no behavior
             change (classify_format/check_value/propose_correction untouched); the
             foundation for a later candidate-override phase (not yet wired). Guarded
             by tests/test_shape_match_score.py.
  Stage 4.6: CANDIDATE OVERRIDE (Phase 3, DEFAULT-OFF — commit b58ef06): a gated
             post-merge resolver (engine._resolve_candidates) that may prefer a
             clearly-more-credible RETAINED candidate over the merge winner. An additive
             per-field ledger (self._field_candidates, built only when the setting is on
             via _remember_candidates at the Stage 0/0.5/1/2/2.5/3 merge points — winner
             selection byte-identical) feeds it. Runs between Stage 4.5 and metadata;
             NEVER touches an authoritative anchor / Stage 0.5 located / keyword_override
             winner, defers to an existing note. Challenger must clearly beat the incumbent
             on shape_match_score (shaped) or value_quality.name_quality (name). Setting
             `candidate_override` = off (default, byte-identical) | suggest (corrected_to
             only) | auto (replace value, only for `candidate_override_fields` types);
             process_docs --candidate-override plumbing. Guarded by
             tests/test_candidate_resolver.py.
```

**Three modes** (stored in settings as `processing_mode`):
- `fast`  — stages 1+2 only, sub-second, any hardware
- `smart` — stages 1+2, then 3 only if invoice_number/invoice_date/total_amount
             missing or below 70% confidence. DEFAULT.
- `ai`    — stages 1+2+3 always

**Locate reads at a capped width, not ×2-upscaled** (2026-06 — the biggest per-doc OCR
win): the anchor/landmark LOCATE (`template_mapper._ocr_lines` → `image_to_data` for word
boxes) used the value-crop prep `_prep`, which UPSCALES ×2 — ballooning a 2481px page to
~4962px so a full-page locate took ~3.8s (the dominant cost on import AND reprocess, and it
runs even with the OCR-text cache because the locate is a SEPARATE pass for word boxes).
The locate only needs to MATCH label/landmark text and return NORMALISED boxes, so it now
uses `_prep_for_lines` which CAPS the width at ~1100px (≈120 DPI): the SAME lines are found
in ~1.1s (2.7× faster, ~2.7s/doc). Geometry-neutral (boxes normalise to the prepped size);
registration uses normalised landmark positions so the fit is unchanged. Guarded by the
template-mapper/drift/registration suites.

**Reprocess reuses the stored full-page OCR text** (2026-06): the full-page OCR is
~1.9s/page and re-reads the SAME pixels every reprocess for a result that never
changes — only the learned data does. So reprocess now passes the doc's already-stored
`documents.ocr_text` and `extract_text_and_images(..., cached_text=...)` RENDERS the page
images (~0.25s, needed for crop/logo/zone OCR + registration) but SKIPS the full-page OCR
(~90% faster on that step). Per-field crop reads + born-digital `page_text_lines` still
re-run, so accuracy is unchanged (the field VALUES come from the crop reads against the
NEW learned anchors, not the full-page text). SINGLE reprocess: `--cached-ocr-file`
(written into the temp folder); BATCH (Reprocess All): `ocr_text` per-doc in the
`--reprocess-manifest` (doc_overrides). GATED OFF when a manual/template ENHANCE is active
(the OCR read would differ) or the stored text is empty → full OCR. First import (no
manifest/cached file) is byte-identical. Self-populating: a reprocess still stores
`ocr_text`, so a doc whose stored text was empty is cached after its first reprocess.

**Bounded parallel processing** (setting `processing_concurrency`, 1–5, default 1):
`process-folder` (processing/handler.js) runs a worker POOL — N Python procs,
each handling a disjoint round-robin SHARD of the folder's files (passed via the
backward-compatible `--files-file` arg in process_docs.py; absent → scan whole
folder). Parallelizes only the CPU-bound OCR/extraction ACROSS documents, never
within one. concurrency=1 keeps the exact original single-proc path. Safe because
ALL DB/file writes stay on the single-threaded JS event loop via
`_handleFileMessage` (better-sqlite3 is synchronous) — Python workers never touch
the DB, only read a per-batch training-data snapshot and emit JSON. Pool emits ONE
aggregate `{type:start,total}` (per-worker starts suppressed) so the renderer's
progress bar isn't clobbered. `_currentBatchProcs[]` + `isBatchRunning()` track all
workers; stop kills every tree. Watch-folder stays serial and defers via
`isBatchRunning()`.

**Per-file WATCHDOG timeout** (`file_timeout_seconds` setting, default 300 = 5 min, 0 = off;
Settings → Processing → "Per-document safety timeout"): a single pathological page can hang a
NATIVE Tesseract/pdfium call that NO Python try/except and (on Windows) no signal can interrupt,
which would stall a whole worker (and its shard) forever. `buildTrainingArgs` passes `--file-timeout
<seconds>` to every worker; `process_docs.py` runs a daemon WATCHDOG thread (`_start_file_watchdog`)
that arms per file (`_mark_file`/`_clear_file` around the loop body) and, if one file overruns,
emits an ERROR `file_done` for it (so `_handleFileMessage` records it `status:error` + drains it to
`Errors/` → surfaced as a stuck doc, never re-attempted) then `os._exit(0)` to escape the wedged
call. `emit()` is `threading.Lock`-guarded so the watchdog can't interleave a partial line. The
worker's REMAINING shard files stay in the intake (not drained) → picked up next run / watch scan.
Generous default so a legitimately large multi-page scan never false-trips; a false trip only
demotes that doc to a retryable error, never loses it. Guarded by
`python_backend/tests/test_file_timeout_watchdog.py` (subprocess drives the real watchdog).

**Drain to Processed/ + file-handle release** (handler.js, 2026-06-28): a processed
original is moved out of the intake folder into `Processed/` (or `Errors/`) once a
verified working copy exists (`drain_processed`, default on). Two reliability fixes:
(1) the Python worker now CLOSES each pdfium document per file (ocr/tesseract.py
`extract_text_and_images`/`pdf_to_images`, born-digital page-0) so the source PDF's
handle is released before drain — Windows can't rename an open file. (2)
`drainOriginalToFolder` distinguishes a genuine cross-volume move (EXDEV → copy+
unlink) from a TRANSIENT LOCK; a still-locked file is left in place (drained next
run) and NEVER left as a duplicate. The INLINE attempt (`_drainNowOrDefer`, on the
main thread per file_done) passes `{retry:false}` → ONE non-blocking attempt (no
Atomics.wait); a locked file is queued (`_pendingDrains`) and flushed by
`_flushPendingDrains` after the worker exits (manual batch: Promise.all; watch:
per-file proc close), which retries (`retry` default true). The EXDEV branch guards
its unlink: if the source is locked it deletes the just-made copy so no duplicate is
left. `file_done` is persisted SYNCHRONOUSLY in the stdout handler (not setImmediate)
so `msg.db_id` is set BEFORE the message is mirrored (the results-table "open this doc
in Review" needs it) — wrapped in try/catch so a per-doc DB error can't skip the
progress mirror/count. Guarded by test_drain_original.js (EXDEV-locked + retry:false
no-duplicate cases).

**Document SEPARATION pre-pass** (`_separateBatchDocuments`): before the worker pool,
each PDF is OCR-scanned to split a multi-document file (e.g. ten one-page alerts in
one PDF). Runs as a BOUNDED PARALLEL pool (≤ CPU cores, per-proc Tesseract thread
cap) with live "Preparing N/M" progress; the stop handler ALWAYS sets
`_cancelRequested` and `process-folder` BAILS after the pre-pass if cancelled (so
Stop is immediate, not stuck behind a launched worker). Gated by
`auto_separate_enabled` (default on).

**Critical**: engine.extract() returns a flat dict mixing field data dicts
`{"value":..,"confidence":..,"method":..}` with plain metadata values
`_supplier_name`, `_document_type`, `_overall_confidence`, `_needs_review`,
`_mode_used`, `_document_slug`. Always pop _ keys BEFORE iterating fields.

**sanitise_extractions()** in process_docs.py strips _ keys and normalises
all values to proper dicts. Call this after popping metadata, before emitting.

**Supplier identity — don't freeze it early**: `supplier_name`/`_supplier_name`
must reflect the LATEST reliable `results['supplier_name']`, not the first
guess. Stage 0's template match (or the logo fallback) only seeds a
provisional value; Stage 1/2 can legitimately override it with something more
accurate (e.g. a taught `anchor_crop` reading the real page beats a
near-duplicate-logo template guess). engine.py re-resolves `supplier_name`
once, after every stage that can touch it has run, before persisting
hints/anchors/logos — otherwise the learning corpus gets silently written
against a stale identity.

**Template identity is stabilised on confirm, not overwritten**: confirming a
document MERGES its fingerprint into the template's stored identity instead of
replacing it (`templates.stabiliseFingerprint`/`chooseLogoPhash`). The keyword
fingerprint becomes the INTERSECTION of recurring tokens across confirmed
samples (with a floor so one noisy sample can't erase a known-good identity);
an already-established `logo_phash` is kept rather than reclobbered each confirm.
Prevents one garbled scan from poisoning Stage 0 matching for a whole supplier.

**Auto-promote a template on a TAUGHT confirm** (`review/handler.js` confirm-review, 2026-06-28):
`_upsertTemplate` was removed from *every* confirm, but a confirm where the user TAUGHT fields
(⊕ targets — `taught_fields` non-empty, non-bulk) now calls it: the operator is clearly
building a reusable layout, so a template is created/refreshed and `_buildTemplateFields`
freezes the non-variable TYPED fields (e.g. **Document Issuer**, `is_variable` 0) as
`fixed_value`s. This is what makes a typed issuer FILL on the next document's reprocess
(previously: drawn targets in Review + a typed issuer + Confirm created NO template, so the
issuer had no learned artifact). Plain (un-taught) and bulk "File All Ready" confirms still
create no template, by design. Best-effort + non-fatal — never fails the confirm.

**Born-digital keyword-fingerprint backfill** (`templates/handler.js` `generateFingerprint`
+ `python_backend/template_fingerprint.py`, 2026-06): a template can be born with an EMPTY
keyword_fingerprint — a BORN-DIGITAL doc (e.g. a Print Tracker email alert) whose stored
`documents.ocr_text` was never captured yields nothing to `extract_keyword_fingerprint` at
promote time, so the template is matchable ONLY by its logo phash. That phash is unreliable
for these: the logo crop is the top-left corner `(0,0→w/2,h/5)`, and on alerts that render a
`From/Sent/To/Subject` email header above the banner it hashes the HEADER → drifts 12-34
Hamming vs the accept gate (conf≥60 ⇒ dist≤6) → "No template match" → the whole cascade
(wrong supplier via the logo fallback, fixed-anchor drift). The fix RE-DERIVES the fingerprint
from SEVERAL of the template's documents (born-digital aware, the same text path processing
uses) and keeps only the STABLE words present in a MAJORITY (≥60%) — dropping per-doc
recipient/entity noise ("Karen"/"McConnell") and keeping the branding ("PRINT","TRACKER",
"printtrackerpro","Sent","Subject"). Cross-sample so it's layout-agnostic (also strengthens
invoice/worksheet fingerprints). Runs: (1) a lazy STARTUP BACKFILL (~14s) over every template
with docs but no fingerprint — fixes existing ones with no re-teach; (2) `promote-to-template`
(so a teach-created born-digital template isn't born empty); (3) an admin "Regenerate
fingerprint" button (Template Manager, force overwrite, beside "Regenerate landmarks") +
`regenerate-template-fingerprint` IPC. FILLS an empty fingerprint only (never clobbers a
stabilised one) unless forced.

**Field variability is EVIDENCE-based, not schema-guessed** (`_buildTemplateFields`
in review/handler.js): a confirmed field is frozen as a template `fixed_value`
ONLY when it's truly constant. The schema heuristic (`_annotateFieldVariability`)
was invoice-centric — it froze any non-ref/non-date field, which wrongly pinned a
worksheet `customer` to one stale value. Now a field with ≥2 DISTINCT confirmed
values for the doc type is treated as variable and never frozen (the cost of a
false "variable" is a harmless re-extract; a false "fixed" commits a wrong value
on every other doc). Self-heals an already-frozen field on the next confirm.

**Admin-LOCKED fixed values** (migration 31, `template_fields.fixed_locked`): a
fixed value an admin explicitly sets in the Template Wizard is a DELIBERATE,
protected override — distinct from the auto-derived non-variable seed above.
`fixed_locked = 1` → template_matcher emits method `template_fixed_locked` (vs the
overridable `template_fixed`); `_upsertFields` preserves the locked value across
confirmed-history rebuilds; `setFieldFixedValue` sets/clears the flag. engine.extract
guards it from ordinary keyword/anchor/identity-rescue overrides (it still yields to
a curated Stage 0.5 mapping and to `keyword_override`, and an authoritative ⊕ anchor
still wins via Tier A). Guarded by `database/modules/test_fixed_locked.js` +
test_precedence.py.

**Fixed Supplier Name is IMMUNE to the logo fallback** (engine `_doctype_fixed_supplier`,
2026-06): a doc type whose Supplier Name (`supplier_name`) is an admin-fixed template
field has a DETERMINISTIC supplier, so a logo guess must never fill it. The logo
supplier fallback runs only `if not supplier_name` — but when NO template matched the
fixed value was never seeded, so a polluted/colliding logo phash filled `supplier_name`
with a WRONG supplier (the "City Office NI on a Print Tracker doc" bug: the same logo
learned under several recipient companies, `findLogoMatch` returns the global-closest).
Now, before the logo fallback, when the doc type IS known the engine looks up that doc
type's fixed Supplier Name across ALL templates for its slug (prefers a LOCKED value;
uses a plain fixed value only when every candidate AGREES — ambiguous → skip, never
guess) and seeds it (method `template_fixed[_locked]`), skipping the logo. Returns None
when there's no unambiguous fixed value, so every other doc type's logo path is
byte-identical. Reusable for any fixed-supplier doc type, independent of template-match
reliability. Guarded by tests/test_fixed_supplier_immune.py.

**Logo supplier match FAILS SAFE on ambiguity** (`anchor.try_logo_supplier_match` +
`_pick_unambiguous_supplier`, 2026-07): the logo fallback used to return the
GLOBAL-CLOSEST logo, so when two DIFFERENT suppliers' stored logos were both near the
page phash it confidently picked whichever was marginally nearer — a WRONG supplier,
which mis-scopes every per-supplier learning corpus (hints/anchors/corrections/template
identity) and files under the wrong company. `compute_logo_hash` is a 64-bit GREYSCALE
phash, so marks sharing a coarse layout — or differing mainly by COLOUR (greyscale
discards it) — land only a few hamming apart (measured: colour-only-distinct logos → 0).
Now the match groups logos by supplier (multi-reference rows for ONE supplier are the
same identity, never a rival), and accepts the winner ONLY when it clears the confidence
gate AND is at least `LOGO_AMBIGUITY_MARGIN` (4) hamming closer than the next DIFFERENT
supplier; on a near-tie it returns None → supplier stays empty for the keyword/template
signals or manual review, instead of a confident wrong guess. INERT for genuinely
distinct logos (winner far clearer than the margin even after scan drift → accepted
unchanged; a well-separated 5-logo bench matched 5/5 under scan noise), so no regression
for real distinct-logo installs; it only REJECTS a previously over-confident wrong guess.
Decision factored into the pure `_pick_unambiguous_supplier` — guarded by
tests/test_logo_ambiguity.py. (The stress-test 48% scanned-supplier rate was a corpus
artifact: five logos distinguished ONLY by colour, phash's blind spot.)

**Validator date rules (Stage 4)**: dates normalise to DD-MM-YYYY; a valid date
embedded in OCR junk is salvaged (`salvage_date`, review-forced). The date
sanity check is FUTURE-ONLY — old archival dates are expected and never flagged;
only dates clearly in the future (> ~1 year) are anomalous.

**Document confidence is format-weighted (Stage 4.5)**: after the per-field
average, `validator.format_consistency_delta` adjusts `_overall_confidence` —
penalise any field that failed its format check; boost only when several
WELL-SUPPORTED fields all match (conservative — sparse/unverified docs get no
boost). Adjusts the displayed score only; per-field notes and needs_review are
unaffected.

**Confidence GROWS with learning (2026-07)** — two calibration boosts so a repeatedly-
confirmed doc stops reading 93% when everything's correct. Both CAP at 98 so a boost
alone never reaches the auto-file threshold. (1) LOGO match_count (anchor._pick_unambiguous_supplier):
a logo confirmed many times is a reliable identity even at a moderate hash distance — the
reported supplier confidence gets a saturating bonus (+8/+18/+32 for ≥2/≥4/≥10 confirmations)
on top of the base 100-dist*6, so a 288×-confirmed "SuperStore" reads ~96%, not 64%. ACCEPTANCE
still keys on the raw distance (base ≥60), so the bonus never loosens matching. (2) LEARNED-
AGREEMENT per-field boost (engine Stage 4.5, before overall_confidence): a field with a value,
NO validation_note (passed clean), and a WELL-SUPPORTED learned format (format_anomaly_checker
attaches `support` = confirmed_count / summed value_counts, ≥3) gets +2/+4/+5 for support
≥3/≥5/≥20 — lifting date/number/total from ~93 toward ~98 as the field's history accumulates.
Guarded by tests/test_logo_ambiguity.py (+ format_anomaly `support`).

**EMPTY required fields weigh the score down** (`validator.overall_confidence`,
2026-06-28): when the scored fields come from the type's SCHEMA, an expected
(required) field that is EMPTY now counts as **0** in the average — so a doc with
one good field and several empty required fields no longer reads as high/green (the
"72% with two empty fields" bug). The hard-coded fallback (no `field_defs`) keeps
the old present-only average (those keys may not exist for a type). Guarded by
tests/test_confidence_empty_fields.py. (KNOWN TRADE-OFF: a type whose required
date/ref is legitimately ABSENT on some layouts will be over-flagged — there's no
"required but sometimes absent" notion yet.)

---

