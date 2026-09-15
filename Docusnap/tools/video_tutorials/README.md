# ScanFinder tutorial-video runner

Records short (30–120 s) YouTube-style how-to videos of ScanFinder from a JSON script: it drives the
mouse and keyboard, shows captions, records the window with FFmpeg, and writes a timeline so a
voice-over (TTS) can be added afterwards.

```
tools/video_tutorials/
├── scanfinder_video_runner.py      the tool (single file, sectioned — see its docstring)
├── schema/video_script.schema.json the script format
├── scripts/                        video scripts (JSON) — two examples included
├── requirements.txt
└── out/                            your MP4s + timelines (git-ignored)
```

Ask Claude for a new script with `/makescript <what the video should show>` — it writes
`scripts/<slug>.json` plus a Markdown storyboard for you to read.

---

## 1. Setup (once)

### Python
```powershell
cd "C:\GIT Projects\Docusnap\tools\video_tutorials"
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```
(Python 3.12 is already installed on this machine as `py -3.12`. tkinter ships with it.)

### FFmpeg
Not on PATH today. Easiest:
```powershell
winget install --id Gyan.FFmpeg -e
```
Open a **new** terminal afterwards and check `ffmpeg -version`. The gyan.dev "full" build includes libx264
(recording) and libass (`--captions burn`). The runner also looks in winget's package folder and
`C:\ffmpeg\bin\ffmpeg.exe` automatically; otherwise pass `--ffmpeg "C:\path\to\ffmpeg.exe"`.

Manual alternative: download `ffmpeg-release-full.7z` from https://www.gyan.dev/ffmpeg/builds/, extract to
`C:\ffmpeg`, add `C:\ffmpeg\bin` to PATH.

---

## 2. Start ScanFinder for recording

Two ways to say *where to click* — pick the app launch that matches:

| Target style | Works with | Launch |
|---|---|---|
| `{"selector": "#btn-search"}` (CSS selector — robust, resolution-independent, what `/makescript` generates) | **DEV app only** | `npm start -- --remote-debugging-port=9222` |
| `{"rel": [0.5, 0.3]}` / `{"abs": [x, y]}` / `{"image": "btn.png"}` | dev **or installed** app | normal launch |

The installed `ScanFinder.exe` deliberately **refuses** `--remote-debugging-port` (security lockout in
`src/main.js`), so selector scripts must run against the dev build. The UI is identical.

Recommended dev launch — a sandboxed copy so demo data never touches your real database:
```powershell
cd "C:\GIT Projects\Docusnap"
$env:DOCUSNAP_USERDATA = "C:\ScanFinderDemo"     # isolated DB/inbox/settings for the videos
npm start -- --remote-debugging-port=9222
```
First run of a fresh sandbox goes through create-admin + the setup wizard; do that by hand once, then
record. Close any other ScanFinder instance first (single-instance lock). Set the theme/window size you
want the video to show. Keep ScanFinder on the **primary monitor**.

---

## 3. Run

```powershell
# 1. read the plan (no mouse, no recording)
python scanfinder_video_runner.py --script scripts\example_search.json --dry-run

# 2. check every target resolves against the running app (no clicks)
python scanfinder_video_runner.py --script scripts\example_search.json --dry-run --verify

# 3. rehearse without recording
python scanfinder_video_runner.py --script scripts\example_search.json --out out\search.mp4 --no-record

# 4. record
python scanfinder_video_runner.py --script scripts\example_search.json --out out\search.mp4
```
A 3-second countdown runs first — take your hands off the mouse **and keyboard** for the whole run
(typing focuses your terminal, which then covers the app; keystrokes land in whichever window has focus).
The runner re-fronts the target window before every click as a safety net, but a stray keypress during a
`type_text` step still corrupts the text. **Abort:** slam the mouse into the top-left corner of the screen
(pyautogui fail-safe) or Ctrl+C in the terminal.

**Zero-setup path:** `python record.py scripts\<name>.json --publish "%USERPROFILE%\Desktop\Tutorials"`
prepares a sandboxed demo copy of the app at the neutral `C:\ScanFinderDemo` (own data folder, `Scans\First`
one demo invoice, `Scans\Batch` eight invoices from two suppliers, `Filed Documents` as the pre-seeded output
folder, demo admin `admin` / `Scan-Finder-2026`), launches it with DevTools, signs in, imports `Scans\First`
once, closes any leftover child window, then records and publishes (mp4 + captions.srt + narration.json +
`tts_manifest.json` in learning order). `--as-is` records the app exactly as it is (the first-run video),
`--reset` wipes the demo profile, `--down` stops the demo app, `--prepare` just readies the app.

