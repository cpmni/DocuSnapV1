'use strict';
/* logo_veto_probe.js — SLICE C end-to-end gate for the isolated-mark logo VETO
 * (template_matcher._logo_detail_veto / logo_detail.should_veto_logo). Builds a template per supplier
 * from most of its confirmed docs (logo phash SET + detail SET), holds a few out, and runs each held-out
 * doc through identify_template with the veto OFF vs ON. PASS = veto ON drops wrong-supplier resolves
 * (false-accepts) to 0 with 0 false-vetoes (a correct/own-supplier match wrongly abstained). DB read-only.
 * Default pair Northgate/Cascade; override via argv.
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/logo_veto_probe.js [SupA] [SupB]
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawnSync } = require('child_process');
const REPO = path.join(__dirname, '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const RUN = path.join(__dirname, '_logo_veto_run.py');
const SUPS = process.argv.slice(2).filter(a => a[0] !== '-');
const A = SUPS[0] || 'Northgate', B = SUPS[1] || 'Cascade';

const db = new Database(path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db'), { readonly: true });
const grab = like => {
  const o = [];
  for (const r of db.prepare(`SELECT stored_path, working_path FROM documents WHERE original_filename LIKE ? AND status='confirmed'`).all(like + '%')) {
    const s = (r.working_path && fs.existsSync(r.working_path)) ? r.working_path
            : (r.stored_path && fs.existsSync(r.stored_path)) ? r.stored_path : null;
    if (s) o.push(s);
  }
  return o;
};
const sets = { [A]: grab(A), [B]: grab(B) };
db.close();
console.log(`${A}: ${sets[A].length} docs · ${B}: ${sets[B].length} docs`);
const f = path.join(os.tmpdir(), `lv_${Date.now()}.json`);
fs.writeFileSync(f, JSON.stringify(sets));
const r = spawnSync('py', ['-3.12', RUN, f], { encoding: 'utf8', maxBuffer: 1 << 26 });
process.stdout.write(r.stdout || '');
if (r.stderr && !/(GATE|held-out)/.test(r.stdout || '')) process.stdout.write('\nstderr: ' + r.stderr.slice(0, 500));
try { fs.unlinkSync(f); } catch {}
