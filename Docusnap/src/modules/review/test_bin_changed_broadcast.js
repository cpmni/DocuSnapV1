'use strict';
/*
 * test_bin_changed_broadcast.js — PINs for the recycle-bin change signal (Chris recurring card —
 * "the bin left open goes stale"; eric design + Oracle SIGN-OFF 2026-08-16).
 *
 * THE DEFECT: the bin view was pull-only and every bin mutation broadcast on a channel the Search
 * window structurally cannot hear — notifyMainWindow sends ONLY to main+review (main.js), and the
 * PURGE handlers broadcast NOTHING at all. The shipped focus-refresh never fired under Chris's
 * CDP-driven session (OS focus never toggles), which is why the card recurred twice.
 *
 * THE FIX: main exposes ctx.notifyBinChanged = () => notifyAllWindows('bin-changed') (pull-model,
 * no payload); every bin-mutating op fires it ONCE (never per-row in a bulk loop); the Search
 * window subscribes and re-runs its own role-gated get-deleted-queue when the bin view is active,
 * on a trailing debounce with its OWN timer.
 *
 * Source pins (the wiring is spread across five files — a drifted call-site is exactly what these
 * catch); the destroyed-window race is pinned BEHAVIOURALLY against the real safe-send.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/modules/review/test_bin_changed_broadcast.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('1. main exposes the signal (fan-out to ALL windows — the bin lives in SEARCH)');
{
  const main = read('src/main.js');
  check('ctx.notifyBinChanged fans out via notifyAllWindows(\'bin-changed\')',
        /notifyBinChanged: \(\) => notifyAllWindows\('bin-changed'\)/.test(main));
}

console.log('2. every bin-mutating op fires it exactly once (bulk = once AFTER the loop)');
{
  const rh = read('src/modules/review/handler.js');
  const between = (a, b) => rh.slice(rh.indexOf(a), b ? rh.indexOf(b) : undefined);
  check('delete-document fires', /delete-document[\s\S]{0,900}notifyBinChanged\(\)/.test(rh));
  check('restore-document fires', /restore-document[\s\S]{0,700}notifyBinChanged\(\)/.test(rh));
  check('restore-all-deleted fires ONCE after its loop',
        /restore-all-deleted[\s\S]{0,900}notifyBinChanged\(\)/.test(rh)
        && !/for \(const id of ids\) \{?\s*documents\.restoreDeleted\(db, id\);?\s*notifyBinChanged/.test(rh));
  check('purge-document fires (purge previously broadcast NOTHING — the exhibit)',
        /purge-document[\s\S]{0,600}notifyBinChanged\(\)/.test(rh));
  check('purge-all-deleted fires once', /purge-all-deleted[\s\S]{0,700}notifyBinChanged\(\)/.test(rh));
  check('_deleteQueue (delete-all) fires once after the loop, outside it',
        /_closeRoutesForDeleted\(db, rows\.map\(r => r\.id\), deletedByName\);[\s\S]{0,400}notifyBinChanged\(\)/.test(rh)
        && !/for \(const r of rows\) \{ documents\.softDelete\(db, r\.id\); n\+\+; notifyBinChanged/.test(rh));
  check('the handler tolerates a fixture ctx without the hook (optional, defaults to a no-op)',
        /typeof ctx\.notifyBinChanged === 'function' \? ctx\.notifyBinChanged : \(\) => \{\}/.test(rh));
}
{
  const sh = read('src/modules/settings/handler.js');
  check('recovery-apply (set-aside → bin) fires', /recoverySvc\.apply[\s\S]{0,1600}notifyBinChanged/.test(sh));
  check('recovery-restore-docs fires once for the batch', /restoreFromRecycleBin[\s\S]{0,600}notifyBinChanged/.test(sh));
  check('repair-delete fires', /repair_delete[\s\S]{0,300}notifyBinChanged/.test(sh));
  const ah = read('src/modules/api/handler.js');
  check('/v1 soft-delete fires (a remote client mutates the bin invisibly otherwise)',
        /documents\.softDelete\(getDb\(\), id\);\s*\n\s*try \{ ctx\.notifyBinChanged/.test(ah));
  check('/v1 restore + purge + empty-bin fire',
        (ah.match(/ctx\.notifyBinChanged && ctx\.notifyBinChanged\(\)/g) || []).length >= 4);
}

console.log('3. the Search window subscribes (push leg) and keeps the focus belt');
{
  const pre = read('src/preload.js');
  check('preload exposes onBinChanged', /onBinChanged:\s+\(cb\) => ipcRenderer\.on\('bin-changed', \(\) => cb\(\)\)/.test(pre));
  const sq = read('src/windows/search/search-query.js');
  check('subscriber re-pulls only in bin mode, on a trailing debounce with its OWN timer',
        /onBinChanged\(\(\) => \{\s*\n\s*if \(!\(window\.SearchState && window\.SearchState\.binMode\)\) return;\s*\n\s*clearTimeout\(binTimer\)/.test(sq));
  check('the focus-refresh belt is kept', /window\.addEventListener\('focus', \(\) => \{\s*\n\s*if \(window\.SearchState && window\.SearchState\.binMode\) doSearch\(\);/.test(sq));
  check('bin-truth-at-action-time is untouched (Restore-all/Empty-bin still query the DB, never the DOM)',
        /_binRows\(\)/.test(sq) && /const rows = await _binRows\(\);/.test(sq));
}

console.log('4. the destroyed-window race (behavioural, real safe-send)');
{
  const { makeSafeSend } = require(path.join(REPO, 'src', 'lib', 'safe-send.js'));
  const safeSend = makeSafeSend(null);
  let sent = 0, threw = false;
  const live = { isDestroyed: () => false, send: () => { sent++; } };
  const dead = { isDestroyed: () => true,  send: () => { throw new Error('Object has been destroyed'); } };
  try {
    safeSend(live, 'bin-changed');
    safeSend(dead, 'bin-changed');
    safeSend(undefined, 'bin-changed');
  } catch { threw = true; }
  check('a live window receives; a destroyed/missing one neither throws nor receives',
        !threw && sent === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
