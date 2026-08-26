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
// Learning Repair start-fresh predicate (mig 90): a stamped document neither shapes the "learned normal"
// nor is judged against it ('' until stamped; test_learning_excluded_readers.js). The browse list itself
// (documents.getConfirmedDocsForScope) still shows it — only the badges go quiet.
const { learningExcludedSql } = require('../../database/modules/machine_vias');

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

// Reference/code-like field key (mirrors engine._is_ref_field): a structured code even when
// the field is typed plain "text" (the built-in ref fields are — migration 3), so shape
// checks must still apply. Covers invoice_number, po_number, sales_order_number, ticket_no,
// serial_number, *_ref, reference.
function isRefLike(key) {
  const k = String(key || '').toLowerCase();
  return /_(no|number|ref)$/.test(k) || /(^|_)reference($|_)/.test(k);
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
// Magnitude-invariant money format: optional sign/currency mark, digits with optional 3-digit
// thousands groups, decimals exactly two when present. '479.04', '1,357.92', '10603.44', '£45'
// all pass; '2.205.60' (double-dot OCR garble) fails. See B1-currency below.
const MONEY_VALID = /^-?\s?[£$€]?\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?$/;
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

    // A ref/code key (invoice_number, po_number, reference, …) is structured even when the
    // field is typed plain "text" (the built-in ref fields are) — mirror engine._is_ref_field.
    const structured = ((g.type && STRUCTURED_CLASSES.has(g.type)) || isRefLike(field)) && !isNameLike(field);
    // Dominant shape (structured only) + an EXAMPLE value that follows it (the "usual" look).
    let shapeSet = null, dominantShare = 0, dominantExample = null;
    if (structured) {
      const shapeCounts = new Map();
      for (const r of rows) { const s = shapeSignature(r.value); shapeCounts.set(s, (shapeCounts.get(s) || 0) + 1); }
      // The LEARNED shapes are those seen ≥2× — a lone off-shape singleton is NOT "learned"
      // (so it stays flaggable), while a genuinely-recurring second format is exempt.
      shapeSet = new Set([...shapeCounts].filter(([, c]) => c >= 2).map(([s]) => s));
      dominantShare = Math.max(...shapeCounts.values()) / confirmedCount;
      let best = null, bestC = 0;
      for (const [s, c] of shapeCounts) if (c > bestC) { bestC = c; best = s; }
      dominantExample = (rows.find(r => shapeSignature(r.value) === best) || {}).value || null;
    }
    const nameLike = isNameLike(field) || g.type === 'text' && isNameLike(field);

    for (const r of rows) {
      const singleton = valueCounts.get(r.value) === 1;
      // B3 — disallowed charset (highest precision). Always fire on replacement/control chars;
      // for currency/number fields also fire on letters.
      if (BAD_CHARS.test(r.value)
          || ((g.type === 'currency' || g.type === 'number') && /[A-Za-z]/.test(r.value))) {
        out.push({ id: r.doc, kind: 'data', field, value: r.value,
          text: `The ${field.replace(/_/g, ' ')} “${r.value}” contains characters we don't usually see here — worth a look.`,
          severity: 4 });
        continue;
      }
      // B1-currency (owner ruling 2026-08-12): a money field has NO magnitude prior — 479.04 and
      // 1,357.92 are both correct on their own documents, and the thousands comma made magnitude
      // part of the SHAPE, so any mixed-magnitude scope flagged its own smaller totals ("looks
      // unusual — the others usually look like '1,357.92'"). Replace the shape comparison with a
      // magnitude-invariant FORMAT check. The true-positive class survives: '2.205.60' (the
      // Nordwind double-dot garble) fails the format and still flags; B3 above keeps the
      // letters/control-chars arm. Money is NEVER shape-compared — `continue` skips B1/B2.
      if (g.type === 'currency') {
        if (singleton && !MONEY_VALID.test(r.value)) {
          out.push({ id: r.doc, kind: 'data', field, value: r.value,
            text: `The ${field.replace(/_/g, ' ')} “${r.value}” doesn't read like an amount — worth a look.`,
            severity: 3 });
        }
        continue;
      }
      // B1 — structured shape miss (single dominant shape ≥80%, off-shape singleton).
      if (structured && dominantShare >= 0.80 && singleton && !shapeSet.has(shapeSignature(r.value))) {
        out.push({ id: r.doc, kind: 'data', field, value: r.value, example: dominantExample,
          text: `The ${field.replace(/_/g, ' ')} “${r.value}” looks unusual for this type${dominantExample ? ` — the others usually look like “${dominantExample}”` : ' — the others follow a different pattern'}.`,
          severity: 3 });
        continue;
      }
      // B2 — name-like, low quality (garbled), non-recurring.
      if (nameLike && singleton) {
        const q = learning.nameQuality ? learning.nameQuality(r.value) : 1;
        const multi = r.value.split(/\s+/).filter(Boolean).length >= 2;
        const badSupplier = (field === 'supplier_name' || field === 'customer_name')
          && learning.isPlausibleSupplierNameBase && !learning.isPlausibleSupplierNameBase(r.value);
        if ((q < 0.5 && multi) || badSupplier) {
          out.push({ id: r.doc, kind: 'data', field, value: r.value,
            text: `The ${field.replace(/_/g, ' ')} “${r.value}” doesn't read like the others — you may want to check it.`,
            severity: 2 });
        }
      }
    }
  }
  return out;
}

