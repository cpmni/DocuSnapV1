"""
extraction/anchor.py
--------------------
Stage 2 extraction — spatial anchor matching.
Uses learned label positions to find field values directly in OCR text.
Faster and more accurate than LLM for known document layouts.
"""

from PIL import Image


def extract_with_anchors(ocr_text: str, anchors: list[dict],
                         supplier_name: str | None,
                         document_type: str | None) -> dict:
    """
    Attempt to extract field values using saved structural anchors.
    Returns dict of {field_key: {"value": str, "confidence": int, "method": "anchor"}}
    Only includes fields where an anchor match was found.
    """
    if not anchors or not ocr_text:
        return {}

    # Filter anchors relevant to this supplier + doc type
    relevant = _filter_anchors(anchors, supplier_name, document_type)
    if not relevant:
        return {}

    lines   = ocr_text.split("\n")
    results = {}

    for anchor in relevant:
        field_key    = anchor["field_key"]
        label        = anchor["anchor_label"].lower().strip()
        direction    = anchor["direction"]
        usage_count  = anchor.get("usage_count", 1)
        conf_factor  = anchor.get("confidence", 0.5)

        if field_key in results:
            continue  # already found by higher-priority anchor

        for i, line in enumerate(lines):
            if label not in line.lower():
                continue

            value = None

            if direction == "right":
                # Value is on the same line after the label
                idx       = line.lower().find(label)
                remainder = line[idx + len(label):].strip().lstrip(":").strip()
                if remainder:
                    value = remainder

            elif direction == "below":
                # Value is on the next non-empty line
                for j in range(i + 1, min(i + 4, len(lines))):
                    candidate = lines[j].strip()
                    if candidate:
                        value = candidate
                        break

            elif direction == "above":
                for j in range(i - 1, max(i - 4, -1), -1):
                    candidate = lines[j].strip()
                    if candidate:
                        value = candidate
                        break

            if value:
                # Confidence based on usage count and stored confidence
                conf = min(95, 55 + (usage_count * 5) + int(conf_factor * 20))
                results[field_key] = {
                    "value":      value.strip(),
                    "confidence": conf,
                    "method":     "anchor",
                    "anchor":     anchor["anchor_label"],
                }
                break

    return results


def try_logo_supplier_match(page_image: Image.Image,
                            logos: list[dict],
                            threshold: int = 12) -> dict | None:
    """
    Attempt to identify supplier from logo perceptual hash.
    Returns {"supplier_name": str, "confidence": int} or None.
    """
    if not logos or page_image is None:
        return None

    try:
        import imagehash
        from PIL import ImageOps, ImageFilter

        w, h   = page_image.size
        crop   = page_image.crop((0, 0, w // 2, h // 5)).convert("L")
        crop   = ImageOps.autocontrast(crop, cutoff=5)
        crop   = crop.resize((256, 256), Image.LANCZOS)
        crop   = crop.filter(ImageFilter.GaussianBlur(radius=1))
        phash  = str(imagehash.phash(crop, hash_size=8))

        best = None
        best_dist = threshold + 1

        for fp in logos:
            dist = _hamming(phash, fp.get("phash", ""))
            if dist < best_dist:
                best_dist = dist
                best = {
                    "supplier_name": fp["supplier_name"],
                    "confidence":    max(0, 100 - dist * 6),
                    "match_count":   fp.get("match_count", 1),
                }

        return best if best and best["confidence"] >= 60 else None

    except ImportError:
        return None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _filter_anchors(anchors: list[dict],
                    supplier_name: str | None,
                    document_type: str | None) -> list[dict]:
    """
    Return anchors relevant to this supplier/doc type, sorted by priority.
    Priority: exact supplier+type match > supplier only > type only > global
    """
    def priority(a):
        s_match = (a.get("supplier_name") or "").lower() in \
                  (supplier_name or "").lower()
        t_match = (a.get("document_type") or "") == (document_type or "")
        if s_match and t_match: return 0
        if s_match:             return 1
        if t_match:             return 2
        return 3

    filtered = [
        a for a in anchors
        if _anchor_matches(a, supplier_name, document_type)
    ]
    return sorted(filtered, key=lambda a: (priority(a), -a.get("usage_count", 1)))


def _anchor_matches(anchor: dict, supplier_name: str | None,
                    document_type: str | None) -> bool:
    a_sup  = (anchor.get("supplier_name") or "").lower()
    a_type = anchor.get("document_type") or ""
    s_name = (supplier_name or "").lower()
    d_type = document_type or ""

    # Global anchors always apply
    if a_sup in ("__unknown__", "__global__", ""):
        return True
    # Supplier match (partial)
    if a_sup and s_name and (a_sup in s_name or s_name in a_sup):
        return True
    # Doc type match
    if a_type and d_type and a_type == d_type:
        return True

    return False


def _hamming(h1: str, h2: str) -> int:
    if not h1 or not h2 or len(h1) != len(h2):
        return 64
    dist = 0
    for c1, c2 in zip(h1, h2):
        xor = int(c1, 16) ^ int(c2, 16)
        dist += bin(xor).count("1")
    return dist
