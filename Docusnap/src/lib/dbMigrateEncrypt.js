'use strict';
/**
 * src/lib/dbMigrateEncrypt.js
 * ---------------------------
 * The one-time, CRASH-SAFE plaintext → encrypted migration for the DB-at-rest arc (slice 2, Oracle
 * SIGN-OFF-W/COND 2026-08-31). gary's manifest state machine — every crash state resolves to a WORKING
 * DB; on ambiguity we keep the SURVIVING PLAINTEXT (data safety over secrecy during the migration only).
 *
 * PROVEN primitives (src/lib/test_db_cipher.js + the encprobe series):
 *   • encrypt a plaintext copy in place: open unkeyed → `PRAGMA hexrekey='<hex>'` → checkpoint (NOT
 *     `rekey`, which treats the hex as a KDF passphrase and will not reopen with `hexkey`);
 *   • `db.backup()` REFUSES a keyed source, so the plaintext `.pre-encrypt` safety copy is taken from the
 *     plaintext live DB (works), and any KEYED copy elsewhere uses VACUUM INTO / a byte copy.
 *
 * The key is passed in (a 32-byte Buffer) — this module never touches DPAPI, so it is testable under
 * electron-as-node without safeStorage. main/onboarding provisions via src/lib/dbKey.js then calls here.
 *
 * Files beside the live DB (userData):
 *   docusnap.db              the live DB
 *   docusnap.db.pre-encrypt  plaintext safety backup (deleted only after a verified swap)
 *   docusnap.db.encrypting   the working encrypted copy being built
 *   docusnap.db.plain-old    the swapped-out plaintext (deleted only after the encrypted DB is live)
 *   docusnap.db.manifest     JSON phase marker driving crash recovery
 */

const fs = require('fs');
const crypto = require('crypto');

const PHASES = { IDLE: 'idle', BACKUP: 'backup', ENCRYPTING: 'encrypting', VERIFY: 'verify', SWAP: 'swap', DONE: 'done' };
const SQLITE_MAGIC = 'SQLite format 3';

function paths(dbPath) {
  return {
    live: dbPath,
    pre: dbPath + '.pre-encrypt',
    work: dbPath + '.encrypting',
    old: dbPath + '.plain-old',
    manifest: dbPath + '.manifest',
    wal: dbPath + '-wal', shm: dbPath + '-shm',
  };
}

function _hasMagic(file) {
  try { return fs.readFileSync(file).subarray(0, 16).toString('binary').startsWith(SQLITE_MAGIC); }
  catch { return false; }
}
function _exists(f) { try { return fs.existsSync(f); } catch { return false; } }
function _rm(f) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* noop */ } }

// Windows can hold a just-closed SQLite file locked for a few ms (AV / lazy handle release), so a rename
// right after close() intermittently throws EBUSY. Retry a handful of times with a short synchronous spin.
function _renameRetry(from, to, tries = 20) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; }
    catch (e) {
      if ((e.code !== 'EBUSY' && e.code !== 'EPERM' && e.code !== 'EACCES') || i >= tries) throw e;
      const until = Date.now() + 25; while (Date.now() < until) { /* brief spin */ }
    }
  }
}

function _readManifest(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function _writeManifest(p, obj) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, p);   // atomic-ish replace so a crash never leaves a half-written manifest
}

// Row-count fingerprint across every user table — the verify's "no data lost" check (plus integrity_check).
function _fingerprint(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  const counts = {};
  for (const t of tables) counts[t] = db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n;
  return counts;
}
function _sameFingerprint(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => b[k] === a[k]);
}

function _assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('dbMigrateEncrypt: key must be a 32-byte Buffer');
  return key.toString('hex');
}

/**
 * Run the migration. `injectCrashAfter` (test-only) = a phase name; the run throws right AFTER that phase's
 * work + manifest write, simulating a power loss. Returns { ok, phasesRun } on success.
 */
