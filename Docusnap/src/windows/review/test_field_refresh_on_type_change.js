'use strict';
/**
 * test_field_refresh_on_type_change.js — PIN for the Review field refresh on a type edit (2026-09-24, Chris
 * 09-23 card 2c; eric D1 → Oracle C11). Source-slice pins (the renderer is DOM-bound):
 *  - the doc-types-changed handler calls the refresh;
 *  - the refresh re-resolves fieldDefs for the doc on screen and DIFFS BY KEY (appendFieldRow for new keys,
 *    remove for gone keys) — never renderFields() / innerHTML = '' (a repaint reverts a value being typed);
 *  - it no-ops while a confirm or File All is in flight and re-runs when they land;
 *  - the confirmCurrentDoc DECLARATION is untouched (the payload pins slice it) — the wrapper reassigns the binding.
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron src/windows/review/test_field_refresh_on_type_change.js
 */
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function check(label, ok, extra) {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`); }
}
const src = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8').replace(/\r\n/g, '\n');
const slice = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i + 1); return i < 0 || j < 0 ? '' : src.slice(i, j); };

console.log('\n1. the doc-types-changed handler refreshes the rows');
const handler = slice("window.docusnap.onDocTypesChanged?.(async () => {", "\n});");
check('handler still reloads allDocTypes + the dropdown', /allDocTypes = await window\.docusnap\.getAllDocTypes\(\)/.test(handler) && /populateTypeDropdown\(\);/.test(handler));
check('handler calls _refreshFieldDefsForCurrentDoc()', /_refreshFieldDefsForCurrentDoc\(\);/.test(handler));

console.log('\n2. the refresh diffs by key, never repaints');
const fn = slice('function _refreshFieldDefsForCurrentDoc() {', '\n// The in-flight guard');
check('located', fn.length > 300);
check('no-op + deferred while a confirm or File All is in flight', /if \(_confirmInFlight > 0 \|\| bulkFiling\) \{ _fieldRefreshPending = true; return; \}/.test(fn));
check('only the doc on screen (currentDoc === _lastRenderedDoc)', /if \(!currentDoc \|\| !doc \|\| doc\.id !== currentDoc\.id\) return;/.test(fn));
check('re-resolves fieldDefs from the CURRENT type (selectedTypeSlug)', /allDocTypes \|\| \[\]\)\.find\(t => t && t\.slug === selectedTypeSlug\)/.test(fn) && /fieldDefs = dt\.fields;/.test(fn));
check('removes the row of a key that LEFT the type (never scraped into allValues)', /if \(nextSet\.has\(key\)\) continue;\s*scroll\.querySelector\(`\.field-row\[data-key="\$\{CSS\.escape\(key\)\}"\]`\)\?\.remove\(\);/.test(fn));
check('appends rows for NEW keys only via appendFieldRow', /if \(prev\.has\(key\)\) continue;/.test(fn) && /appendFieldRow\(scroll, key, val,/.test(fn));
check('honours the hidden+empty skip renderFields applies', /if \(hiddenKeys\.has\(key\) && String\(val\)\.trim\(\) === ''\) continue;/.test(fn));
check('honours the issuer-change clear (no resurrection)', /clearedByIssuerChange\.has\(key\) \? ''/.test(fn));
check('NEVER renderFields() and NEVER innerHTML = \'\' (a repaint reverts a value being typed)', !/renderFields\(/.test(fn) && !/innerHTML\s*=\s*''/.test(fn));
check('re-validates the Confirm gate after the diff', /validateConfirm\(\);/.test(fn));

console.log('\n3. the in-flight guard');
const guard = slice('// The in-flight guard for the refresh above', '\n}\n');
check('confirmCurrentDoc is WRAPPED by reassignment (declaration untouched)', /const _confirmCurrentDocRaw = confirmCurrentDoc;\s*confirmCurrentDoc = async function \(opts\) \{/.test(guard) && /async function confirmCurrentDoc\(\{ bulk = false/.test(src));
check('counter up/down around the raw confirm, deferred refresh re-run on 0', /_confirmInFlight\+\+;/.test(guard) && /_confirmInFlight--;/.test(guard) && /if \(_confirmInFlight === 0 && _fieldRefreshPending && !bulkFiling\)/.test(guard));
const fa = slice('async function fileAllReady() {', '\n}\n');
check('File All re-runs a deferred refresh once bulkFiling clears', /bulkFiling = false;[^\n]*\n\s*if \(_fieldRefreshPending\) \{ try \{ _refreshFieldDefsForCurrentDoc\(\); \} catch \{\} \}/.test(fa));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
