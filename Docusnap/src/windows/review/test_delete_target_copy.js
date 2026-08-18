'use strict';
/*
 * test_delete_target_copy.js — PINs for the delete-surface disambiguation (Chris round-8 card 1).
 *
 * THE FINDING, resolved at source: the toolbar name (#doc-name) is written ONLY by _selectDoc
 * (from the same `doc` that becomes currentDoc, synchronously) and clearDocPanel — so the
 * action-bar Delete structurally CANNOT name a different document than the toolbar shows. What
 * Chris actually hit was a ROW-level × (his driver's title-based selector; queue-row ×s shared
 * the action-bar's title="Delete document", and the hidden deferred tab's ×s are in the DOM),
 * whose dialog honestly named THAT row's doc. Two real gaps remained and are fixed + pinned:
 *   1. all three delete surfaces shared IDENTICAL dialog copy — neither an operator nor a driver
 *      could tell WHICH delete they triggered;
 *   2. a row-× deleting a doc that is NOT the one open on the right is a genuine misclick
 *      hazard — the dialog now says so explicitly when they differ.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/windows/review/test_delete_target_copy.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const src  = fs.readFileSync(path.join(REPO, 'src', 'windows', 'review', 'renderer.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('1. the action-bar Delete reads the LIVE selection (currentDoc), no captured doc');
check('btn-delete confirm names currentDoc',
      /btn-delete'\)\.addEventListener\('click', async \(\) => \{\s*\n\s*if \(!currentDoc\) return;\s*\n\s*if \(!confirm\(`Delete "\$\{currentDoc\.original_filename\}"/.test(src));

console.log('2. row-level deletes carry the mismatch clause when the row is not the open doc');
const mismatch = /currentDoc && currentDoc\.id !== doc\.id\)\s*\n\s*\? `\\n\\nNote: this is the document in the row you clicked — NOT "\$\{currentDoc\.original_filename\}"/g;
check('BOTH row paths (queue deleteFromQueue + deferred qi-delete) carry it',
      (src.match(mismatch) || []).length === 2);

console.log('3. the surfaces are selector-distinguishable (no more shared titles)');
check("row ×s are titled 'Delete this row's document'",
      (src.match(/title="Delete this row's document"/g) || []).length === 2);
check('the action-bar button keeps its own distinct title (index.html)',
      /id="btn-delete"[^>]*title="Delete document"/.test(
        fs.readFileSync(path.join(REPO, 'src', 'windows', 'review', 'index.html'), 'utf8')));

console.log('4. the structural invariant the finding relied on stays true');
check('#doc-name is written only by _selectDoc (from the doc that becomes currentDoc) + clearDocPanel',
      (src.match(/getElementById\('doc-name'\)\.textContent\s*=/g) || []).length === 2);
check('currentDoc is assigned SYNCHRONOUSLY at the top of _selectDoc, before any await',
      /_clearPreviewState\(\);[\s\S]{0,220}currentDoc\s+=\s+doc;/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
