'use strict';
/*
 * test_no_global_collisions.js — the Search window loads PLAIN (non-module) scripts into ONE
 * shared global scope. Two files declaring the same top-level `function _x` silently shadow
 * each other by load order — THE INCIDENT: search-workflow.js (loaded last) declared its own
 * `_btn(label, primary, onClick)` over search-actions.js's `_btn(container, label, onClick)`,
 * and every Document-Actions button (Open in Explorer / Open File / Send back / Delete /
 * Restore / Edit in Review) silently appended NOTHING for weeks — the section-drop guard then
 * hid the whole panel, so no error ever surfaced. Found by Chris The Customer's round-2 review
 * ("I found the invoice and then couldn't do anything with it"), confirmed live over CDP.
 *
 * This pin fails on ANY duplicate top-level function/const/let/var name across the window's
 * script files, so the class can't come back under a different name. Since the shared search
 * UI extraction (2026-09-13) the set spans THREE origins in one scope — the window's own scripts
 * (coreTransport, search-workflow/mailbox/stamp, renderer), the shared search-ui module
 * (../shared/search-ui/*.js — ALSO loaded by the client's pop-out) and the common shared scripts
 * (theme/helpmode/dialogFocus) — every one is scanned. A planted-dupe self-test proves the scan
 * still bites (Oracle C3).
 *
 *   node src/windows/search/test_no_global_collisions.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

// Every <script src> a window html loads, resolved against the html's dir. Returns the duplicate
// top-level names ([name, [file, ...]]) across ALL of them — shared scripts included (Oracle A3: they
// load into the SAME global scope, so a dupe there is just as silent).
function scanDupes(htmlPath) {
  const dir = path.dirname(htmlPath);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const all = [...html.matchAll(/<script src="([^"]+\.js)"><\/script>/g)].map(m => m[1]);
  const decls = {};   // name -> [file, ...]
  for (const f of all) {
    let src = '';
    try { src = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    // async functions included (`async function init` collided with a plain `function init`
    // across two files — benign only by namespace-export luck). Duplicate function/var = SILENT
    // last-wins; duplicate let/const (or mixed) = a SyntaxError that kills the later script
    // entirely — this pin catches both classes.
    for (const m of src.matchAll(/^(?:(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/gm)) {
      const name = m[1] || m[2];
      (decls[name] || (decls[name] = [])).push(f);
    }
  }
  return { all, dupes: Object.entries(decls).filter(([, fs2]) => new Set(fs2).size > 1) };
}

// 1 — the real window.
const { all, dupes } = scanDupes(path.join(__dirname, 'index.html'));
const locals = all.filter(f => !f.includes('/'));
const shared = all.filter(f => f.includes('/search-ui/'));
check(`found the window's local scripts in index.html (${locals.join(', ')})`, locals.length >= 4);
check(`the shared search-ui module is in the scanned set (${shared.length} files)`, shared.length >= 6);
check('the adapter loads BEFORE the first shared search-ui script (window.SearchTransport must exist when they run)',
      all.indexOf('coreTransport.js') >= 0 && all.indexOf('coreTransport.js') < all.findIndex(f => f.includes('/search-ui/')));
check('no top-level name is declared in more than one script in this window\'s shared scope'
      + (dupes.length ? ` — DUPES: ${dupes.map(([n, fs2]) => `${n} (${[...new Set(fs2)].join(' + ')})`).join('; ')}` : ''),
      dupes.length === 0);

// 2 — self-test: a scratch copy of the window with ONE planted duplicate (a shared search-ui name
// re-declared in a local script) must be caught, or this pin is a vacuous green.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-collide-'));
  try {
    const win = path.join(tmp, 'search'); fs.mkdirSync(win);
    const ui = path.join(tmp, 'shared', 'search-ui'); fs.mkdirSync(ui, { recursive: true });
    fs.writeFileSync(path.join(ui, 'searchState.js'), "'use strict';\nfunction escHtml(s) { return s; }\n");
    fs.writeFileSync(path.join(win, 'renderer.js'), "'use strict';\nfunction escHtml(s) { return String(s); }\n");
    fs.writeFileSync(path.join(win, 'index.html'),
      '<script src="../shared/search-ui/searchState.js"></script>\n<script src="renderer.js"></script>\n');
    const planted = scanDupes(path.join(win, 'index.html')).dupes;
    check('self-test: a planted cross-origin duplicate (shared search-ui name re-declared locally) IS caught',
          planted.length === 1 && planted[0][0] === 'escHtml');
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

console.log(fails ? `\n${fails} FAILED` : '\nAll search-window global-collision pins passed');
process.exit(fails ? 1 : 0);
