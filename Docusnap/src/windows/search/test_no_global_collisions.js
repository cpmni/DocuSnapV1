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
 * script files, so the class can't come back under a different name.
 *
 *   node src/windows/search/test_no_global_collisions.js
 */
const fs = require('fs');
const path = require('path');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

// The script files the window loads (from index.html), in order.
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const files = [...html.matchAll(/<script src="([^"]+\.js)"><\/script>/g)].map(m => m[1])
  .filter(f => !f.includes('/') || f.startsWith('search'));   // window-local scripts only (shared/ files load in every window by design)

check(`found the window's local scripts in index.html (${files.join(', ')})`, files.length >= 4);

const decls = {};   // name -> [file, ...]
for (const f of files) {
  let src = '';
  try { src = fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch { continue; }
  // async functions included (`async function init` collided with a plain `function init`
  // across two files — benign only by namespace-export luck). Duplicate function/var = SILENT
  // last-wins; duplicate let/const (or mixed) = a SyntaxError that kills the later script
  // entirely — this pin catches both classes.
  for (const m of src.matchAll(/^(?:(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/gm)) {
    const name = m[1] || m[2];
    (decls[name] || (decls[name] = [])).push(f);
  }
}
const dupes = Object.entries(decls).filter(([, fs2]) => new Set(fs2).size > 1);
check('no top-level name is declared in more than one search-window script'
      + (dupes.length ? ` — DUPES: ${dupes.map(([n, fs2]) => `${n} (${[...new Set(fs2)].join(' + ')})`).join('; ')}` : ''),
      dupes.length === 0);

console.log(fails ? `\n${fails} FAILED` : '\nAll search-window global-collision pins passed');
process.exit(fails ? 1 : 0);
