# Night Test Report — 2026-07-05 (overnight, no code changed)
Branch: `feat/tray-stage1` · Scope: test EVERYTHING we changed today, on synthetic corpora + the REAL user
DB + real-doc repro. Focus per your ask: OCR accuracy / drifts · pattern recognition & auto-repair ·
naive-user simplification. **No source files were modified.** All work is tests, read-only DB probes, and
real-doc reprocessing with `--trace`.

---

## TL;DR — the five things to read first
1. **Today's fixes are a NET WIN and cause NO accuracy regression.** On the 400-doc corpus: scanned type +2%,
   date +2% (date-misses 12→8), confidence +3–4%; totals stay 100%. The reconciliation-total-pick fix is
   **verified working on the real City Office doc 87** (total now 101.28, was wrongly 84.40).
2. **🔴 One REAL regression introduced today (R2):** commit `0cbafb8` disabled the name-truncation flag AND the
   canonical name-repair for the identity fields (`supplier_name`/`customer_name`) — the two most important +
   most-corrected fields. The fix's intent was right; the lever was too broad. Straightforward surgical fix.
3. **🔴 One stale test (R1):** `35963b4` deliberately changed `_remember_candidates`; its old test assertion is
   now wrong. Not a product bug — just update the test.
4. **🟠 The #1 real-world problem is a "drift" (silent wrong reads):** taught **authoritative anchor crops
   mis-read and win at 97%** — City Office invoice_number reads **192074** when the page plainly says **152574**;
   Profile Construction supplier reads **"PROFLE CONSTRUCTION"**. ⚠ **Do NOT bulk-reprocess+auto-accept these —
   today's changes make them read `needs_review=false` (look clean) while being wrong.**
5. **🟠 Naive-user trap (verified):** the most-blocked docs wear a green **"Looks good · 95%"** badge; the review
   queue is a flat chronological list. Best first simplification: **group the queue by sender** (renderer-only).

Test suites: **Python 90/92**, **JS 82/84**. The 4 failures = 2 today-regressions (R1/R2) + 2 pre-existing.

---

## What I tested (method)
- **Full Python suite** (92 files) + **full JS suite** (84 files), each test isolated in its own subprocess.
- **Pre-vs-post proof:** an isolated `git worktree` at `be5d446` (last commit before today) to prove which
  failures are today's regressions vs pre-existing.
- **Accuracy:** the `stress_test` harness (real `process_docs.py` + real learning) over 400 docs (200
  born-digital + 200 scanned) against `ground_truth.json`, fresh learning, 5 cycles — vs the Jul-1 baseline.
- **Real user DB** (`%APPDATA%\ScanFinder\docusnap.db`, 174 docs) — read-only sqlite probes.
- **Real-doc repro:** reprocessed the actual stuck City Office + Profile Construction working-copies with the
  live learning snapshot and `--trace` to see exactly what the pipeline reads and why.
- **Advisors consulted** (advisory only, no code changed): gary (R2 root-cause/fix), reggie (D1 pattern),
  oscar (D1 OCR-crop), bob (naive-user).

---

## 🔴 Regressions introduced TODAY (2)

### R2 — Identity fields lost their truncation-flag + canonical name-repair  **(MEDIUM-HIGH — real)**
- **Cause:** `0cbafb8` ("supplier IDENTITY not vetoed by GLOBAL name format") added, in `engine.py` Stage 4.5
  (line ~1682): `if not fmt_entry and key not in _IDENTITY_FIELD_KEYS: fmt_entry = ...get(('', dt, key))`.
  The identity field's learned format (incl. `name_lexicon`) lives ONLY at the `('', doc_type, key)` scope, so
  skipping that lookup for `supplier_name`/`customer_name` leaves `fmt_entry = None` → `continue` → the whole
  name block is skipped, which contained BOTH:
  - the **truncation/fragment review flag** (`is_truncated_name`, line ~1735) — a supplier that OCRs as a
    fragment ("Beaumont Care Homes Ltd" with the site cut, or "...Lt") files with NO flag; and
  - the **canonical name-repair** (`repair_name_value`, line ~1704) — a misread supplier ("...Lid"→"Ltd", or the
    real "PROFLE"→"Profile" below) no longer auto-corrects.
