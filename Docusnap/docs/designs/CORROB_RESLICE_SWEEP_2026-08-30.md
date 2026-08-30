# Corroboration-gated re-slice sweep for total / ref / date (2026-08-30)

**Status:** design brief, PRE-advisor / PRE-Oracle. Owner-requested. Build in a fresh session:
oscar (OCR recipes) + reggie (format validation) + 007 (zone geometry) → Oracle → DARK switch → OFF/ON
census before any flip. Builds on the shipped review-bound whole-page straighten retry
(`DESKEW_SLICE_REREAD_2026-08-30.md`, commit `4607cc6`).

## 0. Owner ask (verbatim intent)
"For totals, refs and dates: if there's a note AND the straighten didn't fix it, re-slice using
different parameters until we get corroboration, up to a max number of tries." And, on the whole arc:
"works most of the time — be careful not to regress."

## 1. Root cause that motivated it — Nordwind quote 0023 total (REPRODUCED)
The doc's `Total (inc VAT) £2,363.76` is filed/flagged wrong because the **template_mapping zone re-OCR
mangles it**:
- The taught total TARGET box (`geom [0.845, 0.441, 0.081, 0.0162]`) crops a **134×38 px** region at
  200 DPI. The crop is visually clean (`£2,363.76`), but Tesseract reads it as **`£9 32632.76`** at
  EVERY PSM (6/7/8/11/13, raw/2x/3x LANCZOS — best it manages is `2 263.76`; never the truth). The `£`
  glyph + small size + comma tip it. Reproduced in `tmp/_ocr_slice.py` on `tmp/slices_0023/slice_9_target.png`.
- The **full-page keyword read gets `£2,363.76` right @93** (full-page render + word geometry, not a tiny crop).
- So mapping (garbage) vs keyword (correct) → **disagree → no corroboration** → the format-anomaly
  "please check" note can't clear. On the live app keyword_override WON (correct value filed, note stuck);
  in the sandbox the garbage mapping WON (`9 32632.76` filed @50, "total < subtotal"). Same culprit.
- Most docs' total crops OCR clean → mapping agrees with keyword → corroborated. 0023's render tips it over.

Trace + slices captured under `C:\Users\cmccu\.claude\jobs\<job>\tmp\` this session
(`_trace_0023.js` → `trace0023.txt`, `slices_0023/`, `_ocr_slice.py`). Sandbox DB
`scratchpad/live_e44gate.db`; docs `C:\Users\cmccu\Desktop\Demo Docs\Other\IMPORT\Nordwind-*`.

## 2. Fix #1 — discount a format-invalid corroboration witness (do FIRST, small)
A corroboration WITNESS whose value is **deterministically format-invalid** (`9 32632.76` — embedded
spaces / wrong money shape / fails the field's learned format) is **noise, not a dissent**. Two changes:
- It must **not count as a `disagree`** in the corroboration record (so keyword + reconcile can clear the note).
- It must **not WIN** the field over a lower-stage read that PASSES format AND reconciles (stops the
  sandbox's garbage-total-wins outcome).
Locus: the corroboration record (`engine._build_corroboration_emit` / `_corrob_record_bucket` / the
`disagree` list) + the mapping-vs-keyword merge for a format-invalid mapping value. DARK switch, pin,
census. Cannot regress a genuine two-VALID-values disagreement (both pass format). Clears 0023's flag
because keyword already read `2,363.76` and it reconciles (1969.80 + 393.96 = 2363.76).

## 3. Fix #2 — the corroboration-gated re-slice SWEEP (the owner's idea; the general recovery)
For the harder class where NO family read a valid value (fix #1 has nothing valid to fall back on).

- **Trigger:** a `total` / `ref` / `date` field carrying a note (format or reconcile doubt), REVIEW-BOUND,
  after the whole-page straighten retry did not clear it. Not on a clean auto-file. Not on first import of a
  template-less sender (no zone to re-slice).
- **Loop, capped (~4–6 tries), a DIFFERENT recipe each pass** (curated ladder, oscar to finalise):
  1. **Re-render the zone at higher DPI (300 → 400 → 600) FROM THE PDF** — not upscaling the 200-DPI raster
     (the 0023 lever; LANCZOS on the degraded raster did NOT help).
  2. PSM 7 / 8 / 6 / 13.
  3. Binarise / contrast (Otsu, adaptive threshold).
  4. Money: strip `£`/symbols + `tessedit_char_whitelist` digits+`.,`.
  5. Straighten the slice (the deskew param, per-slice).
- **STOP (adopt) when** a read (a) PASSES the field's learned format AND (b) MATCHES an independent family
  (full-page keyword) OR RECONCILES (subtotal+vat=total for a total). Adopt that value, clear the note
  (corroboration gained), REVIEW-BOUND. **Exhausted → leave flagged, unchanged.**
- **Why low-regression:** adopts ONLY a value another source already confirms → never invents a new wrong
  value; worst case is no change. Noted total/ref/date only; bounded tries; never auto-files.

### Open design questions (for the advisors / Oracle)
- **refs/dates have no math reconcile** → their stop is "matches another family's read". If NO other family
  read it, fall back to "two DIFFERENT-param passes agree" — weaker independence (the deskew design's
  self-agreement warning); gate carefully or exclude this fallback initially.
- Corroboration independence: a zone re-slice matching the FULL-PAGE keyword IS cross-source (legit). Two
  zone re-slices agreeing on the same crop is weaker — different params helps but is not fully independent.
- Cost: bounded by max-tries × (only noted total/ref/date). Confirm the per-doc worst case is acceptable.
- This SUPERSEDES the removed field-scoped slice arm (its trigger was "withheld" → fired 0×; this is
  "has a note" + a param SWEEP + a corroboration stop — the safety Oracle wanted).

## 4. Gate (both fixes)
DARK switches, default OFF. Pins (the format-invalid-witness predicate; the sweep's adopt-only-on-
corroboration decision). OFF-vs-ON census on the Nordwind corpus (0023 must heal) + the broader owner DB:
M=0 (no correct value changed), the flag clears on 0023, 0 new wrong values. Oracle ratify before flip.
