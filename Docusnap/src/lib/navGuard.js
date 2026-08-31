'use strict';
/**
 * src/lib/navGuard.js — pure URL classifier for the M4 navigation guard (main.js).
 * Extracted so the load-bearing allow/deny decision is unit-testable in isolation.
 *
 * Returns true ONLY for a file:// URL whose resolved filesystem path sits under the app's
 * own windows/ directory (dev `…/src/windows/`, packaged `…/app.asar/src/windows/`, both
 * derived from main.js `__dirname`). The Help window's inter-page links resolve there →
 * allowed; a dropped `%USERPROFILE%\invoice.html`, any http(s)/data URL, or a
 * window.open('file://…') outside the tree → denied.
 */
const path = require('path');

function isInAppWindow(targetUrl, appWindowsRoot) {
  try {
    const u = new URL(targetUrl);
    if (u.protocol !== 'file:') return false;                 // http(s)/data/etc. never in-app
    const fsPath = require('url').fileURLToPath(u);           // decodes %20 etc.
    const root = String(appWindowsRoot || '').toLowerCase();
    return !!root && path.normalize(fsPath).toLowerCase().startsWith(root);
  } catch { return false; }                                    // unparseable → deny
}

module.exports = { isInAppWindow };
