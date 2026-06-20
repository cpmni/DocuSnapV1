# RapidOCR runtime — provisioning & offline model handling (Stage 3)

RapidOCR is an **opt-in, beta** full-page OCR engine. The shipped default is **Tesseract**;
RapidOCR is selected per-install in **Settings → OCR engine** and is used for **full-page
document OCR only**. Zone / teach / anchor / template crop OCR always uses Tesseract. If the
RapidOCR runtime is absent or fails to initialise, the app **falls back to Tesseract
automatically** with a warning log (`python_backend/ocr/engine.py`). Nothing here changes the
default or any crop OCR path.

This document covers how to make RapidOCR actually runnable, offline, in both environments.

---

## 1. Dependencies (commercial-use safe)

Pinned in **`python_backend/requirements-ocr.txt`**:

| Package | Licence | Notes |
|---|---|---|
| `rapidocr-onnxruntime` | Apache-2.0 | The wheel **bundles** the PP-OCR det/rec/cls ONNX models (Apache-2.0) — offline, no download |
| `onnxruntime` | MIT | **CPU** build only — do **not** install `onnxruntime-gpu` |
| `opencv-python` (transitive) | Apache-2.0 | pulled by rapidocr-onnxruntime |
| `pyclipper` (transitive) | BSD-3-Clause | |
| `shapely` (transitive) | BSD-3-Clause | |
| `PyYAML` (transitive) | MIT | |
| `numpy` (already bundled) | BSD-3-Clause | |
| `Pillow` (already bundled) | HPND/MIT-like | |

No GPL/AGPL. PyMuPDF stays out (AGPL) — PDF rendering remains `pypdfium2` (BSD-3). Add
**opencv-python + numpy** to the product's third-party attribution when RapidOCR is bundled.

Approx. added footprint: **~80–180 MB** (the onnxruntime DLLs dominate; the bundled ONNX
models are ~16 MB).

---

## 2. Dev environment (`py -3.12`, system Python)

```bat
py -3.12 -m pip install -r python_backend\requirements-ocr.txt
py -3.12 -c "from rapidocr_onnxruntime import RapidOCR; RapidOCR(); print('RapidOCR OK')"
```

Then set **Settings → OCR engine → RapidOCR (beta)** (or `ocr_engine=rapidocr` in the DB) and
process a document. Until installed, selecting RapidOCR simply falls back to Tesseract.

## 3. Packaged environment (bundled `vendor/python`)

The standard build now bundles RapidOCR — it is a **REQUIRED** step in **`BUILD.txt` Part 3.1
STEP A**, run right after creating `vendor\python`:

```bat
vendor\python\Scripts\pip install -r python_backend\requirements-ocr.txt
```

This installs the package **and its bundled PP-OCR models** into the venv. The app still
defaults to Tesseract and falls back to it automatically; bundling only makes the per-install
**Settings → OCR engine** toggle work without the customer installing anything.

> ⚠ **`vendor\python` MUST be Python 3.12.** `rapidocr-onnxruntime` publishes **no wheels for
> Python ≥ 3.13** (every release is `Requires-Python <3.13`), so this `pip install` cannot
> resolve on a 3.13/3.14 venv and RapidOCR would be silently absent. Build the venv with
> `py -3.12 -m venv` (BUILD.txt §1.2 already mandates 3.12) and verify
> `vendor\python\Scripts\python.exe --version` reports 3.12.x first.
>
> The backend ships **numpy 2.x**, so `onnxruntime` must be **≥ 1.19** (older builds were
> compiled against numpy 1.x and fail to load) — already pinned in `requirements-ocr.txt`.

---

## 4. Model files & where they live (offline)

`rapidocr-onnxruntime` ships its three default models **inside the wheel**, so a normal
`pip install` places them on disk — **no network fetch**:

```
<dev>      <site-packages>/rapidocr_onnxruntime/models/   (det + rec + cls .onnx)
<packaged> vendor/python/Lib/site-packages/rapidocr_onnxruntime/models/
```

The three model roles required are **detection** (text regions), **recognition** (text), and
**classification** (orientation/angle). With the default install you do not place any files
yourself — they come with the package.

### Optional: point RapidOCR at your own local models
`ocr/engine.py` honours an optional env var **`RAPIDOCR_MODEL_DIR`**. If it is set to a folder
that contains `det.onnx`, `rec.onnx` and `cls.onnx`, those explicit local paths are used;
otherwise the bundled package models are used. Either way **no download ever occurs**. Use this
only if you want to substitute custom/pinned PP-OCRv4/v5 models; the default needs nothing.

---

## 5. Verify fully-offline behaviour

1. Provision the runtime (section 2 or 3) on a machine **with** network.
2. **Disconnect the network** (or run on an isolated VM).
3. Run the check in section 2 — it must construct `RapidOCR()` and read a page **without any
   network access** (no model download). If it tries to fetch, the bundled models are missing —
   reinstall `rapidocr-onnxruntime` and confirm the `models/` folder is populated.
4. In the app, select RapidOCR and process a document offline; confirm full-page text is
   produced and crop/zone reads are unchanged (still Tesseract).

---

## 6. Status / what remains

- **Opt-in & fallback-safe:** default is Tesseract; RapidOCR only runs when explicitly selected,
  and any failure falls back to Tesseract. ✔ (landed)
- **This stage:** dependency pin + offline model documentation + the optional local-path env
  override. No default flip, no UI change, no crop-path change, no installer automation.
- **Still ahead (separate stages):** the per-field **bake-off harness** (compare RapidOCR vs
  Tesseract on a real confirmed corpus, scored through the crop/anchor paths) and only then the
  **default-flip decision**. Do not flip the default before that evidence exists.
