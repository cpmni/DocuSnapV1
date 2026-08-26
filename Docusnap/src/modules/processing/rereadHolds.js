'use strict';
/*
 * rereadHolds — ONE road for the holds a re-read can write (Chris round 19 N1, Oracle P1 SIGN OFF
 * W/COND, 2026-08-23).
 *
 * The quiet lane held a wrong date on Larkspur ("Read differently after learning — was X, now Y",
 * Use X / Keep Y) and the SAME slip filed four times on Copperfield because the values arrived through
 * the MANUAL "Reprocess N from this sender" road, which had none of the lane's holds. Every hold the
 * lane writes now lives here and both roads call it per merged document:
 *
 *   • S3-C5 changed reads (`holdChangedReads`) — with the Oracle's C1 BASELINE: the value compared is
 *     the existing row's type-valid `corrected_to` (the last independent value) when it carries one,
 *     else its display_value. Equal ⇒ no hold. Different ⇒ the note + `corrected_to = baseline` so
 *     Review's Use/Keep offers the baseline — never a type-invalid `was` (the Copperfield chain would
 *     have offered Use "INV-29273" on a date field).
 *   • first-fills of REQUIRED ROLE fields (`holdFirstFills`) — unconditional with a via-specific note
 *     (layout / ready / single-doc manual), PROVISIONAL on the teach/kw/manual-batch vias under the
 *     reliability hold (held at merge, released at batch end unless the field proved unreliable).
 *   • the witnesses of an unreliable box per (scope, field): S3-C5 disagreements, valued→empty losses,
 *     the engine's taught-box yield notes.
 *
 * A BATCH (`newBatch()`) keys its stats per (supplier|slug|field) so a queue-wide Reprocess never lets
 * one sender's bad box hold another sender's first-fills. `release(db, batch)` runs BEFORE any filing
 * door sees the rows (the lane: before onJobDone; the manual batch: before _currentBatchProcs clears).
 */
const COMPANY_KEYS = new Set((() => { try { return require('../../../database/modules/document_types').COMPANY_KEYS || ['supplier_name']; } catch { return ['supplier_name']; } })());
const RELIABILITY_NOTE = 'The box that reads this field read it differently on another document from this sender — confirm once.';
const NOTES = {
  layout: 'Read from your new box — confirm once.',
  ready: 'Read after learning — confirm once.',
  manual: 'Read again at your request — confirm once.',
  // Learning Repair "start fresh" (Oracle C5, 2026-08-26): a held doc re-read after its sender's
  // learning was forgotten — unconditional first-fill hold, member of the "— confirm once." family
  // so `_ownedTemplateRows`' NOT EXISTS keeps it out of later lane arms.
  repair: 'Read again after a learning repair — confirm once.',
  reliability: RELIABILITY_NOTE,
};
const YIELD_RE = /^Kept the read value .* — (the taught|a taught) /;
const S3C5_RE = /Read differently after learning/;

function _norm(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLowerCase(); }

function _validDate(v) {
  try { return !!require('../../../database/modules/trust').validDate(v); } catch { return false; }
}

