#!/usr/bin/env node
'use strict';

/**
 * src/services/test_amount_routing.js — Slice-3 PURE unit gate (Stage 1): the integer-pennies parser
 * + the rule-band matcher. The trust predicate + startDefaultRoute engine (Stage 2) get their own
 * pins (incl. the load-bearing dropped-decimal-never-routes pin).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_amount_routing.js
 */

const { totalToPennies, findMatchingRule, ruleBandsOnAmount, totalSafeToRouteOn, startDefaultRoute, dryRunRules } = require('./amountRouting');

let fail = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  console.log(`  ${ok ? 'OK ' : 'BAD'} ${label}${ok ? '' : `  [got ${JSON.stringify(got)} want ${JSON.stringify(want)}]`}`);
  if (!ok) fail++;
};

console.log('§1 totalToPennies — clean amounts');
eq('£1,046.16 -> 104616', totalToPennies('£1,046.16'), 104616);
eq('£1,046 (0-dp) -> 104600', totalToPennies('£1,046'), 104600);
eq('£5000.5 (1-dp DECIMAL PADDING) -> 500050', totalToPennies('£5000.5'), 500050);   // Oracle A2 — NOT 500005
eq('5000.05 -> 500005', totalToPennies('5000.05'), 500005);
eq('$1,234.00 -> 123400', totalToPennies('$1,234.00'), 123400);
eq('  £ 99.99  (spaces) -> 9999', totalToPennies('  £ 99.99  '), 9999);
eq('0 -> 0', totalToPennies('0'), 0);

console.log('§2 totalToPennies — rejects (=> null => no rule match => manual)');
eq('3-dp -> null', totalToPennies('1046.165'), null);
eq('ambiguous 1.046,16 -> null', totalToPennies('1.046,16'), null);
eq('empty -> null', totalToPennies(''), null);
eq('null -> null', totalToPennies(null), null);
eq('N/A -> null', totalToPennies('N/A'), null);
eq('trailing junk -> null', totalToPennies('100abc'), null);

console.log('§3 totalToPennies — negatives (credits) parse but never match a positive band');
eq('-£50 -> -5000', totalToPennies('-£50'), -5000);
eq('(50.00) accounting -> -5000', totalToPennies('(50.00)'), -5000);

console.log('§4 findMatchingRule — band = [min, max), type match, first-wins');
const rules = [
  { id: 1, document_type_id: 1,    min_amount_pennies: 500000, max_amount_pennies: null,   target_role: 'manager', step_order: 1 },
  { id: 2, document_type_id: null, min_amount_pennies: 0,      max_amount_pennies: 500000, target_role: 'clerk',   step_order: 2 },
];
eq('£5,000.00 at inclusive-min 500000 -> rule 1', findMatchingRule(rules, 500000, 1)?.id, 1);
eq('one penny under min -> rule 2 (any-type band)', findMatchingRule(rules, 499999, 1)?.id, 2);
eq('£10,000 (>=min, max=inf) -> rule 1', findMatchingRule(rules, 1000000, 1)?.id, 1);
eq('wrong type for rule 1 -> falls to any-type rule 2', findMatchingRule(rules, 400000, 2)?.id, 2);
const excl = [{ id: 9, document_type_id: null, min_amount_pennies: 0, max_amount_pennies: 500000, target_role: 'x', step_order: 1 }];
eq('exclusive-max: pennies == max -> NO match', findMatchingRule(excl, 500000, 1), null);
eq('exclusive-max: one under -> match', findMatchingRule(excl, 499999, 1)?.id, 9);
eq('negative pennies never matches a >=0 band', findMatchingRule(rules, -5000, 1), null);
eq('null pennies -> null', findMatchingRule(rules, null, 1), null);
eq('no rules -> null', findMatchingRule([], 500000, 1), null);

