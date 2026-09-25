'use strict';
/*
 * test_reextract_fast_gate.js — pins the DISPLAY-ONLY shape gate on the fast on-open suggestion road
 * (`reextract-fields-fast` → `_reextractFastCore`; Chris 2026-09-24 card 4, built af048af).
 * Run: node src/modules/processing/test_reextract_fast_gate.js
 *
 * THE HOLE THIS PINS. The fast road spawns the imageless `--reextract` pass to fill EMPTY inputs with a "second
 * look" suggestion. Every road that STORES a row runs Python with the setting→env bridge (`_reconcileEnv`), so the
 * Stage-1 `ref_role_digit_gate` (keyword.py `_post_label_value`) refuses a digit-less value for the type's reference
 * role. The fast road did not, so a catalog label ("Credit No") prefix-hitting the heading "CREDIT NOTE" walked
 * below it and OFFERED the first word of the next line ("Meadowvale" / "nanann") as a credit-note number — a value
 * the committing pipeline refuses (reproduced 2026-09-25: gate unset → 'Meadowvale' @80; gate armed → refused).
 * The JS twin here drops such a suggestion before it reaches the pill. It is a BELT: nothing on this road is stored
 * (`mergeReextractRows` builds suggestions only; the sweep files STORED rows under tier1Only).
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8').replace(/\r\n/g, '\n');   // CRLF on disk (core.autocrlf)

let fails = 0;
const ok = (label, cond) => { console.log((cond ? 'OK  ' : 'BAD ') + label); if (!cond) fails++; };

const start = src.indexOf('async function _reextractFastCore');
ok('the fast on-open road exists as _reextractFastCore', start > -1);
const road = start > -1 ? src.slice(start, src.indexOf('\n  }\n', start) + 5) : '';   // the core is nested one level deep
ok('suggestions are built by mergeReextractRows (a suggestion list, never a store)', /let suggestions = mergeReextractRows\(/.test(road));
ok('the type\'s REF ROLE is resolved from document_types.ref_field_key by slug',
   /SELECT ref_field_key FROM document_types WHERE slug = \?/.test(road));
ok('a suggestion with no letter or digit is dropped', /if \(!\/\[A-Za-z0-9\]\/\.test\(v\)\) return false;/.test(road));
ok('a suggestion for the ref role with no digit is dropped (the ref_role_digit_gate twin)',
   road.includes('if (_refKey && s.field_key === _refKey && !/\\d/.test(v)) return false;'));
ok('the filter is ORDERED after the merge and before the IPC return shape',
   road.indexOf('let suggestions = mergeReextractRows(') < road.indexOf('ref_role_digit_gate twin'));
ok('a gate failure falls back to the unfiltered list (fail-open on a display road, never a throw)',
   /catch \{ \/\* gate failure ⇒ the unfiltered list/.test(road));
ok('the road never writes an extraction row (no INSERT/UPDATE extractions inside _reextractFastCore)',
   road.length > 0 && !/INSERT INTO extractions|UPDATE extractions/.test(road));

// ── Oracle C1/C2 (2026-09-25): the ROOT CAUSE — the fast spawn ran without the setting→env bridge ──
// One composition, shared by the fast road and the Quick shard, keys AND order; the fast spawn carries it
// (behind the A/B kill only), so the two imageless roads cannot drift apart again.
console.log('\n_pipelineSpawnEnv — one env for both imageless roads:');
const helper = src.slice(src.indexOf('function _pipelineSpawnEnv(db)'));
ok('the helper exists and composes the four bridges in the shard\'s order (autoTitle, ocrDpi, anchorCrop, reconcile)',
   /function _pipelineSpawnEnv\(db\) \{\s*return \{\s*\.\.\._autoTitleEnv\(db\),\s*\.\.\._ocrDpiEnv\(db\),\s*\.\.\._anchorCropEnv\(db\),\s*\.\.\._reconcileEnv\(db\),\s*\};\s*\}/.test(helper));
const spawnIdx = road.indexOf('proc = spawn(pythonExe(), pythonArgs(backendScript(), ...scriptArgs)');
ok('the fast spawn is the --cached-ocr-file / --reextract road', /'--reextract',\s*'--cached-ocr-file', cachedFile,/.test(road) && spawnIdx > -1);
const spawnLine = road.slice(spawnIdx, spawnIdx + 320);
ok('the fast spawn env spreads _pipelineSpawnEnv(db) (so _reconcileEnv + _anchorCropEnv + _autoTitleEnv all reach Python)',
   /_pipelineSpawnEnv\(db\)/.test(spawnLine));
ok('... and the old switch-less spawn survives ONLY behind the explicit A/B kill REEXTRACT_FAST_PIPELINE_ENV=0',
   /process\.env\.REEXTRACT_FAST_PIPELINE_ENV === '0' \? _ocrDpiEnv\(db\) : _pipelineSpawnEnv\(db\)/.test(spawnLine)
   && !/env: \{ \.\.\.process\.env, \.\.\._ocrDpiEnv\(db\) \}/.test(spawnLine));
const shardIdx = src.indexOf('function _runReprocessShard({');
const shard = shardIdx > -1 ? src.slice(shardIdx, shardIdx + 6000) : '';
ok('the Quick/batch shard composes its env from the SAME helper (byte-identical switch set)',
   /\.\.\._pipelineSpawnEnv\(db\),/.test(shard) && !/\.\.\._reconcileEnv\(db\),/.test(shard));
ok('the display twin still follows the merge (belt kept after the root-cause fix, Oracle C3)',
   road.indexOf('mergeReextractRows(') < road.indexOf('ref_role_digit_gate twin') && /STAYS as a belt/.test(road));

console.log(fails ? `\n${fails} FAILED` : '\nall green');
process.exit(fails ? 1 : 0);
