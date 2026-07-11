# Handover — 2026-07-10 EVENING session (continues HANDOVER_2026-07-10_DAYTIME.md)

**Branch:** `feat/doctype-title-aliases` · **Last commit (pushed):** `e898009` · **Installer from it:** `dist\ScanFinder Setup 2.0.0-r20260710-1024-e898009.exe` (11:25)
**A LARGE unit-tested batch sits UNCOMMITTED on top** (§3) — the user is RUNNING it live via `npm start`; the **live DB is migrated to v45**. User switched the session model to **Fable 5**; this handover is the cold-start pickup. User prefers **plain, concise explanations** (memory `feedback_plain_concise`).

---

## 1. TL;DR

User live-testing surfaced six problems; all were root-caused via the advisors (eric/gary/reggie/oscar/007/Phillip, Oracle vets throughout) and FIXED + unit-tested in the working tree:
1. **Focus dead-caret "everywhere"** — the repair itself was self-perpetuating (blurWebView fired per-click off an at-rest read). Now suspect-only.
2. **Customer field mirrored the issuer** — RC2 unlink shipped: `COMPANY_KEYS=['supplier_name']`, migrations 44+45, renderer decoupled.
3. **Template matched on view, lost on reprocess** — the 2026-07-09 machine-authority override cleared `_kt`. Fixed (kept + type-reflip guarded).
4. **Drifted logo → no template → fields stop filling** — text-corroborated same-type rescue in template_matcher.
5. **Clean underlined captions OCR to garble** ("Site / Customer"→"one f Lustomer") — gated horizontal-rule strip in region.py.
6. **"P/O Number" never read** — po_number label variants added.

Corpus gate: **M=0 HELD; batch is corpus-NEUTRAL on the frozen snapshot** (see §4 — and the strict-gate/exit-code correction there). **Final Oracle vet of fixes 3/4/6 crashed on a transient API error and was NOT completed — re-run it before commit+build.**

## 2. Committed earlier today (already in the e898009 installer)

- `4d2de72` fix(review): keyboard-focus focusin secondary + garble anchor-label rejection (case-chaos rule + auto position-only)
- `e898009` fix(extraction): custom-field Stage-1 seeding + ref caption guard (RC1/RC5 — the Worksheet-217-docs empty-fields fix; gated: ref 99.1→99.3%, silent 27→21, M=0)

⚠ The working tree **partially REVERTS `4d2de72`**: the focusin secondary proved to be an AMPLIFIER of the desync and was removed (§3.1). Commit the revision with a message saying exactly that.

## 3. The UNCOMMITTED batch (all unit-tested green)

Modified tracked: `CLAUDE.md, config/keyword_patterns.json, database/index.js, database/modules/document_types.js, database/modules/test_structural_fields.js, python_backend/extraction/template_matcher.py, python_backend/ocr/region.py, python_backend/process_docs.py, src/lib/focusRepair.js, src/lib/test_focus_repair.js, src/preload.js, src/windows/review/renderer.js`. New: `database/modules/test_migration_customer_unlink.js, database/modules/test_migration_customer_hint_cleanup.js, python_backend/tests/test_template_rescue.py` (+ this handover + `.claude/skills/newsession/`).

### 3.1 Focus — REVISED (the real cure)
- **Root cause (eric; telemetry-proven):** `win.blurWebView()` (focusRepair.js) is the ONLY page-focus dropper in the app. The systemic cure's `|| info.pageHasFocus === false` OR-fallback fired it off a CAPTURE-phase (at-rest) `document.hasFocus()` read → on a desynced page it re-blurred on every click → **self-perpetuating** (telemetry: `pageHasFocus=false` in runs of 5–7 presses, 17/24 desynced). No other thief exists (presence/timers/child-windows/win.on('blur') all ruled out in code).
- **Fix:** blurWebView fires ONLY on `info.suspect === true` (armed by: the native-dialog wrapper, the post-Confirm advance `renderer.js:~2768`, and runZoneOcr — which now calls `markFocusSuspect()` before `ensureWindowFocus()`). The preload `focusin` secondary (from 4d2de72) REVERTED. Healthy/unarmed presses = pure `wc.focus()` no-op.
- **Oracle: SIGN OFF WITH CONDITIONS.** Done: stale "heals regardless of trigger" wording corrected (CLAUDE.md + test header). **OPEN:** (a) child-window-close does NOT arm suspect → recoverable dead-caret after closing Settings/Search (fast-follow); (b) the unit test pins code SHAPE only — **the human smoke test is the real gate and the user has NOT confirmed it yet.**

