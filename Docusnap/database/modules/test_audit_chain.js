#!/usr/bin/env node
'use strict';

/**
 * database/modules/test_audit_chain.js
 * STAGE 5b — the tamper-evident audit chain. Proves: migration 55 shape; a keyed chain verifies;
 * an out-of-band EDIT (after DROP TRIGGER) is caught by the HMAC chain (the chain, not the trigger,
 * is the evidence); a middle DELETE breaks the chain; the append-only triggers block a naked
 * UPDATE and a naked DELETE; the sanctioned archiver's flag-gated delete round-trips the chain; and
 * src/lib/auditKey.js round-trips a DPAPI-wrapped key file.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_audit_chain.js
 *   (plain `node` works too — no Electron API used except the injected secretStore fake.)
 */

const os = require('os'), path = require('path'), fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const auth = require('./auth');
const archive = require('./audit_archive');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const fresh = () => { const d = new Database(':memory:'); runMigrations(d); return d; };
const seed = (db, n) => { for (let i = 0; i < n; i++) auth.addAuditEntry(db, { action: 'act' + i, details: 'd' + i, outcome: 'success' }); };

const KEY = Buffer.alloc(32, 0x5b);

console.log('\nStage 5b — audit chain');

// ── migration 55 shape ──────────────────────────────────────────────────────
{
  const db = fresh();
  const cols = new Set(db.prepare('PRAGMA table_info(audit_log)').all().map(r => r.name));
  check('mig55 added prev_hash column', cols.has('prev_hash'));
  check('mig55 added row_hmac column', cols.has('row_hmac'));
  check('audit_ctl seeded archiving=0', db.prepare("SELECT v FROM audit_ctl WHERE k='archiving'").get().v === 0);
  const trigs = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'audit_log_%'").all().map(r => r.name));
  check('append-only triggers created', trigs.has('audit_log_noupd') && trigs.has('audit_log_nodel'));
  db.close();
}

// ── a keyed chain verifies; INERT before the key ──────────────────────────────
{
  const db = fresh();
  auth.setAuditKey(null);
  seed(db, 3);                                    // written before a key → NULL hmac (inert)
  check('inert (no key) → not chained', db.prepare('SELECT COUNT(*) n FROM audit_log WHERE row_hmac IS NOT NULL').get().n === 0);
  auth.setAuditKey(KEY);
  seed(db, 6);
  const res = auth.verifyAuditChain(db);
  check('keyed chain verifies ok', res.ok === true);
  check('  → checked exactly the 6 keyed rows', res.checked === 6);
  db.close();
}

// ── out-of-band EDIT is caught by the chain even after the UPDATE trigger is dropped ──
{
  const db = fresh();
  auth.setAuditKey(KEY);
  seed(db, 6);
  db.exec('DROP TRIGGER audit_log_noupd');         // attacker removes the guard...
  db.prepare("UPDATE audit_log SET details='HACKED' WHERE action='act3'").run();  // ...and edits a row
  const res = auth.verifyAuditChain(db);
  check('edited row breaks the chain', res.ok === false && res.reason === 'hmac_mismatch');
  db.close();
}

// ── a middle DELETE (via the archiver bypass) breaks the chain ─────────────────
{
  const db = fresh();
  auth.setAuditKey(KEY);
  seed(db, 6);
  const midId = db.prepare("SELECT id FROM audit_log WHERE action='act3'").get().id;
  db.prepare("UPDATE audit_ctl SET v=1 WHERE k='archiving'").run();   // open the sanctioned gate
  db.prepare('DELETE FROM audit_log WHERE id=?').run(midId);
  db.prepare("UPDATE audit_ctl SET v=0 WHERE k='archiving'").run();
  const res = auth.verifyAuditChain(db);
  check('middle delete breaks the chain', res.ok === false && res.reason === 'prev_hash_mismatch');
  db.close();
}

