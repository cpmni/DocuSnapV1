# Feature internals (first-run · backup · learning repair · teaching · dev inspector) — extracted from CLAUDE.md
> Deep reference split out of the always-loaded CLAUDE.md (2026-07-03) to keep the root
> memory lean. Read this when a task touches this area. Nothing here was changed — verbatim move.

## First-run wizard (clean-install setup)
`src/windows/onboarding/` — a linear setup wizard shown ONCE on a clean install,
AFTER the licensing gate allows (so a locked user never sees it). Gated by the
`first_run_completed` setting (`!== 'true'` → show); migration 24 stamps the flag
on any already-configured DB (has an `output_folder`) so existing users are never
re-onboarded — NEVER infer "clean install" from empty state.
- **Gate/flow (main.js):** `enterMainApp()` → gate `allow` → `needsOnboarding()` →
  `showOnboarding()` (else `openMainShell()`). `onboarding-complete` sets the flag
  + opens the shell, then (FIRST RUN only) seeds the default `dashboard_hidden_cards`
  (hides Quick find / Filed automatically / Storage / Backup / Search clients — only
  when unset, never overwriting a user's choice) and shows the WELCOME TOUR (below).
  `open-onboarding` (admin) re-runs the setup wizard from Settings → **Advanced**
  ("Re-run setup"). Reads fail-open — a read error never blocks app entry.
- **Welcome/familiarisation TOUR** (`src/windows/welcome/{index.html,renderer.js}`):
  a SEPARATE 6-card concepts carousel (1 what it's for · 2 how it works + offline/
  private · 3 one document TYPE → many layouts · 4 teach by drawing a box around the
  value · 5 Review→Confirm files+teaches, high-confidence auto-files · 6 You're ready
  → "Go to Import"), shown ONCE after the setup wizard on first run, gated by its OWN
  `welcome_seen` flag (separate from `first_run_completed`). An OWNED non-modal child
  of the main window (in CHILD_WINDOWS + NON_MODAL_CHILD → stays above the core app,
  focuses on first paint — a standalone window sank behind the shell). `welcome-done`
  sets the flag (+ action `'import'` messages the Home shell `welcome-goto-import` →
  `showView('import')`); reopenable any time via the user-menu "Show welcome tour"
  (`open-welcome`). Read-only/teaching — writes no settings. Content per bob's outline.
- **Steps (6):** welcome + offline/privacy note → **output folder** (the ONLY
  required step: pre-filled `Documents\Scan Finder` via `onboarding-suggested-folder`,
  write-validated by `onboarding-validate-folder` which mkdirs + probes; ALSO carries
  the **"Copy processed scans to another folder?"** question) → **output
  organization** (the same folder + filename block builders as Settings → Output
  Structure, pre-filled with defaults) → theme (light/dark, live) → performance
  (threads presets + speed/accuracy mode) → done. "Skip setup" accepts defaults but
  still secures a writable output folder. (Adding a step = bump STEPS + NEXT_LABEL
  and renumber the `data-step` panels in onboarding/index.html.)
- Writes go through the EXISTING `set-setting` path (theme broadcasts live via
  `theme-changed`); the wizard owns only the FLAG + the window/shell swap. The
  output-organization step writes `output_folder_pattern` + `filename_pattern`.
- **Copy-after-processing** (`copy_after_processing_enabled` / `_folder` settings):
  the wizard collects the toggle + destination, but the DOWNSTREAM copy behaviour is
  a deliberate SEPARATE follow-up — nothing consumes these keys yet (the deferred
  "backup-with-retention" subsystem is the real copy+prune workstream, NOT a phantom
  toggle).

---

## Settings backup / restore (admin)
`src/services/backupService.js` + Settings → **Advanced → Backup & Restore**. Exports
the operational config to ONE password-encrypted file and restores it after reinstall.
- **Crypto**: scrypt KDF → AES-256-GCM over gzipped JSON (authenticated, so a wrong
  password / tampering fails cleanly). Binary file `MAGIC|ver|salt|iv|tag|ciphertext`;
  password never stored. No new dependency (node `crypto`).
- **Scope INCLUDED**: settings (minus any `licens*` key), document_types, fields,
  templates + template_fields/field_mappings/landmarks/logo_hashes/groups,
  field_label_overrides, field_anchors, supplier_hints, corrections, logo_fingerprints.
  **EXCLUDED**: users, recovery_codes, audit_log, device_registrations, license_tokens,
  client_seats, document_routes, documents, extractions, migrations.
- **Restore**: ONE transaction with `PRAGMA defer_foreign_keys=ON`; `settings` is
  MERGED (upsert — never wipes device/licensing keys), every other whitelisted table
  is REPLACED (delete + insert with original IDs). Two-step UI: preview(decrypt+counts)
  → confirm → apply; restart recommended. Forward-compatible (only restores columns
  that still exist). Guarded by test_backupservice.js.
- **DEVICE-BOUND IMPORT (anti-trial-stacking)**: the export embeds the licensing device
  fingerprint (`device_fp` = `computeFpHash(product_id)`, already a SHA-256 — never the raw
  machine id) in the payload. On import (`-preview` AND `-apply` both gate, via
  `settings/handler._deviceImportAllowed`), a backup from a DIFFERENT machine is REFUSED
  unless THIS machine holds an active paid SEAT (`licensing.getActiveToken().kind==='seat'
  && state!=='revoked'`) — so a fresh trial on a new VM/PC can't import another machine's
  learned data/settings to dodge the trial, but a paying customer can still migrate to a new
  PC (activate there first, then import). Same-machine restore (matching fp) always allowed;
  legacy backups (no `device_fp`) and dev boxes with no license config are NOT blocked. A
  denied apply is audited (`outcome:'failure', reason:'device_mismatch'`).
- IPCs (admin): `settings-backup-export` / `-preview` / `-apply`.

## Learning Repair (admin) — un-poison a document type
Settings → **Learning Repair** (`panel-repair`, its OWN Administration tab; NOT an add-on to
Learning). The foolproof tool for when a type "learns wrong": browse a type's confirmed docs,
SEE each one, and send a bad one back to Review. **Design principle (bob):** the tool never
decides — it draws the eye to a few candidates and the human looks at the picture and decides;
auto-detection is *"worth a look,"* never *"this is wrong."* The primary action is low-stakes
because Review is a safe holding area (send a good doc back by mistake → just re-confirm it,
**replace-in-place, no -DUPLICATE**).
- **Grounding fact:** learning is DERIVED LIVE from `confirmed` docs (`getFieldFormats` filters
  `WHERE d.status='confirmed'`), so the ONLY way to stop a doc poisoning the model is to move it
  OFF `confirmed` — clearing learning tables alone doesn't un-poison. Hence de-confirm/soft-delete
  are the real levers, not just "forget learning".
- **Backend send-to-review + replace-in-place:** `documents.deconfirmDocument(db,id)` →
  `status='needs_review'`, nulls `confirmed_at`/`confirmed_by_username` but **KEEPS
  `stored_path`/`stored_filename`** (their presence on a needs_review doc = the "previously filed"
  signal). `reviewService.confirm` captures `oldStoredPath = docRow.stored_path` **regardless of
  status** BEFORE the claim (which nulls it) and re-files IN PLACE (`isRefile` when a prior
  stored_path exists + `payload.allowRefile`), so a sent-back doc overwrites its original copy
  instead of minting `-DUPLICATE`. A never-filed needs_review doc has no stored_path → byte-identical
  to today. De-confirm respects the workflow `editGuard` (a doc with an open route can't be sent
  back). Guarded by `src/services/test_reviewservice_refile.js`.
- **Suspect detectors — `src/services/repairSuspects.js`** (precision-first, JS-only, every rule an
  AND-gate + thin-evidence gate so a GOOD doc is never force-flagged). **SCOPE SPLIT (2026-07):**
  "might not belong" is a WHOLE-TYPE judgement — an outlier is BY DEFINITION a different supplier
  from the norm, so Detector A + the outlier field-explanations run on the FULL type pool (the
  supplier filter is IGNORED for them); only Detector B (per-value anomalies) stays scoped to the
  supplier CONTAINS filter for per-supplier format precision. This fixed the "outliers don't show
  up when I search a supplier" bug (a supplier filter used to collapse the comparison pool below the
  ≥8-phash gate). **Detector A — outlier docs** ("might not belong"): single-link
  phash cluster at Hamming ≤10; needs ≥8 usable phashes (SKIP null/short — `hammingDistance` returns
  64 on those, a trap), a legit cluster is ≥3 docs OR ≥15% of pool (multi-modal guard for suppliers
  with 2-3 layouts), an outlier needs a tiny cluster + >16 Hamming to nearest legit + keyword
  Jaccard <0.30. **`explainOutlierFields`** then points at WHICH of an outlier's fields look off +
  why (reused per-field `kind:'data'` reasons) by comparing each value to the type-wide dominant
  shape (structured/ref fields → "formatted differently from this type's usual '…'") or name quality
  (name fields) — so the fields panel shows an inline amber note under the offending field, not just
  a whole-doc verdict. **Detector B — anomalous values** ("data looks off"): B1 off-shape singleton vs a
  single dominant shape (≥80%, `shapeSignature` = digit→#/letter→@/sep literal) — carries an
  `example` (a value matching the dominant shape, shown as "the others usually look like …"); B2
  garbled name (`nameQuality<0.5` + multi-token + singleton, with a RECURRENCE EXEMPTION —
  `value_counts≥2` never flagged, names/addresses vary legitimately); B3 disallowed charset
  (U+FFFD/control chars, or letters in currency/number). Per-scope gate `confirmedCount≥6`.
  **`isRefLike` key-role coercion** (mirrors engine `_is_ref_field`: `*_no`/`*_number`/`*_ref`/
  `reference`): a ref field typed plain `text` (the built-in ref fields ARE — migration 3) is still
  shape-checked by BOTH Detector B and `explainOutlierFields`, else `invoice_number` `152888` (6-digit)
  vs the type's usual 5-digit shape would never flag.
  `computeSuspects` → `{ byId:{ [id]:{ reasons:[{kind:'belong'|'data', field?, value?, example?, text}], severity } }, count }`
  (dedupes to one reason per field; outlier detection on the full pool, Detector B on the scoped pool).
  Guarded by `src/services/test_repair_suspects.js`.
- **IPC (admin) — `settings/handler.js`:** `repair-overview({document_type_slug, supplier_name?})`
  → `{scope, confirmedCount, documents, suspects}` — `confirmedCount` = the supplier-scoped browse
  pool, but full-type-pool outlier docs (a DIFFERENT supplier than the filter) are UNIONED into
  `documents` (`documents.getConfirmedDocsByIds`) so a supplier search still surfaces + can open them;
  `repair-doc-fields(id)` → `{fields:[{field_key,value}]}` the CONFIRMED per-field values
  (`documents.getConfirmedFieldValues`: correction wins over the raw OCR read, so the fields panel
  shows the confirmed `152888`, not a superseded misread `"St"`); `repair-deconfirm(id)` (editGuard-checked,
  audited `repair_send_to_review`, broadcasts `review-count-changed`); `repair-delete(id)`
  (`documents.softDelete` → recycle bin, undo via existing `recovery-restore-docs`). Preload:
  `repairOverview/DocFields/Deconfirm/Delete`.
- **UI — `panel-repair`** (`settings/index.html` + renderer `repairInit`/`rpLoad`/`rpRenderList`/
  `rpSelect`/`rpShowPage`/`rpRenderFields`/`rpRenderSuspectStrip`): type picker ("Learned from N
  documents") + a **CONTAINS supplier filter** (partial company name; `LIKE '%term%'` in BOTH
  `getConfirmedDocsForScope` AND `computeSuspects` — NOT exact) → a "Worth a look" strip (merged
  A+B suspects) + a master list with **Up/Down arrow nav** + a **zoom/pan preview pane** (page image via
  `get-document-pages`, ‹ › multi-page; **scroll-wheel to zoom, right-mouse-button drag to pan — no
  grab**, mirrors the Review preview; resets to fit on each doc via `rpResetView`) beside a
  **field-values panel** (`rpRenderFields` fetches `repair-doc-fields` for CONFIRMED values;
  every field's value listed, flagged fields amber + reason/example inline, whole-doc "belong"
  reasons in a top box). Actions: **Send back to Review** (primary) ·
  **Delete** (recycle bin) · **Looks fine ✓** (session-only dismiss). "Start over for this type
  (advanced)" (forget learning / requeue whole type via `recovery-apply`) is collapsed at the very
  bottom behind a confirm. **Preview/thumbnail file args:** confirmed docs resolve the FILED copy
  via `rpFileArgs(doc)` (stored_path dir + stored_filename, mirrors `tplFileArgs`/search `fileArgs`)
  — `thumbs.js` short-circuits to NO thumbnail on a falsy `folder_path`, so passing `''` silently
  broke thumbnails; `getConfirmedDocsForScope` now returns `stored_path`/`folder_path`/`working_path`
  for this. NOTE (superseded 2026-07): outlier detection used to be scope-dependent, so a true outlier
  of a DIFFERENT company was hidden under a company search — now Detector A runs on the full type pool
  and the handler UNIONS those outlier docs into the browse list, so they surface regardless of the
  supplier filter (Detector B's per-value flags stay supplier-scoped).


## Teaching wizard (guided, non-technical)
`src/windows/teach/` — a dedicated, linear "Teach a new document" wizard for
first-time/non-technical users; opened from the main launchpad card "Teach a
document" (Admin+Edit) or `open-teach-window-at(docId)`. Steps: welcome → choose
the scanned doc (from the review queue) → pick or CREATE a doc type (friendly
field setup + plain-English "main number"/"date" key questions) → point out each
field by drawing a box around its VALUE (live OCR read-back; the wizard
auto-detects the nearby label as the anchor) → review → commit → honest learning
explainer.
- **Auto-flow (2026-06):** after a value read-back is confirmed it auto-advances
  value → anchor → next field (no manual "mark the label"; "Skip label →" keeps the
  auto-detected anchor). A field that doesn't vary per document can be set as a
  **fixed value** (inline text, no drawing) → saved on commit via
  `setTemplateFieldFixed` (locked, survives rebuild — see Admin-LOCKED fixed values).
  `autoLabel()` requires ≥3 alpha chars from the left band (drops noise). Field type
  selector offers Text/Date/Currency/Number. (All curly-quote HTML attrs must stay
  STRAIGHT — smart quotes silently break the injected buttons' class/id.)
- **Artifact (per Oscar):** each field is saved as a Stage 0.5 anchor→target
  MAPPING (value-box-only; auto-label), so it works on document #1 and
  registration covers drift — NOT a Stage 2 ⊕ anchor (avoids two competing
  artifacts).
- **Commit sequence (deferred until the last step so Back/Cancel are safe):**
  `promote-to-template` (creates the template + pins this page as the sample →
  auto-generates landmarks) → `save-template-mapping` per field →
  `confirm-review` (files + learns). Reuses existing IPC; the only new backend is
  `create-doc-type-with-fields` (transactional). The dense Review renderer is
  untouched — the teach window has its own small canvas drawer.

---

## Dev inspector (hidden, read-only)
Hidden developer tool for diagnosing extraction. **Read-only — no DB writes, no
learning, no mutation; invokes no role-protected handler.**
- **Open**: in the MAIN window press **Ctrl+Shift+D then M** (~1s, ignored in text
  fields) → password modal → main checks `=== 'SFDEV'` (`dev-inspector-unlock`,
  pw never logged) → opens `src/windows/dev-inspector`. Available in dev AND
  packaged, gated only by the password.
- **UI — "answer-first" provenance view** (`src/windows/dev-inspector/{index.html,
  renderer.js}`, renderer-only; uses only existing IPC, touches no main-app code):
  three-column shell — LEFT a **session-docs card picker** (in-memory registry,
  resets on restart; filter box + "Follow live document" toggle; coloured status/
  type chips + mini confidence bar; reprocess temp-names `reprocess_<ms>.<ext>`
  prettified to `↻ Reprocess HH:MM:SS`), CENTER the per-field provenance area,
  RIGHT live status (current file/activity/progress) over a page-evidence pane.
  Raw log demoted to a collapsed bottom drawer.
- **Telemetry mirror**: `processing/handler.js` ADDITIVELY tees `process-progress`/
  `reprocess-progress` to the inspector (`notifyDevInspector`) — user console
  unchanged. Drives the live-status card + the doc header summary (resolved
  per-field, NOT the misleading invoice_number convenience).
- **Review trace console** (same key combo Ctrl+Shift+D+M, pw SFDEV, inside the
  REVIEW window — `src/windows/review/{index.html,renderer.js}`): a hidden
  right-side drawer for debugging extraction PRECEDENCE. Reuses the SAME trace
  stream — no new schema. On unlock it calls `review-trace-set(true, pw)` (verified
  in main, opens NO window) which sets `ctx.reviewTraceActive`; processing/handler
  then enables `--trace` (`traceWanted()`) and tees `process-trace` to the review
  window too (`routeTrace`). Per field it lists each stage's candidate
  (stage·value·confidence·method), won/lost (+reason), anchor_reject reasons,
  Stage 2.5 transforms (denoise/correct, from→to), Stage 4/4.5 validation rows
  (the note + value change behind a held/flagged/emptied value — e.g. a Stage 4.5
  withhold), and the final winner. "Reprocess (trace)" reuses the existing reprocess flow;
  events are buffered live (a reprocess runs under a temp filename, so no filename
  filter), with a `devGetSessionDoc` pull for already-processed docs.
  REVIEW-CONSOLE ADDITIONS (2026-06): (a) CLICK-TO-HIGHLIGHT — clicking a candidate/
  reject/validate/final row whose slice was captured draws the crop region on the
  page over a dedicated `#trace-canvas`. The candidate→slice match is by EXACT
  extraction METHOD (METHOD_TO_SLICE), never the coarse merge stage; coordinate
  convention is explicit (`_CENTRE_BASED_SLICE_STAGES` = anchor_crop/relocate/
  registration are centre-based; template_mapping + the inline harvest's inline_box
  are top-left); inline winners now emit a region (anchor.inline_box) so the WINNER
  is highlightable; a method with no crop region draws no box (honest). (b) REGEX
  SCORE — an "rx N%" badge on every value where a pattern check applies (% of the
  value the field's validation_pattern matches), using the SAME validation_patterns
  + a JS mirror of engine `_is_ref_field` coercion (validationKeyFor: a ref field
  typed Number/Currency scores as alphanumeric, not currency — also fixes the on-blur
  validator). (c) VALIDATION "WHY" — each validate row gets a plain-English sub-line
  (value rewritten / suggestion / kept+flagged, plus a reading of the note).
  (d) ANCHOR BOX ALONGSIDE THE VALUE (2026-06) — clicking a row now draws BOTH the value
  box (amber) AND the field's located anchor/label box (blue) together (drawTraceBbox gains
  a `keep` layered-draw; anchorSlice() pulls the kind="anchor" slice). For Stage-2 anchors
  the backend emits an `anchor_label` slice for the located label EVEN when the rigid crop
  succeeded (anchor.py, trace-only) — so you can SEE a label that didn't locate / located on
  the wrong row. Highlight dwell is 30s (was 3.5s; still clears on next click/page/doc).
- **Extraction trace** (`type:"trace"` stdout, separate `process-trace` channel,
  routed to the inspector + the review console when active): emitted by
  `engine.extract(trace=…)` ONLY when `process_docs --trace` is set, which handler
  adds ONLY while the inspector/review-console is open or diag logging is on →
  normal processing is byte-identical (no overhead/output). Events:
  `stage_start|stage_end|candidate|merge(decision win/lose +vs)|transform(2.5)|
  validation(4/4.5)|final|slice`. JS `reprocess_merge` event also surfaces the
  reprocess-merge keep/replace decision.
- **Per-field WINNING LINEAGE** (renderer reconstruction): each field collapses to
  `name + final value + winning-stage badge + "+N other candidates"`; expanded it
  shows a ★FINAL box then a vertical, colour-per-stage **lineage chain** (win
  merges → 2.5 transforms shown in-chain as `from → to` → value-changing
  validations → final), with losers + their reason (`lower confidence (X%<Y%)`
  else honest `superseded (reason not recorded)`) tucked in an "Other candidates"
  expander. Transforms render as chain NODES, so a value cleaned up into the final
  answer reads as the chain's origin — never struck-through (fixes the old
  value-equality "supersede" mislabel). Because the engine does not yet DECLARE a
  winner or per-decision reasons, the chain carries an **"approx" badge** and
  degrades gracefully. Flagged fields (validation note / corrected_to / final
  note) auto-expand. States handled: trace-not-captured banner (opened mid-run),
  live-streaming (debounced re-render), no-crop fields (honest "matched on OCR
  text layer"), AI stage absent, validation-forced-review. **Known main-app
  follow-ups (out of scope of the window):** engine winner-declaration + reason
  strings; and the reprocess identity stamp — reprocess copies to a temp name so
  the trace + dropdown register under it while JS `reprocess_merge` events key on
  the ORIGINAL filename and can orphan (renderer shows them when present, but the
  binding fix lives in `handler.js`).
- **OCR slices**: with `--slice-dir` (added with `--trace`), the anchor crop
  (`anchor_crop`, kind=target) and template-mapping crops (`template_mapping`,
  kinds anchor+target) are saved as temp PNGs; the page-evidence pane shows them
  for the selected field (value/target crops first, then anchor), each labelled
  from its OWN slice event's stage/page/bbox. **Temp only**: one main-owned dir
  `<temp>/ds-devslices`, served base64 via path-validated `dev-get-slice`, cleared
  on inspector close + app before-quit. Never persisted/filed/learned.
- Tests stub OCR-dependent stages (`tests/test_stage2_winner_consistency.py`,
  `test_job_no_pattern.py`); do the same for new trace/gate logic.

---

