'use strict';
/**
 * test_memory_inventory.js
 * Source-level regression pin for the click-to-browse "Learned memory inventory"
 * (Settings → Learning) and its Oracle conditions (2026-08-27 night):
 *   F2-C1  learning-scopes stays a PRESERVING refactor — the argless Repair-console
 *          call runs the suspect detectors unchanged; only an explicit
 *          { suspects:false } skips the per-type phash cost.
 *   F2-C2  the "Open in Learning Repair" deep-link calls rpOpenScope (not a bare
 *          tab switch — that would land on the empty typed box).
 *   F2-C3  the browse uses event DELEGATION + a wire-once guard (the tab lazy-init
 *          re-runs on every show, so per-row/re-show wiring would stack handlers).
 * A behavioural IPC test would need an auth-session + ipcMain harness; this pins
 * the exact shapes a future edit could regress.
 *
 * Run: node src/modules/settings/test_memory_inventory.js   (pure fs.)
 */
const fs = require('fs');
const path = require('path');
const R = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const Rroot = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

let FAILS = 0;
const check = (label, cond) => { if (!cond) FAILS++; console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); };

const handler = R('handler.js');
check('learning-scopes handler takes (_e, opts)', /ipcMain\.handle\('learning-scopes',\s*\(_e,\s*opts\)\s*=>/.test(handler));
check('suspects block is guarded by opts.suspects !== false', /if\s*\(!opts\s*\|\|\s*opts\.suspects\s*!==\s*false\)\s*try\s*{/.test(handler));
check('argless call still computes suspects (computeSuspects present)', /repairSuspects\.computeSuspects/.test(handler));

const preload = Rroot('preload.js');
check('preload learningScopes forwards opts', /learningScopes:\s*\(opts\)\s*=>\s*ipcRenderer\.invoke\('learning-scopes',\s*opts\)/.test(preload));

const renderer = Rroot('windows/settings/renderer.js');
check('loadScopeBrowse exists', /async function loadScopeBrowse\(\)/.test(renderer));
check('browse calls learning-scopes with { suspects:false }', /api\.learningScopes\(\{\s*suspects:\s*false\s*\}\)/.test(renderer));
check('wire-once guard (_lrBrowseWired)', /_lrBrowseWired/.test(renderer) && /if\s*\(!_lrBrowseWired\)/.test(renderer));
check('event delegation on the scope list container', /list\.addEventListener\('click'[\s\S]{0,120}closest\('\.lr-scope-row'\)/.test(renderer));
check('deep-link calls rpOpenScope (not a bare tab switch)', /async function lrOpenInRepair[\s\S]{0,900}rpOpenScope\(sup,\s*slug\)/.test(renderer));
check('lazy-init calls loadScopeBrowse on the learning tab', /dataset\.tab === 'learning'\)\s*{\s*loadScopeBrowse\(\)/.test(renderer));
check('detail is read from get-learning-recovery (read-only)', /getLearningRecovery\(\{\s*supplier_name:\s*sup/.test(renderer));

const html = Rroot('windows/settings/index.html');
check('browse section present (#lr-scope-list)', /id="lr-scope-list"/.test(html));
check('read-only detail pane present (#lr-browse-detail)', /id="lr-browse-detail"/.test(html));
check('typed tools preserved under an Advanced details', /<details[^>]*id="lr-advanced-tools"/.test(html));
check('the cleanup tools still exist inside (rename/clear)', /id="lr-btn-rename-supplier"/.test(html) && /id="lr-btn-clear-anchors"/.test(html));

console.log(FAILS ? `\n${FAILS} FAILED` : '\nALL PASS');
process.exit(FAILS ? 1 : 0);
