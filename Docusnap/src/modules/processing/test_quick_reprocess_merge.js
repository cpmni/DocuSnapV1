#!/usr/bin/env node
'use strict';

/**
 * src/modules/processing/test_quick_reprocess_merge.js
 * ----------------------------------------------------
 * Pins the Quick Reprocess IMAGELESS merge guards (2026-09-01; gary → Oracle C1/C4/C6/C7).
 *
 * A Quick (--reextract) run reads text only — it never sees the page pixels. So `mergeReprocessRows`,
 * when told `imageless:true`, must PRESERVE a stored read that a text-only pass cannot reproduce:
 *   • a TAUGHT field key (operator-blessed)            → keep the stored value, abstain SILENTLY;
 *   • an IMAGE-FAMILY read (anchor_crop* / anchor_registration / template_mapping* / ocr_region)
 *     whose fresh text DIFFERS                          → keep the stored value, and CONTEST the doc
 *     (Oracle C1: it is then held out of the run's consent offer + scope auto-accept, so Quick can
 *     never FILE what Full would HOLD).
 * `stats.imagelessKept` counts every keep (drives the C4 prior-overall preserve). A matching fresh
 * value (Y==X) is never a contest. With `imageless` unset the merge is byte-identical to today.
 *
 * The pure merge is the gate for the value/contest/stat behaviour; a source-contract section pins the
 * batch-level wiring the pure function can't reach (the contested set gates every auto-file door; the
 * partition is switch- and deskew-gated; the Full-fallback strips cached text to earn a stamp — C3).
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/modules/processing/test_quick_reprocess_merge.js
 */

const path = require('path');
const fs   = require('fs');
const { _mergeReprocessRows: merge } = require(path.join(__dirname, 'handler.js'));

let fails = 0, n = 0;
function ok(label, cond) { n++; if (cond) { console.log('  ok   ' + label); return; } fails++; console.log('  FAIL ' + label); }
function section(t) { console.log('\n' + t); }

// A stored/fresh extraction row. Defaults are a plain keyword read at 90.
const row = (field_key, display_value, extra = {}) => ({
  field_key, raw_value: display_value, display_value,
  confidence: 90, extraction_method: 'keyword', validation_note: null, corrected_to: null, ...extra,
});

// Run the merge for ONE field: stored `ex`, fresh `fr`, under `opts`. Returns the merged row for that
// field plus the collected contested list, stats, and the emitted trace decision.
function run1(ex, fr, opts = {}) {
  const contestedOut = [];
  const stats = {};
  let decision = null;
  const traced = (field, d) => { if (field === ex.field_key) decision = d; };
  const merged = merge([ex], [fr], null, traced, null, { contestedOut, stats, ...opts });
  const out = merged.find(r => r.field_key === ex.field_key);
  return { out, contested: contestedOut, stats, decision };
}

// ── 1. Switch OFF (imageless unset) — byte-identical to today ──────────────────
section('1. imageless unset → the guard is inert (byte-identical to today):');
{
  const ex = row('invoice_number', 'INV-CROP', { extraction_method: 'anchor_crop_relocated' });
  const fr = row('invoice_number', 'INV-TEXT');   // differing text read
  const r = run1(ex, fr, {});                      // NO imageless flag
  ok('an image-family field is OVERWRITTEN by the fresh text (today\'s behaviour)', r.out.display_value === 'INV-TEXT');
  ok('nothing is contested when the switch is off', r.contested.length === 0);
  ok('imagelessKept stays 0 when the switch is off', !(r.stats.imagelessKept > 0));
  ok('decision is the plain used_new', r.decision === 'used_new');
}

// ── 2. Imageless + image-family + differing text → keep + CONTEST (C1) ─────────
section('2. imageless, image-family read, fresh text DIFFERS → stored value wins + doc CONTESTED (C1):');
for (const m of ['anchor_crop', 'anchor_crop_relocated', 'anchor_registration', 'template_mapping', 'template_mapping_inline', 'ocr_region']) {
  const ex = row('reference_number', 'STORED-' + m, { extraction_method: m, confidence: 88 });
  const fr = row('reference_number', 'TEXTGUESS');
  const r = run1(ex, fr, { imageless: true });
  ok(`[${m}] stored value is KEPT`, r.out.display_value === 'STORED-' + m);
  ok(`[${m}] stored method + confidence preserved`, r.out.extraction_method === m && r.out.confidence === 88);
  ok(`[${m}] the doc is CONTESTED (old+new recorded)`,
     r.contested.length === 1 && r.contested[0].field === 'reference_number'
       && r.contested[0].old === 'STORED-' + m && r.contested[0].new === 'TEXTGUESS');
  ok(`[${m}] imagelessKept counted the keep (drives C4)`, r.stats.imagelessKept === 1);
  ok(`[${m}] trace names it a contested keep`, r.decision === 'kept_imageless_contested');
}