**The five tutorials, in order** (each script is the storyboard):
`first-run-a-account-licence.json` + `first-run-b-setup-wizard.json` (joined by `--licence-intro`) ·
`teach-a-document.json` · `import-a-folder.json` · `review-and-confirm.json` · `search-for-a-document.json`.
They depend on each other's app state (teach needs the imported example; import feeds review; review/search
need the batch), so re-record in that order after a `--reset`.
The complete first run including the licence screen (account → licence → terms → wizard):
`python record.py scripts\first-run-b-setup-wizard.json --as-is --licence-intro scripts\first-run-a-account-licence.json`
— segment A runs on a licence-less profile so the licence screen appears after the account is created
(explain + hover only; a real "Start trial" would contact the licensing server); the licence rows are then
restored, the app restarts and signs in silently, segment B films from the Terms window, and the two clips
and their timelines are joined into one MP4/SRT/narration set.

Options: `--captions live|burn|none` (live = overlay window, default; burn = post-process from the SRT;
none) · `--fps 30` · `--ffmpeg PATH` · `--cdp-port 9222` · `--window "ScanFinder"` · `--countdown 3`
· `--start-latency 0.5` (ffmpeg start-up allowance used for t=0) · `--keep-raw`.

Before the import example: edit `scripts/example_import_and_review.json` → `type_folder_path.text` to a
real folder holding 3–5 small PDFs, and give the `processing` step enough seconds for them.

### Outputs
| File | What |
|---|---|
| `out\search.mp4` | the video (H.264, cursor drawn, captions overlaid) |
| `out\search.timeline.json` | planned + **actual** start/end of every step (t = 0 is the recording start) |
| `out\search.captions.srt` | the captions as subtitles — re-burn, edit, or upload to YouTube |
| `out\search.narration.json` | narration lines with start/end — the input for the TTS pass |

Later, with a voice track: `ffmpeg -i out\search.mp4 -i voice.wav -c:v copy -c:a aac -shortest out\search_final.mp4`.
Generate one clip per narration line and place each at its `start` (or one continuous track from the
timings) — the `narration.json` carries everything needed.

---

## 4. Script format (quick reference)

Full schema: `schema/video_script.schema.json`. Minimal shape:
```json
{
  "version": 1,
  "title": "Search your documents",
  "app": { "window_title": "ScanFinder", "cdp_port": 9222, "maximize": true },
  "record": { "mode": "window", "fps": 30 },
  "steps": [
    { "id": "open_search", "action": "move_and_click",
      "target": { "selector": "#btn-search", "window": "ScanFinder" },
      "narration": "Click Search in the side bar.", "caption": "1. Click Search", "duration_sec": 3.5 }
  ]
}
```
**Timing:** steps run back-to-back; `duration_sec` is the whole step (action + hold). The runner warns
when an action overruns and records the real times in the timeline. `lead_in_sec` / `lead_out_sec` add
still frames at both ends. Narration ≈ 2.5 words per second — size each step to its line.

