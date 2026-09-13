'use strict';
/*
 * test_quickfile_drop.js — PIN for Quick File drag-drop (Slice A, Oracle SIGN-OFF-W/COND 2026-09-13).
 * Source-wiring pins: the path seam (preload webUtils), the validated stage IPC, the scoped drop
 * handler, and the Q-C12 invariant that the window-level preload drop guard is UNCHANGED.
 * Run: node src/modules/directIntake/test_quickfile_drop.js
 */
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
let pass = 0, fail = 0;
const check = (n, ok) => { if (ok) { pass++; console.log(`  ok  ${n}`); } else { fail++; console.log(`  FAIL ${n}`); } };

console.log('1. preload path seam (Electron 44: File.path gone → webUtils in the preload only)');
{
  const pre = read('src/preload.js');
  check('webUtils imported from electron', /const \{[^}]*\bwebUtils\b[^}]*\} = require\('electron'\)/.test(pre));
  check('preload resolves paths in a [data-intake-drop]-scoped drop listener (real File, not a proxy)',
        /closest\('\[data-intake-drop\]'\)/.test(pre) && /webUtils\.getPathForFile\(files\[i\]\)/.test(pre));
  check('onQuickFileDrop registers the renderer callback', /onQuickFileDrop:\s*\(cb\)\s*=>/.test(pre));
  check('quickFileStagePaths invokes the validated stage IPC',
        /quickFileStagePaths:\s*\(paths\)\s*=>\s*ipcRenderer\.invoke\('direct-intake-stage-paths', paths\)/.test(pre));
}

console.log('2. Q-C12 invariant: the window-level drop guard is UNCHANGED (byte-identical backstop)');
{
  const pre = read('src/preload.js');
  check("window 'dragover' preventDefault stays", /window\.addEventListener\('dragover', \(e\) => e\.preventDefault\(\), false\)/.test(pre));
  check("window 'drop' preventDefault stays (kills file:// nav for EVERY window)",
        /window\.addEventListener\('drop', \(e\) => e\.preventDefault\(\), false\)/.test(pre));
}

console.log('3. MAIN validated stage IPC (renderer-supplied paths → the ONE Q-C10 validator)');
{
  const h = read('src/modules/directIntake/handler.js');
  check("registers 'direct-intake-stage-paths'", /ipcMain\.handle\('direct-intake-stage-paths'/.test(h));
  check('stage-paths is role + enabled gated',
        /direct-intake-stage-paths'[\s\S]{0,220}requireRole\('admin', 'edit'\)[\s\S]{0,120}if \(!enabled\(db\)\)/.test(h));
  check('stagePaths runs the shared validator (svc.validateIntakePath)', /svc\.validateIntakePath\(String\(p/.test(h));
  check('the dialog picker also goes through stagePaths(db, …)', /stagePaths\(db, res\.filePaths/.test(h));
}

console.log('4. renderer drop handler is SCOPED and keeps the backstop');
{
  const v = read('src/windows/main/quickfileView.js');
  check('dropzone carries data-intake-drop (scopes the wiring to this element)', /'data-intake-drop': ''/.test(v));
  check('a drop preventDefaults (consumes) but does NOT call stopPropagation (window backstop stays)',
        /dropZone\.addEventListener\('drop'[\s\S]{0,400}e\.preventDefault\(\)/.test(v)
        && !/dropZone\.addEventListener\('drop'[\s\S]{0,600}\.stopPropagation\(/.test(v));
  check('renderer registers onQuickFileDrop and forwards resolved paths to MAIN',
        /D\.onQuickFileDrop\(/.test(v) && /D\.quickFileStagePaths\(paths\)/.test(v));
  check('refused files surface a plain reason (never a silent drop)', /_refuseReason\(refused\[0\]\.refused\)/.test(v));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
