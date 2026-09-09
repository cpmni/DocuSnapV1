'use strict';
/*
 * test_teach_import_overlap.js — pins the teach-wizard IMPORT OVERLAP (owner 2026-09-09): the ~30s OCR read
 * no longer BLOCKS Continue. The read is HELD as state.readPromise so the user can advance to type-select
 * while it runs; step 3 (startRegionStep) re-collects the wait before it needs state.doc; a failed read
 * routes to an honest prompt, never a stuck spinner. Source-scan pin (the window's convention, cf.
 * test_staged_thumbnail.js). Files on disk are CRLF — spans are [\s\S]-based.
 *
 *   node src/windows/teach/test_teach_import_overlap.js
 */
const fs = require('fs');
const path = require('path');
let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const r = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8').replace(/\r\n/g, '\n');
const h = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

// (1) the gate admits an in-flight read → Continue works while the read runs.
check('canAdvance case 1 admits an in-flight read (state.doc OR state.readPromise)',
      /case 1: return !!state\.doc \|\| !!state\.readPromise;/.test(r));

// (2) the import read is HELD, not awaited inline; token-guarded; Continue re-enabled at once.
{
  const s = r.indexOf("$('btn-import-teach')");
  const body = s > -1 ? r.slice(s, s + 3800) : '';
  check('the handler holds the read as state.readPromise (IIFE) with an ++importToken guard',
        /const token = \+\+state\.importToken;/.test(body) && /state\.readPromise = \(async \(\) => \{/.test(body));
  check('processFolder is awaited INSIDE the held promise (not at the click-handler top level)',
        /state\.readPromise = \(async \(\) => \{[\s\S]*?await D\.processFolder/.test(body)
        && !/^\s*await D\.processFolder/m.test(body.slice(0, body.indexOf('state.readPromise'))));
  check('a stale completion (token superseded) does not clobber a later pick',
        /if \(token !== state\.importToken\) return match;/.test(body));
  check('Continue is re-enabled immediately after launching the read (renderFooter after the IIFE)',
        /renderFooter\(\);\s*\/\/ re-enable Continue/.test(body));
  check('the read settles the gate + restores the button only on the current token (finally guard)',
        /finally \{[\s\S]*?if \(token === state\.importToken\)[\s\S]*?state\.readPromise = null;/.test(body)
        && /btn\.disabled = false; btn\.textContent = lbl;/.test(body));
}

// (3) step 3 re-collects the wait before it needs state.doc; honest failure, no stuck spinner.
{
  const s = r.indexOf('async function startRegionStep');
  const body = s > -1 ? r.slice(s, s + 1100) : '';
  check('startRegionStep awaits state.readPromise (guarded on !state.doc) before the page load',
        /if \(!state\.doc && state\.readPromise\)\s*\{[\s\S]*?await p;/.test(body));
  check("a null/failed read routes to the honest \"couldn't read\" prompt, not a stuck overlay",
        /Couldn't read that document/.test(body) && /_setPageLoading\(false\)/.test(body));
}

// (4) live read-progress: event text + an elapsed ticker, painted on step 1 AND the step-3 overlay span.
check('a read-progress ticker paints both the import status line and the #rg-loading overlay',
      /function _paintRead\(\)/.test(r) && /\$\('import-teach-status'\)/.test(r) && /\$\('rg-loading-msg'\)/.test(r));
check('the #rg-loading overlay carries a #rg-loading-msg span for the live message',
      /id="rg-loading-msg"/.test(h));

// (5) the picker must not auto-pick a queue doc over an import in flight.
check('renderDocPicker skips the default auto-select while an import is in flight',
      /if \(!state\.doc && shown\.length && !state\.readPromise\)\{/.test(r));

console.log(fails ? `\n${fails} FAILED` : '\nAll teach import-overlap pins passed');
process.exit(fails ? 1 : 0);
