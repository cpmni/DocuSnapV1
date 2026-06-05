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
import json
import argparse
import imagehash
from PIL import Image, ImageFilter, ImageOps

# ── Logo region extraction ────────────────────────────────────────────────────

def extract_logo_region(img: Image.Image) -> Image.Image:
    """
    Crop the top portion of the page where logos almost always appear.
    Uses the top 20% of the page, full width — covers letterheads.
    Also tries a left-biased crop since logos are usually top-left.
    """
    w, h = img.size

    # Primary: top-left quadrant (most logos live here)
    top_left = img.crop((0, 0, w // 2, h // 5))

    # Secondary: full top strip
    top_strip = img.crop((0, 0, w, h // 6))

    return top_left, top_strip


def preprocess_for_hash(img: Image.Image) -> Image.Image:
    """
    Normalise the image before hashing so minor scan differences don't
    cause false mismatches. Convert to greyscale, boost contrast, resize.
    """
    img = img.convert('L')                      # greyscale
    img = ImageOps.autocontrast(img, cutoff=5)  # boost contrast
    img = img.resize((256, 256), Image.LANCZOS) # normalise size
    img = img.filter(ImageFilter.GaussianBlur(radius=1))  # reduce noise
    return img


def compute_hashes(img: Image.Image) -> dict:
    """Compute multiple hash types for robustness."""
    processed = preprocess_for_hash(img)
    return {
        "phash": str(imagehash.phash(processed, hash_size=8)),    # perceptual
        "ahash": str(imagehash.average_hash(processed, hash_size=8)),  # average
        "dhash": str(imagehash.dhash(processed, hash_size=8)),    # difference
    }


def hamming_distance(h1: str, h2: str) -> int:
    """Count differing bits between two hex hash strings."""
    if not h1 or not h2 or len(h1) != len(h2):
        return 64
    dist = 0
    for c1, c2 in zip(h1, h2):
        xor = int(c1, 16) ^ int(c2, 16)
        dist += bin(xor).count('1')
    return dist


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
