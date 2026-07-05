'use strict';
// One reprocess pass against the EXISTING learned stress.db, broken down by
// variant (text vs scanned) and failure mode. Does not wipe/relearn.
const path = require('path'); const fs = require('fs'); const os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap', ST = path.join(REPO, 'stress_test');
const CORPUS = path.join(ST, 'corpus'), CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const docTypes = require(path.join(REPO, 'database', 'modules', 'document_types.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
const SCORED = { invoice: { ref: 'invoice_number', date: 'invoice_date' }, sales_order: { ref: 'sales_order_number', date: 'order_date' }, purchase_order: { ref: 'po_number', date: 'po_date' } };
const normSupplier = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normMoney = s => { const v = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return isNaN(v) ? null : v.toFixed(2); };
const normRef = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const moneyStr = v => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const w = (tag, d) => { const f = path.join(os.tmpdir(), `an_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };

function snap(db) {
  const dts = docTypes.getAllWithFields(db);
  let fmt = []; try { fmt = learning.getFieldFormats(db); } catch {}
  let lo = []; try { lo = labelOverrides ? labelOverrides.getForExtraction(db) : []; } catch {}
  let fr = []; try { fr = learning.getFieldRules(db); } catch {}
  const files = [];
  const args = ['--fields-file', w('f', dts.flatMap(d => d.fields)), '--hints-file', w('h', learning.getHints(db)),
    '--anchors-file', w('a', learning.getAllAnchors(db)), '--logos-file', w('l', learning.getAllLogos(db)),
    '--doc-types-file', w('d', dts), '--formats-file', w('fm', fmt), '--templates-file', w('t', templates.getAll(db)),
    '--label-overrides-file', w('lo', lo), '--field-rules-file', w('fr', fr), '--config-file', CFG,
    '--registration', '--born-digital', '--multiline'];
  return { args, files };
}
function runP(s, files) {
  const N = 8; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  const one = (shardFile) => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', CORPUS, '--files-file', shardFile, '--mode', 'fast', '--tesseract', TESS, '--ocr-threads', '1', ...s.args], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => {
    const docs = {}; for (const o of outs) for (const ln of o.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
    return docs;
  });
}
const ef = (m, k) => { const e = m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : (m[k] != null ? m[k] : null); };

(async () => {
  const truth = JSON.parse(fs.readFileSync(path.join(CORPUS, 'ground_truth.json'), 'utf8'));
  const db = new Database(path.join(ST, 'stress.db'), { readonly: true });
  const nameToSlug = {}; for (const r of db.prepare('SELECT name, slug FROM document_types').all()) nameToSlug[r.name] = r.slug;
  const res = await runP(snap(db), truth.map(t => t.filename));
  const acc = { text: {}, scanned: {} }; const cnt = { text: 0, scanned: 0 };
  const FIELDS = ['type', 'supplier', 'ref', 'date', 'subtotal', 'total_amount'];
  for (const v of ['text', 'scanned']) for (const f of FIELDS) acc[v][f] = 0;
  const conf = { text: [], scanned: [] };
  const examples = { supplier_null: [], supplier_wrong: [], money_null: [], money_clip: [], date_bad: [] };
  const methodStats = {};   // winning-method -> { n, ok, tn, tok, sn, sok } (per-stage attribution)
  const fieldFail = {};     // field -> { et,es (empty text/scan), wt,ws (wrong text/scan), ex[] }
  for (const t of truth) {
    const m = res[t.filename]; if (!m) continue; const v = t.variant; cnt[v]++;
    const det = m._document_slug || nameToSlug[m.document_type] || null;
    const s = {
      type: det === t.type_slug, supplier: normSupplier(m.supplier_name) === normSupplier(t.company),
      ref: normRef(ef(m, SCORED[t.type_slug].ref)) === normRef(t.ref),
      date: String(ef(m, SCORED[t.type_slug].date) || '').trim() === t.date,
      subtotal: normMoney(ef(m, 'subtotal')) === normMoney(moneyStr(t.subtotal)),
      total_amount: normMoney(ef(m, 'total_amount')) === normMoney(moneyStr(t.total)),
    };
    for (const f of FIELDS) if (s[f]) acc[v][f]++;
    // Per-stage attribution: for each scored FIELD, which method WON it and was it right?
    const fk = { supplier: 'supplier_name', ref: SCORED[t.type_slug].ref, date: SCORED[t.type_slug].date, subtotal: 'subtotal', total_amount: 'total_amount' };
    for (const [f, key] of Object.entries(fk)) {
      const ex = m.extractions && m.extractions[key];
      const mth = ex && ex.method ? ex.method : (ex ? '(no-method)' : '(no-extraction)');
      const M = methodStats[mth] || (methodStats[mth] = { n: 0, ok: 0, tn: 0, tok: 0, sn: 0, sok: 0 });
      M.n++; if (s[f]) M.ok++;
      if (v === 'text') { M.tn++; if (s[f]) M.tok++; } else { M.sn++; if (s[f]) M.sok++; }
      // classify each FAILURE as empty (recall gap: stage left it blank) vs wrong
      // (precision gap: stage produced an incorrect value) — the two need different fixes.
      if (!s[f]) {
        const val = ef(m, key);
        const F = fieldFail[f] || (fieldFail[f] = { et: 0, es: 0, wt: 0, ws: 0, ex: [] });
        if (val == null || String(val).trim() === '') { if (v === 'text') F.et++; else F.es++; }
        else { if (v === 'text') F.wt++; else F.ws++; if (F.ex.length < 4) F.ex.push(`[${mth}] '${val}'`); }
      }
    }
    conf[v].push(m.overall_confidence || 0);
    if (!s.supplier) { const d = m.supplier_name; (d == null || d === '' ? examples.supplier_null : examples.supplier_wrong).push(`${t.company}<-'${d}'`); }
    if (!s.total_amount) { const d = ef(m, 'total_amount'); const e = (d == null ? examples.money_null : (String(d).replace(/[^0-9.]/g, '').length < String(t.total.toFixed(2)).replace('.', '').length ? examples.money_clip : examples.money_null)); e.push(`want ${moneyStr(t.total)} got '${d}'`); }
    if (!s.date) examples.date_bad.push(`want ${t.date} got '${ef(m, SCORED[t.type_slug].date)}'`);
  }
  const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '-';
  const out = [];
  out.push('# Final breakdown by variant (existing learned DB, 1 reprocess pass)\n');
  out.push('| Field | Text (200) | Scanned (200) | Overall |');
  out.push('|---|---|---|---|');
  for (const f of FIELDS) out.push(`| ${f} | ${acc.text[f]}/${cnt.text} (${pct(acc.text[f], cnt.text)}) | ${acc.scanned[f]}/${cnt.scanned} (${pct(acc.scanned[f], cnt.scanned)}) | ${pct(acc.text[f] + acc.scanned[f], cnt.text + cnt.scanned)} |`);
  const stat = a => a.length ? `min ${Math.min(...a)} / mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)} / max ${Math.max(...a)} / ==100: ${a.filter(x => x >= 100).length}` : '-';
  out.push(`\n**Confidence** — text: ${stat(conf.text)} · scanned: ${stat(conf.scanned)}`);
  out.push(`\n## Failure modes`);
  out.push(`- supplier NULL (no logo match): ${examples.supplier_null.length} — e.g. ${examples.supplier_null.slice(0, 4).join(' ; ')}`);
  out.push(`- supplier WRONG company (phash collision): ${examples.supplier_wrong.length} — e.g. ${examples.supplier_wrong.slice(0, 6).join(' ; ')}`);
  out.push(`- total NULL (not extracted): ${examples.money_null.length} — e.g. ${examples.money_null.slice(0, 3).join(' ; ')}`);
  out.push(`- total COMMA-CLIP (Part-1 bug in the wild): ${examples.money_clip.length} — e.g. ${examples.money_clip.slice(0, 6).join(' ; ')}`);
  out.push(`- date wrong: ${examples.date_bad.length} — e.g. ${examples.date_bad.slice(0, 4).join(' ; ')}`);
  // ── Per-stage attribution — the "what faults does each stage contain" table ──
  const STAGE = (mth) => /^template_mapping/.test(mth) ? '0.5 mapping'
    : /^template_(fixed|anchor|seed)/.test(mth) ? '0 template-seed'
    : mth === 'keyword' ? '1 keyword' : mth === 'keyword_override' ? '1 admin-label'
    : (/^anchor/.test(mth) || mth === 'logo') ? '2 anchor' : mth === 'ocr_corrector' ? '2.5 ocr-fix'
    : mth === 'llm' ? '3 llm' : mth === 'hint' ? 'hint' : mth;
  const mEntries = Object.entries(methodStats).sort((a, b) => b[1].n - a[1].n);
  out.push(`\n## Per-stage attribution — which method WON each scored field, and how often it was right`);
  out.push(`Scored fields: supplier · ref · date · subtotal · total. "wrong" = the method won the field but the value was INCORRECT vs ground truth — i.e. the silent-mis-file risk, the fault that matters most.`);
  out.push('| Method (stage) | wins | correct | precision | wrong | text prec | scanned prec |');
  out.push('|---|---|---|---|---|---|---|');
  for (const [mth, M] of mEntries) out.push(`| \`${mth}\` (${STAGE(mth)}) | ${M.n} | ${M.ok} | ${pct(M.ok, M.n)} | ${M.n - M.ok} | ${pct(M.tok, M.tn)} | ${pct(M.sok, M.sn)} |`);
  const faults = mEntries.map(([mth, M]) => ({ mth, wrong: M.n - M.ok, n: M.n })).filter(x => x.wrong > 0).sort((a, b) => b.wrong - a.wrong);
  out.push(`\n### Fault hit-list — methods ranked by WRONG wins (biggest fault sources first)`);
  if (!faults.length) out.push('- (none — every method that won a scored field was correct on this corpus)');
  for (const x of faults.slice(0, 12)) out.push(`- \`${x.mth}\` (${STAGE(x.mth)}): **${x.wrong}** wrong of ${x.n} wins — ${pct(x.n - x.wrong, x.n)} precision`);
  // ── Per-field recall vs precision gaps — the "what to attack first" table ──
  out.push(`\n## Per-field failure breakdown — recall (empty) vs precision (wrong)`);
  out.push(`EMPTY = the field was left blank (a RECALL gap — no stage read it). WRONG = a value was produced but it's incorrect (a PRECISION gap — the dangerous, silent-mis-file kind).`);
  out.push('| Field | empty text | empty scan | wrong text | wrong scan | wrong examples |');
  out.push('|---|---|---|---|---|---|');
  for (const f of ['supplier', 'ref', 'date', 'subtotal', 'total_amount']) {
    const F = fieldFail[f] || { et: 0, es: 0, wt: 0, ws: 0, ex: [] };
    out.push(`| ${f} | ${F.et} | ${F.es} | ${F.wt} | ${F.ws} | ${F.ex.slice(0, 3).join(' ; ') || '—'} |`);
  }
  // ── CI-style PER-STAGE GATE (GATE=1) — enforce "each stage does its job" ──
  // Fail (exit 1) if any high-volume stage's PRECISION drops below its floor, or the total
  // WRONG-value count (the silent-mis-file class) exceeds the cap. A plain run just reports.
  let gateBreach = 0;
  if (process.env.GATE === '1') {
    const FLOOR = m => m === 'keyword' ? 0.995 : /^(logo|anchor)/.test(m) ? 0.99 : /^template/.test(m) ? 0.98 : 0.95;
    const MIN_WINS = 20, MAX_WRONG = 3;
    out.push('\n## Per-stage precision GATE');
    let totalWrong = 0;
    for (const [m, M] of Object.entries(methodStats)) {
      if (!m.startsWith('(')) totalWrong += M.n - M.ok;          // '(no-extraction)' = empties, not wrong values
      if (m.startsWith('(') || M.n < MIN_WINS) continue;         // skip empties + low-volume noise
      const prec = M.ok / M.n, floor = FLOOR(m), pass = prec >= floor;
      if (!pass) gateBreach++;
      out.push(`- ${pass ? 'PASS' : 'FAIL'} \`${m}\` ${pct(M.ok, M.n)} vs floor ${(floor * 100).toFixed(1)}%  [${M.n} wins]`);
    }
    if (totalWrong > MAX_WRONG) { gateBreach++; out.push(`- FAIL total wrong values ${totalWrong} > ${MAX_WRONG} (silent-mis-file cap)`); }
    else out.push(`- PASS total wrong values ${totalWrong} <= ${MAX_WRONG}`);
    out.push(gateBreach ? `\n**GATE FAILED (${gateBreach} breach) — a stage regressed.**`
                        : `\n**GATE PASSED — every high-volume stage is within its precision floor.**`);
  }
  const txt = out.join('\n');
  fs.writeFileSync(path.join(ST, 'out', 'breakdown.md'), txt);
  console.log(txt);
  db.close();
  if (process.env.GATE === '1' && gateBreach) process.exit(1);
})();
