#!/usr/bin/env python3
"""
logo_fingerprint.py
-------------------
Extracts a perceptual hash fingerprint from the logo region of a document page.

Called by Electron in two modes:
  --mode extract  : extract hashes from a document image (base64 PNG via --image)
  --mode match    : compare a document's hashes against stored fingerprints

Returns JSON: {"phash": "...", "ahash": "..."}
"""

import sys
import os
import json
import argparse
from PIL import Image

# The crop + preprocess + hash recipe is SHARED with the Stage-0 extraction matcher
# (extraction/template_matcher.compute_logo_hash) via one module — logo_hash.py — so a
# taught logo and an extracted logo are always hashed identically (no silent drift).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from logo_hash import extract_logo_region, compute_hashes, hamming_distance  # noqa: E402


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--image-file', required=True, help='Path to PNG file of document page')
    parser.add_argument('--mode',     default='extract',
                        choices=['extract', 'match'],
                        help='extract: compute hashes; match: find closest stored hash')
    parser.add_argument('--stored-file', default=None,
                        help='Path to JSON file of stored fingerprints (for match mode)')
    parser.add_argument('--threshold', type=int, default=12,
                        help='Max hamming distance to count as a match (default 12)')
    args = parser.parse_args()

    # Load image from file
    try:
        img = Image.open(args.image_file).convert('RGB')
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        return

    top_left, top_strip = extract_logo_region(img)

    # Use top-left crop as primary (most logos are there)
    hashes = compute_hashes(top_left)
    # Fallback hashes from full top strip
    strip_hashes = compute_hashes(top_strip)

    if args.mode == 'extract':
        print(json.dumps({
            "phash":       hashes["phash"],
            "ahash":       hashes["ahash"],
            "dhash":       hashes["dhash"],
            "strip_phash": strip_hashes["phash"],
        }), flush=True)
        return

    # Match mode — compare against stored fingerprints
    if not args.stored_file:
        print(json.dumps({"match": None}))
        return

    with open(args.stored_file, 'r') as f:
        stored = json.load(f)
    best_match = None
    best_dist  = args.threshold + 1

    for fp in stored:
        stored_phash = fp.get("phash", "")
        # Try both primary and strip hashes against stored
        for query_hash in [hashes["phash"], strip_hashes["phash"]]:
            dist = hamming_distance(query_hash, stored_phash)
            if dist < best_dist:
                best_dist  = dist
                best_match = {
                    "supplier_name": fp["supplier_name"],
                    "distance":      dist,
                    "confidence":    max(0, 100 - (dist * 6)),  # 0 dist = 100%, 12 dist = 28%
                    "match_count":   fp.get("match_count", 1),
                }

    print(json.dumps({"match": best_match}), flush=True)


if __name__ == '__main__':
    main()
