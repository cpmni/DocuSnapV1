'use strict';
/**
 * src/lib/dbMigrateEncrypt.js
 * ---------------------------
 * The one-time, CRASH-SAFE plaintext → encrypted migration for the DB-at-rest arc (code-as-passphrase;
 * Oracle SIGN-OFF-W/COND 2026-08-31). gary's manifest state machine — every crash state resolves to a
 * WORKING DB; on ambiguity we keep the SURVIVING PLAINTEXT (data safety over secrecy during the
 * migration only).
 *
 * PASSPHRASE MODE (multiple-ciphers): the DB is keyed by the printed RECOVERY CODE, KDF salt in the file
 * header (so the encrypted file is self-sufficient — code + file opens anywhere). The pragma sequence is
 * OWNED by src/lib/dbKey.js (`applyRekey` to encrypt, `applyKey` to open) so open/migration/tool can
 * never diverge. `rekey` is REFUSED in WAL mode, so the encrypt step forces `journal_mode = DELETE`
 * first — which leaves a `-journal` sidecar that every cleanup below must remove.
 *
 * The CODE is passed in — this module never touches DPAPI, so it is testable under electron-as-node.
 * main/onboarding provisions via dbKey.js (which caches the code DPAPI-wrapped) then calls here.
 *
 * Files beside the live DB (userData):
 *   docusnap.db              the live DB
 *   docusnap.db.pre-encrypt  plaintext safety backup (deleted only after a verified swap)
 *   docusnap.db.encrypting   the working encrypted copy being built
 *   docusnap.db.plain-old    the swapped-out plaintext (deleted only after the encrypted DB is live)
 *   docusnap.db.manifest     JSON phase marker driving crash recovery
 */

const fs = require('fs');
const dbKey = require('./dbKey');

const PHASES = { IDLE: 'idle', BACKUP: 'backup', ENCRYPTING: 'encrypting', VERIFY: 'verify', SWAP: 'swap', DONE: 'done' };
const SQLITE_MAGIC = 'SQLite format 3';

function paths(dbPath) {
  return {
    live: dbPath,
    pre: dbPath + '.pre-encrypt',
    work: dbPath + '.encrypting',
    old: dbPath + '.plain-old',
    manifest: dbPath + '.manifest',
    wal: dbPath + '-wal', shm: dbPath + '-shm', journal: dbPath + '-journal',
  };
}

function _hasMagic(file) {
  try { return fs.readFileSync(file).subarray(0, 16).toString('binary').startsWith(SQLITE_MAGIC); }
  catch { return false; }
}
function _exists(f) { try { return fs.existsSync(f); } catch { return false; } }
function _rm(f) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* noop */ } }
// The work file's transient sidecars (WAL from the copy, journal from DELETE-mode rekey).
function _rmWorkSidecars(P) { _rm(P.work + '-wal'); _rm(P.work + '-shm'); _rm(P.work + '-journal'); }

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

/**
 * Run the migration. `code` = the recovery code (display or normalised). `injectCrashAfter` (test-only) =
 * a phase name; the run throws right AFTER that phase's work + manifest write, simulating a power loss.
 * Returns { ok, phasesRun } on success.
 */
