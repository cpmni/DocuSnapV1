'use strict';
/*
 * test_path_containment.js — SEC-17. A Windows junction or symlink inside an approved root must not
 * be able to carry `open-file` / `show-in-explorer` outside that root.
 *
 * `path.resolve` collapses `..` but does NOT follow a reparse point, so the old textual check
 * (`resolved.startsWith(root + sep)`) accepted a junction sitting inside the output folder while it
 * addressed anywhere on disk. `realpath` appeared nowhere in src/ before this fix.
 *
 * The pin also guards the FALSE-REFUSAL side, which is the part most likely to be broken by a
 * well-meaning "simplification": a root that is ITSELF a junction is the ordinary case for a
 * redirected or OneDrive-backed Documents folder, and canonicalising only the target would start
 * refusing those users their own files.
 *
 * Junctions need no administrator rights on Windows (unlike file symlinks), so this runs anywhere.
 * On a non-Windows host the junction cases are skipped and reported as skipped, never as passed.
 *
 *   node src/modules/processing/test_path_containment.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { _withinAnyRoot, _realCanonical } = require('./handler');

let fails = 0, skipped = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const skip = (label) => { console.log(`  --  ${label} (skipped on ${process.platform})`); skipped++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec17-'));
const root = path.join(tmp, 'ApprovedRoot');
const outside = path.join(tmp, 'Elsewhere');
fs.mkdirSync(root); fs.mkdirSync(outside);
const inside = path.join(root, 'ok.pdf');
const secret = path.join(outside, 'secret.pdf');
fs.writeFileSync(inside, '%PDF-1.4\n');
fs.writeFileSync(secret, '%PDF-1.4\n');

console.log('\nBASELINE — ordinary paths behave exactly as before');
check('a real file inside the root is allowed', _withinAnyRoot(inside, [root]) === true);
check('a real file outside every root is refused', _withinAnyRoot(secret, [root]) === true ? false : true);
check('the root directory itself is allowed', _withinAnyRoot(root, [root]) === true);
check('a sibling whose name merely starts with the root name is refused (prefix trap)',
      _withinAnyRoot(root + 'Extra', [root]) === false);

console.log('\nTHE DEFECT — a junction inside the root must not lead out of it');
let junctionMade = false;
if (process.platform === 'win32') {
  const escape = path.join(root, 'escape');
  try { fs.symlinkSync(outside, escape, 'junction'); junctionMade = true; } catch (e) {
    console.log(`  --  could not create a junction (${e.code}) — cases skipped`); skipped++;
  }
  if (junctionMade) {
    const via = path.join(escape, 'secret.pdf');
    check('a file reached THROUGH a junction inside the root is REFUSED', _withinAnyRoot(via, [root]) === false);
    check('the junction directory itself is REFUSED', _withinAnyRoot(escape, [root]) === false);
    // Prove the pin is not vacuous: the OLD textual rule accepted exactly this path.
    const oldRule = via === root || via.startsWith(root + path.sep);
    check('...and the OLD textual rule DID accept it (so this pin is not vacuous)', oldRule === true);
  }
} else { skip('junction escape'); skip('junction directory'); skip('old-rule vacuity check'); }

console.log('\nTHE FALSE-REFUSAL SIDE — a root that is itself a junction must still work');
if (process.platform === 'win32') {
  const realRoot = path.join(tmp, 'RealDocs');
  fs.mkdirSync(realRoot);
  fs.writeFileSync(path.join(realRoot, 'mine.pdf'), '%PDF-1.4\n');
  const linkRoot = path.join(tmp, 'RedirectedDocs');
  let ok = false;
  try { fs.symlinkSync(realRoot, linkRoot, 'junction'); ok = true; } catch { /* skipped below */ }
  if (ok) {
    check('a file under a junction-backed ROOT is still allowed (the OneDrive case)',
          _withinAnyRoot(path.join(linkRoot, 'mine.pdf'), [linkRoot]) === true);
    check('...and is allowed when the setting stores the REAL root but the caller uses the link',
          _withinAnyRoot(path.join(linkRoot, 'mine.pdf'), [realRoot]) === true);
  } else { skip('junction-backed root'); skip('link/real root cross-match'); }
} else { skip('junction-backed root'); skip('link/real root cross-match'); }

console.log('\nCASE INSENSITIVITY — realpath returns the filesystem\'s casing, not the user\'s');
if (process.platform === 'win32') {
  check('a differently-cased root still matches (else we refuse the user their own files)',
        _withinAnyRoot(inside, [root.toUpperCase()]) === true);
} else { skip('case-insensitive root'); }

