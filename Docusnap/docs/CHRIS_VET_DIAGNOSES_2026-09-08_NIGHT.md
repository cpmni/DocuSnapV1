# Chris The Customer — Vet Diagnoses (2026-09-08 NIGHT)

READ-ONLY night-run diagnosis. **Nothing was implemented.** Each item below is root-caused with FACT
(verified in code, cited `file:line`) vs ASSUMPTION, plus the smallest correct fix DESIGN + a pin test.
Owner approval required before any code lands. Line numbers are as of branch `feat/teach-side-overnight`.

Three items from Chris's product vet:
- **A** — Edit-role mailbox card shows "Type — / Unknown / Document —" for a filed invoice.
- **B** — Import list still says "Confirm to file →" after a MANUAL confirm (open since 2026-09-03).
- **C** — Bundle issuer read from a later page while page 1 is shown (design only).

---

## ITEM A — Mailbox card shows "Type — / Unknown / Document —"

### Symptom
An approver opens a mailbox/approval card for a FILED invoice; the preview shows **Type = "—"**, the
status chip = **"Unknown"**, and the stamp/subtitle header = **"Document —"**. Reported under the EDIT
(non-admin) role.

### FACT
1. The mailbox row click hands `selectDoc` a **bare `{ id }`** — it drops the fields the route row
   already carries:
   - `src/windows/search/search-mailbox.js:137` — `window.SearchPreview.selectDoc({ id: r.document_id });`
   - `src/windows/search/search-workflow.js:344` — `window.SearchPreview.selectDoc({ id: route.document_id });`
2. The route row itself DOES carry the type + supplier (so the data exists upstream):
   `database/modules/workflow.js:12-17` — `LIST_SELECT` `LEFT JOIN document_types dt` projects
   `d.supplier_name, d.reference_number, d.doc_date, d.status AS doc_status, dt.name AS type_name,
   dt.slug AS type_slug`. The service list views return these rows verbatim
   (`src/services/workflowService.js:176-179`), and the handler passes them to the renderer unchanged
   except swapping `stamped_path`→`has_stamped` (`src/modules/workflow/handler.js:69-79`).
3. `selectDoc` fetches the detail DTO and **merges** it over the passed doc, but only for the fields
   panel — the other two sub-renders get the **BARE** doc:
   - `src/windows/search/search-preview.js:180` — `renderPreviewFields({ ...doc, ...(full || {}) });` (merged)
   - `src/windows/search/search-preview.js:181` — `window.SearchActions.renderActions(doc);` (BARE)
   - `src/windows/search/search-preview.js:199` — `window.SearchStamp.onDocShown(doc);` (BARE)
4. The detail DTO **`full` never contains `type_name`**, so the merge can't recover it either:
   - `src/services/previewService.js:37-58` — `getDocumentDetail` uses `documents.getWithExtractions`
     (`getById` = `SELECT *`, no join) and resolves only `type_slug` from `document_type_id`
     (`:47-51`, `SELECT slug FROM document_types WHERE id = ?`). It **never resolves `type_name`.** The
     in-code comment at `search-preview.js:177-179` already documents this gap as a known workaround.
   - The DTO *allowlist DOES declare `type_name`* (`src/services/dto.js:23-24` `SEARCH_ROW_FIELDS`
     includes `'type_name'`, `'type_slug'`, `'supplier_name'`, `'status'`), but `pick()` only copies a
     key **if it is present on the row** (`src/services/dto.js:66-70`: `if (f in row) out[f] = row[f]`).
     Since `previewService` never set `type_name`, `pick` omits it — the DTO is not the blocker, the
     unpopulated source is.
