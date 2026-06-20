#!/usr/bin/env node
'use strict';

/**
 * src/modules/filing/test_path_hardening.js
 * -----------------------------------------
 * F-08 + F-06 regression:
 *   F-08 — sanitiseFolderName must never yield a dot-only/escaping path segment,
 *          so a company value of ".." cannot file a document outside the output root.
 *   F-06 — _isOpenablePath must reject UNC paths, executable/script extensions, and
 *          paths that are neither under an app-managed root nor recorded for a document.
 *
 * Pure-function tests (no Electron app, no real DB needed).
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/filing/test_path_hardening.js
 */

const path = require('path');
const { sanitiseFolderName } = require('./handler');
const { _isOpenablePath } = require('../processing/handler');

function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); return cond; }

let fail = 0;

// ── F-08: sanitiseFolderName ─────────────────────────────────────────────────
fail += !check('".." -> neutral folder',  sanitiseFolderName('..')  === 'Unknown Company');
fail += !check('"." -> neutral folder',   sanitiseFolderName('.')   === 'Unknown Company');
fail += !check('"..." -> neutral folder', sanitiseFolderName('...') === 'Unknown Company');
fail += !check('empty -> neutral folder', sanitiseFolderName('')    === 'Unknown Company');
fail += !check('leading dot stripped (".NET Ltd" -> "NET Ltd")', sanitiseFolderName('.NET Ltd') === 'NET Ltd');
fail += !check('normal company preserved', sanitiseFolderName('Acme Supplies Ltd') === 'Acme Supplies Ltd');

const root = path.resolve('/out/root');
for (const bad of ['..', '.', '...', '..\\..\\x', './../x']) {
  const seg = sanitiseFolderName(bad);
  const joined = path.resolve(path.join(root, seg, '2025', 'May'));
  fail += !check(`join(sanitise("${bad}")) stays under root`, joined === root || joined.startsWith(root + path.sep));
}

// ── F-06: _isOpenablePath ────────────────────────────────────────────────────
const stubDb = (rows) => ({ prepare: () => ({ all: () => rows, get: () => undefined }) });
const emptyDb = stubDb([]);

fail += !check('UNC (\\\\host) rejected',        _isOpenablePath(emptyDb, '\\\\evil\\share\\a.pdf') === false);
fail += !check('UNC (//host) rejected',          _isOpenablePath(emptyDb, '//evil/share/a.pdf') === false);
fail += !check('.exe rejected',                  _isOpenablePath(emptyDb, 'C:\\Windows\\System32\\calc.exe') === false);
fail += !check('.ps1 rejected',                  _isOpenablePath(emptyDb, 'C:\\tmp\\run.ps1') === false);
fail += !check('.txt (non-document) rejected',   _isOpenablePath(emptyDb, 'C:\\tmp\\note.txt') === false);
fail += !check('non-recorded .pdf rejected',     _isOpenablePath(emptyDb, 'C:\\random\\a.pdf') === false);

const recorded = path.resolve('/docs/inv.pdf');
const recDb = stubDb([{ working_path: null, stored_path: recorded, folder_path: null, original_filename: 'inv.pdf' }]);
fail += !check('recorded document .pdf allowed', _isOpenablePath(recDb, recorded) === true);
fail += !check('recorded path but .exe still rejected',
  _isOpenablePath(stubDb([{ stored_path: path.resolve('/docs/x.exe') }]), path.resolve('/docs/x.exe')) === false);

console.log(fail ? `\n${fail} check(s) FAILED — path hardening regressed.` : '\nAll path-hardening checks passed.');
process.exit(fail ? 1 : 0);
