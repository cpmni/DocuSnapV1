# HANDOVER — 2026-07-20 EVENING

**Branch** `feat/reprocess-throughput-autostraighten` · **all pushed through `1bc144e`** · working
tree CLEAN (only the untracked `../Backup/` folder, which is not ours).
**Installer** `dist\ScanFinder Setup 2.0.0-r20260720-1424-ac47d00.exe` (built 14:24). It carries
everything up to `ac47d00` — so it does **NOT** contain the issuer-band fix (`e8f3a6c`), the
letterhead reader (`7d314e0`, dark anyway) or the geometry hand-off (`1bc144e`). **Rebuild before
the next fresh-install test.**
**Read this first, then `HANDOVER_2026-07-20.md` (the morning session), then `CLAUDE.md`.**

---

## TL;DR

Two features shipped ON (auto-file trust gate, issuer band). One shipped DARK and **measured as not
working on real documents** (letterhead reader) — that measurement is the session's most valuable
output. One piece of groundwork landed inert (word-geometry hand-off), together with a probe that
**invalidates the obvious next design** and points at the right one.

Also found, and NOT yet acted on: **10 documents in the live DB carry the wrong supplier**, all
stamped by `template_fixed`. That is the owner's long-standing "drift" complaint with a mechanism
attached, and it is the highest-value open thread.

**I published wrong numbers three times today** from a harness with three separate defects. Every
number in this document is stated with what it measures and what it cannot see. Trust the labels.

---

## COMMITTED THIS SESSION (all pushed)

### `5f88791` + `eb79638` — auto-file trust gate: free-text fields no longer block forever (ON)
Sub-100 auto-file required EVERY valued field to pass `valueMatchesShape`, which returns false for
`'freetext'` **by design**. A per-document customer name is unpredictable by definition, so the
requirement was UNSATISFIABLE — graduation (the reward for 10+ clean confirms) was unreachable for
any document carrying one. Measured: **29 docs held, 25 of them among the 156 already hand-confirmed**
(~1 confirm in 6 wasted on a document the system was never going to file).

**The trap that killed two designs** (Oracle): `item="Information"` is a misread that **gets
CONFIRMED**, which collapses its own field to freetext — so a blanket freetext exemption disarms the
guard exactly when the field is poisoned. Today's blanket block fails SAFE under contamination; both
proposed designs failed OPEN. Also rejected: keying on `isNameLikeField` (it matches on SUBSTRING,
so `customer_order_number` is "name-like").
**Shipped:** `_dominantStructuredClass` (≥5 samples, ≥75%) consulted only in the lenient branch.
**Never change `classifyLearnedShape` itself** — it feeds `scopeTrust`, where reclassifying widens
GRADUATION. NULL/dangling role ⇒ no leniency (the 88 floor is already a no-op there).
Kill switch `TRUST_NONROLE_SHAPE_LENIENT=0`. Gate: corpus 50→82 would-auto-file, **M unchanged at 1**,
M_type 0, accuracy byte-identical.

