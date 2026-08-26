'use strict';
/*
 * test_chris_r5_ui_cards.js — contract pins for the three safe UI fixes from Chris round 5
 * (docs/CHRIS_FULL_APP_REVIEW_2026-08-25.md): Card 3 (first-batch expectation line), Card 5
 * ("Add 'Quotation'" pre-fills the name), Card 6 (practice-run readout doesn't leak to the next
 * sample). Source-regex pins (the project's existing style — cf. test_queue_badge_copy.js,
 * test_quiet_lane.js §B5), so a future reword can't silently un-fix them.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd src/windows/review/test_chris_r5_ui_cards.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const renderer = rd('src/windows/review/renderer.js');
const editor   = rd('src/windows/shared/doctype-editor.js');
const tut      = rd('src/windows/tutorial/renderer.js');

// ── Card 3 — first-batch cold-start expectation line ─────────────────────────────
console.log('Card 3 — first-batch expectation line');
{
  const s = renderer.indexOf('async function fileAllReady()');
  const e = renderer.indexOf("addEventListener('click', fileAllReady)");
  const body = s > -1 ? renderer.slice(s, e > -1 ? e : undefined) : '';
  check('one-shot flag: fileAllReady reads/writes fileall_coldstart_hint_seen',
        /getSetting\?\.\('fileall_coldstart_hint_seen'\)/.test(body)
        && /setSetting\?\.\('fileall_coldstart_hint_seen', '1'\)/.test(body));
  check('the line is gated on GENUINE cold-start holds (not missing-field / no-template)',
        /!s\.ready && !s\.needsTemplate/.test(body) && /Number\(s\.confirms \|\| 0\) < Number\(s\.needed \|\| 0\)/.test(body));
  check('the expectation copy is appended (never replaces the filing summary)',
        /appendTeachMessage\('New senders need a few confirms before they file themselves/.test(body));
}

// ── Card 5 — "Add 'Quotation'" pre-fills the name ────────────────────────────────
console.log("Card 5 — Add '<type>' pre-fills the name");
check('the create editor seeds its name from opts.initialName (create mode only)',
      /let name = \(mode === 'create' && opts\.initialName\) \? String\(opts\.initialName\) : '';/.test(editor));
check('openNewTypeModal accepts + forwards the initial name to DocTypeEditor.create',
      /function openNewTypeModal\(_onCreated, _initialName\)/.test(renderer)
      && /initialName: _initialName \|\| '',/.test(renderer));
check('_addDetectedType passes the detected name into the fallback builder',
      /openNewTypeModal\(afterAdd, detName\)/.test(renderer));

// ── Card 6 — practice run: readout does not leak to the next sample ──────────────
console.log('Card 6 — practice-run stale readout cleared on advance');
check('hideToast clears text + the pending timer (not just the .on class)',
      /function hideToast\(\) \{\s*clearTimeout\(toastT\); toastEl\.textContent = ''; toastEl\.classList\.remove\('on'\);/.test(tut));
{
  const s = tut.indexOf('async function confirm()');
  const e = tut.indexOf('function renderDone()');
  const body = s > -1 ? tut.slice(s, e > -1 ? e : undefined) : '';
  check('confirm() drops the readout before the file-copy await (card 6)',
        /hideToast\(\);\s*\/\/ card 6[\s\S]{0,140}?primary\.disabled = true;/.test(body));
}
check('renderReview clears the previous sample toast via hideToast (text + timer, not just class)',
      /hideToast\(\);\n  const hasLow/.test(tut));

console.log(fails ? `\n${fails} FAILED` : '\nAll Chris R5 UI-card pins passed');
process.exit(fails ? 1 : 0);
