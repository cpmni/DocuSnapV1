const fs = require('fs');
const rd = f => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const [offF, onF] = process.argv.slice(2);
const off = new Map(rd(offF).map(r => [r.id, r]));
const on = new Map(rd(onF).map(r => [r.id, r]));
const rv = r => r && r.ref ? r.ref.val : null;
const rc = r => r && r.ref ? r.ref.correct : null;
const dc = r => r && r.date ? r.date.correct : null;
let fires = [], newFilers = [], lostFilers = [], newWrong = [], fixed = [];
for (const [id, o] of on) {
  const b = off.get(id); if (!b) continue;
  const method = (o.ref && o.ref.method) || '';
  const valChanged = rv(o) !== rv(b);
  if (/readwiden/.test(method) || valChanged)
    fires.push({ id, type: o.type, off: rv(b), on: rv(o), onCorrect: rc(o), method });
  if (o.wouldFile && !b.wouldFile) {
    newFilers.push({ id, type: o.type, ref: rv(o), refCorrect: rc(o), dateCorrect: dc(o) });
    if (rc(o) === false || dc(o) === false) newWrong.push({ id, ref: rv(o), refCorrect: rc(o), dateCorrect: dc(o) });
  }
  if (b.wouldFile && !o.wouldFile) lostFilers.push({ id, type: o.type, reason: o.reason });
  if (o.wouldFile && b.wouldFile && rc(b) === false && rc(o) === true) fixed.push({ id, off: rv(b), on: rv(o) });
}
const pr = (t, a) => { console.log(`${t}: ${a.length}`); a.forEach(x => console.log('   ', JSON.stringify(x))); };
console.log('docs compared:', on.size);
pr('FIRES (readwiden method OR ref value changed)', fires);
pr('wouldFile REGRESSIONS (filed OFF, NOT ON) — must be 0 for wouldFile(ON) superset-of wouldFile(OFF)', lostFilers);
pr('NEW filers (ON not OFF)', newFilers);
pr('NEW WRONG auto-files (new filer, ref/date != GT) — MUST be 0', newWrong);
pr('FIXED (was wrong-auto-filing OFF, now correct ON — the arc healing a silent wrong)', fixed);