function create(deps = {}) {
  const corroborated = deps.corroborated || (() => false);
  const K = Number.isFinite(deps.k) ? Number(deps.k) : 1;

  function _typeInfo(db, docId) {
    const doc = db.prepare('SELECT document_type_id FROM documents WHERE id = ?').get(docId);
    if (!doc || !doc.document_type_id) return null;
    const dt = db.prepare('SELECT ref_field_key, date_field_key FROM document_types WHERE id = ?').get(doc.document_type_id) || {};
    const fields = db.prepare('SELECT key, type, required FROM fields WHERE document_type_id = ? AND enabled = 1').all(doc.document_type_id);
    const types = new Map(fields.map(f => [f.key, String(f.type || '').toLowerCase()]));
    const required = fields.filter(f => f.required).map(f => f.key);
    const roleKeys = new Set(['supplier_name', dt.ref_field_key, dt.date_field_key].filter(Boolean));
    const isDateKey = (k) => k === dt.date_field_key || types.get(k) === 'date';
    return { dt, types, required, roleKeys, isDateKey };
  }
  function _after(db, docId) {
    return Object.fromEntries(db.prepare('SELECT * FROM extractions WHERE document_id = ?').all(docId).map(r => [r.field_key, r]));
  }
  // C1: the value to compare a fresh read against — the last INDEPENDENT value the row carried.
  function _baseline(row, isDate) {
    if (!row) return '';
    const ct = String(row.corrected_to || '').trim();
    if (ct && (!isDate || _validDate(ct))) return ct;
    return String(row.display_value || '').trim();
  }
  function _typeValid(v, isDate) { return !!String(v || '').trim() && (!isDate || _validDate(v)); }

  // S3-C5 (+ C1). Returns [{key, was, now}]; writes the note + corrected_to (only a type-valid baseline,
  // only when the fresh row carries no suggestion of its own).
  function holdChangedReads(db, docId, existing) {
    const ti = _typeInfo(db, docId);
    if (!ti) return [];
    const before = Object.fromEntries((existing || []).map(r => [r.field_key, r]));
    const after = _after(db, docId);
    const upd = db.prepare('UPDATE extractions SET validation_note = ? WHERE document_id = ? AND field_key = ?');
    const updCt = db.prepare("UPDATE extractions SET corrected_to = ? WHERE document_id = ? AND field_key = ? AND (corrected_to IS NULL OR TRIM(corrected_to) = '')");
    const changed = [];
    for (const key of ti.required) {
      const isDate = ti.isDateKey(key);
      const was = _baseline(before[key], isDate);
      const now = after[key] && String(after[key].display_value || '').trim();
      if (!was || !now) continue;                               // a fill (or a loss) is not a changed read
      if (_norm(was) === _norm(now)) continue;
      const note = `Read differently after learning — was '${was}', now '${now}'. Please check which is right.`;
      const prior = String(after[key].validation_note || '').trim();
      // Chris round 20 card 7: a Reprocess that re-reads the SAME value carries the earlier hold
      // (mergeReprocessRows) — never print the same sentence twice.
      if (!prior.includes(note)) upd.run(prior ? `${prior} ${note}` : note, docId, key);
      // Chris round 20 card 2: the one-click "Use <old>" is for dates/references — never for the IDENTITY.
      // An old issuer read ('Ticket Type', 'DOCUMENT OLUTIONS') is a garble the arbiters already replaced;
      // offering it back one click from Confirm filed a worksheet under Ticket-Type6\January with no
      // second-folder warning. The note still names the old value; the human types a real sender if needed.
      if (_typeValid(was, isDate) && !COMPANY_KEYS.has(key)) { try { updCt.run(was, docId, key); } catch { /* pre-corrected_to fixtures */ } }
      changed.push({ key, was, now });
    }
    return changed;
  }

  // First-fills of REQUIRED ROLE fields. `noteText` picks the via; the reliability note never judges the
  // identity field (its own arbiters). Returns the held [{key, now}].
  function holdFirstFills(db, docId, existing, noteText) {
    const ti = _typeInfo(db, docId);
    if (!ti) return [];
    const keys = ti.required.filter(k => ti.roleKeys.has(k)).filter(k => noteText !== RELIABILITY_NOTE || !COMPANY_KEYS.has(k));
    const before = Object.fromEntries((existing || []).map(r => [r.field_key, r]));
    const after = _after(db, docId);
    const upd = db.prepare('UPDATE extractions SET validation_note = ? WHERE document_id = ? AND field_key = ?');
    const held = [];
    for (const key of keys) {
      const was = before[key] && String(before[key].display_value || '').trim();
      const now = after[key] && String(after[key].display_value || '').trim();
      if (was || !now) continue;                                 // not a first-fill
      let ok = false;
      try { ok = !!corroborated(after[key].corroboration); } catch { ok = false; }
      if (ok) continue;                                          // ≥2 page families — the fill stands
      const note = noteText || NOTES.layout;
      const prior = String(after[key].validation_note || '').trim();
      if (!prior.includes(note)) upd.run(prior ? `${prior} ${note}` : note, docId, key);
      held.push({ key, now });
    }
    return held;
  }

  function lostReads(db, docId, existing) {
    const ti = _typeInfo(db, docId);
    if (!ti) return [];
    const before = Object.fromEntries((existing || []).map(r => [r.field_key, r]));
    const after = _after(db, docId);
    const out = [];
    for (const key of ti.roleKeys) {
      const was = before[key] && String(before[key].display_value || '').trim();
      const now = after[key] && String(after[key].display_value || '').trim();
      if (was && !now) out.push({ key, was });
    }
    return out;
  }
  function yieldReads(db, docId) {
    return db.prepare('SELECT field_key, validation_note FROM extractions WHERE document_id = ? AND validation_note IS NOT NULL').all(docId)
      .filter(r => YIELD_RE.test(String(r.validation_note || '').trim()))
      .map(r => ({ key: r.field_key }));
  }

  // ── the batch: witnesses + provisional holds keyed per scope ──────────────────────────────────
  function newBatch() { return { fieldStats: new Map(), provisionalHolds: [], released: [], held: [] }; }
  function _scopeOf(db, docId) {
    const r = db.prepare(`SELECT d.supplier_name, dt.slug FROM documents d LEFT JOIN document_types dt ON dt.id = d.document_type_id WHERE d.id = ?`).get(docId) || {};
    return `${_norm(r.supplier_name)}|${_norm(r.slug)}`;
  }
  // One merged document. `via`: 'layout' | 'ready' | 'manual-single' → unconditional first-fill hold;
  // anything else with `reliability` on → provisional hold + witnesses. Returns { changed, firstFills }.
  function onDocMerged(db, batch, { docId, existing, via, reliability = false, unconditionalNote = null, _changed = null }) {
    const changed = Array.isArray(_changed) ? _changed : holdChangedReads(db, docId, existing);   // a caller that already ran S3-C5 passes it
    let firstFills = [];
    const scope = _scopeOf(db, docId);
    if (via === 'witness-only') {
      // the caller wrote its own unconditional first-fill hold; only the witnesses are wanted here
    } else if (unconditionalNote || via === 'layout' || via === 'ready' || via === 'manual-single') {
      const note = unconditionalNote || (via === 'ready' ? NOTES.ready : via === 'manual-single' ? NOTES.manual : NOTES.layout);
      try { firstFills = holdFirstFills(db, docId, existing, note); } catch { firstFills = []; }
    } else if (reliability) {
      try { firstFills = holdFirstFills(db, docId, existing, RELIABILITY_NOTE); } catch { firstFills = []; }
      for (const h of firstFills) batch.provisionalHolds.push({ docId, key: h.key, now: h.now, scope });
    }
    if (reliability) {
      const bump = (key, kind) => { const sk = `${scope}|${key}`; const st = batch.fieldStats.get(sk) || { unreliable: 0, kinds: [] }; st.unreliable++; st.kinds.push(`${kind}:${docId}`); batch.fieldStats.set(sk, st); };
      for (const c of changed) bump(c.key, 'changed');
      try { for (const l of lostReads(db, docId, existing)) bump(l.key, 'lost'); } catch {}
      try { for (const y of yieldReads(db, docId)) bump(y.key, 'yield'); } catch {}
    }
    return { changed, firstFills };
  }
  // Batch end: release every provisional hold whose (scope, field) stayed reliable; keep the rest.
  function release(db, batch) {
    const sel = db.prepare(`SELECT e.validation_note FROM extractions e JOIN documents d ON d.id = e.document_id
                             WHERE e.document_id = ? AND e.field_key = ? AND d.status = 'needs_review' AND TRIM(COALESCE(e.display_value, '')) = ?`);
    const upd = db.prepare('UPDATE extractions SET validation_note = ? WHERE document_id = ? AND field_key = ?');
    const released = [], held = [];
    for (const h of batch.provisionalHolds) {
      const st = batch.fieldStats.get(`${h.scope}|${h.key}`);
      if ((st ? st.unreliable : 0) >= K) { held.push(h); continue; }
      const row = sel.get(h.docId, h.key, String(h.now || '').trim());
      if (!row) continue;                                                  // confirmed / edited meanwhile
      const cur = String(row.validation_note || '');
      if (!cur.includes(RELIABILITY_NOTE)) continue;
      const next = cur.replace(RELIABILITY_NOTE, '').replace(/\s{2,}/g, ' ').trim();
      upd.run(next || null, h.docId, h.key);
      released.push(h);
    }
    batch.released = released; batch.held = held;
    return { released, held };
  }
  function statsSummary(batch) {
    return [...batch.fieldStats.entries()].map(([k, v]) => `${k.split('|').pop()}:${v.unreliable}`).join(',');
  }

  return { holdChangedReads, holdFirstFills, lostReads, yieldReads, newBatch, onDocMerged, release, statsSummary,
           NOTES, RELIABILITY_NOTE, K };
}

module.exports = { create, NOTES, RELIABILITY_NOTE, S3C5_RE, YIELD_RE };
