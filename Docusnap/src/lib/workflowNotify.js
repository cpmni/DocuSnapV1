'use strict';

/**
 * lib/workflowNotify.js — PURE decision logic for Slice-1 workflow notifications
 * (event→toast aggregation + the FIRE-TIME toast decision), kept out of main.js so
 * it is testable under Electron-as-Node. main.js owns the timers and the actual
 * `new Notification`; both transports feed it through main.js notifyWorkflowEvent.
 *
 * Fire-time guards are THE point (Oracle condition 3): a toast queued moments before
 * logout/quit must decide against the state AT FIRE TIME, not at enqueue time — the
 * OS Notification needs no window, so it would otherwise still show after logout.
 */

// Which route events toast, and in which direction.
//   'in'  → something new landed on the RECIPIENT (assign)
//   'out' → the SENDER's request was resolved (approve/reject/acknowledge)
//   null  → badge-ping only (claim, recall — the acting user already knows)
function eventDirection(event) {
  if (event === 'assigned') return 'in';
  if (event === 'approved' || event === 'rejected' || event === 'acknowledged') return 'out';
  return null;
}

function affectedUserId(event, route) {
  return eventDirection(event) === 'in' ? route.to_user_id : route.from_user_id;
}

// Fold an event into the SINGLE-SLOT aggregate (trailing debounce, main.js owns the
// timer). Same affected-user+direction within the window → one counted toast ("N
// documents routed to you"); a different key REPLACES the slot (superseded, bounded —
// never a queue; the badge ping already fired per event regardless).
function aggregate(agg, ev) {
  const dir = ev && ev.route ? eventDirection(ev.event) : null;
  if (!dir) return agg;   // unchanged reference ⇒ caller skips the timer reset
  const affected = affectedUserId(ev.event, ev.route);
  const key = `${affected}:${dir}`;
  if (agg && agg.key === key) return { ...agg, count: agg.count + 1, event: ev.event };
  return {
    key, affectedId: affected, direction: dir, count: 1, event: ev.event,
    counterpart: dir === 'in' ? ev.route.from_username : ev.route.to_username,
    actorId: ev.actor ? ev.actor.userId : null,
  };
}

// Fire-time decision: returns {title, body} or null. Every field of `state` is read
// AT FIRE TIME by the caller: { isQuitting, notificationsSupported, settingEnabled,
// currentUser }.
function decideToast(agg, state) {
  if (!agg) return null;
  if (state.isQuitting) return null;                       // tray-Exit teardown underway
  if (!state.notificationsSupported) return null;
  if (state.settingEnabled === false) return null;         // workflow_toasts_enabled off
  const me = state.currentUser;
  if (!me || me.id !== agg.affectedId) return null;        // logged out / another user's session
  if (agg.actorId != null && agg.actorId === agg.affectedId) return null;  // self-action
  const many = agg.count > 1;
  if (agg.direction === 'in') {
    return {
      title: many ? `${agg.count} documents routed to you` : 'New approval request',
      body: `From ${agg.counterpart} — open the Mailbox in Search to act.`,
    };
  }
  return {
    title: many ? `${agg.count} of your requests were resolved` : `Your request was ${agg.event}`,
    body: `By ${agg.counterpart}. See the Mailbox in Search for details.`,
  };
}

module.exports = { aggregate, decideToast, eventDirection, affectedUserId };
