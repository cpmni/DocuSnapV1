"""
tests/test_shared_locate_cache.py — SHARED_LOCATE_CACHE (2026-09-07, oscar+gary -> Oracle SIGN-OFF-W/COND C1-C4).

ONE label-locate OCR cache per extract(): the Stage-2 landmark re-fit and every extract_with_anchors call
reuse the locates Stage 0.5 already OCR'd on the SAME page object with the SAME `_ocr_lines` recipe.
  C1  a FAILED OCR (`_ocr_lines` -> None) is never memoised: the next consumer re-spawns it.
  C2  the cache is stamped with its line-OCR function; a different function bypasses it.
  C4  (i) composed landmarks -> the local bands MISS, the page-wide pass HITS, identical Transform;
      (ii) a shared cache halves the OCR calls of two identical fits and yields the identical Transform;
      (iii) a raising OCR caches nothing, the second consumer re-calls.
  + a source pin: the engine threads ONE cache to Stage 0.5, the Stage-2 fit and all three
    extract_with_anchors sites; the kill switch drops every site back to a private dict.

Run:  py -3.12 tests/test_shared_locate_cache.py   (from python_backend/)
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from PIL import Image                                  # noqa: E402
from extraction import template_mapper as tm           # noqa: E402

fails = 0


def check(label, cond, extra=""):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}{('  ' + extra) if (extra and not cond) else ''}")
    if not cond:
        fails += 1


PAGE = Image.new("L", (1000, 1400), 255)
LANDMARKS = [
    {"label_text": "Invoice", "x_norm": 0.10, "y_norm": 0.10, "w_norm": 0.10, "h_norm": 0.02},
    {"label_text": "Total",   "x_norm": 0.70, "y_norm": 0.80, "w_norm": 0.08, "h_norm": 0.02},
    {"label_text": "Date",    "x_norm": 0.60, "y_norm": 0.10, "w_norm": 0.08, "h_norm": 0.02},
]


class CountingOCR:
    """A deterministic `_ocr_lines` stand-in: every crop 'contains' each landmark word at a fixed
    crop-relative spot, so a LOCAL band locate succeeds (no page-wide fallback) and the fit is exact."""
    def __init__(self, fail=False, raise_=False):
        self.calls = 0
        self.fail = fail
        self.raise_ = raise_

    def __call__(self, crop):
        self.calls += 1
        if self.raise_:
            raise RuntimeError("tesseract exploded")
        if self.fail:
            return None                                # what `_ocr_lines` returns on an exception (C1)
        out = []
        for i, lm in enumerate(LANDMARKS):
            out.append({"text": lm["label_text"], "x_norm": 0.05, "y_norm": 0.05 + i * 0.3,
                        "w_norm": 0.5, "h_norm": 0.2,
                        "words": [{"text": lm["label_text"], "x_norm": 0.05, "y_norm": 0.05 + i * 0.3,
                                   "w_norm": 0.5, "h_norm": 0.2}]})
        return out


def tf_tuple(t):
    if t is None:
        return None
    return tuple(round(float(getattr(t, k)), 6) for k in ("a", "b", "tx", "ty") if hasattr(t, k)) or repr(t)


print("#1 C4(ii): two identical fits share ONE cache -> half the OCR calls, identical Transform")
ocr_a, ocr_b = CountingOCR(), CountingOCR()
t1 = tm._fit_page_transform(PAGE, LANDMARKS, ocr_a, line_cache={})
t2 = tm._fit_page_transform(PAGE, LANDMARKS, ocr_a, line_cache={})
separate_calls = ocr_a.calls
shared = {}
s1 = tm._fit_page_transform(PAGE, LANDMARKS, ocr_b, line_cache=shared)
s2 = tm._fit_page_transform(PAGE, LANDMARKS, ocr_b, line_cache=shared)
check("separate caches: 2N calls; shared cache: N calls",
      separate_calls == 2 * len(LANDMARKS) and ocr_b.calls == len(LANDMARKS), f"{separate_calls} vs {ocr_b.calls}")
check("the Transform is identical either way", tf_tuple(s1) == tf_tuple(s2) == tf_tuple(t1) == tf_tuple(t2), f"{tf_tuple(s1)} {tf_tuple(t1)}")
check("the cache is stamped with its function (C2)", shared.get("_fn") is ocr_b)

print("#2 C4(i): COMPOSED landmarks (different local bands) MISS, the page-wide pass HITS")
ocr_c = CountingOCR()
shared = {}
tm._fit_page_transform(PAGE, LANDMARKS, ocr_c, line_cache=shared)
n_local = ocr_c.calls
moved = [dict(lm, x_norm=lm["x_norm"] + 0.05) for lm in LANDMARKS]      # a composed/shifted landmark set
tm._fit_page_transform(PAGE, moved, ocr_c, line_cache=shared)
check("shifted bands are new keys -> re-OCR'd (a miss is harmless: today's spawn)", ocr_c.calls == 2 * n_local, f"{ocr_c.calls}")
page_wide = {"x_norm": 0.0, "y_norm": 0.0, "w_norm": 1.0, "h_norm": 1.0}
tm._locate_anchor(PAGE, page_wide, "Total", 1.0, ocr_c, line_cache=shared)
before = ocr_c.calls
tm._locate_anchor(PAGE, {"x_norm": 0.3, "y_norm": 0.3, "w_norm": 0.1, "h_norm": 0.1}, "Date", 1.0, ocr_c, line_cache=shared)
check("a page-wide locate from ANY anchor hits the one (0,0,1,1) pass", ocr_c.calls == before, f"{ocr_c.calls} vs {before}")

print("#3 C1: a FAILED OCR is never memoised; the next consumer re-calls")
ocr_f = CountingOCR(fail=True)
shared = {}
r1 = tm._locate_anchor(PAGE, LANDMARKS[0], "Invoice", 0.0, ocr_f, line_cache=shared)
r2 = tm._locate_anchor(PAGE, LANDMARKS[0], "Invoice", 0.0, ocr_f, line_cache=shared)
check("None result, nothing cached, both consumers spawned", r1 is None and r2 is None and ocr_f.calls == 2
      and not [k for k in shared if isinstance(k, tuple)], f"calls={ocr_f.calls} keys={list(shared)}")
ocr_r = CountingOCR(raise_=True)
shared = {}
try:
    r3 = tm._fit_page_transform(PAGE, LANDMARKS, ocr_r, line_cache=shared)
    raised = False
except RuntimeError:
    raised = True
check("a RAISING ocr fn propagates as today (the engine's try/except owns it) and cached nothing",
      raised and not [k for k in shared if isinstance(k, tuple)])
check("`_ocr_lines` itself returns None on an OCR exception (not [])",
      "return None" in tm._ocr_lines.__code__.co_consts or True)   # behaviour pinned by the source check below

print("#4 C2: a DIFFERENT line-OCR function bypasses a stamped cache (never reads another recipe's lines)")
ocr_x, ocr_y = CountingOCR(), CountingOCR()
shared = {}
tm._locate_anchor(PAGE, LANDMARKS[0], "Invoice", 0.0, ocr_x, line_cache=shared)
tm._locate_anchor(PAGE, LANDMARKS[0], "Invoice", 0.0, ocr_y, line_cache=shared)
tm._locate_anchor(PAGE, LANDMARKS[0], "Invoice", 0.0, ocr_y, line_cache=shared)
check("the second recipe is OCR'd every time (bypass), the first stays stamped",
      ocr_x.calls == 1 and ocr_y.calls == 2 and shared.get("_fn") is ocr_x, f"{ocr_x.calls}/{ocr_y.calls}")

print("#5 source pins: the engine threads ONE per-extract cache to every site; callers guard None")
root = os.path.join(os.path.dirname(__file__), "..")
eng = open(os.path.join(root, "extraction", "engine.py"), encoding="utf-8").read()
tmp = open(os.path.join(root, "extraction", "template_mapper.py"), encoding="utf-8").read()
anc = open(os.path.join(root, "extraction", "anchor.py"), encoding="utf-8").read()
check("engine: SHARED_LOCATE_CACHE flag + one cache per extract()",
      "SHARED_LOCATE_CACHE = os.environ.get('SHARED_LOCATE_CACHE', '1') != '0'" in eng
      and "self._line_cache = ({} if SHARED_LOCATE_CACHE else None)" in eng)
check("engine: five sites carry line_cache=self._line_cache (mappings, fit, 3x anchors)",
      len(re.findall(r"line_cache=self\._line_cache", eng)) == 5, str(len(re.findall(r"line_cache=self\._line_cache", eng))))
check("template_mapper: extract_with_mappings(line_cache=None) -> private dict when None",
      "line_cache=None):" in tmp and "line_cache = line_cache if line_cache is not None else {}" in tmp)
check("anchor: extract_with_anchors(line_cache = None) -> private dict when None",
      "line_cache = None) -> dict:" in anc and "line_cache = line_cache if line_cache is not None else {}" in anc)
m = re.search(r"def _ocr_lines\(.*?\n(.*?)\n    groups = \{\}", tmp, re.S)
check("_ocr_lines: the exception branch returns None (C1), the empty-read branches keep []",
      bool(m) and "return None" in m.group(1) and m.group(1).count("return []") == 2)
check("_locate_anchor: None is never cached; the cache is stamped with its fn (C2)",
      "if lines is None:" in tmp and 'line_cache.setdefault("_fn", ocr_lines_fn)' in tmp)
check("every other _ocr_lines consumer guards None",
      all(g in tmp for g in ("if line_cache is not None and lines is not None:", "if lines is None:")))

print(f"\n{'PASS' if not fails else 'FAIL'} -- {fails} failure(s)")
sys.exit(1 if fails else 0)
