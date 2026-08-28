# HANDOVER — 2026-08-27 NIGHT2 (the owner's two night-prompt features: Export + click-to-browse Memory Inventory)

**Branch** `feat/teach-side-overnight` · **2 code commits tonight, NOT pushed** (owner reviews then pushes):
- `ce4c7f5` **feat(export)** — Home "Export data" → CSV / Excel(.xlsx) / JSON of confirmed doc data
- `d2cf9fe` **feat(learning)** — memory inventory becomes click-to-browse (no more typing an exact name)

Both are the owner's §7 NIGHT PROMPT from `HANDOVER_2026-08-27_NIGHT.md`. Ran the mandated gate: **barry + bob + eric →
Oracle** (SIGN-OFF-WITH-CONDITIONS on both; every condition applied). Prior HEAD `e993498`.

**⚠ LIVE APP — I killed it by accident, then restarted it.** During a boot smoke I ran a too-broad
`Stop-Process -Name electron`, which also killed the owner's live app on CDP 9222. I **relaunched it** (`electron . --remote-debugging-port=9222`, real userData, detached) — it is **BACK UP + healthy on 9222** at the Sign-in
screen, now running the current code (`d2cf9fe`), which also loaded the three pending main-process fixes from the prior
session (§0 step 2 wanted a restart anyway). **The owner just needs to log in again.** The `ocr_light_text_recovery`
setting persists in the DB (unchanged). No data was touched (both features are read-only).

