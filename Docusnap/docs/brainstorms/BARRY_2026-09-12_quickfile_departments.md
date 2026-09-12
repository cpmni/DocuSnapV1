# barry — 2026-09-12 — "Quick File" (non-OCR submission + management) and Departments (access gating)

> Owner ask (2026-09-12, away for ~2h): "a feature for general document management … submission and management of
> docs that don't require OCR … investigate departmental roles and how we can set up a security gating system where
> only certain depts have access to certain docs." Brainstorm stage — every claim about the app is grounded in a
> file:line barry read this session. Synthesised with eric's architecture into
> `docs/designs/QUICKFILE_AND_DEPARTMENTS_PLAN_2026-09-12.md` (the plan the owner reads).

## Verified starting state (the facts the plan stands on)
- Intake accepts only `.pdf .png .jpg .jpeg .tiff .tif .bmp` — `tesseract.py:1178-1180`, mirrored in JS at
  `processing/handler.js:1513-1514` (batch) and `watch/handler.js:44-46, :221` (the watch poll silently `continue`s
  past anything else — a dropped `.docx` vanishes with no message).
- ONE watch folder (`watch/handler.js:53`), no file drag-drop anywhere in the main window (the only `drop` listeners
  are list-reorder in `settings/renderer.js:1793` and `doctype-editor.js:648`), `second-instance` discards argv
  (`main.js:1064`) — no "Send to Scan Finder" path exists.
- `/v1` reads JSON bodies only (`api/handler.js:123`); no multipart/upload endpoint. The client sees PNG pages only.
- `commitDocument` (`filing/handler.js:90-101`) is already source-agnostic: takes `allValues/documentType/dtInfo`,
  keeps the original extension (`:123`), builds folder + filename from the user patterns (`:131-165`) incl. the
  `title` token (`:140`, registered `filename_pattern.js:38`), enforces output-root containment (`:170-174`),
  duplicates (`:191-196`), XML sidecar best-effort (`:231-244`). Nothing in it needs OCR.
- General Document type BUILT and OFF: `document_types.js:757` (`GENERIC_SLUG`), fallback `processing/handler.js:32`
  gated `generic_fallback_enabled`, auto-file refusal `trust.js:1178`, `General/` folder `filing/handler.js:118-119`,
  Settings toggle `settings/renderer.js:1466-1474`. Still OCRs; review-bound by design.
- Search: `searchService.searchDocuments` shapes by ROLE and STATUS only (`searchService.js:46-72`;
  `UNCOMMITTED_ROLES` `:29`); queue/counts unfiltered (`reviewService.js:92-94` → `documents.getReviewQueue :177`).
  `canAccessDocument` (`accessService.js:50-90`) is enforced at `/v1` detail/pages/thumbnail (`api/handler.js:506/
  522/552`), desktop review reads (`review/handler.js:84`), print (`print/handler.js:206`), stamping
  (`stampService.js:49`), workflow (`workflow/handler.js:109/130/214`). Inert Stage-8 seam at `accessService.js:80`
  after admin (`:61`) + open-route party (`:66-68`) + deleted (`:70`), before the role grants (`:83-88`).
  `doctype_grants` (`database/index.js:1382-1391`) is keyed `role|user × document_type_id NOT NULL`.
- Roles `admin|edit|readonly` (`database/index.js:442`); no department concept anywhere in product code.
- Reusable exclusion plumbing: `documents.learning_excluded_at` (mig 90; ONE predicate `learningExcludedSql`, e.g.
  `documents.js:160`) and `documents.confirmed_via` (mig 57; trust's graduation window already excludes a machine
  `confirmed_via`, `index.js:1401-1402`). Audit helper `auth/handler.js:541 logAudit`.
- Prior art: the 08-26 expected-feature sweep REJECTED email-in, tags, retention, a print driver — endorsed
  "Send-To shortcut + drag-drop instead" (`pendingfeatures.md:972-981`). Generic design deferred tags/"My Stuff"/
  per-type filing patterns. No Oracle verdict touches departments or a non-OCR lane — clean slate.