- **Why it matters:** identity is the field that drives filing + ALL learning scope, and (per the live DB) the
  JOINT-most-corrected field. The fix correctly killed the false cross-supplier "format differs" veto, but it
  used too broad a lever and took two legitimate safety behaviours with it.
- **Proof:** `test_name_wordness_engine.py` PASSED at `be5d446`, FAILS now, only `engine.py` changed; mechanism
  traced in code; and a REAL example below (D6, "PROFLE CONSTRUCTION" would have auto-repaired pre-R2).
- **Surgical fix (my proposal; gary refining):** keep resolving the global `fmt_entry` for identity too (so
  `name_lexicon` is available for repair + truncation), and gate ONLY the coarse-shape "format differs"
  `check_value` veto branch (further down, ~line 1749+) on `key not in _IDENTITY_FIELD_KEYS`. WATCH the handover's
  warning that a blanket identity exemption breaks the legit `Lid→Ltd` consistent-customer repair — the surgical
  version preserves it. Add a test locking BOTH directions (identity repair/truncation fires; different suppliers
  are NOT shape-flagged).

### R1 — `test_candidate_resolver.py` stale assertion  **(LOW — not a product bug)**
- `35963b4` (reconciliation-total-pick) deliberately made `engine._remember_candidates` ALWAYS build the
  candidate ledger (it now feeds the always-on `_reconciliation_pick_total`), removing the old "no-op when
  candidate_override off" short-circuit. The Stage 4.6 override itself is still correctly gated
  (`_resolve_candidates` returns when off), so behaviour of the override feature is unchanged.
- The test still asserts `_field_candidates == {}` when override off → fails. **Fix = update the test** to the
  new contract (ledger always built; assert the OVERRIDE is a no-op, not the ledger empty). No product change.

---

## 🟠 Real-world problems (from the live DB + real-doc repro)

### D1 / D6 — Taught authoritative anchor-crops DRIFT and win at high confidence  **(HIGH — silent mis-file)**
This is the marquee "drift" you asked about, and it's **systemic** (multiple fields + suppliers). A taught
(authoritative) Stage-2 anchor reads its value from a tight image CROP; that crop OCR **mangles** the value, and
because authoritative reads bypass the shape/type veto, the wrong value **wins at ~97%**.
- **City Office `invoice_number`:** full-page OCR plainly reads `Invoice No.    152574`, but the pipeline returns
  **`192074`** (anchor_crop, 97%). keyword separately mis-reads `"G2"` (grabbed the customer "G2 Environmental"
  from the adjacent column). The correct value 152574 is never even a candidate.
- **Profile Construction `supplier_name`:** reads **`"PROFLE CONSTRUCTION"`** (anchor_crop; dropped the "I").
  The Contoso "Document Issuer" teach became THE supplier_name anchor for ALL invoices (authoritative
  single-anchor-per-doctype sweep), and its crop mangles other suppliers' names.
- **⚠⚠ Action-blocking for the morning:** the handover's "next step: reprocess the queue" would flip the 4 City
  Office docs from FLAGGED-EMPTY (safe) to **CONFIDENTLY-WRONG-AND-UNFLAGGED** (`needs_review=false`, files 192074
  silently). Do NOT bulk-reprocess+auto-accept City Office until the taught anchor is re-taught/cleared.
- **Fix direction (reggie/oscar refining):**
  - (reggie) full-page label→value: read `Invoice No. → 152574` from the correct full-page OCR so it beats the
    drifted crop; and stop keyword taking the wrong column ("G2") in a 3-column "Invoice To | Invoice No. | value"
    header band (a very common layout).
  - (oscar) the crop OCR degrades a number the full page reads correctly (152574→192074) — fix the crop recipe
    (PSM/padding for a short field) AND, the key systemic guard, **cross-check the crop read against the full-page
    read of the same label; if they disagree, defer to review instead of auto-winning at 97%.** One guard fixes
    both D1 and D6.
  - restoring R2's identity canonical-repair would auto-heal "PROFLE"→"Profile" against the learned lexicon.

