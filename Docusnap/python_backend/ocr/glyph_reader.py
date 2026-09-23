"""Deterministic recognition-only OCR fallback (PP-OCR rec model via onnxruntime).

S0 of the confusable-glyph slice-fallback (Oracle SIGN-OFF-W/COND 2026-09-22, re-rule
on the live Print Tracker exhibit; oscar consensus). This module is the ENGINE ONLY —
it reads one pre-located crop with a second, architecturally-independent recognizer and
returns (text, confidence). It has NO caller yet and touches no pipeline decision, so it
is DARK by construction (S1 wires the PP-vs-Tesseract *disagreement* hold; S2 the census).

Why a direct onnxruntime call (not the rapidocr wrapper): rec-only needs neither the
detection/classification models nor opencv/shapely/pyclipper — this sheds that mass and
pins determinism ourselves. Preprocess + CTC decode replicate rapidocr's
`ch_ppocr_rec` EXACTLY (verified string-for-string by test_glyph_reader_parity.py over the
222 study slices) so we can drop the wrapper with zero accuracy change.

DETERMINISM (Oracle C5 — this read is persisted): a single ORT session, threads pinned to
1, sequential execution, fixed graph-opt level, a fixed input-height (48) with width
letterboxed per-crop, and the DECODED STRING persisted (never logits). The same crop must
read byte-identical across two calls and two processes (pinned by the parity/determinism
test).

Licences: onnxruntime MIT, PP-OCR rec weights + dict Apache-2.0, numpy BSD-3, Pillow HPND —
all free for commercial use, nothing copyleft.

Runtime is embeddable Python (vendor/python): callers `sys.path.insert` then
`from ocr.glyph_reader import read_crop`, never a bare import (the embeddable _pth drops the
script dir — the standing CLAUDE.md gotcha).
"""
from __future__ import annotations

import os
import math
import threading

import numpy as np
from PIL import Image

# onnxruntime is an OPTIONAL dependency: absent in a build that hasn't vendored it yet →
# this module imports fine and read_crop() returns None (fail-toward-Tesseract-only).
try:
    import onnxruntime as _ort
    _ORT_OK = True
except Exception:
    _ort = None
    _ORT_OK = False

# rec model input geometry (PP-OCRv4 rec; matches rapidocr config.yaml rec_img_shape)
_IMG_C, _IMG_H, _IMG_W = 3, 48, 320
_DEFAULT_MAX_WH = _IMG_W / _IMG_H  # 320/48

_LOCK = threading.Lock()
_STATE = {"sess": None, "chars": None, "model": None}


def _resolve_model_path() -> str | None:
    """Where the rec ONNX lives. Priority: explicit env → vendored beside the app →
    (dev only) the rapidocr-bundled model, so the engine + parity test run before we
    vendor our own copy. Returns None if nothing is found (→ read_crop yields None)."""
    env = os.environ.get("GLYPH_REC_MODEL")
    if env and os.path.isfile(env):
        return env
    here = os.path.dirname(os.path.abspath(__file__))
    for cand in (
        os.path.join(here, "models", "rec.onnx"),          # vendored (S0 follow-up)
        os.path.join(here, "..", "models", "rec.onnx"),
    ):
        if os.path.isfile(cand):
            return cand
    # dev fallback: the rapidocr-bundled rec model (NOT shipped — dev/test only)
    try:
        import rapidocr_onnxruntime as _r
        import glob
        base = os.path.dirname(_r.__file__)
        hits = [f for f in glob.glob(os.path.join(base, "**", "*.onnx"), recursive=True)
                if "rec" in os.path.basename(f).lower()]
        if hits:
            return hits[0]
    except Exception:
        pass
    return None


def _session_options():
    so = _ort.SessionOptions()
    so.intra_op_num_threads = 1
    so.inter_op_num_threads = 1
    so.execution_mode = _ort.ExecutionMode.ORT_SEQUENTIAL
    # fixed, explicit optimisation level — pinned so an ORT default change can't move a read
    so.graph_optimization_level = _ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return so


def _load():
    """Lazy, once-per-process. Returns (session, char_list) or (None, None)."""
    if not _ORT_OK:
        return None, None
    if _STATE["sess"] is not None:
        return _STATE["sess"], _STATE["chars"]
    with _LOCK:
        if _STATE["sess"] is not None:
            return _STATE["sess"], _STATE["chars"]
        model = _resolve_model_path()
        if not model:
            return None, None
        try:
            sess = _ort.InferenceSession(
                model, sess_options=_session_options(),
                providers=["CPUExecutionProvider"])
            meta = sess.get_modelmeta().custom_metadata_map
            base = meta["character"].splitlines()
            # rapidocr order: ['blank'] + dict chars + [' ']  (blank idx 0, space last)
            chars = ["blank"] + base + [" "]
            _STATE.update(sess=sess, chars=chars, model=model)
            return sess, chars
        except Exception:
            return None, None


def _to_3ch_uint8(img) -> np.ndarray:
    """Accept a PIL image or an ndarray; return an HxWx3 uint8 array (grey replicated to
    3 channels if needed — the rec model expects 3ch and normalises symmetrically)."""
    if isinstance(img, Image.Image):
        arr = np.asarray(img.convert("RGB"))
    else:
        arr = np.asarray(img)
        if arr.ndim == 2:
            arr = np.stack([arr] * 3, axis=-1)
        elif arr.shape[2] == 4:
            arr = arr[:, :, :3]
    return arr.astype(np.uint8)


