# PLAN — "Quick File" (documents that need no OCR) + Departments (who may see what) — 2026-09-12

**Status:** PLAN (barry product brainstorm + eric architecture → this synthesis → Oracle vet §9). Nothing built.
Companions: `docs/brainstorms/BARRY_2026-09-12_quickfile_departments.md` (product) ·
`docs/designs/QUICKFILE_DEPARTMENTS_ERIC_ARCH_2026-09-12.md` (architecture, every claim file:line-verified).
Owner ask: "a feature for general document management … submission and management of docs that don't require OCR …
investigate departmental roles and … a security gating system where only certain depts have access to certain docs."

## 1. Summary (read this if nothing else)
**Quick File** — drop or pick any office document (Word, Excel, email, born-digital PDF, image), type the company name,
press Enter. It files into the SAME `Company/Year/Month` tree as scanned documents, with the same readable filename,
and is searchable a second later. It never enters Review, never runs OCR, and never teaches the scanner anything.
Internally it is an ordinary confirmed `documents` row whose fields were TYPED, not read.

**Departments** — one dropdown. Put people in departments, tell Scan Finder that Invoices belong to Finance, and every
invoice is tagged Finance the moment it arrives. Staff outside Finance never see it in search, counts, the Review
queue, previews, or the LAN client — unless someone in Finance explicitly sends it to them for approval. Admins always
see everything. Untagged documents stay visible to everyone, so turning the feature on changes nothing until a second
department exists. Every tag and membership change is audited.

**Recommended order:** Q1 → Q2 → D1 → D2 (+ the assign-time route gate, same slice) → D3/D4 → Q3 → Q4 → Q5 → D5 → Q7.
Quick File first (self-contained, byte-identical OFF); Departments second because Quick File's form is where the first
tagger lives, and the LAN upload (Q7) must not exist before the department gate does.
**What does NOT change:** the OCR pipeline, the Review queue, auto-file, learning, the filing patterns, the `/v1`
contract (additive fields only). Every slice ships DARK (seed OFF, `TEST_SWITCH_KEYS`), byte-identical OFF, pinned.

## 2. Starting state (verified at the source by both advisors)
- Intake accepts only `.pdf .png .jpg .jpeg .tiff .tif .bmp` (three copies of that list: `tesseract.py:1178`,
  `processing/handler.js:1513`, `watch/handler.js:44`); a `.docx` dropped in the watch folder is silently skipped.
- No drag-drop anywhere (the preload swallows `drop` on every window BY DESIGN — audit M4/M9, `preload.js:5-15`);
  `second-instance` discards argv (`main.js:1064`); `/v1` is JSON-only (no upload).
- `filing.commitDocument` (`filing/handler.js:90-244`) is already source-agnostic: any extension, folder + filename
  from the user's patterns incl. `{title}`, output-root containment, `-DUPLICATE`, XML sidecar. Nothing in it needs OCR.
- The General Document type (built, OFF) is adjacent but still OCRs and is review-bound.
- Users carry `admin|edit|readonly`. ONE per-document read gate `accessService.canAccessDocument` (desktop IPC + `/v1`)
  with an INERT Stage-8 seam for per-doc-type grants (`doctype_grants`, mig 56). **No list or count surface consults
  it** (search, review queue/counts, bin, dashboard counts, type-ahead, dev inspector, open-by-id, the `/v1 viewing`
  heartbeat) — today that is fine (role-only visibility), but it is the whole cost of departments.
- No department concept exists anywhere; no prior Oracle verdict on either feature (clean slate).

