'use strict';

/**
 * database/modules/auth.js
 * Local authentication storage — users, one-time admin recovery codes,
 * and the audit trail. Pure data-access layer: hashing, sessions, and
 * permission rules live in src/modules/auth/.
 */

const crypto = require('crypto');

const VALID_ROLES = ['admin', 'edit', 'readonly'];

// ── Audit hash chain (Stage 5b) ────────────────────────────────────────────────
// The HMAC key is a DPAPI-held secret managed in the main process (src/lib/auditKey.js) and injected
// here via setAuditKey — this data-layer module stays key-agnostic and only chains when a key is set.
// Fields covered by the per-row HMAC, in a FIXED order (a reorder of this list would invalidate every
// existing chain — do NOT change it). Excludes id (assigned on insert) + the chain columns themselves.
let _auditKey = null;
function setAuditKey(buf) { _auditKey = (buf && buf.length >= 16) ? Buffer.from(buf) : null; }
const _AUDIT_HMAC_FIELDS = ['user_id', 'action', 'target_type', 'target_id', 'details',
  'action_category', 'outcome', 'document_id', 'customer_id', 'session_id', 'source',
  'metadata_json', 'actor_username', 'actor_role', 'created_at'];
function _auditRowHmac(prevHash, row) {
  const canonical = String(prevHash) + '\u0001' +
    _AUDIT_HMAC_FIELDS.map(f => (row[f] == null ? '' : String(row[f]))).join('\u0001');
  return crypto.createHmac('sha256', _auditKey).update(canonical, 'utf8').digest('hex');
}

// ── Users ─────────────────────────────────────────────────────────────────────