console.log('\nMISSING PATHS — the frame-mismatch hole (Oracle B1, 2026-08-08)');
// The label on the first of these used to read "a non-existent path is not promoted into a match"
// while asserting `=== true`, i.e. the exact opposite of what it checked, under a FAIL-CLOSED
// heading. The ASSERTION was right and the LABEL was wrong: a file that simply does not exist YET,
// directly under the root, IS within the root and must stay allowed. What must NOT be allowed is a
// missing leaf reached through a junction — and until the ancestor walk landed, that was allowed,
// because ENOENT returned the RAW path for comparison against a CANONICALISED root.
check('a not-yet-existing file directly under the root IS within it (must not be refused wholesale)',
      _withinAnyRoot(path.join(root, 'gone.pdf'), [root]) === true);
check('_realCanonical resolves a non-existent leaf against its nearest EXISTING ancestor',
      _realCanonical(path.join(root, 'gone.pdf')) === path.join(fs.realpathSync.native(root), 'gone.pdf'));
check('...and several missing levels collapse to the same ancestor-resolved form',
      _realCanonical(path.join(root, 'no', 'such', 'dir', 'gone.pdf'))
        === path.join(fs.realpathSync.native(root), 'no', 'such', 'dir', 'gone.pdf'));

if (process.platform === 'win32') {
  const escape2 = path.join(root, 'peek');
  const outside2 = path.join(tmp, 'OutsideB1');
  fs.mkdirSync(outside2, { recursive: true });
  let made = false;
  try { fs.symlinkSync(outside2, escape2, 'junction'); made = true; } catch { /* skipped below */ }
  if (made) {
    // THE B1 BYPASS. This case is RED against the pre-ancestor-walk code: realpath threw ENOENT on
    // the missing leaf, the raw string came back, and startsWith(root) accepted it.
    const ghost = path.join(escape2, 'nope.pdf');
    check('a MISSING leaf reached through a junction inside the root is REFUSED (the B1 bypass)',
          _withinAnyRoot(ghost, [root]) === false);
    // Non-vacuity, same discipline as the junction block above: the pre-fix behaviour accepted it.
    const preFix = ghost.toLowerCase().startsWith(root.toLowerCase() + path.sep);
    check('...and the pre-fix raw-on-ENOENT comparison DID accept it (so this pin is not vacuous)',
          preFix === true);
    check('a missing leaf several levels below a junction is also REFUSED',
          _withinAnyRoot(path.join(escape2, 'a', 'b', 'nope.pdf'), [root]) === false);
  } else { skip('B1 junction ghost-leaf'); skip('B1 non-vacuity'); skip('B1 deep ghost-leaf'); }
} else { skip('B1 junction ghost-leaf'); skip('B1 non-vacuity'); skip('B1 deep ghost-leaf'); }

console.log('\nFAIL-CLOSED — the unverifiable branch must stay refusing');
// This branch was ENTIRELY unpinned: a future dev could change `return null` to `return p` and the
// whole suite stayed green (the "dead guard greens every test" trap this codebase has been burned
// by before). Force a non-ENOENT error by monkeypatching realpath, the suite's usual convention.
{
  const realFn = fs.realpathSync.native;
  try {
    fs.realpathSync.native = () => { const e = new Error('denied'); e.code = 'EPERM'; throw e; };
    check('a path that EXISTS but cannot be canonicalised returns null (fail closed)',
          _realCanonical(inside) === null);
    check('...and _withinAnyRoot therefore REFUSES it', _withinAnyRoot(inside, [root]) === false);
  } finally {
    fs.realpathSync.native = realFn;
  }
}

console.log('\nTHE KILL SWITCH — and the part of the change it does NOT revert');
process.env.SF_REALPATH_CONTAINMENT = '0';
check('SF_REALPATH_CONTAINMENT=0 returns the input unresolved',
      _realCanonical(inside) === inside);
if (process.platform === 'win32') {
  // PINNED ACCEPTED TRADE-OFF: the case-insensitive compare lives in _withinAnyRoot, OUTSIDE the
  // switch, so OFF means "no reparse-point resolution" — NOT "the pre-SEC-17 code", which compared
  // case-sensitively. Recorded here so the limitation is read from the test, not rediscovered.
  check('case-insensitivity SURVIVES the kill switch (OFF is not a full revert)',
        _withinAnyRoot(inside, [root.toUpperCase()]) === true);
} else { skip('kill-switch case-insensitivity'); }
delete process.env.SF_REALPATH_CONTAINMENT;

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(fails ? `\n${fails} FAILED${skipped ? ` (${skipped} skipped)` : ''}`
                  : `\nAll SEC-17 containment pins passed${skipped ? ` (${skipped} skipped)` : ''}`);
process.exit(fails ? 1 : 0);
