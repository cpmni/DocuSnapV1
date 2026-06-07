#!/usr/bin/env node
'use strict';

/**
 * src/modules/auth/test_auth.js
 * --------------------------------
 * End-to-end test of local authentication: password hashing, first-run admin
 * bootstrap, session/role enforcement, the forced password-change flow, admin
 * user management (create / reset / disable / role changes), the last-admin
 * lockout guards, and the one-time admin-recovery-code path.
 *
 * This drives the REAL handler module (./handler.js) — not a mock of the auth
 * layer — against an in-memory better-sqlite3 database whose schema is a
 * verbatim copy of migration 7 (see database/index.js, runJsMigrations). A
 * fake `ipcMain` just records the registered handlers so the test can invoke
 * them the same way Electron's IPC layer would (handler(event, payload)),
 * exercising the actual data-access layer (database/modules/auth.js) and the
 * actual Argon2id/SHA-256 hashing (./password.js) underneath.
 *
 * Why Electron-as-Node: better-sqlite3 here is a native addon rebuilt against
 * Electron's bundled Node ABI (see database/index.js / electron-builder
 * install-app-deps), not the system Node used to run plain `node` scripts —
 * loading it from system Node fails with a NODE_MODULE_VERSION mismatch.
 * Running the test through Electron's own Node runtime uses the matching ABI,
 * exactly like the shipped app does.
 *
 * Usage (from the project root):
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/auth/test_auth.js
 *
 * Exit code 0 = behaves as expected. Exit code 1 = regression.
 */

const Database   = require('better-sqlite3');
const authDb     = require('../../../database/modules/auth');
const authModule = require('./handler');
const pw         = require('./password');

function check(label, condition) {
  console.log(`  ${condition ? 'OK ' : 'BAD'} ${label}`);
  return condition;
}

function section(title) {
  console.log(`\n${title}`);
}

const silentLogger = { log() {}, warn() {}, err() {} };

// ── In-memory DB — verbatim copy of migration 7's schema (database/index.js),
// so the test exercises the real CHECK constraints, foreign keys and
// collations rather than an approximation of them.
function makeTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      username             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
      display_name         TEXT    NOT NULL,
      password_hash        TEXT    NOT NULL,
      role                 TEXT    NOT NULL CHECK(role IN ('admin','edit','readonly')),
      is_active            INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      last_login_at        TEXT,
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE recovery_codes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash   TEXT    NOT NULL,
      is_used     INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      used_at     TEXT
    );
    CREATE TABLE audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action      TEXT    NOT NULL,
      target_type TEXT,
      target_id   TEXT,
      details     TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

// ── Fake ipcMain — records the registered handlers so they can be invoked
// directly, the same shape Electron uses: handler(event, payload).
function makeFakeIpcMain() {
  const handlers = {};
  return { handlers, handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { handlers[ch] = fn; } };
}

function lastAuditEntry(db, action, targetId) {
  return authDb.getAuditLog(db, 200).find(e =>
    e.action === action && (targetId == null || String(e.target_id) === String(targetId)));
}

