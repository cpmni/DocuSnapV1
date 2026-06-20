#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_audit_archive.js — audit retention (Stage A) + archive-aware
 * search (Stage B) tests.
 *
 * Stage A: retention cutoff · monthly file creation · copy-then-delete row-count
 *   conservation (no loss) · security-event preservation · failure handling
 *   (archive write fails → no throw, live intact) · disable + once/day throttle ·
 *   migration-29 search indexes.
 * Stage B: live-only search unchanged · archived rows merged in for old date ranges ·
 *   merged COUNT + pagination across the boundary · missing/corrupt archive → no
 *   throw + live rows returned + clean detach · attachment cap + partial flag.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_audit_archive.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const archive = require('./audit_archive');
const auth = require('./auth');

let fail = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; return cond; }

function freshLive() { const db = new Database(':memory:'); runMigrations(db); return db; }
const ymd = (d) => d.toISOString().slice(0, 19).replace('T', ' ');     // 'YYYY-MM-DD HH:MM:SS'
function insertAudit(db, { action = 'login_success', category = 'auth', outcome = 'success', createdAt }) {
  return db.prepare(`INSERT INTO audit_log (action, action_category, outcome, created_at) VALUES (?, ?, ?, ?)`)
    .run(action, category, outcome, createdAt).lastInsertRowid;
}
function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ds-auditarch-')); }
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }
function archiveRows(dir, ym) {
  const f = path.join(dir, `audit-${ym}.sqlite`);
  if (!fs.existsSync(f)) return [];
  const a = new Database(f, { readonly: true });
  try { return a.prepare('SELECT * FROM audit_log').all(); } finally { a.close(); }
}
// Build a valid monthly archive file directly (fewer columns than live → also
// exercises the per-archive present-or-NULL column handling in the UNION).
function makeArchive(dir, ym, rows) {
  fs.mkdirSync(dir, { recursive: true });
  const a = new Database(path.join(dir, `audit-${ym}.sqlite`));
  try {
    a.exec(`CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, action_category TEXT, outcome TEXT, details TEXT, created_at TEXT)`);
    const ins = a.prepare(`INSERT OR IGNORE INTO audit_log (id, action, action_category, outcome, created_at) VALUES (?, ?, ?, ?, ?)`);
    for (const r of rows) ins.run(r.id, r.action || 'x', r.category || 'auth', r.outcome || 'success', r.createdAt);
  } finally { a.close(); }
}
const noArc = (db) => db.prepare('PRAGMA database_list').all().every(d => !/^arc/.test(d.name));

