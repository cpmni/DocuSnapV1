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
                  known_doc_slug=None, cached_text=None, known_doc_slug_authority=None,
                  known_supplier=None):
    """Per-document reprocess overrides from a manifest (batched Reprocess All), each
    keyed by the file's basename. Falls back to the global args when the manifest has
    no entry for this file — so single-doc reprocess and folder import (no manifest)
    are byte-identical. This is what lets batched reprocess share ONE Python process
    across many docs WITHOUT losing each doc's own template / doc-slug / enhance
    overrides (the accuracy guarantee). cached_text = the doc's already-stored full-page
    OCR text, reused on reprocess to skip the redundant full-page OCR (see
    extract_text_and_images.cached_text).

    known_doc_slug_authority: who assigned the doc's known_doc_slug — 'machine' (the
    pipeline typed it; a trusted contradicting title may re-type it) vs anything else
    (human-confirmed / absent → the slug stays PINNED, today's behaviour). Deliberately
    NO global fallback for a doc that HAS a manifest entry: authority is a per-document
    fact (statuses differ across a batch), so a global flag must never leak onto
    manifest-carried docs (Oracle condition, 2026-07-09)."""
    has_entry = bool(manifest) and name in manifest
    o = (manifest or {}).get(name) or {}
    ct = o.get("ocr_text")
    return (
        o.get("enhance_params", enhance),                       # None is a valid value
        o.get("known_template_id") or known_template_id,
        o.get("known_doc_slug") or known_doc_slug,
        ct if ct else cached_text,
        o.get("known_doc_slug_authority") if has_entry else known_doc_slug_authority,
        o.get("known_supplier") if has_entry else known_supplier,   # per-doc pin; no global leak onto batch docs
    )


# Python twin of database/modules/slug.js safeSlug (as used by document_types.presetSlug), so a
# type name detected from the SHIPPED keyword buckets derives the SAME slug the type would carry if
# the operator added it from the preset catalog. Keep the two in step: "Delivery Note" must yield
# 'delivery_note' on both sides or the type-refuse guards compare against the wrong string.
def _slug_from_type_name(name, fallback="type", max_len=64):
    import unicodedata as _ud
    import re as _re
    s = "" if name is None else str(name)
    try:
        s = "".join(c for c in _ud.normalize("NFKD", s) if not _ud.combining(c))
    except Exception:
        pass
    s = _re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    if len(s) > max_len:
        s = s[:max_len].rstrip("_")
    return s or fallback


