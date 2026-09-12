# eric — 2026-09-12 — Department access gating + non-OCR intake: Electron-side architecture (advisory, verbatim)

> Companion to `docs/brainstorms/BARRY_2026-09-12_quickfile_departments.md`; synthesised into
> `docs/designs/QUICKFILE_AND_DEPARTMENTS_PLAN_2026-09-12.md`. Migration numbers here were written as 162/163;
> the plan renumbers them 163/164 (mig 162 = the deskew field-adopt arc built the same day).

## Prior art check
No prior design for departments, non-OCR intake or Office files in `pendingfeatures.md` / `docs/oracle_log.md` /
`docs/session-log.md`. Reused: the Stage-8 inert seam (`accessService.js:72-100`, `database/index.js:1373-1396`),
the Generic Document + `{title}` token, the ONE-helper learning-exclusion pattern (`machine_vias.js:25-66`).

## Load-bearing facts (FACT unless marked)
| # | Fact | Where |
|---|---|---|
| F1 | `canAccessDocument` is the one per-doc read predicate; env kill switch `ACCESS_GATE_ENABLED` default ON, **no `isPackaged` guard** (a customer machine can set the env var and turn the doc gate off) | `accessService.js:37-41,50-90` |
| F2 | Per-doc gate consulted by: desktop detail/pages/thumb/enhance (`review/handler.js:882,939,1013,1052,1074`), `/v1` detail/pages/thumb (`api/handler.js:505-508,521-524,551-554`), print (`print/handler.js:206`), stamp (`stampService.js:49`), workflow actions (`workflow/handler.js:109,130,214`, `api/handler.js:775`) | grep |
| F3 | **No LIST or COUNT surface consults it**: search (`search/handler.js:118-129`, `api/handler.js:487-496` → `documents.search :703-792`), review queue/counts (`review/handler.js:436-440`, `api/handler.js:816-836`), bin (`review/handler.js:1185-1189`, `api/handler.js:619-624`), dashboard counts (`search/handler.js:45-48,60,67,73`), type-ahead suggestions (`documents.js:151-175`), dev inspector registry (`processing/handler.js:2581-2582`), `open-document-file`/`show-document-in-explorer` (`:2735-2755`, role + containment only), `/v1 review/:id/viewing` (`api/handler.js:918-925`, writer-only, returns other viewers for ANY id) | read |
| F4 | `review-count-changed` broadcast from 9 sites with a GLOBAL `getReviewCount(db)` (`documents.js:509-513`) | grep |
| F5 | `/v1` sessions carry `{userId, username, role, clientKey}` only; `revokeUser` exists and is called on role change (`sessionService.js:43-67,74-78`; `auth/handler.js:155-157`) | read |
| F6 | `PRAGMA foreign_keys = ON` → cascades are real | `database/index.js:46` |
| F7 | `documents.update` is a WHITELIST; an unlisted column "writes once and can never be cleared" | `documents.js:45-53` |
| F8 | `learningExcludedSql` is the ONE hard learning-exclusion fragment carried by every learning reader (`documents.js:160`, `learning.js:222,1614,1809,2153…`, `trust.js:850,1422`, `namePresence.js:60`, `templates.js:115,149,184`); returns `''` when the column is absent or `learning_exclude_docs` is OFF | `machine_vias.js:41-66` |
| F9 | `reviewService.confirm` is where ALL write-side learning happens (`saveCorrections :438`, `saveSupplierIdentifiers :445`, `persistConfirmedValues :503`, templates `:602,620,672`) | read |
| F10 | `commitDocument` takes any extension untouched (`:123`), writes the XML sidecar for any ext (`:231-241`), dedups (`:191-197`), contains to the one `outputRoot` (`:170-174`), has a RE-FILE road via `existingFiledPath` (`:96,185,205-207`); the re-file caller unlinks the old copy + XML (`reviewService.js:516-520`) | read |
| F11 | `ensureWorkingCopy(fs,path,inboxDir,src,docId,name)` is atomic, sanitises the ext, EXPORTED; `inbox/` is an allowed open root | `processing/handler.js:6210-6226,6956,2240` |
| F12 | `previewService` treats ANY non-`.pdf` as a PNG/JPEG (`:155-160`, `:209-221`) — a `.docx` would come back as a broken image data-URL | read |
| F13 | `ALLOWED_OPEN_EXTS` = pdf/png/jpg/jpeg/tif/tiff/bmp/xml (`:2230`) → `open-document-file` refuses a `.docx`; pin `src/modules/processing/test_path_containment.js` | read |
| F14 | The preload swallows `dragover`/`drop` on EVERY window by design (audit M4/M9: "No window accepts drag-drop"); main guards `will-navigate` | `preload.js:5-15`, `main.js:1185-1187` |
| F15 | Import extension filters: JS `BATCH_SUPPORTED_EXTS` (`processing/handler.js:1513-1514`), watch `SUPPORTED_EXTENSIONS` (`watch/handler.js:44-46,221`), Python `SUPPORTED_EXTENSIONS` (`tesseract.py:1178-1180`) — three copies | read |
| F16 | Home CSP has no `img-src` (data-URL thumbs blocked); Search CSP has `img-src 'self' data:` | `main/index.html:5-6`, `search/index.html:5-6` |
| F17 | `confirmed_via IS NOT NULL` is counted as "filed automatically" on the dashboard | `search/handler.js:67` |
| F18 | No tags/notes concept on documents | grep |
| F19 | HEAD migration = 161 | git log |

