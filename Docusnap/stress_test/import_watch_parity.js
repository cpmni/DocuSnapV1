'use strict';
/*
 * import_watch_parity.js — the watch/import UNIFICATION parity gate (2026-09-02; Oracle SIGN-OFF-W/COND).
 *
 * THE ARC: field detection must be identical regardless of arrival path (manual import vs watch folder).
 * Oracle's load-bearing fact: what a worker READS is fully determined by its {scriptArgs, env}
 * (ExtractionEngine.extract() resets every per-run ledger per file). So proving the two paths ship the
 * SAME command proves reading parity — no OCR run needed for Layer A.
 *
 * This file pins the LOCALLY-RUNNABLE conditions of Oracle §5:
 *   Layer A (LOAD-BEARING) — buildWorkerCommand(manual) vs (watch): scriptArgs equal EXCEPT --folder;
 *     env equal EXACTLY given equal inputs. Plus a NEGATIVE CONTROL: a seeded env divergence MUST make
 *     Layer A fail (a green that can't reproduce drift is worse than none).
 *   Seam #4 (BLOCKING) — --deskew-pages is ARRIVAL-SCOPED and OFF for watch: buildWorkerCommand(watch)
 *     .scriptArgs never contains --deskew-pages for ANY deskew_on_import value; manual DOES when set.
 *
 * NOT here (owner-machine, need the real corpus / a live OCR run — logged in the handover):
 *   Layer B — behavioural row-equality with OMP_THREAD_LIMIT=1 pinned (the file_done contract tuple).
 *   Split-hold arm — watch HOLDS a fresh split segment while manual auto-files (intentional divergence).
 *   Realdoc M=0 on the WATCH path at concurrency==1 — the tripwire for the OMP conc==1 convergence,
 *     which is its OWN deferred commit (today each caller still passes its own threadCap; the builder
 *     is parity-correct GIVEN equal threadCap, which Layer A proves).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron stress_test/import_watch_parity.js
 */
const Database = require('better-sqlite3');
const { runMigrations } = require('../database/index');
const learning = require('../database/modules/learning');
const H = require('../src/modules/processing/handler');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const eqArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
// Deep key/value equality over env dicts, ignoring key order.
const eqEnv = (a, b) => {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  return eqArr(ka, kb) && ka.every(k => a[k] === b[k]);
};
// Drop the value that FOLLOWS --folder so scriptArgs can be compared "except the folder path".
const stripFolder = (args) => {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--folder') { out.push('--folder', '<FOLDER>'); i++; continue; }
    out.push(args[i]);
  }
  return out;
};

const db = new Database(':memory:');
runMigrations(db);

const trainingArgs = ['--templates-file', 'C:/tmp/templates.json', '--hints-file', 'C:/tmp/hints.json'];
const baseOpts = { tesseract: 'C:/tess/tesseract.exe', mode: 'smart', threadCap: 0, trainingArgs };
const manual = (extra = {}) => H.buildWorkerCommand(db, { ...baseOpts, pyFolder: 'C:/Import',    filesFile: null, arrival: 'manual', ...extra });
const watch  = (extra = {}) => H.buildWorkerCommand(db, { ...baseOpts, pyFolder: 'C:/WatchTmp', filesFile: null, arrival: 'watch',  ...extra });

console.log('§A Layer A — command parity given equal inputs (default settings)');
{
  const m = manual(), w = watch();
  check('scriptArgs equal EXCEPT --folder', eqArr(stripFolder(m.scriptArgs), stripFolder(w.scriptArgs)));
  check('env equal EXACTLY', eqEnv(m.env, w.env));
  check('the ONLY scriptArgs difference is the folder value',
        m.scriptArgs.filter((x, i) => x !== w.scriptArgs[i]).length === 1
        && m.scriptArgs[m.scriptArgs.indexOf('--folder') + 1] === 'C:/Import'
        && w.scriptArgs[w.scriptArgs.indexOf('--folder') + 1] === 'C:/WatchTmp');
}