def resolve_assigned_type_authority(ks, ks_auth, detected_name_slug, title_trusted_fresh):
    """Reprocess type authority: may the doc's OWN freshly-detected title override its
    already-ASSIGNED type slug (`ks`)? Returns (override, title_trusted) — the coherent
    pair threaded into BOTH identify_template calls.

    override is True ONLY when ALL hold:
      - an assigned slug exists (this is a reprocess),
      - the assignment authority is 'machine' (the pipeline typed it; a human-confirmed
        type is NEVER overridden — absent/unknown authority counts as human/pinned, so
        every pre-flag caller keeps today's byte-identical pin),
      - the fresh title is TRUSTED (a real standalone heading, conf>=70 — a clipped scan
        has no trusted heading and keeps the pin exactly as before),
      - the detected title resolves to a KNOWN type slug that DIFFERS from the pin.

    title_trusted (the pair's second half) fixes a pre-existing SPLIT-BRAIN: the engine
    used to receive title_trusted computed from the FRESH detection alongside
    detected_slug = the ASSIGNED slug — "trusted title = sales_order" describing a
    heading that actually reads WORKSHEET, which could make template matching refuse a
    legitimate sibling. Pinned ⇒ the title is trusted only when it AGREES with the pin;
    overridden / fresh-scan ⇒ the fresh signal passes through unchanged."""
    override = bool(ks and ks_auth == "machine" and title_trusted_fresh
                    and detected_name_slug and detected_name_slug != ks)
    if ks and not override:
        return False, bool(title_trusted_fresh and detected_name_slug == ks)
    return override, bool(title_trusted_fresh)


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
    parser.add_argument("--accepted-names-file", default=None)
    parser.add_argument("--accepted-issuers-file", default=None)
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
    # Operator "Resolve" supplier PIN (Part B): a per-doc reprocess override that forces the issuer to
    # the operator-chosen supplier BEFORE the logo/template match, so a colliding-logo doc stops
    # reverting to the wrong one. Single-doc reprocess only here (Reprocess-All carries it per-doc in
    # the manifest). The engine keeps it REVIEW-BOUND (method 'operator_pin' + note). Never set on import.
    parser.add_argument("--known-supplier", default=None)
    # Who assigned --known-doc-slug: 'machine' = the pipeline typed the doc and no human
    # ever confirmed it, so a TRUSTED contradicting title (a real standalone heading) may
    # re-type it on reprocess (see resolve_assigned_type_authority). Anything else —
    # including ABSENT (every pre-flag caller: harness, older invocations) — keeps
    # today's pin byte-identical. No hard `choices=` (an unknown value must not kill a
    # batch; it simply behaves as the safe pin).
    parser.add_argument("--known-doc-slug-authority", default=None)
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
    # Fast text-only re-extract (Oracle-vetted, kill switch caller-side REEXTRACT_TEXT_ONLY): with a
    # cached full-page OCR supplied (--cached-ocr-file / manifest ocr_text), render NO page images and
    # run only the engine's image-free stages (keyword + hints + validation + known-id template text-read;
    # crop/anchor/mapping stages self-skip on page_images=[]). Skips BOTH the full-page OCR AND the
    # per-field crop OCR. Absent flag ⇒ byte-identical. Caller excludes born-digital docs (C3).
    parser.add_argument("--reextract", action="store_true",
                        help="text-only re-extract from cached OCR; render no images (fast on-open path)")
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
    parser.add_argument("--deskew-pages", action="store_true",
                        help="'Straighten + Reprocess': transiently deskew each scanned page before "
                             "OCR + as the anchor crop source, so a taught label relocates in a level "
                             "frame. The filed file is untouched; the logo phash uses the raw frame. "
                             "Kill switch env DESKEW_PAGES=0. Review-bound (reprocess never auto-files).")
    parser.add_argument("--deskew-min-angle", type=float, default=0.2,
                        help="Minimum skew angle in DEGREES to straighten under --deskew-pages; a page "
                             "tilted LESS than this reads raw. Clamped to [0.2, 5.0]; default 0.2 = the "
                             "built-in noise floor (straighten any measurable skew). The Review session "
                             "'Straighten all' toggle sends the operator's chosen floor here.")
    parser.add_argument("--trace", action="store_true")
    # SHADOW measurement: compute the text-led supplier-identity verdict per doc and emit it
    # in file_done (extraction/identity_fusion). Changes no decision; off => output unchanged.
    parser.add_argument("--identity-shadow", action="store_true")
    # ACTIVE flag-only: a supplier-identity CONFLICT (letterhead reads a different known supplier
    # than the pipeline resolved) raises needs_review + a note; never overrides/fills. Off => unchanged.
    parser.add_argument("--identity-conflict", action="store_true")
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
    if args.mode not in ("fast", "smart"):
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
    accepted_names = load_json_arg(None, args.accepted_names_file) or []
    accepted_issuers = load_json_arg(None, args.accepted_issuers_file) or []
    enhance_params = load_json_arg(None, args.enhance_file)   or None
    reprocess_manifest = load_json_arg(None, args.reprocess_manifest) or {}

    # Single-doc reprocess: the doc's already-stored full-page OCR text (skip re-OCR).
    global_cached_text = None
    if args.cached_ocr_file:
        try:
            global_cached_text = Path(args.cached_ocr_file).read_text(encoding="utf-8")
        except Exception:
            global_cached_text = None

    # Full-page OCR engine (Tesseract only). Named ocr_engine to avoid colliding with the
    # ExtractionEngine `engine` below.
    from ocr.engine import get_engine
    ocr_engine = get_engine()

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

    # Operator-accepted NAME allowlist — values the user marked "this is a valid name" so
    # the wordness/truncation flags skip them (e.g. an acronym company "Cloud VPS"). Empty
    # → byte-identical.
    if accepted_names:
        engine.set_accepted_names(accepted_names)
    # Operator-accepted ISSUER allowlist — resolved suppliers the user marked a valid issuer via
    # the identity-conflict "Issuer is correct" button (skips the conflict flag). Empty → no change.
    if accepted_issuers:
        engine.set_accepted_issuers(accepted_issuers)

    # Text-led supplier-identity conflict flag (off unless --identity-conflict; flag-only).
    if args.identity_conflict:
        engine.set_identity_conflict(True)

    # Multi-line continuation reads (off unless --multiline; inert without a field rule).
    if args.multiline:
        engine.set_multiline_enabled(True)

    # Region date ordering (default 'dmy' = byte-identical to the historical behaviour).
    from extraction import validator as _validator
    _validator.set_date_order(args.date_order)

    # Region number format for money amounts (default 'anglo' = byte-identical). Detected money
    # is normalised to canonical AND the currency symbol is stripped (money = numbers only).
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
        _enh, _kt, _ks, _cached, _ks_auth, _known_supplier = doc_overrides(
            reprocess_manifest, filepath.name,
            enhance=enhance_params,
            known_template_id=args.known_template_id,
            known_doc_slug=args.known_doc_slug,
            cached_text=global_cached_text,
            known_doc_slug_authority=args.known_doc_slug_authority,
            known_supplier=args.known_supplier,
        )

        try:
            # OCR (skipped on reprocess when the stored full-page text is supplied —
            # the pixels don't change, only the learned data; per-field crop reads
            # still re-run, so accuracy is unchanged. See extract_text_and_images.)
            log(f"  {'render (cached OCR)' if _cached else 'OCR'}: {filepath.name}")
            _rotations = []   # per-page CLOCKWISE auto-rotate angles (filled only on a first import)
            _provenance = []  # per-page 'ocr'|'born_digital' (parallel to page_images)
            # Deskew-on-reprocess ("Straighten + Reprocess"): env DESKEW_PAGES=0 is the kill switch.
            # _raw_pages keeps each page's PRE-deskew image so raw_page0 (below) feeds the logo phash
            # the raw frame; empty (raw_page0=None) when deskew is off -> byte-identical.
            _deskew_pages = bool(getattr(args, 'deskew_pages', False)) and os.environ.get('DESKEW_PAGES', '1') != '0'
            _deskew_min_angle = max(0.2, min(5.0, float(getattr(args, 'deskew_min_angle', 0.2) or 0.2)))
            _raw_pages = [] if _deskew_pages else None
            # Per-page applied deskew angles (parallel to pages) — load-bearing for the
            # DESKEW_RAW_CROPS election's per-page cap (Oracle C4), not just observability.
            _deskew_angles = [] if _deskew_pages else None
            # PAGE-0 GEOMETRY hand-off (letterhead height ranking): filled only when page 0 was
            # freshly OCR'd — empty on a cached reprocess (the pairing would be stale) and on a
            # born-digital page 0 (exact vector text, no word boxes) → consumers fall back to
            # text-only. Empty dict ⇒ None into engine.extract (byte-identical no-geometry path).
            _page0_geom = {}
            if getattr(args, 'reextract', False):
                # Fast text-only re-extract: reuse the cached full-page OCR verbatim, render NO images →
                # the engine runs its image-free subset and every crop/anchor/mapping stage self-skips on
                # page_images=[]. Kills BOTH the full-page OCR and the per-field crop OCR (the two repeated
                # reprocess costs once OCR is cached). An empty cache trips the non-empty guard below.
                ocr_text, page_images = (_cached or ''), []
            else:
                ocr_text, page_images = extract_text_and_images(
                    filepath, _enh, born_digital=args.born_digital, engine=ocr_engine,
                    cached_text=(_cached if (_cached and _cached.strip()) else None),
                    auto_rotate=getattr(args, 'auto_rotate', False), rotations_out=_rotations,
                    provenance_out=_provenance,
                    deskew_pages=_deskew_pages, deskew_min_angle=_deskew_min_angle, raw_pages_out=_raw_pages,
                    page0_words_out=_page0_geom, deskew_angles_out=_deskew_angles)
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
            if args.born_digital and not getattr(args, 'reextract', False) and filepath.suffix.lower() == ".pdf":
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
            # Per-type title aliases (extra printed-title phrases that also detect this type).
            # getAllWithFields parses the stored JSON to an array; be defensive if a str slips through.
            type_aliases = None
            if doc_types:
                type_aliases = {}
                for dt in doc_types:
                    al = dt.get("title_aliases")
                    if isinstance(al, str):
                        try: al = json.loads(al)
                        except Exception: al = []
                    if al:
                        type_aliases[dt["name"]] = al
            type_detection = engine.detect_document_type(ocr_text, known_type_names, type_aliases or None)
            document_type  = type_detection["type"] if type_detection else None
            type_conf      = type_detection["confidence"] if type_detection else 0

            # BANNER HEADING RE-READ. ORDERING IS LOAD-BEARING (Oracle C2): this MUST stay BEFORE
            # title_trusted_fresh (~L560) AND before identify_template (~L623), so a recovered heading
            # flips BOTH the fresh-scan type-precedence and the machine-authority reprocess override.
            # A stylised RED type heading (e.g. a big-red "WORKSHEET" banner) is destroyed by the main
            # pass's greyscale OCR (red is luminance-underweighted -> "WORKSH = ET"), so
            # detect_document_type never matches the alias -> heading=False -> title_trusted=False and
            # the whole 2026-07-15 heading-authority net is disarmed, so the type falls to a same-logo
            # sibling. Recover the banner from the RAW RGB page-0 red channel and RE-DETECT through the
            # SAME exact-alias matcher (no fuzzy -> no new false-positive surface); adopt ONLY a TRUSTED
            # heading. Fires only when the main pass produced no trusted heading, on a scanned page 0
            # (provenance 'ocr') carrying a real red top-band mark (recover_heading_band's C1 pre-gate
            # confines cost + FP surface to red-banner docs — measured firing rate ~0.4%). Fail-safe:
            # any miss keeps the original detection (today's review-hold). Kill switch
            # BANNER_HEADING_REREAD (default ON). Design: docs/designs/BANNER_HEADING_REREAD_2026-07-16.md.
            _banner_reread = False   # telemetry: did the red-channel heading re-read adopt a type?
            if (os.environ.get("BANNER_HEADING_REREAD", "1") != "0"
                    and not (type_detection and type_detection.get("heading") and type_conf >= 70)
                    and page_images and known_type_names
                    and _provenance and _provenance[0] == "ocr"):
                try:
                    from ocr.heading_reread import recover_type_detection
                    _aug = recover_type_detection(page_images[0], ocr_text, known_type_names,
                                                  type_aliases or None, engine.detect_document_type)
                    if _aug:
                        type_detection = _aug
                        document_type  = _aug["type"]
                        type_conf      = _aug["confidence"]
                        _banner_reread = True
                        log(f"  Banner heading recovered: {document_type} ({type_conf}%) [red-channel re-read]")
                except Exception:
                    pass  # additive; on any failure the original detection stands (fail toward review)

            # RUNG 2 — GENERAL TITLE-BAND RE-READ (2026-07-31; herald→Oracle SIGN-OFF-W/COND;
            # kill HEADING_BAND_REREAD=0; default ON — flipped after unit+probe+realdoc census). The full-page pass can MANUFACTURE a
            # garbled heading the red rung can't touch: at low ocr_dpi PSM-3 fragments a tracked
            # banner and the PSM-6 supp merge DOUBLES tokens ("PURCHASE PU RC HASE Oo RDER", doc 180
            # @200 DPI) → wrong low-conf detection → title_trusted=False → the heading-authority net
            # disarms and the ambiguity/refuse guards mis-arm. A geometry-pre-gated (no OCR;
            # top-band banner-height type only — the mid-body column class stays out, Oracle A2)
            # SINGLE-PASS re-read of just the banner band recovers the same pixels verbatim; adoption
            # via the SAME detect_fn + trusted-heading contract as rung 1 (Oracle A1 — no new
            # matcher). Fresh page-0 geometry only (_page0_geom empty on cached reprocess /
            # born-digital → honestly inert). SAME ordering constraint as rung 1 (before
            # title_trusted_fresh + identify_template).
            _band_reread = False   # telemetry: did the general band re-read adopt a type?
            if (os.environ.get("HEADING_BAND_REREAD", "1") != "0"
                    and not _banner_reread
                    and not (type_detection and type_detection.get("heading") and type_conf >= 70)
                    and page_images and known_type_names and _page0_geom
                    and _provenance and _provenance[0] == "ocr"):
                try:
                    from ocr.heading_reread import recover_type_detection_general
                    _aug2 = recover_type_detection_general(page_images[0], _page0_geom, ocr_text,
                                                           known_type_names, type_aliases or None,
                                                           engine.detect_document_type)
                    if _aug2:
                        type_detection = _aug2
                        document_type  = _aug2["type"]
                        type_conf      = _aug2["confidence"]
                        _band_reread   = True
                        log(f"  Banner heading recovered: {document_type} ({type_conf}%) [band re-read]")
                except Exception:
                    pass  # additive; on any failure the original detection stands (fail toward review)

            # RUNG 3 — ABSENT-TITLE PIXEL RE-READ (2026-08-07; oscar→Oracle-pending; kill
            # HEADING_ABSENT_REREAD, DEFAULT OFF/DARK — a type-changing path; flip only after the
            # corpus M=0 gate). The full-page --dpi PSM-3 pass can DROP an oversized centred title
            # ENTIRELY (Castellan 'CREDIT NOTE': --dpi 300 drops it from full-page PSM-3 AND the PSM-6
            # supp merge — proven), so it never reaches the word GEOMETRY rung 2's
            # find_prominent_heading_band reads → rung 2 is BLIND to it BY CONSTRUCTION. A NumPy PIXEL
            # prominence pre-gate (NO OCR — a top-band banner-height ink run the full-page pass left
            # unread) locates the title, and a TIGHT single-pass band re-read (PSM 6/7/11) recovers it
            # (a loose band re-garbles; proven). Adoption via the SAME detect_fn + trusted-heading
            # contract as rungs 1/2 (no new matcher). Needs fresh page-0 geometry (med_h + the read
            # word-set for the coverage test) → honestly inert on a cached reprocess / born-digital.
            # SAME ordering as rungs 1/2 (before title_trusted_fresh + identify_template).
            _absent_reread = False
            if (os.environ.get("HEADING_ABSENT_REREAD", "0") != "0"    # DARK — flip after the gate
                    and not _banner_reread and not _band_reread
                    and not (type_detection and type_detection.get("heading") and type_conf >= 70)
                    and page_images and known_type_names and _page0_geom
                    and _provenance and _provenance[0] == "ocr"):
                try:
                    from ocr.heading_reread import recover_type_detection_absent
                    _aug3 = recover_type_detection_absent(page_images[0], _page0_geom, ocr_text,
                                                          known_type_names, type_aliases or None,
                                                          engine.detect_document_type)
                    if _aug3:
                        type_detection = _aug3
                        document_type  = _aug3["type"]
                        type_conf      = _aug3["confidence"]
                        _absent_reread = True
                        log(f"  Banner heading recovered: {document_type} ({type_conf}%) [absent-title pixel re-read]")
                except Exception:
                    pass  # additive; on any failure the original detection stands (fail toward review)

            # TYPE-PRESENCE GATE (keyword path, Slice 1b — kill switch TYPE_PRESENCE_GATE, default OFF
            # = byte-identical). A keyword-detected type must show its OWN name/alias as a HEADING in the
            # title band. A type assigned only from a BODY mention (heading=False) whose name is ABSENT
            # from the top band is a false-positive — the PO keyword "order to" substring-matched an
            # "Order Total" totals line and typed worksheets as Purchase Order. DROP it -> review UNTYPED
            # (a null type CANNOT auto-file, trust.js 'no-type' — fail toward review). Nulls the COMMITTED
            # type ONLY; type_detection is left intact so detected_name_slug/title_trusted still thread to
            # the template-path guards (herald). Fresh-import path only — a reprocess with an assigned
            # _ks re-honours the stored type at L613, so existing mis-typed docs need re-import/re-type.
            # Reuses the parity-locked type-presence primitives; the token set is the same one the
            # template-path veto scores (test_type_heading_tokens.py). Nudge harvest (emit the page's own
            # heading for the "Add <type>" prompt) is a separate follow-on — until then a dropped doc
            # lands generically-untyped in review (safe, no misfile).
            if (os.environ.get("TYPE_PRESENCE_GATE", "1") != "0"    # flipped default ON 2026-07-30; =0 disables
                    and document_type and type_detection and not type_detection.get("heading")):
                from extraction.template_matcher import (
                    _type_heading_tokens, _type_presence_top_band, _type_heading_present)
                _th_tok = _type_heading_tokens(document_type, (type_aliases or {}).get(document_type))
                if _th_tok and not _type_heading_present(_th_tok, _type_presence_top_band(ocr_text.lower())):
                    log(f"  Type '{document_type}' has no title-band heading — body-mention "
                        f"false-positive; routing to UNTYPED review")
                    document_type = None
                    type_conf = 0

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

            # The fresh detection's own slug (name → slug) + heading trust, resolved ONCE —
            # inputs to the authority decision and the coherent (detected_slug, title_trusted)
            # pair below.
            detected_name_slug = None
            if type_detection and doc_types:
                for dt in doc_types:
                    if dt["name"] == type_detection["type"]:
                        detected_name_slug = dt.get("slug")
                        break
            # UNINSTALLED-TYPE FALLBACK (2026-07-20, owner report — the delivery dockets that
            # filed as Purchase Orders on a FRESH install). The detected type NAME comes from the
            # SHIPPED document_type_keywords buckets, which exist independently of the types this
            # install actually has. Delivery Note is a PRESET, not a built-in — so on a new install
            # the engine detected "Delivery Note" at 93% with a trusted heading, failed to map it to
            # any installed type, and left detected_name_slug None. BOTH type-refuse guards in
            # template_matcher (the logo path AND the keyword path) are conditioned on a truthy
            # detected_slug, so they silently DISARMED, and a same-supplier PURCHASE ORDER template
            # matched by keywords (80%) stamped its own slug over the correct detection. Net effect:
            # the protection was strongest for a fully-configured install and ABSENT for a brand-new
            # one — exactly backwards. So when the name doesn't resolve, DERIVE the slug the type
            # would have if it were added (same safeSlug rules as document_types.presetSlug), which
            # re-arms the refuse: 'delivery_note' != 'purchase_order' => refuse => the doc reaches
            # review UNTYPED instead of MIS-typed. Only ever consulted alongside title_trusted
            # (heading + conf >= 70), so an incidental mention still refuses nothing.
            # Kill switch DETECTED_SLUG_FALLBACK=0 restores the old None behaviour.
            if (detected_name_slug is None and type_detection
                    and os.environ.get("DETECTED_SLUG_FALLBACK", "1") != "0"):
                detected_name_slug = _slug_from_type_name(type_detection.get("type"))
            title_trusted_fresh = bool(type_detection and type_detection.get("heading") and type_conf >= 70)

            # MACHINE-assigned type vs the document's OWN trusted title: a doc the pipeline
            # mis-typed (never human-confirmed, --known-doc-slug-authority 'machine') used to
            # stay mis-typed on every reprocess — the _ks pin replayed the machine's own wrong
            # guess as if a human chose it, so engine-side type fixes never reached
            # already-processed docs. A TRUSTED standalone heading (e.g. "WORKSHEET") that
            # contradicts a machine pin now re-types the doc; a HUMAN-confirmed type is NEVER
            # overridden, and a clipped scan (no trusted heading) keeps the pin exactly as
            # before. The linked template (_kt) is now KEPT on override (2026-07-10): the same-logo
            # sibling is the SAME SUPPLIER, so the engine's known-id rescue still fills its issuer +
            # shared fields; the `authoritative` guard below stops that resurrected template re-
            # flipping the type. (Was: cleared _kt — which left reprocess with "no template matched"
            # and empty fields, gary root-cause. See resolve_assigned_type_authority.)
            _ks_overridden = False
            if _ks and doc_types:
                _ovr, _ = resolve_assigned_type_authority(
                    _ks, _ks_auth, detected_name_slug, title_trusted_fresh)
                if _ovr:
                    for dt in doc_types:
                        if dt.get("slug") == detected_name_slug:
                            doc_slug      = detected_name_slug
                            document_type = dt["name"]
                            if dt.get("fields"):
                                active_fields = dt["fields"]
                            # KEEP _kt (was `_kt = None`): the same-logo sibling is the SAME supplier,
                            # so the engine's known-id rescue fills its issuer + shared fields. The
                            # template can't re-assert its wrong TYPE — the `authoritative` guard at the
                            # _document_type_slug re-flip (below) blocks that on any reprocess.
                            _ks_overridden = True
                            log(f"  Doc type OVERRIDE: assigned '{_ks}' contradicted by its own "
                                f"trusted title '{document_type}' — re-typed (machine-assigned, "
                                f"never confirmed)")
                            break

            # The document's OWN doc-type signal — computed ONCE and threaded IDENTICALLY
            # into BOTH template matches (this pre-extract one that sets active_fields, and
            # the engine's authoritative one) so they cannot disagree. `detected_slug` is the
            # type we believe (the detected title on a fresh scan; the assigned type on a
            # reprocess, already resolved into doc_slug and authoritative). `title_trusted` =
            # the type appeared as a real standalone HEADING, not a body mention — the
            # STRUCTURAL signal the template must not override. (A confidence number can't
            # separate a low-sitting heading under a tall letterhead from a top-of-page
            # incidental mention — both land ~70-75 — so we gate on the heading, not a score.)
            # COHERENT PAIR (Oracle, 2026-07-09): when the assigned slug stays PINNED, the
            # title is trusted only when it AGREES with the pin — the old code shipped the
            # fresh heading's trust alongside the ASSIGNED slug ("trusted title=sales_order"
            # describing a heading that reads WORKSHEET), which could make template matching
            # refuse a legitimate sibling on reprocess.
            detected_slug = doc_slug
            _, title_trusted = resolve_assigned_type_authority(
                _ks if not _ks_overridden else None,
                _ks_auth, detected_name_slug, title_trusted_fresh)

            # Fresh-scan doc-type: for a supplier that issues several layouts under ONE
            # letterhead, the logo+fingerprint alone can't tell the layouts apart (identical
            # fingerprints), so identify_template now uses `detected_slug` to prefer the
            # type-matching sibling — or REFUSE when a trusted title declares a type no
            # sibling carries. Adopt the matched template's type ONLY when the title is NOT a
            # trusted heading (a confident title of a different type wins); NEVER over an
            # explicit known_doc_slug (a reprocess the user already assigned — unless the
            # machine-authority override above re-typed it, which re-enters the fresh path).
            _pinned_tid = None   # FIX B1: id of the ref-prefix-resolved sibling template, pinned into extract() below
            if (not _ks or _ks_overridden) and templates and page_images:
                try:
                    # NOTE (Oracle A2, 2026-07-26): this pre-extract call carries NO query_detail_hash
                    # (the 256-bit mark hash is computed inside engine.extract), so with
                    # LOGO_DETAIL_GLOBAL_RIVALS on, the ENGINE's identify can detail-veto a wrong pick
                    # this call accepted. The divergence is REVIEW-BOUND by construction: a B1 pin from
                    # an ambiguous pick forces the ambiguous-HOLD in the engine (C2, engine.py — a
                    # pinned doc never auto-files), and the engine's own match is the authoritative one
                    # persisted. Documented in lieu of threading the hash here (lower blast radius).
                    # Site 6 (Oracle C6, DESKEW_RAW_CROPS): logo hashes are LEARNED raw-frame
                    # (engine identity reads raw_page0 unconditionally) — this pre-pass was the
                    # split-brain hashing the DESKEWED logo against raw-learned hashes. Under the
                    # election, query raw too. Switch off / deskew off -> byte-identical.
                    _idpage = page_images[0]
                    if _raw_pages and os.environ.get('DESKEW_RAW_CROPS', '0') != '0':
                        _idpage = _raw_pages[0]
                    tmatch = template_matcher.identify_template(
                        _idpage, ocr_text, templates,
                        detected_slug=detected_slug, title_trusted=title_trusted)
                except Exception:
                    tmatch = None
                # FIX B1 (suggest-only, Oracle/gary 2026-07-13): when the same-letterhead pick is
                # AMBIGUOUS (Fix A — the logo cluster spans ≥2 doc types and the skew-garbled title
                # can't resolve which), pick the correct sibling from the doc's OWN reference PREFIX
                # using the SAME poison-barred learned model as _flag_prefix_outlier. This ONLY pre-
                # selects the type + seeds the right fields + pins that sibling's template; the engine
                # STILL flags ambiguous_type, so the doc is routed to REVIEW — never auto-filed on this
                # signal (the PO↔SO cross-reference hole makes an auto-file unsafe: a Sales Order
                # quoting the buyer's PO could confidently mis-type when the own ref is skew-garbled).
                # Abstains (→ Fix A's coin-flip suggestion, unchanged) on null supplier / no learned
                # dominant / 0 or ≥2 sibling prefixes present. Kill switch env REF_PREFIX_RETYPE.
                _amb_sibs = (tmatch or {}).get("ambiguous_siblings")
                if _amb_sibs and doc_types and os.environ.get("REF_PREFIX_RETYPE", "1") != "0":
                    try:
                        from extraction import ocr_corrector as _occ
                        _resolved = _occ.resolve_type_by_ref_prefix(
                            _amb_sibs, (tmatch or {}).get("cluster_supplier"),
                            {dt.get("slug"): dt.get("ref_field_key") for dt in doc_types},
                            _occ.build_prefix_index(formats),
                            _occ.present_code_prefixes(ocr_text))
                    except Exception:
                        _resolved = None
                    if _resolved and _resolved in _amb_sibs:
                        _pinned_tid = _amb_sibs[_resolved].get("id")
                        for dt in doc_types:
                            if dt.get("slug") == _resolved:
                                if _resolved != doc_slug:
                                    doc_slug      = _resolved
                                    document_type = dt["name"]
                                    if dt.get("fields"):
                                        active_fields = dt["fields"]
                                log(f"  Doc type SUGGESTED from ref-prefix (Fix B1 — held for "
                                    f"review): {dt['name']} ({_resolved})")
                                break
                tslug = ((tmatch or {}).get("template") or {}).get("document_type_slug")
                if _pinned_tid is None and tslug and doc_types and tslug != doc_slug and not title_trusted:
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
            _ref_key = None   # hoisted (Oracle C2): threaded to extract() below even when this block is skipped
            _date_key = None  # the type's date ROLE — threaded so hidden-field scoring can never exclude it
            if doc_slug and doc_types:
                _ref_key = next((dt.get("ref_field_key") for dt in doc_types
                                 if dt.get("slug") == doc_slug), None)
                _date_key = next((dt.get("date_field_key") for dt in doc_types
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
                detected_slug = detected_slug,
                title_trusted = title_trusted,
                ref_field_key = _ref_key,
                date_field_key = _date_key,
                supplier_name = None,
                pinned_supplier = _known_supplier,   # operator Resolve pin (Part B); per-doc via doc_overrides, None on import
                known_template_id = _kt,
                pinned_template_id = _pinned_tid,
                trace         = emit_trace if args.trace else None,
                slice_dir     = args.slice_dir if args.trace else None,
                page_text_lines = page_text_lines,
                page_provenance = _provenance,
                identity_shadow = args.identity_shadow,
                raw_page0       = (_raw_pages[0] if _raw_pages else None),
                page0_geometry  = (_page0_geom or None),   # empty (cached/born-digital p0) ⇒ None
                cached_text     = global_cached_text,       # raw-frame witness text (deskew reprocess); None ⇒ engine falls back to ocr_text
                raw_pages       = (_raw_pages or None),     # DESKEW_RAW_CROPS election substrate (Oracle 2026-08-05)
                deskew_angles   = (_deskew_angles or None), # per-page cap input (C4)
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
            # On a REPROCESS the type is ALREADY decided (the known-doc-slug assignment, or the title
            # override above) — a resurrected known-id template supplies supplier/fields but must NEVER
            # re-assert its own (possibly stale) type (the "keeps applying Sales Order on reprocess"
            # bug). Import (no _ks, no override) is unaffected → the template type still wins. (gary,
            # 2026-07-10 — the guard that lets us KEEP _kt on override without re-flipping the type.)
            authoritative    = bool(_ks or _ks_overridden)
            if tmpl_type_slug and doc_types and not authoritative:
                for dt in doc_types:
                    if dt.get("slug") == tmpl_type_slug:
                        doc_type_result = dt["name"]
                        break
            overall_conf     = raw_extractions.pop("_overall_confidence", 0)
            review_needed    = raw_extractions.pop("_needs_review", True)
            template_id      = raw_extractions.pop("_template_id", None)
            logo_phash       = raw_extractions.pop("_logo_phash", None)
            logo_detail_hash = raw_extractions.pop("_logo_detail_hash", None)
            kw_fingerprint   = raw_extractions.pop("_keyword_fingerprint", [])
            identity_shadow_v = raw_extractions.pop("_identity_shadow", None)
            # Disambiguation picker: {field_key: [candidate,…]} for flagged name fields (or {}).
            field_candidates  = raw_extractions.pop("_field_candidate_emit", None) or {}
            raw_extractions.pop("_mode_used", None)
            raw_extractions.pop("_document_slug", None)

            # Sanitise — ensure all values are proper dicts
            extractions = sanitise_extractions(raw_extractions)

            # TYPE-HEADING NUDGE (Slice 1b-nudge, kill switch TYPE_HEADING_NUDGE, default OFF). When the
            # doc ended UNTYPED (the presence gate/veto dropped a wrong type, or nothing matched), harvest
            # the page's own dominant top-band heading — an UNINSTALLED type like "Worksheet" — and emit it
            # as the detected type NAME. It maps to NO installed type, so the doc STAYS untyped
            # (document_type_id null, cannot auto-file) but the handler's _resolveDetectedType surfaces
            # detected_type_name -> the existing "Add '<type>'" nudge, closing the loop (add the type once
            # -> future docs of it type correctly). Conservative harvest -> None on any doubt = plain untyped.
            # Runs BEFORE AUTO_TITLE so a real heading nudge wins over a generic title.
            if doc_type_result is None and os.environ.get("TYPE_HEADING_NUDGE", "1") != "0":   # default ON 2026-07-30; =0 disables
                try:
                    from extraction.keyword import _harvest_top_band_heading
                    _hh = _harvest_top_band_heading(ocr_text.split("\n"), known_type_names)
                    if _hh:
                        doc_type_result = _hh
                        log(f"  Detected uninstalled type heading '{_hh}' -> UNTYPED + Add-type nudge")
                except Exception:
                    pass

            # AUTO-TITLE (Generic Document design §5; kill switch env AUTO_TITLE, default
            # OFF): ONLY for a doc NO type claimed — the same None the Electron fallback
            # maps to "General Document" — so title rows exist precisely for the docs that
            # become generic; typed docs NEVER get one (PIN 5; also why a reprocess with a
            # known slug never re-runs it — the title row survives via the merge carry,
            # Oracle C5). Post-sanitise injection: overall confidence is already computed,
            # zero pipeline interaction. conf 60 keeps it review-threshold-bound on its
            # own; the trust 'generic-type' refusal is the real auto-file wall.
            if doc_type_result is None and os.environ.get("AUTO_TITLE") == "1":
                try:
                    from extraction.title_pick import pick_title
                    _tp = pick_title(ocr_text, supplier_name=supplier_name)
                    if _tp:
                        extractions["title"] = {"value": _tp["title"], "confidence": 60,
                                                "method": "auto_title"}
                        log(f"  TITLE   {_tp['title']!r} (auto_title, line {_tp['line_index']})")
                except Exception as _te:    # fail toward NO title — never junk, never a crash
                    log(f"  TITLE   skipped: {_te}")

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
                # Machine-assigned type re-typed by the doc's own trusted title (reprocess
                # authority override) — the handler plants a review note + drops stale
                # wrong-type extraction rows off this signal.
                **({"type_overridden": {"from": _ks, "to": doc_slug}} if _ks_overridden else {}),
                # Red-channel banner heading re-read adopted a recovered TYPE (telemetry so a corpus
                # A/B can prove the fix FIRED; absent when it didn't). See heading_reread.py.
                **({"banner_heading_reread": True} if _banner_reread else {}),
                "supplier_name":      supplier_name,
                "template_id":        template_id,
                "logo_phash":         logo_phash,
                "logo_detail_hash":   logo_detail_hash,
                "keyword_fingerprint": kw_fingerprint,
                **({"identity_shadow": identity_shadow_v} if identity_shadow_v else {}),
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
                        # Branding cross-check's fuzzy alternative-supplier suggestion → the renderer
                        # "Use '<name>'" one-click button (Slice 2). Additive; absent when not suggested.
                        **({"suggested_supplier": v["suggested_supplier"]}
                           if v.get("suggested_supplier") else {}),
                        # Disambiguation picker: the candidate list for a flagged name field
                        # (value + top-left box + source_label), present ONLY when the engine
                        # armed it (>=2 distinct candidates on a noted name field).
                        **({"candidates": field_candidates[k]}
                           if field_candidates.get(k) else {}),
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