## 3. Feature 1 — Quick File
**Model:** reuse `document_types`, add `document_types.reading_mode TEXT NOT NULL DEFAULT 'read'` (`'read'|'none'`).
A `'none'` type is a plain metadata form. Rationale: the filing `{docType}` token, the search type filter, export,
grants and the per-type department default all key on `document_type_id`; a separate "category" table forks every one.
Presets (tick-to-add, `PRESET_CATALOG`): Contract / Agreement · Correspondence · Spreadsheet / Report · Filed Document.
Fields (typed, none extracted): **Party** (the issuer role, labelled "Company / Person", autocomplete from existing
`supplier_name` values — reads only) · **Date** (default today, visibly editable) · **Title** (default = cleaned
filename stem; already a filename token) · Reference (optional) · Notes (search-only) · **Department** (Feature 2) ·
Tags (v1.1, a LIST-type field or `document_tags`).
**Submission flows:** (Q1) Home "Quick File" button → multi-select pick → one compact form (batch: shared values,
Title per file). (Q4) a second watched folder with the convention `<QuickFileFolder>\<Company>\file.docx` → Party =
sub-folder, Date = file time, Title = stem, Type/Department = the folder's defaults — the zero-UI path a bookkeeper
actually uses; needs a holding state (`status='intake'`, "Awaiting details" tray) so it is v1.1. (Q5) Explorer
"Send to Scan Finder" (`--quickfile <paths>` via `second-instance`, whitelisted in `isForbiddenArgv`, every path
validated). (Q7, v1.2) `POST /v1/quickfile` from the LAN client — lands WITH departments, never before.
Drag-drop onto Home = v1.1 and **Oracle-gated** (it changes the M4/M9 "no window accepts drops" boundary; eric's
design keeps `preventDefault` unconditional and maps files through `webUtils.getPathForFile` in the preload only).
**Storage:** one `documents` row (`status='confirmed'`, `confirmed_at`, `confirmed_by_username`, `overall_confidence
NULL`, `working_path` = inbox copy) + `extractions` rows (`extraction_method='typed'`, confidence 100) + new columns
`documents.intake ('direct'|NULL)` and `documents.intake_notes`. Date goes through `filing.normaliseDate` (the
every-door rule). **The source file is never deleted or moved** (owner Q1).
**Filing:** unchanged `commitDocument` → `Contract.12-09-2026.Office-lease-2026.docx` under `Acme-Ltd/2026/September/`
+ sidecar. **Search:** `documents.ocr_text` = title + notes + cheap born-digital text — PDF text layer via pypdfium2
(a tiny `render/pdf_text.py`, NO OCR), `.docx/.xlsx/.pptx` via a dependency-free ZIP+XML reader (`src/lib/
ooxmlText.js`, zip-bomb capped, off the main thread), `.eml` via headers + text part, `.txt/.md/.csv` verbatim;
`.msg`/legacy binaries = metadata only (`extract_msg` is GPL → licence gate refuses). Thumbnails: PDF/image as today,
office = an icon (`previewService` gets one `isRenderable` guard — today a `.docx` would come back as a broken image).
**Management:** edit details → re-file (existing `existingFiledPath` road) · replace with a new version (append-only
`document_versions`, old file renamed `.vN`) · bulk re-tag/re-file · soft-delete/restore via the existing bin.
Approval routing works unchanged; stamping is PDF-only → an office file's stamp action refuses with a plain message.
**Safety rules (pinned):** (1) never enters Review — `getReviewQueue` reads `needs_review|deferred` only; (2) never
learns — the lane never calls `reviewService.confirm` (all write-side learning lives there) AND the ONE read-side
predicate `learningExcludedSql` gains a non-switchable clause `COALESCE(d.intake,'') <> 'direct'` so all 17+ pinned
learning readers (formats, graduation window, hints, templates, name presence) ignore typed docs; (3) accept-list, not
deny-list: ONE shared `src/lib/fileKinds.js` (`OCR_EXTS`, `INTAKE_EXTS`, `OPEN_EXTS`, `NEVER_OPEN` — executables,
script hosts, `.lnk/.url`, macro-enabled Office, archives, `.html/.svg`) consumed by intake, the folder, argv, `/v1`
and `open-document-file` (four doors, one list; pin `OPEN_EXTS ∩ NEVER_OPEN = ∅`); size cap (50 MB default) checked
before any copy; paths stay in MAIN (a staging token map, the de-pathing rule).
**Slices:** Q1 `fileKinds` + `reading_mode` + presets + `directIntakeService.submit` + Home button/form + exclusion
pins (L2) · Q2 search text + glyph (L1-L2) · Q3 edit → re-file (L1) · Q4 Quick File folder (L3) · Q5 Send-To (L2) ·
Q6 tags/replace/bulk (L2) · Q7 `/v1` upload + download (L3, with D2). OUT: in-app Office preview, email-in, retention.
**Metric:** median submission < 15 s with ≤1 typed field; ZERO Quick File docs ever in Review and ZERO learning rows
sourced from them (both provable from the columns); a typed title re-found next day in < 10 s.

