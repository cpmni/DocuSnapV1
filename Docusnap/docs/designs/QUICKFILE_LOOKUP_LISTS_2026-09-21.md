# Quick File — Records Lists (auto-fill lookup) + OCR/Quick lane crossover — DESIGN

> Owner ask (2026-09-21): the Quick File lane needs its own doc-type management, and because its
> fields don't self-populate, a way to stop re-typing the same subject details. Concrete trigger
> (one example, NOT the scope): a daycare files handwritten docs and re-types each child's name +
> DOB / medical / address every time. **Owner directive: design this to benefit ALL businesses, not
> just childcare.** Owner decisions: **Fork A** (full structured custom fields) + Settings placement
> = **a Scanned / Quick File split inside the existing Document Types tab**.
>
> Advisors consulted (all reports on file this session): **barry** (product), **gary** (data model /
> migration / test), **reggie** (matching + import validation), **eric** (Electron / import / wiring).
> Next gate: **Oracle** (vet the seam), then staged build.

---

## The general pattern (why this is a broad feature, not a childcare hack)
Most small/medium businesses repeatedly file documents ABOUT a recurring SUBJECT they already hold on
paper as a register / index card / spreadsheet:

| Business | Records list | Master field | Attribute fields |
|---|---|---|---|
| Childcare / school | Children | Child name | DOB, guardian, allergies, medical, address |
| Landlord / letting | Tenancies | Address or tenant | Tenant, rent, deposit ref, start date |
| Garage / fleet | Vehicles | Registration | Make/model, owner, MOT due |
| Clinic / vet | Patients | Patient name | DOB/species, NHS/chip no, GP |
| Trades / services | Customers | Customer name | Site address, account no, contact |
| Any employer | Staff | Employee name | Payroll no, start date, department |
| Asset-heavy | Assets / equipment | Asset tag | Serial, location, warranty |

The mechanism is identical for all of them: **prep a list once (type it or import CSV/XLSX) → at filing
time type 3 characters of the subject → pick the record → the document's fields fill.** The Quick File
lane is the one place the app's "minimal interaction" north star is under threat (no OCR to
self-populate), so this is the single biggest typing-killer available there. It also upgrades ScanFinder
from "a filer" into a lightweight records system for any org that files by subject.

User-facing name: a **Records list** (generic; "list" alone reads as a dropdown, "Records" generalises
past people). Each list has a **key field** (the master), **attribute columns**, and **entries** (one
per subject).

---

## Verified facts the design rests on (cited; from the advisor pass)
- `document_types.reading_mode TEXT NOT NULL DEFAULT 'read'` (mig 165, `database/index.js:3382-3401`) is
  the SOLE detection gate: `process_docs.py:1140-1141` builds `known_type_names` from types with
  `reading_mode != 'none'`. `'none'` types are excluded from detection + heading re-read (Q-C8).
- Quick File picker filters `reading_mode==='none'` today (`src/modules/directIntake/handler.js:122-124`)
  — so "in the picker" and "excluded from detection" are currently the negation of each other. That is
  the coupling the crossover must break.
- `reading_mode` / `quick_file` are NOT in `updateType.allowed` (`document_types.js:387-388`) — a type's
  lane is frozen at creation today. Presets set `reading_mode='none'` (`:866-867`); `quick_file` is a
  JS catalog property only, not a column.
- Non-learning is structural: `machine_vias.learningExcludedSql` appends `AND COALESCE(intake,'')<>'direct'`
  UNCONDITIONALLY (`machine_vias.js:85-91`, Q-C1). `directIntakeService.submit` writes `intake='direct'`,
  extractions `method='typed'` conf 100, never calls `reviewService.confirm`/`isAutoFileEligible`.
- **The prerequisite gap (all four advisors):** the Quick File PANE renders only fixed metadata
  `{party,date,title,reference,notes}` (`quickfileView.js:249-256`) and `submit` persists only 4 roles
  (`directIntakeService.js:150-153`). Per-type custom fields are neither rendered nor stored. **Fork A
  builds this first (Slice 0).**
