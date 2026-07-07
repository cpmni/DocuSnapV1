#!/usr/bin/env node
'use strict';

/**
 * stress_test/import_load_harness.js
 * ----------------------------------
 * IMPORT-SIDE load & robustness harness. Hammers the REAL Python backend under
 * PARALLELISM (sharded across N workers, mirroring the manual/watch worker pool)
 * over a large MIXED batch = a big slice of the valid corpus + deliberately
 * PATHOLOGICAL files (zero-byte, garbage bytes, truncated PDF, plain text renamed
 * .pdf, odd/Unicode names, uppercase extension).
 *
 * THE INVARIANT: no input file is ever lost on import. Every file must be accounted
 * for by EXACTLY ONE file_done — a valid file as success, a corrupt file as an
 * ISOLATED status:error — and one bad file must NEVER crash a worker and silently
 * drop the rest of its shard (that would be lost documents).
 *
 * Fully sandboxed: a temp import folder + a fresh in-memory DB snapshot (no live DB).
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron stress_test/import_load_harness.js
 *   (spawns `py -3.12`; needs Tesseract for the scanned variants.)
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const REPO   = path.join(__dirname, '..');
const CORPUS = path.join(__dirname, 'corpus');
const CFG    = path.join(REPO, 'config', 'keyword_patterns.json');
const PROCESS_DOCS = path.join(REPO, 'python_backend', 'process_docs.py');
const TESS   = 'C:/Program Files/Tesseract-OCR/tesseract.exe';

const learning  = require(path.join(REPO, 'database', 'modules', 'learning.js'));
const docTypes  = require(path.join(REPO, 'database', 'modules', 'document_types.js'));
const { runMigrations } = require(path.join(REPO, 'database', 'index.js'));

let fail = 0;
const check = (l, c, extra) => { console.log(`  ${c ? 'OK ' : 'BAD'} ${l}${extra ? '  ' + extra : ''}`); if (!c) fail++; };
const tmp = (tag, data) => { const f = path.join(os.tmpdir(), `il_${tag}_${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(data)); return f; };

function baselineArgs() {
  const db = new Database(':memory:'); runMigrations(db); docTypes.seedBuiltInTypes(db);
  const dts = docTypes.getAllWithFields(db);
  const args = ['--fields-file', tmp('f', dts.flatMap(d => d.fields)), '--hints-file', tmp('h', []),
    '--anchors-file', tmp('a', []), '--logos-file', tmp('l', []), '--doc-types-file', tmp('d', dts),
    '--formats-file', tmp('fm', []), '--templates-file', tmp('t', []), '--label-overrides-file', tmp('lo', []),
    '--field-rules-file', tmp('fr', []), '--config-file', CFG, '--born-digital', '--multiline', '--auto-rotate'];
  db.close(); return args;
}

// Build a temp import folder = a slice of valid corpus docs + pathological files.
function buildImportFolder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-import-'));
  const truth = JSON.parse(fs.readFileSync(path.join(CORPUS, 'ground_truth.json'), 'utf8'));
  // ~160 valid docs: interleave text + scanned so both code paths are under load.
  const text = truth.filter(t => t.variant === 'text').slice(0, 80);
  const scan = truth.filter(t => t.variant === 'scanned').slice(0, 80);
  const valid = [];
  for (let i = 0; i < 80; i++) { for (const t of [text[i], scan[i]]) if (t) { fs.copyFileSync(path.join(CORPUS, t.filename), path.join(dir, t.filename)); valid.push(t.filename); } }

  const realPdf = fs.readFileSync(path.join(REPO, 'assets', 'tutorial-samples', 'sample1.pdf'));
  const bad = {};
  const put = (name, buf) => { fs.writeFileSync(path.join(dir, name), buf); bad[name] = true; };
  put('zzz_zero_byte.pdf', Buffer.alloc(0));
  put('zzz_garbage.pdf', Buffer.from(Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256))));
  put('zzz_truncated.pdf', realPdf.subarray(0, Math.floor(realPdf.length / 2)));   // valid header, cut off
  put('zzz_plain_text.pdf', Buffer.from('This is just text, not a PDF at all.\n'.repeat(50)));
  put('zzz_only_header.pdf', Buffer.from('%PDF-1.4\n%\xFF\xFF\n'));
  put('zzz UPPER EXT.PDF', realPdf);                                               // valid, uppercase ext + spaces
  put('zzz_ünîçødé_名前.pdf', realPdf);                                            // valid, Unicode name
  put('zzz_giant_repeat.pdf', Buffer.alloc(2 * 1024 * 1024, 0x41));                // 2MB of 'A' (non-PDF bulk)

  return { dir, valid, bad: Object.keys(bad), all: valid.concat(Object.keys(bad)) };
}

function runSharded(args, dir, filenames, N) {
  const shards = Array.from({ length: N }, () => []);
  filenames.forEach((f, i) => shards[i % N].push(f));
  const shardFiles = shards.filter(s => s.length).map(names => tmp('shard', names));
  const runOne = (shardFile, idx) => new Promise((resolve) => {
    const p = spawn('py', ['-3.12', PROCESS_DOCS, '--folder', dir, '--files-file', shardFile,
      '--mode', 'fast', '--tesseract', TESS, ...args], { windowsHide: true });
    let out = '', errored = false;
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', () => {});
    p.on('error', () => { errored = true; });
    p.on('close', (code) => resolve({ out, code, errored, idx }));
  });
  return Promise.all(shardFiles.map(runOne));
}

(async () => {
  const t0 = Date.now();
  const { dir, valid, bad, all } = buildImportFolder();
  const N = Math.max(2, Math.min(8, os.cpus().length || 4));
  console.log(`Import batch: ${all.length} files (${valid.length} valid + ${bad.length} pathological) across ${N} parallel workers`);
  console.log('Running the real backend (fast, born-digital, auto-rotate)…');

  const results = await runSharded(baselineArgs(), dir, all, N);
  const t = ((Date.now() - t0) / 1000).toFixed(0);

  // Parse every file_done across all shards.
  const done = {}; let logErrors = 0, malformed = 0;
  for (const r of results) {
    for (const ln of r.out.split('\n')) {
      const s = ln.trim(); if (s[0] !== '{') continue;
      let m; try { m = JSON.parse(s); } catch { malformed++; continue; }
      if (m.type === 'file_done') { if (done[m.original_filename]) console.log(`  !! duplicate file_done for ${m.original_filename}`); done[m.original_filename] = m; }
      else if (m.type === 'log' && m.level === 'err') logErrors++;
    }
  }
  const seen = new Set(Object.keys(done));
  console.log(`Workers finished in ${t}s · ${seen.size} file_done · exit codes [${results.map(r => r.code).join(',')}]\n`);

  console.log('VERIFY —');
  // 1. No worker crashed away (each shard must have exited 0 / produced output).
  check('no worker crashed (all shards exit 0)', results.every(r => r.code === 0 && !r.errored), `codes=[${results.map(r => r.code).join(',')}]`);

  // 2. THE INVARIANT: every input file accounted for by exactly one file_done (no loss).
  const missing = all.filter(f => !seen.has(f));
  check('every input file produced a file_done (NO LOST FILES)', missing.length === 0, missing.length ? `missing: ${missing.slice(0, 8).join(', ')}` : `(${seen.size}/${all.length})`);
  check('no phantom file_done for a file we didn\'t submit', [...seen].every(f => all.includes(f)));

  // 3. Valid files succeeded (a real doc/status), corrupt files ISOLATED as error.
  const validOk = valid.filter(f => { const m = done[f]; return m && m.success !== false && m.status !== 'error'; });
  check('all valid files processed successfully', validOk.length === valid.length, `(${validOk.length}/${valid.length})`);
  const badErr = bad.filter(f => { const m = done[f]; return m && (m.success === false || m.status === 'error'); });
  const badOk  = bad.filter(f => { const m = done[f]; return m && m.success !== false && m.status !== 'error'; });
  // A pathological file must be ACCOUNTED FOR — ideally isolated as error; a few (e.g. a
  // valid PDF with an odd name, or bulk bytes pdfium tolerates) may parse fine. The hard
  // rule is no LOSS + no crash; error-isolation is asserted for the clearly-corrupt ones.
  check('every pathological file is accounted for (error OR a clean parse, never lost)', bad.every(f => seen.has(f)), `(err ${badErr.length}, parsed ${badOk.length})`);
  const clearlyCorrupt = ['zzz_zero_byte.pdf', 'zzz_garbage.pdf', 'zzz_plain_text.pdf', 'zzz_only_header.pdf'];
  const corruptIsolated = clearlyCorrupt.filter(f => { const m = done[f]; return m && (m.success === false || m.status === 'error'); });
  check('clearly-corrupt files are ISOLATED as status=error (not a crash, not lost)', corruptIsolated.length === clearlyCorrupt.length, `(${corruptIsolated.length}/${clearlyCorrupt.length}: ${clearlyCorrupt.filter(f=>!corruptIsolated.includes(f)).join(', ')||'all'})`);

  // 4. One bad file didn't poison its shard — each shard's OTHER files still came through
  //    (already implied by "no lost files", but report the per-shard success explicitly).
  check('a corrupt file did not drop the rest of its shard', missing.length === 0);

  console.log(`\n  summary: ${validOk.length} valid ok · ${badErr.length}/${bad.length} pathological isolated-as-error · ${badOk.length} pathological parsed-clean · ${logErrors} err-logs`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  console.log(`\n${fail ? fail + ' FAILED' : '✅ IMPORT LOAD HELD — no files lost, corrupt files isolated, no worker crash.'}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
