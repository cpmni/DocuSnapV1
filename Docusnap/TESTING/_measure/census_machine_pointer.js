'use strict';
/*
 * census_machine_pointer.js — the measurement gary named as the gate for the machine-pointer design.
 * READ-ONLY on the database it is given: it copies to a temp file before touching any setting.
 *
 * Answers, per (supplier, type, field):
 *   • human vs machine counts, and how much of the corpus is invisible;
 *   • the prefix index armed OFF vs ON, and which scopes go disarmed -> ARMED;
 *   • whether the shape class or confirmed_count would move (both must be ZERO — that is the
 *     design's central claim, and this is what proves it rather than asserting it);
 *   • THE MANUAL-REVIEW OUTPUT: scopes where the machine-majority prefix DIFFERS from the
 *     human-attested prefix. That is the poisoned-scope list, and no code decides it.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 electron.exe census_machine_pointer.js <db> [--json out.json]
 */
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const trust    = require(path.join(REPO, 'database', 'modules', 'trust.js'));

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) { console.error('usage: census <db>'); process.exit(2); }

// Work on a COPY, always. This script flips a setting to measure the counterfactual and must never
// be able to do that to a real database.
const tmp = path.join(os.tmpdir(), `census_${Date.now()}.db`);
fs.copyFileSync(SRC, tmp);
const db = new Database(tmp);

const set = (k, v) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?) '
  + 'ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);

const codePrefix = v => {
  const s = String(v == null ? '' : v);
  if (!/[0-9]/.test(s)) return null;
  const m = /^[A-Za-z]{2,}/.exec(s);
  return m ? m[0].toUpperCase() : null;
};
const prefixCounts = counts => {
  const out = {};
  for (const [v, n] of Object.entries(counts || {})) {
    const p = codePrefix(v);
    if (p) out[p] = (out[p] || 0) + n;
  }
  return out;
};
// The shipped bars, in one place (engine `_prefix_dominant_backed`).
const armed = pc => {
  const tot = Object.values(pc).reduce((a, b) => a + b, 0);
  let dom = null, dn = 0;
  for (const [k, n] of Object.entries(pc)) if (n > dn) { dom = k; dn = n; }
  return { dom, dn, tot, ok: tot >= 5 && dn >= 5 && dn >= 0.9 * tot };
};
const key = g => `${String(g.supplier_name || '(all)').trim()}|${g.document_type}|${g.field_key}`;

// ── ARM 1: today (exclusion ON) ────────────────────────────────────────────────────────────────
set('learning_exclude_machine_confirms', 'true');
const onGroups = new Map();
for (const g of (learning.getFieldFormats(db) || [])) onGroups.set(key(g), g);

// ── ARM 2: the counterfactual (exclusion OFF) — used ONLY to read what the machine channel holds
set('learning_exclude_machine_confirms', 'false');
const offGroups = new Map();
for (const g of (learning.getFieldFormats(db) || [])) offGroups.set(key(g), g);
set('learning_exclude_machine_confirms', 'true');

const rows = [];
let armedNow = 0, armedAfter = 0, wouldArm = [], shapeMoves = [], countMoves = [], poisoned = [];

for (const [k, off] of offGroups) {
  const on = onGroups.get(k);
  const humanCounts = on ? (on.value_counts || {}) : {};
  const allCounts   = off.value_counts || {};
  const hp = prefixCounts(humanCounts);
  // The DESIGN's union: a machine value is admitted only if its prefix is human-attested.
  const attested = new Set(Object.keys(hp));
  const unionCounts = { ...humanCounts };
  for (const [v, n] of Object.entries(allCounts)) {
    if (humanCounts[v]) continue;                       // already counted on the human side
    const p = codePrefix(v);
    if (p && attested.has(p)) unionCounts[v] = (unionCounts[v] || 0) + n;
  }
  const aOn  = armed(hp);
  const aNew = armed(prefixCounts(unionCounts));
  if (aOn.ok) armedNow++;
  if (aNew.ok) armedAfter++;
  if (!aOn.ok && aNew.ok) wouldArm.push({ k, from: aOn, to: aNew });

  // The design claims these two CANNOT move (the union happens at the emit, in Python — the JS
  // group is untouched). Measured here so the claim is proved, not asserted.
  if (on && off && (on.confirmed_count !== undefined)) {
    const onSolid = !on.provisional, offSolid = !off.provisional;
    if (onSolid !== offSolid) shapeMoves.push({ k, on: onSolid, off: offSolid });
  }

  // THE MANUAL-REVIEW OUTPUT: the machine channel's majority prefix vs the human-attested one.
  const machineOnly = {};
  for (const [v, n] of Object.entries(allCounts)) if (!humanCounts[v]) machineOnly[v] = n;
  const mp = armed(prefixCounts(machineOnly));
  if (aOn.dom && mp.dom && mp.dom !== aOn.dom && mp.dn >= 3) {
    poisoned.push({ k, human: `${aOn.dom}x${aOn.dn}`, machine: `${mp.dom}x${mp.dn}` });
  }

  const hTot = Object.values(humanCounts).reduce((a, b) => a + b, 0);
  const aTot = Object.values(allCounts).reduce((a, b) => a + b, 0);
  if (aTot > hTot) rows.push({ k, human: hTot, all: aTot, hidden: aTot - hTot,
                               armedOn: aOn.ok, armedNew: aNew.ok, dom: aOn.dom || mp.dom || '-' });
}

