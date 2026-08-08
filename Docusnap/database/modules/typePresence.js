'use strict';
// PER-TEMPLATE TYPE-HEADING PRESENCE (Type Slice 1, 2026-07-28; owner idea -> Herald/gary design ->
// Oracle SIGN-OFF-WITH-CONDITIONS). The TYPE analog of namePresence.js. A 64-bit phash logo COLLISION
// can stamp a WRONG-TYPE same-letterhead sibling's slug onto a doc (a worksheet filed as delivery_note)
// when the doc's printed TYPE HEADING isn't read (title_trusted=False) so the trusted-title refuse is
// STARVED. This measures, per template, how reliably its CONFIRMED docs PRINT that type's heading in
// their top band; the PYTHON consume seam (template_matcher.identify_template) then HOLDS a pick whose
// armed type-heading is ABSENT from the candidate's top band. Fail-toward-abstain.
//
// PARITY (Oracle C-a): the learn side (this module) and the check side (Python) score the IDENTICAL
// token set — computed ONCE here and threaded to Python via type_heading_tokens — with the same >=0.6
// whole-word match on the same ~14-line/600-char top band. This module only COMPUTES + threads
// {type_heading_ratio, type_heading_n, type_heading_tokens}; the kill switch TYPE_PRESENCE_VETO lives on
// the Python consume side, so these keys are INERT until it is flipped. Guarded by test_type_presence.js
// + the Python twin test_type_presence_matcher.py.

const namePresence = require('./namePresence');   // reuse its regex-safe [a-z0-9] token discipline + GENERIC set

// Type-heading generic tokens = namePresence's corporate-suffix set PLUS 'note'/'document': a lone
// "note"/"document" is NOT a type signal (the discriminating word in "delivery NOTE" / "purchase ORDER"
// is the OTHER token). Kept here (not in namePresence) so the two predicates can't silently drift.
const TYPE_GENERIC_TOKENS = new Set([...namePresence.GENERIC_NAME_TOKENS, 'note', 'document']);

// Distinctive tokens of a type's name (∪ its printed-title aliases). De-duped, order-preserving.
function typeHeadingTokens(name, aliases) {
  const src = [name].concat(Array.isArray(aliases) ? aliases : []).filter(Boolean).join(' ');
  const seen = new Set();
  const toks = [];
  for (const t of (String(src).toLowerCase().match(/[a-z0-9]+/g) || [])) {
    if (t.length >= 3 && !TYPE_GENERIC_TOKENS.has(t) && !seen.has(t)) { seen.add(t); toks.push(t); }
  }
  return toks;
}

// First ~14 lines / 600 chars, lowered — the TITLE band. SAME shape on both sides (parity).
const TOP_BAND_LINES = 14;
const TOP_BAND_CHARS = 600;
function topBand(text) {
  return String(text || '').split(/\r?\n/).slice(0, TOP_BAND_LINES).join('\n')
    .slice(0, TOP_BAND_CHARS).toLowerCase();
}

// True <=> >=0.6 of `tokens` present as WHOLE WORDS in `band`. Takes PRE-COMPUTED tokens (so the ratio
// over many docs and the Python candidate check score the identical set). Mirrors the namePresence ratio.
function headingPresent(tokens, band) {
  if (!tokens || !tokens.length || !band) return false;
  const text = String(band).toLowerCase();
  let present = 0;
  for (const t of tokens) if (new RegExp('\\b' + t + '\\b').test(text)) present++;  // toks are [a-z0-9]+, regex-safe
  return present >= 1 && (present / tokens.length) >= 0.6;
}

// Per-template: resolve its type-heading tokens (doc-type name ∪ aliases) and the fraction of its
// CONFIRMED docs whose TOP BAND prints that heading. {ratio, count, tokens}. count = confirmed docs with
// NON-EMPTY ocr_text (Oracle C5 parity). One type query + one docs query per template (per getAll batch,
// Oracle C-b — cheap, no OCR). Fail-safe: any error -> {0,0,[]} (the veto never arms).
function templateTypeHeadingPresence(db, template) {
  const out = { ratio: 0, count: 0, tokens: [] };
  try {
    const slug = template && (template.document_type_slug || '');
    if (!slug) return out;
    const ty = db.prepare('SELECT name, title_aliases FROM document_types WHERE slug = @slug').get({ slug });
    if (!ty) return out;
    let aliases = [];
    try { aliases = ty.title_aliases ? JSON.parse(ty.title_aliases) : []; } catch { aliases = []; }
    const tokens = typeHeadingTokens(ty.name, aliases);
    out.tokens = tokens;
    if (!tokens.length) return out;                       // generic-only type name -> can't arm
    const rows = db.prepare(
      "SELECT ocr_text FROM documents WHERE status = 'confirmed' AND template_id = @tid " +
      "AND ocr_text IS NOT NULL AND LENGTH(TRIM(ocr_text)) > 0").all({ tid: template.id });
    const count = rows.length;
    if (!count) return out;
    let present = 0;
    for (const r of rows) if (headingPresent(tokens, topBand(r.ocr_text))) present++;
    out.ratio = present / count;
    out.count = count;
    return out;
  } catch { return out; }
}

module.exports = {
  typeHeadingTokens, topBand, headingPresent, templateTypeHeadingPresence, TYPE_GENERIC_TOKENS,
};
