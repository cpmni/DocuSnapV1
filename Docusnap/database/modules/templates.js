'use strict';

// Multi-reference logo phash (migration 26): a template's identity is a SET of
// perceptual hashes, not one. Per-scan DPI/enhance drift shifts a recomputed phash
// by double-digit Hamming, so a single frozen hash spawns duplicate templates.
// Matching takes the MIN distance over the set; confirms APPEND drifted-but-related
// hashes (within the band, not near-dupes) so the set converges to span the drift.
const LOGO_HASH_CAP    = 8;    // max stored hashes per template
const LOGO_DEDUP_FLOOR = 2;    // <= this to the nearest existing ref -> already covered, skip
const LOGO_APPEND_BAND = 13;   // append only within this Hamming of an existing ref (= the matcher candidate net)

// Shared distinctive-branding primitives (the ONE source of truth for template convergence by
// branding rather than the unstable logo — see branding_fingerprint.js + the M2 design doc).
const brandingFp = require('./branding_fingerprint');
const logoDetail = require('./logoDetail');   // 256-bit isolated-mark veto arithmetic (mig 47)
const namePresence = require('./namePresence');   // per-supplier name-presence veto (Oracle 2026-07-24)
const typePresence = require('./typePresence');    // per-template type-heading presence (Type Slice 1, 2026-07-28)
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

// The stored templates.confirmed_count is bumped ONLY by templates.update(), which runs on the
// taught-confirm reuse branch (_upsertTemplate via onTaughtConfirm) — so an ordinary confirm never
// touches it and a real install reads 0 next to 20 confirmed documents (owner's DB, 2026-07-20:
// 0 / 1 / 0 against 20 / 20 / 19). That is not only a cosmetic roster bug: this column feeds the
// same-type sibling TIEBREAKS in template_matcher.py:179 and engine.py:696 ("prefer the
// most-confirmed sibling") and the ORDER templates are handed to the matcher — all three of which
// are INERT while every value is 0, silently degrading sibling choice to first-seen/name order.
// So the pipeline reader now serves the LIVE count (documents linked to the template and confirmed
// — the same truth the Template Manager already shows), which cannot drift because it is derived,
// not maintained. ONE grouped query per call; getAll runs once per batch. The stored column is left
// alone (mergeInto still sums it) but is no longer authoritative anywhere.
// Kill switch TEMPLATE_LIVE_COUNTS=0 restores the stored column + SQL ordering byte-identically.
function getAll(db) {
  const useLive = process.env.TEMPLATE_LIVE_COUNTS !== '0';
  const rows = useLive
    ? db.prepare('SELECT * FROM templates').all()
    : db.prepare('SELECT * FROM templates ORDER BY confirmed_count DESC, name').all();
  const counts = useLive ? liveConfirmedCounts(db) : null;
  if (counts) {                                   // null ⇒ uncountable, keep the stored column
    for (const t of rows) t.confirmed_count = counts.get(t.id) || 0;
    // Re-create the SQL ordering in JS so "shown count" and "order" still agree.
    rows.sort((a, b) => (b.confirmed_count - a.confirmed_count)
      || String(a.name || '').localeCompare(String(b.name || '')));
  } else if (useLive) {
    rows.sort((a, b) => ((b.confirmed_count || 0) - (a.confirmed_count || 0))
      || String(a.name || '').localeCompare(String(b.name || '')));
  }
  for (const t of rows) {
    t.fields              = getFields(db, t.id);
    t.field_mappings      = getMappings(db, t.id);
    t.landmarks           = getLandmarks(db, t.id);
    t.logo_phashes        = getLogoHashes(db, t.id);
    t.logo_detail_hashes = getLogoDetailHashes(db, t.id);
    // HIDDEN_FIELD_SCORING: the operator's "this layout lacks this field" declaration rides the
    // templates JSON so the Python engine can exclude a declared-absent EMPTY field from the
    // document score (template_matcher.hidden_fields_for_scope). Additive key — the matcher
    // ignores it; [] on a DB without migration 54.
    t.hidden_fields       = getHiddenFields(db, t.id);
    t.keyword_fingerprint = _parseJson(t.keyword_fingerprint, []);
    t.ocr_auto_params     = _parseJson(t.ocr_auto_params, null);
    const dom             = getDominantSupplier(db, t.id);
    t.dominant_supplier       = dom ? dom.value  : null;
    t.dominant_supplier_count = dom ? dom.count  : 0;
    t.dominant_supplier_total = dom ? dom.total  : 0;
    // TYPE_PRESENCE_VETO (Type Slice 1): thread this template's type-heading reliability + the token
    // set so the Python consume seam can HOLD a wrong-type logo-collision pick whose heading is absent
    // from the candidate. Additive keys, INERT until the Python kill switch TYPE_PRESENCE_VETO is on.
    const th              = typePresence.templateTypeHeadingPresence(db, t);
    t.type_heading_ratio  = th.ratio;
    t.type_heading_n      = th.count;
    t.type_heading_tokens = th.tokens;
  }
  return rows;
}

// N — LIVE confirmed-document counts for the Template Manager (docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md).
// The stored templates.confirmed_count is under-counted (bumped only on the taught-confirm reuse branch,
// never on create / graduation-link), so the roster shows "confirmed 0×" despite many linked docs. It is
// DISPLAY-ONLY — graduation counts confirmed DOCUMENTS live via trust.scopeTrust (never this column) and
// mergeInto sums it — so these readers show the live truth WITHOUT touching the stored column or getAll()
// (which feeds the extraction pipeline + Python matcher and MUST NOT change). ONE grouped query (no index
// on documents.template_id → a per-template correlated subquery would full-scan), map-joined.
// FAIL-SAFE (2026-07-20): getAll — the pipeline reader — now calls this, so it must never throw.
// A caller whose schema has `templates` but not `documents` (the promote/template unit fixtures,
// and any future minimal harness) would otherwise take a "no such table: documents" straight
// through template reading and break extraction.
// Returns NULL when the count could not be taken at all — deliberately distinct from an EMPTY map,
// which is a legitimate answer meaning "no confirmed documents yet" (0 is then the truth). getAll
// keeps the stored column on null and overwrites on a map, so a broken query degrades to exactly
// the pre-change behaviour instead of zeroing every template.
function liveConfirmedCounts(db) {
  const m = new Map();
  try {
    for (const r of db.prepare(
      "SELECT template_id, COUNT(*) c FROM documents WHERE status = 'confirmed' AND template_id IS NOT NULL GROUP BY template_id"
    ).all()) m.set(r.template_id, r.c);
  } catch {
    return null;   // no documents table / unreadable → caller keeps the stored column
  }
  return m;
}

// Template Manager roster (get-templates): getAll's rows with confirmed_count replaced by the LIVE
// confirmed-doc count. getAll() itself is left untouched.
//
// P5 (2026-07-22): the roster is a DISPLAY concern only. This wrapper is viewer-only — its sole
// non-test caller is the get-templates IPC; the matcher reads templates.getAll() DIRECTLY
// (processing/handler.js, review/handler.js), and getAll's count-desc SQL order feeds the sibling
// tiebreaks + "the order templates reach the matcher" (277a107 / TEMPLATE_LIVE_COUNTS). So we sort
// the ROSTER alphabetically by name here without touching getAll's matcher-facing order.
// Kill switch TEMPLATE_VIEWER_ALPHA=0 restores the legacy count-desc roster order byte-identically.
function getAllWithLiveCounts(db) {
  const rows   = getAll(db);
  const counts = liveConfirmedCounts(db);
  for (const t of rows) t.confirmed_count = counts.get(t.id) || 0;
  if (process.env.TEMPLATE_VIEWER_ALPHA !== '0') {
    rows.sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
      || ((a.id || 0) - (b.id || 0)));                                       // stable tiebreak on same-name templates
  } else {
    rows.sort((a, b) => (b.confirmed_count - a.confirmed_count) || String(a.name || '').localeCompare(String(b.name || '')));
  }
  return rows;
}

// Live confirmed-doc count for ONE template (the detail view — same truth as the roster).
function confirmedDocCount(db, templateId) {
  return db.prepare(
    "SELECT COUNT(*) c FROM documents WHERE template_id = ? AND status = 'confirmed'"
  ).get(templateId).c;
}

// The issuer identity the template's CONFIRMED docs actually carry, as a distribution — NOT the
// template's cosmetic `name` (which is only the FIRST-confirmed issuer and can be an outlier/OCR
// garble: "50 Asia" once vs "Contoso Asia" thrice). Returns the top issuer + its count + the total
// confirmed-with-issuer count so the extraction engine can require a CLEAR majority before letting
// a template identity override a per-doc field read. Read-only; additive to getAll.
//
// DEFENSIVE: this is an additive nicety and getAll runs in the Template Manager, the promote/confirm
// WRITE path, and the extraction snapshot — so it must NEVER break core template loading. Any error
// (e.g. a minimal caller/fixture DB whose `documents` table lacks a column) is swallowed → null →
// the engine's template-supplier precedence simply stays inert (as when a template has no dominant
// issuer). Ordered by count only; no confirmed_at tiebreaker — a tie can never be a STRICT majority
// (count*2 > total is false when the top two are equal), so the engine returns None for it anyway,
// making any tie-break pick unobservable — and requiring confirmed_at would couple this to the full
// documents schema for no behavioural gain.
// `excludeDocId` (TEMPLATE_GUARD_SELF_INDEPENDENT, 2026-07-21): omit ONE document from the tally.
// The supplier-link guard (reviewService confirm seam + _upsertTemplate) runs AFTER the doc being
// confirmed is already status='confirmed', supplier_name=confirmedIssuer, and still template-linked
// — so a plain getDominantSupplier COUNTS THE DOC AGAINST ITSELF: on a template with no other
// confirmed docs, the intruder becomes its own "established identity", supplierNamesDisjoint(x,x)
// is false, the guard never detaches, and the wrong template is permanently poisoned (its dominant
// flips, which then disarms the Stage-0 rival-branding gate for every sibling doc). The guard passes
// `document_id` here to judge identity from the OTHER confirmed docs only. Default null ⇒ the
// `@ex IS NULL` short-circuit matches every row ⇒ BYTE-IDENTICAL to the old positional query for the
// getAll / establishedIdentity-internal / test callers, which never pass it. ALL-NAMED binds
// deliberately (Oracle C1): better-sqlite3 refuses a mix of positional `?` and named `@ex` and
// throws, and this function's `catch` would swallow that throw and silently revert to the bug.
function getDominantSupplier(db, templateId, excludeDocId = null) {
  try {
    const rows = db.prepare(`
      SELECT supplier_name AS value, COUNT(*) AS n
      FROM documents
      WHERE template_id = @tid AND status = 'confirmed'
        AND supplier_name IS NOT NULL AND TRIM(supplier_name) <> ''
        AND (@ex IS NULL OR id != @ex)
      GROUP BY supplier_name
      ORDER BY n DESC
    `).all({ tid: templateId, ex: excludeDocId });
    if (!rows.length) return null;
    const total = rows.reduce((s, r) => s + r.n, 0);
    return { value: rows[0].value, count: rows[0].n, total };
  } catch {
    return null;
  }
}

