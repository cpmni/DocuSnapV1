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

console.log('4. multi-doc pane (S4a) + typeahead (S4b) wiring — Oracle conditions');
{
  const html = read('src/windows/main/index.html');
  const qf = read('src/windows/main/quickfileView.js');
  const preload = read('src/preload.js');
  const prev = read('src/services/previewService.js');
  const di = read('src/modules/directIntake/handler.js');
  // CSP1 — main window gains img-src 'self' data: (keeps 'self'); previews are data-URL png/jpeg.
  check("CSP1: main index.html adds img-src 'self' data:", /img-src 'self' data:/.test(html));
  // REG1 — single-file path intact: the multi-doc render is GUARDED by flag+>1, the plain loop still exists.
  check('REG1: multi-doc guarded by quickfile_multidoc_enabled && staged.length > 1', /multiDocEnabled && staged\.length > 1/.test(qf));
  check('REG1: single-file/shared render loop still present', /for \(const f of staged\) \{[\s\S]{0,200}qf-filerow/.test(qf));
  check('REG1: no innerHTML in the pane (still)', !/\.innerHTML/.test(qf));
  // IPC1 — preview by token, gated, exact:true, non-renderable → icon.
  check('IPC1: preload exposes quickFilePreview', /quickFilePreview:\s*\(token\)\s*=>\s*ipcRenderer\.invoke\('direct-intake-preview', token\)/.test(preload));
  check('IPC1: direct-intake-preview handler is role+enabled gated', /ipcMain\.handle\('direct-intake-preview'[\s\S]{0,220}requireRole\('admin', 'edit'\)[\s\S]{0,120}if \(!enabled\(db\)\)/.test(di));
  check('IPC1: preview uses getThumbnail with exact:true + isRenderable gate', /isRenderable\(s\.ext\)/.test(di) && /exact: true/.test(di));
  // EXACT1 — getThumbnail forwards exact.
  check('EXACT1: getThumbnail destructures + forwards exact', /function getThumbnail\(db, \{ docId, folderPath, filename, exact \}/.test(prev) && /_resolveDocFile\(db, \{ docId, folderPath, filename, exact \}/.test(prev));
  // MC2 — the pane uses the shared pinned meta helper (window.quickfileMeta), loaded before the pane.
  check('MC2: quickfileMeta.js loaded before quickfileView.js', /quickfileMeta\.js"><\/script>[\s\S]{0,120}quickfileView\.js/.test(html));
  check('MC2: doFile builds per-doc meta via window.quickfileMeta (buildMeta/withDefaults)', /window\.quickfileMeta[\s\S]{0,400}QF\.withDefaults\(f, sharedVals\)[\s\S]{0,200}QF\.buildMeta\(documentTypeId, merged\)/.test(qf));
  // S4b — typeahead on the bound list's trigger field.
  check('S4b: typeahead calls lookup.suggest + lookup.resolve', /D\.lookup\.suggest\(/.test(qf) && /D\.lookup\.resolve\(/.test(qf));
}

console.log('5. F1 (2026-09-21 Chris vet) — el() skips null kids; twin parity with lookupAdmin.js');
{
  // A no-disambiguator (or blank-disambiguator) Records list makes the typeahead row pass a `null` second
  // kid; the unguarded el() did appendChild(null) → the dropdown never rendered (crash every keystroke).
  const qf = read('src/windows/main/quickfileView.js');
  const la = read('src/windows/settings/lookupAdmin.js');
  const guard = /for \(const c of \[\]\.concat\(kids\)\) if \(c != null\) n\.appendChild/;
  check('quickfileView.js el() guards null kids (a `? x : null` kid must be a no-op, not appendChild(null))', guard.test(qf));
  check('lookupAdmin.js el() has the SAME guard — the twins must not diverge again (this WAS the root cause)', guard.test(la));
  check('the crash callsite is intact: the row still passes a null 2nd kid when there is no disambiguator',
        /\[el\('span', \{\}, row\.master_value\), sub \? el\('span'/.test(qf));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
