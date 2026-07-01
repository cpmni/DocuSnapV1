"""
Guard test for the thousands-separator comma-clip: a currency value whose thousands
separator OCR'd as a SPACE (or split across word tokens) — "$10,576.31" -> "$10 576.31"
— was TRUNCATED to "$10" by the contiguous currency pattern in _clean_text_fallback (the
anchor_inline path), and left malformed ("$10 576.31") by clean_crop_segment. Both now
rejoin the thousands separator first. No OCR needed — pure string cleaning.
"""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extraction import anchor  # noqa: E402

VP = json.load(open(Path(__file__).resolve().parents[2] / "config" / "keyword_patterns.json"))["validation_patterns"]

fail = 0
def check(label, cond):
    global fail
    print(f"  {'OK ' if cond else 'BAD'} {label}")
    if not cond:
        fail += 1

print("_normalise_currency_spacing:")
NS = anchor._normalise_currency_spacing
check("space thousands sep rejoined", NS("$10 576.31") == "$10,576.31")
check("comma+space rejoined", NS("$10, 576.31") == "$10,576.31")
check("millions (two groups) rejoined", NS("$1 234 567.89") == "$1,234,567.89")
check("already contiguous untouched", NS("$10,576.31") == "$10,576.31")
check("no thousands group -> untouched", NS("$248.81") == "$248.81")
check("no space -> returned verbatim", NS("$10") == "$10")
check("not-a-thousands-group (4 digits) untouched", NS("$10 5764") == "$10 5764")
check("None safe", NS(None) is None)

print("\n_clean_text_fallback (anchor_inline path) — currency no longer truncated:")
CF = lambda v: anchor._clean_text_fallback(v, "currency", VP)
check("'$10 576.31' -> '$10,576.31' (was '$10')", CF("$10 576.31") == "$10,576.31")
check("'$10, 576.31' -> '$10,576.31'", CF("$10, 576.31") == "$10,576.31")
check("'$1 234 567.89' -> full", CF("$1 234 567.89") == "$1,234,567.89")
check("contiguous '$10,576.31' unchanged", CF("$10,576.31") == "$10,576.31")
check("small value '$248.81' unchanged", CF("$248.81") == "$248.81")
check("no-comma '$10' unchanged", CF("$10") == "$10")

print("\nclean_crop_segment (anchor_crop path) — currency rejoined, not left spaced:")
CC = lambda v: anchor.clean_crop_segment(v, "currency")
check("'$10 576.31' -> '$10,576.31'", CC("$10 576.31") == "$10,576.31")
check("'$1 234 567.89' -> full", CC("$1 234 567.89") == "$1,234,567.89")

print("\nfree-text is NOT affected (only val_type=='currency' rejoins):")
check("text 'Ann Blume 10 115' kept whole", anchor.clean_crop_segment("Ann Blume 10 115", "text") == "Ann Blume 10 115")
check("text field currency-looking value untouched", anchor.clean_crop_segment("Unit 4 100", "text") == "Unit 4 100")

print(f"\n{fail} check(s) FAILED" if fail else "\nAll currency-spacing checks passed.")
sys.exit(1 if fail else 0)