## A. The non-OCR lane — "Quick File"
**Name:** Quick File (verb "Quick-file this"; lane id `quick_file`). "Save As, but into the right place with the right
details": no reading, no Review, no learning, a receipt every time.

**Opportunity.** Half a small office's paperwork is never scanned (the signed lease PDF, the Excel quote, the insurer's
email) — it lives in Downloads and Outlook. Scan Finder already owns the filing tree and the search box; letting those
documents into the SAME `Company/Year/Month` tree and the SAME search is the whole feature.

**Model: reuse `document_types`, add a reading mode.** `document_types.reading_mode TEXT NOT NULL DEFAULT 'read'`
(`'read'|'none'`). A `'none'` type is a plain metadata form. Reuse because the filing `{docType}` token
(`filing/handler.js:133`), the search `docType` filter (`documents.js:703-707`), export, Stage-8 grants
(`document_type_id NOT NULL`) and Part B's per-type department default all key on `document_type_id`; a parallel
category table forks every one.

Fields on a Quick File type (typed, none extracted): **Party** (the structural issuer role, label "Company / Person",
autocomplete from existing `supplier_name` values — reads, never writes a scope) · **Date** (structural, default TODAY,
visibly editable — the Generic scan-date pattern at submission) · **Title** (`field_key='title'`, default = cleaned
filename stem; already a filename token) · **Reference** (optional) · **Notes** (search-only, never a filename token)
· **Department** (Part B dropdown, default = submitter's) · Tags = v1.1 as a LIST-type field (zero schema).
Presets via `PRESET_CATALOG`: Contract / Agreement · Correspondence · Spreadsheet / Report · Filed Document.

**Submission flows.** (1) Home → "Quick File" button + drop zone (v1, L2): pick/drop 1-N → one compact form; batch
values apply to all, Title per file. Dropping a `.docx` on the ordinary Import zone routes to Quick File with a
one-line note; dropping a PDF on Quick File never OCRs (the entry point decides). (2) Quick File FOLDER (v1.1, L3, the
zero-UI differentiator): a second watched folder reusing the pure poll/stability machine (`watch/handler.js:67
classifyPoll`, exported `:603`) + overlap guard (`:31-42`); convention `<QuickFileFolder>\<Company Name>\file.docx` →
Party = sub-folder, Date = mtime, Title = stem, Type/Department = the folder's defaults; no sub-folder → `General/`.
(3) "Send to Scan Finder" (v1.1, L2): SendTo `.lnk` → `ScanFinder.exe --quickfile <paths>`; `second-instance`
(`main.js:1064`) receives; whitelist `--quickfile` in `isForbiddenArgv` (`main.js:68`); validate each path (exists,
accept-listed, size cap, not a reparse point — the SEC-17 class `processing/handler.js:2249+`). (4) LAN client
(v1.2, L3): `POST /v1/quickfile` (metadata JSON + raw body, hard cap, accept-list + magic-byte sniff, per-user rate
limit) → the same `quickFileService.submit()`; lands WITH Part B, not before.

**Where it files.** Unchanged `commitDocument`; extension preserved → `Contract.12-09-2026.Office-lease-2026.docx` under
`Acme-Ltd/2026/September/` + XML sidecar; same duplicate policy. `{department}` folder token = Part B v1.1.

**How it is found.** `documents.ocr_text` = Title + Notes + cheap born-digital text: PDF text layer via the existing
`born_digital.py:38` pypdfium2 read (never Tesseract); `.docx/.xlsx/.pptx` via stdlib `zipfile` + tag-strip; `.eml`
via stdlib `email`; `.txt/.csv/.rtf` raw; cap at the existing 50k. Zero new deps (`.msg` needs `extract_msg`, GPL —
DENIED by the licence gate → index the filename only). Existing `fullText` LIKE search (`searchService.js:52`) finds it
unchanged. Search row: file-type glyph where no thumbnail (`previewService.js:69, :201-225` renders images + PDFs
only); optional "Filed as-is" chip. Open: `ALLOWED_OPEN_EXTS` (`processing/handler.js:2230`) grows by exactly the
accept list inside the containment check (`:2232-2247`). No in-app Office preview in v1 — "Open in Word".

**Management ops.** Edit details → re-file (existing road: `existingFiledPath` `filing/handler.js:96`; `allowRefile`
`documents.js:639-640`) as a Search-row action (v1). Replace with a new version (v1.1): keep row + metadata, file the
new bytes, rename the old with the duplicate suffix + `superseded`, audit — no versions table. Move department /
re-tag (Part B v1), bulk re-file/re-tag (v1.1), retention/archive OUT (rejected 08-26).

**Composition.** NEVER enters Review: `quickFileService.submit()` = one transaction — copy to `userData/inbox` as
`working_path` (mig 17) → `commitDocument` → `documents` insert `status='confirmed'`, `confirmed_via='quick_file'`,
`learning_excluded_at=now`, `intake='quick_file'`, `ocr_text` → audit. NOT via `reviewService.confirm` (learning
hooks), NOT `_upsertTemplate` (extend the generic skip at `review/handler.js:1639` to `reading_mode='none'`), no
hints/logos/graduation (`confirmed_via` exclusion). PIN: a Quick File doc never creates a learning row of any kind
and never counts toward a supplier's auto-file graduation. Review count untouched (`getReviewQueue` reads
`needs_review|deferred`). Original file: COPY, leave the source (unlike import, which removes it —
`filing/handler.js:221-224`); "Remove original after filing" remembered checkbox (owner Q1). Routing works unchanged;
stamping is PDF-only → an Office file's stamp action refuses with a plain message. LAN client: confirmed rows appear
in client search at once; Office files = metadata + "open on the main PC" until a party-authorised `/v1 …/file`
download exists (the same endpoint Print slice 4 needs).