5. Symptom decomposition (each string traced to its render site, all fed the **bare** doc):
   - **"Type —"** — `renderPreviewFields` merged doc still lacks `type_name` (neither `{id}` nor `full`
     has it) → `_field(fields, 'Type', doc.type_name)` renders `—`
     (`src/windows/search/search-preview.js:28` + the empty-value `|| '—'` at `:57`).
   - **"Unknown"** — `renderActions(doc)` gets the bare `{id}`; `doc.status` is undefined →
     `_statusChip(undefined)` → `LABELS[status] || (status ? … : 'Unknown')`
     (`src/windows/search/search-actions.js:161-167`).
   - **"Document —"** — `onDocShown(doc)`/`open(doc)` gets the bare `{id}`; subtitle
     `` `${doc.supplier_name || 'Document'} — ${doc.reference_number || doc.type_name || ''}` `` →
     "Document —" (`src/windows/search/search-stamp.js:116`).
6. The role is **incidental**, not causal. `get-document-detail` applies the same gate for every
   logged-in role — `requireLogin()` + `_assertDocAccess()` + `projectDocumentDetail` — with no
   role-differentiated field set (`src/modules/review/handler.js:912-923`). The search-results path
   works only because its rows already carry `type_name`/`supplier_name`/`status`
   (`src/windows/search/search-results.js:79`), so `selectDoc(doc)` there has a full doc for all three
   sub-renders.

### ASSUMPTION
- Chris happened to be logged in as EDIT when he hit it; the bug reproduces for **admin** approvers
  opening from the mailbox too (same `selectDoc({ id })` path). Cheap to confirm by opening the same
  card as admin — expected identical "Type —/Unknown/Document —".
- The `/v1` detached client renders its document-detail from the same `projectDocumentDetail` DTO, so
  its detail "Type" is likely blank too; fixing `previewService` fixes the client as a side benefit.
  (Not separately verified in the client renderer this pass.)

### Root cause (file:line)
Two independent gaps combine, both on the mailbox/workflow entry (the search-results entry is unaffected):
- **`src/services/previewService.js:47-51`** — the detail DTO resolves `type_slug` but **never
  `type_name`**, so `full.type_name` is always absent → "Type —" even after the merge.
- **`src/windows/search/search-preview.js:181,199`** — `selectDoc` passes the **bare** unmerged `doc`
  to `renderActions` and `onDocShown`, so with a partial `{id}` caller (mailbox/workflow) the status
  chip → "Unknown" and the subtitle → "Document —".

### Proposed fix + pin
**Fix (smallest correct, fixes all three strings + hardens the class):**
1. `src/services/previewService.js:47-51` — extend the existing type lookup to also resolve the name:
   change `SELECT slug` → `SELECT slug, name`, and set `doc.type_name = doc.type_name || (t ? t.name : null)`
   alongside the existing `doc.type_slug` assignment. `projectDocumentDetail` already allowlists
   `type_name`, so it then rides the DTO to every detail consumer (mailbox, workflow, `/v1` client,
   Review). This is a one-line extension of a lookup the function already performs.
2. `src/windows/search/search-preview.js:180-199` — build the merged doc once and use it for **all**
   sub-renders: `const merged = { ...doc, ...(full || {}) }; s.selectedDoc = merged;` then call
   `renderPreviewFields(merged)`, `renderActions(merged)`, and `onDocShown(merged)`. This fixes
   "Unknown"/"Document —" for any partial-doc caller, present or future. Keep the stale-selection guard
   (`mine`) intact.

*(Alternative, renderer-only, if the owner wants zero main-process change: enrich the two call sites —
`search-mailbox.js:137` and `search-workflow.js:344` — to pass `{ id, type_name, type_slug,
supplier_name, reference_number, doc_date, status: r.doc_status }` from the route row. Note the
`status: r.doc_status` alias trap — the route projects the doc's status as `doc_status`. This is the
smaller diff but re-introduces the "every caller must remember the fields" fragility the `:177-179`
comment already laments, and does not fix the `/v1` client detail. The `previewService` fix is
preferred.)*

