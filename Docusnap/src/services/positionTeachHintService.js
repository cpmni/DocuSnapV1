'use strict';
/*
 * positionTeachHintService.js — Card 1 (Chris R5): the "draw a box to teach the next one" nudge.
 *
 * THE FRICTION. A sender whose fields sit in a TABLE (Pelican) reads blank. The operator TYPES the
 * values and files — but typing teaches the VALUE (a correction/hint), never the POSITION. Only a
 * drawn ⊕ box (a field_anchor or a Stage-0.5 template mapping) teaches WHERE a field sits, so the
 * NEXT 40 documents from that sender read blank again. This service, after such a confirm, returns a
 * one-time nudge to DRAW a box. It NEVER synthesises a position from a typed value — that is the
 * standing 2026-08-10 WRONG-LAYER ruling ("a box is evidence about WHERE, never WHETHER").
 *
 * FIRE iff (all): a human single confirm (the caller gates !_via && !bulk); a filing-relevant field
 * was typed FROM SCRATCH (empty -> value); it is NOT the identity field (issuer is resolved by
 * letterhead/logo, not a box — this also de-dups with Card 4); a ⊕ box was NOT drawn for it this
 * confirm; the (supplier,type) scope has NO learned position for it — no field_anchor AND no template
 * mapping / fixed_value on a template the scope actually uses (resolved by TEMPLATE ID, not a supplier
 * string — the dead-guard trap Oracle named); and the scope has not already been nudged.
 *
 * DARK: env POSITION_TEACH_NUDGE (1/0 wins) / setting position_teach_nudge (default 'false').
 * Presentation-only + fail-open: returns { supplier, fields:[{key,label}] } (value-blind) or null.
 * The only write is the once-per-scope "seen" marker so the nudge shows ONCE per (supplier,type).
 */

const IDENTITY_KEYS = new Set(['supplier_name', 'customer_name']);
const SEEN_SETTING = 'position_teach_nudge_seen';

function _enabled(db, learning) {
  const env = process.env.POSITION_TEACH_NUDGE;
  if (env === '1') return true;
  if (env === '0') return false;
  try { return learning.getSetting(db, 'position_teach_nudge', 'false') === 'true'; } catch { return false; }
}
function _norm(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }

function applyForConfirm(db, opts) {
  opts = opts || {};
  const { documentId, corrections, supplierName, typeSlug, dtInfo, templateId, learning, audit, logger } = opts;
  try {
    if (!_enabled(db, learning)) return null;
    const supplier = String(supplierName || '').trim();
    const slug = String(typeSlug || (dtInfo && dtInfo.slug) || '').trim().toLowerCase();
    if (!supplier || !slug || !dtInfo) return null;

    // 1) filing-relevant fields typed FROM SCRATCH (empty -> value); exclude identity + drawn fields.
    const drawn = new Set((Array.isArray(opts.taughtFields) ? opts.taughtFields : []).map(String));
    const roleKeys = new Set([dtInfo.ref_field_key, dtInfo.date_field_key].filter(Boolean));
    const typeFieldKeys = new Set((Array.isArray(dtInfo.fields) ? dtInfo.fields : []).map(f => f.key));
    const cand = [];
    for (const [key, c] of Object.entries(corrections || {})) {
      if (!c || IDENTITY_KEYS.has(key) || drawn.has(key)) continue;
      const wasEmpty = !String(c.original_value == null ? '' : c.original_value).trim();
      const nowVal   =  String(c.corrected_value == null ? '' : c.corrected_value).trim();
      if (!wasEmpty || !nowVal) continue;                          // only empty -> value (the "read nothing" win)
      if (!(roleKeys.has(key) || typeFieldKeys.has(key))) continue;   // filing-relevant only
      cand.push(key);
    }
    if (!cand.length) return null;

    // 2) drop any candidate that ALREADY has a learned POSITION for the scope. Anchors are supplier-
    //    scoped; template mappings / fixed_value are keyed by TEMPLATE ID, so resolve the template(s)
    //    the scope actually uses (the doc's own template + the name/branding match) and query THOSE —
    //    querying by a supplier string would never find a real mapping (false-nudge every wizard-taught
    //    scope) or always miss (a dead guard). Positive control pinned in the test.
    const templates = require('../../database/modules/templates');
    const anchored = new Set((learning.getTaughtFieldKeys(db, { supplier_name: supplier, document_type: slug }) || []).map(r => r.field_key));
    const tplIds = new Set();
    if (templateId) tplIds.add(Number(templateId));
    try { const tid = templates.findForSupplierType(db, { supplier_name: supplier, document_type_slug: slug }); if (tid) tplIds.add(Number(tid)); } catch { /* fail toward nudging */ }
    const hasPosition = (key) => {
      if (anchored.has(key)) return true;
      for (const tid of tplIds) {
        try { const m = templates.getMapping(db, tid, key); if (m && (m.enabled == null || m.enabled)) return true; } catch { /* ignore */ }
        try { const f = (templates.getFields(db, tid) || []).find(x => x.field_key === key); if (f && String(f.fixed_value == null ? '' : f.fixed_value).trim()) return true; } catch { /* ignore */ }
      }
      return false;
    };
    const need = cand.filter(k => !hasPosition(k));
    if (!need.length) return null;

    // 3) once per (supplier,type) — the seen-set, keyed on the normalized supplier|slug.
    const seenKey = `${_norm(supplier)}|${slug}`;
    let seen = {};
    try { seen = JSON.parse(learning.getSetting(db, SEEN_SETTING, '{}') || '{}') || {}; } catch { seen = {}; }
    if (seen[seenKey]) return null;
    seen[seenKey] = 1;
    try { learning.setSetting(db, SEEN_SETTING, JSON.stringify(seen)); } catch { /* best-effort */ }

    const labelOf = (k) => {
      const f = (Array.isArray(dtInfo.fields) ? dtInfo.fields : []).find(x => x.key === k);
      return (f && f.label) || k.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
    };
    const fields = need.map(k => ({ key: k, label: labelOf(k) }));   // value-blind: no value, no confidence
    try {
      audit && audit(db, { action: 'position_teach_nudge', target_type: 'scope', target_id: documentId, document_id: documentId,
        outcome: 'success', metadata: { supplier, type_slug: slug, fields: need.join(',') } });
    } catch { /* advisory */ }
    return { supplier, fields };
  } catch (e) {
    try { logger && logger.warn && logger.warn('position-teach nudge skipped: ' + (e && e.message)); } catch { /* ignore */ }
    return null;
  }
}

module.exports = { applyForConfirm };
