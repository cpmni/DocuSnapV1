#!/usr/bin/env python3
"""
test_file_timeout_watchdog.py
-----------------------------
Verifies the per-file watchdog in process_docs.py: when a file overruns
--file-timeout, the worker emits an error file_done for THAT file and force-exits
(escaping a wedged native OCR call) instead of hanging the batch forever.

Because the watchdog calls os._exit, the check runs in a SUBPROCESS: this script
re-invokes itself with --drive, which arms the real watchdog with a 1s timeout,
marks a file as in-progress, and sleeps (simulating a hung page). The parent then
asserts the error was emitted, the process exited promptly (well before the sleep),
and the exit code is 0.

Run:  py -3.12 python_backend/tests/test_file_timeout_watchdog.py
"""
import sys, os, time, json, subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(BACKEND))


def drive():
    # Import the REAL watchdog from process_docs (importing does not run main()).
    import process_docs as pd
    pd._start_file_watchdog(1.0)          # 1-second per-file timeout
    pd._mark_file("stuck_page.pdf")       # arm it for a file
    time.sleep(30)                        # "hang" — the watchdog should kill us at ~1s
    # If we ever get here the watchdog failed; signal it distinctly.
    pd.emit({"type": "file_done", "success": True, "status": "confirmed",
             "original_filename": "stuck_page.pdf", "note": "WATCHDOG_DID_NOT_FIRE"})
    os._exit(3)


def main():
    if "--drive" in sys.argv:
        drive()
        return

    t0 = time.monotonic()
    proc = subprocess.run([sys.executable, str(Path(__file__)), "--drive"],
                          capture_output=True, text=True, timeout=20)
    elapsed = time.monotonic() - t0

    fail = 0
    def check(label, cond, extra=""):
        nonlocal fail
        print(f"  {'OK ' if cond else 'BAD'} {label}{('  ' + extra) if extra else ''}")
        if not cond: fail += 1

    # Parse emitted JSON lines.
    done = None
    for ln in proc.stdout.splitlines():
        ln = ln.strip()
        if not ln.startswith("{"):
            continue
        try: m = json.loads(ln)
        except Exception: continue
        if m.get("type") == "file_done" and m.get("original_filename") == "stuck_page.pdf":
            done = m

    check("watchdog emitted a file_done for the stuck file", done is not None)
    check("it is an ERROR (success:false, status:error)", bool(done) and done.get("success") is False and done.get("status") == "error",
          f"(got {done})" if done else "")
    check("error message mentions the timeout", bool(done) and "timed out" in (done.get("error") or "").lower())
    check("worker did NOT reach the post-sleep line", not (done and done.get("note") == "WATCHDOG_DID_NOT_FIRE"))
    check("worker exited promptly (~1s, well before the 30s sleep)", elapsed < 6, f"({elapsed:.1f}s)")
    check("clean exit code 0", proc.returncode == 0, f"(code {proc.returncode})")

    print(f"\n{'All file-timeout watchdog checks passed.' if fail == 0 else str(fail) + ' FAILED'}")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
