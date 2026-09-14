'use strict';
/*
 * test_client_teach_sync.js — DRIFT GUARD (checker half) for the shared teach UI (teach-over-client S1,
 * 2026-09-14; the test_client_search_sync.js twin). Every COMMITTED client copy under client/renderer/shared/
 * (the teach-ui module + the shared sub-scripts the wizard loads) must be byte-equal (banner-aware,
 * CRLF-normalised) to its canonical source under src/windows/shared/. Red = someone edited a source (or a
 * copy) without re-running scripts/sync-client-teach.js, i.e. a core teach change that would NOT reach the
 * client. Also proves the checker bites (stale / extra / CRLF-flip / missing banner).
 *
 *   node scripts/test_client_teach_sync.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require(path.join(__dirname, 'sync-client-teach.js'));

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('1. every committed client copy is current');
{
  const d = S.diff();
  const files = S.sourceFiles();
  check(`teach-ui source has teach.js + teach.css (${files.length})`, files.includes('teach.js') && files.includes('teach.css') && files.every(f => !/^test_/.test(f)));
  check('every source file has a copy' + (d.missing.length ? ` — missing: ${d.missing.join(', ')}` : ''), d.missing.length === 0);
  check('no copy is stale' + (d.stale.length ? ` — stale: ${d.stale.join(', ')} (run: node scripts/sync-client-teach.js)` : ''), d.stale.length === 0);
  check('no orphan copy (mirror semantics)' + (d.extra.length ? ` — extra: ${d.extra.join(', ')}` : ''), d.extra.length === 0);
  for (const f of files) {
    const copy = fs.readFileSync(path.join(S.DST, f), 'utf8');
    check(`teach-ui/${f}: the copy carries the GENERATED banner on line 1`, copy.split(/\r?\n/)[0] === (f.endsWith('.css') ? S.CSS_BANNER_LINE : S.BANNER_LINE));
  }
  const pins = fs.existsSync(S.DST) ? fs.readdirSync(S.DST).filter(f => /^test_/.test(f)) : [];
  check('no pin files are shipped to the client', pins.length === 0);
  // The teach-shared set: the 9 shared sub-components the wizard loads, mirrored beside search's theme/fonts.
  const sub = S.SETS.find(s => s.name === 'teach-shared');
  const subFiles = S.listSrc(sub);
  check(`teach-shared mirrored (${subFiles.length} sub-scripts)`, subFiles.length === S.SUBSCRIPTS.length && subFiles.every(f => fs.existsSync(path.join(sub.dst, f))));
  check('every sub-script copy carries the banner', subFiles.every(f => fs.readFileSync(path.join(sub.dst, f), 'utf8').split(/\r?\n/)[0] === S.BANNER_LINE));
}

console.log('2. the checker bites (hash semantics)');
{
  const f = S.sourceFiles()[0];
  const good = S.generated(f);
  check('a CRLF-flipped copy still hashes equal (core.autocrlf cannot flip this pin red)',
        S.sha(good.replace(/\r?\n/g, '\r\n')) === S.sha(good.replace(/\r\n/g, '\n')));
  check('a one-byte change in the copy hashes DIFFERENT (→ stale)', S.sha(good + 'x') !== S.sha(good));
  check('a copy missing its banner hashes DIFFERENT (→ stale)', S.sha(good.split('\n').slice(1).join('\n')) !== S.sha(good));
}

console.log('3. sync() + diff() on a scratch destination (mirror, stale, extra)');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-teach-sync-'));
  try {
    const modSrc = fs.readFileSync(path.join(__dirname, 'sync-client-teach.js'), 'utf8')
      .replace(/const CLIENT_SHARED = [^\n]+/, `const CLIENT_SHARED = ${JSON.stringify(path.join(tmp, 'shared'))};`)
      .replace(/path\.join\(__dirname, '\.\.'\)/, JSON.stringify(path.join(__dirname, '..')));
    const modPath = path.join(tmp, 'sync-scratch.js');
    fs.writeFileSync(modPath, modSrc);
    const M = require(modPath);
    const before = M.diff();
    check('scratch destination starts with every file missing (all sets)',
          before.missing.length === M.SETS.reduce((n, s) => n + M.listSrc(s).length, 0));
    M.sync();
    const after = M.diff();
    check('after sync() every scratch copy is current', after.stale.length === 0 && after.missing.length === 0 && after.extra.length === 0);
    const f = M.sourceFiles()[0];
    fs.appendFileSync(path.join(M.DST, f), '\n// drift\n');
    check('an edit to a scratch copy is reported stale', M.diff().stale.includes(f));
    fs.writeFileSync(path.join(M.DST, 'orphan.js'), '// left over\n');
    check('an orphan file in the teach-ui scratch copy is reported extra', M.diff().extra.includes('orphan.js'));
    M.sync();
    check('sync() mirrors: orphan removed, drift rewritten', M.diff().extra.length === 0 && M.diff().stale.length === 0);
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
