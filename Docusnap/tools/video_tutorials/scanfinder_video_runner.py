#!/usr/bin/env python3
r"""
scanfinder_video_runner.py — record short ScanFinder tutorial videos from a JSON script.

    python scanfinder_video_runner.py --script scripts\example_import_and_review.json --out out\import.mp4

What it does, in order:
  1. Loads + validates the script (schema: schema/video_script.schema.json).
  2. Brings the ScanFinder window to the front (maximised by default) and works out the capture region.
  3. Starts FFmpeg (gdigrab desktop capture, cropped to that region, cursor drawn).
  4. Runs every step: moves/clicks/types via pyautogui, shows the step's caption in a click-through
     overlay window, then waits out the step's duration_sec.
  5. Stops FFmpeg and writes, next to the MP4:
        <out>.timeline.json   planned + actual start/end per step (t=0 = recording start)
        <out>.captions.srt    the captions as subtitles (also used by --captions burn)
        <out>.narration.json  the narration lines with start/end — feed this to TTS later.

Targets (where to click) — any step with a `target` accepts ONE of:
    {"selector": "#btn-search", "window": "ScanFinder"}   CSS selector resolved live over Chrome DevTools
                                                          (DEV app only: npm start -- --remote-debugging-port=9222)
    {"rel": [0.5, 0.3], "window": "ScanFinder — Search"}  fraction of the window's client area (0..1)
    {"abs": [1200, 640]}                                   absolute screen pixels
    {"image": "assets/run_button.png", "confidence": 0.9} pyautogui image match (needs a PNG crop of the control)
  plus optional "offset": [dx, dy] pixels added to the resolved point.

Actions: move_and_click | click | double_click | right_click | move_to | type_text | press_keys | scroll |
         wait | focus_window | launch_app.   See ACTIONS below and the README for the parameters of each.

Sections of this file (search for "# ====="): DPI · script loading · Win32 helpers · DevTools resolver ·
target resolver · caption overlay · recorder · timeline · actions · runner · CLI.  Each is independent so a
new action type or a new caption renderer is a local change.
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wt
import glob
import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

# ===== DPI awareness — MUST run before pyautogui / tkinter import, so every coordinate is a physical pixel ===========
def _set_dpi_aware() -> None:
    try:
        # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4 (Windows 10 1703+)
        if ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):
            return
    except Exception:
        pass
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


if sys.platform != "win32":
    sys.exit("scanfinder_video_runner.py is Windows-only (gdigrab + Win32 window handling).")
_set_dpi_aware()

import pyautogui  # noqa: E402  (after DPI awareness on purpose)

pyautogui.FAILSAFE = True   # slam the mouse into the top-left corner to abort a run
pyautogui.PAUSE = 0.05

ACTIONS = (
    "move_and_click", "click", "double_click", "right_click", "move_to", "drag",
    "type_text", "press_keys", "scroll", "wait", "focus_window", "launch_app", "eval_js",
)
TARGET_KINDS = ("selector", "rel", "abs", "image")


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ===== Script loading + validation ===================================================================================
class ScriptError(Exception):
    pass


@dataclass
class Step:
    index: int
    id: str
    action: str
    duration_sec: float
    narration: str = ""
    caption: str = ""
    target: Optional[dict] = None
    wait_for: Optional[dict] = None
    params: dict = field(default_factory=dict)   # everything else (text, keys, amount, button, ...)


@dataclass
class Script:
    title: str
    app: dict
    record: dict
    captions: dict
    lead_in_sec: float
    lead_out_sec: float
    steps: list[Step]
    raw: dict
    path: str


def _validate_target(t: Any, where: str) -> Optional[dict]:
    if t is None:
        return None
    if not isinstance(t, dict):
        raise ScriptError(f"{where}: target must be an object")
    kinds = [k for k in TARGET_KINDS if k in t]
    if len(kinds) != 1:
        raise ScriptError(f"{where}: target needs exactly one of {TARGET_KINDS}, got {kinds or 'none'}")
    k = kinds[0]
    if k in ("rel", "abs"):
        v = t[k]
        if not (isinstance(v, (list, tuple)) and len(v) == 2 and all(isinstance(n, (int, float)) for n in v)):
            raise ScriptError(f"{where}: target.{k} must be [x, y]")
        if k == "rel" and not all(0 <= n <= 1 for n in v):
            raise ScriptError(f"{where}: target.rel values must be within 0..1")
    elif not isinstance(t[k], str) or not t[k].strip():
        raise ScriptError(f"{where}: target.{k} must be a non-empty string")
    if "offset" in t:
        o = t["offset"]
        if not (isinstance(o, (list, tuple)) and len(o) == 2):
            raise ScriptError(f"{where}: target.offset must be [dx, dy]")
    if "at" in t:
        a = t["at"]
        if not (isinstance(a, (list, tuple)) and len(a) == 2 and all(isinstance(n, (int, float)) and 0 <= n <= 1 for n in a)):
            raise ScriptError(f"{where}: target.at must be [fx, fy] fractions inside the element (0..1)")
        if k != "selector":
            raise ScriptError(f"{where}: target.at only applies to selector targets")
    return t


def load_script(path: str) -> Script:
    with open(path, "r", encoding="utf-8") as fh:
        try:
            raw = json.load(fh)
        except json.JSONDecodeError as e:
            raise ScriptError(f"{path}: not valid JSON — {e}") from e
    if not isinstance(raw, dict):
        raise ScriptError("script root must be an object")
    steps_raw = raw.get("steps")
    if not isinstance(steps_raw, list) or not steps_raw:
        raise ScriptError("script.steps must be a non-empty list")

    app = dict(raw.get("app") or {})
    app.setdefault("window_title", "ScanFinder")
    app.setdefault("cdp_port", 9222)
    app.setdefault("maximize", True)
    record = dict(raw.get("record") or {})
    record.setdefault("mode", "window")
    if record["mode"] not in ("window", "screen", "region"):
        raise ScriptError("record.mode must be window | screen | region")
    if record["mode"] == "region":
        r = record.get("region")
        if not (isinstance(r, list) and len(r) == 4):
            raise ScriptError("record.region must be [x, y, w, h] when record.mode is 'region'")
    record.setdefault("fps", 30)
    captions = dict(raw.get("captions") or {})

    steps: list[Step] = []
    seen_ids: set[str] = set()
    for i, s in enumerate(steps_raw, 1):
        where = f"steps[{i}]"
        if not isinstance(s, dict):
            raise ScriptError(f"{where}: must be an object")
        action = s.get("action")
        if action not in ACTIONS:
            raise ScriptError(f"{where}: unknown action {action!r}; valid: {', '.join(ACTIONS)}")
        sid = str(s.get("id") or f"step_{i}")
        if sid in seen_ids:
            raise ScriptError(f"{where}: duplicate id {sid!r}")
        seen_ids.add(sid)
        dur = s.get("duration_sec", None)
        if not isinstance(dur, (int, float)) or dur < 0:
            raise ScriptError(f"{where} ({sid}): duration_sec must be a number >= 0")
        target = _validate_target(s.get("target"), f"{where} ({sid})")
        needs_target = action in ("move_and_click", "click", "double_click", "right_click", "move_to")
        if needs_target and target is None:
            raise ScriptError(f"{where} ({sid}): action {action} needs a target")
        if action == "drag":
            _validate_target(s.get("from"), f"{where} ({sid}).from")
            _validate_target(s.get("to"), f"{where} ({sid}).to")
            if not s.get("from") or not s.get("to"):
                raise ScriptError(f"{where} ({sid}): drag needs 'from' and 'to' targets")
        if action == "eval_js" and not isinstance(s.get("js"), str):
            raise ScriptError(f"{where} ({sid}): eval_js needs a string 'js'")
        if action == "type_text" and not isinstance(s.get("text"), str):
            raise ScriptError(f"{where} ({sid}): type_text needs a string 'text'")
        if action == "press_keys" and not s.get("keys"):
            raise ScriptError(f"{where} ({sid}): press_keys needs 'keys' (string or list)")
        if action == "launch_app" and not (s.get("exe") or app.get("exe")):
            raise ScriptError(f"{where} ({sid}): launch_app needs 'exe' (or app.exe)")
        wait_for = s.get("wait_for")
        if wait_for is not None:
            if not isinstance(wait_for, dict) or not (wait_for.get("window") or wait_for.get("selector")):
                raise ScriptError(f"{where} ({sid}): wait_for needs 'window' and/or 'selector'")
            if wait_for.get("selector"):
                _validate_target({"selector": wait_for["selector"]}, f"{where} ({sid}).wait_for")
        known = {"id", "action", "duration_sec", "narration", "caption", "target", "wait_for"}
        params = {k: v for k, v in s.items() if k not in known}
        steps.append(Step(
            index=i, id=sid, action=action, duration_sec=float(dur),
            narration=str(s.get("narration") or ""), caption=str(s.get("caption") or ""),
            target=target, wait_for=wait_for, params=params,
        ))
    return Script(
        title=str(raw.get("title") or os.path.splitext(os.path.basename(path))[0]),
        app=app, record=record, captions=captions,
        lead_in_sec=float(raw.get("lead_in_sec", 1.0)), lead_out_sec=float(raw.get("lead_out_sec", 1.5)),
        steps=steps, raw=raw, path=path,
    )


# ===== Win32 helpers (ctypes only — no pywin32 needed) ==============================================================
user32 = ctypes.windll.user32
dwmapi = ctypes.windll.dwmapi
HWND = ctypes.c_void_p
WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, HWND, ctypes.c_void_p)
user32.EnumWindows.argtypes = [WNDENUMPROC, ctypes.c_void_p]
user32.IsWindowVisible.argtypes = [HWND]
user32.IsIconic.argtypes = [HWND]
user32.GetWindowTextLengthW.argtypes = [HWND]
user32.GetWindowTextW.argtypes = [HWND, ctypes.c_wchar_p, ctypes.c_int]
user32.GetClientRect.argtypes = [HWND, ctypes.POINTER(wt.RECT)]
user32.GetWindowRect.argtypes = [HWND, ctypes.POINTER(wt.RECT)]
user32.ClientToScreen.argtypes = [HWND, ctypes.POINTER(wt.POINT)]
user32.ShowWindow.argtypes = [HWND, ctypes.c_int]
user32.SetForegroundWindow.argtypes = [HWND]
user32.GetParent.argtypes = [HWND]
user32.GetParent.restype = HWND
user32.GetClassNameW.argtypes = [HWND, ctypes.c_wchar_p, ctypes.c_int]
user32.GetWindowThreadProcessId.argtypes = [HWND, ctypes.c_void_p]
user32.AttachThreadInput.argtypes = [ctypes.c_uint, ctypes.c_uint, ctypes.c_bool]
user32.BringWindowToTop.argtypes = [HWND]
user32.GetAncestor.argtypes = [HWND, ctypes.c_uint]
user32.GetAncestor.restype = HWND
user32.GetForegroundWindow.restype = HWND
user32.GetWindowLongW.argtypes = [HWND, ctypes.c_int]
user32.SetWindowLongW.argtypes = [HWND, ctypes.c_int, ctypes.c_long]
dwmapi.DwmGetWindowAttribute.argtypes = [HWND, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]

SW_RESTORE, SW_MAXIMIZE = 9, 3
SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SM_CXSCREEN, SM_CYSCREEN = 76, 77, 0, 1
DWMWA_EXTENDED_FRAME_BOUNDS = 9


def _norm_title(s: str) -> str:
    # Titles use an em dash ("ScanFinder — Search"); be forgiving about which dash the script author typed.
    return re.sub(r"\s*[—–-]\s*", " - ", s).strip().lower()


def list_windows() -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []

    @WNDENUMPROC
    def cb(hwnd, _lp):
        if user32.IsWindowVisible(hwnd):
            n = user32.GetWindowTextLengthW(hwnd)
            if n > 0:
                buf = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(hwnd, buf, n + 1)
                out.append((hwnd, buf.value))
        return True

    user32.EnumWindows(cb, None)
    return out


APP_WINDOW_CLASSES = ("Chrome_WidgetWin_1", "#32770")   # Electron windows · native dialogs


def window_class(hwnd: int) -> str:
    buf = ctypes.create_unicode_buffer(64)
    user32.GetClassNameW(hwnd, buf, 64)
    return buf.value


def find_window(title: str) -> Optional[int]:
    """Exact (dash-normalised) title match first; then a substring match restricted to app-class windows
    (an Electron window or a native dialog). A bare substring over every window once matched the owner's
    TERMINAL tab titled '… ScanFinder …' and clicked into it — so no last-resort match. Returns HWND or None."""
    want = _norm_title(title)
    wins = list_windows()
    for h, name in wins:
        if _norm_title(name) == want:
            return h
    for h, name in wins:
        if want in _norm_title(name) and window_class(h) in APP_WINDOW_CLASSES:
            return h
    return None


def is_foreground(hwnd: int) -> bool:
    fg = user32.GetForegroundWindow()
    return bool(fg) and (fg == hwnd or user32.GetAncestor(fg, 2) == hwnd)


def wait_for_window(title: str, timeout: float) -> int:
    deadline = time.monotonic() + timeout
    while True:
        h = find_window(title)
        if h:
            return h
        if time.monotonic() > deadline:
            names = ", ".join(repr(n) for _, n in list_windows()[:12])
            raise RuntimeError(f"window {title!r} not found within {timeout:.0f}s (visible: {names} ...)")
        time.sleep(0.2)


def client_rect(hwnd: int) -> tuple[int, int, int, int]:
    """Client area on screen as (x, y, w, h) in physical pixels."""
    r = wt.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(r))
    pt = wt.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    return pt.x, pt.y, r.right - r.left, r.bottom - r.top


def frame_rect(hwnd: int) -> tuple[int, int, int, int]:
    """Visible window frame (DWM extended bounds — excludes the invisible resize border)."""
    r = wt.RECT()
    try:
        if dwmapi.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ctypes.byref(r), ctypes.sizeof(r)) == 0:
            return r.left, r.top, r.right - r.left, r.bottom - r.top
    except Exception:
        pass
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right - r.left, r.bottom - r.top


def bring_to_front(hwnd: int, maximize: bool = False) -> None:
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, SW_RESTORE)
    if maximize:
        user32.ShowWindow(hwnd, SW_MAXIMIZE)
    # Windows only honours SetForegroundWindow from the thread that owns the current foreground window.
    # Preferred: attach our input queue to that thread for the call (no synthetic keystrokes — an ALT tap
    # while a text field is focused can swallow the next characters). Fallback: the classic ALT tap.
    fg = user32.GetForegroundWindow()
    if fg and fg != hwnd:
        kernel32 = ctypes.windll.kernel32
        fg_thread = user32.GetWindowThreadProcessId(fg, None)
        me = kernel32.GetCurrentThreadId()
        attached = fg_thread and fg_thread != me and user32.AttachThreadInput(me, fg_thread, True)
        try:
            user32.SetForegroundWindow(hwnd)
        finally:
            if attached:
                user32.AttachThreadInput(me, fg_thread, False)
    else:
        user32.SetForegroundWindow(hwnd)
    # ALWAYS to the top of the z-order too: being the foreground window does not imply being on top
    # (the backdrop's topmost-toggle can sit above a foreground app window and swallow every click).
    user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040)   # HWND_TOP, NOMOVE|NOSIZE|SHOWWINDOW
    user32.BringWindowToTop(hwnd)
    time.sleep(0.25)
    if not is_foreground(hwnd):
        user32.keybd_event(0x12, 0, 0, 0)
        user32.keybd_event(0x12, 0, 2, 0)
        user32.SetForegroundWindow(hwnd)
        time.sleep(0.3)


def virtual_screen_origin() -> tuple[int, int]:
    return user32.GetSystemMetrics(SM_XVIRTUALSCREEN), user32.GetSystemMetrics(SM_YVIRTUALSCREEN)


def primary_screen_rect() -> tuple[int, int, int, int]:
    return 0, 0, user32.GetSystemMetrics(SM_CXSCREEN), user32.GetSystemMetrics(SM_CYSCREEN)


def work_area_rect() -> tuple[int, int, int, int]:
    """Primary monitor minus the taskbar (SPI_GETWORKAREA)."""
    r = wt.RECT()
    if user32.SystemParametersInfoW(48, 0, ctypes.byref(r), 0):
        return r.left, r.top, r.right - r.left, r.bottom - r.top
    return primary_screen_rect()


# ===== DevTools (CDP) resolver — CSS selector → element rect, for the DEV app ========================================
class CDP:
    """Minimal Chrome DevTools client: list page targets, evaluate JS. One short websocket per call."""

    def __init__(self, port: int):
        self.port = port

    def targets(self) -> list[dict]:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/list", timeout=4) as resp:
                return [t for t in json.load(resp) if t.get("type") == "page"]
        except Exception as e:
            raise RuntimeError(
                f"DevTools port {self.port} not reachable ({e}). Selector targets need the DEV app started with "
                f"`npm start -- --remote-debugging-port={self.port}` (the installed ScanFinder.exe refuses that flag)."
            ) from e

    def find_target(self, window: str) -> Optional[dict]:
        want = _norm_title(window)
        ts = self.targets()
        for t in ts:
            if _norm_title(t.get("title", "")) == want:
                return t
        for t in ts:
            if want in _norm_title(t.get("title", "")) or want in t.get("url", "").lower():
                return t
        return None

    def evaluate(self, target: dict, expression: str) -> Any:
        try:
            from websocket import create_connection  # websocket-client
        except ImportError as e:
            raise RuntimeError("selector targets need `pip install websocket-client`") from e
        ws_url = target.get("webSocketDebuggerUrl")
        if not ws_url:
            raise RuntimeError(f"target {target.get('title')!r} has no webSocketDebuggerUrl (another DevTools client attached?)")
        ws = create_connection(ws_url, timeout=5, suppress_origin=True)
        try:
            ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                                "params": {"expression": expression, "returnByValue": True, "awaitPromise": True}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == 1:
                    break
        finally:
            ws.close()
        if "error" in msg:
            raise RuntimeError(f"DevTools error: {msg['error']}")
        res = msg.get("result", {}).get("result", {})
        if res.get("subtype") == "error" or "exceptionDetails" in msg.get("result", {}):
            raise RuntimeError(f"JS error: {res.get('description') or msg['result'].get('exceptionDetails')}")
        return res.get("value")

    _RECT_JS = """
