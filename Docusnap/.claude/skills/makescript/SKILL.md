---
name: makescript
description: Generate a ScanFinder tutorial-video script — a Markdown storyboard for the owner to read AND a JSON script for tools/video_tutorials/scanfinder_video_runner.py — from a one-line request such as "/makescript 60-second video on searching documents".
---

# /makescript — tutorial-video script generator

`$ARGUMENTS` = what the video should show (feature, length, audience hints).

Produce TWO things every time, in this order, and WRITE the JSON to disk:
1. **Markdown storyboard** — in the reply. Title, one-line goal, then a table: `# | on screen (action) | caption | narration | secs`. End with the total and any assumptions (demo data needed, app state).
2. **JSON script** — saved to `tools/video_tutorials/scripts/<slug>.json` (slug = lowercase-hyphenated title) and ALSO printed in a ```json block. Must validate against `tools/video_tutorials/schema/video_script.schema.json` (read it if unsure). Tell the owner the run command:
   `python scanfinder_video_runner.py --script scripts\<slug>.json --dry-run --verify` then `--out out\<slug>.mp4`.

## Hard rules
- **Never invent a selector.** Every `#id` / `.class` MUST be verified by grep in the window's markup before it is emitted: main window `src/windows/main/index.html`, Review `src/windows/review/index.html`, Search `src/windows/shared/search-ui/searchMarkup.js` (+ `searchResults.js` for result rows), Settings `src/windows/settings/index.html`, Teach `src/windows/teach/index.html`. If no stable id exists, use a `rel` target and say so in the assumptions.
- Assume ScanFinder is already open, signed in, on the Home screen, maximised (the dev app with `--remote-debugging-port=9222`). Do not `launch_app` unless asked.
- Target length 30–120 s. Narration is spoken style, one idea per step, ≈ 2.5 words/second — size `duration_sec` to the line (min 3 s for a click step, 2.5 s for a pure wait). Captions ≤ 8 words, numbered for sequential actions ("1. Click Search"). Narration and caption are DIFFERENT strings: caption = the label, narration = the explanation.
- Every step has `id` (`^[a-z0-9_]+$`, unique), `action`, `duration_sec`, `narration`, `caption`. Always name the `window` in a target. Use `wait_for` whenever a step needs a child window/dialog/button that the previous step causes to appear (window open ≈ 1–2 s; processing = long, give it a `wait_for` selector with a big timeout).
- Prefer `move_and_click` + `type_text` + `wait`. No drags. Favour robustness over cleverness.
- Real product, real names: ScanFinder has no "projects" or "scans you run" — map such requests onto the actual flows below and say which mapping you used.

## ScanFinder UI map (verified 2026-09-15 — re-grep if the markup changed)
Window titles (exact): `ScanFinder` (main) · `ScanFinder — Review` · `ScanFinder — Search` · `Scan Finder — Settings` · `Teach a new document — Scan Finder` · `Export data — Scan Finder` · `Scan Finder — User Guide`. Child windows open maximised, modal to the main window.

Main window rail (`src/windows/main/index.html`): `#btn-home` · `#btn-import` (Import view) · `#btn-review` (opens Review) · `#btn-search` (opens Search) · `#btn-teach` (Teach wizard) · `#btn-export` · `#btn-settings` · `#btn-help` · `#nav-quickfile` (hidden unless Quick File is on).
Import view: `#folder-box` (opens the native folder picker, title `Select the folder of scanned documents to import`) · `#btn-run` (Process Documents; disabled until a folder is set) · `#btn-stop` · `#btn-review-docs` ("✓ Review your documents", appears after a batch) · `#btn-toggle-log` · `#btn-print-slips` · `#btn-clear-stats`.
Native folder picker recipe: `type_text` with `wait_for.window` = the dialog title, `text` = the full path, then `press_keys` `"enter"` × 2 (navigate, then Select Folder).

Search window (`searchMarkup.js`, window `ScanFinder — Search`): `#inp-fulltext` (search anything) · `#inp-date-from` / `#inp-date-to` · `#inp-total-op` + `#inp-total` · `#inp-type` · `#chk-uncommitted` · `#btn-search` (RUN — same id as the main rail button, so the `window` field matters) · results rows `.result-row` (first = `querySelector` default) · `#btn-doc-prev` / `#btn-doc-next` · page nav `#btn-page-prev` / `#btn-page-next` · zoom `#btn-zoom-in` / `#btn-zoom-out` / `#btn-zoom-reset` · in-document find `#inp-find-doc` + `#btn-match-prev` / `#btn-match-next` · close `#btn-close`.

Review window (`review/index.html`, window `ScanFinder — Review`): `#btn-confirm` (file this document) · `#btn-defer` · `#btn-skip` · `#btn-reprocess` · `#btn-delete` · `#btn-file-all-review` (File all ready) · `#btn-preview-ocr`. Queue = left column, page = right, fields = sidebar.

Canonical flows (each is a finished 40–70 s video):
- **Import + file** — `#btn-import` → `#folder-box` → dialog recipe → `#btn-run` → wait (processing) → `#btn-review-docs` (wait_for it) → Review `#btn-confirm`. Example: `scripts/example_import_and_review.json`.
- **Search** — `#btn-search` (main) → wait_for Search window → `#inp-fulltext` type → `#btn-search` (Search window) → `.result-row` → hold on preview. Example: `scripts/example_search.json`.
- **Review / correct a field** — `#btn-review` → click a queue row (`rel` or grep the row class) → click a field input (grep `review/index.html` for the field-panel ids before emitting) → `type_text` with `clear: true` → `#btn-confirm`.
- **Teach a new document** — `#btn-teach` → the wizard window; steps involve drawing a box (a drag) — NOT supported by the runner; script only up to the wizard opening, or use `wait` steps with captions over the owner doing the draw by hand (`"optional": true` on nothing; just narrate).
- **Settings tour** — `#btn-settings` → Settings window; tab buttons carry `data-tab` (grep for the slug), so `[data-tab="filesfiling"]`-style selectors are fine once verified.

## Output template (Markdown)
```
## <Title>  (~NN s)
Goal: <one line>.
Assumes: <app state / demo data>.

| # | On screen | Caption | Narration | s |
|---|-----------|---------|-----------|---|
| 1 | Home screen, maximised | Import scans into ScanFinder | Here's how to… | 4 |
...
Total: NN s.  Saved: tools/video_tutorials/scripts/<slug>.json
```
Then the ```json block, then the two run commands.
