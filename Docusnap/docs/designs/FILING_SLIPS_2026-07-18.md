# FILING SLIPS ("Separator sheets") — design, advisor-consensus + Oracle-signed

**Date:** 2026-07-18 · **Status:** DESIGNED, NOT BUILT. Oracle verdict: **SIGN OFF WITH CONDITIONS** (C1–C6, folded in below and listed in §11). Owner has 9 open questions (§10) to answer before slice 1.
**Panel:** oscar (detection) · gary (pipeline) · eric (desktop) · barry (product) → synthesis → Oracle. Codebase facts spot-verified 2026-07-18 (`handler.js:697-943`, `segmentation.py:129-198`, `segment_docs.py:53-64`, `pdf_splitter.py:30-47`, `check-vendor-python.js:34/42`). Product origin: `docs/brainstorms/BARRY_2026-07-18_home-edition_generic-docs_separator-sheets.md`.

## 1. Problem & goal

A user scanning a pile of paper as one batch PDF has no reliable way to tell ScanFinder where one document ends and the next begins — today's template-based separation pre-pass needs taught templates and never runs on a day-one install. The feature: print numbered separator sheets from inside ScanFinder, slot them between documents in the pile; at import each sheet page (identified by a namespaced QR) defines a split boundary AND is removed from the filed output, with the untouched original preserved. Decision rule: **the QR decode IS the decision** (Reed-Solomon makes a surviving misdecode practically impossible; the `SFSEP-` namespace firewalls third-party QRs), and the fail-safe is **no clean decode ⇒ no split** — one merged, review-bound document always beats a silent wrong split.

## 2. User-facing spec (barry)

**Naming (disagreement, resolved):** the UI says **"Separator sheets"** everywhere — it slots into the existing Settings "Document separation" section, matches copier/MFD vocabulary, and reserves "Filing Slips" for the future destination-slip feature. Internal keys keep the project name for grep-ability: setting `filing_slips_enabled`, env `FILING_SLIPS`. The UI label never leaks the internal name.

