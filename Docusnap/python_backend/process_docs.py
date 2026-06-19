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
import time
import shutil
import argparse
from pathlib import Path
from datetime import datetime

# Ensure local modules are importable
sys.path.insert(0, str(Path(__file__).parent))

from ocr.tesseract import configure as configure_tesseract
from ocr.tesseract import extract_text_and_images, SUPPORTED_EXTENSIONS
from extraction.engine import ExtractionEngine
from extraction import template_matcher


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
    parser.add_argument("--label-overrides-file", default=None)
    parser.add_argument("--enhance-file",   default=None)
    # Parallel processing: when Electron runs a bounded worker pool, each worker
    # gets an explicit JSON list of the filenames (within --folder) it owns, so
    # the pool processes disjoint slices of the folder concurrently. Absent →
    # the worker scans the whole folder (the original single-process behaviour).
    parser.add_argument("--files-file",     default=None)
    # Reprocess only: the template this document is already linked to, honoured
    # as a Stage 0 fallback when live re-identification fails (see engine.extract).
    parser.add_argument("--known-template-id", type=int, default=None)
    # Authoritative doc-type slug for a reprocess (the document's already-assigned
    # type). Used in preference to re-detecting from OCR, which fails on a clipped
    # scan and leaves document_slug null — silently disabling the format gates.
    parser.add_argument("--known-doc-slug", default=None)
    # Dev-only: emit a structured per-field extraction TRACE stream (type:"trace")
    # for the hidden Dev Inspector. Off by default → zero extra output/overhead and
    # the user-facing process-progress stream is byte-identical.
    parser.add_argument("--registration", action="store_true",
                        help="enable Stage 0.5 registration-invariant anchoring "
                             "(landmark transform); inert unless templates carry landmarks")
    parser.add_argument("--candidate-override", choices=("off", "suggest", "auto"),
                        default="off",
                        help="Phase 3 post-merge candidate resolver (default off = no "
                             "behaviour change; suggest = corrected_to only; auto = "
                             "replace value for --candidate-override-fields only)")
    parser.add_argument("--candidate-override-fields", default="",
                        help="comma-separated field TYPES eligible for auto override")
    parser.add_argument("--born-digital", action="store_true",
                        help="use a PDF's embedded text layer (exact) instead of OCR "
                             "for pages that carry one; inert for image-only/scanned PDFs")
    parser.add_argument("--trace", action="store_true")
    # Dev-only: directory for temporary OCR crop slices (set by the handler only
    # while the inspector is open). Ignored unless --trace is also set.
    parser.add_argument("--slice-dir", default=None)
    # Inline fallbacks (for small payloads)
    parser.add_argument("--fields",          default=None)
    parser.add_argument("--hints",           default=None)
    parser.add_argument("--anchors",         default=None)
    parser.add_argument("--logos",           default=None)
    args = parser.parse_args()

    # Dev-only trace emitter (no-op unless --trace). Stamps type/doc/seq/ts so the
    # inspector can order + group events; emitted on the same stdout but with a
    # distinct type the handler routes only to the inspector. Never affects the
    # user-facing progress messages.
    _trace_state = {"seq": 0, "doc": None}
    def emit_trace(ev: dict):
        if not args.trace:
            return
        _trace_state["seq"] += 1
        emit({"type": "trace", "doc": _trace_state["doc"],
              "seq": _trace_state["seq"], "ts": int(time.time() * 1000), **ev})

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
    label_overrides = load_json_arg(None, args.label_overrides_file) or []
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

    # Registration-invariant anchoring (off unless --registration; inert without
    # taught landmarks on the matched template).
    if args.registration:
        engine.set_registration_enabled(True)

    # Phase 3 candidate override (default 'off' → byte-identical behaviour).
    if args.candidate_override and args.candidate_override != "off":
        _co_fields = [t.strip() for t in (args.candidate_override_fields or "").split(",") if t.strip()]
        engine.set_candidate_override(args.candidate_override, _co_fields)

    # Load learned format templates for OCR correction
    if formats:
        engine.set_formats(formats)

    # Admin keyword label overrides — merged onto the shipped patterns per run,
    # scoped to each document's detected doc-type slug (see engine Stage 1).
    if label_overrides:
        engine.set_label_overrides(label_overrides)

    # Find the files to process. With an explicit --files-file (a parallel
    # worker's shard), process exactly those names — restricted to existing,
    # supported files in the folder, preserving the given order. Otherwise scan
    # the whole folder as before.
    folder    = Path(args.folder)
    file_list = load_json_arg(None, args.files_file)
    if file_list is not None:
        files = [
            folder / name for name in file_list
            if (folder / name).is_file()
            and (folder / name).suffix.lower() in SUPPORTED_EXTENSIONS
        ]
    else:
        files = sorted([
            f for f in folder.iterdir()
            if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS
        ])

    emit({"type": "start", "total": len(files)})
    processed_at = datetime.now().isoformat(timespec="seconds")

    for filepath in files:
        emit({"type": "file_begin", "filename": filepath.name})
        _trace_state["doc"] = filepath.name

        try:
            # OCR
            log(f"  OCR: {filepath.name}")
            ocr_text, page_images = extract_text_and_images(
                filepath, enhance_params, born_digital=args.born_digital)

            if not ocr_text.strip():
                raise ValueError("OCR returned no text — is the scan readable?")

            # Born-digital: page-0 text-layer lines (exact word boxes) for the
            # anchor locate/harvest, so a relocated read on a generated PDF is
            # taken from the vector text, not an OCR re-read. None for image-only/
            # scanned pages (no text layer) -> anchors fall back to OCR unchanged.
            page_text_lines = None
            if args.born_digital and filepath.suffix.lower() == ".pdf":
                try:
                    import pypdfium2 as _pdfium
                    from ocr import born_digital as _bd
                    _pg0 = _pdfium.PdfDocument(str(filepath))[0]
                    if _bd.assess_page(_pg0)[0]:
                        page_text_lines = _bd.page_lines(_pg0)
                except Exception:
                    page_text_lines = None

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

            # Authoritative override: a reprocessed document already knows its
            # assigned doc type. Honour it over keyword re-detection (which fails
            # on a clipped scan, nulling the slug and disabling the format gates).
            # Also recover the type NAME + its field set from the known slug so the
            # rest of the pipeline stays consistent with the assigned type.
            if args.known_doc_slug and doc_types:
                for dt in doc_types:
                    if dt.get("slug") == args.known_doc_slug:
                        doc_slug      = args.known_doc_slug
                        document_type = dt["name"]
                        if dt.get("fields"):
                            active_fields = dt["fields"]
                        log(f"  Doc type from assigned record: {document_type} ({doc_slug})")
                        break

            # Fresh-scan doc-type: a confidently-matched template (logo + keyword
            # fingerprint) is a STRONGER type signal than keyword name-detection —
            # and for a supplier that issues several layouts under ONE letterhead
            # the fingerprint is the only thing that distinguishes them (logo alone
            # just says "this supplier"). Adopt the matched template's doc type +
            # field set so the slug, fields and (doc-type-scoped) anchors all agree
            # — but NEVER over an explicit known_doc_slug (a reprocess the user
            # already assigned). Reusable for every supplier/doc type.
            if not args.known_doc_slug and templates and page_images:
                try:
                    tmatch = template_matcher.identify_template(page_images[0], ocr_text, templates)
                except Exception:
                    tmatch = None
                tslug = ((tmatch or {}).get("template") or {}).get("document_type_slug")
                if tslug and doc_types and tslug != doc_slug:
                    for dt in doc_types:
                        if dt.get("slug") == tslug:
                            doc_slug      = tslug
                            document_type = dt["name"]
                            if dt.get("fields"):
                                active_fields = dt["fields"]
                            log(f"  Doc type from matched template: {document_type} "
                                f"({tslug}, {tmatch.get('confidence')}% via {tmatch.get('method')})")
                            break

            # The doc type's designated REFERENCE field is a CODE (a reference or
            # serial — a single token, no internal spaces), even when the operator
            # left its type as the generic "text". Coerce it to 'alphanumeric' so
            # the credibility/rescue gates treat a high-DPI crop mis-read like
            # "cield wu" as a reference error (and a clean "2602-0768-1" as valid)
            # instead of accepting it as free text. Never touches a date/currency
            # field; reusable for every custom doc type.
            if doc_slug and doc_types:
                _ref_key = next((dt.get("ref_field_key") for dt in doc_types
                                 if dt.get("slug") == doc_slug), None)
                if _ref_key and active_fields:
                    for _f in active_fields:
                        if _f.get("key") == _ref_key and (_f.get("type") or "text") in ("text", "", None):
                            _f["type"] = "alphanumeric"

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
                trace         = emit_trace if args.trace else None,
                slice_dir     = args.slice_dir if args.trace else None,
                page_text_lines = page_text_lines,
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
                "invoice_number": _get_val(extractions, [
                    "invoice_number", "sales_order_number", "po_number"
                ]),
                "invoice_date": _get_val(extractions, [
                    "invoice_date", "order_date", "po_date"
                ]),
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
