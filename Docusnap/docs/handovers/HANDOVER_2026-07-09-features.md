# Handover — 2026-07-09 (feature session)

Continues from `HANDOVER_2026-07-09.md` (the overnight harness-RED resolution). This covers the
daytime feature/fix work. Every change was designed with the advisor agents + the Oracle
(SIGN OFF / SIGN OFF WITH CONDITIONS) and verified against the real-doc harness (M=0).

## Git state (read this first)

- **`main`** (`b48e628`, **not pushed** — 26 commits ahead of upstream) carries everything below
  EXCEPT title-aliases and the anchor-message tweak:
  - `04d00dc` fix(ocr): two-pass born-digital line grouping (3-column header re-home)
  - `229b4a7` fix(anchor): born-digital exact-text corroboration → auto-file unlock (Oracle cond #4)
  - `272d113` test(harness): self-validating GT overrides (poisoned test-GT can't read as a code RED)
  - `54f5366` + `7c9fa4b` perf(review): snappier Confirm (detach best-effort learning spawns) + nits
  - `2e6d50b` feat(review): learned-anchor panel in learning history (from earlier in the session)
  - `b48e628` fix(doctype): type-precedence — a supplier's template must not force its type
- **`feat/doctype-title-aliases`** (`64931f4` + `e793dbd` + this docs commit) — the title-aliases feature,
  the anchor-readout fix, and this handover/CLAUDE.md. **Not merged to main.** (The anchor fix rides here
  for durability; ideally cherry-pick it to its own branch off `main`.)
- `e793dbd` fix(review): don't show the garbled anchor readout on a Document Issuer box — **UNTESTED in-app.**

`main` and both branches are **local only — nothing pushed, nothing built.**

## What shipped

### 1. Two-pass born-digital line grouping (`04d00dc`, main)
Root cause of the ACME / City-Office / Cloud-VPS wrong-column reads: `ocr/born_digital.py::page_lines`
grouped words with a SINGLE greedy pass, so a value between two header rows glued to the row seeded
FIRST → its own label read empty → keyword grabbed the wrong column. Fixed with oscar's proven
two-pass nearest-anchor pattern (PASS 1 = same anchor set as before by construction; PASS 2 re-homes
each word to its nearest anchor). Guarded by `tests/test_born_digital.py` (3-column re-home + stacked-rows).

### 2. Auto-file unlock — born-digital exact-text corroboration (`229b4a7`, main; Oracle cond #4)
An authoritative ⊕ anchor on a born-digital doc reads the drawn box as an IMAGE crop → debris →
`anchor_crop_recovered`, capped ≤87 (below the 88 floor) even when correct, so those docs could never
auto-file. `anchor._exact_text_corroborates` lifts the cap to [90,95] ONLY when the born-digital VECTOR
text (`page_text_lines`, never OCR — None for scanned, so can't fire on same-pixel agreement) carries
the token as a bounded whole word on the value's own taught row. #1344: invoice_number 85→95, overall
93→97. Pinned in `tests/test_recover_clean_token.py`.

### 3. Self-validating GT-override harness annotation (`272d113`, main)
`stress_test/gt_overrides.json` + `realdoc_regression.js`: 7 docs whose CONFIRMED value was poisoned
during testing (mis-confirmed page-number fragments '1/2','102' / a transposition) are corrected to the
filename-true value so the M gate reflects true pipeline soundness. SELF-VALIDATING (Oracle): applies
only when the doc STILL carries the recorded poison (`poisoned_ref`/`fname_has`); on mismatch (DB reset /
other machine / re-confirmed) it SKIPS + warns, never a silent wrong substitution. This is why the harness
now reads M=0 with those docs.

### 4. Snappier Confirm (`54f5366` + `7c9fa4b`, main; Oracle "B+", NOT full-optimistic)
The Confirm→next-doc pause was the round-trip AWAITING best-effort learning: a logo-hash Python spawn
+ 2×150ms sleeps + `captureSample`/`onTaughtConfirm` (two more Python landmark spawns). The Oracle ruled
the full-optimistic renderer WRONG LAYER (would open a silently-gone-doc hole). Fix in the layer where
each piece lives: `reviewService.confirm` detaches captureSample + onTaughtConfirm (fire-and-forget after
persistence + notifyCounts); the 150ms `releaseDelayMs` dropped; the renderer backgrounds the logo save.
`confirmReview` STAYS awaited → atomic claim + fail-toward-review intact. Pinned in `test_reviewservice.js`
(a never-resolving/rejecting hook must not delay or crash confirm).

### 5. Type-precedence fix (`b48e628`, main) — the worksheet→sales_order bug
A supplier issuing several doc types on ONE letterhead had every doc forced to the first-learned type
(identical-fingerprint sibling templates; the established one won and stamped the wrong type over the
doc's own title). Fix: thread the document's own detected title into `identify_template`
(`detected_slug` + `title_trusted`), computed ONCE and passed identically into BOTH match sites
(process_docs pre-extract + the engine's authoritative one). Within a same-logo cluster it PREFERS the
sibling whose type matches the title, and REFUSES (returns None → doc to review to teach) when a TRUSTED
title declares a type no sibling has. `title_trusted` gates on the STRUCTURAL heading signal
(`keyword.detect_document_type` now exposes `heading` + `_line_is_heading_like`), NOT a confidence
threshold. Live Ashford spot-check passed (worksheet→#10, sales_order→#9, PO→refuse). Guarded by the new
identical-fingerprint fixture in `tests/test_template_matcher.py`.

### 6. Title aliases for custom doc types (`64931f4`, branch `feat/doctype-title-aliases`)
Removes the onboarding caveat "the type name must match the printed title". A type lists **aliases**
(other printed titles) and a doc headed by any is detected as that type. `document_types.title_aliases`
(JSON TEXT, **migration 43** via safeAdd); shared `normaliseTitleAliases` (hard-rejects an alias equal to
ANY existing type name; drops <3-char/numeric/over-long with a notice; caps 20); folded into the type's
NAME-keyed bucket in `keyword.detect_document_type` (result stays the NAME, so detected_slug/heading-trust
unchanged; **byte-identical when no aliases**). UI = "Also appears as" chips in the shared
`doctype-editor.js` (Settings + Teach). Help updated (`document-types.html` + help-mode text) with the
niggly bits. Guarded by `tests/test_detect_type_aliases.py` + `database/modules/test_document_types_aliases.js`.

### 7. Document-Issuer anchor readout (`e793dbd` — committed but UNTESTED, `src/windows/review/renderer.js`)
Drawing a ⊕ box around a supplier (top-corner logo/letterhead, no caption) showed a garbled anchor
readout (the auto-label search OCR'ing logo/noise to its left, stored as a LOCATED label). Fix: for
`supplier_name`/`customer_name`, suppress the readout (clean toast instead) AND downgrade the staged
anchor to position-only (`label_detected=false`, clean label) so a garbled label can't be saved or
mis-locate later. Reusable (all suppliers/layouts); other fields keep the normal readout. **Committed
(`e793dbd`) but NOT yet tested in-app — verify the clean toast + no garbled bar, then keep or adjust.**

## Open follow-ups (deferred, non-blocking)

- **Merge decisions pending the user:** `feat/doctype-title-aliases` → main; the uncommitted anchor fix →
  its own branch; and `main` itself is unpushed/unbuilt.
- **Hyphen-aware type matcher (aliases slice 5, deferred by the Oracle):** make `_type_keyword_pattern`
  split on `[\s-]` + universally boundary-guard, so `W-Sheet` also matches OCR variants. Its own PR
  behind its own harness gate — it changes matching for EVERY doc incl. built-ins.
- **Supplier-identity-on-refuse (type-precedence follow-up):** on a template REFUSE the issuer can come
  back empty (fail-safe → review). Seed supplier identity (only) from the logo-matched-but-type-refused
  template so a genuinely-new type doesn't lose the issuer.
- **Worksheet ref/date first-touch = 0/8** — the *auto-label-from-field* feature (design DONE + Oracle
  SIGN-OFF-WITH-CONDITIONS earlier this session; NOT built): derive a weak keyword label from each custom
  field's own label+type. Conditions: only derive gated fields (date/ref/currency), attach a review note,
  refuse ungated free-text, `keyword_autolabel` method + teach-CTA filter, a custom-type fixture test.
- **Cleanup (user's live data):** 3 mistyped Ashford docs (`AW_wor_15`, `AW_wor_34` → set worksheet;
  de-confirm `AW_wor_38`) — a wrong template link can't self-heal via reprocess. And purge the poisoned
  learned values (City Office invoice_number '1/2', Cloud VPS '102') via Review → Advanced → learning history.

## Test artefacts (this session)

- **500 fresh scanned test PDFs**: `C:\Users\cmccu\Desktop\Fresh Test Docs\` — 10 fictional suppliers ×50,
  unique logo/font/accent/layout/ref+date format per supplier, varied doc types, all image-only (OCR path).
  `_ground_truth.csv` maps each file → true supplier/type/ref/date/total. Generator:
  `scratchpad/gen_scanned_docs.py`. These are the Ashford-etc. docs the harness now reprocesses.
- **Spot-check runners** (scratchpad, reusable): `spotcheck_ashford.js` (type-precedence proof on real
  pixels), `run_fresh_import.js` (first-touch import scoring vs GT). Use ELECTRON_RUN_AS_NODE.
- The real-doc harness now reprocesses **1745** confirmed docs; the ~8 flagged "regressions" are all the
  Ashford multi-template set (blank-GT suppliers, the mis-confirmed PO, scanned-date-read limits) — M=0,
  not caused by any of the above changes (the no-alias detection path is provably byte-identical).

## How to verify
- Python (script-style): `cd python_backend && py -3.12 tests/<file>.py` (needs PYTHONIOENCODING=utf-8 for
  the arrow-bearing suites).
- JS (Electron-as-Node): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <test>.js`.
- Harness (~8 min): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/realdoc_regression.js`
  — gate = M=0 + no non-Ashford accuracy drop. Clear `python_backend/**/__pycache__` after Python edits.
