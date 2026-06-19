# User Guide screenshots

Drop real PNG screenshots into this folder using the **exact filenames** below.
Until a file exists, the guide shows a tidy "Screenshot coming soon" placeholder in
its place (handled by `help-nav.js`), so missing images never break the layout.

Captured at a normal window size, light **or** dark theme is fine (the guide chrome
themes itself; the screenshot can be either). Aim for clear, legible UI — annotate
with simple callout arrows/numbers where noted.

| Filename | Page | Show / annotate |
|---|---|---|
| `console-annotated.png` | Getting Started | The main window with its key areas labelled: Begin Import, Source Folder, Process Documents, Review Queue badge, Search, Settings, Teach, FAST/SMART badge, Help/?. |
| `review-window-annotated.png` | Review Window | The three panes — queue (left), document preview (centre), extracted fields (right), with one flagged/low-confidence field visible. |
| `review-field-row.png` | Review Window | Close-up of a single field row: the value, its confidence badge, and the pick-from-document button. |
| `teach-draw-box.png` | Templates & Learning | The Teach wizard mid-step: a box drawn around a field's value with the live read-back shown. |
| `search-results.png` | Search & Filing | The Search window: filters on top, results list, and the preview pane on the right. |

## Adding more later
- Use `<figure class="shot-fig"><img class="shot" src="img/your-name.png" alt="…"><figcaption>…</figcaption></figure>` in any page.
- Keep names lower-case and hyphenated, matching the area they show.
- Prefer real screenshots for *layout/orientation*; the in-page SVG diagrams already cover *concepts* (the workflow, the confidence line, the filing tree) and never go stale.
