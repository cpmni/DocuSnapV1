#!/usr/bin/env node
'use strict';

/**
 * src/lib/test_workflow_notify.js
 * Pure decision logic for Slice-1 workflow notifications (lib/workflowNotify.js):
 * aggregation (trailing-debounce slot) + the FIRE-TIME toast decision. The fire-time
 * guards are Oracle condition 3 — a toast queued moments before logout/quit must
 * decide against the state AT FIRE TIME (the OS toast needs no window and would
 * otherwise still show after logout).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/lib/test_workflow_notify.js
 * (also runs under plain node — the module is pure).
 */

const { aggregate, decideToast, eventDirection, affectedUserId } = require('./workflowNotify');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const route = { id: 9, document_id: 4, from_user_id: 1, from_username: 'admin', to_user_id: 2, to_username: 'editor' };
const OK_STATE = { isQuitting: false, notificationsSupported: true, settingEnabled: true, currentUser: { id: 2 } };

console.log('§1 event → direction / affected user');
check("assigned → 'in' (recipient)", eventDirection('assigned') === 'in' && affectedUserId('assigned', route) === 2);
check("approved → 'out' (sender)", eventDirection('approved') === 'out' && affectedUserId('approved', route) === 1);
check("rejected/acknowledged → 'out'", eventDirection('rejected') === 'out' && eventDirection('acknowledged') === 'out');
check('claimed/recalled → badge-ping only (null)', eventDirection('claimed') === null && eventDirection('recalled') === null);

console.log('§2 aggregation — single slot, count-merge on same key, replace on new key');
{
  let agg = null;
  const claimed = aggregate(agg, { event: 'claimed', route, actor: { userId: 2 } });
  check('claim leaves the aggregate UNCHANGED (same reference — no timer reset)', claimed === agg);
  agg = aggregate(agg, { event: 'assigned', route, actor: { userId: 1 } });
  check('first assign seeds the slot (count 1, counterpart = sender)', agg && agg.count === 1 && agg.counterpart === 'admin');
  agg = aggregate(agg, { event: 'assigned', route, actor: { userId: 1 } });
  agg = aggregate(agg, { event: 'assigned', route, actor: { userId: 1 } });
  check('same-key assigns MERGE (bulk → one counted toast)', agg.count === 3);
  const replaced = aggregate(agg, { event: 'approved', route, actor: { userId: 2 } });
  check('different key REPLACES the slot (superseded — bounded, never a queue)',
    replaced.count === 1 && replaced.direction === 'out' && replaced.affectedId === 1);
}

console.log('§3 fire-time guards (Oracle condition 3)');
{
  const agg = aggregate(null, { event: 'assigned', route, actor: { userId: 1 } });
  check('happy path fires', !!decideToast(agg, OK_STATE));
  check('null aggregate → no toast', decideToast(null, OK_STATE) === null);
  check('isQuitting at FIRE time → no toast', decideToast(agg, { ...OK_STATE, isQuitting: true }) === null);
  check('Notification unsupported → no toast', decideToast(agg, { ...OK_STATE, notificationsSupported: false }) === null);
  check('workflow_toasts_enabled off → no toast', decideToast(agg, { ...OK_STATE, settingEnabled: false }) === null);
  // THE queued-then-logged-out pin: enqueued while editor was signed in, fired after logout.
  check('QUEUED-THEN-LOGGED-OUT: currentUser null at fire time → no toast',
    decideToast(agg, { ...OK_STATE, currentUser: null }) === null);
  check('a DIFFERENT user signed in at fire time → no toast',
    decideToast(agg, { ...OK_STATE, currentUser: { id: 7 } }) === null);
  // Self-action: the desktop user assigning to THEMSELVES must not be toasted about it.
  const selfAgg = aggregate(null, { event: 'assigned', route: { ...route, to_user_id: 1 }, actor: { userId: 1 } });
  check('self-action → no toast', decideToast(selfAgg, { ...OK_STATE, currentUser: { id: 1 } }) === null);
}

console.log('§4 toast copy — singular vs aggregated');
{
  const one = aggregate(null, { event: 'assigned', route, actor: { userId: 1 } });
  check("single 'in' → 'New approval request' from the sender",
    decideToast(one, OK_STATE).title === 'New approval request' && /From admin/.test(decideToast(one, OK_STATE).body));
  let many = one;
  many = aggregate(many, { event: 'assigned', route, actor: { userId: 1 } });
  many = aggregate(many, { event: 'assigned', route, actor: { userId: 1 } });
  check("bulk 'in' → counted title", decideToast(many, OK_STATE).title === '3 documents routed to you');
  const out = aggregate(null, { event: 'rejected', route, actor: { userId: 2 } });
  check("single 'out' → names the terminal state",
    decideToast(out, { ...OK_STATE, currentUser: { id: 1 } }).title === 'Your request was rejected');
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll workflow-notify checks passed.');
process.exit(fails ? 1 : 0);
