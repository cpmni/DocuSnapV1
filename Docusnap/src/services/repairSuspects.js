'use strict';

/**
 * services/repairSuspects.js
 * --------------------------
 * "Worth a look" detectors for the Learning Repair section. PRECISION-FIRST: a false
 * positive (a GOOD doc flagged) is worse than a miss, because a non-technical user must
 * be able to trust the suggestions. Every rule is an AND-gate; thin-evidence gates stop
 * flagging when the learned model is too small to judge. Pure JS, offline, no new deps.
 * Everything is "worth a look" — NEVER auto-acted-on (the caller only ever suggests).
 *
 * Detector A — outlier DOCUMENTS (by perceptual-hash / keyword divergence).
 * Detector B — anomalous VALUES (garbled/unusual field values vs the learned normal).
 *
 * Design from an OCR-expert (oscar) + regex/format (reggie) consult; see the plan file.
 */

const learning = require('../../database/modules/learning');

// ── helpers ───────────────────────────────────────────────────────────────────
// Perceptual-hash Hamming over two 16-hex (64-bit) strings. Returns 64 on any mismatch
// (a trap the caller avoids by PRE-FILTERING to valid 16-hex phashes only).
function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = (parseInt(a[i], 16) ^ parseInt(b[i], 16)) & 0xf;
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}
const isPhash = (h) => typeof h === 'string' && /^[0-9a-fA-F]{16}$/.test(h);

// Format shape signature: digit -> '#', letter -> '@', everything else (separators) literal.
// Mirrors python_backend/extraction/format_anomaly_checker.shape_signature.
function shapeSignature(v) {
  let out = '';
  for (const ch of String(v == null ? '' : v)) {
    if (ch >= '0' && ch <= '9') out += '#';
    else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) out += '@';
    else out += ch;
  }
  return out;
}

