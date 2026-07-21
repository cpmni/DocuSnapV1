'use strict';

/**
 * services/backupService.js
 * -------------------------
 * Encrypted settings/configuration backup + restore. Transport-agnostic and
 * READ/WRITE against the DB handle passed in; the IPC edge (settings/handler.js)
 * owns the admin gate, the file dialogs, and file IO.
 *
 * Scope (what survives a reinstall): app settings, document types + fields,
 * templates + their mappings/landmarks/logo-hashes/groups, keyword label
 * overrides, and the learned data (anchors, hints, corrections, logo
 * fingerprints). DELIBERATELY EXCLUDES users/auth, sessions, the audit log,
 * licensing/device state, and the documents themselves.
 *
 * Crypto: scrypt (password -> key) + AES-256-GCM (authenticated), over gzipped
 * JSON. Authenticated encryption means a wrong password or any tampering fails
 * the decrypt cleanly. The password is never stored.
 *
 * File layout (binary, NOT plain JSON): MAGIC(8) | ver(1) | salt(16) | iv(12) |
 * tag(16) | ciphertext(gzip(JSON)).
 */

const crypto = require('crypto');
const zlib = require('zlib');

const MAGIC = Buffer.from('SFBACKUP', 'utf8');   // 8 bytes
const FORMAT_VERSION = 1;
const SUPPORTED_FORMATS = new Set([1]);

// Tables included, parents before children (FK-safe insert order; restore also
// defers FK checks as belt-and-braces). `settings` is MERGED (upsert), the rest
// are fully REPLACED — see applyBackup.
const TABLES = [
  'settings',
  'document_types', 'fields',
  'template_groups', 'templates',
  'template_fields', 'template_field_mappings', 'template_landmarks', 'template_logo_hashes',
  'field_label_overrides',
  'field_anchors', 'supplier_hints', 'corrections', 'logo_fingerprints',
];

// Settings keys NEVER backed up or restored — licensing/device-bound state.
function _settingExcluded(key) {
  return String(key || '').toLowerCase().includes('licens');
}

// ── Crypto ──────────────────────────────────────────────────────────────────────
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function _deriveKey(password, salt) {
  return crypto.scryptSync(Buffer.from(String(password), 'utf8'), salt, 32, SCRYPT);
}
function _encrypt(plaintext, password) {
  const salt = crypto.randomBytes(16);
  const iv   = crypto.randomBytes(12);
  const key  = _deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct  = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), salt, iv, tag, ct]);
}
function _decrypt(fileBuf, password) {
  const HEAD = 8 + 1 + 16 + 12 + 16;
  if (!Buffer.isBuffer(fileBuf) || fileBuf.length <= HEAD || !fileBuf.subarray(0, 8).equals(MAGIC)) {
    throw new Error('This is not a Scan Finder backup file.');
  }
  let o = 9;
  const salt = fileBuf.subarray(o, o += 16);
  const iv   = fileBuf.subarray(o, o += 12);
  const tag  = fileBuf.subarray(o, o += 16);
  const ct   = fileBuf.subarray(o);
  const decipher = crypto.createDecipheriv('aes-256-gcm', _deriveKey(password, salt), iv);
  decipher.setAuthTag(tag);
  try { return Buffer.concat([decipher.update(ct), decipher.final()]); }
  catch { throw new Error('Wrong password, or the backup file is corrupted.'); }
}

// ── Public API ────────────────────────────────────────────────────────────────────

