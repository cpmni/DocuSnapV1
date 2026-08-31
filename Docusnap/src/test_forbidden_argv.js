'use strict';
/*
 * test_forbidden_argv.js — a packaged Scan Finder must refuse to start with a debugging port open.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/test_forbidden_argv.js
 *
 * WHY. Anyone could start the shipped ScanFinder.exe with `--remote-debugging-port=9222` and attach
 * DevTools to the running app: read every window's code, breakpoint the licence flow, and call the
 * privileged bridge functions from a console. It is not a privilege escalation — every channel is
 * re-authorised in MAIN against the signed-in session — but it hands an attacker a ready-made
 * reverse-engineering harness, and no customer has a use for it.
 *
 * THE TWO FAILURE DIRECTIONS ARE BOTH REAL, which is why this file tests both:
 *   * too NARROW and the lockout is theatre (a spelling slips through);
 *   * too WIDE and the app refuses to start for a legitimate reason — a document path passed by
 *     "Open with", the installer's own switches, Chromium's logging flags. That is a support call
 *     on day one, and it is the more likely mistake.
 *
 * The predicate lives in its own module precisely so it can be tested without launching
 * Electron's app lifecycle - main.js touches `app` at require time.
 */
const path = require('path');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const { isForbiddenArgv } = require(path.join(__dirname, 'lib', 'forbiddenArgv.js'));

console.log('1. REFUSED — every spelling of a debugging switch');
for (const a of ['--remote-debugging-port=9222', '--remote-debugging-port', '--remote-debugging-pipe',
                 '--inspect', '--inspect=0.0.0.0:9229', '--inspect-brk', '--inspect-brk=9229',
                 '--inspect-port=9229', '--inspect-publish-uid=stderr',
                 '--REMOTE-DEBUGGING-PORT=9222']) {
  check(`refused: ${a}`, isForbiddenArgv(['ScanFinder.exe', a]) === true);
}
check('refused when buried among other arguments',
      isForbiddenArgv(['ScanFinder.exe', 'C:\\docs\\a.pdf', '--enable-logging', '--inspect=1234']) === true);

console.log('\n2. ALLOWED — everything a real launch actually passes');
for (const argv of [
  ['ScanFinder.exe'],
  ['ScanFinder.exe', 'C:\\Users\\jane\\Documents\\invoice.pdf'],
  ['ScanFinder.exe', '--enable-logging'],
  ['ScanFinder.exe', '--disable-gpu'],
  ['ScanFinder.exe', '--allow-file-access-from-files'],
  ['ScanFinder.exe', '--updated'],
  ['ScanFinder.exe', 'C:\\path with spaces\\remote-debugging-port.pdf'],   // a FILE, not a switch
  ['ScanFinder.exe', '--squirrel-firstrun'],
]) {
  check(`allowed: ${argv.slice(1).join(' ') || '(no arguments)'}`, isForbiddenArgv(argv) === false);
}

console.log('\n3. TOTAL — argv[0] is the executable and is never judged');
check('an executable path containing "inspect" does not block startup',
      isForbiddenArgv(['C:\\Program Files\\inspector\\ScanFinder.exe']) === false);
check('empty / missing argv is safe', isForbiddenArgv([]) === false && isForbiddenArgv(null) === false);

console.log(fails ? `\n${fails} FAILED` : '\nAll argv-lockout pins passed');
process.exit(fails ? 1 : 0);