function main() {
  const NOW = new Date('2026-06-20T12:00:00Z');
  const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);

  // ══════════════════════════ STAGE A ══════════════════════════
  // ── 1–4: cutoff · monthly files · conservation · security-event preservation ──
  {
    const db = freshLive(); const dir = tmpdir();
    insertAudit(db, { action: 'login_success',  createdAt: ymd(daysAgo(200)) });                           // old month A
    insertAudit(db, { action: 'access_denied', category: 'admin', outcome: 'denied', createdAt: ymd(daysAgo(120)) }); // old month B (SECURITY)
    insertAudit(db, { action: 'password_reset', createdAt: ymd(daysAgo(120)) });                           // old month B
    insertAudit(db, { action: 'login_success',  createdAt: ymd(daysAgo(5)) });                             // recent
    insertAudit(db, { action: 'import_run', category: 'processing', createdAt: ymd(daysAgo(1)) });         // recent
    const before = db.prepare('SELECT COUNT(*) c FROM audit_log').get().c;

    const res = archive.runMaintenance(db, { archiveDir: dir, retentionDays: 30, now: NOW, force: true, Database });

    const liveCount = db.prepare('SELECT COUNT(*) c FROM audit_log').get().c;
    check('result reports 3 rows archived', res.archived === 3);
    check('retention cutoff: only the 2 recent rows remain live', liveCount === 2);
    check('live rows are all newer than the cutoff', db.prepare('SELECT MIN(created_at) m FROM audit_log').get().m >= ymd(daysAgo(30)));

    const ymA = ymd(daysAgo(200)).slice(0, 7), ymB = ymd(daysAgo(120)).slice(0, 7);
    check('monthly archive file created (month A)', fs.existsSync(path.join(dir, `audit-${ymA}.sqlite`)));
    check('monthly archive file created (month B)', fs.existsSync(path.join(dir, `audit-${ymB}.sqlite`)));

    const archivedTotal = archiveRows(dir, ymA).length + archiveRows(dir, ymB).length;
    check('copy-then-delete conserves total row count (no loss)', liveCount + archivedTotal === before);
    check('security event (access_denied) preserved in archive',
      archiveRows(dir, ymB).some(r => r.action === 'access_denied' && r.outcome === 'denied'));
    check('security event removed from live (moved, not duplicated)',
      db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='access_denied'").get().c === 0);
    db.close(); rmrf(dir);
  }

  // ── 5: archive write fails → no throw, live rows intact (no loss) ─────────────
  {
    const db = freshLive(); const dir = tmpdir();
    insertAudit(db, { action: 'login_success',  createdAt: ymd(daysAgo(200)) });
    insertAudit(db, { action: 'access_denied', category: 'admin', outcome: 'denied', createdAt: ymd(daysAgo(200)) });
    const before = db.prepare('SELECT COUNT(*) c FROM audit_log').get().c;
    const ThrowingDB = function () { throw new Error('simulated archive write failure'); };
    let threw = false, res;
    try { res = archive.runMaintenance(db, { archiveDir: dir, retentionDays: 30, now: NOW, force: true, Database: ThrowingDB }); }
    catch { threw = true; }
    check('maintenance never throws on archive write failure', threw === false);
    check('nothing archived on failure', !!res && res.archived === 0);
    check('live rows intact on failure (no loss)', db.prepare('SELECT COUNT(*) c FROM audit_log').get().c === before);
    db.close(); rmrf(dir);
  }

  // ── disable + once/day throttle ──────────────────────────────────────────────
  {
    const db = freshLive(); const dir = tmpdir();
    insertAudit(db, { action: 'login_success', createdAt: ymd(daysAgo(200)) });
    const d = archive.runMaintenance(db, { archiveDir: dir, retentionDays: 0, now: NOW, force: true, Database });
    check('retentionDays=0 disables archival', d.skipped === 'disabled' &&
      db.prepare('SELECT COUNT(*) c FROM audit_log').get().c === 1);
    archive.runMaintenance(db, { archiveDir: dir, retentionDays: 30, now: NOW, Database });
    const t = archive.runMaintenance(db, { archiveDir: dir, retentionDays: 30, now: NOW, Database });
    check('second run within a day is throttled', t.skipped === 'throttled');
    db.close(); rmrf(dir);
  }

  // ── 6: migration 29 search indexes exist ─────────────────────────────────────
  {
    const db = new Database(':memory:'); runMigrations(db);
    const idx = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name));
    check('migration 29: idx_audit_outcome exists', idx.has('idx_audit_outcome'));
    check('migration 29: idx_audit_cat_created exists', idx.has('idx_audit_cat_created'));
    db.close();
  }

  // ══════════════════════════ STAGE B ══════════════════════════
  // ── B1: live-only searches are byte-identical (no archive engagement) ─────────
  {
    const db = freshLive(); const dir = tmpdir();
    insertAudit(db, { action: 'x', createdAt: ymd(daysAgo(1)) });
    insertAudit(db, { action: 'y', createdAt: ymd(daysAgo(2)) });
    const noOpts  = auth.getAuditLogFiltered(db, {});                                                   // no opts
    const noDate  = auth.getAuditLogFiltered(db, {}, { archiveDir: dir });                              // opts, no date bound
    const recent  = auth.getAuditLogFiltered(db, { dateFrom: ymd(daysAgo(10)) }, { archiveDir: dir });  // date bound, no archive files
    check('live-only: no opts → live result', noOpts.total === 2 && noOpts.archivesPartial === undefined);
    check('live-only: opts without a date bound → live result', noDate.total === 2 && noDate.archivesPartial === undefined);
    check('live-only: date bound with no archive files → live result', recent.total === 2 && recent.archivesPartial === undefined);
    db.close(); rmrf(dir);
  }

  // ── B2: archived rows merged in; merged COUNT + pagination across the boundary ─
  {
    const db = freshLive(); const dir = tmpdir();
    insertAudit(db, { action: 'a_old',  createdAt: ymd(daysAgo(200)) });  // id1 → archive 2025-12
    insertAudit(db, { action: 'b_old', category: 'admin', outcome: 'denied', createdAt: ymd(daysAgo(120)) }); // id2 → archive 2026-02
    insertAudit(db, { action: 'c_old',  createdAt: ymd(daysAgo(120)) });  // id3 → archive 2026-02
    insertAudit(db, { action: 'd_live', createdAt: ymd(daysAgo(5)) });    // id4 → live
    insertAudit(db, { action: 'e_live', createdAt: ymd(daysAgo(1)) });    // id5 → live
    archive.runMaintenance(db, { archiveDir: dir, retentionDays: 30, now: NOW, force: true, Database });

    const all = auth.getAuditLogFiltered(db, { dateFrom: '2025-01-01', limit: 100 }, { archiveDir: dir });
    check('merged: COUNT spans live + archived (total=5)', all.total === 5);
    check('merged: rows newest-first by id across the union', all.rows.map(r => r.id).join(',') === '5,4,3,2,1');
    check('merged: an archived-only row is present', all.rows.some(r => r.action === 'a_old'));
    check('merged: full coverage is NOT flagged partial', all.archivesPartial === undefined);

    const p1 = auth.getAuditLogFiltered(db, { dateFrom: '2025-01-01', limit: 2, offset: 0 }, { archiveDir: dir });
    const p2 = auth.getAuditLogFiltered(db, { dateFrom: '2025-01-01', limit: 2, offset: 2 }, { archiveDir: dir });
    const p3 = auth.getAuditLogFiltered(db, { dateFrom: '2025-01-01', limit: 2, offset: 4 }, { archiveDir: dir });
    check('pagination page 1 (live)     → ids 5,4 (total 5)', p1.rows.map(r => r.id).join(',') === '5,4' && p1.total === 5);
    check('pagination page 2 (boundary) → ids 3,2', p2.rows.map(r => r.id).join(',') === '3,2');
    check('pagination page 3 (archive)  → id 1', p3.rows.map(r => r.id).join(',') === '1');
    check('no leftover attachments after merged queries', noArc(db));
    db.close(); rmrf(dir);
  }

  // ── B3: corrupt archive file → no throw, live rows returned, partial, clean detach ─
  {
    const db = freshLive(); const dir = tmpdir();
    insertAudit(db, { action: 'live1', createdAt: ymd(daysAgo(1)) });
    insertAudit(db, { action: 'live2', createdAt: ymd(daysAgo(2)) });
    fs.writeFileSync(path.join(dir, 'audit-2024-05.sqlite'), 'this is not a sqlite database');
    let threw = false, res;
    try { res = auth.getAuditLogFiltered(db, { dateFrom: '2024-01-01', limit: 100 }, { archiveDir: dir }); }
    catch { threw = true; }
    check('corrupt archive: query does not throw', threw === false);
    check('corrupt archive: live rows still returned', !!res && res.total === 2);
    check('corrupt archive: coverage flagged partial', !!res && res.archivesPartial === true);
    check('corrupt archive: no leftover attachments', noArc(db));
    db.close(); rmrf(dir);
  }

  // ── B4: attachment cap (>8 in-range months) → ≤8 attached, partial, no throw ───
  {
    const db = freshLive(); const dir = tmpdir();
    insertAudit(db, { action: 'live1', createdAt: ymd(daysAgo(1)) });
    for (let mo = 1; mo <= 10; mo++) {
      const ym = `2024-${String(mo).padStart(2, '0')}`;
      makeArchive(dir, ym, [{ id: 1000 + mo, action: `arc_${ym}`, createdAt: `${ym}-15 00:00:00` }]);
    }
    let threw = false, res;
    try { res = auth.getAuditLogFiltered(db, { dateFrom: '2024-01-01', limit: 100 }, { archiveDir: dir }); }
    catch { threw = true; }
    check('cap: query does not throw', threw === false);
    check('cap: coverage flagged partial (10 months > cap 8)', !!res && res.archivesPartial === true);
    check('cap: searched live + the 8 most-recent archived months only', !!res && res.total === 1 + 8);
    check('cap: no leftover attachments', noArc(db));
    db.close(); rmrf(dir);
  }

  console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll audit-archive (Stage A + Stage B) checks passed.');
  process.exit(fail ? 1 : 0);
}

main();
