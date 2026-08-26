'use strict';

/**
 * services/learningRepairService.js — Learning Repair "START FRESH" for ONE scope (sender × doc type).
 * barry (console) + gary (semantics) → Oracle SIGN-OFF-WITH-CONDITIONS C1–C6, 2026-08-26.
 * DARK: setting `learning_repair_forget` (env LEARNING_REPAIR_FORGET wins both ways).
 *
 * THE PROBLEM. The old "Forget learning for this type" (recoveryService) deleted anchors/hints/rules
 * and left everything that actually TEACHES: the owned layout (template + its frozen sender name +
 * logo hashes + mappings + landmarks) and the LIVE-derived model — getFieldFormats / scopeTrust /
 * getDominantSupplier keep counting the scope's confirmed documents. A "forgotten" sender stayed
 * warm and could still be GRADUATED. The owner's requirement: "if a supplier's learning data is
 * removed for a type, it is re-read in future as a NEW doc."
 *
 * WHAT THIS DOES (one transaction, snapshot first):
 *   1. SNAPSHOT every row it is about to delete + every stamp it is about to write, to
 *      <snapshotDir>/<ts>-<sender>-<type>.json (Undo = a faithful restore, explicit ids — C4).
 *   2. Retract each confirmed document's confirm-planted hints + identifiers ONCE and stamp
 *      documents.learning_retracted_at (C1 idempotence: every later door — send-back, delete —
 *      skips a doc already retracted; a human re-confirm clears the stamp).
 *   3. Delete the scope's supplier_hints / field_anchors / field_rules (exact-match scope, C3 —
 *      never the LIKE-contains browse filter: forgetting "Acme" must not touch "Pacmec").
 *   4. Delete the templates the scope OWNS for this type (frozen sender == scope, or its sample doc
 *      is the scope's) — but REFUSE (C2, fail-closed) any template whose confirmed documents include
 *      ANOTHER sender (the 07-20 intruder class) or whose type differs; the refusal is reported.
 *      Children are enumerated at runtime via PRAGMA foreign_key_list (a hard-coded table list rots).
 *      Template-scoped label overrides (no FK) are deleted explicitly. The <slug>.json dump is
 *      removed as hygiene (C6 — nothing reads it, the matcher gets the fresh getAll dump).
 *   5. Stamp documents.learning_excluded_at on the scope's CONFIRMED documents: filed + searchable,
 *      no longer teaching (the ONE shared predicate, machine_vias.learningExcludedSql).
 *   6. Corrections are KEPT (undo fidelity + getFieldFormats' correction-wins on restore).
 *   7. Drop the scope's graduation opt-out (cosmetic; a cold scope has nothing to opt out of).
 * Logos, identifiers and accepted-issuer values SURVIVE an S×T forget (a sender may have other
 * types — a whole-sender forget is the owner's call). Files on disk are NEVER touched.
 *
 * After the forget the caller schedules the quiet lane with reason 'repair' (C5): the scope's held,
 * now template-less documents are re-read under the unconditional "Read again after a learning
 * repair — confirm once." hold; confirmed documents are never re-read.
 */

const fs = require('fs');
const path = require('path');
const learning = require('../../database/modules/learning');
const templates = require('../../database/modules/templates');
const { learningExcludedSql } = require('../../database/modules/machine_vias');

const SNAPSHOT_VERSION = 1;

function enabled(db) {
  const env = process.env.LEARNING_REPAIR_FORGET;
  if (env === '1') return true;
  if (env === '0') return false;
  try { return learning.getSetting(db, 'learning_repair_forget', 'false') === 'true'; } catch { return false; }
}

const _norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const _safe = (s) => String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'scope';

function _tableExists(db, name) {
  try { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name); } catch { return false; }
}
function _hasColumn(db, table, col) {
  try { return !!db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(col); } catch { return false; }
}

function _typeRow(db, slug) {
  try { return db.prepare('SELECT id, slug, name FROM document_types WHERE LOWER(slug) = ?').get(_norm(slug)) || null; } catch { return null; }
}

