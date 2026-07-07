'use strict';
/*
 * teach_pass.js — score the TAUGHT-ANCHOR stages the plain corpus can't reach.
 *
 * The stress corpus never teaches ⊕ anchors, so Stage-2 anchor_crop never fires and its
 * precision is invisible (the plain analyze.js shows only keyword + logo). This pass:
 *   1. copies the learned stress.db -> teach.db,
 *   2. injects the AUTHORITATIVE ref/date anchors from gen_teach_anchors.py (exact value
 *      boxes derived from the corpus layout),
 *   3. reprocesses + scores with the SAME per-stage attribution as analyze.js.
 * Authoritative anchors win Tier-A, so ref/date are now read by anchor_crop — giving a real
 * PRECISION number for the crop path (the stage the City Office 152574->192074 drift hit).
 *
 * Env: LIMIT=N reprocess only the first N corpus files (fast validation).
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron stress_test/teach_pass.js
 */
const path = require('path'); const fs = require('fs'); const os = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const REPO = 'c:/GIT Projects/Docusnap', ST = path.join(REPO, 'stress_test');
const CORPUS = process.env.CORPUS ? path.resolve(process.env.CORPUS) : path.join(ST, 'corpus');
const ANCHORS_SRC = path.join(ST, 'corpus', 'teach_anchors.json');   // layout-universal: same boxes for any corpus
const CFG = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
const STRESS_DB = path.join(ST, 'stress.db'), TEACH_DB = path.join(ST, 'teach.db');
const learning = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const docTypes = require(path.join(REPO, 'database', 'modules', 'document_types.js'));
const templates = require(path.join(REPO, 'database', 'modules', 'templates.js'));
let labelOverrides = null; try { labelOverrides = require(path.join(REPO, 'database', 'modules', 'label_overrides.js')); } catch {}
const SCORED = { invoice: { ref: 'invoice_number', date: 'invoice_date' }, sales_order: { ref: 'sales_order_number', date: 'order_date' }, purchase_order: { ref: 'po_number', date: 'po_date' } };
const normMoney = s => { const v = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return isNaN(v) ? null : v.toFixed(2); };
const normRef = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const normSupplier = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const moneyStr = v => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const w = (tag, d) => { const f = path.join(os.tmpdir(), `tp_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; };

// 1) copy the learned DB (checkpoint WAL first so the copy is complete), then inject anchors.
function prepareDb() {
  const src = new Database(STRESS_DB); src.pragma('wal_checkpoint(TRUNCATE)'); src.close();
  for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(TEACH_DB + ext); } catch {} }
  fs.copyFileSync(STRESS_DB, TEACH_DB);
  const db = new Database(TEACH_DB);
  const anchors = JSON.parse(fs.readFileSync(ANCHORS_SRC, 'utf8'));
  db.prepare('DELETE FROM field_anchors').run();   // start clean (idempotent re-runs)
  const ins = db.prepare(`INSERT INTO field_anchors
    (supplier_name, document_type, field_key, anchor_label, direction, page_zone,
     x_norm, y_norm, w_norm, h_norm, usage_count, confidence, last_authoritative_at)
    VALUES (@supplier_name,@document_type,@field_key,@anchor_label,@direction,'top',
     @x_norm,@y_norm,@w_norm,@h_norm,@usage_count,@confidence,'2026-07-05 12:00:00')`);
  const tx = db.transaction(rows => rows.forEach(r => ins.run(r)));
  tx(anchors);
  return { db, nAnchors: anchors.length };
}

function snap(db) {
  const dts = docTypes.getAllWithFields(db);
  let fmt = []; try { fmt = learning.getFieldFormats(db); } catch {}
  let lo = []; try { lo = labelOverrides ? labelOverrides.getForExtraction(db) : []; } catch {}
  let fr = []; try { fr = learning.getFieldRules(db); } catch {}
  const args = ['--fields-file', w('f', dts.flatMap(d => d.fields)), '--hints-file', w('h', learning.getHints(db)),
    '--anchors-file', w('a', learning.getAllAnchors(db)), '--logos-file', w('l', learning.getAllLogos(db)),
    '--doc-types-file', w('d', dts), '--formats-file', w('fm', fmt), '--templates-file', w('t', templates.getAll(db)),
    '--label-overrides-file', w('lo', lo), '--field-rules-file', w('fr', fr), '--config-file', CFG,
    '--registration', '--born-digital', '--multiline'];
  return { args };
}
function runP(s, files) {
  const N = 8; const shards = Array.from({ length: N }, () => []); files.forEach((f, i) => shards[i % N].push(f));
  const sf = shards.filter(x => x.length).map(names => w('shard', names));
  const one = (shardFile) => new Promise(res => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', CORPUS, '--files-file', shardFile, '--mode', 'fast', '--tesseract', TESS, ...s.args], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', () => {}); p.on('close', () => res(out)); p.on('error', () => res(''));
  });
  return Promise.all(sf.map(one)).then(outs => {
    const docs = {}; for (const o of outs) for (const ln of o.split('\n')) { const t = ln.trim(); if (t[0] !== '{') continue; let m; try { m = JSON.parse(t); } catch { continue; } if (m.type === 'file_done') docs[m.original_filename] = m; }
    return docs;
  });
}
const ef = (m, k) => { const e = m.extractions && m.extractions[k]; return e && typeof e === 'object' ? e.value : (m[k] != null ? m[k] : null); };
const STAGE = (mth) => /^template_mapping/.test(mth) ? '0.5 mapping'
  : mth === 'keyword' ? '1 keyword' : mth === 'keyword_override' ? '1 admin-label'
  : (/^anchor/.test(mth) || mth === 'logo') ? '2 anchor' : mth === 'hint' ? 'hint' : mth;

(async () => {
  const { db, nAnchors } = prepareDb();
  console.log(`injected ${nAnchors} authoritative ref/date anchors into teach.db`);
  let truth = JSON.parse(fs.readFileSync(path.join(CORPUS, 'ground_truth.json'), 'utf8'));
  const LIMIT = parseInt(process.env.LIMIT || '0', 10);
  if (LIMIT > 0) truth = truth.filter((_, i) => i < LIMIT || (i >= 200 && i < 200 + LIMIT));  // some text + some scanned
  const res = await runP(snap(db), truth.map(t => t.filename));

  // per-stage attribution restricted to the taught fields (ref, date) so we isolate the crop path.
  const methodStats = {};
  const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '-';
  for (const t of truth) {
    const m = res[t.filename]; if (!m) continue;
    const fk = { ref: SCORED[t.type_slug].ref, date: SCORED[t.type_slug].date };
    const ok = {
      ref: normRef(ef(m, fk.ref)) === normRef(t.ref),
      date: String(ef(m, fk.date) || '').trim() === t.date,
    };
    for (const f of ['ref', 'date']) {
      const ex = m.extractions && m.extractions[fk[f]];
      const mth = ex && ex.method ? ex.method : (ex ? '(no-method)' : '(no-extraction)');
      const M = methodStats[mth] || (methodStats[mth] = { n: 0, ok: 0, tn: 0, tok: 0, sn: 0, sok: 0 });
      M.n++; if (ok[f]) M.ok++;
      if (t.variant === 'text') { M.tn++; if (ok[f]) M.tok++; } else { M.sn++; if (ok[f]) M.sok++; }
    }
  }
  const out = [];
  out.push('# Taught-anchor pass — Stage-2 crop precision on ref + date (authoritative anchors injected)\n');
  out.push('| Method (stage) | wins | correct | precision | wrong | text prec | scanned prec |');
  out.push('|---|---|---|---|---|---|---|');
  for (const [mth, M] of Object.entries(methodStats).sort((a, b) => b[1].n - a[1].n))
    out.push(`| \`${mth}\` (${STAGE(mth)}) | ${M.n} | ${M.ok} | ${pct(M.ok, M.n)} | ${M.n - M.ok} | ${pct(M.tok, M.tn)} | ${pct(M.sok, M.sn)} |`);
  const anchorWins = Object.entries(methodStats).filter(([mth]) => /^anchor/.test(mth)).reduce((s, [, M]) => s + M.n, 0);
  out.push(`\n**anchor_crop path fired on ${anchorWins} of ${truth.length * 2} ref/date reads.** ` +
    (anchorWins === 0 ? '⚠ anchors did NOT fire — check the document_type match / supplier resolution.' : 'Precision above is the taught-crop stage measured in isolation.'));
  // GATE=1: fail if the taught-anchor stage drops below its precision floor.
  let gateBreach = 0;
  if (process.env.GATE === '1') {
    const MIN_WINS = 20, MAX_WRONG = 5;
    out.push('\n## Taught-anchor precision GATE');
    let totalWrong = 0;
    for (const [m, M] of Object.entries(methodStats)) {
      if (!m.startsWith('(')) totalWrong += M.n - M.ok;
      if (m.startsWith('(') || M.n < MIN_WINS) continue;
      const prec = M.ok / M.n, floor = /^anchor/.test(m) ? 0.99 : 0.95, pass = prec >= floor;
      if (!pass) gateBreach++;
      out.push(`- ${pass ? 'PASS' : 'FAIL'} \`${m}\` ${(prec * 100).toFixed(1)}% vs floor ${(floor * 100).toFixed(1)}%  [${M.n} wins]`);
    }
    if (totalWrong > MAX_WRONG) { gateBreach++; out.push(`- FAIL total wrong ${totalWrong} > ${MAX_WRONG}`); }
    else out.push(`- PASS total wrong ${totalWrong} <= ${MAX_WRONG}`);
    out.push(gateBreach ? `\n**GATE FAILED (${gateBreach}).**` : `\n**GATE PASSED — taught-anchor stage within its floor.**`);
  }
  const txt = out.join('\n');
  fs.writeFileSync(path.join(ST, 'out', 'teach_breakdown.md'), txt);
  console.log('\n' + txt);
  db.close();
  if (process.env.GATE === '1' && gateBreach) process.exit(1);
})();