## A. Department access gating
### A.1 Data model (additive, byte-identical when empty)
Single nullable `documents.department_id` (NOT a join table): NULL = shared/unrestricted keeps every existing row
byte-identical; every list filter is one predicate; a later multi-dept need is an additive `document_departments`
join OR-ed into the same helper. Extend `doctype_grants` with `department_id` as a third SUBJECT kind (dept D may not
see type T); do NOT add a polymorphic `department_grants` (3×3 semantics to test). The tag IS the per-document rule.
```sql
CREATE TABLE departments (id PK, name TEXT NOT NULL UNIQUE COLLATE NOCASE, slug TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE user_departments (user_id FK users ON DELETE CASCADE, department_id FK departments ON DELETE CASCADE,
  created_at, PRIMARY KEY (user_id, department_id));
ALTER TABLE documents      ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE RESTRICT;
CREATE INDEX idx_documents_department ON documents(department_id);
ALTER TABLE doctype_grants ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE CASCADE;
CREATE INDEX idx_doctype_grants_dept ON doctype_grants(department_id, document_type_id);
ALTER TABLE document_types ADD COLUMN default_department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;
```
`ON DELETE RESTRICT` on `documents.department_id` is deliberate: `SET NULL` would silently UN-restrict every doc in a
deleted department (fail-open on delete). The service refuses a hard delete while docs reference it; admins retire via
`is_active=0` (a retired dept STILL restricts). `doctype_grants` subject invariant "exactly one of role/user_id/
department_id" enforced in the writer. Re-tag audit = an `audit_log` row `document_department_set {from,to}` on the
append-only HMAC chain via `logAudit`. Watch-folder default: setting `watch_default_department_id`. Backup/restore:
include `departments` (natural key `slug`); exclude `user_departments` (ASSUMPTION about `backupService.js` scope).
Add `department_id` to the `documents.update` whitelist (F7) + `insert`.

