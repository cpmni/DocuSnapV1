'use strict';
/*
 * watch_separate_soak.js — the SOAK ANALYZER for the DARK `watch_separate_enabled` flip gate (2026-09-02).
 *
 * WHY A SOAK: the pure fold (test_watch_separation.js) pins the re-import-loop GUARD and the accounting,
 * but the thing that is UNMEASURED on the single-doc corpus (Oracle, commit 29adce2) is EMPIRICAL: does
 * the real separator split real bundled PDFs at the RIGHT boundary, on the UNATTENDED path, without a
 * re-import loop, a lost document, or a wrong-but-clean boundary auto-filing with nobody watching. That
 * can only be answered by running the flag ON over real scans for a while. This tool turns that live soak
 * into a PASS/FAIL by mining the watch log (and, optionally, the watch folder) for the failure modes.
 *
 * It reads NOTHING live — it post-processes `processing.log` after a soak. Zero risk, run anytime.
 *
 * Usage:
 *   node stress_test/watch_separate_soak.js [--log <processing.log>] [--watch-folder <dir>] [--json]
 *     --log           default: %APPDATA%/ScanFinder/processing.log  (falls back to DocuSnap)
 *     --watch-folder  optional: cross-check .sf_separated_originals/ against the split tally
 *     --json          machine-readable summary
 *
 * VERDICT: exits 0 (PASS) only if — over the soak window — there was at least one real separation AND
 *   zero re-import loops AND zero separation errors AND zero orphaned split-originals. Otherwise 1 (FAIL),
 *   or 2 (INCONCLUSIVE — no separations seen yet; keep soaking / feed more bundles).
 * The gate protocol + thresholds live in docs/designs/WATCH_SEPARATE_SOAK_GATE_2026-09-02.md.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; }
const wantJson = process.argv.includes('--json');

function defaultLog() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  for (const app of ['ScanFinder', 'DocuSnap']) {
    const p = path.join(appData, app, 'processing.log');
    if (fs.existsSync(p)) return p;
  }
  return path.join(appData, 'ScanFinder', 'processing.log');
}

const logPath = arg('--log', defaultLog());
const watchFolder = arg('--watch-folder', null);

if (!fs.existsSync(logPath)) {
  console.error(`FAIL — log not found: ${logPath}\n  (point --log at the machine's %APPDATA%/ScanFinder/processing.log after a soak)`);
  process.exit(1);
}

const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/);

// ── Signals ───────────────────────────────────────────────────────────────────────────────────────
// A separation happened (either the watch banner or the pre-pass count).
const RE_SEPARATED   = /\[watch\] separated (\d+) multi-document PDF\(s\) — (\d+) document/;
const RE_SEP_COUNT   = /\[separate\] separated (\d+) multi-document PDF/;
const RE_SEP_FAIL    = /\[watch\] separation failed/;
// A file entered the stable set / was re-tracked (a segment re-appearing here == a re-import loop).
const RE_ACCEPTED    = /\[watch\] file stable for [\d.]+s — accepted for processing: (.+)$/;
const RE_RETRACK     = /\[watch\] file changed after being processed — re-tracking: (.+)$/;
const RE_BATCH       = /\[watch\] processing (\d+) file\(s\)/;
const RE_BATCH_DONE  = /\[watch\] finished batch of (\d+) \(exit=(-?\d+)\)/;
const RE_SKIP_GONE   = /\[watch\] skipped — file no longer present: (.+)$/;

let separations = 0, splitPdfs = 0, segmentsProduced = 0, sepFailures = 0, batches = 0, batchNonZeroExit = 0;
const accepted = new Map();   // basename → times it entered the stable set
const retracked = [];         // names re-tracked after processing
const failures = [];

for (const raw of lines) {
  const line = raw.trim();
  if (!line) continue;
  let m;
  if ((m = RE_SEPARATED.exec(line))) { separations++; splitPdfs += Number(m[1]); }
  else if ((m = RE_SEP_COUNT.exec(line))) { /* pre-pass echo — counted via the banner above */ }
  if (RE_SEP_FAIL.test(line)) { sepFailures++; failures.push(line); }
  if ((m = RE_ACCEPTED.exec(line))) { const n = m[1].trim(); accepted.set(n, (accepted.get(n) || 0) + 1); }
  if ((m = RE_RETRACK.exec(line))) { retracked.push(m[1].trim()); }
  if ((m = RE_BATCH.exec(line))) { batches++; }
  if ((m = RE_BATCH_DONE.exec(line))) { if (Number(m[2]) !== 0) batchNonZeroExit++; }
  if ((m = RE_SKIP_GONE.exec(line))) { /* a benign vanish (moved/renamed) — informational */ }
}

