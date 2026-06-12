"""
tests/test_anchor_drift.py
--------------------------
Unit tests for anchor.py's drift-tolerant crosscheck behaviour.

The root problem: anchor_crop uses stored absolute (x_norm, y_norm) coordinates
that shift when page-registration differs between scans.  When the crop lands on
wrong content it returns a plausible-looking but incorrect value, which
suppressed the text-search fallback under the old "if not value" guard.

The fix: always run the text-based search, compare against the crop result, and
for direction=right anchors prefer the text result when they disagree (text is
anchored to the label string, so it is inherently drift-tolerant).
direction=below/above retain the old fallback-only behaviour to avoid
column-bleed regressions in multi-column layouts.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import unittest
from unittest.mock import patch

from PIL import Image

from extraction.anchor import extract_with_anchors, _values_agree


# ── helpers ──────────────────────────────────────────────────────────────────

def _blank_page():
    """Minimal white PIL Image — just needs to be non-None so crop path runs."""
    return Image.new("RGB", (1200, 1600), color="white")


def _anchor(direction="right", x_norm=0.5, y_norm=0.3, w_norm=0.2, h_norm=0.04):
    return [{
        "field_key":    "customer_name",
        "anchor_label": "Customer Name",
        "direction":    direction,
        "usage_count":  5,
        "confidence":   0.9,
        "x_norm":       x_norm,
        "y_norm":       y_norm,
        "w_norm":       w_norm,
        "h_norm":       h_norm,
    }]


# ── _values_agree ─────────────────────────────────────────────────────────────

class TestValuesAgree(unittest.TestCase):
    def test_identical(self):
        self.assertTrue(_values_agree("INV-001", "INV-001"))

    def test_case_insensitive(self):
        self.assertTrue(_values_agree("Belfast", "belfast"))

    def test_crop_substring_of_text(self):
        # Crop returned exact name; text got the full address line — still agree
        self.assertTrue(_values_agree(
            "Beaumont Care Homes Ltd",
            "Beaumont Care Homes Ltd - Tuderdale",
        ))

    def test_text_substring_of_crop(self):
        self.assertTrue(_values_agree(
            "Beaumont Care Homes Ltd - Tuderdale",
            "Beaumont Care Homes Ltd",
        ))

    def test_different_values(self):
        self.assertFalse(_values_agree("Belfast", "Beaumont Care Homes Ltd"))

    def test_whitespace_stripped(self):
        self.assertTrue(_values_agree("  INV-001  ", "INV-001"))

    def test_empty_vs_value(self):
        self.assertFalse(_values_agree("", "Belfast"))

    def test_short_string_not_substring(self):
        # "a" is a character inside many strings — must NOT count as agreement
        self.assertFalse(_values_agree("a", "Beaumont Care Homes Ltd"))

    def test_very_short_vs_identical(self):
        # Exact equality still works even for short strings
        self.assertTrue(_values_agree("hs", "hs"))

    def test_four_char_not_substring(self):
        # 4 chars is below the minimum — substring match NOT accepted
        self.assertFalse(_values_agree("Belf", "Belfast"))

    def test_five_char_substring_matches(self):
        # 5 chars meets the minimum — substring match accepted
        self.assertTrue(_values_agree("Belfa", "Belfast"))


# ── crosscheck behaviour ──────────────────────────────────────────────────────

class TestAnchorDriftCrosscheck(unittest.TestCase):

    # direction=right — crop vs text crosscheck is active

    def test_right_agree_crop_reported(self):
        """When crop and text agree, anchor_crop method is used (no change)."""
        ocr = "Customer Name: Beaumont Care Homes Ltd"
        with patch("extraction.anchor._crop_and_ocr", return_value="Beaumont Care Homes Ltd"):
            r = extract_with_anchors(
                ocr, _anchor("right"), "Document Solutions", "job_worksheet",
                page_images=[_blank_page()],
            )
        self.assertEqual(r["customer_name"]["value"], "Beaumont Care Homes Ltd")
        self.assertEqual(r["customer_name"]["method"], "anchor_crop")

    def test_right_drift_text_wins(self):
        """When crop returns a drifted value and text finds the right one, text wins."""
        ocr = "Customer Name: Beaumont Care Homes Ltd"
        with patch("extraction.anchor._crop_and_ocr", return_value="Belfast"):
            r = extract_with_anchors(
                ocr, _anchor("right"), "Document Solutions", "job_worksheet",
                page_images=[_blank_page()],
            )
        self.assertEqual(r["customer_name"]["value"], "Beaumont Care Homes Ltd")
        self.assertEqual(r["customer_name"]["method"], "anchor")

    def test_right_crop_ok_no_text_label(self):
        """When crop returns a value but the label is absent from OCR, crop is discarded.

        The anchor was recorded on a different document variant — the saved coordinates
        have no label to anchor them and may point at unrelated content.
        """
        ocr = "Some other content without the label"
        with patch("extraction.anchor._crop_and_ocr", return_value="Beaumont Care Homes Ltd"):
            r = extract_with_anchors(
                ocr, _anchor("right"), "Document Solutions", "job_worksheet",
                page_images=[_blank_page()],
            )
        # Label absent → crop discarded → field missing
        self.assertNotIn("customer_name", r)

    def test_right_crop_fails_text_fills(self):
        """When crop returns None (bad crop area), text-search fills in."""
        ocr = "Customer Name: Beaumont Care Homes Ltd"
        with patch("extraction.anchor._crop_and_ocr", return_value=None):
            r = extract_with_anchors(
                ocr, _anchor("right"), "Document Solutions", "job_worksheet",
                page_images=[_blank_page()],
            )
        self.assertEqual(r["customer_name"]["value"], "Beaumont Care Homes Ltd")
        self.assertEqual(r["customer_name"]["method"], "anchor")

    def test_right_no_page_image_text_only(self):
        """Without a page image the crop path never runs; text-search is used."""
        ocr = "Customer Name: Beaumont Care Homes Ltd"
        r = extract_with_anchors(
            ocr, _anchor("right"), "Document Solutions", "job_worksheet",
        )
        self.assertEqual(r["customer_name"]["value"], "Beaumont Care Homes Ltd")
        self.assertEqual(r["customer_name"]["method"], "anchor")

    def test_right_crop_extended_text_agrees(self):
        """Text returning a superset of the crop value still counts as agreement."""
        ocr = "Customer Name: Beaumont Care Homes Ltd - Tuderdale"
        with patch("extraction.anchor._crop_and_ocr", return_value="Beaumont Care Homes Ltd"):
            r = extract_with_anchors(
                ocr, _anchor("right"), "Document Solutions", "job_worksheet",
                page_images=[_blank_page()],
            )
        # Crop is a substring of text -> they agree -> anchor_crop method kept
        self.assertEqual(r["customer_name"]["method"], "anchor_crop")

    # direction=below — crosscheck NOT active; old fallback-only behaviour

    def test_below_drift_crop_retained(self):
        """For direction=below, the crop result is kept even when text differs."""
        ocr = "Customer Name:\nBeaumont Care Homes Ltd"
        with patch("extraction.anchor._crop_and_ocr", return_value="Belfast"):
            r = extract_with_anchors(
                ocr, _anchor("below"), "Document Solutions", "job_worksheet",
                page_images=[_blank_page()],
            )
        # Crop wins; text search is a fallback, not a crosscheck for below
        self.assertEqual(r["customer_name"]["value"], "Belfast")
        self.assertEqual(r["customer_name"]["method"], "anchor_crop")

    def test_below_crop_fails_text_fills(self):
        """For direction=below, text-search still fills in when crop fails."""
        ocr = "Customer Name:\nBeaumont Care Homes Ltd"
        with patch("extraction.anchor._crop_and_ocr", return_value=None):
            r = extract_with_anchors(
                ocr, _anchor("below"), "Document Solutions", "job_worksheet",
                page_images=[_blank_page()],
            )
        self.assertEqual(r["customer_name"]["value"], "Beaumont Care Homes Ltd")
        self.assertEqual(r["customer_name"]["method"], "anchor")

    # Both paths fail

    def test_label_absent_crop_discarded(self):
        """When crop returns something but the label is absent from OCR, crop is discarded.

        This is the position-drift-plus-layout-change case: coordinates were saved
        for a document variant that HAS a "Customer Name:" label; on this variant
        the field is called "Work Address:" so the label is nowhere in the OCR text.
        The crop lands on unrelated content at the stale coordinates and must be
        silently dropped so the field shows as empty (needs review) not wrong.
        """
        ocr = "Work Address: Beaumont Care Homes Ltd\nTicket Logged: 31/03/2026"
        with patch("extraction.anchor._crop_and_ocr", return_value="Belfast"):
            r = extract_with_anchors(
                ocr, _anchor("right"), "Document Solutions", "job_worksheet",
                page_images=[_blank_page()],
            )
        # "Customer Name" is not in the OCR text → crop discarded → field absent
        self.assertNotIn("customer_name", r)

    def test_label_present_no_inline_value_crop_used(self):
        """When the label IS in OCR but no inline value (e.g. value in a box below),
        the crop result is kept — the label's presence confirms the coordinates
        are plausibly aimed at the right region."""
        ocr = "Customer Name:\n"   # label on page, value in a separate box cell
        with patch("extraction.anchor._crop_and_ocr", return_value="Beaumont Care Homes Ltd"):
            r = extract_with_anchors(
                ocr, _anchor("right"), "Document Solutions", "job_worksheet",
                page_images=[_blank_page()],
            )
        self.assertEqual(r["customer_name"]["value"], "Beaumont Care Homes Ltd")
        self.assertEqual(r["customer_name"]["method"], "anchor_crop")

    def test_no_value_at_all(self):
        """If both crop and text fail, the field is absent from results."""
        ocr = "Completely unrelated content"
        with patch("extraction.anchor._crop_and_ocr", return_value=None):
            r = extract_with_anchors(
                ocr, _anchor("right"), "Document Solutions", "job_worksheet",
                page_images=[_blank_page()],
            )
        self.assertNotIn("customer_name", r)


if __name__ == "__main__":
    unittest.main()