(() => {
  const el = document.querySelector(%s);
  if (!el) return { error: 'no element matches' };
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });   // 'center' would re-centre an oversized page canvas
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  return { x: r.left, y: r.top, w: r.width, h: r.height, visible, dpr: window.devicePixelRatio, title: document.title };
})()
"""

    def element_rect(self, window: str, selector: str) -> dict:
        target = self.find_target(window)
        if not target:
            titles = ", ".join(repr(t.get("title")) for t in self.targets())
            raise RuntimeError(f"no DevTools page titled like {window!r} (open pages: {titles})")
        val = self.evaluate(target, self._RECT_JS % json.dumps(selector))
        if not isinstance(val, dict) or val.get("error"):
            raise RuntimeError(f"{selector!r} in {target.get('title')!r}: {val.get('error') if isinstance(val, dict) else val}")
        if not val.get("visible"):
            raise RuntimeError(f"{selector!r} in {target.get('title')!r} exists but is not visible yet")
        return val


# ===== Target resolver — any target form → one screen point ==========================================================
class TargetResolver:
    def __init__(self, app: dict, cdp_port: Optional[int] = None):
        self.app = app
        self.cdp = CDP(int(cdp_port or app.get("cdp_port") or 9222))
        self.last_hwnd: Optional[int] = None   # the OS window the last rel/selector target was resolved in

    def _window_for(self, target: dict) -> str:
        return str(target.get("window") or self.app.get("window_title") or "ScanFinder")

    def resolve(self, target: dict, timeout: float = 20.0) -> tuple[int, int, str]:
        """Returns (x, y, description). Retries until `timeout` so a window/element that is still
        opening — or the app briefly stalling under load (synchronous better-sqlite3 on a busy CPU) —
        gets a chance to recover. The step's own duration is not consumed by this wait."""
        deadline = time.monotonic() + timeout
        last: Optional[Exception] = None
        while True:
            try:
                x, y, desc = self._resolve_once(target)
                ox, oy = (target.get("offset") or (0, 0))
                return int(round(x + ox)), int(round(y + oy)), desc
            except Exception as e:  # noqa: BLE001 — every resolver failure is retryable until the deadline
                last = e
                if time.monotonic() > deadline:
                    raise RuntimeError(f"could not resolve target {target}: {last}") from last
                time.sleep(0.25)

    def _resolve_once(self, t: dict) -> tuple[float, float, str]:
        self.last_hwnd = None
        if "abs" in t:
            x, y = t["abs"]
            return float(x), float(y), f"abs({x},{y})"
        if "rel" in t:
            title = self._window_for(t)
            hwnd = find_window(title)
            if not hwnd:
                raise RuntimeError(f"window {title!r} not found")
            cx, cy, cw, ch = client_rect(hwnd)
            fx, fy = t["rel"]
            self.last_hwnd = hwnd
            return cx + cw * fx, cy + ch * fy, f"rel({fx},{fy}) of {title!r}"
        if "image" in t:
            path = t["image"]
            if not os.path.isabs(path):
                path = os.path.join(os.path.dirname(os.path.abspath(self.app.get("_script_path", "."))), path)
            kwargs = {}
            if "confidence" in t:
                kwargs["confidence"] = float(t["confidence"])
            try:
                pt = pyautogui.locateCenterOnScreen(path, **kwargs)
            except TypeError:  # no opencv → no confidence kwarg
                pt = pyautogui.locateCenterOnScreen(path)
            except pyautogui.ImageNotFoundException:
                pt = None
            if pt is None:
                raise RuntimeError(f"image {path!r} not found on screen")
            return float(pt.x), float(pt.y), f"image({os.path.basename(path)})"
        if "selector" in t:
            title = self._window_for(t)
            rect = self.cdp.element_rect(title, t["selector"])
            hwnd = find_window(rect.get("title") or title)
            if not hwnd:
                raise RuntimeError(f"OS window for page {rect.get('title')!r} not found")
            cx, cy, cw, ch = client_rect(hwnd)
            dpr = float(rect.get("dpr") or 1.0)
            fx, fy = (t.get("at") or (0.5, 0.5))   # point inside the element (fractions), default centre
            x = cx + (rect["x"] + rect["w"] * fx) * dpr
            y = cy + (rect["y"] + rect["h"] * fy) * dpr
            if not (cx <= x <= cx + cw and cy <= y <= cy + ch):
                raise RuntimeError(f"{t['selector']!r} resolved outside the window client area ({x:.0f},{y:.0f})")
            self.last_hwnd = hwnd
            at = f"@{t['at']}" if t.get("at") else ""
            return x, y, f"{t['selector']}{at} in {rect.get('title')!r}"
        raise RuntimeError(f"unsupported target {t}")

    def wait_for(self, cond: dict, timeout: float) -> None:
        if cond.get("window"):
            wait_for_window(str(cond["window"]), timeout)
        if cond.get("selector"):
            self.resolve({"selector": cond["selector"], "window": cond.get("window")}, timeout)


