#!/usr/bin/env python3
"""
process_docs.py
---------------
Thin entry point called by Electron. Orchestrates the extraction pipeline
for a folder of documents. Streams JSON progress to stdout.

All heavy lifting is in the extraction/ modules.
"""

import sys
import os
import json
import shutil
import argparse
from pathlib import Path
from datetime import datetime

# Ensure local modules are importable
sys.path.insert(0, str(Path(__file__).parent))

from ocr.tesseract import configure as configure_tesseract
from ocr.tesseract import extract_text_and_images, SUPPORTED_EXTENSIONS
from extraction.engine import ExtractionEngine


# ── Helpers ───────────────────────────────────────────────────────────────────

def emit(obj: dict):
    print(json.dumps(obj), flush=True)

def log(text: str, level: str = ""):
    emit({"type": "log", "text": text, "level": level})

def sanitise_extractions(extractions: dict) -> dict:
    """
    Ensure every field value is a proper dict with value/confidence/method.
    Filters out _ prefixed metadata keys and handles plain string/None values.
    """
    clean = {}
    for key, data in extractions.items():
        if key.startswith('_'):
            continue  # skip metadata keys
        if isinstance(data, dict):
            clean[key] = data
        elif data is not None:
            clean[key] = {"value": str(data), "confidence": 50, "method": "unknown"}
        else:
            clean[key] = {"value": None, "confidence": 0, "method": "unknown"}
    return clean