// ── Re-import-loop detection ────────────────────────────────────────────────────────────────────────
// A segment produced by a split must be pre-marked 'processing' so the resumed poll sees it in-flight
// (never a fresh "accepted for processing"). If a name was accepted MORE THAN ONCE, or a processed file
// was re-tracked, that is the loop this gate must not see. (A benign re-scan of an EDITED source is also
// re-tracking, so re-tracked names are flagged for eyeball, not auto-failed unless they recur.)
const acceptedTwice = [...accepted.entries()].filter(([, n]) => n > 1);
const retrackDupes = retracked.filter((n, i) => retracked.indexOf(n) !== i);
const loopSuspects = [...new Set([...acceptedTwice.map(([n]) => n), ...retrackDupes])];

// ── Optional folder cross-check: every split-original should sit in .sf_separated_originals/ ──────────
let orphanOriginals = null, separatedOriginalsCount = null;
if (watchFolder) {
  const sepDir = path.join(watchFolder, '.sf_separated_originals');
  if (fs.existsSync(sepDir)) {
    try {
      const originals = fs.readdirSync(sepDir).filter(f => f.toLowerCase().endsWith('.pdf'));
      separatedOriginalsCount = originals.length;
      // Each moved original implies a split happened; a mismatch vs the log's splitPdfs is worth a look
      // (originals accumulate across soaks, so this is >=, not ==).
      orphanOriginals = Math.max(0, splitPdfs - originals.length);   // more banners than moved files = a move failed
    } catch (e) { console.error(`  (watch-folder cross-check skipped: ${e.message})`); }
  } else {
    separatedOriginalsCount = 0;
  }
}

// ── Verdict ──────────────────────────────────────────────────────────────────────────────────────────
const hard = [];
if (sepFailures > 0) hard.push(`${sepFailures} separation error(s)`);
if (loopSuspects.length) hard.push(`${loopSuspects.length} possible re-import loop(s): ${loopSuspects.slice(0, 8).join(', ')}`);
if (orphanOriginals) hard.push(`${orphanOriginals} split-original(s) not found in .sf_separated_originals/`);
if (batchNonZeroExit > 0) hard.push(`${batchNonZeroExit} batch(es) exited non-zero`);

let verdict, code;
if (separations === 0) { verdict = 'INCONCLUSIVE'; code = 2; }
else if (hard.length)  { verdict = 'FAIL'; code = 1; }
else                   { verdict = 'PASS'; code = 0; }

const summary = {
  verdict, logPath,
  separations, splitPdfs, batches, batchNonZeroExit, sepFailures,
  distinctFilesAccepted: accepted.size, filesAcceptedMoreThanOnce: acceptedTwice.length,
  retrackedCount: retracked.length, loopSuspects, separatedOriginalsCount, orphanOriginals,
  hardFailures: hard,
};

if (wantJson) { console.log(JSON.stringify(summary, null, 2)); process.exit(code); }

console.log(`WATCH_SEPARATE soak — ${logPath}`);
console.log(`  separations (banners) : ${separations}   split PDFs: ${splitPdfs}`);
console.log(`  batches               : ${batches}   non-zero exit: ${batchNonZeroExit}`);
console.log(`  separation errors     : ${sepFailures}`);
console.log(`  files accepted        : ${accepted.size} distinct   (>1×: ${acceptedTwice.length})`);
console.log(`  re-tracked after done : ${retracked.length}   (recurring: ${retrackDupes.length})`);
if (loopSuspects.length) console.log(`  ⚠ loop suspects       : ${loopSuspects.join(', ')}`);
if (watchFolder) console.log(`  .sf_separated_originals: ${separatedOriginalsCount ?? 'n/a'}   orphaned split-originals: ${orphanOriginals ?? 'n/a'}`);
if (failures.length) { console.log('  separation failure lines:'); for (const f of failures.slice(0, 5)) console.log(`    ${f}`); }
console.log(`\n${verdict}${hard.length ? ' — ' + hard.join('; ') : ''}`);
if (verdict === 'INCONCLUSIVE') console.log('  No separations in this log yet — keep soaking, or feed the watch folder a known bundled PDF.');
process.exit(code);