### A.2 Enforcement
Order inside `canAccessDocument`, two inserted lines:
```
1 doc missing → not_found · 2 admin → allow · 3 OPEN-route party → allow · 4 deleted → deny
5 departmentTagDecision(db,user,doc) → deny 'department_restricted'   ← NEW (tag ∉ my depts)
6 doctypeGrantDecision(db,user,doc)  → deny 'doctype_restricted'      ← existing seam, now reads the table
7 edit → allow · 8 readonly → confirmed ? allow : deny · 9 else → deny
```
Both read ONE compiled object `compileRestrictions(db, user) → {unrestricted, deptIds:Set, deniedTypeIds:Set}`,
memoised per request, never per process (membership must be live).
**Open-route party ruling:** keep it above the department test; move enforcement to ASSIGN time —
`workflowService._validateAssignTarget` (`:185`) and `assignSystem` (`:232`) must refuse a recipient for whom
`canAccessDocument(db, recipient, docId)` (evaluated BEFORE the route exists) is false → `fail('RECIPIENT_NO_ACCESS')`.
Without this a system route from `amountRouting.startDefaultRoute` (`review/handler.js:160-168`, recipients by
`usersByRole`) would leak a restricted doc to any edit user. A member removed mid-route keeps route visibility until the
route closes — accept, document, audit (auto-close on membership change = v2).
**List/count filtering — SQL, one helper, never a renderer post-filter:** `accessService.visibleDocSql(db, user,
alias='d') → {sql, params}` returning `''` when the gate is off, the actor is admin, or `departments` is empty/absent
(the `learningExcludedSql` `''`-when-inert pattern):
```sql
AND (d.department_id IS NULL OR d.department_id IN (SELECT department_id FROM user_departments WHERE user_id = @__viewer))
AND d.document_type_id NOT IN (<deniedTypeIds>)
```
Route-party docs are NOT OR-ed into lists (the mailbox is their surface; detail-by-id passes via step 3).
**Consistency pin:** for every doc, `canAccessDocument(u,id).allow === (id ∈ search(u)) || isOpenRouteParty(u,id)`.
**Surface inventory:** detail/pages/thumb/enhance/print/stamp/workflow — none (steps 5/6 land automatically) ·
`documents.search :703` — thread `viewer` (`searchService.searchDocuments({db,params,role,userId})`) → append the
fragment · `getReviewQueue/getDeferredQueue/getReviewCount/getDeferredCount :177,295,509,545` + `reviewSvc.queue/
deferred/counts(db)` (`api :819-835`) — same `viewer` arg (`/v1` passes `session`, desktop `getCurrentUser()`) · the 9
`review-count-changed` broadcasters — collapse to ONE `review/handler.js notifyCounts(db)` (`:150-153` exists) reading
`getCurrentUser()` · Bin `getDeletedQueue :341` — fragment · Dashboard `getFiledCounts :555` + `get-dashboard-extra`
(`search/handler.js:60,67,73`) — fragment (count leakage) · Export (`export/handler.js:26-42`) admin-only — none; if
ever opened to `edit`, `exportService._buildDocQuery :126-133` + `listOptions :54-70` take the fragment · Type-ahead
`getFieldValueSuggestions :151-175` — fragment · Dev inspector `:2581` — admin-only when `departments` non-empty ·
`open-document-file`/`show-document-in-explorer :2735-2755`, raw `open-file :2718` — add `canAccessDocument` on the
resolved doc · `/v1 review/:id/viewing :918-925` — add the per-doc gate before `heartbeat` · Workflow mailbox lists —
none (consistent once assign is gated) · `/v1` DTO `dto.js:22-26,44-49` — add `department_id`,`department_name`
(additive) · Detached client — dept badge from the DTO; never decides.
**Kill switch:** share `ACCESS_GATE_ENABLED`; the feature's byte-identical OFF state is DATA (empty tables). A setting
`departments_enabled` (default OFF, in `TEST_SWITCH_KEYS`) gates only the admin UI + the write side; the READ gate keys
off data so a tagged doc is restricted regardless (fail-closed). **Companion fix (pre-existing, F1):** `gateEnabled()`
must honour the env var only when `!app.isPackaged`, like `_realCanonical` (`processing/handler.js:2286-2294`) — a
security boundary must not be env-switchable on a customer machine.

### A.3 Write side
`departmentService.setDocumentDepartment(db, actor, docId, deptId|null)`: `requireRole('admin','edit')` →
`canAccessDocument` → `workflowService.editGuard` (`:44`) → widening rule → write → audit. **Widening (to NULL, or to a
dept the actor is not in) = admin only**; narrowing/moving within own depts = edit; readonly never. Defaults, precedence
explicit > watch-folder default > doc-type default: applied at INSERT (`processing/handler.js` insert sites, e.g.
`:6395`) and re-applied at confirm **only if `department_id IS NULL`**. **Confirm/filing seam (corpus M=0):** one
guarded statement in `reviewService.confirm` after the claim, before filing: `if (deptsExist && doc.department_id ==
null && dt.default_department_id) update(...)` — dead with an empty table → byte-identical. A `{department}` token
needs the same 3-point registration as `{title}` (`filename_pattern.js:25-45` + `filing/handler.js:132-141`); an empty
token collapses (`:98-129`) → untagged docs byte-identical. Deriving a dept FROM a folder is backwards — refuse.

### A.4 Filing-folder reality
The output tree is a plain Windows folder; the `.metadata/*.xml` sidecar contains EVERY field value (`:297-328`). Any
account with share/NTFS read on that tree reads everything; app gating governs the app, the API and the client only.
Options: (1) ship the `{department}` folder token so a customer can ACL `Finance/` and `HR/` — their job, documented;
(2) per-department output roots — refuse v1 (three one-root seams: `:170-174`, `_allowedOpenRoots :2232-2247`, the
watch-overlap check `watch/handler.js:31-42`); (3) the DB-at-rest encryption arc protects `docusnap.db`, not the filed
files; (4) consider omitting the XML sidecar for dept-tagged docs (setting).