### D2 — Identity (`supplier_name`) is the joint-most-corrected field  **(reinforces R2)**
- 57 total corrections; top fields: total (12), **supplier_name (12)**, item (11), subtotal (10), invoice_no (5).
- Real identity errors the user has been fixing: `''→SuperStore`, `'Ship To:'→SuperStore` (label bleed),
  `'Solutions'→City Office NI` (fragment), `'50 Asia'→Contoso Asia` (garble), `'Profile Construction ACME
  Inc'→'Profile Construction'` (merge). Identity is the weakest field in real use — weakening its safety net (R2)
  is the wrong direction.

### D3 — "Profile Construction ACME Inc" merge still poisons confirmed data  **(MEDIUM)**
- 3 confirmed docs carry the merged BILL FROM+BILL TO identity; a 4th was hand-fixed. Today's born-digital
  column-split fix **is verified to split the text now** (repro shows `Profile Construction    ACME Inc` with the
  gap), so a reprocess heals the TEXT — but the supplier is currently fragmented into two identities in the
  learning corpus + filing. (Note: reprocess also triggers the D6 anchor-crop mangle, so heal + re-teach the
  anchor together.)

### D4/D5 — smaller items
- **doc 174 confirmed at 9% confidence** (Document Solutions service-ticket, a hard non-invoice layout). Not a
  bug — `overall_confidence` isn't recomputed after manual fixing — but "confirmed at 9%" exists; Learning-Repair
  suspect detection should treat these as candidates.
- A learned anchor label is **mojibake: `'�Subtotal:'`** (SuperStore) — a currency/encoding artifact captured
  into `field_anchors`. Cosmetic.
- 128 `total` supplier-hints stored though `total` is per-doc variable (correctly skipped by the variability
  guard; harmless bloat — could prune variable-field hints at write time).

---

## 🟢 What's working (today's fixes verified)

### Accuracy — net improvement, zero regression (400-doc corpus, tonight vs Jul-1 baseline)
| Field (scanned 200) | Baseline | Tonight | Δ |
|---|---|---|---|
| type | 94.0% | **96.0%** | +2% |
| date | 94.0% | **96.0%** | +2% (misses 12→8) |
| supplier | 86.0% | 86.0% | 0 |
| ref | 93.0% | 93.0% | 0 |
| subtotal / total | 100% / 100% | 100% / 100% | 0 |
| confidence (scanned mean) | 84.5% | **88.2%** | +3.7% |
| confidence (text mean) | 93.7% | **96.0%** | +2.3% |

