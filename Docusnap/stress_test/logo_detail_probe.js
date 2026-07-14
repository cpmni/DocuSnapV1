'use strict';
/* logo_detail_probe.js — GATE-0 gate for the logo-collision discriminator (logo_detail.detail_hash).
 * Renders every confirmed doc of two (or more) suppliers, computes the ISOLATED-mark 256-bit detail
 * hash (colour + a bitonal/B&W-scan simulation), and reports the intra-supplier drift vs the inter-
 * supplier distance. PASS = the marks SEPARATE (inter-min > intra-max) with margin, on BOTH colour
 * and B&W — i.e. the discriminator tells look-alike monograms apart and survives black-and-white
 * scanning. DB read-only. Default pair Northgate/Cascade (the live collision); override via argv.
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/logo_detail_probe.js [SupA] [SupB]
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawnSync } = require('child_process');
const REPO = path.join(__dirname, '..');
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
const HELPER = path.join(__dirname, '_logo_detail_hash.py');
const LIVE = path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const SUPS = process.argv.slice(2).filter(a => a[0] !== '-');
const A = SUPS[0] || 'Northgate', B = SUPS[1] || 'Cascade';

const db = new Database(LIVE, { readonly: true });
const grab = like => {
  const out = [];
  for (const r of db.prepare(`SELECT stored_path, working_path FROM documents
      WHERE original_filename LIKE ? AND status='confirmed'`).all(like + '%')) {
    const s = (r.working_path && fs.existsSync(r.working_path)) ? r.working_path
            : (r.stored_path && fs.existsSync(r.stored_path)) ? r.stored_path : null;
    if (s) out.push(s);
  }
  return out;
};
const setA = grab(A), setB = grab(B);
db.close();
console.log(`${A}: ${setA.length} docs · ${B}: ${setB.length} docs`);
if (setA.length < 2 || setB.length < 2) { console.log('need ≥2 docs per supplier — aborting'); process.exit(0); }

const w = d => { const f = path.join(os.tmpdir(), `ld_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const hashOf = files => {
  const r = spawnSync('py', ['-3.12', HELPER, w(files)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  try { return JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { console.log('py err:', (r.stderr || '').slice(0, 400)); return {}; }
};
const hA = hashOf(setA), hB = hashOf(setB);
const hamHex = (a, b) => { if (!a || !b || a.length !== b.length) return null; let d = 0; for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } } return d; };

function report(kind) {
  const va = setA.map(f => (hA[f] || {})[kind]).filter(Boolean);
  const vb = setB.map(f => (hB[f] || {})[kind]).filter(Boolean);
  const nullA = setA.length - va.length, nullB = setB.length - vb.length;
  const intra = [];
  for (const s of [va, vb]) for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) intra.push(hamHex(s[i], s[j]));
  const inter = [];
  for (const a of va) for (const b of vb) inter.push(hamHex(a, b));
  const imax = intra.length ? Math.max(...intra) : 0, imin = inter.length ? Math.min(...inter) : 0;
  const sep = imin > imax;
  console.log(`[${kind}] isolate-fail(null): ${A}=${nullA} ${B}=${nullB} · intra-max=${imax} · inter-min=${imin} · ` +
              (sep ? `SEPARATED margin=${imin - imax}` : 'COLLIDE'));
  return sep;
}
console.log('');
const okC = report('colour'), okB = report('bitonal');
console.log('\n' + (okC && okB ? 'GATE PASS — isolated-mark detail hash separates the pair on colour AND B&W'
                                : 'GATE FAIL — the pair is not cleanly separated'));