## 0. First actions for the next session / the owner (in order)
1. **Log back into the live app** (it restarted, so the prior session ended).
2. **VERIFY THE EXCEL EXPORT BY OPENING IT IN EXCEL** (the one thing I could NOT verify — no LibreOffice here, and the
   hand-rolled .xlsx pin is a Node unzip which is more lenient than Excel's parser): Home → **Export data** → pick a
   scope → Save as **Excel** → **open the .xlsx in Excel**. If Excel refuses to open it, that is the (loud, expected)
   failure mode — CSV and JSON are unaffected; either fix the ZIP/OOXML in `src/lib/xlsxWriter.js` or fall back to
   exceljs (see §4). Confirm a reference number like `007123` keeps its leading zeros (the whole point of xlsx here).
3. **Interactive render smoke of both screens** (I verified boot + unit/source pins + every DOM id, but could not drive
   the UI past the login — no credentials): open the Export window (checklists, live count, preview, save) and
   Settings → Learning (click a sender in the new browse; open one in Learning Repair via the deep-link).
4. Then the rest of the queue waits (the §3 light-text realdoc gate from the prior handover; help plan D1–D11).

## 1. EXPORT (`ce4c7f5`) — Home button → a select-and-save tool
**What shipped (the advisor MVP, every new-behaviour-visible screen ships on):**
- **Home**: a nav-rail **Export** item + an "Export data" dashboard card — BOTH admin-only (hidden for edit/readonly;
  `main/renderer.js applyCurrentUser`). Open a NON-MODAL `export` child window (`main.js` CHILD_WINDOWS +
  NON_MODAL_CHILD + dock title; `open-export-window` admin-gated; preload `openExportWindow`).
- **`src/windows/export/{index.html,renderer.js}`**: checklists for document **types** (selecting types drives which
  **fields** are offered, deduped across types), **senders**, and **columns** (a metadata spine + the selected types'
  fields); options = confirmed-only default + "include in-review" + a filed-date range; a **LIVE match count +
  first-8-row preview**; format pills CSV / Excel / JSON.
- **`src/services/exportService.js`** (read-only): `listOptions` (pickers) · `countMatches` · `gather` (the EAV→wide
  **pivot** via `documents.getConfirmedFieldValues` — the **human's answer wins**: correction → display → raw; List
  fields joined `"; "`) · `toCsv` / `toJson` / `toXlsx` · `filterSummary` (audit).
- **`src/modules/export/handler.js`**: `export-options` / `export-preview` / `export-run`, every one
  `requireRole('admin')`. **Save dialog FIRST, then gather** (a mis-click never freezes on a big gather — Oracle).
  Writes **only** the OS-dialog path (never a derived 2nd path → needs no `_allowedOpenRoots`). Audits count + filter
  summary + basename only.

**Formats — why Excel is here (Oracle reframed it):** CSV mangles the headline columns on open — `reference_number`,
invoice/account numbers: `007123`→`7123`, `1234567890123456`→`1.2E+15`. Only the `.xlsx` `inlineStr` path preserves
them, so Excel is the correctness-preserving format, not a luxury.
- **CSV**: UTF-8 **BOM** + CRLF + RFC-4180; **CSV-formula-injection neutralised** (a cell opening `= + - @` gets a
  leading `'` **before** the RFC quote; negative/plain numbers exempt so `-50.00` survives).
- **`.xlsx`** = **`src/lib/xlsxWriter.js`**, **dependency-free** (node built-ins only) — every cell `inlineStr`, ZIP
  built **STORE** (no deflate surface) + own **CRC-32** (Electron's Node predates `zlib.crc32`), **fixed 1980 DOS
  timestamp** = byte-deterministic. **Keeps the 4-dep tree + `check-licenses.js` gate UNTOUCHED — no new npm dep.**
- **JSON**: no BOM, List fields as real arrays.

**Path columns:** `folder_path` (the user's own filed location) is offered opt-in/off; `stored_path` / `working_path`
are NEVER exported.
**No silent truncation (Oracle F1-C1):** 10k-row cap; preview shows the **true unbounded** count; Run asks for explicit
acknowledgment past the cap; and the artifact self-identifies (`# TRUNCATED` CSV row / `{_truncated}` JSON object /
marker xlsx row).

**PINS (all green under Electron-as-Node / node):** `src/services/test_exportservice.js` (pivot, correction-wins,
filters, `_csvCell` formula-before-quote + number exemption, BOM, list→array, truncation) · `src/lib/test_xlsx_writer.js`
(golden-file: parts + CRC + number-as-text + XML escape + unicode + deterministic — **NODE unzip, does NOT certify
Excel-open**) · `src/modules/export/test_export_registry.js` (non-modal + admin gate + wiring).

## 2. MEMORY INVENTORY (`d2cf9fe`) — Settings → Learning, click-to-browse
**Owner's complaint:** you had to type an exact sender name over a long flat table. **Now:** a primary **click-to-browse**
"Learned memory inventory" — a filterable scope list (one row per sender × type + counts + a "Files by itself / Not yet"
chip), cloned from the Learning-Repair selector but **READ-ONLY**. Click a sender → a read-only detail pane shows what it
remembers (fill-in hint values, past corrections, taught positions, cleanup rules, logo/layouts), from the existing
`get-learning-recovery`. The **former typed search + all its cleanup tools + the raw table are PRESERVED** verbatim under
a collapsed **"Advanced — search & clean a specific supplier"** disclosure (nothing removed; destructive actions need an
explicit expand). Clicking a browse row pre-fills those tools.

**Oracle conditions (all applied):**
- **F2-C1** `learning-scopes` is a **preserving** refactor: `() =>` → `(_e, opts) =>`, the per-type `computeSuspects`
  block guarded by `if (!opts || opts.suspects !== false)`. The **argless Repair-console call is byte-identical** (its
  "worth a look" filter intact); the browse passes `{ suspects:false }` to skip the phash cost. preload forwards opts.
- **F2-C2** the "Open in Learning Repair →" deep-link calls **`rpOpenScope(sup, slug)`** after activating + `repairInit()`-ing
  the Repair tab — it LOADS the scope (works console-on OR off), never a bare tab switch onto the empty typed box.
- **F2-C3** ONE **delegated** click listener on the static `#lr-scope-list` + a **wire-once** guard (`_lrBrowseWired`) —
  the tab lazy-init re-runs `loadScopeBrowse` on every Learning-tab show.

**Blast radius:** read-only + admin-gated; the only shared-code touch is the one `learning-scopes` IPC (pinned). The
existing flat table + its refresh wiring (`#lr-inv-refresh` / `loadMemoryInventory`) are UNTOUCHED (now inside Advanced).
**Known minor:** a rename/clear done in the Advanced tools refreshes the flat table but not the browse counts until the
browse **Refresh** button or a tab re-show (cosmetic; the mutation is correct).
**PIN:** `src/modules/settings/test_memory_inventory.js` (source-level — the F2-C1 guard shape, opts forwarding,
delegation + wire-once, `rpOpenScope` deep-link, read-only detail, Advanced tools preserved). A behavioural IPC test
needs an auth-session harness; the guard is structurally preservation-proof.

## 3. Verification done / NOT done
- **Done:** all 4 pins green; `node --check` clean on every edited JS; `index.html` tag-balanced (div 987/987, details
  10/10); every DOM id each renderer references verified present; the **main process boots clean** on the new code
  (sandbox launch, DevTools up, no exception); no new dependency → license gate untouched; `exportService` + `xlsxWriter`
  proven under the real Electron ABI.
- **NOT done (owner morning, §0):** (1) opening a real `.xlsx` in **Excel** — the pin can't certify it; (2) an
  interactive render smoke of both screens (blocked at the live login — no credentials).

## 4. Deferred slices (logged in `pendingfeatures.md`)
Export L3/L4: column-set **presets** (Xero/Sage/QuickBooks — owner Q on the exact column maps), the **accountant pack**
(copy the matching PDFs alongside), List-field **long-format** (one row per element). If the hand-rolled `.xlsx` ever
misbehaves, the sanctioned fallback is **exceljs (MIT)** — `npm install exceljs && npm run check:licenses` (treat a
non-zero exit as no-go) + add its licence family to section 3 of `THIRD-PARTY-LICENSES.txt`, then point `toXlsx` at it.
Memory inventory: the pre-scoped "Learning Repair v2 LATER sections" stay deferred (the remembered-values EDITOR, the
layouts canvas) — this slice is the read-only browse only.

## 5. Exact revert per commit
- Undo memory inventory only: `git revert d2cf9fe`
- Undo export only: `git revert ce4c7f5`
- Drop both (nothing else is on top): `git reset --hard e993498`

## 5b. 2026-08-28 follow-ups (owner feedback while reviewing, same branch, NOT pushed)
- **`b04f202` export date fields** — owner: the single date range read as if it belonged to the
  include-unconfirmed toggle, and there was no range for the actual document date. Options block regrouped
  with labels + rules ("Which documents" │ "Date ranges" │ "Save as"); TWO labelled ranges — **Document
  date** (doc_date) and **Date filed** (confirmed_at); exported + preview dates now follow **Settings →
  Processing → "Date format (region)"** (`region_date_order` dmy/mdy/ymd; ymd = ISO for a database). doc_date
  is stored DD-MM-YYYY, filtered by reformatting to sortable YYYY-MM-DD in SQL. Native `<input type="date">`
  pickers already show in the OS locale. Pin `test_exportservice.js` extended. Revert: `git revert b04f202`.
- **`6da3f96` audit-log tidy** — owner: right-align the per-row "View" buttons. CSS-only `float:right` on
  `#panel-audit .aud-view-btn`. Revert: `git revert 6da3f96`.
- **`8b3a35d` HELP SYSTEM rebuild — slice 1** (owner: "work on auto on the help file system … involve the
  agents"). Executed `docs/designs/HELP_SYSTEM_REBUILD_PLAN_2026-08-27.md` at its recommended defaults for
  D1–D11. Delivered the plain-speak SPINE + Check pages (index/A0, quick-start/A1, set-up/A2, teach/B1,
  import/C1, review/D1, fix-a-detail/D2, files-by-itself/D3) on the teach-first route, a **"User Guide…"**
  item in the Home account menu, the rebuilt `help-nav.js` manifest (old pages kept + re-mapped so every
  deep link resolves) and a deep-link pin (`test_help_nav.js`, green). Screenshots are placeholders
  (text-first). **OWNER: this slice sets the VOICE — read Quick start + Teach and sign off the tone (plan
  D11) BEFORE the rest is written.** Slices 2–3 (document-types, search, settings, admin, learning,
  troubleshooting, shortcuts, glossary, other-PCs + real screenshots) are queued, deliberately NOT written
  tonight so you correct the voice after the spine, not after 19 pages (bob's spine-first call). `check:help`
  has 20 PRE-EXISTING popup-text gaps (search/teach windows) unrelated to this slice — a later copy pass.
  Revert: `git revert 8b3a35d`.

## 6. Traps hit this session
- **The PowerShell/Bash tool has NO node/coreutils on PATH** — use PowerShell for `node`, and the Write tool (not
  heredocs) for scripts. `ls`/`cat`/`head` fail in the Bash tool.
- **Electron-as-Node prints nothing through the PowerShell tool** unless wrapped: `cmd /c ".\node_modules\electron\dist\electron.exe <test>.js > out.txt 2>&1"` then read the file.
- **`Stop-Process -Name electron` kills the LIVE app too** (it is an electron process). To clean up a sandbox, kill it
  by its specific **PID**, never by name. (This is how I took down 9222 — restarted it.)
- **Literal control chars in a source regex get mangled by the editor** — build such a regex with `new RegExp('[\\u0000-…]')`
  (\u escapes), not a `/[…]/` literal (bit me in `xmlEsc`).
- The single-instance lock is **per-userData**, so a `DOCUSNAP_USERDATA` sandbox runs safely beside the live app.
