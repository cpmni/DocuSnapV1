#!/usr/bin/env python3
"""
tests/test_ocr_no_plaintext.py
-------------------------------
Confirms that process_docs.py's per-document processing loop does NOT write
plaintext *_ocr.txt files to the source folder.

Background: prior versions wrote `{stem}_ocr.txt` alongside each source
document as a "save raw OCR for audit" side-effect. The file was never read
back by any part of the pipeline — ocr_text was always used in-memory. The
write was removed (process_docs.py lines 136-138) because it left unencrypted
OCR content (document text, financial figures, supplier names) in user-visible
source folders with no retention or cleanup policy.

These checks patch out Tesseract/PIL so no real OCR hardware is needed; they
target the process_docs.py file-handling layer in isolation.

Usage:
    py -3.12 python_backend/tests/test_ocr_no_plaintext.py

Exit code 0 = no plaintext OCR files written.  Exit code 1 = regression.
"""

import sys, os, json, tempfile, io
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))
import process_docs   # noqa: E402 — imported after sys.path setup


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def section(title):
    print(f"\n{title}")


def _run_main_with_stubs(folder: Path) -> list[dict]:
    """Run process_docs.main() against `folder` with OCR/engine stubbed out.
    Returns the list of JSON messages emitted to stdout."""
    fake_img = MagicMock()  # PIL Image stand-in
    fake_ocr_text = "ACME CORP\nInvoice No: INV-9999\nTotal: £500.00"

    mock_engine = MagicMock()
    mock_engine.detect_document_type.return_value = {"type": "Invoice", "confidence": 85}
    mock_engine.extract.return_value = {
        "_supplier_name":       "Acme Corp",
        "_document_type":       "Invoice",
        "_overall_confidence":  80,
        "_needs_review":        False,
        "_template_id":         None,
        "_logo_phash":          None,
        "_keyword_fingerprint": [],
        "_mode_used":           "fast",
        "_document_slug":       "invoice",
        "invoice_number": {"value": "INV-9999", "confidence": 85, "method": "keyword"},
        "total_amount":   {"value": "£500.00",  "confidence": 78, "method": "keyword"},
    }

    emitted = []
    def capture_emit(obj):
        emitted.append(obj)

    with patch("process_docs.extract_text_and_images",
               return_value=(fake_ocr_text, [fake_img])), \
         patch("process_docs.ExtractionEngine", return_value=mock_engine), \
         patch("process_docs.configure_tesseract"), \
         patch("process_docs.emit", side_effect=capture_emit), \
         patch("sys.argv", ["process_docs.py", "--folder", str(folder)]):
        process_docs.main()

    return emitted


def main():
    failures = 0

    section("no *_ocr.txt files written to the source folder")

    with tempfile.TemporaryDirectory() as tmpdir:
        folder = Path(tmpdir)
        # Place a minimal supported file so the file loop has something to iterate
        dummy = folder / "test_invoice.png"
        dummy.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)  # PNG header stub

        emitted = _run_main_with_stubs(folder)

        # Primary check: no *_ocr.txt files in the folder
        ocr_txt_files = list(folder.glob("*_ocr.txt"))
        if not check("no *_ocr.txt files in source folder after processing",
                     ocr_txt_files == []):
            failures += 1
            print(f"    found: {[f.name for f in ocr_txt_files]}")

        # Secondary: the original source document is untouched (not deleted/modified)
        if not check("source document is not deleted or modified",
                     dummy.exists()):
            failures += 1

        # Tertiary: pipeline still emitted a file_done event (processing worked)
        done_events = [e for e in emitted if e.get("type") == "file_done"]
        if not check("pipeline still emits a file_done event (extraction unaffected)",
                     len(done_events) == 1 and done_events[0].get("success") is True):
            failures += 1

        # Quaternary: no other unexpected *.txt files were created
        txt_files = list(folder.glob("*.txt"))
        if not check("no *.txt files of any kind left in source folder",
                     txt_files == []):
            failures += 1
            print(f"    found: {[f.name for f in txt_files]}")

    section("source-code audit: the *_ocr.txt write is absent from process_docs.py")

    process_docs_src = (Path(__file__).parent.parent / "process_docs.py").read_text()
    if not check("'_ocr.txt' pattern not present in process_docs.py",
                 "_ocr.txt" not in process_docs_src):
        failures += 1
    if not check("'write_text' not called on an ocr_path in process_docs.py "
                 "(belt-and-braces: no alternative plaintext write snuck in)",
                 "ocr_path.write_text" not in process_docs_src):
        failures += 1

    print()
    if failures:
        print(f"{failures} check(s) failed — plaintext OCR file regression detected.")
        return 1
    print("All checks passed — no plaintext OCR text files are written to source folders.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
