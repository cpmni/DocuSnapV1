"""
extraction/engine.py
--------------------
Orchestrates the extraction pipeline across three modes:

  FAST  — keyword + anchor only. No LLM. Sub-second per document.
           Used when supplier is well-trained.

  SMART — keyword + anchor only, same as FAST. Default mode. (LLM
           fallback for missing required fields was disabled — see
           _should_use_llm — kept distinct from FAST for future use.)

  AI    — LLM always runs after keyword + anchor, regardless of
           confidence. Slowest, most thorough for unknown documents.

Usage:
  engine = ExtractionEngine(mode='smart', ...)
  result = engine.extract(...)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction import keyword, anchor, validator, ocr_corrector, template_matcher, template_mapper, format_anomaly_checker

# LLM import is optional — system works without it in FAST mode
try:
    from extraction import llm as llm_module
    LLM_AVAILABLE = True
except ImportError:
    LLM_AVAILABLE = False


def _supplier_identity_decision(existing: dict | None, candidate: dict | None) -> str | None:
    """Plausibility-aware merge ruling for the supplier_name field only.

    Returns 'take' (candidate replaces existing), 'keep' (existing wins, ignore
    candidate), or None (no opinion — fall back to the normal confidence merge).

    A plausible candidate replaces an IMPLAUSIBLE incumbent regardless of
    confidence — this is what lets a real read of the company name override a
    stale template_fixed short fragment like "IN" that arrived at confidence 95.
    Symmetrically, an implausible candidate never displaces a plausible
    incumbent. When both are plausible (or both implausible — e.g. a genuinely
    short "IBM" with no plausible alternative), there is no opinion and the
    caller's confidence comparison decides, so legitimate short names are never
    hard-banned. Reuses keyword._is_plausible_supplier_name (shape test).
    """
    e_ok = keyword._is_plausible_supplier_name((existing or {}).get("value"))
    c_ok = keyword._is_plausible_supplier_name((candidate or {}).get("value"))
    if e_ok and not c_ok:
        return "keep"
    if c_ok and not e_ok:
        return "take"
    return None


class ExtractionEngine:

    def __init__(self,
                 mode:         str = "smart",   # fast | smart | ai
                 config_path:  str | None = None,
                 ollama_url:   str = "http://127.0.0.1:11434/api/generate",
                 model:        str = "phi3:mini",
                 emit_fn            = None):

        self.mode         = mode.lower()
        self.patterns     = keyword.load_patterns(config_path)
        self.ollama_url   = ollama_url
        self.model        = model
        self.emit         = emit_fn or (lambda msg: None)
        self.format_index        = {}   # populated by set_formats()
        self.noise_profile_index = {}   # populated by set_formats()
        self.format_class_index  = {}   # populated by set_formats()

    def log(self, text: str, level: str = ""):
        self.emit({"type": "log", "text": text, "level": level})

    def set_formats(self, formats_data: list):
        """Pre-build all format indexes from confirmed value data."""
        self.format_index        = ocr_corrector.build_format_index(formats_data)
        self.noise_profile_index = ocr_corrector.build_noise_profile_index(formats_data)
        self.format_class_index  = format_anomaly_checker.build_format_class_index(formats_data)
        n = len([k for k in self.format_index if k != '_fallback'])
        m = len(self.noise_profile_index)
        p = len(self.format_class_index)
        self.log(f"  OCR corrector: {n} format templates, {m} learned noise profile(s) loaded")
        if p:
            self.log(f"  Format checker: {p} format class rule(s) loaded")

    def warmup(self) -> bool:
        """Warm up Ollama model. Returns True if AI is available."""
        if self.mode == "fast":
            self.log("  Fast Mode — AI not used.")
            return False
        if not LLM_AVAILABLE:
            self.log("  LLM module not available — running in Fast Mode.", "warn")
            self.mode = "fast"
            return False
        self.log("  Warming up AI model…")
        ok = llm_module.warmup(self.ollama_url, self.model)
        if ok:
            self.log(f"  AI model ready ({self.model}).")
        else:
            self.log("  AI model not available — falling back to Fast Mode.", "warn")
            self.mode = "fast"
        return ok

    def detect_document_type(self, ocr_text: str,
                             known_types: list | None = None) -> dict | None:
        return keyword.detect_document_type(ocr_text, self.patterns, known_types)

    def extract(self,
                ocr_text:      str,
                page_images:   list,
                filename:      str,
                field_defs:    list,
                hints:         list,
                anchors:       list,
                logos:         list,
                templates:     list | None = None,
                document_type: str | None = None,
                document_slug: str | None = None,
                supplier_name: str | None = None) -> dict:
        """
        Run extraction pipeline according to current mode.
        Returns dict with field values + metadata keys prefixed with _.
        """
        results      = {}
        field_keys   = [f["key"] for f in field_defs]
        # Date-typed fields get a merge guard: a candidate that doesn't parse as
        # a real date must never displace one that does (e.g. a mis-cropped
        # taught anchor returning a bare "March" overriding a valid full date).
        date_field_keys = {f["key"] for f in field_defs if f.get("type") == "date"}
        matched_tmpl = None
        logo_phash   = None
        kw_fingerprint = []

        # ── Pre-stage: compute logo hash + keyword fingerprint (always) ───────
        if page_images:
            logo_phash = template_matcher.compute_logo_hash(page_images[0])
        kw_fingerprint = template_matcher.extract_keyword_fingerprint(ocr_text)

        # ── Stage 0: Template matching ────────────────────────────────────────
        if templates:
            match = template_matcher.identify_template(
                page_images[0] if page_images else None,
                ocr_text,
                templates,
            )
            if match:
                matched_tmpl = match['template']
                self.log(
                    f"  Template matched: {matched_tmpl.get('name')} "
                    f"({match['confidence']}% via {match['method']})"
                )
                tmpl_results = template_matcher.extract_with_template(ocr_text, matched_tmpl)
                for key, data in tmpl_results.items():
                    results[key] = data
                # Promote supplier from the template's own resolved supplier_name
                # field (a fixed_value learned from confirmed documents) — NOT
                # from the template's auto-generated display name. Templates
                # created before a supplier was known get generic names like
                # "Purchase Order Template", whose first word ("Purchase") is
                # not a supplier name — using it poisoned every downstream
                # hint/anchor lookup (and got persisted into supplier_hints,
                # where it then won out over the real "Polychemtex Inc." hints).
                if not supplier_name:
                    supplier_name = (results.get('supplier_name') or {}).get('value') or None
                found = len([v for v in results.values() if v.get('value')])
                self.log(f"  Stage 0: {found}/{len(field_keys)} fields from template")

                # ── Stage 0.5: admin-drawn anchor → target zone mappings ──────
                # Optional, additive layer on the matched template (Settings →
                # Templates → "Map a Field"). Only engages for documents that
                # matched a SPECIFIC template with enabled mappings AND when we
                # have page pixels to crop — every template/document without
                # drawn mappings takes zero extra work and behaves exactly as
                # before. See template_mapper.py for the anchor-relocation +
                # relative-offset model (the "primary model" the admin tool
                # implements — NOT a fixed coarse-grid lookup).
                tmpl_mappings = [m for m in (matched_tmpl.get('field_mappings') or [])
                                 if m.get('enabled', True) not in (False, 0)]
                if tmpl_mappings and page_images:
                    self.log(f"  Stage 0.5: {len(tmpl_mappings)} anchor→target mapping(s)…")
                    mapping_results = template_mapper.extract_with_mappings(
                        page_images, tmpl_mappings,
                        field_patterns=self.patterns.get("field_patterns", {}),
                    )
                    applied = 0
                    for key, data in mapping_results.items():
                        existing = results.get(key)
                        # An admin-drawn mapping (Settings → Templates → "Map a
                        # Field") is a deliberate, per-template correction —
                        # someone pinned the exact zone on a real sample because
                        # the template's own generic rule was producing the
                        # wrong value for this field (template_fixed/
                        # template_anchor are frequently auto-learned and can be
                        # stale — this mapping exists specifically to override
                        # one). It should win on authority, not on a raw
                        # confidence number that the generic rule's stale 95
                        # (template_fixed) would otherwise always clear. Mirrors
                        # the is_taught_override precedent below — a more
                        # specific, curated source outranks the more generic
                        # rule it refines, regardless of either one's confidence.
                        is_curated_refinement = (existing is None
                                                  or existing.get("method") in
                                                     ("template_fixed", "template_anchor"))
                        if is_curated_refinement or data["confidence"] > existing.get("confidence", 0):
                            results[key] = data
                            applied += 1
                    if applied:
                        self.log(f"  Stage 0.5: {applied} field(s) refined via anchor/target mapping")

        # ── Pre-stage: logo supplier identification (fallback if no template) ──
        if not supplier_name and logos and page_images:
            logo_match = anchor.try_logo_supplier_match(page_images[0], logos)
            if logo_match:
                supplier_name = logo_match["supplier_name"]
                self.log(
                    f"  Logo match: {supplier_name}"
                    f" ({logo_match['confidence']}% confidence,"
                    f" {logo_match['match_count']} previous docs)"
                )
                results["supplier_name"] = {
                    "value":      supplier_name,
                    "confidence": logo_match["confidence"],
                    "method":     "logo",
                }

        # ── Stage 1: Keyword extraction (always runs) ─────────────────────────
        self.log("  Stage 1: keyword extraction…")
        kw_results = keyword.extract_fields(ocr_text, field_keys, self.patterns)
        for key, data in kw_results.items():
            existing = results.get(key)
            if key == "supplier_name" and existing:
                decision = _supplier_identity_decision(existing, data)
                if decision == "keep":
                    continue
                if decision == "take":
                    results[key] = data
                    continue
            if (key in date_field_keys and existing
                    and validator.parse_date(existing.get("value")) is not None
                    and validator.parse_date(data.get("value")) is None):
                continue  # don't let an unparseable date replace a valid one
            if not existing or data.get("confidence", 0) > existing.get("confidence", 0):
                results[key] = data
        found = len([v for v in results.values() if v.get("value")])
        self.log(f"  Stage 1: {found}/{len(field_keys)} fields found")

        # ── Stage 2: Anchor extraction (always runs) ──────────────────────────
        if anchors:
            self.log("  Stage 2: anchor extraction…")
            anchor_results = anchor.extract_with_anchors(
                ocr_text, anchors, supplier_name, document_slug,
                page_images=page_images,
                field_patterns=self.patterns.get("field_patterns", {}),
            )
            for key, data in anchor_results.items():
                existing = results.get(key)
                # Supplier identity is plausibility-gated first: a poisoned
                # anchor_crop carrying an implausible short fragment must not
                # ride the is_taught_override path to clobber a plausible name,
                # and a plausible anchor read must rescue an implausible
                # incumbent regardless of confidence. Both-plausible /
                # both-implausible falls through to the normal contest below.
                if key == "supplier_name" and existing:
                    decision = _supplier_identity_decision(existing, data)
                    if decision == "keep":
                        continue
                    if decision == "take":
                        results[key] = data
                        continue
                # Date guard: an unparseable taught date (e.g. a mis-cropped
                # anchor_crop "March") must not override a valid existing date,
                # even via the is_taught_override "ground truth" path below.
                if (key in date_field_keys and existing
                        and validator.parse_date(existing.get("value")) is not None
                        and validator.parse_date(data.get("value")) is None):
                    continue
                # A user-taught anchor (drawn with the ⊕ tool, resolved via
                # crop+re-OCR at the exact saved coordinates) is ground truth for
                # that spot on the page — it overrides a generic keyword/regex
                # match even when the keyword match scored higher confidence.
                # Without this, a freshly-learned anchor (usage_count=1, so its
                # computed confidence sits ~85) can never beat an
                # already-wrong keyword hit (e.g. base_confidence 88-93 for
                # po_number), so the "wrong value" never gets corrected.
                #
                # EXCEPTION — admin-drawn template mappings (Stage 0.5,
                # method "template_mapping"/"template_mapping_expanded") are
                # excluded from "generic match this overrides". A learned
                # anchor_crop is keyed to whatever supplier_name the pipeline
                # believed at teaching time; if that identity was wrong, the
                # anchor itself is silently wrong too — and unconditionally
                # overriding a freshly hand-placed mapping with it would let
                # exactly that stale, mis-keyed learning permanently shadow a
                # deliberate correction (the bug this guard exists to close).
                # The two now contend on confidence like any other pairing —
                # both are curated "ground truth" tiers, so a fair contest
                # between them is the right arbiter, not an automatic win for
                # whichever one happens to run later in the stage order.
                is_taught_override = (data.get("method") == "anchor_crop"
                                      and existing
                                      and existing.get("method") not in
                                          ("anchor_crop", "template_mapping", "template_mapping_expanded"))
                if not existing or is_taught_override or data["confidence"] > existing["confidence"]:
                    results[key] = data
            new_found = len([v for v in results.values() if v.get("value")])
            self.log(f"  Stage 2: +{new_found - found} fields from anchors")
            found = new_found

        # ── Resolve final supplier identity ───────────────────────────────────
        # Stage 0 (template) and the pre-stage logo match only produce a
        # provisional supplier_name — its job is to seed anchor/hint filtering
        # for Stage 2, not to be the final answer. Stage 1/2 can legitimately
        # override results['supplier_name'] with a different, more accurate
        # value (e.g. a user-taught anchor_crop reading the real page beats a
        # near-duplicate-logo template match). Re-resolving here — once, after
        # every stage that can touch the field has run, before _supplier_name
        # is set or any hint/anchor/logo persistence happens — keeps the
        # pipeline's notion of "who is this" in sync with the value the user
        # actually sees and confirms. Without this, the stale provisional
        # identity kept driving downstream lookups/persistence while the
        # displayed field already held the corrected value, silently writing
        # the wrong supplier into the learning corpus on every confirm.
        resolved_supplier = (results.get('supplier_name') or {}).get('value') or None
        if resolved_supplier and resolved_supplier != supplier_name:
            if supplier_name:
                self.log(
                    f"  WARNING: supplier identity changed during extraction — "
                    f"pipeline='{supplier_name}' field='{resolved_supplier}' "
                    f"(file={filename}) — using field value",
                    level="warn",
                )
            supplier_name = resolved_supplier

        # Normalise supplier identity to one canonical form before it drives any
        # downstream supplier-scoped lookup (hints, anchors, format anomaly) or
        # gets persisted: OCR edge noise like a leading smart quote ("‘Cloud VPS")
        # otherwise splits the learning corpus so prior corrections never apply.
        if supplier_name:
            normalised = keyword.normalize_supplier_name(supplier_name)
            if normalised != supplier_name:
                supplier_name = normalised
                if results.get('supplier_name'):
                    results['supplier_name'] = {**results['supplier_name'], 'value': supplier_name}

        # ── Stage 2.5a: Supplier name text-scan fallback ─────────────────────────
        # If logo match failed and keyword didn't find supplier_name, scan the
        # top of the OCR text for any known supplier name from confirmed hints.
        # This handles suppliers like "SuperStore" whose name appears as plain
        # text rather than an identifiable logo.
        #
        # Gated on PLAUSIBILITY, not mere presence: a stale template/anchor seed
        # of an implausible short fragment ("IN") used to count as "already have
        # a supplier" and skipped this recovery entirely — letting the fragment
        # win. Now an implausible incumbent is treated like no incumbent, so the
        # scan can recover the real, plausible name from confirmed hints.
        if not keyword._is_plausible_supplier_name(supplier_name) and hints:
            ocr_top = ocr_text[:600].lower()
            best_hint = None
            best_usage = 0
            for h in hints:
                if h.get("field_key") != "supplier_name":
                    continue
                if (h.get("usage_count") or 0) < 3:
                    continue
                val = (h.get("hint_value") or "").strip()
                # Only a PLAUSIBLE hint may replace the incumbent — never swap one
                # implausible fragment for another.
                if not keyword._is_plausible_supplier_name(val):
                    continue
                if val and val.lower() in ocr_top:
                    if (h.get("usage_count") or 0) > best_usage:
                        best_hint  = val
                        best_usage = h.get("usage_count") or 0
            if best_hint:
                supplier_name = best_hint
                results["supplier_name"] = {
                    "value":      best_hint,
                    "confidence": min(85, 60 + best_usage * 2),
                    "method":     "hint_text_match",
                }
                self.log(f"  Stage 2.5: supplier '{best_hint}' identified from text scan")

        # ── Stage 2.5b: Apply supplier hints (fill missing fields only) ──────────
        # Hints only fill fields that keyword/anchor found NOTHING for.
        # They do not override a found value — each document's variable fields
        # (date, reference, customer name) differ per invoice.
        if hints and supplier_name:
            hint_results = self._apply_hints(hints, supplier_name, document_slug, field_defs)
            hint_count = 0
            for key, data in hint_results.items():
                existing = results.get(key)
                if not existing or not existing.get("value"):
                    results[key] = data
                    hint_count += 1
            if hint_count:
                self.log(f"  Stage 2.5: {hint_count} field(s) set from learned hints")

        # ── Stage 2.5c: learned noise-edge stripping (template-scoped) ───────
        # Runs before character-substitution correction below so a value like
        # "# 14269" is trimmed to "14269" first — giving try_correct a clean,
        # correctly-sized string to apply digit-confusion fixes to, rather than
        # failing its length check against a noise-padded value.
        if self.noise_profile_index:
            n_denoised = 0
            for key, data in list(results.items()):
                if not isinstance(data, dict) or not data.get("value"):
                    continue
                denoised, was_changed = ocr_corrector.denoise_value(
                    data["value"], key, supplier_name, document_slug,
                    self.noise_profile_index,
                )
                if was_changed:
                    results[key] = {
                        **data,
                        "value":      denoised,
                        "confidence": min(95, (data.get("confidence") or 0) + 5),
                        "method":     data.get("method", "") + "+denoised",
                    }
                    n_denoised += 1
            if n_denoised:
                self.log(f"  Stage 2.5: {n_denoised} value(s) denoised via learned template")

        # ── Stage 2.5b: OCR format correction ────────────────────────────────
        if self.format_index:
            n_corrected = 0
            for key, data in list(results.items()):
                if not isinstance(data, dict) or not data.get("value"):
                    continue
                corrected_val, boost = ocr_corrector.correct_extraction(
                    data["value"], key, supplier_name, document_slug,
                    self.format_index,
                )
                if boost > 0:
                    new_conf = min(95, (data.get("confidence") or 0) + boost)
                    was_changed = corrected_val != data["value"]
                    results[key] = {
                        **data,
                        "value":      corrected_val,
                        "confidence": new_conf,
                        "method":     (data.get("method", "") + "+corrected")
                                      if was_changed else data.get("method", ""),
                    }
                    if was_changed:
                        n_corrected += 1
            if n_corrected:
                self.log(f"  Stage 2.5: {n_corrected} OCR correction(s) applied")

        # ── Decide whether to call LLM ────────────────────────────────────────
        use_llm = self._should_use_llm(results, document_slug)

        if use_llm:
            missing = [f for f in field_defs
                       if not results.get(f["key"], {}).get("value")]
            if missing:
                self.log(
                    f"  Stage 3: AI extraction for {len(missing)} fields…"
                )
                llm_results = llm_module.extract_missing_fields(
                    ocr_text, filename, field_defs,
                    already_found    = results,
                    hints            = hints,
                    document_type    = document_type,
                    supplier_name    = supplier_name,
                    ollama_url       = self.ollama_url,
                    model            = self.model,
                )
                for key, data in llm_results.items():
                    if data.get("value") and not results.get(key, {}).get("value"):
                        results[key] = data
                final = len([v for v in results.values() if v.get("value")])
                self.log(f"  Stage 3: +{final - found} fields from AI")
        else:
            self.log(f"  Stage 3: skipped ({self.mode.capitalize()} Mode)")

        # ── Stage 4: Validation ───────────────────────────────────────────────
        self.log("  Stage 4: validating…")
        results = validator.validate_and_adjust(results, field_defs)

        # ── Stage 4.5: Format anomaly check ──────────────────────────────────
        # Compares each extracted value against the coarse format class learned
        # from confirmed historical values for the same
        # (supplier_name, document_type, field_key) group.  On anomaly: caps
        # confidence at 45 and adds a traceable validation_note.  Fields
        # already flagged by Stage 4 are skipped to avoid double-penalisation.
        # No correction is proposed here — that is Stage 2 of this feature.
        format_anomaly_flagged = False
        if self.format_class_index and supplier_name and document_slug:
            s_lower  = supplier_name.lower().strip()
            dt_lower = document_slug.lower().strip()
            n_flagged = 0
            for key, data in list(results.items()):
                if key.startswith('_') or not isinstance(data, dict):
                    continue
                if data.get('validation_note'):
                    continue  # Stage 4 already flagged this field
                val = data.get('value')
                if not val:
                    continue
                fmt_entry = self.format_class_index.get((s_lower, dt_lower, key))
                if not fmt_entry:
                    continue
                anomaly = format_anomaly_checker.check_value(str(val), fmt_entry)
                if anomaly:
                    new_conf = min(data.get('confidence') or 0, 45)
                    results[key] = {
                        **data,
                        'confidence':      new_conf,
                        'validation_note': f"format anomaly ({anomaly['anomaly']})",
                    }
                    n_flagged += 1
                    format_anomaly_flagged = True
            if n_flagged:
                self.log(f"  Stage 4.5: {n_flagged} field(s) flagged by format anomaly check")

        # ── Metadata ──────────────────────────────────────────────────────────
        overall_conf  = validator.overall_confidence(results, field_defs)
        # Stage 4.5 confidence caps (≤45) will always trigger needs_review via
        # the per-field threshold check.  The OR guard covers the edge case
        # where a flagged field is not listed in field_defs.
        review_needed = validator.needs_review(results, field_defs) or format_anomaly_flagged

        results["_supplier_name"]        = supplier_name
        results["_document_type"]        = document_type
        results["_document_slug"]        = document_slug
        results["_overall_confidence"]   = overall_conf
        results["_needs_review"]         = review_needed
        results["_mode_used"]            = self.mode
        results["_template_id"]          = matched_tmpl.get("id") if matched_tmpl else None
        results["_logo_phash"]           = logo_phash
        results["_keyword_fingerprint"]  = kw_fingerprint

        return results

    def _apply_hints(self, hints: list, supplier_name: str,
                     document_slug: str | None, field_defs: list[dict]) -> dict:
        """
        Apply learned supplier hints as direct field values — but only for
        fields whose value is constant for a given supplier (company name,
        address, terms). A field the document type's own schema marks as
        "variable" (it's the designated reference/date field, or typed as a
        date) differs on every document; replaying a remembered value for
        it is exactly how one document's reference number ends up stamped
        onto another's (see field_defs[*]["is_variable"], derived in
        document_types.js from ref_field_key/date_field_key/type — NOT a
        per-field-key guess here, so custom types/fields are covered too).

        Only applies hints with usage_count >= 2 that match this supplier
        (exactly — see note below) and optionally doc type. Confidence
        scales with usage_count (caps at 90).
        """
        results    = {}
        s_lower    = supplier_name.lower().strip()
        field_meta = {f["key"]: f for f in field_defs}

        for hint in hints:
            h_sup   = (hint.get("supplier_name") or "").lower().strip()
            h_type  = hint.get("document_type") or ""
            h_key   = hint.get("field_key")
            h_value = hint.get("hint_value")
            usage   = int(hint.get("usage_count") or 0)

            if not h_key or not h_value or h_key not in field_meta:
                continue
            if usage < 2:
                continue
            if field_meta[h_key].get("is_variable"):
                continue

            # Exact (normalised) supplier match. Substring matching here
            # would let one supplier's hints bleed into another's whenever
            # one name contains the other — the same collision class that
            # made 'PO' match inside "Polychemtex Inc." for template anchors.
            sup_match  = h_sup and h_sup == s_lower
            type_match = (not h_type) or (h_type == (document_slug or ""))

            if sup_match and type_match:
                conf = min(90, 60 + usage * 5)
                # Only update if this hint gives higher confidence than existing
                existing_conf = results.get(h_key, {}).get("confidence", 0)
                if conf > existing_conf:
                    results[h_key] = {
                        "value":      h_value,
                        "confidence": conf,
                        "method":     "hint",
                    }

        return results

    def _should_use_llm(self, current_results: dict,
                        document_slug: str | None) -> bool:
        """Decide whether to call the LLM based on current mode and coverage."""
        # Fast and Smart modes both use keyword+anchor only — no Ollama required.
        # LLM is reserved for 'ai' mode only (not exposed in UI).
        if self.mode == "ai":
            return LLM_AVAILABLE
        return False
