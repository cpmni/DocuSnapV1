'use strict';

/**
 * database/modules/auth.js
 * Local authentication storage — users, one-time admin recovery codes,
 * and the audit trail. Pure data-access layer: hashing, sessions, and
 * permission rules live in src/modules/auth/.
 */

const VALID_ROLES = ['admin', 'edit', 'readonly'];

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
  const use  = Object.keys(row).filter(k => cols.has(k));
  db.prepare(`INSERT INTO audit_log (${use.join(', ')}) VALUES (${use.map(k => '@' + k).join(', ')})`).run(row);
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
function getAuditLogFiltered(db, f = {}) {
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
  const total  = db.prepare(`SELECT COUNT(*) AS c FROM audit_log al ${clause}`).get(args).c;
  const rows   = db.prepare(`
    SELECT al.*, u.username AS actor_username_live, u.display_name AS actor_display_name
    FROM audit_log al LEFT JOIN users u ON u.id = al.user_id
    ${clause} ORDER BY al.id DESC LIMIT ${limit} OFFSET ${offset}
  `).all(args);
  return { rows, total, limit, offset };
}

module.exports = {
  VALID_ROLES,
  countUsers, countActiveAdmins,
  getUserByUsername, getUserById, getAllUsers, createUser,
  setUserRole, setUserActive, setUserPassword, touchLastLogin,
  issueRecoveryCode, findActiveRecoveryCodeByHash, markRecoveryCodeUsed,
  addAuditEntry, getAuditLog, getAuditLogFiltered, sanitiseAuditMeta, categoryFor,
};
