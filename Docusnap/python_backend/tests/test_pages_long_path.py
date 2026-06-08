#!/usr/bin/env python3
r"""
tests/test_pages_long_path.py
-----------------------------
Regression test for render/pages.py's _win_long_path() helper.

Context: the Template Viewer's preview pane showed "No preview available
for this sample document." for any sample document filed under a supplier
folder whose name ends in a dot or space (e.g. "Polychemtex Inc."). Node's
fs (libuv) resolves such paths fine, but pypdfium2's internal fopen/
CreateFileW calls hit Win32's legacy DOS-8.3 normalisation, which silently
strips trailing dots/spaces from path components — so PdfDocument() raised
FileNotFoundError for a file that demonstrably exists on disk.

get-document-pages (review/handler.js) is the SHARED IPC handler behind the
review, search AND template-viewer preview panes — any supplier name ending
in '.'/' ' breaks PDF preview rendering everywhere this handler is used, not
just in the template viewer. The fix wraps the path in the \\?\ extended-
length prefix, which bypasses Win32's normalisation — but ONLY if applied to
the path verbatim, since os.path.abspath()/normpath() perform that exact
normalisation themselves and would strip the trailing dot before the prefix
is even added (this is the mistake the first iteration of this fix made).

Tested directly against _win_long_path (string transform) plus an end-to-end
check that pypdfium2 can actually open a PDF inside a real trailing-dot
directory once the helper is applied — proving the fix closes the loop, not
just that the string looks right.

Usage:
    py -3.12 python_backend/tests/test_pages_long_path.py

Exit code 0 = helper behaves correctly. Exit code 1 = regression.
"""

import io
import os
import sys
import shutil
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / 'render'))
import pages  # noqa: E402

import pypdfium2 as pdfium


def check(label, condition):
    print(f"  {'OK ' if condition else 'BAD'} {label}")
    return condition


def main():
    failures = 0

    if os.name != 'nt':
        print("Skipping — _win_long_path is a Windows-only Win32-path-quirk fix "
              "(no-op on other platforms by design).")
        return 0

    # Case 1: a normal absolute local path gets the \\?\ prefix, verbatim.
    p1 = r'C:\DocusnapBuild\Cloud VPS\2026\March\Invoice.06-03-2026.337728.pdf'
    out1 = pages._win_long_path(p1)
    print("Case 1: normal absolute local path")
    if not check("prefixed with \\\\?\\", out1 == '\\\\?\\' + p1):
        failures += 1

    # Case 2: a path component ending in '.' must survive byte-for-byte —
    # this is the exact shape that broke (and the exact thing abspath() ruins).
    p2 = r'C:\DocusnapBuild\Polychemtex Inc.\2026\March\Purchase-Order.16-03-2026.204870-DUPLICATE-7.pdf'
    out2 = pages._win_long_path(p2)
    print("Case 2: path with trailing-dot directory component ('Polychemtex Inc.')")
    if not check("trailing dot preserved verbatim", 'Polychemtex Inc.\\2026' in out2):
        failures += 1
    if not check("prefixed with \\\\?\\", out2 == '\\\\?\\' + p2):
        failures += 1
    if not check("not mangled by abspath/normpath (no dot stripped)", 'Polychemtex Inc\\' not in out2):
        failures += 1

    # Case 3: an already-prefixed path must pass through untouched (idempotent).
    p3 = '\\\\?\\C:\\already\\prefixed\\file.pdf'
    out3 = pages._win_long_path(p3)
    print("Case 3: already-prefixed path")
    if not check("returned verbatim, not double-prefixed", out3 == p3):
        failures += 1

    # Case 4: a UNC path is rewritten to the \\?\UNC\ form pypdfium2/Win32 expects.
    p4 = r'\\fileserver\DocusnapBuild\Acme Ltd\2026\file.pdf'
    out4 = pages._win_long_path(p4)
    print("Case 4: UNC path")
    if not check("rewritten to \\\\?\\UNC\\ form", out4 == r'\\?\UNC\fileserver\DocusnapBuild\Acme Ltd\2026\file.pdf'):
        failures += 1

    # Case 5 (end-to-end): pypdfium2 can open a real PDF inside a real
    # trailing-dot directory once routed through _win_long_path — and cannot
    # without it. Proves the fix closes the loop against the live failure,
    # not just that the string transform looks plausible.
    print("Case 5: end-to-end open of a PDF inside a real trailing-dot directory")
    tmp_root  = Path(tempfile.mkdtemp(prefix='docusnap-longpath-'))
    long_root = '\\\\?\\' + str(tmp_root)
    try:
        # Create the trailing-dot directory and the PDF inside it via the
        # \\?\-prefixed path — exactly how Node/libuv (filing/handler.js)
        # creates supplier folders, which preserves the dot on disk. Creating
        # them through plain os.mkdir()/Path.mkdir() would hit the very same
        # Win32 normalisation this fix targets and silently produce 'Acme
        # Inc' (no dot) instead — a fixture that wouldn't reproduce the bug.
        trailing_dot_dir = long_root + '\\Acme Inc.'
        os.mkdir(trailing_dot_dir)
        long_pdf_path = trailing_dot_dir + '\\sample.pdf'

        doc = pdfium.PdfDocument.new()
        doc.new_page(100, 100)
        buf = io.BytesIO()
        doc.save(buf)
        with open(long_pdf_path, 'wb') as f:
            f.write(buf.getvalue())

        # The path as Node would hand it to this script: absolute, real,
        # *not* long-path-prefixed — Node resolves and reads it fine via
        # libuv; only the Python-side open is affected.
        raw_path = str(tmp_root / 'Acme Inc.' / 'sample.pdf')

        try:
            pdfium.PdfDocument(raw_path)
            unfixed_opened = True
        except FileNotFoundError:
            unfixed_opened = False
        if not check("WITHOUT the fix, pypdfium2 cannot open it (reproduces the live bug)", not unfixed_opened):
            failures += 1

        try:
            fixed_doc = pdfium.PdfDocument(pages._win_long_path(raw_path))
            fixed_opened = len(fixed_doc) == 1
        except FileNotFoundError:
            fixed_opened = False
        if not check("WITH the fix (_win_long_path), pypdfium2 opens it successfully", fixed_opened):
            failures += 1
    finally:
        shutil.rmtree(long_root, ignore_errors=True)

    print()
    if failures:
        print(f"{failures} check(s) failed — _win_long_path regressed.")
        return 1
    print("All checks passed — _win_long_path behaves as expected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