## 4. Feature 2 — Departments
**Model (additive, byte-identical when empty):**
```
departments        (id, name UNIQUE NOCASE, slug UNIQUE, is_active DEFAULT 1, created_at)
user_departments   (user_id FK CASCADE, department_id FK CASCADE, PK(user_id, department_id))
users.all_departments   INTEGER DEFAULT 0            -- "the accountant flag": sees everything, is not admin
documents.department_id INTEGER NULL REFERENCES departments(id) ON DELETE RESTRICT   (+ index)
document_types.default_department_id INTEGER NULL REFERENCES departments(id) ON DELETE SET NULL
settings: departments_enabled ('false'), watch_default_department_id, quickfile_folder_department_id
```
**The one rule:** `NULL department = shared = visible to everyone`. Zero backfill; every existing row is unchanged.
**Visibility:** a non-admin may see a document iff its department is NULL, OR they are a member of it, OR
`all_departments=1`, OR they are a party on an OPEN route for it. Admin always.
**Taggers (precedence at insert):** explicit (Quick File form / Review dropdown) > watch-folder or Quick-File-folder
default > doc-type default > NULL. Re-applied at confirm ONLY if still NULL (a human tag is never overridden).
**Enforcement — two places, one compiled object:**
1. Per-document: two lines in `canAccessDocument`, AFTER admin + open-route party + deleted, BEFORE the role grants:
   `departmentTagDecision → deny 'department_restricted'`, then the existing Stage-8 seam (type deny). Both read
   `compileRestrictions(db, user) → {unrestricted, deptIds, deniedTypeIds}`, memoised per REQUEST (membership is live).
2. Lists/counts: `accessService.visibleDocSql(db, user)` — ONE SQL fragment (returns `''` when the gate is off, the
   actor is admin, or `departments` is empty — the `learningExcludedSql` pattern) appended in: `documents.search`,
   review/deferred queues + counts (which must now take the actor), the bin, dashboard counts, type-ahead suggestions,
   export facets; the dev inspector becomes admin-only when departments exist; `open-document-file`/`show-in-explorer`
   and the `/v1 viewing` heartbeat gain the per-doc gate. The 9 global `review-count-changed` broadcasters collapse to
   one per-viewer `notifyCounts`. **Consistency pin:** for every doc, `canAccessDocument(u,id).allow === (id ∈
   search(u)) || isOpenRouteParty(u,id)`. The `/v1` DTO gains `department_id`/`department_name` (additive).
