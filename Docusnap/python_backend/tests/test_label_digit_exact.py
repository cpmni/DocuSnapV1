"""Pins for Slice D — the _label_score digit-exactness guard (Oracle 2026-08-05,
D-C1..D-C3). The fuzzy blend let a digit-heavy VALUE-like anchor needle lock a
DIFFERENT value as its "label" ('03-06-2026' located '07-01-2026'), making the
drift guard call the anchor stable on a wrong lock. Digit-dominant needles now
require their digit sequence contiguous in the haystack before fuzzy scoring.

D-C3 note: the guard also reaches _match_label_run (it maximises _label_score
over windows), so a digit-heavy needle can no longer win a fuzzy window there —
covered by the window check below.

Run: py -3.12 python_backend/tests/test_label_digit_exact.py
"""
import importlib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


# ── default OFF (D-C1) ───────────────────────────────────────────────────────
os.environ.pop('TEMPLATE_LABEL_DIGIT_EXACT', None)
import extraction.template_mapper as tm
importlib.reload(tm)
check("kill switch default OFF", tm._LABEL_DIGIT_EXACT_ON is False)
off_score = tm._label_score('03-06-2026', 'date 07-01-2026')
check("OFF: the wrong-date fuzzy lock still scores (byte-identical today)",
      off_score >= tm._FUZZY_MATCH_THRESHOLD)

# ── armed ────────────────────────────────────────────────────────────────────
os.environ['TEMPLATE_LABEL_DIGIT_EXACT'] = '1'
importlib.reload(tm)
check("switch arms", tm._LABEL_DIGIT_EXACT_ON is True)

check("PIN: '03-06-2026' must NOT lock '07-01-2026'",
      tm._label_score('03-06-2026', 'date 07-01-2026') == 0.0)
check("digit-exact needle still locks ('03-06-2026' on its own row)",
      tm._label_score('03-06-2026', 'credit date 03-06-2026') == 1.0)
check("separator variance tolerated ('03-06-2026' vs '03/06/2026' row)",
      tm._label_score('03-06-2026', 'date 03/06/2026') > 0.0)
check("caption with incidental digit untouched ('vat no 1' share 1/6)",
      tm._label_score('vat no 1', 'vat no 1') == 1.0)
check("caption 'invoice #2' unaffected (below digit share bar)",
      tm._label_score('invoice #2', 'invoice #2 details') == 1.0)
check("letter-dominant code needle untouched ('inv no' fuzzy on 'invoice no')",
      tm._label_score('inv no', 'invoice no') > 0.0)

# D-C3: the window scorer inherits the guard — a digit-heavy needle can't win a
# fuzzy window on a row carrying only a DIFFERENT value.
words = [{"text": "date"}, {"text": "07-01-2026"}]
check("_match_label_run: no window lock for '03-06-2026' on a wrong-value row",
      tm._match_label_run(words, '03-06-2026') is None)
words_right = [{"text": "date"}, {"text": "03-06-2026"}]
run = tm._match_label_run(words_right, '03-06-2026')
check("_match_label_run: exact-digit needle still finds its window",
      run is not None and run[0][-1]["text"] == '03-06-2026')

os.environ.pop('TEMPLATE_LABEL_DIGIT_EXACT', None)
importlib.reload(tm)

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All label digit-exactness checks passed.")