def load_json_arg(inline: str | None, filepath: str | None) -> list | dict | None:
    """Load JSON from a file path or inline string."""
    if filepath and os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    if inline:
        return json.loads(inline)
    return None


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder",          required=True)
    parser.add_argument("--tesseract",       default=None)
    parser.add_argument("--mode",            default="smart",
                        choices=["fast","smart","ai"])
    parser.add_argument("--config-file",     default=None)
    parser.add_argument("--fields-file",     default=None)
    parser.add_argument("--hints-file",      default=None)
    parser.add_argument("--anchors-file",    default=None)
    parser.add_argument("--logos-file",      default=None)
    parser.add_argument("--doc-types-file",  default=None)
    parser.add_argument("--formats-file",    default=None)
    parser.add_argument("--templates-file", default=None)
    parser.add_argument("--supplier-types-file", default=None)
    parser.add_argument("--enhance-file",   default=None)
    # Reprocess only: the template this document is already linked to, honoured
    # as a Stage 0 fallback when live re-identification fails (see engine.extract).
    parser.add_argument("--known-template-id", type=int, default=None)
    # Inline fallbacks (for small payloads)
    parser.add_argument("--fields",          default=None)
    parser.add_argument("--hints",           default=None)
    parser.add_argument("--anchors",         default=None)
    parser.add_argument("--logos",           default=None)
    args = parser.parse_args()

    # Configure Tesseract
    configure_tesseract(args.tesseract)

    # Load training data (once, before the file loop)
    fields    = load_json_arg(args.fields,  args.fields_file)   or []
    hints     = load_json_arg(args.hints,   args.hints_file)    or []
    anchors   = load_json_arg(args.anchors, args.anchors_file)  or []
    logos     = load_json_arg(args.logos,   args.logos_file)    or []
    doc_types = load_json_arg(None,         args.doc_types_file)  or []
    formats        = load_json_arg(None, args.formats_file)   or []
    templates      = load_json_arg(None, args.templates_file) or []
    supplier_types = load_json_arg(None, args.supplier_types_file) or []
    enhance_params = load_json_arg(None, args.enhance_file)   or None

    emit({
        "type": "log",
        "text": f"[Learning] {len(hints)} hints, {len(anchors)} anchors,"
                f" {len(logos)} logos, {len(templates)} templates,"
                f" {len(formats)} format templates loaded"
    })

    # Initialise extraction engine
    engine = ExtractionEngine(
        mode        = args.mode,
        config_path = args.config_file,
        emit_fn     = emit,
    )

    # Load learned format templates for OCR correction
    if formats:
        engine.set_formats(formats)

    # Find all supported files
    folder = Path(args.folder)
    files  = sorted([
        f for f in folder.iterdir()
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS
    ])

    emit({"type": "start", "total": len(files)})
    processed_at = datetime.now().isoformat(timespec="seconds")

    for filepath in files:
        emit({"type": "file_begin", "filename": filepath.name})

        try:
            # OCR
            log(f"  OCR: {filepath.name}")
            ocr_text, page_images = extract_text_and_images(filepath, enhance_params)

            if not ocr_text.strip():
                raise ValueError("OCR returned no text — is the scan readable?")

            # Detect document type
            known_type_names = [dt["name"] for dt in doc_types] if doc_types else None
            type_detection = engine.detect_document_type(ocr_text, known_type_names)
            document_type  = type_detection["type"] if type_detection else None
            type_conf      = type_detection["confidence"] if type_detection else 0

            if document_type:
                log(f"  Document type: {document_type} ({type_conf}%)")

            # Get fields for this document type
            active_fields = fields
            if document_type and doc_types:
                for dt in doc_types:
                    if dt["name"] == document_type and dt.get("fields"):
                        active_fields = dt["fields"]
                        break

            # Run extraction pipeline
            # Get doc type slug for smart mode decisions
            doc_slug = None
            if document_type and doc_types:
                for dt in doc_types:
                    if dt["name"] == document_type:
                        doc_slug = dt.get("slug")
                        break

            raw_extractions = engine.extract(
                ocr_text      = ocr_text,
                page_images   = page_images,
                filename      = filepath.name,
                field_defs    = active_fields,
                hints         = hints,
                anchors       = anchors,
                logos         = logos,
                templates     = templates,
                document_type = document_type,
                document_slug = doc_slug,
                supplier_name = None,
                known_template_id = args.known_template_id,
                supplier_types = supplier_types,
            )

            # Pull out metadata keys before sanitising
            supplier_name    = raw_extractions.pop("_supplier_name", None)
            doc_type_result  = raw_extractions.pop("_document_type", document_type)
            # A matched template's document type wins over keyword detection: it's
            # a confirmed, learned layout identity, and it's the ONLY way a custom
            # doc type (no document_type_keywords) gets assigned to recurring docs.
            # Resolve the template's slug back to the type name the rest of the
            # pipeline / handler expects. Falls through to the keyword result when
            # no template matched or its slug isn't a known type.
            tmpl_type_slug   = raw_extractions.pop("_document_type_slug", None)
            if tmpl_type_slug and doc_types:
                for dt in doc_types:
                    if dt.get("slug") == tmpl_type_slug:
                        doc_type_result = dt["name"]
                        break
            overall_conf     = raw_extractions.pop("_overall_confidence", 0)
            review_needed    = raw_extractions.pop("_needs_review", True)
            template_id      = raw_extractions.pop("_template_id", None)
            logo_phash       = raw_extractions.pop("_logo_phash", None)
            kw_fingerprint   = raw_extractions.pop("_keyword_fingerprint", [])
            raw_extractions.pop("_mode_used", None)
            raw_extractions.pop("_document_slug", None)

            # Sanitise — ensure all values are proper dicts
            extractions = sanitise_extractions(raw_extractions)

            # Emit per-field extraction detail so the log shows what was found vs missed
            for field_key, data in extractions.items():
                val    = data.get("value")
                conf   = data.get("confidence", 0)
                method = data.get("method", "?")
                if val:
                    log(f"  FOUND   {field_key}: {repr(val)} ({conf}% via {method})")
                else:
                    log(f"  MISSED  {field_key}  (method tried: {method})")

            # Always send to review queue — user confirms each document
            status = "needs_review"

            # Main-window preview keys: resolve Reference/Date from the matched
            # document type's OWN ref/date field keys first, so custom types
            # (e.g. Job Worksheet → job_no/date) preview immediately in the list,
            # then fall back to the built-in invoice/SO/PO keys. Generalises to
            # any current or future custom type — no per-type special-casing.
            ref_keys  = ["invoice_number", "sales_order_number", "po_number"]
            date_keys = ["invoice_date", "order_date", "po_date"]
            if doc_type_result and doc_types:
                for dt in doc_types:
                    if dt.get("name") == doc_type_result:
                        if dt.get("ref_field_key"):
                            ref_keys  = [dt["ref_field_key"]]  + ref_keys
                        if dt.get("date_field_key"):
                            date_keys = [dt["date_field_key"]] + date_keys
                        break

            emit({
                "type":               "file_done",
                "success":            True,
                "status":             status,
                "original_filename":  filepath.name,
                "overall_confidence": overall_conf,
                "needs_review":       review_needed,
                "document_type":      doc_type_result,
                "type_confidence":    type_conf,
                "supplier_name":      supplier_name,
                "template_id":        template_id,
                "logo_phash":         logo_phash,
                "keyword_fingerprint": kw_fingerprint,
                "mode_used":          "fast",
                "ocr_text":           ocr_text[:50000],
                "extractions":        {
                    k: {
                        "value":      v.get("value"),
                        "confidence": v.get("confidence", 0),
                        "method":     v.get("method", "unknown"),
                        **({"validation_note": v["validation_note"]}
                           if v.get("validation_note") else {}),
                        **({"corrected_to": v["corrected_to"]}
                           if v.get("corrected_to") else {}),
                    }
                    for k, v in extractions.items()
                },
                # Convenience fields for main window table
                "invoice_number": _get_val(extractions, ref_keys),
                "invoice_date":   _get_val(extractions, date_keys),
                "total_amount":  _get_val(extractions, ["total_amount"]),
                "currency":      _get_val(extractions, ["currency"]),
            })

        except Exception as exc:
            emit({
                "type":              "file_done",
                "success":           False,
                "status":            "error",
                "original_filename": filepath.name,
                "error":             str(exc),
            })


def _get_val(extractions: dict, keys: list[str]) -> str | None:
    for k in keys:
        v = extractions.get(k, {}).get("value")
        if v:
            return v
    return None


if __name__ == "__main__":
    main()