// ── 3. Imageless + TAUGHT key → keep, but abstain SILENTLY (no contest) ────────
section('3. imageless, a TAUGHT field, fresh DIFFERS → keep the stored value, abstain silently (no contest):');
{
  const taughtKeys = new Set(['supplier_name']);
  // Even an image-family taught read must NOT be contested — the operator blessed it.
  const ex = row('supplier_name', 'Acme Ltd', { extraction_method: 'anchor_crop' });
  const fr = row('supplier_name', 'Acme Limited');
  const r = run1(ex, fr, { imageless: true, taughtKeys });
  ok('taught stored value is KEPT', r.out.display_value === 'Acme Ltd');
  ok('a taught keep is NOT contested (silent abstain)', r.contested.length === 0);
  ok('but it still counts toward imagelessKept (C4 overall preserve)', r.stats.imagelessKept === 1);
  ok('trace names it a taught keep', r.decision === 'kept_imageless_taught');
}
{
  // TRADE-OFF PIN (handover): a fresh anchor teach in scope → Quick keeps the stored value AND the
  // keyword fallback did NOT claim the taught field. Model: the field is taught; the fresh (keyword)
  // read differs; the stored value survives and the fresh guess is discarded.
  const taughtKeys = new Set(['po_number']);
  const ex = row('po_number', 'PO-TAUGHT', { extraction_method: 'anchor_inline' });   // any stored method
  const fr = row('po_number', 'PO-KEYWORD', { extraction_method: 'keyword' });
  const r = run1(ex, fr, { imageless: true, taughtKeys });
  ok('trade-off: the taught field keeps its value, the keyword fallback did not claim it', r.out.display_value === 'PO-TAUGHT');
  ok('trade-off: not contested (operator-blessed)', r.contested.length === 0);
}

// ── 4. No FALSE contest — agreeing values, and non-image text reads ────────────
section('4. no false contest (Y==X eligible; a plain text read still wins):');
{
  // Y == X: image-family stored, fresh text MATCHES → not a contest, the doc stays eligible.
  const ex = row('total_amount', '100.00', { extraction_method: 'anchor_crop' });
  const fr = row('total_amount', '100.00');
  const r = run1(ex, fr, { imageless: true });
  ok('image-family + matching fresh value → NOT contested (Y==X → eligible)', r.contested.length === 0);
  ok('image-family + matching value → not held as an imageless keep', !(r.stats.imagelessKept > 0));
}
{
  // A NON-image-family stored read (plain keyword / anchor / anchor_inline / born_digital) is text-
  // derivable, so a differing fresh text legitimately wins and never contests.
  for (const m of ['keyword', 'anchor', 'anchor_inline', 'born_digital', '', undefined]) {
    const ex = row('order_date', '01-01-2026', { extraction_method: m });
    const fr = row('order_date', '02-01-2026');
    const r = run1(ex, fr, { imageless: true });
    ok(`[${String(m)}] non-image stored read is overwritten by the fresh text`, r.out.display_value === '02-01-2026');
    ok(`[${String(m)}] non-image read never contests`, r.contested.length === 0);
  }
}

// ── 5. C4 — multiple keeps accumulate ──────────────────────────────────────────
section('5. imagelessKept accumulates across fields (drives the C4 prior-overall preserve):');
{
  const existing = [
    row('a', 'CROPA', { extraction_method: 'anchor_crop' }),        // image-family, differs → keep+contest
    row('b', 'TAUGHTB', { extraction_method: 'keyword' }),          // taught, differs → keep, no contest
    row('c', 'KWORDC'),                                             // plain, differs → fresh wins
  ];
  const fresh = [ row('a', 'A2'), row('b', 'B2'), row('c', 'C2') ];
  const contestedOut = []; const stats = {};
  merge(existing, fresh, null, null, null, { imageless: true, taughtKeys: new Set(['b']), contestedOut, stats });
  ok('two kept reads (image-family + taught) counted', stats.imagelessKept === 2);
  ok('only the non-taught image-family keep is contested', contestedOut.length === 1 && contestedOut[0].field === 'a');
}

// ── 6. Source contract — the batch-level C1/C3 wiring the pure merge can't reach ─
section('6. source contract — the contested set gates every auto-file door + partition is gated (C1/C3):');
{
  const src = fs.readFileSync(path.join(__dirname, 'handler.js'), 'utf8');
  ok('a run-scoped contested Set exists', /let _reprocessContested = new Set\(\)/.test(src));
  ok('applyReprocessResult adds a contested doc to the set', /_reprocessContested\.add\(docId\)/.test(src));
  ok('the batch-start reset clears the contested set (fresh run)', /_reprocessContested = new Set\(\);\s*\/\/ Quick Reprocess C1/.test(src));
  ok('isAutoFileEligible excludes a contested doc', /_reprocessContested\.has\(doc\.id\)\)\s*return \{ excluded:/.test(src));
  ok('the scope auto-accept loop skips a contested doc', /if \(_reprocessContested\.has\(d\.id\)\) continue;/.test(src));
  ok('the consent-offer builder filters out contested docs', /autoFileEligibleIds\(db, rows\)\.filter\(id => !_reprocessContested\.has\(id\)\)/.test(src));
  // Partition gating (C3): Quick only when asked AND the DARK switch is on AND not a straighten-all.
  ok('the partition is gated on opts.quick + quick_reprocess_enabled + !deskewAll',
     /const quickOn = !!\(opts && opts\.quick\) && !deskewAll[\s\S]{0,120}quick_reprocess_enabled', 'false'\) === 'true'/.test(src));
  ok('a Full-fallback doc inside a Quick batch has its cached text STRIPPED (C3 self-heal)',
     /delete manifest\[tn\]\.ocr_text;\s*\/\/ C3: force one honest re-OCR/.test(src));
  ok('the imageless shard passes --reextract', /if \(reextract\) scriptArgs\.push\('--reextract'\)/.test(src));
  // C6/C7 identity-column guards: logo preserved unconditionally, supplier never blanked imageless.
  ok('C6: logo_phash/logo_detail preserved unconditionally on an imageless run', /_logoPhashP\s*=\s*s\.logo_phash \?\? null/.test(src));
  ok('C7: an imageless run never marks the supplier column blanked', /_imageless \? false : supplierColumnBlanked/.test(src));
  ok('C4: prior overall_confidence is restored when a guard kept a stored read', /_imageless && _mergeStats\.imagelessKept > 0/.test(src));
}

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);
