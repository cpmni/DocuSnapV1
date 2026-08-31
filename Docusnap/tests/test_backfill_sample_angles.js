/** Pin — the sample-angle backfill predicate (Oracle C2, 2026-08-11) + the reason the script
 *  must exist at all: BOTH existing writers skip non-NULL rows, so a stale 0 is otherwise
 *  permanently unfixable.
 *
 *  ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe tests/test_backfill_sample_angles.js
 */
const path = require('path');
const fs = require('fs');
const { decide } = require(path.join(__dirname, '..', 'scripts', 'backfill-sample-angles.js'));

let fails = 0;
const check = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

// C2 predicate
check('NULL stored -> write detected', JSON.stringify(decide(null, -0.7)) === JSON.stringify({ action: 'write', angle: -0.7 }));
check('stored 0, |det| >= 0.3 -> overwrite', decide(0, -0.7).action === 'overwrite' && decide(0, -0.7).angle === -0.7);
check('stored 0, |det| = 0.3 boundary -> overwrite', decide(0, 0.3).action === 'overwrite');
check('stored 0, |det| < 0.3 -> keep', decide(0, -0.2).action === 'keep');
check('stored 0, det 0 -> keep', decide(0, 0).action === 'keep');
check('non-zero stored, disagrees >= 0.3 -> census-flag NEVER write', decide(1.5, 0.4).action === 'census-flag');
check('non-zero stored, agrees -> keep', decide(1.5, 1.5).action === 'keep');
check('no detection -> skip', decide(0, null).action === 'skip' && decide(0, NaN).action === 'skip');

// The pinned defect: today's writers CANNOT fix a stale non-NULL angle. If either guard is
// ever removed this pin goes stale in the safe direction (the script becomes redundant, not
// wrong) — but the overwrite path must exist SOMEWHERE, and today this script is it.
const tplHandler = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'templates', 'handler.js'), 'utf8');
check('teach-commit writer still guards AND sample_deskew_angle IS NULL (the reason the backfill script exists)',
  /UPDATE templates SET sample_deskew_angle = \? WHERE id = \? AND sample_deskew_angle IS NULL/.test(tplHandler));
const procHandler = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('lazy heal still skips non-NULL rows (t.sample_deskew_angle != null continue)',
  /t\.sample_deskew_angle != null \|\| !t\.sample_document_id\) continue/.test(procHandler));

// Oracle C4: the heal arms on EITHER compose flag (the live install runs compose_scan only —
// before this fix a NULL-angle template was never healed on the owner's real config).
check('C4: heal arming covers teach_angle_compose_scan (env)', /TEACH_ANGLE_COMPOSE_SCAN === '1'/.test(procHandler));
check('C4: heal arming covers teach_angle_compose_scan (setting)',
  /teach_angle_compose_scan', 'false'\) === 'true'/.test(procHandler));

console.log('\n' + (fails ? `${fails} FAILED` : 'ALL PASS'));
process.exit(fails ? 1 : 0);
