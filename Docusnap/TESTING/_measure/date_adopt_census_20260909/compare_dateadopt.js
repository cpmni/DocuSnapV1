// compare_dateadopt.js <off.jsonl> <on.jsonl> — the date-adopt (mig 143) flip-gate diff.
// Fires = the DATE field's method carries 'padadopt' OR its value changed OFF->ON. M = a NEW auto-filer
// whose date != GT. Gate: wouldFile(ON) superset-of wouldFile(OFF), every adopt==GT, 0 new wrong.
const fs = require('fs');
const rd = f => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const [offF, onF] = process.argv.slice(2);
const off = new Map(rd(offF).map(r => [r.id, r]));
const on = new Map(rd(onF).map(r => [r.id, r]));
const dv = r => r && r.date ? r.date.val : null;
const dc = r => r && r.date ? r.date.correct : null;
const dm = r => (r && r.date && r.date.method) || '';
let fires = [], newFilers = [], lostFilers = [], newWrong = [], fixed = [];
for (const [id, o] of on) {
  const b = off.get(id); if (!b) continue;
  const method = dm(o);
  const valChanged = dv(o) !== dv(b);
  if (/padadopt/.test(method) || valChanged)
    fires.push({ id, type: o.type, off: dv(b), on: dv(o), onCorrect: dc(o), method });
  if (o.wouldFile && !b.wouldFile) {
    newFilers.push({ id, type: o.type, date: dv(o), dateCorrect: dc(o), ref: o.ref && o.ref.val, refCorrect: o.ref && o.ref.correct });
    if (dc(o) === false || (o.ref && o.ref.correct === false)) newWrong.push({ id, date: dv(o), dateCorrect: dc(o), ref: o.ref && o.ref.val, refCorrect: o.ref && o.ref.correct });
  }
  if (b.wouldFile && !o.wouldFile) lostFilers.push({ id, type: o.type, reason: o.reason });
  if (o.wouldFile && b.wouldFile && dc(b) === false && dc(o) === true) fixed.push({ id, off: dv(b), on: dv(o) });
}
const pr = (t, a) => { console.log(`${t}: ${a.length}`); a.forEach(x => console.log('   ', JSON.stringify(x))); };
console.log('docs compared:', on.size);
pr('FIRES (padadopt method OR date value changed)', fires);
pr('wouldFile REGRESSIONS (filed OFF, NOT ON) — must be 0', lostFilers);
pr('NEW filers (ON not OFF)', newFilers);
pr('NEW WRONG auto-files (new filer, date/ref != GT) — MUST be 0', newWrong);
pr('FIXED (was wrong-auto-filing OFF, correct ON)', fixed);