# ===== Caption overlay — borderless, topmost, click-through tkinter window ===========================================
class CaptionOverlay:
    """Runs on the MAIN thread (tkinter requirement); the step runner posts captions via a queue."""

    WS_EX_TRANSPARENT, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE = 0x20, 0x80000, 0x80, 0x8000000
    GWL_EXSTYLE = -20

    def __init__(self, region: tuple[int, int, int, int], style: dict, captions: bool = True,
                 backdrop: Optional[str] = None):
        import tkinter as tk
        self.region = region
        self.style = style
        self.captions = captions
        self.root = tk.Tk()
        self.root.withdraw()
        self.backdrop = None
        if backdrop:
            # A plain full-screen window BEHIND the app: hides the desktop/terminal/other apps when the
            # recorded window is small (sign-in, wizard, dialogs). Never topmost, never activates.
            bx, by, bw, bh = work_area_rect()
            self.backdrop = tk.Toplevel(self.root)
            self.backdrop.overrideredirect(True)
            self.backdrop.configure(bg=backdrop)
            self.backdrop.geometry(f"{bw}x{bh}+{bx}+{by}")
            self.backdrop.update_idletasks()
            self.backdrop.update()
            self.backdrop_hwnd = user32.GetParent(self.backdrop.winfo_id()) or self.backdrop.winfo_id()
            user32.SetWindowLongW(self.backdrop_hwnd, self.GWL_EXSTYLE,
                                  user32.GetWindowLongW(self.backdrop_hwnd, self.GWL_EXSTYLE) | self.WS_EX_NOACTIVATE | self.WS_EX_TOOLWINDOW)
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", float(style.get("opacity", 0.92)))
        bg = style.get("background", "#141414")
        self.root.configure(bg=bg)
        x, y, w, h = region
        self.label = tk.Label(
            self.root, text="", fg=style.get("color", "#ffffff"), bg=bg,
            font=(style.get("font", "Segoe UI"), int(style.get("font_size", 26)), "bold"),
            wraplength=int(w * float(style.get("max_width_frac", 0.8))), justify="center",
            padx=int(style.get("pad_x", 28)), pady=int(style.get("pad_y", 14)),
        )
        self.label.pack()
        self.root.update_idletasks()
        self._make_click_through()

    def place_backdrop_under(self, hwnd: Optional[int]) -> None:
        """Insert the backdrop DIRECTLY BELOW `hwnd` in the z-order (no activation): app > backdrop > the rest.
        Called at every step start and after every re-front, because each app window hand-off (Terms closes,
        the wizard opens) lets Windows activate whatever was next — usually the presenter's terminal."""
        if not self.backdrop or not hwnd:
            return
        # SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE|SWP_SHOWWINDOW
        user32.SetWindowPos(self.backdrop_hwnd, hwnd, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0040)

    def _make_click_through(self) -> None:
        # Tk wraps the toplevel: winfo_id() is the inner child, GetParent() the real frame window.
        # Style ONLY the wrapper. (Making the inner child WS_EX_LAYERED hides it — a layered window is
        # invisible until SetLayeredWindowAttributes is called on it — which rendered a black box.)
        inner = self.root.winfo_id()
        hwnd = user32.GetParent(inner) or inner
        ex = user32.GetWindowLongW(hwnd, self.GWL_EXSTYLE)
        ex |= self.WS_EX_LAYERED | self.WS_EX_TRANSPARENT | self.WS_EX_TOOLWINDOW | self.WS_EX_NOACTIVATE
        user32.SetWindowLongW(hwnd, self.GWL_EXSTYLE, ex)
        alpha = int(round(float(self.style.get("opacity", 0.92)) * 255))
        user32.SetLayeredWindowAttributes(hwnd, 0, alpha, 0x2)  # LWA_ALPHA

    def set_caption(self, text: str) -> None:
        text = (text or "").strip()
        if not text or not self.captions:
            self.root.withdraw()
            return
        self.label.config(text=text)
        self.root.update_idletasks()
        w, h = self.label.winfo_reqwidth(), self.label.winfo_reqheight()
        rx, ry, rw, rh = self.region
        pos = self.style.get("position", "bottom")
        margin = int(self.style.get("margin", 56))
        x = rx + (rw - w) // 2
        y = ry + margin if pos == "top" else ry + rh - margin - h
        self.root.geometry(f"{w}x{h}+{x}+{y}")
        self.root.deiconify()
        self.root.attributes("-topmost", True)
        self._make_click_through()   # Tk may recreate its wrapper window on deiconify — re-apply
        self.root.update_idletasks()

    def run(self, work: Callable[[Callable[[str], None], Callable[[], None]], None]) -> None:
        """Run `work(set_caption, raise_backdrop)` on a worker thread while tkinter owns the main thread.
        Both callables are thread-safe posts; the Tk work happens here on the main thread."""
        q: queue.Queue = queue.Queue()
        outcome: dict = {}

        def post_caption(text: str) -> None:
            q.put(("caption", text))

        def post_backdrop(under_hwnd: Optional[int]) -> None:
            done = threading.Event()
            q.put(("backdrop", (done, under_hwnd)))
            done.wait(1.0)

        def worker() -> None:
            try:
                work(post_caption, post_backdrop)
            except BaseException as e:  # noqa: BLE001 — re-raised on the main thread below
                outcome["error"] = e
            finally:
                q.put(("done", None))

        threading.Thread(target=worker, name="steps", daemon=True).start()

        def poll() -> None:
            try:
                while True:
                    kind, val = q.get_nowait()
                    if kind == "caption":
                        self.set_caption(val)
                    elif kind == "backdrop":
                        done, under = val
                        self.place_backdrop_under(under)
                        done.set()
                    elif kind == "done":
                        self.root.quit()
                        return
            except queue.Empty:
                pass
            self.root.after(40, poll)

        self.root.after(40, poll)
        try:
            self.root.mainloop()
        finally:
            try:
                self.root.destroy()
            except Exception:
                pass
        if "error" in outcome:
            raise outcome["error"]


