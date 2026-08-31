#!/usr/bin/env node
'use strict';
/**
 * Crash-injection tests for lib/dbMigrateEncrypt — the plaintext → encrypted migration state machine
 * (code-as-passphrase; Oracle C7/C3). Runs on TEMP DBs; never touches the live DB. Native module →
 * run under electron-as-node:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/lib/test_db_migrate_encrypt.js
 */
const fs = require('fs'); const os = require('os'); const path = require('path');
const Database = require('better-sqlite3');
const M = require('./dbMigrateEncrypt');
const dbKey = require('./dbKey');

let pass = 0, fail = 0;
const check = (l, c) => { if (c) { pass++; console.log('  OK  ' + l); } else { fail++; console.error('  FAIL: ' + l); } };
const CODE = 'ABCDE-FGHJK-MNPQR-STVWX-YZ234';

function seedPlain(dbPath) {
  const d = new Database(dbPath);
  d.pragma('journal_mode = WAL');
  d.exec("CREATE TABLE documents(id INTEGER PRIMARY KEY, supplier TEXT); CREATE TABLE settings(k TEXT, v TEXT)");
  const ins = d.prepare('INSERT INTO documents(supplier) VALUES(?)');
  for (let i = 0; i < 37; i++) ins.run('supplier-' + i);
  d.prepare('INSERT INTO settings VALUES(?,?)').run('sentinel', 'value-xyz');
  d.pragma('wal_checkpoint(TRUNCATE)');
  d.close();
}
function freshDb() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbmig-')); const p = path.join(dir, 'docusnap.db'); seedPlain(p); return p; }
function readsWithCode(p) {
  let d = null;
  try { d = new Database(p); dbKey.applyKey(d, CODE); const r = d.prepare("SELECT COUNT(*) n FROM documents").get(); const s = d.prepare("SELECT v FROM settings WHERE k='sentinel'").get(); return r.n === 37 && s.v === 'value-xyz'; }
  catch (e) { return 'ERR:' + e.message; }
  finally { if (d) { try { d.close(); } catch { /* noop */ } } }
}
function readsPlain(p) {
  let d = null;
  try { d = new Database(p, { readonly: true }); const r = d.prepare("SELECT COUNT(*) n FROM documents").get(); return r.n === 37; }
  catch { return false; }
  finally { if (d) { try { d.close(); } catch { /* noop */ } } }
}

// ── 1. happy path + PORTABILITY ───────────────────────────────────────────────
{
  const p = freshDb(); const P = M.paths(p);
  const res = M.migrate({ dbPath: p, code: CODE });
  check('migrate returns ok + ran all four phases', res.ok && res.phasesRun.length === 4);
  check('live is now ENCRYPTED (magic absent) and reads WITH the code', !M._hasMagic(p) && readsWithCode(p) === true);
  check('live does NOT open without the code', readsPlain(p) === false);
  check('plaintext residues removed (.pre-encrypt / .plain-old / .encrypting / -journal gone)',
        !fs.existsSync(P.pre) && !fs.existsSync(P.old) && !fs.existsSync(P.work) && !fs.existsSync(P.journal) && !fs.existsSync(P.work + '-journal'));
  check('resolveState after a done migration reports encrypted + clears the manifest',
        M.resolveState({ dbPath: p }) === 'encrypted' && !fs.existsSync(P.manifest));
  // PORTABILITY: copy ONLY the migrated .db to a fresh dir, open by the code
  const moved = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dbmig-moved-')), 'docusnap.db');
  fs.copyFileSync(p, moved);
  check('PORTABILITY: the migrated .db, copied alone to a fresh dir, opens by the code', readsWithCode(moved) === true);
}

// ── 2. refuse to migrate an already-encrypted DB ─────────────────────────────
{
  const p = freshDb(); M.migrate({ dbPath: p, code: CODE });
  let refused = false; try { M.migrate({ dbPath: p, code: CODE }); } catch (e) { refused = /not plaintext/.test(e.message); }
  check('a second migrate on an encrypted DB is REFUSED (not plaintext)', refused);
}

