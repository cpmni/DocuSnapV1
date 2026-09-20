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

import random

sys.path.insert(0, str(Path(__file__).parent.parent))
from pdf_splitter import parse_ranges, split_pdf, chunk_ranges, normalise_groups


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

    # ── normalise_groups — 1-based lists → 0-based index lists (may be non-contiguous) ──
    section('normalise_groups — clamp/dedupe/drop-empty, preserve order & non-contiguity')
    ng_cases = [
        ([[1, 2, 4], [5, 6, 8]], 8, [[0, 1, 3], [4, 5, 7]]),   # the interior-removal case
        ([[1, 9, 2]],            8, [[0, 1]]),                  # 9 out of range → dropped, order kept
        ([[1, 1, 2]],            8, [[0, 1]]),                  # duplicate collapsed
        ([[1, 2], []],           8, [[0, 1]]),                  # empty group dropped
        ([[9, 10]],              8, []),                        # all-out-of-range group → gone
        ([[1, 4, 5]],            5, [[0, 3, 4]]),               # single non-contiguous group
    ]
    for grps, total, expected in ng_cases:
        got = normalise_groups(grps, total)
        if not check(f'normalise_groups({grps}, {total}) == {expected}', got == expected, f'got {got}'):
            failures += 1

    # ── split_pdf(groups=…) — ONE file per group, non-contiguous preserved ──────
    # THE load-bearing assertion: a sub-document with an interior page removed stays ONE
    # file (file-count == group-count), NOT one file per contiguous run. A page-SET-only
    # check would pass under the buggy range-gap design too, so assert FILE COUNT and
    # PER-FILE PAGE COUNTS.
    section('split_pdf(groups) — interior removal keeps a sub-doc as one file')
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / 'grp.pdf'
        make_minimal_pdf(src, 8)
        try:
            # N=8, split at 1 & 5, blanks 3 & 7 removed → groups {1,2,4},{5,6,8}
            paths = split_pdf(str(src), None, tmp, groups=[[1, 2, 4], [5, 6, 8]])
            if not check('2 output files (NOT 4)', len(paths) == 2, f'got {len(paths)}'):
                failures += 1
            for i, expected_n in enumerate([3, 3]):
                if i < len(paths):
                    got_n = count_pages(paths[i])
                    if not check(f'group {i+1} is one {expected_n}-page file', got_n == expected_n, f'got {got_n}'):
                        failures += 1
        except Exception as exc:
            failures += 1; print(f'  BAD split_pdf(groups) raised: {exc}')

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / 'grp1.pdf'
        make_minimal_pdf(src, 5)
        try:
            paths = split_pdf(str(src), None, tmp, groups=[[1, 4, 5]])
            if not check('single non-contiguous group -> 1 file', len(paths) == 1, f'got {len(paths)}'):
                failures += 1
            if paths and not check('that file has 3 pages', count_pages(paths[0]) == 3, f'got {count_pages(paths[0])}'):
                failures += 1
        except Exception as exc:
            failures += 1; print(f'  BAD split_pdf(single group) raised: {exc}')

    # ── Property test — the split partition invariant under the groups path ─────
    section('split_pdf(groups) — property: files == non-empty groups, pages preserved')
    random.seed(20260920)
    prop_fail = 0
    for _ in range(40):
        N = random.randint(2, 20)
        # random groups of random 1-based pages (may be non-contiguous, out-of-range, dup, empty)
        n_groups = random.randint(1, 4)
        groups = [[random.randint(1, N + 2) for _ in range(random.randint(0, N))] for _ in range(n_groups)]
        expected = normalise_groups(groups, N)
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / 'p.pdf'
            make_minimal_pdf(src, N)
            paths = split_pdf(str(src), None, tmp, groups=groups)
            if len(paths) != len(expected):
                prop_fail += 1; continue
            if any(count_pages(p) != len(g) for p, g in zip(paths, expected)):
                prop_fail += 1
    if not check('40 random group-splits: file count == non-empty groups & page counts match', prop_fail == 0, f'{prop_fail} failed'):
        failures += 1

    # ── CLI — --groups-file round-trip ──────────────────────────────────────────
    section('CLI round-trip — --groups-file')
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / 'gf_source.pdf'
        make_minimal_pdf(src, 8)
        gf = Path(tmp) / 'groups.json'
        gf.write_text(json.dumps([[1, 2, 4], [5, 6, 8]]), encoding='utf-8')
        script = Path(__file__).parent.parent / 'pdf_splitter.py'
        result = subprocess.run(
            [sys.executable, str(script), '--file', str(src), '--groups-file', str(gf), '--outdir', tmp],
            capture_output=True, text=True,
        )
        try:
            out = json.loads(result.stdout.strip())
            if not check('--groups-file exits 0', result.returncode == 0, f'code={result.returncode}'):
                failures += 1
            if not check('--groups-file -> 2 files', len(out.get('files', [])) == 2, str(out)):
                failures += 1
        except json.JSONDecodeError:
            failures += 1; print(f'  BAD could not parse --groups-file output: {result.stdout!r}')

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
