/** Pin — reprocess Tesseract-threading parity (owner "option 1", 2026-08-11).
 *
 *  Tesseract's LSTM reads boundary glyphs differently under different OpenMP thread counts
 *  (upstream-documented float-accumulation nondeterminism). The owner watched a single
 *  reprocess read 'ACC-2291' while Reprocess-All read 'ACC-229]' on the SAME document:
 *  the single spawn ran UNCAPPED while batch workers ran at cores/shards. Both reprocess
 *  paths now derive ONE cap from the CONFIGURED concurrency (_reprocessThreadCap) — never
 *  the per-run shard count — so every reprocess read shares identical threading.
 *
 *  These pins are source-level (the wiring-pin pattern): each leg that could silently
 *  reopen the disparity must keep its shape.
 *
 *  ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe tests/test_reprocess_threadcap.js
 */
const path = require('path');
const fs = require('fs');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'processing', 'handler.js'), 'utf8');

check('_reprocessThreadCap exists and derives from CONFIGURED concurrency (min 10 clamp)',
  /function _reprocessThreadCap\(db\)[\s\S]{0,600}Math\.min\(10, conc\)/.test(src));
check('formula floors cores/concurrency with a 1 minimum',
  /function _reprocessThreadCap\(db\)[\s\S]{0,700}Math\.max\(1, Math\.floor\(cores \/ conc\)\)/.test(src));
// The per-shard formula may survive ONLY on the first-IMPORT path (the recorded residual —
// import parallelism is its own design); the REPROCESS-BATCH handler must use the shared cap.
const rb = src.slice(src.indexOf("ipcMain.handle('reprocess-batch'"));
check('reprocess-batch uses the shared cap (no per-shard formula in its handler)',
  /const threadCap = _reprocessThreadCap\(db\);/.test(rb)
  && !/Math\.floor\(\(os\.cpus\(\)\.length \|\| 1\) \/ shards\.length\)/.test(rb));
check('the import path is the ONLY surviving per-shard cap (the recorded residual)',
  (src.match(/Math\.floor\(\(os\.cpus\(\)\.length \|\| 1\) \/ shards\.length\)/g) || []).length === 1);
check('single reprocess spawn env carries the SAME cap',
  /OMP_THREAD_LIMIT: String\(_reprocessThreadCap\(db\)\)/.test(src));

console.log('\n' + (fails ? `${fails} FAILED` : 'ALL PASS'));
process.exit(fails ? 1 : 0);