// ── Supplier-link guard primitives (Oracle condition A, template-misfile fix 2026-07-20) ──────
// The identity a template ASSERTS when matched/reused: its DOMINANT confirmed issuer (live
// truth), else its frozen supplier_name fixed value (what template_fixed would stamp). The
// cosmetic `name` is deliberately NOT consulted — it is first-confirm luck, can be an OCR garble
// ("50 Asia"), and plays no role in matching/filing/learning scope. Null = unjudgeable; callers
// keep the link on null (fail toward today's behaviour).
// `excludeDocId`: forwarded to getDominantSupplier so the guard judges a template's identity from
// the OTHER confirmed docs, never the one under judgement (see getDominantSupplier). Order is
// unchanged: dominant-confirmed-issuer (now optionally self-excluded) → frozen supplier_name fixed
// value → null. `name` is STILL never consulted (Oracle C3): a self-excluded null must fail toward
// KEEP-link, not toward detaching a legitimate cold first-confirm against a garbled/cosmetic name.
function establishedIdentity(db, templateId, excludeDocId = null) {
  const dom = getDominantSupplier(db, templateId, excludeDocId);
  if (dom && dom.value) return dom.value;
  try {
    const row = db.prepare(
      "SELECT fixed_value FROM template_fields WHERE template_id = ? AND field_key = 'supplier_name' " +
      "AND is_variable = 0 AND fixed_value IS NOT NULL AND TRIM(fixed_value) <> ''").get(templateId);
    return row ? row.fixed_value : null;
  } catch { return null; }
}

// Zero shared DISTINCTIVE name tokens ⇒ the two names denote different companies. Deliberately
// PRECISION-FIRST: any shared token ("Copperfield Electrical" vs "Copperfield Electrical Ltd")
// keeps the link — the guard only fires on an unambiguously FOREIGN name, because its false
// positive merely spawns a duplicate template (the known fragmentation cost, convergeable later)
// while its false negative re-arms the confirm-time reinforcement loop it exists to close.
// Generic corporate-suffix tokens carry no identity and are ignored on both sides.
const GENERIC_NAME_TOKENS = new Set([
  'ltd', 'limited', 'plc', 'inc', 'llc', 'llp', 'gmbh', 'co', 'corp', 'company',
  'group', 'holdings', 'the', 'and', 'of', 'uk',
]);
function _nameTokens(s) {
  const m = String(s || '').toLowerCase().normalize('NFKC').match(/[a-z0-9]{2,}/g) || [];
  return new Set(m.filter(t => !GENERIC_NAME_TOKENS.has(t)));
}
function supplierNamesDisjoint(a, b) {
  const ta = _nameTokens(a), tb = _nameTokens(b);
  if (!ta.size || !tb.size) return false;          // unjudgeable ⇒ not disjoint
  for (const t of ta) if (tb.has(t)) return false;
  return true;
}

function getById(db, id) {
  const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  if (!t) return null;
  t.fields              = getFields(db, t.id);
  t.field_mappings      = getMappings(db, t.id);
  t.keyword_fingerprint = _parseJson(t.keyword_fingerprint, []);
  t.ocr_auto_params     = _parseJson(t.ocr_auto_params, null);
  t.sample_document     = t.sample_document_id ? getSampleDocument(db, t.sample_document_id) : null;
  t.landmarks           = getLandmarks(db, t.id);
  t.logo_phashes        = getLogoHashes(db, t.id);
  t.logo_detail_hashes = getLogoDetailHashes(db, t.id);
  return t;
}

// Minimal projection — just enough for the viewer to resolve a preview path
// (mirrors the {folderPath, filename} resolution search/renderer.js already
// does for confirmed vs. unconfirmed documents) and show a caption.
function getSampleDocument(db, documentId) {
  return db.prepare(`
    SELECT id, original_filename, stored_filename, stored_path, folder_path,
           status, supplier_name, doc_date, reference_number
    FROM documents WHERE id = ?
  `).get(documentId) || null;
}

function getFields(db, templateId) {
  return db.prepare(
    'SELECT * FROM template_fields WHERE template_id = ? ORDER BY field_key'
  ).all(templateId);
}

// ── Field anchor → target mappings (Template Viewer) ─────────────────────────
// Additive companion to template_fields: those store text-search anchor RULES
// (label + direction, no coordinates); these store admin-DRAWN anchor/target
// RECTANGLES on a pinned sample document, for crop-and-OCR extraction. Kept
// in their own table (rather than extending template_fields) so templates
// without any drawn mappings are byte-for-byte unaffected — see
// template_mapper.py for how they're consumed.

function getMappings(db, templateId) {
  const rows = db.prepare(
    'SELECT * FROM template_field_mappings WHERE template_id = ? ORDER BY field_key'
  ).all(templateId);
  for (const r of rows) r.region_hint = _parseJson(r.region_hint, []);
  return rows;
}

function getMapping(db, templateId, fieldKey) {
  const r = db.prepare(
    'SELECT * FROM template_field_mappings WHERE template_id = ? AND field_key = ?'
  ).get(templateId, fieldKey);
  if (r) r.region_hint = _parseJson(r.region_hint, []);
  return r || null;
}

function saveMapping(db, templateId, mapping) {
  const m = {
    template_id:      templateId,
    field_key:        mapping.field_key,
    page_number:      mapping.page_number || 0,
    anchor_text:      mapping.anchor_text || null,
    anchor_x_norm:    mapping.anchor_x_norm,
    anchor_y_norm:    mapping.anchor_y_norm,
    anchor_w_norm:    mapping.anchor_w_norm,
    anchor_h_norm:    mapping.anchor_h_norm,
    target_x_norm:    mapping.target_x_norm,
    target_y_norm:    mapping.target_y_norm,
    target_w_norm:    mapping.target_w_norm,
    target_h_norm:    mapping.target_h_norm,
    offset_dx_norm:   mapping.target_x_norm - mapping.anchor_x_norm,
    offset_dy_norm:   mapping.target_y_norm - mapping.anchor_y_norm,
    ocr_type:         mapping.ocr_type || 'text',
    search_expansion: mapping.search_expansion ?? 0.04,
    region_hint:      JSON.stringify(_computeRegionHint(mapping)),
    enabled:          mapping.enabled === false ? 0 : 1,
  };
  db.prepare(`
    INSERT INTO template_field_mappings
      (template_id, field_key, page_number, anchor_text,
       anchor_x_norm, anchor_y_norm, anchor_w_norm, anchor_h_norm,
       target_x_norm, target_y_norm, target_w_norm, target_h_norm,
       offset_dx_norm, offset_dy_norm, ocr_type, search_expansion,
       region_hint, enabled)
    VALUES
      (@template_id, @field_key, @page_number, @anchor_text,
       @anchor_x_norm, @anchor_y_norm, @anchor_w_norm, @anchor_h_norm,
       @target_x_norm, @target_y_norm, @target_w_norm, @target_h_norm,
       @offset_dx_norm, @offset_dy_norm, @ocr_type, @search_expansion,
       @region_hint, @enabled)
    ON CONFLICT(template_id, field_key) DO UPDATE SET
      page_number      = excluded.page_number,
      anchor_text      = excluded.anchor_text,
      anchor_x_norm    = excluded.anchor_x_norm,
      anchor_y_norm    = excluded.anchor_y_norm,
      anchor_w_norm    = excluded.anchor_w_norm,
      anchor_h_norm    = excluded.anchor_h_norm,
      target_x_norm    = excluded.target_x_norm,
      target_y_norm    = excluded.target_y_norm,
      target_w_norm    = excluded.target_w_norm,
      target_h_norm    = excluded.target_h_norm,
      offset_dx_norm   = excluded.offset_dx_norm,
      offset_dy_norm   = excluded.offset_dy_norm,
      ocr_type         = excluded.ocr_type,
      search_expansion = excluded.search_expansion,
      region_hint      = excluded.region_hint,
      enabled          = excluded.enabled,
      updated_at       = datetime('now')
  `).run(m);
  return getMapping(db, templateId, mapping.field_key);
}

function setMappingEnabled(db, templateId, fieldKey, enabled) {
  db.prepare(`
    UPDATE template_field_mappings SET enabled = ?, updated_at = datetime('now')
    WHERE template_id = ? AND field_key = ?
  `).run(enabled ? 1 : 0, templateId, fieldKey);
}

function deleteMapping(db, templateId, fieldKey) {
  return db.prepare(
    'DELETE FROM template_field_mappings WHERE template_id = ? AND field_key = ?'
  ).run(templateId, fieldKey);
}

function recordMappingTest(db, templateId, fieldKey, { value, confidence, status }) {
  db.prepare(`
    UPDATE template_field_mappings
    SET last_test_value = ?, last_test_confidence = ?, last_test_status = ?,
        last_test_at = datetime('now')
    WHERE template_id = ? AND field_key = ?
  `).run(value ?? null, confidence ?? null, status || null, templateId, fieldKey);
}