- `direct_intake_enabled` is GA / default-ON (mig 171). So the new subsystem gets its OWN dark flag —
  it must not ride the now-live lane's flag.
- **The XLSX reader already exists in-tree + pinned:** `src/lib/ooxmlGrid.js extractGrid(buf)` (reuses
  `ooxmlText.js` unzip; reads cached `<v>` + sharedStrings, never evaluates formulas; `.xlsm` is
  `NEVER_OPEN`; per-entry inflate cap 8 MB + `MAX_TOTAL_CELLS`; pin `test_ooxml_grid.js`). Caps are
  PREVIEW-tuned (200 rows) — a higher-cap read is needed for commit. **No new dependency for XLSX.**
- Reusable primitives: `date_parse.normaliseDate` (every-door date rule, UK DD-MM, real-calendar),
  `text_normalise.normaliseForTokens`, `name_proximity.foldIdentity`/`similarIdentity`, the served
  `validation_patterns` (`get-validation-patterns`), the MAIN-side staged-token / de-pathing pattern,
  the hidden-tab pattern (Workflow tab), the generic Settings `data-tab`→`panel-<slug>` handler.
- No lookup/reference tables or prior art exist (grep = 0). Genuinely greenfield; no Oracle verdict or
  pinned trade-off to contradict. Migrations at **195**; new migs 196+.

---

## Design

### A. Lane crossover — decouple with ONE additive column (keep reading_mode as the sole detection gate)
- **mig 196:** `ALTER TABLE document_types ADD COLUMN quick_file INTEGER NOT NULL DEFAULT 0`, then
  `UPDATE document_types SET quick_file=1 WHERE reading_mode='none'`. Byte-identical picker set
  post-migration; the OCR importer is byte-identical (detection reads only `reading_mode`).
- Two independent axes: `reading_mode` (read|none) = OCR detection; `quick_file` (0|1) = offered in the
  Quick File picker. `read+quick_file=1` = a **crossover** type usable in both lanes.
- **Invariant (enforced in `updateType`):** `reading_mode='none' ⇒ quick_file=1` (a no-OCR type must be
  reachable somewhere); setting `reading_mode='none'` auto-sets `quick_file=1`.
- **One filter change:** `direct-intake-doctypes` filters installed types by `quick_file=1` (fallback
  `reading_mode==='none' OR quick_file=1` tolerates a pre-mig fixture). `known_type_names` UNCHANGED —
  `quick_file` must NEVER feed detection.
- Add `reading_mode` + `quick_file` to `updateType.allowed` (guarded by the invariant) so the Settings
  UI can toggle a type's lane. `addPresetTypes` sets `quick_file=1` beside its `reading_mode='none'`.
- **Settings (owner's choice — split inside Document Types):** the Document Types tab gains a
  Scanned / Quick File segmented view over the SAME type list + CRUD (`add-field`/`update-field`/
  `create-doc-type-with-fields` unchanged). A crossover type appears under both. A per-type "also allow
  Quick File" toggle sets `quick_file`.

### B. Slice 0 (Fork A prerequisite) — custom fields on Quick File types, end-to-end
- Quick File types carry real `fields` (reuse the existing field types incl. **choice/dropdown** and
  **long-text** — both matter broadly: room/allergy/department dropdowns, medical/notes long text).
- The Quick File **pane renders the selected type's fields dynamically** (below the fixed
  Company/Date/Title/Reference/Notes), CSP-safe (createElement/textContent only).
- **`directIntakeService.submit` persists every provided field** as a typed extraction (`method='typed'`
  conf 100), same road as the 4 it stores now. No `documents` schema change — extra fields live in
  `extractions` exactly like the existing typed roles. `update` mirrors it.
