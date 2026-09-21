'use strict';
/*
 * modules/lookup/handler.js — the Electron/IPC edge for Quick File RECORDS LISTS (auto-fill lookup).
 * Pure DB logic lives in database/modules/lookup.js (pinned); this owns only role/enabled gating, window
 * notify, and audit. DARK behind lookup_lists_enabled (seeded OFF, mig 197) — every IPC refuses when off.
 *
 * Roles (Barry): editing the LIST SCHEMA + field-map binding is admin; adding/editing RECORDS + the
 * typeahead is everyday 'edit' work. Import IPCs live in the import slice (S3).
 *
 * SAFETY: this edge never calls any learning reader/writer; a resolved record is a PREFILL only — the
 * Quick File submit files it as an intake='direct' typed row (learning-excluded, Q-C1 / PIN 1).
 */
const lookup = require('../../../database/modules/lookup');

const TTL_MS = 15 * 60 * 1000;

function register(ctx) {
  const { ipcMain, getDb, app, fs, path, logger } = ctx;
  const { requireRole, logAudit } = require('../auth/handler');
  const learning = require('../../../database/modules/learning');
  const svc = require('../../services/directIntakeService');   // reuse validateIntakePath (canonicalise/real-file/containment)
  const lookupImport = require('../../services/lookupImport');
  const fileKinds = require('../../lib/fileKinds');

  // MAIN-side parsed-import staging: token -> { headers, rows, date1904, isXlsx, expires }. The file is parsed
  // then DISCARDED (paths never reach the renderer). Separate from directIntake's _staged (that keeps the doc).
  const _imports = new Map();
  const _sweepImports = () => { const now = Date.now(); for (const [k, v] of _imports) if (v.expires < now) _imports.delete(k); };
  const _mint = () => 'imp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);

  const enabled = (db) => String(learning.getSetting(db, 'lookup_lists_enabled', 'false')) === 'true';
  const notify = () => { try { ctx.notifyAllWindows && ctx.notifyAllWindows('lookup-lists-changed'); } catch {} };
  const audit = (db, action, m) => { try { logAudit(db, { action, action_category: 'settings', outcome: 'success', ...(m || {}) }); } catch {} };
  const gate = (db, roles) => { requireRole(...roles); if (!enabled(db)) return false; return true; };

  ipcMain.handle('lookup-enabled', () => { requireRole('admin', 'edit'); return { ok: true, enabled: enabled(getDb()) }; });

  // ── Lists (management = admin) ─────────────────────────────────────────────────────────────────
  ipcMain.handle('lookup-lists', () => {
    const db = getDb(); if (!gate(db, ['admin', 'edit'])) return { ok: false, error: 'disabled' };
    return { ok: true, lists: lookup.listLists(db) };
  });
  ipcMain.handle('lookup-create-list', (_e, payload) => {
    const db = getDb(); if (!gate(db, ['admin'])) return { ok: false, error: 'disabled' };
    const r = lookup.createList(db, payload || {});
    if (r.ok) { audit(db, 'lookup_list_created', { list_id: r.id }); notify(); }
    return r;
  });
  ipcMain.handle('lookup-update-list', (_e, payload) => {
    const db = getDb(); if (!gate(db, ['admin'])) return { ok: false, error: 'disabled' };
    const { id, changes } = payload || {};
    const r = lookup.updateList(db, id, changes || {});
    if (r.ok) notify();
    return r;
  });
  ipcMain.handle('lookup-delete-list', (_e, id) => {
    const db = getDb(); if (!gate(db, ['admin'])) return { ok: false, error: 'disabled' };
    const r = lookup.deleteList(db, id);
    if (r.ok) { audit(db, 'lookup_list_deleted', { list_id: id }); notify(); }
    return r;
  });

  // ── Records (add/edit = admin+edit everyday work) ──────────────────────────────────────────────
  ipcMain.handle('lookup-records', (_e, payload) => {
    const db = getDb(); if (!gate(db, ['admin', 'edit'])) return { ok: false, error: 'disabled' };
    const { listId, offset, limit } = payload || {};
    return { ok: true, records: lookup.getRecords(db, listId, { offset, limit }), total: lookup.countRecords(db, listId) };
  });
  ipcMain.handle('lookup-add-record', (_e, payload) => {
    const db = getDb(); if (!gate(db, ['admin', 'edit'])) return { ok: false, error: 'disabled' };
    const { listId, values, disambiguator } = payload || {};
    const r = lookup.addRecord(db, listId, { values, disambiguator, source: 'manual' });
    if (r.ok) notify();
    return r;
  });
  ipcMain.handle('lookup-update-record', (_e, payload) => {
    const db = getDb(); if (!gate(db, ['admin', 'edit'])) return { ok: false, error: 'disabled' };
    const { id, values, disambiguator } = payload || {};
    const r = lookup.updateRecord(db, id, { values, disambiguator });
    if (r.ok) notify();
    return r;
  });
  ipcMain.handle('lookup-delete-record', (_e, id) => {
    const db = getDb(); if (!gate(db, ['admin', 'edit'])) return { ok: false, error: 'disabled' };
    const r = lookup.deleteRecord(db, id);
    if (r.ok) notify();
    return r;
  });

  // ── Typeahead + resolve (the fill payoff = admin+edit) ─────────────────────────────────────────
  ipcMain.handle('lookup-suggest', (_e, payload) => {
    const db = getDb(); if (!gate(db, ['admin', 'edit'])) return { ok: false, error: 'disabled' };
    let { listId, documentTypeId, query, limit } = payload || {};
    if (listId == null && documentTypeId != null) listId = lookup.getListForType(db, documentTypeId);
    if (listId == null) return { ok: true, rows: [], total: 0 };
    const res = lookup.suggest(db, listId, String(query || ''), { limit });
    return { ok: true, ...res };
  });
  ipcMain.handle('lookup-resolve', (_e, payload) => {
    const db = getDb(); if (!gate(db, ['admin', 'edit'])) return { ok: false, error: 'disabled' };
    const { documentTypeId, recordId } = payload || {};
    return lookup.resolveRecordForType(db, documentTypeId, recordId);
  });
  // What the Quick File pane needs to wire the typeahead: the bound list (if any) for a doc type + which
  // field is the trigger (the master-mapped field the user types into).
  ipcMain.handle('lookup-type-binding', (_e, documentTypeId) => {
    const db = getDb(); if (!gate(db, ['admin', 'edit'])) return { ok: false, error: 'disabled' };
    const listId = lookup.getListForType(db, documentTypeId);
    if (listId == null) return { ok: true, bound: false };
    const list = lookup.getList(db, listId);
    const maps = lookup.getFieldMaps(db, documentTypeId);
    const trigger = maps.find(m => m.is_trigger) || null;
    return { ok: true, bound: true, listId, list: { id: list.id, name: list.name, master_key: list.master_key, disambiguator_key: list.disambiguator_key },
             triggerFieldKey: trigger ? trigger.field_key : null };
  });

  // ── Field maps (binding a list to a type's fields = admin) ─────────────────────────────────────
  ipcMain.handle('lookup-field-maps-get', (_e, documentTypeId) => {
    const db = getDb(); if (!gate(db, ['admin'])) return { ok: false, error: 'disabled' };
    return { ok: true, maps: lookup.getFieldMaps(db, documentTypeId), listId: lookup.getListForType(db, documentTypeId) };
  });
  ipcMain.handle('lookup-field-maps-set', (_e, payload) => {
    const db = getDb(); if (!gate(db, ['admin'])) return { ok: false, error: 'disabled' };
    const { documentTypeId, listId, maps } = payload || {};
    const r = lookup.setFieldMaps(db, documentTypeId, listId, maps);
    if (r.ok) { audit(db, 'lookup_field_maps_set', { document_type_id: documentTypeId, list_id: listId }); notify(); }
    return r;
  });

  // ── CSV / XLSX import (admin) — pick → parse in MAIN → preview → commit (transactional) ─────────
  ipcMain.handle('lookup-import-pick', async () => {
    const db = getDb(); if (!gate(db, ['admin'])) return { ok: false, error: 'disabled' };
    _sweepImports();
    const { dialog } = require('electron');
    const win = ctx.getMainWindow && ctx.getMainWindow();
    const res = await dialog.showOpenDialog(win || undefined, {
      title: 'Import records — choose a CSV or Excel file',
      properties: ['openFile'],
      filters: [{ name: 'Data files', extensions: ['csv', 'xlsx'] }],
    });
    if (!res || res.canceled || !res.filePaths || !res.filePaths.length) return { ok: true, canceled: true };
    const raw = res.filePaths[0];
    const v = svc.validateIntakePath(raw, {
      userDataDir: app.getPath('userData'),
      outputRoot: learning.getSetting(db, 'output_folder', null),
      maxMb: Number(learning.getSetting(db, 'lookup_import_max_mb', 10)) || 10,
    });
    if (!v.ok) return { ok: false, error: v.refused || 'invalid' };
    const ext = fileKinds.normExt(v.ext || raw);
    if (ext !== '.csv' && ext !== '.xlsx') return { ok: false, error: 'unsupported_type' };
    let buf; try { buf = fs.readFileSync(v.path); } catch { return { ok: false, error: 'read_failed' }; }
    const parsed = lookupImport.parseBuffer(buf, ext);
    if (!parsed.ok) return { ok: false, error: parsed.error || 'parse_failed' };
    const token = _mint();
    _imports.set(token, { headers: parsed.headers, rows: parsed.rows, date1904: parsed.date1904, isXlsx: parsed.isXlsx, expires: Date.now() + TTL_MS });
    return { ok: true, token, headers: parsed.headers, sampleRows: parsed.rows.slice(0, 20), rowCount: parsed.rows.length, truncated: !!parsed.truncated };
  });

  ipcMain.handle('lookup-import-commit', (_e, payload) => {
    const db = getDb(); if (!gate(db, ['admin'])) return { ok: false, error: 'disabled' };
    _sweepImports();
    const { token, listId, columnMap, mode } = payload || {};
    const staged = token && _imports.get(token);
    if (!staged || staged.expires < Date.now()) { if (token) _imports.delete(token); return { ok: false, error: 'expired' }; }
    const list = lookup.getList(db, listId);
    if (!list) return { ok: false, error: 'unknown_list' };
    const r = lookupImport.applyImport(db, list, { headers: staged.headers, rows: staged.rows, date1904: staged.date1904, isXlsx: staged.isXlsx },
      columnMap || {}, { mode: mode === 'replace' ? 'replace' : 'append' });
    if (r.ok) { _imports.delete(token); audit(db, 'lookup_import', { list_id: listId, inserted: r.inserted, updated: r.updated, skipped: r.skipped }); notify(); }
    return r;
  });

  ipcMain.handle('lookup-import-cancel', (_e, token) => {
    requireRole('admin'); if (token) _imports.delete(token); return { ok: true };
  });
}

module.exports = { register };
