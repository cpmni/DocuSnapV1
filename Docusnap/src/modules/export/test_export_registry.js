'use strict';
/**
 * test_export_registry.js
 * Source-level pin (Oracle F1-C3): the Export window must be registered as a
 * NON-MODAL child — a modal child makes the minimise-dock chip unclickable
 * (the failure the main.js:519 "no child is modal" invariant guards). Also pins
 * the admin gate + preload wiring so a future edit can't silently drop them.
 *
 * Run: node src/modules/export/test_export_registry.js   (pure fs, no Electron.)
 */
const fs = require('fs');
const path = require('path');
const R = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

let FAILS = 0;
const check = (label, cond) => { if (!cond) FAILS++; console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); };

const main = R('main.js');
check("CHILD_WINDOWS includes 'export'", /CHILD_WINDOWS\s*=\s*new Set\(\[[^\]]*'export'/.test(main));
check("NON_MODAL_CHILD includes 'export' (non-modal → dock chip works)", /NON_MODAL_CHILD\s*=\s*new Set\(\[[^\]]*'export'/.test(main));
check('CHILD_DOCK_TITLES has an export label', /'export':\s*'Export data'/.test(main));
check('open-export-window handler is admin-gated', /ipcMain\.on\('open-export-window'[\s\S]{0,140}hasRole\('admin'\)/.test(main));
check('exportModule required + registered', /exportModule\s*=\s*require\('\.\/modules\/export\/handler'\)/.test(main) && /exportModule\.register\(ctx\)/.test(main));

const preload = R('preload.js');
check('preload exposes openExportWindow', /openExportWindow:\s*\(\)\s*=>\s*ipcRenderer\.send\('open-export-window'\)/.test(preload));
check('preload exposes the export IPC bridges', /exportOptions:.*invoke\('export-options'/.test(preload) && /exportRun:.*invoke\('export-run'/.test(preload));

const handler = R('modules/export/handler.js');
check('every export IPC is admin-gated', (handler.match(/requireRole\('admin'\)/g) || []).length >= 3);
check('save-dialog path is written directly (no derived 2nd path)', /writeFileSync\(r\.filePath/.test(handler));

console.log(FAILS ? `\n${FAILS} FAILED` : '\nALL PASS');
process.exit(FAILS ? 1 : 0);
