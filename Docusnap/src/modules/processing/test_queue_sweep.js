'use strict';
/*
 * test_queue_sweep.js — PINs for the queue-wide Tier-1 re-ask
 * (gary design → Oracle SIGN-OFF-W/COND C7–C11, 2026-08-18; DARK behind `scope_sweep_enabled`).
 *
 * WHY IT EXISTS. Proven live: one further confirm made 17 already-correct documents eligible, and
 * only a Reprocess All — three minutes re-reading pages that produced identical answers — made the
 * app notice. Tier 1 is the same question asked for free: `trust.autoFileEligibleIds` over the
 * STORED rows with live trust and live learned formats. No OCR, no re-extract, no new decision.
 *
 * THE RULING THIS MUST NOT BREACH. A prior Oracle ruling removed a queue-wide sweep with "no
 * restore door" after the renderer's autoCommitFullConfidence filed 101 documents across six
 * suppliers as HUMAN confirms, inflating graduation. What was banned is a silent queue-wide COMMIT
 * with human attribution. This is queue-wide EVALUATION with a server-owned offer, machine via,
 * per-doc untick and undo — and the accept may only file what the server offered.
 *
 * Two pins here FAIL against the pre-fix code: the Tier-1-only accept (C7) and the
 * not-offered refusal (C8).
 *
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe src/modules/processing/test_queue_sweep.js
 */
const path = require('path');
const fs   = require('fs');
const REPO = path.resolve(__dirname, '..', '..', '..');
const src  = fs.readFileSync(path.join(REPO, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
const rend = fs.readFileSync(path.join(REPO, 'src', 'windows', 'review', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(REPO, 'src', 'windows', 'review', 'index.html'), 'utf8');
const pre  = fs.readFileSync(path.join(REPO, 'src', 'preload.js'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };

console.log('C7 — the accept can never fall through to the tier that is being HELD');
check('_evaluateSweepDoc returns excluded instead of re-extracting when tier1Only is set',
      /if \(ctx && ctx\.tier1Only\) return \{ excluded: \{ docId: doc\.id, reason: t1\.reason \|\| 'not-eligible' \} \};/.test(src));
check('...and the early return sits BEFORE the Tier-2 re-extract',
      src.indexOf('ctx.tier1Only') < src.indexOf('_reextractFastCore(db, doc.id'));
check('the accept path sets tier1Only (a doc that loses Tier-1 eligibility between offer and '
      + 'accept is DROPPED, never promoted and filed)',
      /const ctx = \{ trainingArgs: null, tempFiles: \[\], tier1Only: true \};/.test(src));

console.log('C8 — the server remembers its own offer; the renderer may narrow it, never widen it');
check('offers are recorded server-side, keyed by scope', /_sweepOffers\.set\(_sweepOfferKey\(/.test(src));
check('the accept refuses a docId that was never offered',
      /if \(!_offered \|\| !_offered\.has\(docId\)\) \{ dropped\.push\(\{ docId, reason: 'not-offered' \}\); continue; \}/.test(src));
check('both offer sites record (per-scope AND queue-wide)',
      (src.match(/_sweepOffers\.set\(/g) || []).length >= 2);

console.log('C9 — the consent trail cannot have an accept with no matching offer');
check('the offer is audited unconditionally, not at a renderer display threshold',
      /if \(candidates\.length\) \{[\s\S]{0,220}scope_sweep_offered/.test(src)
      && !/if \(candidates\.length >= 2\) \{[\s\S]{0,200}scope_sweep_offered/.test(src));

console.log('C10 — one cap, and copy that states its true reach');
check('SWEEP_CAP is defined ONCE and used by the offer and the accept',
      (src.match(/const SWEEP_CAP = 25;/g) || []).length === 1
      && /accepts\.slice\(0, SWEEP_CAP\)/.test(src)
      && /g\.candidates\.length >= SWEEP_CAP/.test(src));
check('the bar no longer claims these match "what you\'ve confirmed" (false for a sender the '
      + 'operator never touched)', !/match what you've confirmed and pass the same checks/.test(rend));
check('...it says what was actually done — and that nothing was re-read',
      /already read cleanly and now pass every check — nothing was re-read/.test(rend));
check('other ready senders are named rather than implied away', /other sender\$\{s\.otherScopes === 1/.test(rend)
      || /s\.otherScopes \? /.test(rend));

console.log('C11 — a dismissal stands, and there is a way back');
check('"Not now" sets the session dismissal (no auto-resurrect — that would be nagware)',
      /_sweepQueueDismissed = true;/.test(rend));
check('the automatic pass honours it', /if \(!manual && _sweepQueueDismissed\) return false;/.test(rend));
check('a manual re-summon exists in the tool rail', /id="btn-sweep-check"/.test(html));
check('...shown only when the feature is enabled (a button that always says "nothing" would lie)',
      /scope_sweep_enabled'\);\s*\n\s*if \(String\(on\) !== 'true'\) return;/.test(rend));
check('the manual pass SAYS SO when the answer is "nothing new" (silence is what sends people '
      + 'back to Reprocess All)', /if \(manual\) showToast\('Checked everything still waiting/.test(rend));

console.log('the queue-wide evaluator itself');
// Slice the handler body precisely: it ends where the shared per-doc evaluator's header begins.
// (An earlier version sliced to the next ipcMain.handle and swallowed _evaluateSweepDoc, which
// legitimately DOES re-extract — the test was wrong, not the code.)
const QW = (() => {
  const i = src.indexOf("ipcMain.handle('sweep-queue-candidates'");
  const j = src.indexOf("  // One doc's sweep evaluation", i);
  return i >= 0 && j > i ? src.slice(i, j) : '';
})();
check('the handler body was located', QW.length > 200);
check('it is READ-ONLY — no INSERT/UPDATE/DELETE in the handler body', !/INSERT |UPDATE |DELETE /.test(QW));
check('it reuses the shipped batch predicate (the same one the default-ON reprocess bar uses)',
      /trust\.autoFileEligibleIds\(db, rows\)/.test(QW));
check('it never spawns — Tier 2 stays request-only', !/_reextractFastCore|buildTrainingArgs/.test(QW));
check('blank-supplier docs are excluded EXPLICITLY, not by luck',
      /TRIM\(COALESCE\(d\.supplier_name, ''\)\) <> ''/.test(src));
check('workflow-locked and open-in-Review docs are excluded',
      /NOT IN \('pending', 'claimed'\)/.test(src) && /!presence\.viewers\(d\.id\)\.length/.test(src));
check('it refuses mid-batch', /if \(_anyProcessingBusy\(\)\) return \{ ok: false, reason: 'busy' \};[\s\S]{0,200}sweep-queue|sweep-queue[\s\S]{0,900}_anyProcessingBusy\(\)/.test(src));
check('it is dark unless scope_sweep_enabled', /sweep-queue-candidates[\s\S]{0,700}scope_sweep_enabled/.test(src));
check('the renderer bridge exists', /sweepQueueCandidates: \(\)/.test(pre));
check('filing still goes through the ONE shared confirm with the machine via',
      /via: 'scope_sweep'/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
