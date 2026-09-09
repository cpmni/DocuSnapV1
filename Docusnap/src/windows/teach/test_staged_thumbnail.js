#!/usr/bin/env node
'use strict';
/*
 * src/windows/teach/test_staged_thumbnail.js — owner 2026-09-07: "when I open teach and import a doc, it takes a
 * very long time for it to finish and the thumbnail to appear". The wizard now shows a provisional card with the
 * picked PDF's page-1 thumbnail (rendered from the STAGED copy) the moment it is picked; the read itself is
 * unchanged. Source pin: the IPC accepts only the app's own sf-teach-* staging dir under the OS temp root and a
 * bare basename; the preload forwards it; the renderer shows the card BEFORE processFolder and removes it on
 * success or error.
 *
 *   node src/windows/teach/test_staged_thumbnail.js
 */
const fs = require('fs');
const path = require('path');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const strip = (s) => s.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
const ph = strip(fs.readFileSync(path.join(__dirname, '..', '..', 'modules', 'processing', 'handler.js'), 'utf8'));
const pre = strip(fs.readFileSync(path.join(__dirname, '..', '..', 'preload.js'), 'utf8'));
const tw = strip(fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8'));

console.log('1 the IPC is fenced to the staging dir');
const ipc = ph.slice(ph.indexOf("ipcMain.handle('get-staged-teach-thumbnail'"), ph.indexOf("ipcMain.handle('get-staged-teach-thumbnail'") + 1400);
check('admin/edit gated', /requireRole\('admin', 'edit'\);/.test(ipc));
check('folder must be DIRECTLY under os.tmpdir() and named sf-teach-*', /path\.dirname\(dir\) !== tmpRoot \|\| !path\.basename\(dir\)\.startsWith\('sf-teach-'\)/.test(ipc));
check('filename must be a bare basename', /if \(!base \|\| base !== filename\) return null;/.test(ipc));
check('renders via previewService.getThumbnail with docId null (no DB row, the staged copy itself)', /getThumbnail\(getDb\(\), \{ docId: null, folderPath: dir, filename: base \}/.test(ipc));
check('never throws to the renderer', /catch \(err\) \{[\s\S]{0,200}return null;/.test(ipc));

console.log('2 the road');
check('preload forwards (folder, filename)', /getStagedTeachThumbnail: \(folder, filename\) => ipcRenderer\.invoke\('get-staged-teach-thumbnail', folder, filename\)/.test(pre));
check('the card is shown BEFORE processFolder and removed after the read (now inside the held readPromise, token-guarded)',
      /const _prov = _showProvisionalCard\(staged\);[\s\S]{0,1400}await D\.processFolder\(staged\.folder, \{ autoFile: false \}\);[\s\S]{0,400}_prov\.remove\(\);/.test(tw));
check('…and removed on error (in the held-read catch)', /catch \(e\) \{[\s\S]{0,120}_prov\.remove\(\);/.test(tw));
check('the provisional card carries the thumbnail from the staged copy', /function _showProvisionalCard\(staged\)[\s\S]{0,900}D\.getStagedTeachThumbnail\(staged\.folder, staged\.filename\)/.test(tw));
check('a missing grid or thumbnail is harmless (plain card / no-op remove)', /if\(!grid\) return \{ remove\(\)\{\} \};/.test(tw) && /return \{ remove\(\)\{ try\{ c\.remove\(\); \}catch\{\} \} \};/.test(tw));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
