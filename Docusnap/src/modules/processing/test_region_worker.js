'use strict';
/*
 * regionWorker.js pool mechanics — dispatch, parallel spread, kill-switch, crash->reject (so the
 * handler cold-falls-back), shutdown. Uses a FAKE worker (echoes a canned response, no Tesseract) so
 * the pool LOGIC is tested deterministically; the warm==cold byte-identical read is pinned separately
 * in python_backend/tests/test_region_worker.py.
 * Run: node src/modules/processing/test_region_worker.js   (no native deps)
 */
const fs = require('fs'), os = require('os'), path = require('path');
const rw = require('./regionWorker');

let fail = 0;
function check(name, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${name}`); if (!cond) fail++; }

const FAKE = [
  'import sys, json',
  'sys.stdout.write(json.dumps({"ready": True}) + "\\n"); sys.stdout.flush()',
  'for line in sys.stdin:',
  '    line = line.strip()',
  '    if not line: continue',
  '    try: req = json.loads(line)',
  '    except Exception: continue',
  '    sys.stdout.write(json.dumps({"id": req.get("id"), "text": "FAKE:" + str(req.get("file")),',
  '                                 "box": None, "words": [], "lines": 1}) + "\\n"); sys.stdout.flush()',
].join('\n');
const CRASH = 'import sys\nsys.exit(1)\n';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rwtest_'));
const fakePath = path.join(dir, 'fake_worker.py'); fs.writeFileSync(fakePath, FAKE);
const crashPath = path.join(dir, 'crash_worker.py'); fs.writeFileSync(crashPath, CRASH);

function cfg(scriptPath, enabled = true, poolSize = 2) {
  rw.configure({
    pythonExe: () => 'py',
    pythonArgs: (script, ...args) => ['-3.12', script, ...args],
    workerScript: scriptPath,
    tesseract: () => '',
    isEnabled: () => enabled,
    poolSize,
  });
}

(async () => {
  cfg(fakePath);
  const r = await rw.run({ imageFile: 'X.png', boxes: true });
  check('run() resolves with the worker response', !!r && r.text === 'FAKE:X.png');

  const rs = await Promise.all([1, 2, 3].map(i => rw.run({ imageFile: 'p' + i + '.png', boxes: false })));
  check('3 parallel runs all resolve to their own request', rs.every((x, i) => x.text === 'FAKE:p' + (i + 1) + '.png'));
  rw.shutdown();

  cfg(fakePath, false);
  let rejected = false;
  try { await rw.run({ imageFile: 'X.png', boxes: false }); } catch { rejected = true; }
  check('disabled pool -> run() rejects (so the handler cold-falls-back)', rejected);
  check('enabled() is false when disabled', rw.enabled() === false);
  rw.shutdown();

  cfg(crashPath, true, 1);
  let crashRejected = false;
  try { await rw.run({ imageFile: 'X.png', boxes: false }); } catch { crashRejected = true; }
  check('a worker that dies -> run() rejects (fail-safe)', crashRejected);
  rw.shutdown();

  console.log(`\n${fail ? 'FAIL' : 'PASS'} — ${fail} failure(s)`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  process.exit(fail ? 1 : 0);
})();
