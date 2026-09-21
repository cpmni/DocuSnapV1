# HANDOVER — 2026-09-21 (Quick File Records-lists + crossover + multi-doc pane)

**Branch** `feat/teach-side-overnight`. **HEAD `9de80c4`.** **Origin CURRENT (all pushed).** Migration **198**.
Working tree clean of feature work (only the OWNER's dirty files remain — `CLAUDE.md`, `tools/video_tutorials/*` —
do NOT commit them; plus pre-existing untracked scratch/handover/TESTING files). `node scripts/run-pins.js` =
**409/409 green**. `run-pins` does NOT scan `src/lib` — run `src/lib/test_ooxml_grid.js` directly (green).
Read this first, then `docs/designs/QUICKFILE_LOOKUP_LISTS_2026-09-21.md` (the full design + both Oracle verdicts).

## Installers (customer-shippable pair, hardened — built at HEAD, verified)
Rev `9de80c4` (`build:release` core + client `dist`, `AUDIT_OFFLINE_OK=1`; hardened, verified):
- Core `dist\ScanFinder Setup 2.0.0-r20260921-1916-9de80c4.exe` (testBuild:false, bytecode present, no plaintext
  modules, 9 fuses as declared, boot smoke 0, 15 windows, signed).
- Client `client\dist\ScanFinder Search Client Setup 1.0.2-r20260921-1919-9de80c4.exe` (signed).
- Built offline (`AUDIT_OFFLINE_OK=1` — npm registry unreachable on this box; github push works; deps UNCHANGED).
  Self-signed → SmartScreen "Run anyway" on first launch. The `…-1913-61fce74.REFUSED.exe` is a stale refused
  attempt (source-protection caught a misplaced readable module — fixed in `9de80c4`); ignore/delete it.

## What shipped this session (6 commits, all pushed) — the Quick File auto-fill feature, S0→S4
Owner ask: separate Quick File doc types from OCR types; add auto-fill "Records lists" keyed by a master field
(daycare child = one example, but designed GENERIC — customers/tenants/vehicles/staff/patients/assets); 3-char
typeahead; CSV/XLSX import; and a multi-document pane that shows each doc + per-doc field entry. Also: hide the
Review "Visible to" display from non-admins. Process: barry+gary+reggie+eric → **Oracle SIGN-OFF-W/COND** (lookup
C1-C8) + barry+eric → **Oracle SIGN-OFF-W/COND** (multi-doc pane MC1-MC3/CSP1/IPC1/EXACT1/REG1/FLAG1); both logged
in `docs/oracle_log.md`. **Everything ships DARK/opt-in — no behaviour change until a flag is flipped.**

- **S0 `3a6dbf0`** — Quick File types now carry per-type CUSTOM fields end-to-end: the pane renders them,
  `directIntakeService.submit/update` persist them as typed extractions (conf 100), deduped vs the 4 role keys (C8),
  searchable. Byte-identical for role-only types.
