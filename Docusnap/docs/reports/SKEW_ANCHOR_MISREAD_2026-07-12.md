# Overnight investigation — skewed-scan reference misreads (Cascade delivery dockets)

**Date:** 2026-07-12 (overnight, autonomous) · **Trigger:** operator saw delivery-docket numbers
auto-filed WRONG (DN-11354 → IN-11354) and attributed it to page skew. · **Process:** full specialist
+ Oracle gauntlet (oscar, reggie, 007, gary, Oracle) per the advisor-gate directive.

> **TL;DR.** The operator was right that skew is involved, but the *mechanism* is subtler than "the
> glyphs read wrong": **page skew breaks the taught anchor's LABEL RELOCATION**, sending the value
> crop to the wrong place → a confident, shape-valid misread (D→I / D→Y). Two independent fixes,
> different paths, both Oracle-signed, **NOT yet built** (they touch the extraction/auto-file path
> and want your eyes + a corpus M=0 gate + a reggie precision pass before shipping):
> 1. **Prefix-outlier guard (SAFETY — build first).** Stops a shape-valid misread from auto-filing +
>    poisoning learning **on import**. Would have caught all 6 of your bad auto-files.
> 2. **Deskew-on-reprocess (QUALITY — the feature you asked for).** "Straighten + Reprocess" reads
>    the straightened page → the anchor relocation works → correct read. Review-bound recovery tool.

---

## 1. The evidence (measured, not assumed)

**Real before-state — the app's ACTUAL reads on your 20 imported Cascade delivery dockets, scored
against the known true values (regenerated from the deterministic generator):**

| | count |
|---|---|
| Correct | **13 / 20 (65%)** |
| Wrong | 7 |
| …of which **AUTO-FILED wrong** (85–97% conf, now poisoning the learned set) | **6** |

**Every failure is an ANCHOR read** — `anchor_crop` (4/9 correct) and `anchor_registration` (1/3).
The `manual` / `anchor_inline` / `anchor_crop_recovered` / `anchor_crop_crosscheck` methods were all
correct. So it is specifically the anchor **crop / relocation** rungs that misfire on skew.

Sample wrong auto-files: `IN-57505`, `IN-11354`, `YN-44834`, `IN-77832`, `IN-60360`, `IN-93900` —
all the true `DN-` prefix misread as a **single-substitution neighbour** (`D`→`I`, `D`→`Y`).

**Root cause — reproduced with the REAL anchor code on docket_11 (skew −1.4°):**
- `anchor._relocate_value_by_label` searches a full-page-width row band by **fuzzy label
  text-match**. On the skewed page the tilt mis-groups the OCR rows, so a wrong text run wins the
  fuzzy match and the value crop lands at **x≈0.26 (wrong side of the page)** → garbage / clipped
  first char.
- On the **deskewed** page the correct "Delivery Note No." label is found at **x≈0.84** and the value
  reads **`DN-11354` correctly.**
- So skew breaks the *relocation*, not the glyphs. (A wide region OCR reads `DN` fine on the raw page
  — which is why "it looks fine" but the anchor still misreads.)

**Before/after harness (real anchor read over the anchor set, raw vs deskewed):**

| condition | correct | note |
|---|---|---|
| raw | 60% | before |
| **deskew** | **80%** | misreads halved — the fix |
| raw + **wide crop** | 60% | **your crop-widen idea — tested, does NOT help** |
| deskew + wide crop | 80% | widening adds nothing over deskew |

**Why crop-widen doesn't help:** the relocation lands in the wrong *place*, so a wider crop just
reads the wrong spot cleanly. Widening only helps a crop that's correctly-placed-but-clipped; that's
not this failure. (Good idea, and worth keeping in mind for a genuine clipping case — just not this
one.)

---

## 2. The critical framing (Oracle) — two paths, two fixes

The confident misreads **auto-file on IMPORT** (`_maybeAutoFile`, handler.js:2232). A **reprocess
always routes to `needs_review`** (handler.js:1099) and cannot auto-file. So:

- **Deskew-on-reprocess does NOT stop the live harm** — nobody re-straightens 20 dockets that already
  filed themselves silently. It's a **recovery / quality tool** (better reads when you choose to
  straighten; cleaner re-teaching).
- **The prefix-outlier guard is the safety fix** — it runs on the import/auto-file path and refuses
  the shape-valid misread before it files + poisons.

Don't let the strong deskew evidence displace the guard: **build the guard first.**

---

## 3. Fix 1 — Prefix-outlier guard  (SAFETY · build first · Oracle: BUILD, priority)

**Why nothing catches it today:** `IN-11354` is **shape-valid** — it passes the reference regex, so
no credibility / format / shape gate fires, and it auto-files at 97%. A gate-*failure* trigger (like
REREAD_ESCALATION) can never fire on a valid-shaped wrong value. Only a **learned-value model** catches it.

**Design (Oracle-shaped; mirrors the Stage-2.5d dominance machinery in `ocr_corrector.py`):**
- New `build_prefix_index(formats_data)`: per (supplier, doctype, ref-field), learn the **dominant
  leading-alpha prefix** of confirmed CODE values (`DN` from `DN-11354`) + the set of all confirmed
  prefixes. Qualifies only above a confirmations-count + share threshold; values must carry a digit
  (codes, not names).
