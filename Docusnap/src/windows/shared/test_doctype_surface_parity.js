'use strict';
/*
 * test_doctype_surface_parity.js — the Teach wizard and Settings must offer the SAME document-type
 * controls, and must reach them through the SAME code.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/windows/shared/test_doctype_surface_parity.js
 *
 * THE DEFECT (owner-reported, 2026-08-07, fixed 2026-08-10): "the teach wizard add-new-type doesn't
 * have the add-from-catalog button and more". A type created inside the wizard was a second-class
 * citizen — the EDITOR was already shared, so fields and structural roles matched, but everything
 * around it lived only in Settings. In practice that meant: mid-teach, holding the document, you
 * could not tick "Sales Invoice" and get its fields and likely printed labels for free, and you
 * could not add a missing field to an existing type without abandoning the wizard.
 *
 * WHY A SOURCE-LEVEL PIN. Both surfaces are renderers driven by IPC; exercising them properly needs
 * a live app. What this asserts is the thing that actually rots: that the two screens keep calling
 * ONE implementation instead of growing private copies. This codebase has been bitten by exactly
 * that shape before — two spellings of one predicate drifting apart — which is why the catalog was
 * extracted rather than duplicated.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const teachHtml = read('src/windows/teach/index.html');
const teachJs   = read('src/windows/teach/renderer.js');
const setHtml   = read('src/windows/settings/index.html');
const setJs     = read('src/windows/settings/renderer.js');
const catalogJs = read('src/windows/shared/doctype-catalog.js');

console.log('1. ONE catalog implementation, mounted twice');
check('the catalog lives in the shared folder', catalogJs.includes('window.DocTypeCatalog'));
check('Settings calls the shared one', setJs.includes('window.DocTypeCatalog.open'));
check('Teach calls the shared one', teachJs.includes('window.DocTypeCatalog.open'));
check('Settings no longer builds its own catalog overlay',
      !setJs.includes('Add document types from catalog'));
check('...and the markup for it exists in exactly one file',
      catalogJs.includes('Add document types from catalog'));

console.log('\n2. BOTH windows load the shared scripts');
for (const [name, html] of [['teach', teachHtml], ['settings', setHtml]]) {
  check(`${name} loads doctype-catalog.js`, html.includes('shared/doctype-catalog.js'));
  check(`${name} loads doctype-editor.js`, html.includes('shared/doctype-editor.js'));
}

console.log('\n3. The wizard offers what Settings offers');
check('Teach has an "Add from catalog" button', teachHtml.includes('id="btn-teach-catalog"'));
check('Teach has an "Edit this type" button', teachHtml.includes('id="btn-teach-edit-type"'));
check('Teach mounts the shared editor in CREATE mode', /mode:\s*'create'/.test(teachJs));
check('Teach mounts the shared editor in EDIT mode', /mode:\s*'edit'/.test(teachJs));
check('Settings mounts the same two modes',
      /mode:\s*'create'/.test(setJs) && /mode:\s*'edit'/.test(setJs));

console.log('\n4. The wizard stays usable after a type changes underneath it');
check('adding from the catalog re-renders the type list',
      /onAdded[\s\S]{0,200}renderTypeStep\(\)/.test(teachJs));
check('editing a type refreshes the fields the operator is about to teach',
      /onChange[\s\S]{0,600}state\.fields\s*=/.test(teachJs));
check('the edit button is hidden while creating a new type',
      /btn-teach-edit-type[\s\S]{0,400}isNew \? 'none'/.test(teachJs));

console.log('\n5. The modal opts out of help-mode (the dead-dialog class)');
check('the shared overlay sets data-help-ignore', catalogJs.includes('data-help-ignore'));

console.log(fails ? `\n${fails} FAILED` : '\nAll doc-type surface-parity pins passed');
process.exit(fails ? 1 : 0);