/** The scope's CONFIRMED documents — EXACT sender match (C3). */
function _confirmedDocs(db, sup, typeId) {
  const cols = ['id', 'original_filename', 'template_id', 'supplier_name', 'ocr_text', 'confirmed_via'];
  if (_hasColumn(db, 'documents', 'learning_retracted_at')) cols.push('learning_retracted_at');
  if (_hasColumn(db, 'documents', 'learning_excluded_at')) cols.push('learning_excluded_at');
  return db.prepare(`
    SELECT ${cols.map(c => `d.${c}`).join(', ')} FROM documents d
    WHERE d.status = 'confirmed' AND LOWER(TRIM(COALESCE(d.supplier_name, ''))) = ? AND d.document_type_id = ?
    ORDER BY d.id`).all(_norm(sup), typeId);
}

/** Held docs of the scope: template-less (the lane's default population) vs bound to a template the
 *  scope does NOT own (excluded from the lane — reported so the console can say "use Reprocess"). */
function _heldDocs(db, sup, typeId, ownedIds) {
  const rows = db.prepare(`
    SELECT d.id, d.template_id FROM documents d
    WHERE d.status = 'needs_review' AND LOWER(TRIM(COALESCE(d.supplier_name, ''))) = ?
      AND (d.document_type_id = ? OR d.document_type_id IS NULL)`).all(_norm(sup), typeId);
  const owned = new Set(ownedIds || []);
  let reread = 0, elsewhere = 0;
  for (const r of rows) {
    if (!r.template_id || owned.has(r.template_id)) reread++; else elsewhere++;
  }
  return { total: rows.length, reread, elsewhere };
}

