#!/usr/bin/env node
'use strict';
/**
 * Pin for lib/dbStartup — the DB-at-rest startup decision table (Oracle C4). Pure/file-only, so it runs
 * under plain node with an injected fake safeStorage; the DB "files" are just headers (real SQLite magic
 * for plaintext, arbitrary bytes for encrypted). Run: node src/lib/test_db_startup.js
 */
const fs = require('fs'); const os = require('os'); const path = require('path');
const S = require('./secretStore');
const K = require('./dbKey');
const startup = require('./dbStartup');

let pass = 0, fail = 0;
const check = (l, c) => { if (c) { pass++; console.log('  OK  ' + l); } else { fail++; console.error('  FAIL: ' + l); } };
const fakeSS = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('D:' + s), decryptString: (b) => Buffer.from(b).toString('utf8').replace(/^D:/, '') };
S.__setSafeStorage(fakeSS);

const MAGIC = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(84)]);       // plaintext header
const ENC = Buffer.concat([Buffer.from('sqleetchacha20xx'), Buffer.alloc(84)]);          // non-magic (encrypted)

function scenario(name, { db, key, mig }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbstart-'));
  K.__setDirForTest(dir);
  const dbPath = path.join(dir, 'docusnap.db');
  if (db === 'plaintext') fs.writeFileSync(dbPath, MAGIC);
  else if (db === 'encrypted') fs.writeFileSync(dbPath, ENC);
  // db === 'none' → no file
  if (key) K.cacheCode('ABCDE-FGHJK-MNPQR-STVWX-YZ234');
  if (mig) K.armMigration('ABCDE-FGHJK-MNPQR-STVWX-YZ234');   // the DISJOINT `.db-migrate-code`
  const res = startup.decide({ dbPath });
  // ENRICHED (existing call sites read `.action`, unchanged): also report the on-disk state AFTER
  // decide(), so the C1 self-heal (a stale arm must be GONE on an encrypted boot) is directly assertable.
  return { action: res.action, reason: res.reason, migAfter: K.hasMigrateCode(), keyAfter: K.hasKey(), dir };
}

// ── the ORIGINAL five rows — must stay BYTE-IDENTICAL now that the migrate arm exists (no arm in any) ──
check("absent key + no DB          -> plaintext (fresh install)", scenario('a', { db: 'none', key: false }).action === 'plaintext');
check("absent key + plaintext DB   -> plaintext (not-yet-encrypted)", scenario('b', { db: 'plaintext', key: false }).action === 'plaintext');
check("present key + encrypted DB  -> open-cached (normal daily open)", scenario('c', { db: 'encrypted', key: true }).action === 'open-cached');
check("present key + PLAINTEXT DB  -> tripwire (DOWNGRADE, loud fail)", scenario('d', { db: 'plaintext', key: true }).action === 'tripwire');
check("ABSENT key + ENCRYPTED DB   -> prompt-code (RESTORED BACKUP — the owner's row)",
      scenario('e', { db: 'encrypted', key: false }).action === 'prompt-code');

// the distinction that a naive loadCode()==null would miss: null key is BOTH 'plaintext' and 'prompt-code'
check("null key is disambiguated by the DB header, not treated uniformly",
      scenario('f', { db: 'plaintext', key: false }).action === 'plaintext'
      && scenario('g', { db: 'encrypted', key: false }).action === 'prompt-code');

// ── the DISJOINT migrate arm (Oracle 2026-08-31) ─────────────────────────────────────────────
check("absent key + arm + PLAINTEXT DB -> migrate (the opt-in ceremony armed the encrypt)",
      scenario('h', { db: 'plaintext', key: false, mig: true }).action === 'migrate');
check("absent key + arm + no DB         -> plaintext + stray arm CLEARED",
      (r => r.action === 'plaintext' && r.migAfter === false)(scenario('i', { db: 'none', key: false, mig: true })));

// C1 — the SELF-HEAL: a stale arm found on an ENCRYPTED DB is removed on EVERY boot, so it can never
// survive to disarm a future downgrade. Assert BOTH the action AND that the arm file is gone afterwards.
check("stale arm + encrypted + key      -> open-cached AND arm self-healed (removed)",
      (r => r.action === 'open-cached' && r.migAfter === false)(scenario('j', { db: 'encrypted', key: true, mig: true })));
check("stale arm + encrypted + NO key   -> prompt-code AND arm self-healed (removed)",
      (r => r.action === 'prompt-code' && r.migAfter === false)(scenario('k', { db: 'encrypted', key: false, mig: true })));

// THE TRIPWIRE MUST STILL FIRE with a stale arm present — a real `.db-key` beside a PLAINTEXT DB is a
// downgrade, checked BEFORE the migrate row, so a stale arm can NEVER silently re-encrypt a restored
// old plaintext backup (the exact bypass the disjoint-file design closes). Arm survives (not encrypted).
check("stale arm + key + PLAINTEXT DB   -> STILL tripwire (the stale arm cannot bypass the downgrade alarm)",
      scenario('l', { db: 'plaintext', key: true, mig: true }).action === 'tripwire');

S.__setSafeStorage(undefined);
console.log(`\ndb-startup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