// ── Outlier field explanations ────────────────────────────────────────────────────
// For a doc already flagged as a whole-document outlier ("might not belong"), point at
// WHICH field values look off and why — comparing each of the outlier's values to the
// type-wide norm. Emits kind:'data' + field reasons, so the Learning Repair fields panel
// renders an inline amber note under the offending field with no extra UI work.
// vals: the FULL-type-pool value rows (same shape as detectAnomalousValues' input).
function explainOutlierFields(vals, outlierIds) {
  const idset = new Set((outlierIds || []).map(Number));
  if (!idset.size) return [];
  const byField = new Map();
  for (const r of (vals || [])) {
    const v = (r.value == null ? '' : String(r.value)).trim();
    if (!v) continue;
    if (!byField.has(r.field_key)) byField.set(r.field_key, { type: r.field_type || null, rows: [] });
    byField.get(r.field_key).rows.push({ doc: r.document_id, value: v });
  }
  const out = [];
  for (const [field, g] of byField) {
    const total = g.rows.length;
    if (total < 4) continue;   // need a little evidence before calling one shape "usual"
    const label = field.replace(/_/g, ' ');
    const structured = ((g.type && STRUCTURED_CLASSES.has(g.type)) || isRefLike(field)) && !isNameLike(field);
    // Dominant shape + an example value that follows it (structured fields only).
    let dominantShape = null, dominantShare = 0, example = null;
    if (structured) {
      const shapeCounts = new Map();
      for (const r of g.rows) { const s = shapeSignature(r.value); shapeCounts.set(s, (shapeCounts.get(s) || 0) + 1); }
      let bestC = 0;
      for (const [s, c] of shapeCounts) if (c > bestC) { bestC = c; dominantShape = s; }
      dominantShare = bestC / total;
      example = (g.rows.find(r => shapeSignature(r.value) === dominantShape) || {}).value || null;
    }
    for (const r of g.rows) {
      if (!idset.has(Number(r.doc))) continue;
      // B1-currency parity (owner ruling 2026-08-12, see detectAnomalousValues): money is never
      // shape-compared — magnitude drives the thousands comma, and any amount is correct on its
      // own doc. Only a value that fails the money FORMAT is worth explaining.
      if (g.type === 'currency') {
        if (!MONEY_VALID.test(r.value)) {
          out.push({ id: r.doc, kind: 'data', field, value: r.value,
            text: `The ${label} “${r.value}” doesn’t read like an amount — this is part of why it looks out of place.` });
        }
        continue;
      }
      if (structured && dominantShare >= 0.6 && shapeSignature(r.value) !== dominantShape) {
        out.push({ id: r.doc, kind: 'data', field, value: r.value, example,
          text: `The ${label} “${r.value}” doesn’t match this type’s usual format${example ? ` of “${example}”` : ''} — this is part of why it looks out of place.` });
      } else if (isNameLike(field)) {
        const q = learning.nameQuality ? learning.nameQuality(r.value) : 1;
        if (q < 0.5 && r.value.split(/\s+/).filter(Boolean).length >= 2) {
          out.push({ id: r.doc, kind: 'data', field, value: r.value,
            text: `The ${label} “${r.value}” doesn’t read like a typical name for this type.` });
        }
      }
    }
  }
  return out;
}