**Pin:**
- Unit — extend `src/services/test_previewservice.js`: given a document row whose base fetch lacks
  `type_name` but has a valid `document_type_id`, assert `getDocumentDetail(...).type_name` equals the
  type's name (and survives `dto.projectDocumentDetail`). Pins the missing-name gap so a future
  `SELECT *` refactor can't silently drop it again.
- Source pin — extend `src/windows/search/test_preview_error_state.js` (already asserts the mailbox
  routes through `selectDoc({ id })`): assert `selectDoc` passes the **merged** object (not the bare
  `doc`) to both `renderActions` and `onDocShown` — e.g. neither call site is `renderActions(doc)` /
  `onDocShown(doc)` on a bare arg.

### Seam + owner-gated?
Pure **display / DTO-projection** path — no extraction, anchoring, OCR, validation, learning, or
auto-file logic touched. **NOT owner-gated.** Blast radius: the `previewService` change adds a field
the DTO contract already declares, and flows to the `/v1` client detail + Review detail as a benign
enrichment (they read the same projection). The `selectDoc` merge change makes the mailbox/workflow
preview match what search-results already renders. Low risk.

---

## ITEM B — Import row stuck on "Confirm to file →" after a MANUAL confirm

### Symptom
After a batch import, an import RESULT ROW in the main window shows "Confirm to file →" (needs-review)
or "Ready to file" (clean). The user opens Review and **manually confirms** the doc — but the import
row never flips to "Filed." Open + unvetted since 2026-09-03.

### FACT
1. The import row's status chip is set once, at row build, from the `file_done` signal — one of
   Error / "Confirm to file →" / "Ready to file" (`src/windows/main/renderer.js:1204-1229`, in
   `addTableRow`). The row stores its doc id for later flipping:
   `src/windows/main/renderer.js:1184` — `if (msg.db_id != null) tr.dataset.docId = String(msg.db_id);`.
2. The **only** function that flips a row to a filed state is `markRowFiled(docId)`
   (`src/windows/main/renderer.js:1006-1017`), and its **only caller** is the AUTO-FILE broadcast:
   `src/windows/main/renderer.js:992-998` — `window.docusnap.onDocAutoFiled?.((info) => { … markRowFiled(info.docId); })`,
   wired to the `'doc-auto-filed'` event (`src/preload.js:516`). The in-code comment at
   `src/windows/main/renderer.js:1219-1220` states markRowFiled "is the ONLY place allowed to claim a
   document is filed" and it is reached "on the onDocAutoFiled event" — i.e. auto-file only.
3. A **manual confirm** goes through the `confirm-review` IPC
   (`src/modules/review/handler.js:1282-1314`). On success it returns `r` to the **Review** window and
   the shared service fires only a **count** broadcast — `notifyCounts(db)` →
   `notifyMainWindow('review-count-changed', documents.getReviewCount(db))`
   (`src/modules/review/handler.js:151-153`). There is **no per-document "confirmed/filed" event** on
   the manual-confirm road.
4. The main window's only listener for that broadcast updates the queue badge + dashboard, and **never
   touches the import rows**: `src/windows/main/renderer.js:1352` —
   `window.docusnap.onReviewCountChanged((count) => { applyReviewCount(count); refreshDashboardIfHome(); });`.
   `review-count-changed` also carries only a **bare number** (`getReviewCount`), so even if a row
   listened to it, it could not know **which** doc was confirmed.
5. The split-row `watch db_id` fix (`205143a`, pinned by `stress_test/test_watch_row_dbid_sync.js`)
   only made `msg.db_id` land **synchronously** so the row carries `data-doc-id` and the **auto-file**
   flip (`markRowFiled`) can find split-import rows. Its own header states the bug was watch-split rows
   "never flipped to 'Filed (auto)'" — it added **no** manual-confirm event. So the manual-confirm road
   was simply never wired to flip the row.

