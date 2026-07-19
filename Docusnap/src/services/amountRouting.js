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

// A rule "bands on amount" iff it constrains the total (a lower or upper bound). A TYPE-ONLY rule
// (min 0, max NULL) matches ANY amount — including a doc with NO readable total — and skips the
// dropped-decimal trust gate (a doubtful total is a Review problem, not routing's; Barry/Oracle).
const ruleBandsOnAmount = (r) => (Number(r.min_amount_pennies) > 0) || (r.max_amount_pennies != null);

// Find the FIRST active rule (caller passes them ordered by step_order, id) whose type + band match.
// Band = [min, max): inclusive-min, exclusive-max; max null = unbounded. Null document_type_id = ANY
// type. `pennies` may be null (no readable total): a BANDED rule then SKIPS (it needs an amount) so it
// can't SHADOW a later type-only rule that should catch the doc (Oracle C1); a type-only rule matches
// regardless. Pure — `rules` is the caller's pre-filtered active set (workflow.listActiveRouteRules).
function findMatchingRule(rules, pennies, documentTypeId) {
  if (!Array.isArray(rules)) return null;
  for (const r of rules) {
    if (r.document_type_id != null && r.document_type_id !== documentTypeId) continue;
    if (!ruleBandsOnAmount(r)) return r;                 // type-only: matches any amount incl. none
    if (pennies == null) continue;                        // banded needs a total; none => skip (no shadowing)
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

// The engine — runs DETACHED + fail-open at the FILING SEAM (reviewService.confirm — bulk AND
// non-bulk — and processing _autoFileDoc). Creates ONE route when a doc matches an active rule, a
// target resolves unambiguously, and (for a ROLE-resolved target) it isn't the confirmer (SoD). An
// amount-BANDED rule additionally trust-gates the total (the dropped-decimal guard); a TYPE-ONLY rule
// does not. Every other path HOLDS toward a human (audit reason only). deps: { entitled, hasActiveRoute,
// currencyConsistent, floor, listActiveRules, usersByRole, assign, audit, summarizeRule? }. meta:
// { actor?:{userId,username,role}, supplierName, slug, documentTypeId }. On the AUTO-FILE path meta.actor
// is ABSENT (no human sender) so SoD is inert (self-routing is unambiguous there).
function startDefaultRoute(db, docId, ctx, meta, deps) {
  // Runtime gates: kill switch, then the REAL entitlement (master WORKFLOW_FEATURE_ENABLED const,
  // false today) so a dark build can NEVER create a route, then the already-routed/re-file guard.
  if (!amountRoutingEnabled()) return { routed: false, reason: 'disabled' };
  if (!deps.entitled(db)) return { routed: false, reason: 'not-entitled' };
  // NOTE: 'disabled'/'not-entitled' above are DELIBERATELY un-audited — they fire on every confirm
  // in a dark build (audit-spam; pinned in test_amount_routing.js). 'already-routed' below IS
  // audited (FYI slice / Oracle Q8): the dedupe is ANY-open-route, so an unresolved FYI blocks a
  // rule-triggered approval — rare (routes fire once at filing; only an Edit-in-Review re-file
  // re-enters) but a real missed-approval scenario that must be discoverable, not silent-silent.
  if (deps.hasActiveRoute(db, docId)) {
    _routeAudit(deps, docId, meta, 'noop', 'already-routed');
    return { routed: false, reason: 'already-routed' };
  }

  // Match the rule FIRST (Oracle C1) so a type-only rule fires even with no/messy total, and a banded
  // rule that would fail the trust gate can't shadow a later type-only rule.
  const pennies = ctx ? totalToPennies(ctx.value) : null;
  const rules = deps.listActiveRules(db);
  const rule = findMatchingRule(rules, pennies, meta.documentTypeId);
  if (!rule) {
    // No rule matched. If a BANDED rule matches this doc's TYPE but couldn't be evaluated (no readable
    // total), that's an honest HOLD — it wanted this doc, we just couldn't read the £ (Oracle C1) —
    // NOT a plain no-match. (A type-only rule would already have matched above, so this only fires
    // when the only type-matching rules are amount-banded.)
    if (pennies == null && Array.isArray(rules) && rules.some(r =>
          ruleBandsOnAmount(r) && (r.document_type_id == null || r.document_type_id === meta.documentTypeId))) {
      _routeAudit(deps, docId, meta, 'held', 'no-total'); return { routed: false, reason: 'no-total' };
    }
    _routeAudit(deps, docId, meta, 'noop', 'no-rule-match', { pennies }); return { routed: false, reason: 'no-match' };
  }

  // Amount-banded rules trust-gate the total (the dropped-decimal guard is load-bearing here);
  // type-only rules never touch the total.
  if (ruleBandsOnAmount(rule)) {
    if (!ctx) { _routeAudit(deps, docId, meta, 'held', 'no-total'); return { routed: false, reason: 'no-total' }; }
    const currencyConsistent = deps.currencyConsistent(db, meta.supplierName, meta.slug, ctx.fieldKey, ctx.value);
    const safe = totalSafeToRouteOn(ctx, { currencyConsistent, floor: deps.floor(db) });
    if (!safe.safe) { _routeAudit(deps, docId, meta, 'held', safe.reason); return { routed: false, reason: safe.reason }; }
  }

  // Resolve the target.
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

  // SoD — only for a ROLE-RESOLVED target (Oracle C3): the system landed on the confirmer, don't
  // silently route to them. An EXPLICITLY named person (even yourself) is a deliberate choice → allowed.
  if (rule.target_role && meta.actor && toUserId === meta.actor.userId) { _routeAudit(deps, docId, meta, 'held', 'sod-self', { toUserId }); return { routed: false, reason: 'sod' }; }

  // Immutable "why it routed" snapshot (Oracle C6) — the rule sentence AS IT WAS at route time, so a
  // later edit/delete can't rewrite history. The wiring supplies summarizeRule (does the name lookups).
  const matchedRuleSummary = deps.summarizeRule ? deps.summarizeRule(rule) : null;
  const res = deps.assign(meta.actor, { documentId: docId, toUserId, actionRequired: rule.action_required || 'approve', matchedRuleSummary });
  if (!res || !res.ok) { _routeAudit(deps, docId, meta, 'held', 'assign-failed', { code: res && res.code }); return { routed: false, reason: 'assign-failed' }; }
  _routeAudit(deps, docId, meta, 'routed', rule.action_required || 'approve', { toUserId, pennies });
  return { routed: true, routeId: res.route && res.route.id, toUserId };
}

// PURE, write-free (NO db handle by design — "creates zero routes" is structural; Oracle C5/gary).
// Reports which active rule each recent doc WOULD match, for the settings dry-run preview. Same matcher
// as runtime so the preview can't drift. recentDocs: [{id, document_type_id, totalDisplay}]. Returns
// [{ ruleId, rule, count, sample:[docId…] }] grouped by the winning rule. No target-resolve, no trust
// gate (per-doc runtime concerns) — the UI labels it "would match", not "will route".
function dryRunRules(rules, recentDocs) {
  const per = new Map();
  for (const d of (recentDocs || [])) {
    const rule = findMatchingRule(rules, totalToPennies(d.totalDisplay), d.document_type_id);
    if (!rule) continue;
    if (!per.has(rule.id)) per.set(rule.id, { ruleId: rule.id, rule, count: 0, sample: [] });
    const e = per.get(rule.id); e.count++; if (e.sample.length < 20) e.sample.push(d.id);
  }
  return [...per.values()];
}

module.exports = {
  totalToPennies, findMatchingRule, ruleBandsOnAmount, totalSafeToRouteOn,
  captureTotalContext, startDefaultRoute, dryRunRules, amountRoutingEnabled,
};