def _cv2_bilinear(arr: np.ndarray, out_w: int, out_h: int) -> np.ndarray:
    """cv2.resize(INTER_LINEAR)-equivalent bilinear in pure numpy (half-pixel centres,
    border-clamped, no antialias) so the direct path reproduces rapidocr (which uses
    cv2.resize) EXACTLY, without shipping OpenCV. `arr` HxWxC → out_h×out_w×C float32."""
    h, w = arr.shape[:2]
    a = arr.astype(np.float32)
    # half-pixel centre convention: src = (dst + 0.5) * scale - 0.5
    sx = (np.arange(out_w, dtype=np.float32) + 0.5) * (w / out_w) - 0.5
    sy = (np.arange(out_h, dtype=np.float32) + 0.5) * (h / out_h) - 0.5
    x0 = np.floor(sx).astype(np.int32); y0 = np.floor(sy).astype(np.int32)
    fx = (sx - x0)[None, :, None]; fy = (sy - y0)[:, None, None]
    x0c = np.clip(x0, 0, w - 1); x1c = np.clip(x0 + 1, 0, w - 1)
    y0c = np.clip(y0, 0, h - 1); y1c = np.clip(y0 + 1, 0, h - 1)
    top = a[y0c][:, x0c] * (1 - fx) + a[y0c][:, x1c] * fx
    bot = a[y1c][:, x0c] * (1 - fx) + a[y1c][:, x1c] * fx
    return top * (1 - fy) + bot * fy


def _resize_norm(arr: np.ndarray, max_wh_ratio: float) -> np.ndarray:
    """Replicate rapidocr `resize_norm_img` (single image): resize to height 48 keeping
    aspect (clamped to the letterbox width), /255, mean/std 0.5, CHW, right-pad with
    zeros. Uses a cv2-equivalent numpy bilinear (_cv2_bilinear) so the decoded string is
    identical to rapidocr on all 222 study slices — verified by parity_check.py."""
    img_w = int(_IMG_H * max_wh_ratio)
    h, w = arr.shape[:2]
    ratio = w / float(h)
    resized_w = img_w if math.ceil(_IMG_H * ratio) > img_w else int(math.ceil(_IMG_H * ratio))
    resized_w = max(1, resized_w)
    r = _cv2_bilinear(arr, resized_w, _IMG_H)
    r = r.transpose((2, 0, 1)) / 255.0
    r -= 0.5
    r /= 0.5
    pad = np.zeros((_IMG_C, _IMG_H, img_w), dtype=np.float32)
    pad[:, :, 0:resized_w] = r
    return pad


def _ctc_decode(preds: np.ndarray, chars: list) -> tuple[str, float, float]:
    """Greedy CTC: argmax per timestep, drop blank (idx 0), collapse consecutive repeats,
    conf = mean of the kept per-step maxima. Mirrors rapidocr CTCLabelDecode.
    Third element (2026-09-23, Oracle C1 for the confusable RELEASE): the MIN of the kept
    per-step maxima — the weakest single glyph. A 0.95 MEAN over an 8-glyph code can hide
    one glyph near 0.6, and the confusable glyph is the only one that matters. Text and
    mean are unchanged (222/222 rapidocr parity holds on [0]/[1]); every existing caller
    indexes [0]/[1] only."""
    idx = preds.argmax(axis=2)[0]
    prob = preds.max(axis=2)[0]
    sel = np.ones(len(idx), dtype=bool)
    sel[1:] = idx[1:] != idx[:-1]      # is_remove_duplicate=True
    sel &= idx != 0                    # blank
    kept_idx = idx[sel]
    kept_prob = prob[sel]
    text = "".join(chars[i] for i in kept_idx)
    conf = float(np.mean(kept_prob)) if len(kept_prob) else 0.0
    gmin = float(np.min(kept_prob)) if len(kept_prob) else 0.0
    return text, conf, gmin


def prep_crop(img):
    """The FROZEN preprocessing the fallback feeds the model (oscar C7): greyscale →
    upscale so the text cap-height lands near 48px (LANCZOS) → a light, fixed unsharp mask
    (sharpens the serif the model reads). Measured best on the study slices; do NOT add
    binarise / CLAHE / JPEG (all measured to HURT a CNN recognizer). Returns a PIL 'L'
    image. Any failure returns the plain greyscale (never raises)."""
    try:
        from PIL import ImageFilter
        g = img.convert("L") if isinstance(img, Image.Image) else Image.fromarray(np.asarray(img)).convert("L")
        w, h = g.size
        scale = max(1.0, min(8.0, 48.0 / max(1.0, h / 1.6)))
        if scale > 1.01:
            g = g.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        return g.filter(ImageFilter.UnsharpMask(radius=1.5, percent=110, threshold=3))
    except Exception:
        try:
            return img.convert("L")
        except Exception:
            return img


def available() -> bool:
    """True iff the engine can actually run (onnxruntime present AND a model resolvable)."""
    sess, _ = _load()
    return sess is not None


def read_crop(img) -> tuple[str, float, float] | None:
    """Read one pre-located crop with the PP-OCR rec model. `img` is a PIL image or an
    ndarray (the RAW crop; the caller applies the frozen grey→upscale→unsharp prep before
    calling). Returns (text, confidence 0-1, weakest-glyph confidence 0-1) or None if the
    engine is unavailable or the read fails. Never raises into extraction."""
    try:
        sess, chars = _load()
        if sess is None:
            return None
        arr = _to_3ch_uint8(img)
        if arr.shape[0] < 2 or arr.shape[1] < 2:
            return None
        max_wh = max(_DEFAULT_MAX_WH, arr.shape[1] / float(arr.shape[0]))
        x = _resize_norm(arr, max_wh)[np.newaxis, :].astype(np.float32)
        inp = sess.get_inputs()[0].name
        preds = sess.run(None, {inp: x})[0]
        return _ctc_decode(preds, chars)
    except Exception:
        return None