### ASSUMPTION
- None load-bearing. The confirm is a genuine filing step (`reviewService.confirm` is the atomic
  claim-then-file path), so once it succeeds the doc IS filed and "Filed" is the honest label — the row
  is merely stale, not wrong about filing. (Consistent with the deliberate "Ready to file" ≠ "Filed"
  wording at `src/windows/main/renderer.js:1213-1218`.)

### Root cause (file:line)
No per-document confirmed/filed broadcast exists on the manual-confirm road, and the row-flip helper is
wired only to auto-file:
- `src/modules/review/handler.js:1282-1314` (`confirm-review`) emits only the count broadcast
  (`:151-153`), never a per-doc event.
- `src/windows/main/renderer.js:992-998` — `markRowFiled` is subscribed only to `doc-auto-filed`;
  nothing calls it after a manual confirm.
Real bug (misleading status), not works-as-designed — this is the "where is my paper?" class Chris has
repeatedly flagged.

### Proposed fix + pin
**Fix (smallest correct — mirror the auto-file wiring for a manual confirm):**
1. `src/modules/review/handler.js` — in the `confirm-review` success path (just before `return r;` at
   `:1313`, where `payload.document_id` and `notifyMainWindow` are both in scope), add a per-doc
   broadcast: `notifyMainWindow('doc-confirmed', { docId: payload.document_id });`. (Adds a
   notification only — no change to filing/learning behaviour.)
2. `src/preload.js` — beside `onDocAutoFiled` (`:516`), add
   `onDocConfirmed: (cb) => ipcRenderer.on('doc-confirmed', (_e, info) => cb(info)),`.
3. `src/windows/main/renderer.js` — add a listener beside the auto-file one (`:992-998`):
   `window.docusnap.onDocConfirmed?.((info) => { if (info && info.docId != null) markRowFiled(info.docId, { manual: true }); });`
   and extend `markRowFiled(docId, opts)` (`:1006-1017`) to label **"Filed"** when `opts.manual`
   (vs the existing "Filed (auto)"), keeping the click-to-open-in-Review behaviour.

*(If the owner prefers a single source of truth, hang the per-doc event off the existing `notifyCounts`
seam instead — but `notifyCounts(db)` lacks the docId, so the IPC-handler-level broadcast at `:1313`,
where `payload.document_id` is already in hand, is the smaller and more direct change.)*