# ===== Recorder — FFmpeg gdigrab, desktop capture cropped to the region ==============================================
def find_ffmpeg(explicit: Optional[str]) -> str:
    cands = [explicit, os.environ.get("FFMPEG"), shutil.which("ffmpeg")]
    cands += glob.glob(os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Packages",
                                    "Gyan.FFmpeg*", "ffmpeg-*", "bin", "ffmpeg.exe"))
    cands += [r"C:\ffmpeg\bin\ffmpeg.exe", r"C:\Program Files\ffmpeg\bin\ffmpeg.exe"]
    for c in cands:
        if c and os.path.isfile(c):
            return c
    raise RuntimeError("ffmpeg not found — install it (README → FFmpeg) or pass --ffmpeg <path to ffmpeg.exe>")


class Recorder:
    def __init__(self, ffmpeg: str, region: tuple[int, int, int, int], fps: int, out_path: str):
        self.ffmpeg, self.fps, self.out_path = ffmpeg, fps, out_path
        x, y, w, h = region
        vx, vy = virtual_screen_origin()
        # libx264 needs even dimensions; crop coordinates are relative to the captured (virtual) desktop.
        self.crop = (w - w % 2, h - h % 2, x - vx, y - vy)
        self.proc: Optional[subprocess.Popen] = None

    def start(self) -> None:
        w, h, x, y = self.crop
        cmd = [
            self.ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "gdigrab", "-framerate", str(self.fps), "-draw_mouse", "1", "-i", "desktop",
            "-vf", f"crop={w}:{h}:{x}:{y}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-r", str(self.fps), "-movflags", "+faststart", self.out_path,
        ]
        os.makedirs(os.path.dirname(os.path.abspath(self.out_path)) or ".", exist_ok=True)
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                     creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        time.sleep(0.4)
        if self.proc.poll() is not None:
            err = self.proc.stderr.read().decode(errors="replace") if self.proc.stderr else ""
            raise RuntimeError(f"ffmpeg exited at start: {err.strip()}")

    def stop(self) -> None:
        if not self.proc or self.proc.poll() is not None:
            return
        try:
            self.proc.stdin.write(b"q")   # graceful: flushes the MP4 index
            self.proc.stdin.flush()
        except Exception:
            pass
        try:
            _, err = self.proc.communicate(timeout=15)
            if self.proc.returncode not in (0, None):
                log(f"ffmpeg exit {self.proc.returncode}: {err.decode(errors='replace').strip()[-400:]}")
        except subprocess.TimeoutExpired:
            self.proc.kill()
            log("ffmpeg did not stop gracefully — killed (the MP4 may be truncated)")