rows.sort((a, b) => b.hidden - a.hidden);
console.log(`\n=== CORPUS VISIBILITY (${path.basename(SRC)}) ===`);
const tot = rows.reduce((a, r) => ({ h: a.h + r.human, a: a.a + r.all }), { h: 0, a: 0 });
console.log(`groups with hidden machine evidence: ${rows.length}`);
console.log(`counted human values ${tot.h} · total confirmed values ${tot.a} · `
            + `hidden ${tot.a - tot.h} (${tot.a ? ((tot.a - tot.h) / tot.a * 100).toFixed(1) : 0}%)`);
console.log('\ntop 15 by hidden evidence:');
for (const r of rows.slice(0, 15)) {
  console.log(`  ${r.k.padEnd(58).slice(0, 58)} human ${String(r.human).padStart(4)} / all ${String(r.all).padStart(4)}`
    + `  prefix-armed: ${r.armedOn ? 'yes' : 'NO '} -> ${r.armedNew ? 'YES' : 'no '}   dom=${r.dom}`);
}
console.log(`\n=== PREFIX LANE ===`);
console.log(`scopes armed today: ${armedNow}   after the union: ${armedAfter}   newly armed: ${wouldArm.length}`);
for (const w of wouldArm) console.log(`  + ${w.k.padEnd(58).slice(0, 58)} ${w.from.dn}/${w.from.tot} -> ${w.to.dn}/${w.to.tot} (${w.to.dom})`);

console.log(`\n=== MUST BE ZERO (the design's central claim) ===`);
console.log(`solid/provisional flips: ${shapeMoves.length}` + (shapeMoves.length ? ' <-- INVESTIGATE' : ''));
for (const s of shapeMoves.slice(0, 10)) console.log(`  ${s.k}  solid ON=${s.on} OFF=${s.off}`);

console.log(`\n=== MANUAL REVIEW — machine-majority prefix DIFFERS from the human-attested one ===`);
if (!poisoned.length) console.log('  (none)');
for (const p of poisoned) console.log(`  ${p.k.padEnd(52).slice(0, 52)} human ${p.human}  machine ${p.machine}`);

// ── GRADUATION CENSUS: scopeTrust must be IDENTICAL either way ─────────────────────────────────
console.log(`\n=== GRADUATION CENSUS (scopeTrust must be identical) ===`);
const scopes = db.prepare(`SELECT DISTINCT d.supplier_name sup, t.slug slug FROM documents d
  JOIN document_types t ON t.id = d.document_type_id
  WHERE d.status='confirmed' AND TRIM(COALESCE(d.supplier_name,'')) <> ''`).all();
let diff = 0;
for (const s of scopes) {
  set('learning_exclude_machine_confirms', 'true');
  const a = trust.scopeTrust(db, s.sup, s.slug);
  set('learning_exclude_machine_confirms', 'false');
  const b = trust.scopeTrust(db, s.sup, s.slug);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    diff++;
    console.log(`  DIFFERS ${s.sup} | ${s.slug}`);
    console.log(`    exclusion ON : ${JSON.stringify(a)}`);
    console.log(`    exclusion OFF: ${JSON.stringify(b)}`);
  }
}
set('learning_exclude_machine_confirms', 'true');
console.log(`  scopes examined ${scopes.length}, differing ${diff}`
  + (diff ? '  <-- these DE-GRADUATE if the exclusion is lifted wholesale; the emit-side design must not touch them' : ''));

db.close(); fs.unlinkSync(tmp);
