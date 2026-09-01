#!/usr/bin/env node
'use strict';
/**
 * src/test_security_audit_20260901.js
 * -----------------------------------
 * Source-contract pins for the three SAFE fixes built during the 2026-09-01 pre-release security audit
 * (docs/SECURITY_REVIEW_2026-09-01.md). These are wiring in main-process files that cannot be require()d
 * under a test (they pull the live Electron app), so — like test_focus_repair.js / test_navguard.js — the
 * load-bearing lines are asserted against the source, plus a hermetic unit for the client nav classifier.
 *
 *   gary R3   — toggling the in-Review trace console OFF clears its cropped-image slices (src/main.js).
 *   eric C-4  — the client TLS self-signed escape hatch is IGNORED in a packaged build (client/main.js).
 *   eric C-3  — the client has an app-level navigation lockdown mirroring the core (client/main.js).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/test_security_audit_20260901.js
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (label, cond) => { pass++; if (!cond) { fail++; pass--; console.error('  FAIL: ' + label); } else console.log('  ok   ' + label); };

const mainSrc   = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'client', 'main.js'), 'utf8');

// ── gary R3 — trace-console OFF clears the slices ──────────────────────────────
console.log('R3 — review-trace-set(false) clears the dev slices:');
{
  // Isolate the review-trace-set handler body and prove the OFF branch calls clearDevSlices().
  const i = mainSrc.indexOf("ipcMain.handle('review-trace-set'");
  ok('the review-trace-set handler exists', i >= 0);
  const body = mainSrc.slice(i, i + 1200);
  ok('the OFF path clears reviewTraceActive AND calls clearDevSlices()',
     /ctx\.reviewTraceActive = false;[\s\S]{0,700}clearDevSlices\(\);[\s\S]{0,40}return true;/.test(body));
  ok('clearDevSlices is defined (unlinks every file under the dev slice dir)',
     /const clearDevSlices = \(\) => \{[\s\S]{0,200}readdirSync\(devSliceDir\)[\s\S]{0,120}unlinkSync/.test(mainSrc));
}

// ── eric C-4 — client self-signed hatch ignored when packaged ──────────────────
console.log('C-4 — client ALLOW_SELF_SIGNED gated on !app.isPackaged:');
{
  ok('ALLOW_SELF_SIGNED requires !app.isPackaged (a packaged build never disables CA verification)',
     /const ALLOW_SELF_SIGNED = !app\.isPackaged && process\.env\.SCANFINDER_CLIENT_ALLOW_SELF_SIGNED === '1';/.test(clientSrc));
  // Guard against a regression to the un-gated form.
  ok('the un-gated form (env alone) is gone',
     !/const ALLOW_SELF_SIGNED = process\.env\.SCANFINDER_CLIENT_ALLOW_SELF_SIGNED === '1';/.test(clientSrc));
}

// ── eric C-3 — client navigation lockdown ──────────────────────────────────────
console.log('C-3 — client app-level navigation lockdown:');
{
  ok('registers app.on(web-contents-created)', /app\.on\('web-contents-created'/.test(clientSrc));
  ok('denies every new window (routes http\(s\) to the OS browser, action deny)',
     /setWindowOpenHandler\(\(\{ url \}\) => \{[\s\S]{0,220}shell\.openExternal[\s\S]{0,120}return \{ action: 'deny' \}/.test(clientSrc));
  ok('blocks off-tree will-navigate', /will-navigate',\s*\(e, url\) => \{ if \(!_isClientInApp\(url\)\) e\.preventDefault\(\); \}/.test(clientSrc));
  ok('blocks off-tree will-redirect', /will-redirect',\s*\(e, url\) => \{ if \(!_isClientInApp\(url\)\) e\.preventDefault\(\); \}/.test(clientSrc));
  ok('refuses <webview>', /will-attach-webview',\s*\(e\) => e\.preventDefault\(\)/.test(clientSrc));
  ok('_isClientInApp is file:// scheme-only (http\(s\)/data never in-app)',
     /if \(u\.protocol !== 'file:'\) return false;/.test(clientSrc));
}

// ── hermetic unit: the client nav classifier's allow/deny intent ───────────────
// A copy of the shipped predicate (the shipped one can't be imported from client/main.js — it is not
// exported). Documents the ALLOW/DENY decision; the core twin is proven in src/lib/test_navguard.js.
console.log('C-3 — nav classifier allow/deny (intent):');
{
  const { pathToFileURL, fileURLToPath } = require('url');
  const root = path.normalize(path.join('C:', 'app', 'client', 'renderer')).toLowerCase();
  const isInApp = (targetUrl) => {
    try {
      const u = new URL(targetUrl);
      if (u.protocol !== 'file:') return false;
      const fsPath = fileURLToPath(u);
      return path.normalize(fsPath).toLowerCase().startsWith(root);
    } catch { return false; }
  };
  ok('an in-tree renderer page is allowed',
     isInApp(pathToFileURL(path.join('C:', 'app', 'client', 'renderer', 'index.html')).href));
  ok('an in-tree sub-asset is allowed',
     isInApp(pathToFileURL(path.join('C:', 'app', 'client', 'renderer', 'search-results.js')).href));
  ok('a dropped file outside the tree is DENIED',
     !isInApp(pathToFileURL(path.join('C:', 'Users', 'x', 'invoice.html')).href));
  ok('an http(s) URL is DENIED', !isInApp('https://evil.example/x'));
  ok('a data: URL is DENIED', !isInApp('data:text/html,<script>alert(1)</script>'));
  ok('an unparseable target is DENIED', !isInApp('::::not a url'));
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
