'use strict';

/**
 * database/modules/audit_archive.js — desktop audit-log retention (Stage A).
 * ---------------------------------------------------------------------------
 * Keeps the live `audit_log` in docusnap.db bounded by MOVING rows older than a
 * retention window into monthly SQLite archive files, so nothing is ever
 * deleted-without-archive. Best-effort: every public entry point is fully guarded
 * and NEVER throws into its caller (the startup hook must never block app launch).
 *
 * Archive files:  <archiveDir>/audit-YYYY-MM.sqlite, one row-compatible `audit_log`
 *                 table per month (schema derived from the live table; live `id`
 *                 preserved as PRIMARY KEY so re-archiving is idempotent).
 * Move semantics: COPY-THEN-DELETE. Rows are committed into the archive file FIRST;
 *                 only then are they deleted from live. A crash between the two
 *                 re-archives idempotently (INSERT OR IGNORE) on the next run — so
 *                 no row can be lost, at worst a transient duplicate resolved next run.
 * Retention:      settings `audit_retention_days` (default 180; 0 disables).
 * Throttle:       at most once/day via settings `audit_archive_last_run` (stamped
 *                 when a run is claimed, so a persistent failure can't hammer startup).
 * Reclaim:        a one-off VACUUM of the live DB ONLY after a large cleanup
 *                 (>= vacuumThreshold rows in a single run) — never on routine runs.
 *
 * NOTE (Stage A): archived rows are preserved + searchable on disk but are NOT yet
 * surfaced in the admin Audit search — archive-aware merged search is Stage B.
 *
 * No category dropping: security/compliance events are archived like everything else.
 */

const fs   = require('fs');
const path = require('path');
const { getSetting, setSetting } = require('./learning');

const RETENTION_KEY  = 'audit_retention_days';
const LAST_RUN_KEY   = 'audit_archive_last_run';
const DEFAULT_RETENTION_DAYS = 180;
const THROTTLE_MS    = 20 * 60 * 60 * 1000;   // ~once/day (20h, so a normal daily launch is never skipped by drift)
const VACUUM_ROWS_THRESHOLD = 10000;          // reclaim only after a big one-off cleanup

