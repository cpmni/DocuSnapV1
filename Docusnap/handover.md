# ☀ MORNING REPORT — 2026-09-21 NIGHT RUN (autonomous; nothing pushed)

Ran `docs/designs/NIGHT_RUN_2026-09-21.md` on auto. **All work committed LOCAL, NOT pushed** (owner pushes after
review). Branch `feat/teach-side-overnight`. **Final pins: `node scripts/run-pins.js` = 409/409 green.**

**Commits this run (4, local):**
- `436af88` polish(settings): graphical folder tabs for the Document-Types lane views (Task 0 — the owner's uncommitted UI tweak, isolated).
- `124e5a2` fix(quickfile): typeahead no longer crashes on a Records list with no disambiguator (Chris F1 — a REAL bug).
- (docs) DARK_SWITCH_LEDGER refresh + oracle_log F1 verdict + NIGHT_RUN ledger + this report + the census RESULT.md + Chris's vet doc.

## Task A — dark-switch batch census (`TESTING/_measure/flip_census_20260921/RESULT.md`)
Migrated a 700-corpus copy to HEAD (mig 198, 400 test docs); `RR_APP_ENV=1` baseline; shell-env lever. Two UNION
arms + per-switch isolation of the two that fired.
- **HEAL union (37 still-dark reading/ref/date/geometry switches): M=0** — 6 GT-correct ref/date heals (clipped
  codes/dates recovered), 0 file→hold, 1 correct new auto-file (#434, ref+date right). No wrong change.
- **FRICTION union (3 auto-file looseners): M=0** — 7 held→filed, **all 7 ref+date correct (0 wrong auto-files)**.
- **Isolated:** `template_code_read_widen` (mig 141) M=0 / 4 heals; `template_edge_clip_heal` (mig 151) M=0 / 1 heal.
- **0 FLIPS tonight.** The synthetic census clears the plan's batch bar, but each firing switch's OWN named flip gate
  requires the **605 REAL corpus + a pixel-adjudicated adversarial fire census** (Oracle C1-C7 for mig 151; mig 141
  has no Oracle *flip* sign-off). Auto-flipping would skip that gate (approval-class), so they are **logged as
  flip-ready-candidates**. The code-widen/edge-clip family (141+151) is the strongest — recommend running its named
  605/Oracle gate then flipping. The whole 37-switch dark batch is SAFE at HEAD (union M=0).
- Refreshed `docs/DARK_SWITCH_LEDGER.md` for the missing 09-19→21 flips (migs 187-191, 193).

## Task B — Chris daycare Quick File vet (`docs/CHRIS_QUICKFILE_VET_2026-09-21.md`)
Fresh `/christest` sandbox (port 9223), flags flipped ON in the sandbox, seeded a "Child Record" Quick File type +
a "Children" records list (5 kids, incl. two Avas) + 4 daycare inbox docs. Verdict: filing/search are excellent,
but "not yet for children's records — fix auto-fill". 7 findings; Oracle-vetted the fixes:
- **F1 🔴 FIXED (`124e5a2`, Oracle SIGN-OFF-W/COND):** the auto-fill typeahead crashed on every keystroke
  (`appendChild(null)`) for any Records list with no/blank disambiguator — `quickfileView.js` `el()` lacked the
  null-kid guard its twin `lookupAdmin.js` has. One-line guard + a twin-parity pin so they can't diverge again.
- **F2** = a SEED ARTIFACT (my test list used bare-string columns; the product's own UI always writes
  `{key,label,type}` objects) → no code change.
- **DEFERRED to you (design/policy, Oracle agreed):** F3 (the required "Document Issuer/Company/Person" role
  becomes the folder name on a child record while child name is optional — structural-role model), F4 (typed Quick
  File fields display "100%" — cosmetic, no wrong-file), F5 (a no-disambiguator list now shows a name-only dropdown
  — the F1 fix ACTIVATES this; add a second-column fallback), **F6 (multi-doc "apply-to-all" lights a green "ready"
  dot on a doc that merely inherited the shared party — a wrong-child footgun; it is a FLIP-BLOCKER: do NOT flip
  `quickfile_multidoc_enabled` until "ready" distinguishes own-subject from inherited-default).**

## Owed in the morning
Push · run the 605/Oracle flip gate for mig 141+151 before flipping (strongest candidate) · the F1 live in-app
re-drive (needs the sandbox login Chris created) · decide F3/F4/F5/F6 · the standing backlog below (unchanged).
Sandbox app may still be up on port 9223 (harmless); the census sandbox artifacts are in `TESTING/_measure/flip_census_20260921/`.

---

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
