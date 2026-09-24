'use strict';
/*
 * test_reprocess_quick_rescore.js — PINs for the QUICK RESCORE (2026-09-24; owner sandbox exhibit:
 * 17 Nordwind quotes stuck at a false "31%" after a Quick reprocess although every field read 90-96).
 * gary vet → Oracle RE-RULE of Plan-B condition C4 (SIGN-OFF-W/COND C1-C6, docs/oracle_log.md 2026-09-24).
 *
 * The helpers are PURE (exported as H._quickRescoreMerged / H._quickRescoreStore); the call site sits INSIDE
 * the C4 `if (_imageless && _mergeStats.imagelessKept > 0)` block and is pinned by source below.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 <electron> src/modules/processing/test_reprocess_quick_rescore.js
 */
const path = require('path');
const fs = require('fs');
const H = require(path.join(__dirname, 'handler.js'));
const rescore = H._quickRescoreMerged;
const decide  = H._quickRescoreStore;
const merge   = H._mergeReprocessRows;

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const DEFS = [
  { key: 'supplier_name', required: 1 }, { key: 'quote_number', required: 1 },
  { key: 'quote_date', required: 1 }, { key: 'total_amount', required: 0 },
];
const row = (field_key, display_value, confidence, over) => Object.assign(
  { field_key, display_value, raw_value: display_value, confidence, extraction_method: 'keyword', validation_note: null, corrected_to: null }, over || {});
const EXHIBIT = [row('supplier_name', 'Nordwind Refrigeration Ltd', 90, { extraction_method: 'letterhead_prefill+issuer_sibling_fill' }),
                 row('quote_number', 'NRQ-4484', 95, { extraction_method: 'keyword_override' }),
                 row('quote_date', '27-04-2026', 96), row('total_amount', '1,876.80', 95, { extraction_method: 'keyword_override' })];

console.log('1. the exhibit: required 90/95/96 -> floor(281/3) = 93; the optional total does not score');
{
  const r = rescore(EXHIBIT, DEFS, {});
  check('score 93 (Python int(), not Math.round -> 94)', r && r.score === 93);
  check('scored keys = the three required', r && r.keys.join() === 'supplier_name,quote_number,quote_date');
  const d = decide({ prior: 31, rescore: r, contested: false, taughtKeptKeys: [] });
  check('prior 31 -> stored 93, reason raised', d.stored === 93 && d.reason === 'raised');
}

console.log('2. never below the prior (C4 purpose kept)');
{
  const r = rescore([row('supplier_name', 'A', 80), row('quote_number', 'B', 80), row('quote_date', 'C', 80)], DEFS, {});
  const d = decide({ prior: 96, rescore: r, contested: false, taughtKeptKeys: [] });
  check('rescored 80 vs prior 96 -> 96 kept', r.score === 80 && d.stored === 96 && d.reason === 'kept');
}

console.log('3. an unread required key scores 0');
{
  const r = rescore([row('supplier_name', 'A', 90), row('quote_date', 'C', 90)], DEFS, {});
  check('missing quote_number -> floor(180/3) = 60', r.score === 60);
  const r2 = rescore([row('supplier_name', 'A', 90), row('quote_number', '   ', 99), row('quote_date', 'C', 90)], DEFS, {});
  check('Oracle C3: a whitespace value is EMPTY -> 60 too', r2.score === 60);
  const r3 = rescore([row('supplier_name', 'A', 90), row('quote_number', 'B', null), row('quote_date', 'C', 90)], DEFS, {});
  check('a NULL confidence on a valued row counts 0 (never NaN)', r3.score === 60);
}

console.log('4. hidden keys: skipped when empty, counted when valued, NEVER for a protected key');
{
  const defs = DEFS.concat([{ key: 'account_no', required: 1 }]);
  const rows = [row('supplier_name', 'A', 90), row('quote_number', 'B', 90), row('quote_date', 'C', 90)];
  const skipped = rescore(rows, defs, { hiddenKeys: new Set(['account_no']) });
  check('empty hidden required key skipped -> 90', skipped.score === 90);
  const notHidden = rescore(rows, defs, {});
  check('control: not hidden -> counts 0 -> floor(270/4) = 67', notHidden.score === 67);
  const valued = rescore(rows.concat([row('account_no', 'X', 50)]), defs, { hiddenKeys: new Set(['account_no']) });
  check('a VALUED hidden key still counts (engine EMPTY-ONLY exclusion) -> floor(320/4) = 80', valued.score === 80);
  // Oracle C-protect (gary correction 3): a hidden set naming a role/identity key never skips it
  const prot = rescore([row('supplier_name', 'A', 90), row('quote_date', 'C', 90)], DEFS,
                       { hiddenKeys: new Set(['quote_number']), protectedKeys: new Set(['quote_number']) });
  check('PIN: hidden set naming the ref role still scores that empty key 0 -> 60', prot.score === 60);
}

