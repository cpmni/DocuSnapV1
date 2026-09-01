"""Pins the OCR-recipe stamp + the emit-key decision (Quick Reprocess, 2026-09-01; gary → Oracle C3/C6).

The recipe stamp is what lets a later "Quick" reprocess reuse the stored full-page text and skip the
render + per-field crop OCR. A future dev must not be able to quietly:
  - stamp a recipe onto text THIS run did not produce (a cached-text reuse or a --reextract) — that would
    let Quick reuse OCR the current pipeline never actually ran;
  - forget `imageless:true` on a --reextract (the handler's no-image merge guards key off it);
  - build the recipe from settings at reprocess time instead of the runtime-actual DPI/light levels;
  - bump the Python pipeline rev without moving the JS mirror (a one-sided bump silently keeps Quick alive
    across an OCR change) — pinned cross-language in test_ocr_cache_usable.js against this constant.

Pure-function pins (no OCR spawned): the emit decision + the recipe builder read env, not pixels.

  ELECTRON is not needed; run with the bundled/py interpreter:
  py -3.12 python_backend/tests/test_reextract_recipe.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from process_docs import _ocr_recipe_emit_keys, _deskew_retry_should_run
from ocr.tesseract import current_ocr_recipe_meta, get_tesseract_version, OCR_PIPELINE_REV

fails = []
def check(name, cond):
    if not cond: fails.append(name)

def _set(**env):
    for k, v in env.items():
        if v is None: os.environ.pop(k, None)
        else:         os.environ[k] = str(v)

# ── which keys the file_done emit carries ──────────────────────────────────────────────────────────
# A fresh render/OCR run (no --reextract, no cached text) → the recipe, and nothing else.
_set(OCR_RENDER_DPI="200", OCR_LIGHT_TEXT_RECOVERY=None)
k = _ocr_recipe_emit_keys(False, None, False, False)
check("fresh run emits ocr_recipe", "ocr_recipe" in k and "imageless" not in k)
check("fresh run recipe is a dict with the runtime-actual DPI", k["ocr_recipe"].get("dpi") == 200)

# A cached-text reuse (Reprocess-All today stages documents.ocr_text) → NEITHER key: the stored recipe
# already describes that text, and no pixels were read this run.
check("cached-text reuse emits NO recipe and NO imageless", _ocr_recipe_emit_keys(False, "some stored page text", False, False) == {})
check("whitespace-only cache is treated as no cache (fresh)", "ocr_recipe" in _ocr_recipe_emit_keys(False, "   \n ", False, False))

# A --reextract (imageless) run → imageless:true, never a recipe (it read no pixels).
check("--reextract emits imageless:true, no recipe", _ocr_recipe_emit_keys(True, None, False, False) == {"imageless": True})
check("--reextract WITH cached text still emits imageless (reextract dominates)", _ocr_recipe_emit_keys(True, "stored text", False, False) == {"imageless": True})

# ── the recipe reflects RUNTIME-ACTUAL values, not settings re-read ─────────────────────────────────
_set(OCR_RENDER_DPI="150", OCR_LIGHT_TEXT_RECOVERY="1", OCR_LIGHT_TEXT_LEVELS="205,215")
r = current_ocr_recipe_meta(bd_enabled=True, bd_used=False)
check("dpi is the DPI actually in force", r["dpi"] == 150)
check("light is the list of levels actually run when recovery is ON", r["light"] == [205, 215])
check("bd flag reflects the born-digital arg", r["bd"] is True)
check("bd_used reflects actual provenance, independent of bd", r["bd_used"] is False)
check("rev is the module constant", r["rev"] == OCR_PIPELINE_REV and isinstance(OCR_PIPELINE_REV, int))
check("tess is a string (best-effort, never raises)", isinstance(r["tess"], str))

# light OFF → light is null (an OFF→ON flip is therefore a visible recipe change ocrCacheUsable can catch)
_set(OCR_LIGHT_TEXT_RECOVERY=None, OCR_LIGHT_TEXT_LEVELS=None)
check("light is null when the recovery pass did not run", current_ocr_recipe_meta(False, False)["light"] is None)

# a bad/out-of-band DPI clamps to 300 in the recipe exactly as the render does
_set(OCR_RENDER_DPI="99999")
check("out-of-band DPI clamps to 300 in the recipe", current_ocr_recipe_meta(False, False)["dpi"] == 300)
_set(OCR_RENDER_DPI=None)

check("get_tesseract_version never raises", isinstance(get_tesseract_version(), str))

# ── the deskew retry stays refused on a reprocess (--reextract) — unchanged by this arc ──────────────
check("deskew retry refused on --reextract", _deskew_retry_should_run(True, True, False, True, True) is False)
check("deskew retry still runs on a fresh review-bound page", _deskew_retry_should_run(True, True, False, False, True) is True)

if fails:
    print("FAILED:")
    for f in fails: print("  -", f)
    sys.exit(1)
print(f"All {12 + 8} reextract-recipe pins passed")