/** Templates the scope OWNS for this type (quietLane's ownership rule) + the C2 refusal test. */
function _ownedTemplates(db, sup, slug) {
  if (!_tableExists(db, 'templates')) return { own: [], refused: [] };
  const s = _norm(sup);
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT t.id, t.name, t.document_type_slug FROM templates t
       WHERE (EXISTS (SELECT 1 FROM template_fields tf WHERE tf.template_id = t.id AND tf.field_key = 'supplier_name'
                         AND LOWER(TRIM(COALESCE(tf.fixed_value, ''))) = @s)
           OR EXISTS (SELECT 1 FROM documents sd WHERE sd.id = t.sample_document_id
                         AND LOWER(TRIM(COALESCE(sd.supplier_name, ''))) = @s))`).all({ s });
  } catch {
    try {
      rows = db.prepare(`
        SELECT t.id, t.name, t.document_type_slug FROM templates t
         WHERE EXISTS (SELECT 1 FROM template_fields tf WHERE tf.template_id = t.id AND tf.field_key = 'supplier_name'
                         AND LOWER(TRIM(COALESCE(tf.fixed_value, ''))) = @s)`).all({ s });
    } catch { rows = []; }
  }
  const own = [], refused = [];
  for (const t of rows) {
    const others = db.prepare(`
      SELECT supplier_name AS name, COUNT(*) AS n FROM documents
       WHERE template_id = ? AND status = 'confirmed'
         AND LOWER(TRIM(COALESCE(supplier_name, ''))) NOT IN ('', ?)
       GROUP BY LOWER(TRIM(supplier_name))`).all(t.id, s);
    const typeMismatch = t.document_type_slug && _norm(t.document_type_slug) !== _norm(slug);
    if (others.length || typeMismatch) {
      refused.push({ id: t.id, name: t.name, document_type_slug: t.document_type_slug,
                     reason: typeMismatch ? 'other-type' : 'shared-with-other-sender',
                     otherSuppliers: others.map(o => ({ name: o.name, n: o.n })) });
    } else {
      own.push({ id: t.id, name: t.name, document_type_slug: t.document_type_slug });
    }
  }
  return { own, refused };
}

/** Every table with a foreign key onto `templates` (+ the FK column) — enumerated at runtime (C4). */
function _templateChildTables(db) {
  const out = [];
  try {
    for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name <> 'templates'").all()) {
      let fks = [];
      try { fks = db.prepare(`PRAGMA foreign_key_list('${t.name}')`).all(); } catch { fks = []; }
      for (const fk of fks) if (fk.table === 'templates') out.push({ table: t.name, column: fk.from });
    }
  } catch {}
  return out;
}

function _scopeRows(db, table, sup, slug) {
  if (!_tableExists(db, table)) return [];
  try {
    return db.prepare(`SELECT * FROM ${table} WHERE supplier_name = @sn COLLATE NOCASE AND COALESCE(document_type, '') = @dt`)
      .all({ sn: sup, dt: slug });
  } catch { return []; }
}

function _globalAnchorCount(db, slug) {
  if (!_tableExists(db, 'field_anchors')) return 0;
  try {
    return db.prepare(`SELECT COUNT(*) n FROM field_anchors WHERE (supplier_name IS NULL OR supplier_name IN ('__global__', '__unknown__', ''))
                       AND COALESCE(document_type, '') = ?`).get(slug).n;
  } catch { return 0; }
}

/** The plain-English consequence sentence — computed from the SAME counts the forget will act on. */
function consequenceText(plan) {
  const bits = [];
  const n = (k, s, p) => `${k} ${k === 1 ? s : (p || s + 's')}`;
  const learned = plan.hints + plan.anchors + plan.rules + plan.labelOverrides;
  if (plan.templates.length) bits.push(n(plan.templates.length, 'layout'));
  if (learned) bits.push(`${learned} remembered value${learned === 1 ? '' : 's'} and taught position${learned === 1 ? '' : 's'}`);
  const first = bits.length ? `This forgets ${bits.join(' and ')}.` : 'There is nothing learned to forget for this sender and type.';
  const filed = `${n(plan.docsToStamp, 'filed document')} stay${plan.docsToStamp === 1 ? 's' : ''} where ${plan.docsToStamp === 1 ? 'it is' : 'they are'} and stop${plan.docsToStamp === 1 ? 's' : ''} teaching.`;
  const next = `The next ${plan.typeName || 'document'} from ${plan.supplier} will wait for you to check it, like a new sender.`;
  const extras = [];
  if (plan.templatesRefused.length) extras.push(`${n(plan.templatesRefused.length, 'layout')} shared with another sender ${plan.templatesRefused.length === 1 ? 'is' : 'are'} kept.`);
  if (plan.held.reread) extras.push(`${n(plan.held.reread, 'waiting document')} will be read again.`);
  if (plan.held.elsewhere) extras.push(`${n(plan.held.elsewhere, 'waiting document')} ${plan.held.elsewhere === 1 ? 'is' : 'are'} bound to another sender's layout — use Reprocess for ${plan.held.elsewhere === 1 ? 'it' : 'those'}.`);
  if (plan.logos) extras.push('The sender is still recognised by its logo.');
  if (plan.globalAnchors) extras.push(`${n(plan.globalAnchors, 'shared position')} for this type ${plan.globalAnchors === 1 ? 'is' : 'are'} kept (${plan.globalAnchors === 1 ? 'it belongs' : 'they belong'} to every sender).`);
  return [first, filed, next, ...extras, 'You can undo this.'].join(' ');
}