**Routing ruling:** an open-route party stays exempt (an explicit, audited grant by a sender who could see the doc) —
BUT assignment is gated at ASSIGN time: `workflowService._validateAssignTarget` / `assignSystem` refuse a recipient
for whom `canAccessDocument` is false (`RECIPIENT_NO_ACCESS`), INCLUDING system routes (`amountRouting` picks
recipients by role and would otherwise leak a restricted doc to any edit user). Lands in the SAME slice as the read
gate. A member removed mid-route keeps visibility until the route closes (documented, audited; auto-close = v2).
**Write side:** `departmentService.setDocumentDepartment` — role → `canAccessDocument` → `editGuard` → widening rule
→ write → audit. **Widening (to NULL, or to a department the actor is not in) = admin only**; narrowing within own
departments = edit; readonly never. The confirm/filing path gets ONE guarded statement (dead with an empty table →
corpus M=0 byte-identical). Deleting a department with documents is REFUSED (fail-closed — `SET NULL` would silently
un-restrict them); admins retire it (`is_active=0`, still restricts) or bulk-move first (D6).
**Filing-folder reality (say it to the customer):** the output tree is a plain Windows folder and the `.metadata/*.xml`
sidecar holds every field value; anyone with share/NTFS read sees everything. App gating governs the app, the API and
the client. The honest fix is D5: a `{department}` folder token so IT can put `Finance\` and `HR\` under NTFS ACLs. A
setting to omit the sidecar for tagged docs is worth offering. Per-department output ROOTS: refused (three one-root
seams). The DB-at-rest encryption arc (DARK) protects the DB, not the files.
**Sessions:** membership is looked up per request, never baked into the `/v1` token → a removal is effective on the
next request, no contract bump, no forced logout. `can_stamp` is orthogonal (already behind the per-doc gate).
**Setup UX:** Settings → **Users & Departments** (add/rename/retire; per-user tick-boxes + "All departments");
Document Types editor gains "Default department"; watch folder + Quick File folder gain a Department dropdown; a
"Department" chip + dropdown on every Search/Review row (edit/admin, audited before→after). Master switch
`departments_enabled` (OFF) gates the UI + write side only; the READ gate keys off DATA, so a tagged doc is restricted
regardless (fail-closed). Enabling shows one sentence: "Admins always see everything. Documents with no department
are visible to everyone. Departments restrict what Scan Finder shows — they do not change Windows folder permissions."
The person enabling it gets `all_departments` by default (owner Q9). First-run wizard untouched.
**Threat cases → pins:** id-walk of pages/thumbs/detail across departments (desktop + `/v1`) → denied, no body ·
counts change by ZERO for an outsider · route to an outsider → `RECIPIENT_NO_ACCESS` (human + system) · admin is the
ONLY bypass; an edit user in no department sees only untagged docs · membership removed mid-session → next request
denied · export stays admin-only + carries the fragment · deleting a department with docs → refused ·
`ACCESS_GATE_ENABLED=0` on a packaged build → ignored (§6) · type-ahead excludes restricted docs · presence heartbeat
on a restricted id → denied.
**Slices:** D1 tables + migration (seed nothing; `NULL` = shared) + switch + byte-identical pin (L1) · D2 read gate +
the SQL fragment in EVERY reader + assign-time route gate + audit + the denial matrix (role × status × membership ×
transport) (L2-L3, the load-bearing slice) · D3 taggers (L2) · D4 Settings UI + the enable sentence (L1) · D5
`{department}` folder token + optional no-sidecar (L3) · D6 bulk "apply type defaults" / bulk re-tag (L2) · D7
department×type deny via `doctype_grants.department_id` and/or multi-department docs — only if asked. OUT:
impersonation, per-field redaction, per-department output roots.
**Risks a small business hits (and the answer):** locked-out boss (admins exempt + enabler gets `all_departments`) ·
the accountant who needs everything (`all_departments`, not admin) · shared reception PC with one login (keep it
untagged-only; departments bite on the LAN client where logins are personal — say so in Help) · a doc in two
departments (v1 one column: file under the more restrictive or leave shared; join table = D7) · "why can the new
starter see last year's invoices?" (D6 bulk apply) · reprocess type flip must not silently re-tag
(`department_set_by='rule'|'user'`).

## 5. Rulings where the two advisors differed
1. **Delete a department:** eric's `ON DELETE RESTRICT` + retire wins over barry's `SET NULL`+counted confirm —
   un-restricting on delete is fail-open. Bulk-move first (D6) is the admin's road.
2. **Where dept×type rules live:** barry "tag only, leave `doctype_grants` inert" for v1; eric's `department_id`
   subject column on `doctype_grants` is the RESERVED shape for a later D7. v1 = tag + per-type default only (one
   mechanism = one "why can't I see this?" answer).
3. **Marking a typed doc:** eric's `documents.intake='direct'` + a NON-switchable `learningExcludedSql` clause wins over
   barry's `confirmed_via='quick_file'` (`confirmed_via` is counted as auto-filed on the dashboard and its exclusion is
   soft/switchable). `confirmed_via` stays NULL (a human filed it).
4. **Drag-drop:** barry v1, eric Oracle-gated — it is a change to a security boundary the audit closed on purpose.
   v1 = the pick dialog; drag-drop = v1.1 with its own Oracle pass.
5. **Naming:** user-facing "Quick File"; internal `direct_intake` / `intake='direct'` / `directIntakeService`.

## 6. Security findings surfaced by this investigation (pre-existing; fix regardless of the features)
- **`ACCESS_GATE_ENABLED` has no `isPackaged` guard** (`accessService.js:37-41`): on a customer machine an env var
  turns the document read gate OFF. Fix: honour the env var only when `!app.isPackaged`, exactly like `_realCanonical`
  (`processing/handler.js:2286-2294`). Small, pin-able, ship first (prerequisite for D2).
- `open-document-file` / `show-document-in-explorer` (`processing/handler.js:2735-2755`) check role + containment but
  not the per-doc gate — an `edit` user can open any filed doc by id. Harmless today (role-only visibility); load-bearing
  once departments exist. Part of D2.
- `/v1 review/:id/viewing` (`api/handler.js:918-925`) returns other viewers' names for ANY id (writer-only). Part of D2.
- The XML sidecar duplicates every field value in plaintext beside the file (D5's optional no-sidecar setting).

## 7. Build order, gates, conventions
Each slice: own setting seeded OFF (mig), listed in `TEST_SWITCH_KEYS`, byte-identical OFF (pinned), advisor + Oracle
gate before build, `npm run test:pins` green, the corpus M=0 run for anything that touches the confirm/filing path.
Migration numbers: 162 = today's deskew arc; departments = 163; intake = 164 (+ later tags/versions). Sequence:
§6 fix → Q1 → Q2 → D1 → D2 (+ route gate) → D3/D4 → Q3 → Q4 → Q5 → D5 → Q7. Chris (customer vet, sandboxed) after Q1
and after D4. Help pages for both features (the User Guide has a 153-key check).

## 8. Owner questions (recommended default in bold)
1. Quick File: **copy and leave the original where it is** (remembered "Remove original after filing" checkbox) — or move?
2. Model: **reuse `document_types` with `reading_mode='none'`** — or a separate category list?
3. Accept list: **include legacy Office binaries (`.doc/.xls/.ppt`)**; never macro-enabled/executables/archives/HTML; **50 MB cap** (eric) vs 100 MB (barry)?
4. Search text for Quick File PDFs/Office files: **cheap born-digital text only, never Tesseract** — or typed fields only?
5. Departments v1: **one mechanism (the tag + per-type default); `doctype_grants` stays inert** — or light the dept×type deny now?
6. One department per document (**a column**) or many (join table)?
7. Routing: **an open-route recipient sees the routed doc outside their department, audited; assignment to an outsider is refused unless the sender is admin?** — or refuse cross-department routing entirely? (eric: gate at assign time, no exception; barry: allow the boss. Recommend: assign-time gate, with `all_departments` for the approver who needs everything.)
8. `{department}` folder token: **v1.1, opt-in, default pattern unchanged** — or v1 with a `Finance/…` default?
9. Should the person enabling departments automatically get `all_departments`? (**yes**)
10. Omit the XML sidecar for department-tagged documents (a setting)? (**offer it, default on = keep today's behaviour**)

## 9. Oracle — SIGN OFF WITH CONDITIONS on BOTH features (full blocks in `docs/oracle_log.md` 2026-09-12)
**Quick File — Q-C1…Q-C12.** The shape is right and the cheapest. NOT yet safe as written: the read-side helper
(`learningExcludedSql`) reaches every learning reader, but FOUR existing write-side doors take a confirmed row into
Review/learning without the lane's consent and none knows `intake`: `documents.deconfirmDocument` (Put back /
Learning Repair send-back / class-fix undo), the Learning Repair console listing (negatively pinned to ignore the
predicate), "Edit in Review" (`confirm(allowRefile)` → hints/corrections/template hooks), and `reprocess-document` /
`requeueConfirmedDocsForScope` (a `.docx` silently skipped by Python, a Quick-Filed PDF OCR'd and confirmed as a
human read). Exact failure: admin sends a typed contract back from Learning Repair → Review renders no pages →
Confirm → learning rows for a document nobody read — and the "never learns" metric still reads zero because it
counts docs. Plus: the realdoc harness selects GT by raw `status='confirmed'` (a typed PDF would be scored against
the OCR pipeline → manufactured M); `working_path` must be NULLed after filing (else `reconcileHolding` deletes the
inbox copy at next start and every preview breaks); the `previewService` guard must sit BEFORE `readFileSync` (a
50 MB `.xlsx` = 67 MB over IPC per click); `'none'` presets must ship no `title_aliases` and be excluded from
`detect_document_type` (else a scanned page headed "AGREEMENT" types as a form-only type); the auto-filed
dashboard denominator counts typed docs; `--quickfile` argv must refuse with no session; legacy Office binaries CAN
carry VBA (the honest control is "never executes — hands to the OS like Explorer" + a pinned MOTW check).
Fail-toward-review is INVERTED for a typed row: the safe state is REFUSAL with a sentence, never a queue entry.
Conditions Q-C1 (non-switchable helper clause + updated exact-text pins) · Q-C2 (a WRITE-side refusal family,
source-contract-pinned) · Q-C3 (the only road to OCR = an explicit audited "Read this document" that clears
`intake` first) · Q-C4 (the harness + every GT script exclude `intake='direct'`) · Q-C5 (NULL `working_path` +
unlink) · Q-C6 (renderable guard before any read) · Q-C7 (Party autocomplete = a dedicated non-learning reader) ·
Q-C8 (`'none'` presets never detect) · Q-C9 (denominator) · Q-C10 (session + `_realCanonical` + regular-file +
not-under-userData/output + allowlist + size before any copy) · Q-C11 (pin MOTW or drop the claim) · Q-C12
(drag-drop v1.1, own Oracle pass, preload byte-identical elsewhere).
**Departments — D-C1…D-C12.** The smallest sound model; no lower layer exists. Three seams missed: (1) an
assign-time gate via the FULL `canAccessDocument(recipient)` REGRESSES today's routing (readonly users are
routable; `needs_review` docs are routable; evaluated before the route exists it returns `readonly_unconfirmed`)
— the gate must evaluate the DEPARTMENT decision only; (2) insert-time tagging by the DETECTED type + "re-apply
only if NULL" files a mis-detected doc under the wrong department silently — needs `documents.department_set_by
('rule'|'user')` with confirm re-deriving from the confirmed type when `'rule'`; (3) backup/restore carries
`default_department_id` + the folder-default settings as raw ids → a restore can tag docs to a FOREIGN department
(remap by slug, NULL on absence). Four missed readers: `getByIds` (activity strip, auto-filed tile, quick-check
grid), `getConfirmedDocsByIds`, Learning History's `getDocumentsForFieldValue`, the autocomplete. The consistency
pin as written fails today on the bin (state the bin's role rule). "Byte-identical when empty" is TRUE for the
data-gated parts and FALSE for the 9→1 count-broadcast refactor + the helper text change → own pins. CX: the
IMPORTING user whose batch vanishes (type default tags it to another department) and the disabled-switch ghost
restriction — fixed by TELLING. `ACCESS_GATE_ENABLED` (F1) is LOW severity today (whoever sets the env var owns
the DB + tree; nil from the LAN client) but a P1 PRECONDITION for D2 — one line, existing pattern, existing pin.
Conditions D-C1 (dept-decision-only assign gate; pin readonly FYI routing still works) · D-C2 (`department_set_by`)
· D-C3 (backup remap by slug) · D-C4 (the four readers) · D-C5 (named-surface consistency pin + a mutation run
proving it fails when one fragment is deleted) · D-C6 (`gateEnabled()` ignores the env var when packaged — ship
NOW as its own commit) · D-C7 (import summary + Review CTA say "N filed to <Department> (not visible to you)") ·
D-C8 (switch OFF with tagged docs refused with the count, or a persistent banner) · D-C9 (create-time rule: an
edit user tags only a department they belong to; shared-at-create = admin/`all_departments`) · D-C10 (system-route
refusal surfaced in the routing dry-run) · D-C11 (the count-broadcast collapse = its own commit + pin) · D-C12
(delete refused while referenced; a retired department still restricts).
**Order ruling:** agrees with §7 with two amendments — D-C6 ships NOW as a standalone commit; D1+D2 (+ the assign
gate + `department_set_by` + both pins) are ONE slice (a column with no enforcer is a trap). Q7 after D2, own
Oracle pass (the first body-bearing WRITE endpoint on `/v1`). **Refuse outright (added):** the no-sidecar setting
(Q10 — DO NOTHING; the sidecar sits beside the file it describes) and any auto-close of routes on membership
change in v1. **Owner Q&A:** Q1 yes, and NO "remove original" checkbox in v1 · Q2 yes + Q-C8 · Q3 yes, 50 MB as a
setting · Q4 yes, cap pages (50) too · Q5 yes · Q6 yes · Q7 department-decision-only gate; `edit` senders refused
to outsiders; an ADMIN sender may route to an outsider (audited, open-route visibility only); system routes
refused + surfaced · Q8 yes, v1.1 opt-in, new filings only · Q9 yes · Q10 do nothing.
