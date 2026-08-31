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
const m = engine.match(/"Couldn't confirm who issued this page[^"]*"\s*\n\s*"([^"]*)"/);
check('the letterhead note literal is present in engine.py', !!m);
const noteText = m ? ("Couldn't confirm who issued this page — the top of the page reads 'Acme Ltd'. " + m[1]) : '';

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
check('it says the issuer could not be confirmed (true for a new sender AND a known sender whose layout changed — Chris card #2)',
      /couldn't confirm who issued/i.test(noteText));
check('it names the sender-vs-customer mistake, the one only a human can catch here',
      /sender, not the customer/i.test(noteText));
check('it does not assert - it asks for confirmation', /please confirm/i.test(noteText));

const seam = engine.slice(engine.indexOf('LETTERHEAD ISSUER SUGGESTION'));
const block = seam.slice(0, seam.indexOf('TYPE-AMBIGUITY guard'));
// The block now holds TWO branches: a DEFAULT-OFF prefill `if` (Chris round-11 card #4) and the
// original value-less suggest `elif`. Split on the elif so each contract is checked in isolation.
const splitAt = block.indexOf('elif not _lfld.get("suggested_supplier")');
check('the block splits into a prefill branch and a suggest branch', splitAt > 0);
const prefillBranch = splitAt > 0 ? block.slice(0, splitAt) : '';
const suggestBranch = splitAt > 0 ? block.slice(splitAt) : block;

console.log('\nthe SUGGEST path still emits a value-less row (suggest, never assert):');
check('the suggest branch sets suggested_supplier', suggestBranch.includes('_lfld["suggested_supplier"] = _lh'));
check('the suggest branch NEVER writes a value', !/_lfld\["value"\]\s*=\s*(?!None)/.test(suggestBranch));
check('the suggest reader is fill-empty-only', block.includes('results["supplier_name"].get("value")'));
check('the suggest reader is default OFF', /LETTERHEAD_ISSUER", "0"\) == "1"/.test(block));

console.log('\nthe PREFILL path (Chris round-11 card #4) writes a value but stays review-bound:');
check('prefill is a SEPARATE seam, default OFF', /LETTERHEAD_PREFILL", "0"\) == "1"/.test(prefillBranch));
check('prefill is fill-empty-only', prefillBranch.includes('not _lfld.get("value")'));
check('prefill writes the value into the box', /_lfld\["value"\]\s*=\s*_lh/.test(prefillBranch));
check('C1: prefill holds the row by confidence 69 (< the 70 review threshold), not the note alone',
      /_lfld\["confidence"\]\s*=\s*69/.test(prefillBranch));
check('C3: prefill stamps the DISTINCT method token letterhead_prefill (matches no note-demoter)',
      /_lfld\["method"\]\s*=\s*"letterhead_prefill"/.test(prefillBranch));
check('C2: prefill does NOT set suggested_supplier (no redundant Use-button on a filled box)',
      !/_lfld\["suggested_supplier"\]\s*=/.test(prefillBranch));

// C2: the value-present note must NOT arm the branding button, but MUST carry the sender-vs-customer copy.
const pm = prefillBranch.match(/f"The letterhead reads[^"]*"\s*\n\s*"([^"]*)"/);
check('the prefill note literal is present in engine.py', !!pm);
const prefillNote = pm ? ("The letterhead reads 'Acme Ltd' — filled in for you, but please confirm " + pm[1]) : '';
check('C2: the prefill note does NOT arm the "Use \'X\'" button (value-present = plain note)',
      !!brandingRe && !brandingRe.test(prefillNote));
check('C2: ...and does NOT arm the issuer-accept affordance either (no button on a filled box)',
      !acceptRe || !acceptRe.test(prefillNote));
check('C2: the prefill note still names the sender-vs-customer mistake', /sender, not the customer/i.test(prefillNote));
check('the prefill note asks for confirmation, does not assert', /please confirm/i.test(prefillNote));

// C3 cross-file: classFixService must not shed this note on reprocess (its CLEARABLE_NOTE_MARKS set).
console.log('\nthe prefill note is durable (no note-demoter sheds it):');
const classFix = read('..', '..', 'services', 'classFixService.js');
check('C3: classFixService does not clear the letterhead prefill note',
      !/filled in for you|letterhead reads/i.test(classFix));

// ── Slice 2 of the garbled-issuer arc (2026-08-22 evening; Oracle C2.3) ──────────────────────
// The identity-CONFLICT note ("Letterhead may read “X” — detected “Y”. Please confirm the issuer.")
// now ALSO arms the branding-resolve button, because the engine carries X in `suggested_supplier`
// when Y is a GARBLE of X (and clears any Stage-4.5 token repair from corrected_to, so the weaker
// accept-btn `Use “DOCUMENT”` can never double-render). The row shows two honest answers:
// `Use “X”` (fills + pins + sibling ripple) and `✓ Keep “Y” as the issuer` (names the value).
console.log('\nslice 2 — the identity-conflict note:');
const idm = engine.match(/f"Letterhead may read “\{_idv\.get\('text_led'\)\}” — "\s*\n\s*f"([^"]*)"/);
check('the identity-conflict note literal is present in engine.py', !!idm);
const idNote = idm ? ('Letterhead may read “DOCUMENT SOLUTIONS” — ' + idm[1].replace("{_idv.get('resolved')}", 'NOCUMENT')) : '';
check('the identity note ARMS the branding-resolve button (the suggestion is no longer dropped)',
      !!brandingRe && brandingRe.test(idNote));
const issuerSrc = renderer.match(/isIssuerFlag\s*=[\s\S]{0,400}?\/([^/]+)\/i\.test\(note\)/);
const issuerRe  = issuerSrc ? new RegExp(issuerSrc[1], 'i') : null;
check('…and the issuer-accept affordance too — two honest answers on purpose', !!issuerRe && issuerRe.test(idNote));
check('the issuer-accept label NAMES the value it affirms (never a blind "Issuer is correct" beside a garble)',
      /✓ Keep “\$\{_btnVal\(val\)\}” as the issuer/.test(renderer));
check('the branding button is gated on suggested_supplier (no suggestion → no button → unarmed install is byte-identical)',
      /isBrandingFlag\s*=[\s\S]{0,200}?!!suggestedSupplier/.test(renderer));
check('engine: the suggestion writer clears corrected_to in the same breath (no accept-btn double-render)',
      /f\["suggested_supplier"\] = canon\s*\n\s*f\["corrected_to"\] = None/.test(engine));
check('engine: the letterhead-prefill note (prefillNote) still does NOT arm the branding button (value-present)',
      !!brandingRe && !brandingRe.test(prefillNote));

console.log(fails ? `\n${fails} FAILED` : '\nAll letterhead note-contract checks passed');
process.exit(fails ? 1 : 0);