### A.5 Sessions / presence / stamps
Per-request membership lookup, not in the token (`sessions.issue/verify` unchanged; `compileRestrictions` reads
`user_departments` at gate time). Membership change effective next request; no contract bump; do NOT `revokeUser` on
membership change. Presence: queue rows filtered first; gate the `viewing` heartbeat. `can_stamp` orthogonal
(`stampService` already requires `canAccessDocument :49`).

### A.6 Threat cases → pins
1 id-walk pages/thumbs/detail across depts → 403/404 no body · 2 search/queue/bin/dashboard counts: a restricted doc
changes NO number for an outsider · 3 route to an outsider → `RECIPIENT_NO_ACCESS` (human + system assign) · 4 admin =
the ONLY bypass; an `edit` user in no department sees only NULL-tagged docs · 5 membership removed mid-session → next
request denied · 6 export admin-only stays; pin the fragment · 7 deleting a department with docs → refused · 8
`ACCESS_GATE_ENABLED=0` in a packaged build → ignored · 9 type-ahead excludes restricted docs · 10 presence heartbeat
on a restricted id → 403.

### A.7 Tests + OFF control
`test_access_service.js` (inject `deps.departments`; existing suite green with empty tables = the OFF control) · new
`test_department_visibility.js` (fragment `''` on an empty table; the consistency pin; each surface returns the same
set as `canAccessDocument`) · `test_search_contract.js`, `test_v1_contract.js`, `test_v1_review.js`,
`test_v1_workflow.js` unchanged with empty tables; additive DTO fields asserted · corpus M=0: `npm run test:pins` + a
realdoc run with the migration applied and no departments — filenames/folders byte-identical.
**Seam statement.** RELIES ON `PRAGMA foreign_keys=ON`; the `documents.update` whitelist extended; assign-time gating
landing in the SAME slice as the read gate (else the route exemption becomes a bypass); every list surface threading a
`viewer`. WEAKENS nothing when tables are empty; when populated, the 9 global count broadcasts become per-viewer
(single desktop session → safe); `edit` loses "open any filed doc by id" (intended).

## B. Non-OCR submission lane (Electron side)
### B.1 Intake
- **Dialog (slice 1):** IPC `direct-intake-pick` → `dialog.showOpenDialog(win, {properties:['openFile',
  'multiSelections'], filters:[{name:'Documents', extensions: INTAKE_EXTS}]})`. Paths stay in MAIN: a staging map
  `_intakeStaged: Map<token,{path,ext,size,mtime,expires}>` (the `_devSession` pattern), TTL 15 min, cleared on window
  close. The renderer receives `[{token,name,ext,size,refused?}]` — the de-pathing rule (`searchService.js:74-82`) holds.
- **Drag-drop (slice 4, Oracle-gated — a change to the M4/M9 boundary, F14):** keep both `preventDefault` calls
  unconditional; in the preload's `drop` handler, ONLY when `e.target.closest('[data-intake-drop]')` exists, map
  `e.dataTransfer.files` through `webUtils.getPathForFile(file)` (Electron 44; `File.path` is gone; `webUtils` is
  preload-only — the path never enters the renderer) → `ipcRenderer.invoke('direct-intake-stage', paths)`. Pin:
  dropping an `.html` on Home still does not navigate; a drop outside the target is inert.
- **Per-lane watch folder (slice 5, later):** a SECOND setting `direct_intake_watch_folder`, reuse `classifyPoll`
  (`watch/handler.js:67`) + `_watchFolderConflict :31` + an overlap check vs the OCR watch folder. A watched file has no
  metadata → needs a holding state `documents.status='intake'` + an "Awaiting details" tray on Home. Blast radius of a
  new status: `restoreDeleted` maps non-confirmed → `needs_review` (`documents.js:332-340`) — must map
  `intake='direct' && !confirmed_at` → `'intake'`. Refuse for v1.
