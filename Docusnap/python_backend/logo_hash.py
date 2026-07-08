#!/usr/bin/env python3
"""
logo_hash.py — the ONE shared logo-region perceptual-hash recipe.

Both the interactive teach path (`logo/fingerprint.py`) and the Stage-0 extraction
matcher (`extraction/template_matcher.compute_logo_hash`) MUST hash a logo the same
way — otherwise a logo taught in one path silently never matches in the other. This
module is the single place the crop + preprocess + hash recipe lives; both import it.

Behaviour is byte-identical to the previously-duplicated inline code: top-left crop
(w//2 x h//5), greyscale -> autocontrast(cutoff=5) -> resize 256x256 LANCZOS ->
GaussianBlur(radius=1), perceptual hash at hash_size=8 (64-bit).
"""
from PIL import Image, ImageFilter, ImageOps
import imagehash

HASH_SIZE = 8


def extract_logo_region(img: "Image.Image"):
    """Crop the top portion of the page where logos almost always appear.
    Returns (top_left, top_strip): the top-left quadrant (most logos live here)
    and the full top strip (fallback)."""
    w, h = img.size
    top_left = img.crop((0, 0, w // 2, h // 5))
    top_strip = img.crop((0, 0, w, h // 6))
    return top_left, top_strip


def preprocess_for_hash(img: "Image.Image") -> "Image.Image":
    """Normalise a crop before hashing so minor scan differences don't flip bits:
    greyscale, boost contrast, normalise size, reduce noise."""
    img = img.convert('L')                                 # greyscale
    img = ImageOps.autocontrast(img, cutoff=5)             # boost contrast
    img = img.resize((256, 256), Image.LANCZOS)            # normalise size
    img = img.filter(ImageFilter.GaussianBlur(radius=1))   # reduce noise
    return img


def compute_hashes(img: "Image.Image") -> dict:
    """phash/ahash/dhash of a crop (preprocessed first) — used by the teach path."""
    processed = preprocess_for_hash(img)
    return {
        "phash": str(imagehash.phash(processed, hash_size=HASH_SIZE)),          # perceptual
        "ahash": str(imagehash.average_hash(processed, hash_size=HASH_SIZE)),   # average
        "dhash": str(imagehash.dhash(processed, hash_size=HASH_SIZE)),          # difference
    }


def logo_phash(page_image: "Image.Image"):
    """The single top-left-region phash string used by Stage-0 matching. Byte-identical
    to the former `template_matcher.compute_logo_hash`. Returns None on any error."""
    try:
        w, h = page_image.size
        crop = page_image.crop((0, 0, w // 2, h // 5))
        crop = preprocess_for_hash(crop)
        return str(imagehash.phash(crop, hash_size=HASH_SIZE))
    except Exception:
        return None


def hamming_distance(h1: str, h2: str) -> int:
    """Count differing bits between two hex hash strings."""
    if not h1 or not h2 or len(h1) != len(h2):
        return 64
    dist = 0
    for c1, c2 in zip(h1, h2):
        xor = int(c1, 16) ^ int(c2, 16)
        dist += bin(xor).count('1')
    return dist