// ── Detector B4: reference-PREFIX outlier (a wrong-document-type misfile) ──────────
// shapeSignature() folds EVERY letter to '@', so "PO-21275" and "DN-70795" both reduce to
// "@@-#####" — a purchase order filed as a delivery note keeps the SAME shape, so B1 and
// explainOutlierFields (shape-only) are STRUCTURALLY blind to it; no threshold tuning on
// shapes can ever surface it. This learns the dominant LITERAL alpha prefix per (type, field)
// — the document-type signature (DN/PO/SO/INV) — and flags a lone value whose prefix
// disagrees. Precision-first; every gate is AND-ed:
//   1. >= PREFIX_MIN_POOL confirmed values (a dominance judgement needs more evidence than a
//      shape one — matched to the phash-pool gate, not B1's lower 6).
//   2. structured / ref-like field, not name-like (the SAME class B1 uses, no new classifier).
//   3. prefixes are the NORM: >= PREFIX_NORM_FRAC of values carry an alpha prefix — otherwise a
//      "dominant prefix" is meaningless (e.g. a mostly-bare-number field, or the live
//      service_worksheet/reference_number where only 29% are prefixed → this field self-skips).
//   4. ONE prefix dominates: seen >= PREFIX_DOM_MIN times AND >= PREFIX_DOM_SHARE of the
//      PREFIXED values. (Two DIFFERENT denominators on purpose: gate 3 asks "are prefixes the
//      norm?" over ALL rows; gate 4 asks "is there a single dominant prefix?" over the prefixed
//      ones. A future maintainer must not collapse them.)
// Then flag each value whose prefix != dominant AND is a SINGLETON — a prefix used by >=2 docs
// is treated as a learned rare-but-real format and left alone (mirrors B1's ">=2 shape recurs =
// learned" exemption). PRECISION: zero-FP on the observed 185-doc corpus, but this is precision-
// FIRST, not zero-FP on the class — it fails toward review. ACCEPTED RESIDUALS (Oracle-noted):
//   • a legitimately-rare MINORITY-SUPPLIER prefix (one doc of a real GDN-/DEL- supplier in a
//     DN-dominated pool) is a genuine false positive — acceptable: suggestion-only, self-
//     correcting on inspection, and "may be filed under the wrong type" already hedges. Catching
//     it correctly needs a supplier-COHESION check (do the odd-prefix docs cluster on identity?),
//     a separate build, NOT a looser threshold.
//   • 2+ IDENTICAL wrong-prefix misfiles are missed (they stop being singletons) — same cohesion
//     build would recover them.
//   • a code field whose KEY looks name-like (customer_order_number, company_reg_no) is excluded
//     by gate 2 (isNameLike), so a misfile there is invisible — a MISS not a false-flag, inherited
//     verbatim from B1; the motivating field delivery_number is unaffected.
// Runs on the FULL type pool — a misfile is by definition a different
// supplier, so a supplier browse filter must not scope it away (same rule as the outlier
// detectors; see the computeSuspects comment).
// ⚠ MIRROR NOTE: python_backend/extraction/format_anomaly_checker.shape_signature is prefix-
// blind too, but it runs at EXTRACTION time on confidence/veto/auto-file. Do NOT port these
// gates there verbatim — at extraction a genuinely-new supplier with a legitimately different
// prefix would be FALSE-HELD against thin learned history (a fail-toward-review violation at the
// wrong moment). A Python-side prefix rule needs new-supplier-safe calibration; logged to the
// backlog. shapeSignature itself stays byte-identical to its Python twin (this rule adds an
// orthogonal signal alongside it, never changes it).
const PREFIX_MISMATCH_ENABLED = process.env.REPAIR_PREFIX_MISMATCH !== '0';   // kill switch (default ON)
const PREFIX_MIN_POOL  = 8;      // gate 1
const PREFIX_NORM_FRAC = 0.80;   // gate 3
const PREFIX_DOM_MIN   = 5;      // gate 4a
const PREFIX_DOM_SHARE = 0.85;   // gate 4b
// Leading run of >=2 ASCII letters, uppercased; null if none. >=2 is load-bearing: >=3 would
// never fire (DN/PO/SO are two letters); >=1 manufactures singletons from any stray leading
// letter. Strict — no leading-punctuation tolerance (a systematically-symbol-prefixed field
// returns null throughout and disables via gate 3, a safe fail-toward-silence).
function alphaPrefix(v) {
  const m = /^\s*([A-Za-z]{2,})/.exec(String(v == null ? '' : v));
  return m ? m[1].toUpperCase() : null;
}
function detectRefPrefixOutliers(vals) {
  if (!PREFIX_MISMATCH_ENABLED) return [];
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
    if (rows.length < PREFIX_MIN_POOL) continue;                                            // gate 1
    const structured = ((g.type && STRUCTURED_CLASSES.has(g.type)) || isRefLike(field)) && !isNameLike(field);
    if (!structured) continue;                                                              // gate 2
    const prefixed = [];
    for (const r of rows) { const p = alphaPrefix(r.value); if (p) prefixed.push({ doc: r.doc, value: r.value, pfx: p }); }
    if (prefixed.length / rows.length < PREFIX_NORM_FRAC) continue;                         // gate 3
    const counts = new Map();
    for (const r of prefixed) counts.set(r.pfx, (counts.get(r.pfx) || 0) + 1);
    let dominant = null, domCount = 0;
    for (const [p, c] of counts) if (c > domCount) { domCount = c; dominant = p; }
    if (domCount < PREFIX_DOM_MIN) continue;                                                // gate 4a
    if (domCount / prefixed.length < PREFIX_DOM_SHARE) continue;                            // gate 4b
    const label = field.replace(/_/g, ' ');
    for (const r of prefixed) {
      if (r.pfx === dominant) continue;
      if (counts.get(r.pfx) !== 1) continue;                                               // singleton only
      out.push({ id: r.doc, kind: 'data', field, value: r.value, example: dominant, severity: 3,
        text: `The ${label} “${r.value}” starts with “${r.pfx}”, but every other ${label} here starts with “${dominant}” — this document may be filed under the wrong type.` });
    }
  }
  return out;
}

