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
import threading
from pathlib import Path
from datetime import datetime

# Ensure local modules are importable
sys.path.insert(0, str(Path(__file__).parent))

from ocr.tesseract import configure as configure_tesseract
from ocr.tesseract import extract_text_and_images, SUPPORTED_EXTENSIONS
from extraction.engine import ExtractionEngine
from extraction import template_matcher


# ── Helpers ───────────────────────────────────────────────────────────────────

_emit_lock = threading.Lock()

def emit(obj: dict):
    # Lock-guarded so the per-file watchdog thread can't interleave a partial line with the
    # main thread's output.
    with _emit_lock:
        print(json.dumps(obj), flush=True)

def log(text: str, level: str = ""):
    emit({"type": "log", "text": text, "level": level})


# ── Per-file watchdog ─────────────────────────────────────────────────────────
# A single pathological page can hang a native Tesseract/pdfium call that no Python
# try/except (and, on Windows, no signal) can interrupt. When --file-timeout > 0, a
# daemon thread watches the file the main thread is on; if it overruns, it emits an
# error file_done for that file (so it's surfaced as status=error + drained to Errors/
# by the handler, never re-attempted) then force-exits, escaping the wedged call —
# instead of stalling the whole batch forever. The remaining files stay in the intake
# folder and are picked up on the next run / watch scan.
_watch = {"name": None, "started": 0.0}

def _mark_file(name):
    _watch["name"] = name
    _watch["started"] = time.monotonic()

def _clear_file():
    _watch["name"] = None

def _start_file_watchdog(timeout_s: float):
    if not timeout_s or timeout_s <= 0:
        return
    def _loop():
        while True:
            time.sleep(1.0)
            name = _watch["name"]
            if name is not None and (time.monotonic() - _watch["started"]) > timeout_s:
                try:
                    emit({"type": "file_done", "success": False, "status": "error",
                          "original_filename": name,
                          "error": f"processing timed out after {int(timeout_s)}s (skipped to protect the batch)"})
                except Exception:
                    pass
                try: sys.stdout.flush()
                except Exception: pass
                os._exit(0)   # escape the wedged native call; the process is unrecoverable
    threading.Thread(target=_loop, daemon=True, name="file-watchdog").start()

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

