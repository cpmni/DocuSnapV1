'use strict';
/*
 * test_import_app_managed_folder.js — the importer REFUSES the app's own working folders (owner 2026-09-14,
 * after Chris imported `.sf_separated_originals` and got a 34-page stack of blank pages: that folder holds the
 * ORIGINAL stacks the separator already split and filed; `.metadata` holds the filing sidecars). Name-based on
 * purpose — those folders can sit under any source tree, so no setting knows them.
 *
 *   node src/modules/processing/test_import_app_managed_folder.js
 */
const fs = require('fs');
const path = require('path');
const { isAppManagedFolder } = require('./handler');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('the predicate');
for (const p of ['C:\\Scans\\.sf_separated_originals', 'C:\\Scans\\.sf_separated_originals\\', 'C:/Scans/.sf_separated_originals/sub',
                 'C:\\Out\\Acme\\2026\\August\\.metadata', 'D:\\x\\.METADATA\\deep', '\\\\nas\\share\\inbox\\.sf_separated_originals'])
  check(`refused: ${p}`, isAppManagedFolder(p) === true);
for (const p of ['C:\\Scans', 'C:\\Scans\\separated_originals', 'C:\\Scans\\sf_separated_originals', 'C:\\Out\\Acme\\metadata',
                 'C:\\Scans\\my.metadata.files', 'C:\\Scans\\.sf_separated_originals_old', '', null])
  check(`allowed: ${JSON.stringify(p)}`, isAppManagedFolder(p) === false);

console.log('the wiring');
const src = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8');
check('process-folder refuses an app-managed folder BEFORE any work, with a plain message',
      /if \(isAppManagedFolder\(folderPath\)\) \{\s*\n\s*return \{ success: false, error: 'This folder is one ScanFinder manages itself/.test(src)
      && src.indexOf("if (isAppManagedFolder(folderPath))") < src.indexOf("licenseDenied(db)"));
check('the separator still writes originals to the same folder name the predicate knows', /const SEPARATED_DIR = '\.sf_separated_originals';/.test(src) && /sf_separated_originals\|metadata/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
