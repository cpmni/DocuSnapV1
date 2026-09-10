'use strict';
/*
 * test_note_topic_dedup.js — the NOTE_TOPIC_DEDUP composeNote contract (mig 158, DARK; gary → Oracle
 * SIGN-OFF-W/COND). composeNote collapses two SAME-ref-recheck-topic notes to the higher-rank one (the
 * lane-hold survives → the hold survives); every other pair + the ABSENT mark fall through (null → the
 * caller keeps its current concat → byte-identical). Safety: never empty when either input is non-empty;
 * never touches method/corrected_to (a pure string helper); the lane-hold always survives.
 *
 *   node src/modules/processing/test_note_topic_dedup.js
 */
const path = require('path');
const fs = require('fs');
const { composeNote, REF_ADVISORY_MARKS, ABSENT_MARK } = require('./composeNote');
let fails = 0;
const check = (l, c) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}`); if (!c) fails++; };

// Real note shapes from the pipeline:
const LANE  = "Read differently after learning — was 'S0-47966', now 'SO-47966'. Please check which is right.";
const SOFT  = "The reference 'SO-47966' has a character that can look like another on a scan (O/0, I/1) — please confirm the reference before filing.";
const WIT   = "this could read 'SO-47966' or 'S0-47966' (0 and O look alike on a scan) — one character differs; showing 'SO-47966' — please check which is printed";
const ABSENT= "'SO-47966' doesn't appear on this page as written — the page reads it as 'S0-47966' — please check the reference before filing.";
const TOTALS= "The line items don't sum to the order total — please check the amounts.";

console.log('composeNote — the ref-recheck collapse:');
check('lane-hold (existing) + advisory (incoming) → the LANE-HOLD survives',
      composeNote(LANE, SOFT) === LANE);
check('advisory (existing) + lane-hold (incoming) → the LANE-HOLD survives (site-2 shape rereadHolds:135)',
      composeNote(SOFT, LANE) === LANE);
check('two advisories (soften + witness) → a single survivor (one of them), never both',
      [SOFT, WIT].includes(composeNote(SOFT, WIT)) && composeNote(SOFT, WIT) !== null);
check('never returns empty when either input is non-empty',
      composeNote(SOFT, WIT) && composeNote(LANE, SOFT) && composeNote('', SOFT) === null);

console.log('composeNote — what it must NOT merge (falls through to concat → null):');
check('ABSENT + advisory → null (the absent mark is its own topic, never dropped — _neitherOnPage)',
      composeNote(ABSENT, SOFT) === null && composeNote(SOFT, ABSENT) === null);
check('a ref advisory + a DIFFERENT-topic totals note → null (different topics concat)',
      composeNote(SOFT, TOTALS) === null && composeNote(TOTALS, LANE) === null);
check('an empty operand → null (caller handles empties)',
      composeNote('', LANE) === null && composeNote(WIT, '') === null);
// Simulate the two call sites' OFF-vs-ON:
console.log('site behaviour (the survivor collapses the wall; concat stays for other pairs):');
const site1 = (keep, fresh, on) => { const d = on ? composeNote(keep, fresh) : null; return d != null ? d : (fresh && !keep.includes(fresh) ? `${keep} ${fresh}` : keep); };
check('handler.js:1664 shape — OFF stacks the wall',   site1(LANE, SOFT, false) === `${LANE} ${SOFT}`);
check('handler.js:1664 shape — ON collapses to the lane-hold', site1(LANE, SOFT, true) === LANE);
check('handler.js:1664 shape — a different-topic note still concats even ON', site1(LANE, TOTALS, true) === `${LANE} ${TOTALS}`);
check('ABSENT is preserved even ON (concat, matches _neitherOnPage regex)',
      /doesn't appear on this page as written/.test(site1(ABSENT, SOFT, true)));

console.log('mark-sync — every JS mark literal is still a substring of the live Python constant:');
const eng = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'python_backend', 'extraction', 'engine.py'), 'utf8');
const tm  = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'python_backend', 'extraction', 'template_mapper.py'), 'utf8');
const hay = eng + tm;
for (const m of REF_ADVISORY_MARKS) check(`ref-advisory mark present in Python: "${m}"`, hay.includes(m));
check(`ABSENT mark present in Python: "${ABSENT_MARK}"`, hay.includes(ABSENT_MARK));
check('handler.js still routes :1664 through composeNote only when opts.noteTopicDedup',
      fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8').includes('opts.noteTopicDedup ? require(\'./composeNote\').composeNote(keep, fresh) : null'));

console.log(fails ? `\nFAILED: ${fails}` : '\nALL PASS');
process.exit(fails ? 1 : 0);
