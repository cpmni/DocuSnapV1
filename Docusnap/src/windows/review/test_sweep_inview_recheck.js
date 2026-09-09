/**
 * test_sweep_inview_recheck.js — PIN for the in-view countdown VIEW-SETTLE RECHECK (sweep_inview_recheck,
 * DARK, mig 150; owner report 2026-09-09 — WS-95132 / #40: the sweep files everything but the in-view doc,
 * which gets no countdown because the sweep's 'sweep-inview-eligible' offer is dropped by the presence race).
 *
 * Wiring pin: the fix REUSES the fully-verified countdown path (sweep-inview-file re-verifies at commit), so
 * this guards the WIRING (read-only recheck IPC + preload + renderer settle-hook) so it can't silently drop.
 *
 * Run:  node src/windows/review/test_sweep_inview_recheck.js
 */
const fs = require('fs'), path = require('path');
let P = 0, F = 0;
const check = (name, ok) => { if (ok) { P++; console.log('  ok  ' + name); } else { F++; console.log('  FAIL ' + name); } };
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');

const handler  = read('..', '..', 'modules', 'processing', 'handler.js');
const preload  = read('..', '..', 'preload.js');
const renderer = read('renderer.js');
const idx      = read('..', '..', '..', 'database', 'index.js');
const dark     = read('..', '..', '..', 'database', 'dark_switches.js');

console.log('1. IPC sweep-inview-recheck — read-only, double-gated, same predicate as sweep-inview-file');
const i = handler.indexOf("ipcMain.handle('sweep-inview-recheck'");
const ipc = i >= 0 ? handler.slice(i, i + 1600) : '';
check('IPC is registered', i >= 0);
check('requires admin/edit', /requireRole\('admin', 'edit'\)/.test(ipc));
check('gated on BOTH sweep_inview_countdown AND sweep_inview_recheck',
  /getSetting\(db, 'sweep_inview_countdown', 'false'\) !== 'true'/.test(ipc)
  && /getSetting\(db, 'sweep_inview_recheck', 'false'\) !== 'true'/.test(ipc));
check('only for a needs_review doc', /doc\.status !== 'needs_review'/.test(ipc));
check('requires the SOLE LOCAL desktop viewer (onlyViewerIs desktop:uid)', /onlyViewerIs\(id, `desktop:\$\{u\.id\}`\)/.test(ipc));
check('requires isAutoFileEligible', /trust\.isAutoFileEligible\(db, doc\)/.test(ipc));
check('READ-ONLY — never files here (no reviewService.confirm / recordReviewEvent in the handler)',
  !/reviewService\.confirm/.test(ipc) && !/recordReviewEvent/.test(ipc));
check('returns {offer:true, fingerprint} on success', /offer: true, docId: id, fingerprint: extractionsFingerprint\(rows\)/.test(ipc));

console.log('\n2. preload bridge');
check('preload exposes sweepInviewRecheck(docId) -> sweep-inview-recheck',
  /sweepInviewRecheck:\s*\(docId\)\s*=>\s*ipcRenderer\.invoke\('sweep-inview-recheck', \{ docId \}\)/.test(preload));

console.log('\n3. renderer — settle hook + reuse of the existing countdown starter');
check('_maybeRecheckInview is defined', /async function _maybeRecheckInview\(docId\)/.test(renderer));
check('selectDoc calls it after the doc settles (fieldsOnly-guarded, fire-and-forget)',
  /if \(!fieldsOnly\) _maybeRecheckInview\(doc\.id\);/.test(renderer));
check('it calls the bridge and starts the EXISTING countdown on offer',
  /window\.docusnap\.sweepInviewRecheck\?\.\(docId\)/.test(renderer)
  && /_startInviewCountdown\(\{ docId, fingerprint: r\.fingerprint \}\)/.test(renderer));
check('doc-guarded (skips if the view moved on, or already counting this doc)',
  /if \(!currentDoc \|\| currentDoc\.id !== docId\) return;/.test(renderer)
  && /if \(_inviewCd && _inviewCd\.docId === docId\) return;/.test(renderer));

console.log('\n4. DARK seed OFF + TEST_SWITCH_KEYS');
check("migration 150 seeds sweep_inview_recheck = 'false' (DARK)",
  /VALUES \('sweep_inview_recheck', 'false'\)/.test(idx) && /VALUES \(150\)/.test(idx));
check('dark_switches.js lists the key in TEST_SWITCH_KEYS', /'sweep_inview_recheck'/.test(dark));

console.log('\n' + (F === 0 ? 'ALL PASS' : F + ' FAILED') + `  (${P} ok)`);
process.exit(F ? 1 : 0);
