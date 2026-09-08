#!/usr/bin/env node
'use strict';
/**
 * scripts/test_check_npm_audit.js — pins the npm-audit release gate's pure evaluate() (slice 2.5 of
 * docs/designs/AUDIT_FIX_PLAN_2026-09-08.md): blocks high/critical, ignores moderate, honours an
 * unexpired allowlist entry loudly, FAILS an expired one, flags an offline report, and the shipped
 * allowlist file is well-formed.
 *
 *   node scripts/test_check_npm_audit.js
 */
const path = require('path');
const { evaluate, advisoryIds, loadAllowlist } = require(path.join(__dirname, 'check-npm-audit.js'));
let pass = 0, fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log(`  OK  ${n}`); } else { fail++; console.log(`  FAIL ${n}${extra ? ' — ' + extra : ''}`); } };
const NOW = new Date('2026-09-08T12:00:00Z');
const vuln = (name, severity, ghsa) => ({ [name]: { name, severity, range: '<1.4.0', fixAvailable: true,
  via: [{ source: 1101234, name, title: 't', url: `https://github.com/advisories/${ghsa}`, severity }] } });
const report = (v) => ({ auditReportVersion: 2, vulnerabilities: v, metadata: {} });

console.log('check-npm-audit gate:');
check('clean report → nothing', (() => { const r = evaluate(report({}), { entries: [] }, NOW); return !r.blocking.length && !r.allowed.length && !r.expired.length && !r.offline; })());
check('an unallowlisted HIGH blocks', evaluate(report(vuln('node-forge', 'high', 'GHSA-aaaa-bbbb-cccc')), { entries: [] }, NOW).blocking.length === 1);
check('an unallowlisted CRITICAL blocks', evaluate(report(vuln('x', 'critical', 'GHSA-1111-2222-3333')), { entries: [] }, NOW).blocking.length === 1);
check('a MODERATE does not block', evaluate(report(vuln('y', 'moderate', 'GHSA-4444-5555-6666')), { entries: [] }, NOW).blocking.length === 0);
{ const r = evaluate(report(vuln('node-forge', 'high', 'GHSA-aaaa-bbbb-cccc')), { entries: [{ id: 'ghsa-aaaa-bbbb-cccc', reason: 'cert-gen only', expires: '2026-12-31' }] }, NOW);
  check('an unexpired allowlist entry (case-insensitive id) is ALLOWED, not blocking', r.blocking.length === 0 && r.allowed.length === 1 && r.expired.length === 0); }
{ const r = evaluate(report(vuln('node-forge', 'high', 'GHSA-aaaa-bbbb-cccc')), { entries: [{ id: 'GHSA-aaaa-bbbb-cccc', reason: 'old', expires: '2026-01-01' }] }, NOW);
  check('an EXPIRED allowlist entry FAILS (expired, not allowed, not silently blocking)', r.blocking.length === 0 && r.allowed.length === 0 && r.expired.length === 1); }
{ const r = evaluate(report(vuln('node-forge', 'high', 'GHSA-aaaa-bbbb-cccc')), { entries: [{ id: '1101234', reason: 'by npm number', expires: '2026-12-31' }] }, NOW);
  check('the numeric npm advisory id also matches', r.allowed.length === 1); }
check('a report with .error is OFFLINE', evaluate({ error: { code: 'ENOTFOUND' } }, { entries: [] }, NOW).offline === true);
check('advisoryIds extracts GHSA + numeric source', (() => { const ids = advisoryIds(vuln('z', 'high', 'GHSA-7777-8888-9999').z); return ids.includes('GHSA-7777-8888-9999') && ids.includes('1101234'); })());
{ let ok = true, why = ''; try { const al = loadAllowlist(); ok = Array.isArray(al.entries); } catch (e) { ok = false; why = e.message; }
  check('scripts/audit-allowlist.json is well-formed (every entry id + reason + expires)', ok, why); }
console.log(`\ncheck-npm-audit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
