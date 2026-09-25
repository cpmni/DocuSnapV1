'use strict';
/*
 * test_review_redetect_receipt.js — pins the QUIET-REDETECT RECEIPT in the Review window (Chris 2026-09-24 card 1,
 * built af048af; type NAMES in the toast 2026-09-25).
 * Run: node src/windows/review/test_review_redetect_receipt.js
 *
 * THE FRICTION THIS PINS. A quiet redetect is the direct consequence of something the user just did (added a type
 * from the catalog / saved a keyword label). Its completion used to be silent: the list kept the OLD reading while
 * the pile sorted itself, and the document being viewed — which the lane deliberately never touches — gave no hint
 * that it had been left behind. The `job_done` branch for `ev.kind === 'redetect'` must therefore:
 *   1. refresh the queue AT ONCE (never the open document's pane — the lane skips anything being viewed);
 *   2. toast a receipt that names what was re-read and WHY (the type NAMES the person chose — "Credit Note", never
 *      the lane's slug "credit_note"; live-verified 2026-09-25: the slug leaked into the toast);
 *   3. when the open document was one the pass skipped (`ev.viewing` carries those ids), say so and point at the
 *      one action that applies it (Reprocess).
 * Source-regex pin: the renderer runs only inside Electron, so this reads the code and asserts its shape.
 */
const fs   = require('fs');
const path = require('path');
const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

const start = renderer.indexOf("if (ev.kind === 'redetect') {");
check('a job_done branch exists for the redetect kind', start > -1);
const branch = start > -1 ? renderer.slice(start, start + 2600) : '';

check('1. the list is refreshed at once from the broadcast',
      /await _refreshQueueFromBroadcast\(\)/.test(branch));
check('1. ... and the open document is NEVER re-selected/re-read by the receipt (no selectDoc / reprocess call in the branch)',
      branch.length > 0 && !/selectDoc\(/.test(branch) && !/btn-reprocess/.test(branch));
check('2. the receipt toast names the count and says the list was refreshed',
      /showToast\(`Re-read \$\{n\} document/.test(branch) && /the list has been refreshed/.test(branch));
check('2. the toast maps every type SLUG to its NAME through the doc-type cache (never `typeSlugs.join`)',
      /const typeName = \(s\) =>/.test(branch)
      && /j\.typeSlugs\.map\(typeName\)\.join\(', '\)/.test(branch)
      && !/j\.typeSlugs\.join\(/.test(branch));
check('2. ... falling back to the slug itself when the cache has no such type (never an empty name)',
      /return t && t\.name \? t\.name : s;/.test(branch));
check('3. the open document is recognised as SKIPPED from the event\'s viewing ids',
      /const openSkipped = !!\(currentDoc && Array\.isArray\(ev\.viewing\) && ev\.viewing\.includes\(currentDoc\.id\)\)/.test(branch));
check('3. ... and the toast then says it was left as it was and points at Reprocess',
      /left as it was while you had it open/.test(branch) && /press Reprocess to apply it there too/.test(branch));
check('the toast is a receipt only: nothing is shown when the pass re-read 0 documents',
      /if \(n > 0\) showToast\(/.test(branch));

// ── The DURABLE receipt (2026-09-25): the activity strip renders the lane's 'recognised' event ──
console.log('\nactivity strip — the recognised chip:');
check('the pencil icon + the fix tone (typed, not filed — never a green tick)',
      /_asIcon\(ev\) \{[^\n]*ev\.kind === 'recognised'\) \? '✎'/.test(renderer)
      && /ev\.kind === 'convention' \|\| ev\.kind === 'recognised'\) return 'fix';/.test(renderer));
check('the chip label says how many were given their type', /case 'recognised': return `\$\{n\} given \$\{n === 1 \? 'its' : 'their'\} type`;/.test(renderer));
check('the panel sentence names the type(s) the pass ran for via the doc-type cache, and says typed-not-filed',
      /function _asTypeNames\(ev\)/.test(renderer)
      && /case 'recognised': \{ const names = _asTypeNames\(ev\)\.map\(escHtml\);/.test(renderer)
      && /given \$\{n === 1 \? 'its' : 'their'\} type\$\{why\} — check and confirm them as usual/.test(renderer));

// The cache the name mapping reads must be refreshed by the doc-types broadcast (a type added from the catalog
// reaches this window before the lane finishes), or the toast would fall back to slugs again.
check('allDocTypes is reloaded on the doc-types-changed broadcast',
      /window\.docusnap\.onDocTypesChanged\?\.\(async \(\) => \{\s*\n?\s*try \{ allDocTypes = await window\.docusnap\.getAllDocTypes\(\); \} catch \{\}/.test(renderer));

console.log(fails ? `\n${fails} FAILED` : '\nall green');
process.exit(fails ? 1 : 0);
