'use strict';
/*
 * templateMerge.js — M3 cleanup engine for template fragmentation
 * (docs/designs/TEMPLATE_CONVERGENCE_2026-07-17.md).
 *
 * Heals the EXISTING mess left by fragmentation, keyed off the DISTINCTIVE BRANDING fingerprint (the
 * logo is too unstable on scans — see branding_fingerprint.js). Three pieces, matched to their risk:
 *
 *   findMergeCandidates(db)  — READ-ONLY. Clusters of same-supplier same-type DUPLICATE templates, each
 *                              with a suggested canonical and a STRUCTURE verdict, so the admin can merge
 *                              them (destructive) with eyes open. NEVER auto-merges (mergeInto DELETEs the
 *                              source — irreversible). Two genuinely-distinct layouts of one supplier
 *                              (same branding, different anchor geometry) are flagged 'group_or_review',
 *                              NOT 'merge' — Phillip's structure gate.
 *   planBackfill(db)         — READ-ONLY. Confirmed documents with NO template that a same-type branding
 *                              match would LINK (the deferred M1 job, applied retroactively).
 *   applyBackfill(db)        — NON-DESTRUCTIVE. Performs the backfill LINK only (guarded
 *                              `WHERE template_id IS NULL`); never touches a template's identity, so a
 *                              mis-link is a reversible cosmetic link, never template poison (Oracle C1).
 *
 * The destructive MERGE apply is the EXISTING templates.mergeInto, invoked by an admin-confirmed caller
 * AFTER a backup (the UI slice). This module never calls it.
 *
 * Comparators (Oracle, by mutation power): MERGE candidacy uses exact SYMMETRIC Jaccard (no fuzzy — a
 * wrong merge is irreversible); backfill LINK uses the reversible 0.60 bar. Both require same slug +
 * >= DISTINCTIVE_MIN shared distinctive tokens.
 */
const brandingFp = require('./branding_fingerprint');
const templates  = require('./templates');

const SURFACE_JACCARD   = 0.60;   // surface a cluster for admin review
const AUTO_JACCARD      = 0.75;   // strong enough to PRE-SELECT for merge (admin still confirms)
const LINK_RATIO        = 0.60;   // backfill LINK threshold (reversible → the lower bar, Oracle)
const STRUCTURE_POS_TOL = 0.05;   // normalised landmark position agreement window for "same layout"
const STRUCTURE_MIN_SHARED = 3;   // need >= this many shared landmarks to judge structure at all

function _parseJson(s, fb) { try { const v = JSON.parse(s); return v == null ? fb : v; } catch { return fb; } }
const _round2 = n => Math.round((n || 0) * 100) / 100;
const _distinct = fp => brandingFp.distinctiveTokens(fp);

