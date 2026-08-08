'use strict';
/*
 * test_letterhead_note_contract.js — the Python note text MUST arm the renderer's button.
 * Run: node src/windows/review/test_letterhead_note_contract.js
 *
 * THE BUG THIS EXISTS FOR (Oracle SEND-BACK, 2026-07-20). The Review renderer decides whether to
 * draw the "Use '<name>'" button by REGEX-MATCHING the validation_note that Python wrote:
 *
 *     const isBrandingFlag = !!note && !isApplied && key === 'supplier_name'
 *       && !!suggestedSupplier && /page branding reads|confirm the correct company/i.test(note);
 *
 * The first draft of the letterhead reader ended its note "...please confirm the company", which
 * does not match "confirm the CORRECT company". The suggestion was computed, persisted, handed to
 * the renderer and silently dropped: the operator saw a sentence of prose and an empty box, and
 * had to retype the name. Every Python test was green, the measured hit-rate looked excellent, and
 * the feature had no user-visible effect whatsoever.
 *
 * That is the real defect class here: TWO LANGUAGES COUPLED BY A PROSE STRING, with no test
 * spanning the seam. This file is that test. It reads the literal note out of engine.py and runs
 * it through the renderer's actual regex, so a copy edit on either side trips red.
 *
 * It also guards the OTHER direction: the note must not accidentally match the issuer-ACCEPT
 * affordance's regex too, or a single field would render two competing buttons.
 */
const fs   = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');

const engine   = read('..', '..', '..', 'python_backend', 'extraction', 'engine.py');
const renderer = read('renderer.js');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

// ── Extract the LITERAL note the letterhead seam writes ──────────────────────────────────────
// It is an f-string split across two source lines; join them and drop the interpolation.
const m = engine.match(/"Never seen this sender before\.[^"]*"\s*\n\s*"([^"]*)"/);
check('the letterhead note literal is present in engine.py', !!m);
const noteText = m ? ('Never seen this sender before. The top of the page reads \'Acme Ltd\' — ' + m[1]) : '';

// ── Extract the renderer's ACTUAL gating regexes (never re-type them here) ────────────────────
const brandingSrc = renderer.match(/isBrandingFlag\s*=[\s\S]{0,400}?\/([^/]+)\/i\.test\(note\)/);
check('the renderer branding-button regex is found', !!brandingSrc);
const brandingRe = brandingSrc ? new RegExp(brandingSrc[1], 'i') : null;

const acceptSrc = renderer.match(/isIssuerAcceptFlag\s*=[\s\S]{0,400}?\/([^/]+)\/i\.test\(note\)/);
const acceptRe  = acceptSrc ? new RegExp(acceptSrc[1], 'i') : null;

console.log('\nthe seam:');
check('the letterhead note ARMS the "Use \'<name>\'" button (this failed on build 1)',
      !!brandingRe && brandingRe.test(noteText));
check('...and does NOT also arm the issuer-accept affordance (no double button)',
      !acceptRe || !acceptRe.test(noteText));

console.log('\nthe copy does the job the note is relied on for:');
// On first contact the corroboration gate cannot protect anything - the name was read verbatim out
// of the page, so "is it corroborated by the page text" is true by construction. The operator
// reading this sentence is the entire remaining safety budget.
check('it says the sender is unknown', /never seen this sender/i.test(noteText));
check('it names the sender-vs-customer mistake, the one only a human can catch here',
      /sender, not the customer/i.test(noteText));
check('it does not assert - it asks for confirmation', /please confirm/i.test(noteText));

console.log('\nthe python side still emits a value-less row (suggest, never assert):');
const seam = engine.slice(engine.indexOf('LETTERHEAD ISSUER SUGGESTION'));
const block = seam.slice(0, seam.indexOf('TYPE-AMBIGUITY guard'));
check('the seam sets suggested_supplier', block.includes('_lfld["suggested_supplier"] = _lh'));
check('the seam NEVER writes a value', !/_lfld\["value"\]\s*=\s*(?!None)/.test(block));
check('the seam is fill-empty-only', block.includes('results["supplier_name"].get("value")'));
check('the seam is default OFF', /LETTERHEAD_ISSUER", "0"\) == "1"/.test(block));

console.log(fails ? `\n${fails} FAILED` : '\nAll letterhead note-contract checks passed');
process.exit(fails ? 1 : 0);
