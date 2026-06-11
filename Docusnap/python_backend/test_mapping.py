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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image-file',   required=True)
    parser.add_argument('--mapping-file', required=True)
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

    field_key = mapping.get('field_key')
    # Mirror engine.py: field_patterns drives _clean_value's val_type. Use the
    # mapping's own ocr_type so the test cleans the value the same way reprocess
    # does for this field.
    field_patterns = {}
    if field_key and mapping.get('ocr_type'):
        field_patterns = {field_key: {'validation': mapping['ocr_type']}}

    results = template_mapper.extract_with_mappings([page], [mapping], field_patterns=field_patterns)
    print(json.dumps(results.get(field_key) or {}))


if __name__ == '__main__':
    main()