def burn_captions(ffmpeg: str, raw_mp4: str, srt: str, out_mp4: str, style: dict) -> None:
    """Post-process: burn the SRT into the video (needs an ffmpeg with libass — the gyan.dev 'full' build has it).
    Runs with cwd = the output folder and RELATIVE names so the subtitles filter never sees a Windows path."""
    out_dir = os.path.dirname(os.path.abspath(out_mp4)) or "."
    force = (f"FontName={style.get('font', 'Segoe UI')},FontSize={int(style.get('font_size', 26)) // 1},"
             f"Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=4,"
             f"BackColour=&H80000000,Alignment={8 if style.get('position') == 'top' else 2},MarginV=40")
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", os.path.relpath(raw_mp4, out_dir),
           "-vf", f"subtitles={os.path.relpath(srt, out_dir)}:force_style='{force}'",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", os.path.relpath(out_mp4, out_dir)]
    res = subprocess.run(cmd, cwd=out_dir, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"caption burn failed: {res.stderr.strip()[-600:]}")


# ===== Timeline — planned vs actual times, SRT + narration JSON for the TTS pass ====================================
def _srt_ts(sec: float) -> str:
    ms = int(round(max(sec, 0) * 1000))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


class Timeline:
    def __init__(self, script: Script):
        self.script = script
        self.rows: list[dict] = []
        t = script.lead_in_sec
        for st in script.steps:
            self.rows.append({
                "id": st.id, "action": st.action, "caption": st.caption, "narration": st.narration,
                "planned_start": round(t, 3), "planned_end": round(t + st.duration_sec, 3),
                "actual_start": None, "actual_end": None, "status": "pending", "note": "",
            })
            t += st.duration_sec
        self.planned_total = t + script.lead_out_sec
        self.t0: Optional[float] = None
        self.actual_total: Optional[float] = None

    def now(self) -> float:
        return time.monotonic() - (self.t0 or time.monotonic())

    def start_recording_clock(self, latency: float) -> None:
        self.t0 = time.monotonic() + latency   # first frame lands ~latency after Popen

    def mark(self, i: int, key: str, status: Optional[str] = None, note: str = "") -> None:
        self.rows[i][key] = round(self.now(), 3)
        if status:
            self.rows[i]["status"] = status
        if note:
            self.rows[i]["note"] = note

    def print_plan(self) -> None:
        print(f"\n{self.script.title} — planned {self.planned_total:.1f}s "
              f"(lead-in {self.script.lead_in_sec}s, lead-out {self.script.lead_out_sec}s)\n")
        print(f"{'#':>3} {'start':>7} {'end':>7}  {'action':<14} {'id':<22} caption")
        for i, r in enumerate(self.rows, 1):
            print(f"{i:>3} {r['planned_start']:>7.1f} {r['planned_end']:>7.1f}  {r['action']:<14} {r['id']:<22} {r['caption'][:60]}")
        print()

    def _times(self, r: dict) -> tuple[float, float]:
        s = r["actual_start"] if r["actual_start"] is not None else r["planned_start"]
        e = r["actual_end"] if r["actual_end"] is not None else r["planned_end"]
        return s, max(e, s + 0.05)

    def write(self, out_mp4: str) -> dict:
        stem = os.path.splitext(out_mp4)[0]
        paths = {"timeline": stem + ".timeline.json", "srt": stem + ".captions.srt", "narration": stem + ".narration.json"}
        # SRT — consecutive identical captions are merged so a caption held over several steps is one cue.
        cues: list[list] = []
        for r in self.rows:
            if not r["caption"]:
                continue
            s, e = self._times(r)
            if cues and cues[-1][2] == r["caption"] and abs(cues[-1][1] - s) < 0.3:
                cues[-1][1] = e
            else:
                cues.append([s, e, r["caption"]])
        with open(paths["srt"], "w", encoding="utf-8") as fh:
            for n, (s, e, text) in enumerate(cues, 1):
                fh.write(f"{n}\n{_srt_ts(s)} --> {_srt_ts(e)}\n{text}\n\n")
        narration = [{"id": r["id"], "start": self._times(r)[0], "end": self._times(r)[1], "text": r["narration"]}
                     for r in self.rows if r["narration"].strip()]
        with open(paths["narration"], "w", encoding="utf-8") as fh:
            json.dump({"title": self.script.title, "video": os.path.basename(out_mp4),
                       "source_script": os.path.basename(self.script.path),
                       "total_sec": self.actual_total or self.planned_total, "lines": narration}, fh, indent=2)
        with open(paths["timeline"], "w", encoding="utf-8") as fh:
            json.dump({"title": self.script.title, "video": os.path.basename(out_mp4),
                       "source_script": os.path.basename(self.script.path), "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                       "planned_total_sec": round(self.planned_total, 3), "actual_total_sec": self.actual_total,
                       "steps": self.rows}, fh, indent=2)
        return paths