**Actions**
| action | parameters |
|---|---|
| `move_and_click` / `click` | `target`, `button`, `clicks`, `move_duration` (0.6), `hover_sec` (0.25) |
| `double_click`, `right_click` | same as above |
| `move_to` | `target` — hover only, to point at something |
| `drag` | `from`, `to` (targets; use `at` fractions on a page canvas), `button` (`left` draws a teach box, `right` pans), `drag_duration` |
| `type_text` | `text`, optional `target` (clicked first), `clear`, `enter`, `interval` |
| `press_keys` | `keys`: `"enter"` or `["ctrl","f"]`, `presses` |
| `scroll` | `amount` (negative = down), optional `target` |
| `wait` | nothing — hold the caption for `duration_sec` |
| `focus_window` | `window`, `maximize` |
| `eval_js` | `window`, `js` — run JavaScript in an app page over DevTools (dev app only). A demo/privacy hook: e.g. set the import folder without opening the native picker (which would show the presenter's own folder tree) |
| `launch_app` | `exe`, `args`, `cwd`, `wait_for_window` (usually not needed — app already open) |

**Native dialogs are never filmed.** The Windows folder/file pickers show the presenter's OneDrive name and
pinned folders. The scripts avoid them: the setup wizard's output folder is pre-seeded (`record.py`), the
import folder is set with `eval_js` (mirrors what the picker would do), and Teach picks from the queue.

**Selector targets can take `"at": [fx, fy]`** — a point inside the element as fractions — which is how a
teach box is drawn on `#pageCanvas` (fractions of the page: measure them on a rendered page image).

Any step may carry `wait_for: {"window": "...", "selector": "...", "timeout": 10}` — a pre-condition
polled before the action (a child window opening, a native dialog appearing, a button becoming visible).
Waiting time is not charged to `duration_sec`. `"optional": true` lets a failing step be skipped.

**Targets** — exactly one of:
- `"selector": "#btn-run"` + `"window"` — resolved live via DevTools; the point is the element's centre.
- `"rel": [0.5, 0.3]` + `"window"` — fraction of that window's client area. Read the numbers off a
  screenshot: x ÷ window width, y ÷ window height.
- `"abs": [1200, 640]` — screen pixels (fragile: breaks on any resize).
- `"image": "assets/run_button.png"` (+ `"confidence": 0.9` with opencv) — crop a PNG of the control.
- `"offset": [dx, dy]` — pixel nudge applied to any of the above.

**Small windows (sign-in, wizard):** use `"record": {"mode": "screen", "backdrop": "#1f2430"}` — the
runner captures the work area (no taskbar) and puts a plain-colour window behind the app so your desktop,
terminal and other apps never appear in the video.

**Window titles** (exact; any dash style is accepted):
`ScanFinder` (main) · `ScanFinder — Review` · `ScanFinder — Search` · `Scan Finder — Settings` ·
`Teach a new document — Scan Finder` · `Export data — Scan Finder` · `Scan Finder — User Guide` ·
native folder dialog: `Select the folder of scanned documents to import`. Child windows open
maximised over the main window, so `record.mode: "window"` on the main window captures them too.

**Adding an action type:** add its name to `ACTIONS`, a method of the same name on `Actions`, and (if
it needs new parameters) validation in `load_script`. Everything else — timing, captions, timeline —
is untouched.

---

## 5. Troubleshooting

- **`ffmpeg not found`** — see Setup; or `--ffmpeg "C:\ffmpeg\bin\ffmpeg.exe"`.
- **`DevTools port 9222 not reachable`** — the app was not started with `--remote-debugging-port=9222`,
  or it is the installed build (which refuses it). Use the dev launch above, or switch the script's
  targets to `rel`/`image`.
- **`no element matches` / `exists but is not visible yet`** — run `--dry-run --verify` with the app
  in the state that step expects. Ids come from `src/windows/*/index.html` (and
  `src/windows/shared/search-ui/searchMarkup.js` for Search). Add a `wait_for` if the element appears
  after an animation or a window open. The Search window's `#btn-search` is a different button from the
  main window's `#btn-search` — always give `"window"`.
- **Clicks land slightly off** — Windows display scaling. The runner is per-monitor DPI aware and converts
  DevTools CSS pixels with `devicePixelRatio`, so 125 %/150 % scaling is fine for selectors. For `rel`
  targets re-measure after changing scaling. Electron zoom (Ctrl +/−) inside ScanFinder is also handled.
- **Recording is black, offset, or shows the wrong monitor** — keep ScanFinder on the primary monitor
  and un-minimised. Multi-monitor layouts with a screen left of/above the primary are supported
  (virtual-screen origin is subtracted) but untested on every driver; if in doubt use
  `"record": {"mode": "screen"}` and crop later.
- **Captions not in the video** — they are a separate click-through window; gdigrab captures the
  composited desktop so they appear. If some capture path drops them, use `--captions burn`.
- **The overlay blocks a click** — it is `WS_EX_TRANSPARENT`; if a click still fails, move the caption
  with `"captions": {"position": "top"}`.
- **`window 'ScanFinder' not found`** — title mismatch. `--dry-run` never touches windows, so use
  `--verify`; the error lists the visible window titles.
- **The app does not come to the front** — Windows blocks focus stealing; the runner taps ALT first.
  Click the ScanFinder window once yourself before starting if it still stays behind.
- **A native dialog step misfires** — the folder picker: type the full path, Enter navigates into it,
  a second Enter presses *Select Folder*. If your Windows language labels the button differently,
  replace the second Enter with `{"keys": ["alt", "s"]}` or a `rel` click.
- **Step overran** (`ran N s over its duration_sec`) — processing took longer than scripted; raise that
  step's `duration_sec` or precede the next step with `wait_for`. The timeline still records the truth.
- **Fail-safe fired** (`FailSafeException`) — the mouse hit the top-left corner; that is the abort switch.
