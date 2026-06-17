#!/usr/bin/env python3
"""
tests/test_pdf_splitter.py
---------------------------
Focused tests for pdf_splitter.py:
  - parse_ranges correctness (boundary, single, multi, out-of-range)
  - split_pdf produces correct page counts per output file
  - CLI round-trips: success and error paths

Requires pypdf (pip install pypdf) and a throwaway minimal PDF fixture.
Creates and cleans up its own temp files.

Usage:
    py -3.12 python_backend/tests/test_pdf_splitter.py
"""

import sys
import os
import json
import tempfile
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from pdf_splitter import parse_ranges, split_pdf, chunk_ranges


def check(label, condition, detail=''):
    ok = bool(condition)
    print(f"  {'OK ' if ok else 'BAD'} {label}" + (f' — {detail}' if detail else ''))
    return ok


def section(title):
    print(f'\n{title}')


def make_minimal_pdf(path: Path, n_pages: int):
    """Create the smallest valid multi-page PDF using pypdf."""
    from pypdf import PdfWriter
    writer = PdfWriter()
    for _ in range(n_pages):
        writer.add_blank_page(width=595, height=842)
    with open(path, 'wb') as f:
        writer.write(f)


def count_pages(pdf_path: str) -> int:
    from pypdf import PdfReader
    return len(PdfReader(pdf_path).pages)


def main():
    failures = 0

    # ── parse_ranges ──────────────────────────────────────────────────────────
    section('parse_ranges — correct 0-based index lists')
    cases = [
        ('1',       10, [[0]]),
        ('10',      10, [[9]]),
        ('1-3',     10, [[0, 1, 2]]),
        ('1-3,5',   10, [[0, 1, 2], [4]]),
        ('0',       10, []),              # 0 is out of 1-based range
        ('11',      10, []),              # beyond total
        ('3-1',     10, []),              # reversed range (empty)
        ('1-3,5,7-9', 10, [[0,1,2],[4],[6,7,8]]),
    ]
    for spec, total, expected in cases:
        got = parse_ranges(spec, total)
        if not check(f"parse_ranges({spec!r}, {total}) == {expected}", got == expected, f"got {got}"):
            failures += 1

    # ── split_pdf — page count verification ───────────────────────────────────
    section('split_pdf — output files have correct page counts')
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / 'source.pdf'
        make_minimal_pdf(src, 6)

        try:
            paths = split_pdf(str(src), '1-2,4,5-6', tmp)

            if not check('3 output files produced', len(paths) == 3, f'got {len(paths)}'):
                failures += 1
            expected_counts = [2, 1, 2]
            for i, (p, expected_n) in enumerate(zip(paths, expected_counts)):
                got_n = count_pages(p)
                if not check(f'output {i+1} has {expected_n} page(s)', got_n == expected_n, f'got {got_n}'):
                    failures += 1
            # Ensure outputs are in the requested directory
            for p in paths:
                if not check(f'{os.path.basename(p)} is inside outdir', Path(p).parent == Path(tmp)):
                    failures += 1
        except Exception as exc:
            failures += 1
            print(f'  BAD split_pdf raised: {exc}')

    # ── chunk_ranges — split every N pages ─────────────────────────────────────
    section('chunk_ranges — every N pages (1 = every page)')
    chunk_cases = [
        (5, 1, [[0], [1], [2], [3], [4]]),          # every page
        (7, 3, [[0, 1, 2], [3, 4, 5], [6]]),        # trailing short group kept
        (4, 2, [[0, 1], [2, 3]]),                   # even split
        (3, 10, [[0, 1, 2]]),                       # N > total -> one group
        (5, 0, [[0], [1], [2], [3], [4]]),          # 0 clamped to 1
    ]
    for total, every, expected in chunk_cases:
        got = chunk_ranges(total, every)
        if not check(f'chunk_ranges({total}, {every}) == {expected}', got == expected, f'got {got}'):
            failures += 1

    section('split_pdf — every=1 produces one file per page')
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / 'each.pdf'
        make_minimal_pdf(src, 5)
        try:
            paths = split_pdf(str(src), '', tmp, every=1)
            if not check('5 single-page files', len(paths) == 5, f'got {len(paths)}'):
                failures += 1
            if not check('each output is 1 page', all(count_pages(p) == 1 for p in paths)):
                failures += 1
        except Exception as exc:
            failures += 1; print(f'  BAD split_pdf(every=1) raised: {exc}')

    # ── CLI — --every round-trip ───────────────────────────────────────────────
    section('CLI round-trip — --every 2')
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / 'every_source.pdf'
        make_minimal_pdf(src, 5)
        script = Path(__file__).parent.parent / 'pdf_splitter.py'
        result = subprocess.run(
            [sys.executable, str(script), '--file', str(src), '--every', '2', '--outdir', tmp],
            capture_output=True, text=True,
        )
        try:
            out = json.loads(result.stdout.strip())
            if not check('--every exits 0', result.returncode == 0, f'code={result.returncode}'):
                failures += 1
            if not check('--every -> 3 files (2,2,1)', len(out.get('files', [])) == 3, str(out)):
                failures += 1
        except json.JSONDecodeError:
            failures += 1; print(f'  BAD could not parse --every output: {result.stdout!r}')

    # ── CLI — success path ─────────────────────────────────────────────────────
    section('CLI round-trip — success path')
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / 'cli_source.pdf'
        make_minimal_pdf(src, 4)
        script = Path(__file__).parent.parent / 'pdf_splitter.py'
        result = subprocess.run(
            [sys.executable, str(script),
             '--file', str(src), '--ranges', '1-2,3-4', '--outdir', tmp],
            capture_output=True, text=True,
        )
        try:
            out = json.loads(result.stdout.strip())
            if not check('CLI exits 0',       result.returncode == 0, f'code={result.returncode}'):
                failures += 1
            if not check('success=true',      out.get('success') is True, str(out)):
                failures += 1
            if not check('2 files returned',  len(out.get('files', [])) == 2, str(out)):
                failures += 1
        except json.JSONDecodeError:
            failures += 1
            print(f'  BAD could not parse CLI output: {result.stdout!r}')

    # ── CLI — missing file ────────────────────────────────────────────────────
    section('CLI round-trip — missing file returns error JSON')
    with tempfile.TemporaryDirectory() as tmp:
        script = Path(__file__).parent.parent / 'pdf_splitter.py'
        result = subprocess.run(
            [sys.executable, str(script),
             '--file', '/nonexistent/no.pdf', '--ranges', '1', '--outdir', tmp],
            capture_output=True, text=True,
        )
        try:
            out = json.loads(result.stdout.strip())
            if not check('CLI exits non-zero for missing file', result.returncode != 0, f'code={result.returncode}'):
                failures += 1
            if not check('success=false', out.get('success') is False, str(out)):
                failures += 1
        except json.JSONDecodeError:
            failures += 1
            print(f'  BAD could not parse error output: {result.stdout!r}')

    print()
    if failures:
        print(f'{failures} check(s) FAILED.')
        return 1
    print('All checks passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