// ── Per-template field HIDING (migration 54, owner-approved 2026-07-24) ───────────────────────
// A DISPLAY/EXPECTATION mask: hide a field the TYPE has but THIS supplier's layout lacks, so Review
// stops showing it as an empty "not found" row and stops counting it a missing-required blocker FOR
// THIS TEMPLATE. Never a data delete (extraction still runs + stores whatever it reads). HIDE-ONLY,
// superset-locked (only a field the type actually has), structural roles (issuer/date/ref) NEVER
// hideable — enforced here in setHiddenField. INERT: with no rows, every consumer clause is a no-op.
function _thfTableExists(db) {
  try {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='template_hidden_fields'").get();
  } catch { return false; }
}

function _structuralKeysForTemplate(db, templateId) {
  // Keys that can NEVER be hidden: the identity/company key(s) + customer_name + the type's ref/date
  // roles. Mirrors document_types.COMPANY_KEYS + the structural-role definition (CLAUDE.md).
  const { COMPANY_KEYS } = require('./document_types');
  const keys = new Set([...(COMPANY_KEYS || ['supplier_name']), 'customer_name']);
  const row = safe(() => db.prepare(
    `SELECT dt.ref_field_key AS ref, dt.date_field_key AS date
       FROM templates t LEFT JOIN document_types dt ON dt.slug = t.document_type_slug
      WHERE t.id = ?`).get(templateId), null);
  if (row) { if (row.ref) keys.add(row.ref); if (row.date) keys.add(row.date); }
  return keys;
}

function getHiddenFields(db, templateId) {
  if (!_thfTableExists(db)) return [];
  return db.prepare('SELECT field_key FROM template_hidden_fields WHERE template_id = ? ORDER BY field_key')
           .all(templateId).map(r => r.field_key);
}

function isFieldHideable(db, templateId, fieldKey) {
  // Superset-lock: the field must exist on the template's TYPE, and must not be a structural role.
  if (_structuralKeysForTemplate(db, templateId).has(fieldKey)) return false;
  const t = safe(() => db.prepare('SELECT document_type_slug FROM templates WHERE id = ?').get(templateId), null);
  if (!t) return false;
  const exists = safe(() => db.prepare(
    `SELECT 1 FROM fields f JOIN document_types dt ON dt.id = f.document_type_id
      WHERE dt.slug = ? AND f.key = ? LIMIT 1`).get(t.document_type_slug, fieldKey), null);
  return !!exists;
}

function getTypeFieldsForHiding(db, templateId) {
  // The template's TYPE fields with per-field {structural, hidden} flags — everything the Template
  // Manager needs to render a hide toggle per field (structural rows are shown locked). Includes
  // fields that have NO drawn mapping (the whole point: hide a field the layout simply lacks).
  const t = safe(() => db.prepare('SELECT document_type_slug FROM templates WHERE id = ?').get(templateId), null);
  if (!t) return [];
  const structural = _structuralKeysForTemplate(db, templateId);
  const hidden = new Set(getHiddenFields(db, templateId));
  const rows = safe(() => db.prepare(
    `SELECT f.key, f.label FROM fields f JOIN document_types dt ON dt.id = f.document_type_id
      WHERE dt.slug = ? AND COALESCE(f.enabled, 1) = 1
      ORDER BY COALESCE(f.sort_order, 100), f.id`).all(t.document_type_slug), []);
  return rows.map(r => ({ key: r.key, label: r.label, structural: structural.has(r.key), hidden: hidden.has(r.key) }));
}

function setHiddenField(db, templateId, fieldKey, hidden) {
  // Returns {ok, reason?}. Refuses a structural role or a field not on the type (superset-lock).
  if (hidden && !isFieldHideable(db, templateId, fieldKey)) {
    const structural = _structuralKeysForTemplate(db, templateId).has(fieldKey);
    return { ok: false, reason: structural ? 'structural-role' : 'not-a-type-field' };
  }
  if (!_thfTableExists(db)) return { ok: false, reason: 'no-table' };
  if (hidden) {
    db.prepare('INSERT OR IGNORE INTO template_hidden_fields (template_id, field_key) VALUES (?, ?)')
      .run(templateId, fieldKey);
  } else {
    db.prepare('DELETE FROM template_hidden_fields WHERE template_id = ? AND field_key = ?')
      .run(templateId, fieldKey);
  }
  return { ok: true };
}

// 8-region coarse grid: 2 columns × 4 rows of the page, indexed 0-7
// (row-major, top-left = 0). Purely an optimisation HINT recorded alongside
// the real anchor/target geometry — see CLAUDE.md: "do not make the fixed
// grid the sole extraction mechanism". A target spanning multiple cells
// records all of them so a future full-OCR-skip pass knows to merge zones.
const GRID_COLS = 2;
const GRID_ROWS = 4;

function _computeRegionHint({ target_x_norm, target_y_norm, target_w_norm, target_h_norm }) {
  if ([target_x_norm, target_y_norm, target_w_norm, target_h_norm].some(v => v == null)) return [];
  const x0 = Math.max(0, Math.min(1, target_x_norm));
  const y0 = Math.max(0, Math.min(1, target_y_norm));
  const x1 = Math.max(0, Math.min(1, target_x_norm + target_w_norm));
  const y1 = Math.max(0, Math.min(1, target_y_norm + target_h_norm));
  const cells = new Set();
  const c0 = Math.floor(x0 * GRID_COLS), c1 = Math.max(c0, Math.ceil(x1 * GRID_COLS) - 1);
  const r0 = Math.floor(y0 * GRID_ROWS), r1 = Math.max(r0, Math.ceil(y1 * GRID_ROWS) - 1);
  for (let r = r0; r <= Math.min(r1, GRID_ROWS - 1); r++) {
    for (let c = c0; c <= Math.min(c1, GRID_COLS - 1); c++) {
      cells.add(r * GRID_COLS + c);
    }
  }
  return [...cells].sort((a, b) => a - b);
}

// ── Sample document ───────────────────────────────────────────────────────────

function setSampleDocument(db, templateId, documentId) {
  db.prepare(`
    UPDATE templates SET sample_document_id = ?, updated_at = datetime('now') WHERE id = ?
  `).run(documentId || null, templateId);
}

// ── OCR auto-processing rule ─────────────────────────────────────────────────
// A learned, template-tied OCR preprocessing baseline (skew/threshold/noise
// params — same shape as review/renderer.js getEnhanceParams()). Persisted
// here so it can apply automatically on reprocess for documents matched to
// this template, independent of manual OCR Preview state — see
// processing/handler.js reprocess-document.

