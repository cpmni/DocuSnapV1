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
    meta: { format: payload.format, app_version: payload.app_version || '', exported_at: payload.exported_at || '' },
    payload,
    summary,
  };
}

/**
 * Apply a validated payload. ONE transaction, FK checks deferred to commit.
 * settings = MERGE (upsert, never deletes device/licensing keys); all other
 * whitelisted tables = REPLACE (delete-all + insert with original IDs so
 * relationships are preserved). Forward-compatible: only restores columns that
 * still exist in the current schema.
 */
function applyBackup(db, payload) {
  const applied = {};
  db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    for (const t of TABLES) {
      const rows = payload.tables[t];
      if (!Array.isArray(rows)) continue;

      let cols;
      try { cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name); }
      catch { continue; }   // table no longer exists in this schema
      if (!cols.length) continue;

      if (t === 'settings') {
        // Merge: upsert each (non-licensing) key; leave other existing keys intact.
        const up = db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ' +
                              'ON CONFLICT(key) DO UPDATE SET value = excluded.value');
        let n = 0;
        for (const r of rows) {
          if (_settingExcluded(r.key)) continue;
          up.run({ key: r.key, value: r.value == null ? null : String(r.value) });
          n++;
        }
        applied[t] = n;
        continue;
      }

      // Replace.
      db.prepare(`DELETE FROM ${t}`).run();
      if (!rows.length) { applied[t] = 0; continue; }
      const useCols = cols.filter(c => Object.prototype.hasOwnProperty.call(rows[0], c));
      if (!useCols.length) { applied[t] = 0; continue; }
      const insert = db.prepare(
        `INSERT INTO ${t} (${useCols.map(c => `"${c}"`).join(', ')}) ` +
        `VALUES (${useCols.map(c => '@' + c).join(', ')})`
      );
      let n = 0;
      for (const r of rows) {
        const params = {};
        for (const c of useCols) params[c] = (r[c] === undefined ? null : r[c]);
        insert.run(params); n++;
      }
      applied[t] = n;
    }
  })();
  return { applied };
}

module.exports = { createBackup, readBackup, applyBackup, TABLES, FORMAT_VERSION };
