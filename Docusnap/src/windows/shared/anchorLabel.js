'use strict';

// Shared label-quality helpers for the "teach a field" surfaces — the Review ⊕ tool and the
// Teach-a-document wizard. These were previously defined ONLY in review/renderer.js, so the
// teach wizard carried its own weaker label detection: it took the whole left-band OCR text as
// the "label" (a wide two-column key/value row glued the far-left caption onto the adjacent one
// → the label "spanned to the left") and never stripped value-shaped tokens. Extracting them
// here — used by BOTH renderers — makes the label detection identical and unable to diverge again.
//
// PURE functions (no DOM / no closure state). Exposed as window.AnchorLabel for the classic
// (non-module) window scripts, which load this before their renderer.js. Guarded by
// src/windows/shared/test_anchor_label.js.

(function (root) {
  // From the OCR word boxes of a left-of-value strip (one line tall), return the RIGHTMOST
  // contiguous block — the caption NEAREST the value — split from any other column on a wide
  // horizontal gap. Returns { text, box:[l,t,w,h] } in the words' own px space, or null when
  // there are no usable words. This is what stops a wide two-column key/value row
  // ("Ticket No. … Work Address") merging BOTH captions into one bogus anchor.
  function nearestLeftCluster(words) {
    const ws = (words || [])
      .filter(w => w && Array.isArray(w.box) && w.box.length >= 4 && (w.text || '').trim())
      .map(w => ({ text: w.text.trim(), l: +w.box[0], t: +w.box[1], w: +w.box[2], h: +w.box[3] }))
      .filter(w => isFinite(w.l) && isFinite(w.w))
      .sort((a, b) => a.l - b.l);
    if (!ws.length) return null;
    // A real inter-COLUMN gap is several text-heights wide — far larger than the inter-word
    // space inside one caption. Tie the threshold to word height so it scales with DPI/zoom
    // rather than a brittle pixel constant.
    const heights = ws.map(w => w.h).filter(h => h > 0).sort((a, b) => a - b);
    const medH = heights[Math.floor(heights.length / 2)] || 0;
    // Walk left→right; a gap past the threshold starts a new column, DISCARDING everything to its
    // left. The surviving block is the rightmost (nearest) column. The threshold is PER-GAP, scaled
    // to the RIGHT word's height (the caption side, nearest the value) — NOT a global median — so a
    // big BANNER heading sharing the OCR row ("PURCHASE ORDER   Order No. PO-83175") can't inflate
    // the median and swallow the real inter-column gap, gluing the heading onto the caption (the
    // "the label grabs the whole line" class). medH is the fallback when a word has no height.
    let block = [ws[0]];
    for (let i = 1; i < ws.length; i++) {
      const prev = ws[i - 1];
      const gap  = ws[i].l - (prev.l + prev.w);
      const gapThresh = Math.max((ws[i].h || medH) * 1.2, 8);
      if (gap > gapThresh) block = [ws[i]];
      else block.push(ws[i]);
    }
    const l = Math.min(...block.map(w => w.l));
    const t = Math.min(...block.map(w => w.t));
    const r = Math.max(...block.map(w => w.l + w.w));
    const b = Math.max(...block.map(w => w.t + w.h));
    return { text: block.map(w => w.text).join(' '), box: [l, t, r - l, b - t] };
  }

  // Group words into visual rows on y-centre proximity (scale-free: threshold from the median
  // word height; floor keeps very small print from fragmenting into per-word rows). Shared by
  // nearestAboveRow (bottom row) and nearestRowTo (row nearest a given y).
  function _groupRows(words) {
    const ws = (words || [])
      .filter(w => w && Array.isArray(w.box) && w.box.length >= 4 && (w.text || '').trim())
      .map(w => ({ text: w.text.trim(), l: +w.box[0], t: +w.box[1], w: +w.box[2], h: +w.box[3] }))
      .filter(w => isFinite(w.t) && isFinite(w.h));
    if (!ws.length) return [];
    const heights = ws.map(w => w.h).filter(h => h > 0).sort((a, b) => a - b);
    const medH = heights[Math.floor(heights.length / 2)] || 0;
    const band = Math.max(medH * 0.6, 4);
    const rows = [];
    for (const w of ws.slice().sort((a, b) => (a.t + a.h / 2) - (b.t + b.h / 2))) {
      const c = w.t + w.h / 2;
      const row = rows.find(r => Math.abs(c - r.c) <= band);
      if (row) {
        row.words.push(w);
        row.c += (c - row.c) / row.words.length;   // running mean centre
      } else {
        rows.push({ c, words: [w] });
      }
    }
    return rows;
  }

  // From the OCR word boxes of a LEFT-of-value strip that is TALLER than one line (the strip
  // is vertically EXPANDED so a bolder/higher caption isn't decapitated — the 'SO #'→'sok'
  // class, 2026-07-10), return only the words of the visual row NEAREST the given y-centre
  // (the VALUE row's centre in the words' own px space) — so a neighbouring row's words can't
  // hijack the rightmost-column pick that follows. Returns a words array for
  // nearestLeftCluster, or null when there are no usable words.
  function nearestRowTo(words, centreY) {
    const rows = _groupRows(words);
    if (!rows.length) return null;
    const best = rows.reduce((a, b) =>
      (Math.abs(b.c - centreY) < Math.abs(a.c - centreY) ? b : a));
    return best.words.map(w => ({ text: w.text, box: [w.l, w.t, w.w, w.h] }));
  }

  // From the OCR word boxes of an ABOVE-the-value strip, return only the BOTTOM visual row —
  // the caption line NEAREST the value. The strip must be tall enough to CONTAIN the caption
  // (line spacing routinely exceeds the value box's own height, so a one-line strip clips the
  // caption to its bottom pixel-tips and OCR hallucinates junk from the sliver — the
  // "eee F WS CwE ewe" ⊕ readout, 2026-07-10); a taller strip may then catch the row above the
  // caption too, and THIS selection is what stops that row being glued on (the old reason the
  // strip was starved to one line). Returns { text, box:[l,t,w,h] } in the words' own px space,
  // or null when there are no usable words.
  function nearestAboveRow(words) {
    const rows = _groupRows(words);
    if (!rows.length) return null;
    const bottom = rows.reduce((a, b) => (b.c > a.c ? b : a));
    const block = bottom.words.slice().sort((a, b) => a.l - b.l);
    const l = Math.min(...block.map(w => w.l));
    const t = Math.min(...block.map(w => w.t));
    const r = Math.max(...block.map(w => w.l + w.w));
    const btm = Math.max(...block.map(w => w.t + w.h));
    return { text: block.map(w => w.text).join(' '), box: [l, t, r - l, btm - t] };
  }

  // SHORT-CAPTION allowlist (reggie, 2026-07-10): real order-ref captions are often ≤3 chars
  // ("SO", "SO#", "S/O", "Ref", "No.") and died at extractLabel's length gate, leaving the
  // field position-only-anchored even beside a clean printed caption (the MP_sal_35 "SO #"
  // case). CLOSED class — the two known order-ref stems (dotted/slashed forms included), the
  // two bare generic caption words, and at most ONE optional trailing caption punctuation —
  // so 3-char OCR debris ('sok', 'po4', '$0') still returns null (position-only, as today).
  const SHORT_CAPTION = /^(?:[SP]\/?O|[SP]\.O\.?|REF|NO)\s?[.#:]?$/i;

  // The caption nearest the value = the LAST (rightmost/closest) words of the strip text.
  function extractLabel(text) {
    const cleaned = String(text || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const tail = cleaned.slice(-40).trim();
    if (tail.length > 3 && /[a-zA-Z]/.test(tail)) return tail;
    // Normalise a GLUED trailing '#' to the spaced caption form ('SO#' → 'SO #'): the glue is
    // an OCR artifact, and the spaced label locates decisively (1.0 on "SO #" rows, <0.6 on
    // "SOLD TO") where the glued form fuzzy-ties (0.667 on both — a proximity coin-toss).
    if (SHORT_CAPTION.test(tail)) return tail.replace(/(\S)#$/, '$1 #');
    return null;
  }

  // Strip value-shaped tokens so a MAC/IP/reference/date/serial sitting where a label was
  // expected is never saved AS the label (it would never re-locate on a future page).
  // MIRROR PAIR: database/modules/learning.js sanitizeAnchorLabel MUST stay identical —
  // saveAnchor re-sanitizes, and a difference both re-strips the label AND nulls the
  // drift-invariant offset (learning.js's `_clean !== anchor_label` branch).
  function sanitizeAnchorLabel(label) {
    if (!label || typeof label !== 'string') return '';
    const kept = label.trim().split(/\s+/).filter(tok => {
      // A STANDALONE '#' (optionally '#.'/'#:') is caption punctuation ("SO #", "Item #"),
      // never a value — KEEP it: the '#' is the uniqueness that makes a 2-char stem
      // locatable (reggie, 2026-07-10). A glued '#12345' has no letters and still drops.
      if (/^#[.:]?$/.test(tok)) return true;
      if (!/[a-zA-Z]/.test(tok)) return false;                 // bare number / ref / date
      if ((tok.match(/\d/g) || []).length >= 3) return false;  // code-like serial
      return true;
    });
    if (!kept.some(t => /[a-zA-Z]/.test(t))) return '';        // a label must carry letters
    return kept.join(' ').trim();
  }

  // An auto-detected label captured off a NOISY scan can be garbled ("Serial No." → "verial No.",
  // "Description" → a replacement-char-prefixed "escription"). A garbled label never re-locates on
  // future pages, so the taught anchor silently reads nothing forever. Flag the obvious garble so
  // the readout can warn + let the operator fix the label before it's saved.
  function labelLooksSuspicious(label) {
    if (!label || !label.trim()) return true;
    if (/�/.test(label)) return true;                                  // OCR replacement char
    if (/[^\p{L}\p{N}\s.,'&()/:#%\-]/u.test(label)) return true;            // junk symbols real captions don't carry
    // a long alphabetic token with NO vowel reads as garble ("brtnz", "vrntx")
    const toks = label.split(/\s+/).map(t => t.replace(/[^a-zA-Z]/g, '')).filter(t => t.length >= 4);
    if (toks.some(t => !/[aeiouy]/i.test(t))) return true;
    // intra-token case chaos — a lowercase letter immediately followed by an uppercase one.
    // A real caption never does this (Title-case caps only at the front; ALLCAPS not at all),
    // but garbled OCR does ("Site / Customer" misread as "VUoWwriter" trips o→W). Also catches
    // an ALLCAPS word with one misread lowercase ("INVOlCE" → l→C). reggie-designed 2026-07-10;
    // 0 false-flags across the real-caption vocab. Cannot catch clean-case clips ("verial",
    // "escription") — no character rule can (they read as words) → left to the operator.
    if (/\p{Ll}\p{Lu}/u.test(label)) return true;
    // COMMA-ORPHAN (D1, 2026-07-11): a label ending in a comma + a single stray letter ("esha, i")
    // is an OCR FRAGMENT (a word split across the strip edge), never a real caption — flag it so
    // the existing suspicious->position-only downgrade drops it instead of staging garble.
    if (/,\s*\p{L}\.?\s*$/u.test(label.trim())) return true;
    // DECAPITATION FRAGMENTS (2026-07-31, the teach "oe ee No." class): >=2 CONSECUTIVE short
    // (<=2 alpha chars) all-lowercase tokens that aren't caption vocabulary are the bottom/top
    // halves of a vertically-clipped caption, never a real label. Consecutive + vocab-exempt so
    // "a/c no." (ac then vocab 'no'), "p/o no." ('po' is vocab), "Date of Issue" (lone 'of'),
    // "Ship To" (uppercase T) all stay clean — pinned in test_anchor_label.js.
    {
      const alpha = label.split(/\s+/).map(t => t.replace(/[^a-zA-Z]/g, '')).filter(Boolean);
      let run = 0;
      for (const t of alpha) {
        if (t.length <= 2 && t === t.toLowerCase() && !LABEL_VOCAB.has(t)) {
          if (++run >= 2) return true;
        } else run = 0;
      }
    }
    return false;
  }

  // ── TEACH LABEL PASS-2 (clip-gated re-read) — pure geometry/decision helpers ────────────────
  // (2026-07-31, gary + Oracle signed; the "oe ee No." class.) The teach LEFT/ABOVE label band
  // derives its vertical extent ONLY from the user's drawn value box, so a low/short draw slices
  // the caption glyphs and OCR reads half-letter junk — which sanitize/suspicious can't always
  // catch. The renderer re-reads a TIGHT crop around the picked cluster's own word boxes, but
  // ONLY when there is mechanism evidence of a clip (edge-touch, below) or the pass-1 label is
  // suspicious — a clean unclipped draw never pays a second OCR and cannot be degraded.

  // TRUE when the picked cluster's word-box union touches the band crop's clipping edge —
  // decapitated glyph fragments sit AT the edge by construction (the missing half is outside the
  // crop). LEFT bands clip at BOTH edges (band centred on the drawn box); ABOVE bands only at the
  // TOP (their bottom edge abuts the value row by construction — nearestAboveRow's bottom row
  // touching it is healthy, Oracle C3). `clusterBox` = [l,t,w,h] in the crop's own px; `cropHpx`
  // = the crop's pixel height in the SAME frame.
  function clusterTouchesClipEdge(clusterBox, cropHpx, dir, tolPx) {
    if (!Array.isArray(clusterBox) || clusterBox.length < 4 || !(cropHpx > 0)) return false;
    const tol = (typeof tolPx === 'number' && tolPx >= 0) ? tolPx : 1.5;
    const t = +clusterBox[1], b = +clusterBox[1] + +clusterBox[3];
    if (!isFinite(t) || !isFinite(b)) return false;
    if (t <= tol) return true;                                  // top clip (both directions)
    return dir !== 'above' && b >= cropHpx - tol;               // bottom clip (left bands only)
  }

  // The pass-2 re-read rectangle, in page-norm coords: the pass-1 cluster box expanded by pads
  // keyed to the LARGER of the cluster height and the drawn value-box height (the cluster height
  // is the CLIPPED height, so a fraction of it alone undershoots — gary). Vertical ±0.8×,
  // horizontal ±0.5× (fragment unions can clip the leading glyph), clamped to the page.
  function labelRereadRect(clusterNorm, valueNorm) {
    const h = Math.max(clusterNorm.h || 0, (valueNorm && valueNorm.h) || 0);
    const vPad = h * 0.8, hPad = h * 0.5;
    const x = Math.max(0, clusterNorm.x - hPad);
    const y = Math.max(0, clusterNorm.y - vPad);
    const right  = Math.min(1, clusterNorm.x + clusterNorm.w + hPad);
    const bottom = Math.min(1, clusterNorm.y + clusterNorm.h + vPad);
    return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
  }

  // Convert an OCR word/cluster box from a CROP's own pixel frame back to page-norm coords.
  // `rect` = the crop's page-norm rectangle, `srcBox` = [l,t,w,h] in the crop's SENT pixels,
  // `ds` = the downscale the crop was sent at (1.0 native under TEACH_NATIVE_CROP). Getting ds
  // wrong here is the 1ef3e50 frame-math class (a phantom 0.42× put every label box in the wrong
  // place) — pinned in test_anchor_label.js with ds≠1.
  function cropBoxToPageNorm(rect, srcBox, natW, natH, ds) {
    if (!Array.isArray(srcBox) || srcBox.length < 4) return null;
    const [l, t, w, h] = srcBox.map(Number);
    const nW = natW * ds, nH = natH * ds;
    if (!(nW > 0 && nH > 0 && w > 0 && h > 0)) return null;
    return { x: rect.x + l / nW, y: rect.y + t / nH, w: w / nW, h: h / nH };
  }

  // TRUE when the candidate label IS a document-type heading ("SALES ORDER", "Invoice", a type's
  // "Also appears as" alias) — a decapitated caption under a big type banner lets the padded
  // pass-2 crop read the BANNER clean, and saving that as the anchor re-opens the a666b83
  // teach-safety class (a type heading appears on EVERY doc of that type, so the anchor
  // re-locates on the wrong row everywhere). Exact match after normalisation; `typeNames` =
  // every install doc-type NAME + title_aliases + the just-created type (the caller retains
  // them from getAllDocTypes). Tolerant of alias lists arriving as JSON strings.
  function _normHeading(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function isTypeHeadingLabel(label, typeNames) {
    const n = _normHeading(label);
    if (!n) return false;
    for (const raw of (typeNames || [])) {
      let names = raw;
      if (typeof raw === 'string' && raw.trim().startsWith('[')) {
        try { names = JSON.parse(raw); } catch { names = raw; }
      }
      for (const one of (Array.isArray(names) ? names : [names])) {
        if (_normHeading(one) === n) return true;
      }
    }
    return false;
  }

  // D1 — TEACH LABEL-PICK: score a candidate caption. 2 = matches one of THIS field's own known
  // captions (a field-scoped bank — its DB labels + display label; NOT a global bank, which would
  // let a neighbouring row's 'Date' outscore the true unknown left caption); 1 = not suspicious;
  // 0 = suspicious/empty. Pure — no OCR, no DOM.
  function _normCaption(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function _matchesFieldCaption(label, fieldCaptions) {
    const n = _normCaption(label);
    if (!n) return false;
    return (fieldCaptions || []).some(c => _normCaption(c) === n);
  }
  function scoreLabelCandidate(label, fieldCaptions) {
    if (!label || !label.trim()) return 0;
    if (_matchesFieldCaption(label, fieldCaptions)) return 2;
    return labelLooksSuspicious(label) ? 0 : 1;
  }

  // Pick between the LEFT-strip and ABOVE-strip captions at teach time. Higher score wins; a TIE
  // goes to LEFT (the status-quo direction). BOTH 0 -> position-only (empty label, never a staged
  // garble). Returns {label, direction:'left'|'above'|null}. This replaces the left-first EARLY
  // RETURN that let a garbled left strip ('esha, i') beat a clean caption above ('Customer').
  // ── FORM-LABEL WORD VOCABULARY (2026-07-17) — steer the ⊕ teach direction toward the side whose
  // caption reads like a real FORM LABEL. A general dictionary can't do this ("Rote" IS an English
  // word); a curated caption vocabulary can ("rote"=no, "site"/"customer"=yes). Original in-repo
  // constant (no external word-list bundled → licence-clean). STEER only — never a reject list.
  // C4 INVARIANT: ship/to/deliver/customer/serial/no/order/site MUST stay listed or the tie pins in
  // test_anchor_label.js (Ship To / Deliver To, etc.) flip. Product-code abbreviations (sku/eori/
  // mpn/gtin/iban/utr) are DELIBERATELY excluded — they are the exposed non-vocab class (see the
  // pinned mis-steer test); the operator [← Left]/[↑ Above] toggle corrects a mis-steer.
  const LABEL_VOCAB = new Set([
    'customer','client','supplier','vendor','seller','buyer','name','company','business',
    'account','acct','site','address','premises','location','invoice','order','purchase','sales',
    'po','so','reference','ref','number','num','no','serial','id','code','date','dated','due',
    'total','subtotal','net','gross','vat','tax','gst','qty','quantity','amount','price','unit',
    'cost','description','desc','item','details','detail','bill','billing','ship','shipping',
    'shipped','sold','deliver','delivery','delivered','to','from','for','terms','payment','method',
    'currency','discount','balance','note','notes','contact','phone','tel','telephone','fax',
    'email','mobile','website','work','job','ticket','worksheet','sheet','project','department',
    'dept','branch','office','manager','engineer','status','type','product','service','model',
    'part','period','month','year'
  ]);
  const _LABEL_RATIO_MARGIN   = 0.5;   // above must out-score left by this to flip a tie
  const _LABEL_MIN_ABOVE_HITS = 2;     // ...AND carry >=2 vocab words (C2: a lone word can't flip)
  let _ratioTiebreak = true;
  function setRatioTiebreak(on) { _ratioTiebreak = !!on; }   // kill switch → OFF = unconditional LEFT
  // Split on caption separators (NOT '.', so dotted stems "S.O."/"P.O."/"No." survive as one token),
  // lowercase + strip to alnum, drop empties.
  function _labelTokens(label) {
    return String(label || '').split(/[\s/\\|,;:\-]+/)
      .map(t => t.toLowerCase().replace(/[^a-z0-9]+/g, '')).filter(Boolean);
  }
  function labelVocabHits(label) { return _labelTokens(label).filter(t => LABEL_VOCAB.has(t)).length; }
  function labelWordRatio(label) {
    const t = _labelTokens(label);
    return t.length ? t.filter(x => LABEL_VOCAB.has(x)).length / t.length : 0;
  }

  function pickLabelCandidate(leftLabel, aboveLabel, fieldCaptions) {
    const L = (leftLabel || '').trim(), A = (aboveLabel || '').trim();
    const sL = scoreLabelCandidate(L, fieldCaptions), sA = scoreLabelCandidate(A, fieldCaptions);
    if (sL === 0 && sA === 0) return { label: '', direction: null };   // position-only
    if (sA > sL) return { label: A, direction: 'above' };
    if (sL > sA) return { label: L, direction: 'left' };
    // TIE. Consult the form-label word ratio ONLY on a score-1 tie (both clean, NEITHER a known field
    // caption — a score-2 caption is the field's own gold signal, never second-guessed: C3). Flip
    // LEFT→ABOVE only with POSITIVE evidence: the above side carries >=2 form-label words (C2) AND
    // out-scores the left by >= the margin — so a lone dictionary word can't override a real single-
    // token abbreviation left (EORI/SKU); only a decisively-cleaner multi-word caption ("Site /
    // Customer" over "Rote,") flips. STEER only — the label is never rejected; the operator's Left/
    // Above toggle overrides a mis-steer. NOTE (was "C5, the Teach wizard does NOT share this
    // picker" — NO LONGER TRUE as of 2026-08-08): teach/renderer.js `autoLabel` now calls this
    // function too, so BOTH surfaces steer identically and a change here moves both. Teach pins it
    // in src/windows/teach/test_teach_label_pick.js.
    if (_ratioTiebreak && sL === 1 && sA === 1
        && labelVocabHits(A) >= _LABEL_MIN_ABOVE_HITS
        && (labelWordRatio(A) - labelWordRatio(L)) >= _LABEL_RATIO_MARGIN) {
      return { label: A, direction: 'above' };
    }
    return { label: L, direction: 'left' };                            // tie default stays LEFT
  }

  // DESKEW BACK-TRANSFORM (2026-07-12): map a point given in the STRAIGHTENED (display) frame back
  // to the RAW page frame that extraction reads. The Review window can straighten the on-screen page
  // (region.py --deskew) so drawn ⊕ boxes land on level text; the immediate crop is read from that
  // straightened image (see==read, a pure win), but the coords STAGED for the anchor are in the
  // straightened frame while extraction reads the RAW scan — so on save they must be rotated back.
  //
  // `angleDeg` is the angle passed to PIL `img.rotate()` to straighten the page (CCW-positive; the
  // value detect_skew_angle returns). PIL's rotate maps an OUTPUT pixel to the INPUT (source) pixel
  // via input = R(+angle)·output about the image centre (VERIFIED empirically vs real PIL.rotate —
  // NOT R(-angle); the sign was measured with a marker-pixel round-trip, see test_anchor_label.js).
  // So a point the user drew at `output` (straightened) came from raw position R(+angle)·output.
  // The rotation is in PIXEL space, so normalise→pixel→rotate→normalise; W,H are the page's pixel
  // dims (preserved by expand=False, identical in both frames). Pure; returns {x,y} normalised.
  function deskewedNormToRaw(xNorm, yNorm, angleDeg, W, H) {
    if (!angleDeg || !W || !H) return { x: xNorm, y: yNorm };
    const cx = W / 2, cy = H / 2;
    const px = xNorm * W - cx, py = yNorm * H - cy;
    const th = angleDeg * Math.PI / 180;
    const c = Math.cos(th), s = Math.sin(th);
    const rx = cx + c * px - s * py;      // R(+angle) about centre — proven sign
    const ry = cy + s * px + c * py;
    return { x: rx / W, y: ry / H };
  }

  // Decide how a ⊕-staged anchor's coords must be finalised, given the deskew frame the box was
  // drawn on (`snap`) and the live frame at commit (`live`) — each `{angle, docId, page, W, H}`.
  // Pure (the caller performs the DOM side-effects). This is the load-bearing FAIL-SAFE (Oracle C1):
  // the back-transform is valid ONLY against the frame the box was drawn on, and there are OCR awaits
  // between draw and commit, so if the displayed frame changed (Straighten toggled, page/doc
  // navigated, or an async swap left the image undecoded → W/H 0) the staged coords belong to a
  // different frame and must NEVER be persisted as raw. Returns:
  //   {action:'keep'}       — deskew not involved (drawn raw, still raw) → leave coords as staged
  //   {action:'drop'}       — frame changed / unusable → caller discards the teach + warns
  //   {action:'transform', x, y, page_zone, offset_dx?, offset_dy?} — apply these RAW-frame coords
  function deskewFinalizeAnchor(anchor, snap, live) {
    const snapAngle = snap ? (snap.angle || 0) : 0;
    const liveAngle = live ? (live.angle || 0) : 0;
    if (!snapAngle && !liveAngle) return { action: 'keep' };   // deskew never involved
    const W = snap && snap.W, H = snap && snap.H;
    const frameOk = !!snap && !!live && !!W && !!H
      && live.docId === snap.docId && live.page === snap.page
      && live.angle === snap.angle && live.W === snap.W && live.H === snap.H;
    if (!frameOk) return { action: 'drop' };
    if (!snapAngle) return { action: 'keep' };   // drawn on the raw frame — coords already raw
    const v = deskewedNormToRaw(anchor.x_norm, anchor.y_norm, snapAngle, W, H);
    const out = { action: 'transform', x: v.x, y: v.y,
                  page_zone: v.y < 0.33 ? 'top' : v.y < 0.66 ? 'middle' : 'bottom' };
    if (anchor.offset_dx_norm != null && anchor.offset_dy_norm != null) {
      const l = deskewedNormToRaw(anchor.x_norm - anchor.offset_dx_norm, anchor.y_norm - anchor.offset_dy_norm, snapAngle, W, H);
      out.offset_dx = v.x - l.x; out.offset_dy = v.y - l.y;
    }
    return out;
  }

  root.AnchorLabel = { nearestLeftCluster, nearestAboveRow, nearestRowTo, extractLabel, sanitizeAnchorLabel, labelLooksSuspicious, scoreLabelCandidate, pickLabelCandidate, labelWordRatio, labelVocabHits, setRatioTiebreak, deskewedNormToRaw, deskewFinalizeAnchor, clusterTouchesClipEdge, labelRereadRect, isTypeHeadingLabel, cropBoxToPageNorm };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

// Node/test interop (the browser path uses window.AnchorLabel).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).AnchorLabel;
}
