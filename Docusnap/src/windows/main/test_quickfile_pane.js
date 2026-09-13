'use strict';
/*
 * test_quickfile_pane.js — PIN for the Quick File SUBMIT PANE (2026-09-13; barry pane>modal, eric router
 * swap, Oracle-gated). The pane replaces the old modal (quickfile.js) with an in-page view sibling to
 * Import. There is no in-repo jsdom harness for the Home renderer (eric), so these source pins guard the
 * wiring + the DARK/OFF gating; functional coverage is the unchanged service pins + a manual/Chris pass.
 *
 * Run: node src/windows/main/test_quickfile_pane.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(REPO, p));

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('1. router — the pane is a view, fail-closed when disabled');
{
  const rr = read('src/windows/main/renderer.js');
  check("VIEWS includes 'quickfile'", /const VIEWS = \['home', 'import', 'quickfile'\]/.test(rr));
  check('showView fail-closed unless QuickFileView.enabled',
        /name === 'quickfile' && !\(window\.QuickFileView && window\.QuickFileView\.enabled\)\) return/.test(rr));
  check('lazy enter() hook on entry', /name === 'quickfile' && window\.QuickFileView\) window\.QuickFileView\.enter\(\)/.test(rr));
  check('showView exposed for the Import cross-link', /window\.showView = showView;/.test(rr));
}

console.log('2. markup — the pane section + nav routing + the modal is gone');
{
  const html = read('src/windows/main/index.html');
  check('view-quickfile section + qf-root', /<section class="view" id="view-quickfile">/.test(html) && /id="qf-root"/.test(html));
  check('nav-quickfile now routes via data-view', /id="nav-quickfile" data-view="quickfile"/.test(html));
  check('nav-quickfile still hidden until revealed (DARK)', /id="nav-quickfile"[^>]*style="display:none;"/.test(html));
  check('loads quickfileView.js, not the old modal', /<script src="quickfileView\.js">/.test(html) && !/<script src="quickfile\.js">/.test(html));
  check('the old modal file is deleted', !exists('src/windows/main/quickfile.js'));
}

console.log('3. pane script — reveal gate, the unchanged IPCs, the receipt, CSP-safety');
{
  const qf = read('src/windows/main/quickfileView.js');
  check('exposes window.QuickFileView { enabled, enter }', /window\.QuickFileView = \{ get enabled\(\)[\s\S]{0,40}enter, refreshTypes \}/.test(qf));
  check('reveal reads the flag once and un-hides both triggers only when enabled',
        /quickFileDocTypes\(\)[\s\S]{0,200}view\.enabled = enabled;[\s\S]{0,80}if \(!enabled\) return;/.test(qf));
  check('uses the SAME four backend IPCs (no new backend)',
        /quickFilePick\(\)/.test(qf) && /quickFileDocTypes\(\)/.test(qf) && /quickFileAddType\(/.test(qf) && /quickFileSubmit\(/.test(qf));
  check('receipt actions: Open folder (de-pathed, by docId) / Find it / Undo(soft-delete)',
        /showDocumentInExplorer\(res\.docId\)/.test(qf) && !/showInExplorer\(res\.storedPath\)/.test(qf)
        && /openSearchWindow\(title \|\| name\)/.test(qf) && /deleteDocument\(res\.docId/.test(qf));
  check('CSP-safe: no innerHTML anywhere in the pane', !/\.innerHTML/.test(qf));
  check('the drag-drop target id exists for the later slice (boundary untouched now)', /id: 'qf-dropzone'/.test(qf));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
