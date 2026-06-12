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

    # Intercept intermediate crops for diagnostics — save anchor and derived
    # target crops alongside the temp image so a garbled result can be inspected.
    img_dir = os.path.dirname(args.image_file)
    _debug_save_crops(page, mapping, img_dir)

    # Pass field_defs so the test applies the SAME Stage 0.5 numeric/date
    # shape-gate engine.py does (it passes field_defs). field_type comes from the
    # editor payload; field_key alone also drives the reference-key convention
    # (_number/_no) inside extract_with_mappings. Without this the test would show
    # a value that live extraction rejects (e.g. a digit-less numeric job_no).
    field_defs = [{'key': field_key, 'type': mapping.get('field_type')}] if field_key else None
    results = template_mapper.extract_with_mappings(
        [page], [mapping], field_patterns=field_patterns, field_defs=field_defs)
    out = results.get(field_key) or {}
    sys.stderr.write(f"[test_mapping] page={page.size} field={field_key} result={out.get('value')!r}\n")
    sys.stderr.flush()
    print(json.dumps(out))


def _debug_save_crops(page, mapping, out_dir):
    """Save anchor + derived-target crops to temp dir for visual inspection."""
    try:
        from extraction import template_mapper as tm

        def _norm(prefix):
            keys = (f"{prefix}_x_norm", f"{prefix}_y_norm", f"{prefix}_w_norm", f"{prefix}_h_norm")
            vals = [mapping.get(k) for k in keys]
            if any(v is None for v in vals):
                return None
            x, y, w, h = (float(v) for v in vals)
            return {"x_norm": x, "y_norm": y, "w_norm": w, "h_norm": h}

        anchor_box = _norm("anchor")
        target_box = _norm("target")
        if not anchor_box or not target_box:
            return

        def _px(box, img):
            W, H = img.size
            x1 = int(box["x_norm"] * W)
            y1 = int(box["y_norm"] * H)
            x2 = int((box["x_norm"] + box["w_norm"]) * W)
            y2 = int((box["y_norm"] + box["h_norm"]) * H)
            return x1, y1, x2, y2

        anchor_crop = page.crop(_px(anchor_box, page))
        anchor_crop.save(os.path.join(out_dir, "debug_anchor_crop.png"))

        # Re-run locate to get the derived target
        located = tm._locate_anchor(page, anchor_box, mapping.get("anchor_text"),
                                    float(mapping.get("search_expansion") or 0), tm._ocr_lines)
        if located:
            dx = float(mapping.get("offset_dx_norm") or 0)
            dy = float(mapping.get("offset_dy_norm") or 0)
            inset_x = max(0.0, (anchor_box["w_norm"] - located["w_norm"]) / 2)
            inset_y = max(0.0, (anchor_box["h_norm"] - located["h_norm"]) / 2)
            derived = {
                "x_norm": min(1, max(0, located["x_norm"] - inset_x + dx)),
                "y_norm": min(1, max(0, located["y_norm"] - inset_y + dy)),
                "w_norm": target_box["w_norm"],
                "h_norm": target_box["h_norm"],
            }
            sys.stderr.write(f"[test_mapping] anchor_box={anchor_box}\n")
            sys.stderr.write(f"[test_mapping] located={located}\n")
            sys.stderr.write(f"[test_mapping] inset=({inset_x:.4f},{inset_y:.4f}) dx={dx:.4f} dy={dy:.4f}\n")
            sys.stderr.write(f"[test_mapping] derived_target={derived}\n")
            sys.stderr.flush()
            target_crop = page.crop(_px(derived, page))
            target_crop.save(os.path.join(out_dir, "debug_target_crop.png"))
        else:
            sys.stderr.write("[test_mapping] _locate_anchor returned None\n")
            sys.stderr.flush()
            target_crop = page.crop(_px(target_box, page))
            target_crop.save(os.path.join(out_dir, "debug_target_crop_fallback.png"))
    except Exception as ex:
        sys.stderr.write(f"[test_mapping debug] error: {ex}\n")
        sys.stderr.flush()


if __name__ == '__main__':
    main()
