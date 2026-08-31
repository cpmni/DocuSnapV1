'use strict';

/**
 * modules/search/handler.js
 * Document search across confirmed and uncommitted documents.
 *
 * The query + role-based result shaping live in the transport-agnostic
 * services/searchService.js so the SAME logic backs a future detached LAN client.
 * This handler owns only the Electron/IPC edge: authenticate, derive the caller's
 * role, delegate. Do NOT re-add the shaping rules here — they belong in the service.
 */

const searchService = require('../../services/searchService');

// Q4b (2026-08-22): senders that FILE BY THEMSELVES = scopeReadiness.isReady over every confirmed
// (supplier, type) — ONE getFieldFormats scan shared across scopes, memoised 10 s (Oracle C4b.2).
let _selfFilingMemo = null;   // { at, value }
function _selfFilingSenders(db, opts = {}) {
  if (!opts.noMemo && _selfFilingMemo && (Date.now() - _selfFilingMemo.at) < 10000) return _selfFilingMemo.value;
  const readiness = require('../../../database/modules/scopeReadiness');
  const learning  = require('../../../database/modules/learning');
  const formats = learning.getFieldFormats(db);
  const rows = db.prepare(`SELECT DISTINCT LOWER(TRIM(d.supplier_name)) AS sup, d.supplier_name AS supplier, LOWER(dt.slug) AS slug
                             FROM documents d JOIN document_types dt ON dt.id = d.document_type_id
                            WHERE d.status = 'confirmed' AND d.supplier_name IS NOT NULL AND TRIM(d.supplier_name) <> ''`).all();
  const senders = new Set(); let scopes = 0;
  for (const r of rows) {
    let ok = false;
    try { ok = !!readiness.isReady(db, r.supplier, r.slug, { formats }).ready; } catch { ok = false; }
    if (ok) { scopes++; senders.add(r.sup); }
  }
  const value = { senders: senders.size, scopes };
  _selfFilingMemo = { at: Date.now(), value };
  return value;
}