**File-type policy (ACCEPT list).** Accept `.pdf`, the image set, `.docx .xlsx .pptx .doc .xls .ppt .odt .ods .rtf
.txt .csv .eml .msg`. NEVER: executables/script hosts (`.exe .msi .com .scr .bat .cmd .ps1 .vbs .js .jse .wsf .hta
.jar .lnk .url`), macro-enabled Office (`.docm .xlsm .pptm`), archives (`.zip .7z .rar`), `.html/.htm`. Cap 100 MB.
Refusal = a visible message naming the file. ONE shared constant consumed by intake, the Quick File folder,
`--quickfile` argv, `/v1/quickfile` and `ALLOWED_OPEN_EXTS` — four doors, one list.

**Friction.** The competitor is Explorer's Save As. Wins only with fewer decisions: Type remembered, Date/Title
pre-filled, Party autocompleted, Department = mine; the one keystroke is Party; the folder convention removes even that.
Trust: the receipt names the filed path + "Open folder"; the doc is in Search within a second.

| Slice | Content | Level | Priority |
|---|---|---|---|
| Q1 | `reading_mode` + presets + `quickFileService.submit()` + Home button/form + drop zone + accept list + `ALLOWED_OPEN_EXTS` + learning/graduation exclusion pins + audit | L2 | v1 must |
| Q2 | Born-digital/Office text into `ocr_text` + search glyph/chip | L1-L2 | v1 must |
| Q3 | Edit details → re-file | L1 | v1 should |
| Q4 | Quick File folder (Party-sub-folder convention) | L3 | v1.1 differentiator |
| Q5 | Send-To shortcut + `--quickfile` argv | L2 | v1.1 quick win |
| Q6 | Tags as a LIST field; Replace-version; bulk re-file | L2 | v1.1 |
| Q7 | `/v1/quickfile` + `/v1 …/file` download | L3 | v1.2, with Part B |
| Out | In-app Office preview, email-in, retention, `.msg` text | — | never / much later |

**Success metric:** median submission < 15 s with ≤1 typed field (Party); >70% zero edits beyond Party; ZERO Quick
File docs ever in Review and ZERO learning rows sourced from them (pinnable from existing columns); a typed title
re-found next day in < 10 s. **Risks:** the accept list is a security surface (one constant, pinned); `open-file`
widening stays inside the containment roots; Party autocomplete never CREATES a scope; a Quick File PDF later wanted
READ needs an explicit "Read this document" action (reprocess) that clears `learning_excluded_at` deliberately.

