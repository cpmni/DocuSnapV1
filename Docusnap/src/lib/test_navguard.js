#!/usr/bin/env node
'use strict';
// Hermetic tests for lib/navGuard (audit M4). Proves the allow/deny decision that must
// permit the Help window's inter-page navigation while denying everything else.
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/lib/test_navguard.js
const path = require('path');
const { pathToFileURL } = require('url');
const { isInAppWindow } = require('./navGuard');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) { pass++; } else { fail++; console.error('  FAIL: ' + label); } };

// Simulate main.js's derived root: <dir>/windows/ (dev or packaged, both from __dirname).
const appRoot = path.join(__dirname, '..', 'windows');           // src/windows
const root = (appRoot + path.sep).toLowerCase();

const helpUrl   = pathToFileURL(path.join(appRoot, 'help', 'review.html')).href;
const teachUrl  = pathToFileURL(path.join(appRoot, 'teach', 'index.html')).href;
const outsideUrl = pathToFileURL(path.join(__dirname, '..', '..', 'invoice.html')).href;   // outside windows/
const userProfileDrop = pathToFileURL(path.join(require('os').homedir(), 'invoice.html')).href;

check('ALLOW: Help window inter-page link (windows/help/review.html)', isInAppWindow(helpUrl, root) === true);
check('ALLOW: another app window (windows/teach/index.html)', isInAppWindow(teachUrl, root) === true);
check('ALLOW: a %20-encoded path under windows/ decodes + allows',
  isInAppWindow(pathToFileURL(path.join(appRoot, 'help', 'a b.html')).href, root) === true);
check('DENY: a file outside windows/ (dropped invoice.html one level up)', isInAppWindow(outsideUrl, root) === false);
check('DENY: a file in the user profile (the drop-navigation attack)', isInAppWindow(userProfileDrop, root) === false);
check('DENY: an https URL', isInAppWindow('https://evil.example/x', root) === false);
check('DENY: a data: URL', isInAppWindow('data:text/html,<script>alert(1)</script>', root) === false);
check('DENY: a file:// URL to windows-sibling prefix (no false startsWith on windows-x)',
  isInAppWindow(pathToFileURL(path.join(appRoot + '-evil', 'x.html')).href, root) === false);
check('DENY: garbage / unparseable input', isInAppWindow('not a url', root) === false && isInAppWindow(null, root) === false);
check('DENY: empty root never matches (guard-disabled safety)', isInAppWindow(helpUrl, '') === false);

console.log(`\nnavGuard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