// ── 3. crash after BACKUP / ENCRYPTING / VERIFY → rolled back to plaintext ────
for (const phase of [M.PHASES.BACKUP, M.PHASES.ENCRYPTING, M.PHASES.VERIFY]) {
  const p = freshDb(); const P = M.paths(p);
  let threw = false; try { M.migrate({ dbPath: p, code: CODE, injectCrashAfter: phase }); } catch { threw = true; }
  const status = M.resolveState({ dbPath: p });
  check(`crash after ${phase}: throws, resolveState -> rolled-back, live still plaintext + readable`,
        threw && status === 'rolled-back' && M._hasMagic(p) && readsPlain(p) === true);
  check(`crash after ${phase}: work + backup residues cleaned`,
        !fs.existsSync(P.work) && !fs.existsSync(P.pre) && !fs.existsSync(P.manifest));
}

// ── 3b. KILL DURING REKEY: a garbage/half-rekeyed work file is discarded, live kept plaintext ──
{
  const p = freshDb(); const P = M.paths(p);
  fs.writeFileSync(P.work, Buffer.from('half-rekeyed-garbage-not-a-db'));   // simulate interrupted rekey
  fs.writeFileSync(P.manifest, JSON.stringify({ phase: M.PHASES.ENCRYPTING }));
  const status = M.resolveState({ dbPath: p });
  check('kill-during-rekey: garbage work discarded, live untouched plaintext + readable',
        status === 'rolled-back' && M._hasMagic(p) && readsPlain(p) === true && !fs.existsSync(P.work));
}

// ── 4. crash AFTER swap+done write (before cleanup) → encrypted, residues cleaned ──
{
  const p = freshDb(); const P = M.paths(p);
  let threw = false; try { M.migrate({ dbPath: p, code: CODE, injectCrashAfter: M.PHASES.SWAP }); } catch { threw = true; }
  const status = M.resolveState({ dbPath: p });
  check('crash after swap(done written): resolveState -> encrypted, reads with code, residues cleaned',
        threw && status === 'encrypted' && readsWithCode(p) === true
        && !fs.existsSync(P.old) && !fs.existsSync(P.pre) && !fs.existsSync(P.manifest));
}

// ── 5. mid-swap, live MISSING (first rename done, second not) → restore plain-old ──
{
  const p = freshDb(); const P = M.paths(p);
  fs.renameSync(p, P.old);
  fs.copyFileSync(P.old, P.work);
  { const w = new Database(P.work); w.pragma('journal_mode = DELETE'); dbKey.applyRekey(w, CODE); w.close(); }
  try { fs.unlinkSync(P.work + '-journal'); } catch { /* noop */ }
  fs.writeFileSync(P.manifest, JSON.stringify({ phase: M.PHASES.SWAP }));
  const status = M.resolveState({ dbPath: p });
  check('mid-swap live-missing: restored plaintext from plain-old, live readable',
        status === 'rolled-back' && M._hasMagic(p) && readsPlain(p) === true && !fs.existsSync(P.work));
}

// ── 6. mid-swap, live already ENCRYPTED (both renames done, DONE not written) → finish ──
{
  const p = freshDb(); const P = M.paths(p);
  fs.copyFileSync(p, P.old);
  { const w = new Database(p); w.pragma('journal_mode = DELETE'); dbKey.applyRekey(w, CODE); w.close(); }
  try { fs.unlinkSync(p + '-journal'); } catch { /* noop */ }
  fs.writeFileSync(P.manifest, JSON.stringify({ phase: M.PHASES.SWAP }));
  const status = M.resolveState({ dbPath: p });
  check('mid-swap live-encrypted: recognised as completed swap, reads with code, plain-old removed',
        status === 'recovered-encrypted' && readsWithCode(p) === true && !fs.existsSync(P.old) && !fs.existsSync(P.manifest));
}

// ── 7. code validation ────────────────────────────────────────────────────────
{
  const p = freshDb();
  let bad = false; try { M.migrate({ dbPath: p, code: 'nope' }); } catch (e) { bad = /invalid recovery code/.test(e.message); }
  check('migrate refuses an invalid recovery code', bad);
}

console.log(`\ndb-migrate-encrypt: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