### `0f3c8e9` — detected-type nudge + migration 51 (ON)
`documents.detected_type_name`, NULL-inert, set only when a detected type name matches no installed
type. Review offers **"Add '<type>'"** which adds the type **and RE-READS the document** — because
extraction ran against the union of all installed types' keys, so add-then-auto-select blanks every
field (Oracle's catch). Kill `DETECTED_TYPE_NUDGE=0`.

### `39e8142` (morning) + this session's `5f88791` renderer half — Review tells the truth about holds
Three false hold-reasons of the same class fixed today. An untyped doc was told to *lower the
auto-file threshold* (impossible: `trust.js` refuses `no-type` at any threshold); a graduated doc
ABOVE its floor was told **"Ready to file"** about a document the predicate had refused. New
`get-auto-file-reason` IPC returns the SAME predicate's verdict; the panel names the blocking field.
**Rule going forward: when Review explains a hold, it must read the real verdict, never re-derive one.**

### `e8f3a6c` — the issuer band (ON)
Stage 2.5a adopted a known supplier HINT found anywhere in a raw `ocr_text[:600]` slice whose
docstring called it "the issuer band". It is not one — the RECIPIENT name sits ~160-180 chars in on
real documents, so the CUSTOMER was admissible evidence for the ISSUER. Now truncated at the first
recipient marker via `chrome_band.issuer_chrome`, **keeping the 600-char reach** (`_HINT_BAND_LINES=40`).
**Do not use `issuer_chrome`'s own `max_lines=6` default** — it is calibrated for TOKEN-RATIO
consumers that degrade gracefully; this one is an all-or-nothing substring test.
**The reward is on the GRADUATION arm, not the swap arm** (I measured the swap arm, found zero
exposure, and nearly shipped it as a zero-benefit hardening): graduation swaps a NOTED fill for an
UN-NOTED one, and `trust.js` refuses auto-file on any note BEFORE the floor check — **the note IS
the human checkpoint**, and its stated evidence standard had never matched the code.
**Oracle's blocking catch:** the swap arm has NO else branch, so suppressing a match left an
IMPLAUSIBLE incumbent (`IN`) standing as the filing folder and learning scope, unnoted. Now blanks
with a note, delta-scoped. Kill `ISSUER_HINT_BAND=0`.
**Does NOT fix** the buyer-issued vendor-caption class — needs a type-aware slice; do NOT add
supplier/vendor/seller to `_RECIPIENT_MARKER` (type-blind, 3+ consumers, and "Supplier: ACME" is the
issuer's self-declaration on a supplier-issued form).

### `7d314e0` — letterhead issuer reader (**DARK, and it does not work on real documents**)
`LETTERHEAD_ISSUER=1` to arm. **Leave it off.**
- synthetic Demo Docs, 45 docs cold: **31 correct, 0 wrong (69%)**
- **REAL scanned invoices, 14 docs: 0 suggestions (0%)**

Not a tuning miss — a design ceiling. Real invoices read `SuperStore` → `INVOICE` → `# 32104`: the
name is line 1 with **nothing beneath it to corroborate against**. The synthetic generator always
prints an address block under the name, so the corroboration rule was calibrated against a world
that does not exist. Per-document causes: SuperStore (8 of 14) dies on corroboration; Contoso Asia
has 1 address line where 2 are required; City Office NI fails the name shape on an OCR noise prefix
(`~    City Office NI`).
**STOP RULE, in the module header:** do not rescue this by loosening corroboration or stripping
noise prefixes — that is tuning against the 14 documents someone happened to look at.

Oracle SENT IT BACK first; all conditions are folded in: the **button never rendered** (the renderer
arms "Use '<name>'" by REGEX-MATCHING the note text, and mine said "confirm the company" vs the
required "confirm the **correct** company" — computed, stored, silently dropped, every test green,
zero user-visible effect); the uncaptioned window-envelope layout suggested the **customer**; and
`type_phrases` was fed bucket KEYS (10) not PHRASES (89), so a logo-only letterhead suggested
**"TAX INVOICE"** as the company. `test_letterhead_note_contract.js` now spans the Python↔JS seam
and is proven red on the old wording.

### `1bc144e` — word-geometry hand-off (INERT, no caller yet)
`reconstruct_page_text(..., words_out: dict|None = None)` → `{words, med_h, lines, size}`.
Byte-identical with no caller. Units: **image-natural pixels, top-left, (left, top, w, h)** — NOT
anchor space, which is centre-based and normalised.

### `ebaf220` — cold-start supplier harness (`stress_test/demo_supplier_learning.js`)
Not in any suite; needs the Desktop Demo Docs corpus; ~40 min. Env: `DEMO_ROOT ONLY TYPES PER_TYPE ISOLATE`.

---

## THE NEXT PIECE OF WORK — geometry slice, design already measured

**Do not build "largest text in the top band".** I probed it on the real invoices and it is wrong:

```
h=89   ratio=2.87   'INVOICE'      <- the document TITLE is the largest text
h=46   ratio=1.48   'Date:'
h=42   ratio=1.35   '$22.17'
h=39   ratio=1.26   'Superstore'   <- the ISSUER is only FOURTH
```

**The design the data supports: geometry RANKS, existing text filters GATE.** Exclude document-type
phrases (`engine._letterhead_type_phrases`, already built), drop caption lines ending in `:`, reject
digit-dominant values (both already in the letterhead/title_pick ladder) — that removes INVOICE,
`Date:` and `$22.17`, and **`Superstore` is then the largest surviving candidate**. Neither advisor
proposed this: 007 argued height, reggie argued text, and the data says they only work multiplied.

Two things whoever builds it must know:
1. **Word heights are noisy** — "City Office" OCR'd as `Cit` (h=64) + `Office` (h=101). Compute a
   candidate's height at LINE level (median/max over its words), never per word.
2. **Always ratio to `med_h`**, never absolute pixels — that is what makes it DPI-invariant, and
   this project has a documented DPI-hint bug in exactly that shape.

Wiring still needed: thread `words_out` from `ocr/engine.py:38` (`TesseractEngine.read_page`) →
`extract_text_and_images` → the engine, **page 0 only**. Note the cached-reprocess caveat: when
`cached_text` is used the OCR pass is skipped entirely, so the geometry will be absent on a reprocess
— fall back to text-only, or re-OCR only when the supplier is still unresolved.

---

## THE HIGHEST-VALUE OPEN THREAD — 10 wrong suppliers in the live DB

Running the letterhead reader over the live DB's 198 stored OCR texts, it disagreed with the stored
supplier on exactly 10 documents. Adjudicated against the filenames: **the reader is right on all 10
and the database is wrong.** `NorthgateTextiles_invoice_03.pdf` and six Vellum & Crane invoices are
stored as **"Copperfield Electrical"**. Several are still in the review queue showing the wrong
company on screen right now.

**All 10 were produced by `template_fixed`** — a template carrying a FROZEN `supplier_name`,
matching documents that are not from that supplier and stamping its own name on them. This is the
owner's reported "drift", with a mechanism. It deserves its own investigation: how does a template
come to match another supplier's documents, and should a frozen issuer ever be applied when the page
text disagrees (a cross-check like `nameCorroboratedByText` exists but is not consulted here)?

Reproduce: `scratchpad/lh_live.py` and `lh_verdict.py` patterns — read-only over
`%APPDATA%\ScanFinder\docusnap.db`, run `letterhead.pick_issuer` on `ocr_text`, compare to
`supplier_name`, adjudicate with `original_filename`.

---

## MEASUREMENT HYGIENE — read this before trusting any harness

**My harness shipped three defects and I published wrong numbers three times.** Fixed and committed,
with a self-check that now aborts on a non-viable fixture. The lessons generalise:

1. **A shared DB file across "fresh" runs.** Learning bled between suppliers; a Marlowe PO resolved
   to "Copperfield Electrical", a company not on that page — and I attributed it to page text
   *because the harness asserted isolation it did not enforce*. Isolation you assert but don't
   enforce is worse than none: it converts a broken fixture into a confident published result.
2. **`runMigrations` creates ZERO document types and ZERO fields.** The built-ins come from
   `seedBuiltInTypes`, which the harness never called — so every document ran against the wrong
   field set ("Stage 1: 0/0 fields found", a purchase order matching a `worksheet_date`). A
   "48 wrong purchase orders" finding **evaporated** once the types existed.
3. **Synthetic corpora flatter.** 69% on the generator, 0% on real scans, same code. Any yield
   number from `stress_test/gen_corpus.py` or Demo Docs is an upper bound, not an estimate.

**And the corpus gate's blind spots, now measured:**
- `realdoc_regression.js` reprocesses CONFIRMED docs while feeding learning built from those same
  docs — its ground truth IS the value that trained the learning. It measures "can it reproduce what
  it was taught", not "can it identify". Both the Larkspur incident and the Northgate→Copperfield
  misfile scored **100% straight through it**.
- It does NOT score `validation_note` or `needs_review`, so it is blind to any change whose cost is
  review volume (that is why the issuer-band change needed `_issuer_report.js` as a second gate).
- It spawns `process_docs.py` directly and never loads Electron → structurally blind to every
  renderer/handler change.
- Its corpus shrank 2495 → 156 docs through DB resets. **100% of 156 is not the same claim as 99.8%
  of 2495** — the corpus that last produced a supplier failure had the hard cases in it.

**Four stale tests found and fixed today** (`test_promote_custom_doctype.js`,
`test_reprocess_type_flip.py`, `test_failure_creates_holding_row.js`, plus
`test_template_identity_graduate.py`'s verdict block sitting MID-FILE so appended checks could never
fail). One pre-existing failure remains and is NOT ours:
`tests/test_identity_fusion.py::test_verdict_conflict_agree_abstain` (verified by stashing).

---

## FIRST ACTIONS FOR THE NEXT SESSION

1. **Rebuild the installer** — the current one predates `e8f3a6c`, `7d314e0` and `1bc144e`.
2. **Investigate the 10 `template_fixed` misfiles** (above). Highest value, directly answers the
   owner's drift complaint, and some are wrong on screen today.
3. **Build the geometry slice** to the design measured above (rank by height, gate by the existing
   text filters). Thread `words_out` through `ocr/engine.py` for page 0 only.
4. Only then reconsider `LETTERHEAD_ISSUER`. It stays OFF until it scores on real documents.

## DEFERRED / DESIGNED, NOT BUILT
- **Buyer-issued vendor-caption class** — a type-aware widening of `_suppress_buyer_seller_issuer`.
  Do NOT solve it by editing `_RECIPIENT_MARKER`.
- **Footer band** for issuer names (owner's idea) — rejected for the band slice as a separate
  concern with its own risk profile (print-bureau/payment-processor names); needs its own measurement.
- Workflow slices 5 (delegation) + 6 (packaging flip = go-live); SEC-04 pairing gate; Barry slices 3-5.

## NEEDS THE OWNER
- Fresh-install test with delivery dockets on the second machine (the detected-type nudge has never
  been clicked by a human — the button, the preselected catalog row and the post-add re-read are all
  untested by any harness).
- Watch the trust-gate flip in the wild: graduated suppliers' clean docs now auto-file at 95%+.
  `TRUST_NONROLE_SHAPE_LENIENT=0` reverts it.
- IONOS deploy (all backend security fixes remain inert), print/Ricoh test.

## KEY PATHS
- Live DB `%APPDATA%\ScanFinder\docusnap.db` (read-only: `sqlite3 'file:...?mode=ro'`), migration **51**.
- Corpus gate `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/realdoc_regression.js`
  → **read `stress_test/out/realdoc_regression.md`, never trust the exit code**.
- Python script-style tests need `PYTHONIOENCODING=utf-8`; `test_identity_fusion` is pytest-style.
- JS tests need Electron-as-Node (native ABI), except pure source-inspection pins which run on `node`.