console.log('§5 totalSafeToRouteOn — the safety predicate');
{
  const S = totalSafeToRouteOn;
  eq('clean total -> safe', S({ value: '£6,000.00', confidence: 95, note: null, wasCorrected: false }, { currencyConsistent: true, floor: 88 }).safe, true);
  eq('DROPPED-DECIMAL (currencyConsistent false) -> held [THE safety pin]', S({ value: '104616', confidence: 95, note: null, wasCorrected: false }, { currencyConsistent: false, floor: 88 }).reason, 'currency-dp');
  eq('human-CORRECTED total (stale conf 40 + note) -> safe (bypasses floor)', S({ value: '£6,000.00', confidence: 40, note: 'looks off', wasCorrected: true }, { currencyConsistent: true, floor: 88 }).safe, true);
  eq('machine total conf 40 -> held (weak)', S({ value: '£6,000.00', confidence: 40, note: null, wasCorrected: false }, { currencyConsistent: true, floor: 88 }).reason, 'weak-total');
  eq('machine total with a note -> held (flagged)', S({ value: '£6,000.00', confidence: 95, note: 'check', wasCorrected: false }, { currencyConsistent: true, floor: 88 }).reason, 'flagged-total');
  eq('no total -> held', S(null, {}).reason, 'no-total');
  eq('unparseable -> held', S({ value: 'N/A', wasCorrected: false }, { currencyConsistent: true, floor: 88 }).reason, 'unparseable-total');
  eq('corrected total STILL fails currency-dp (human odd value -> manual, never mis-routes)', S({ value: '104616', wasCorrected: true }, { currencyConsistent: false, floor: 88 }).reason, 'currency-dp');
}

