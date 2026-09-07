#!/usr/bin/env node
'use strict';
/*
 * src/modules/processing/test_last_picked_dir.js — owner 2026-09-07: "the app used to remember the last opened
 * folder but it now defaults to Documents — remember the last location for that session; default back on a
 * reopen". Session-only memory shared by the import-folder picker and the teach PDF picker: a module variable
 * (never a setting), a file pick remembers its directory, a missing directory falls back to the OS default.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/processing/test_last_picked_dir.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const H = require('./handler');

console.log('1 the memory');
H._resetPickedDir();
check('nothing remembered → undefined (the OS default, Documents)', H._pickerDefaultPath() === undefined);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-pick-'));
H._rememberPickedDir(dir);
check('a picked folder is remembered', H._pickerDefaultPath() === dir);
const file = path.join(dir, 'a.pdf'); fs.writeFileSync(file, 'x');
H._rememberPickedDir(file);
check('a picked FILE remembers its directory (teach after import opens where the operator was)', H._pickerDefaultPath() === dir);
H._rememberPickedDir(path.join(dir, 'missing', 'b.pdf'));
check('a non-existent pick is ignored (memory kept)', H._pickerDefaultPath() === dir);
fs.rmSync(dir, { recursive: true, force: true });
check('a remembered folder that vanished falls back to the OS default', H._pickerDefaultPath() === undefined);
H._resetPickedDir();

console.log('2 the pickers (source pin)');
const src = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8').replace(/\r\n/g, '\n');
const pick = src.slice(src.indexOf("ipcMain.handle('pick-folder'"), src.indexOf("ipcMain.handle('pick-folder'") + 700);
const teach = src.slice(src.indexOf("ipcMain.handle('stage-pdf-for-teach'"), src.indexOf("ipcMain.handle('stage-pdf-for-teach'") + 900);
check('pick-folder opens at the remembered folder + remembers the pick', /defaultPath: _pickerDefaultPath\(\)/.test(pick) && /_rememberPickedDir\(r\.filePaths\[0\]\)/.test(pick));
check('stage-pdf-for-teach opens at the remembered folder + remembers the pick', /defaultPath: _pickerDefaultPath\(\)/.test(teach) && /_rememberPickedDir\(r\.filePaths\[0\]\)/.test(teach));
check('session-only: the memory is a module variable, never written to settings', /^let _lastPickedDir = null;/m.test(src) && !/setSetting\([^)]*_lastPickedDir/.test(src));
check('the output-folder picker is untouched (a settings value, not a session pick)', !/pick-output-folder'[\s\S]{0,400}defaultPath: _pickerDefaultPath/.test(src));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