# ===== Actions — one function per action type; add new ones to ACTIONS + this table =================================
class Actions:
    def __init__(self, script: Script, resolver: TargetResolver, sleep: Callable[[float], None]):
        self.script, self.resolver, self.sleep = script, resolver, sleep
        self.after_front: Callable[[int], None] = lambda _h: None   # runner hook: re-seat the backdrop under hwnd

    def _goto(self, st: Step) -> tuple[int, int]:
        x, y, desc = self.resolver.resolve(st.target, float(st.params.get("resolve_timeout", 20)))
        log(f"  → {desc} = ({x},{y})")
        hwnd = self.resolver.last_hwnd
        if hwnd and not is_foreground(hwnd):
            # Something else took focus (the owner's terminal, a notification…) and may now COVER the
            # target — a click would land on it. Re-front the app window first, never maximise here.
            log("  ! target window not in front — bringing it forward")
            bring_to_front(hwnd, maximize=False)
        if hwnd:
            self.after_front(hwnd)
        pyautogui.moveTo(x, y, duration=float(st.params.get("move_duration", 0.6)), tween=pyautogui.easeInOutQuad)
        self.sleep(float(st.params.get("hover_sec", 0.25)))   # a beat so the viewer sees where the cursor landed
        return x, y

    def move_to(self, st: Step) -> None:
        self._goto(st)

    def drag(self, st: Step) -> None:
        """Left-drag from `from` to `to` (both targets) — e.g. drawing a teach box on a page."""
        timeout = float(st.params.get("resolve_timeout", 20))
        x1, y1, d1 = self.resolver.resolve(st.params["from"], timeout)
        x2, y2, d2 = self.resolver.resolve(st.params["to"], timeout)
        log(f"  → drag {d1} ({x1},{y1}) → {d2} ({x2},{y2})")
        hwnd = self.resolver.last_hwnd
        if hwnd and not is_foreground(hwnd):
            log("  ! target window not in front — bringing it forward")
            bring_to_front(hwnd, maximize=False)
        if hwnd:
            self.after_front(hwnd)
        button = str(st.params.get("button", "left"))   # "right" = pan gesture in the teach/preview panes
        pyautogui.moveTo(x1, y1, duration=float(st.params.get("move_duration", 0.6)), tween=pyautogui.easeInOutQuad)
        self.sleep(float(st.params.get("hover_sec", 0.3)))
        pyautogui.mouseDown(button=button)
        self.sleep(0.15)
        pyautogui.moveTo(x2, y2, duration=float(st.params.get("drag_duration", 0.9)), tween=pyautogui.easeInOutQuad)
        self.sleep(0.15)
        pyautogui.mouseUp(button=button)

    def eval_js(self, st: Step) -> None:
        """Run JavaScript in an app page over DevTools (dev app only). Demo/privacy hook — e.g. set the import
        folder without opening the native picker (which would show the presenter's own folder tree)."""
        window = str(st.params.get("window") or self.script.app.get("window_title") or "ScanFinder")
        target = self.resolver.cdp.find_target(window)
        if not target:
            raise RuntimeError(f"no DevTools page titled like {window!r}")
        val = self.resolver.cdp.evaluate(target, st.params["js"])
        log(f"  → eval_js in {target.get('title')!r} = {json.dumps(val)[:120]}")

    def move_and_click(self, st: Step) -> None:
        x, y = self._goto(st)
        pyautogui.click(x, y, clicks=int(st.params.get("clicks", 1)), interval=0.12,
                        button=str(st.params.get("button", "left")))

    click = move_and_click

    def double_click(self, st: Step) -> None:
        st.params.setdefault("clicks", 2)
        self.move_and_click(st)

    def right_click(self, st: Step) -> None:
        st.params.setdefault("button", "right")
        self.move_and_click(st)

    def type_text(self, st: Step) -> None:
        if st.target:
            self.move_and_click(st)
            self.sleep(0.15)
        if st.params.get("clear"):
            pyautogui.hotkey("ctrl", "a")
            pyautogui.press("backspace")
        text = st.params["text"]
        interval = float(st.params.get("interval", 0.045))
        if text.isascii():
            pyautogui.write(text, interval=interval)
        else:
            try:
                from pynput.keyboard import Controller
                kb = Controller()
                for ch in text:
                    kb.type(ch)
                    time.sleep(interval)
            except ImportError:
                log("  ! non-ASCII text needs `pip install pynput`; typing ASCII characters only")
                pyautogui.write("".join(c for c in text if c.isascii()), interval=interval)
        if st.params.get("enter"):
            pyautogui.press("enter")

    def press_keys(self, st: Step) -> None:
        keys = st.params["keys"]
        presses = int(st.params.get("presses", 1))
        if isinstance(keys, str):
            keys = [keys]
        for _ in range(presses):
            if len(keys) == 1:
                pyautogui.press(keys[0])
            else:
                pyautogui.hotkey(*keys)
            self.sleep(0.1)

    def scroll(self, st: Step) -> None:
        if st.target:
            self._goto(st)
        pyautogui.scroll(int(st.params.get("amount", -400)))

    def wait(self, st: Step) -> None:
        pass  # the runner waits out duration_sec for every step

    def focus_window(self, st: Step) -> None:
        title = str(st.params.get("window") or self.script.app["window_title"])
        hwnd = wait_for_window(title, float(st.params.get("timeout", 10)))
        bring_to_front(hwnd, maximize=bool(st.params.get("maximize", False)))
        self.after_front(hwnd)

    def launch_app(self, st: Step) -> None:
        exe = str(st.params.get("exe") or self.script.app.get("exe"))
        args = [str(a) for a in (st.params.get("args") or [])]
        cwd = st.params.get("cwd") or None
        if exe.lower().endswith((".cmd", ".bat")) or st.params.get("shell"):
            subprocess.Popen(" ".join([f'"{exe}"'] + args), cwd=cwd, shell=True)
        else:
            subprocess.Popen([exe] + args, cwd=cwd)
        title = str(st.params.get("wait_for_window") or self.script.app["window_title"])
        hwnd = wait_for_window(title, float(st.params.get("timeout", 60)))
        bring_to_front(hwnd, maximize=bool(self.script.app.get("maximize", True)))

    def run(self, st: Step) -> None:
        getattr(self, st.action)(st)


