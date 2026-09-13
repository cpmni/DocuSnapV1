'use strict';
/*
 * test_client_search_sync.js — DRIFT GUARD #1 (checker half) for the shared search UI (client search
 * parity, 2026-09-13; Oracle C4 + S1): every COMMITTED client copy under client/renderer/shared/ must be
 * byte-equal (banner-aware, CRLF-normalised; binaries raw) to its canonical source under src/windows/shared/
 * — the search-ui module, theme.css, the fonts and the pattern tiles. Red = someone edited a source (or a
 * copy) without re-running scripts/sync-client-search.js, i.e. a core search/theme change that would NOT
 * reach the client. Also proves the checker bites: a one-byte change → stale; a removed source → extra; a
 * CRLF flip alone → still current; a binary copy is compared byte-for-byte.
 *
 *   node scripts/test_client_search_sync.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require(path.join(__dirname, 'sync-client-search.js'));

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('1. every committed client copy is current');
{
  const d = S.diff();
  const files = S.sourceFiles();
  check(`search-ui source has the shared modules (${files.length})`, files.length >= 9 && files.every(f => !/^test_/.test(f)));
  check('every source file has a copy' + (d.missing.length ? ` — missing: ${d.missing.join(', ')}` : ''), d.missing.length === 0);
  check('no copy is stale' + (d.stale.length ? ` — stale: ${d.stale.join(', ')} (run: node scripts/sync-client-search.js)` : ''), d.stale.length === 0);
  check('no orphan copy (mirror semantics)' + (d.extra.length ? ` — extra: ${d.extra.join(', ')}` : ''), d.extra.length === 0);
  for (const f of files) {
    const copy = fs.readFileSync(path.join(S.DST, f), 'utf8');
    check(`search-ui/${f}: the copy carries the GENERATED banner on line 1`, copy.split(/\r?\n/)[0] === (f.endsWith('.css') ? S.CSS_BANNER_LINE : S.BANNER_LINE));
  }
  const pins = fs.existsSync(S.DST) ? fs.readdirSync(S.DST).filter(f => /^test_/.test(f)) : [];
  check('no pin files are shipped to the client', pins.length === 0);
  // The S1 sets: the pop-out loads the REAL theme + its fonts + the seasonal tiles.
  const theme = path.join(S.CLIENT_SHARED, 'theme.css');
  check('theme.css is mirrored with its banner', fs.existsSync(theme) && fs.readFileSync(theme, 'utf8').split(/\r?\n/)[0] === S.THEME_BANNER_LINE);
  const fontSet = S.SETS.find(s => s.name === 'fonts'), patSet = S.SETS.find(s => s.name === 'patterns');
  check(`fonts mirrored (${S.listSrc(fontSet).length} woff2)`, S.listSrc(fontSet).length >= 8 && S.listSrc(fontSet).every(f => fs.existsSync(path.join(fontSet.dst, f))));
  check(`patterns mirrored (${S.listSrc(patSet).length} svg)`, S.listSrc(patSet).length >= 7 && S.listSrc(patSet).every(f => fs.existsSync(path.join(patSet.dst, f))));
  const f0 = S.listSrc(fontSet)[0];
  check('a binary copy is byte-identical to its source', f0 && Buffer.compare(fs.readFileSync(path.join(fontSet.src, f0)), fs.readFileSync(path.join(fontSet.dst, f0))) === 0);
}

console.log('2. the checker bites (hash semantics)');
{
  const f = S.sourceFiles()[0];
  const good = S.generated(f);
  check('a CRLF-flipped copy still hashes equal (core.autocrlf cannot flip this pin red)',
        S.sha(good.replace(/\r?\n/g, '\r\n')) === S.sha(good.replace(/\r\n/g, '\n')));
  const oneByte = good.slice(0, -2) + (good.endsWith(';\n') ? ' \n' : 'x');
  check('a one-byte change in the copy hashes DIFFERENT (→ stale)', S.sha(oneByte) !== S.sha(good));
  check('a copy missing its banner hashes DIFFERENT (→ stale)', S.sha(good.split('\n').slice(1).join('\n')) !== S.sha(good));
  const b = Buffer.from([1, 2, 3, 4]);
  check('a binary one-byte change hashes DIFFERENT', S.sha(b) !== S.sha(Buffer.from([1, 2, 3, 5])));
}

console.log('3. sync() + diff() on a scratch destination (mirror, stale, extra)');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-sync-'));
  try {
    // Re-require the module with CLIENT_SHARED redirected to the scratch dir.
    const modSrc = fs.readFileSync(path.join(__dirname, 'sync-client-search.js'), 'utf8')
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
    check('an orphan file in the scratch copy is reported extra', M.diff().extra.includes('orphan.js'));
    const fontSet = M.SETS.find(s => s.name === 'fonts'); const f0 = M.listSrc(fontSet)[0];
    fs.appendFileSync(path.join(fontSet.dst, f0), Buffer.from([0]));
    check('a modified binary copy is reported stale', M.diff().stale.includes('fonts/' + f0));
    M.sync();
    check('sync() mirrors: orphan removed, drifted text + binary rewritten', M.diff().extra.length === 0 && M.diff().stale.length === 0);
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
