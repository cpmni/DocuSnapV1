'use strict';
/*
 * test_issuer_teach_decision_contract.js — the Review renderer + the review IPC handler must CONSULT
 * issuerTeachDecision.js / the plausibility predicate at every door (Chris round 2026-09-01 cards 1+2;
 * eric → Oracle SIGN-OFF-W/COND C1-C8). A pure module that nothing calls is a dead guard whose unit
 * test greens forever (the repo's "dead guard greens every test" trap) — this pins the call sites by
 * parsing, per repo convention (test_issuer_ripple_contract.js).
 *
 * Card 1 (stale ripple after a branding garble): a retype of the issuer must TEAR DOWN the sibling
 *   ripple bar + its offered-name memo + the "Change what's read from X" heading, unconditionally
 *   (C8 — not behind the kill switch); the teardown runs from the input handler AND _applyTeachValue
 *   (C3); offerIssuerRipple refuses an implausible read at its head; apply-issuer-ripple refuses an
 *   implausible value itself, READING teach_issuer_plausibility_warn ITSELF (C1), and returns a
 *   `reason` the bar surfaces (C6 — never mute).
 * Card 2 (clipped draw overwrote a correct issuer): the ⊕/drawn write for supplier_name ONLY (C2)
 *   consults shouldDrawnReadReplaceField with the ONE check-issuer-read result (C5); the decline is
 *   ATOMIC (C7 — no corrections write / .corrected / dismissServerNote / focus repair inside the
 *   guarded block); the declined read is offered as a "Use “X”" action wired to _applyTeachValue.
 *
 * Run: node src/windows/review/test_issuer_teach_decision_contract.js
 */
const fs = require('fs');
const path = require('path');
const R = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8').replace(/\r\n/g, '\n');
const H = fs.readFileSync(path.join(__dirname, '..', '..', 'modules', 'review', 'handler.js'), 'utf8').replace(/\r\n/g, '\n');
const IDX = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const L = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'database', 'modules', 'learning.js'), 'utf8').replace(/\r\n/g, '\n');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };
const at = (needle, from = 0) => R.indexOf(needle, from);
const fnBody = (src, head, endNeedle) => {
  const s = src.indexOf(head); if (s < 0) return '';
  const e = endNeedle ? src.indexOf(endNeedle, s) : -1;
  return src.slice(s, e > 0 ? e : s + 6000);
};

// ── the module is loaded by the Review window BEFORE renderer.js ─────────────────────────────
check('module file exists', fs.existsSync(path.join(__dirname, 'issuerTeachDecision.js')));
const tagMod = IDX.indexOf('<script src="issuerTeachDecision.js"></script>');
const tagRend = IDX.indexOf('<script src="renderer.js"></script>');
check('index.html loads issuerTeachDecision.js before renderer.js', tagMod > 0 && tagRend > tagMod);

// ── F1: the named teardown ───────────────────────────────────────────────────────────────────
const td = fnBody(R, 'function _teardownIssuerRipple(row)', '\n}\n');
check('_teardownIssuerRipple(row) exists', td.length > 0);
check('teardown removes the ripple bar (row-scoped)', /\.ripple-bar/.test(td) && /remove\(\)/.test(td));
check('teardown clears row.dataset.rippleOffered', /delete row\.dataset\.rippleOffered|row\.dataset\.rippleOffered\s*=\s*''/.test(td));
check('teardown refreshes the "Change what\'s read from X" heading', /_updateSenderFieldsBtn\(\)/.test(td));
check('teardown is NOT behind the kill switch (C8)', !/teach_issuer_plausibility_warn|checkIssuerRead/.test(td));

// the input handler: every keystroke on supplier_name tears down THEN schedules the taught refresh
check('the supplier_name input handler tears down the ripple then schedules the taught refresh',
      /if \(key === 'supplier_name'\) \{ _teardownIssuerRipple\(row\); _scheduleTaughtRefreshForIssuer\(\); \}/.test(R));

