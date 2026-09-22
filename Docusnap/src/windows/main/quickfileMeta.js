'use strict';
/*
 * src/lib/quickfileMeta.js — pure per-doc meta assembly for the multi-document Quick File pane (Oracle MC2).
 * Each staged entry OWNS its values; buildMeta returns THAT entry's meta — it never reads a shared/mutable
 * focused index, so an in-flight edit can't file doc-B's values onto doc-A (the MC1 silent-wrong-file class).
 * The pane's submit loop calls buildMeta(typeId, entry) closing over each entry object. Requirable + pinned.
 */
function buildMeta(documentTypeId, entry) {
  const v = (entry && entry.values) || {};
  const cf = (v.customFields && typeof v.customFields === 'object') ? v.customFields : {};
  return {
    documentTypeId,
    party: String(v.party || '').trim(),
    date: v.date || '',
    reference: String(v.reference || '').trim(),
    title: String(v.title || '').trim(),
    notes: String(v.notes || '').trim(),
    customFields: cf,
  };
}

// The value the FILING path will key the record folder on, for THIS entry — resolved exactly as
// resolveRecordFolderKey/commitDocument do (F6, Oracle): keyField 'supplier_name'→party, the type's
// date/ref role→date/reference, 'title'→title, else a custom field. `key` = { keyField, dateKey, refKey }.
function resolvedKeyValue(entry, key) {
  const v = (entry && entry.values) || {};
  const kf = key && key.keyField;
  if (!kf || kf === 'supplier_name') return String(v.party || '').trim();
  if (key.dateKey && kf === key.dateKey) return String(v.date || '').trim();
  if (kf === (key.refKey || 'reference_number')) return String(v.reference || '').trim();
  if (kf === 'title') return String(v.title || '').trim();
  const cf = (v.customFields && typeof v.customFields === 'object') ? v.customFields : {};
  return String(cf[kf] || '').trim();
}

// An entry is "ready to file" when the RESOLVED folder key field has a value — so a green dot ⟺ the doc
// files to a real <Type>/<Key>/ folder, amber ⟺ it would land in <Type>/Unfiled/ (F6: the "ready" dot must
// tell the truth about where the doc lands, not light up on an inherited shared default with an empty key).
// Back-compat: no `key` (or keyField 'supplier_name') → the party check, unchanged for supplier-keyed types.
function isReady(entry, key) { return !!resolvedKeyValue(entry, key); }

// A shared "applies to all" default merged UNDER an entry's own values (the entry's own value wins; a blank
// entry field inherits the shared default). Used when the pane applies batch defaults to each doc.
function withDefaults(entry, shared) {
  const s = shared || {}, v = (entry && entry.values) || {};
  const merged = {};
  for (const k of ['party', 'date', 'reference', 'notes']) merged[k] = (String(v[k] || '').trim() || String(s[k] || '').trim());
  merged.title = String(v.title || '').trim();   // title is always per-doc (never inherited)
  const cf = {};
  const sc = (s.customFields && typeof s.customFields === 'object') ? s.customFields : {};
  const vc = (v.customFields && typeof v.customFields === 'object') ? v.customFields : {};
  for (const k in sc) if (String(sc[k] || '').trim()) cf[k] = sc[k];
  for (const k in vc) if (String(vc[k] || '').trim()) cf[k] = vc[k];   // the doc's own value wins
  merged.customFields = cf;
  return { ...(entry || {}), values: merged };
}

// Dual-mode: the node PIN requires it; the Quick File renderer loads it as a <script> (window.quickfileMeta)
// so the pane and the pin share ONE source (MC2 — no drift between the tested mapping and the shipped one).
const _api = { buildMeta, isReady, withDefaults, resolvedKeyValue };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.quickfileMeta = _api;
