'use strict';
/*
 * test_deskew_session.js — pins the SESSION "Straighten all" wiring (oscar+eric+Oracle-signed
 * 2026-07-13). Source-inspection pins (the project's wiring-pin style): a future edit can't silently
 * break the load-bearing seams. Run: node src/windows/review/test_deskew_session.js
 *
 * Seams pinned:
 *   C3 (oscar must-fix) — the batch handler must suppress the cached ocr_text AND pass --deskew-pages
 *                         + --deskew-min-angle when deskewAll; else the straighten silently no-ops.
 *   C4               — Reprocess All + Reprocess-this-sender both force the read via runReprocessBatch's
 *                       single reprocessBatch({deskewAll, deskewMinAngle}) call.
 *   C2               — review_deskew_session / review_deskew_min_angle are written ONLY by the session
 *                       apply/off handlers, never by the per-doc toggle or the wizard.
 *   Floor            — the operator angle is clamped max(0.2, min(5.0, …)) on both JS edges.
 */
const fs = require('fs');
const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');

const handler  = read('..', '..', 'modules', 'processing', 'handler.js');
const preload  = read('..', '..', 'preload.js');
const renderer = read('renderer.js');
const html     = read('index.html');

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };
const count = (s, sub) => s.split(sub).length - 1;

console.log('handler.js — batch read floor (C3):');
check('reprocess-batch handler takes opts', handler.includes("ipcMain.handle('reprocess-batch', async (event, docs, opts) =>"));
check('derives deskewAll from opts', handler.includes('const deskewAll = !!(opts && opts.deskewAll)'));
check('derives + clamps deskewMinAngle from opts', handler.includes('const deskewMinAngle = Math.max(0.2, Math.min(5.0, Number(opts && opts.deskewMinAngle) || 0.2))'));
check('C3: manifest SUPPRESSES cached ocr_text when deskewAll (else deskew no-ops)', handler.includes('!enh && !deskewAll && row && row.ocr_text'));
check('C3: batch spawn pushes --deskew-pages AND --deskew-min-angle when deskewAll',
      handler.includes("if (deskewAll) scriptArgs.push('--deskew-pages', '--deskew-min-angle', String(deskewMinAngle))"));
check('get-page-deskew handler takes minAngle', handler.includes("ipcMain.handle('get-page-deskew', async (_e, base64png, minAngle) =>"));
check('display path passes --min-angle (clamped) to region.py', handler.includes("'--min-angle', String(Math.max(0.2, Math.min(5.0, Number(minAngle) || 0.2)))"));

console.log('\npreload.js — IPC signatures (backward-compatible extra arg):');
check('reprocessBatch forwards opts', preload.includes("reprocessBatch:              (docs, opts) => ipcRenderer.invoke('reprocess-batch', docs, opts)"));
check('getPageDeskew forwards minAngle', preload.includes("getPageDeskew:       (b64, minAngle) => ipcRenderer.invoke('get-page-deskew', b64, minAngle)"));

console.log('\nrenderer.js — session drive + reprocess flag (C4) + display threshold:');
check('doc-open makes deskewEnabled FOLLOW the session flag', renderer.includes('deskewEnabled = deskewSessionOn; deskewByPage = {}; deskewPageAngle = 0; updateDeskewBtn();'));
check('C4: Reprocess batch call passes {deskewAll, deskewMinAngle} (covers both reprocess buttons via runReprocessBatch)',
      renderer.includes('{ deskewAll: !!deskewSessionOn, deskewMinAngle }'));
check('display fetch passes a floor to getPageDeskew (session default = deskewMinAngle)',
      renderer.includes('getPageDeskew?.(b64, minAngle)') && renderer.includes('applyDeskewToCurrentPage(minAngle = deskewMinAngle, manual = false)'));
check('the min-angle input read is clamped [0.2, 5.0]', renderer.includes('Math.max(0.2, Math.min(5.0, v))'));
check('session auto-straighten stays silent; only an explicit per-doc request toasts "already straight"',
      renderer.includes("else if (manual) { showToast('This page already looks straight.', 'ok'); updateDeskewBtn(); }"));

console.log('\nrenderer.js — per-doc Straighten button status + hard-floor override:');
check('the button label reflects the ACTUAL applied angle, not just that mode is on',
      renderer.includes('const straightened = deskewEnabled && !wizard.active && !!deskewPageAngle;'));
check('the per-doc button reads at the hard 0.2° floor (works below the session floor)',
      renderer.includes('const DESKEW_HARD_FLOOR = 0.2;') && renderer.includes('applyDeskewToCurrentPage(DESKEW_HARD_FLOOR, true)'));
check('toggleDeskew acts on the SHOWN frame (revert if straightened, else force-straighten)',
      renderer.includes('const shownStraightened = deskewEnabled && !!deskewPageAngle;'));

console.log('\nrenderer.js — C2: only the session apply/off handlers persist the flag:');
check('review_deskew_session is written exactly twice (applyDeskewSession + turnOffDeskewSession)',
      count(renderer, "localStorage.setItem('review_deskew_session'") === 2);
check('one write turns it on', renderer.includes("localStorage.setItem('review_deskew_session', 'true')"));
check('one write turns it off', renderer.includes("localStorage.setItem('review_deskew_session', 'false')"));
check('review_deskew_min_angle is persisted once (in applyDeskewSession)',
      count(renderer, "localStorage.setItem('review_deskew_min_angle'") === 1);
// The per-doc toggle + the wizard must not touch the session flag. Both flip deskewEnabled only.
const toggleBody = (renderer.match(/function toggleDeskew\(\)[\s\S]*?\n}/) || [''])[0];
check('per-doc toggleDeskew() does NOT write the session flag', toggleBody.length > 0 && !toggleBody.includes('review_deskew_session'));

console.log('\nindex.html — the rail button + threshold flyout:');
check('rail button #btn-deskew-all present', html.includes('id="btn-deskew-all"'));
check('flyout #deskew-all-bar present', html.includes('id="deskew-all-bar"'));
check('angle input with the recommended default + range/step',
      html.includes('id="deskew-min-input"') && html.includes('min="0.2" max="5.0" step="0.1" value="1.0"'));
check('Turn on + Turn off buttons present', html.includes('id="btn-deskew-all-apply"') && html.includes('id="btn-deskew-all-off"'));

console.log('\n' + (fails === 0 ? 'ALL PASS' : fails + ' FAILED'));
process.exit(fails ? 1 : 0);