console.log('§6 startDefaultRoute — gates, rule match, role resolution + SoD (mock deps)');
{
  const meta = { actor: { userId: 2, username: 'editor', role: 'edit' }, supplierName: 'Acme', slug: 'invoice', documentTypeId: 1 };
  const ctxOK = { fieldKey: 'total_amount', value: '£6,000.00', confidence: 95, note: null, wasCorrected: false };
  const userRule = [{ id: 1, document_type_id: null, min_amount_pennies: 500000, max_amount_pennies: null, target_user_id: 9, action_required: 'approve', step_order: 1 }];
  const mockDeps = (over = {}) => ({
    entitled: () => true, hasActiveRoute: () => false, currencyConsistent: () => true, floor: () => 88,
    listActiveRules: () => userRule, usersByRole: () => [],
    assign: (actor, opts) => ({ ok: true, route: { id: 100, to_user_id: opts.toUserId } }),
    audit: () => {}, ...over,
  });

  delete process.env.WORKFLOW_AMOUNT_ROUTING;
  eq('kill switch OFF -> not routed', startDefaultRoute(null, 1, ctxOK, meta, mockDeps()).reason, 'disabled');
  process.env.WORKFLOW_AMOUNT_ROUTING = '1';

  eq('master OFF (not entitled) -> not routed [master-dark pin]', startDefaultRoute(null, 1, ctxOK, meta, mockDeps({ entitled: () => false })).reason, 'not-entitled');
  eq('already routed -> not routed [idempotency/re-file pin]', startDefaultRoute(null, 1, ctxOK, meta, mockDeps({ hasActiveRoute: () => true })).reason, 'already-routed');

  // FYI slice audit pins (Oracle Q8): 'already-routed' IS audited (the any-route dedupe can
  // block a rule-triggered approval behind an open FYI — must be discoverable, not
  // silent-silent) — but 'disabled'/'not-entitled' stay SILENT: they fire on every confirm in
  // a dark build, so "completing" their auditing would flood the log (audit-spam pin).
  {
    const auditsAR = [];
    startDefaultRoute(null, 1, ctxOK, meta, mockDeps({ hasActiveRoute: () => true, audit: (e) => auditsAR.push(e) }));
    eq('already-routed audits noop', auditsAR.length === 1 && auditsAR[0].outcome === 'noop'
      && /already-routed/.test(auditsAR[0].details || ''), true);
    const auditsSilent = [];
    delete process.env.WORKFLOW_AMOUNT_ROUTING;
    startDefaultRoute(null, 1, ctxOK, meta, mockDeps({ audit: (e) => auditsSilent.push(e) }));
    process.env.WORKFLOW_AMOUNT_ROUTING = '1';
    startDefaultRoute(null, 1, ctxOK, meta, mockDeps({ entitled: () => false, audit: (e) => auditsSilent.push(e) }));
    eq('disabled + not-entitled still audit NOTHING (spam pin — do not "complete" this)', auditsSilent.length, 0);
  }

  const happy = startDefaultRoute(null, 1, ctxOK, meta, mockDeps());
  eq('happy path -> routed to target_user 9', happy.routed && happy.toUserId, 9);

  eq('dropped-decimal -> held [safety]', startDefaultRoute(null, 1, { ...ctxOK, value: '104616' }, meta, mockDeps({ currencyConsistent: () => false })).reason, 'currency-dp');
  eq('below band -> no rule match (manual)', startDefaultRoute(null, 1, { ...ctxOK, value: '£100.00' }, meta, mockDeps()).reason, 'no-match');

  // Oracle C3: an EXPLICITLY named person (even yourself) is a deliberate choice -> ALLOWED
  // (route-to-self); only a ROLE that RESOLVES to the confirmer is SoD-blocked.
  const selfRule = [{ id: 1, document_type_id: null, min_amount_pennies: 500000, max_amount_pennies: null, target_user_id: 2, action_required: 'approve', step_order: 1 }];
  eq('explicit target_user_id == confirmer -> ROUTED (route-to-self allowed)', startDefaultRoute(null, 1, ctxOK, meta, mockDeps({ listActiveRules: () => selfRule })).routed, true);
  const sodRoleRule = [{ id: 1, document_type_id: null, min_amount_pennies: 500000, max_amount_pennies: null, target_role: 'manager', action_required: 'approve', step_order: 1 }];
  eq('role RESOLVING to the confirmer -> held sod', startDefaultRoute(null, 1, ctxOK, meta, mockDeps({ listActiveRules: () => sodRoleRule, usersByRole: () => [{ id: 2, is_active: 1 }] })).reason, 'sod');

  const roleRule = [{ id: 1, document_type_id: null, min_amount_pennies: 500000, max_amount_pennies: null, target_role: 'manager', action_required: 'approve', step_order: 1 }];
  const one = startDefaultRoute(null, 1, ctxOK, meta, mockDeps({ listActiveRules: () => roleRule, usersByRole: () => [{ id: 5, is_active: 1 }] }));
  eq('single-member role (!= confirmer) -> routed', one.routed && one.toUserId, 5);
  eq('ambiguous role (2 members) -> held', startDefaultRoute(null, 1, ctxOK, meta, mockDeps({ listActiveRules: () => roleRule, usersByRole: () => [{ id: 5, is_active: 1 }, { id: 6, is_active: 1 }] })).reason, 'ambiguous-role');
  eq('empty role (0 members) -> held', startDefaultRoute(null, 1, ctxOK, meta, mockDeps({ listActiveRules: () => roleRule, usersByRole: () => [] })).reason, 'no-recipient');
  delete process.env.WORKFLOW_AMOUNT_ROUTING;
}

