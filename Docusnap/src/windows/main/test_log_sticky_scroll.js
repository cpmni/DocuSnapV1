#!/usr/bin/env node
'use strict';
/*
 * src/windows/main/test_log_sticky_scroll.js — owner 2026-09-07: the import log "jumps to the bottom every time it
 * updates; stop jumping if a user scrolls up, resume when they scroll to the bottom". Source pin: every append
 * goes through _logFollow(), which scrolls only while _logStick is set; the scroll listener re-derives the flag
 * from the reader's position; opening the log re-arms it.
 *
 *   node src/windows/main/test_log_sticky_scroll.js
 */
const fs = require('fs');
const path = require('path');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const src = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8').replace(/\r\n/g, '\n');
const code = src.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

check('appendLog follows via _logFollow(), never a bare scroll-to-bottom', /logOutput\.appendChild\(div\);\s*_logFollow\(\);/.test(code));
check('the only bare scroll-to-bottom left is the View-log open (which re-arms)', (code.match(/logOutput\.scrollTop = logOutput\.scrollHeight/g) || []).length === 2 && /_logStick = true; logOutput\.scrollTop = logOutput\.scrollHeight;/.test(code));
check('_logFollow scrolls only while stuck to the bottom', /function _logFollow\(\) \{ if \(_logStick\) logOutput\.scrollTop = logOutput\.scrollHeight; \}/.test(code));
check('the scroll listener re-derives the flag from the reader position (up = parked, bottom = armed)', /addEventListener\('scroll', \(\) => \{ _logStick = _logAtBottom\(logOutput\); \}\)/.test(code) && /scrollHeight - el\.scrollTop - el\.clientHeight\) <= _LOG_STICK_PX/.test(code));
check('a small tolerance, not exact equality (sub-pixel scroll positions)', /_LOG_STICK_PX = 8/.test(code));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