console.log('5. mismatch penalty mirrors validator.py (-12, -18, cap -25); no boost leg');
{
  const noted = (n) => [row('supplier_name', 'A', 100, n > 0 ? { validation_note: 'x' } : {}),
                        row('quote_number', 'B', 100, n > 1 ? { validation_note: 'x' } : {}),
                        row('quote_date', 'C', 100, n > 2 ? { validation_note: 'x' } : {})];
  check('one noted valued row -> 100-12 = 88', rescore(noted(1), DEFS, {}).score === 88);
  check('two -> 100-18 = 82', rescore(noted(2), DEFS, {}).score === 82);
  check('three -> 100-24 = 76 (cap 25 not reached)', rescore(noted(3), DEFS, {}).score === 76);
  check('clean all-100 rows -> 100 (no positive boost ever added)', rescore(noted(0), DEFS, {}).score === 100);
  const fc = require(path.join(__dirname, '..', '..', '..', 'database', 'modules', 'format_consistency'));
  check('the penalty comes from the ONE shared module (Oracle C2)', fc.mismatchDelta(1) === -12 && fc.mismatchDelta(2) === -18 && fc.mismatchDelta(4) === -25 && fc.mismatchDelta(0) === 0);
}

console.log('6. the env kill keeps today\'s value byte-for-byte');
{
  const r = rescore(EXHIBIT, DEFS, {});
  const d = decide({ prior: 31, rescore: r, contested: false, taughtKeptKeys: [], enabled: false });
  check("enabled:false -> stored 31, reason 'kill'", d.stored === 31 && d.reason === 'kill');
  const dn = decide({ prior: null, rescore: r, contested: false, taughtKeptKeys: [], enabled: false });
  check('kill with a NULL prior -> null (today: engine value / null untouched)', dn.stored === null);
}

console.log('7. cap 99: a Quick pass with a kept row never mints the at-100 gate-free road');
{
  const r = rescore([row('supplier_name', 'A', 100), row('quote_number', 'B', 100), row('quote_date', 'C', 100)], DEFS, {});
  const d = decide({ prior: 31, rescore: r, contested: false, taughtKeptKeys: [] });
  check('all-100 rows -> 99', r.score === 100 && d.stored === 99);
  const d100 = decide({ prior: 100, rescore: r, contested: false, taughtKeptKeys: [] });
  check('a prior of 100 is still never lowered (max wins)', d100.stored === 100 && d100.reason === 'kept');
}

console.log('8. no field defs / no keys -> null -> today\'s value');
{
  check('null defs -> null', rescore(EXHIBIT, null, {}) === null);
  check('empty defs -> null', rescore(EXHIBIT, [], {}) === null);
  const d = decide({ prior: 31, rescore: null, contested: false, taughtKeptKeys: [] });
  check("decision keeps the prior, reason 'no-fielddefs'", d.stored === 31 && d.reason === 'no-fielddefs');
}

console.log('9. no required flags -> every defined key scores (validator fallback)');
{
  const defs = [{ key: 'a', required: 0 }, { key: 'b', required: 0 }];
  const r = rescore([row('a', 'x', 80)], defs, {});
  check('a valued 80 + an empty b -> 40', r.score === 40 && r.keys.join() === 'a,b');
}

console.log('10. Oracle C1 — a CONTESTED doc keeps the prior even when the rescore is higher');
{
  const r = rescore(EXHIBIT, DEFS, {});
  const d = decide({ prior: 31, rescore: r, contested: true, taughtKeptKeys: [] });
  check("contested -> 31, reason 'contested'", d.stored === 31 && d.reason === 'contested');
}

console.log('11. Oracle C1 — a TAUGHT key kept on a SCORED key blocks the raise; on a non-scored optional key it does not (PINNED trade-off)');
{
  const r = rescore(EXHIBIT, DEFS, {});
  const blocked = decide({ prior: 31, rescore: r, contested: false, taughtKeptKeys: ['quote_number'] });
  check("taught keep on the required ref -> 31, reason names the key", blocked.stored === 31 && blocked.reason === 'taught-kept:quote_number');
  const allowed = decide({ prior: 31, rescore: r, contested: false, taughtKeptKeys: ['total_amount'] });
  check('taught keep on the OPTIONAL total (not scored) -> raise allowed -> 93', allowed.stored === 93 && allowed.reason === 'raised');
}

