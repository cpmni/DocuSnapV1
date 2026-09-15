#!/usr/bin/env python3
r"""
record.py — one command from nothing to an MP4.

    python record.py scripts\search-for-a-document.json --publish "%USERPROFILE%\Desktop\Tutorials"
    python record.py scripts\first-run-b-setup-wizard.json --as-is --licence-intro scripts\first-run-a-account-licence.json
                                                                    # the complete first run (account → licence → terms → wizard)
    python record.py --prepare                                      # just get the demo app ready (signed in, demo doc imported)
    python record.py --down                                         # stop the demo app
    python record.py --reset                                        # wipe the demo profile (next run = first run again)

The DEMO PROFILE (default C:\ScanFinderDemo — a neutral path, so nothing personal ever shows on camera):
    userData\           the app's own DB/settings (DOCUSNAP_USERDATA) — never your real %APPDATA%\ScanFinder
    Scans\First\        one demo invoice (the "teach" example)
    Scans\Batch\        eight demo invoices, two suppliers (the "import a folder" example)
    Filed Documents\    the output folder the setup wizard suggests (seeded, so no folder dialog is filmed)
The DB is seeded with scripts\seed-chris-sandbox.js (licence rows only → 0 users → create-admin flow).

Before handing over to scanfinder_video_runner.py it guarantees: the profile exists, the DEV app is running
against it with DevTools on --port, and (unless --as-is) the app is signed in on Home with Scans\First imported.
--licence-intro <script>: films <script> first on a wiped profile with NO licence rows and the licence gate
  pointed at a local fake server (so the real licence screen appears after the account is created — explain
  and hover only), then restores the licence rows, restarts, signs in silently and films the main script
  from the Terms window; the clips + timelines are joined into --out.
--publish <dir>: copy the finished MP4 + captions.srt + narration.json there and update tts_manifest.json.
Placeholders in ANY script it runs: {{USER}} {{PASS}} {{PROFILE}} {{SCANS_FIRST}} {{SCANS_BATCH}} {{OUTPUT}}
(+ a _JS variant of each path, escaped for use inside a JavaScript string in eval_js).
Everything the runner accepts (--captions, --fps, --countdown, ...) passes through.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import scanfinder_video_runner as R  # noqa: E402

DEMO_USER = "admin"
DEMO_PASS = "Scan-Finder-2026"       # demo sandbox only — a throwaway local profile, not a real account
DEFAULT_PROFILE = r"C:\ScanFinderDemo"
DEMO_DOCS = os.path.join(os.path.expanduser("~"), "Desktop", "Demo Docs")
IMPORT_MARKER = ".demo_imported"
ELECTRON = os.path.join(REPO, "node_modules", ".bin", "electron.cmd")


def log(msg: str) -> None:
    print(f"[record] {msg}", flush=True)


def electron_node(script: str, *args: str) -> str:
    """Run a Node script with Electron-as-Node (native modules are built for the Electron ABI)."""
    cmd = " ".join(f'"{a}"' for a in (ELECTRON, script, *args))
    res = subprocess.run(cmd, cwd=REPO, env={**os.environ, "ELECTRON_RUN_AS_NODE": "1"},
                         capture_output=True, text=True, shell=True)
    if res.returncode != 0:
        raise SystemExit(f"{os.path.basename(script)} failed: {res.stdout[-400:]} {res.stderr[-400:]}")
    return res.stdout.strip()


# ---- profile ---------------------------------------------------------------------------------------------------------
def _pdfs(folder: str) -> list[str]:
    return sorted(glob.glob(os.path.join(folder, "**", "*.pdf"), recursive=True))


def _demo_set(supplier: str, kind: str, count: int, skip: int = 0) -> list[str]:
    allpdf = _pdfs(os.path.join(DEMO_DOCS, supplier, kind))
    src = [p for p in allpdf if "Processed" not in p] or allpdf
    if len(src) < skip + count:
        raise SystemExit(f"need {skip + count} PDFs under Demo Docs\\{supplier}\\{kind}, found {len(src)}")
    return src[skip:skip + count]


def ensure_profile(profile: str, strip_licence: bool = False) -> None:
    first, batch = os.path.join(profile, "Scans", "First"), os.path.join(profile, "Scans", "Batch")
    for d in (os.path.join(profile, "userData"), first, batch, os.path.join(profile, "Filed Documents")):
        os.makedirs(d, exist_ok=True)
    if not _pdfs(first):
        for p in _demo_set("Copperfield Electrical", "invoice", 1):
            shutil.copy2(p, first)
        log("Scans\\First: 1 Copperfield invoice")
    if not _pdfs(batch):
        for p in _demo_set("Copperfield Electrical", "invoice", 3, skip=1) + _demo_set("Ironbridge Fabrication", "invoice", 5):
            shutil.copy2(p, batch)
        log("Scans\\Batch: 3 Copperfield + 5 Ironbridge invoices")
    user_data = os.path.join(profile, "userData")
    db = os.path.join(user_data, "docusnap.db")
    if not os.path.isfile(db):
        log("seeding a fresh sandbox DB (licence rows only, 0 users)…")
        out = electron_node(os.path.join(REPO, "scripts", "seed-chris-sandbox.js"), user_data)
        log(out.splitlines()[-1])
        # The setup wizard suggests output_folder when set → a neutral demo path, and no Browse dialog on camera.
        log(electron_node(os.path.join(HERE, "sandbox_setting.js"), user_data, "output_folder",
                          os.path.join(profile, "Filed Documents")))
        if strip_licence:
            log(electron_node(os.path.join(HERE, "sandbox_license.js"), user_data, "strip"))


def restore_licence(profile: str) -> None:
    log(electron_node(os.path.join(HERE, "sandbox_license.js"), os.path.join(profile, "userData"), "restore"))


def reset_profile(profile: str, port: int) -> None:
    app_down(port)
    if os.path.isdir(profile):
        shutil.rmtree(profile)
        log(f"removed {profile}")


# ---- app -------------------------------------------------------------------------------------------------------------
def cdp_pages(port: int) -> list[dict] | None:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as resp:
            return [t for t in json.load(resp) if t.get("type") == "page"]
    except Exception:
        return None


def ensure_app(profile: str, port: int) -> None:
    if cdp_pages(port) is not None:
        log(f"app already up on port {port}")
        return
    log(f"launching the dev app on port {port} (profile {profile})…")
    env = {**os.environ, "DOCUSNAP_USERDATA": os.path.join(profile, "userData")}
    logf = open(os.path.join(profile, "app.log"), "ab")
    subprocess.Popen(f"npm start -- --remote-debugging-port={port}", cwd=REPO, env=env, shell=True,
                     stdout=logf, stderr=subprocess.STDOUT,
                     creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
    deadline = time.monotonic() + 120
    while cdp_pages(port) is None:
        if time.monotonic() > deadline:
            raise SystemExit(f"app did not open DevTools port {port} within 120 s — see {profile}\\app.log")
        time.sleep(1)
    time.sleep(5)   # splash → login hand-off + renderer init; typing into a page mid-init loses characters
    log("app up")


def app_down(port: int) -> None:
    if cdp_pages(port) is None:
        log("app not running")
        return
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
                          f"(Get-NetTCPConnection -LocalPort {port} -State Listen | Select-Object -First 1).OwningProcess"],
                         capture_output=True, text=True).stdout.strip()
    if out.isdigit():
        subprocess.run(["taskkill", "/PID", out, "/T", "/F"], capture_output=True)
        log(f"stopped app pid {out}")
        time.sleep(2)


def visible(port: int, window: str, selector: str) -> bool:
    try:
        R.CDP(port).element_rect(window, selector)
        return True
    except Exception:
        return False


# ---- scripts ---------------------------------------------------------------------------------------------------------
def placeholder_values(profile: str) -> dict[str, str]:
    paths = {"PROFILE": profile, "SCANS_FIRST": os.path.join(profile, "Scans", "First"),
             "SCANS_BATCH": os.path.join(profile, "Scans", "Batch"), "OUTPUT": os.path.join(profile, "Filed Documents")}
    values = {"USER": DEMO_USER, "PASS": DEMO_PASS, **paths}
    # _JS variants: escaped once more so the path survives inside a JavaScript string literal in eval_js
    values.update({k + "_JS": json.dumps(v)[1:-1] for k, v in paths.items()})
    return values


def substitute(path: str, values: dict[str, str]) -> str:
    """Write a copy of the script with {{PLACEHOLDERS}} filled (JSON-escaped) and return its path."""
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    for k, v in values.items():
        text = text.replace("{{" + k + "}}", json.dumps(v)[1:-1])
    tmp = os.path.join(HERE, "out", "_resolved_" + os.path.basename(path))
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    return tmp


def run_silent(path: str, port: int, values: dict[str, str]) -> int:
    return R.main(["--script", substitute(path, values), "--out", os.path.join(HERE, "out", "_setup.mp4"),
                   "--no-record", "--captions", "none", "--countdown", "0", "--cdp-port", str(port)])


def run_recorded(path: str, out: str, port: int, values: dict[str, str], passthrough: list[str]) -> int:
    return R.main(["--script", substitute(path, values), "--out", out, "--cdp-port", str(port)] + passthrough)


def close_child_windows(port: int) -> None:
    """Return to a clean Home: close any Teach/Review/Search/Settings/… window left open by an earlier run."""
    cdp = R.CDP(port)
    try:
        pages = cdp.targets()
    except Exception:
        return
    for t in pages:
        title = (t.get("title") or "").strip()
        if title == "ScanFinder" or "Sign in" in title:
            continue
        try:
            cdp.evaluate(t, "window.close(); 'closed'")
            log(f"closed leftover window {title!r}")
        except Exception:
            pass
    time.sleep(1)


def ensure_ready(profile: str, port: int, values: dict[str, str], skip_import: bool) -> None:
    for _ in range(30):
        if R.find_window("ScanFinder"):
            break
        time.sleep(1)
    close_child_windows(port)
    if R.find_window("ScanFinder — Sign in"):
        if visible(port, "ScanFinder — Sign in", "#setup-username"):
            log("fresh profile → silent first-run (create admin, terms, wizard, tour)…")
            if run_silent(os.path.join(HERE, "scripts", "_bootstrap_demo.json"), port, values) != 0:
                raise SystemExit("bootstrap failed — look at the app window, fix, re-run")
        else:
            log("signing in…")
            if run_silent(os.path.join(HERE, "scripts", "_login_demo.json"), port, values) != 0:
                raise SystemExit("sign-in failed")
    hwnd = R.wait_for_window("ScanFinder", 60)
    R.bring_to_front(hwnd, maximize=True)
    marker = os.path.join(profile, IMPORT_MARKER)
    if not skip_import and not os.path.isfile(marker):
        log("importing Scans\\First once (the teach example)…")
        if run_silent(os.path.join(HERE, "scripts", "_import_demo.json"), port, values) != 0:
            raise SystemExit("demo import failed")
        open(marker, "w").close()
        log("demo doc imported")


# ---- fake licence server (for filming the licence screen) ------------------------------------------------------------
# The dev app's licence gate calls the REAL backend on every start and re-issues this machine's seat, so a
# licence-less sandbox never shows the licence screen. For the licence segment only, record.py runs a tiny local
# server that answers every request with {"state":"none"} ("no licence for this device") and points the dev
# app's config/license.json at it. The original file is backed up first and restored in `finally`, and any
# leftover backup is restored on the next record.py start — the swap can't outlive a run.
LICENSE_CFG = os.path.join(REPO, "config", "license.json")
LICENSE_BAK = LICENSE_CFG + ".videobak"


class FakeLicenceServer:
    def __init__(self, port: int = 9877):
        import http.server
        import threading

        class H(http.server.BaseHTTPRequestHandler):
            def _reply(self):
                body = b'{"state":"none"}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                if n:
                    self.rfile.read(n)
                self._reply()

            do_GET = _reply

            def log_message(self, *a):  # quiet
                pass

        self.port = port
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        log(f"fake licence server on http://127.0.0.1:{self.port} (answers: no licence)")
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()


def restore_license_config_if_needed() -> None:
    if os.path.isfile(LICENSE_BAK):
        shutil.copyfile(LICENSE_BAK, LICENSE_CFG)
        os.remove(LICENSE_BAK)
        log("config/license.json restored from backup")


class TempLicenceConfig:
    """Point config/license.json at the fake server for the duration of the block; always restore."""

    def __init__(self, port: int):
        self.port = port

    def __enter__(self):
        restore_license_config_if_needed()
        shutil.copyfile(LICENSE_CFG, LICENSE_BAK)
        with open(LICENSE_CFG, encoding="utf-8") as fh:
            cfg = json.load(fh)
        cfg["base_url"] = f"http://127.0.0.1:{self.port}/v1"
        with open(LICENSE_CFG, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh, indent=2)
        log("config/license.json → fake server (backup kept beside it)")
        return self

    def __exit__(self, *exc):
        restore_license_config_if_needed()


# ---- joining segments + publishing -----------------------------------------------------------------------------------
def _ffprobe_duration(ffmpeg: str, mp4: str) -> float:
    ffprobe = os.path.join(os.path.dirname(ffmpeg), "ffprobe.exe")
    out = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4],
                         capture_output=True, text=True).stdout.strip()
    return float(out)


def _times(r: dict) -> tuple[float, float]:
    s = r["actual_start"] if r["actual_start"] is not None else r["planned_start"]
    e = r["actual_end"] if r["actual_end"] is not None else r["planned_end"]
    return s, max(e, s + 0.05)


def join_segments(parts: list[str], out_mp4: str) -> None:
    """Concatenate same-format clips (concat demuxer, stream copy) and merge their timelines/captions/narration."""
    ffmpeg = R.find_ffmpeg(None)
    lst = os.path.splitext(out_mp4)[0] + ".concat.txt"
    with open(lst, "w", encoding="utf-8") as fh:
        for p in parts:
            fh.write("file '" + os.path.abspath(p).replace("\\", "/").replace("'", "'\\''") + "'\n")
    res = subprocess.run([ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
                          "-i", lst, "-c", "copy", "-movflags", "+faststart", out_mp4], capture_output=True, text=True)
    if res.returncode != 0:
        raise SystemExit(f"join failed: {res.stderr[-500:]}")
    os.remove(lst)

    rows, offset = [], 0.0
    for p in parts:
        stem = os.path.splitext(p)[0]
        with open(stem + ".timeline.json", encoding="utf-8") as fh:
            tl = json.load(fh)
        for r in tl["steps"]:
            r = dict(r)
            for k in ("planned_start", "planned_end", "actual_start", "actual_end"):
                if r.get(k) is not None:
                    r[k] = round(r[k] + offset, 3)
            r["segment"] = os.path.basename(p)
            rows.append(r)
        offset += _ffprobe_duration(ffmpeg, p)
    stem = os.path.splitext(out_mp4)[0]
    cues = []
    for r in rows:
        if not r["caption"]:
            continue
        s, e = _times(r)
        if cues and cues[-1][2] == r["caption"] and abs(cues[-1][1] - s) < 0.3:
            cues[-1][1] = e
        else:
            cues.append([s, e, r["caption"]])
    with open(stem + ".captions.srt", "w", encoding="utf-8") as fh:
        for n, (s, e, text) in enumerate(cues, 1):
            fh.write(f"{n}\n{R._srt_ts(s)} --> {R._srt_ts(e)}\n{text}\n\n")
    with open(stem + ".narration.json", "w", encoding="utf-8") as fh:
        json.dump({"video": os.path.basename(out_mp4), "total_sec": round(offset, 3),
                   "lines": [{"id": r["id"], "start": _times(r)[0], "end": _times(r)[1], "text": r["narration"]}
                             for r in rows if r["narration"].strip()]}, fh, indent=2)
    with open(stem + ".timeline.json", "w", encoding="utf-8") as fh:
        json.dump({"video": os.path.basename(out_mp4), "segments": [os.path.basename(p) for p in parts],
                   "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"), "actual_total_sec": round(offset, 3),
                   "steps": rows}, fh, indent=2)
    log(f"joined {len(parts)} segments → {out_mp4} ({offset:.1f}s)")


def publish(out_mp4: str, folder: str, title: str) -> None:
    """Copy the finished set to `folder` and refresh tts_manifest.json (one entry per video, in order)."""
    os.makedirs(folder, exist_ok=True)
    stem = os.path.splitext(out_mp4)[0]
    name = os.path.basename(stem)
    copied = []
    for ext in (".mp4", ".captions.srt", ".narration.json"):
        src = stem + ext
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(folder, name + ext))
            copied.append(name + ext)
    manifest = os.path.join(folder, "tts_manifest.json")
    entries = []
    if os.path.isfile(manifest):
        with open(manifest, encoding="utf-8") as fh:
            entries = json.load(fh).get("videos", [])
    entries = [e for e in entries if e.get("name") != name]
    with open(stem + ".narration.json", encoding="utf-8") as fh:
        nar = json.load(fh)
    entries.append({"name": name, "title": title, "video": name + ".mp4", "narration": name + ".narration.json",
                    "captions": name + ".captions.srt", "total_sec": nar.get("total_sec"),
                    "lines": nar.get("lines", [])})
    # canonical viewing order (the learning path); anything else keeps publish order after these
    order = ["first-run-setup", "teach-a-document", "import-a-folder", "review-and-confirm", "search-for-a-document"]
    entries.sort(key=lambda e: (order.index(e["name"]) if e["name"] in order else len(order)))
    with open(manifest, "w", encoding="utf-8") as fh:
        json.dump({"generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                   "how_to_use": "Each video has a narration.json: `lines[]` = {id, start, end, text} in seconds from the "
                                 "start of the MP4. Generate one TTS clip per line and place it at `start` (or feed the "
                                 "whole list to a timestamp-aware TTS tool), then mux: ffmpeg -i <video>.mp4 -i voice.wav "
                                 "-c:v copy -c:a aac -shortest <video>_final.mp4. captions.srt holds the on-screen "
                                 "captions (already burned in via the live overlay; also usable as YouTube subtitles).",
                   "videos": entries}, fh, indent=2)
    log(f"published {', '.join(copied)} → {folder}")


# ---- main ------------------------------------------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Prepare the demo ScanFinder and record a tutorial script.")
    ap.add_argument("script", nargs="?", help="video script JSON")
    ap.add_argument("--out", help="output MP4 (default out\\<script-stem>.mp4)")
    ap.add_argument("--profile", default=DEFAULT_PROFILE, help="demo profile folder (neutral path — it shows on camera)")
    ap.add_argument("--port", type=int, default=9222)
    ap.add_argument("--as-is", action="store_true", help="don't sign in / bootstrap / import — record the app as it is")
    ap.add_argument("--licence-intro", metavar="SCRIPT", help="film SCRIPT on a licence-less profile first, then the main script; join both")
    ap.add_argument("--reuse-part-a", action="store_true", help="with --licence-intro: keep the existing partA.mp4, re-film only the main script")
    ap.add_argument("--skip-import", action="store_true", help="don't import the demo doc")
    ap.add_argument("--publish", metavar="DIR", help="copy the finished mp4/srt/narration there + update tts_manifest.json")
    ap.add_argument("--prepare", action="store_true", help="profile + app + sign-in + import, then stop")
    ap.add_argument("--down", action="store_true", help="stop the demo app and exit")
    ap.add_argument("--reset", action="store_true", help="stop the app and delete the demo profile")
    opts, passthrough = ap.parse_known_args(argv)
    restore_license_config_if_needed()   # crash recovery from an interrupted --licence-intro run

    if opts.down:
        app_down(opts.port)
        return 0
    if opts.reset:
        reset_profile(opts.profile, opts.port)
        return 0
    values = placeholder_values(opts.profile)
    out = opts.out or (os.path.join(HERE, "out", os.path.splitext(os.path.basename(opts.script))[0] + ".mp4")
                       if opts.script else None)

    def title_of(path: str) -> str:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh).get("title", os.path.basename(path))

    if opts.licence_intro:
        if not opts.script:
            raise SystemExit("--licence-intro needs the main script too")
        part_a = os.path.splitext(out)[0] + ".partA.mp4"
        if opts.reuse_part_a and os.path.isfile(part_a):
            log(f"reusing {os.path.basename(part_a)}; wiping the profile and creating the account silently")
            reset_profile(opts.profile, opts.port)
            ensure_profile(opts.profile)
            ensure_app(opts.profile, opts.port)
            if run_silent(os.path.join(HERE, "scripts", "_create_admin.json"), opts.port, values) != 0:
                raise SystemExit("silent account creation failed")
        else:
            log("licence intro: starting from a wiped demo profile")
            reset_profile(opts.profile, opts.port)
            ensure_profile(opts.profile, strip_licence=True)
            with FakeLicenceServer() as fake, TempLicenceConfig(fake.port):
                ensure_app(opts.profile, opts.port)   # launched while the config points at the fake server
                rc = run_recorded(opts.licence_intro, part_a, opts.port, values, passthrough)
                app_down(opts.port)                   # stop it BEFORE the real config comes back
            if rc != 0:
                return rc
            log("licence segment done — restoring the licence and restarting")
            restore_licence(opts.profile)
            ensure_app(opts.profile, opts.port)
            log("signing in silently…")
            if run_silent(os.path.join(HERE, "scripts", "_login_demo.json"), opts.port, values) != 0:
                raise SystemExit("sign-in after licence restore failed")
        part_b = os.path.splitext(out)[0] + ".partB.mp4"
        rc = run_recorded(opts.script, part_b, opts.port, values, passthrough)
        if rc != 0:
            return rc
        join_segments([part_a, part_b], out)
        if opts.publish:
            publish(out, opts.publish, title_of(opts.licence_intro).split(":")[0] + ": " + title_of(opts.script).split(": ", 1)[-1])
        if not opts.skip_import:
            ensure_ready(opts.profile, opts.port, values, False)   # the recorded run created the account; import now
        return 0

    ensure_profile(opts.profile)
    ensure_app(opts.profile, opts.port)
    if not opts.as_is:
        ensure_ready(opts.profile, opts.port, values, opts.skip_import)
    if opts.prepare or not opts.script:
        log("demo app ready")
        return 0
    rc = run_recorded(opts.script, out, opts.port, values, passthrough)
    if rc == 0 and opts.publish:
        publish(out, opts.publish, title_of(opts.script))
    return rc


if __name__ == "__main__":
    sys.exit(main())
