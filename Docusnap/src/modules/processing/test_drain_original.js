/*
 * src/modules/processing/test_drain_original.js
 * ---------------------------------------------
 * Unit test for drainOriginalToFolder (Slice 2) — moving a processed original
 * out of the intake folder into a managed "Processed"/"Errors" subfolder so it
 * can't be re-pulled by the next scan. Pure fs-injected logic, so it's hermetic
 * (no real disk). Mirrors filing/test_remove_source_file.js.
 *
 * Run with Electron-as-Node:
 *   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
 *     src/modules/processing/test_drain_original.js
 */
'use strict';

const path = require('path');
const { drainOriginalToFolder } = require('./handler');

let failures = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'}  ${name}`);
  if (!cond) failures++;
};

// Minimal in-memory fs: a set of existing file/dir paths + a call log.
function makeFs({ existing = [], renameThrows = false } = {}) {
  const paths = new Set(existing);
  const log   = { renamed: [], copied: [], unlinked: [], mkdirs: [] };
  return {
    _paths: paths, _log: log,
    existsSync: (p) => paths.has(p),
    mkdirSync:  (p) => { paths.add(p); log.mkdirs.push(p); },
    renameSync: (a, b) => {
      if (renameThrows) throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
      paths.delete(a); paths.add(b); log.renamed.push([a, b]);
    },
    copyFileSync: (a, b) => { paths.add(b); log.copied.push([a, b]); },
    unlinkSync:   (a)    => { paths.delete(a); log.unlinked.push(a); },
  };
}

// 1) Happy path: rename into a fresh Processed dir
{
  const src  = 'C:/watch/scan.pdf';
  const dest = 'C:/watch/Processed';
  const fs   = makeFs({ existing: [src] });
  const r    = drainOriginalToFolder(fs, path, src, dest, 'scan.pdf');
  check('returns the dest folder',     r && r.folder === dest);
  check('returns the same filename',   r && r.filename === 'scan.pdf');
  check('made the Processed dir',      fs._log.mkdirs.includes(dest));
  check('renamed exactly once',        fs._log.renamed.length === 1);
  check('original left the intake',    !fs._paths.has(src));
  check('lands in Processed',          fs._paths.has(path.join(dest, 'scan.pdf')));
}

// 2) Name collision → -N suffix
{
  const src  = 'C:/watch/scan.pdf';
  const dest = 'C:/watch/Processed';
  const fs   = makeFs({ existing: [src, dest, path.join(dest, 'scan.pdf')] });
  const r    = drainOriginalToFolder(fs, path, src, dest, 'scan.pdf');
  check('collision appends -1',        r && r.filename === 'scan-1.pdf');
  check('lands as scan-1.pdf',         fs._paths.has(path.join(dest, 'scan-1.pdf')));
}

// 3) Cross-volume rename (EXDEV) → copy + unlink fallback
{
  const src  = '//share/watch/scan.pdf';
  const dest = 'C:/local/Processed';
  const fs   = makeFs({ existing: [src], renameThrows: true });
  const r    = drainOriginalToFolder(fs, path, src, dest, 'scan.pdf');
  check('fallback still moves it',     r && r.filename === 'scan.pdf');
  check('copied on EXDEV',             fs._log.copied.length === 1);
  check('unlinked original on EXDEV',  fs._log.unlinked.length === 1);
  check('original gone after fallback',!fs._paths.has(src));
}

// 4) Source already gone → null, no side effects
{
  const fs = makeFs({ existing: [] });
  const r  = drainOriginalToFolder(fs, path, 'C:/watch/gone.pdf', 'C:/watch/Processed', 'gone.pdf');
  check('returns null when src missing',          r === null);
  check('no mkdir/rename when src missing',
    fs._log.mkdirs.length === 0 && fs._log.renamed.length === 0);
}

if (failures) {
  console.log(`\n${failures} check(s) failed — drainOriginalToFolder regressed.`);
  process.exit(1);
}
console.log('\nAll checks passed — drainOriginalToFolder behaves as expected.');
process.exit(0);