- **Reconciliation-total-pick (`35963b4`) verified on REAL doc 87:** total now `101.28` ("adjusted to the total
  that balances against the line amounts"), was wrongly `84.40`.
- **Sparse-column scanned-totals recovery, numeric-shape fold, separator-family fold, born-digital column split,
  identity-format skip, verified-badge fix** — all guarded by today's 12 tests, all **green**.
- The synthetic corpus totals were already clean shapes, so the numeric-fold/sparse-column fixes show no delta
  HERE (they target real-doc shapes absent from the corpus) — verified separately by their unit tests + the
  doc-87 repro.

### Auto-repair / pattern recognition
- Non-identity canonical name-repair (Lid→Ltd) INTACT (`test_stage45_text_preserve`, `test_name_match` pass).
- O→0 correction + anti-poison proportional gate INTACT (`test_format_anomaly_checker`,
  `test_shape_acceptance_proportional`, `test_slipfix_to_shape` pass).
- (Identity repair/truncation is the R2 exception above.)

---

## Persistent gaps (PRE-EXISTING — good next targets, not today's fault)
- **Scanned supplier-by-logo: 28/200 unresolved (86%)** — the biggest corpus gap; scanned logo match misses.
- **Scanned ref: 14/200 fail (93%).**
- **Nothing ever reaches conf=100** (ceiling ~98% text / lower scanned). With `auto_file_threshold` defaulting to
  100, NOTHING auto-files on real reads — a user must lower the slider to ~98. Worth surfacing in the auto-file
  suggestion.
- 2 pre-existing broken tests (NOT today): `test_supplier_identity_persistence.js` (test fixture missing the
  `extractions` table) and `test_workflow_ipc.js` (hidden workflow feature flag off). Both fail identically at
  `be5d446`. Low priority.

---

## Naive-user simplification (bob synthesis + my code verification)

### VERIFIED TRAP — the most-blocked docs look the most finished  **(MEDIUM-HIGH UX)**
Row colour (`renderQueueList`): `conf<40`→red, else `isFlagged`→orange, else green **"Looks good"**. `isFlagged`
only counts `review_flag_count`/`below_threshold_count` — **NOT an empty required field**. So the 7 City Office
docs at 95% with an empty invoice number render as green **"Looks good · 95%"** even though Confirm is blocked.
The docs blocked from filing present as the most complete. Cheap fix: treat "missing a required/role field" as
≥orange, and lead the row with its blocker ("Needs: Invoice No.") rather than the confidence score.

### bob's ranked simplifications (don't compromise the review-don't-auto-act ethos)
1. **Group the review queue by sender**, expanded, each group headed "City Office NI — 14 documents · all missing
   Invoice No." (keep a chronological toggle). **Renderer-only — every row already carries supplier + confidence
   + flags; no SQL/IPC/schema.** Turns a demoralising 25-item scatter into ~5 named piles and makes the batch
   nature obvious. **← top recommendation, smallest safe slice, substrate for the rest.**
2. A triage line naming the biggest cluster + the shortcut ("…teach it once and we'll re-read the rest").
3. "Apply what you taught to the other N from this sender" — a sender-scoped reprocess that comes BACK to review
   (never silent auto-file; the reprocess-discards-edits guard already exists). This is teach-once→fix-many made
   discoverable — it directly attacks the 14×-manual-typing pain.
4. Group-scoped "File all that look good" (AFTER read quality improves; keep it gated to no-flag/no-empty docs).
5. Prefill a recurring sender's STABLE fields (won't/ shouldn't fill the per-doc invoice number).

Under-stated traps bob flagged: "95% confident but can't file" is a contradiction to a normal person (lead with
the blocker, not the score); teaching says "next time" so the user assumes the 13 in front of them are still
manual; the flat order actively hides the pattern that would lead to the fix; the one rescue button ("Reprocess
all in queue") is named after the plumbing and reads as dangerous.

---

## Recommended morning priorities (ranked)
1. **Fix R2** (restore identity truncation-flag + canonical repair; surgical) — protects the most important +
   weakest field; gary has the fix design. Add the two-direction regression test.
2. **Add the anchor-crop cross-check guard** (defer to review when an authoritative crop disagrees with the
   full-page label read) — kills the D1+D6 silent-drift class in one move; oscar/reggie refining. Meanwhile,
   **clear/re-teach the drifted City Office invoice_number + the cross-supplier supplier_name anchors**, and do
   NOT bulk-reprocess+auto-accept City Office.
3. **Fix the "Looks good" badge** to reflect an empty required field, and **group the review queue by sender**
   (renderer-only) — the highest-leverage naive-user wins.
4. Fix R1 (update the stale test).
5. Backlog: scanned supplier-by-logo (28), scanned ref (14), the auto-file confidence-ceiling UX, the mojibake
   anchor label, doc-174-style low-conf-confirmed in Learning-Repair.

## Reproduce
- Py suite: the per-file runner (pytest for `def test_` files, script otherwise), each isolated.
- Accuracy: `MODE=fast CYCLES=5 …/electron stress_test/run_stress.js` → `out/results.md`; `…/electron
  stress_test/analyze.js` → variant breakdown. Baselines preserved as `out/*_baseline_jul1.md`.
- Real-doc drift repro: read-only scripts in the session scratchpad reprocess the live working-copies with the
  live learning snapshot + `--trace` (never writes the live DB).

## Advisor deep-dives (all validated the findings; advisory only, no code changed)

### gary — R2 root cause + fix (CONFIRMED, with a sharper fix than mine)
- Confirmed the exact diff + mechanism. **Also proved name-repair is disabled for identity** via probe
  (`"Beaumont Care Homes Lid"`→`"Ltd"` repair lives inside the skipped block) — and it was **untested**
  (`test_stage45_text_preserve` exercises repair only on the non-identity key `"customer"`, which is why
  `0cbafb8` shipped green).
- **Fix = two hunks:** (A) restore the UNCONDITIONAL global `fmt_entry` fallback (line ~1681-1683); (B) bypass
  ONLY the coarse-shape "format differs" veto for identity — `if key in _IDENTITY_FIELD_KEYS: continue` placed
  immediately before the `results[key] = {… 'format differs' …}` at line ~1785 (identity is always a text field,
  so it only ever reaches that text branch — safe by construction).
- **Rejected the tempting alternative** (gating the whole block on `matches_stable_prefix`): a *garbled* identity
  breaks prefix-match, so it would skip the very `Lid→Ltd` repair we must restore — evidence-backed.
- Optional **Hunk C** (1 clause): gate the identity truncation call on `matches_stable_prefix` to avoid a
  PRE-EXISTING opt-in truncation false-flag (a shorter *different* multi-token supplier). BEAU still fires.
- **Tests (lock both directions):** identity repair fires (the untested gap) · identity truncation fires ·
  different supplier NOT shape-flagged (strengthen with a *shaped-class* corpus, not the synthetic SuperStore
  one which resolves to freetext) · identity cross-supplier truncation NOT flagged. **`customer_name` is equally
  affected** — cover it too.

### oscar — D1/D6 crop drift (CONFIRMED; the guard fixes both)
- Diagnosis: the crop path (`anchor._crop_and_ocr`, 2× LANCZOS upscale + autocontrast/sharpen, PSM 7/6) is a
  DIFFERENT, lossier measurement than the full-page PSM-3 native-DPI read — it corrupts the `5` glyphs
  (5→9, 5→0). A **digit whitelist would NOT fix this** (both wrong outputs are already digits). The box landed on
  the right row (rigid `anchor_crop` won), so this is crop-READ quality + a missing cross-check, not placement.
- **Fix (smallest robust):** extend the existing label-locate/inline-harvest (`_locate_for_relocation`, already
  cached via `line_cache`) to STRUCTURED ref fields with *disagreement* semantics — after an authoritative
  `anchor_crop` produces a structured value, harvest the same label's inline value from the full page; if they
  **differ**, don't let the crop win at 97% — prefer the full-page value / cap conf + force review. Byte-identical
  when they agree. Must live in `anchor.py` (authoritative promotion is downstream of the engine arbiter).
- **The invariant that kills the whole silent-drift class:** *an authoritative anchor may only win silently when
  two independent reads of the same field agree; on disagreement → review.* Reusable across every supplier/field,
  no per-doc logic. Complements: PSM-8 ladder rung for a lone token; a shape-derived whitelist (safe per-field).
- No new deps (Tesseract/pytesseract Apache-2.0, Pillow, NumPy, pypdfium2 — all OSS-safe; PyMuPDF stays out).

### reggie — D1 full-page label→value ("Invoice No. 152574" vs the wrong "G2" column)
- **Exact cause:** the label pattern matches "invoice no" but STOPS before the trailing "." — so `after = ".
  152574"`; the leading-separator strip (`keyword.py:412`, `^[\s:|\-–]+`) doesn't include ".", so column-split
  yields `['.', '152574']`, takes `'.'` (rejected as too short) → the same-row "right" read FAILS → falls to the
  line-based "below" branch which grabs the first column of the next row = "G2 Environmental" (the cell under
  "Invoice To"), truncated to "G2". Two defects: trailing-"." label residue + a "below" fallback that can't
  column-align.
- **Fix = 3 lines** after `keyword.py:416`: drop a leading PURE-punctuation residue column (`re.fullmatch(
  r'[.\-–:#|)*]+', seg)`) so the real value in the next column is taken — only when a following column exists;
  never drops a segment containing a letter/digit. Additive, precision-preserving, no validation/renderer change.
- **Generalizes** to every "Invoice To | Invoice No. | value" 3-column band + sibling ref fields (PO No., SO No.).
- Latent pre-existing flag (separate call): the bare `{"text":"#","directions":["right"]}` label
  (`keyword_patterns.json:99`) would grab "Account # 3541" on docs lacking an "Invoice No." label — protected today
  only by label order.
- Together with oscar's crop cross-check this FULLY resolves City Office invoice_number: reggie makes 152574 a
  candidate from the correct full-page OCR; oscar makes the drifted crop 192074 defer instead of winning.