## B. Departments
```
departments        (id, name, slug, is_default, created_at)   -- seed ONE row 'General' is_default=1
user_departments   (user_id FK CASCADE, department_id FK CASCADE, PK(user_id, department_id))
users.all_departments INTEGER DEFAULT 0                        -- the accountant flag
documents.department_id INTEGER NULL REFERENCES departments(id) ON DELETE SET NULL
document_types.default_department_id INTEGER NULL
settings: departments_enabled ('false'), quickfile_folder_department_id, watch_folder_department_id
```
**The one rule:** `NULL department = General = visible to everyone`. Byte-identical on day one, zero backfill.
**Visibility predicate:** a non-admin may see a document iff its department is NULL/General, OR the user is a member,
OR `users.all_departments=1`, OR the user is a party on an OPEN route for it. Admin always.
**Three rule types collapse to one mechanism + three taggers:** by TYPE = `document_types.default_department_id`
(every Invoice tagged Finance at insert); by TAG = the tag; both = type default + human override. Tagger precedence
at insert: explicit (Quick File form / Review dropdown) > watch/Quick-File folder department > type default > NULL.
**Compose with Stage 8 — extend the SEAM, not the TABLE:** implement in the seam body at `accessService.js:80`
(rename `doctypeGrantDecision` → `restrictionDecision`, `{deny:true, reason:'department_restricted'}`) — after admin
+ open-route party (both stay exempt), before the role grants. Do NOT store department rules in `doctype_grants`
(wrong shape); leave it inert as a possible second, orthogonal axis later. Two axes in v1 = the "why can't I see
this?" support trap (owner Q5).
**Enforcement (name every reader):** the per-doc predicate already covers detail/pages/thumbnail/print/stamp/
workflow. Departments ADD a list-side fragment `departmentVisibleSql(db, user)` (the `learningExcludedSql` pattern) in
`documents.search` (`documents.js:703`), `getReviewQueue/getDeferredQueue/getReviewCount/getDeferredCount`
(`reviewService.js:92-94` — must take the actor), Home stats (`documents.js:561`), export (`export/handler.js`), the
Quick-check grid, the Teach doc-picker (`teach/renderer.js:135`). Workflow inbox/completed are per-user already
(`workflowService.js:176-179`). Admin-only surfaces exempt by role. A pin ENUMERATES the readers — a forgotten
fragment leaks titles and amounts. Counts: `review-count-changed` is broadcast globally (`api/handler.js:186`,
`settings/handler.js:398`); desktop = one session; `/v1` counts per request — re-read memberships per request (never
in the token) so removal is immediate.
**What a restricted user sees:** restricted docs absent from search/counts (silence is right — the `not_found`
philosophy `accessService.js:59`); preview/open by id → `department_restricted`, AUDITED (the one deny worth a row).
Routing: a Finance user CAN send a Finance doc to a non-Finance approver; the recipient sees exactly that doc while the
route is open (Oracle C3 semantics), then the immutable snapshot. A "Department: Finance" chip on every row + a
dropdown (edit/admin), audited before → after.
**Setup UX:** Settings → **Users & Departments** (add/rename/delete — delete moves docs to General with a counted
confirm; per-user tick-boxes + "All departments"); Document Types editor gains "Default department"; watch folder +
Quick File folder gain a Department dropdown; master switch `departments_enabled` OFF; enabling shows: "Admins always
see everything. Documents with no department are visible to everyone. Departments restrict what Scan Finder shows —
they do not change Windows folder permissions." First-run wizard untouched.
**Admin override + audit:** admins exempt; no impersonation. Audited: department create/rename/delete (moved count),
membership add/remove, `all_departments` toggle, doc re-tag (before/after, actor), per-type default change, every
`department_restricted` deny — `logAudit` `action_category='access'`.