### 3.2 RC2 — customer_name UNLINKED from identity (the owner's big ask)
- `COMPANY_KEYS = ['supplier_name']` (document_types.js). Built-in **Sales Order** identity → `supplier_name` ("Document Issuer") + optional `customer_name` "Customer"; presets **Sales Invoice/Remittance** flipped to supplier_name; Delivery-Note/Statement secondary customer_name relabelled "Customer".
- **Migration 44** (`reshapeCustomerIdentityTypes`) — SCHEMA-ONLY by owner decision: adds a supplier_name identity to any customer_name type, demotes customer_name (only where labelled the old "Document Issuer"); touches NO documents/filing/learning.
- **Migration 45** (`cleanupStaleCustomerLearning`, gary-designed, Oracle-aligned) — deletes customer_name hints where value == own scope OR value ∈ known-issuer set (logo/scope snapshot), + customer_name anchors labelled 'Document Issuer'. Keeps legit recipients ("Greenfield Nurseries"). gary's full write-path audit: cleanup alone fixes the reprocess bleed; can't regenerate (field is now labelled "Customer").
- **Renderer decoupled at 6 sites** (ISSUER_KEYS, issuerBlankKey, position-only teach branch, isIssuerFlag, _issuerHint, confirm issuerKey) — customer now teaches like a normal captioned field.
- Oracle completeness gate ran CLEAN on the live DB pre-decouple. Tests: `test_migration_customer_unlink.js` (11) + `test_migration_customer_hint_cleanup.js` (12) + updated `test_structural_fields.js` — green. Confirmed live: worksheet Customer read "Ormeau Bakery Supplies" (the real recipient).
- **OPEN Oracle condition:** a dedicated PIN test that renderer `ISSUER_KEYS=['supplier_name']` + the engine guards (engine.py:875/934 early-return on supplier_name-in-fd_keys) are the INTENDED retirement (comments exist; test not written).

### 3.3 Template lost on REPROCESS (gary) — NOT an RC2 bug
- `python_backend/process_docs.py` (~544–563, ~656–664). Root cause: the 2026-07-09 machine-authority override set `_kt = None` → the engine's known-id rescue (engine.py:1191) had nothing to resurrect → handler persisted `template_id=NULL` (handler.js:1081 unguarded) → "matched on view, no match after reprocess" + fields stopped filling.
- **Fix:** keep `_kt` on override; new `authoritative = bool(_ks or _ks_overridden)` gates the `_document_type_slug` re-flip — a resurrected template supplies supplier/fields but NEVER re-asserts its stale type ("keeps applying Sales Order" stays closed; import path byte-identical).
- Syntax-checked; **gary's suggested unit tests NOT written yet**: `test_stage0_known_id_rescue.py` (refusal + known-id ⇒ template + issuer fill) and a `test_reprocess_type_flip.py` extension pinning the type-adoption guard.

### 3.4 Logo-drift template RESCUE (Phillip)
- `python_backend/extraction/template_matcher.py`: `RESCUE_KEYWORD_OVERLAP=0.80`, `RESCUE_LOGO_BAND=20`, `_min_set_dist`, rescue block BEFORE the slug-blind keyword fallback: when `detected_slug and title_trusted`, accept the highest-keyword-overlap SAME-TYPE template iff overlap ≥0.80 AND (no logo OR min-set logo dist ≤20) → conf 60, method `keywords+slug_rescue`.
- Root cause (measured live): Meridian fragmented into 3 templates 10–14 Hamming bits apart (accept gate ≤6; `findByLogoHash` blind ≥14); the slug-BLIND `_match_by_keywords` picked the identical-fingerprint INVOICE sibling → title-trust refuse → None → no fills (MP_pur_14). Convergence root-cause: passive append band (13) < real drift (14) + low-volume singletons.
- Tests: `tests/test_template_rescue.py` (7 green: rescues the right PO, refuses wrong-supplier/wrong-type, gated on title_trusted, close logo still wins the normal path); existing `test_template_matcher.py` green. **Slice 2 (self-healing: authoritative logo-append-on-confirm past the 13 band) DESIGNED, NOT built** — without it the rescue re-fires per scan (works, never converges).