// ── DOWNGRADE ATTACK: NULLing a tampered suffix's hmac must NOT launder to ok:true ──
// (Oracle SEND-BACK gate.) An attacker drops the triggers, rewrites a SUFFIX, then NULLs its hmacs
// to make the old verifier reset-to-GENESIS and return ok:true. The fixed verifier fails loud.
{
  const db = fresh();
  auth.setAuditKey(KEY);
  seed(db, 6);
  db.exec('DROP TRIGGER audit_log_noupd'); db.exec('DROP TRIGGER audit_log_nodel');
  db.prepare("UPDATE audit_log SET details='FORGED' WHERE id>=4").run();      // rewrite the suffix...
  db.prepare('UPDATE audit_log SET row_hmac=NULL, prev_hash=NULL WHERE id>=4').run(); // ...then launder it
  const res = auth.verifyAuditChain(db);
  check('downgrade attack (NULL suffix) FAILS loud', res.ok === false && res.reason === 'null_after_keyed');
  check('  → and it names the first laundered row', res.brokenAt === 4);
  db.close();
}

// ── TRADE-OFF PIN: terminal key-loss (keyed prefix, then genuine inert NULL rows) → fail, not ok:true ──
// This is the ONLY benign state the null_after_keyed rule rejects, and rejecting it is deliberate: a
// silent ok:true there would re-open the downgrade hole. A future dev must not "restore" the lenient reset.
{
  const db = fresh();
  auth.setAuditKey(KEY);
  seed(db, 3);
  auth.setAuditKey(null);                    // key lost — subsequent rows are inert (NULL hmac)
  seed(db, 2);
  auth.setAuditKey(KEY);                      // key restored for verification
  const res = auth.verifyAuditChain(db);
  check('keyed-prefix + inert-tail FAILS (null_after_keyed)', res.ok === false && res.reason === 'null_after_keyed');
  db.close();
}

// ── the append-only triggers block a naked UPDATE and a naked DELETE ───────────
{
  const db = fresh();
  auth.setAuditKey(KEY);
  seed(db, 3);
  check('naked UPDATE on audit_log is blocked', throws(() => db.prepare("UPDATE audit_log SET details='x' WHERE id=1").run()));
  check('naked DELETE on audit_log is blocked (archiving=0)', throws(() => db.prepare('DELETE FROM audit_log WHERE id=1').run()));
  db.close();
}

