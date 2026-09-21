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

// An entry is "ready to file" when it has a company/person (the pane's single-file guard) — mirrors doFile.
function isReady(entry) { return !!(entry && entry.values && String(entry.values.party || '').trim()); }

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
const _api = { buildMeta, isReady, withDefaults };
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
if (typeof window !== 'undefined') window.quickfileMeta = _api;