function migrate({ dbPath, code, logger, injectCrashAfter } = {}) {
  const Database = require('better-sqlite3');
  const norm = dbKey.normaliseCode(code);
  if (!dbKey.isValidNormalised(norm)) throw new Error('dbMigrateEncrypt: invalid recovery code');
  const P = paths(dbPath);
  if (!_exists(P.live)) throw new Error('dbMigrateEncrypt: no live DB to migrate');
  if (!_hasMagic(P.live)) throw new Error('dbMigrateEncrypt: live DB is not plaintext — already encrypted or corrupt (refusing)');

  const crash = (phase) => { if (injectCrashAfter === phase) throw new Error(`__injected_crash_after_${phase}`); };
  const run = [];

  // ── phase BACKUP: fold WAL into the main file, take the plaintext safety copy ─
  // A cold fs copy after a TRUNCATE checkpoint + close is synchronous, consistent (no open connection),
  // and byte-exact for the plaintext source (db.backup() is async AND refuses a keyed source).
  _writeManifest(P.manifest, { phase: PHASES.BACKUP, startedAt: new Date().toISOString() });
  { const src = new Database(P.live); src.pragma('wal_checkpoint(TRUNCATE)'); src.close(); }
  _rm(P.wal); _rm(P.shm);
  _rm(P.pre);
  fs.copyFileSync(P.live, P.pre);
  { const b = new Database(P.pre, { readonly: true }); const ok = b.pragma('integrity_check', { simple: true }); b.close();
    if (ok !== 'ok') throw new Error('dbMigrateEncrypt: pre-encrypt backup failed integrity_check'); }
  run.push(PHASES.BACKUP); crash(PHASES.BACKUP);

  // ── phase ENCRYPTING: copy the plaintext live → work, rekey the copy by passphrase ─
  _writeManifest(P.manifest, { phase: PHASES.ENCRYPTING });
  _rm(P.work); _rmWorkSidecars(P);
  fs.copyFileSync(P.live, P.work);
  {
    const w = new Database(P.work);
    w.pragma('journal_mode = DELETE');   // rekey is REFUSED in WAL mode
    dbKey.applyRekey(w, norm);           // cipher + kdf_iter + rekey='<normalised-code>' (encrypt in place)
    w.close();
  }
  _rmWorkSidecars(P);
  run.push(PHASES.ENCRYPTING); crash(PHASES.ENCRYPTING);

  // ── phase VERIFY: encrypted opens with the code + fingerprint matches; NEGATIVE controls ──
  _writeManifest(P.manifest, { phase: PHASES.VERIFY });
  {
    const live = new Database(P.live, { readonly: true });
    const liveFp = _fingerprint(live); live.close();

    const enc = new Database(P.work);
    dbKey.applyKey(enc, norm);
    const integ = enc.pragma('integrity_check', { simple: true });
    const encFp = _fingerprint(enc);
    enc.close();
    if (integ !== 'ok') throw new Error('dbMigrateEncrypt: encrypted copy failed integrity_check');
    if (!_sameFingerprint(liveFp, encFp)) throw new Error('dbMigrateEncrypt: row-count fingerprint mismatch (data loss) — aborting');

    // NEGATIVE CONTROL 1: header magic must be ABSENT (not plaintext).
    if (_hasMagic(P.work)) throw new Error('dbMigrateEncrypt: encrypted copy still has the SQLite magic — NOT encrypted');
    // NEGATIVE CONTROL 2: opening WITHOUT the code must FAIL. finally-close so a thrown query never
    // leaks the handle (a leaked handle locks the file → EBUSY on the swap rename below).
    let openedNoKey = false, n = null;
    try { n = new Database(P.work, { readonly: true }); n.prepare('SELECT COUNT(*) FROM sqlite_master').get(); openedNoKey = true; }
    catch { /* expected — encrypted file rejects an unkeyed read */ }
    finally { if (n) { try { n.close(); } catch { /* noop */ } } }
    if (openedNoKey) throw new Error('dbMigrateEncrypt: encrypted copy opened WITHOUT the code — encryption not applied');
  }
  _rmWorkSidecars(P);
  run.push(PHASES.VERIFY); crash(PHASES.VERIFY);

  // ── phase SWAP: crash-ordered rename. plain-old ← live, then live ← work ─────
  _writeManifest(P.manifest, { phase: PHASES.SWAP });
  _rm(P.wal); _rm(P.shm); _rm(P.journal);
  _rmWorkSidecars(P);
  _rm(P.old);
  _renameRetry(P.live, P.old);       // (crash here: live missing, old = plaintext → recover old→live)
  _renameRetry(P.work, P.live);      // (crash here: live = encrypted, old = plaintext, manifest=swap → mark done)
  _writeManifest(P.manifest, { phase: PHASES.DONE, encrypted: true, finishedAt: new Date().toISOString() });
  run.push(PHASES.SWAP); crash(PHASES.SWAP);   // (crash here: DONE written, residues not yet removed → resolveState finishes)

  // ── success: remove the plaintext residues (they would defeat encryption) ────
  _rm(P.old); _rm(P.pre);
  try { logger && logger.info && logger.info('dbMigrateEncrypt: migration complete — DB encrypted'); } catch { /* noop */ }
  return { ok: true, phasesRun: run };
}