# ===== Runner — orchestrates window focus, recorder, overlay, steps, timeline ========================================
class Runner:
    def __init__(self, script: Script, opts: argparse.Namespace):
        self.script, self.opts = script, opts
        self.stop_event = threading.Event()
        script.app["_script_path"] = script.path
        self.resolver = TargetResolver(script.app, opts.cdp_port)
        self.timeline = Timeline(script)
        self.actions = Actions(script, self.resolver, self.sleep)

    # -- interruptible sleep (Ctrl+C / failsafe set stop_event) --
    def sleep(self, seconds: float) -> None:
        end = time.monotonic() + max(seconds, 0)
        while True:
            if self.stop_event.is_set():
                raise KeyboardInterrupt
            left = end - time.monotonic()
            if left <= 0:
                return
            time.sleep(min(left, 0.05))

    def capture_region(self) -> tuple[int, int, int, int]:
        rec = self.script.record
        if rec["mode"] == "region":
            x, y, w, h = rec["region"]
            return int(x), int(y), int(w), int(h)
        if rec["mode"] == "screen":
            return work_area_rect()   # primary monitor without the taskbar
        title = str(rec.get("window") or self.opts.window or self.script.app["window_title"])
        hwnd = wait_for_window(title, 10)
        return frame_rect(hwnd)

    def prepare_window(self) -> None:
        title = str(self.opts.window or self.script.app["window_title"])
        self.app_hwnd = wait_for_window(title, 10)
        bring_to_front(self.app_hwnd, maximize=bool(self.script.app.get("maximize", True)))
        log(f"window {title!r} in front (maximize={self.script.app.get('maximize', True)})")

    def verify_targets(self) -> int:
        """Resolve every target without moving the mouse. Returns the number of failures."""
        fails = 0
        for st in self.script.steps:
            for label, t in (("target", st.target), ("wait_for", st.wait_for)):
                if not t:
                    continue
                if label == "wait_for":
                    t = {"selector": t["selector"], "window": t.get("window")} if t.get("selector") else None
                    if not t:
                        continue
                try:
                    x, y, desc = self.resolver.resolve(t, 3)
                    log(f"ok   {st.id:<22} {label}: {desc} → ({x},{y})")
                except Exception as e:  # noqa: BLE001
                    fails += 1
                    log(f"FAIL {st.id:<22} {label}: {e}")
        return fails

    def current_app_window(self) -> Optional[int]:
        """The app window to keep the backdrop under: the foreground window if it is an app window, else the
        last window a target resolved in, else the window the run started on."""
        fg = user32.GetForegroundWindow()
        if fg and window_class(fg) in APP_WINDOW_CLASSES:
            return fg
        return self.resolver.last_hwnd or getattr(self, "app_hwnd", None)

    def run_steps(self, set_caption: Callable[[str], None],
                  place_backdrop: Callable[[Optional[int]], None] = lambda _h: None) -> None:
        tl, script = self.timeline, self.script
        self.actions.after_front = place_backdrop
        self.sleep(script.lead_in_sec)
        place_backdrop(self.current_app_window())
        for i, st in enumerate(script.steps):
            start = time.monotonic()
            log(f"step {i + 1}/{len(script.steps)} {st.id} [{st.action}] {st.duration_sec:.1f}s  {st.caption!r}")
            set_caption(st.caption)
            place_backdrop(self.current_app_window())   # each window hand-off may have surfaced the terminal
            tl.mark(i, "actual_start", "running")
            try:
                if st.wait_for:
                    self.resolver.wait_for(st.wait_for, float(st.wait_for.get("timeout", 10)))
                self.actions.run(st)
            except KeyboardInterrupt:
                tl.mark(i, "actual_end", "aborted")
                raise
            except Exception as e:  # noqa: BLE001
                tl.mark(i, "actual_end", "failed", str(e))
                if st.params.get("optional"):
                    log(f"  ! optional step failed, continuing: {e}")
                else:
                    raise RuntimeError(f"step {st.id} failed: {e}") from e
            spent = time.monotonic() - start
            if spent > st.duration_sec + 0.5:
                log(f"  ! step ran {spent - st.duration_sec:.1f}s over its duration_sec — timeline shifts")
            self.sleep(st.duration_sec - spent)
            tl.mark(i, "actual_end", "done" if tl.rows[i]["status"] == "running" else None)
        set_caption("")
        self.sleep(script.lead_out_sec)
        tl.actual_total = round(tl.now(), 3)

    def run(self) -> int:
        opts, script = self.opts, self.script
        self.timeline.print_plan()
        if opts.dry_run:
            if opts.verify:
                fails = self.verify_targets()
                return 1 if fails else 0
            return 0

        self.prepare_window()
        region = self.capture_region()
        log(f"capture region x={region[0]} y={region[1]} w={region[2]} h={region[3]}")
        if opts.verify and self.verify_targets():
            return 1

        ffmpeg = None if opts.no_record else find_ffmpeg(opts.ffmpeg)
        want_burn = opts.captions == "burn" and not opts.no_record
        raw_out = os.path.splitext(opts.out)[0] + ".raw.mp4" if want_burn else opts.out
        recorder = Recorder(ffmpeg, region, int(opts.fps or script.record.get("fps", 30)), raw_out) if ffmpeg else None

        for n in range(int(opts.countdown), 0, -1):
            log(f"starting in {n}… (hands off the mouse; top-left corner = abort)")
            time.sleep(1)

        backdrop = script.record.get("backdrop")
        overlay = None
        if opts.captions == "live" or backdrop:
            overlay = CaptionOverlay(region, script.captions, captions=(opts.captions == "live"), backdrop=backdrop)
            if backdrop:
                overlay.root.update()
                bring_to_front(self.app_hwnd, maximize=False)   # the new backdrop came up in front — put the app back
                overlay.place_backdrop_under(self.app_hwnd)
        exit_code = 0
        try:
            if recorder:
                recorder.start()
                log(f"recording → {raw_out}")
            self.timeline.start_recording_clock(float(opts.start_latency) if recorder else 0.0)
            if overlay:
                overlay.run(self.run_steps)
            else:
                self.run_steps(lambda _t: None, lambda _h: None)
            log("steps finished")
        except KeyboardInterrupt:
            self.stop_event.set()
            log("aborted")
            exit_code = 130
        except Exception as e:  # noqa: BLE001
            self.stop_event.set()
            log(f"ERROR: {e}")
            exit_code = 2
        finally:
            if recorder:
                recorder.stop()

        paths = self.timeline.write(opts.out)
        if exit_code == 0 and want_burn and recorder:
            log("burning captions…")
            burn_captions(ffmpeg, raw_out, paths["srt"], opts.out, script.captions)
            if not opts.keep_raw:
                os.remove(raw_out)
        log(f"video     {opts.out if (exit_code == 0 or not want_burn) else raw_out}")
        for k, p in paths.items():
            log(f"{k:<9} {p}")
        return exit_code


