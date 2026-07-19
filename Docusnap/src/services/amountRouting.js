'use strict';

/**
 * services/amountRouting.js — Workflow Slice 3 (amount-threshold routing).
 * -----------------------------------------------------------------------
 * After a document is confirmed, auto-create an approval route from the £ ScanFinder extracted.
 * This file holds the PURE pieces (Stage 1): parse a money display string to INTEGER PENNIES, and
 * match a pennies amount against the active route rules. The trust predicate + the startDefaultRoute
 * engine (Stage 2) build on these. Everything here is pure (no DB, no side effects) and unit-tested
 * in src/services/test_amount_routing.js. Behind default-OFF WORKFLOW_AMOUNT_ROUTING and dark under
 * the master WORKFLOW_FEATURE_ENABLED entitlement.
 */

// Parse a money DISPLAY STRING ("£1,046.16") to INTEGER PENNIES, or null if it isn't a clean amount.
// STRING-BASED, never float — a banding decision must be exact (Oracle C4). Handles £/$/€, thousands
// commas, 0/1/2 dp with DECIMAL PADDING ("£5000.5" -> 500050, NOT 500005; Oracle A2), and negatives
// (leading '-' or accounting "(1,234.56)"). 3+ dp / ambiguous / empty / junk -> null (=> no rule
// match => manual). A negative naturally fails an inclusive-min>=0 band, so credits never mis-route.
function totalToPennies(display) {
  if (display == null) return null;
  let s = String(display).trim();
  if (!s) return null;
  let negative = false;
  const paren = s.match(/^\((.*)\)$/);              // (1,234.56) = accounting negative
  if (paren) { negative = true; s = paren[1].trim(); }
  s = s.replace(/[£$€\s]/g, '');
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  s = s.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;    // 3+ dp, empty, or junk -> null
  const [intPart, fracRaw = ''] = s.split('.');
  const frac = fracRaw.padEnd(2, '0');             // "5" -> "50"
  const pennies = parseInt(intPart, 10) * 100 + parseInt(frac, 10);
  if (!Number.isFinite(pennies)) return null;
  return negative ? -pennies : pennies;
}

// Find the FIRST active rule (the caller passes them ordered by step_order, id) whose type + band
// contains `pennies`. Band = [min, max): inclusive-min, exclusive-max; max null = unbounded (Oracle
// C4). A rule with a null document_type_id matches ANY type. Returns the rule row or null. Pure —
// `rules` is the caller's pre-filtered active set (workflow.listActiveRouteRules).
function findMatchingRule(rules, pennies, documentTypeId) {
  if (pennies == null || !Array.isArray(rules)) return null;
  for (const r of rules) {
    if (r.document_type_id != null && r.document_type_id !== documentTypeId) continue;
    if (pennies < r.min_amount_pennies) continue;
    if (r.max_amount_pennies != null && pennies >= r.max_amount_pennies) continue;
    return r;
  }
  return null;
}

