/*
 * src/modules/processing/test_ensure_working_copy.js
 * --------------------------------------------------
 * Unit test for ensureWorkingCopy (Slice 3) — the atomic inbox working-copy
 * primitive shared by the success and failure intake paths. Atomicity (copy to
 * .part, then rename) is what guarantees a crash mid-copy never leaves a
 * half-written <docId><ext> that looks valid. Pure fs-injected, hermetic.
 *
 * Run with Electron-as-Node:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
 *     src/modules/processing/test_ensure_working_copy.js
 */
'use strict';

const path = require('path');
const { ensureWorkingCopy } = require('./handler');

let failures = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'}  ${name}`);
  if (!cond) failures++;
};

function makeFs({ existing = [], renameThrows = false, copyThrows = false } = {}) {
  const paths = new Set(existing);
  const log   = { copied: [], renamed: [], unlinked: [], mkdirs: [] };
  return {
    _paths: paths, _log: log,
    existsSync: (p) => paths.has(p),
    mkdirSync:  (p) => { paths.add(p); log.mkdirs.push(p); },
    copyFileSync: (a, b) => { if (copyThrows) throw new Error('copy fail'); paths.add(b); log.copied.push([a, b]); },
    renameSync:   (a, b) => { if (renameThrows) throw new Error('rename fail'); paths.delete(a); paths.add(b); log.renamed.push([a, b]); },
    unlinkSync:   (a)    => { paths.delete(a); log.unlinked.push(a); },
  };
}

const INBOX = 'C:/inbox';

// 1) Happy path: copy to .part, then rename onto the final name
{
  const fs   = makeFs({ existing: ['C:/watch/scan.pdf'] });
  const dest = path.join(INBOX, '42.pdf');
  const r    = ensureWorkingCopy(fs, path, INBOX, 'C:/watch/scan.pdf', 42, 'scan.pdf');
  check('returns the final dest',        r === dest);
  check('copied to a .part temp first',  fs._log.copied.length === 1 && fs._log.copied[0][1] === dest + '.part');
  check('renamed .part → final',         fs._log.renamed.length === 1);
  check('final copy exists',             fs._paths.has(dest));
  check('no .part left behind',          !fs._paths.has(dest + '.part'));
}

// 2) rename fails mid-publish → cleaned up, returns null (no half-written final)
{
  const fs   = makeFs({ existing: ['C:/watch/scan.pdf'], renameThrows: true });
  const dest = path.join(INBOX, '42.pdf');
  const r    = ensureWorkingCopy(fs, path, INBOX, 'C:/watch/scan.pdf', 42, 'scan.pdf');
  check('returns null on rename failure', r === null);
  check('.part cleaned up',               !fs._paths.has(dest + '.part'));
  check('no final left behind',           !fs._paths.has(dest));
}

// 3) source missing → null, no copy attempted
{
  const fs = makeFs({ existing: [] });
  const r  = ensureWorkingCopy(fs, path, INBOX, 'C:/watch/gone.pdf', 7, 'gone.pdf');
  check('returns null when src missing',  r === null);
  check('no copy attempted',              fs._log.copied.length === 0);
}

// 4) a non-alphanumeric "extension" is dropped (no user text in the path)
{
  const fs = makeFs({ existing: ['C:/watch/weird.pdf;x'] });
  const r  = ensureWorkingCopy(fs, path, INBOX, 'C:/watch/weird.pdf;x', 9, 'weird.pdf;x');
  check('unsafe ext sanitised away',      r === path.join(INBOX, '9'));
}

if (failures) {
  console.log(`\n${failures} check(s) failed — ensureWorkingCopy regressed.`);
  process.exit(1);
}
console.log('\nAll checks passed — ensureWorkingCopy behaves as expected.');
process.exit(0);