function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function countActiveAdmins(db, excludeUserId = null) {
  if (excludeUserId == null) {
    return db.prepare(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1`
    ).get().n;
  }
  return db.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id != ?`
  ).get(excludeUserId).n;
}

function getUserByUsername(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
}

function getUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getAllUsers(db) {
  return db.prepare(`
    SELECT id, username, display_name, role, is_active, must_change_password,
           last_login_at, created_at, updated_at
    FROM users ORDER BY created_at ASC
  `).all();
}

function createUser(db, { username, display_name, password_hash, role, must_change_password = 0 }) {
  if (!VALID_ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
  const info = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, role, must_change_password)
    VALUES (@username, @display_name, @password_hash, @role, @must_change_password)
  `).run({ username: String(username).trim(), display_name, password_hash, role, must_change_password: must_change_password ? 1 : 0 });
  return getUserById(db, info.lastInsertRowid);
}

function setUserRole(db, id, role) {
  if (!VALID_ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
  db.prepare(`UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?`).run(role, id);
}

function setUserActive(db, id, isActive) {
  db.prepare(`UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(isActive ? 1 : 0, id);
}

// ── TOTP (second factor for the detached-client auth boundary, migration 25) ──
// Stored on the users row: totp_secret (base32) + totp_enabled (0/1). The secret
// is written by an enrolment "setup" step and only ENABLED once the user proves a
// valid code ("confirm") — so a half-finished enrolment never locks anyone out.
function getTotpForUser(db, id) {
  return db.prepare('SELECT totp_secret, totp_enabled FROM users WHERE id = ?').get(id);
}

function setTotpSecret(db, id, secretBase32) {
  db.prepare(`UPDATE users SET totp_secret = ?, totp_enabled = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(secretBase32, id);
}

function setTotpEnabled(db, id, enabled) {
  db.prepare(`UPDATE users SET totp_enabled = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(enabled ? 1 : 0, id);
}

function clearTotp(db, id) {
  db.prepare(`UPDATE users SET totp_secret = NULL, totp_enabled = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(id);
}

// Used both for admin-initiated resets (mustChange = true, temp password) and
// for a user changing their own password (mustChange = false, clears the flag).
function setUserPassword(db, id, password_hash, mustChange) {
  db.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(password_hash, mustChange ? 1 : 0, id);
}

function touchLastLogin(db, id) {
  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(id);
}

// ── Recovery codes (admin lockout recovery) ──────────────────────────────────
// One active code per user at a time — issuing a new one invalidates any
// earlier unused codes for that user (rotation), so only the most recently
// shown code can ever be redeemed.

function issueRecoveryCode(db, userId, codeHash) {
  const tx = db.transaction(() => {
    db.prepare(`UPDATE recovery_codes SET is_used = 1, used_at = datetime('now')
                WHERE user_id = ? AND is_used = 0`).run(userId);
    return db.prepare(`INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)`)
      .run(userId, codeHash).lastInsertRowid;
  });
  return tx();
}

// Looked up by hash (the code is high-entropy random data, so an exact hash
// match is sufficient — no need to know the username up front).
function findActiveRecoveryCodeByHash(db, codeHash) {
  return db.prepare(`
    SELECT rc.*, u.username, u.display_name, u.role, u.is_active
    FROM recovery_codes rc JOIN users u ON u.id = rc.user_id
    WHERE rc.code_hash = ? AND rc.is_used = 0
  `).get(codeHash);
}

function markRecoveryCodeUsed(db, id) {
  db.prepare(`UPDATE recovery_codes SET is_used = 1, used_at = datetime('now') WHERE id = ?`).run(id);
}

// ── Audit log ─────────────────────────────────────────────────────────────────

// Infer the broad category from the action name (so callers can stay terse).
const _CATEGORY = {
  login_success:'auth', login_failure:'auth', logout:'auth', password_change:'auth',
  password_reset:'auth', user_created:'auth', role_change:'auth', user_enabled:'auth',
  user_disabled:'auth', recovery_code_use:'auth', recovery_code_issued:'auth',
  setting_changed:'settings',
  document_open:'document', document_close:'document', document_deleted:'document',
  review_confirmed:'review', review_deferred:'review', review_restored:'review',
  reprocess:'processing', import_run:'processing',
  template_created:'template', template_updated:'template', template_deleted:'template',
  access_denied:'admin',
};
function categoryFor(action) {
  if (!action) return null;
  if (String(action).startsWith('license.')) return 'licensing';
  return _CATEGORY[action] || null;
}

// GDPR/security guardrail: NEVER persist secrets/PII or contents in metadata.
// Redact by key name; cap value length; never dump nested objects/contents.
// Matches secret-bearing FIELD NAMES (password, token, *_key like license_key,
// recovery code, fingerprint, hash…) — but NOT a field literally named "key"
// (that's a setting's NAME, which is safe and useful to log).
const _REDACT_KEY = /pass|pwd|token|secret|_key|key_|recovery|fingerprint|otp|seed|\bhash\b/i;
function sanitiseAuditMeta(meta) {
  if (meta == null) return null;
  if (typeof meta !== 'object') return { value: String(meta).slice(0, 300) };
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (_REDACT_KEY.test(k)) { out[k] = '[redacted]'; }
    else if (v == null)            { out[k] = null; }
    else if (typeof v === 'object'){ out[k] = '[object]'; }   // no contents / nested dumps
    else                          { out[k] = String(v).slice(0, 300); }
  }
  return out;
}

// Which audit_log columns this DB actually has (old-schema tables → only the
// original five), cached per db so the writer/query degrade gracefully.
const _auditCols = new WeakMap();
function auditColumns(db) {
  let cols = _auditCols.get(db);
  if (!cols) {
    try { cols = new Set(db.prepare('PRAGMA table_info(audit_log)').all().map(r => r.name)); }
    catch { cols = new Set(['user_id','action','target_type','target_id','details']); }
    _auditCols.set(db, cols);
  }
  return cols;
}
// Drop the cached column set for a db handle. Called by migration 55 the moment it adds the chain
// columns, so a pre-migration write (the workflow-paid heal runs BEFORE mig 55 in the same pass and
// may call auditColumns) can't leave a stale set that hides row_hmac for the rest of the session.
function invalidateAuditColumns(db) { try { _auditCols.delete(db); } catch { /* noop */ } }

function addAuditEntry(db, entry) {
  const e = entry || {};
  let { user_id = null, action, target_type = null, target_id = null, details = null,
        action_category = null, outcome = null, document_id = null, customer_id = null,
        session_id = null, source = 'desktop', metadata = null,
        actor_username = null, actor_role = null } = e;
  // Snapshot the actor so the record survives a later rename/deletion.
  if (user_id != null && (actor_username == null || actor_role == null)) {
    try { const u = getUserById(db, user_id);
      if (u) { actor_username = actor_username ?? u.username; actor_role = actor_role ?? u.role; } } catch {}
  }
  const row = {
    user_id, action,
    target_type, target_id: target_id != null ? String(target_id) : null,
    details: details != null ? String(details) : null,
    action_category: action_category || categoryFor(action),
    outcome,
    document_id: document_id != null ? Number(document_id) : null,
    customer_id: customer_id != null ? String(customer_id) : null,
    session_id, source: source || 'desktop',
    metadata_json: metadata != null ? JSON.stringify(sanitiseAuditMeta(metadata)) : null,
    actor_username, actor_role,
  };
  const cols = auditColumns(db);
  // Stage 5b: link this row into the tamper-evident hash chain when a key is set and the columns
  // exist. created_at is fixed HERE (not left to the DB default) so it is covered by the HMAC and a
  // later edit of the timestamp is detectable. INERT when no key (older rows carry NULL hmac).
  if (_auditKey && cols.has('row_hmac') && cols.has('prev_hash')) {
    try {
      if (row.created_at == null) row.created_at = db.prepare("SELECT datetime('now') AS t").get().t;
      const prev = db.prepare('SELECT row_hmac FROM audit_log ORDER BY id DESC LIMIT 1').get();
      row.prev_hash = (prev && prev.row_hmac) || 'GENESIS';
      row.row_hmac  = _auditRowHmac(row.prev_hash, row);
    } catch { /* chain best-effort — never block the audit write */ }
  }
  const use  = Object.keys(row).filter(k => cols.has(k));
  db.prepare(`INSERT INTO audit_log (${use.join(', ')}) VALUES (${use.map(k => '@' + k).join(', ')})`).run(row);
}

// Stage 5b — walk the hash chain and report the first break. `rows` may be the live table alone or the
// live+archive UNION (the IPC attaches archives). Recomputes each row's HMAC from its prev_hash +
// content and checks the prev_hash links the previous row. Rows with a NULL hmac (written before the
// key existed) reset the link to GENESIS — so the chain is verified from the first keyed row onward.
function verifyAuditChainRows(rows) {
  if (!_auditKey) return { ok: false, reason: 'no_key' };
  let prev = 'GENESIS', checked = 0, sawKeyed = false;
  for (const r of rows) {
    if (r.row_hmac == null) {
      // A NULL-hmac row is legitimate ONLY as part of the initial pre-key PREFIX. id is AUTOINCREMENT
      // and pre-key rows always carry the lowest ids (archived rows keep theirs), so under ORDER BY id
      // ASC a genuine inert row can NEVER follow a keyed one. A NULL after a keyed row is therefore
      // either an attacker NULLing a tampered suffix to launder it back to "ok", or terminal key-loss —
      // both must FAIL LOUD. Never fall through to a bare ok:true when keyed rows precede unverifiable ones.
      if (sawKeyed) return { ok: false, brokenAt: r.id, reason: 'null_after_keyed', checked };
      prev = 'GENESIS'; continue;                              // still in the pre-key prefix — fresh link
    }
    if (r.prev_hash !== prev) return { ok: false, brokenAt: r.id, reason: 'prev_hash_mismatch', checked };
    if (_auditRowHmac(r.prev_hash, r) !== r.row_hmac) return { ok: false, brokenAt: r.id, reason: 'hmac_mismatch', checked };
    prev = r.row_hmac; checked++; sawKeyed = true;
  }
  return { ok: true, checked };
}
function verifyAuditChain(db) {
  try { return verifyAuditChainRows(db.prepare('SELECT * FROM audit_log ORDER BY id ASC').all()); }
  catch (e) { return { ok: false, reason: 'read_error', error: e && e.message }; }
}

function getAuditLog(db, limit = 200) {
  return db.prepare(`
    SELECT al.*, u.username AS actor_username_live, u.display_name AS actor_display_name
    FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.id DESC LIMIT ?
  `).all(limit);
}

// Admin search: filter by user / document / customer / category / action /
// outcome / date range / free text, with pagination. Returns { rows, total }.
function getAuditLogFiltered(db, f = {}, opts = {}) {
  const cols = auditColumns(db);
  const where = [], args = {};
  const has = (c) => cols.has(c);
  if (f.user_id)                 { where.push('al.user_id = @user_id'); args.user_id = Number(f.user_id); }
  if (f.username)                { where.push('al.actor_username LIKE @uname'); args.uname = `%${f.username}%`; }
  if (f.document_id && has('document_id')) { where.push('al.document_id = @doc'); args.doc = Number(f.document_id); }
  if (f.customer_id && has('customer_id')) { where.push('al.customer_id LIKE @cust'); args.cust = `%${f.customer_id}%`; }
  if (f.category && has('action_category')){ where.push('al.action_category = @cat'); args.cat = f.category; }
  if (f.action)                  { where.push('al.action = @action'); args.action = f.action; }
  if (f.outcome && has('outcome')){ where.push('al.outcome = @outcome'); args.outcome = f.outcome; }
  if (f.dateFrom)                { where.push('al.created_at >= @from'); args.from = String(f.dateFrom); }
  if (f.dateTo)                  { where.push('al.created_at <= @to'); args.to = String(f.dateTo); }
  if (f.text)                    { where.push('(al.action LIKE @t OR al.details LIKE @t OR al.actor_username LIKE @t)'); args.t = `%${f.text}%`; }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit  = Math.min(Math.max(parseInt(f.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(f.offset, 10) || 0, 0);

  // Archive-aware search (Stage B): when a date bound is set AND monthly archive
  // files (Stage A) overlap the range, transparently MERGE live + archive rows via
  // ATTACH + UNION ALL — only the FROM source changes; WHERE/COUNT/ORDER/LIMIT/JOIN
  // are unchanged. Archived rows keep their original (unique) live `id`, so
  // ORDER BY al.id DESC stays a correct chronological total order and COUNT/LIMIT/
  // OFFSET remain accurate. Recent / live-only searches (no date bound, or no
  // overlapping archive file) are byte-identical. Best-effort: any archive failure
  // degrades to the live-only query and never throws (archivesPartial flags it).
  const ATTACH_CAP = 8;                 // SQLite default attached-DB limit is 10 — leave headroom
  const attached = [];                  // alias names to DETACH afterwards
  let archivesPartial = false;
  let fromExpr = 'audit_log al';        // live-only default (byte-identical path)

  if (opts.archiveDir && (f.dateFrom || f.dateTo)) {
    try {
      const { archiveFilesForRange } = require('./audit_archive');
      const fromYm = f.dateFrom ? String(f.dateFrom).slice(0, 7) : null;
      const toYm   = f.dateTo   ? String(f.dateTo).slice(0, 7)   : null;
      const picked = archiveFilesForRange(opts.archiveDir, fromYm, toYm, ATTACH_CAP);
      archivesPartial = picked.partial;
      if (picked.files.length) {
        const colSql = [...cols].map(c => `"${c}"`).join(', ');
        const parts  = [`SELECT ${colSql} FROM audit_log`];
        picked.files.forEach((file, i) => {
          const alias = `arc${i}`;
          try {
            db.exec(`ATTACH DATABASE '${String(file.path).replace(/'/g, "''")}' AS ${alias}`);
            // Probe + per-archive column presence: a corrupt/locked file or a
            // schema-drifted archive throws here and is cleanly excluded; an absent
            // column is selected as NULL so the UNION stays column-aligned.
            const acols = new Set(db.prepare(`PRAGMA ${alias}.table_info(audit_log)`).all().map(r => r.name));
            const sel = [...cols].map(c => (acols.has(c) ? `"${c}"` : `NULL AS "${c}"`)).join(', ');
            parts.push(`SELECT ${sel} FROM ${alias}.audit_log`);
            attached.push(alias);
          } catch {
            archivesPartial = true;
            try { db.exec(`DETACH DATABASE ${alias}`); } catch { /* ignore */ }
          }
        });
        if (parts.length > 1) fromExpr = `(${parts.join(' UNION ALL ')}) al`;
      }
    } catch { archivesPartial = true; /* fall through to live-only */ }
  }

  let rows, total;
  if (fromExpr === 'audit_log al') {
    // Live-only: byte-identical to the pre-archive behavior (no attachments held).
    total = db.prepare(`SELECT COUNT(*) AS c FROM audit_log al ${clause}`).get(args).c;
    rows  = db.prepare(`
      SELECT al.*, u.username AS actor_username_live, u.display_name AS actor_display_name
      FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
      ${clause} ORDER BY al.id DESC LIMIT ${limit} OFFSET ${offset}
    `).all(args);
  } else {
    try {
      total = db.prepare(`SELECT COUNT(*) AS c FROM ${fromExpr} ${clause}`).get(args).c;
      rows  = db.prepare(`
        SELECT al.*, u.username AS actor_username_live, u.display_name AS actor_display_name
        FROM ${fromExpr} LEFT JOIN users u ON u.id = al.user_id
        ${clause} ORDER BY al.id DESC LIMIT ${limit} OFFSET ${offset}
      `).all(args);
    } catch (e) {
      // Robust fallback: any merged-query failure returns live-only, never throws.
      archivesPartial = true;
      total = db.prepare(`SELECT COUNT(*) AS c FROM audit_log al ${clause}`).get(args).c;
      rows  = db.prepare(`
        SELECT al.*, u.username AS actor_username_live, u.display_name AS actor_display_name
        FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
        ${clause} ORDER BY al.id DESC LIMIT ${limit} OFFSET ${offset}
      `).all(args);
    } finally {
      for (const alias of attached) { try { db.exec(`DETACH DATABASE ${alias}`); } catch { /* ignore */ } }
    }
  }

  const result = { rows, total, limit, offset };
  if (archivesPartial) result.archivesPartial = true;   // additive: only on degraded coverage
  return result;
}