// ── the sanctioned archiver moves rows AND the live+archive union still verifies ──
{
  const db = fresh();
  auth.setAuditKey(KEY);
  seed(db, 6);
  const before = db.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
  const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auditarc-'));
  const future = new Date(Date.now() + 400 * 86400000);   // push cutoff ahead so every row is "old"
  const r = archive.runMaintenance(db, { archiveDir, now: future, force: true, Database });
  check('archiver moved rows (flag-gated delete works)', r.archived > 0);
  const liveAfter = db.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
  check('  → live shrank by the archived count', liveAfter === before - r.archived);

  const arcName = fs.readdirSync(archiveDir).find(n => /^audit-\d{4}-\d{2}\.sqlite$/.test(n));
  check('  → a monthly archive file exists', !!arcName);
  const cols = db.prepare('PRAGMA table_info(audit_log)').all().map(c => `"${c.name}"`).join(',');
  db.exec(`ATTACH DATABASE '${path.join(archiveDir, arcName).replace(/'/g, "''")}' AS arc`);
  const union = db.prepare(`SELECT * FROM (SELECT ${cols} FROM audit_log UNION ALL SELECT ${cols} FROM arc.audit_log) ORDER BY id ASC`).all();
  db.exec('DETACH DATABASE arc');
  const vr = auth.verifyAuditChainRows(union);
  check('live+archive union verifies (chain survives archiving)', vr.ok === true);
  check('  → archived rows kept their row_hmac', union.every(x => x.row_hmac));
  db.close();
  try { fs.rmSync(archiveDir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── src/lib/auditKey.js round-trips a DPAPI-wrapped key file ───────────────────
{
  const secret = require('../../src/lib/secretStore');
  // Fake safeStorage: a reversible "encryptor" so we exercise the ENC1 wrap/unwrap path off-Electron.
  secret.__setSafeStorage({
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('FAKE:' + s, 'utf8'),
    decryptString: (b) => Buffer.from(b).toString('utf8').replace(/^FAKE:/, ''),
  });
  const auditKey = require('../../src/lib/auditKey');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auditkey-'));
  auditKey.__setDirForTest(dir);
  const k1 = auditKey.getAuditKey();
  check('auditKey returns a 32-byte buffer', Buffer.isBuffer(k1) && k1.length === 32);
  const stored = fs.readFileSync(path.join(dir, auditKey.FILE_NAME), 'utf8');
  check('  → the key file is ENC1-wrapped at rest', secret.isEncrypted(stored));
  auditKey.__setDirForTest(dir);                   // clear the cache, re-read from disk
  const k2 = auditKey.getAuditKey();
  check('  → a second open returns the SAME key', Buffer.compare(k1, k2) === 0);
  secret.__setSafeStorage(undefined);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── column-cache invalidation: a pre-mig-55 write must not permanently hide row_hmac ──
{
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT,
    target_type TEXT, target_id TEXT, details TEXT, action_category TEXT, outcome TEXT, document_id INTEGER,
    customer_id TEXT, session_id TEXT, source TEXT, metadata_json TEXT, actor_username TEXT, actor_role TEXT,
    created_at TEXT DEFAULT (datetime('now')))`);
  auth.setAuditKey(KEY);
  auth.addAuditEntry(db, { action: 'pre' });                 // caches the column set WITHOUT chain columns
  db.exec('ALTER TABLE audit_log ADD COLUMN prev_hash TEXT');  // ← what migration 55 does
  db.exec('ALTER TABLE audit_log ADD COLUMN row_hmac TEXT');
  auth.addAuditEntry(db, { action: 'stale' });               // stale cache → NOT chained (the latent bug)
  check('repro: stale column cache hides row_hmac', db.prepare("SELECT row_hmac FROM audit_log WHERE action='stale'").get().row_hmac == null);
  auth.invalidateAuditColumns(db);                            // ← the fix mig 55 now performs
  auth.addAuditEntry(db, { action: 'fixed' });
  check('fix: after invalidate, writes chain again', db.prepare("SELECT row_hmac FROM audit_log WHERE action='fixed'").get().row_hmac != null);
  db.close();
}

// ── source guard: no PRODUCTION path hard-deletes a user (Oracle belt) ─────────
// A hard user-delete + foreign_keys=ON cascades ON DELETE SET NULL onto audit_log.user_id — an UPDATE
// the append-only trigger blocks (and which would break the HMAC anyway). The app deactivates users; if
// a future feature adds a hard delete, it must be an explicit, chain-aware decision — so trip here first.
{
  const root = path.join(__dirname, '..', '..');
  const skip = new Set(['node_modules', '.git', 'dist', 'build', 'build_python', 'vendor']);
  const re = /DELETE\s+FROM\s+users\b/i;
  const hits = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || skip.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full); continue; }
      if (!ent.name.endsWith('.js') || /(^|[._-])test/i.test(ent.name)) continue;   // skip tests
      try { if (re.test(fs.readFileSync(full, 'utf8'))) hits.push(path.relative(root, full)); } catch { /* ignore */ }
    }
  };
  try { walk(path.join(root, 'src')); walk(path.join(root, 'database')); } catch { /* best-effort */ }
  check(`no production 'DELETE FROM users' (append-only cascade guard)${hits.length ? ' — found: ' + hits.join(', ') : ''}`, hits.length === 0);
}

console.log('');
if (fails) { console.log(`FAILED: ${fails} check(s)`); process.exit(1); }
console.log('All Stage-5b audit-chain checks passed.');
process.exit(0);
