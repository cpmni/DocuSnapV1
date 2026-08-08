#!/usr/bin/env python3
"""
ocr/region_worker.py — a LONG-LIVED focused-OCR worker (draw-tool UX plan Slice 2). Imports
region_core ONCE (killing the ~115ms/read pytesseract+PIL import cost), then loops reading one
newline-delimited JSON request per line from stdin and writing one JSON response per line to stdout:

  request : {"id": <n>, "file": "<png path>", "boxes": <bool>}
  response: {"id": <n>, "text": ..., "box": ..., "words": [...], "lines": <n>}
            {"id": <n>, "error": "<msg>"}          (any failure — the manager falls back to a cold spawn)

STATELESS per request (fresh Image.open every time; region_core.process holds no state) — so the
warm read is BYTE-IDENTICAL to the cold region.py CLI, and no draw can contaminate the next. A pool
of these (one per spare core, managed by src/modules/processing/regionWorker.js) runs the 3 reads of
one draw in parallel. Talks over its OWN stdio only — never touches the DB / webContents.
"""
import sys
import os
import json
import time as _time

import pytesseract
from PIL import Image

# See region.py: the packaged embeddable Python's ._pth drops the script-dir from sys.path, so a bare
# `import region_core` crashes the worker at startup (dev's system Python masks it). Add ocr/ + its
# parent explicitly before importing.
_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (os.path.dirname(_HERE), _HERE):
    if _p not in sys.path:
        sys.path.insert(0, _p)
try:
    import region_core
except ImportError:                              # imported as a package (ocr.region_worker)
    from ocr import region_core


def _handle(req):
    """One request dict -> one response dict. Never raises (errors become {'error': ...})."""
    rid = req.get('id') if isinstance(req, dict) else None
    try:
        img = Image.open(req['file']).convert('L')          # greyscale — mirrors the region.py CLI load
        res = region_core.process(img, boxes=bool(req.get('boxes')))
        return {"id": rid, "text": res["text"], "box": res["box"],
                "words": res["words"], "lines": res["lines"]}
    except Exception as e:
        return {"id": rid, "error": str(e)}


def main():
    # --tesseract <path>: set ONCE for the worker's lifetime (mirrors region.py). Parsed loosely so a
    # missing/misspelled flag never crashes the worker (it would just use the system tesseract).
    argv = sys.argv[1:]
    if '--tesseract' in argv:
        i = argv.index('--tesseract')
        if i + 1 < len(argv):
            tp = argv[i + 1]
            if tp and os.path.exists(tp):
                pytesseract.pytesseract.tesseract_cmd = tp

    # Signal readiness so the manager can distinguish "spawned + imports done" from "still warming".
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:                       # blocks until the manager sends a request (or EOF -> exit)
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue                             # ignore a malformed line rather than die
        resp = _handle(req)
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()


if __name__ == '__main__':
    main()
