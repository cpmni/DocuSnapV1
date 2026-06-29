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

from extraction import keyword, anchor, validator, ocr_corrector, template_matcher, template_mapper, format_anomaly_checker, value_quality, wordness

# LLM import is optional — system works without it in FAST mode
try:
    from extraction import llm as llm_module
    LLM_AVAILABLE = True
except ImportError:
    LLM_AVAILABLE = False


# Stage 0.5 LOCATED-path mapping methods (admin-drawn anchor→target zones that
# located their anchor on this page). Curated ground truth — protected from
# keyword demotion and from a stale taught-anchor clobber. The "_salvaged"
# variants are the SAME located mappings whose date value was rescued via
# validator.salvage_date (Fix C1); they carry identical provenance and so get
# identical protection. The weaker DRIFT-path variants are deliberately excluded
# (unchanged): a fixed-coordinate drift seed is not strong enough to be shielded.
# Minimum substantial-word OCR confidence for an authoritative ⊕ anchor's CROP
# read to win Tier-A OUTRIGHT (engine.extract). Below this the read carries a
# garbled word and must instead contend on confidence, where its OCR-capped score
# loses to a clean alternative. 70 keeps confidently-read teaches winning while
# rejecting the partial-garble case (min word conf ~55) the mean alone misses.
_TIER_A_OCR_MIN = 70

_STAGE05_LOCATED_METHODS = (
    "template_mapping", "template_mapping_expanded",
    "template_mapping_salvaged", "template_mapping_expanded_salvaged",
    # P4 "register, then read" rung — a target box mapped through the per-page
    # registration transform. Same curated-ground-truth provenance as a located
    # mapping, so it gets the same keyword-demotion / stale-anchor-clobber guards.
    "template_registration", "template_registration_expanded",
    "template_registration_salvaged", "template_registration_expanded_salvaged",
)


def _is_stage05_located(method: str | None) -> bool:
    """True for ANY Stage 0.5 located-mapping method — the absolute fast-path read,
    the registration/relocation rungs, and their `_salvaged` / `_shapewarn` suffix
    variants. Prefix-based so every present and future suffix combination (e.g.
    template_mapping_shapewarn, template_registration_expanded_shapewarn) gets the
    SAME protection: keyword can't demote it (Stage 1) and a non-authoritative
    auto-anchor can't clobber it (Stage 2). Note template_matcher's generic
    `template_fixed` / `template_anchor` deliberately DON'T match — they are the
    auto-learned rules a manual mapping exists to override, not located mappings."""
    return bool(method) and (method.startswith("template_mapping")
                             or method.startswith("template_registration"))


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


def _is_ref_field(key: str) -> bool:
    """Reference-number-style fields, by naming convention (no supplier/doc
    specifics): invoice_number / po_number / sales_order_number (..._number),
    job_no (..._no), and any explicit reference field. Covers unseen custom
    types that follow the same convention."""
    k = (key or "").lower()
    return k.endswith("_number") or k.endswith("_no") or "reference" in k


# Field TYPE → credibility validation key. Only STRUCTURED / code types are mapped;
# text/multiline_text are deliberately ABSENT so free-text fields stay unconstrained
# (seeding "text" would flip on the degraded-text escalation for name/address reads).
_TYPE2VAL = {"date": "date", "currency": "currency", "number": "currency",
             "amount": "currency", "alphanumeric": "alphanumeric",
             "job_reference": "job_reference", "currency_code": "currency_code",
             # Explicit "Reference number" field type — a deliberate CODE marker;
             # gated alphanumeric, never currency.
             "reference": "alphanumeric",
             # "Reference code" — a STRICTER ref shape that must contain a digit (a
             # digit-free word like "Reference"/"Customer" fails). A deliberate WITHHOLD
             # gate, offered as a distinct option rather than mutating "alphanumeric"
             # (which many fields rely on). reggie Tier-2.
             "reference_code": "reference_code"}
# NOTE: the FLAG-ONLY supplementary types (email/percentage/postcode_uk/vat_gb/iban/website)
# are deliberately NOT mapped here. A _TYPE2VAL entry makes the value's validation_pattern a
# WITHHOLD gate (a non-matching read is dropped); these are flag-only per review-not-reject —
# the value is kept and surfaced for review via the renderer on-blur validator
# (TYPE_TO_VALIDATION) + the Stage-4.5 field_charsets note (both keyed on the field TYPE,
# independent of _TYPE2VAL). reference_code (above) is the one Tier-2 type that DOES gate.


def _seed_field_patterns(base_patterns, field_defs):
    """Seed per-field credibility patterns from each field's configured TYPE so a
    CUSTOM doc-type field (no keyword-config entry) is gated by its real type rather
    than loose free-text (which lets high-DPI crop garbage commit unchallenged). The
    keyword config wins where it already carries an entry.

    Ref-role coercion — both cases resolve to "alphanumeric", the right gate for a CODE:
      * a ref field a user typed Number/Currency (the money pattern rejects NNNN-NNNN-N
        refs); and
      * the doc-type REFERENCE role typed plain "text" — the structural ref field is
        created as text, so it slips past _TYPE2VAL and would be graded FREE TEXT,
        accepting OCR garbage like "en rT" at the absolute drawn box and never
        relocating to its anchor. Free-text name/address fields (not _is_ref_field)
        stay unconstrained. Reusable for every supplier/template with a text ref role.
    """
    field_patterns = dict(base_patterns or {})
    for _f in (field_defs or []):
        _k, _t = _f.get("key"), (_f.get("type") or "").lower()
        if not _k or _k in field_patterns:
            continue
        # A MAC/IP field is a CODE with a precise format — give it a first-class
        # validation pattern regardless of the loose DB type the user picked
        # (text/alphanumeric), so its colons/octets are type-VALID (not "unexpected
        # characters") and a new device's address isn't flagged as a learned-SHAPE
        # anomaly. See value_quality.network_address_validation.
        _net = value_quality.network_address_validation(_k)
        if _net:
            field_patterns[_k] = {"validation": _net}
        elif _t in _TYPE2VAL:
            mapped = _TYPE2VAL[_t]
            if _is_ref_field(_k) and mapped in ("currency", "currency_code"):
                mapped = "alphanumeric"
            field_patterns[_k] = {"validation": mapped}
        elif _is_ref_field(_k):
            field_patterns[_k] = {"validation": "alphanumeric"}
    return field_patterns


def _ref_override_plausible(value) -> bool:
    """Conservative shape gate for whether a Stage 2 reference candidate is
    information-rich enough to OVERRIDE an existing incumbent. Rejects the
    low-information failures (a lone "a", punctuation-only crops, 2-letter
    noise) while still accepting short numeric refs ("12", "PO12") and normal
    alphanumeric refs ("INV-2026-001", "ABCD"). Shape-only — no value lists."""
    v = (value or "").strip()
    alnum = sum(c.isalnum() for c in v)
    if alnum == 0:                       # punctuation-only junk
        return False
    if len(v) < 2:                       # single character like "a"
        return False
    if not any(c.isdigit() for c in v) and alnum < 4:   # very low-info, no digits
        return False
    return True


def _enabled_mappings(tmpl: dict) -> list:
    """Enabled admin-drawn field_mappings on a template dict (same enabled-filter
    Stage 0.5 has always applied: anything not explicitly disabled counts)."""
    return [m for m in (tmpl.get("field_mappings") or [])
            if m.get("enabled", True) not in (False, 0)]


