'use strict';
/*
 * forbiddenArgv.js — command-line switches a PACKAGED Scan Finder refuses to start with.
 *
 * Anyone could start the shipped ScanFinder.exe with `--remote-debugging-port=9222` and attach a
 * full DevTools session to the running app: read every window's code, breakpoint the licence flow,
 * and call the privileged bridge functions from a console. That is not a privilege escalation —
 * every channel is re-authorised in MAIN against the signed-in session — but it hands an attacker
 * a ready-made reverse-engineering harness, and no customer has any use for it. The sanctioned
 * on-site diagnostic is the SFDEV trace console inside Review, which deliberately survives packaging.
 *
 * Its own module, not a closure inside main.js, so the predicate can be unit-tested without
 * starting Electron's app lifecycle (main.js touches `app` at require time). Same shape as
 * src/lib/protectedSettings.js.
 *
 * BOTH failure directions are real, and the second is the likelier mistake: too narrow and the
 * lockout is theatre; too wide and the app refuses to start for a legitimate reason — a document
 * path from "Open with", an installer switch, Chromium's logging flags — which is a support call
 * on day one. Pinned in src/test_forbidden_argv.js.
 */
const FORBIDDEN =
  /^--(remote-debugging-port|remote-debugging-pipe|inspect|inspect-brk|inspect-port|inspect-publish-uid)\b/i;

/** True when this argv asks for a debugging channel. argv[0] is the executable and is never judged. */
function isForbiddenArgv(argv) {
  return (argv || []).slice(1).some(a => FORBIDDEN.test(String(a)));
}

module.exports = { isForbiddenArgv, FORBIDDEN };