/** Read-only plan for the console's dry-run. */
function dryRun(db, { supplier_name, document_type_slug } = {}) {
  const sup = String(supplier_name || '').trim(), slug = _norm(document_type_slug);
  if (!sup || !slug) return { ok: false, error: 'A sender and a document type are required.' };
  const dt = _typeRow(db, slug);
  if (!dt) return { ok: false, error: `Unknown document type "${document_type_slug}".` };
  const { own, refused } = _ownedTemplates(db, sup, slug);
  const docs = _confirmedDocs(db, sup, dt.id);
  const alreadyExcluded = docs.filter(d => d.learning_excluded_at).length;
  const plan = {
    ok: true, supplier: sup, document_type_slug: slug, typeName: dt.name,
    hints: _scopeRows(db, 'supplier_hints', sup, slug).length,
    anchors: _scopeRows(db, 'field_anchors', sup, slug).length,
    rules: _scopeRows(db, 'field_rules', sup, slug).length,
    corrections: _scopeRows(db, 'corrections', sup, slug).length,   // KEPT — reported for honesty
    labelOverrides: own.length && _tableExists(db, 'field_label_overrides')
      ? db.prepare(`SELECT COUNT(*) n FROM field_label_overrides WHERE template_id IN (${own.map(() => '?').join(',')})`).get(...own.map(t => t.id)).n : 0,
    templates: own, templatesRefused: refused,
    docsToStamp: docs.length - alreadyExcluded, docsConfirmed: docs.length, alreadyExcluded,
    held: _heldDocs(db, sup, dt.id, own.map(t => t.id)),
    logos: _tableExists(db, 'logo_fingerprints') ? db.prepare('SELECT COUNT(*) n FROM logo_fingerprints WHERE supplier_name = ? COLLATE NOCASE').get(sup).n : 0,
    identifiers: _tableExists(db, 'supplier_identifiers') ? db.prepare('SELECT COUNT(*) n FROM supplier_identifiers WHERE supplier_name = ? COLLATE NOCASE').get(sup).n : 0,
    globalAnchors: _globalAnchorCount(db, slug),
  };
  plan.text = consequenceText(plan);
  return plan;
}