- Guard `_flag_ref_prefix_outlier`: a read whose prefix is **NOT a confirmed prefix** AND is a
  **single-substitution, same-length neighbour** of the dominant (`DN`→`IN`, `DN`→`YN` — a classic
  OCR confusion) → **FLAG only**: cap conf ≤69 + note + `needs_review`. **Never snap, never rewrite**
  (the digits are per-doc variable, so you can't correct the value — only refuse to trust it).
- Lives at the extraction/gate level → fires on the **import path** → `isAutoFileEligible` refuses it.
- **Fail-safe:** a genuinely-new legit prefix (a real `IN-` invoice supplier) is reviewed **once**,
  confirmed, joins the known set, and stops being flagged — self-correcting, never a hard reject.

**Impact:** all **6** of your bad auto-files are single-substitution neighbours of `DN` → the guard
would have flagged every one (→ review, not silent file, not learning-poison).

**Conditions before shipping (Oracle):** reggie precision pass on the exact prefix-extraction +
threshold + edit-distance rule (tight scope so it doesn't nag suppliers whose prefix legitimately
varies); **realdoc_regression M=0 + zero per-field accuracy drop** (it sits on the auto-file path);
unit tests that (a) reproduce the Cascade `IN` vs dominant `DN` flag and (b) pin "legit-new-prefix
reviews once, then clears". This is the **same class** as the standing Cloudpeak high-conf-ref-misread
triage and the queued reggie `/`-dropped-refs pass — build it as that guard.

*(Note on your already-polluted Cascade set: the learned values now hold 13× `DN` + 5× `IN` + 1× `YN`,
so `DN` is only ~68% dominant — the guard prevents pollution from STARTING on a clean scope; the
already-poisoned Cascade values should be purged via Settings → Learning → Learning Recovery, or
re-confirmed correctly, to restore the dominant prefix.)*

---

## 4. Fix 2 — Deskew-on-reprocess  (QUALITY · the feature you asked for · Oracle: SIGN OFF WITH CONDITIONS)

**"Straighten + Reprocess" reads the straightened page** → the anchor relocation finds the label in
the level frame → correct read (60→80% on the harness; `DN-11354` recovered on docket_11).

**Design (gary + Oracle, build-ready):**
- Deskew each page **transiently, per-page** in `extract_text_and_images` (a new `deskew_pages` param,
  distinct from `enhance_params.deskew`), after the existing auto-rotate. `ocr_text` + the anchor
  crop-source are both straightened; the **filed file stays raw**.
- **Hard guard (mandatory): logo fingerprint must be hashed from a RAW page-0 copy** (keep the
  pre-deskew page 0; use it at `engine.py:1522` for the persisted phash + `:1695` for identity). A
  straightened logo phash would drift and, once persisted (`handler.js:1102`) + appended to
  `template_logo_hashes` on confirm, would poison the supplier's identity set for every future *raw*
  import. Non-negotiable.
- **No coordinate seed-transform needed** — the failing anchor is *captioned*, so it self-corrects
  (relocation re-finds the label on the deskewed page). Registration also self-corrects (RANSAC fits
  the rotation) and actually *improves*. Position-only / rigid-crop anchors read at a raw seed on a
  deskewed page → small shift at low skew (still reads the fixed glyph), a possible neighbour read at
  high skew — tolerable because reprocess is **review-bound**. Defer 007's full seed-rotation (only
  buys the high-skew tail, not in evidence).
- **UX note (Oracle):** surface "straightening may change other fields — please check them" (a
  rubber-stamped shifted field feeds learning).
- Plumbing: renderer Straighten-on → `deskewOnce` in the reprocess payload → handler adds
  `--deskew-pages`, forces fresh OCR (no cached-ocr), and **must not** call `setOcrAutoParams` (a
  one-shot straighten never becomes the template's permanent baseline). Env kill-switch `DESKEW_PAGES`.
- **Gate:** flag-off byte-identical; a logo_phash-invariance test (pins the raw-page-0 guard); real
  before/after measuring per-field **correct→wrong** regressions on *non-targeted* fields; born-digital
  skip. No corpus M=0 (reprocess can't auto-file).

---

## 5. Recommendation & build order

1. **Prefix-outlier guard first** — it stops the active silent-wrong-auto-file + learning-poison.
   (reggie precision pass → M=0 gate → ship.)
2. **Deskew-on-reprocess** — the quality/recovery tool you asked for. (raw-page-0 logo guard is the
   one hard condition.)
3. **Clean the poisoned Cascade values** (Learning Recovery) so its dominant `DN-` prefix is restored
   (helps both the guard and future reads).

Both designs are build-ready from the advisor gauntlet; I did not ship them overnight because they
touch the extraction/auto-file path and warrant your review + the M=0 gate. Say the word and I'll
build them (guard first) with the reggie pass + the corpus gate.

## 6. Also outstanding (unchanged this session)
- Four reviewed/tested but **uncommitted** changes still in the tree: deskew *display* + C1 frame-safety,
  warning-revalidation, taught-anchor dot (red/green), import folder-picker + preview.
- The **detection-deskew** idea remains **parked** (`docs/designs/DETECT_DESKEW_PARKED_2026-07-11.md`).
