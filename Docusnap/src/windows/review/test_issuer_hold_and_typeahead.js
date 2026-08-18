'use strict';
/*
 * test_issuer_hold_and_typeahead.js — PINs for the two owner-found blockers of 2026-08-18.
 *
 * BUG 1 — THE DEAD-END HOLD. reviewService refuses a near-match issuer with
 * fail('ISSUER_NEAR_MATCH', msg, { nearMatch: {existing, distance, …} }), and the Review renderer
 * needs that payload to draw the inline note carrying the ONLY two ways past the hold
 * ("Use <known>" / "Keep <typed>"). The confirm-review IPC hand-back whitelisted `code`,
 * `confirmedBy` and `prefixOutlier` — and DROPPED `nearMatch`. So showIssuerNearMatchHold got
 * undefined, fell back to a toast that printed its own placeholder ("a company you already use")
 * as if it were the company, and offered no buttons: a CORRECT document could not be filed at all.
 *
 * BUG 2 — THE TYPE-AHEAD ATE KEYSTROKES. Free-text fields (the Document Issuer among them) attach
 * a native <datalist>. It was re-attached on EVERY input event, so the operator typed with a
 * native popup open competing for the keyboard, and closeSuggest() called input.blur() on the
 * field being typed into — characters landing in the blur→refocus gap were lost while Backspace
 * (no replacement path) worked. Symptom: "caret is there, I can delete but not type."
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/windows/review/test_issuer_hold_and_typeahead.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const rend = fs.readFileSync(path.join(REPO, 'src', 'windows', 'review', 'renderer.js'), 'utf8');
const ipc  = fs.readFileSync(path.join(REPO, 'src', 'modules', 'review', 'handler.js'), 'utf8');
const svc  = fs.readFileSync(path.join(REPO, 'src', 'services', 'reviewService.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('1. the near-match payload survives the IPC hand-back (the dead-end fix)');
check('the service still SENDS nearMatch with the refusal',
      /fail\('ISSUER_NEAR_MATCH',[\s\S]{0,220}\{ nearMatch: \{ existing: nm\.existing/.test(svc));
check('the IPC hand-back FORWARDS it (was dropped by the whitelist)',
      /r\.code === 'ISSUER_NEAR_MATCH' \? \{ nearMatch: r\.nearMatch \}/.test(ipc));
check('the other refusal payloads still ride (no collateral)',
      /prefixOutlier: \{ field: r\.field/.test(ipc) && /r\.confirmedBy \? \{ confirmedBy: r\.confirmedBy \}/.test(ipc));
check('the renderer still routes ISSUER_NEAR_MATCH into the inline hold, not a bare toast',
      (rend.match(/r\.code === 'ISSUER_NEAR_MATCH'\ \) \{ showIssuerNearMatchHold|code === 'ISSUER_NEAR_MATCH'/g) || []).length >= 2);
check('the inline hold offers BOTH escapes (adopt the known name / keep what was typed)',
      /inm-use-btn">Use "\$\{known\}"/.test(rend) && /inm-keep-btn">Keep "\$\{escHtml\(cur\)\}"/.test(rend));
check('the fallback toast never prints its placeholder as a company name, and says what to DO',
      /nm && nm\.existing[\s\S]{0,200}open the Document Issuer field and correct it/.test(rend)
      && !/\$\{nm\?\.existing \|\| 'a company you already use'\}/.test(rend));

console.log('2. the type-ahead never fights the keyboard (the vanished-characters fix)');
check('the list is armed on an IDLE DEBOUNCE, not on every keystroke',
      /const armList = \(\) => \{[\s\S]{0,320}setTimeout\(\(\) => \{[\s\S]{0,260}setAttribute\('list', dlId\)/.test(rend)
      && !/input\.value\.trim\(\)\.length >= 3\) \{ ensureLoaded\(\); input\.setAttribute\('list', dlId\); \}/.test(rend));
check('a printable keydown DETACHES the popup before the character lands',
      /e\.key\.length === 1 && !e\.ctrlKey && !e\.metaKey && !e\.altKey\) detachList\(\)/.test(rend));
check('closeSuggest blurs ONLY while the field still holds focus (never a blind mid-typing blur)',
      /const wasFocused = document\.activeElement === input;[\s\S]{0,120}if \(!wasFocused\) return;[\s\S]{0,60}input\.blur\(\)/.test(rend));
check('the pick paths still work (arrow-nav keeps the popup, Enter/mouse-pick closes it)',
      /lastArrowAt = Date\.now\(\); return;/.test(rend)
      && /e\.key === 'Enter' && input\.hasAttribute\('list'\)\) \{ setTimeout\(closeSuggest, 0\)/.test(rend)
      && /inputType === 'insertReplacementText'/.test(rend));
check('a pending arm is cancelled on blur (no popup opening behind a departed operator)',
      /addEventListener\('blur', \(\) => \{\s*\n\s*if \(suggestTimer\)/.test(rend));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
