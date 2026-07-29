'use strict';
/*
 * score_demo_digital.js — score the born-digital DEMO batch (gen_demo_digital.py) against its
 * ground_truth.json, with NO learning loaded (clean COLD extraction) so the result isolates
 * born-digital layout / keyword / anchor / type-detection accuracy — the exact layer the batch
 * is built to stress. Reads the live DB READ-ONLY for the installed doc-types + fields ONLY
 * (so the engine knows which fields to extract); hints/anchors/logos/templates are EMPTY.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/score_demo_digital.js [A|B|all]
 * Output: console summary + "<Desktop>/Demo Docs Digital/score_report.md".
 * No app code / DB is modified.
 */
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap';
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const LIVE_DB = process.env.RR_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const ROOT = path.join(process.env.USERPROFILE, 'Desktop', 'Demo Docs Digital');
const WHICH = (process.argv[2] || 'A').toUpperCase();   // A (default) | B | ALL

const normSupplier = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normRef = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const normMoney = s => { const v = parseFloat(String(s || '').replace(/[^0-9.\-]/g, '')); return isNaN(v) ? null : v.toFixed(2); };
const normDate = s => String(s || '').replace(/[^0-9]/g, '');
const w = (tag, d) => { const f = path.join(os.tmpdir(), `sd_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const ef = (m, k) => { const e = k && m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : (k && m[k] != null ? m[k] : null); };
const pct = (o, n) => n ? (100 * o / n).toFixed(1) + '%' : '  -  ';

function docTypesWithFields(db) {
  const dts = db.prepare('SELECT * FROM document_types').all();
  const byType = {};
  for (const f of db.prepare('SELECT * FROM fields').all()) (byType[f.document_type_id] || (byType[f.document_type_id] = [])).push(f);
  for (const dt of dts) dt.fields = byType[dt.id] || [];
  return dts;
}

// COLD snapshot: real doc-types + fields, EMPTY learning (no hints/anchors/logos/templates/rules).
function coldArgs(db) {
  const dts = docTypesWithFields(db);
  return ['--fields-file', w('f', dts.flatMap(d => d.fields)),
          '--hints-file', w('h', []), '--anchors-file', w('a', []), '--logos-file', w('l', []),
          '--doc-types-file', w('d', dts), '--formats-file', w('fm', []),
          '--templates-file', w('t', []), '--label-overrides-file', w('lo', []),
          '--field-rules-file', w('fr', []),
          '--config-file', CFG, '--registration', '--born-digital', '--multiline'];
}

function runP(folder, args, files) {
  const N = 8; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  const one = shardFile => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', folder, '--files-file', shardFile, '--mode', 'fast', '--tesseract', TESS, ...args], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => {
    const docs = {}; for (const o of outs) for (const ln of o.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
    return docs;
  });
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'ground_truth.json'))) { console.error('No ground_truth.json under', ROOT, '— run gen_demo_digital.py first.'); process.exit(1); }
  const gtAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'ground_truth.json'), 'utf8'));
  const gtRows = gtAll.filter(g => WHICH === 'ALL' || g.set === WHICH);
  const db = new Database(LIVE_DB, { readonly: true, fileMustExist: true });
  const nameToSlug = {}, roles = {}, installed = new Set();
  for (const r of db.prepare('SELECT name, slug, ref_field_key, date_field_key FROM document_types').all()) {
    nameToSlug[r.name] = r.slug; roles[r.slug] = { ref: r.ref_field_key, date: r.date_field_key }; installed.add(r.slug);
  }

  // stage the batch flat into a temp dir keyed by basename (unique across the batch)
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'scoredemo-'));
  const gt = {}; const files = [];
  for (const g of gtRows) {
    const src = path.join(ROOT, g.file); if (!fs.existsSync(src)) continue;
    const base = path.basename(src);
    fs.copyFileSync(src, path.join(TMP, base)); files.push(base); gt[base] = g;
  }
  console.log(`Scoring ${files.length} ${WHICH} docs (cold: no learning). Types installed: ${[...installed].length}`);
  const notInstalled = [...new Set(gtRows.map(g => g.type_slug))].filter(s => !installed.has(s));
  if (notInstalled.length) console.log(`  ⚠ type(s) NOT installed in the DB (will mis-type/skip field score): ${notInstalled.join(', ')}`);

  const res = await runP(TMP, coldArgs(db), files);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

  // 'total' is intentionally NOT scored: the installed doc-types define only issuer/ref/date fields
  // (no total/line-item field exists to extract into), so a total score would be a false 0%. Add a
  // total field to the types and re-score to test money extraction.
  const F = ['type', 'supplier', 'ref', 'date'];
  const blank = () => Object.fromEntries(F.map(f => [f, { ok: 0, n: 0 }]));
  const overall = blank(), byArch = {}, byType = {}, byEdge = {};
  const miss = Object.fromEntries(F.map(f => [f, []]));
  let noResult = 0, held = 0;

  for (const base of files) {
    const m = res[base], g = gt[base];
    if (!m) { noResult++; continue; }
    if (m.needs_review) held++;
    const rk = (roles[g.type_slug] || {}).ref, dk = (roles[g.type_slug] || {}).date;
    const detSlug = m._document_slug || nameToSlug[m.document_type] || null;
    const s = {
      type: detSlug === g.type_slug,
      supplier: normSupplier(m.supplier_name) === normSupplier(g.supplier),
      ref: (rk && g.ref != null) ? normRef(ef(m, rk)) === normRef(g.ref) : null,
      date: (dk && g.date != null) ? normDate(ef(m, dk)) === normDate(g.date) : null,
      total: (g.money && g.total != null) ? normMoney(ef(m, 'total') != null ? ef(m, 'total') : ef(m, 'total_amount')) === normMoney(g.total) : null,
    };
    const got = { type: (m.document_type || detSlug), supplier: m.supplier_name, ref: rk ? ef(m, rk) : null, date: dk ? ef(m, dk) : null, total: ef(m, 'total') != null ? ef(m, 'total') : ef(m, 'total_amount') };
    const want = { type: g.type_slug, supplier: g.supplier, ref: g.ref, date: g.date, total: g.total };
    const arch = g.archetype, ty = g.type_slug;
    byArch[arch] = byArch[arch] || blank(); byType[ty] = byType[ty] || blank();
    for (const f of F) {
      if (s[f] == null) continue;
      overall[f].n++; byArch[arch][f].n++; byType[ty][f].n++;
      if (s[f]) { overall[f].ok++; byArch[arch][f].ok++; byType[ty][f].ok++; }
      else if (miss[f].length < 14) miss[f].push(`${base}  [${arch}${g.edge_tags.length ? '/' + g.edge_tags.join('+') : ''}]  got ${JSON.stringify(got[f])}  want ${JSON.stringify(want[f])}`);
      for (const tag of (g.edge_tags.length ? g.edge_tags : ['(clean)'])) {
        byEdge[tag] = byEdge[tag] || blank(); byEdge[tag][f].n++; if (s[f]) byEdge[tag][f].ok++;
      }
    }
  }
  db.close();

  const tbl = (title, obj) => {
    let out = `\n### ${title}\n\n| ${title.split(' ')[1] || 'key'} | ` + F.map(f => f).join(' | ') + ' | n |\n|' + '---|'.repeat(F.length + 2) + '\n';
    for (const k of Object.keys(obj).sort()) {
      const r = obj[k]; const n = Math.max(...F.map(f => r[f].n));
      out += `| ${k} | ` + F.map(f => pct(r[f].ok, r[f].n)).join(' | ') + ` | ${n} |\n`;
    }
    return out;
  };
  let rep = `# Demo-digital COLD score — Set ${WHICH}\n\nReprocessed ${files.length} docs with NO learning (pure born-digital layout/keyword/anchor/type). `;
  rep += `no-result: ${noResult} · held(needs_review): ${held}` + (notInstalled.length ? ` · uninstalled types: ${notInstalled.join(', ')}` : '') + `\n`;
  rep += `\n## Overall\n\n| field | ` + F.join(' | ') + ` |\n|---|` + '---|'.repeat(F.length) + `\n| accuracy | ` + F.map(f => pct(overall[f].ok, overall[f].n)).join(' | ') + ` |\n`;
  rep += tbl('by archetype', byArch) + tbl('by type', byType) + tbl('by edge', byEdge);
  rep += `\n## Sample mismatches (up to 14 per field)\n`;
  for (const f of F) { rep += `\n**${f}** (${overall[f].n - overall[f].ok} wrong / ${overall[f].n})\n`; for (const line of miss[f]) rep += `- ${line}\n`; }

  const outPath = path.join(ROOT, `score_report_${WHICH}.md`);
  fs.writeFileSync(outPath, rep);
  console.log('\nOVERALL  ' + F.map(f => `${f} ${pct(overall[f].ok, overall[f].n)}`).join('  '));
  console.log(`held ${held}  no-result ${noResult}  ->  ${outPath}`);
})();