// _applyTeachValue (the "Use X" road) tears down too (C3)
const atv = fnBody(R, 'function _applyTeachValue(fieldKey, value)', '\n}\n');
check('_applyTeachValue exists', atv.length > 0);
check('_applyTeachValue tears down the ripple for supplier_name (C3)',
      /fieldKey === 'supplier_name'[\s\S]{0,160}_teardownIssuerRipple\(/.test(atv));

// offerIssuerRipple's head guard
const oir = fnBody(R, 'async function offerIssuerRipple(srcDocId, name, row)', '\n}\n');
check('offerIssuerRipple exists', oir.length > 0);
// `findIssuerSiblings` also appears in the early-return guard on line 1, so anchor on the actual call.
const oirHead = oir.slice(0, oir.indexOf('findIssuerSiblings(srcDocId'));
check('the ripple bar is removed at the head (stale bar cannot survive a fresh offer)', /\.ripple-bar'\)\?\.remove\(\)/.test(oirHead));
check('offerIssuerRipple checks the read (check-issuer-read) BEFORE looking for siblings', /checkIssuerRead\s*\??\.?\s*\(/.test(oirHead));
check('offerIssuerRipple consults IssuerTeachDecision.shouldOfferIssuerRipple at its head',
      /IssuerTeachDecision\.shouldOfferIssuerRipple\(\{[^}]*implausible/.test(oirHead));
check('an implausible read returns without offering', /shouldOfferIssuerRipple\(\{[^}]*\}\)\)\s*return;/.test(oirHead));
// C6: the apply click surfaces the IPC's reason and never leaves the bar mute/stuck
const applyClick = oir.slice(oir.indexOf('applyIssuerRipple('));
check('a refused apply surfaces out.reason in the bar (C6)', /out\.reason/.test(applyClick));
check('a refused apply re-enables Not now (the bar is never stuck)', /dismiss\.disabled = false/.test(applyClick));

// ── F1 defence-in-depth: apply-issuer-ripple refuses an implausible value ITSELF (C1) ─────────
const air = fnBody(H, "ipcMain.handle('apply-issuer-ripple'", '\n  });\n');
check('apply-issuer-ripple handler exists', air.length > 0);
check('apply-issuer-ripple READS teach_issuer_plausibility_warn itself (C1)', /teach_issuer_plausibility_warn/.test(air));
check('apply-issuer-ripple calls learning.issuerReadLooksImplausible(value)', /learning\.issuerReadLooksImplausible\(value\)/.test(air));
check('the refusal happens BEFORE the supplier_pin UPDATE', air.indexOf('issuerReadLooksImplausible') < air.indexOf('UPDATE documents SET supplier_pin'));
check('the refusal returns ok:false + error + a human reason (C6)', /ok: false, error: 'implausible-issuer',[\s\S]{0,80}reason:/.test(air));

// ── F2: the drawn-read write on supplier_name consults the decision (C2/C5/C7) ───────────────
const rzo = fnBody(R, 'async function runZoneOcr(rect, fieldKey)', '\nasync function ');
check('runZoneOcr exists', rzo.length > 0);
const writeAt = rzo.indexOf("const input = document.querySelector(`.field-input[data-key=\"${fieldKey}\"]`);");
check('the write block is found', writeAt > 0);
const preWrite = rzo.slice(Math.max(0, writeAt - 2200), writeAt);
check('the check runs ONLY for supplier_name (C2 — not _isNameLikeField)',
      /fieldKey === 'supplier_name'/.test(preWrite) && !/_isNameLikeField\(fieldKey\)[\s\S]{0,80}checkIssuerRead/.test(preWrite));
check('ONE check-issuer-read call before the write (C5)', (preWrite.match(/checkIssuerRead\s*\??\.?\s*\(/g) || []).length === 1);
check('stale-async guard: the doc id is captured before the await and compared after',
      /currentDoc\?\.id/.test(preWrite) && /!==\s*\(?currentDoc\?\.id/.test(preWrite));
check('the decision is IssuerTeachDecision.shouldDrawnReadReplaceField with read/priorValue/implausible/fieldKey',
      /IssuerTeachDecision\.shouldDrawnReadReplaceField\(\{[^}]*read[^}]*priorValue[^}]*implausible[^}]*fieldKey/.test(preWrite));
const writeBlock = rzo.slice(writeAt, rzo.indexOf('lastTeachCtx = {', writeAt));
check('the whole write block is gated on the decision (atomic decline, C7)',
      /if \(input && _replace\)/.test(writeBlock));
// everything that constitutes "the write" sits INSIDE the gated block — nothing leaks on a decline
const gated = writeBlock.slice(writeBlock.indexOf('if (input && _replace)'));
for (const needle of ["corrections[fieldKey] = { original_value: orig, corrected_value: text }", "input.classList.add('corrected')", 'dismissServerNote(_row, fieldKey)', 'fieldValidationError(fieldKey, input.value)', 'window.repairModalInputFocus?.(input)']) {
  check(`inside the gate: ${needle.slice(0, 48)}`, gated.indexOf(needle) > 0);
}
check('speakIssuerTeach receives the ONE check result + the decline (C5)',
      /speakIssuerTeach\(fieldKey, text, \{[^}]*implausible[^}]*declined|speakIssuerTeach\(fieldKey, text, \{[^}]*declined[^}]*implausible/.test(rzo));

// the "Use X" offer on the implausible branch
const sit = fnBody(R, 'async function speakIssuerTeach(fieldKey, text', '\n}\n');
check('speakIssuerTeach takes the threaded check (no second IPC when threaded)', /implausible === true \|\| implausible === false|typeof opts\.implausible === 'boolean'/.test(sit) || /_opts\.implausible/.test(sit));
// The read-back action is a shared `useReadAction` (label `Use "X"`, applies via _applyTeachValue),
// spread into both the near-match-when-declined branch and the implausible-when-declined branch.
check('speakIssuerTeach defines a Use "X" action that applies via _applyTeachValue',
      /useReadAction\s*=\s*\{[\s\S]{0,240}label: `Use "\$\{text\}"`[\s\S]{0,240}_applyTeachValue\(fieldKey, text\)/.test(sit));
check('the implausible branch offers that Use action ONLY when the read was declined',
      /if \(implausible\)\s*\{[\s\S]{0,300}if \(declined\)[\s\S]{0,800}useReadAction/.test(sit));
check('the near-match branch swaps "Keep what I read" for the Use action when declined',
      /declined\s*\?\s*useReadAction/.test(sit));
check('the decline copy says the previous value was kept', /I kept <span/.test(sit));

// ── C4: the warn-only contract comments name the new consumers ───────────────────────────────
check('handler.js check-issuer-read comment names the write/offer consumers (C4)',
      /issuerTeachDecision|shouldDrawnReadReplaceField|apply-issuer-ripple[^\n]*refus/i.test(H.slice(H.indexOf('check-issuer-read') - 2500, H.indexOf('check-issuer-read'))));
check('learning.js issuerReadLooksImplausible comment names the write/offer consumers (C4)',
      /shouldDrawnReadReplaceField|apply-issuer-ripple/.test(L.slice(L.indexOf('function issuerReadLooksImplausible') - 2500, L.indexOf('function issuerReadLooksImplausible'))));

console.log(fails ? `\nFAILED ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
