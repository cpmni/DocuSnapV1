'use strict';
/*
 * test_intake_path.js — PIN for the Quick File Q-C10 intake-path validator
 * (directIntakeService.validateIntakePath). The ONE gate every intake path passes (dialog / drop / arg).
 * Must FAIL on the fail-open bug (unverifiable path staged) and on any containment/type/size escape.
 * Run: ELECTRON_RUN_AS_NODE=1 electron src/modules/directIntake/test_intake_path.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const svc = require('../../services/directIntakeService');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sf_intake_'));
const userData = path.join(sandbox, 'userData'); fs.mkdirSync(userData);
const output   = path.join(sandbox, 'output');   fs.mkdirSync(output);
const outside  = path.join(sandbox, 'outside');  fs.mkdirSync(outside);
const OPTS = { userDataDir: userData, outputRoot: output, maxMb: 50 };

const mk = (dir, name, bytes = 10) => { const p = path.join(dir, name); fs.writeFileSync(p, Buffer.alloc(bytes, 1)); return p; };

console.log('1. accept a normal document outside the app roots');
{
  const good = mk(outside, 'invoice.pdf');
  const r = svc.validateIntakePath(good, OPTS);
  check('a .pdf outside roots is accepted', r.ok === true && r.ext === '.pdf' && typeof r.size === 'number');
  check('accepted path is the canonical real path', r.ok && fs.existsSync(r.path));
}

console.log('2. type refusals');
{
  check('.exe refused (unsupported_type)', svc.validateIntakePath(mk(outside, 'x.exe'), OPTS).refused === 'unsupported_type');
  check('.db refused (unsupported_type)',  svc.validateIntakePath(mk(outside, 'docusnap.db'), OPTS).refused === 'unsupported_type');
  check('.lnk refused (unsupported_type)', svc.validateIntakePath(mk(outside, 'x.lnk'), OPTS).refused === 'unsupported_type');
  check('.docm (macro) refused',           svc.validateIntakePath(mk(outside, 'm.docm'), OPTS).refused === 'unsupported_type');
}

console.log('3. containment — never stage a file inside the app data / output tree');
{
  check('inside userData → inside_app', svc.validateIntakePath(mk(userData, 'a.pdf'), OPTS).refused === 'inside_app');
  check('inside outputRoot → inside_app', svc.validateIntakePath(mk(output, 'b.pdf'), OPTS).refused === 'inside_app');
}

console.log('4. canonicalise-then-contain: a junction that RESOLVES into userData is refused');
{
  const real = mk(userData, 'secret.pdf');
  const jlink = path.join(sandbox, 'jlink');
  let made = true;
  try { fs.symlinkSync(userData, jlink, 'junction'); } catch { made = false; }
  if (made) {
    const via = path.join(jlink, 'secret.pdf');   // textually OUTSIDE userData, resolves INTO it
    check('a file reached THROUGH a junction into userData is refused', svc.validateIntakePath(via, OPTS).refused === 'inside_app');
  } else {
    console.log('  ~~  (junction create unavailable — skipped)');
  }
}

console.log('5. fail-CLOSED on an unverifiable / missing / non-file / UNC / invalid path');
{
  check('missing file → missing', svc.validateIntakePath(path.join(outside, 'nope.pdf'), OPTS).refused === 'missing');
  const adir = path.join(outside, 'folder.pdf'); fs.mkdirSync(adir);
  check('a directory named *.pdf → not_a_file', svc.validateIntakePath(adir, OPTS).refused === 'not_a_file');
  check('UNC path → network (never silently)', svc.validateIntakePath('\\\\server\\share\\x.pdf', OPTS).refused === 'network');
  check('empty/invalid → invalid', svc.validateIntakePath('', OPTS).refused === 'invalid');
}

console.log('6. size cap');
{
  const big = mk(outside, 'big.pdf', 4096);
  check('over the size cap → too_large', svc.validateIntakePath(big, { ...OPTS, maxMb: 0.000001 }).refused === 'too_large');
  check('under the cap → accepted', svc.validateIntakePath(big, { ...OPTS, maxMb: 50 }).ok === true);
}

try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