// datetime('now') stores 'YYYY-MM-DD HH:MM:SS' (UTC). Produce a matching, lexically
// comparable cutoff string for the same column.
function cutoffString(now, retentionDays) {
  const d = new Date(now.getTime() - retentionDays * 86400000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function _getSettingSafe(db, key, def) { try { return getSetting(db, key, def); } catch { return def; } }
function _setSettingSafe(db, key, val) { try { setSetting(db, key, val); } catch { /* best-effort */ } }

function auditTableExists(db) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'").get(); }
  catch { return false; }
}

// Live audit_log columns (names + PRAGMA info), so the archive schema and the
// INSERT stay in lockstep with whatever migration state the live table is at.
function liveColumns(db) {
  const info  = db.prepare('PRAGMA table_info(audit_log)').all();
  const names = info.map(c => c.name);
  return { info, names, quoted: names.map(n => `"${n}"`).join(', ') };
}

// Create the per-month archive table (+ retrieval indexes) if absent. `id` is the
// PRIMARY KEY (the original live id, preserved — NOT autoincrement) so INSERT OR
// IGNORE makes re-archiving idempotent.
function ensureArchiveSchema(arch, cols) {
  const defs = cols.info.map(c => {
    if (c.name === 'id') return '"id" INTEGER PRIMARY KEY';
    return `"${c.name}" ${c.type || 'TEXT'}`;
  }).join(', ');
  arch.exec(`CREATE TABLE IF NOT EXISTS audit_log (${defs})`);
  const has = (n) => cols.names.includes(n);
  const idx = (sql, need) => { try { if (need) arch.exec(sql); } catch { /* index is best-effort */ } };
  idx('CREATE INDEX IF NOT EXISTS idx_audit_created     ON audit_log(created_at)',                 has('created_at'));
  idx('CREATE INDEX IF NOT EXISTS idx_audit_outcome     ON audit_log(outcome)',                    has('outcome'));
  idx('CREATE INDEX IF NOT EXISTS idx_audit_cat_created ON audit_log(action_category, created_at)', has('action_category') && has('created_at'));
  idx('CREATE INDEX IF NOT EXISTS idx_audit_user        ON audit_log(user_id)',                    has('user_id'));
  idx('CREATE INDEX IF NOT EXISTS idx_audit_doc         ON audit_log(document_id)',                has('document_id'));
}

// Archive one YYYY-MM bucket of rows older than the cutoff. COPY-THEN-DELETE.
// Returns the number of rows archived (and removed from live). Throws on failure
// BEFORE any live delete, so the caller leaves that month's rows in live.
function archiveMonth(liveDb, Database, archiveDir, ym, cutoff, cols) {
  const rows = liveDb.prepare(
    `SELECT ${cols.quoted} FROM audit_log WHERE created_at < ? AND substr(created_at, 1, 7) = ?`
  ).all(cutoff, ym);
  if (!rows.length) return 0;

  const file = path.join(archiveDir, `audit-${ym}.sqlite`);
  const arch = new Database(file);
  try {
    ensureArchiveSchema(arch, cols);
    const ins = arch.prepare(
      `INSERT OR IGNORE INTO audit_log (${cols.quoted}) VALUES (${cols.names.map(() => '?').join(', ')})`
    );
    arch.transaction((rs) => { for (const r of rs) ins.run(cols.names.map(n => r[n])); })(rows);
    // committed: rows are durably in the archive file before we touch live
  } finally {
    arch.close();
  }

  // Only now remove from live (all-or-nothing). Dedup by id is unnecessary — the
  // copy succeeded — but delete the exact id set we archived.
  const hasId = cols.names.includes('id');
  if (hasId) {
    const del = liveDb.prepare('DELETE FROM audit_log WHERE id = ?');
    liveDb.transaction((ids) => { for (const id of ids) del.run(id); })(rows.map(r => r.id));
  } else {
    // No id column (legacy 5-col schema): delete by the month+cutoff predicate.
    liveDb.prepare('DELETE FROM audit_log WHERE created_at < ? AND substr(created_at,1,7) = ?').run(cutoff, ym);
  }
  return rows.length;
}

/**
 * Best-effort retention maintenance. NEVER throws.
 * @param {object} db   open better-sqlite3 handle to docusnap.db
 * @param {object} opts { archiveDir, retentionDays?, now?, logger?, force?, Database?, vacuumThreshold? }
 * @returns {object} a small result/skip summary (for tests + diagnostics)
 */
function runMaintenance(db, opts = {}) {
  const logger = opts.logger || null;
  try {
    const now = opts.now || new Date();
    const retentionDays = opts.retentionDays != null
      ? Number(opts.retentionDays)
      : parseInt(_getSettingSafe(db, RETENTION_KEY, String(DEFAULT_RETENTION_DAYS)), 10);
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return { skipped: 'disabled' };

    // Throttle to once/day. Stamp the run NOW (before the work) so a persistent
    // failure can't re-run every startup.
    const last = Number(_getSettingSafe(db, LAST_RUN_KEY, '0')) || 0;
    if (!opts.force && last && (now.getTime() - last) < THROTTLE_MS) return { skipped: 'throttled' };
    _setSettingSafe(db, LAST_RUN_KEY, String(now.getTime()));

    if (!auditTableExists(db)) return { skipped: 'no_table' };

    const cutoff = cutoffString(now, retentionDays);
    const months = db.prepare(
      `SELECT substr(created_at, 1, 7) AS ym FROM audit_log WHERE created_at < ?
        GROUP BY ym ORDER BY ym`
    ).all(cutoff).map(r => r.ym).filter(Boolean);
    if (!months.length) return { archived: 0, months: 0 };

    if (!opts.archiveDir) return { skipped: 'no_archive_dir' };
    fs.mkdirSync(opts.archiveDir, { recursive: true });

    const Database = opts.Database || require('better-sqlite3');
    const cols = liveColumns(db);
    let archived = 0, monthFiles = 0;
    for (const ym of months) {
      try {
        const n = archiveMonth(db, Database, opts.archiveDir, ym, cutoff, cols);
        if (n) { archived += n; monthFiles++; }
      } catch (e) {
        // Leave this month's rows in live (no loss); continue with the others.
        try { logger?.warn?.(`[audit-archive] month ${ym} skipped: ${e.message}`); } catch {}
      }
    }

    // Conservative reclaim: a single VACUUM only after a big one-off cleanup.
    const threshold = opts.vacuumThreshold != null ? opts.vacuumThreshold : VACUUM_ROWS_THRESHOLD;
    if (archived >= threshold) {
      try { db.exec('VACUUM'); } catch (e) { try { logger?.warn?.(`[audit-archive] VACUUM skipped: ${e.message}`); } catch {} }
    }
    if (archived) { try { logger?.log?.(`[audit-archive] archived ${archived} row(s) into ${monthFiles} month file(s)`); } catch {} }
    return { archived, months: monthFiles };
  } catch (e) {
    try { logger?.warn?.(`[audit-archive] skipped: ${e.message}`); } catch {}
    return { skipped: 'error', error: e.message };
  }
}

// Stage B helper: existing monthly archive files whose YYYY-MM overlaps the given
// range, most-recent first, capped. Returns { files:[{ym,path}], partial:boolean }.
// `partial` is true when more in-range archived months exist than the cap allows
// (the most-recent `cap` are returned). Missing dir / no matches → empty + not partial.
function archiveFilesForRange(archiveDir, fromYm, toYm, cap = 8) {
  const out = { files: [], partial: false };
  if (!archiveDir) return out;
  let names;
  try { names = fs.readdirSync(archiveDir); } catch { return out; }   // dir absent → no archives
  const re = /^audit-(\d{4}-\d{2})\.sqlite$/;
  let months = [];
  for (const n of names) {
    const m = re.exec(n);
    if (!m) continue;
    const ym = m[1];
    if (fromYm && ym < fromYm) continue;
    if (toYm   && ym > toYm)   continue;
    months.push(ym);
  }
  months.sort().reverse();                       // most-recent first
  if (cap > 0 && months.length > cap) { out.partial = true; months = months.slice(0, cap); }
  out.files = months.map(ym => ({ ym, path: path.join(archiveDir, `audit-${ym}.sqlite`) }));
  return out;
}

module.exports = {
  runMaintenance,
  // exported for tests / Stage B reuse
  cutoffString, liveColumns, ensureArchiveSchema, archiveMonth, auditTableExists,
  archiveFilesForRange,
  RETENTION_KEY, LAST_RUN_KEY, DEFAULT_RETENTION_DAYS,
};
