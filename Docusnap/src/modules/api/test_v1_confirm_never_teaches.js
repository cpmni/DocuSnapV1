#!/usr/bin/env node
'use strict';
/**
 * test_v1_confirm_never_teaches.js — the teach-over-client S3 safety pin (2026-09-14).
 *
 * Teaching over /v1 opened the app's highest-value learning/schema WRITE surface (POST /v1/teach/commit).
 * This pin fences that power OFF from every OTHER /v1 route, so a future edit can't silently let a plain
 * confirm (or any other route) draw template mappings / fixed values / hidden fields:
 *   1. the plain /v1/confirm route passes taught_fields: [] LITERALLY and never reads body.taught_fields
 *      (a confirm files a document — it never teaches);
 *   2. NO direct learning/template WRITE (templates.saveMapping / setFieldFixedValue / setHiddenField /
 *      labelOverrides.addLabelOverride / _upsertTemplate) appears anywhere in the /v1 handler — the ONE teach
 *      write is encapsulated in reviewHandler.teachCommit, called only from the admin+switch-gated /teach/commit
 *      route;
 *   3. that route is gated (admin role + teach_over_client_enabled + license) and delegates to teachCommit.
 *
 * A pure source-contract pin (no DB/network) — deterministic and fast.  node src/modules/api/test_v1_confirm_never_teaches.js
 */
const fs = require('fs');
const path = require('path');
let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

const src = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8');

// 1. The /v1 confirm route hardcodes taught_fields: [] and never reads it from the body.
const confirmIdx = src.indexOf('confirmMatch');
const confirmRoute = src.slice(src.indexOf('if (req.method === \'POST\' && confirmMatch)', confirmIdx),
                               src.indexOf('if (req.method === \'POST\' && confirmMatch)', confirmIdx) + 2500);
check('the /v1 confirm route passes taught_fields: [] (a literal empty list)', /taught_fields:\s*\[\s*\]/.test(confirmRoute));
check('the /v1 confirm route NEVER reads body.taught_fields', !/body\.taught_fields/.test(confirmRoute) && !/\.taught_fields\b/.test(confirmRoute.replace(/taught_fields:\s*\[\s*\]/g, '')));

// 2. No STRAY learning/template write in the /v1 handler — the only teach write is inside reviewHandler.teachCommit.
for (const bad of ['templates.saveMapping', 'templates.setFieldFixedValue', 'templates.setHiddenField', 'labelOverrides.addLabelOverride', '_upsertTemplate']) {
  check(`the /v1 handler contains NO direct ${bad} (learning writes live only in reviewHandler.teachCommit)`, !src.includes(bad));
}

// 3. The teach-commit route delegates to reviewHandler.teachCommit and is admin + switch + license gated.
const tcIdx = src.indexOf('/teach/commit`');
const tcRoute = src.slice(src.lastIndexOf('if (req.method === \'POST\'', tcIdx), src.indexOf('finally { _teachCommitInFlight--; }') + 40);
check('the teach-commit route delegates to require(\'../review/handler\').teachCommit', /require\('\.\.\/review\/handler'\)\.teachCommit/.test(tcRoute));
check('the teach-commit route is ADMIN-only', /session\.role !== 'admin'/.test(tcRoute));
check('the teach-commit route gates on the teach_over_client_enabled switch', /teach_over_client_enabled/.test(tcRoute) && /FEATURE_DISABLED/.test(tcRoute));
check('the teach-commit route re-checks the license', /licenseDenied/.test(tcRoute) && /LICENSE/.test(tcRoute));
check('the teach-commit route resolves the path server-side (it passes only the parsed body, not client paths)', !/folder_path:\s*body/.test(tcRoute));

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
process.exit(fail ? 1 : 0);
