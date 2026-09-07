"""
tests/test_omp_inherit.py — OMP INHERIT (Oracle 2026-09-07 C6 / seam S2).

The two in-process OCR pools (DS_OCR_PARALLEL_FIELDS in anchor.extract_with_anchors, DS_OCR_PARALLEL_FULLPAGE in
tesseract.reconstruct_page_text) used to write OMP_THREAD_LIMIT='1' unconditionally — LOWERING a cap the parent
process exported. On a cap>=2 box a single reprocess then read Stage 0-1 at the cap and Stage 2+ at 1 while
Reprocess-All shards read everything at the cap: the 'ACC-2291' vs 'ACC-229]' thread-count class (08-11)
reintroduced by the pools. Now the pools only FLOOR an ABSENT cap to '1'; an exported cap is inherited untouched.

Pinned: (1) the functional rule on both sites via a stubbed image_to_data; (2) the source shape.
Run:  py -3.12 tests/test_omp_inherit.py   (from python_backend/)
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

fails = 0


def check(label, cond, extra=""):
    global fails
    print(f"  {'OK ' if cond else 'BAD'} {label}{('  ' + extra) if (extra and not cond) else ''}")
    if not cond:
        fails += 1


root = os.path.join(os.path.dirname(__file__), "..")
anc = open(os.path.join(root, "extraction", "anchor.py"), encoding="utf-8").read()
tes = open(os.path.join(root, "ocr", "tesseract.py"), encoding="utf-8").read()

print("#1 source: neither pool writes OMP_THREAD_LIMIT unconditionally")
writes = re.findall(r"os\.environ\[['\"]OMP_THREAD_LIMIT['\"]\]\s*=\s*['\"]1['\"]", anc + tes)
guards = re.findall(r"if not os\.environ\.get\(['\"]OMP_THREAD_LIMIT['\"]\)", anc + tes)
check("exactly two floor-writes, each behind an absent-cap guard", len(writes) == 2 and len(guards) == 2, f"writes={len(writes)} guards={len(guards)}")
for name, src in (("anchor.py", anc), ("tesseract.py", tes)):
    m = re.search(r"if not os\.environ\.get\(['\"]OMP_THREAD_LIMIT['\"]\):[^\n]*\n\s*os\.environ\[['\"]OMP_THREAD_LIMIT['\"]\]\s*=\s*['\"]1['\"]", src)
    check(f"{name}: the write is the guard's body", bool(m))

print("#2 functional: the fullpage pool inherits an exported cap, floors an absent one")
from ocr import tesseract as T                                              # noqa: E402


class _FakePT:
    class Output:
        DICT = "dict"

    @staticmethod
    def image_to_data(img, config="", output_type=None):
        return {"text": [], "left": [], "top": [], "width": [], "height": [], "conf": [],
                "block_num": [], "par_num": [], "line_num": [], "word_num": []}


_orig_pt = getattr(T, "pytesseract", None)
T.pytesseract = _FakePT
from PIL import Image                                                        # noqa: E402
img = Image.new("L", (200, 100), 255)


def _run_fullpage(pre):
    os.environ["DS_OCR_PARALLEL_FULLPAGE"] = "1"
    if pre is None:
        os.environ.pop("OMP_THREAD_LIMIT", None)
    else:
        os.environ["OMP_THREAD_LIMIT"] = pre
    try:
        try:
            T.reconstruct_page_text(img)
        except Exception as e:      # the stub's empty dict may trip a later stage; the env write happens first
            pass
        return os.environ.get("OMP_THREAD_LIMIT")
    finally:
        os.environ.pop("DS_OCR_PARALLEL_FULLPAGE", None)


check("exported cap '2' survives the fullpage pool", _run_fullpage("2") == "2", str(os.environ.get("OMP_THREAD_LIMIT")))
check("exported cap '3' survives the fullpage pool", _run_fullpage("3") == "3")
check("an ABSENT cap is floored to '1' (today's behaviour for the uncapped case)", _run_fullpage(None) == "1")
os.environ.pop("OMP_THREAD_LIMIT", None)
T.pytesseract = _orig_pt

print("#3 functional: the fields pool's guard (evaluated through the same predicate shape)")
# The fields pool needs a full anchor context to reach its write; pin the predicate by executing the
# guarded statement extracted from the source under both env states.
m = re.search(r"(if not os\.environ\.get\(['\"]OMP_THREAD_LIMIT['\"]\):[^\n]*\n\s*os\.environ\[['\"]OMP_THREAD_LIMIT['\"]\]\s*=\s*['\"]1['\"])", anc)
stmt = "\n".join(l.strip() if i == 0 else "    " + l.strip() for i, l in enumerate(m.group(1).split("\n"))) if m else None
check("anchor.py guard extracted", bool(stmt))
if stmt:
    os.environ["OMP_THREAD_LIMIT"] = "4"; exec(stmt, {"os": os}); a4 = os.environ.get("OMP_THREAD_LIMIT")
    os.environ.pop("OMP_THREAD_LIMIT", None); exec(stmt, {"os": os}); a0 = os.environ.get("OMP_THREAD_LIMIT")
    os.environ.pop("OMP_THREAD_LIMIT", None)
    check("cap '4' inherited; absent -> '1'", a4 == "4" and a0 == "1", f"{a4}/{a0}")

print(f"\n{'PASS' if not fails else 'FAIL'} -- {fails} failure(s)")
sys.exit(1 if fails else 0)