def doc_overrides(manifest, name, *, enhance=None, known_template_id=None,
                  known_doc_slug=None, cached_text=None):
    """Per-document reprocess overrides from a manifest (batched Reprocess All), each
    keyed by the file's basename. Falls back to the global args when the manifest has
    no entry for this file — so single-doc reprocess and folder import (no manifest)
    are byte-identical. This is what lets batched reprocess share ONE Python process
    across many docs WITHOUT losing each doc's own template / doc-slug / enhance
    overrides (the accuracy guarantee). cached_text = the doc's already-stored full-page
    OCR text, reused on reprocess to skip the redundant full-page OCR (see
    extract_text_and_images.cached_text)."""
    o = (manifest or {}).get(name) or {}
    ct = o.get("ocr_text")
    return (
        o.get("enhance_params", enhance),                       # None is a valid value
        o.get("known_template_id") or known_template_id,
        o.get("known_doc_slug") or known_doc_slug,
        ct if ct else cached_text,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder",          required=True)
    parser.add_argument("--tesseract",       default=None)
    # No hard `choices=`: a stale/legacy mode (e.g. an old "light", or one from a
    # restored settings backup) must NOT make argparse exit and kill the whole batch.
    # Anything unrecognised is coerced to "smart" below.
    parser.add_argument("--mode",            default="smart")
    parser.add_argument("--config-file",     default=None)
    parser.add_argument("--fields-file",     default=None)
    parser.add_argument("--hints-file",      default=None)
    parser.add_argument("--anchors-file",    default=None)
    parser.add_argument("--logos-file",      default=None)
    parser.add_argument("--doc-types-file",  default=None)
    parser.add_argument("--formats-file",    default=None)
    parser.add_argument("--templates-file", default=None)
    parser.add_argument("--label-overrides-file", default=None)
    parser.add_argument("--field-rules-file", default=None)
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
    # Batched Reprocess All: a JSON map {basename: {known_template_id, known_doc_slug,
    # enhance_params}} so ONE Python process can reprocess many docs while each keeps
    # its OWN overrides (per-doc accuracy). Absent → the global --known-* args apply
    # (single-doc reprocess / folder import are byte-identical). See doc_overrides().
    parser.add_argument("--reprocess-manifest", default=None)
    # Reprocess optimisation: path to a file holding this document's already-stored
    # full-page OCR text. When present, the full-page OCR (~1.9s/page) is SKIPPED and
    # this text reused (the pixels — and thus the text — don't change on reprocess; only
    # the learned data does, and per-field crop reads still re-run). Single-doc reprocess
    # only; the batch path carries the text per-doc in --reprocess-manifest instead.
    parser.add_argument("--cached-ocr-file", default=None)
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
    parser.add_argument("--name-wordness", action="store_true",
                        help="flag free-text NAME reads that don't read like a name "
                             "(document chrome / ref-code bleed / OCR garble); flag-only, "
                             "default off; inert without extraction/data/char_trigrams.json")
    parser.add_argument("--multiline", action="store_true",
                        help="enable multi-line continuation reads (a free-text value that "
                             "wraps onto the next line); inert without a multiline_continue "
                             "field rule, so single-line reads stay byte-identical")
    parser.add_argument("--date-order", choices=("dmy", "mdy", "ymd", "auto"), default="dmy",
                        help="region date ordering for AMBIGUOUS numeric dates (03/04/2026): "
                             "dmy=UK/EU (default), mdy=US, ymd=ISO-first. A day-value >12 is "
                             "unambiguous in any mode; ISO and month-name dates always parse.")
    parser.add_argument("--number-format",
                        choices=("anglo", "continental", "french", "swiss", "indian"),
                        default="anglo",
                        help="region grouping/decimal style for money amounts: anglo=1,234.56 "
                             "(default), continental=1.234,56, french=1 234,56, swiss=1'234.56, "
                             "indian=12,34,567.89. Amounts are normalised to canonical 1234.56.")
    parser.add_argument("--born-digital", action="store_true",
                        help="use a PDF's embedded text layer (exact) instead of OCR "
                             "for pages that carry one; inert for image-only/scanned PDFs")
    parser.add_argument("--auto-rotate", action="store_true",
                        help="detect a sideways/upside-down scanned page (Tesseract OSD) and "
                             "rotate it upright for OCR; the per-page angles are emitted so the "
                             "caller can rewrite the filed PDF. First import only; born-digital "
                             "and confident-upright pages are skipped (inert).")
    parser.add_argument("--ocr-engine", default="tesseract",
                        help="full-page OCR engine: 'tesseract' (default, byte-identical) "
                             "| 'rapidocr' (opt-in; falls back to tesseract if the runtime/"
                             "models are unavailable). Crop/zone/anchor OCR always uses Tesseract.")
    parser.add_argument("--ocr-fast", action="store_true",
                        help="RapidOCR speed mode: skip the angle classifier (use_cls=False) "
                             "for upright pages. Set by the app in Fast mode; ignored by Tesseract.")
    parser.add_argument("--ocr-threads", type=int, default=0,
                        help="RapidOCR onnxruntime intra-op thread cap PER worker (0/unset = "
                             "onnxruntime default = all cores). The app passes cores/concurrency "
                             "when running parallel workers so they don't oversubscribe the CPU. "
                             "Ignored by Tesseract.")
    parser.add_argument("--trace", action="store_true")
    # Per-file WATCHDOG timeout (seconds; 0 = disabled). A single pathological page can hang
    # a native Tesseract/pdfium call, which no Python try/except or (on Windows) signal can
    # interrupt. When set, a daemon thread force-terminates this worker if one file exceeds the
    # timeout — after emitting a file_done error for it so the doc is surfaced (status=error,
    # drained to Errors/ by the handler, never re-attempted) instead of stalling the batch forever.
    parser.add_argument("--file-timeout", type=float, default=0.0)
    # Dev-only: directory for temporary OCR crop slices (set by the handler only
    # while the inspector is open). Ignored unless --trace is also set.
    parser.add_argument("--slice-dir", default=None)
    # Inline fallbacks (for small payloads)
    parser.add_argument("--fields",          default=None)
    parser.add_argument("--hints",           default=None)
    parser.add_argument("--anchors",         default=None)
    parser.add_argument("--logos",           default=None)
    args = parser.parse_args()
    if args.mode not in ("fast", "smart", "ai"):
        args.mode = "smart"   # tolerate a stale/legacy mode rather than failing the batch

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
    field_rules    = load_json_arg(None, args.field_rules_file) or []
    enhance_params = load_json_arg(None, args.enhance_file)   or None
    reprocess_manifest = load_json_arg(None, args.reprocess_manifest) or {}

    # Single-doc reprocess: the doc's already-stored full-page OCR text (skip re-OCR).
    global_cached_text = None
    if args.cached_ocr_file:
        try:
            global_cached_text = Path(args.cached_ocr_file).read_text(encoding="utf-8")
        except Exception:
            global_cached_text = None

    # Full-page OCR engine (default 'tesseract' = byte-identical). RapidOCR is opt-in
    # and falls back to Tesseract if its runtime/models are unavailable; crop/zone/
    # anchor OCR is unaffected by this selection. Named ocr_engine to avoid colliding
    # with the ExtractionEngine `engine` below.
    from ocr.engine import get_engine
    ocr_engine = get_engine(
        args.ocr_engine,
        use_cls=not args.ocr_fast,
        intra_op_num_threads=(args.ocr_threads if args.ocr_threads and args.ocr_threads > 0 else None),
    )

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

    # Free-text NAME wordness review flag (off unless --name-wordness; flag-only).
    if args.name_wordness:
        engine.set_name_wordness(True)

    # Multi-line continuation reads (off unless --multiline; inert without a field rule).
    if args.multiline:
        engine.set_multiline_enabled(True)

    # Region date ordering (default 'dmy' = byte-identical to the historical behaviour).
    from extraction import validator as _validator
    _validator.set_date_order(args.date_order)

    # Region number format for money amounts (default 'anglo' = byte-identical).
    from extraction import number_format as _number_format
    _number_format.set_format(args.number_format)

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

    # Operator-taught field cleanup rules (Review right-click toolkit) — strip a
    # learned leaked heading/column at extraction time (engine Stage 4.5).
    if field_rules:
        engine.set_field_rules(field_rules)

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

    _start_file_watchdog(getattr(args, "file_timeout", 0.0))

    for filepath in files:
        _mark_file(filepath.name)   # arm the per-file watchdog for this file
        emit({"type": "file_begin", "filename": filepath.name})
        _trace_state["doc"] = filepath.name

        # Per-document overrides (batched reprocess) — fall back to the global args
        # when no manifest entry exists (byte-identical for folder import / single doc).
        _enh, _kt, _ks, _cached = doc_overrides(
            reprocess_manifest, filepath.name,
            enhance=enhance_params,
            known_template_id=args.known_template_id,
            known_doc_slug=args.known_doc_slug,
            cached_text=global_cached_text,
        )

        try:
            # OCR (skipped on reprocess when the stored full-page text is supplied —
            # the pixels don't change, only the learned data; per-field crop reads
            # still re-run, so accuracy is unchanged. See extract_text_and_images.)
            log(f"  {'render (cached OCR)' if _cached else 'OCR'}: {filepath.name}")
            _rotations = []   # per-page CLOCKWISE auto-rotate angles (filled only on a first import)
            ocr_text, page_images = extract_text_and_images(
                filepath, _enh, born_digital=args.born_digital, engine=ocr_engine,
                cached_text=(_cached if (_cached and _cached.strip()) else None),
                auto_rotate=getattr(args, 'auto_rotate', False), rotations_out=_rotations)
            if any(_rotations):
                log(f"  auto-rotate: {[r for r in _rotations if r]} (clockwise°) on {filepath.name}")

            # Live page count, so the UI can flag a multi-page document while it processes.
            emit({"type": "file_pages", "filename": filepath.name, "pages": len(page_images)})

            if not ocr_text.strip():
                raise ValueError("OCR returned no text — is the scan readable?")

            # Born-digital: page-0 text-layer lines (exact word boxes) for the
            # anchor locate/harvest, so a relocated read on a generated PDF is
            # taken from the vector text, not an OCR re-read. None for image-only/
            # scanned pages (no text layer) -> anchors fall back to OCR unchanged.
            page_text_lines = None
            if args.born_digital and filepath.suffix.lower() == ".pdf":
                _bd_doc = None
                try:
                    import pypdfium2 as _pdfium
                    from ocr import born_digital as _bd
                    _bd_doc = _pdfium.PdfDocument(str(filepath))
                    _pg0 = _bd_doc[0]
                    if _bd.assess_page(_pg0)[0]:
                        page_text_lines = _bd.page_lines(_pg0)
                except Exception:
                    page_text_lines = None
                finally:
                    # Release the file handle so the post-processing drain can move the
                    # original out of the source folder (Windows locks an open PDF).
                    if _bd_doc is not None:
                        try: _bd_doc.close()
                        except Exception: pass

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
            if _ks and doc_types:
                for dt in doc_types:
                    if dt.get("slug") == _ks:
                        doc_slug      = _ks
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
            if not _ks and templates and page_images:
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
                known_template_id = _kt,
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
                "page_rotations":     _rotations,   # per-page clockwise° for the caller to rotate the filed PDF
                "original_filename":  filepath.name,
                "overall_confidence": overall_conf,
                "needs_review":       review_needed,
                "document_type":      doc_type_result,
                "type_confidence":    type_conf,
                "supplier_name":      supplier_name,
                "template_id":        template_id,
                "logo_phash":         logo_phash,
                "keyword_fingerprint": kw_fingerprint,
                "page_count":         len(page_images),
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
        finally:
            _clear_file()   # disarm the watchdog between files (only an in-progress file can time out)


def _get_val(extractions: dict, keys: list[str]) -> str | None:
    for k in keys:
        v = extractions.get(k, {}).get("value")
        if v:
            return v
    return None


if __name__ == "__main__":
    main()
