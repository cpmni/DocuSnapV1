"""
test_harness — additive, TEST-ONLY synthetic-document corpus generator + evaluator
for the Scan Finder OCR/extraction pipeline.

Six cooperating agents over a shared artifact directory:
  1 generator       2 drift        3 ocr_detect
  4 template_anchor 5 metrics      6 reporter

It NEVER edits production code or auto-remediates — it generates a corpus, runs the
project's own stack against it, records failures, tallies recurring problems, and
writes a report with *suggested* fixes only.

Run from python_backend/ so the project modules (extraction.*, ocr.*) import cleanly:
    cd python_backend
    py -3.12 -m test_harness.run --config artifacts/test_harness/config.json
"""
__version__ = "1.0.0"
