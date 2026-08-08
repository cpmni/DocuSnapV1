'use strict';
/*
 * test_review_initial_selection.js — pins the Review-window cold-start LANDING rule.
 * Run: node src/windows/review/test_review_initial_selection.js
 *
 * THE UX HOLE THIS PINS. On a first import after install there are no learned senders yet, so the
 * review queue (grouped-by-sender by default, every group collapsed on open) shows a single "—"
 * bar over an EMPTY preview pane and nothing is auto-selected — a first-time user gets stranded
 * with no obvious next step. The fix factors the load-time landing choice into the pure function
 * decideInitialSelection() and, for the SINGLE-group case (the cold-DB / single-sender case),
 * auto-expands that pile and opens its first document.
 *
 * TWO load-bearing properties, both pinned behaviourally below:
 *  1. target XOR auto-land — a requested "Edit in Review" target NEVER coexists with an auto-select.
 *     That mutual exclusion is what removed the pre-existing double-select race (the old code fired
 *     an un-awaited selectDoc(queue[0]) AND then a second selectDoc for the Search target).
 *  2. 2+ groups → land on NOTHING — the deliberate many-senders "pick a group" overview must be
 *     preserved. This is the pin that stops a future dev "helpfully" widening the auto-select to
 *     always-first-group, which would BOTH disturb that overview AND revive the race.
 *
 * Also pinned (source): the "—" group KEY is unchanged (only the DISPLAY title is humanised), and
 * the "sink the unidentified pile" tiebreak sits BELOW the attention term so a flagged unidentified
 * batch is never buried under a clean named pile (Oracle condition C2).
 */
const fs   = require('fs');
const path = require('path');
const renderer = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

// Extract the PURE decideInitialSelection from renderer.js (it references no DOM/globals) and eval
// it in isolation, so the assertions below test real RETURN VALUES, not just source text.
const start = renderer.indexOf('function decideInitialSelection');
const end   = renderer.indexOf('/* __PIN_END:decideInitialSelection__ */');
check('decideInitialSelection is present with its pin-end marker', start > -1 && end > start);
const decideInitialSelection = eval('(' + renderer.slice(start, end) + ')');

const dA = { id: 1 }, dB = { id: 2 }, dC = { id: 3 };

console.log('\ndecideInitialSelection — behaviour:');

// (a) a target present → navigate, and NEVER a select (the mutual exclusion / race fix)
let r = decideInitialSelection({ targetId: 99, queueGrouped: true, queue: [dA, dB],
                                 groups: [{ supplier: '—', docs: [dA, dB] }] });
check('(a) target present → { navigate: id }', r.navigate === 99);
check('(a) target present → NO select alongside it', r.select === undefined);

// (b) flat "Newest first" view, no target → the top row (unchanged from the old behaviour)
r = decideInitialSelection({ targetId: null, queueGrouped: false, queue: [dA, dB], groups: [] });
check('(b) flat, no target → select queue[0]', r.select === dA);

// (c) grouped, exactly ONE sender pile → that pile's first doc (THE cold-start landing)
r = decideInitialSelection({ targetId: null, queueGrouped: true, queue: [dA, dB],
                             groups: [{ supplier: '—', docs: [dA, dB] }] });
check('(c) grouped, 1 group → select groups[0].docs[0]', r.select === dA);

// (d) grouped, 2+ sender piles → land on NOTHING (preserve the collapsed overview) — the guard
r = decideInitialSelection({ targetId: null, queueGrouped: true, queue: [dA, dB, dC],
                             groups: [{ supplier: 'Acme', docs: [dA] }, { supplier: 'Beta', docs: [dB, dC] }] });
check('(d) grouped, 2+ groups → { none } (no auto-select — the widening guard)', r.none === true && !r.select);

// empty queue → nothing (renderQueueList shows its own empty state)
r = decideInitialSelection({ targetId: null, queueGrouped: true, queue: [], groups: [] });
check('empty queue → { none }', r.none === true);

// a single group with no docs must not throw / must not claim a select
r = decideInitialSelection({ targetId: null, queueGrouped: true, queue: [dA],
                             groups: [{ supplier: '—', docs: [] }] });
check('single group with empty docs → { none } (no crash)', r.none === true && !r.select);

console.log('\nWiring + invariants (source):');
const lqBody = renderer.slice(renderer.indexOf('async function loadQueue'),
                              renderer.indexOf('// ── "Auto-committed"'));
check('loadQueue calls decideInitialSelection', /decideInitialSelection\(\{/.test(lqBody));
// The flat-only `selectDoc(queue[0])` auto-select is now gone EVERYWHERE — the window-open path
// uses decideInitialSelection, and the mid-session Defer / File-All done-paths advance via
// advanceAfterAction (which lands on a doc in the grouped view too, instead of clearing the pane).
check('the old flat-only `selectDoc(queue[0])` auto-select is gone everywhere (open + mid-session)',
      !/if \(queue\.length > 0 && !queueGrouped\) selectDoc\(queue\[0\]\);/.test(renderer));
// Defer must advance within the visible/grouped order (advanceAfterAction), not clear the pane.
const deferSrc  = renderer.slice(renderer.indexOf("getElementById('btn-defer').addEventListener"));
const deferBody = deferSrc.slice(0, deferSrc.indexOf('});'));
check('Defer advances via advanceAfterAction (lands on the next doc, grouped view too)',
      /advanceAfterAction\(/.test(deferBody));
check('getReviewTarget is read BEFORE the decision (consume-once)',
      lqBody.indexOf('getReviewTarget') > -1
      && lqBody.indexOf('getReviewTarget') < lqBody.indexOf('decideInitialSelection('));
check('refreshAutoCommittedBar is still called in loadQueue (Oracle C3 — not dropped)',
      /refreshAutoCommittedBar\(\)/.test(lqBody));

check("group KEY fallback stays '—' in reviewDisplayGroups (expand/nav depends on it)",
      /const key = \(doc\.supplier_name \|\| ''\)\.trim\(\) \|\| '—';/.test(renderer));
check('groupTitle maps the "—" pile to human copy by live group count (display only)',
      /function groupTitle\(supplier, groupCount\)/.test(renderer)
      && /Your scanned documents/.test(renderer) && /Sender not identified/.test(renderer));

// Oracle C2: the "—"-sink tiebreak must come AFTER the attention (need) term in the shared sort.
const sortSrc  = renderer.slice(renderer.indexOf('entries.sort((a, b) =>'));
const sortBody = sortSrc.slice(0, sortSrc.indexOf('return entries;'));
check('sort: attention (need) term precedes the "—"-sink term (a flagged pile is never buried)',
      sortBody.indexOf('(b.need > 0) - (a.need > 0)') > -1
      && sortBody.indexOf("(a.supplier === '—') - (b.supplier === '—')") > -1
      && sortBody.indexOf('(b.need > 0) - (a.need > 0)') < sortBody.indexOf("(a.supplier === '—') - (b.supplier === '—')"));

console.log(fails ? `\n${fails} FAILED` : '\nAll initial-selection checks passed');
process.exit(fails ? 1 : 0);
