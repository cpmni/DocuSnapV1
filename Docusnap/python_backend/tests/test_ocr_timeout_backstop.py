"""test_ocr_timeout_backstop.py — PINs for S0 (oscar fix #1 + Oracle SIGN-OFF-W/COND 2026-09-09):
the per-call tesseract `timeout=` backstop + `SetErrorMode` at worker startup.

Root problem (HANDOVER_2026-09-09_EVENING §1): a tesseract child that ABORTS (0x40000015 in libstdc++)
blocked on the Windows Error Reporting modal → pytesseract's default `timeout=0` waited forever → the shard
wedged → siblings never merged → the watchdog os._exit orphaned the child. Fix: SetErrorMode kills the modal
(abort fast), and a generous per-call `timeout=` guarantees pytesseract KILLS a hung child then raises, which
the crash-path `except` degrades to a per-field MISS (empty read → held), never a silent wrong value.

Pins: (1) a raised timeout/abort at each guarded site returns the EMPTY read, never propagates; (2) every
production pytesseract.image_to_* call in the crash-path files carries `timeout=` (no untimed call can be
reintroduced); (3) SetErrorMode is set at both worker entry points.

Run:  PYTHONIOENCODING=utf-8 py -3.12 python_backend/tests/test_ocr_timeout_backstop.py
"""
import os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import pytesseract
from ocr import tesseract, region_core
from PIL import Image

_P = _F = 0
def check(name, ok):
    global _P, _F
    if ok: _P += 1; print(f"  ok  {name}")
    else:  _F += 1; print(f"  FAIL {name}")

_IMG = Image.new('L', (200, 40), 255)
_TIMEOUT_ERR = RuntimeError('Tesseract process timeout')          # what pytesseract raises on timeout (:150-152)
_ABORT_ERR = pytesseract.pytesseract.TesseractError(-1073741803, 'aborted')  # 0x40000015 abort

print("1. a raised timeout / abort at a guarded site → EMPTY read, never propagates")
for label, err in (('timeout(RuntimeError)', _TIMEOUT_ERR), ('abort(TesseractError)', _ABORT_ERR)):
    _orig_s, _orig_d = pytesseract.image_to_string, pytesseract.image_to_data
    def _raise_s(*a, **k): raise err
    def _raise_d(*a, **k): raise err
    pytesseract.image_to_string = _raise_s
    pytesseract.image_to_data = _raise_d
    try:
        r1 = tesseract.ocr_image(_IMG)
        check(f"ocr_image → '' on {label}", r1 == '')
        r2 = region_core.process(_IMG)                            # the field-crop ladder (crash cluster)
        check(f"region_core.process → no raise, empty text on {label}", isinstance(r2, dict) and (r2.get('text') or '') == '')
        r3 = tesseract.reconstruct_page_text(_IMG, "--oem 3 --psm 3")
        check(f"reconstruct_page_text → no raise on {label}", isinstance(r3, str))
    except Exception as e:
        check(f"NO site propagated the raise on {label}", False); print('      propagated:', repr(e))
    finally:
        pytesseract.image_to_string, pytesseract.image_to_data = _orig_s, _orig_d

print("\n2. every production pytesseract.image_to_* call on the crash path carries timeout=")
def _all_timed(relpath):
    src = open(os.path.join(os.path.dirname(__file__), '..', relpath), encoding='utf-8').read()
    flat = re.sub(r'\s+', ' ', src)                              # calls can span lines
    calls = re.findall(r'pytesseract\.image_to_(?:string|data)\s*\((?:[^()]|\([^()]*\))*\)', flat)
    untimed = [c for c in calls if 'timeout=' not in c]
    return len(calls), untimed
for rel in ('ocr/tesseract.py', 'ocr/region_core.py', 'ocr_region.py'):
    n, untimed = _all_timed(rel)
    check(f"{rel}: all {n} image_to_* calls carry timeout= (0 untimed)", n > 0 and not untimed)
    if untimed: print('      UNTIMED:', untimed)

print("\n3. SetErrorMode at both worker entry points")
pd = open(os.path.join(os.path.dirname(__file__), '..', 'process_docs.py'), encoding='utf-8').read()
rg = open(os.path.join(os.path.dirname(__file__), '..', 'ocr', 'region.py'), encoding='utf-8').read()
check("process_docs.py sets SetErrorMode (SEM_NOGPFAULTERRORBOX etc.) and calls it in main()",
      'SetErrorMode(SEM)' in pd and '_suppress_windows_error_dialogs()' in pd and '0x8000' in pd)
check("region.py main() sets SetErrorMode", 'SetErrorMode(0x0001 | 0x0002 | 0x8000)' in rg)
check("the timeout is a GENEROUS backstop (>= 120s default), env-tunable, not tightened",
      tesseract.OCR_CALL_TIMEOUT >= 120)

print(f"\n{'ALL PASS' if _F == 0 else str(_F) + ' FAILED'}  ({_P} ok)")
sys.exit(1 if _F else 0)
