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
      const auto  = db.prepare("SELECT COUNT(*) c FROM documents WHERE status='confirmed' AND confirmed_at >= ? AND confirmed_by_username = 'Auto-filed (100%)'").get(weekAgo).c;
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

module.exports = { register };