// Exact SYMMETRIC Jaccard on distinctive tokens (the MERGE comparator). |A∩B| / |A∪B|.
function distinctiveJaccard(fpA, fpB) {
  const a = new Set(_distinct(fpA)), b = new Set(_distinct(fpB));
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Structure verdict between two templates by their LANDMARK constellations: 'compatible' (same layout —
// safe to merge), 'divergent' (same branding but the shared landmarks sit in different places → distinct
// layouts → GROUP, don't merge), or 'insufficient' (too few shared landmarks to judge → don't auto-merge).
function structureVerdict(db, aId, bId) {
  const la = templates.getLandmarks(db, aId), lb = templates.getLandmarks(db, bId);
  if (la.length < STRUCTURE_MIN_SHARED || lb.length < STRUCTURE_MIN_SHARED) return 'insufficient';
  const byLabel = new Map();
  for (const l of lb) { const k = String(l.label_text || '').toLowerCase().trim(); if (k) byLabel.set(k, l); }
  let shared = 0, agree = 0;
  for (const l of la) {
    const k = String(l.label_text || '').toLowerCase().trim();
    const m = k && byLabel.get(k);
    if (!m) continue;
    shared++;
    if (Math.abs((l.x_norm || 0) - (m.x_norm || 0)) <= STRUCTURE_POS_TOL &&
        Math.abs((l.y_norm || 0) - (m.y_norm || 0)) <= STRUCTURE_POS_TOL) agree++;
  }
  if (shared < STRUCTURE_MIN_SHARED) return 'insufficient';
  return (agree / shared >= 0.8) ? 'compatible' : 'divergent';
}

// Canonical = the row a cluster should fold INTO: most live confirmed docs → has landmarks → has a
// pinned sample → has field mappings → oldest (lowest id). All display/robustness signals; the merge is
// TARGET-WINS so the canonical must be the richest row.
function _canonicalStats(db, t) {
  return {
    id: t.id,
    live:      templates.confirmedDocCount(db, t.id),
    landmarks: templates.getLandmarks(db, t.id).length,
    sample:    t.sample_document_id ? 1 : 0,
    mappings:  templates.getMappings(db, t.id).length,
  };
}
function _pickCanonical(stats) {
  return stats.slice().sort((a, b) =>
    (b.live - a.live) || (b.landmarks - a.landmarks) || (b.sample - a.sample) ||
    (b.mappings - a.mappings) || (a.id - b.id)
  )[0];
}

// READ-ONLY. Clusters of same-supplier same-type duplicate templates worth reviewing for a merge.
function findMergeCandidates(db, opts = {}) {
  const surface = opts.surface ?? SURFACE_JACCARD;
  const auto    = opts.auto    ?? AUTO_JACCARD;
  const rows = db.prepare(
    "SELECT id, name, document_type_slug, keyword_fingerprint, sample_document_id FROM templates " +
    "WHERE keyword_fingerprint IS NOT NULL AND document_type_slug IS NOT NULL AND TRIM(document_type_slug) <> ''"
  ).all();
  for (const t of rows) t._fp = _parseJson(t.keyword_fingerprint, []);

  // Group by type slug; only templates with a real (>= DISTINCTIVE_MIN) branding identity can be members.
  const bySlug = new Map();
  for (const t of rows) {
    if (_distinct(t._fp).length < brandingFp.DISTINCTIVE_MIN) continue;   // thin identity → never a merge member
    if (!bySlug.has(t.document_type_slug)) bySlug.set(t.document_type_slug, []);
    bySlug.get(t.document_type_slug).push(t);
  }

  const clusters = [];
  for (const [slug, group] of bySlug) {
    if (group.length < 2) continue;
    const claimed = new Set();
    for (const seed of group) {
      if (claimed.has(seed.id)) continue;
      // A cluster = the seed + every same-slug template within `surface` Jaccard of the SEED (seed-based,
      // not single-linkage chaining — precision-first; the admin reviews the rest).
      const members = [seed];
      claimed.add(seed.id);
      for (const other of group) {
        if (claimed.has(other.id)) continue;
        if (distinctiveJaccard(seed._fp, other._fp) >= surface) { members.push(other); claimed.add(other.id); }
      }
      if (members.length < 2) continue;

      const stats  = members.map(m => _canonicalStats(db, m));
      const canon  = _pickCanonical(stats);
      const canonRow = members.find(m => m.id === canon.id);
      const others = members.filter(m => m.id !== canon.id).map(m => ({
        id: m.id, name: m.name,
        jaccard:   _round2(distinctiveJaccard(canonRow._fp, m._fp)),
        structure: structureVerdict(db, canon.id, m.id),
        liveConfirmed: stats.find(s => s.id === m.id).live,
      }));
      // Recommend a destructive MERGE only when EVERY other member is both strongly-branded (>= auto)
      // AND structurally compatible; a divergent/insufficient structure → group_or_review (never merge).
      const structureOk = others.every(o => o.structure === 'compatible');
      const strongAll   = others.every(o => o.jaccard >= auto);
      const action = !structureOk ? 'group_or_review' : (strongAll ? 'merge' : 'review');

      clusters.push({
        slug,
        canonical: { id: canon.id, name: canonRow.name, liveConfirmed: canon.live,
                     landmarks: canon.landmarks, hasSample: !!canon.sample, mappings: canon.mappings },
        members: others,
        suggestedAction: action,
      });
    }
  }
  return clusters;
}

// READ-ONLY. Confirmed documents with NO template that a same-type branding match would LINK.
function planBackfill(db, opts = {}) {
  const threshold = opts.threshold ?? LINK_RATIO;
  const docs = db.prepare(
    "SELECT d.id, d.keyword_fingerprint, dt.slug AS slug FROM documents d " +
    "JOIN document_types dt ON dt.id = d.document_type_id " +
    "WHERE d.status = 'confirmed' AND d.template_id IS NULL AND dt.slug IS NOT NULL AND TRIM(dt.slug) <> ''"
  ).all();
  const plan = [];
  for (const d of docs) {
    const target = templates.findByBrandingFingerprint(db, _parseJson(d.keyword_fingerprint, []), d.slug, threshold);
    if (target) plan.push({ docId: d.id, slug: d.slug, templateId: target.id, templateName: target.name, ratio: _round2(target.match_ratio) });
  }
  return plan;
}

// NON-DESTRUCTIVE. Recompute the plan and LINK each doc, guarded `WHERE template_id IS NULL` (idempotent;
// never overwrites an existing link, never touches a template's identity → a mis-link is reversible).
function applyBackfill(db, opts = {}) {
  const plan = planBackfill(db, opts);
  const stmt = db.prepare('UPDATE documents SET template_id = ? WHERE id = ? AND template_id IS NULL');
  let linked = 0;
  db.transaction(() => { for (const p of plan) linked += stmt.run(p.templateId, p.docId).changes; })();
  return { linked, plan };
}

module.exports = {
  findMergeCandidates, planBackfill, applyBackfill,
  distinctiveJaccard, structureVerdict,
  SURFACE_JACCARD, AUTO_JACCARD, LINK_RATIO,
};