# ===== CLI ===========================================================================================================
def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Drive ScanFinder from a JSON script, record it, caption it.")
    ap.add_argument("--script", required=True, help="path to the video script JSON")
    ap.add_argument("--out", help="output MP4 (required unless --dry-run)")
    ap.add_argument("--dry-run", action="store_true", help="print the planned timeline; no mouse, no recording")
    ap.add_argument("--verify", action="store_true", help="resolve every target first (with --dry-run: only that)")
    ap.add_argument("--no-record", action="store_true", help="drive the UI + captions but skip ffmpeg")
    ap.add_argument("--captions", choices=["live", "burn", "none"], default="live",
                    help="live = overlay window during recording (default); burn = post-process from the SRT; none")
    ap.add_argument("--fps", type=int, default=None, help="capture frame rate (default: script record.fps or 30)")
    ap.add_argument("--ffmpeg", default=None, help="path to ffmpeg.exe (else PATH / winget / C:\\ffmpeg\\bin)")
    ap.add_argument("--cdp-port", type=int, default=None, help="DevTools port for selector targets (default app.cdp_port)")
    ap.add_argument("--window", default=None, help="override app.window_title")
    ap.add_argument("--countdown", type=int, default=3, help="seconds before recording starts")
    ap.add_argument("--start-latency", type=float, default=0.5, help="ffmpeg start-up allowance used for t=0")
    ap.add_argument("--keep-raw", action="store_true", help="keep the un-captioned raw MP4 when burning")
    opts = ap.parse_args(argv)
    if not opts.dry_run and not opts.out:
        ap.error("--out is required unless --dry-run")
    if opts.out:
        opts.out = os.path.abspath(opts.out)
    try:
        script = load_script(opts.script)
    except (ScriptError, OSError) as e:
        print(f"script error: {e}", file=sys.stderr)
        return 3
    return Runner(script, opts).run()


if __name__ == "__main__":
    sys.exit(main())