**Pin:**
- New `stress_test/test_confirm_row_filed_sync.js` (source pin, mirroring
  `test_watch_row_dbid_sync.js`'s style): assert (a) `src/modules/review/handler.js` `confirm-review`
  success path emits `notifyMainWindow('doc-confirmed'` with `payload.document_id`; (b) `src/preload.js`
  exposes `onDocConfirmed`; (c) `src/windows/main/renderer.js` wires `onDocConfirmed` → `markRowFiled`
  and `markRowFiled` supports the manual "Filed" label. A future refactor that drops the broadcast or
  the listener re-breaks the flip and this catches it.

### Seam + owner-gated?
Adds a **notification** on the confirm road and a renderer listener — **no change to filing, learning,
auto-file eligibility, or extraction.** **NOT owner-gated** in the extraction sense. The only care point
is that `doc-confirmed` fires exactly once per successful confirm on the same window path that already
fires `review-count-changed`; a rejected/failed confirm (`!r.ok`) must not fire it (place the call in
the success branch only).

---

## ITEM C — Bundle issuer read from a later page while page 1 is shown (DESIGN ONLY)

### Symptom
On a multi-page bundled PDF, the detected issuer/supplier comes from a later page (e.g. page 3) while
the viewer shows page 1. Looks wrong to the user (the visible page is not where the name was read).

### FACT
1. The full-page OCR text handed to the engine is **one concatenated blob across all pages**, joined
   with explicit page markers: `python_backend/ocr/tesseract.py:1159` —
   `return "\n\n--- PAGE BREAK ---\n\n".join(texts), pages`. `texts` is filled per page
   (`:1107`, `:1112`, `:1145`). So `ocr_text` mixes every page's text, and Stage-1 keyword / Stage-2
   text lanes scan the whole bundle with **no page-boundary awareness**.
2. The engine treats `ocr_text` as a single blob for identity — it does **not** reason about
   `--- PAGE BREAK ---` at all (grep of `python_backend/extraction/engine.py` for `PAGE BREAK` /
   `page break` / `page_break` → **no hits**). The many `results["supplier_name"] = {…}` election sites
   (e.g. `engine.py:8763, 8783, 8864, 9747, 9814, 9896, 9963, 10005, 10045, 10090, 11408`) attach a
   `method` and `confidence` but **no source page / text offset**.
3. The **logo/template identity** lane is page-0-anchored: `python_backend/process_docs.py:1147` —
   `_idpage = page_images[0]` fed to `template_matcher.identify_template(...)`. So a **logo-elected**
   issuer is page-1 by construction; the cross-page problem is specific to the **text-elected** issuer
   (a keyword/anchor hit that lands in a later page's slice of the blob).
4. The **type** is detected from **page-0 geometry** only:
   `python_backend/process_docs.py:875` (`reconstruct_page_text(page_images[0], …)`) and
   `:901 / :928 / :968` (`recover_type_detection*(page_images[0], …)`). So type is page-1-anchored
   while the text-lane supplier can come from a later page — a type-page vs issuer-page divergence is
   itself a strong "this is a bundle" signal.

### ASSUMPTION
- The reported case is a text-lane election (page 1 lacks a strong letterhead/logo, a later page's
  letterhead text wins). A logo-strong page-1 doc would already resolve on page 1 (fact 3).
- Deriving the source page by **first occurrence** of the resolved name string in `ocr_text` is
  **unreliable**: many single-doc invoices repeat the supplier name in a per-page footer, so
  first-occurrence would (correctly) say page 1 there but could be ambiguous when the name recurs. The
  robust derivation needs the **winning** read's own offset/page, not first-occurrence. (Design risk,
  below.)

### Root cause (file:line)
Not a defect to "fix" — it is the current architecture: identity is elected over the whole-bundle
concatenated `ocr_text` (`tesseract.py:1159`) with no per-read page provenance
(`engine.py` supplier-election sites carry `method`/`confidence` but no page). The visible-page vs
read-page mismatch is the honest consequence. The design below adds **provenance + a nudge**; the real
remedy for bundles is **splitting** (see the seam).

### Proposed design (DESIGN ONLY — not built)
**(1) Honest cross-page PROVENANCE note on the issuer.**
When the elected `supplier_name` read's source page ≠ the shown page (page 1 / page index 0), attach a
review-bound note, e.g. *"Issuer read from page N."* Feasibility rests on the `--- PAGE BREAK ---`
markers (`tesseract.py:1159`): the page index of a text span = count of markers before its offset. The
correct seam is to have the winning read **carry its offset/page** at the election site rather than
re-searching the blob:
- Stage-1 keyword reads have a regex match position (page derivable from the match offset).
- Stage-2 anchor reads have a `page_zone`/geometry (already page-aware).
- The logo lane is page-0 by construction → no note.
Emit the note only when the derived page > 1. Fall back to first-occurrence only as a last resort, and
suppress it when the name also appears on page 1 (a repeated footer), to avoid a false "from page N."

**(2) "Split this bundle?" nudge.**
When `page_count > 1` AND the issuer's source page ≠ page 1 (optionally corroborated by
**type-page (page 1) ≠ issuer-page**, fact 4), surface a review-bound suggestion to split the bundle
and point the user at the existing **✂ Split-PDF** tool in Review (`split-pdf` IPC). This is a
review-time nudge, never an auto-split.

### Seam + owner-gated?
**Owner-gated: YES — extraction layer.** Any new note that rides `needs_review` changes auto-file
eligibility (a doc carrying a provenance/split note must be **review-bound, not auto-filed**), so it
needs the standard **cold census + realdoc M=0** gate before a flip, DARK by default.