### 3.5 OCR underline garble (oscar)
- `python_backend/ocr/region.py`: `_strip_horizontal_rules` at the light rung — gated morphological removal of ≥55%-width thin horizontal runs (an underline fused with glyph baselines at the 108-DPI teach preview garbled "Site / Customer" → "one f Lustomer"/"ore Customer"). Lazy scipy.ndimage import (BSD, already bundled); any failure returns the original.
- Oracle insight: extraction reads at 300 DPI where the rule doesn't fuse — fixing the STORED label likely makes relocation just work. **OPEN:** the test referenced in the docstring (`tests/test_strip_rules.py`) was NOT written (underlined caption reads clean; no-rule crop byte-identical; underscore value preserved).

### 3.6 po_number "P/O Number" caption gap
- `config/keyword_patterns.json`: added `P/O Number|No|No.|#` + `P.O. Number|No|No.` to `po_number.labels` (additive; `_label_pattern` keeps "/" and "." literal — verified match + no cross-match; live case reads PO5252).

## 4. Verification state — READ THIS CAREFULLY

- **Unit tests: ALL green.** Python: custom_field_seeding (12), keyword_label_guard, template_matcher, template_rescue (7), detect_type_aliases. JS: structural_fields, migration-44 (11), migration-45 (12), anchor_label (27), focus_repair.
- **Corpus gate (`%TEMP%\sf-frozen\batch_final.md`, frozen 2017-doc snapshot, migrations 44+45 auto-applied to the frozen DB):** type 99.9 / supplier 99.8 / ref 99.3 / date 99.5; **0 would-auto-file-a-WRONG-value (M=0 HELD)**; 29 regressions / 21 SILENT — **byte-identical headline to the pre-batch run** (`seeding_run.md` / `final_frozen.md`) → the batch is **corpus-neutral**; no new regressions. The 21-silent class is PRE-EXISTING (baseline had 27) — stale GT + scanned-recall, documented in memory.
- ⚠ **CORRECTION + GOTCHA:** `GATE_EXIT=1` — the strict `GATE=1` mode exits 1 on ANY silent regression, so it trips on the pre-existing 21 and has done on prior runs too. The mid-session claim "gate passed (exit 0)" was WRONG — the task's exit-0 came from a trailing `echo` masking the harness exit. **Read the report file, not the exit code**, and don't append `; echo …` after `GATE=1` runs.
- **Final Oracle vet of §3.3/3.4/3.6 CRASHED** (transient API ConnectionRefused) — **NOT completed. Re-run before commit+build.** Brief: (1) gary keep-`_kt` + `authoritative` guard — import byte-identical? any other type-reflip path? docTrustGate `templateMatched` now true on reprocessed override-docs — still held by the type-change validation_note? (2) Phillip 0.80/20 rescue — false-accept seam, docTrustGate interaction, fail-toward-review; (3) P/O labels false-match risk.
- Focus / RC2 / oscar-007 designs already Oracle-signed (open conditions listed in §3/§6).
- **User smoke tests pending:** focus (Confirm/draw/dialog/child-window-close → click a field), and a Meridian ⊕ Customer teach with "Above" (caption should now read "Site / Customer" clean).

## 5. FIRST ACTIONS for the fresh session

