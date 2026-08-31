#!/usr/bin/env python3
"""
test_mapping.py — Template-Editor "Test" entry point.

Runs the EXACT same Stage 0.5 extraction the real reprocess uses
(extraction.template_mapper.extract_with_mappings) for a single draft/saved
mapping against a sample page, so the editor's test result is guaranteed to
match what reprocess will produce — same anchor relocation, target-crop
derivation, OCR invocation and normalisation. Previously the editor cropped the
absolute drawn target box directly (via ocr/region.py), which silently diverged
from the relocated path and could pass while reprocess clipped/omitted the value.

Usage:
  py -3.12 python_backend/test_mapping.py --image-file page.png \
      --mapping-file mapping.json --tesseract <path>

Emits a single JSON line: {"value","confidence","method","anchor"} or {} when
the anchor can't be located / nothing is read (the same omission contract).
"""

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from PIL import Image  # noqa: E402

try:
    import pytesseract
except ImportError:
    pytesseract = None

from extraction import template_mapper  # noqa: E402
from extraction.engine import _seed_field_patterns  # noqa: E402  (same gate the real pipeline uses)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image-file',   required=True)
    parser.add_argument('--mapping-file', required=True)
    parser.add_argument('--landmarks-file', default=None)
    parser.add_argument('--tesseract',    default=None)
    args = parser.parse_args()

    if args.tesseract and pytesseract is not None and os.path.exists(args.tesseract):
        pytesseract.pytesseract.tesseract_cmd = args.tesseract

    try:
        page = Image.open(args.image_file)
    except Exception:
        print('{}')
        return
    with open(args.mapping_file, encoding='utf-8') as f:
        mapping = json.load(f)

    # Template landmarks (optional): when present, resolve_geometry runs the SAME
    # registration transform reprocess uses, so the overlay tracks a shifted page.
    landmarks = None
    if args.landmarks_file:
        try:
            with open(args.landmarks_file, encoding='utf-8') as f:
                landmarks = json.load(f) or None
        except Exception:
            landmarks = None

    field_key = mapping.get('field_key')
    # Mirror engine.py EXACTLY by building field_patterns through the SAME
    # _seed_field_patterns the real pipeline uses, with the field's type as input.
    # This is what makes the preview gate identically to reprocess — crucially it
    # applies the ref-role coercion, so a doc-type REFERENCE field typed "text" is
    # gated as a CODE (alphanumeric), not free-text. Without this the preview graded
    # a text-typed ref as free-text (from the mapping's ocr_type) and a drifted
    # absolute read of OCR garbage PASSED — committing "at drawn position" instead of
    # showing the relocation reprocess actually performs (the preview/extraction gap).
    #
    # The type now comes from `field_type` — the field's REAL declared type, sent by the caller.
    # It used to come from the mapping's `ocr_type` column, which was deleted on 2026-08-08 (owner
    # decision: wire it or delete it) because NO production code read it and three UI surfaces
    # wrote it with three different vocabularies. `field_type` is strictly more faithful: it is the
    # same input `engine._seed_field_patterns` receives in the real pipeline. `ocr_type` is still
    # accepted as a fallback so an older caller, or a mapping row read straight from the DB, keeps
    # working; absent both, 'text' — exactly what an unset ocr_type resolved to before.
    field_patterns = {}
    if field_key:
        _ftype = mapping.get('field_type') or mapping.get('ocr_type') or 'text'
        field_patterns = _seed_field_patterns({}, [{'key': field_key, 'type': _ftype}])

    # resolve_geometry runs the SAME extractor and ALSO reports where the anchor
    # label located and which target box was actually read (the resolved value
    # position), so the Template Wizard can overlay "where it reads" on the page.
    # Backward-compatible: callers that only read value/confidence/method (the
    # Template Manager "Test" button) ignore the extra anchor_box/target_box keys.
    print(json.dumps(template_mapper.resolve_geometry(page, mapping, field_patterns=field_patterns,
                                                      template_landmarks=landmarks)))


if __name__ == '__main__':
    main()
