'use strict';

/**
 * database/modules/slug.js
 * ------------------------
 * ONE canonical slug/key derivation, shared by every site that mints a NEW
 * document-type slug or field key. Before this, five sites derived slugs with
 * different rules (some non-collapsing, some without edge-trim/fallback), which
 * let symbol-only / non-Latin names collapse to "_" (UNIQUE collisions + cryptic
 * SQLite errors) and malformed keys like "ref__" through to filing (buildXml
 * crash). See the 2026-07-02 QA audit root cause.
 *
 * Target shape: ^[a-z0-9]+(_[a-z0-9]+)*$  (no leading/trailing/double '_').
 *   NFKD-fold accents -> ASCII · lowercase · non-alnum runs -> '_' · trim edge
 *   '_' · length-cap (re-trim) · non-empty fallback.
 *
 * IMPORTANT: this is for MINTING NEW rows only. Do NOT re-slug existing rows —
 * learned scope (field_anchors / supplier_hints / field_label_overrides / the
 * template document_type_slug) keys off the stored slug; changing it orphans data.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

function safeSlug(input, opts = {}) {
  const fallback = opts.fallback || 'item';
  const maxLen   = opts.maxLen   || 64;
  let s = String(input == null ? '' : input);
  // NFKD decomposes accented letters so combining marks can be stripped
  // ("façade" -> "facade", "Zürich" -> "zurich"). Non-Latin scripts that don't
  // decompose to ASCII fall through to the fallback below.
  try { s = s.normalize('NFKD').replace(COMBINING_MARKS, ''); } catch { /* older runtime */ }
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/_+$/g, '');
  return s || fallback;
}

/**
 * safeSlug + a live-table uniqueness suffix. `existsFn(slug)` returns truthy
 * when the slug is already taken; we append _2, _3, … until free. Use for a
 * UNIQUE slug/key column so two names that collapse to the same base don't
 * throw a raw constraint error.
 */
function uniqueSlug(base, existsFn, opts = {}) {
  const seed = safeSlug(base, opts);
  if (typeof existsFn !== 'function') return seed;
  let slug = seed, n = 1;
  while (existsFn(slug)) { n += 1; slug = `${seed}_${n}`; }
  return slug;
}

module.exports = { safeSlug, uniqueSlug };