// Called when an admin/edit user reprocesses a document with OCR Preview
// active and that document has a known template_id — the manual params
// become this template's auto-processing baseline (enabled by default; an
// admin can turn it off via setOcrAutoEnabled without losing the params).
// Move every document linked to `fromTemplateId` onto `toTemplateId` — the
// reversible primitive behind admin "reassign a poisoned duplicate's documents
// to the correct template" (e.g. a near-identical layout that was learned twice,
// once under a bad short-token identity). Only the documents.template_id LINK
// moves; no extraction data, hints, anchors, or fingerprints are touched, and
// matching itself is link-independent (Stage 0 uses logo_phash/keyword_finger-
// print, not template_id) — so this is fully reversible by reassigning back.
// If the target has no pinned sample yet, it adopts the source's so the
// representative preview survives the move. Returns a summary for traceability.
function reassignDocuments(db, fromTemplateId, toTemplateId) {
  if (!fromTemplateId || !toTemplateId || fromTemplateId === toTemplateId) {
    return { moved: 0, sampleAdopted: false, from: fromTemplateId, to: toTemplateId };
  }
  let sampleAdopted = false;
  const tx = db.transaction(() => {
    const info = db.prepare(
      'UPDATE documents SET template_id = @to WHERE template_id = @from'
    ).run({ to: toTemplateId, from: fromTemplateId });
    const src = db.prepare('SELECT sample_document_id FROM templates WHERE id = ?').get(fromTemplateId);
    const dst = db.prepare('SELECT sample_document_id FROM templates WHERE id = ?').get(toTemplateId);
    if (src && src.sample_document_id && dst && !dst.sample_document_id) {
      db.prepare(`UPDATE templates SET sample_document_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(src.sample_document_id, toTemplateId);
      sampleAdopted = true;
    }
    return info.changes;
  });
  const moved = tx();
  return { moved, sampleAdopted, from: fromTemplateId, to: toTemplateId };
}

// Fold one template's learned data into a canonical target, then delete the
// source — the one-shot consolidation behind Learning Recovery → "Merge into…".
// IRREVERSIBLE (unlike reassignDocuments, which is link-only). Policy: TARGET
// WINS — the canonical template keeps its own identity, mappings, fields,
// landmarks and sample; it only GAINS what it LACKS from the source. So a
// fragment carrying the curated `customer` mapping hands it to the matched
// workhorse without clobbering the workhorse's own data. confirmed_count is
// summed. The source's own mappings/fields/landmarks cascade-delete with its row
// (the folds COPIED the needed ones under the target first); its document links
// move before the delete so the FK null-out is a no-op. One transaction.
function mergeInto(db, fromTemplateId, toTemplateId) {
  const fromId = Number(fromTemplateId), toId = Number(toTemplateId);
  if (!fromId || !toId || fromId === toId) {
    return { ok: false, reason: 'invalid', from: fromId, to: toId };
  }
  const from = db.prepare('SELECT * FROM templates WHERE id = ?').get(fromId);
  const to   = db.prepare('SELECT * FROM templates WHERE id = ?').get(toId);
  if (!from || !to) return { ok: false, reason: 'not_found', from: fromId, to: toId };

  const s = { ok: true, from: fromId, to: toId, movedDocs: 0, mappingsAdded: 0,
              fieldsAdded: 0, landmarksAdopted: false, sampleAdopted: false,
              phashAdopted: false };
  const tx = db.transaction(() => {
    // 1. Document links → target.
    s.movedDocs = db.prepare('UPDATE documents SET template_id = ? WHERE template_id = ?')
      .run(toId, fromId).changes;

    // 2. field_mappings: add only field_keys the target LACKS (target wins),
    //    preserving each folded mapping's enabled flag.
    const haveMap = new Set(getMappings(db, toId).map(m => m.field_key));
    for (const m of getMappings(db, fromId)) {
      if (haveMap.has(m.field_key)) continue;
      saveMapping(db, toId, { ...m, enabled: m.enabled !== 0 });
      s.mappingsAdded++;
    }

    // 3. template_fields: same add-missing fold.
    const haveF = new Set(getFields(db, toId).map(f => f.field_key));
    const missingF = getFields(db, fromId).filter(f => !haveF.has(f.field_key));
    if (missingF.length) { _upsertFields(db, toId, missingF); s.fieldsAdded = missingF.length; }

    // 4. landmarks / sample / phash / fingerprint: adopt source's ONLY if target lacks.
    if (!getLandmarks(db, toId).length) {
      const srcLm = getLandmarks(db, fromId);
      if (srcLm.length) { setLandmarks(db, toId, srcLm); s.landmarksAdopted = true; }
    }
    if (!to.sample_document_id && from.sample_document_id) {
      db.prepare(`UPDATE templates SET sample_document_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(from.sample_document_id, toId);
      s.sampleAdopted = true;
    }
    if (!to.logo_phash && from.logo_phash) {
      db.prepare(`UPDATE templates SET logo_phash = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(from.logo_phash, toId);
      s.phashAdopted = true;
    }
    // Fold the source's logo-hash reference set into the target (add-missing;
    // addLogoHash dedups via UNIQUE and re-applies the cap). So the canonical row
    // inherits every render variant the fragment had learned.
    for (const h of getLogoHashes(db, fromId)) addLogoHash(db, toId, h);
    if (from.logo_phash) addLogoHash(db, toId, from.logo_phash);
    if (!_parseJson(to.keyword_fingerprint, []).length) {
      const fp = _parseJson(from.keyword_fingerprint, []);
      if (fp.length) db.prepare('UPDATE templates SET keyword_fingerprint = ? WHERE id = ?')
        .run(JSON.stringify(fp), toId);
    }

    // 5. confirmed_count summed onto the canonical row.
    db.prepare('UPDATE templates SET confirmed_count = confirmed_count + ? WHERE id = ?')
      .run(from.confirmed_count || 0, toId);

    // 6. Delete the now-emptied source (mappings/fields/landmarks cascade; links moved).
    db.prepare('DELETE FROM templates WHERE id = ?').run(fromId);
  });
  tx();
  return s;
}

function setOcrAutoParams(db, templateId, params) {
  db.prepare(`
    UPDATE templates SET ocr_auto_enabled = 1, ocr_auto_params = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(params || {}), templateId);
  return getById(db, templateId);
}

function setOcrAutoEnabled(db, templateId, enabled) {
  db.prepare(`
    UPDATE templates SET ocr_auto_enabled = ?, updated_at = datetime('now') WHERE id = ?
  `).run(enabled ? 1 : 0, templateId);
  return getById(db, templateId);
}

// Closest template by logo phash, comparing against each template's WHOLE
// reference set (min distance), not just its primary — so a drifted scan still
// resolves once the set has converged. threshold 13 reaches the convergence band
// (callers apply their own accept gate, e.g. conf>=60 ⇔ dist<=6, on match_distance).
function findByLogoHash(db, phash, threshold = 13, document_type_slug = null) {
  if (!phash) return null;
  // Optional TYPE SCOPING (the UI recheck passes it): a supplier issuing several
  // doc types on ONE letterhead has same-logo sibling templates, so a logo-only
  // match is type-blind and would resolve a Sales Order template for an Invoice.
  // When a slug is given, only that type's templates are candidates — mirroring
  // template_matcher.identify_template's type refusal. Null slug = legacy behaviour.
  const rows = document_type_slug
    ? db.prepare(
        "SELECT * FROM templates WHERE logo_phash IS NOT NULL AND LOWER(COALESCE(document_type_slug, '')) = LOWER(?)"
      ).all(document_type_slug)
    : db.prepare('SELECT * FROM templates WHERE logo_phash IS NOT NULL').all();
  let best = null, bestDist = threshold + 1;
  for (const t of rows) {
    let hashes = getLogoHashes(db, t.id);
    if (!hashes.length && t.logo_phash) hashes = [t.logo_phash];   // legacy fallback
    let dist = 64;
    for (const h of hashes) { const d = hammingDistance(phash, h); if (d < dist) dist = d; }
    if (dist < bestDist) {
      bestDist = dist;
      best = { ...t, match_distance: dist, confidence: Math.max(0, 100 - dist * 6) };
    }
  }
  return best;
}

// Keyword-fingerprint match — JS mirror of template_matcher.py's
// _match_by_keywords (word-boundary regex over each template's stored
// keyword_fingerprint, score = hits/len(keywords)). KEYWORD_THRESHOLD there
// is 0.75 → confidence >= 75 here, with the same int()-style truncation.
function findByKeywordFingerprint(db, ocrText, threshold = 75, document_type_slug = null) {
  if (!ocrText) return null;
  const ocrLower = ocrText.toLowerCase();
  // Same optional TYPE SCOPING as findByLogoHash — a same-letterhead sibling of a
  // different type must not match here either (its keyword fingerprint is identical).
  const rows = document_type_slug
    ? db.prepare(
        "SELECT id, name, keyword_fingerprint FROM templates WHERE keyword_fingerprint IS NOT NULL AND LOWER(COALESCE(document_type_slug, '')) = LOWER(?)"
      ).all(document_type_slug)
    : db.prepare('SELECT id, name, keyword_fingerprint FROM templates WHERE keyword_fingerprint IS NOT NULL').all();

  let best = null, bestScore = 0;
  for (const t of rows) {
    const keywords = _parseJson(t.keyword_fingerprint, []);
    if (!keywords.length) continue;
    let hits = 0;
    for (const kw of keywords) {
      const esc = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(ocrLower)) hits++;
    }
    const score = hits / keywords.length;
    if (score > bestScore) {
      bestScore = score;
      best = { template: { id: t.id, name: t.name }, confidence: Math.floor(score * 100), method: 'keywords' };
    }
  }
  return (best && best.confidence >= threshold) ? best : null;
}

// Branding-fingerprint REUSE target (M2, docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md): the
// canonical SAME-TYPE template a drifted-logo doc should reuse, identified by DISTINCTIVE branding
// tokens (not the unstable logo). Requires >= DISTINCTIVE_MIN shared distinctive tokens AND a SYMMETRIC
// ratio >= threshold; TYPE-SCOPED by slug (a same-branding sibling of another type is never a reuse
// target — the letterhead fingerprint is type-blind). Returns the best-ratio same-type template or null.
// threshold defaults to 0.80 — the measured 0% cross-supplier false-match point; the MUTATING reuse path
// (_upsertTemplate → update() folds fingerprint/fields) gets the strict bar (link paths use a lower one).
function findByBrandingFingerprint(db, docFingerprint, document_type_slug, threshold = 0.80) {
  if (!document_type_slug) return null;
  if (brandingFp.distinctiveTokens(docFingerprint).length < brandingFp.DISTINCTIVE_MIN) return null;
  const rows = db.prepare(
    "SELECT id, name, document_type_slug, keyword_fingerprint FROM templates WHERE keyword_fingerprint IS NOT NULL AND LOWER(COALESCE(document_type_slug, '')) = LOWER(?)"
  ).all(document_type_slug);
  let best = null, bestRatio = 0;
  for (const t of rows) {
    const { shared, ratio } = brandingFp.symmetricDistinctiveOverlap(docFingerprint, _parseJson(t.keyword_fingerprint, []));
    if (shared >= brandingFp.DISTINCTIVE_MIN && ratio >= threshold && ratio > bestRatio) {
      bestRatio = ratio;
      best = { id: t.id, name: t.name, document_type_slug: t.document_type_slug, match_ratio: ratio, shared };
    }
  }
  return best;
}

// LIVE field-visibility resolver (2026-07-25, owner request): the template whose hidden-field config
// applies to a (supplier, type) — used by Review to hide a supplier's absent fields even when Stage-0
// matched NO template (the "No template match" case). Returns a template id or null; null ⇒ the caller
// shows ALL fields (the fail-safe the owner asked for). mode 1 = entered NAME first, doc branding
// fingerprint as backup (default); mode 2 = entered NAME only (a dev A/B switch). Name match is normalised
// exact-first then containment; ties broken by confirmed_count so the richest (post-merge canonical) wins.
function _normNameForVis(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

function findForSupplierType(db, { supplier_name, document_type_slug, keyword_fingerprint = null, mode = 1 } = {}) {
  if (!document_type_slug) return null;
  const slug = document_type_slug;
  const byName = () => {
    const q = _normNameForVis(supplier_name);
    if (q.length < 3) return null;   // too short to match safely (fail toward "show all")
    const rows = db.prepare(
      "SELECT id, name, confirmed_count FROM templates WHERE LOWER(COALESCE(document_type_slug, '')) = LOWER(?) AND name IS NOT NULL"
    ).all(slug);
    let exact = null, partial = null;
    for (const t of rows) {
      const n = _normNameForVis(t.name);
      if (!n) continue;
      const cc = t.confirmed_count || 0;
      if (n === q) { if (!exact || cc > (exact.confirmed_count || 0)) exact = t; }
      else if (n.includes(q) || q.includes(n)) { if (!partial || cc > (partial.confirmed_count || 0)) partial = t; }
    }
    const best = exact || partial;
    return best ? best.id : null;
  };
  const byBranding = () => {
    if (!Array.isArray(keyword_fingerprint) || !keyword_fingerprint.length) return null;
    const m = findByBrandingFingerprint(db, keyword_fingerprint, slug, 0.80);
    return m ? m.id : null;
  };
  return (mode === 2) ? byName() : (byName() || byBranding());
}

// UNION of the hidden-field configs across EVERY template that shares this doc's (supplier NAME, type)
// — so a per-supplier "hide item/serial" setting applies regardless of WHICH duplicate sibling template
// the logo matched (2026-07-27, owner: visibly-same same-supplier same-type templates must be treated as
// one AUTOMATICALLY, no manual merge). Same name-normalisation + type scoping + branding backup as
// findForSupplierType, but returns the UNIONED field_key list instead of a single template id. Display-
// only; fail-safe [] (⇒ show ALL fields) when nothing resolves or the table is absent.
function getHiddenFieldsForSupplierType(db, { supplier_name, document_type_slug, keyword_fingerprint = null, mode = 1 } = {}) {
  if (!document_type_slug || !_thfTableExists(db)) return [];
  const slug = document_type_slug;
  const ids = new Set();
  const q = _normNameForVis(supplier_name);
  if (q.length >= 3) {
    const rows = safe(() => db.prepare(
      "SELECT id, name FROM templates WHERE LOWER(COALESCE(document_type_slug, '')) = LOWER(?) AND name IS NOT NULL"
    ).all(slug), []);
    for (const t of rows) {
      const n = _normNameForVis(t.name);
      if (n && (n === q || n.includes(q) || q.includes(n))) ids.add(t.id);
    }
  }
  // Branding backup (mode 1 only), same as findForSupplierType — only when the NAME resolved nothing.
  if (mode !== 2 && ids.size === 0 && Array.isArray(keyword_fingerprint) && keyword_fingerprint.length) {
    const m = safe(() => findByBrandingFingerprint(db, keyword_fingerprint, slug, 0.80), null);
    if (m) ids.add(m.id);
  }
  // C3 (2026-07-27, group activation): also include GROUP siblings (group_id) of any resolved template —
  // so once the owner-run backfill groups the duplicates, config resolves group-wide too. ADDITIVE
  // (group_id ∪ name), never a replacement, so a name-matched-but-ungrouped cluster never loses its config.
  for (const tid of [...ids]) {
    const gid = safe(() => (db.prepare('SELECT group_id FROM templates WHERE id = ?').get(tid) || {}).group_id, null);
    if (gid != null) for (const s of safe(() => db.prepare('SELECT id FROM templates WHERE group_id = ?').all(gid), [])) ids.add(s.id);
  }
  const out = new Set();
  for (const id of ids) for (const k of getHiddenFields(db, id)) out.add(k);
  return [...out].sort();
}

// NAME-PRIMARY REUSE (TEMPLATE_REUSE_BY_NAME, Phillip/Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-27): the id
// of the SAME-SLUG template whose ESTABLISHED (dominant confirmed) identity EXACTLY equals `confirmedIssuer`
// (_normNameForVis; NEVER containment — "northgate services" contains "gate services"), preferring the
// RICHEST (most confirmed docs). Keys on establishedIdentity, NOT the cosmetic `name` (first-confirm luck /
// OCR garble). Both names must be a plausible supplier shape + normalised length >= 3. null ⇒ no exact
// same-identity same-type sibling ⇒ caller mints standalone (today's behaviour). Cross-supplier reuse is
// structurally impossible (exact identity + slug). ACCEPTED residual (Oracle, pinned): two DIFFERENT real
// companies whose confirmed issuer normalises identically + same slug DO fold — but that identical-name
// collision already merges supplier-scoped hints/anchors/corrections, so it adds no NEW class, and the
// operator sees the values at teach time. The CALLER links + Part-E re-validates the acquisition.
function reuseByEstablishedName(db, confirmedIssuer, document_type_slug, excludeDocId = null) {
  if (!document_type_slug) return null;
  const q = _normNameForVis(confirmedIssuer);
  if (q.length < 3) return null;
  const { isPlausibleSupplierNameBase } = require('./learning');   // lazy — avoids a load-order knot
  if (!safe(() => isPlausibleSupplierNameBase(confirmedIssuer), false)) return null;
  const rows = safe(() => db.prepare(
    "SELECT id FROM templates WHERE LOWER(COALESCE(document_type_slug, '')) = LOWER(?)").all(document_type_slug), []);
  let best = null, bestCount = -1;
  for (const t of rows) {
    const ident = safe(() => establishedIdentity(db, t.id, excludeDocId), null);   // dominant confirmed issuer, self-excluded (empty sibling ⇒ null ⇒ skipped)
    if (!ident || _normNameForVis(ident) !== q) continue;         // EXACT normalised identity, NEVER containment
    if (!safe(() => isPlausibleSupplierNameBase(ident), false)) continue;
    const cc = safe(() => confirmedDocCount(db, t.id), 0) || 0;   // canonical = richest confirmed sibling (never the empty duplicate)
    if (cc > bestCount) { bestCount = cc; best = t.id; }
  }
  return best;
}

// Lightweight current-template recheck — given a document's already-stored
// logo_phash/ocr_text (no page image, no OCR, no extraction pipeline), tries
// the same logo-then-keyword identification order and accept thresholds as
// template_matcher.identify_template(): logo confidence >= 60, else keyword
// confidence >= 75. Used by the review queue to detect that a template added
// via "Add to Template Manager" now covers a document that was queued before
// it existed.
function identifyByFingerprint(db, { logo_phash, ocr_text, document_type_slug = null, logo_detail_hash = null }) {
  if (logo_phash) {
    const logoMatch = findByLogoHash(db, logo_phash, 13, document_type_slug);
    if (logoMatch && logoMatch.confidence >= 60) {
      // DETAIL-HASH VETO (TEMPLATE_LOGO_DETAIL_VETO, default ON; Oracle-signed 2026-07-23).
      // The 64-bit phash's histograms have CROSSED on real scans — measured cross-supplier
      // separation 2/64 bits vs SAME-supplier scan drift 18/64 — so no distance threshold can
      // make a logo-alone accept correct (the "Template available: Thornbury" on a Copperfield
      // docket incident). When the caller supplies the doc's 256-bit isolated-mark hash and the
      // matched template has an enrolled detail set, a positive CONTRADICTION (min-over-set
      // distance > veto dist 72; measured impostor 114-124 vs genuine drift 30-56) refuses the
      // logo arm and falls through to the text-based keyword arm — abstain-or-text, never
      // pick-another-template-by-hash. Fail-open on missing detail (callers not passing the new
      // param, detail-less template rows, pre-mig-47 installs) ⇒ byte-identical. This extends
      // the 2026-07-20 identity invariant — "a logo match never asserts identity alone" — to
      // its last JS holdout; see logoDetail.js for the deliberate Stage-0 semantic divergence.
      const vetoed = logo_detail_hash && process.env.TEMPLATE_LOGO_DETAIL_VETO !== '0'
        && logoDetail.shouldVetoLogo(logo_detail_hash, getLogoDetailHashes(db, logoMatch.id));
      // NAME-PRESENCE VETO (Oracle SIGN-OFF-WITH-CONDITIONS 2026-07-24): a supplier that reliably
      // prints its own name can't be suggested for a page lacking it — the JS twin of the Python
      // TEMPLATE_LOGO_TEXT_GATE, keyed on a learned per-supplier ratio. Sibling to the detail veto:
      // both only turn accept->abstain (monotonic) and fall through to the text keyword arm. It is
      // MORE load-bearing than the detail veto here — it also guards the wizard save-target and the
      // graduation link that share identifyByFingerprint. See namePresence.js.
      const nameVetoed = !vetoed && namePresence.nameBearingButAbsent(db, logoMatch.id, ocr_text);
      if (!vetoed && !nameVetoed) {
        return { template: { id: logoMatch.id, name: logoMatch.name }, confidence: logoMatch.confidence, method: 'logo' };
      }
    }
  }
  // Gate the keyword arm too (Oracle: both arms) — a keyword-fingerprint match to a name-bearing
  // supplier whose name is absent on this page is the same cross-supplier suggestion.
  const kw = findByKeywordFingerprint(db, ocr_text, 75, document_type_slug);
  return (kw && namePresence.nameBearingButAbsent(db, kw.template.id, ocr_text)) ? null : kw;
}

// Cheap name-based lookup for the Learning Recovery tab — shows managed
// templates alongside (but separate from) automatic learning data for the
// same supplier. Matching is purely cosmetic (template name vs. supplier
// name); it does not affect identification, which uses logo_phash /
// keyword_fingerprint exclusively (see identifyByFingerprint above).
function searchByName(db, query, document_type_slug) {
  const q = `%${(query || '').toLowerCase()}%`;
  return db.prepare(`
    SELECT id, name, document_type_slug, confirmed_count
    FROM templates
    WHERE LOWER(name) LIKE @q AND (@dt IS NULL OR document_type_slug = @dt)
    ORDER BY name
  `).all({ q, dt: document_type_slug || null });
}

function create(db, { name, document_type_slug, logo_phash, logo_detail_hash, keyword_fingerprint, fields }) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'template';
  // templates.slug is UNIQUE, but the generated NAME is not: two documents of the
  // same type with no resolved supplier both yield "<Type> Template" -> the same
  // base slug, so a second one would hit "UNIQUE constraint failed: templates.slug".
  // De-duplicate by appending a counter. Slug/name are COSMETIC (identification is
  // by logo_phash / keyword_fingerprint — see template_matcher.py and rename()), so
  // a numbered slug is harmless. Reusable for every supplier/type.
  const slugExists = db.prepare('SELECT 1 FROM templates WHERE slug = ?');
  let slug = base, n = 1;
  while (slugExists.get(slug)) { n += 1; slug = `${base}_${n}`; }
  const info = db.prepare(`
    INSERT INTO templates (name, slug, document_type_slug, logo_phash, keyword_fingerprint)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, slug, document_type_slug || null, logo_phash || null,
         JSON.stringify(keyword_fingerprint || []));
  const id = info.lastInsertRowid;
  if (logo_phash) addLogoHash(db, id, logo_phash, logo_detail_hash);   // seed the set + its detail hash (migration 26 / 47)
  if (fields && fields.length) _upsertFields(db, id, fields);
  return id;
}

// NAME-HEAL decision (2026-07-10): should a later confirm's Document-Issuer value replace
// this template's current name? A template created at a supplier's FIRST confirm inherits
// whatever sat in the issuer field at that moment — a wrong first detection births a
// template named after a POSTCODE ("BT23 1BE" → slug bt23_1be, the PF_pur case) or a bare
// caption word ("Ref", 4 confirms deep) and the old heal (generic "<Type> Template" names
// only) never touches it. Adopt the confirmed issuer when:
//   • the issuer is a PLAUSIBLE supplier name (learning.isPlausibleSupplierName) and
//     differs from the current name (case-insensitive), AND the current name is
//   • still the GENERIC "… Template", OR shape-IMPLAUSIBLE ("IN", "36552"), OR a UK
//     POSTCODE ("BT23 1BE" — letters+digits, so it PASSES the plausibility shape test;
//     regex twin of config validation_patterns.postcode_uk), OR a single bare
//     DOCUMENT-STRUCTURE word ("Ref", "Invoice", "Total" — captions, never companies).
// A plausible multi-word / brand-like name (hand-rename, or a previously-adopted issuer)
// is NEVER touched — so the heal can't flip-flop between issuer variants: once a plausible
// name is in place, only the admin can change it. Pure; guarded by
// test_template_name_heal.js. NAME stays cosmetic (matching is logo/fingerprint).
const _CAPTION_WORDS = new Set([
  'ref', 'reference', 'no', 'number', 'invoice', 'order', 'total', 'date',
  'account', 'customer', 'supplier', 'vendor', 'issuer', 'po', 'so', 'quote',
  'delivery', 'statement', 'receipt', 'worksheet', 'document',
]);
const _UK_POSTCODE = /^[A-Za-z]{1,2}\d{1,2}[A-Za-z]?\s*\d[A-Za-z]{2}$/;

function _looksLikeNonName(name) {
  const t = String(name || '').trim();
  if (!t) return true;
  if (/\btemplate$/i.test(t)) return true;                       // the generic auto-name
  const { isPlausibleSupplierNameBase } = require('./learning'); // lazy: avoids load-order knots
  if (!isPlausibleSupplierNameBase(t)) return true;              // "IN"/"36552" shapes (BASE — a real short name like "Dell" is NOT chrome-demoted here)
  if (_UK_POSTCODE.test(t)) return true;                         // "BT23 1BE"
  const toks = t.toLowerCase().split(/\s+/);
  if (toks.length === 1 && _CAPTION_WORDS.has(toks[0].replace(/[.:#]+$/, ''))) return true;
  return false;
}

function shouldAdoptIssuerName(currentName, confirmedIssuer) {
  const issuer = String(confirmedIssuer || '').trim();
  if (!issuer) return false;
  const { isPlausibleSupplierNameBase } = require('./learning');
  if (!isPlausibleSupplierNameBase(issuer)) return false;        // never adopt junk (BASE — a real short issuer is not chrome-demoted)
  if (_UK_POSTCODE.test(issuer)) return false;                   // …or a postcode-as-issuer
  if (issuer.toLowerCase() === String(currentName || '').trim().toLowerCase()) return false;
  return _looksLikeNonName(currentName);
}

// Cosmetic/admin-facing rename only — `name` plays no role in template
// matching (identification uses logo_phash / keyword_fingerprint exclusively,
// see template_matcher.py) and `slug` is left untouched, so this can never
// affect extraction, identification, or the debug-export filename derived
// from slug at creation time (review/handler.js _writeTemplateFile).
function rename(db, id, name) {
  db.prepare(`UPDATE templates SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(name, id);
  return getById(db, id);
}

// Scoped delete — removes only this template's own row plus its
// template_fields / template_field_mappings (both ON DELETE CASCADE on
// template_id, see migrations 4 and 8). documents.template_id has no cascade
// and foreign_keys is ON, so any confirmed documents pointing at this template
// must be unlinked first or the DELETE would throw SQLITE_CONSTRAINT_FOREIGNKEY;
// nulling it out only clears the now-dangling reference — the documents, their
// extractions, learned anchors, supplier hints, and logo fingerprints are
// untouched. Wrapped in a transaction so the unlink and delete are atomic.
function remove(db, id) {
  const tx = db.transaction(() => {
    db.prepare('UPDATE documents SET template_id = NULL WHERE template_id = ?').run(id);
    db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  });
  tx();
}

// ── Template identity stability ────────────────────────────────────────────
// A template's logo_phash + keyword_fingerprint ARE its Stage-0 identity (see
// template_matcher.py identify_template). Confirming a sample used to OVERWRITE
// both with that one document's freshly-OCR'd values, so a single noisy scan
// could replace a known-good identity with non-reproducible garble — OCR
// misreads ("OLUTIONS", "bol"), or per-document customer/invoice/date tokens.
// After such a confirm even the original sample no longer matched its own
// template, so the learned anchors/field-mappings never ran. These helpers make
// identity STABILISE across confirms instead of being clobbered by one sample.

// A pruned keyword identity below this many tokens is too thin to identify
// reliably, so a confirm that would erode it that far is ignored in favour of
// the established identity.
const FINGERPRINT_FLOOR = 3;

function _normTokens(arr) {
  const out = [], seen = new Set();
  for (const t of (Array.isArray(arr) ? arr : [])) {
    const s = String(t == null ? '' : t).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;   // case-insensitive dedupe (matcher lowercases both sides)
    seen.add(k);
    out.push(s);                 // preserve first-seen casing/order
  }
  return out;
}

// Keep the tokens that RECUR across confirmed samples — the intersection of the
// established identity with the incoming sample. Per-document noise (a customer
// name, an invoice number, a one-off OCR misread) appears in only one sample and
// is dropped; stable supplier branding survives and converges. The FLOOR guards
// erosion: if the intersection is too thin to identify reliably, the established
// identity is kept unchanged so one noisy confirm cannot erase it. The first
// real identity (nothing established yet) is seeded as-is.
function stabiliseFingerprint(existing, incoming) {
  const ex  = _normTokens(existing);
  const inc = _normTokens(incoming);
  if (!ex.length)  return inc;   // nothing established yet — seed from this sample
  if (!inc.length) return ex;    // nothing to learn from — keep the proven identity
  const incSet = new Set(inc.map(t => t.toLowerCase()));
  const kept   = ex.filter(t => incSet.has(t.toLowerCase()));   // existing order/casing
  return kept.length >= FINGERPRINT_FLOOR ? kept : ex;
}

// Logo identity is a single perceptual hash, not a set, so it cannot intersect.
// The same per-render scan/DPI/enhance drift that affects the fingerprint shifts
// a recomputed phash by double-digit Hamming on the SAME document, so over-
// writing a populated hash every confirm only destabilises the Stage-0 logo
// gate. Seed it once when empty; otherwise keep the established value.
function chooseLogoPhash(existing, incoming) {
  const ex = existing == null ? '' : String(existing).trim();
  if (ex) return existing;
  return (incoming == null || String(incoming).trim() === '') ? null : incoming;
}

// Converge a template's IDENTITY (keyword fingerprint + logo-hash set) toward one
// document's signals, WITHOUT bumping confirmed_count or touching fields (count-free,
// field-free — safe to call on any commit, not only a taught one). The fingerprint is
// INTERSECTED (stabiliseFingerprint) so per-document noise (customer tokens, a one-off
// misread) erodes and stable branding survives: this is the healer that strips the
// customer-token pollution a graduation-frozen template carries. The logo is the
// fragile axis — a single phash drifts double-digit Hamming per render — so it is
// SEEDED once when empty then APPENDED within the drift band, never overwritten.
//
// appendLogoOnly (Oracle C-A — set by the automatic learn-on-commit hook + backfill):
// NEVER seed a NEW primary logo. Enrich the logo set only when the template ALREADY
// carries a primary; a template with no primary (a graduation-C3 KEYWORD-ONLY template,
// whose logo was deliberately withheld on a cross-supplier logo collision) is left with
// NO logo at all. Re-planting that withheld logo would be a silent cross-supplier
// misfile (the 64-bit phash hashes letterhead LAYOUT, so same-layout/different-supplier
// is the danger zone). The fingerprint intersect — the real healer — still runs in
// every mode; only the logo SEED is suppressed.
function enrichIdentity(db, id, { logo_phash, logo_detail_hash, keyword_fingerprint, appendLogoOnly = false } = {}) {
  const cur  = db.prepare('SELECT logo_phash, keyword_fingerprint FROM templates WHERE id = ?').get(id) || {};
  const sets = [], params = [];

  if (keyword_fingerprint !== undefined) {
    const merged = stabiliseFingerprint(_parseJson(cur.keyword_fingerprint, []), keyword_fingerprint);
    sets.push('keyword_fingerprint = ?');
    params.push(JSON.stringify(merged));
  }
  // Seed/keep the primary logo column ONLY on the taught-update path. Under
  // appendLogoOnly the column is untouched so a null primary can never be seeded.
  if (logo_phash !== undefined && !appendLogoOnly) {
    sets.push('logo_phash = ?');
    params.push(chooseLogoPhash(cur.logo_phash, logo_phash));
  }
  if (sets.length) {
    params.push(id);
    db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  // Multi-reference logo-hash maintenance (migration 26): seed the established
  // primary into the reference set, then APPEND this scan's hash when it's a
  // drifted-but-related sample (within the band, not a near-duplicate) so the set
  // converges to span this supplier's render drift. addLogoHash dedups + caps.
  if (logo_phash) {
    const primary = (db.prepare('SELECT logo_phash FROM templates WHERE id = ?').get(id) || {}).logo_phash;
    if (appendLogoOnly && !primary) return;       // C-A: no established primary → never enrich the logo
    if (primary) addLogoHash(db, id, primary);    // seed's own detail hash unknown here → backfills on re-confirm
    const minD = minLogoDistance(db, id, logo_phash, primary);
    if (minD > LOGO_DEDUP_FLOOR && minD <= LOGO_APPEND_BAND) addLogoHash(db, id, logo_phash, logo_detail_hash);
  }
}

function update(db, id, { logo_phash, logo_detail_hash, keyword_fingerprint, fields } = {}) {
  // confirmed_count bump + timestamp stay here (identity convergence is delegated).
  db.prepare("UPDATE templates SET confirmed_count = confirmed_count + 1, updated_at = datetime('now') WHERE id = ?").run(id);
  // Taught-confirm identity convergence — NOT appendLogoOnly, so a first taught confirm
  // still seeds the primary logo exactly as before (byte-identical to the old inline body).
  enrichIdentity(db, id, { logo_phash, logo_detail_hash, keyword_fingerprint });
  if (fields && fields.length) _upsertFields(db, id, fields);
}

// Slice 1 — LEARN-ON-COMMIT. Re-run identity convergence for a document's ALREADY-resolved
// template on ANY commit route (single confirm / File-All / auto-file), so a matched or
// graduation-born template keeps converging toward its supplier's real branding instead of
// freezing at its first sample (a customer-token-polluted fingerprint + a single logo hash).
// Historically this ran ONLY on a taught confirm (via update()); a frozen template lets the
// same-supplier invoice "letterhead magnet" out-score the real PO template → refuse / misfile.
//   · Kill switch template_learn_on_confirm — DEFAULT ON since the flip (setting='false' disables); env
//     TEMPLATE_LEARN_ON_CONFIRM=1/0 hard-forces it for the flip gate + route tests.
//   · TYPE-SCOPED     — only a template of the confirmed type is enriched.
//   · SUPPLIER-VALIDATED — a doc whose confirmed issuer is a provably DIFFERENT company from the
//     template's established identity donates nothing (a mislinked doc can't plant a foreign hash).
//   · appendLogoOnly  — Oracle C-A: never seeds a NEW primary logo (a graduation-C3 keyword-only
//     template stays logo-less; only the fingerprint intersect heals it).
//   · SYMMETRIC across all types. Pure DB (no ctx) — safe to call from any commit path.
function learnTemplateOnCommit(db, document_id, { document_type_slug, supplier_name } = {}) {
  const learning = require('./learning');   // lazy — avoids a load-order knot
  const env = process.env.TEMPLATE_LEARN_ON_CONFIRM;
  const on  = env === '1' ? true : env === '0' ? false
            : learning.getSetting(db, 'template_learn_on_confirm', 'true') !== 'false';
  if (!on) return;

  const doc = db.prepare(
    'SELECT template_id, logo_phash, logo_detail_hash, keyword_fingerprint FROM documents WHERE id = ?'
  ).get(document_id);
  const tid = doc && doc.template_id;
  if (!tid) return;                          // no resolved template on this doc → nothing to enrich

  const tmpl = db.prepare('SELECT document_type_slug FROM templates WHERE id = ?').get(tid);
  if (!tmpl) return;
  // TYPE-SCOPE: never let a same-logo sibling of another type absorb this doc's fingerprint.
  if (document_type_slug && tmpl.document_type_slug && tmpl.document_type_slug !== document_type_slug) return;

  // SUPPLIER-VALIDATE: exclude this doc from the identity read (a plain establishedIdentity would
  // count the doc against itself); enrich only if the OTHER samples' issuer is not provably foreign.
  const ident = establishedIdentity(db, tid, document_id);
  if (ident && supplier_name && supplierNamesDisjoint(supplier_name, ident)) return;

  const fp = _parseJson(doc.keyword_fingerprint, null);
  enrichIdentity(db, tid, {
    logo_phash:          doc.logo_phash || undefined,
    logo_detail_hash:    doc.logo_detail_hash || undefined,
    keyword_fingerprint: Array.isArray(fp) ? fp : undefined,
    appendLogoOnly:      true,          // C-A — never seed a new primary logo automatically
  });
}

function _upsertFields(db, templateId, fields) {
  // A confirmed-history rebuild must NOT erase an admin-LOCKED fixed value
  // (fixed_locked = 1) — the CASE keeps the existing row's fixed_value/is_variable
  // when locked, else takes the recomputed values (unchanged behaviour for unlocked
  // rows). fixed_locked itself is never touched here, so a locked row stays locked.
  const stmt = db.prepare(`
    INSERT INTO template_fields
      (template_id, field_key, anchor_label, direction, fixed_value, is_variable)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(template_id, field_key) DO UPDATE SET
      anchor_label = excluded.anchor_label,
      direction    = excluded.direction,
      fixed_value  = CASE WHEN fixed_locked = 1 THEN fixed_value ELSE excluded.fixed_value END,
      is_variable  = CASE WHEN fixed_locked = 1 THEN is_variable ELSE excluded.is_variable END
  `);
  for (const f of fields) {
    stmt.run(
      templateId,
      f.field_key,
      f.anchor_label  || null,
      f.direction     || 'right',
      f.fixed_value   || null,
      f.is_variable !== false && f.is_variable !== 0 ? 1 : 0
    );
  }
}

// Explicit admin-set fixed value for ONE template field (Template Manager /
// Template Wizard → "Fixed value"). A fixed value makes
// template_matcher.extract_with_template emit it for every matching document — and,
// because the admin set it deliberately, as the PROTECTED method
// 'template_fixed_locked' (confidence 95) that the engine guards from ordinary
// OCR/keyword/anchor overrides, NOT the overridable auto-derived 'template_fixed'.
// fixed_locked = 1 marks that intent and is preserved across confirmed-history
// rebuilds (_upsertFields). Clearing it (null/empty) sets fixed_value=NULL,
// is_variable=1 AND fixed_locked=0, returning the field to normal variable
// behaviour. Only fixed_value/is_variable/fixed_locked are touched on conflict, so
// any learned anchor_label/direction on the same row is preserved.
function setFieldFixedValue(db, templateId, fieldKey, fixedValue) {
  const val = (fixedValue == null || String(fixedValue).trim() === '')
    ? null
    : String(fixedValue).trim();
  const isVariable = val === null ? 1 : 0;
  const locked     = val === null ? 0 : 1;
  db.prepare(`
    INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable, fixed_locked)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(template_id, field_key) DO UPDATE SET
      fixed_value  = excluded.fixed_value,
      is_variable  = excluded.is_variable,
      fixed_locked = excluded.fixed_locked
  `).run(templateId, fieldKey, val, isVariable, locked);
  return getById(db, templateId);
}

function hammingDistance(h1, h2) {
  if (!h1 || !h2 || h1.length !== h2.length) return 64;
  let dist = 0;
  for (let i = 0; i < h1.length; i++) {
    let xor = parseInt(h1[i], 16) ^ parseInt(h2[i], 16);
    while (xor) { dist += xor & 1; xor >>= 1; }
  }
  return dist;
}

function _parseJson(str, fallback) {
  try { return JSON.parse(str || 'null') || fallback; } catch { return fallback; }
}

// ── Template groups ───────────────────────────────────────────────────────────
// Organisational grouping only — v1 has no shared-anchor behaviour.  Matching
// (Stage 0 logo/keyword, Stage 0.5 mapping) is purely per-template; group_id
// is metadata consumed only by the admin UI and returned via getById's SELECT *.

function getAllGroups(db) {
  return db.prepare('SELECT * FROM template_groups ORDER BY name').all();
}

function createGroup(db, name) {
  const info = db.prepare('INSERT INTO template_groups (name) VALUES (?)').run(name.trim());
  return info.lastInsertRowid;
}

function deleteGroup(db, id) {
  const tx = db.transaction(() => {
    db.prepare('UPDATE templates SET group_id = NULL WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM template_groups WHERE id = ?').run(id);
  });
  tx();
}

function setTemplateGroup(db, templateId, groupId) {
  db.prepare('UPDATE templates SET group_id = ? WHERE id = ?').run(groupId || null, templateId);
  return getById(db, templateId);
}

function getSiblings(db, groupId, excludeTemplateId) {
  return db.prepare(
    'SELECT id, name, document_type_slug FROM templates WHERE group_id = ? AND id != ? ORDER BY name'
  ).all(groupId, excludeTemplateId);
}

// ── Registration landmarks (migration 22) ───────────────────────────────────
// Per-template stable text landmarks used to fit a similarity/affine transform
// from the taught page onto an incoming (shifted/skewed/scaled) page — see
// python_backend/extraction/registration.py. Additive: a template with no
// landmarks simply falls through to the existing anchor/offset path.

// ── Multi-reference logo hashes (migration 26) ──────────────────────────────
function getLogoHashes(db, templateId) {
  return db.prepare(
    'SELECT phash FROM template_logo_hashes WHERE template_id = ? ORDER BY id'
  ).all(templateId).map(r => r.phash);
}

// Slice C: the isolated-mark 256-bit DETAIL hashes of this template's enrolled prints (nulls
// excluded). The Slice-C disambiguator takes the min distance over this set to veto a look-alike
// logo collision. Empty until Slice-B enrolment accrues → the veto is inert (never a false abstain).
function getLogoDetailHashes(db, templateId) {
  return db.prepare(
    "SELECT detail_hash FROM template_logo_hashes WHERE template_id = ? AND detail_hash IS NOT NULL AND detail_hash <> '' ORDER BY id"
  ).all(templateId).map(r => r.detail_hash);
}

// Append a logo hash to a template's reference set (idempotent via UNIQUE), capped
// at LOGO_HASH_CAP. On overflow, evict the MOST REDUNDANT non-primary ref (smallest
// distance to another ref; tie-broken oldest), never the template's seed/primary
// logo_phash. One transaction.
function addLogoHash(db, templateId, phash, detail_hash) {
  if (!phash) return;
  const tx = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO template_logo_hashes (template_id, phash, detail_hash) VALUES (?, ?, ?)')
      .run(templateId, phash, detail_hash || null);
    // Slice B: backfill the isolated-mark detail hash onto an already-present phash row (INSERT OR
    // IGNORE leaves an existing row untouched; a pre-migration row's detail_hash is NULL). NULL-inert.
    if (detail_hash) {
      db.prepare(`UPDATE template_logo_hashes SET detail_hash = ?
                  WHERE template_id = ? AND phash = ? AND (detail_hash IS NULL OR detail_hash = '')`)
        .run(detail_hash, templateId, phash);
    }
    const rows = db.prepare(
      'SELECT id, phash FROM template_logo_hashes WHERE template_id = ? ORDER BY id'
    ).all(templateId);
    if (rows.length <= LOGO_HASH_CAP) return;
    const primary = (db.prepare('SELECT logo_phash FROM templates WHERE id = ?').get(templateId) || {}).logo_phash || null;
    let victim = null, bestRedund = Infinity;
    for (const r of rows) {                       // rows ordered oldest-first → oldest wins ties
      if (r.phash === primary) continue;          // never evict the seed/primary
      let nearest = 64;
      for (const o of rows) {
        if (o.id === r.id) continue;
        const d = hammingDistance(r.phash, o.phash);
        if (d < nearest) nearest = d;
      }
      if (nearest < bestRedund) { bestRedund = nearest; victim = r.id; }
    }
    if (victim != null) db.prepare('DELETE FROM template_logo_hashes WHERE id = ?').run(victim);
  });
  tx();
}

// Min Hamming from a phash to a template's whole reference set — falls back to the
// legacy single logo_phash so pre-migration / un-backfilled templates still match.
function minLogoDistance(db, templateId, phash, primaryFallback) {
  if (!phash) return 64;
  let hashes = getLogoHashes(db, templateId);
  if (!hashes.length && primaryFallback) hashes = [primaryFallback];
  let best = 64;
  for (const h of hashes) { const d = hammingDistance(phash, h); if (d < best) best = d; }
  return best;
}

// Fraction of the candidate template's keyword fingerprint also present in the
// document's — the over-merge guard for the widened (7-13) convergence reuse band.
function _keywordOverlap(docFp, candFp) {
  const cand = (candFp || []).map(s => String(s).toLowerCase());
  if (!cand.length) return 0;
  const doc = new Set((docFp || []).map(s => String(s).toLowerCase()));
  let hits = 0;
  for (const k of cand) if (doc.has(k)) hits++;
  return hits / cand.length;
}

function getLandmarks(db, templateId) {
  return db.prepare(
    'SELECT * FROM template_landmarks WHERE template_id = ? ORDER BY page_number, id'
  ).all(templateId);
}

// Replace-all in one transaction (the wizard / backfill recomputes the whole
// set for a template at once, never appends piecemeal). `source` tags how the set
// was produced ('auto' = derived; 'manual' = admin-drawn via Enhance detection);
// a row's own l.source wins so an adopted (merge) set keeps its origin.
function setLandmarks(db, templateId, landmarks, source = 'auto') {
  const rows = Array.isArray(landmarks) ? landmarks : [];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM template_landmarks WHERE template_id = ?').run(templateId);
    const ins = db.prepare(`
      INSERT INTO template_landmarks
        (template_id, label_text, x_norm, y_norm, w_norm, h_norm, ocr_conf, page_number, source)
      VALUES (@template_id, @label_text, @x_norm, @y_norm, @w_norm, @h_norm, @ocr_conf, @page_number, @source)
    `);
    for (const l of rows) {
      if (!l || l.label_text == null) continue;
      ins.run({
        template_id: templateId,
        label_text:  String(l.label_text),
        x_norm:      Number(l.x_norm), y_norm: Number(l.y_norm),
        w_norm:      Number(l.w_norm), h_norm: Number(l.h_norm),
        ocr_conf:    l.ocr_conf == null ? null : Number(l.ocr_conf),
        page_number: l.page_number == null ? 0 : (Number(l.page_number) | 0),
        source:      l.source || source,
      });
    }
  });
  tx();
  return getLandmarks(db, templateId);
}

// True if the template has admin-drawn (manual) landmarks — auto-derivation must
// NOT overwrite these (see generateLandmarks guard).
function hasManualLandmarks(db, templateId) {
  return !!db.prepare(
    "SELECT 1 FROM template_landmarks WHERE template_id = ? AND source = 'manual' LIMIT 1"
  ).get(templateId);
}

function clearLandmarks(db, templateId) {
  db.prepare('DELETE FROM template_landmarks WHERE template_id = ?').run(templateId);
}

// True if the template's landmarks were auto-derived from the cross-sample corpus
// (source='cross_sample') — the single-sample bootstrap must not downgrade these.
function hasCrossSampleLandmarks(db, templateId) {
  return !!db.prepare(
    "SELECT 1 FROM template_landmarks WHERE template_id = ? AND source = 'cross_sample' LIMIT 1"
  ).get(templateId);
}

// ── Cross-sample landmark corpus (migration 34) ──────────────────────────────
// Per-confirmed-document captured words. REPLACE-per-doc (idempotent) so
// re-confirming a document never double-counts it in the corpus.
function replaceSampleWords(db, templateId, docId, words) {
  const rows = Array.isArray(words) ? words : [];
  const tx = db.transaction(() => {
    if (docId != null) {
      db.prepare('DELETE FROM template_sample_words WHERE template_id = ? AND doc_id = ?').run(templateId, docId);
    }
    const ins = db.prepare(`
      INSERT INTO template_sample_words
        (template_id, doc_id, label_text, x_norm, y_norm, w_norm, h_norm, ocr_conf)
      VALUES (@template_id, @doc_id, @label_text, @x_norm, @y_norm, @w_norm, @h_norm, @ocr_conf)
    `);
    for (const w of rows) {
      if (!w || w.text == null) continue;
      ins.run({
        template_id: templateId, doc_id: docId == null ? null : docId,
        label_text: String(w.text),
        x_norm: Number(w.x_norm), y_norm: Number(w.y_norm),
        w_norm: Number(w.w_norm), h_norm: Number(w.h_norm),
        ocr_conf: w.conf == null ? null : Number(w.conf),
      });
    }
  });
  tx();
}

function countSampleDocs(db, templateId) {
  const r = db.prepare(
    'SELECT COUNT(DISTINCT doc_id) AS n FROM template_sample_words WHERE template_id = ?'
  ).get(templateId);
  return (r && r.n) || 0;
}

// Per-doc word lists for cross-sample selection: [[{text,conf,x_norm,…}], …].
function getSampleWordsByDoc(db, templateId) {
  const rows = db.prepare(`
    SELECT doc_id, label_text, x_norm, y_norm, w_norm, h_norm, ocr_conf
    FROM template_sample_words WHERE template_id = ? ORDER BY doc_id, id
  `).all(templateId);
  const byDoc = new Map();
  for (const r of rows) {
    const k = r.doc_id == null ? 0 : r.doc_id;
    if (!byDoc.has(k)) byDoc.set(k, []);
    byDoc.get(k).push({
      text: r.label_text, conf: r.ocr_conf,
      x_norm: r.x_norm, y_norm: r.y_norm, w_norm: r.w_norm, h_norm: r.h_norm,
    });
  }
  return [...byDoc.values()];
}

// Migration 46 sweep: UNFREEZE already-auto-frozen RECIPIENT-name template fields across ALL
// templates. `_buildTemplateFields` used to freeze a per-doc customer/recipient name as a fixed_value,
// which then stamped that one name onto every matching doc (template_fixed @95 — "Primrose Childcare"
// / "Aldermoor Engineering"). The go-forward guard stops NEW freezes, but the AUTO-FILE path never
// re-runs `_buildTemplateFields`, so an already-poisoned template keeps auto-filing the wrong recipient
// forever — only this sweep heals it (Oracle C1: mandatory in-slice). LABEL-AWARE (Oracle C2): recover
// each field's label from its own type so an opaque-key field labelled "Customer Name" is caught too.
// Preserves admin locks (fixed_locked=1) and the ISSUER (COMPANY_KEYS). Template DEFINITIONS only —
// never touches filed docs (a future doc re-extracts the recipient → fail toward review, never a stale
// stamp). Idempotent (an unfrozen row is is_variable=1 → not re-selected). Guarded by
// database/modules/test_migration_unfreeze_names.js.
function unfreezeAutoFrozenRecipientNames(db) {
  const { isNameLikeField } = require('./learning');
  const { COMPANY_KEYS }    = require('./document_types');
  const companyKeys = COMPANY_KEYS || ['supplier_name'];
  const rows = db.prepare(`
    SELECT tf.id AS id, tf.field_key AS key, f.label AS label
    FROM template_fields tf
    JOIN templates t ON t.id = tf.template_id
    LEFT JOIN document_types dt ON LOWER(dt.slug) = LOWER(t.document_type_slug)
    LEFT JOIN fields f ON f.document_type_id = dt.id AND f.key = tf.field_key
    WHERE tf.is_variable = 0 AND COALESCE(tf.fixed_locked, 0) = 0
  `).all();
  const upd = db.prepare('UPDATE template_fields SET fixed_value = NULL, is_variable = 1 WHERE id = ?');
  let unfrozen = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (companyKeys.includes(r.key)) continue;                 // keep the issuer frozen
      if (!isNameLikeField(r.key, r.label)) continue;            // keep genuinely-constant non-name fields
      upd.run(r.id); unfrozen++;
    }
  });
  tx();
  return { unfrozen, scanned: rows.length };
}