/**
 * Called on startup to resolve an interrupted migration to a WORKING DB. Returns a status string:
 *   'plaintext' · 'encrypted' · 'recovered-encrypted' · 'rolled-back' · 'ambiguous-kept-plaintext'.
 */
function resolveState({ dbPath, logger } = {}) {
  const P = paths(dbPath);
  const man = _readManifest(P.manifest);
  const liveMagic = _hasMagic(P.live);
  const log = (m) => { try { logger && logger.warn && logger.warn('dbMigrateEncrypt.resolveState: ' + m); } catch { /* noop */ } };

  // No manifest: either never migrated (plaintext) or a completed encrypted install (no residue).
  if (!man) {
    if (_exists(P.live) && !liveMagic) return 'encrypted';         // encrypted, migration long done
    _rm(P.work); _rmWorkSidecars(P);                               // stray work from an aborted attempt
    return 'plaintext';
  }

  if (man.phase === PHASES.DONE) {
    _rm(P.old); _rm(P.pre); _rm(P.work); _rmWorkSidecars(P); _rm(P.manifest);
    return 'encrypted';
  }

  // Crashed at SWAP — the delicate window. (_hasMagic TRUE = plaintext "SQLite format 3"; FALSE = encrypted.)
  if (man.phase === PHASES.SWAP) {
    if (_exists(P.live) && liveMagic) {
      // live is still PLAINTEXT → the first rename (live→old) hadn't taken. Discard the encrypted work.
      _rm(P.work); _rmWorkSidecars(P); _rm(P.old); _rm(P.pre); _rm(P.manifest);
      log('crash at swap with plaintext live — discarded encrypted work, kept plaintext');
      return 'rolled-back';
    }
    if (_exists(P.live) && !liveMagic) {
      // live is ENCRYPTED → both renames completed before the DONE write. Finish the transaction.
      _rm(P.old); _rm(P.pre); _rm(P.work); _rmWorkSidecars(P); _rm(P.manifest);
      log('crash at swap with encrypted live — swap had completed, marked done');
      return 'recovered-encrypted';
    }
    // live MISSING → the first rename happened, the second didn't. Restore plain-old → live.
    if (_exists(P.old) && _hasMagic(P.old)) {
      fs.renameSync(P.old, P.live);
      _rm(P.work); _rmWorkSidecars(P); _rm(P.pre); _rm(P.manifest);
      log('crash mid-swap, live missing — restored plaintext from plain-old');
      return 'rolled-back';
    }
    if (_exists(P.pre) && _hasMagic(P.pre)) {
      fs.renameSync(P.pre, P.live);
      _rm(P.work); _rmWorkSidecars(P); _rm(P.old); _rm(P.manifest);
      log('crash mid-swap, live+old gone — restored plaintext from pre-encrypt backup');
      return 'ambiguous-kept-plaintext';
    }
    log('crash mid-swap and NO plaintext survivor found — manual recovery required');
    return 'ambiguous-kept-plaintext';
  }

  // Crashed at BACKUP / ENCRYPTING / VERIFY — live was NEVER touched (rekey only ever wrote P.work).
  // Discard the work (even a half-rekeyed / garbage copy — it is never opened, only removed), keep live.
  _rm(P.work); _rmWorkSidecars(P); _rm(P.pre); _rm(P.manifest);
  log(`crash at ${man.phase} — live untouched, discarded the attempt (plaintext preserved)`);
  return 'rolled-back';
}

module.exports = { PHASES, paths, migrate, resolveState, _fingerprint, _hasMagic };