console.log('\n§A2 Layer A carries the OMP cap identically when both callers pass it (given equal threadCap)');
{
  const m = manual({ threadCap: 3 }), w = watch({ threadCap: 3 });
  check('both set OMP_THREAD_LIMIT=3', m.env.OMP_THREAD_LIMIT === '3' && w.env.OMP_THREAD_LIMIT === '3');
  check('env still equal EXACTLY at threadCap=3', eqEnv(m.env, w.env));
  const m0 = manual({ threadCap: 0 });
  check('threadCap=0 leaves OMP UNSET (uncapped single-worker path)', !('OMP_THREAD_LIMIT' in m0.env));
}

console.log('\n§B NEGATIVE CONTROL — a real env divergence MUST break Layer A (proves the gate can see drift)');
{
  // A fresh migrated DB is treated as a NEW INSTALL, so most reading switches seed ON. To make a
  // GUARANTEED env delta (a green that can't reproduce drift is worse than none — Oracle §5), take a
  // key that IS present and turn it OFF on the rebuild only. Self-guard that it starts present.
  const KEY = 'raw_crop_witness_flag', ENV = 'RAW_CROP_WITNESS_FLAG';
  const m = manual();
  check(`precondition: ${ENV} present on fresh DB (else this control is vacuous)`, ENV in m.env);
  learning.setSetting(db, KEY, 'false');   // → _reconcileEnv drops RAW_CROP_WITNESS_FLAG on the rebuild only
  const wDrift = watch();
  check('seeded env divergence is DETECTED (env no longer equal)', !eqEnv(m.env, wDrift.env));
  check(`the divergence is exactly ${ENV} disappearing`, !(ENV in wDrift.env) && m.env[ENV] === '1');
  learning.setSetting(db, KEY, 'true');   // restore
  check('restored: env equal again', eqEnv(manual().env, watch().env));
}

console.log('\n§C Seam #4 (BLOCKING) — --deskew-pages is arrival-scoped and OFF for watch');
{
  // deskew OFF (default): neither emits it.
  check('deskew OFF: manual has no --deskew-pages', !manual().scriptArgs.includes('--deskew-pages'));
  check('deskew OFF: watch has no --deskew-pages',  !watch().scriptArgs.includes('--deskew-pages'));
  for (const floor of ['0.2', '0.5', '3', '0.05', '9']) {
    learning.setSetting(db, 'deskew_on_import', 'true');
    learning.setSetting(db, 'deskew_on_import_min_angle', floor);
    const m = manual(), w = watch();
    check(`deskew ON (floor=${floor}): manual EMITS --deskew-pages`, m.scriptArgs.includes('--deskew-pages'));
    check(`deskew ON (floor=${floor}): watch NEVER emits --deskew-pages (anti-parity by design)`, !w.scriptArgs.includes('--deskew-pages'));
  }
  learning.setSetting(db, 'deskew_on_import', 'false');
  check('deskew restored OFF: manual clean again', !manual().scriptArgs.includes('--deskew-pages'));
}

console.log('\n§D trace/slice-dir contract — --slice-dir only when the caller mkdir\'d it');
{
  check('wantTrace=false: no --trace', !manual({ wantTrace: false }).scriptArgs.includes('--trace'));
  const t = manual({ wantTrace: true, sliceDir: 'C:/slices' });
  check('wantTrace + sliceDir: --trace then --slice-dir', t.scriptArgs.includes('--trace')
        && t.scriptArgs[t.scriptArgs.indexOf('--trace') + 1] === '--slice-dir'
        && t.scriptArgs[t.scriptArgs.indexOf('--slice-dir') + 1] === 'C:/slices');
  const t2 = manual({ wantTrace: true, sliceDir: null });
  check('wantTrace + no sliceDir (mkdir failed): --trace but NO --slice-dir', t2.scriptArgs.includes('--trace') && !t2.scriptArgs.includes('--slice-dir'));
}

console.log(fails ? `\nFAIL — ${fails} check(s) failed` : '\nPASS — all parity checks green');
process.exit(fails ? 1 : 0);