1. **Re-run the final Oracle vet** of §3.3/3.4/3.6 (brief in §4).
2. **Write the missing tests** (cheap): `tests/test_strip_rules.py` (§3.5), gary's two (§3.3), the ISSUER_KEYS/engine-guard pin (§3.2).
3. **Commit in logical groups** (explain the partial 4d2de72 revert): (a) focus revision; (b) RC2 unlink + migrations 44/45 + renderer decouple; (c) template fixes (gary + Phillip); (d) region.py rule-strip + po_number labels. Push.
4. **Build** (`npm run build` — close the dev app first, EPERM on better_sqlite3.node; a dev `npm start` may still be running). The `…e898009.exe` installer LACKS the whole §3 batch.
5. Then the deferred queue (§6) as the user directs.

## 6. Deferred (designed, NOT built)

- **oscar/007 B1/B2/B3** (Oracle-approved WITH CONDITIONS): B1 garble-gate narrowing MUST pass a connector-caption corpus ("Bill of Lading", "Sold to Party", "Date of Issue", "No. of Units"…); **B2 vertical-integrity guard MUST use a review-forcing conf-0 placeholder, NOT a bare drop** — a bare `continue` lets a `required:0` field auto-file BLANK, invisible to the M=0 gate (the Oracle's headline catch); B3 forceDir closure (renderer.js:~2418 hard-codes 'right'). Workaround live today: the label box is editable — type the real caption.
- **Phillip Slice 2:** authoritative logo-hash append-on-confirm past the 13 band (self-healing convergence; without it the rescue re-fires per scan).
- **Focus:** child-window-close suspect arm.
- **Corpus regeneration** (user asked): rebuild the 500-doc test corpus with CLEAN layouts — same params from `Desktop\Fresh Test Docs\_ground_truth.csv` (500 docs, 10 suppliers × 50; invoice 280 / PO 90 / SO 50 / worksheet 80). Baked-in layout bugs found: the Ref/Date info box overlaps the address + table header; table description column misaligned vs numbers. **The original generator was NOT found anywhere** — rebuild from the CSV + rendered samples (scratchpad `sample_*.png`). Docs are IMAGE-ONLY (rasterised ~150 DPI + noise).
- Earlier systemic-review queue: RC3 Fix1 (gate logo-save on `isPlausibleSupplierName` — kills the "Ref" junk supplier, Oracle SIGN OFF), RC4 garbled-VALUE flag, RC1 slice 2 (free-text seeding), identity_fusion positive fill.

## 7. Needs the USER

- **Focus smoke test** on the current tree (each trigger, then click a field; child-window-close is the known residual).
- **Teach test:** Meridian worksheet ⊕ Customer with "↑ Above" — check the caption reads "Site / Customer" cleanly now.
- **Doc 1778 (AW_pur_08) STILL outstanding since overnight:** Learning Repair → send back → set type to **Purchase Order BEFORE Confirm**.
- Meridian **Worksheet** has no template yet ("no template match" there is CORRECT) — "Save as template" on a good one.
- `dist\` holds 3 stale installers (…e5d8c85, …a873c4e, …63b0cdb) + current e898009 — the stale three can be deleted.

## 8. Key facts / paths

- **Live DB** `%APPDATA%\Roaming\ScanFinder\docusnap.db` — at migration **45**. Overnight backups in `%APPDATA%\ScanFinder\db_backups\`.
- **Frozen A/B snapshot** `%TEMP%\sf-frozen\` (its DB is ALSO at v45 now — the batch gate migrated it; `baseline_frozen.md`/`final_frozen.md`/`seeding_run.md`/`batch_final.md` live there). **Baseline worktree** `%TEMP%\sf-baseline-wt` (HEAD 63b0cdb). Both cleanable after the batch ships (`git worktree remove --force …`).
- **Harness:** `GATE=1 APPDATA=<frozen> ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/realdoc_regression.js` (~35 min) — read the REPORT, not the exit code (§4 gotcha).
- **Tests:** Python `py -3.12 tests/<t>.py` from `python_backend/`; DB/migration JS via `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <path>`; pure-logic JS via `node`.
- **Advisors:** bob/eric/gary/oscar/reggie/oracle = registered subagent types; 007 + Phillip = general-purpose + persona (`agents/007.md` / `document-fingerprinting` skill).
- `/newsession` skill now exists (`.claude/skills/newsession/`) — wraps up a session: handover + CLAUDE.md + memory.
