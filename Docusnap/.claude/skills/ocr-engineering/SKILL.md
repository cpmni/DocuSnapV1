# Skill: OCR Engineering (deep)

A working knowledge pack for diagnosing and designing document-OCR EXTRACTION systems —
recognition AND geometry. Bias: prove root cause, fix the reusable layer, never one doc.
Licence rule: only OSS that is free for commercial use; state the licence (PyMuPDF is
AGPL — use pypdfium2, BSD-3/Apache, as this project does).

## 1. The two-axis model (use this first, every time)
OCR failures are either:
- **Reading** — the right region is cropped but the recognised text is wrong (garbled
  glyphs, merged words, separator noise, low-confidence soup).
- **Placement** — the recognised text is fine but the crop was taken from the wrong
  place (drift, off-by-one-row, column bleed, a frame/scale mismatch).
Decide which BEFORE proposing a fix. Tell: a *uniform* error across many fields ⇒
placement (geometry/frame); a *per-field, content-dependent* error ⇒ reading.

## 2. Coordinate frames (the #1 source of "moved" bugs)
A box passes through frames; name each hop:
- **image-natural px** (the rendered page bitmap)
- **page-normalised [0,1]** (stored mappings, landmarks, anchors)
- **canvas/CSS px** (what the user drew on; depends on getBoundingClientRect + zoom/pan + object-fit)
- **crop-relative px** (what Tesseract sees for a single crop)
Checks: Does the draw canvas EXACTLY overlay the image (no letterbox/object-fit:contain
gap)? Is the stored value normalised to the IMAGE or to the CANVAS? Are render DPIs equal
at teach time vs read time? A constant vertical/horizontal offset across all fields is the
fingerprint of a frame or origin mismatch — chase it before touching OCR.

## 3. Anchor → value (the rigid local link)
On a fixed template the value sits at `located_label + offset`. Store
`offset = target_origin − anchor_origin` (box corner to box corner). At read time:
- locate the label's TIGHT OCR bbox (not the drawn box);
- re-derive the label's box-origin: `located_origin = located_tight − inset`, where
  `inset = (drawn_anchor_size − located_tight_size)/2` (assumes the label sits centred in
  the drawn box — VERIFY this assumption; if the drawn anchor box is the tight label
  itself, inset ≈ 0);
- `value_origin = located_origin + offset`.
Pitfalls: applying the offset to the tight bbox instead of the box-origin clips leading
glyphs ("PROFILE"→"ROFILE"); a wrong/zero offset places the value ON the label.

## 4. Key/value rows & merged-line OCR (a top cause of relocation REFUSAL)
"Label …gap… value" rows frequently OCR as ONE line. Locating the label then returns a
box spanning the whole row. Guards:
- **extract the label run** — the leading contiguous words that match the needle, so the
  value words are excluded;
- **refuse a too-wide match** — if the located "label" is ≫ the drawn anchor (e.g. ≥2.5×
  width), don't relocate off its left edge (you'd read the wrong column) — fall through.
DANGER: if "refuse too-wide" fires, the field falls to the GLOBAL transform or to nothing
— so a merged-row label can silently hand positioning to registration. When debugging
drift, check whether the relocation is being REFUSED (too wide) before blaming precedence.

## 5. Registration ("register, then read") — a FALLBACK, not a primary
Derive 3–5 stable/unique/well-spread landmark words from the sample; re-locate them on the
incoming page; fit a similarity/affine transform (RANSAC) from taught→located centroids;
map each taught box THROUGH it. Properties:
- handles translation AND scale/skew (a pure offset only handles translation);
- but a too-few/poor fit, or stale landmarks (sample file changed/missing), drifts EVERY
  mapped box by a similar amount — the classic "all fields shifted one row" look;
- so registration must NOT override a value whose own anchor was found. Precedence:
  **absolute-on-clean-page → anchor+offset (when the label is found) → registration
  (only when no usable anchor) → nothing**. If a global transform wins while a local
  anchor was available, that is the bug.
Box divergence (drawn box vs its transform image) tells you the page is registered
differently — but it does NOT tell you the transform is CORRECT; a bad fit also diverges.

## 6. Tesseract & crops (reading axis)
- PSM 7 (single line) for a one-line value crop; PSM 6 for a block; PSM 8 for a single word.
- `image_to_data` gives per-word `conf` + bbox — use mean/min-word conf as a real trust
  signal; never commit a synthetic 90 over a 55-confidence read.
- Light-first ladder: greyscale → upscale-small-only → PSM7 → PSM6 → heavy (autocontrast/
  Sauvola/unsharp) ONLY when light is empty. Heavy upscale+sharpen DESTROYS clean
  high-DPI/born-digital crops (turns a clean name into "nara"). The interactive draw tool
  and the extractor MUST use the SAME recipe or a drawn box reads differently than reads.
- Structured fields: let regex validate (Tesseract under-reads dashed digits, so don't
  cap a valid "2602-0768-1" on confidence). Free-text: cap by OCR conf, flag don't drop.

## 7. Debugging method (what to instrument)
Per field, capture: which RUNG won (absolute / anchor+offset / registration), the LOCATED
anchor box, the DERIVED value box, the read text, and the OCR mean/min conf. Compare the
resolved box to the DRAWN box (Δ tells you absolute vs moved) and to the actual value
(tells you correct vs drifted). The decisive triage:
- resolved == drawn, off the value ⇒ the DRAWN/stored coords are wrong (teach frame) OR the
  page isn't shifted and the box was simply mis-drawn;
- resolved moved, off the value, rung=REG ⇒ global transform winning/poor (precedence or
  landmark quality);
- resolved moved, off the value, rung=map ⇒ offset/inset math wrong;
- right place, wrong text ⇒ reading axis (recipe/PSM/preprocess).

## 8. Generalisation discipline
Every fix names the layer (frame conversion / offset math / precedence rule / OCR recipe)
and how it helps UNSEEN templates. No filename- or sample-specific coordinates. Prefer a
multi-sample or synthetic check over a single-document confirmation.