function migrate({ dbPath, key, logger, injectCrashAfter } = {}) {
  const Database = require('better-sqlite3');
  const hex = _assertKey(key);
  const P = paths(dbPath);
  if (!_exists(P.live)) throw new Error('dbMigrateEncrypt: no live DB to migrate');
  if (!_hasMagic(P.live)) throw new Error('dbMigrateEncrypt: live DB is not plaintext — already encrypted or corrupt (refusing)');

  const crash = (phase) => { if (injectCrashAfter === phase) throw new Error(`__injected_crash_after_${phase}`); };
  const run = [];

  // ── phase BACKUP: fold WAL into the main file, take the plaintext safety copy ─
  // db.backup() is ASYNC and won't back up a keyed source; a cold fs copy after a TRUNCATE checkpoint +
  // close is synchronous, consistent (no open connection), and byte-exact for the plaintext source.
  _writeManifest(P.manifest, { phase: PHASES.BACKUP, startedAt: new Date().toISOString() });
  { const src = new Database(P.live); src.pragma('wal_checkpoint(TRUNCATE)'); src.close(); }
  _rm(P.wal); _rm(P.shm);
  _rm(P.pre);
  fs.copyFileSync(P.live, P.pre);
  // The plaintext safety copy must exist + verify before we touch anything else.
  { const b = new Database(P.pre, { readonly: true }); const ok = b.pragma('integrity_check', { simple: true }); b.close();
    if (ok !== 'ok') throw new Error('dbMigrateEncrypt: pre-encrypt backup failed integrity_check'); }
  run.push(PHASES.BACKUP); crash(PHASES.BACKUP);

  // ── phase ENCRYPTING: copy the plaintext live → work, hexrekey the copy ──────
  _writeManifest(P.manifest, { phase: PHASES.ENCRYPTING });
  _rm(P.work); _rm(P.work + '-wal'); _rm(P.work + '-shm');
  fs.copyFileSync(P.live, P.work);
  {
    const w = new Database(P.work);
    w.pragma(`hexrekey='${hex}'`);   // raw-key encrypt-in-place (matches PRAGMA hexkey on open)
    w.pragma('wal_checkpoint(TRUNCATE)');
    w.close();
  }
  run.push(PHASES.ENCRYPTING); crash(PHASES.ENCRYPTING);

  // ── phase VERIFY: encrypted opens with the key + fingerprint matches; NEGATIVE controls ──
  _writeManifest(P.manifest, { phase: PHASES.VERIFY });
  {
    const live = new Database(P.live, { readonly: true });
    const liveFp = _fingerprint(live); live.close();

    const enc = new Database(P.work);
    enc.pragma(`hexkey='${hex}'`);
    const integ = enc.pragma('integrity_check', { simple: true });
    const encFp = _fingerprint(enc);
    enc.pragma('wal_checkpoint(TRUNCATE)');   // fold + drop the verify connection's WAL before we swap
    enc.close();
    if (integ !== 'ok') throw new Error('dbMigrateEncrypt: encrypted copy failed integrity_check');
    if (!_sameFingerprint(liveFp, encFp)) throw new Error('dbMigrateEncrypt: row-count fingerprint mismatch (data loss) — aborting');

    // NEGATIVE CONTROL 1: header magic must be ABSENT (not plaintext).
    if (_hasMagic(P.work)) throw new Error('dbMigrateEncrypt: encrypted copy still has the SQLite magic — NOT encrypted');
    // NEGATIVE CONTROL 2: opening WITHOUT the key must FAIL. `finally`-close so a thrown query never
    // leaks the handle (a leaked handle locks the file → EBUSY on the swap rename below).
    let openedNoKey = false, n = null;
    try { n = new Database(P.work, { readonly: true }); n.prepare('SELECT COUNT(*) FROM sqlite_master').get(); openedNoKey = true; }
    catch { /* expected — encrypted file rejects an unkeyed read */ }
    finally { if (n) { try { n.close(); } catch { /* noop */ } } }
    if (openedNoKey) throw new Error('dbMigrateEncrypt: encrypted copy opened WITHOUT the key — encryption not applied');
  }
  run.push(PHASES.VERIFY); crash(PHASES.VERIFY);

  // ── phase SWAP: crash-ordered rename. plain-old ← live, then live ← work ─────
  _writeManifest(P.manifest, { phase: PHASES.SWAP });
  // fold + drop any live/work WAL/SHM so the swapped files are self-contained + unlocked.
  _rm(P.wal); _rm(P.shm);
  _rm(P.work + '-wal'); _rm(P.work + '-shm');
  _rm(P.old);
  _renameRetry(P.live, P.old);       // (crash here: live missing, old = plaintext → recover old→live)
  _renameRetry(P.work, P.live);      // (crash here: live = encrypted, old = plaintext, manifest=swap → mark done)
  _writeManifest(P.manifest, { phase: PHASES.DONE, encrypted: true, finishedAt: new Date().toISOString() });
  run.push(PHASES.SWAP); crash(PHASES.SWAP);   // (crash here: DONE written, residues not yet removed → resolveState finishes)

  // ── success: remove the plaintext residues (they would defeat encryption) ────
  _rm(P.old); _rm(P.pre);
  _rm(P.work + '-wal'); _rm(P.work + '-shm');
  try { logger && logger.info && logger.info('dbMigrateEncrypt: migration complete — DB encrypted'); } catch { /* noop */ }
  return { ok: true, phasesRun: run };
}