**Named seam (what it relies on upstream / what it interacts with):**
- **Relies on** the `--- PAGE BREAK ---` markers in `ocr_text` (`tesseract.py:1159`) staying present
  and unique — any text normaliser/cleaner that strips or rewrites them silently breaks the page
  mapping. Better: thread the winning read's page from the election site instead of re-deriving from
  the blob.
- **Relies on** the identity lanes exposing a locatable source (keyword offset vs anchor geometry vs
  page-0 logo) — the derivation must be lane-aware; a lone "search the blob for the value" is the
  fragile path (footer-repeat ambiguity, ASSUMPTION above).
- **Interacts with `watch_separate_enabled`** (the real bundle-splitter — DARK, soak-gated per
  `docs/designs/WATCH_SEPARATE_SOAK_GATE_2026-09-02.md`): that feature splits bundled PDFs into
  constituent documents on the watch path (imports whole until flipped). The nudge is the **interim /
  manual-import** surface of the *same* problem and must **defer to** the document-separation pre-pass
  — do not nag when separation already ran and declined to split, and do not fire on a **genuine single
  multi-page document** (e.g. a 34-page contract, statement, or a doc whose issuer legitimately sits on
  a cover/summary page). Once `watch_separate_enabled` is live, the nudge's scope should shrink to the
  manual path + docs separation left intact.
- **Interacts with the page-0 TYPE election** (`process_docs.py:875/901/928/968`): type is read from
  page 1 while the text-lane supplier can be a later page. Type-page ≠ issuer-page is a useful
  corroborating bundle signal for the nudge (and, conversely, a matching type+issuer page argues it is
  one document with a later-page name, so soften the nudge there).

---

## Summary (root cause + verdict)

| Item | Root cause | Verdict |
|---|---|---|
| **A** | Mailbox/workflow row click passes a **bare `{id}`** to `selectDoc` (`search-mailbox.js:137`, `search-workflow.js:344`); the detail DTO **never populates `type_name`** (`previewService.js:47-51` resolves `type_slug` only), and `selectDoc` feeds the **bare** doc to `renderActions`/`onDocShown` (`search-preview.js:181,199`). NOT a role gate (`review/handler.js:912-923` is role-independent) and NOT the DTO allowlist (it declares `type_name`). "Edit-role" is incidental. | **Real bug.** Display/projection only — **not owner-gated.** Fix: resolve `type_name` in `previewService` + pass the merged doc to all sub-renders. |
| **B** | The row-to-"Filed" flip (`markRowFiled`, `main/renderer.js:1006`) is wired **only** to the auto-file event (`doc-auto-filed`, `:992-998`). The manual `confirm-review` road emits only a **bare count** (`review/handler.js:151-153`), which the main window uses for the badge/dashboard, never the rows (`:1352`). The `205143a` split-row fix only stamped `db_id` for the auto-file flip — it added no manual-confirm event. | **Real bug** (stale/misleading status). Notification wiring only — **not owner-gated.** Fix: emit `doc-confirmed` on confirm success + a renderer listener → `markRowFiled(…, {manual:true})` labelled "Filed". |
| **C** | Identity is elected over the **whole-bundle concatenated `ocr_text`** (`tesseract.py:1159`) with **no per-read page provenance** (`engine.py` supplier sites carry method/confidence, no page); logo + type are page-0-anchored, so a **text-elected** issuer can come from a later page. | **Works-as-architected**, not a discrete defect. Design adds a provenance note + "Split this bundle?" nudge. **Extraction layer → owner-gated** (census + M=0, DARK). Real remedy is splitting (`watch_separate_enabled`); the nudge is the interim/manual surface and must defer to the separation pre-pass. |

*Nothing implemented. Fixes A and B are small and not owner-gated; item C is a design for owner review
before any build.*
