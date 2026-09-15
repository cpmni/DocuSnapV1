# HANDOVER 2026-09-16 — the tutorial-video night run (cold start for the next session)

Branch `feat/teach-side-overnight`. Everything from this session is in `tools/video_tutorials/` + the `/makescript`
skill (committed at the end of the run — see `git log -3`). No app code touched. Pins untouched (377/377 at the
last run). The handover queue from 2026-09-15 EVENING (push `8ec76de`, VM live-test of both installers, Departments
D2b/D3/D4) is STILL parked — nothing there moved tonight.

## What the owner asked (verbatim intent)
"Use the night run to make useful instructional videos for YouTube. Output to `Desktop\Tutorials` with a file to
generate timestamped TTS. Nothing of my laptop layout/folders in the videos. Teach first, then import, then review.
Detailed explanations of what and why — not just the buttons — casual, not cheesy, fully useful to the customer."
Tomorrow: the owner takes the timestamped narration to an AI voice, overlays it, uploads.

## DELIVERABLE — `C:\Users\cmccu\Desktop\Tutorials\`
| # | file | length | content |
|---|------|--------|---------|
| 1 | `first-run-setup.mp4` | 3:58 | create admin → recovery code → **licence screen** (trial / activation key, hover-only) → Terms → every wizard choice with its reason → tour → Home |
| 2 | `teach-a-document.mp4` | 2:39 | Teach: pick the queued example → type → pan → draw issuer / date / number → read-backs → Review → save → Done |
| 3 | `import-a-folder.mp4` | 1:33 | Import: folder box (narrated; folder set without the picker) → Process → what happens → 8 docs → Review your documents |
| 4 | `review-and-confirm.mp4` | 1:38 | Review: grouped queue → open Ironbridge doc → fields explained → Confirm (really filed; next doc auto-loads) → File All Ready |
| 5 | `search-for-a-document.mp4` | 1:08 | Search "Ironbridge" → result → zoom → find "total" (highlighted 2/2) → filters |
Each has `<name>.narration.json` (`lines[] = {id, start, end, text}` seconds from the MP4 start) and
`<name>.captions.srt`; `tts_manifest.json` = all five in learning order; `README.md` = how to add the voice-over
(one clip per line at its `start`, then `ffmpeg -i v.mp4 -i voice.wav -c:v copy -c:a aac -shortest`).

**Frame-checked** (every video): dark backdrop where windows are small, no taskbar, no terminal, no
`C:\Users\…` path (demo lives at `C:\ScanFinderDemo`), the teach read-backs correct (Copperfield Electrical ·
23/11/2026 · INV-29597), the review Confirm actually filed (queue 8→7, "4 more offered in File All Ready").

## Optional re-takes (owner's call)
- **Search** was recorded BEFORE Review, so its results carry "Needs Review" badges; narration still fits ("Include
  unconfirmed" is on). For a "filed" look: confirm the remaining queue, then
  `record.py scripts\search-for-a-document.json --publish "%USERPROFILE%\Desktop\Tutorials"`.
- The first-run video's segment A (account + licence) was filmed once and reused (`--reuse-part-a`); it is fine.
- Not made (ideas): Settings tour, Quick File, Export, the search client. `/makescript <ask>` + the updated skill
  (verified selectors for teach/review/import) generates them; record with `record.py … --publish …`.

## How it works now (for re-recording) — `tools/video_tutorials/README.md` is the manual
- `record.py` = one command: neutral demo profile `C:\ScanFinderDemo` (`userData`, `Scans\First` 1 Copperfield
  invoice, `Scans\Batch` 3 Copperfield + 5 Ironbridge, `Filed Documents` pre-seeded as output_folder so no Browse
  dialog), dev app on DevTools 9222, silent sign-in/bootstrap, closes leftover child windows, imports `Scans\First`
  once, records, `--publish DIR` copies mp4/srt/narration + updates the manifest.
- **Licence screen**: the dev app re-fetches this PC's seat from the real backend on every start, so
  `--licence-intro` runs a local fake licence server (answers `{"state":"none"}`) and temporarily points
  `config/license.json` at it (backup `config/license.json.videobak`, restored in `finally` + on next start;
  gitignored). Nothing is ever activated. `git status config` was clean after every run.
- Runner additions tonight: `drag` (left = teach box, right = pan), `eval_js` (DevTools hook — used to set the
  import folder without the native picker, and to scroll the teach page to the top), selector `at` fractions,
  backdrop window (`record.backdrop`), z-order re-seating of the backdrop under the app on every step, foreground
  re-front via `AttachThreadInput` (no ALT tap), app-class-restricted window matching, `scrollIntoView('nearest')`.
- Order matters (state): reset → first-run → (auto import First) → teach → import → review → search.

## Things the owner should know
- **Your terminal prompt line may contain the text "Demo Admin"** — an early silent run typed into the terminal
  when it had focus (before the focus fix). It was never sent. Just clear the line.
- `C:\ScanFinderDemo\` (≈ 10 MB) is the demo profile; `record.py --reset` deletes it. The demo dev app was
  stopped at the end of the run (`record.py --down`).
- The videos show the DEV build's UI (identical to the installed app). The demo admin is `admin` /
  `Scan-Finder-2026` (throwaway).
- The recovery code shown in video 1 belongs to the throwaway demo DB.

## Commands
```powershell
cd "C:\GIT Projects\Docusnap\tools\video_tutorials"; .\.venv\Scripts\Activate.ps1
python record.py scripts\<name>.json --publish "$env:USERPROFILE\Desktop\Tutorials"      # one video
python record.py scripts\first-run-b-setup-wizard.json --as-is --licence-intro scripts\first-run-a-account-licence.json --out out\first-run-setup.mp4 --publish "$env:USERPROFILE\Desktop\Tutorials"
python record.py --reset | --down | --prepare
python scanfinder_video_runner.py --script scripts\<name>.json --dry-run --verify          # check a script
```
