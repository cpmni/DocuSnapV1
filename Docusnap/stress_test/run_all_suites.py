"""run_all_suites.py — run EVERY Python and JS test in the repo and write one machine-readable
result file, so "the suite is green" is a measurement rather than a memory.

WHY THIS EXISTS (2026-08-10). `pytest tests/` ABORTS: the tests directory mixes pytest-style files
with script-style ones, and at least one script-style file calls `sys.exit()` at import, which kills
collection for everything after it. That is a known, long-standing gotcha in CLAUDE.md, and the
practical effect is that nobody has ever had a single number for the whole suite — each session runs
the handful of files it touched. This runs each file in its OWN process so one `sys.exit` can only
fail its own file.

Two styles, detected rather than assumed:
  * pytest-style  -> `py -3.12 -m pytest <file> -q`
  * script-style  -> `py -3.12 <file>`, pass/fail by EXIT CODE
A file that pytest collects zero tests from is re-run as a script before being called empty, because
"0 collected" and "this is a script" look identical from the outside.

JS gates run under Electron-as-Node (ELECTRON_RUN_AS_NODE=1). Without that the Electron binary
launches a GUI and hangs until the timeout — the other standing gotcha.

  py -3.12 stress_test/run_all_suites.py [--python-only|--js-only] [--out results.json]

Read-only with respect to the app: it runs tests, which use their own fixtures and in-memory DBs.
It does NOT touch the live database. Some suites are slow; each file gets its own timeout.
"""
import argparse
import json
import os
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = "py"
PY_ARGS = ["-3.12"]
ELECTRON = os.path.join(REPO, "node_modules", "electron", "dist", "electron.exe")
TIMEOUT = 300

# Directories whose "tests" are harnesses needing a live corpus/DB, not unit gates.
SKIP_DIRS = {"node_modules", "Backup", "dist", "TESTING", "__pycache__", ".git", "vendor"}
# Individual files that are interactive, need a real scanner/corpus, or are known long harnesses.
SKIP_FILES = {
    "run_all_suites.py",
}


def _iter_tests(root, ext, prefix="test_"):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.startswith(prefix) and fn.endswith(ext) and fn not in SKIP_FILES:
                yield os.path.join(dirpath, fn)


def _run(cmd, cwd, env=None, timeout=TIMEOUT):
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True,
                           timeout=timeout, encoding="utf-8", errors="replace")
        return p.returncode, (p.stdout or "") + (p.stderr or ""), time.time() - t0
    except subprocess.TimeoutExpired:
        return -9, "TIMEOUT", time.time() - t0
    except Exception as e:                                   # noqa: BLE001
        return -1, f"RUNNER ERROR: {e}", time.time() - t0


def run_python(files, env):
    out = []
    for f in sorted(files):
        rel = os.path.relpath(f, REPO)
        rc, log, dt = _run([PY] + PY_ARGS + ["-m", "pytest", f, "-q", "--no-header"], REPO, env)
        style = "pytest"
        # "no tests ran" / collected 0 -> it is a script-style file, not an empty one.
        if "no tests ran" in log or "collected 0 items" in log or "INTERNALERROR" in log:
            rc, log, dt = _run([PY] + PY_ARGS + [f], REPO, env)
            style = "script"
        out.append({"file": rel, "kind": "python", "style": style, "rc": rc,
                    "ok": rc == 0, "secs": round(dt, 1), "tail": log.strip()[-400:]})
        print(f"  {'ok ' if rc == 0 else 'FAIL'} [{style:6}] {rel} ({dt:.1f}s)")
    return out


def run_js(files, env):
    out = []
    if not os.path.exists(ELECTRON):
        print(f"  (electron not found at {ELECTRON} — skipping JS)")
        return out
    jenv = dict(env)
    jenv["ELECTRON_RUN_AS_NODE"] = "1"          # or the binary opens a GUI and hangs
    for f in sorted(files):
        rel = os.path.relpath(f, REPO)
        rc, log, dt = _run([ELECTRON, f], REPO, jenv)
        out.append({"file": rel, "kind": "js", "style": "script", "rc": rc,
                    "ok": rc == 0, "secs": round(dt, 1), "tail": log.strip()[-400:]})
        print(f"  {'ok ' if rc == 0 else 'FAIL'} [js    ] {rel} ({dt:.1f}s)")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--python-only", action="store_true")
    ap.add_argument("--js-only", action="store_true")
    ap.add_argument("--out", default=os.path.join(REPO, "TESTING", "suite_results.json"))
    a = ap.parse_args()

    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"           # box-drawing chars in test output vs cp1252
    env.setdefault("PYTHONPATH", os.path.join(REPO, "python_backend"))

    results = []
    if not a.js_only:
        print("== PYTHON ==")
        results += run_python(_iter_tests(os.path.join(REPO, "python_backend"), ".py"), env)
    if not a.python_only:
        print("== JS ==")
        js = list(_iter_tests(os.path.join(REPO, "src"), ".js")) \
            + list(_iter_tests(os.path.join(REPO, "database"), ".js")) \
            + list(_iter_tests(os.path.join(REPO, "client"), ".js"))
        results += run_js(js, env)

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    passed = [r for r in results if r["ok"]]
    failed = [r for r in results if not r["ok"]]
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump({"total": len(results), "passed": len(passed), "failed": len(failed),
                   "results": results}, fh, indent=2)
    print(f"\n{len(passed)}/{len(results)} passed. {len(failed)} failed.")
    for r in failed:
        print(f"  FAIL {r['file']} (rc={r['rc']}, {r['secs']}s)")
    print(f"\nwritten: {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