// Kill switch — read at CALL TIME (never cached), default OFF ⇒ byte-identical. This is the switch
// that makes the confirm-path capture a no-op. The MASTER gate (real entitlement) is checked
// separately in startDefaultRoute, so even with this ON a dark build never creates a route.
function amountRoutingEnabled() {
  const v = String(process.env.WORKFLOW_AMOUNT_ROUTING || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

// PURE — is the captured total safe to route on? (Oracle C4 + gary.) A dropped-decimal read is the
// dangerous class; `currencyConsistent === false` is the guard. A total the HUMAN corrected this cycle
// (`ctx.wasCorrected`) bypasses the note/confidence floor (a corrected row keeps stale machine
// confidence) but STILL must pass currencyDpConsistent (a human-typed odd value just falls to manual,
// never mis-routes). Returns { safe, reason, pennies }.
function totalSafeToRouteOn(ctx, opts = {}) {
  if (!ctx || ctx.value == null) return { safe: false, reason: 'no-total' };
  const pennies = totalToPennies(ctx.value);
  if (pennies == null) return { safe: false, reason: 'unparseable-total' };
  if (opts.currencyConsistent === false) return { safe: false, reason: 'currency-dp' };   // dropped-decimal guard
  if (!ctx.wasCorrected) {                                                                 // machine-read, unscrutinised
    if (ctx.note && String(ctx.note).trim()) return { safe: false, reason: 'flagged-total' };
    const floor = Number(opts.floor) || 0;
    if (floor > 0 && ctx.confidence != null && Number(ctx.confidence) < floor) return { safe: false, reason: 'weak-total' };
  }
  return { safe: true, pennies };
}

// Capture the total's trust context DURING confirm — after saveCorrections, BEFORE the note-clear
// (Oracle A1). Kill-switch-gated so OFF ⇒ no DB read ⇒ byte-identical. `wasCorrected` is derived from
// the corrections payload (was the total touched THIS cycle), not the sticky row flag. deps.getExtractedTotalContext = documents.getExtractedTotalContext.
function captureTotalContext(db, docId, corrections, deps) {
  if (!amountRoutingEnabled()) return null;
  const ctx = deps.getExtractedTotalContext(db, docId);
  if (!ctx) return null;
  const wasCorrected = !!(corrections && Object.prototype.hasOwnProperty.call(corrections, ctx.fieldKey));
  return { ...ctx, wasCorrected };
}

function _routeAudit(deps, docId, meta, outcome, reason, extra) {
  try {
    deps.audit({
      user_id: meta && meta.actor ? meta.actor.userId : null,
      action: 'workflow_amount_route', action_category: 'workflow', outcome,   // routed | held | noop
      target_type: 'document', target_id: docId, document_id: docId,
      details: reason + (extra ? ' ' + JSON.stringify(extra) : ''),
    });
  } catch { /* audit must never break routing */ }
}

// The engine — runs DETACHED + fail-open in reviewService.confirm's non-bulk block. Creates ONE
// approval route when the extracted total is trust-passing AND matches an active rule AND a target
// resolves unambiguously AND it isn't the confirmer (SoD). Every other path HOLDS toward a human
// (audit reason only in v1 — the "needs a routing decision" surface is a documented fast-follow).
// deps: { entitled, hasActiveRoute, currencyConsistent, floor, listActiveRules, usersByRole, assign, audit }.
// meta: { actor:{userId,username,role}, supplierName, slug, documentTypeId }.
function startDefaultRoute(db, docId, ctx, meta, deps) {
  // Runtime gates: kill switch, then the REAL entitlement (master WORKFLOW_FEATURE_ENABLED — a const,
  // false today) so a dark build can NEVER create a route that would lock a doc with no UI to unlock
  // it (Oracle), then the re-file/already-routed guard (Oracle B1).
  if (!amountRoutingEnabled()) return { routed: false, reason: 'disabled' };
  if (!deps.entitled(db)) return { routed: false, reason: 'not-entitled' };
  if (deps.hasActiveRoute(db, docId)) return { routed: false, reason: 'already-routed' };

  if (!ctx) { _routeAudit(deps, docId, meta, 'held', 'no-total'); return { routed: false, reason: 'no-total' }; }
  const currencyConsistent = deps.currencyConsistent(db, meta.supplierName, meta.slug, ctx.fieldKey, ctx.value);
  const safe = totalSafeToRouteOn(ctx, { currencyConsistent, floor: deps.floor(db) });
  if (!safe.safe) { _routeAudit(deps, docId, meta, 'held', safe.reason); return { routed: false, reason: safe.reason }; }

  const rule = findMatchingRule(deps.listActiveRules(db), safe.pennies, meta.documentTypeId);
  if (!rule) { _routeAudit(deps, docId, meta, 'noop', 'no-rule-match', { pennies: safe.pennies }); return { routed: false, reason: 'no-match' }; }

  let toUserId = null;
  if (rule.target_role) {
    const members = (deps.usersByRole(db, rule.target_role) || []).filter(u => u && u.is_active);
    if (members.length === 0) { _routeAudit(deps, docId, meta, 'held', 'no-recipient-for-role', { role: rule.target_role }); return { routed: false, reason: 'no-recipient' }; }
    if (members.length > 1)  { _routeAudit(deps, docId, meta, 'held', 'ambiguous-role', { role: rule.target_role, count: members.length }); return { routed: false, reason: 'ambiguous-role' }; }
    toUserId = members[0].id;
  } else {
    toUserId = rule.target_user_id;
  }
  if (toUserId == null) { _routeAudit(deps, docId, meta, 'held', 'no-target'); return { routed: false, reason: 'no-target' }; }

  // Separation of duties: never route a doc to the person who just confirmed it.
  if (meta.actor && toUserId === meta.actor.userId) { _routeAudit(deps, docId, meta, 'held', 'sod-self', { toUserId }); return { routed: false, reason: 'sod' }; }

  // Create the route as if sent BY the confirmer (the submitter). assign re-validates role/routable/recipient.
  const res = deps.assign(meta.actor, { documentId: docId, toUserId, actionRequired: rule.action_required || 'approve' });
  if (!res || !res.ok) { _routeAudit(deps, docId, meta, 'held', 'assign-failed', { code: res && res.code }); return { routed: false, reason: 'assign-failed' }; }
  _routeAudit(deps, docId, meta, 'routed', rule.action_required || 'approve', { toUserId, pennies: safe.pennies });
  return { routed: true, routeId: res.route && res.route.id, toUserId };
}

module.exports = {
  totalToPennies, findMatchingRule, totalSafeToRouteOn,
  captureTotalContext, startDefaultRoute, amountRoutingEnabled,
};
