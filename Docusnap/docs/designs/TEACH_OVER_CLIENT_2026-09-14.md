# TEACH OVER THE SEARCH CLIENT — design (2026-09-14)

Status: SCOPED, advisor-vetted (eric = Electron/architecture, gary = /v1 contract + atomicity + security +
tests). **Oracle: SIGN OFF WITH CONDITIONS (2026-09-14, `docs/oracle_log.md`) — C1-C7 below; none bite S0.**
Owner then reversed the B defer ("we will implement upload to teach too") — the upload-to-teach section is
merged in below. **Oracle B follow-up: SIGN OFF WITH CONDITIONS C8-C14 (2026-09-14, gates S4 not S0), listed
in the B section.**

**S0 BUILT 2026-09-14 (core byte-identical; full pin gate 364/364 green):** `renderer.js` moved to
`src/windows/shared/teach-ui/teach.js`; the IO seam swapped to `window.TeachTransport` (data) +
`window.TeachHost` (chrome); core adapters `src/windows/teach/coreTeachTransport.js` + `coreTeachHost.js`
(pure pass-throughs) loaded before the wizard in `index.html`; the `DocTypeEditor`/`DocTypeCatalog`
`|| window.docusnap` fallback removed (injection mandatory; all 4 callers verified passing `api`); new pin
`src/windows/shared/test_teach_ui_no_direct_ipc.js` (no-direct-IPC + adapter-contract, discovered by
`run-pins`). Every teach source-contract pin + ~9 cross-repo pins that read the wizard were re-pointed at the
new path. NOT YET DONE in S0: a runtime boot smoke of the teach window (owner launch, or the S1 harness) and
the sync-script/drift-pin/committed client copy (folded into S1 with the client window). NOT committed
(owner's call).

## Oracle conditions (2026-09-14) — SIGN OFF WITH CONDITIONS
Premise HELD (A is a coherent v1 cut; the one-shot transactional commit is the right design; `_upsertTemplate`
verified to have no `await` before its row writes → the sync transaction is feasible). Two premise CORRECTIONS
are already applied inline below (blast radius; render parity). Conditions, bound to their slice:
- **C1 (S3 gate):** the DB-equivalence pin compares `{templates, template_fields, template_field_mappings,
  template_hidden_fields, template_landmarks, field_label_overrides}` — ADD `template_fields` +
  `template_hidden_fields` (fixed values + hidden fields live there; a mis-written fixed value slips a
  mappings-only gate). Drop `field_anchors` (the wizard writes none) or keep it only as a zero-assert.
- **C2 (correction, applied):** teaching writes TEMPLATE/(supplier,type)-scoped mappings + `template_fields` +
  `template_hidden_fields` + `field_label_overrides` — NOT app-wide `field_anchors` (that is the Stage-2 ⊕
  `save-field-anchor` path, which this design does NOT expose). Smaller blast radius than first stated.
- **C3 (S1 gate):** `/v1/documents/:id/page-deskew` MUST use `expand=False` + identical `detect_skew` params to
  the desktop `get-page-deskew`. Assert identical returned image DIMENSIONS + `measured`/`angle` between the two
  paths before S1. Do NOT force scale equality — mappings are stored NORMALIZED (0-1), so scale/DPI is
  scale-invariant; the deskew FRAME is the only real divergence.
- **C4 (S3):** the type-split / identity-near-match acks bound wrong-TYPE + wrong-IDENTITY only. A mis-drawn BOX
  on an already-graduated (supplier,type) auto-files WRONG values — bounded by audit + reversibility +
  admin-auth (desktop parity), NOT the ack. State honestly. OPTIONAL hardening: a re-taught template on an
  already-graduated scope holds its siblings for one human-agreeing confirm (mirror identity-hold-siblings).
- **C5 (S3 gate):** crash-replay idempotency pin (step-3 commits, step-4/6 never complete → replay same
  `teachCommitId` = EXACTLY ONE template + ZERO dup rows). PREFER recording `teachCommitId` `pending` INSIDE the
  step-3 transaction, promoted to `done` at step 6 (the step-6-only ledger leaves a fragile crash window).
- **C6 (S3):** the wizard payload `sample_deskew_angle`/`angle_measured` MUST be written SYNCHRONOUSLY inside
  the step-3 transaction (the `sample_deskew_angle IS NULL` guarded UPDATE, `review/handler.js:1693-1708` — the
  2026-09-07 placement root-cause fix). Only the Python `generateSampleAngle`/landmarks/fingerprint spawns are
  step-5 best-effort. A lost sample angle lands a glyph to the side on every tilted sibling.
- **C7 (S1):** empty-queue UX ("no documents are waiting to teach — scan one into the main PC first") + honest
  owner copy that this teaches documents already scanned into the core.
- **Isolation precision:** plain `/v1` confirm ALREADY mints GRADUATION templates via `onScopeGraduated`
  (W=10-gated, no drawn mappings). The `confirm_never_teaches` + handler-grep pins bound DIRECT drawn-mapping
  teach, NOT graduation — state the guarantee that precisely.

## Goal
Let a remote admin on another LAN PC teach a new document type / template over the existing `/v1` TLS API,
from inside the detached SEARCH CLIENT — no separate teach tool. Owner chose to add it to the client (login,
TLS, page viewer, theme already there).

## Owner decision (2026-09-14) — the exemplar source
**A: teach documents ALREADY in the core's review queue** (scanned into the core, or dropped into its watched
folder). The client does NOT upload a brand-new file from its own PC to teach in v1. Reason it matters: a
teachable exemplar must be an OCR'd `needs_review`/`pending` row that carries `logo_phash` /
`keyword_fingerprint` (`_upsertTemplate` reads them, `review/handler.js:1813`). Quick File intake is NOT a
teachable source — it files immediately, `reading_mode='none'`, no OCR, no fingerprint (`test_v1_intake.js:129`).
**B (client-PC upload-to-teach) is NOW IN SCOPE** (owner reversed 2026-09-14: "we will implement upload to
teach too") — see the "B — upload-to-teach" section at the end. It is a new OCR-import write surface and gets
its own Oracle follow-up pass; purely additive (once the upload is an OCR'd review row, teach = A).

## Architecture — follow the search-ui precedent (both advisors agree)
Same pattern as the shared search screen (`src/windows/shared/search-ui/`, Oracle-signed 2026-09-13):
- Extract `src/windows/teach/renderer.js` (2318 lines) → `src/windows/shared/teach-ui/*.js`. Route every
  `D.* (= window.docusnap)` call through `window.TeachTransport`. Split window/host chrome
  (windowMinimise/close, openHelpWindow, getTeachTarget/onTeachLoadDoc, openReviewWindow*) onto a separate
  `window.TeachHost` — those are not transport.
- Core adapter `src/windows/teach/coreTeachTransport.js` = pure pass-through to the core preload bridge
  (mirror `src/windows/search/coreTransport.js`). Client adapter `client/renderer/teach/clientTeachTransport.js`
  = over the `/v1` apiClient (mirror `client/renderer/search/clientTransport.js`).
- The heavy bits are ALREADY share-ready (eric, FACT): `src/windows/shared/anchorLabel.js` +
  `valueLocate.js` have zero IO (pure coordinate math); OCR read-back submits client-cropped image BYTES
  (no path); the page images arrive path-free from `/v1/documents/:id/pages`. Sub-components
  (`doctype-editor.js`, `doctype-catalog.js`, `thumbs.js`, `listCaption.js`, `boxSnap.js`) already take an
  injected `api`. **Load-bearing cleanup (S0):** remove the `|| window.docusnap` fallback in
  `doctype-editor.js:237` (+ `doctype-catalog.js:33`) so injection is MANDATORY; audit both call sites
  (Settings + teach) to pass `api` explicitly. On the client `window.docusnap` does not exist.
- Client copies are GENERATED + committed under `client/renderer/shared/teach-ui/` (+ the shared sub-scripts)
  by a new `scripts/sync-client-teach.js` (mirror `sync-client-search.js`), drift-pinned by
  `scripts/test_client_teach_sync.js`, no-direct-IPC-pinned by
  `src/windows/shared/test_teach_ui_no_direct_ipc.js` (beside the search twin so run-pins discovers it; mirror
  `test_search_ui_no_direct_ipc.js` —
  forbids naming any preload bridge / ipcRenderer / require / contextBridge, comments included). Both pins
  join `npm run test:pins`.
- Cap probe `_cap(name)` (searchState.js pattern, ABSENT=true): the client sets `caps.import=false`,
  `caps.review=false`, and non-admin caps false → the shared UI HIDES those controls, core path unchanged.

## Client window model (eric)
A separate top-level BrowserWindow cloned from the search pop-out (`client/main.js:42-46`): single instance,
bounds persisted, **closed on logout AND on main-window close**, loaded via `loadFile` under the navGuard root
at `client/renderer/teach/index.html`. **Non-modal** (the main window is the re-auth surface; a modal child
would block a 401 re-login). **The session token NEVER reaches the teach window** (only the role cache does),
same as search. A write-surface window that outlived the session would be the worst leak — the
closed-on-logout rule is mandatory.

## Transport surface
### Reuse as-is
- `GET /v1/doc-types` (`handler.js:1171`) — types + fields + roles. `GET /v1/documents/:id/page` /
  `page-info` — the page to draw on. `GET /v1/review/queue` — the exemplar list. `POST
  /v1/documents/:id/ocr-region` (`:756`, isWriter + in-flight cap + audited) — the box read-back text.
### New reads (mirror the ocr-region spawn: client pixels, own in-flight cap, path-free, isWriter)
- `POST /v1/documents/:id/ocr-region?mode=boxes` → `{words:[{t,b:[l,t,w,h],c}]}` (add a mode to the ONE OCR
  door rather than a new path).
- `POST /v1/documents/:id/ocr-page-words` → `{w,h,words:[...]}` (full-page OCR — its OWN in-flight cap, same
  fan-out concern as `/find`; must ride `_ocrDpiEnv`/`_reconcileEnv`).
- `POST /v1/documents/:id/page-deskew` → `{angle, image(b64), measured}`.
- `GET /v1/templates/:id` → landmark count + field summary ONLY, DTO-projected (a template detail can carry a
  sample file path — project it out).
- Advisory reads (read-only, fail-open, isWriter): `GET /v1/teach/check-issuer-read`,
  `check-type-split`, `check-identity-near-match`, `followup`.
### New writes
- `POST /v1/doc-types` `{name, fields[], ref_field_key, date_field_key}` → reuses
  `create-doc-type-with-fields`; **ADMIN-only**. (Intake's `new:<slug>` only resolves PRESET catalog slugs —
  cannot create an arbitrary custom type. Edit-an-existing-type is OUT of v1 scope; the wizard only creates.)
- `POST /v1/teach/commit` — the ONE transactional commit (below).
### Cannot cross /v1 in v1 (cap-hidden on the client)
- `stagePdfForTeach` / `getStagedTeachThumbnail` / `processFolder` / `onProgress` — local file import
  (`caps.import=false`; the wizard boots against the /v1 review queue). This is exactly owner-decision A.
- `openReviewWindow*` — the client has no Review window (`caps.review=false`; the follow-up card's "Check in
  Review" hides, or rewires to the search pop-out's `openDocById`).

## The commit — ONE transactional endpoint (gary; the primary lever)
Do NOT mirror the desktop's 6-call sequence over the wire (a socket drop between calls = a half-born template
that mis-extracts every future sibling). The client sends the WHOLE finished teaching in one body; the server
runs the sequence.

`POST /v1/teach/commit` body:
```
{ teachCommitId,               // client-minted UUID — idempotency key
  document_id, document_type_slug, supplier_name, allValues,
  sample_deskew_angle, angle_measured,
  listCaptions:[{field_key,label}], fixed:[{field_key,value}], hidden:[field_key],
  mappings:[{field_key,page_number,anchor_text,
             anchor_{x,y,w,h}_norm, target_{x,y,w,h}_norm, search_expansion}],
  acknowledgeTypeSplit, acknowledgeIssuerNearMatch, taught_fields }
```
Server flow (order mirrors the desktop; keeps confirm's `onTaughtConfirm` enrich idempotent):
1. **Idempotency short-circuit** — look up `teachCommitId` in a new additive `teach_commits` ledger; if present
   return the stored `{ok, templateId, filename}`. Makes "server committed, client never saw the 200, client
   retries" safe over a flaky LAN.
2. **Validate everything up front, before any write** — doc-type exists; `document_id` is a teachable review
   row; every `field_key` ∈ the type's fields; every coord finite/0-1/area>0/on-page (lift
   `templates/handler.js:753-762`); each caption passes `cleanCaption` + `isGenericCaption`
   (`review/handler.js:1626-1636`); `fixed`/`hidden` refuse structural roles.
3. **ONE `better-sqlite3` db.transaction() (synchronous)** = the atomic unit: create/reuse the template
   (`_upsertTemplate`'s sync core) + ALL mappings + fixed + hidden + list-caption overrides. No partial mapping
   set can ever reach extraction. Any throw → full rollback → nothing half-born.
4. **File the exemplar** via `reviewService.confirm(..., taught_fields, allowRefile:false)` — its
   `onTaughtConfirm` finds the just-made template and enriches idempotently (`reviewService.js:601-619`). Does
   the PDF move + learning. OUTSIDE the DB transaction (file I/O + Python).
5. **Best-effort async enrichment** — landmarks / fingerprint / sample-angle (already non-fatal,
   `review/handler.js:1684-1718`). Never blocks the 200.
6. Record the ledger result; audit; return `{ok, templateId, filename, landmarksWarn}`.

Why not one ACID transaction over ALL of it: better-sqlite3 transactions are synchronous — they can't span the
Python spawns or the async PDF move. Decomposition: template+mappings = atomic (step 3); confirm/file (4) +
enrichment (5) = recoverable/best-effort. **No state leaves extraction wrong:** if confirm fails after step 3,
the template exists and extracts siblings CORRECTLY; only the exemplar sits unfiled in the queue → admin
re-confirms (self-healing). No compensating delete needed — a fully-mapped template is never wrong to keep, and
idempotency handles the retry.

## Security model
Reference invariants: F-01 (template writes = license re-check, `templates/handler.js:737`), F-02 (server-side
path resolution, body = values only, `api/handler.js:1194`), SEC-03 (`_canAccess` on by-id seams), intake's
SAFE-subset / size / in-flight caps.
- **Gate: ADMIN-only for the WHOLE `/v1/teach/commit` and `POST /v1/doc-types`** (strictest of the constituent
  desktop gates — mappings/fixed are already admin). Advisory + OCR reads stay isWriter. Plus the
  `detached_client` entitlement gate (→ 402) and the F-01 license re-check (→ 403 LICENSE).
- **Server opt-in switch `teach_over_client_enabled`, default OFF** — checked like `directIntakeService.enabled`
  → 409 FEATURE_DISABLED when off. The owner turns remote teaching on deliberately.
- **Server-side ack enforcement (the one place blast radius breaks):** run the wizard's own advisory guards
  (`check-type-split`, `check-identity-near-match`) INSIDE the commit; if a guard fires and the matching
  `acknowledge*` flag is absent → 409 with the reason (fail-toward-a-human). A scripted client cannot skip the
  guard that stops a mis-taught mapping feeding a PRE-GRADUATED (supplier,type) auto-file.
- Input validation all server-side (coords, field_key membership, caption cleanliness, teachable status).
- Size/rate: cap mappings (≤ 64), cap anchor_text/value lengths, a teach in-flight cap of 1-2 (the commit
  spawns Python), the 1 MB body cap is fine (no file bytes ride this — the exemplar already exists on the core).
- **Audit every write** (`user_id`, `via:'client'`, `ip`, `document_id`) — mirror the intake audit.
- **Blast radius (new authority a client gains) — CORRECTED per Oracle C2:** with a stolen ADMIN session,
  remote write to the learning/schema layer — mint templates, write TEMPLATE/(supplier,type)-scoped
  `template_field_mappings`, set fixed values (in `template_fields`) surviving history rebuilds, hide fields
  (`template_hidden_fields`), inject `field_label_overrides` keywords. It does NOT write the app-wide
  `field_anchors` (the Stage-2 ⊕ path is not exposed) — the scope is the exemplar's own template, not all
  suppliers. Bound:
  fresh templates land siblings in REVIEW (graduation still needs W=10 clean confirms in `trust.js` — MUST NOT
  weaken) + scope is the exemplar's own (supplier,type) + reversible (Learning Recovery / mergeInto) + audited.
  Tamper-evident, not tamper-proof vs the core PC's admin (same posture as stamping).

## Contract
`API_CONTRACT_VERSION` 1.6.0 → **1.7.0**; `client/apiClient.js CLIENT_CONTRACT` in lockstep. Client gates its
teach cap on ≥ 1.7.0 (hides teach on an older core).

## Slice plan (each independently testable; guards baked in)
- **S0 — Extract, core byte-identical.** teach-ui shared module + `TeachTransport`/`TeachHost` +
  coreTeachTransport + core host adapter; mandatory injection in doctype-editor/catalog (audit Settings + teach
  call sites); generalise the sync script to a teach-ui mirror set + the shared sub-scripts; add the
  no-direct-IPC + drift pins to test:pins. GATE: core teach render+commit smoke byte-identical; both pins green.
- **S1 — Client pop-out, READ + advisory + OCR routes.** teachWin cloned from searchWin;
  `client/renderer/teach/{index.html,clientTeachTransport.js}` + preload; wire ocr-region(+boxes),
  ocr-page-words, page-deskew, templates/:id, check-*, followup. `caps.import=false`, `caps.review=false`.
  Contract 1.7.0; `test_v1_teach.js` reads.
- **S2 — Doc-type create.** `POST /v1/doc-types` (admin). DocTypeEditor/Catalog fully over /v1.
- **S3 — The commit (highest blast radius → the Oracle gate is here).** `POST /v1/teach/commit` transactional +
  idempotent + admin-gated + `teach_over_client_enabled` OFF + server-side acks + audit. Relax the confirm
  route's `taught_fields:[]` hardcode ONLY on the teach path (teaching never smuggles through plain confirm).
- **S4 — client-PC upload-to-teach (owner B, IN SCOPE).** `POST /v1/teach/stage` — see the "B" section below.
  Sequence after S3. Additive; the transactional-commit design is untouched.

## Test strategy (gary)
- **`src/modules/api/test_v1_teach.js`** (house style of `test_v1_intake.js`): auth (no token 401; edit 403 —
  pins admin-only; unentitled 402; license-denied 403); validation (off-page/NaN/zero-area 400; field_key not
  on type 400; generic caption 400; structural role refused; non-teachable doc 400); happy path (EXACTLY ONE
  template + N mappings + fixed + hidden + captions, ONE file, audit rows); **idempotency** (replay same
  teachCommitId → same templateId, no second template, no double-file); **atomicity** (a failing mapping →
  ZERO rows persisted); server-side ack (type-split + ack false → 409).
- **Widening-guard pins:** `test_v1_confirm_never_teaches.js` — the plain confirm route still hardcodes
  `taught_fields:[]` (`handler.js:1209`) and never reads `body.taught_fields`. Source-contract grep pin —
  `templates.saveMapping | setFieldFixedValue | addLabelOverride | _upsertTemplate | create-doc-type` appear in
  the /v1 handler ONLY inside the teach-commit / doc-types blocks (a stray new /v1 learning write fails it).
- **Parity/drift:** `scripts/sync-client-teach.js` + `test_client_teach_sync.js` + the no-direct-IPC pin +
  `scripts/teach-window-harness.js` (clone `search-window-harness.js`, `--client`; drives a full teach on core
  and client identically, reports call arity/shape; a `--role edit` run asserts the client teach entry is
  HIDDEN — admin-only, hidden-beats-refused).
- **DB-equivalence gate (the read-identity proof, not a full corpus run):** on two copies of a fixture DB,
  teach the SAME doc + SAME boxes once via desktop IPC and once via `/v1/teach/commit`; assert `templates`,
  `template_fields`, `template_field_mappings`, `template_hidden_fields`, `template_landmarks`,
  `field_label_overrides` rows equal (modulo ids/timestamps) — per Oracle C1 (`template_fields` +
  `template_hidden_fields` ADDED so a mis-written fixed/hidden value can't slip a mappings-only gate;
  `field_anchors` dropped — the wizard writes none). Identical rows ⇒ a remote-taught template reads
  byte-identically to a locally-taught one ⇒
  `realdoc_regression.js` provably unaffected. Run realdoc M=0 ONLY if the commit endpoint alters
  `reviewService.confirm`'s taught path; if it re-drives the same functions with the same payload, the
  equivalence pin is the gate.

## Open risks / HYPOTHESES to settle before/at build
1. **Render parity (frame-math class).** The client draws boxes on the page it renders from `/v1/page`; the
   desktop draws on `getDocumentPages`. If the two use a different scale/DPI, the same drawn box maps to
   different template coords → a subtly mis-placed mapping the DB-equivalence pin (same input coords) won't
   catch. VERIFY the client teach page render uses the SAME `render/pages.py` recipe/scale as the desktop teach
   render before S1.
2. **Garbled-supplier naming.** A confirmed-issuer garble taught remotely mints a template named after the
   garble (`_upsertTemplate:1830`). The near-match ack guards this — the server MUST enforce it (a scripted
   client skips it otherwise). Pinned by the ack-enforcement route test.
3. **Verify the ASSUMPTION** that `_upsertTemplate`'s create has no `await` before its writes (read
   `review/handler.js:1960-2155`) — the sync-transaction design in step 3 depends on it.

## The seam
RELIES ON: search-ui's injected-transport + drift/no-direct-IPC harness (reused wholesale); confirm's
server-side path resolution (F-02) extended to the commit; the client pop-out lifecycle (token-in-main, closed
on logout/main-close); `anchorLabel.js`/`valueLocate.js` staying IO-free; an OCR'd review-queue exemplar
existing on the core (owner-decision A).
WEAKENS/ADDS: removes the deliberate `taught_fields:[]` safety on the (new) teach path — teaching becomes
possible over the LAN; opens the highest-value learning/schema WRITE surface to remote clients for the first
time — a teach is TEMPLATE/(supplier,type)-scoped (NOT app-wide `field_anchors`; Oracle C2). Does NOT weaken
auto-file (graduation W=10 stays). The one place a mis-taught mapping could feed an auto-file is an
already-graduated (supplier,type): a wrong TYPE/IDENTITY is caught by the server-side ack, but a wrong BOX is
bounded only by audit + reversibility + admin-auth (Oracle C4) — optional sibling-hold hardening noted there.


---

# B — upload-to-teach (owner reversed the defer 2026-09-14; own Oracle follow-up pass pending)

Merge into TEACH_OVER_CLIENT_2026-09-14.md AFTER the current Oracle vet lands (apply its conditions first).
Owner: "we will implement upload to teach too." So decision A stays for the queue case AND B is added — a
remote person can bring a brand-new document from their own PC.

## What changes vs the A-only design
Purely ADDITIVE. Once the uploaded document is an OCR'd `needs_review` row on the core, teach + the
transactional commit are IDENTICAL to A. B only adds HOW the exemplar reaches the queue.

## The stage route
`POST /v1/teach/stage` — upload a document, run the FULL OCR import on the core WITHOUT filing, return the
review-queue docId to teach.
- Reuses the desktop teach-import server half verbatim: the wizard does
  `processFolder(staged.folder, { autoFile:false })` (`teach/renderer.js:235`) then picks the new row from
  `getReviewQueue()` by filename. Over /v1 the route does the same: write the bytes to a minted temp/inbox
  path (server-side, path never crosses the renderer), run the normal import with autoFile:false → the doc
  lands `needs_review` (NOT filed even if that supplier+type is graduated — autoFile:false forces review),
  render nothing here (pages come from the existing `/v1/documents/:id/page`), return `{docId, filename}`.
- Response is returned only when the OCR import completes (~30 s for a scan). The client shows an indeterminate
  "Reading…" spinner — same as the desktop single-doc read (no sub-%). Do NOT build SSE/chunked progress for
  v1 (over-engineering; onProgress can't cross /v1 cheaply — eric).

## Upload mechanics — reuse Quick File intake's, DON'T reuse intake itself
Intake (`handler.js:816`, `directIntakeService.submit`) FILES immediately (`reading_mode='none'`, no OCR) —
NOT a teachable source (that's why A used the queue). But its UPLOAD plumbing is exactly what stage needs and
is already Oracle-vetted (Quick File Q-C1/Q-C2):
- capped streaming reader (a file upload, so the 1 MB `readJsonBody` cap does NOT apply — use intake's capped
  reader with a stage-specific size cap),
- an in-flight cap (its own, e.g. `TEACH_STAGE_MAX_INFLIGHT = 1` — OCR is CPU-heavy; a remote trigger must not
  fan out Python),
- temp path minted + cleaned on completion/error,
- `fileKinds` SAFE-subset validation (PDF + image types only — mirror `fileKinds.isUploadIntake`),
- a PAGE-COUNT cap (reject e.g. > 40-page uploads — a 500-page scan would tie up OCR; the desktop watch/import
  already scales timeout by page count, but a remote trigger wants a hard ceiling).

## Security — the NEW surface B adds beyond A
A opened a remote LEARNING-WRITE surface. B additionally opens a **remote OCR-IMPORT trigger** (an arbitrary
LAN-supplied file → the full `process_docs` pipeline on the core). Threat model:
- **Resource exhaustion** — the primary new risk. Bound: admin-only + entitlement + the same
  `teach_over_client_enabled` switch (default OFF) + in-flight cap 1 + size cap + page-count cap. One remote
  admin cannot spawn concurrent OCR floods.
- **Malicious file crashing pdfium/tesseract** — already isolated (per-process spawn; the import path handles a
  failed read; a crash frees the in-flight slot). No worse than a local import.
- **File bytes crossing** — SAFE-subset + size cap (as above); bytes go to a server temp, never to any
  renderer; path resolved server-side (F-02).
- **Abandoned staged docs** — an admin who stages then never teaches leaves a `needs_review` row in the queue.
  Parity with the desktop teach-import (it leaves it in the queue too); the core operator sees it. Acceptable;
  no new cleanup needed. (Optional later: mark stage-origin rows for a janitor. NOT v1.)
- **Auto-file** — autoFile:false is load-bearing: a staged exemplar must NEVER auto-file, even for a graduated
  supplier+type, or a remote upload could push a document straight to a folder unseen. Pin it.
- Audit every stage (`user_id`, `via:'client'`, `ip`, filename, resulting docId) — mirror intake's audit.

## Client UI
The teach wizard step-1 already has an "Import a document to teach" button (`btn-import-teach`,
`teach/renderer.js:206`). On the client, `caps.import=true` (was false in A-only); the button uploads via
`/v1/teach/stage` (through the client-main token map) instead of `stagePdfForTeach`+`processFolder`. The
provisional "Reading…" card stays; the elapsed ticker stays; the staged-thumbnail preview
(`getStagedTeachThumbnail`) either gets a tiny `/v1/teach/staged-thumb` read OR is simply omitted on the client
(cap-hidden) — the real page render arrives from `/v1/page` once the import completes. Prefer OMIT for v1
(one less route); revisit if the owner wants the instant thumbnail.

## Slice plan change
S4 is no longer DEFERRED — it is a real slice:
- **S4 — client-PC upload-to-teach.** `POST /v1/teach/stage` (admin + entitlement + switch + caps) reusing
  intake's capped-upload plumbing + the desktop import (autoFile:false); client sets `caps.import=true` and
  wires `btn-import-teach` to the stage route. Contract already at 1.7.0 from S1-S3 (adding this endpoint set
  needs no further bump unless it lands before them — sequence it after S3, or bump to 1.8.0 if shipped
  separately). Its own `/v1` route pin in `test_v1_teach.js`.

## Test additions
- `test_v1_teach.js` stage cases: auth (edit → 403 if admin-gated; unentitled 402; switch off 409); a
  non-PDF/oversize/too-many-pages upload → 4xx refused; happy path → ONE `needs_review` row, NOT filed, correct
  docId returned; in-flight cap (a 2nd concurrent stage → 429); autoFile:false PINNED (a graduated supplier+type
  upload still lands in review, never filed).
- Parity harness: the `--client` teach run can start from an UPLOAD (stage) as well as a queue pick.

## Open question for the combined Oracle follow-up
- Is `TEACH_STAGE_MAX_INFLIGHT=1` + size + page-count the right ceiling, or does stage need a per-user/day
  quota too (a remote admin re-uploading in a loop)? Likely the in-flight cap + audit is enough for a trusted
  admin on a licensed LAN; confirm.
- Admin-only vs isWriter for stage: A's COMMIT is admin-only. Stage merely imports-to-review (no learning
  write) — arguably isWriter (edit) is enough, matching the desktop where an edit user can import to teach.
  BUT stage is the OCR-flood surface; gate it admin-only for v1 to keep one gate across the whole teach
  feature, revisit if the owner wants edit users to bring docs. RECOMMEND admin-only for v1.

## Oracle B conditions (2026-09-14) — SIGN OFF WITH CONDITIONS C8-C14 (gate S4)
- **C8** the /v1 stage drives the SAME auto-file gate with `autoFileRun=false` (`process-folder` is an IPC
  handler — NOT reusable verbatim; extract/invoke the batch path with a no-op progress sink); pin `autoFile:false`
  via the /v1 route incl. a GRADUATED scope.
- **C9** return the docId captured from the import (`_handleFileMessage` `msg.db_id`), NOT the desktop
  filename-pick (`teach.js` — fragile under duplicate names).
- **C10** in-flight decrement + temp-FOLDER cleanup leak-proof on every path (mirror intake `finish()`+done-guard
  +`req.on('aborted'|'error')`); clean temp AFTER the import; the /v1 in-flight counter releases in a `finally`
  (separate from the worker watchdog).
- **C11** page-count HARD cap via a cheap `render/pages.py` count PRE-PROBE BEFORE the OCR spawn.
- **C12** mark stage-origin rows ("staged for teaching by <user> via client") + a clear "already filed —
  re-import to teach" message on the commit race (not a generic 400).
- **C13** admin-only AFFIRMED (edit-only stage = dead-end half-capability + it is the OCR-flood surface);
  record the deliberate desktop(edit)-vs-/v1(admin) asymmetry.
- **C14** ACCEPTED RESIDUAL: a sequential upload loop pegs the one OCR slot — bounded by in-flight=1 + watchdog
  + audit + the OFF switch; no quota for v1.
- **S4 gate:** `test_v1_teach.js` stage pins (auth matrix incl. edit→403; 415/413; too-many-pages rejected by
  the pre-probe before OCR; happy = ONE `needs_review` NOT filed + returned id == created row; 429 + slot frees;
  `autoFile:false` pinned for a graduated scope via /v1). No realdoc M=0 for B.