// ── Public: compute the suspect map for a scope ───────────────────────────────────
function computeSuspects(db, { document_type_slug, supplier_name } = {}) {
  const empty = { byId: {}, count: 0 };
  if (!document_type_slug) return empty;
  const dt = document_type_slug;
  // "Might not belong" is a WHOLE-TYPE judgement: an outlier is BY DEFINITION a different
  // supplier from the norm, so a supplier "search" must NOT scope it away (that was the
  // "outliers don't show up when I search" bug). Detector A + the outlier field-explanations
  // run on the FULL type pool; Detector B (per-value anomalies) stays scoped to any supplier
  // filter, preserving its per-supplier format precision.
  const sn = (supplier_name && String(supplier_name).trim()) ? String(supplier_name).trim() : null;

  const docRows = db.prepare(`
    SELECT d.id, d.logo_phash, d.keyword_fingerprint, d.overall_confidence
    FROM documents d
    WHERE d.status = 'confirmed'${learningExcludedSql(db)}
      AND d.document_type_id = (SELECT id FROM document_types WHERE slug = @dt)
  `).all({ dt });

  const valSelect = (scoped) => db.prepare(`
    SELECT e.document_id, e.field_key,
           TRIM(COALESCE(c.corrected_value, e.display_value, e.raw_value)) AS value,
           fld.type AS field_type
    FROM extractions e
    JOIN documents d ON d.id = e.document_id
    LEFT JOIN corrections c ON c.document_id = e.document_id AND c.field_key = e.field_key
    LEFT JOIN fields fld ON fld.document_type_id = d.document_type_id AND fld.key = e.field_key
    WHERE d.status = 'confirmed'${learningExcludedSql(db)}
      AND d.document_type_id = (SELECT id FROM document_types WHERE slug = @dt)
      ${scoped ? "AND (@sn IS NULL OR d.supplier_name LIKE '%' || @sn || '%')" : ''}
  `).all(scoped ? { dt, sn } : { dt });

  const valRowsFull   = valSelect(false);
  const valRowsScoped = sn ? valSelect(true) : valRowsFull;

  const byId = {};
  const add = (id, reason, sev) => {
    const b = byId[id] || (byId[id] = { reasons: [], severity: 0 });
    if (reason.field && b.reasons.some(r => r.field === reason.field)) return;   // one reason per field
    b.reasons.push(reason);
    b.severity = Math.max(b.severity, sev || 0);
  };

  const outliers = detectOutlierDocs(docRows);
  for (const s of outliers) add(s.id, { kind: 'belong', text: s.text }, 3);
  for (const s of detectAnomalousValues(valRowsScoped)) add(s.id, { kind: 'data', field: s.field, value: s.value, example: s.example || null, text: s.text }, s.severity || 2);
  for (const s of explainOutlierFields(valRowsFull, outliers.map(o => o.id))) add(s.id, { kind: 'data', field: s.field, value: s.value, example: s.example || null, text: s.text }, 2);
  // B4 — ref-PREFIX outlier (a wrong-type misfile that keeps the same shape; see the function).
  // On the FULL pool (a misfile is a different supplier — must not be scoped away). Added LAST so
  // a higher-precision existing reason keeps the field slot via the one-reason-per-field dedupe.
  for (const s of detectRefPrefixOutliers(valRowsFull)) add(s.id, { kind: 'data', field: s.field, value: s.value, example: s.example || null, text: s.text }, s.severity || 3);

  return { byId, count: Object.keys(byId).length };
}

module.exports = { computeSuspects, detectOutlierDocs, detectAnomalousValues, explainOutlierFields, detectRefPrefixOutliers, alphaPrefix, shapeSignature, hammingHex, jaccard, isNameLike, isRefLike };
