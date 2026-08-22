#!/usr/bin/env node
'use strict';
// `npm start` launcher (dev only — packaged builds never run this file).
// Turns DIAGNOSTIC LOGGING on for every dev session (owner request 2026-08-22) unless the caller has
// already set DOCUSNAP_DIAGNOSTIC_LOG explicitly. The log lands in <repo>\Debug\diagnostic_<stamp>.jsonl
// (src/modules/diaglog.js). A packaged ScanFinder.exe reads only the `diagnostic_logging` SETTING, so
// customers keep the default OFF. Any extra args (e.g. --remote-debugging-port=9223) pass through.
const { spawn } = require('child_process');
const path = require('path');
const env = { ...process.env };
if (!env.DOCUSNAP_DIAGNOSTIC_LOG) env.DOCUSNAP_DIAGNOSTIC_LOG = 'on';
const electron = require('electron');   // the binary path (electron's main export when required from node)
const child = spawn(electron, ['.', ...process.argv.slice(2)], { cwd: path.join(__dirname, '..'), stdio: 'inherit', env, windowsHide: false });
child.on('exit', (code) => process.exit(code == null ? 0 : code));