- Byte-identical for types with NO custom fields (the four presets today).

### C. Records lists — data model (3 DARK tables, mig 197)
```
lookup_lists ( id PK, name UNIQUE, master_key, columns_json,      -- [{key,label,type,is_master,sort}]
               upsert_key_json, created_at, updated_at )
lookup_records ( id PK,                                            -- SURROGATE id; master_value NOT unique
                 list_id FK->lookup_lists ON DELETE CASCADE,
                 master_value,                                     -- denormalised master column, indexed
                 values_json,                                      -- {columnKey: value} for non-master cols
                 disambiguator, source, updated_at )
lookup_field_maps ( id PK, document_type_id FK, list_id FK, field_key, column_key,
                    is_trigger, UNIQUE(document_type_id, field_key) )
CREATE INDEX idx_lookup_records_master ON lookup_records(list_id, master_value COLLATE NOCASE);
```
- **Surrogate `id` is the identity, `master_value` carries NO unique constraint** → two identical names
  are two rows; selection returns a specific id → that row fills. Nothing can merge (the John-Doe safety).
- One list per doc type for v1 — enforce IN JS (all field-maps for a type reference one `list_id`).
  NOT `UNIQUE(document_type_id)` on `lookup_field_maps` (that table is one row PER mapped field; its
  UNIQUE is `(document_type_id, field_key)`). [Oracle C6]
- Empty tables = byte-identical to absent. Go-forward-only. Behind the new flag (below).
- **Never touches learning:** these tables only PREFILL a form before submit; the prefilled values land
  on an `intake='direct'` row already excluded from every learning reader. (Seam named in E.)

### D. Typeahead + fill (the payoff)
- **Match rule (reggie): token-prefix AND-match** — every query token must prefix a distinct record
  token. "doe"→John **Doe**; "jo do"→**Jo**hn **Do**e; NOT substring ("ann" must not flood with
  Susanna/Joanna). Normalisation: NFKC + diacritic strip + apostrophe/dot join + hyphen split + lower —
  one shared `src/lib/nameLookup.js` (`nameMatchTokens`, `nameMatches`, `rankMatches`), reused by the
  typeahead AND the import dedupe so they can't drift.
