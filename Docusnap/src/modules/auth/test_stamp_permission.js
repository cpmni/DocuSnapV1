#!/usr/bin/env node
'use strict';
/**
 * src/modules/auth/test_stamp_permission.js
 * Workflow+Stamping redesign — SLICE 0 (data + permission spine). Proves:
 *   - stamp_types seeded with the 6 defaults; stamp_events is append-only (UPDATE/DELETE blocked);
 *   - the custom-stamp create guards (empty / too long / reserved / bad colour / duplicate);
 *   - the tamper-resistant permission: no grant → refused; admin grant → allowed; revoke → refused;
 *     FAIL-CLOSED when real OS encryption is unavailable; and a hand-INSERTed forged grant breaks the
 *     audit chain → still refused + a `tamper_detected` row (Oracle gate 1 — reproduce the INSERT).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/auth/test_stamp_permission.js
 */

const Database = require('better-sqlite3');
const { runMigrations } = require('../../../database/index');
const auth   = require('../../../database/modules/auth');
const stamps = require('../../../database/modules/stamps');
const perm   = require('./stampPermission');
const secret = require('../../lib/secretStore');

let fails = 0;
const check  = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const fresh  = () => { const d = new Database(':memory:'); runMigrations(d); return d; };
const KEY = Buffer.alloc(32, 0x5b);
// Fake safeStorage reporting encryption AVAILABLE (the packaged-Windows happy path).
const FAKE_SS = { isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('enc:' + s), decryptString: (b) => String(b).replace(/^enc:/, '') };

console.log('\nWorkflow+Stamping slice 0 — catalog + append-only record + stamp permission');

// ── schema: catalog seeded, record append-only ────────────────────────────────
{
  const db = fresh();
  const types = stamps.listStampTypes(db);
  check('stamp_types seeded 6 defaults', types.length === 6);
  check('  all built_in', types.every(t => t.built_in === 1));
  check('  PAID present, hex colour', types.some(t => t.label === 'PAID' && /^#[0-9A-Fa-f]{6}$/.test(t.color)));
  const cols = new Set(db.prepare('PRAGMA table_info(stamp_events)').all().map(r => r.name));
  check('stamp_events has source/artifact hashes + audit_ref',
    cols.has('source_sha256') && cols.has('artifact_sha256') && cols.has('audit_ref'));
  db.prepare(`INSERT INTO stamp_events (document_id, type_label_snapshot, placed_at) VALUES (1,'PAID',datetime('now'))`).run();
  check('stamp_events blocks UPDATE', throws(() => db.prepare(`UPDATE stamp_events SET type_label_snapshot='X' WHERE id=1`).run()));
  check('stamp_events blocks DELETE', throws(() => db.prepare(`DELETE FROM stamp_events WHERE id=1`).run()));
  db.close();
}

// ── catalog create guards ─────────────────────────────────────────────────────
{
  const db = fresh();
  check('reject empty',        stamps.createStampType(db, { label: '  ', color: '#2E7D32' }).code === 'EMPTY');
  check('reject too long',     stamps.createStampType(db, { label: 'THIS IS WAY TOO LONG FOR A STAMP', color: '#2E7D32' }).code === 'TOO_LONG');
  check('reject reserved word', stamps.createStampType(db, { label: 'approved', color: '#2E7D32' }).code === 'RESERVED');
  check('reject bad colour',   stamps.createStampType(db, { label: 'POSTED', color: 'blue' }).code === 'BAD_COLOR');
  check('reject duplicate',    stamps.createStampType(db, { label: 'paid', color: '#2E7D32' }).code === 'DUPLICATE');
  const ok = stamps.createStampType(db, { label: 'Posted', color: '#1565C0', category: 'Accounts' });
  check('create custom ok',    ok.ok === true && ok.id > 0);
  check('  stored uppercased + keyed', (stamps.getStampTypeByKey(db, 'posted') || {}).label === 'POSTED');
  db.close();
}

// ── permission: signed grants, fail-closed, tamper-evident ────────────────────
{
  secret.__setSafeStorage(FAKE_SS);
  auth.setAuditKey(KEY);
  const db = fresh();
  const admin = auth.createUser(db, { username: 'boss', display_name: 'Boss', password_hash: 'x', role: 'admin' });
  const jane  = auth.createUser(db, { username: 'jane', display_name: 'Jane', password_hash: 'x', role: 'edit' });
  const adminActor = { userId: admin.id, username: 'boss', role: 'admin' };
  const editActor  = { userId: jane.id,  username: 'jane', role: 'edit'  };

  check('no grant → cannot stamp',    perm.canStamp(db, jane.id) === false);
  check('non-admin cannot grant',     perm.grantStamp(db, editActor, jane.id).code === 'FORBIDDEN');
  check('admin grants ok',            perm.grantStamp(db, adminActor, jane.id).ok === true);
  check('granted → can stamp',        perm.canStamp(db, jane.id) === true);
  check('admin revokes ok',           perm.revokeStamp(db, adminActor, jane.id).ok === true);
  check('revoked → cannot stamp',     perm.canStamp(db, jane.id) === false);

  perm.grantStamp(db, adminActor, jane.id);
  check('granted again → can stamp',  perm.canStamp(db, jane.id) === true);
  secret.__setSafeStorage(null);      // DPAPI-less host
  check('no real DPAPI → fail closed', perm.canStamp(db, jane.id) === false);
  secret.__setSafeStorage(FAKE_SS);
  check('DPAPI back → can stamp',     perm.canStamp(db, jane.id) === true);

  // TAMPER: hand-INSERT a forged grant (append-only triggers block UPDATE/DELETE, NOT INSERT).
  const tom = auth.createUser(db, { username: 'tom', display_name: 'Tom', password_hash: 'x', role: 'edit' });
  check('tom not granted',            perm.canStamp(db, tom.id) === false);
  db.prepare(`INSERT INTO audit_log (action, action_category, target_type, target_id, outcome, row_hmac, prev_hash)
              VALUES ('stamp_permission_granted','security','user',?, 'success','deadbeef','GENESIS')`).run(String(tom.id));
  check('forged INSERT breaks the chain', auth.verifyAuditChain(db).ok === false);
  check('forged grant → still refused',   perm.canStamp(db, tom.id) === false);
  check('  tamper_detected recorded',     db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='tamper_detected'`).get().n >= 1);

  secret.__setSafeStorage(undefined);
  auth.setAuditKey(null);
  db.close();
}

console.log(`\n${fails === 0 ? 'ALL OK' : fails + ' FAILED'}\n`);
process.exit(fails === 0 ? 0 : 1);
