#!/usr/bin/env node
'use strict';
/**
 * scripts/test_csp_directives.js — every renderer window's meta CSP must carry `base-uri 'none'`
 * and `form-action 'none'` (audit 2026-09-07 P1-6; plan docs/designs/AUDIT_FIX_PLAN_2026-09-08.md
 * slice 2.2). Neither directive inherits from default-src, so a window that forgets them is open
 * to a <base>/<form> injection even under `default-src 'none'`. Scans src/windows/** and
 * client/renderer/** (multi-line <meta> tags included — a line grep misses them).
 *
 *   node scripts/test_csp_directives.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIRS = [path.join(ROOT, 'src', 'windows'), path.join(ROOT, 'client', 'renderer')];
const META = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gs;
const REQUIRED = ["base-uri 'none'", "form-action 'none'"];

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && e.name.endsWith('.html')) yield p;
  }
}

let files = 0, metas = 0;
const bad = [];
for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of walk(dir)) {
    files++;
    const src = fs.readFileSync(f, 'utf8');
    const found = [...src.matchAll(META)];
    if (found.length === 0) { bad.push(`${path.relative(ROOT, f)}: no meta CSP`); continue; }
    for (const m of found) {
      metas++;
      const csp = m[1].replace(/\s+/g, ' ');
      const missing = REQUIRED.filter(d => !csp.includes(d));
      if (missing.length) bad.push(`${path.relative(ROOT, f)}: missing ${missing.join(', ')}`);
    }
  }
}

if (bad.length) {
  console.error(`[test_csp_directives] FAIL — ${bad.length} window(s) lack a required CSP directive:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log(`[test_csp_directives] OK — ${metas} meta CSP(s) across ${files} window file(s) carry base-uri + form-action 'none'.`);