| Slice | Content | Level | Priority |
|---|---|---|---|
| D1 | Tables + migration (seed General, all users → General) + switch; byte-identical pin | L1 | v1 |
| D2 | `restrictionDecision` body + `departmentVisibleSql` in every reader + audit + real-invocation denial matrix (role × status × membership × transport) | L2 | v1 must |
| D3 | Taggers: Quick File form, Review dropdown, per-type default, watch/Quick-File folder department | L2 | v1 |
| D4 | Settings UI + the plain-language enable sentence | L1 | v1 |
| D5 | `{department}` folder token (NTFS can mirror the restriction) | L3 | v1.1 differentiator |
| D6 | Admin bulk "Apply type defaults to existing documents" + bulk re-tag | L2 | v1.1 |
| D7 | Multi-department docs (join table) | L2 | only if demanded |
| Out | Per-role type deny (Stage 8 rows), impersonation, per-field redaction | — | later / never |

**Risks a small business hits:** (1) locked-out boss → admins exempt + the enabler gets `all_departments`; (2) the
accountant who needs everything but not admin → `all_departments=1`; (3) shared reception PC, one login → keep the
shared user General-only; departments bite on the LAN client where logins are personal (say so in help); (4) a doc
in two departments → v1 one column, file under the MORE restrictive or General; join table = D7; (5) untagged backlog
→ D6; (6) reprocess type flip must not silently re-tag → `department_set_by='rule'|'user'`; (7) files on disk are not
gated → D5's `{department}` token + the enable sentence; (8) export leaks if the fragment is forgotten → on the reader
list; (9) deleting a department SETs NULL with a counted confirm, never cascade-deletes documents.

## C. Owner questions (recommended default in bold)
1. Quick File: **copy and leave the original** (remembered "Remove original after filing") — or move like import?
2. Model: **reuse `document_types` with `reading_mode='none'`** — or a separate category list?
3. Accept list: **include legacy Office binaries**; never macro-enabled/executables/archives/HTML; **100 MB cap**?
4. Search text: **cheap born-digital text only, never Tesseract** — or filename + typed fields only?
5. Departments v1: **one mechanism (doc tag) + per-type defaults; `doctype_grants` stays inert** — or light per-role type deny now?
6. One department per doc (**a column**) or many (join table)?
7. Routing: **an open-route recipient sees the routed doc outside their department, audited** — or refuse cross-dept routing?
8. `{department}` folder token: **v1.1, opt-in, default pattern unchanged** — or v1 with a `Finance/…` default?
9. Should the person enabling departments automatically get `all_departments`? (**yes**)

## D. Product stories
**Quick File.** Not everything arrives on paper. The signed lease from the solicitor, the quote you sent in Excel, the
insurer's email — today they live in Downloads and a mailbox nobody searches. Quick File lets you drop any of them onto
Scan Finder (or into a folder named after the company, or right-click "Send to Scan Finder"), type the company name,
press Enter. It files exactly where the scanned invoices go — `Acme Ltd / 2026 / September` — with the same readable
filename, appears in the same search box a second later, and can be sent for approval like any other document. It
never asks you to review anything, never tries to read the document, and never lets a typed name teach the scanner
something wrong. One tree, one search, every document.

**Departments.** Small businesses do not need an enterprise permissions system; they need "the bookkeeper sees
invoices, the sales desk does not, and the boss sees everything." Departments is one dropdown: put people in
departments, tell Scan Finder that Invoices belong to Finance, and every invoice is tagged automatically the moment it
arrives. Staff outside Finance never see it in search, counts, or the Review queue — on the main PC or from the search
client — unless someone in Finance explicitly sends it to them for approval. Admins always see everything, untagged
documents stay visible to everyone, and turning the feature on changes nothing until you create your second
department. Every tag and membership change is in the audit log, and an optional folder layout puts `Finance\` at the
top of the tree so Windows permissions can match what Scan Finder shows.

**Recommended order:** Q1 → Q2 → D1 → D2 → D3/D4 → Q3 → Q4 → Q5 → D5 → Q7.