async function main() {
  let failures = 0;
  const pass = (label, cond) => { if (!check(label, cond)) failures++; };

  // ════════════════════════════════════════════════════════════════════════
  section('1. Password hashing & verification (Argon2id) — pure, no DB');
  // ════════════════════════════════════════════════════════════════════════
  {
    const hash = await pw.hashPassword('correct horse battery staple');
    pass('hash looks like an argon2id hash',                     hash.startsWith('$argon2id$'));
    pass('correct password verifies',                            await pw.verifyPassword(hash, 'correct horse battery staple') === true);
    pass('wrong password (even a near-miss) fails',              await pw.verifyPassword(hash, 'Correct Horse Battery Staple') === false);
    pass('a malformed/foreign hash fails closed without throwing', await pw.verifyPassword('not-a-real-hash', 'anything') === false);
    pass('a missing hash fails closed',                          await pw.verifyPassword(null, 'anything') === false);
  }

  // ════════════════════════════════════════════════════════════════════════
  section('2. High-entropy secrets — recovery codes & temp passwords (SHA-256)');
  // ════════════════════════════════════════════════════════════════════════
  {
    const code = pw.generateRecoveryCode();
    const temp = pw.generateTempPassword();
    pass('recovery code is 4 dash-grouped blocks of 4',          /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code));
    pass('temp password is a bare 12-character string',          /^[A-Z0-9]{12}$/.test(temp));
    pass('visually-confusable characters (0/O/1/I/L) never appear', !/[01OIL]/.test(code) && !/[01OIL]/.test(temp));
    pass('hashSecret ignores case, dashes and spaces — same code hashes the same either way',
      pw.hashSecret(code) === pw.hashSecret(code.toLowerCase().replace(/-/g, ' ')));
    pass('hashSecret still distinguishes two different codes', pw.hashSecret(code) !== pw.hashSecret(pw.generateRecoveryCode()));
  }

  // ── Wire the real handler module to an in-memory DB ───────────────────────
  const db      = makeTestDb();
  const ipcMain = makeFakeIpcMain();
  authModule.register({ ipcMain, getDb: () => db, notifyAllWindows: () => {}, logger: silentLogger });
  const call = (channel, data) => ipcMain.handlers[channel](null, data);
  // For handlers that throw (the requireRole/requireLogin gates) rather than
  // resolving to {success:false} — both the FORBIDDEN/AUTH_REQUIRED Errors
  // raised synchronously and any promise rejection land here.
  const expectThrow = async (channel, data) => { try { await call(channel, data); return null; } catch (e) { return e; } };

  let adminId, adminRecoveryCode;
  let editUserId, viewerUserId;
  const editKnownPassword   = 'EditChosen456';
  const viewerKnownPassword = 'ViewerChosen789';

  // ════════════════════════════════════════════════════════════════════════
  section('3. First-run admin creation');
  // ════════════════════════════════════════════════════════════════════════
  {
    let status = await call('auth-get-status');
    pass('a fresh database reports that first-run setup is needed', status.needsFirstRunSetup === true);

    const bad = await call('auth-first-run-setup', { username: 'admin', displayName: 'Site Admin', password: 'short', confirmPassword: 'short' });
    pass('rejects a too-short password before creating anyone', bad.success === false && authDb.countUsers(db) === 0);

    const r = await call('auth-first-run-setup', {
      username: 'admin', displayName: 'Site Admin', password: 'AdminPass123', confirmPassword: 'AdminPass123',
    });
    pass('first-run setup succeeds',                  r.success === true);
    pass('the first account created is an Admin',     r.user && r.user.role === 'admin');
    pass('a one-time recovery code is issued and returned (shown only here, never again)',
      typeof r.recoveryCode === 'string' && r.recoveryCode.length > 0);
    pass('setup logs the new admin straight in',      authModule.getCurrentUser() && authModule.getCurrentUser().role === 'admin');

    adminId = r.user.id;
    adminRecoveryCode = r.recoveryCode;

    const row = authDb.getUserById(db, adminId);
    pass('the stored admin row needs no forced password change', row.role === 'admin' && row.must_change_password === 0);
    pass('the bootstrap is fully audited (creation, recovery code issued, auto sign-in)',
      !!lastAuditEntry(db, 'user_created', adminId) &&
      !!lastAuditEntry(db, 'recovery_code_issued', adminId) &&
      !!lastAuditEntry(db, 'login_success', adminId));

    const again = await call('auth-first-run-setup', { username: 'someone', displayName: 'X', password: 'WhateverPass1', confirmPassword: 'WhateverPass1' });
    pass('first-run setup cannot run a second time',   again.success === false && /already been completed/.test(again.error));
    pass('the rejected re-attempt created no extra account', authDb.countUsers(db) === 1);

    status = await call('auth-get-status');
    pass('status now reports setup as complete', status.needsFirstRunSetup === false);
  }

  // ════════════════════════════════════════════════════════════════════════
  section('4. Session primitives — requireLogin / requireRole / hasRole');
  // ════════════════════════════════════════════════════════════════════════
  {
    pass('hasRole reflects the live session',                         authModule.hasRole('admin') === true && authModule.hasRole('edit') === false);
    pass('requireLogin returns the session for any signed-in user',   authModule.requireLogin().role === 'admin');
    pass('requireRole admits a session whose role is in the list',    (() => { try { return authModule.requireRole('admin').role === 'admin'; } catch { return false; } })());
    pass('requireRole rejects a session whose role is not listed, with FORBIDDEN', (() => {
      try { authModule.requireRole('edit', 'readonly'); return false; }
      catch (e) { return e.code === 'FORBIDDEN'; }
    })());

    await call('auth-logout');
    pass('logout clears the shared session',                          authModule.getCurrentUser() === null);
    pass('hasRole is false for every role once signed out',           authModule.hasRole('admin') === false && authModule.hasRole('readonly') === false);
    pass('requireLogin throws AUTH_REQUIRED (not FORBIDDEN) when nobody is signed in', (() => {
      try { authModule.requireLogin(); return false; }
      catch (e) { return e.code === 'AUTH_REQUIRED'; }
    })());
    pass('requireRole() called with no roles still fails as AUTH_REQUIRED first — the zero-args footgun is avoided', (() => {
      try { authModule.requireRole(); return false; }
      catch (e) { return e.code === 'AUTH_REQUIRED'; }
    })());

    const back = await call('auth-login', { username: 'admin', password: 'AdminPass123' });
    pass('the admin can sign back in with their own chosen password', back.success === true && back.user.role === 'admin');
  }

  // ════════════════════════════════════════════════════════════════════════
  section('5. Generic login failures — no username-vs-password disclosure');
  // ════════════════════════════════════════════════════════════════════════
  {
    const unknownUser = await call('auth-login', { username: 'nobody-such-account', password: 'WhateverPass1' });
    const wrongPass   = await call('auth-login', { username: 'admin', password: 'TotallyWrongPass1' });
    pass('an unknown username and a wrong password fail with the exact same message',
      unknownUser.success === false && wrongPass.success === false && unknownUser.error === wrongPass.error);
    pass('that message gives no hint which part was wrong', unknownUser.error === 'Invalid username or password.');
    pass('neither failure starts a session', authModule.getCurrentUser() === null || authModule.getCurrentUser().username === 'admin');
  }

  // ════════════════════════════════════════════════════════════════════════
  section('6. Admin creates Edit & Read Only users — must-change-password flow');
  // ════════════════════════════════════════════════════════════════════════
  {
    const dup = await call('auth-create-user', { username: 'admin', displayName: 'Duplicate', role: 'edit' });
    pass('cannot create a user whose username is already taken', dup.success === false && /already in use/.test(dup.error));

    const badRole = await call('auth-create-user', { username: 'whoever', displayName: 'Whoever', role: 'superuser' });
    pass('rejects a role outside admin/edit/readonly', badRole.success === false);

    const editRes = await call('auth-create-user', { username: 'j.smith', displayName: 'Jordan Smith', role: 'edit' });
    pass('creates the Edit account',                    editRes.success === true);
    pass('hands back a one-time temporary password',    /^[A-Z0-9]{12}$/.test(editRes.tempPassword));
    pass('the response never carries a password hash',  editRes.user && editRes.user.password_hash === undefined);
    editUserId = editRes.user.id;

    pass('the new account is forced to change its password on first login',
      authDb.getUserById(db, editUserId).must_change_password === 1);

    await call('auth-logout');
    const first = await call('auth-login', { username: 'j.smith', password: editRes.tempPassword });
    pass('signs in with the temporary password',        first.success === true);
    pass('login reports that a forced change is required', first.mustChangePassword === true);

    const tooShort = await call('auth-set-new-password-after-reset', { newPassword: 'short', confirmPassword: 'short' });
    pass('the forced-change step rejects a weak replacement', tooShort.success === false);

    const changed = await call('auth-set-new-password-after-reset', { newPassword: editKnownPassword, confirmPassword: editKnownPassword });
    pass('a valid replacement is accepted and clears the flag',
      changed.success === true && authDb.getUserById(db, editUserId).must_change_password === 0);

    const again = await call('auth-set-new-password-after-reset', { newPassword: 'AnotherOne123', confirmPassword: 'AnotherOne123' });
    pass('the forced-change step cannot run again once the flag is cleared',
      again.success === false && /No password change is required/.test(again.error));

    await call('auth-logout');
    const relogin = await call('auth-login', { username: 'j.smith', password: editKnownPassword });
    pass('the self-chosen password now signs them in with no further change required',
      relogin.success === true && relogin.mustChangePassword === false);

    // Hand control back to the admin to provision the Read Only account.
    await call('auth-logout');
    await call('auth-login', { username: 'admin', password: 'AdminPass123' });
    const viewerRes = await call('auth-create-user', { username: 'r.viewer', displayName: 'Riley Viewer', role: 'readonly' });
    pass('creates the Read Only account', viewerRes.success === true);
    viewerUserId = viewerRes.user.id;

    await call('auth-logout');
    await call('auth-login', { username: 'r.viewer', password: viewerRes.tempPassword });
    await call('auth-set-new-password-after-reset', { newPassword: viewerKnownPassword, confirmPassword: viewerKnownPassword });
  }

  // ════════════════════════════════════════════════════════════════════════
  section('7. Read Only: signed-in reads work, edit/admin actions are refused');
  // ════════════════════════════════════════════════════════════════════════
  {
    await call('auth-logout');
    const viewerLogin = await call('auth-login', { username: 'r.viewer', password: viewerKnownPassword });
    pass('the Read Only user signs in with their own chosen password',
      viewerLogin.success === true && viewerLogin.user.role === 'readonly');

    pass('requireLogin (the gate shared read-paths like search/preview use) admits them',
      (() => { try { return authModule.requireLogin().role === 'readonly'; } catch { return false; } })());
    pass('requireRole(admin, edit) — the gate review & processing handlers use — refuses them with FORBIDDEN', (() => {
      try { authModule.requireRole('admin', 'edit'); return false; }
      catch (e) { return e.code === 'FORBIDDEN'; }
    })());
    pass('requireRole(admin) — the gate user-management/settings handlers use — refuses them too', (() => {
      try { authModule.requireRole('admin'); return false; }
      catch (e) { return e.code === 'FORBIDDEN'; }
    })());
    pass('hasRole confirms exactly one role is true for them',
      authModule.hasRole('readonly') === true && authModule.hasRole('admin', 'edit') === false);

    // Re-check the actual IPC boundary the renderer would hit, not just the
    // primitive — the user-management endpoint must itself reject them.
    const err = await expectThrow('auth-list-users', {});
    pass('auth-list-users itself rejects a Read Only session (defense at the IPC layer, not just hidden UI)',
      err && err.code === 'FORBIDDEN');
  }

  // ════════════════════════════════════════════════════════════════════════
  section('8. Disabling an account immediately blocks sign-in');
  // ════════════════════════════════════════════════════════════════════════
  {
    await call('auth-logout');
    await call('auth-login', { username: 'admin', password: 'AdminPass123' });

    const disable = await call('auth-set-user-active', { userId: viewerUserId, isActive: false });
    pass('admin disables the viewer account', disable.success === true && authDb.getUserById(db, viewerUserId).is_active === 0);

    await call('auth-logout');
    const blocked = await call('auth-login', { username: 'r.viewer', password: viewerKnownPassword });
    pass('a disabled account cannot sign in even with the correct password',
      blocked.success === false && /disabled/i.test(blocked.error));
    pass('the rejection does not start a session', authModule.getCurrentUser() === null);
    pass('the audit trail records the real reason ("disabled") even though the user only sees a generic message', (() => {
      const e = lastAuditEntry(db, 'login_failure', viewerUserId);
      return e && e.details === 'disabled';
    })());

    await call('auth-login', { username: 'admin', password: 'AdminPass123' });
    const reenable = await call('auth-set-user-active', { userId: viewerUserId, isActive: true });
    pass('admin re-enables the account', reenable.success === true);
    await call('auth-logout');
    const restored = await call('auth-login', { username: 'r.viewer', password: viewerKnownPassword });
    pass('a re-enabled account can sign in again with its existing password', restored.success === true);

    await call('auth-logout');
    await call('auth-login', { username: 'admin', password: 'AdminPass123' });
  }

  // ════════════════════════════════════════════════════════════════════════
  section('9. Admin resets another user’s password');
  // ════════════════════════════════════════════════════════════════════════
  {
    const reset = await call('auth-admin-reset-password', { userId: editUserId });
    pass('admin issues a one-time temporary password for j.smith',
      reset.success === true && /^[A-Z0-9]{12}$/.test(reset.tempPassword));
    pass('the reset forces a password change on next login',
      authDb.getUserById(db, editUserId).must_change_password === 1);
    pass('the audit entry attributes the reset to the admin who performed it, not the target', (() => {
      const e = lastAuditEntry(db, 'password_reset', editUserId);
      return e && Number(e.user_id) === adminId && e.details === 'admin_reset';
    })());

    await call('auth-logout');
    const oldPassword = await call('auth-login', { username: 'j.smith', password: editKnownPassword });
    pass('the old self-chosen password stops working the moment an admin resets it', oldPassword.success === false);

    const withTemp = await call('auth-login', { username: 'j.smith', password: reset.tempPassword });
    pass('the new temporary password signs them in and re-engages the forced-change flow',
      withTemp.success === true && withTemp.mustChangePassword === true);

    await call('auth-set-new-password-after-reset', { newPassword: editKnownPassword, confirmPassword: editKnownPassword });
    await call('auth-logout');
    await call('auth-login', { username: 'admin', password: 'AdminPass123' });
  }

  // ════════════════════════════════════════════════════════════════════════
  section('10. The sole Admin cannot be demoted, disabled, or otherwise locked out');
  // ════════════════════════════════════════════════════════════════════════
  {
    const demote = await call('auth-set-user-role', { userId: adminId, role: 'edit' });
    pass('cannot demote the only active admin', demote.success === false && /At least one active Admin/.test(demote.error));
    pass('their role is left untouched on the row', authDb.getUserById(db, adminId).role === 'admin');

    const disableSelf = await call('auth-set-user-active', { userId: adminId, isActive: false });
    pass('cannot disable your own account (the self-guard fires before the lockout guard)',
      disableSelf.success === false && /cannot disable your own account/i.test(disableSelf.error));

    const promote = await call('auth-set-user-role', { userId: editUserId, role: 'admin' });
    pass('promoting a second user to Admin succeeds', promote.success === true);
    pass('the role change is audited', (() => {
      const e = lastAuditEntry(db, 'role_change', editUserId);
      return e && /edit -> admin/.test(e.details || '');
    })());

    const demoteNowOk = await call('auth-set-user-role', { userId: editUserId, role: 'edit' });
    pass('once a second active admin exists, demoting one of them succeeds', demoteNowOk.success === true);
    pass('exactly one active admin remains afterwards', authDb.countActiveAdmins(db) === 1);
  }

  // ════════════════════════════════════════════════════════════════════════
  section('11. One-time admin-recovery code — success, invalid, and reuse paths');
  // ════════════════════════════════════════════════════════════════════════
  {
    await call('auth-logout');

    const garbage = await call('auth-recover-admin', { recoveryCode: 'NOT-AREA-LCOD-EVER', newPassword: 'WhateverPass1', confirmPassword: 'WhateverPass1' });
    pass('a code that was never issued fails with the generic recovery message',
      garbage.success === false && /invalid or has already been used/.test(garbage.error));
    pass('a failed redemption is still audited, generically (no account details leak)',
      authDb.getAuditLog(db, 200).some(e => e.action === 'recovery_code_use' && e.details === 'failed'));

    const recoveredPassword = 'RecoveredPass789';
    const ok = await call('auth-recover-admin', { recoveryCode: adminRecoveryCode, newPassword: recoveredPassword, confirmPassword: recoveredPassword });
    pass('the original first-run code redeems successfully',     ok.success === true);
    pass('redemption signs the admin straight back in',          ok.user && ok.user.role === 'admin');
    pass('a brand-new code is issued and returned — shown once, just like first-run, never retrievable again',
      typeof ok.recoveryCode === 'string' && ok.recoveryCode !== adminRecoveryCode);
    pass('the redemption is fully audited (use, reset, rotation)',
      !!lastAuditEntry(db, 'recovery_code_use', adminId) &&
      !!lastAuditEntry(db, 'password_reset', adminId) &&
      !!lastAuditEntry(db, 'recovery_code_issued', adminId));

    const rotatedCode = ok.recoveryCode;

    const reuse = await call('auth-recover-admin', { recoveryCode: adminRecoveryCode, newPassword: 'Whatever1234', confirmPassword: 'Whatever1234' });
    pass('the just-spent code cannot be redeemed a second time (single-use enforced)',
      reuse.success === false && /invalid or has already been used/.test(reuse.error));

    await call('auth-logout');
    const relogin = await call('auth-login', { username: 'admin', password: recoveredPassword });
    pass('the password chosen during recovery is what now signs the admin in', relogin.success === true);

    await call('auth-logout');
    const second = await call('auth-recover-admin', { recoveryCode: rotatedCode, newPassword: 'SecondRecover1', confirmPassword: 'SecondRecover1' });
    pass('the rotated code redeems too, and rotates again — recovery keeps working across uses',
      second.success === true && second.recoveryCode !== rotatedCode && second.recoveryCode !== adminRecoveryCode);

    const reuseRotated = await call('auth-recover-admin', { recoveryCode: rotatedCode, newPassword: 'Whatever1234', confirmPassword: 'Whatever1234' });
    pass('the rotated code is single-use too, the moment it is spent', reuseRotated.success === false);
  }

  console.log();
  if (failures) {
    console.log(`${failures} check(s) failed — local authentication regressed.`);
    process.exitCode = 1;
    return;
  }
  console.log('All checks passed — local authentication behaves as expected.');
}

main().catch((e) => {
  console.error('Test run crashed:', e);
  process.exitCode = 1;
});