- **Reader location (eric + gary): MAIN-side over IPC.** Records live in SQLite (single source, no
  staleness). **Reconciliation of gary's SQL-prefix vs reggie's token-prefix:** the main-side reader
  loads the list's records into a per-list in-memory cache (invalidated on import/edit) and applies
  `nameMatches` in JS — sub-ms for the few-thousand-row lists this targets; for a list near the 50k cap,
  fall back to the indexed SQL prefix (`master_value LIKE ? ESCAPE '\' COLLATE NOCASE`, LIKE-escaped so a
  typed `%` can't dump the list) as a coarse prefilter then refine in JS. Min 3 chars enforced main-side.
- **Ranking (reggie):** recently-used (before typing) → exact → whole-key prefix → front-anchored
  token-prefix → any-order token-prefix. Cap the dropdown at 8 with a non-silent "+N more — keep typing".
- **Disambiguation:** when ≥2 match, each row shows a configured secondary line (the list's
  `disambiguator`, default a date column e.g. DOB) so two John Does are separable; the pick returns an id.
- **Fill rule (barry — friction trap):** fill all mapped fields, HIGHLIGHT what filled, leave everything
  editable; anything the user already typed WINS (offer, don't overrule). No match → "File anyway with
  what you typed" + "Add '<typed>' as a new record" (inline capture, fills now + offers to save).
- **Roles:** editing the list/type schema is admin (Settings). Adding/importing records + add-new-on-the-fly
  is everyday work → reachable by **edit** role, not admin-only.

### E. CSV / XLSX import
- **Parse in MAIN, always** (renderer is sandboxed / no fs / de-pathing; `connect-src 'self'`).
- **No new dependency:** XLSX via `ooxmlGrid` (`extractGrid` for the header + ~50-row PREVIEW; a
  higher-cap read reusing `parseSharedStrings`/`parseSheet` with `opts.maxRows` for COMMIT). CSV = a small
  RFC-4180 parser in MAIN (quoted fields, embedded comma/newline, CRLF, strip UTF-8 BOM; row 1 = headers;
  warned CP1252 fallback; EU semicolon-delimiter detection).
- **Distinct importer** (a `_stagedImports` token map, separate from directIntake's `_staged` — the import
  file is parsed then DISCARDED, never filed), reusing `validateIntakePath` (canonicalise / real-file /
  not-inside-app / size) narrowed to `{.csv,.xlsx}`.
- **Query/parse logic in a service** (`src/services/lookupService.js`) so a future `/v1` lane reuses it.
- **Flow:** pick → validate → parse headers + sample → **column-map** (fuzzy header→field guess, user
  adjusts; pick the key column; unmapped columns dropped with notice) → **preview grid** (flags blank
  keys, duplicate keys, unparseable dates, and shows the INTERPRETED DD-MM-YYYY so a US-order misread is
  visible) → **dedupe policy** → commit. Remember the mapping per (type + header-set) for one-click
  re-import.
- **Dedupe (reggie — safety-critical):** update only on a composite `upsert_key_json` (folded master +
  a disambiguator, e.g. name + DOB). No disambiguator configured → INSERT-all + report "N rows match an
  existing name — review". **Never merge on the name alone.**
- **Dates:** any column mapped to a `type='date'` field → `normaliseDate`; unparseable → row flagged
  (import with date blank + in a "needs attention" list) — never store an unparsed date (keeps the
  every-door date rule intact upstream of submit).
- **Free-text columns:** edge-trim only (preserve internal line breaks in address/notes), finite length cap.
- **Caps / DoS:** file-size cap (`qf_lookup_max_mb` ~10 MB), ≤50k rows/list, ~300 chars/cell; enforce on
  staged file size + a streamed row count BEFORE full materialisation; zip-bomb guard on inflate (already
  in ooxmlGrid); no formula evaluation; no XXE.
- **Transactional:** parse + validate the WHOLE file into memory (bounded by caps) → apply in ONE
  `db.transaction` → any throw rolls back → **list unchanged**. Return `{inserted, updated, skipped,
  errors[]}`. Dry-run preview mirrors the backup preview/apply pattern.
- **XLSX serial dates:** an XLSX date cell may be an Excel serial number, not a string — convert via the
  epoch, never string-parse "43922".

### F. Flag + wiring (DARK / byte-identical OFF)
- **New dark flag `lookup_lists_enabled`** (seeded `'false'`; register in `database/dark_switches.js`
  FEATURE_MASTER_SWITCHES + WRITERS + TEST_SWITCH_KEYS, mirroring `departments_enabled`; the admin
  Settings toggle is the one writer, tagged `// @FEATURE_MASTER_WRITE`). Crossover (A) + Slice 0 (B)
  are their own smaller gates; the lookup subsystem (C/D/E) rides this flag.
- Every new IPC `requireRole('admin','edit')` + refuses `{ok:false,error:'disabled'}` when off.
- The Settings toggle MUST be added to `test_settings_wiring.js` VISIBLE_ALLOWLIST (else the leaked-toggle
  pin reds — the single easiest miss, per eric). Div-balance + addressed-ids guards honoured.
- All imported / user data rendered with `textContent`/`createElement`, **never `innerHTML`** (the import
  preview is fully attacker-influenced).

---

## Seams named (relies on ↑ / weakens ↓)
- **RELIES ON:** (a) `learningExcludedSql`'s non-switchable `intake='direct'` clause — the whole lookup
  path is safe ONLY because it terminates in a direct-intake typed row; (b) `reading_mode` remaining the
  SOLE input to `known_type_names` — `quick_file` must never be consulted by detection; (c) Slice 0
  (custom-field capture) landing before lookups have a fill target; (d) caps enforced BEFORE
  materialisation so a sync main-thread parse can't jank the UI.
- **WEAKENS / must re-check:** decoupling the picker from `reading_mode==='none'` removes the implicit
  "in picker ⇒ excluded from detection." Nothing SAFETY-critical depended on that (safety is
  `reading_mode`), but **the /v1 Quick File type-list surface MUST use the same `quick_file=1` filter** or
  a LAN client could pick a type not intended for Quick File. HYPOTHESIS — verify the /v1 intake type-list
  before the flag flip. Fork A changes what Quick File persists → re-verify search/filing for
  custom-field-less types.
- **Does NOT touch** auto-file / extraction / `trust.js` — lookup only prefills a typed form; Quick File
  bypasses `isAutoFileEligible` entirely.

## Invariants / PINs
- **PIN 1 — learning-leak** (extend `test_learning_excluded_readers.js`): (a) source-contract — the
  `lookup`/`lookupService` readers reference no learning table / `getFieldFormats`/`getFieldValueSuggestions`;
  (b) behavioural — prefill from a record, submit, assert learning readers return nothing sourced from that
  doc and `scopeTrust` count is unchanged (prefilling never alters the `intake='direct'` marker).
- **PIN 2 — detection-exclusion** (mirror Q-C8): build the candidate list as `process_docs` does
  (`reading_mode != 'none'`) over a fixture with a `none+quick_file=1` AND a `read+quick_file=1` type;
  assert the `none` type is excluded from `known_type_names` regardless of `quick_file`, the `read` type
  included. Add the Python-side assertion if a Q-C8 pytest exists (the real gate).
- **PIN 3 — accepted trade-off:** the reader is token-PREFIX (a mid-string/substring match does NOT
  appear) — a future dev can't silently "fix" it to a contains match.
- **Corpus:** run `realdoc_regression.js` once with migs 196/197 applied + `lookup_lists_enabled` OFF and
  require byte-identical vs base (proves additive column + picker-filter change are inert to OCR).

## Staging (each still passes the Oracle gate confirmed below, then builds)
- **S0** Custom fields on Quick File types, end-to-end (pane render + submit persist). Fork A prerequisite.
- **S1** mig 196 `quick_file` column + `updateType` lanes editable + picker filter switch + the
  Scanned/Quick-File split in Document Types + PIN 2.
- **S2** mig 197 lookup tables + `lookup_lists_enabled` flag OFF + list CRUD + field-map UI + the
  Settings lookup section (hidden-until-flag; VISIBLE_ALLOWLIST) + PIN 1.
- **S3** CSV + XLSX import (preview / column-map / dedupe / date-normalise / caps / transactional).
- **S4** typeahead (`nameLookup.js`) + click-to-fill + add-new-on-the-fly + PIN 3.
- **S5 (owner)** flip `lookup_lists_enabled` after the gates (+ verify the /v1 type-list seam first).

## PII note (surfaced, not blocking)
Records will hold sensitive data for many businesses (medical, addresses, payroll) in a plaintext SQLite
DB by default. The DB-at-rest encryption arc is built but unmigrated. Recommend enabling encryption for
customers storing sensitive records; consider a Departments visibility gate on record data; warn on CSV
export of a records list. A trust feature and a sales point ("your data is encrypted and never leaves
this PC"), not a childcare-only concern.

## Oracle verdict — SIGN OFF WITH CONDITIONS (2026-09-21)
Premise sound; both safety seams (learning-exclusion + detection) verified structural + already pinned;
staging right (S0 is a genuine independently-valuable prerequisite). Does NOT touch auto-file/trust/
extraction. Fold C1–C8 in; gate the flip as below. Oracle's fork rulings on the four open questions:
Q3 /v1 seam = **code now in S1, not verify-before-flip** (it's `api/handler.js:1103`, a known location);
Q1 typeahead SQL fallback = **WRONG, drop/fix** (silently degrades token-prefix → first-word-only);
Q2 one-list-per-type = **OK for v1** but enforce in JS (C6); Q4 Fork-A-via-extractions = **confirmed inert**.

Two doc errors Oracle caught (corrected above): flag lives at `database/dark_switches.js`; one-list is
NOT `UNIQUE(document_type_id)`. Also: a SECOND detection consumer exists — `keyword.py:906` also keys
`reading_mode != 'none'` (the title-signal/segmentation path) — so PIN 2 must assert Python-side too.
Release-disarm note: `lookup_lists_enabled` in TEST_SWITCH_KEYS force-disarms OFF on a hardened RELEASE
build's first launch of an armed TEST DB (safe for a not-yet-GA feature; don't chase it later).

### Conditions (build holds to these)
- **C1 (S1, code now):** flip `api/handler.js:1103` to the same `quick_file=1` filter (+ pre-mig
  fallback) in the SAME slice as the desktop picker; add a desktop↔/v1 filter-parity assertion.
- **C2 (S1):** enforce `reading_mode='none' ⇒ quick_file=1` on BOTH the `reading_mode` write AND the
  `quick_file` write in `updateType` (reject/auto-repair `quick_file=0` on a `none` type); pin the orphan.
- **C3 (S4):** do NOT ship the `master_value LIKE` fallback (it anchors first-token-only). Prefer (a) a
  normalised-token column/index (or FTS) so token-prefix holds at any size; else (b) cap the per-list size
  to what the in-memory JS path serves + drop the SQL fallback; a retained SQL prefilter must be
  token-aware. PIN 3 must RED if a first-token-only prefilter ships.
- **C4 (S3):** the commit-path XLSX reader is real work — `parseSheet` is NOT exported and caps are
  module consts. Either refactor `ooxmlGrid` to take an injectable caps object (200-row preview default
  unchanged; `test_ooxml_grid.js` stays green) OR a separate bounded parser in `lookupService`. Keep the
  zip-bomb/inflate caps.
- **C5 (S3):** read `workbookPr@date1904`; convert serials via the correct epoch (handle the 1900 leap
  bug); interpreted DD-MM-YYYY preview is NON-skippable; unconvertible serial → flag-and-report, never store.
- **C6 (S2):** one-list-per-type enforced in JS (see the data-model note above), not a bad UNIQUE.
- **C7 (S2, PIN 1 extension):** source-contract assertion that lookup prefill is reachable ONLY from the
  Quick File pane / `directIntakeService` and is NOT referenced by `reviewService.confirm` / the Review/OCR
  confirm door (guards the `intake='direct'` guarantee against a future wiring change; the behavioural
  test alone doesn't).
- **C8 (S0):** `submit`/`update` persist custom fields DE-DUPLICATED against the four role keys
  (`supplier_name`, date_field_key, ref_field_key, `title`) — iterate non-role fields only; no double rows.

### Verification gate for the `lookup_lists_enabled` flip (S5)
1. `realdoc_regression.js` byte-identical with migs 196/197 applied + flag OFF.
2. PIN 1 (learning-leak, source+behavioural + C7), PIN 2 (detection-exclusion over a fixture with BOTH a
   `none+quick_file=1` and a `read+quick_file=1` type — assert JS AND Python `keyword.py:906`), PIN 3
   (token-prefix incl. the C3 first-token-only guard) all green.
3. Desktop↔/v1 picker parity (C1).
4. Import adversarial suite fails-toward on: malformed/zip-bomb xlsx, `.xlsm` (NEVER_OPEN), serial +
   1904-system dates, blank/duplicate composite keys, a formula/injection cell, an oversized file — each
   rejected-and-reported, list unchanged on any throw.
5. MANUAL round-trip of a real CSV and a real .xlsx (the pins are Node parses, not Excel certification).
6. Settings toggle added to `test_settings_wiring.js` VISIBLE_ALLOWLIST.
7. PII pre-flip checklist: warn on CSV export of a records list; document the DB-encryption recommendation
   in the feature help (Departments visibility gate on record data = reasonable v2).

---

# ADDENDUM — Multi-document Quick File pane (per-doc entry + preview) [owner ask 2026-09-21]

> Owner: "if someone selects multiple docs, a way to DISPLAY the doc but also allow ENTRY of the field
> data from the doc." Ran through barry (layout) + eric (Electron) → Oracle (this addendum).

## Consensus design (barry + eric)
**Master-detail with carry-forward defaults**, gated by staged count — NO mode toggle:
- `staged.length <= 1` → today's single form, UNCHANGED (no regression, source pins keep matching).
- `> 1` → left **filmstrip** (one cell/doc: lazy page-1 thumb for PDF/image, or an ext ICON card for
  Word/Excel/email/text — never a broken image; active = focused) + right **focused preview + per-doc form**.
- **Shared "applies to all" block** (today's form) = the batch DEFAULT; each per-doc field inherits it as a
  faded placeholder and OVERRIDES on type (sticky; editing the shared block never silently rewrites an
  overridden doc). "Apply to all" + "Same as previous" shortcuts. The typeahead + per-type custom fields live
  in the per-doc form. "File N ready" files the complete docs, leaves incomplete ones with a gentle reason.
- Fields: Company/Person, Reference, Date, custom fields = per-doc (inherit+override); Type + Notes = shared
  default. Doc TYPE stays SHARED across the batch for v1 (per-doc type = a later slice; named trade-off).

## Electron facts that dictate the build (eric, verified)
- **Main-window CSP has NO `img-src`** (`src/windows/main/index.html:5-6`) → a `data:` image is BLOCKED. Slice A
  adds `img-src 'self' data:` (matches Review/Search which already carry it). Trade-off: widens the whole main
  window's image policy to png/jpeg data URLs; `script-src` stays `'self'`, `.svg` is NEVER_OPEN + not
  renderable → same posture the app already ships in two windows. Name it in the commit.
- A STAGED file has **no docId** — `previewService.getThumbnail` keys off docId/folder/filename. New IPC
  `direct-intake-preview(token)` in MAIN: same `requireRole('admin','edit')` + `enabled(db)` gate + `_sweep()`;
  token→path in MAIN; non-renderable (`fileKinds.isRenderable`) → `{renderable:false, kind:ext}`; else
  `getThumbnail(..., {exact:true})` → `{renderable:true, dataUrl}`. Path NEVER leaves MAIN (de-pathing intact).
- **`exact:true` passthrough on `getThumbnail`** (one line; mirror `getDocumentPages`): without it,
  `_resolveDocFile` non-exact SIBLING RECOVERY could render a DIFFERENT filed doc sharing the base name. The
  single shared correctness guard.
- **State:** `staged = [{token,name,ext,size, values:{party,date,reference,title,notes,customFields:{}}}]` +
  `focusedIdx`; inputs bind to `staged[focusedIdx].values` (strings only, CSP-safe, no innerHTML). `doFile`
  loops per token with that doc's meta — **NO backend change** (`submit` already takes one token + one meta).
- **TTL (15 min, `_staged`)**: a long multi-doc entry can expire tokens mid-batch → renew `expires` on preview
  (bounded, MAIN-only, path already validated). Recommended.
- **Lifecycle:** per-token data-URL cache in the renderer (immutable per token); lazy filmstrip thumbs via
  IntersectionObserver (a cell needs a layout box — `visibility:hidden`, never `display:none`); clear cache +
  disconnect observers on staged-reset/remove; after `await preview(token)` re-check the token is still
  staged/focused before inserting the `<img>` (drop a late render).

## Slices + gate
- **S4a-A (preview):** main CSP `img-src 'self' data:` + `getThumbnail` `exact` passthrough + `direct-intake-preview`
  IPC + preload `quickFilePreview` + focused/only-doc preview (icon card for non-renderable) + TTL renew. Gate:
  source pins (CSP string, IPC name, exact in previewService) + manual (PDF→thumb, docx/eml→icon, single-file
  still files, expired token→clean icon).
- **S4a-B (per-doc form):** per-entry `values` + master-detail when >1 + apply-to-all/same-as-previous; single
  file untouched. Gate: no-innerHTML pin green + a pure node pin on the per-doc meta mapping + manual: file 3
  docs, 3 different parties/dates → each filed with its OWN supplier_name/doc_date.
- **S4a-C (polish, optional):** crisper focused page (getDocumentPage scale), IntersectionObserver filmstrip,
  per-doc type override.
Then **S4b** wires the lookup typeahead + click-to-fill onto the per-doc form.

Files: `src/windows/main/index.html` (CSP), `src/modules/directIntake/handler.js` (IPC + TTL renew),
`src/services/previewService.js` (exact passthrough), `src/preload.js` (quickFilePreview),
`src/windows/main/quickfileView.js` (state + layout), `src/windows/main/test_quickfile_pane.js` (pins).
NO change to `src/services/directIntakeService.js`.

---

# BUILT — 2026-09-21 (S0 → S4, all pins green)
Migrations: **196** document_types.quick_file (crossover) · **197** lookup_lists/lookup_records/lookup_field_maps
+ `lookup_lists_enabled` OFF · **198** `quickfile_multidoc_enabled` OFF. Both feature flags are opt-in settings
(NOT dark TEST switches).
- **S0** custom fields on Quick File types end-to-end (directIntakeService.submit/update dedupe vs role keys, C8;
  pane renders per-type fields). Pin: test_direct_intake_service.js §5/§6.
- **S1** crossover: `document_types.quick_file`, `updateType` lanes + C2 invariant, shared `isQuickFileType`
  (desktop + /v1 pickers, C1), Settings Document-Types Scanned/Quick-File split + per-type lane control. Also:
  Review "Visible to" hidden from non-admins (owner ask). Pin: test_doctype_lanes.js.
- **S2** Records lists: database/modules/lookup.js (surrogate-id, token-prefix suggest via src/lib/nameLookup.js),
  src/modules/lookup/handler.js (gated IPCs), src/windows/settings/lookupAdmin.js (enable + bind + records +
  import UI). Pin: test_lookup.js (incl. PIN 1 learning-leak + PIN 3 token-prefix + C6).
- **S3** import: src/lib/csvParse.js + ooxmlGrid injectable caps (C4) + date1904/serial (C5) + src/services/
  lookupImport.js (transactional, composite-key dedupe, never silent-merge). Pin: test_lookup_import.js.
- **S4a** multi-doc pane behind `quickfile_multidoc_enabled` (FLAG1): direct-intake-preview(token) IPC
  (getThumbnail exact:true = EXACT1; renderable/icon; TTL renew cap = TTL1), main CSP img-src 'self' data:
  (CSP1), per-entry closures via the pinned src/lib/quickfileMeta.js (MC1/MC2), partial-clear keeps unfiled
  (MC3). Pin: test_quickfile_pane.js §4 + test_quickfile_meta.js.
- **S4b** 3-char token-prefix typeahead on the bound list's trigger field in the pane (single/shared form;
  fills mapped fields, editable, highlighted). NOTE: typeahead in the multi-doc focused form = a follow-up.

VERIFY GATES STILL OWED (before flipping either flag on for a customer): the realdoc byte-identical run
(migs applied, flags OFF); the manual round-trips (multi-doc MC1/MC3, import adversarial, /v1 picker parity);
Chris sandbox pass. `run-pins` does NOT scan src/lib — run test_ooxml_grid.js + test_quickfile_meta.js directly.