/** Apply the forget. Returns { ok, summary, snapshotPath, plan } or { ok:false, error }. */
function forgetScope(db, actor, { supplier_name, document_type_slug } = {}, opts = {}) {
  if (!enabled(db) && !opts.force) return { ok: false, error: 'Start fresh is turned off (learning_repair_forget).' };
  const plan = dryRun(db, { supplier_name, document_type_slug });
  if (!plan.ok) return plan;
  if (!_hasColumn(db, 'documents', 'learning_excluded_at')) return { ok: false, error: 'This database has not been migrated for start-fresh (mig 90).' };
  const sup = plan.supplier, slug = plan.document_type_slug;
  const dt = _typeRow(db, slug);
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const snapshotDir = opts.snapshotDir || null;
  const childTables = _templateChildTables(db);

  // 1) SNAPSHOT (built inside the transaction so it sees exactly what is deleted; written before commit)
  const snap = { version: SNAPSHOT_VERSION, created_at: stamp, stamp,
                 actor: actor && (actor.username || actor.displayName) || null,
                 scope: { supplier_name: sup, document_type_slug: slug, document_type_id: dt.id },
                 rows: {}, templates: [], labelOverrides: [], docs: [], graduation_optout: null };
  const summary = { hints: 0, anchors: 0, rules: 0, templates: 0, templatesRefused: plan.templatesRefused.length,
                    labelOverrides: 0, docsStamped: 0, docsRetracted: 0, identifiersRetracted: 0 };
  let snapshotPath = null;
  const tx = db.transaction(() => {
    const docs = _confirmedDocs(db, sup, dt.id);
    for (const t of ['supplier_hints', 'field_anchors', 'field_rules']) snap.rows[t] = _scopeRows(db, t, sup, slug);
    // The per-doc retract also DECREMENTS rows outside the scope — the `__global__` hint twins of this
    // type and the sender's identifier rows — so snapshot those too: Undo is then an EXACT row restore
    // (INSERT OR REPLACE by id), never a re-plant on top of restored rows.
    if (_tableExists(db, 'supplier_hints')) {
      try { snap.rows.supplier_hints.push(...db.prepare("SELECT * FROM supplier_hints WHERE supplier_name = '__global__' AND COALESCE(document_type, '') = ?").all(slug)); } catch {}
    }
    if (_tableExists(db, 'supplier_identifiers')) {
      try { snap.rows.supplier_identifiers = db.prepare('SELECT * FROM supplier_identifiers WHERE supplier_name = ? COLLATE NOCASE').all(sup); } catch { snap.rows.supplier_identifiers = []; }
    }
    for (const t of plan.templates) {
      const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(t.id);
      const children = {};
      for (const c of childTables) {
        try { children[c.table] = db.prepare(`SELECT * FROM ${c.table} WHERE ${c.column} = ?`).all(t.id); } catch { children[c.table] = []; }
      }
      const boundDocs = db.prepare('SELECT id FROM documents WHERE template_id = ?').all(t.id).map(r => r.id);
      snap.templates.push({ row, children, boundDocs });
      if (_tableExists(db, 'field_label_overrides')) {
        try { snap.labelOverrides.push(...db.prepare('SELECT * FROM field_label_overrides WHERE template_id = ?').all(t.id)); } catch {}
      }
    }
    snap.docs = docs.map(d => ({ id: d.id, template_id: d.template_id,
                                 learning_retracted_at: d.learning_retracted_at || null,
                                 learning_excluded_at: d.learning_excluded_at || null }));
    try { snap.graduation_optout = learning.getSetting(db, 'graduation_optout', null); } catch {}
    if (snapshotDir) {
      fs.mkdirSync(snapshotDir, { recursive: true });
      snapshotPath = path.join(snapshotDir, `${stamp.replace(/[:]/g, '-')}-${_safe(sup)}-${_safe(slug)}.json`);
      fs.writeFileSync(snapshotPath, JSON.stringify(snap));   // a write failure THROWS → rollback, nothing forgotten
    }

    // 2) scope deletes FIRST (exact scope; corrections KEPT) — counted whole, before the per-doc
    //    retract below can whittle the same rows down one vote at a time.
    const scope = { supplier_name: sup, document_type: slug };
    summary.hints = learning.clearSupplierHintsForScope(db, scope).changes || 0;
    summary.anchors = learning.clearFieldAnchorsForScope(db, scope).changes || 0;
    summary.rules = learning.clearFieldRulesForScope(db, scope).changes || 0;
    // 3) per-document retract, ONCE (C1): takes this sender's votes off the `__global__` twins and its
    //    identifier rows (the scope rows are already gone). Stamped so no later door retracts again.
    const stampRetract = db.prepare("UPDATE documents SET learning_retracted_at = ? WHERE id = ?");
    for (const d of docs) {
      if (d.learning_retracted_at) continue;                   // already retracted by an earlier door
      try { learning.retractConfirmHints(db, d.id); summary.docsRetracted++; } catch {}
      try { const r = learning.retractSupplierIdentifiers(db, d.id); summary.identifiersRetracted += (r && (r.deleted + r.decremented)) || 0; } catch {}
      stampRetract.run(stamp, d.id);
    }
    // 4) owned templates (refused ones untouched)
    for (const t of plan.templates) {
      if (_tableExists(db, 'field_label_overrides')) {
        try { summary.labelOverrides += db.prepare('DELETE FROM field_label_overrides WHERE template_id = ?').run(t.id).changes; } catch {}
      }
      templates.remove(db, t.id);
      summary.templates++;
      if (opts.templatesDir) {
        try { const f = path.join(opts.templatesDir, `${t.slug || ''}.json`); if (t.slug && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
        try { const row = snap.templates.find(x => x.row && x.row.id === t.id); const f = row && row.row.slug ? path.join(opts.templatesDir, `${row.row.slug}.json`) : null;
              if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
      }
    }
    // 5) stamp learning_excluded_at (only where not already stamped)
    summary.docsStamped = db.prepare(`
      UPDATE documents SET learning_excluded_at = ?
       WHERE status = 'confirmed' AND LOWER(TRIM(COALESCE(supplier_name, ''))) = ? AND document_type_id = ?
         AND COALESCE(learning_excluded_at, '') = ''`).run(stamp, _norm(sup), dt.id).changes;   // (a WRITE guard, not the reader filter — that literal lives only in machine_vias)
    // 7) opt-out drop (cosmetic)
    try { require('../../database/modules/trust').setScopeOptOut(db, sup, slug, false); } catch {}
  });
  try { tx(); }
  catch (e) {
    try { if (snapshotPath && fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath); } catch {}
    return { ok: false, error: `Nothing was changed: ${e.message || e}` };
  }
  return { ok: true, summary, snapshotPath, stamp, plan };
}

/** Undo a forget from its snapshot: rows back with their ids, templates + children re-inserted,
 *  documents re-linked ONLY where still unbound, stamps cleared ONLY where they are this forget's,
 *  hints re-planted for the docs this forget retracted. */
function undoForget(db, snapshotPath, opts = {}) {
  let snap;
  try { snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')); } catch (e) { return { ok: false, error: `Cannot read the snapshot: ${e.message}` }; }
  if (!snap || snap.version !== SNAPSHOT_VERSION || !snap.scope) return { ok: false, error: 'Unrecognised snapshot.' };
  const summary = { rows: 0, templates: 0, relinked: 0, unstamped: 0 };
  // Learning rows come back EXACTLY as snapshotted (by id, usage counts included) — the snapshot
  // covers everything the forget deleted OR decremented (scope rows, `__global__` twins, identifier
  // rows), so no re-plant is needed and none must run (a re-plant on top of restored rows would
  // double-count). Templates + children are re-inserted with their original ids (OR IGNORE: a row
  // re-created since the forget keeps its own).
  const upsertRow = (table, row) => {
    const cols = Object.keys(row);
    try { return db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(row).changes; }
    catch { return 0; }
  };
  const insertRow = (table, row) => {
    const cols = Object.keys(row);
    try { return db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(row).changes; }
    catch { return 0; }
  };
  const tx = db.transaction(() => {
    for (const [table, rows] of Object.entries(snap.rows || {})) for (const r of rows) summary.rows += upsertRow(table, r);
    for (const t of (snap.templates || [])) {
      if (!t.row) continue;
      if (insertRow('templates', t.row)) summary.templates++;
      for (const [table, rows] of Object.entries(t.children || {})) for (const r of rows) insertRow(table, r);
      for (const id of (t.boundDocs || [])) {
        summary.relinked += db.prepare('UPDATE documents SET template_id = ? WHERE id = ? AND template_id IS NULL').run(t.row.id, id).changes;
      }
    }
    for (const r of (snap.labelOverrides || [])) insertRow('field_label_overrides', r);
    for (const d of (snap.docs || [])) {
      const cur = db.prepare('SELECT status, learning_retracted_at, learning_excluded_at FROM documents WHERE id = ?').get(d.id);
      if (!cur) continue;
      if (cur.learning_excluded_at === snap.stamp && !d.learning_excluded_at) {
        summary.unstamped += db.prepare('UPDATE documents SET learning_excluded_at = NULL WHERE id = ?').run(d.id).changes;
      }
      if (cur.learning_retracted_at === snap.stamp && !d.learning_retracted_at) {
        db.prepare('UPDATE documents SET learning_retracted_at = NULL WHERE id = ?').run(d.id);
      }
    }
    if (snap.graduation_optout != null) { try { learning.setSetting(db, 'graduation_optout', snap.graduation_optout); } catch {} }
  });
  try { tx(); } catch (e) { return { ok: false, error: `Nothing was restored: ${e.message || e}` }; }
  if (opts.deleteSnapshot !== false) { try { fs.unlinkSync(snapshotPath); } catch {} }
  return { ok: true, summary, scope: snap.scope };
}

function listSnapshots(snapshotDir, { limit = 20 } = {}) {
  try {
    return fs.readdirSync(snapshotDir).filter(f => f.endsWith('.json')).sort().reverse().slice(0, limit).map(f => {
      const p = path.join(snapshotDir, f);
      let meta = null;
      try { const s = JSON.parse(fs.readFileSync(p, 'utf8')); meta = { created_at: s.created_at, scope: s.scope, templates: (s.templates || []).length, docs: (s.docs || []).length }; } catch {}
      return { path: p, file: f, ...meta };
    });
  } catch { return []; }
}

module.exports = { enabled, dryRun, forgetScope, undoForget, listSnapshots, consequenceText,
                   _ownedTemplates, _templateChildTables, learningExcludedSql };
