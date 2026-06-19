#!/usr/bin/env node
'use strict';
/*
 * scripts/check-help-coverage.js
 * ------------------------------
 * Help-mode coverage guard. For every window that uses the shared "? help mode"
 * (src/windows/shared/helpmode.js), it asserts that every control marked with a
 * `data-help-key` in the window's HTML has a matching entry in that window's
 * HELP_TEXTS map (the object passed to initHelpMode in its renderer JS).
 *
 * Why: help text and markup drift apart silently — someone adds a control with a
 * data-help-key but forgets the text, so help mode shows the generic "No help for
 * this item yet" fallback. This catches that at dev/CI time instead of in front of
 * a user. (Recommended by the product review as the single most important
 * anti-drift guardrail for the help system.)
 *
 * It does NOT police which controls *should* have a key — that's a deliberate,
 * selective choice (only action/consequence controls, to avoid popup clutter).
 *
 * Usage:  node scripts/check-help-coverage.js
 * Exit 0 = every data-help-key resolves. Exit 1 = at least one key has no text.
 */

const fs = require('fs');
const path = require('path');

const WINDOWS_DIR = path.join(__dirname, '..', 'src', 'windows');

// Windows wired for help mode (load helpmode.js + define HELP_TEXTS). Onboarding
// is intentionally excluded — it's a one-time, self-explaining setup flow with no
// help affordance.
const WINDOWS = ['main', 'review', 'settings', 'search', 'teach'];

// data-help-key values present in a window's HTML.
function htmlKeys(html) {
  const keys = new Set();
  const re = /data-help-key\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) keys.add(m[1]);
  return keys;
}

// Keys DEFINED in the window's JS (any quoted object key followed by a colon).
// Over-collecting slightly is fine: the guard only needs to confirm each
// data-help-key has SOME text entry, and help maps are the only quoted-key
// objects of note in these renderers.
function jsKeys(js) {
  const keys = new Set();
  const re = /["']([\w-]+)["']\s*:/g;
  let m;
  while ((m = re.exec(js)) !== null) keys.add(m[1]);
  return keys;
}

function readWindowJs(dir) {
  // The renderer plus any sub-modules in the window dir.
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
}

let failures = 0;
for (const win of WINDOWS) {
  const dir  = path.join(WINDOWS_DIR, win);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const inHtml = htmlKeys(html);
  const inJs   = jsKeys(readWindowJs(dir));

  const missing = [...inHtml].filter(k => !inJs.has(k));
  if (missing.length) {
    failures += missing.length;
    console.log(`BAD  ${win}: ${missing.length} data-help-key without help text → ${missing.join(', ')}`);
  } else {
    console.log(`OK   ${win}: ${inHtml.size} keyed control(s) all have help text`);
  }
}

if (failures) {
  console.log(`\n${failures} help-coverage gap(s). Add the missing key(s) to the window's HELP_TEXTS map.`);
  process.exit(1);
}
console.log('\nAll help-mode keys resolve to help text.');
process.exit(0);
