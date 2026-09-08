#!/usr/bin/env node
'use strict';
/**
 * scripts/check-npm-audit.js — RELEASE GATE: no open HIGH/CRITICAL advisory in the PRODUCTION dependency
 * tree (pre-deployment audit 2026-09-07 P1-1; plan docs/designs/AUDIT_FIX_PLAN_2026-09-08.md §3 slice 2.5).
 *
 * Runs `npm audit --omit=dev --json` on the root package (the client has no production dependencies; the
 * cert-tool is not shipped). Blocks on severity >= high unless the advisory is in
 * scripts/audit-allowlist.json — an entry needs an `id` (GHSA-… / the advisory URL id), a `reason`, and an
 * `expires` date; an EXPIRED entry fails the gate (an allowlist is a dated decision, not a permanent hole).
 * Allowed advisories are printed loudly so a release log shows them. The registry being unreachable is a
 * FAIL unless AUDIT_OFFLINE_OK=1 (an offline build must say so explicitly).
 *
 *   node scripts/check-npm-audit.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'audit-allowlist.json');
const BLOCKING = new Set(['high', 'critical']);

function advisoryIds(vuln) {
  const ids = new Set();
  for (const v of vuln.via || []) {
    if (typeof v !== 'object') continue;
    if (v.url) { const m = /(GHSA-[\w-]+)/i.exec(v.url); if (m) ids.add(m[1].toUpperCase()); }
    if (v.source != null) ids.add(String(v.source));
  }
  return [...ids];
}

/**
 * evaluate(report, allowlist, now) → { blocking, allowed, expired, offline }
 * Pure — no I/O. `report` is the `npm audit --json` (v2) object; `allowlist` = { entries: [{id, reason, expires}] }.
 */
function evaluate(report, allowlist, now = new Date()) {
  const out = { blocking: [], allowed: [], expired: [], offline: false };
  if (!report || report.error) { out.offline = true; out.error = report && report.error; return out; }
  const entries = (allowlist && allowlist.entries) || [];
  const byId = new Map(entries.map(e => [String(e.id).toUpperCase(), e]));
  for (const [name, vuln] of Object.entries(report.vulnerabilities || {})) {
    if (!BLOCKING.has(String(vuln.severity).toLowerCase())) continue;
    const ids = advisoryIds(vuln);
    const hit = ids.map(i => byId.get(i.toUpperCase())).find(Boolean);
    const row = { name, severity: vuln.severity, ids, range: vuln.range, fixAvailable: vuln.fixAvailable };
    if (!hit) { out.blocking.push(row); continue; }
    const exp = hit.expires ? new Date(hit.expires) : null;
    if (!exp || isNaN(exp) || exp < now) out.expired.push({ ...row, entry: hit });
    else out.allowed.push({ ...row, entry: hit });
  }
  return out;
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return { entries: [] };
  const al = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
  for (const e of al.entries || []) {
    if (!e.id || !e.reason || !e.expires) throw new Error(`audit-allowlist.json: every entry needs id + reason + expires (bad: ${JSON.stringify(e)})`);
  }
  return al;
}

function runAudit() {
  // One command string under a shell: npm is a .cmd shim on Windows (needs the shell) and a string avoids
  // Node's DEP0190 "args + shell" warning. No user input is interpolated.
  const r = spawnSync('npm audit --omit=dev --json', { cwd: ROOT, encoding: 'utf8', shell: true });
  const text = (r.stdout || '').trim();
  try { return JSON.parse(text); } catch { return { error: { code: r.status, message: (r.stderr || text || 'npm audit produced no JSON').slice(0, 400) } }; }
}

if (require.main === module) {
  const allowlist = loadAllowlist();
  const res = evaluate(runAudit(), allowlist);
  if (res.offline) {
    const msg = `[check-npm-audit] npm audit could not reach the registry: ${JSON.stringify(res.error).slice(0, 300)}`;
    if (process.env.AUDIT_OFFLINE_OK === '1') { console.log(msg + ' — AUDIT_OFFLINE_OK=1, continuing (say so in the release notes).'); process.exit(0); }
    console.error(msg + ' — set AUDIT_OFFLINE_OK=1 to build offline deliberately.'); process.exit(1);
  }
  for (const a of res.allowed) console.log(`[check-npm-audit] ALLOWED ${a.name} (${a.severity}; ${a.ids.join(',')}) — ${a.entry.reason} — expires ${a.entry.expires}`);
  const bad = [...res.blocking.map(b => `BLOCKING ${b.name} ${b.severity} ${b.ids.join(',')} range ${b.range} fix=${JSON.stringify(b.fixAvailable)}`),
               ...res.expired.map(b => `EXPIRED allowlist entry ${b.entry.id} for ${b.name} (${b.entry.expires}) — renew the decision or fix it`)];
  if (bad.length) { console.error(`[check-npm-audit] REFUSED — ${bad.length} problem(s):\n  ${bad.join('\n  ')}`); process.exit(1); }
  console.log(`[check-npm-audit] OK — no open high/critical advisory in the production tree (${res.allowed.length} allowlisted).`);
}

module.exports = { evaluate, advisoryIds, loadAllowlist };
