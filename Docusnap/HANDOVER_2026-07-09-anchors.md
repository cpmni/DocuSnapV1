# Handover — 2026-07-09 (anchor-bleed + OCR-crop fixes, agent-orchestrated)

Branch **`fix/anchor-bleed-crop-ocr`** (off `fix/autofile-critical-field-floor`, which carries the
morning's per-field confidence floor). Four commits, all tested. Validated on the live real-doc harness.

## What these fixed (two user-reported symptoms)
1. **Anconia #1110 invoice_number read "Not found"** though the crop was a perfect `317437`.
2. **Cross-supplier drift**: teaching an Anconia `invoice_number` anchor made it bleed onto City
   Office (and others), the box landing on a mid-page cell → `$0` / (last night) `1828987`.

## The fixes (all shipped + tested)
- **reggie — OCR clip-debris recovery** (`anchor._recover_clean_token`, commit 4165918). The crop read
  the right value with a short OCR debris prefix (`". = 317437"`), so the credibility gate (coverage
  <80%) rejected it. Now: recover the clean token when EXACTLY ONE whitespace-token matches the field
  pattern and the rest is short punctuation debris; refuse a bare-alnum fragment (`"2 317437"`), a real
  word, or a multi-value drift. Recover-and-FLAG (method `anchor_crop_recovered`, conf≤70 + "please
  verify" note) — never silent. **#1110 now reads `317437` (flagged).** `test_recover_clean_token.py`.
- **gary Slice 1 — supplier-scope the sweep** (`learning.saveAnchor`, commit 647b69a). An authoritative
  teach no longer DELETES other suppliers' anchors for the same field (the "it broke my other suppliers"
  root cause). `test_saveanchor_scope.js`.
- **gary Slice 2 + 007① placement gate** (`anchor.py`, commit d1947fd). Slice 2: `_filter_anchors`
  authoritative priority is supplier-scoped (a cross-supplier teach can't out-rank a supplier's own
  anchor; `__global__`/same-supplier still wins; cross-supplier still ADMITTED). 007①: a NAMED
  cross-supplier authoritative rigid crop is "located" only if its caption is at the TAUGHT position
  (`_located_at_taught_position`: located label TOP-LEFT vs value_centre−offset, per-axis tol
  0.10/0.06; no-offset → low-trust → dropped). Scoped to cross-supplier → same-supplier reads untouched.
  `test_anchor_selection_scope.py`.

## Validation (realdoc_regression.js, live DB, 1207 docs)
- ref accuracy **96.3% → 99.4%**; regressions **46 → 8** (all poisoned test GT).
- Harness M=4 (#896/#897/#916/#1026) — **all poisoned GT: the pipeline reads `152567` correctly, proven
  by the docs' own original filenames (`…29-05-2026-152567-…pdf`); the user mis-confirmed the page
  number `1/2` during testing.** #404 similarly reads its true `22162`. **Genuine silent-wrong-auto-file
  = 0.**

## DEFERRED (next validated slice) — oscar's confident-clean whitelist
oscar designed a type-charset whitelist RE-READ (glyph-preservation guard: accept only if the alnum core
is unchanged) so a debris crop reads CONFIDENT/no-flag instead of reggie's flagged recovery. **The Oracle
BLOCKED shipping it naively**: it removes the credibility rejection that routes a drifted read to Review,
so a cross-supplier crop landing on a DIFFERENT valid number could clean to high conf → auto-file wrong
(a fresh M=1). To ship it: gate it behind the placement decision (never upgrade a NAMED cross-supplier
read; run AFTER 007①), scope to structured types with a non-null `field_charsets` entry, keep the do-not
list (text/multiline/date), add a min-conf floor, mirror into `ocr/region.py`, and RE-RUN the harness
**with it present** asserting M=0. Full recipe in oscar's report + `scratchpad/agent_synthesis.md`.
Not urgent — reggie's flagged recovery already makes the value read correctly (just flagged).

## Other soft follow-ups (Oracle)
- A user-facing note when a cross-supplier read is DROPPED for placement ("Couldn't place X on this
  layout — please check") so an empty required field doesn't look broken. (Today it routes to review via
  required-empty, just without a reason line.)
- Corpus-validate the placement tolerances (0.08/0.10/0.12) if any same-supplier over-reject shows up.
- The ⊕/Template-Wizard "this layout is used by all senders" checkbox → `__global__` supplier (the
  sanctioned opt-in for a genuinely shared multi-supplier template).

## The Oracle (new)
`.claude/agents/oracle.md` — a Tesseract/OCR + office-doc + customer-experience veteran who VETS the
specialists' consensus. First outing: **earned his keep** — caught the oscar/placement M=1 interaction
no specialist saw, a coordinate-frame bug in 007's helper, and settled the 007-vs-gary fork for gary.
Trial log + running assessment: `docs/oracle_log.md` (verdict: KEEP).
