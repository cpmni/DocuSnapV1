"""census_sample_angles.py — READ-ONLY census for the sample_deskew_angle backfill
(Oracle SIGN-OFF-W/COND 2026-08-11, conditions C1-C3).

For every template: the STORED sample angle vs the sample page's DETECTED tilt under BOTH
measurement regimes — the 150-DPI render `ocr/detect_angle.py` uses (the teach-commit writer)
and the 200-DPI render the app's extraction pipeline reads at. C1 asks whether the regimes
disagree >=0.2 deg (if so, the writer itself must move to 200 DPI in the same slice); C2's
do-no-harm predicate decides per row:

  NULL stored, file present            -> WRITE detected
  stored 0.0 and |detected| >= 0.3     -> OVERWRITE (the stale pre-round-trip zero)
  stored 0.0 and |detected| <  0.3     -> KEEP (a wrongly-added small angle would mis-place
                                          currently-correct templates; compose fires from 0.2)
  non-zero stored                      -> NEVER rewritten v1; census-only, flag |delta| >= 0.3
  sample file missing/unreadable       -> SKIP + REPORT, never guess

Usage:  py -3.12 stress_test/census_sample_angles.py <templates.json> [--out census.json]
Writes ONLY the optional --out json. Never touches any DB.
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'python_backend'))
import pytesseract
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
from ocr.tesseract import detect_skew_angle


def render(path, dpi):
    from PIL import Image
    if path.lower().endswith('.pdf'):
        import pypdfium2 as pdfium
        doc = pdfium.PdfDocument(path)
        try:
            return doc[0].render(scale=dpi / 72.0).to_pil()
        finally:
            doc.close()
    return Image.open(path)


def main():
    rows = json.load(open(sys.argv[1], encoding='utf-8'))
    out = []
    print(f"{'tpl':>4} {'stored':>7} {'det150':>7} {'det200':>7} {'regimeΔ':>8}  decision")
    for t in rows:
        path = t.get('working_path') or t.get('stored_path')
        stored = t.get('sample_deskew_angle')
        rec = {'id': t['id'], 'name': t['name'], 'stored': stored, 'file': path}
        if not path or not os.path.exists(path):
            rec.update(decision='SKIP-REPORT (sample file missing)', det150=None, det200=None)
            print(f"{t['id']:>4} {str(stored):>7} {'—':>7} {'—':>7} {'—':>8}  {rec['decision']}")
            out.append(rec)
            continue
        try:
            d150 = float(detect_skew_angle(render(path, 150), 0.2))
            d200 = float(detect_skew_angle(render(path, 200), 0.2))
        except Exception as e:
            rec.update(decision=f'SKIP-REPORT (detect failed: {e})', det150=None, det200=None)
            print(f"{t['id']:>4} {str(stored):>7} {'ERR':>7} {'ERR':>7} {'—':>8}  {rec['decision']}")
            out.append(rec)
            continue
        regime_delta = abs(d150 - d200)
        det = d200   # the pipeline's own regime is the reference for the decision column
        if stored is None:
            decision = f'WRITE {det:+.2f}'
        elif stored == 0.0:
            decision = f'OVERWRITE {det:+.2f}' if abs(det) >= 0.3 else 'KEEP (|det| < 0.3)'
        else:
            decision = ('CENSUS-FLAG stored-vs-detected' if abs(stored - det) >= 0.3
                        else 'KEEP (non-zero stored, agrees)')
        rec.update(det150=round(d150, 2), det200=round(d200, 2),
                   regime_delta=round(regime_delta, 2), decision=decision)
        print(f"{t['id']:>4} {str(stored):>7} {d150:>+7.2f} {d200:>+7.2f} {regime_delta:>8.2f}  {decision}")
        out.append(rec)
    disagree = [r for r in out if (r.get('regime_delta') or 0) >= 0.2]
    print(f"\nC1: regimes disagree >=0.2 deg on {len(disagree)} of {len([r for r in out if r.get('det150') is not None])} measured samples"
          + (f" -> the 150-DPI writer MUST move to 200 DPI in this slice: {[r['id'] for r in disagree]}" if disagree else ' -> regimes agree; the tpl-7 zero came from file-state churn (08-10 deskew era), not the DPI'))
    if len(sys.argv) > 3 and sys.argv[2] == '--out':
        json.dump(out, open(sys.argv[3], 'w', encoding='utf-8'), indent=1)


if __name__ == '__main__':
    main()