- **Allowlist + never-open guard — ONE shared module** `src/lib/fileKinds.js`: `OCR_EXTS` (replaces the two JS copies,
  F15; Python keeps its own, pinned equal by a test), `INTAKE_EXTS = .pdf .docx .xlsx .pptx .doc .xls .ppt .odt .ods
  .rtf .txt .md .csv .eml .msg .png .jpg .jpeg .tif .tiff .bmp .gif`, `OPEN_EXTS = OCR ∪ INTAKE ∪ {.xml}` (becomes
  `ALLOWED_OPEN_EXTS`, F13), `NEVER_OPEN = .exe .bat .cmd .com .js .jse .vbs .vbe .ps1 .psm1 .lnk .scr .msi .msp .hta
  .wsf .wsh .reg .url .pif .cpl .jar .dll .inf .iso .img .htm .html .svg .docm .xlsm .pptm`. Allowlist decides; the
  never-list is defence in depth. `path.extname` handles `invoice.pdf.exe`; junctions covered by `_realCanonical`.
  Pins: `test_file_kinds.js` (`OPEN_EXTS ∩ NEVER_OPEN = ∅`); `test_path_containment.js` gains `.exe/.lnk/.docm`
  refusals through `_isOpenablePath`.
- **Size caps:** setting `direct_intake_max_mb` (default 50) on the staged `stat` before any copy; 50 files per submit.
- **Working copy:** `ensureWorkingCopy` (F11) → `inbox/<docId><ext>`. **The user's source file is NEVER deleted or
  drained** (the OCR lane's `_scheduleSourceMove`/`removeSourceFile` are not called).
### B.2 Metadata + data model
**One `documents` row + `extractions` rows, no separate table** (every consumer keys off them; "there is no second
search engine" `searchService.js:15-17`). Row: `status='confirmed'`, `confirmed_at=now`, `confirmed_by_username=actor`,
`overall_confidence=NULL` (ASSUMPTION the Search renderer shows "—"), `document_type_id` from the modal (default the
General Document preset), `supplier_name`/`doc_date`/`reference_number` from the typed fields, `page_count` for PDFs,
`working_path`. Extractions `{field_key, raw_value=display_value=typed, confidence=100, extraction_method='typed',
was_corrected=0}`. Date via `filing.normaliseDate` (`filing/handler.js:411`, the every-door rule).
**Migration:** `documents.intake TEXT NULL` (`'direct'` | NULL = OCR pipeline), `documents.intake_notes TEXT NULL`
(both in `insert` + the `update` whitelist). Tags: `document_tags(document_id FK CASCADE, tag TEXT COLLATE NOCASE,
PK(document_id, tag))` in slice 3, wired into the full-text `EXISTS` chain (`documents.js:753-768`) table-guarded like
barcodes (`:762-767`).
**Learning exclusion — two layers, both required:** (1) write side: the lane never calls `reviewService.confirm` (F9)
and never consults `isAutoFileEligible`; (2) read side: extend the ONE helper `learningExcludedSql` (F8) with a second,
**non-switchable**, column-guarded clause `AND COALESCE(d.intake,'') <> 'direct'` — all 17+ pinned readers move
together. Do NOT reuse `confirmed_via` (it means "who confirmed", is counted as auto-filed on the dashboard F17, its
exclusion is SOFT, and `learning_excluded_at` alone is switchable OFF).
### B.3 Filing
`filing.commitDocument({db, fs, path, outputRoot, folderPath:<staged dir>, originalFilename, workingPath:<inbox copy>,
existingFiledPath:null, allValues, documentType: dt.name, dtInfo, logger})` (F10) — non-PDF extensions, the sidecar,
`-DUPLICATE`, root containment for free; `{originalName}` seeds the default title; `{title}` is a token. Then
`documents.update({stored_filename, stored_path})`. On failure after the row insert: delete the row + inbox copy and
report (never an `error`-status row in the OCR stuck list).
### B.4 Search text + thumbnails
Fill `documents.ocr_text`; provenance is `intake='direct'`, not `ocr_recipe`. `src/lib/ooxmlText.js` — dependency-free
(the reader twin of `xlsxWriter.js`): minimal ZIP central-directory parser + `zlib.inflateRawSync(buf,
{maxOutputLength})` (zip-bomb cap 8 MB/part); `word/document.xml` (`<w:t>`), `xl/sharedStrings.xml` + `xl/worksheets/
sheet*.xml`, `ppt/slides/slide*.xml` (`<a:t>`); strip tags, decode entities, cap `ocr_text` at 200k chars; run in a
`worker_threads` worker. `.txt/.md/.csv` verbatim (control chars stripped). `.eml`: headers (Subject/From/Date pre-fill
the modal) + `text/plain` part. `.msg`, `.doc/.xls/.ppt`: metadata only in v1. PDF text: a 30-line
`python_backend/render/pdf_text.py` (pypdfium2 `get_textpage().get_text_range()` + page count), spawned like
`render/pages.py` — PDF text ONLY, no OCR, embeddable-python `sys.path.insert` rule. Thumbnails: PDF via `--thumb`;
images via the raw read; office → `null` (list icon by ext). **Seam (F12):** `getDocumentPages`/`getThumbnail` gain
`if (!fileKinds.isRenderable(ext)) return []/null`.
### B.5 Management ops, IPC, preload, CSP
`src/services/directIntakeService.js` (transport-agnostic, injectable): `stage(db, actor, paths)`, `submit(db, actor,
{token, meta})`, `update(db, actor, docId, patch)` (re-files via `existingFiledPath` when a filing token changed; old
copy + XML unlinked as `reviewService :516-520`), `replace(db, actor, docId, token)`, `bulkUpdate(db, actor, docIds,
patch)`. Order of checks in every mutator: `requireRole('admin','edit')` → `direct_intake_enabled` → token valid →
`INTAKE_EXTS` + `NEVER_OPEN` → size cap → `canAccessDocument` (update/replace/bulk) → `workflowService.editGuard` →
department write rule (A.3) → doc type enabled → `normaliseDate` → transaction (row + extractions + tags) →
copy/extract/file outside the txn → audit `document_direct_intake|_updated|_replaced` → event `direct-intake-changed`.
Replace with history: append-only `document_versions(id, document_id FK CASCADE, version_no, stored_path, sha256,
replaced_by_username, replaced_at)` (the `stamp_events` pattern); the superseded file renamed `<stem>.v<N><ext>`. No
diff/restore UI v1. Soft-delete/restore: existing bin IPCs (a dialog-lane doc always has `confirmed_at` → restore →
`confirmed`). IPCs: `direct-intake-pick|stage|submit|update|replace|bulk-update|list` (list = `documents.search` with an
`intake='direct'` param, SQL side). Preload: six invoke-only functions under the existing `docusnap` bridge. CSP: no
change if the modal lives in the Search window (F16); on Home, `img-src 'self' data:` (one reviewed line).
### B.6 Seams
Review queue/counts untouched by construction; auto-file never invoked; `previewService` office branch; `open-document-
file` works only once `ALLOWED_OPEN_EXTS` = the shared `OPEN_EXTS`; `shell.openPath` on a `.docx` opens Word (MOTW
preserved by `copyFileSync` → Protected View — ASSUMPTION on ADS propagation); LAN client v1 read-only — rows carry
`stored_filename` for an icon; `/pages` returns `[]` for office files; **no `/v1` download endpoint** (a new egress
surface → its own Oracle pass). `getStuckCount`/`reconcileHolding` (`:6246`): the inbox copy maps to a live row; unlink
after filing (mirrors `reviewService.js:509`).
### B.7 Slice order (each byte-identical OFF behind `direct_intake_enabled`, seed OFF, in `TEST_SWITCH_KEYS`)
1 `fileKinds.js` + collapse the three ext copies + `ALLOWED_OPEN_EXTS` → pins (zero behaviour change) · 2 migration +
`learningExcludedSql` clause + `directIntakeService.submit` (dialog lane) + the modal + `previewService` office branch →
`test_direct_intake_service.js` (row shape, no learning rows, `getFieldFormats`/`scopeTrust` ignore it, filing via a
stubbed `commitDocument`) + `test_learning_excluded_readers.js` extended · 3 update/replace/bulk/tags +
`document_versions` · 4 drag-drop (Oracle-gated boundary change) · 5 per-lane watch folder (`intake` status) · 6
`pdf_text.py` + eml.
**Refuse in v1:** `.msg`/binary Office text, a `/v1` file download, per-department output roots, version diff/restore,
deriving departments from folders, macro-enabled formats, the watch lane before the holding state exists.

## Assumptions (not verified at source)
`backupService.js` scope for departments; the Search renderer's rendering of a NULL `overall_confidence`; `thumbs.js`
fallback on `null`; the IPC name behind `getFieldValueSuggestions`; MOTW propagation via `copyFileSync`; that
`reviewSvc.queue/counts` wrap `documents.getReviewQueue/getReviewCount` unchanged.
