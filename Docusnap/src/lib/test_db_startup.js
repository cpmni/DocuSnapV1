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

function scenario(name, { db, key }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbstart-'));
  K.__setDirForTest(dir);
  const dbPath = path.join(dir, 'docusnap.db');
  if (db === 'plaintext') fs.writeFileSync(dbPath, MAGIC);
  else if (db === 'encrypted') fs.writeFileSync(dbPath, ENC);
  // db === 'none' → no file
  if (key) K.cacheCode('ABCDE-FGHJK-MNPQR-STVWX-YZ234');
  return startup.decide({ dbPath });
}

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

S.__setSafeStorage(undefined);
console.log(`\ndb-startup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