/**
 * Called on startup to resolve an interrupted migration to a WORKING DB. Returns a status string:
 *   'plaintext'            — no migration in progress; live is plaintext (normal pre-encryption).
 *   'encrypted'            — migration done; live is encrypted.
 *   'recovered-encrypted'  — crashed after the swap completed; marked done, cleaned residues.
 *   'rolled-back'          — crashed mid-migration or mid-swap; restored the plaintext live, discarded work.
 *   'ambiguous-kept-plaintext' — an unexpected shape; kept whatever plaintext survives, cleared the attempt.
 */
function resolveState({ dbPath, logger } = {}) {
  const P = paths(dbPath);
  const man = _readManifest(P.manifest);
  const liveMagic = _hasMagic(P.live);
  const log = (m) => { try { logger && logger.warn && logger.warn('dbMigrateEncrypt.resolveState: ' + m); } catch { /* noop */ } };

  // No manifest: either never migrated (plaintext) or a completed encrypted install (no residue).
  if (!man) {
    if (_exists(P.live) && !liveMagic) return 'encrypted';         // encrypted, migration long done
    _rm(P.work); _rm(P.work + '-wal'); _rm(P.work + '-shm');       // stray work from an aborted attempt
    return 'plaintext';
  }

  if (man.phase === PHASES.DONE) {
    _rm(P.old); _rm(P.pre); _rm(P.work); _rm(P.manifest);
    return 'encrypted';
  }

  // Crashed at SWAP — the delicate window. (_hasMagic TRUE = plaintext "SQLite format 3"; FALSE = encrypted.)
  if (man.phase === PHASES.SWAP) {
    if (_exists(P.live) && liveMagic) {
      // live is still PLAINTEXT → the first rename (live→old) hadn't taken. Discard the encrypted work,
      // keep plaintext. (If plain-old also somehow exists, the plaintext live is the authority.)
      _rm(P.work); _rm(P.old); _rm(P.pre); _rm(P.manifest);
      log('crash at swap with plaintext live — discarded encrypted work, kept plaintext');
      return 'rolled-back';
    }
    if (_exists(P.live) && !liveMagic) {
      // live is ENCRYPTED → both renames completed before the DONE write. Finish the transaction.
      _rm(P.old); _rm(P.pre); _rm(P.manifest);
      log('crash at swap with encrypted live — swap had completed, marked done');
      return 'recovered-encrypted';
    }
    // live MISSING → the first rename happened, the second didn't. Restore plain-old → live.
    if (_exists(P.old) && _hasMagic(P.old)) {
      fs.renameSync(P.old, P.live);
      _rm(P.work); _rm(P.pre); _rm(P.manifest);
      log('crash mid-swap, live missing — restored plaintext from plain-old');
      return 'rolled-back';
    }
    // Nothing usable at live/old — fall back to the pre-encrypt plaintext safety copy.
    if (_exists(P.pre) && _hasMagic(P.pre)) {
      fs.renameSync(P.pre, P.live);
      _rm(P.work); _rm(P.old); _rm(P.manifest);
      log('crash mid-swap, live+old gone — restored plaintext from pre-encrypt backup');
      return 'ambiguous-kept-plaintext';
    }
    log('crash mid-swap and NO plaintext survivor found — manual recovery required');
    return 'ambiguous-kept-plaintext';
  }

  // Crashed at BACKUP / ENCRYPTING / VERIFY — live was NEVER touched. Discard work + attempt, keep live.
  _rm(P.work); _rm(P.work + '-wal'); _rm(P.work + '-shm'); _rm(P.pre); _rm(P.manifest);
  log(`crash at ${man.phase} — live untouched, discarded the attempt (plaintext preserved)`);
  return 'rolled-back';
}

module.exports = { PHASES, paths, migrate, resolveState, _fingerprint, _hasMagic };
