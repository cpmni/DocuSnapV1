'use strict';
/*
 * test_slip_e2e.js — Oracle C1: the "dead guard greens every test" pin for Filing Slips.
 *
 * With slips ON and ZERO taught templates, the handler must spawn a REAL, working
 * segment_docs.py invocation. This test drives the actual chain: the handler's argv
 * builder (buildSegmentArgs) → a real `py -3.12 segment_docs.py` spawn on a real
 * segno-built slip fixture → buildSplitPlan → a real pdf_splitter.py spawn — and
 * asserts the sheet page was excluded from the outputs. If the arg construction ever
 * regresses to passing a null --templates-file (spawn throws → runPyJson resolves null
 * → detection silently dead), this test goes red while the unit tests stay green.
 *
 * Run: node src/modules/processing/test_slip_e2e.js   (needs py -3.12 + segno + zxing-cpp)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { buildSegmentArgs, buildSplitPlan } = require('./split_plan');

const REPO = path.resolve(__dirname, '..', '..', '..');
const PB = path.join(REPO, 'python_backend');
const PY = ['-3.12'];

let fails = 0;
const check = (label, cond, extra) => {
  console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${String(extra).slice(0, 200)}]` : ''}`);
  if (!cond) fails++;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slip_e2e_'));
const fixture = path.join(tmp, 'batch.pdf');

// 1. Build the fixture: content · slip #7 · content (real segno QR, PIL multi-page PDF).
let r = spawnSync('py', [...PY, path.join(PB, 'tests', 'slip_fixtures.py'), '--out', fixture, '--layout', 'c,s7,c'],
  { encoding: 'utf8', timeout: 120000 });
check('fixture built', r.status === 0 && fs.existsSync(fixture), r.stderr);

// 2. The REAL argv path: slips ON, zero templates (the day-one install shape).
const argv = buildSegmentArgs({ filePath: fixture, templatesFile: null, tesseract: null, slips: true });
check('argv: --slips present, no --templates-file, no null entries',
  argv.includes('--slips') && !argv.includes('--templates-file') && argv.every(x => typeof x === 'string'),
  JSON.stringify(argv));

// 3. Real segment_docs.py invocation with exactly that argv.
r = spawnSync('py', [...PY, path.join(PB, 'segment_docs.py'), ...argv], { encoding: 'utf8', timeout: 180000 });
let det = null;
try { det = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
check('segment_docs.py --slips decoded the sheet (real invocation, real decode)',
  !!det && det.success === true && JSON.stringify(det.separator_pages) === '[1]'
  && JSON.stringify(det.segments) === '[[0,0],[2,2]]',
  det ? JSON.stringify(det) : `${r.stderr} :: ${r.stdout}`.slice(0, 300));

// 4. Plan + real pdf_splitter run — the sheet page must be EXCLUDED from the outputs.
const plan = buildSplitPlan(det || {});
check('plan: split, minFiles=1, ranges exclude page 2', plan.action === 'split' && plan.minFiles === 1 && plan.ranges === '1,3');
r = spawnSync('py', [...PY, path.join(PB, 'pdf_splitter.py'), '--file', fixture, '--ranges', plan.ranges, '--outdir', tmp],
  { encoding: 'utf8', timeout: 120000 });
let split = null;
try { split = JSON.parse(r.stdout.trim().split('\n').pop()); } catch {}
const made = split && split.success && Array.isArray(split.files) ? split.files.filter(f => fs.existsSync(f)) : [];
check('splitter produced 2 one-page docs (sheet removed)', made.length === 2, JSON.stringify(split));
check('splitter outputs meet the plan gate (made.length >= minFiles)', made.length >= plan.minFiles);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\n${fails ? 'FAIL' : 'PASS'} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