function tokenSet(arr) {
  const s = new Set();
  for (const t of (Array.isArray(arr) ? arr : [])) {
    const k = String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (k) s.add(k);
  }
  return s;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Name-like field key (mirrors value_quality.is_name_like_field intent).
function isNameLike(key) {
  const k = String(key || '').toLowerCase();
  return /(^|_)(supplier|customer|company|vendor|client|name|address|payee|remitter)($|_)/.test(k);
}

// ── Detector A: outlier documents ───────────────────────────────────────────────
// rows: [{ id, logo_phash, keyword_fingerprint(array|json string), overall_confidence }]
function detectOutlierDocs(rows) {
  const docs = (rows || []).map(r => ({
    id: r.id, phash: r.logo_phash,
    kw: tokenSet(Array.isArray(r.keyword_fingerprint) ? r.keyword_fingerprint
        : (() => { try { return JSON.parse(r.keyword_fingerprint || '[]'); } catch { return []; } })()),
    conf: r.overall_confidence,
  }));
  const withPhash = docs.filter(d => isPhash(d.phash));
  if (withPhash.length < 8) return [];   // thin-pool gate: don't judge outliers below 8 usable phashes

  // Single-link cluster at Hamming <= 10 (established same-supplier band).
  const parent = withPhash.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { parent[find(a)] = find(b); };
  for (let i = 0; i < withPhash.length; i++)
    for (let j = i + 1; j < withPhash.length; j++)
      if (hammingHex(withPhash[i].phash, withPhash[j].phash) <= 10) union(i, j);

  const clusters = new Map();
  withPhash.forEach((_, i) => { const r = find(i); (clusters.get(r) || clusters.set(r, []).get(r)).push(i); });
  const pool = withPhash.length;
  const legit = [];   // indices belonging to an accepted (legit) cluster
  const clusterOf = [...clusters.values()];
  for (const idxs of clusterOf) {
    if (idxs.length >= 3 || idxs.length / pool >= 0.15) idxs.forEach(i => legit.push(i));
  }
  if (!legit.length) return [];   // no dominant cluster to compare against → don't guess

  const out = [];
  for (const idxs of clusterOf) {
    if (idxs.length > 2 || idxs.length / pool >= 0.15) continue;   // tiny, non-legit clusters only
    for (const i of idxs) {
      const d = withPhash[i];
      let minH = 64;
      for (const j of legit) minH = Math.min(minH, hammingHex(d.phash, withPhash[j].phash));
      if (minH <= 16) continue;   // within drift band → scan noise, not an outlier
      // keyword corroboration: max Jaccard to any legit doc must be low
      let maxJ = 0;
      for (const j of legit) maxJ = Math.max(maxJ, jaccard(d.kw, withPhash[j].kw));
      if (maxJ >= 0.30) continue;
      const isolation = 0.6 * Math.min(1, (minH - 16) / 24) + 0.4 * (1 - maxJ);
      out.push({ id: d.id, isolation, conf: d.conf });
    }
  }
  out.sort((a, b) => (b.isolation - a.isolation) || ((a.conf || 0) - (b.conf || 0)));
  return out.slice(0, 10).map(o => ({ id: o.id, kind: 'belong',
    text: 'This document looks quite different from the others of this type — worth a quick check.' }));
}

// ── Detector B: anomalous field values ───────────────────────────────────────────
// vals: [{ document_id, field_key, value, field_type }] for the scope's confirmed docs.
const STRUCTURED_CLASSES = new Set(['date', 'currency', 'alphanumeric', 'number']);
// The OCR replacement char (U+FFFD) or any C0 control char — a near-certain garble anywhere.
const BAD_CHARS = new RegExp('[' + String.fromCharCode(0xFFFD) + '\\x00-\\x1F]');
function detectAnomalousValues(vals) {
  // Group by field_key.
  const byField = new Map();
  for (const r of (vals || [])) {
    const v = (r.value == null ? '' : String(r.value)).trim();
    if (!v) continue;
    if (!byField.has(r.field_key)) byField.set(r.field_key, { type: r.field_type || null, rows: [] });
    byField.get(r.field_key).rows.push({ doc: r.document_id, value: v });
  }

  const out = [];
  for (const [field, g] of byField) {
    const rows = g.rows;
    const confirmedCount = rows.length;
    if (confirmedCount < 6) continue;   // thin-evidence gate: don't judge a field with < 6 confirmed values
    const valueCounts = new Map();
    for (const r of rows) valueCounts.set(r.value, (valueCounts.get(r.value) || 0) + 1);
    const distinct = valueCounts.size;
    if (distinct < 3) continue;

    const structured = g.type && STRUCTURED_CLASSES.has(g.type) && !isNameLike(field);
    // Dominant shape (structured only).
    let shapeSet = null, dominantShare = 0;
    if (structured) {
      const shapeCounts = new Map();
      for (const r of rows) { const s = shapeSignature(r.value); shapeCounts.set(s, (shapeCounts.get(s) || 0) + 1); }
      // The LEARNED shapes are those seen ≥2× — a lone off-shape singleton is NOT "learned"
      // (so it stays flaggable), while a genuinely-recurring second format is exempt.
      shapeSet = new Set([...shapeCounts].filter(([, c]) => c >= 2).map(([s]) => s));
      dominantShare = Math.max(...shapeCounts.values()) / confirmedCount;
    }
    const nameLike = isNameLike(field) || g.type === 'text' && isNameLike(field);

    for (const r of rows) {
      const singleton = valueCounts.get(r.value) === 1;
      // B3 — disallowed charset (highest precision). Always fire on replacement/control chars;
      // for currency/number fields also fire on letters.
      if (BAD_CHARS.test(r.value)
          || ((g.type === 'currency' || g.type === 'number') && /[A-Za-z]/.test(r.value))) {
        out.push({ id: r.doc, kind: 'data', field,
          text: `The ${field.replace(/_/g, ' ')} “${r.value}” contains characters we don't usually see here — worth a look.`,
          severity: 4 });
        continue;
      }
      // B1 — structured shape miss (single dominant shape ≥80%, off-shape singleton).
      if (structured && dominantShare >= 0.80 && singleton && !shapeSet.has(shapeSignature(r.value))) {
        out.push({ id: r.doc, kind: 'data', field,
          text: `The ${field.replace(/_/g, ' ')} “${r.value}” looks unusual for this type — the others follow a different pattern.`,
          severity: 3 });
        continue;
      }
      // B2 — name-like, low quality (garbled), non-recurring.
      if (nameLike && singleton) {
        const q = learning.nameQuality ? learning.nameQuality(r.value) : 1;
        const multi = r.value.split(/\s+/).filter(Boolean).length >= 2;
        const badSupplier = (field === 'supplier_name' || field === 'customer_name')
          && learning.isPlausibleSupplierName && !learning.isPlausibleSupplierName(r.value);
        if ((q < 0.5 && multi) || badSupplier) {
          out.push({ id: r.doc, kind: 'data', field,
            text: `The ${field.replace(/_/g, ' ')} “${r.value}” doesn't read like the others — you may want to check it.`,
            severity: 2 });
        }
      }
    }
  }
  return out;
}

// ── Public: compute the suspect map for a scope ───────────────────────────────────
function computeSuspects(db, { document_type_slug, supplier_name } = {}) {
  const empty = { byId: {}, count: 0 };
  if (!document_type_slug) return empty;
  const sn = supplier_name || null, dt = document_type_slug;

  const docRows = db.prepare(`
    SELECT d.id, d.logo_phash, d.keyword_fingerprint, d.overall_confidence
    FROM documents d
    WHERE d.status = 'confirmed'
      AND d.document_type_id = (SELECT id FROM document_types WHERE slug = @dt)
      AND (@sn IS NULL OR d.supplier_name = @sn)
  `).all({ dt, sn });

  const valRows = db.prepare(`
    SELECT e.document_id, e.field_key,
           TRIM(COALESCE(c.corrected_value, e.display_value, e.raw_value)) AS value,
           fld.type AS field_type
    FROM extractions e
    JOIN documents d ON d.id = e.document_id
    LEFT JOIN corrections c ON c.document_id = e.document_id AND c.field_key = e.field_key
    LEFT JOIN fields fld ON fld.document_type_id = d.document_type_id AND fld.key = e.field_key
    WHERE d.status = 'confirmed'
      AND d.document_type_id = (SELECT id FROM document_types WHERE slug = @dt)
      AND (@sn IS NULL OR d.supplier_name = @sn)
  `).all({ dt, sn });

  const byId = {};
  const add = (id, reason) => { (byId[id] || (byId[id] = { reasons: [], severity: 0 })).reasons.push(reason); };
  for (const s of detectOutlierDocs(docRows)) { add(s.id, { kind: 'belong', text: s.text }); byId[s.id].severity = Math.max(byId[s.id].severity, 3); }
  for (const s of detectAnomalousValues(valRows)) { add(s.id, { kind: 'data', field: s.field, text: s.text }); byId[s.id].severity = Math.max(byId[s.id].severity, s.severity || 2); }

  return { byId, count: Object.keys(byId).length };
}

module.exports = { computeSuspects, detectOutlierDocs, detectAnomalousValues, shapeSignature, hammingHex, jaccard, isNameLike };