console.log('12. idempotent (Plan-B C5): applying the decision to its own output changes nothing');
{
  const r = rescore(EXHIBIT, DEFS, {});
  const d1 = decide({ prior: 31, rescore: r, contested: false, taughtKeptKeys: [] });
  const d2 = decide({ prior: d1.stored, rescore: r, contested: false, taughtKeptKeys: [] });
  check('second pass stores the same 93', d2.stored === 93 && d2.reason === 'kept');
}

console.log('13. the merge records taughtKeptKeys beside imagelessKept (both taught keep sites)');
{
  const ex = [row('quote_number', 'NRQ-1', 95, { extraction_method: 'template_mapping' }),
              row('total_amount', '10.00', 95, { extraction_method: 'template_mapping' })];
  // (b) differing fresh value on a taught key; (a) empty-with-note fresh read on a taught key
  const fresh = [row('quote_number', 'NRQ-7', 60), row('total_amount', null, 0, { validation_note: 'could not be re-read' })];
  const stats = { imagelessKept: 0, taughtKeptKeys: [] };
  const out = merge(ex, fresh, null, null, null, { imageless: true, taughtKeys: new Set(['quote_number', 'total_amount']), contestedOut: [], stats });
  check('both keeps counted', stats.imagelessKept === 2);
  check('both taught keys recorded', stats.taughtKeptKeys.slice().sort().join() === 'quote_number,total_amount');
  check('stored values kept', out.find(r => r.field_key === 'quote_number').display_value === 'NRQ-1');
  // control: the identity-conf leg is NOT a taught keep
  const st2 = { imagelessKept: 0, taughtKeptKeys: [] };
  merge([row('supplier_name', 'Nordwind', 90, { extraction_method: 'letterhead_prefill' })],
        [row('supplier_name', 'Nordwind', 66)], null, null, null, { imageless: true, taughtKeys: new Set(), contestedOut: [], stats: st2 });
  check('identity-conf keep counts in imagelessKept but NOT in taughtKeptKeys', st2.imagelessKept === 1 && st2.taughtKeptKeys.length === 0);
}

console.log('14. SOURCE pins — the rescore sits INSIDE the C4 block; the cap; the kill; the exports');
{
  const src = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8');
  const i0 = src.indexOf('if (_imageless && _mergeStats.imagelessKept > 0) {');
  const iCall = src.indexOf('quickRescoreMerged(mergedRows, _fd,');
  const iUpd = src.indexOf('const _updateDoc = () =>');
  check('C4 block still exists and the rescore call sits inside it (before _updateDoc)', i0 > 0 && iCall > i0 && iCall < iUpd);
  const block = src.slice(i0, iUpd);
  check('the block opens with the prior fetch exactly as before', /SELECT overall_confidence FROM documents WHERE id = \?/.test(block));
  check('the decision reads the env kill QUICK_RESCORE_MERGED', /process\.env\.QUICK_RESCORE_MERGED !== '0'/.test(block));
  check('contested + taughtKeptKeys are both fed to the decision', /contested: _contested\.length > 0/.test(block) && /taughtKeptKeys: _mergeStats\.taughtKeptKeys/.test(block));
  check('cap constant is 99', /const QUICK_RESCORE_CAP = 99;/.test(src));
  check('a FULL run is untouched: the assignment before the block is the engine value', /let _overallToStore = result\.overall_confidence \|\| null;\s*\n\s*if \(_imageless && _mergeStats\.imagelessKept > 0\)/.test(src));
  check('trace event named reprocess_quick_rescore', /event: 'reprocess_quick_rescore'/.test(block));
  check('exports present', typeof H._quickRescoreMerged === 'function' && typeof H._quickRescoreStore === 'function');
  // charsetAcceptService consumes the same constants (Oracle C2) — no literal copy left
  const cas = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'charsetAcceptService.js'), 'utf8');
  check('charsetAcceptService reads the constants from format_consistency.js (no literal 12/6/25 copy)',
        /require\('\.\.\/\.\.\/database\/modules\/format_consistency'\)/.test(cas) && !/_FC_MISMATCH_BASE = 12/.test(cas));
}

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
