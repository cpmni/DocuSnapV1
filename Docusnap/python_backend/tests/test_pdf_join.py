#!/usr/bin/env python3
"""
tests/test_pdf_join.py
----------------------
Focused tests for pdf_join.py (the C12 "Rejoin" primitive):
  - join_pdfs produces the summed page count
  - page order == the order of the input paths (proved with distinct page widths)
  - per-page /Rotate is preserved across DIFFERENT source files (the load-bearing
    claim: joining working copies keeps auto-rotate orientation)
  - CLI round-trips: success, missing file, fewer than two inputs

Requires pypdf. Creates and cleans up its own temp files.

Usage:
    py -3.12 python_backend/tests/test_pdf_join.py
"""

import sys
import os
import json
import tempfile
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from pdf_join import join_pdfs


def check(label, condition, detail=''):
    ok = bool(condition)
    print(f"  {'OK ' if ok else 'BAD'} {label}" + (f' — {detail}' if detail else ''))
    return ok


def section(title):
    print(f'\n{title}')


def make_pdf(path: Path, widths, rotations=None):
    """One page per entry in `widths`; optional per-page /Rotate."""
    from pypdf import PdfWriter
    writer = PdfWriter()
    for i, w in enumerate(widths):
        page = writer.add_blank_page(width=w, height=842)
        if rotations and rotations[i]:
            page.rotate(rotations[i])
    with open(path, 'wb') as f:
        writer.write(f)


def page_widths(pdf_path):
    from pypdf import PdfReader
    return [round(float(p.mediabox.width)) for p in PdfReader(pdf_path).pages]


def page_rotations(pdf_path):
    from pypdf import PdfReader
    return [int(p.rotation) for p in PdfReader(pdf_path).pages]


def count_pages(pdf_path):
    from pypdf import PdfReader
    return len(PdfReader(pdf_path).pages)


def main():
    failures = 0

    # ── page count = sum of inputs ─────────────────────────────────────────────
    section('join_pdfs — summed page count')
    with tempfile.TemporaryDirectory() as tmp:
        a = Path(tmp) / 'a.pdf'; make_pdf(a, [595, 595])   # 2 pages
        b = Path(tmp) / 'b.pdf'; make_pdf(b, [595])        # 1 page
        out = Path(tmp) / 'joined.pdf'
        try:
            n = join_pdfs([str(a), str(b)], str(out))
            if not check('join returns pages == 3', n == 3, f'got {n}'):
                failures += 1
            if not check('joined file has 3 pages', count_pages(str(out)) == 3):
                failures += 1
        except Exception as exc:
            failures += 1; print(f'  BAD join_pdfs raised: {exc}')

    # ── page order == argv order (distinct widths) ─────────────────────────────
    section('join_pdfs — page order follows the input order')
    with tempfile.TemporaryDirectory() as tmp:
        a = Path(tmp) / 'a.pdf'; make_pdf(a, [595])        # wide
        b = Path(tmp) / 'b.pdf'; make_pdf(b, [300])        # narrow
        ab = Path(tmp) / 'ab.pdf'; ba = Path(tmp) / 'ba.pdf'
        try:
            join_pdfs([str(a), str(b)], str(ab))
            join_pdfs([str(b), str(a)], str(ba))
            if not check('A,B -> [595,300]', page_widths(str(ab)) == [595, 300], str(page_widths(str(ab)))):
                failures += 1
            if not check('B,A -> [300,595] (order respected, not sorted)', page_widths(str(ba)) == [300, 595], str(page_widths(str(ba)))):
                failures += 1
        except Exception as exc:
            failures += 1; print(f'  BAD order test raised: {exc}')

    # ── per-page /Rotate preserved across files (the load-bearing claim) ───────
    section('join_pdfs — per-page rotation preserved across different source files')
    with tempfile.TemporaryDirectory() as tmp:
        rot = Path(tmp) / 'rot.pdf'; make_pdf(rot, [595], rotations=[90])   # rotated
        flat = Path(tmp) / 'flat.pdf'; make_pdf(flat, [595], rotations=[0])  # upright
        out = Path(tmp) / 'j.pdf'
        try:
            join_pdfs([str(rot), str(flat)], str(out))
            rots = page_rotations(str(out))
            if not check('joined rotations == [90, 0]', rots == [90, 0], str(rots)):
                failures += 1
        except Exception as exc:
            failures += 1; print(f'  BAD rotation test raised: {exc}')

    # ── CLI — success path ─────────────────────────────────────────────────────
    section('CLI round-trip — success path')
    with tempfile.TemporaryDirectory() as tmp:
        a = Path(tmp) / 'a.pdf'; make_pdf(a, [595, 595])
        b = Path(tmp) / 'b.pdf'; make_pdf(b, [595])
        out = Path(tmp) / 'cli.pdf'
        script = Path(__file__).parent.parent / 'pdf_join.py'
        result = subprocess.run(
            [sys.executable, str(script), '--file', str(a), '--file', str(b), '--out', str(out)],
            capture_output=True, text=True,
        )
        try:
            data = json.loads(result.stdout.strip())
            if not check('CLI exits 0', result.returncode == 0, f'code={result.returncode}'):
                failures += 1
            if not check('success=true, pages=3', data.get('success') is True and data.get('pages') == 3, str(data)):
                failures += 1
            if not check('out file exists', out.is_file()):
                failures += 1
        except json.JSONDecodeError:
            failures += 1; print(f'  BAD could not parse CLI output: {result.stdout!r}')

    # ── CLI — missing input ────────────────────────────────────────────────────
    section('CLI round-trip — missing input returns error JSON, non-zero')
    with tempfile.TemporaryDirectory() as tmp:
        a = Path(tmp) / 'a.pdf'; make_pdf(a, [595])
        out = Path(tmp) / 'x.pdf'
        script = Path(__file__).parent.parent / 'pdf_join.py'
        result = subprocess.run(
            [sys.executable, str(script), '--file', str(a), '--file', str(Path(tmp) / 'nope.pdf'), '--out', str(out)],
            capture_output=True, text=True,
        )
        try:
            data = json.loads(result.stdout.strip())
            if not check('CLI exits non-zero for missing input', result.returncode != 0, f'code={result.returncode}'):
                failures += 1
            if not check('success=false', data.get('success') is False, str(data)):
                failures += 1
        except json.JSONDecodeError:
            failures += 1; print(f'  BAD could not parse error output: {result.stdout!r}')

    # ── CLI — fewer than two inputs rejected ───────────────────────────────────
    section('CLI round-trip — a single input is refused (a join needs two)')
    with tempfile.TemporaryDirectory() as tmp:
        a = Path(tmp) / 'a.pdf'; make_pdf(a, [595])
        out = Path(tmp) / 'x.pdf'
        script = Path(__file__).parent.parent / 'pdf_join.py'
        result = subprocess.run(
            [sys.executable, str(script), '--file', str(a), '--out', str(out)],
            capture_output=True, text=True,
        )
        try:
            data = json.loads(result.stdout.strip())
            if not check('single input exits non-zero', result.returncode != 0, f'code={result.returncode}'):
                failures += 1
            if not check('success=false for <2 inputs', data.get('success') is False, str(data)):
                failures += 1
        except json.JSONDecodeError:
            failures += 1; print(f'  BAD could not parse output: {result.stdout!r}')

    print()
    if failures:
        print(f'{failures} check(s) FAILED.')
        return 1
    print('All checks passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
