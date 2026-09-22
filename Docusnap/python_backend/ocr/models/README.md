# Vendored OCR model — PP-OCR English recognition (rec-only fallback)

`rec.onnx` is the recognition-only model for the confusable-glyph slice fallback
(`ocr/glyph_reader.py`, S0 — Oracle SIGN-OFF-W/COND 2026-09-22). It is read via
onnxruntime directly; the character dictionary is embedded in the model's ONNX metadata
(`custom_metadata_map["character"]`, 95 chars), so no separate dict file ships.

- **File:** `rec.onnx` = `en_PP-OCRv3_rec_infer.onnx` (English/Latin PP-OCRv3 recognition,
  8.97 MB, input NCHW `[?,3,48,?]`, output `[?,T,97]`).
- **SHA-256:** see `rec.onnx.sha256` (pinned; the determinism gate checks the running
  model against it).
- **Source:** RapidOCR model hub —
  `https://huggingface.co/spaces/RapidAI/RapidOCR/resolve/main/models/text_rec/en_PP-OCRv3_rec_infer.onnx`
  (downloaded 2026-09-22).
- **Licence:** Apache-2.0 (PP-OCR / PaddleOCR weights). Free for commercial use.
  Add the PP-OCR model + onnxruntime (MIT) entries to `THIRD-PARTY-LICENSES.txt` /
  `COMPLIANCE.md` when this fallback is wired into a shipping build (S1/packaging).

To re-obtain or update: download the file above, drop it here as `rec.onnx`, and refresh
`rec.onnx.sha256` (`sha256sum rec.onnx`). The engine also accepts an override path via the
`GLYPH_REC_MODEL` env var (used by the parity/efficacy harnesses).
