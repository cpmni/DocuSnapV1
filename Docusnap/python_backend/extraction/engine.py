"""
extraction/engine.py
--------------------
Orchestrates the extraction pipeline across three modes:

  FAST  — keyword + anchor only. No LLM. Sub-second per document.
           Used when supplier is well-trained (10+ confirmed docs).

  SMART — keyword + anchor first. LLM only if required fields are
           missing or low confidence. Default mode.

  AI    — LLM always runs after keyword + anchor, regardless of
           confidence. Slowest, most thorough for unknown documents.

Usage:
  engine = ExtractionEngine(mode='smart', ...)
  result = engine.extract(...)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extraction import keyword, anchor, validator

# LLM import is optional — system works without it in FAST mode
try:
    from extraction import llm as llm_module
    LLM_AVAILABLE = True
except ImportError:
    LLM_AVAILABLE = False


# ── Required fields that must be found to skip LLM in SMART mode ─────────────
SMART_MODE_REQUIRED = {
    "invoice":        ["invoice_number", "invoice_date", "total_amount"],
    "sales_order":    ["sales_order_number", "order_date"],
    "purchase_order": ["po_number", "po_date"],
    "_default":       ["invoice_date", "total_amount"],
}

SMART_MODE_MIN_CONFIDENCE = 70
FAST_MODE_SUGGESTION_THRESHOLD = 10  # confirmed docs before suggesting Fast Mode


class ExtractionEngine:

    def __init__(self,
                 mode:         str = "smart",   # fast | smart | ai
                 config_path:  str | None = None,
                 ollama_url:   str = "http://127.0.0.1:11434/api/generate",
                 model:        str = "phi3:mini",
                 emit_fn            = None):

        self.mode       = mode.lower()
        self.patterns   = keyword.load_patterns(config_path)
        self.ollama_url = ollama_url
        self.model      = model
        self.emit       = emit_fn or (lambda msg: None)

    def log(self, text: str, level: str = ""):
        self.emit({"type": "log", "text": text, "level": level})

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
                document_type: str | None = None,
                document_slug: str | None = None,
                supplier_name: str | None = None) -> dict:
        """
        Run extraction pipeline according to current mode.
        Returns dict with field values + metadata keys prefixed with _.
        """
        results     = {}
        field_keys  = [f["key"] for f in field_defs]

        # ── Pre-stage: logo supplier identification ───────────────────────────
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
        results.update(kw_results)
        found = len([v for v in results.values() if v.get("value")])
        self.log(f"  Stage 1: {found}/{len(field_keys)} fields found")

        # ── Stage 2: Anchor extraction (always runs) ──────────────────────────
        if anchors:
            self.log("  Stage 2: anchor extraction…")
            anchor_results = anchor.extract_with_anchors(
                ocr_text, anchors, supplier_name, document_slug
            )
            for key, data in anchor_results.items():
                existing = results.get(key)
                if not existing or data["confidence"] > existing["confidence"]:
                    results[key] = data
            new_found = len([v for v in results.values() if v.get("value")])
            self.log(f"  Stage 2: +{new_found - found} fields from anchors")
            found = new_found

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
            if self.mode == "fast":
                self.log("  Stage 3: skipped (Fast Mode)")
            else:
                self.log("  Stage 3: skipped (sufficient confidence from keyword/anchor)")

        # ── Stage 4: Validation ───────────────────────────────────────────────
        self.log("  Stage 4: validating…")
        results = validator.validate_and_adjust(results, field_defs)

        # ── Metadata ──────────────────────────────────────────────────────────
        overall_conf  = validator.overall_confidence(results)
        review_needed = validator.needs_review(results, field_defs)

        results["_supplier_name"]      = supplier_name
        results["_document_type"]      = document_type
        results["_document_slug"]      = document_slug
        results["_overall_confidence"] = overall_conf
        results["_needs_review"]       = review_needed
        results["_mode_used"]          = self.mode

        return results

    def _should_use_llm(self, current_results: dict,
                        document_slug: str | None) -> bool:
        """Decide whether to call the LLM based on current mode and coverage."""

        if self.mode == "fast":
            return False

        if self.mode == "ai":
            return LLM_AVAILABLE and self.mode != "fast"

        # SMART mode — only call LLM if required fields are missing/low confidence
        slug     = document_slug or "_default"
        required = SMART_MODE_REQUIRED.get(slug, SMART_MODE_REQUIRED["_default"])

        for field_key in required:
            data = current_results.get(field_key, {})
            if not data.get("value"):
                return True  # missing required field — need LLM
            if (data.get("confidence") or 0) < SMART_MODE_MIN_CONFIDENCE:
                return True  # low confidence — need LLM

        return False  # all required fields found with good confidence
