# Scan Finder — Overnight Adversarial QA Audit (2026-07-02)

> **STATUS 2026-07-02 — ALL 11 FINDINGS FIXED + TESTED.** Every item below is now
> resolved in code. New shared helpers: `database/modules/slug.js` (`safeSlug`/
> `uniqueSlug`, closes #7/#9 root cause) and `src/modules/path_overlap.js`
> (`foldersOverlap`, #8). New/updated tests: `database/modules/test_slug.js`,
> `src/services/test_backup_retype.js` (#1), `src/modules/test_path_overlap.js` (#8),
> extended `src/modules/filing/test_filename_pattern.js` (#10). See CLAUDE.md's
> "Known bugs" → "RESOLVED QA FINDINGS" for the per-item landing notes. The report
> body below is preserved as the original findings record.


**Goal:** find ways a user can break or corrupt the software, or footguns/glitches the UI
allows — *without changing any code*. Everything below is a read-only trace of the code;
**no source was modified.** Nothing here has been fixed — this is a findings report for you
to prioritise.

**Method:** a veteran-tester audit pass over the highest-risk surfaces, plus specialist
consults — **eric** (Electron/IPC/lifecycle/restore), **reggie** (slug/key sanitisation),
**bob** (product/UX calls) — and my own read-only verification (Node/SQLite/grep). Issues we
already found and fixed *this session* (garbled ⊕ labels, dangling structural role, type-change
teaching leak, terms-gate dead-end, onboarding data-mode collision, theme dropdown, learning-
recovery refresh) are **excluded** — these are all NEW.

**Status key:** `CONFIRMED` = exact code path traced. `PLAUSIBLE` = strong code-grounded
suspicion needing a live check. Ranked most-dangerous-first (data corruption / silent
wrong-filing / unrecoverable dead-ends before cosmetic).

---

## Executive summary — fix in this order

1. **[HIGH] Backup restore silently re-types documents, or aborts with an opaque error.**
2. **[HIGH] A document type with no Reference (or no Date) role can NEVER be confirmed — permanent dead-end.**
3. **[HIGH] "Reprocess" silently discards all in-progress manual edits + the chosen type — no warning.**
4. **[MED-HIGH] Batch processing freezes every window: a synchronous Python `spawnSync` + big `copyFileSync` run on the main thread.**
5. **[MED] "File All Ready" bulk race — deleting/clicking a row mid-run can file the WRONG document.**
6. **[MED] Empty "Document Issuer" files silently into "Unknown Company" and degrades learning.**
7. **[MED] Non-Latin / emoji / symbol-only type names collapse to slug `"_"` → UNIQUE collision + cryptic error.**
8. **[MED] Watch folder overlapping the output folder (flat pattern) → re-import loop / unbounded `-DUPLICATE` growth.**
9. **[LOW] `buildXml` throws on a malformed field key → orphan output file + doc stuck in review.**
10. **[LOW] A supplier value that sanitises to empty drops the company folder level.**
11. **[LOW] Search date range has no From > To guard.**

Plus a cross-cutting root cause behind #7/#9: **five different slug/key derivations disagree**
(see reggie's canonical rule at the end).

---

## HIGH

### 1. Backup restore silently re-types documents (or aborts opaquely) — `CONFIRMED`, data integrity
- **Surface:** `src/services/backupService.js` `applyBackup()` (~L132-177); `database/index.js` FKs.
- **Likelihood:** Medium — the DB persists across reinstall (`deleteAppDataOnUninstall:false`), so restore routinely runs on a machine that still holds `documents`.
- **What breaks:** `foreign_keys=ON` globally (`database/index.js:18`); `applyBackup` adds
  `defer_foreign_keys=ON` (postpones enforcement to COMMIT, does **not** disable it). It does
  `DELETE FROM …` then re-INSERT `document_types`/`fields`/`templates` with their **original
  ids**, while `documents` is **excluded** from backup. `documents` holds FK edges into those
  tables (`document_type_id→document_types`, `template_id→templates`) and `templates.sample_document_id→documents`
  points the *other* way (restored table → excluded table). Two outcomes, both bad:
  - **(a) Opaque abort** — if a surviving document references a type/template id not present
    after restore, or a restored `templates.sample_document_id` points at a doc id that
    doesn't exist here (very likely cross-machine), the deferred check fails at COMMIT →
    `FOREIGN KEY constraint failed`, whole restore rolls back with a meaningless error.
  - **(b) Silent re-type** — where a document's `document_type_id` still *exists* in the
    restored set but now maps to a **different** type (local id 2 = Invoice, backup id 2 =
    Sales Order), the FK check passes (existence, not identity) → the document is silently
    re-typed → wrong filing folder + wrong field schema, no error.
- **Failure mode:** silent document mis-typing, or a restore that always fails on a populated DB.
- **Fix direction (eric):** stop delete-by-id + reinsert-original-id for any parent an *excluded*
  table references. Restore `document_types` by **UPSERT on `slug`**, `fields` on `(type,key)`,
  preserve existing parent ids so surviving `documents` FKs stay valid, remap child refs
  (templates/mappings) via an old→new id map, and NULL a `templates.sample_document_id` whose
  referent is absent. Translating the FK error to English is a band-aid for (a) and does nothing
  for (b) — only the natural-key approach is correct.

### 2. A type with no Reference (or no Date) role can NEVER be confirmed — permanent dead-end — `CONFIRMED`
- **Surface:** `src/windows/review/renderer.js` `validateConfirm()` (~L1352-1385).
- **Likelihood:** Medium — any custom type keyed only by a date (delivery note, worksheet), or a
  type whose ref role was self-healed to NULL after the Reference field was deleted.
- **What breaks:** `refKey = dt?.ref_field_key || 'invoice_number'` (L1354) and
  `dateKey = dt?.date_field_key || 'invoice_date'` (L1353). With no ref/date role, it falls back
  to the literal `invoice_number`/`invoice_date`, which don't exist on a custom type → the
  dangling-role branch fires and **permanently disables Confirm** ("Reference field isn't set
  up") — with nothing valid to choose, because the type legitimately has no reference. This
  directly contradicts `document_types.js ensureStructuralRoles` (~L280-306), which *deliberately*
  refuses to force a reference role ("gating a reference on a type that has none trains operators
  to enter junk"). The UI re-imposes exactly what the backend chose to avoid — as a dead-end.
- **Failure mode:** unrecoverable dead-end; the only "escape" is to designate an arbitrary wrong
  field as the reference (the junk-training the backend avoids).
- **Fix direction (bob):** honour the type — require a reference/date only when the role is
  *actually assigned* (`refKey = dt?.ref_field_key || null`; skip when null). Keep the dangling
  warning only for a role that IS set but points at a missing field. Apply to both ref and date.

### 3. "Reprocess" silently discards in-progress manual edits + the chosen type — `CONFIRMED`, work loss
- **Surface:** `src/windows/review/renderer.js` btn-reprocess (~L3157-3165), reprocess-all (~L3310-3320).
- **Likelihood:** High — "Reprocess with Learned Data" reads like "apply my learning", so users
  click it *after* correcting fields.
- **What breaks:** on success the handler does `corrections = {}`, re-renders fresh DB fields, and
  `syncDocTypeFromRecord` re-selects the auto-detected type — with **no unsaved-edits guard and no
  warning**. Every hand-typed correction and the manual type override is wiped.
- **Failure mode:** silent loss of review work.
- **Fix direction:** if `Object.keys(corrections).length` (or a manual type change) is pending,
  `confirm()` a warning before reprocessing; or merge fresh extraction only over *untouched* fields.

### 4. Batch processing freezes every window — synchronous work on the `file_done` path — `CONFIRMED`
- **Surface:** `src/modules/processing/handler.js` — stdout `data` handler loops buffered lines
  synchronously (~L668, L686); `ensureWorkingCopy`→`copyFileSync` (~L1696, L1910);
  `_rotateWorkingCopyIfNeeded`→`spawnSync(pdf_rotate.py)` (~L1782, `timeout:30000`).
- **Likelihood:** Med-High — auto-rotate is ON by default, common on scanned input; concurrency up to 5.
- **What breaks:** DB writes are small/indexed (fine). The freeze is **synchronous file + process
  work on the main thread**: multi-MB `copyFileSync` per source PDF (tens-hundreds of ms each) and
  — the worst — a **synchronous Python cold-start** (`spawnSync pdf_rotate`) per rotated doc,
  freezing Review/Settings/main and queuing all IPC for its duration. (Auto-file moves are
  correctly deferred via `setImmediate`; the working-copy + rotate were left synchronous.)
- **Failure mode:** child windows go unresponsive for hundreds of ms to seconds during a batch.
- **Fix direction (eric):** keep DB writes synchronous; move the file copy (`fs.copyFile` async)
  and the `pdf_rotate` `spawnSync` off `file_done` — async `spawn` deferred via `setImmediate`/a
  small queue, exactly as `_maybeAutoFile` already does, chained before auto-file.

---

## MEDIUM

### 5. "File All Ready" bulk race — a delete/row-click mid-run files the WRONG doc — `CONFIRMED`
- **Surface:** `src/windows/review/renderer.js` `fileAllReady()` lock (~L2225), `btn-delete` (~L2540),
  per-row `×`→`deleteFromQueue` (~L2563), `confirmCurrentDoc` reads module-global `currentDoc` (~L2056).
- **Likelihood:** Low-Medium — needs a user click inside the bulk-run window.
- **What breaks:** the lock disables only file-all/skip/defer/delete-all — NOT the single Delete,
  per-row `×`, or a queue-row click. The loop does `await selectDoc(doc)` then
  `await confirmCurrentDoc({bulk:true})`, which reads `currentDoc` (not the loop's `doc`). A delete
  or row-click landing in the await gap reassigns `currentDoc` → the confirm files the **wrong**
  document, and the tail `queue = queue.filter(d=>d.id!==currentDoc.id)` drops the wrong row. The
  pre-check `if(!queue.some(d=>d.id===doc.id)) continue` runs *before* the awaits, so it doesn't
  guard the gap.
- **Fix direction (eric):** add Delete/`×`/row-selection to the bulk lock; PLUS a reusable
  `expectId: doc.id` arg to `confirmCurrentDoc` that bails if `currentDoc.id !== expectId` before
  the confirm IPC (protects every caller).

### 6. Empty "Document Issuer" files silently into "Unknown Company" + degrades learning — `CONFIRMED`
- **Surface:** `validateConfirm` requires only `[dateKey, refKey]` (~L1378); filing fallback
  `filing/handler.js` (~L100); learning scope → `__global__` (`learning.js` ~L133).
- **Likelihood:** Medium.
- **What breaks:** the identity field (supplier/customer, "Document Issuer", `required=1`) is never
  checked by the gate, so Confirm is enabled with a blank issuer → the doc files under
  "Unknown Company/…" and per-supplier learning silently falls back to global scope. Contradicts the
  field's `required` flag.
- **Fix direction (bob):** warn-and-allow (the app's "review, don't reject" posture) — an amber
  notice naming the consequence ("Issuer is blank — files under 'Unknown Company', won't learn this
  sender") + a deliberate confirm-anyway, rather than a hard block or today's silent pass.

### 7. Non-Latin / emoji / symbol-only type names → slug `"_"` → UNIQUE collision + cryptic error — `CONFIRMED`
- **Surface:** `database/modules/document_types.js` `addType()` (~L198), `create-doc-type-with-fields`,
  `presetSlug` (~L449); reachable from Review's "new type" modal and Settings.
- **Likelihood:** Low-Medium (non-English installs).
- **What breaks:** slug = `name.toLowerCase().replace(/[^a-z0-9]+/g,'_')` with no edge-trim/fallback.
  Verified: `"发票"`→`"_"`, `"###"`→`"_"`, `"📄 Receipt"`→`"_receipt"`. Two symbol/non-Latin names both
  collapse to `"_"` → `UNIQUE constraint failed: document_types.slug`, surfaced as a generic error
  string. Empty/`"_"` slugs also collide with label-override scope + filing tokens.
- **Fix direction (reggie):** one shared `safeSlug` (NFKD-fold → collapse → trim → length-cap →
  non-empty fallback → uniqueness suffix) used by every derivation site; friendly "name too similar"
  message instead of the SQLite text. (See canonical rule below.)

### 8. Watch folder overlapping the output folder (flat pattern) → re-import / unbounded `-DUPLICATE` growth — `CONFIRMED` mechanism
- **Surface:** `src/modules/watch/handler.js` `_setFolder` (~L402) has NO overlap validation; scan is
  non-recursive (`entry.isFile()` skips subdirs, L169).
- **Likelihood:** Low-Med — needs a *flat* output pattern (no `{supplier}/{year}/{month}`) AND
  `watch_folder == output_folder`.
- **What breaks:** non-recursive watch protects sub-foldered output. But with a flat output pattern,
  filed copies land as **top-level files** in the watched folder → re-detected → re-imported → filed
  as `-DUPLICATE` (a *new* filename, so `_tracked` doesn't skip it) → `-DUPLICATE-2` → … unbounded
  duplicate growth. Also: manually importing the output folder re-processes filed docs.
- **Fix direction:** validate that `watch_folder` (and the manual import folder) is not equal to /
  inside / a parent of `output_folder` (and the drain `Processed/` folder); warn on overlap.

---

## LOW

### 9. `buildXml` throws on a malformed field key → orphan output file + doc stuck in review — `CONFIRMED` crash
- **Surface:** `src/modules/filing/handler.js` `buildXml()` (~L273): `key.split('_').map(w=>w[0].toUpperCase()+w.slice(1))`.
- **What breaks (verified in Node):** any key with an empty segment — `"ref__"`, `"amount_"`, `"_"`,
  `"__x"` — makes `w[0]` `undefined` → `TypeError`. It runs at filing **step 6, AFTER the file copy
  (step 5)**, with no try/catch, so `reviewService.confirm` rolls the doc back to `needs_review` but
  **leaves the physical copy** in the output tree. `addField`'s key sanitiser
  (`replace(/[^a-z0-9_]/g,'_')`, L207) is non-collapsing/non-trimming, so such keys are reachable via
  raw `add-field` IPC, `src/database.js:215 addCustomField`, or restored/legacy rows.
- **Failure mode:** orphan files accumulate + doc stuck with "Confirm failed. Check settings." on retry.
- **Fix direction (reggie — smallest, highest-value):**
  `const tag = key.split('_').filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join(''); if(!tag) continue;`
  — plus optionally wrap the `buildXml` call in try/catch so any XML defect can't strand a copied file.

### 10. A supplier value that sanitises to empty drops the company folder level — `CONFIRMED`
- **Surface:** `filing/handler.js` folderValues (~L138-144) + `filename_pattern.buildFolderSegments`.
- **What breaks:** the `'Unknown Company'` fallback only fires when `supplier_name` is *falsy* (~L100).
  A non-empty value that sanitises away — `".."`, `"///"`, `"***"` — passes it, reduces to `""`, and
  `.filter(Boolean)` drops the level → docs land in `OutputRoot/Year/Month/` with no company folder
  (contained by the output-root check, so misfiling not traversal).
- **Fix direction:** if the resolved `{supplier}` level is empty, substitute `Unknown Company` rather
  than dropping the level.

### 11. Search date range has no From > To guard — `CONFIRMED` (minor)
- **Surface:** search window / `src/modules/search/handler.js` — no ordering validation on
  `dateFrom`/`dateTo`.
- **What breaks:** a From later than To simply returns nothing with no hint. Low impact; a small
  inline "From is after To" note would help.

---

## Cross-cutting root cause — slug/key derivation is inconsistent (reggie)

Five sites derive a slug/key with **different** rules; only two are correct. This is the root of
#7 and #9.

| Site | Rule | Missing |
|---|---|---|
| `document_types.js:198` `addType` | collapse | trim, fallback, cap, uniqueness |
| `document_types.js:207` `addField` | **non-collapsing** | collapse, trim, fallback |
| `document_types.js:449` `presetSlug` | (mirror addType) | same as addType |
| `src/database.js:215` `addCustomField` | **non-collapsing** | collapse, trim, fallback |
| `src/modules/settings/handler.js:63` inline slug | **non-collapsing** | collapse, trim (→ ref/date role can fail to bind) |
| `src/windows/shared/doctype-editor.js:62` `slugify` | collapse + trim | fallback, cap |
| `database/modules/templates.js:412` | collapse + trim + fallback ✓ | (reference impl) |
| `database/modules/learning.js:316` | collapse + trim ✓ | (reference impl) |

**Canonical rule (reggie):** one shared `safeSlug(input,{fallback,maxLen,reserved})`:
`NFKD-normalize → lowercase → [^a-z0-9]+→'_' → trim edge '_' → slice(maxLen)+re-trim → non-empty
fallback → optional reserved-word prefix`; caller adds a live-table uniqueness suffix loop.
Target shape `^[a-z0-9]+(_[a-z0-9]+)*$`. **Do NOT re-slug existing rows** without a migration —
learned scope (anchors/hints/label-overrides) keys off the slug.

---

## Product calls for the owner (bob)

- **No-reference types (#2):** *honour* a type with no reference role — require only what's actually
  designated (recommended), rather than forcing every type to have a reference.
- **Empty issuer (#6):** *warn-and-allow* with a named acknowledgement — stronger than reference
  (issuer drives folder + learning), but not a hard block (respects OCR edge cases + review-not-reject).

---

## Checked and found SOUND (not defects)

- The atomic confirm claim (`documents.confirmIfReviewable`) correctly prevents double-file; the loser
  gets `ALREADY_FILED`.
- Learning scope correctly prefers the edited `allValues.supplier_name` over the stale pre-confirm
  identity — correcting a supplier doesn't split the corpus.
- Path traversal in supplier/folder tokens is contained (edge-trim + output-root `resolve` guard).
- Staged ⊕ anchors / field rules are correctly discarded on doc-change and type-change.
- Backup crypto (scrypt + AES-256-GCM) fails cleanly on wrong password/tamper; licensing keys excluded.
- Window lifecycle: "Object has been destroyed" is guarded (`safe-send.js` + `isDestroyed()`); double-open
  de-dupes; stale refs cleared on `closed`. (Minor: a few raw `webContents.send` at `main.js:284/1055/1107`
  should use `safeSend` for consistency — each is already try/catch-wrapped, so not a bug.)
- Delete-All-Review is admin-only + confirm-gated; document types aren't UI-deletable (no delete-type IPC),
  so "delete a type with documents" isn't reachable.
- **Corrupt / zero-byte / malformed PDF import** — sound: `process_docs.py`'s per-file loop wraps each
  file in try/except (~L310-537), emits a `status:error` doc, and CONTINUES the batch — one bad file
  can't kill the run. (Residual, unverified: a NATIVE Tesseract/pdfium segfault or an OCR *hang* on a
  pathological page would kill/stall the worker — there's no per-file timeout — but that needs a crafted
  file to confirm; lower priority.)
- **Licensing clock-rollback** — sound: expiry uses `effectiveNow = max(now, high-water-mark)`
  (`src/lib/license/token.js:104`; HWM persisted + advanced in `licensing/handler.js`), so winding the
  system clock back cannot extend a trial/seat.
- **SQL injection** — sound: `documents.search()` (~L318) appends only fixed clause strings and binds all
  user input via named parameters (`@company`/`@reference`/`@fullText`); `_clearDanglingDocRefs`'s
  interpolated `whereSql` is a developer-controlled literal, never user input. No string-concatenated
  user values reach a query.

---

*No code was changed in producing this report. Each item lists a fix DIRECTION only — decide what to act on.*

## Audit coverage
Surfaces traced: Review (confirm gate, ⊕ teaching, bulk File-All, reprocess, delete), Document Types &
Fields (slug/key derivation, structural roles), Filing (buildXml, folder/filename tokens, duplicates),
Learning/extraction poisoning, Backup/Restore (crypto + FK integrity), Import/Watch (corrupt files, folder
overlap), processing event-loop + window lifecycle, Licensing (clock-rollback), Search (injection). Lower-
risk surfaces given lighter coverage: the detached `/v1` client API depth, onboarding folder-writability
edge cases, help-mode — candidates for a follow-up pass.
