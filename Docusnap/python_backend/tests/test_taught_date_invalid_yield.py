"""Pins for TEMPLATE_DATE_INVALID_YIELD — the engine kw-merge date-precedence fix (Oracle
SIGN-OFF-W/COND 2026-08-06). A Stage-0.5-located taught DATE that OCR-misread into an IMPOSSIBLE
calendar value ('33/04/2026' — a tilt glyph-misread of '03/04/2026') used to WIN the merge on
authority over a valid, confident keyword date. Now it yields to the keyword read but FLAGGED to
Review (the note is the sole safety — Stage 4's clean-date floor makes the confidence cap cosmetic).
Heals ONLY the impossible-date subset (a misread landing on a DIFFERENT valid date parses → skipped).

Run: py -3.12 python_backend/tests/test_taught_date_invalid_yield.py
"""
import inspect
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.pop('TEMPLATE_DATE_INVALID_YIELD', None)
import extraction.engine as E

FAILED = []


def check(name, cond):
    print(("PASS  " if cond else "FAIL  ") + name)
    if not cond:
        FAILED.append(name)


check("switch default OFF", E.TEMPLATE_DATE_INVALID_YIELD is False)

# ── the deterministic date-validity discriminator ─────────────────────────────
Y = E._invalid_taught_date_yields
check("impossible taught '33/04/2026' + valid kw '03/04/2026' -> yields", Y('33/04/2026', '03/04/2026') is True)
check("whole impossible family caught: '31/02/2026' -> yields", Y('31/02/2026', '01/03/2026') is True)
check("VALID taught date -> NO yield (authority preserved for valid dates)", Y('15-07-2026', '03/04/2026') is False)
check("kw NOT a valid date ('March') -> no yield", Y('33/04/2026', 'March') is False)
check("both invalid -> no yield (today's flagged path kept)", Y('33/04/2026', '44/44/4444') is False)
# reggie's salvage_date conjunct — a genuinely-valid but NOISY taught date is recovered, must NOT yield
check("spaced VALID taught '03 / 04 / 2026' -> NO yield (salvage recovers it)", Y('03 / 04 / 2026', '08/04/2026') is False)
check("junk-suffixed VALID taught '03/04/2026x' -> NO yield (salvage recovers it)", Y('03/04/2026x', '08/04/2026') is False)
check("empty taught -> no yield", Y('', '03/04/2026') is False)

# ── source pins on the merge branch (Oracle conditions 2 + 5) ─────────────────
src = inspect.getsource(E.ExtractionEngine.extract) if hasattr(E, 'ExtractionEngine') else inspect.getsource(E)
if 'TEMPLATE_DATE_INVALID_YIELD' not in src:
    src = Path(E.__file__).read_text(encoding='utf-8')
i_flag = src.find('if (TEMPLATE_DATE_INVALID_YIELD and key in date_field_keys and _kw_ok')
i_kwdef = src.find('_kw_ok = (data.get("method") in ("keyword", "keyword_override")')
i_blind = src.find('if (_blind_reg and _kw_ok')
check("branch present, gated on TEMPLATE_DATE_INVALID_YIELD as FIRST conjunct + date key + _kw_ok",
      i_flag != -1)
check("placed AFTER _kw_ok is defined and BEFORE the _blind_reg swap (Oracle C2)",
      i_kwdef != -1 and i_blind != -1 and i_kwdef < i_flag < i_blind)
check("commits the keyword value via {**data} + a validation_note (Review-bound) + own continue",
      "_invalid_taught_date_yields(existing.get(\"value\"), data.get(\"value\"))" in src
      and 'validation_note' in src[i_flag:i_flag + 700]
      and src[i_flag:i_blind].rstrip().endswith('continue'))
check("predicate uses parse_date AND salvage_date (reggie hardening), never a new date regex",
      'validator.parse_date' in inspect.getsource(E._invalid_taught_date_yields)
      and 'validator.salvage_date' in inspect.getsource(E._invalid_taught_date_yields))

print()
if FAILED:
    print(f"{len(FAILED)} FAILED")
    sys.exit(1)
print("All taught-date-invalid-yield checks passed.")
