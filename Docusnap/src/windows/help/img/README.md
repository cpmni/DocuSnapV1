# User Guide screenshots

Drop real PNG screenshots into this folder using the **exact filenames** below.
Until a file exists, the guide shows a tidy "Screenshot coming soon" placeholder in
its place (handled by `help-nav.js`), so missing images never break the layout.

Captured at a normal window size, light **or** dark theme is fine (the guide chrome
themes itself; the screenshot can be either). Aim for clear, legible UI — annotate
with simple callout arrows/numbers where noted.

| Filename | Page | Status / Show / annotate |
|---|---|---|
| `console-annotated.png` | Getting Started | Now covered by an annotated **SVG figure** (the home screen, 9 numbered callouts). Drop this PNG in only if you want a real screenshot instead — a note on the page points to it. |
| `review-window-annotated.png` | Review Window | Screenshot slot (placeholder). The three panes — queue (left), preview (centre), fields (right), with one flagged/low-confidence field visible. |
| `review-field-row.png` | Review Window | Now covered by an annotated **SVG figure** (a field row, 5 numbered callouts). Optional real screenshot. |
| `teach-draw-box.png` | Templates & Learning | Screenshot slot (placeholder). The Teach wizard mid-step: a box drawn around a field's value with the live read-back shown. |
| `search-results.png` | Search & Filing | Screenshot slot (placeholder). The Search window: filters on top, results list, preview pane on the right. |

## In-page SVG figures (no screenshot needed — never go stale)
These are authored as themeable inline SVG with numbered directive callouts, in the house
`dg-*` classes (see `help.css`): **the home screen / launchpad** (Getting Started), **a field
row** (Review), **the Output Structure builder** (Search & Filing), **which teaching tool?**
(Templates & Learning), and **a document type at a glance** (Document Types & Fields).

## Adding more later
- Use `<figure class="shot-fig"><img class="shot" src="img/your-name.png" alt="…"><figcaption>…</figcaption></figure>` in any page.
- Keep names lower-case and hyphenated, matching the area they show.
- Prefer real screenshots for *layout/orientation*; the in-page SVG diagrams already cover *concepts* (the workflow, the confidence line, the filing tree, and the figures listed above) and never go stale.