- **S1 `387a4d6`** — **lane crossover, mig 196 `document_types.quick_file`.** `reading_mode` stays the SOLE OCR
  detection gate; `quick_file` alone decides picker membership → a type can be Scanned / Quick File / **Both**.
  `updateType` lanes editable + C2 invariant (a `none` type can't be orphaned). Shared `isQuickFileType` drives the
  desktop AND `/v1` pickers (C1 parity). Settings → Document Types has a Scanned/Quick-File filter + a per-type
  "How is this type filed?" control. **Also: Review "Visible to" hidden from non-admins** (server gate unchanged).
- **S2 `750cd41`** — **Records lists, mig 197** (`lookup_lists`/`lookup_records`/`lookup_field_maps` +
  `lookup_lists_enabled` OFF). `database/modules/lookup.js` (surrogate-id keyed — two "John Doe" never merge; token-
  prefix suggest via `src/lib/nameLookup.js`, Oracle C3); gated IPCs `src/modules/lookup/handler.js`; Settings admin
  UI `src/windows/settings/lookupAdmin.js` (enable + bind a list to a type's fields + add/list records + import).
  ONE list per type in JS (C6). NEVER touches learning — a prefill files as `intake='direct'` (PIN 1 / C7).
- **S3 `e696d62`** — **CSV / XLSX import.** `src/lib/csvParse.js` (BOM/semicolon/quoted) + `ooxmlGrid` refactored
  with injectable caps (200-row preview default unchanged, C4) + Excel serial dates incl. 1900-leap + Mac/1904 (C5);
  `src/services/lookupImport.js` — parse-in-MAIN, transactional (bad row rolls back the whole import), composite-key
  dedupe (folded master + disambiguator) that NEVER silently merges two same-named subjects; blank master
  skipped+reported, bad date imported blank+flagged.
- **S4 `61fce74`** — **typeahead + multi-doc pane.** S4b: a 3-char token-prefix typeahead on the bound list's
  trigger field fills the mapped fields (editable, highlighted). S4a (behind **mig 198 `quickfile_multidoc_enabled`**,
  OFF): >1 files → filmstrip + focused preview + per-doc form with shared "applies to all" defaults; single-file is
  byte-identical when off (REG1). New `direct-intake-preview(token)` IPC renders a staged file in MAIN
  (`getThumbnail exact:true` = EXACT1; non-renderable→icon; TTL renews capped = TTL1); main CSP gains
  `img-src 'self' data:` (CSP1). Per-entry closures via the pinned `src/windows/main/quickfileMeta.js`
  (MC1/MC2 — no wrong-doc leak); "File N" keeps incomplete docs staged (MC3).
- **`9de80c4`** — build fix: moved `quickfileMeta.js` (a renderer `<script>`) out of `src/lib` (which the hardened
  build bytecode-compiles + forbids readable modules in) to `src/windows/main/`. No logic change.

Pins added: `test_doctype_lanes.js` (PIN2 detection-exclusion + C2 + parity), `test_lookup.js` (PIN1 learning-leak +
PIN3 token-prefix + C6), `test_lookup_import.js`, `test_quickfile_meta.js`; extended `test_direct_intake_service.js`
§5/§6 + `test_quickfile_pane.js` §4.

## NEXT BATCH — prioritised

### A. Verify before flipping EITHER new flag on for a customer
1. **`lookup_lists_enabled` + `quickfile_multidoc_enabled` are both OFF.** Before a customer flip: `realdoc_regression.js`
   (RR_APP_ENV=1) byte-identical with migs 196/197/198 applied + flags OFF (proves the additive column + picker-filter
   are inert to OCR). Then the MANUAL round-trips (not jsdom-pinnable): multi-doc — file 3 docs with 3 different
   parties/dates → each filed with its OWN supplier_name/doc_date (MC1); an incomplete doc stays staged (MC3);
   PDF→thumb, docx/eml→icon; single-file unchanged; a deleted-staged file → icon not a stranger's doc. Import —
   a real .csv AND a real .xlsx round-trip + the adversarial set (zip-bomb/serial/1904/blank-key/oversized) each
   rejected-and-reported with the list unchanged. Desktop↔/v1 picker parity. A `/christest` sandbox pass on the new
   Settings + pane.
2. **PII** — Records lists hold sensitive data (medical/DOB/payroll) in a plaintext DB. Recommend enabling DB-at-rest
   encryption for those customers + warn on records-CSV-export (a v2 Departments gate on record data is reasonable).

### B. Feature follow-ups
3. **Typeahead in the MULTI-DOC focused form** — S4b wired the typeahead into the single/shared pane only; the per-doc
   form in the multi-doc pane doesn't yet host it (named v1 trade-off). Add it there.
4. **Per-doc TYPE in multi-doc** — the batch shares one doc type in v1 (per-doc type deferred, Oracle-accepted).

### C. Standing DEV backlog (owner-gated — pre-dates this feature; still owed)
5. **Undetected-issuer flip census** (`issuer_undetected_blank` mig 195, still DARK): `realdoc_regression.js` M=0 +
   zero supplier_name accuracy drop + report the fire denominator + a multi-token synthetic FP set (Oracle C4).
6. **Split "recover the original" button** (Chris F3): the original is in `.sf_separated_originals` but no visible
   recover action — add one. Pairs with C12 Rejoin.
7. **Deploy the 3 licensing-server changes** (`BEFORE_RELEASE.md`, manual IONOS upload, owner login): CF real-IP fix,
   New-account admin, API-activity page + IP-logging notice. Deploy traps in that file.
8. **DB-at-rest encryption decision** — 2a whole-DB (recovery-code / data-loss trade) vs 2b TOTP-secret-only.
9. **VM live-verify** the pair (Quick File single + multi off by default; client cert-ID / one-time-code; thumbnails).

### D. Later (pendingfeatures.md)
Rotate/reorder pages in the splitter · a general queue-wide Join · `.sf_separated_originals` name-collision hardening
· import-time/duplex blank removal.

## Key facts / gotchas
- **Feature flags this session** are opt-in SETTINGS, NOT dark TEST switches (NOT in TEST_SWITCH_KEYS, count stays
  **45**): `lookup_lists_enabled` (mig 197), `quickfile_multidoc_enabled` (mig 198). `document_types.quick_file`
  (mig 196) is a schema column, backfilled from `reading_mode='none'` (picker byte-identical post-migration).
- **Detection safety:** `reading_mode` is the SOLE input to `known_type_names` (`process_docs.py:1140`, `keyword.py:906`).
  `quick_file` must NEVER feed detection. PIN2 (`test_doctype_lanes.js`) guards this.
- **Learning safety:** the whole lookup path is safe ONLY because a prefill files as `intake='direct'` (already
  learning-excluded, `machine_vias.learningExcludedSql`). PIN1 (`test_lookup.js`) is a source-contract that
  `lookup.js`/its handler reference no learning reader AND that `reviewService` never references lookup (C7).
- **Matching = token-PREFIX** (`src/lib/nameLookup.js`): "doe"→John **Doe**, never a substring. PIN3 pins it.
  Record identity is a surrogate id — master_value is NOT unique. No JS↔Python twin (Quick File is JS-only).
- **Hardened build source-protection:** a RENDERER `<script>` must live under `src/windows/**` (ships readable);
  anything under `src/lib|services|modules` or `database` is bytecode-compiled and a readable file there is REFUSED.
  (That is why `quickfileMeta.js` lives in `src/windows/main/`.)
- **Build:** kill every Electron first (EBUSY); `AUDIT_OFFLINE_OK=1 npm run build:release` (core) + `cd client &&
  npm run dist` (client). The verifier renames a refused build `*.REFUSED.exe`.
- Advisors: reggie/gary/oracle/barry/eric via the Agent tool; Chris via `/christest`.