// ── Stamp permission grants (Workflow+Stamping redesign 2026-08-28) ─────────────
// The stamp permission is NOT a flippable column — it is a stream of signed grant/revoke EVENTS that ride
// the tamper-evident audit hash chain above. A hand-INSERTed grant has no valid row_hmac, so the chain
// breaks and the check-time verifier (src/modules/auth/stampPermission.js) refuses. `latestStampGrantState`
// is the raw read (latest event wins); the POLICY (verify chain + require real DPAPI, fail-closed) lives in
// the main-process module, not here. Admin authorisation is enforced by that caller.
function addStampGrantEvent(db, { actorUserId = null, actorUsername = null, actorRole = null,
                                  targetUserId, targetUsername = null, grant } = {}) {
  addAuditEntry(db, {
    user_id: actorUserId,
    action: grant ? 'stamp_permission_granted' : 'stamp_permission_revoked',
    action_category: 'security',
    target_type: 'user', target_id: targetUserId,
    outcome: 'success',
    actor_username: actorUsername, actor_role: actorRole,
    metadata: { target_user_id: targetUserId, target_username: targetUsername },
  });
}
// Latest grant/revoke for a user → 'granted' | 'revoked' | null. target_id is stored as TEXT by
// addAuditEntry, so compare as a string. id DESC = newest event wins (the chain fixes order).
function latestStampGrantState(db, targetUserId) {
  if (targetUserId == null) return null;
  const row = db.prepare(
    `SELECT action FROM audit_log
      WHERE action IN ('stamp_permission_granted','stamp_permission_revoked') AND target_id = ?
      ORDER BY id DESC LIMIT 1`).get(String(targetUserId));
  if (!row) return null;
  return row.action === 'stamp_permission_granted' ? 'granted' : 'revoked';
}

module.exports = {
  VALID_ROLES,
  countUsers, countActiveAdmins,
  getUserByUsername, getUserById, getAllUsers, createUser,
  setUserRole, setUserActive, setUserPassword, touchLastLogin,
  getTotpForUser, setTotpSecret, setTotpEnabled, clearTotp,
  issueRecoveryCode, findActiveRecoveryCodeByHash, markRecoveryCodeUsed,
  addAuditEntry, getAuditLog, getAuditLogFiltered, sanitiseAuditMeta, categoryFor,
  setAuditKey, verifyAuditChain, verifyAuditChainRows, invalidateAuditColumns,
  addStampGrantEvent, latestStampGrantState,
};