def select_mapping_source(matched_tmpl: dict, templates: list | None) -> tuple[list, dict | None]:
    """Decide which template's admin-drawn field_mappings to run for a document
    that matched ``matched_tmpl`` — the deferred template-group "shared-anchor"
    behaviour (see templates.js: groups were metadata-only in v1).

    Returns ``(mappings, source)`` where ``mappings`` is the list of enabled
    field_mappings to apply and ``source`` is the template they came from
    (``matched_tmpl`` itself when it has its own, the sibling when borrowed, or
    ``matched_tmpl`` with an empty list when there is nothing to run).

    Rule:
      1. If the matched template has enabled mappings OF ITS OWN, always use
         those — unchanged behaviour; a template's own curated mappings win and
         no group lookup happens.
      2. Otherwise, if it belongs to a group, BORROW from the grouped sibling
         (same ``group_id``, different ``id``) that has enabled mappings. A group
         is an admin assertion that those templates share a layout, and the
         borrowed mappings are still re-run through the anchor-relocation model
         on THIS page (template_mapper re-finds each anchor, yielding nothing if
         the layout doesn't actually match) — so borrowing is validated, never
         copied blindly.
      3. If there is no group, or no sibling has mappings, return an empty list
         so the caller simply runs no Stage 0.5 — exactly as before.

    Deterministic sibling pick: the sibling with the MOST enabled mappings, tie-
    broken by highest ``confirmed_count`` then lowest ``id`` — the most-developed,
    most-trusted sibling, chosen stably regardless of the input list's order.

    Pure: no I/O and no DB; operates only on the template dicts already passed
    into ``extract()`` (each carries ``id``, ``group_id`` and ``field_mappings``
    via templates.getAll's ``SELECT *`` + per-row mapping load).
    """
    own = _enabled_mappings(matched_tmpl)
    if own:
        return own, matched_tmpl

    gid = matched_tmpl.get("group_id")
    if gid is None:
        return [], matched_tmpl

    mid = matched_tmpl.get("id")
    candidates = []
    for sib in (templates or []):
        if sib is matched_tmpl:
            continue
        if sib.get("group_id") != gid or sib.get("id") == mid:
            continue
        sib_maps = _enabled_mappings(sib)
        if sib_maps:
            candidates.append((sib, sib_maps))

    if not candidates:
        return [], matched_tmpl

    candidates.sort(key=lambda c: (-len(c[1]),
                                   -(c[0].get("confirmed_count") or 0),
                                   c[0].get("id") or 0))
    best_sib, best_maps = candidates[0]
    return best_maps, best_sib


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
        self.label_overrides     = []   # populated by set_label_overrides()
        self.field_rules_index   = {}   # populated by set_field_rules()
        self._multiline_index    = {}   # populated by set_field_rules() (multiline_continue)
        self.multiline_enabled   = False  # set by set_multiline_enabled()
        self.registration_enabled = False  # set by set_registration_enabled()
        # Phase 3 candidate-override (default OFF → byte-identical behaviour). Modes:
        # 'off' | 'suggest' (corrected_to only) | 'auto' (value, only for opted-in
        # field types in candidate_override_fields). See _resolve_candidates().
        self.candidate_override        = 'off'
        self.candidate_override_fields = set()
        self._field_candidates   = {}    # per-run candidate ledger (built only when override on)
        # Wordness gate (default OFF → byte-identical). When on, a free-text NAME read
        # that does not read like a name (document chrome, ref/code bleed, OCR garble)
        # is FLAGGED for review (note + conf cap); never rejected. See extraction/wordness.py.
        self.name_wordness       = False
        self._trace              = None  # dev-only trace callback (set per extract())

    def log(self, text: str, level: str = ""):
        self.emit({"type": "log", "text": text, "level": level})

    def set_registration_enabled(self, on: bool):
        """Enable the Stage 0.5 registration rung (P4, 'register, then read').
        Inert unless the matched template carries taught landmarks."""
        self.registration_enabled = bool(on)

    def set_name_wordness(self, on: bool):
        """Enable the free-text NAME wordness review flag (default OFF). Inert unless the
        char-trigram table ships (extraction/data/char_trigrams.json)."""
        self.name_wordness = bool(on)

    def set_multiline_enabled(self, on: bool):
        """Enable the multi-line continuation read (default OFF in-engine; the handler passes
        the default-ON setting). Inert without a multiline_continue rule for the field — so a
        single-line read stays byte-identical."""
        self.multiline_enabled = bool(on)

    def set_candidate_override(self, mode, fields=None):
        """Enable the Phase 3 post-merge candidate resolver. mode: 'off' (default,
        no behaviour change) | 'suggest' (corrected_to + note only) | 'auto' (replace
        value, but ONLY for field types in `fields`). Mirrors the other extraction
        setting setters; default-off keeps the engine byte-identical."""
        self.candidate_override = (mode or 'off').lower().strip()
        self.candidate_override_fields = set(fields or [])

    # ── Phase 3 candidate ledger + post-merge resolver (default OFF) ─────────────
    # A purely-additive side-ledger of every stage's produced candidate, consumed
    # ONLY by _resolve_candidates after Stage 4.5. Winner-selection code is unchanged;
    # when candidate_override is 'off' both helpers short-circuit so there is zero
    # extra work and zero behaviour change.
    def _remember_candidates(self, stage: str, produced: dict):
        if self.candidate_override == 'off' or not produced:
            return
        for key, data in produced.items():
            if key.startswith('_') or not isinstance(data, dict):
                continue
            v = data.get('value')
            if not v:
                continue
            self._field_candidates.setdefault(key, []).append({
                'value':         v,
                'method':        data.get('method'),
                'confidence':    data.get('confidence') or 0,
                'stage':         stage,
                'authoritative': bool(data.get('authoritative')),
                'located':       bool(data.get('located')),
            })

    @staticmethod
    def _override_eligible(incumbent: dict) -> bool:
        """A winner may be reconsidered ONLY if it is a generic/auto source — NEVER
        an authoritative ⊕ anchor, a Stage 0.5 located mapping/registration, or an
        admin label. This is what preserves the committed precedence guarantees."""
        if incumbent.get('authoritative'):
            return False
        m = incumbent.get('method')
        if _is_stage05_located(m) or m == 'keyword_override':
            return False
        return True

    def _best_challenger(self, key, incumbent, cands, fmt_entry, ftype):
        """Pick a retained candidate that CLEARLY beats the incumbent on the field's
        evidence axis, else None. Deterministic (tie-break: confidence desc, then
        value). Reuses shape_match_score (shaped) / value_quality.name_quality (name)
        — no parallel scoring."""
        inc_val = str(incumbent.get('value') or '')
        distinct = [c for c in cands if c.get('value') and str(c['value']) != inc_val]
        if not distinct:
            return None

        shapes = (fmt_entry or {}).get('shapes')
        if shapes:  # SHAPED field: prefer a candidate that matches a learned shape
            if format_anomaly_checker.shape_match_score(inc_val, fmt_entry) >= 0.8:
                return None  # incumbent already credible for this shape
            qualifying = [c for c in distinct
                          if format_anomaly_checker.shape_match_score(str(c['value']), fmt_entry) == 1.0]
        else:       # NAME-LIKE field: prefer a clearly higher-quality name
            try:
                from extraction import value_quality
            except Exception:
                return None
            if not value_quality.is_name_like_field(key):
                return None
            if value_quality.name_quality(inc_val) >= 0.5:
                return None
            qualifying = [c for c in distinct
                          if value_quality.name_quality(str(c['value'])) >= 0.6]
        if not qualifying:
            return None
        qualifying.sort(key=lambda c: (-(c['confidence'] or 0), str(c['value'])))
        return qualifying[0]

    def _resolve_candidates(self, results, field_defs, supplier_name, document_slug):
        """Stage 4.6 — gated, deterministic, suggestion-first override. Runs only when
        candidate_override != 'off'. Never touches a protected winner, defers to a
        field that already has a note/corrected_to (one note per field)."""
        if self.candidate_override == 'off' or not self._field_candidates:
            return
        auto_fields = self.candidate_override_fields
        field_types = {f.get('key'): (f.get('type') or '') for f in (field_defs or [])}
        s_lower  = (supplier_name or '').lower().strip()
        dt_lower = (document_slug or '').lower().strip()
        n = 0
        for key, incumbent in list(results.items()):
            if key.startswith('_') or not isinstance(incumbent, dict):
                continue
            if incumbent.get('validation_note') or incumbent.get('corrected_to'):
                continue  # Stage 4/4.5 already spoke — one note per field
            if not self._override_eligible(incumbent):
                continue
            cands = self._field_candidates.get(key)
            if not cands:
                continue
            fmt_entry = (self.format_class_index.get((s_lower, dt_lower, key)) if s_lower else None) \
                        or self.format_class_index.get(('', dt_lower, key))
            challenger = self._best_challenger(key, incumbent, cands, fmt_entry, field_types.get(key))
            if not challenger:
                continue
            if self.candidate_override == 'auto' and field_types.get(key) in auto_fields:
                results[key] = {**incumbent,
                                'value':           challenger['value'],
                                'confidence':      challenger.get('confidence') or incumbent.get('confidence') or 0,
                                'overridden':      True,
                                'validation_note': f"auto-selected better-match candidate: {challenger['value']}"}
            else:  # suggest (default when on): never replace the value
                results[key] = {**incumbent,
                                'corrected_to':    challenger['value'],
                                'confidence':      min(incumbent.get('confidence') or 0, 70),
                                'validation_note': f"better-match candidate: {challenger['value']}"}
            n += 1
        if n:
            self.log(f"  Stage 4.6: {n} field(s) had a better-match candidate ({self.candidate_override})")

    # ── Dev-only extraction trace (no-op unless a trace callback is set) ────────
    # Emits structured field-lifecycle events for the hidden Dev Inspector. All
    # helpers short-circuit when self._trace is None, so normal (non-trace)
    # extraction does no extra work and produces no extra output. These never
    # mutate `results` — they only observe it, so merge outcomes are unchanged.
    def _t(self, event: str, **kw):
        if not self._trace:
            return
        ev = {"event": event}
        for k, v in kw.items():
            ev[k] = self._brief(v) if k == "vs" else v
        self._trace(ev)

    @staticmethod
    def _brief(d):
        if not isinstance(d, dict):
            return None
        return {"method": d.get("method"), "value": d.get("value"),
                "confidence": d.get("confidence")}

    def _snap(self, results: dict) -> dict:
        """Shallow per-field snapshot (method/value/confidence) of resolved fields."""
        return {k: self._brief(v) for k, v in results.items()
                if not k.startswith("_") and isinstance(v, dict)}

    def _trace_stage(self, stage: str, stage_results: dict, pre: dict, results: dict):
        """Emit stage_start, a candidate per field the stage proposed, the merge
        decision derived from the OBSERVED post-merge state (win/lose + the value
        it contended with), then stage_end. Pure observation."""
        if not self._trace:
            return
        self._t("stage_start", stage=stage)
        for key, cand in (stage_results or {}).items():
            if key.startswith("_") or not isinstance(cand, dict):
                continue
            self._t("candidate", stage=stage, field=key, method=cand.get("method"),
                    value=cand.get("value"), confidence=cand.get("confidence"))
            after = results.get(key)
            won = bool(after and after.get("value") == cand.get("value")
                       and after.get("method") == cand.get("method"))
            self._t("merge", stage=stage, field=key,
                    decision=("win" if won else "lose"),
                    method=cand.get("method"), value=cand.get("value"),
                    confidence=cand.get("confidence"),
                    vs=(pre.get(key) if won else after))
        self._t("stage_end", stage=stage)

    def _capture_slice(self, field, stage, page, bbox, pil_img, kind="target"):
        """Dev-only: save the exact crop used for an OCR attempt to the session
        temp dir and emit a typed `slice` trace event pointing at it. `kind` is
        'anchor' (the region used to find/verify the anchor) or 'target' (the
        region OCR'd for the field value). No-op unless a trace callback AND a
        slice dir are set. Never raises into extraction."""
        if not (self._trace and self._slice_dir):
            return
        try:
            import os
            self._slice_n += 1
            path = os.path.join(self._slice_dir, f"slice_{self._slice_n}_{kind}.png")
            pil_img.save(path)
            self._t("slice", field=field, stage=stage, kind=kind, page=page,
                    bbox=(list(bbox) if bbox else None), path=path)
        except Exception:
            pass  # diagnostics must never disrupt extraction

    def _trace_validation(self, pre: dict, results: dict):
        """Emit a validation event for any field that Stage 4/4.5 normalised,
        capped, corrected, or annotated."""
        if not self._trace:
            return
        for key, data in results.items():
            if key.startswith("_") or not isinstance(data, dict):
                continue
            b = pre.get(key)
            note      = data.get("validation_note")
            corrected = data.get("corrected_to")
            changed   = bool(b and b.get("value") != data.get("value"))
            capped    = bool(b and (b.get("confidence") or 0) > (data.get("confidence") or 0))
            if note or corrected or changed or capped:
                self._t("validation", field=key, value=data.get("value"),
                        confidence=data.get("confidence"), note=note,
                        corrected_to=corrected, was=(b.get("value") if b else None))

    def set_label_overrides(self, overrides: list):
        """Admin keyword label overrides (per-installation), merged onto the
        shipped patterns at Stage 1, scoped to each document's doc-type slug."""
        self.label_overrides = overrides or []
        if self.label_overrides:
            self.log(f"  Keyword label overrides: {len(self.label_overrides)} loaded")

    def _make_format_lookup(self, supplier_name, document_slug):
        """Per-field learned-format lookup used by the qualification gates: try
        the supplier-scoped entry first, then fall back to the doc-type-scoped one
        ('' supplier) so qualification works even when the supplier is never
        resolved (document-agnostic). Returns None when nothing is learned."""
        if not self.format_class_index or not document_slug:
            return None
        s = (supplier_name or '').lower().strip()
        d = document_slug.lower().strip()
        def lookup(fk):
            return (self.format_class_index.get((s, d, fk)) if s else None) \
                   or self.format_class_index.get(('', d, fk))
        return lookup

    def set_field_rules(self, rules: list):
        """Operator-taught field cleanup rules (Review right-click toolkit). Index
        by (supplier_lower, doctype_lower, field_key) → [rule, …] so the Stage 4.5
        winner loop can strip a learned leaked heading/column from a field value."""
        idx, ml = {}, {}
        for r in (rules or []):
            if not isinstance(r, dict) or not r.get('field_key') or not r.get('rule_type'):
                continue
            key = ((r.get('supplier_name') or '').lower().strip(),
                   (r.get('document_type') or '').lower().strip(),
                   r['field_key'])
            if r['rule_type'] == 'multiline_continue':
                # Continuation rule: trailing chars in token_norm (default -/–/—). Consulted
                # by the anchor READ step (_make_multiline_lookup), NOT the Stage 4.5 apply
                # loop below — joining must happen at the crop, not as a post-trim.
                ml[key] = {'pattern_chars': (r.get('token_norm') or '').strip() or '-–—'}
                continue
            idx.setdefault(key, []).append(r)
        self.field_rules_index = idx
        self._multiline_index  = ml
        if idx:
            self.log(f"  Field cleanup rules: {sum(len(v) for v in idx.values())} loaded")
        if ml:
            self.log(f"  Multi-line continuation rules: {len(ml)} loaded")

    def _make_multiline_lookup(self, supplier_name, document_slug):
        """Per-field multiline_continue lookup for the anchor read step: supplier+doctype →
        doctype-only ('') → '__global__'. Returns None when the feature is off or no rule is
        in scope (→ single-line read, byte-identical)."""
        if not self.multiline_enabled or not self._multiline_index:
            return None
        s = (supplier_name or '').lower().strip()
        d = (document_slug or '').lower().strip()
        idx = self._multiline_index
        def lookup(fk):
            for sk in ([s] if s else []) + ['', '__global__']:
                hit = idx.get((sk, d, fk))
                if hit:
                    return hit
            return None
        return lookup

    def _field_rules_for(self, supplier_name, document_slug, field_key):
        """Rules in scope for a field, most-specific scope first: supplier+doctype,
        then doctype-only ('' supplier), then the '__global__' supplier. Each rule is
        applied in turn; within a scope, remove_text rules run longest-token-first."""
        if not self.field_rules_index:
            return []
        s = (supplier_name or '').lower().strip()
        d = (document_slug or '').lower().strip()
        out = []
        for sk in ([s] if s else []) + ['', '__global__']:
            out.extend(self.field_rules_index.get((sk, d, field_key), []))
        # keep_block first, then remove_text longest-token-first (most specific wins).
        out.sort(key=lambda r: (0 if r.get('rule_type') == 'keep_block' else 1,
                                -len(r.get('token_norm') or '')))
        return out

    @staticmethod
    def _doctype_fixed_supplier(templates, document_slug):
        """The doc type's FIXED Supplier Name, taken from any template for this
        doc-type slug. A doc type whose Supplier Name is an admin-fixed template
        field has a DETERMINISTIC supplier — the page logo is irrelevant — so this
        lets the fixed value survive a MISSED template match and stay immune to the
        logo fallback (which otherwise fills supplier_name with a logo guess when no
        template matched). Prefers an admin-LOCKED value; uses a plain fixed value
        only when every candidate agrees (ambiguous → None, so we never guess).
        Returns {'value', 'method'} or None — None leaves behaviour byte-identical."""
        if not templates or not document_slug:
            return None
        slug = str(document_slug).strip()
        locked, plain = [], []
        for t in templates:
            if (t.get('document_type_slug') or '') != slug:
                continue
            for f in (t.get('fields') or []):
                if f.get('key') != 'supplier_name':
                    continue
                val = f.get('fixed_value')
                val = val.strip() if isinstance(val, str) else val
                if not val:
                    continue
                (locked if f.get('fixed_locked') else plain).append(val)
        for bucket, method in ((locked, 'template_fixed_locked'), (plain, 'template_fixed')):
            uniq = {v for v in bucket if v}
            if len(uniq) == 1:
                return {'value': next(iter(uniq)), 'method': method}
        return None

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
                supplier_name: str | None = None,
                known_template_id: int | None = None,
                trace = None,
                slice_dir = None,
                page_text_lines: list | None = None) -> dict:
        """
        Run extraction pipeline according to current mode.
        Returns dict with field values + metadata keys prefixed with _.

        `trace`: optional dev-only callback (process_docs --trace). When set,
        structured field-lifecycle events are emitted for the Dev Inspector;
        when None, every trace helper is a no-op so behaviour/timing is unchanged.
        """
        self._trace     = trace
        self._slice_dir = slice_dir   # dev-only crop capture dir (set only with --trace)
        self._slice_n   = 0
        self._field_candidates = {}   # Phase 3 ledger (built only when candidate_override on)
        results      = {}
        field_keys   = [f["key"] for f in field_defs]
        # Seed field_patterns from each field's configured TYPE (+ the ref-role
        # coercion) so CUSTOM doc-type fields and the structural REFERENCE role are
        # gated by their real type instead of loose free-text. The keyword config
        # still wins where it carries a richer entry. See _seed_field_patterns.
        field_patterns = _seed_field_patterns(self.patterns.get("field_patterns", {}), field_defs)
        # Date-typed fields get a merge guard: a candidate that doesn't parse as
        # a real date must never displace one that does (e.g. a mis-cropped
        # taught anchor returning a bare "March" overriding a valid full date).
        date_field_keys = {f["key"] for f in field_defs if f.get("type") == "date"}
        # Free-text fields (text / multiline_text / untyped) have legitimately
        # variable shapes — a customer name with or without a site suffix, an
        # address of any length. The Stage 4.5 learned-SHAPE check must never
        # WITHHOLD or TRIM such a value (only softly flag it); otherwise a clean
        # company name is discarded just because recent confirmed history happened
        # to share a longer shape (e.g. customers all "Beaumont Care Homes Ltd -
        # <Site>" learn a rigid shape that NULLs a valid "Beaumont Care Homes Ltd
        # -" with no site). NOTE: a reference field is frequently typed plain
        # "text" too (e.g. reference_number), so exclude _is_ref_field — those ARE
        # structured codes and must keep full shape enforcement. Dates/currency are
        # their own types, already outside this set.
        text_field_keys = {f["key"] for f in field_defs
                           if (f.get("type") or "").lower() in ("text", "multiline_text", "")
                           and not _is_ref_field(f["key"])}
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
            # Reprocess honour: a document already linked to a template (passed
            # as known_template_id) should still run that template's stage 0/0.5
            # — including its admin-drawn field mappings — even when live
            # re-identification is borderline and returns no match (e.g. a
            # logo/keyword score that dipped below threshold for this scan). Only
            # used as a fallback when live matching fails, so it never overrides
            # a positive live match with a stale link.
            if not match and known_template_id is not None:
                known = next((t for t in templates if t.get('id') == known_template_id), None)
                if known:
                    match = {'template': known, 'confidence': 0, 'method': 'known_id'}
                    self.log(f"  Stage 0: live match failed; honouring linked template id={known_template_id}")
            if match:
                matched_tmpl = match['template']
                self.log(
                    f"  Template matched: {matched_tmpl.get('name')} "
                    f"({match['confidence']}% via {match['method']})"
                )
                # A matched template is a STRONG, reliable doc-type signal — far
                # more robust than the keyword type-detection that sets
                # document_slug upstream, which fails when the identifying band is
                # clipped off a scan (the exact cropped-page failure mode). The
                # learned-format / qualification gates key on document_slug, so a
                # missing slug silently DISABLES them — a wrong-row crop then
                # passes and drift relocation never triggers. Adopt the template's
                # doc-type slug when the caller couldn't resolve one, so the gates
                # still engage on a degraded page. Never overrides a slug the
                # caller DID detect; reusable for every template/doc-type.
                if not document_slug and matched_tmpl.get('document_type_slug'):
                    document_slug = matched_tmpl.get('document_type_slug')
                    self.log(f"  Doc-type slug from matched template: {document_slug}")
                tmpl_results = template_matcher.extract_with_template(ocr_text, matched_tmpl)
                _pre_s0 = self._snap(results)
                self._remember_candidates('0_template', tmpl_results)
                for key, data in tmpl_results.items():
                    results[key] = data
                self._trace_stage('0_template', tmpl_results, _pre_s0, results)
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
                # Own enabled mappings win; otherwise borrow from a grouped
                # sibling that has them (validated below by re-running the
                # anchor relocation on this page). See select_mapping_source.
                tmpl_mappings, mapping_src = select_mapping_source(matched_tmpl, templates)
                if tmpl_mappings and page_images:
                    if mapping_src is not matched_tmpl:
                        self.log(f"  Stage 0.5: borrowing {len(tmpl_mappings)} mapping(s) from "
                                 f"grouped sibling '{mapping_src.get('name')}'…")
                    else:
                        self.log(f"  Stage 0.5: {len(tmpl_mappings)} anchor→target mapping(s)…")
                    # Universal failsafe source: the SAME learned-format index
                    # Stage 4.5 uses, keyed the SAME way (supplier+doc-type+field,
                    # lowercased). Passed as a per-field lookup so the mapper can
                    # reject a value whose shape doesn't match what this field has
                    # historically been on this template — no per-field config, no
                    # dependence on the on-page label text. Only constrains fields
                    # that already have a learned format (≥3 confirmed values via
                    # build_format_class_index); everything else passes through.
                    _fmt_lookup = self._make_format_lookup(supplier_name, document_slug)
                    # Landmarks come from the SAME template the mappings did
                    # (mapping_src — its coordinate frame is what the transform
                    # registers this page against). Inert unless that template has
                    # landmarks AND registration is enabled.
                    _landmarks = (mapping_src or matched_tmpl).get("landmarks") or []
                    mapping_results = template_mapper.extract_with_mappings(
                        page_images, tmpl_mappings,
                        field_patterns=field_patterns,
                        validation_patterns=self.patterns.get("validation_patterns", {}),
                        format_lookup=_fmt_lookup,
                        slice_capture=(self._capture_slice if (self._trace and self._slice_dir) else None),
                        template_landmarks=_landmarks,
                        registration_enabled=self.registration_enabled,
                    )
                    applied = 0
                    _pre_s05 = self._snap(results)
                    self._remember_candidates('0.5_mapping', mapping_results)
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
                        # A curated Stage 0.5 mapping outranks the generic Stage 0
                        # seeds it exists to refine — including an admin-LOCKED fixed
                        # value (a drawn zone on a real sample is the more specific
                        # curated source, per the intended precedence).
                        # A garbled FREE-TEXT mapping read no longer rides curated authority:
                        # Stage A caps such a read to its real OCR mean (~70), so a low-confidence
                        # free-text mapping forfeits the is_curated_refinement fast-track and must
                        # instead win on confidence — where it loses to a clean incumbent/anchor, so
                        # a mangled crop can't out-rank the correct value on authority alone.
                        # Threshold 75: a clean free-text mapping caps at >=78 (Stage A base 78
                        # no-label / 90 with-label); only a garbled one (~70) is demoted. Structured
                        # mappings (regex-validated, never capped, not in text_field_keys) are unaffected.
                        _ft_mapping_weak = (key in text_field_keys
                                            and data.get("confidence", 0) < 75)
                        is_curated_refinement = ((not _ft_mapping_weak)
                                                  and (existing is None
                                                  or existing.get("method") in
                                                     ("template_fixed", "template_anchor",
                                                      "template_fixed_locked")))
                        # `existing is not None` guard: a weak free-text mapping with no
                        # incumbent (existing None) has is_curated_refinement False, so the
                        # confidence branch must not deref None — it simply forfeits and the
                        # field is left for Stage 1/2 to fill.
                        if is_curated_refinement or (existing is not None
                                                     and data["confidence"] > existing.get("confidence", 0)):
                            results[key] = data
                            applied += 1
                    self._trace_stage('0.5_mapping', mapping_results, _pre_s05, results)
                    if applied:
                        self.log(f"  Stage 0.5: {applied} field(s) refined via anchor/target mapping")

        # ── Fixed Supplier Name is IMMUNE to the logo fallback ────────────────
        # A doc type whose Supplier Name is an admin-fixed template field has a
        # deterministic supplier, so a logo guess must never fill it. When no
        # template matched (the fixed value was never seeded) but the doc type IS
        # known, apply the doc-type's fixed Supplier Name and SKIP the logo match.
        # Returns None when the doc type has no fixed supplier → logo runs as before.
        if not supplier_name and document_slug:
            fixed_sup = self._doctype_fixed_supplier(templates, document_slug)
            if fixed_sup:
                supplier_name = fixed_sup['value']
                results["supplier_name"] = {
                    "value":      supplier_name,
                    "confidence": 95,
                    "method":     fixed_sup['method'],
                }
                self.log(f"  Fixed Supplier Name for '{document_slug}': "
                         f"{supplier_name} — logo fallback skipped")

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

        # Dev-only: expose the RESOLVED doc identity so a diagnostic log can show
        # why the learned-format / qualification gates did or didn't engage (they
        # key on document_slug; a missing/mismatched slug silently disables them).
        # No-op unless tracing.
        self._t("doc_context",
                supplier_name=supplier_name,
                document_slug=document_slug,
                document_type=document_type,
                template_name=(matched_tmpl.get("name") if matched_tmpl else None),
                template_slug=(matched_tmpl.get("document_type_slug") if matched_tmpl else None),
                format_rules=len(self.format_class_index or {}),
                format_keys=sorted(self.format_class_index.keys())[:12] if self.format_class_index else [])

        # ── Stage 1: Keyword extraction (always runs) ─────────────────────────
        self.log("  Stage 1: keyword extraction…")
        # Merge admin label overrides for THIS doc type onto the shipped patterns
        # (additive; creates an entry for a custom field that has no shipped one,
        # so it becomes keyword-extractable). Returns self.patterns unchanged when
        # there's nothing to merge — no per-run copy in the common case.
        patterns_for_run = keyword.merge_label_overrides(
            self.patterns, self.label_overrides, document_slug)
        kw_results = keyword.extract_fields(ocr_text, field_keys, patterns_for_run)
        # ── INPUT HYGIENE for name-like free-text keyword reads ── a keyword/label
        # capture has NO crop-path cleaning, so OCR edge junk ("--« Beaumont Care
        # Homes Ltd -") enters verbatim and — being the highest-authority source
        # (keyword_override) — WINS, then only gets flagged downstream. Strip the
        # SAME edge artefacts a crop read already drops, AT CAPTURE, so the junk
        # never becomes "the answer" and the trace shows a clean winner. Edges only
        # (interior preserved); structured/ref fields untouched. Stage 4.5 still
        # edge-cleans the final winner as a catch-all (idempotent here). Reusable for
        # every supplier/field. See value_quality.strip_name_edges.
        _kw_charsets = self.patterns.get('field_charsets') or {}
        _kw_types    = {f.get('key'): f.get('type') for f in (field_defs or [])}
        for _kk, _kd in kw_results.items():
            if not isinstance(_kd, dict):
                continue
            _kt = _kw_types.get(_kk)
            if _kt in (None, 'text', 'multiline_text') and value_quality.is_name_like_field(_kk):
                _kv = _kd.get('value')
                if _kv:
                    _kspec = _kw_charsets.get(_kt, _kw_charsets.get('default')) if _kw_charsets else None
                    _kclean = value_quality.strip_name_edges(str(_kv), _kspec)
                    if _kclean and _kclean != _kv:
                        _kd['value'] = _kclean
                        if 'display_value' in _kd:
                            _kd['display_value'] = _kclean
        _pre_s1 = self._snap(results)
        self._remember_candidates('1_keyword', kw_results)
        for key, data in kw_results.items():
            existing = results.get(key)
            # An admin-LOCKED fixed value (method 'template_fixed_locked') is a
            # deliberate, protected override: NO ordinary read — not even the
            # supplier-identity rescue below — may replace it on confidence. It still
            # yields ONLY to an explicit admin label (keyword_override) and to curated
            # Stage 0.5 mappings (which ran first). Narrow: ordinary 'template_fixed'
            # stays overridable.
            if (existing and existing.get("method") == "template_fixed_locked"
                    and data.get("method") != "keyword_override"):
                continue
            if key == "supplier_name" and existing:
                decision = _supplier_identity_decision(existing, data)
                if decision == "keep":
                    continue
                if decision == "take":
                    results[key] = data
                    continue
            # An admin-drawn Stage 0.5 mapping is curated ground truth. A generic
            # keyword hit must not silently DEMOTE it to method "keyword" — doing
            # so also strips its protection from the anchor_crop override in Stage
            # 2 (is_taught_override excludes only template_mapping*), letting a
            # mis-aimed learned anchor then clobber the deliberate mapping. Keep
            # the mapping; curated sources still contend on confidence later.
            if existing and _is_stage05_located(existing.get("method")):
                continue
            if (key in date_field_keys and existing
                    and validator.parse_date(existing.get("value")) is not None
                    and validator.parse_date(data.get("value")) is None):
                continue  # don't let an unparseable date replace a valid one
            # Precedence: an admin label override (Settings → Advanced, method
            # "keyword_override") is a deliberate instruction for where this
            # field's value lives, so a VALID one outranks ANY learned/generic
            # incumbent on AUTHORITY — not on a raw confidence number it could
            # never clear against a frozen 95. (At Stage 1 the realistic incumbents
            # are the Stage 0 template seeds template_fixed/template_anchor, but the
            # guard is written generally so the override also beats any other
            # non-curated method without depending on the seed's exact label.) It
            # still yields to curated Stage 0.5 mappings — those are skipped above
            # via _STAGE05_LOCATED_METHODS, and excluding them here keeps that
            # mapping > label ordering consistent — and to authoritative Stage 2 ⊕
            # anchors (Tier A above overrides it there, now regardless of method).
            is_override_authority = (data.get("method") == "keyword_override"
                                     and existing is not None
                                     and not _is_stage05_located(existing.get("method")))
            if (not existing or is_override_authority
                    or data.get("confidence", 0) > existing.get("confidence", 0)):
                results[key] = data
        self._trace_stage('1_keyword', kw_results, _pre_s1, results)
        found = len([v for v in results.values() if v.get("value")])
        self.log(f"  Stage 1: {found}/{len(field_keys)} fields found")

        # ── Stage 2: Anchor extraction (always runs) ──────────────────────────
        if anchors:
            self.log("  Stage 2: anchor extraction…")
            # "Register, then read" for Stage 2: fit ONE page-0 transform from the
            # matched template's landmarks (anchors only read page 0) and hand it to
            # the anchor stage so a taught value box can be mapped onto a shifted/
            # skewed/scaled page when its own label can't be re-found. Inert (None)
            # unless registration is enabled AND the matched template has landmarks
            # — so a template without landmarks behaves exactly as before. Fitting
            # here (vs inside Stage 0.5) lets the SAME transform serve both stages;
            # for an anchors-only template (no drawn mappings) Stage 0.5 never ran,
            # so this is the only fit.
            anchor_page_transform = None
            if self.registration_enabled and page_images and matched_tmpl:
                _alm = matched_tmpl.get("landmarks") or []
                if not _alm:
                    self.log("  Stage 2: registration inactive — template has no "
                             "landmarks (re-pin the sample to generate them)")
                else:
                    try:
                        anchor_page_transform = template_mapper._fit_page_transform(
                            page_images[0], _alm, template_mapper._ocr_lines)
                    except Exception as e:
                        self.log(f"  Stage 2: landmark fit skipped ({e})", "warn")
                    if anchor_page_transform is not None:
                        self.log(f"  Stage 2: page registered "
                                 f"({anchor_page_transform.n_inliers}/{len(_alm)} landmarks, "
                                 f"residual {anchor_page_transform.residual:.4f})")
                    else:
                        self.log(f"  Stage 2: registration fit failed "
                                 f"({len(_alm)} landmarks, too few/poor matches)")
            # Dev-trace only: record what each crop rung READ and which gate
            # dropped it, so a "field not pulled in" can be diagnosed (the winners-
            # only candidate trace can't show a rejected read). No-op without --trace.
            _on_reject = ((lambda fk, st, v, r: self._t(
                "anchor_reject", field=fk, method=st, value=v, reason=r))
                if self._trace else None)
            anchor_results = anchor.extract_with_anchors(
                ocr_text, anchors, supplier_name, document_slug,
                page_images=page_images,
                field_patterns=field_patterns,
                validation_patterns=self.patterns.get("validation_patterns", {}),
                slice_capture=(self._capture_slice if (self._trace and self._slice_dir) else None),
                format_lookup=self._make_format_lookup(supplier_name, document_slug),
                page_transform=anchor_page_transform,
                on_reject=_on_reject,
                page_text_lines=page_text_lines,
                text_field_keys=text_field_keys,
                multiline_lookup=self._make_multiline_lookup(supplier_name, document_slug),
            )
            _pre_s2 = self._snap(results)
            self._remember_candidates('2_anchor', anchor_results)
            for key, data in anchor_results.items():
                existing = results.get(key)
                # Protect an admin-LOCKED fixed value from any NON-authoritative anchor
                # read (incl. the supplier-identity rescue + credibility-gate paths
                # below). An authoritative ⊕ anchor still wins outright via Tier A.
                if (existing and existing.get("method") == "template_fixed_locked"
                        and not data.get("authoritative")):
                    continue
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
                # ── Stage 2 credibility gate (before any override) ───────────
                # A Stage 2 candidate must not DISPLACE an existing incumbent
                # unless it is credible for the field's class. Reusable, shape/
                # type based — never document- or supplier-specific. Only guards
                # OVERRIDES: an empty field is still filled (and the validator
                # then flags it), so this never suppresses a first read.
                if existing and existing.get("value"):
                    if key in date_field_keys:
                        # Non-date junk (e.g. a mis-cropped "March") must not beat
                        # a date field — the candidate has to parse as a date.
                        if validator.parse_date(data.get("value")) is None:
                            continue
                    elif _is_ref_field(key):
                        cand_v = data.get("value") or ""
                        # Wildly-inconsistent ref (a lone "a", punctuation noise)
                        # must not override a plausible incumbent.
                        if not _ref_override_plausible(cand_v):
                            continue
                        # Digit-shape consistency: a digit-free candidate (e.g. a
                        # label/word like "Booking" read from a drifted crop) must
                        # not displace a digit-bearing incumbent ("7602-1354-4").
                        inc_v = existing.get("value") or ""
                        if any(c.isdigit() for c in inc_v) and not any(c.isdigit() for c in cand_v):
                            continue
                # ── Tier A: authoritative ⊕ anchor wins outright (any method) ──
                # An EXPLICIT authoritative ⊕ anchor that cleared the credibility
                # gate above is the operator's deliberate, current correction for
                # this field — it wins outright over ANY incumbent (Stage 0.5
                # mapping, admin label override, generic template seed, learned),
                # regardless of the resolved method or confidence. Passive anchors
                # (authoritative=False) never reach here. This generalises the old
                # anchor_crop-ONLY is_taught_override below so an authoritative
                # anchor that resolved via inline / relocated / registration still
                # wins (was the bug: a re-teach that read its value off the
                # located line lost a confidence contest to the label it was meant
                # to override). An INVALID authoritative read was already dropped
                # by the credibility gate, so it correctly yields to the next valid
                # lower-priority source.
                # LOCATED gate (anchor.py): a blind RIGID read whose label can't be
                # found on this page (a stale/non-localizable ⊕ anchor reading the
                # wrong row — e.g. anchor_label = the field's own name) is NOT a
                # trustworthy correction, so it does NOT win Tier-A; it falls through
                # to the normal confidence contest (where its capped conf yields to a
                # located mapping). `located` defaults True so a located teach — and
                # any caller/test that builds results without the flag — is unchanged.
                # OCR-QUALITY gate on the outright win: an authoritative crop whose
                # read contains a GARBLED word (min substantial-word confidence low)
                # is not trustworthy enough to win OUTRIGHT over a credible
                # alternative — e.g. a re-teach that read "Aaiumant Care Homes Ltd -
                # Galaorm" (min word conf ~55) should not beat the clean keyword
                # "Beaumont Care Homes Ltd - Galgorm". Such a read FALLS THROUGH to
                # the confidence contest below, where its OCR-capped confidence loses
                # to the clean read. A clean authoritative read (min ≥ threshold, or
                # an inline/text read with no crop conf = None) still wins outright.
                _omin = data.get("ocr_min_conf")
                _ocr_clean = (_omin is None) or (_omin >= _TIER_A_OCR_MIN)
                # COVERAGE gate on the outright win (belt-and-braces with the anchor.py
                # credibility coverage check): an authoritative read of a TYPED field
                # must match MOST of its validation pattern, so a clean-but-wrong value
                # the pattern only matches on a sub-run (a colon-laden MAC, coverage
                # ~0.18) cannot win Tier-A over a full-match mapping — it falls through
                # to the contest where the rx-100% mapping wins. Untyped / date /
                # currency carry no pattern here → no constraint (byte-identical).
                _cov_ok = True
                _vt = (field_patterns.get(key) or {}).get("validation") if field_patterns else None
                if _vt and _vt not in ("date", "currency", "currency_code"):
                    _cpats = (self.patterns.get("validation_patterns") or {}).get(_vt)
                    if _cpats:
                        _cov_ok = anchor._pattern_coverage(data.get("value"), _cpats) >= 0.8
                if data.get("authoritative") and data.get("value") and data.get("located", True) and _ocr_clean and _cov_ok:
                    results[key] = data
                    continue
                # Precedence: a deliberately DRAWN source outranks an AUTO-LEARNED
                # anchor. A hand-drawn Stage 0.5 mapping (_STAGE05_LOCATED_METHODS)
                # and an admin label override (method "keyword_override") are
                # "manually drawn" (tier 1/2); a passively auto-learned anchor is
                # an automatic guess (tier 3), not "manually drawn". Only an
                # EXPLICIT ⊕ re-teach (authoritative) anchor may displace them —
                # without this a stale auto-learned anchor with a high computed
                # confidence (≈97, often mis-keyed to the wrong supplier) silently
                # shadows a freshly drawn mapping / override on every reprocess.
                # Two DELIBERATE sources (a drawn mapping and an authoritative
                # anchor) still contend on confidence below, as before.
                if (existing and not data.get("authoritative")
                        and (existing.get("method") == "keyword_override"
                             or _is_stage05_located(existing.get("method")))):
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
                # OCR gate (same _ocr_clean as Tier-A): a garbled anchor_crop read
                # must not taught-override a clean incumbent either — it falls
                # through to the confidence contest, where its OCR-capped confidence
                # loses. A clean read (or one with no crop conf) keeps the override.
                is_taught_override = (data.get("method") == "anchor_crop"
                                      and data.get("located", True)
                                      and _ocr_clean
                                      and existing
                                      and existing.get("method") != "anchor_crop"
                                      and not _is_stage05_located(existing.get("method")))
                if not existing or is_taught_override or data["confidence"] > existing["confidence"]:
                    results[key] = data
            self._trace_stage('2_anchor', anchor_results, _pre_s2, results)
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
            self._remember_candidates('2.5_hint', hint_results)
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
                    self._t("transform", field=key, stage="2.5_denoise",
                            method=results[key]["method"], confidence=results[key]["confidence"],
                            **{"from": data["value"], "to": denoised})
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
                        self._t("transform", field=key, stage="2.5_correct",
                                method=results[key]["method"], confidence=new_conf,
                                **{"from": data["value"], "to": corrected_val})
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
                self._remember_candidates('3_llm', llm_results)
                for key, data in llm_results.items():
                    if data.get("value") and not results.get(key, {}).get("value"):
                        results[key] = data
                final = len([v for v in results.values() if v.get("value")])
                self.log(f"  Stage 3: +{final - found} fields from AI")
        else:
            self.log(f"  Stage 3: skipped ({self.mode.capitalize()} Mode)")

        # ── Stage 4: Validation ───────────────────────────────────────────────
        self.log("  Stage 4: validating…")
        self._t('stage_start', stage='4_validate')
        _pre_val = self._snap(results)
        results = validator.validate_and_adjust(results, field_defs)

        # ── Field cleanup rules (operator-taught, Review right-click toolkit) ──
        # Strip a learned leaked heading/column from a field's WINNER value
        # (keep_block keeps the single pattern/code-shaped token; remove_text removes
        # a learned caption). Runs HERE — independent of learned format history — so it
        # applies even to fields with no confirmed shape. Honest: rewrites value/
        # display_value with was_corrected + corrected_to + an "auto-trimmed, was: …"
        # note; NOT review-forced (the match guards make it deterministic). No-op when
        # no rule is in scope or every guard refuses → byte-identical.
        if self.field_rules_index and document_slug:
            from extraction import field_rules as _field_rules
            _val_pats = self.patterns.get("validation_patterns") or {}
            for key, data in list(results.items()):
                if key.startswith('_') or not isinstance(data, dict):
                    continue
                val = data.get('value')
                if not isinstance(val, str) or not val:
                    continue
                rules = self._field_rules_for(supplier_name, document_slug, key)
                if not rules:
                    continue
                original = val
                cur = val
                for r in rules:
                    rt = r.get('rule_type')
                    if rt == 'keep_block':
                        _vt = (field_patterns.get(key) or {}).get("validation")
                        _pl = _val_pats.get(_vt) or []
                        if isinstance(_pl, str):
                            _pl = [_pl]
                        pat = ("(?:" + ")|(?:".join(_pl) + ")") if _pl else None
                        cur, _ = _field_rules.apply_keep_block(cur, pat)
                    elif rt == 'remove_text':
                        cur, _ = _field_rules.apply_remove_text(
                            cur, r.get('token_norm') or '',
                            side=r.get('side') or 'trailing',
                            min_prefix=r.get('min_prefix') or 3)
                if cur != original:
                    results[key] = {**data, 'value': cur, 'display_value': cur,
                                    'was_corrected': True, 'corrected_to': cur,
                                    'validation_note': f'auto-trimmed, was: "{original}"'}

        # ── Stage 4.5: Format anomaly check ──────────────────────────────────
        # Compares each extracted value against the coarse format class learned
        # from confirmed historical values for the same
        # (supplier_name, document_type, field_key) group.  On anomaly: caps
        # confidence at 45 and adds a traceable validation_note.  Fields
        # already flagged by Stage 4 are skipped to avoid double-penalisation.
        # No correction is proposed here — that is Stage 2 of this feature.
        format_anomaly_flagged = False
        # The wordness gate must run COLD (no learned history) — that is where free-text
        # name silent-errors are worst — so enter this block when name_wordness is on even
        # if the format index is empty. When name_wordness is OFF this is byte-identical to
        # the original `format_class_index and document_slug` guard.
        if document_slug and (self.format_class_index or self.name_wordness):
            s_lower  = (supplier_name or '').lower().strip()
            dt_lower = document_slug.lower().strip()
            n_flagged = 0
            field_charsets = self.patterns.get('field_charsets') or {}
            field_types    = {f.get('key'): f.get('type') for f in (field_defs or [])}
            validation_patterns = self.patterns.get('validation_patterns') or {}
            for key, data in list(results.items()):
                if key.startswith('_') or not isinstance(data, dict):
                    continue
                if data.get('validation_note'):
                    continue  # Stage 4 already flagged this field
                val = data.get('value')
                if not val:
                    continue
                # ── EDGE-JUNK CLEANUP (name-like free-text) ── a real name never
                # STARTS with "--«" / a stray symbol; strip OCR edge artefacts BEFORE
                # the charset/format checks below so a cleaned value isn't needlessly
                # flagged, and so a keyword read (which skips the crop-path cleaning)
                # gets the same edge hygiene a crop read already has. EDGES ONLY —
                # the interior is untouched (free-text variation preserved). The value
                # change is visible in the trace; no review is forced (the charset
                # check then runs on the CLEANED value). See value_quality.strip_name_edges.
                _ftype0 = field_types.get(key)
                if _ftype0 in (None, 'text', 'multiline_text') and value_quality.is_name_like_field(key):
                    _spec0 = (field_charsets.get(_ftype0, field_charsets.get('default')) if field_charsets else None)
                    _clean = value_quality.strip_name_edges(str(val), _spec0)
                    if _clean and _clean != val:
                        data = {**data, 'value': _clean, 'display_value': _clean}
                        results[key] = data
                        val = _clean
                # ── Type-authority gate ── a value that FULLY matches its field's PRECISE
                # validation pattern (mac/ip) is type-authoritative, and a label/landmark-
                # CONFIRMED read (relocated/inline/registration / Stage 0.5 mapping) already
                # cleared the anchor-stage credibility + column-bleed guards. Either way the
                # generic charset + learned-SHAPE heuristics below must not second-guess it:
                # a MAC's ':' isn't "unexpected", a new IP/serial just differs in shape from
                # history. The generic 'alphanumeric' is NOT precise, so an UN-anchored drift
                # (a rigid "Bookinc" via keyword/anchor_crop) still gets shape-gated.
                _val_key = (field_patterns.get(key) or {}).get('validation')
                _authoritative = bool(
                    _val_key in anchor._PRECISE_VAL_TYPES
                    and validation_patterns.get(_val_key)
                    and anchor._pattern_coverage(str(val), validation_patterns[_val_key])
                        >= anchor._PATTERN_AUTHORITATIVE_MIN)
                _method = data.get('method') or ''
                _label_confirmed = (_method in anchor._LABEL_CONFIRMED_METHODS
                                    or _is_stage05_located(_method))
                # ── Valid-character policy (Phase 1, backend-only FLAG) ── before the
                # format lookup so it covers EVERY field, not only those with learned
                # formats. Surfaces unexpected OCR symbols for the field TYPE (note +
                # conf cap); NEVER strips the value. Skips date/currency (their own
                # normalisers own punctuation); defers to any existing note via the
                # guard above. See format_anomaly_checker.charset_disallowed +
                # config field_charsets.
                if field_charsets and not _authoritative:
                    _ftype = field_types.get(key)
                    if _ftype not in ('date', 'currency', 'currency_code'):
                        _spec = field_charsets.get(_ftype, field_charsets.get('default'))
                        _bad = format_anomaly_checker.charset_disallowed(str(val), _spec)
                        if _bad:
                            results[key] = {
                                **data,
                                'confidence':      min(data.get('confidence') or 0, 70),
                                'validation_note': "unexpected characters (" + " ".join(_bad) + ") - please verify",
                            }
                            n_flagged += 1
                            format_anomaly_flagged = True
                            continue
                # ── Wordness gate (default OFF) ── before the format lookup so it works
                # COLD (no learned history), where free-text name silent-errors are worst.
                # FLAG-ONLY: a free-text NAME read that doesn't read like a name (document
                # chrome / ref-code bleed / OCR garble) gets a note + conf cap; the value
                # is never changed. Gated on is_name_like_field; self-calibrates per field
                # via the learned word_like flag when history exists (code-like field =>
                # skip). See extraction/wordness.py + reggie's review.
                if self.name_wordness and not _authoritative and key in text_field_keys \
                        and value_quality.is_name_like_field(key):
                    _fe = (self.format_class_index.get((s_lower, dt_lower, key)) if s_lower else None) \
                          or self.format_class_index.get(('', dt_lower, key))
                    _word_like = True if not _fe else _fe.get('word_like', True)
                    _wnote = wordness.name_structure_flag(str(val), word_like=_word_like)
                    if _wnote:
                        results[key] = {
                            **data,
                            'confidence':      min(data.get('confidence') or 0, 70),
                            'validation_note': _wnote,
                        }
                        n_flagged += 1
                        format_anomaly_flagged = True
                        continue
                # Supplier-scoped format first; fall back to the doc-type-scoped
                # one ('' supplier) so qualification works even when the supplier
                # is never identified (document-agnostic learning).
                fmt_entry = (self.format_class_index.get((s_lower, dt_lower, key)) if s_lower else None) \
                            or self.format_class_index.get(('', dt_lower, key))
                if not fmt_entry:
                    continue
                # ── Canonical token repair for NAME-LIKE fields ── runs INDEPENDENT of
                # the anomaly verdict: a garbled company name is coarse-class FREETEXT
                # and may not trip check_value at all, so gating it behind `anomaly`
                # would make it dead code. Repairs garbled KNOWN tokens to their learned
                # canonical spelling and keeps the variable tail verbatim (never
                # whole-value snap, never injects a learned token). See name_match.py.
                # TWO TIERS by evidence:
                #   STRONG (every changed token at a NEAR-UNIVERSAL position, doc_freq
                #     >= 0.9, >= 3 docs) — a confident misread fix backed by overwhelming
                #     history ("Beaumont Care Homes Lid" -> "...Ltd"). AUTO-APPLY the
                #     value (the operator wants the misread FIXED, not just suggested);
                #     kept visible via was_corrected + a note, and NOT review-forced
                #     (no format_anomaly_flagged) so a confident fix doesn't nag.
                #   WEAK — emitted as a corrected_to SUGGESTION only (value untouched,
                #     conf capped, review-forced), exactly as before.
                name_lex = fmt_entry.get('name_lexicon')
                if name_lex and key in text_field_keys:
                    from extraction import name_match
                    repaired, strong = name_match.repair_name_value(str(val), name_lex, details=True)
                    if repaired and repaired != str(val):
                        if strong:
                            results[key] = {
                                **data,
                                'value':           repaired,
                                'display_value':   repaired,
                                'was_corrected':   True,
                                'corrected_to':    repaired,
                                # Note carries the ORIGINAL read so the UI can show what
                                # was auto-fixed (the input already holds the correction).
                                'validation_note': f"Auto-corrected to match learned data (was: {val})",
                            }
                        else:
                            results[key] = {
                                **data,
                                'confidence':      min(data.get('confidence') or 0, 70),
                                'corrected_to':    repaired,
                                'validation_note': f"Suggested name correction: {repaired}",
                            }
                            n_flagged += 1
                            format_anomaly_flagged = True
                        continue   # one repair/suggestion per field — skip the anomaly path
                    # ── Truncation / fragment flag (reggie follow-up) ── the dominant
                    # name silent-error class character wordness CANNOT catch (a fragment
                    # is a real word): a value SHORTER than the history length ("...Ltd -"
                    # with the site cut) OR a final-token fragment ("...Ltd - B"). Run
                    # BEFORE conforms_to_lexicon: a final-token fragment still CONFORMS
                    # (stable prefix matches, count reaches expected_len), so conforms would
                    # otherwise suppress it. History-gated (name_lex present) => inert
                    # without confirmed history; under the name_wordness opt-in; flag-only.
                    if self.name_wordness and name_match.is_truncated_name(str(val), name_lex):
                        results[key] = {
                            **data,
                            'confidence':      min(data.get('confidence') or 0, 70),
                            'validation_note': 'looks shorter than the usual name — please verify',
                        }
                        n_flagged += 1
                        format_anomaly_flagged = True
                        continue
                    # No repair / truncation. If the value CONFORMS to the learned name
                    # pattern (every stable PREFIX token matches; only the variable
                    # TAIL differs), the name_lexicon — a more precise model than the
                    # coarse learned SHAPE — says this is the EXPECTED pattern. Suppress
                    # the shape "format differs" flag: a customer "Beaumont Care Homes
                    # Ltd - <new site>" is normal, not an anomaly, even when the new
                    # site's length was never confirmed before.
                    if name_match.conforms_to_lexicon(str(val), name_lex):
                        continue
                anomaly = format_anomaly_checker.check_value(str(val), fmt_entry)
                if anomaly:
                    # Type-authoritative (precise mac/ip pattern) or label/landmark-
                    # confirmed read — accept clean, no shape flag (see the type-authority
                    # gate above): the value matches the field's nature / was read beside
                    # its located label, so a learned digit-position SHAPE mismatch is not
                    # an anomaly. The UN-anchored rigid/keyword path still falls through.
                    if _authoritative or _label_confirmed:
                        continue
                    # Free-text field (name/address): a learned shape must never
                    # withhold or trim a valid value here — its shape varies
                    # legitimately. Keep the value, flag softly for a human to
                    # eyeball. This is what stops a clean company name being
                    # discarded by a longer historical shape. Structured/code
                    # fields fall through to the full shape enforcement below.
                    if key in text_field_keys:
                        # CLEAN-NAME RELAX: a well-formed name (good name-quality; charset
                        # already clean by here) whose field has NO learned stable-prefix
                        # identity — the confirmed names don't share a common prefix because
                        # the field holds DIFFERENT customers/companies — is NOT flagged
                        # merely for a length/word-count difference: a new customer
                        # ("McMahon Associates") is normal, not an anomaly. When the field
                        # DOES carry a stable prefix (single-identity history), a non-
                        # conforming value is a genuine anomaly (a TRUNCATED "Beaumont Care
                        # Homes Ltd -" or a WRONG prefix "Totally Different Co -") and still
                        # flags — conforms_to_lexicon already suppressed a legitimate new
                        # tail above. A GARBLED name (quality < 0.5) always flags.
                        _has_stable_prefix = bool(name_lex and name_lex.get('positions'))
                        if not _has_stable_prefix \
                                and value_quality.is_name_like_field(key) \
                                and value_quality.name_quality(str(val)) >= 0.5:
                            continue
                        results[key] = {
                            **data,
                            'confidence':      min(data.get('confidence') or 0, 70),
                            'validation_note': 'format differs from the usual — please verify',
                        }
                        n_flagged += 1
                        format_anomaly_flagged = True
                        continue
                    # First, recover a CLEAN value by extracting a substring that
                    # matches a learned accepted SHAPE — this strips column-bleed
                    # junk ("2605-0769-1 Work Address Beaumont…") down to the real
                    # value ("2605-0769-1"). Universal: driven by the field's own
                    # learned shapes, never a per-field pattern.
                    extracted = format_anomaly_checker.extract_accepted_shape(str(val), fmt_entry)
                    if extracted and extracted != str(val):
                        results[key] = {
                            **data,
                            'value':           extracted,
                            'validation_note': 'trimmed to the expected format — please verify',
                        }
                        n_flagged += 1
                        format_anomaly_flagged = True
                        continue
                    # Stage 2 — conservative digits-only cleanup. If the learned
                    # class is digits_only, try to repair the value. A confident
                    # repair (only known OCR confusables / separators changed) is
                    # auto-applied as the effective value with an explanatory
                    # note; an uncertain one is surfaced as a review-forced
                    # CANDIDATE (display value untouched).
                    correction = format_anomaly_checker.propose_correction(str(val), fmt_entry)
                    if correction and correction['confident']:
                        results[key] = {
                            **data,
                            'value':           correction['corrected'],
                            'validation_note': correction['note'],
                        }
                    elif correction:
                        results[key] = {
                            **data,
                            'confidence':      min(data.get('confidence') or 0, 45),
                            'corrected_to':    correction['corrected'],
                            'validation_note': correction['note'],
                        }
                    elif anomaly.get('severity') == 'high' or fmt_entry.get('shapes'):
                        # Very wrong for this field — either a hard class violation
                        # (letters where it's always digits/dates) OR the field has
                        # a learned SHAPE that this value, and any substring of it,
                        # doesn't satisfy (e.g. garbage "AyeARr AGAR a" where the
                        # reference is shaped "####-####-#"). Withhold it and ask
                        # for manual entry rather than populate an inconsistent
                        # value. A genuinely new-but-correct shape is accepted once
                        # it has been confirmed enough times (count-gated shapes).
                        results[key] = {
                            **data,
                            'value':           None,
                            'confidence':      0,
                            'validation_note': "doesn't match the expected format — please enter manually",
                        }
                    else:
                        # In-class difference with no learned shape to enforce —
                        # keep it but flag for a human to verify.
                        results[key] = {
                            **data,
                            'confidence':      min(data.get('confidence') or 0, 45),
                            'validation_note': 'format differs from the usual — please verify',
                        }
                    n_flagged += 1
                    format_anomaly_flagged = True
            if n_flagged:
                self.log(f"  Stage 4.5: {n_flagged} field(s) flagged by format anomaly check")

        self._trace_validation(_pre_val, results)
        self._t('stage_end', stage='4_validate')

        # ── Stage 4.6: gated candidate override (default OFF → no-op) ───────────
        # After Stage 4.5, before metadata, so overall_confidence/needs_review reflect
        # any change. Suggestion-first; never touches a protected winner. No-op unless
        # candidate_override is enabled (then the ledger built during merge is read).
        self._resolve_candidates(results, field_defs, supplier_name, document_slug)

        # ── Metadata ──────────────────────────────────────────────────────────
        overall_conf  = validator.overall_confidence(results, field_defs)
        # Document-level format-consistency weighting: penalise the document when
        # any field failed its expected format, and reward it when several well-
        # supported fields all match. "Supported" = fields with a learned format
        # for this supplier/type (the same index Stage 4.5 checks against), so a
        # clean-but-unverified or sparse document is never over-rewarded. Only the
        # displayed document score moves — per-field notes and needs_review are
        # untouched.
        supported_keys = set()
        if self.format_class_index and supplier_name and document_slug:
            sl = supplier_name.lower().strip()
            dl = document_slug.lower().strip()
            supported_keys = {k for (s, d, k) in self.format_class_index if s == sl and d == dl}
        fc_delta = validator.format_consistency_delta(results, field_defs, supported_keys)
        if fc_delta:
            overall_conf = max(0, min(100, overall_conf + fc_delta))
            self.log(f"  Format consistency: document confidence {'+' if fc_delta > 0 else ''}{fc_delta}")
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
        # The matched template carries the document type its layout was confirmed
        # under — the only signal that assigns CUSTOM doc types (which have no
        # document_type_keywords to keyword-detect). process_docs.py prefers it.
        results["_document_type_slug"]   = matched_tmpl.get("document_type_slug") if matched_tmpl else None
        results["_logo_phash"]           = logo_phash
        results["_keyword_fingerprint"]  = kw_fingerprint

        # Final resolved value per field — the inspector marks any earlier
        # candidate whose value differs from this as a superseded intermediate.
        if self._trace:
            for key, data in results.items():
                if key.startswith("_") or not isinstance(data, dict):
                    continue
                self._t("final", field=key, value=data.get("value"),
                        method=data.get("method"), confidence=data.get("confidence"),
                        note=data.get("validation_note"))

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

        # Evidence-based variability: a field with >=2 DISTINCT confirmed values for
        # this supplier+type is variable IN FACT (e.g. a per-document customer name),
        # even when the schema doesn't flag it is_variable (free-text fields never are).
        # Replaying the most-frequent value onto a new document is exactly how one doc's
        # customer gets stamped onto another's. Count distinct values within the SAME
        # scope a hint would apply in, and skip those fields — the field falls to review
        # (empty) instead of being guessed. Mirrors the evidence-based freeze guard in
        # review/handler.js _buildTemplateFields.
        distinct_vals: dict[str, set] = {}
        for h in hints:
            hk = h.get("field_key")
            hv = (h.get("hint_value") or "").strip().lower()
            if not hk or not hv:
                continue
            hs = (h.get("supplier_name") or "").lower().strip()
            ht = h.get("document_type") or ""
            if hs == s_lower and ((not ht) or ht == (document_slug or "")):
                distinct_vals.setdefault(hk, set()).add(hv)

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
            if len(distinct_vals.get(h_key, ())) >= 2:
                continue   # variable BY EVIDENCE — multiple confirmed values; never replay one

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
