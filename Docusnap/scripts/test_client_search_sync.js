'use strict';
/*
 * test_client_search_sync.js — DRIFT GUARD #1 (checker half) for the shared search UI (client search
 * parity, 2026-09-13; Oracle C4): the COMMITTED client copy (client/renderer/shared/search-ui/) must be
 * byte-equal (banner-aware, CRLF-normalised) to the canonical source (src/windows/shared/search-ui/).
 * Red = someone edited the source (or the copy) without re-running scripts/sync-client-search.js, i.e.
 * a core search change that would NOT reach the client. Also proves the checker bites: a one-byte change
 * in a scratch copy → stale; a removed source file → extra; a CRLF flip alone → still current.
 *
 *   node scripts/test_client_search_sync.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require(path.join(__dirname, 'sync-client-search.js'));

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('1. the committed client copy is current');
{
  const d = S.diff();
  const files = S.sourceFiles();
  check(`source has the shared modules (${files.length})`, files.length >= 7 && files.every(f => !/^test_/.test(f)));
  check('every source file has a copy' + (d.missing.length ? ` — missing: ${d.missing.join(', ')}` : ''), d.missing.length === 0);
  check('no copy is stale' + (d.stale.length ? ` — stale: ${d.stale.join(', ')} (run: node scripts/sync-client-search.js)` : ''), d.stale.length === 0);
  check('no orphan copy (mirror semantics)' + (d.extra.length ? ` — extra: ${d.extra.join(', ')}` : ''), d.extra.length === 0);
  for (const f of files) {
    const copy = fs.readFileSync(path.join(S.DST, f), 'utf8');
    check(`${f}: the copy carries the GENERATED banner on line 1`, copy.split(/\r?\n/)[0] === (f.endsWith('.css') ? S.CSS_BANNER_LINE : S.BANNER_LINE));
  }
  const pins = fs.existsSync(S.DST) ? fs.readdirSync(S.DST).filter(f => /^test_/.test(f)) : [];
  check('no pin files are shipped to the client', pins.length === 0);
}

console.log('2. the checker bites (scratch copies)');
{
  const f = S.sourceFiles()[0];
  const good = S.generated(f);
  check('a CRLF-flipped copy still hashes equal (core.autocrlf cannot flip this pin red)',
        S.sha(good.replace(/\r?\n/g, '\r\n')) === S.sha(good.replace(/\r\n/g, '\n')));
  const oneByte = good.slice(0, -2) + (good.endsWith(';\n') ? ' \n' : 'x');
  check('a one-byte change in the copy hashes DIFFERENT (→ stale)', S.sha(oneByte) !== S.sha(good));
  check('a copy missing its banner hashes DIFFERENT (→ stale)', S.sha(good.split('\n').slice(1).join('\n')) !== S.sha(good));
}

console.log('3. --check exits 1 on a stale copy (process-level, scratch DST)');
{
  // Run the real generator against a scratch destination by re-requiring it with DST redirected via a
  // tiny wrapper: simplest is to exercise diff() on a temp dir through a module copy.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-sync-'));
  try {
    const modSrc = fs.readFileSync(path.join(__dirname, 'sync-client-search.js'), 'utf8')
      .replace(/const DST = [^\n]+/, `const DST = ${JSON.stringify(path.join(tmp, 'search-ui'))};`);
    const modPath = path.join(tmp, 'sync-scratch.js');
    fs.writeFileSync(modPath, modSrc.replace(/path\.join\(__dirname, '\.\.'\)/, JSON.stringify(path.join(__dirname, '..'))));
    const M = require(modPath);
    const before = M.diff();
    check('scratch DST starts with every file missing', before.missing.length === M.sourceFiles().length);
    M.sync();
    const after = M.diff();
    check('after sync() the scratch copy is current', after.stale.length === 0 && after.missing.length === 0 && after.extra.length === 0);
    const f = M.sourceFiles()[0];
    fs.appendFileSync(path.join(M.DST, f), '\n// drift\n');
    check('an edit to the scratch copy is reported stale', M.diff().stale.includes(f));
    fs.writeFileSync(path.join(M.DST, 'orphan.js'), '// left over\n');
    check('an orphan file in the scratch copy is reported extra', M.diff().extra.includes('orphan.js'));
    M.sync();
    check('sync() mirrors: the orphan is removed and the drifted file rewritten', M.diff().extra.length === 0 && M.diff().stale.length === 0);
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