function register(ctx) {
  const { ipcMain, getDb } = ctx;
  const { requireLogin } = require('../auth/handler');
  const documents = require('../../../database/modules/documents');

  // Real "documents filed" totals (today / this week / this month) for the dashboard
  // pulse — a direct SQL count, so it reflects true volume up to 999+ instead of being
  // capped by the search list. Read-only, login-gated like search.
  ipcMain.handle('get-filed-counts', () => {
    requireLogin();
    return documents.getFiledCounts(getDb());
  });

  // Extra dashboard-card data (auto-file rate, storage, search clients, last backup). Read-only,
  // login-gated. Each block is best-effort so one failure can't blank the rest.
  ipcMain.handle('get-dashboard-extra', () => {
    requireLogin();
    const db = getDb();
    const learning = require('../../../database/modules/learning');
    const out = {};
    // 1) Filed automatically vs by hand, last 7 days (uses confirmed_by_username + the auto sentinel).
    try {
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
      const total = db.prepare("SELECT COUNT(*) c FROM documents WHERE status='confirmed' AND confirmed_at >= ?").get(weekAgo).c;
      // LIKE, not exact: three machine usernames exist — 'Auto-filed (100%)', 'Auto-filed (corroborated)',
      // 'Auto-filed (reprocess)' — the old exact match silently undercounted (Oracle 2026-08-12 Q5).
      // Chris round 18 A7: the scope sweep ("filed themselves") stamps confirmed_via='scope_sweep' under the
      // triggering user's name, so a username-only count said "Nothing has filed by itself in the last 7
      // days" while the Review strip listed 23. Any machine via counts (column-guarded for old fixtures).
      const _hasVia = !!db.prepare("SELECT 1 FROM pragma_table_info('documents') WHERE name='confirmed_via'").get();
      const auto  = db.prepare(`SELECT COUNT(*) c FROM documents WHERE status='confirmed' AND confirmed_at >= ? AND (confirmed_by_username LIKE 'Auto-filed%'${_hasVia ? " OR (confirmed_via IS NOT NULL AND TRIM(confirmed_via) <> '')" : ''})`).get(weekAgo).c;
      out.autoFiled = { auto, total, pct: total ? Math.round((auto / total) * 100) : null };
    } catch { /* leave undefined */ }
    // 2) Storage: output folder, free disk space, total filed documents.
    try {
      const folder = learning.getSetting(db, 'output_folder', null);
      const docs = db.prepare("SELECT COUNT(*) c FROM documents WHERE status='confirmed'").get().c;
      let freeBytes = null;
      try { const st = require('fs').statfsSync(folder || require('os').homedir()); freeBytes = st.bavail * st.bsize; } catch {}
      out.storage = { outputFolder: folder, docs, freeBytes };
    } catch { /* leave undefined */ }
    // 3) Search clients — only meaningful when the detached-client feature is licensed; "in use" =
    //    seats heartbeated in the last ~2 min. Reads client_seats directly (no seat-pool dependency).
    try {
      const ent = require('../../services/entitlementService').checkClientEntitlement(db);
      if (ent && ent.search && ent.search.entitled) {
        let seats = [];
        try { seats = db.prepare('SELECT username, hostname, last_seen FROM client_seats').all(); } catch {}
        const now = Date.now();
        const active = seats.filter(s => s.last_seen && (now - Number(s.last_seen)) < 120000);
        out.clients = { entitled: true, inUse: active.length, cap: ent.search.seats,
                        names: active.map(s => s.username || s.hostname).filter(Boolean).slice(0, 6) };
      } else out.clients = { entitled: false };
    } catch { /* leave undefined */ }
    // 4) Last backup timestamp (stamped by settings-backup-export).
    try { out.lastBackupAt = learning.getSetting(db, 'last_backup_at', null); } catch { /* none */ }
    // 5) Suppliers now AUTO-FILING — distinct suppliers among the GRADUATED (supplier, doc-type)
    //    scopes, i.e. the SAME roster the Settings "Suppliers handled automatically" list shows. The
    //    dashboard's old "learned N suppliers" counted distinct suppliers in a recent CONFIRMED sample,
    //    which diverged from that roster (the reported ambiguity); this is the truthful, roster-
    //    consistent tally of who actually auto-commits.
    try {
      const trust = require('../../../database/modules/trust');
      const scopes = trust.listGraduatedScopes(db) || [];
      const sups = new Set();
      for (const s of scopes) {
        const n = String(s.supplier || s.supplier_name || '').trim().toLowerCase();
        if (n) sups.add(n);
      }
      out.autoFilingSuppliers = { suppliers: sups.size, scopes: scopes.length };
    } catch { /* leave undefined */ }
    // 6) Senders that FILE BY THEMSELVES — THE readiness predicate (scopeReadiness.isReady: role-
    //    complete learned formats ∥ graduated, AND a taught/graduation layout) over every
    //    (supplier, type) with ≥1 confirmed doc; ONE getFieldFormats scan shared across scopes and
    //    memoised 10 s (Oracle C4b.2: hundreds of scopeTrust queries per Home paint otherwise).
    //    Q4b: Home said "No suppliers file automatically yet" (the graduation roster) after 34
    //    documents had filed themselves — the Review badge and this card now ask the same function.
    try { out.selfFilingSenders = _selfFilingSenders(db); } catch { /* leave undefined */ }
    return out;
  });

  ipcMain.handle('search-documents', (_e, params) => {
    // F-01 (multi-point licensing): search is DELIBERATELY left ungated in phase 1.
    // It is read-only (lowest value to a licence bypass — the licensed asset is the
    // extraction/learning WRITE path, gated at confirm-review + template mappings)
    // and carries the highest regression risk (locking a valid-but-just-expired
    // session out of merely VIEWING records). Revisit if search becomes a gated tier.
    //
    // Authentication is transport-specific: the in-process session supplies the
    // role; a detached client would map a token to the same role set instead.
    const { role } = requireLogin();
    return searchService.searchDocuments({ db: getDb(), params, role });
  });
}

module.exports = { register, _selfFilingSenders };