/** Build an encrypted backup Buffer from the current DB. */
function createBackup(db, password, opts = {}) {
  if (!password || !String(password).trim()) throw new Error('A password is required.');
  const tables = {};
  for (const t of TABLES) {
    let rows;
    try { rows = db.prepare(`SELECT * FROM ${t}`).all(); } catch { continue; }   // table absent -> skip
    if (t === 'settings') rows = rows.filter(r => !_settingExcluded(r.key));
    tables[t] = rows;
  }
  const payload = {
    format: FORMAT_VERSION,
    app_version: opts.appVersion || '',
    exported_at: new Date().toISOString(),
    // Licensing device fingerprint of the machine that made this backup. Used on import
    // to stop a fresh trial on another machine from importing someone else's learned
    // data/settings (see settings/handler device-import gate). It's already a SHA-256
    // hash (never the raw machine id) and the whole file is encrypted; safe to embed.
    device_fp: opts.deviceFp || '',
    tables,
  };
  return _encrypt(zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8')), password);
}

/** Decrypt + validate ONLY (no DB writes). Returns { meta, payload, summary }. */
function readBackup(fileBuf, password) {
  if (!password || !String(password).trim()) throw new Error('A password is required.');
  let payload;
  try { payload = JSON.parse(zlib.gunzipSync(_decrypt(fileBuf, password)).toString('utf8')); }
  catch (e) { if (/password|corrupted|Scan Finder backup/.test(e.message)) throw e; throw new Error('The backup file is unreadable.'); }
  if (!payload || typeof payload !== 'object' || typeof payload.tables !== 'object') {
    throw new Error('Not a valid backup payload.');
  }
  if (!SUPPORTED_FORMATS.has(payload.format)) {
    throw new Error(`Unsupported backup version (${payload.format}). This app can restore version ${[...SUPPORTED_FORMATS].join(', ')}.`);
  }
  const summary = {};
  for (const t of TABLES) summary[t] = Array.isArray(payload.tables[t]) ? payload.tables[t].length : 0;
  return {
    meta: { format: payload.format, app_version: payload.app_version || '', exported_at: payload.exported_at || '', device_fp: payload.device_fp || '' },
    payload,
    summary,
  };
}

/**
 * Apply a validated payload. ONE transaction, FK checks deferred to commit.
 *
 * The naive "DELETE FROM … then re-INSERT with the backup's original ids" is
 * WRONG for the parent tables that the EXCLUDED `documents` table references
 * (`document_type_id`, `template_id`): on a machine that still holds documents
 * (the DB survives reinstall), it either aborts at COMMIT with an opaque
 * `FOREIGN KEY constraint failed`, or — worse — silently RE-TYPES a document
 * when the backup's id N maps to a different type than the local id N (the FK
 * check verifies existence, not identity). See the 2026-07-02 QA audit #1.
 *
 * So parents are restored by NATURAL KEY, preserving the LOCAL id:
 *   - settings           MERGE (upsert; never wipes device/licensing keys)
 *   - document_types     UPSERT on `slug`      -> backup-id → local-id map
 *   - template_groups    UPSERT on `name`      -> id map
 *   - templates          UPSERT on `slug` (remap group_id; NULL a
 *                        sample_document_id whose doc isn't present here) -> id map
 *   - fields + template_* children  scoped REPLACE per restored parent, FK remapped
 *   - learned tables     full REPLACE (no inbound id FK; keyed by supplier/slug text)
 * Local-only rows (absent from the backup) are left intact, so a surviving
 * document's type/template is never deleted out from under it. Forward-compatible:
 * only columns that still exist in this schema are restored.
 */
function applyBackup(db, payload) {
  const applied = {};
  const T = (payload && payload.tables) || {};
  const rowsFor = (t) => (Array.isArray(T[t]) ? T[t] : null);
  const colsOf  = (t) => {
    try { const c = db.prepare(`PRAGMA table_info(${t})`).all().map(x => x.name); return c.length ? c : null; }
    catch { return null; }
  };
  const tableExists = (t) => {
    try { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t); }
    catch { return false; }
  };
  const pickCols = (row, list) => { const o = {}; for (const c of list) o[c] = (row[c] === undefined ? null : row[c]); return o; };

  // Insert a row honouring only columns that still exist; reuse the row's ORIGINAL
  // id when that slot is free (stable ids on a same-machine restore), else let
  // AUTOINCREMENT assign a fresh one (child ids aren't referenced by anything).
  const insertRow = (table, cols, row) => {
    let useCols = cols.filter(c => Object.prototype.hasOwnProperty.call(row, c));
    if (useCols.includes('id')) {
      const free = row.id != null && !db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(row.id);
      if (!free) useCols = useCols.filter(c => c !== 'id');
    }
    if (!useCols.length) return null;
    const info = db.prepare(
      `INSERT INTO ${table} (${useCols.map(c => `"${c}"`).join(', ')}) ` +
      `VALUES (${useCols.map(c => '@' + c).join(', ')})`
    ).run(pickCols(row, useCols));
    return info.lastInsertRowid;
  };

  db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');

    // ── settings — MERGE ──
    {
      const rows = rowsFor('settings'), cols = colsOf('settings');
      if (rows && cols) {
        const up = db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ' +
                              'ON CONFLICT(key) DO UPDATE SET value = excluded.value');
        let n = 0;
        for (const r of rows) {
          if (_settingExcluded(r.key)) continue;
          up.run({ key: r.key, value: r.value == null ? null : String(r.value) });
          n++;
        }
        applied.settings = n;
      }
    }

    // ── parents — UPSERT by natural key, preserving local ids. `prepRow` may
    //    rewrite a row before insert/update (remap child FKs, null dangling refs). ──
    const upsertParent = (table, natKey, prepRow) => {
      const rows = rowsFor(table), cols = colsOf(table);
      const map = new Map();   // backup id -> local id
      if (!rows || !cols) return map;
      const findLocal = db.prepare(`SELECT id FROM ${table} WHERE ${natKey} = ?`);
      let n = 0;
      for (const raw of rows) {
        const row = prepRow ? prepRow({ ...raw }) : { ...raw };
        const keyVal = row[natKey];
        let localId = null;
        if (keyVal != null) { const e = findLocal.get(String(keyVal)); if (e) localId = e.id; }
        if (localId != null) {
          const upCols = cols.filter(c => c !== 'id' && Object.prototype.hasOwnProperty.call(row, c));
          if (upCols.length) {
            db.prepare(`UPDATE ${table} SET ${upCols.map(c => `"${c}" = @${c}`).join(', ')} WHERE id = @__id`)
              .run({ ...pickCols(row, upCols), __id: localId });
          }
        } else {
          localId = insertRow(table, cols, row);
        }
        if (raw.id != null && localId != null) map.set(raw.id, localId);
        n++;
      }
      applied[table] = n;
      return map;
    };

    const typeMap  = upsertParent('document_types', 'slug');
    const groupMap = upsertParent('template_groups', 'name');

    const docPresent = tableExists('documents') ? db.prepare('SELECT 1 FROM documents WHERE id = ?') : null;
    const tmplMap = upsertParent('templates', 'slug', (row) => {
      if ('group_id' in row && row.group_id != null) {
        row.group_id = groupMap.has(row.group_id) ? groupMap.get(row.group_id) : null;   // remap or drop dangling
      }
      if ('sample_document_id' in row && row.sample_document_id != null) {
        if (!docPresent || !docPresent.get(row.sample_document_id)) row.sample_document_id = null;   // referent absent here
      }
      return row;
    });

    // ── children — for every restored parent, REPLACE its child set (scoped delete
    //    by remapped parent id, then insert with the remapped FK). Local-only parents
    //    keep their children untouched. ──
    const replaceChildren = (table, parentCol, parentMap) => {
      const rows = rowsFor(table), cols = colsOf(table);
      // M5 (same class as the learned-table loop): an empty child array is "nothing to
      // import", not "delete this parent's children". Absent→skipped must equal empty→skipped.
      if (!rows || !rows.length || !cols) return;
      const del = db.prepare(`DELETE FROM ${table} WHERE ${parentCol} = ?`);
      for (const localId of new Set(parentMap.values())) del.run(localId);
      let n = 0;
      for (const raw of rows) {
        const oldParent = raw[parentCol];
        if (oldParent == null || !parentMap.has(oldParent)) continue;   // orphan in backup
        insertRow(table, cols, { ...raw, [parentCol]: parentMap.get(oldParent) });
        n++;
      }
      applied[table] = n;
    };

    replaceChildren('fields', 'document_type_id', typeMap);
    for (const ct of ['template_fields', 'template_field_mappings', 'template_landmarks', 'template_logo_hashes']) {
      replaceChildren(ct, 'template_id', tmplMap);
    }

    // ── learned tables — full REPLACE (no inbound id FK; keyed by supplier/slug text) ──
    for (const t of ['field_label_overrides', 'field_anchors', 'supplier_hints', 'corrections', 'logo_fingerprints']) {
      const rows = rowsFor(t), cols = colsOf(t);
      // M5: an EMPTY array means "nothing to import", the same as an ABSENT table — NOT
      // "delete everything". Without the `!rows.length` guard a fresh-install backup (which
      // serialises these learned tables as []) would `DELETE FROM` and wipe every anchor,
      // hint, correction and logo on the TARGET machine. `createBackup` already skips an
      // absent table, so absent→skipped must equal empty→skipped.
      if (!rows || !rows.length || !cols) continue;
      db.prepare(`DELETE FROM ${t}`).run();
      let n = 0;
      for (const raw of rows) { insertRow(t, cols, { ...raw }); n++; }
      applied[t] = n;
    }
  })();
  return { applied };
}

module.exports = { createBackup, readBackup, applyBackup, TABLES, FORMAT_VERSION };