module.exports = {
  getAll, getAllWithLiveCounts, liveConfirmedCounts, confirmedDocCount, getById, getFields, findByLogoHash, findByKeywordFingerprint, findByBrandingFingerprint, findForSupplierType, identifyByFingerprint,
  getDominantSupplier, establishedIdentity, supplierNamesDisjoint,
  unfreezeAutoFrozenRecipientNames,
  searchByName,
  create, update, enrichIdentity, learnTemplateOnCommit, remove, rename, shouldAdoptIssuerName, hammingDistance,
  stabiliseFingerprint, chooseLogoPhash,
  getMappings, getMapping, saveMapping, setMappingEnabled, deleteMapping,
  recordMappingTest, setSampleDocument, reassignDocuments, mergeInto, setFieldFixedValue,
  getHiddenFields, getHiddenFieldsForSupplierType, reuseByEstablishedName, isFieldHideable, setHiddenField, getTypeFieldsForHiding,
  _normNameForVis,   // exported for the JS↔Python parity pin (vis_norm_vectors.json)
  setOcrAutoParams, setOcrAutoEnabled,
  getLandmarks, setLandmarks, clearLandmarks, hasManualLandmarks, hasCrossSampleLandmarks,
  replaceSampleWords, countSampleDocs, getSampleWordsByDoc,
  getLogoHashes, addLogoHash, getLogoDetailHashes, minLogoDistance, keywordOverlap: _keywordOverlap,
  getAllGroups, createGroup, deleteGroup, setTemplateGroup, getSiblings,
  GRID_COLS, GRID_ROWS,
};