**The sheet** (A4 portrait, PIL-drawn raster, pure black on white, no greys/art behind codes):
1. Thick diagonal-stripe header band + small caps `SCANFINDER SEPARATOR SHEET` (product name must be on the sheet — the holder may never have opened the app).
2. **Primary QR ~90 mm**, centred upper half, payload `SFSEP-0007`, **ECC level H** (30% recovery), quiet zone ≥15 mm (spec minimum is 4 modules). (oscar 90 mm vs barry 100 mm — non-material, both ≥~20 px/module at the 150 DPI detection render vs a 3–4 px floor; **pinned 90 mm** so number + instructions fit above the fold.)
3. The big number beneath: `SEPARATOR 07`, ~90 pt — the human handle and the slice-6 OCR rung. Payload string `SFSEP-0007` in ~8 pt small print (support/diagnostic handle).
4. Three instruction lines: place between documents; ScanFinder splits here and removes this sheet automatically; reusable, any way up is fine.
5. **TWO corner-repeat mini-QRs ~35 mm** on opposite diagonal corners (oscar over barry's one — crease/staple/double-feed half-page insurance, found by the same decode pass at zero cost).
6. Mirrored bottom stripe band (visual symmetry; survives upside-down insertion).

**Print flow:** secondary button **"Print separator sheets"** in the Import view `.import-actions` (where the user stands, pile in hand) + the same button and the toggle in Settings → Processing → Document separation. Click ⇒ Python generates the PDF into userData ⇒ `shell.openPath` ⇒ system viewer, Ctrl+P. No in-app print stack in v1.

**Import feedback:** on a split, a progress-log line: *"Batch-0418.pdf — 3 separator sheets found · split into 4 documents · sheets removed · original kept safe."* Parts flow as normal result rows. A sheet that fails to decode is invisible by design: the merged doc lands in Review with the sheet inside; Help documents recovery via the existing manual Split tool (ranges already exclude pages: "1-3,5-9"). No new failure UI in v1.

**Reuse guidance (Help):** ordinary or 120–160 gsm paper; coloured paper aids retrieval; matte laminate only (gloss glares in ADFs); no staples.

**v1 cut list:** destination slips · number-OCR/page-signature rescue (slice 6) · watch-folder parity (slice 5) · per-person slips · loose-image batches (separation is PDF-only today; slips inherit that) · pack customisation beyond a count field · Review pre-suggested split point (slice 6).

## 3. Detection design (oscar)

**Decoder: `zxing-cpp`** (PyPI `zxing-cpp`, import `zxingcpp`) — **Apache-2.0**, pure algorithmic (no model weights), maintained C++ ZXing port v2.x, prebuilt win_amd64 wheels incl. CPython 3.12, ~1 MB, zero runtime deps, accepts PIL/NumPy directly. `read_barcodes(img, formats=QRCode)` returns ALL codes with positions — the corner-repeats come free. Alternatives all fail a gate: pyzbar/zbar LGPL (denied), OpenCV vendor-forbidden, ML decoders drag Torch. **Encoder: `segno`** (BSD-3-Clause, pure Python).

**Print spec → detection margin:** payload uppercase `SFSEP-` + digits sits in QR alphanumeric mode; at ECC H, version floats v1/v2 (21/25 modules). 90 mm at the 150 DPI render ≈ **21 px/module** — ~5× the decode floor, surviving draft inkjet, toner banding, creases.

**Recipe:** decode the page render **first**, before any OCR/template work. Namespace check is a full-match anchored regex — encoder emits `SFSEP-%04d`; **decoder accepts `^SFSEP-\d{1,6}$`** (printed packs never go stale if the counter widens). QR is rotation/mirror-invariant — no deskew rung. No born-digital short-circuit (decode is ~5–20 ms/page, noise). No 300 DPI rung in v1; slice 6 may use `return_errors=True` ("QR located, checksum failed") as a precise trigger for a targeted `scale=300/72` re-render retry.

**Failure ladder (ranked):** low toner/banding → ECC-H absorbs, else no split (safe). Skewed feed → invariant, decodes. Creased/dog-eared → centre code recovers ≤30% damage, corners cover corner loss, else no split (slice-6 rescue territory). Face-down feed → duplex pack decodes; single-sided pack yields a blank scan → merged doc, visible, recoverable. **Double-feed overlap** (slip partially covering a doc page) → a corner QR may decode on a page also carrying document ink → page excluded = **the one silent-content-loss branch**; v1 safety is the preserved original, slice 6 adds an ink-coverage check (decoded slip page with substantial non-slip content → review-flag). Photocopied slip → decodes; reuse is by design.

**Duplex-by-default (owner Q3):** oscar recommends each slip generates as TWO identical pages with "print double-sided" on-sheet — solves face-down feeds and duplex scanners imaging blank backs; printed single-sided anyway, the two consecutive slip pages both decode, both excluded, and collapse to one boundary. Harmless in every branch.

## 4. Pipeline integration (gary)

**Where the scan runs (disagreement, resolved):** oscar proposed hooking QR-first inside `detect_segments`' per-page loop (`segmentation.py:163-178`). Gary rejects that placement: the loop early-returns single-segment when `not templates` (`segmentation.py:136`) and pays Tesseract per page — wrong for the day-one zero-template install the feature exists for. **Resolution: gary's architecture** (it removes the template dependency rather than patching it, and dissolves the index-alignment seam because template segmentation is skipped outright when slips are present):

- **New module `python_backend/ocr/slip_detect.py`:** own pypdfium2 render pass at 150 DPI (preserving the px/module math), zxing decode, anchored namespace regex, pure `segments_excluding(page_count, separator_pages)` → exclusion-aware 0-based segments. **Any per-page exception aborts detection entirely (returns None)** — a partial slip map splits WRONG; whole-file scan is mandatory (no early exit). Anomaly cap: >500 pages ⇒ skip slip detection for that file + log, never partial-scan. An abort is **recorded in the detector `reasons`** so the dev-inspector trace explains the fallthrough (Oracle C4).
- **`segment_docs.py` orchestrates** via a new `--slips` flag: slips first; separators found ⇒ emit slips-only result, **skip template segmentation for that file**; none found or aborted ⇒ fall through to `detect_segments` unchanged. No `--slips` ⇒ byte-identical.
- **Gate refactor (Oracle C2 — supersedes the panel's draft gate):** `handler.js:926-929` becomes **`(auto_separate_enabled && templatesFile) || slipsOn`** — the pre-pass arms for slips INDEPENDENTLY of the heuristic-separation master toggle. Rationale: slips are explicit physical intent, not a heuristic; a user who disabled auto-separation (template splitting misfired) and then enables "Recognise separator sheets" must get a working toggle, not a silent non-function. `--templates-file` is passed only when the left conjunct holds (so slips-only mode runs the slip scan and skips template segmentation naturally). `slipsOn=false` reduces to exactly today's condition — byte-identical.
- **Slips-only when present (pinned trade-off):** physical slips are explicit manual control; compounding template heuristics (FIRST_PAGE_FP_FLOOR=0.5) inside slip chunks doubles the test matrix. An un-slipped multi-doc chunk stays merged → review. Accepted double-render cost when templates exist and no slips found; a shared-images param on `detect_segments` is the named later optimisation.

**Contract + exclusion-seam fix:** detector output grows additively — `separator_pages`, `separator_payloads`, segments already exclusion-aware (7 pages, slip at index 3 ⇒ `[[0,2],[4,6]]`). The existing range-builder (`handler.js:737`) emits `"1-3,5-7"`, which `pdf_splitter.parse_ranges` already honours as exclusion — **no pdf_splitter change**. The JS decision rule is extracted into pure `split_plan.js` (`buildSplitPlan(det)`, unit-testable without better-sqlite3):
- No separators ⇒ today's rule verbatim (<2 segments ⇒ skip).
- ≥1 separator + ≥1 segment ⇒ proceed even with ONE segment — **the REWRITE case** (a doc + one trailing slip is rewritten without the slip, never filed with it); the `made.length < 2` guard (`handler.js:742`) becomes `< minFiles` where `minFiles = separators ? 1 : 2`.
- Only-slips ⇒ no splitter call; original → `.sf_separated_originals/` + visible log.

Original-move semantics unchanged; that folder IS the recovery story. Locked-original fallback applies to rewrite too (residual: files with slip inside, logged warn — fail-safe, pre-exists for splits).

**Edge cases (decided):**

| Case | Behaviour |
|---|---|
| Slip = page 0 / last page | Leading slip dropped / 1-segment REWRITE (the seam fix) |
| Consecutive slips | Both excluded, no empty segment (duplex-pack branch) |
| Only-slips PDF | Consume + preserve original + log |
| Slip mid-document (user error) | Two docs → review (half-docs read poorly); recover from originals folder |
| Duplicate numbers | No dedupe — labels, not tokens |
| Slips + template boundaries both fire | Slips-only (PIN #2) |
| Namespaced-looking QR inside a real doc | Full-match regex + clean decode required; no AND-gate (per brief) |
| Slip-detect abort | Fall through to template segmentation; recorded in `reasons` (can still split a slip-bearing file with sheets inside parts — pre-existing-class outcome, original preserved; Oracle-accepted) |

**Performance:** with zero templates, ON adds ~30–80 ms render + ~5–20 ms decode per page — an order cheaper than the template pre-pass; existing `sepP ≤ 6` parallelism applies.

## 5. Desktop/Electron design (eric)

**IPC:** `generate-filing-slips({count})` in `src/modules/processing/handler.js` (owns separation, has `pythonExe()/pythonArgs()`, same spawn shape as `split-pdf`). Validate in MAIN: integer, clamp 1–50. `requireRole('admin','edit')` — the handler mutates a settings counter, and read-only users never mutate settings. Preload: one invoke bridge.

**Generation CLI `python_backend/filing_slips.py --count N --start N --out <path>`:** PIL + segno, 200 DPI pages (1654×2339 px), QR rasterised ~1200 px, `img.save(out, "PDF", save_all=True, append_images=[...], resolution=200.0)` — the `resolution` kwarg is load-bearing (without it the physical page size is wrong and slips print off-A4). Font ladder: `C:\Windows\Fonts\arialbd.ttf` → `segoeuib.ttf` → scaled default (never fail the pack over a font). Single-line JSON out; ~30 s kill-timer; NOT in the Stop/kill registry (independent of any batch). Sibling imports per the embeddable-python rule (`from ocr.x import …` after `sys.path.insert`).

**Write location:** `userData/filing-slips/`, filename `Filing slips 0007-0016.pdf`, sweep to last 5 packs per generation. Not Downloads (permissions/OneDrive redirect risk). **Hand-off:** `shell.openPath` — NOT `webContents.print`/`printToPDF` (hidden-BrowserWindow lifecycle surface for zero added truth). Success UX: inline "Created slips 7–16" + Open-to-print + Show-in-folder; errors rendered inline (the visible-refusal pattern from `1eceb9e`).

**Numbering (disagreement, resolved):** eric's settings counter **`filing_slip_next_number`** (default 1, read+incremented atomically in main — single-threaded + synchronous better-sqlite3, no race; 4 digits, wrap 9999→1) over barry's stateless 01–10 pack. The number is the human handle AND surfaces in split feedback ("split at sheets 7 and 8") — two stateless packs on one desk are physically indistinguishable and muddy the slice-6 OCR rung. Barry's reuse story survives intact: every printed slip stays valid forever; the counter only stops fresh packs colliding. Rides the settings backup; a restore that rewinds it just repeats label numbers — harmless (labels, not tokens). Count field default 10, clamp 1–50.

**UI:** Settings toggle `#filing-slips-toggle` ("Recognise separator sheets", barry's sub-copy) + "Print separator sheets…" button row in the Document separation section; Import-view secondary button; **no Home card** (one Did-you-know tip string if discoverability matters); **no broadcasts** (plain getSetting/setSetting). **Watch-folder warning (Oracle C3):** when `filing_slips_enabled` is ON **and** a watch folder is configured, a persistent inline warning renders on the toggle row AND on the print-pack success panel: *"Sheets are detected on manual Import only — not yet in the auto-import folder."* Plus a Help section. (Watch scan-to-folder is the most common MFD workflow; without this, the on-sheet promise is false there.)

**Split feedback (minor disagreement, resolved):** plain `log` progress line for v1 (zero new surface) carrying the slip numbers, plus a dev-inspector `process-trace` event `{ev:'slip_split', file, slip_pages, payloads}` under the existing `--trace` convention; a typed `file_split` renderer row is later polish.

## 6. Slices & kill switches

House rule applies to every slice: capture the corpus baseline (`stress_test/realdoc_regression.js`, M=0/M_type) BEFORE any code; each slice its own commit; gate = switch-OFF byte-identical to baseline, switch-ON only the intended delta; STOP and show the comparison.

1. **Slice 1 — detector + pipeline** (`slip_detect.py`, `segment_docs.py --slips`, C2 gate refactor, `split_plan.js`, exclusion/rewrite fix). Switch: setting `filing_slips_enabled` (**default OFF**) + env `FILING_SLIPS=0` hard-kill (env overrides setting). Gate: OFF byte-identical; ON over the slip-free corpus decision-identical (scan finds nothing ⇒ identical decisions); unit fixtures green; **C1 dead-spawn E2E pin green**.
2. **Slice 2 — generation + UI** (`filing_slips.py`, `generate-filing-slips` IPC, counter, Settings/Import buttons + C3 watch warning, log line, Help). Switch: the same setting gates the toggle-adjacent UI; generation is inert without user action. Gate: corpus untouched (no pipeline files); packaged-build print test (page size, fonts) + `python -P` import pin.
3. **Slice 3 — vendor/licence plumbing + packaged E2E**: `check-vendor-python.js`, BUILD.txt, notices (**C5: lands in the SAME COMMIT as the first `import zxingcpp`**); `npm run check:vendor`/`check:licenses` green; barry's success metric on the owner's MFD (10 docs / 9 sheets at 300 DPI colour AND 150–200 DPI greyscale ⇒ 10 docs, zero sheet pages filed; payment-QR control never splits; obscured-QR control merges cleanly).
4. **Slice 4 — default-ON flip** (own commit). Preconditions: corpus green + owner MFD pilot + **watch-folder parity (slice 5) shipped before or with the flip, else the flip goes back to Oracle (C3)**. Whether the flip applies to existing installs in an update is owner Q2.
5. **Slice 5 — watch-folder parity** — eric's option (a): split in temp staging, decouple "original consumed" from "1 file → 1 document" in the drain (`watch/handler.js:261-318`); crash mid-batch ⇒ original re-imports whole, duplicate-suffixed, never silent. **Not** in-watch-folder splitting (partial `_split_pN.pdf` debris in a user/OneDrive dir ⇒ double-import).
6. **Later — number-OCR rescue rung** — only when NO QR decoded: Otsu page-signature (mostly-white + one dominant near-square dark blob 60–110 mm — **must be recalibrated against the shipped stripe-banded artwork**, which breaks "mostly white"), crop band beneath, ~3× upscale (PIL `BICUBIC` — NOT OpenCV constants), Tesseract PSM 7 whitelist `SFSEP-0123456789`. **REVIEW-FLAGGED suggestion only, never a silent split**; never an AND-gate on the QR. Plus the `return_errors` → 300 DPI retry.
7. **Later — destination slips** (payload schema, routing, review story — separate design pass).

**Default ON vs OFF (disagreement, resolved):** eric+barry argued ship-ON (namespace-gated, day-one story); gary + the house control-test rule demand OFF until proven. **Resolution: build OFF, flip ON as slice 4 after the gates** — the day-one argument concerns the *shipped* default, which slice 4 delivers once evidence exists.

## 7. Invariants & test plan

- `tests/test_slip_detect.py`: segno-built slips + PIL content pages composed via `save_all=True`; every §4 edge case; wrong-namespace QR rejected; synthetic degradation battery (downscale to 150 DPI, ±3° rotate, band-mask 20% of modules, blur); negative pages with URL/payment QRs; per-page exception ⇒ None (abort, not partial); `segments_excluding` battery.
- **C1 dead-spawn pin (E2E-shaped):** runs the REAL arg-construction path with slips ON / zero templates and asserts `segment_docs.py` actually received `--slips` WITHOUT a `--templates-file` arg (no null in argv) and returned a decode on a slip fixture. (Guards the "spawn throws → runPyJson null → detection silently dead while unit tests stay green" trap.)
- `tests/test_slip_embeddable_import.py`: mirror `test_region_embeddable_import.py` — `from ocr.slip_detect import …` after `sys.path.insert`, verified under `python -P` against **`dist/win-unpacked`'s vendor/python, not dev Python** (C5).
- `src/modules/processing/test_split_plan.js` (plain Node): today's rule verbatim with no separators; **PIN #1** — 1-segment+separator ⇒ rewrite plan (a future dev must not restore "leave untouched" and re-file sheets inside docs); only-slips ⇒ consume plan; **C4 additions:** (a) 0 segments + separators (only-slips ⇒ consume, no splitter call), (b) separators listed but detection aborted upstream ⇒ plan = untouched (an abort must not half-apply), (c) locked-original in the 1-output rewrite branch (fresh file deleted, warn logged).
- **PIN #2** (Python): templates + slips both present ⇒ slips-only segments (the accepted trade-off can't be "fixed" back without a design pass). **PIN #3:** `parse_ranges` comma-group exclusion semantics.
- **C6 discipline:** baseline captured first; OFF byte-identical (M=0/M_type=0, zero per-field drop); ON over the slip-free corpus decision-identical; each PIN demonstrated to FAIL when its guarded behaviour is reverted (flip the rewrite rule back, watch the test go red once, before merge).
- Corpus A/B per slice (§6); barry's MFD success metric as the real-world gate.

## 8. Dependencies & licences

- **`zxing-cpp`** (import `zxingcpp`) — **Apache-2.0**, decode. **`segno`** — **BSD-3-Clause**, encode. Both auto-classify ALLOWED via dist-info METADATA in `scripts/check-licenses.js`. pyzbar (LGPL) and OpenCV correctly rejected.
- `scripts/check-vendor-python.js`: REQUIRED += `['zxingcpp','QR decoding — separator sheets']`, `['segno','QR encoding — separator sheets']`; PIP_NAME += `zxingcpp: 'zxing-cpp'`. BUILD.txt §3 pip line (~165) += `segno zxing-cpp`. Regenerate `THIRD-PARTY-LICENSES.txt` (both licence families already have §3 texts — inventory-only). Installer +≈2 MB. **All of this in the same commit as the first `import zxingcpp` (C5).**

## 9. Risks & named seams (merged)

1. **Gate refactor must keep the two mechanisms independent** — the C2 form `(auto_separate_enabled && templatesFile) || slipsOn` guarantees enabling slips neither re-arms template separation on no-template installs nor dies under a disabled master toggle. Mitigation: C1 pin + OFF-byte-identical gate.
2. **Exclusion is a new content-removal power.** The double-feed overlap branch is the only silent-content-loss path; the "sheets removed" copy is a promise the rewrite fix must keep. Mitigation: preserved original (v1), slice-6 ink-coverage review flag, PIN #1.
3. **Partial slip map = wrong split.** Mitigation: abort-entire-detection on any per-page exception; whole-file scan; >500-page skip-whole-file cap; abort recorded in `reasons` (C4).
4. **Slips-present skips template segmentation** for that file — fails toward merged→review. PIN #2.
5. **Rescue rung must stay review-bound** — promoting it to auto-split recreates the silent-wrong-split the ladder forbids; it must never become an AND-gate on the QR.
6. **v1 artwork is a frozen contract** — the slice-6 page signature is built against it; changing stripes/layout later breaks that rung; the "mostly white" recipe must be recalibrated against the stripe-banded design before slice 6 ships.
7. **Relied-on upstream invariants (pin or don't touch):** `parse_ranges` comma-group independence; `.sf_separated_originals` excluded from the non-recursive scan; `runPyJson` null-on-error + whole-doc fallback; `auto_separate_enabled` default-ON.
8. **Watch-folder asymmetry** until slice 5: slips file inside docs arriving via watch. Mitigation: C3 warning UI + slice-5-before-flip sequencing.
9. **Default-ON ships the decoder in every build** — a licence-gate failure blocks all builds. Mitigation: both wheels pre-verified against the allowlist; gates run in slice 3 before any flip.
10. **Counter write** makes generation a mutating IPC — `requireRole('admin','edit')` holds the read-only wall. No new path-taking IPC (generated path originates in MAIN); generation spawn outside Stop/kill semantics, leak-guarded by the 30 s timer.
11. **Auto-file interplay (Oracle-weighed and accepted):** split parts flow to `_maybeAutoFile` as fresh documents — unchanged path. A mid-document slip is user-planted intent; part 1 may auto-file while part 2 lands in review as a fragment — visible (split log names the sheets, original preserved), no NEW silent-wrong-filing path.

## 10. Open questions — **ANSWERED by the owner 2026-07-18: "all as recommended"**

1. UI name **"Separator sheets"** ✔ confirmed (internal keys stay `filing_slips_*`).
2. **Default-ON flip scope** (existing installs vs fresh only): no recommendation existed — DEFERRED to slice 4, where it must be decided before the flip commit. Does not block slices 1–3.
3. **Duplex-by-default pack** ✔ YES — each slip generates as two identical pages with "print double-sided" on-sheet.
4. **v1 overlap policy** ✔ exclude silently, relying on the preserved original, until the slice-6 ink-coverage review flag.
5. **Watch-folder parity** ✔ acceptable as a visibly-warned v1 gap (C3 warning UI); slice 5 before/with the default-ON flip stands.
6. **Only-slips files** ✔ consume + preserve original + log.
7. **Pack UX** ✔ count default 10 (clamp 1–50) + the stateful `filing_slip_next_number` counter.
8. **Import-view button** ✔ beside Process/Stop (plus Settings).
9. **Pilot hardware** — the owner's office MFD; concrete profile to be named at the slice-3/4 pilot run.

## 11. Oracle review (2026-07-18) — SIGN OFF WITH CONDITIONS

Premise verified against the code (the `<2 segments ⇒ untouched` rule and `made.length < 2` guard at `handler.js:734/742`; the template-file gate `handler.js:926-929`; the `not templates ⇒ single segment` early return `segmentation.py:136` that justifies the separate-module architecture; `parse_ranges` exclusion `pdf_splitter.py:30-47`; the 21 px/module math; both wheel licences). Architecture sound: QR-is-the-decision, exclusion-aware segments, slips-only precedence, default-OFF-then-flip. Auto-file interplay explicitly weighed and accepted (§9.11). Conditions — all folded into §§4-8 above:

- **C1** — dead-spawn pin: E2E arg-construction test, slips ON / no templates, asserts a real `segment_docs.py --slips` invocation succeeds (no `--templates-file` arg, no null in argv).
- **C2** — decoupled gate `(auto_separate_enabled && templatesFile) || slipsOn` (slips must not be strangled under the heuristic-separation master toggle — explicit physical intent, not a heuristic); OFF-state byte-identical corpus run re-proven after the change.
- **C3** — watch-folder warning UI (toggle row + print-pack panel) whenever slips ON + watch configured; slice 5 lands before or with the default-ON flip, else the flip returns for re-review.
- **C4** — `test_split_plan.js` adds only-slips / abort-must-not-half-apply / locked-rewrite cases; slip-detect aborts recorded in detector `reasons`.
- **C5** — vendor plumbing (check-vendor REQUIRED, PIP_NAME, BUILD.txt, notices) in the SAME commit as the first `import zxingcpp`; the embeddable-import test runs under `python -P` against `dist/win-unpacked`'s vendor/python, not dev Python.
- **C6** — per-slice verification gate as §6: baseline first; OFF byte-identical (M=0/M_type=0, zero per-field drop); ON over the slip-free corpus decision-identical; each PIN demonstrated to fail when its guarded behaviour is reverted, before merge.