console.log('§7 type-only rules + null-total (Oracle C1 — no shadowing, honest holds)');
{
  const meta = { actor: { userId: 2, username: 'editor', role: 'edit' }, supplierName: 'Acme', slug: 'invoice', documentTypeId: 1 };
  const ctxOK = { fieldKey: 'total_amount', value: '£6,000.00', confidence: 95, note: null, wasCorrected: false };
  const typeOnly = [{ id: 7, document_type_id: 1, min_amount_pennies: 0, max_amount_pennies: null, target_user_id: 9, action_required: 'approve', step_order: 1 }];
  const banded   = [{ id: 8, document_type_id: 1, min_amount_pennies: 500000, max_amount_pennies: null, target_user_id: 9, action_required: 'approve', step_order: 1 }];
  const both     = [banded[0], typeOnly[0]];   // banded FIRST, type-only SECOND (shadowing risk)
  const md = (rules, over = {}) => ({
    entitled: () => true, hasActiveRoute: () => false, currencyConsistent: () => true, floor: () => 88,
    listActiveRules: () => rules, usersByRole: () => [],
    assign: (actor, opts) => ({ ok: true, route: { id: 100, to_user_id: opts.toUserId } }), audit: () => {}, ...over,
  });
  process.env.WORKFLOW_AMOUNT_ROUTING = '1';

  eq('ruleBandsOnAmount: type-only (min0/maxNull) -> false', ruleBandsOnAmount({ min_amount_pennies: 0, max_amount_pennies: null }), false);
  eq('ruleBandsOnAmount: min>0 -> true', ruleBandsOnAmount({ min_amount_pennies: 1, max_amount_pennies: null }), true);
  eq('ruleBandsOnAmount: max set -> true', ruleBandsOnAmount({ min_amount_pennies: 0, max_amount_pennies: 500000 }), true);

  eq('type-only + clean total -> routed', startDefaultRoute(null, 1, ctxOK, meta, md(typeOnly)).routed, true);
  eq('type-only + DROPPED-DECIMAL -> routed (amount gate skipped)', startDefaultRoute(null, 1, { ...ctxOK, value: '104616' }, meta, md(typeOnly, { currencyConsistent: () => false })).routed, true);
  eq('type-only + NO total -> routed', startDefaultRoute(null, 1, null, meta, md(typeOnly)).routed, true);
  eq('[banded, type-only] + no total -> routes via TYPE-ONLY (no shadow)', startDefaultRoute(null, 1, null, meta, md(both)).toUserId, 9);
  eq('[banded only] + no total -> held no-total (honest, not no-match)', startDefaultRoute(null, 1, null, meta, md(banded)).reason, 'no-total');
  eq('[banded only] + dropped-decimal (parses) -> held currency-dp (safety kept)', startDefaultRoute(null, 1, { ...ctxOK, value: '104616' }, meta, md(banded, { currencyConsistent: () => false })).reason, 'currency-dp');
  delete process.env.WORKFLOW_AMOUNT_ROUTING;
}

console.log('§8 dryRunRules — pure, write-free (Oracle C5)');
{
  const rules = [
    { id: 1, document_type_id: 1, min_amount_pennies: 500000, max_amount_pennies: null, target_user_id: 9, step_order: 1 },
    { id: 2, document_type_id: 1, min_amount_pennies: 0,      max_amount_pennies: null, target_user_id: 8, step_order: 2 },
  ];
  const recent = [
    { id: 101, document_type_id: 1, totalDisplay: '£6,000.00' },   // rule 1 (banded)
    { id: 102, document_type_id: 1, totalDisplay: '£100.00' },     // rule 2 (type-only, below band 1)
    { id: 103, document_type_id: 1, totalDisplay: null },          // rule 2 (type-only, no total)
    { id: 104, document_type_id: 2, totalDisplay: '£9,000.00' },   // no match (wrong type)
  ];
  const res = dryRunRules(rules, recent);
  const r1 = res.find(x => x.ruleId === 1), r2 = res.find(x => x.ruleId === 2);
  eq('rule 1 (banded) matched 1 doc', r1 && r1.count, 1);
  eq('rule 2 (type-only) matched 2 docs incl. the totalless one', r2 && r2.count, 2);
  eq('dryRunRules has NO db param (arity 2) -> structurally write-free', dryRunRules.length, 2);
}

console.log(`\n${fail ? 'FAIL' : 'PASS'} — ${fail} failure(s)`);
process.exit(fail ? 1 : 0);
