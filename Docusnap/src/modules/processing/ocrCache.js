'use strict';
//
// OCR cache reuse decision (Quick Reprocess, 2026-09-01; gary → Oracle SIGN-OFF-W/COND C1-C7).
//
// "Quick" reprocess reuses the full-page OCR text stored with a document (documents.ocr_text) and
// skips the page render + per-field crop OCR — the expensive half of a reprocess. That is only SAFE
// when the OCR pipeline that PRODUCED the stored text is still the pipeline that runs today. Each
// fresh OCR run stamps a recipe (documents.ocr_recipe, from ocr/tesseract.py current_ocr_recipe_meta);
// this module compares that stamp to the CURRENT pipeline and decides, per document, whether the
// cached text may be reused.
//
// PURE + explicit reasons: ocrCacheUsable returns { usable, reason } so the partition (handler.js)
// can route + the C3 census arm can count. No DB or OCR here — currentOcrRecipe reads settings once,
// ocrCacheUsable is a pure comparison over a row-like the caller assembles (it resolves enhance_active).
//
// FAIL-SAFE DIRECTION throughout: any doubt (no stamp, empty text, unknown field) → NOT usable → the
// doc runs a Full re-read. A false "usable" would silently reuse stale OCR; a false "not usable" only
// costs one honest re-OCR.

const learning = require('../../../database/modules/learning');

// MUST stay equal to ocr/tesseract.py OCR_PIPELINE_REV. Bump BOTH together whenever a change could
// alter the full-page OCR text for the same pixels (render/DPI/PSM/grouping/born-digital/deskew/light/
// traineddata). A one-sided bump is caught by test_ocr_cache_usable.js ↔ tests/test_reextract_recipe.py.
const OCR_PIPELINE_REV = 1;

// The app's light-text recovery pass runs the measured default level set (ocr/tesseract.py
// _LIGHT_LEVELS_DEFAULT). The census-only OCR_LIGHT_TEXT_LEVELS override is not a customer setting, so
// "light on" in the app means exactly these levels — mirror them here for the comparison.
const LIGHT_LEVELS_DEFAULT = [200, 210, 220, 230];

// The setting the handler writes with each fresh recipe's tesseract version (the "current engine"
// marker). Lets JS — which never spawns tesseract — know the current tess version for the compare.
const TESS_MARKER_SETTING = 'ocr_pipeline_tess';

function _get(db, key, dflt) {
  try { return learning.getSetting(db, key, dflt); } catch { return dflt; }
}

// The recipe the pipeline WOULD stamp on a fresh run right now, from the live settings + this module's
// rev mirror + the current-engine marker. Compared against each document's stored recipe.
function currentOcrRecipe(db) {
  let dpi = 300;                                     // mirror _resolve_render_dpi's clamp exactly
  try { const r = parseInt(_get(db, 'ocr_dpi', '300'), 10); if (r >= 100 && r <= 600) dpi = r; } catch {}
  const lightOn = _get(db, 'ocr_light_text_recovery', 'false') === 'true';
  const bd      = _get(db, 'born_digital_enabled', 'true') !== 'false';
  return {
    dpi,
    light: lightOn ? LIGHT_LEVELS_DEFAULT.slice() : null,
    bd,
    rev: OCR_PIPELINE_REV,
    tess: String(_get(db, TESS_MARKER_SETTING, '') || ''),
  };
}

function parseRecipe(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : null; }
  catch { return null; }
}

function _lightEqual(a, b) {
  const na = a == null, nb = b == null;
  if (na || nb) return na && nb;                     // both off, or both on — one-sided = changed
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const sa = a.map(Number).sort((x, y) => x - y);
  const sb = b.map(Number).sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

// row-like: { ocr_text, ocr_recipe (JSON string|obj|null), enhance_active (bool, resolved by caller) }.
// current: from currentOcrRecipe(db). Returns { usable, reason }.
function ocrCacheUsable(row, current) {
  const no = (reason) => ({ usable: false, reason });
  if (!row) return no('no-row');
  if (!current) return no('no-current-recipe');

  // ── per-document refusals (independent of the recipe compare) ──
  if (!row.ocr_text || !String(row.ocr_text).trim()) return no('empty-ocr-text');
  if (row.enhance_active) return no('enhance-active-template');   // crops read on enhanced pixels; Quick skips crop OCR
  const rec = parseRecipe(row.ocr_recipe);
  if (!rec) return no('no-recipe-stamp');                        // NULL / malformed = legacy, never reusable
  if (rec.bd_used) return no('born-digital-doc');                // text-layer read; Quick can't rebuild its geometry

  // ── recipe-vs-current invalidators ──
  if (Number(rec.dpi) !== Number(current.dpi)) return no('dpi-changed');
  if (!_lightEqual(rec.light, current.light)) return no('light-recovery-changed');
  if (Boolean(rec.bd) !== Boolean(current.bd)) return no('born-digital-setting-changed');
  if (Number(rec.rev) !== Number(current.rev)) return no('pipeline-rev-changed');
  // tess: compare only when BOTH are known. current.tess is the last fresh-run marker; if it is not
  // set yet (no fresh import since this shipped) we do NOT refuse all reuse — rev already guards every
  // code/traineddata change, and a genuine engine swap updates the marker on its first fresh import.
  if (rec.tess && current.tess && String(rec.tess) !== String(current.tess)) return no('tesseract-version-changed');

  return { usable: true, reason: 'ok' };
}

// NON-invalidators, recorded so a future dev does not "helpfully" add them (each verified):
//   * auto_rotate_enabled — rotation is baked into the working-copy PDF at import (the page is rotated
//     once, then stored), so a later flip does not change the pixels the stored text was read from.
//   * region_date_order / number_format — these drive PARSING of already-extracted text, not the OCR;
//     Quick still re-runs the per-field parse/validate on the reused text.

module.exports = { currentOcrRecipe, ocrCacheUsable, parseRecipe, OCR_PIPELINE_REV, TESS_MARKER_SETTING, LIGHT_LEVELS_DEFAULT };
