# Extraction regression harness

Catches regressions in field-detection/anchoring (keyword matching, anchor
matching, supplier hints, validation) without manually reprocessing documents.

## Run it

```
py -3.12 python_backend/tests/run_regression.py
```

Exit code `0` = everything matches expectations. Exit code `1` = at least one
field regressed — the printed diff shows which fixture, field, expected value,
and actual value.

## How it works

Each `fixtures/*.json` file is self-contained: synthetic OCR text + the
schema/learning data (`field_defs`, `hints`, `anchors`, `templates`) the
engine needs + an `expected` block of `field_key -> value`. The runner feeds
this straight into `ExtractionEngine.extract()` (bypassing Tesseract/PDF
rendering — `page_images=[]`, which every image-dependent stage already
None-guards) and diffs the result against `expected`.

This targets the matching/anchoring/learning *logic* — where the recent bugs
actually lived — not OCR accuracy, and runs instantly with no Tesseract
dependency or version-pinning concerns.

## Adding a fixture

Copy an existing fixture and change the `ocr_text`/`field_defs`/`hints`/
`expected` to represent a **class** of document layout or failure mode you
want to guard against (e.g. "label below value", "column bleed", "supplier
name collides with another supplier's cached data") — not a copy of one
specific real document. Each fixture's `description`/`represents` fields
should explain which broad failure class it guards against, so the suite
stays a regression net for *future* unseen suppliers/templates rather than a
record of past one-off documents.
