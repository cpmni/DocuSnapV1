'use strict';
/*
 * test_ocr_type_retired.js — `template_field_mappings.ocr_type` is RETIRED from the UI.
 *
 * THE DECISION (owner, 2026-08-08: "wire it or delete it" — deleted). The column was written by
 * THREE admin surfaces with THREE different vocabularies — the Review template wizard, the Settings
 * Template Manager, and the teach wizard's role-aware seeder — and read by ZERO production code.
 * Extraction's `val_type` comes from `engine._seed_field_patterns(base, field_defs)`, keyed on the
 * document TYPE's field definitions, so nothing an admin picked here ever changed a single read.
 * The Settings control even carried the title "Expected value format — affects post-processing",
 * which was simply untrue.
 *
 * WHAT WAS AND WAS NOT REMOVED. The three controls, their renderer plumbing, the Saved-Mappings
 * table column, and the teach seeder are gone. The DB COLUMN REMAINS, `NOT NULL DEFAULT 'text'`:
 * dropping it would be a destructive migration for no benefit, `templates.js` still writes
 * `mapping.ocr_type || 'text'` so the default holds, and several test fixtures create the table
 * with it. This pin therefore asserts the UI is clean, NOT that the column is absent.
 *
 * THE ONE REAL CONSUMER WAS FIXED, NOT ORPHANED. The dev CLI `test_mapping.py` fed `ocr_type` into
 * the real `_seed_field_patterns` to make its preview gate identically to reprocess. Left alone it
 * would have started seeing a constant 'text' and quietly diverged again — the exact preview/
 * extraction gap its own comment says it exists to close. It now takes `field_type`, the field's
 * real declared type, which is strictly more faithful than what it replaced.
 *
 *   node src/windows/test_ocr_type_retired.js
 */
const fs = require('fs');
const path = require('path');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');
// Strip comments before structural assertions — the tombstone comments left behind deliberately
// NAME the thing being removed, so a naive scan finds the very string it is checking has gone.
const nc = (s) => s.replace(/<!--[\s\S]*?-->/g, '').split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

console.log('\nTHE CONTROLS ARE GONE FROM ALL THREE SURFACES');
const reviewHtml   = nc(read('review', 'index.html'));
const settingsHtml = nc(read('settings', 'index.html'));
const reviewJs     = nc(read('review', 'renderer.js'));
const settingsJs   = nc(read('settings', 'renderer.js'));
const teachJs      = nc(read('teach', 'renderer.js'));

check('review: the wiz-ocr-type select is gone from the markup', !reviewHtml.includes('wiz-ocr-type'));
check('review: no renderer code addresses it', !reviewJs.includes('wiz-ocr-type'));
check('settings: the tpl-map-ocr-type select is gone from the markup', !settingsHtml.includes('tpl-map-ocr-type'));
check('settings: no renderer code addresses it', !settingsJs.includes('tpl-map-ocr-type'));
check('teach: the role-aware ocr_type seeder is gone', !/function ocrTypeFor/.test(teachJs)
      && !/OCR_TYPE_BY_FIELD_TYPE\s*=/.test(teachJs));

console.log('\nNO SURFACE STILL SENDS ocr_type ON A SAVE');
for (const [name, src] of [['review', reviewJs], ['settings', settingsJs], ['teach', teachJs]]) {
  check(`${name}: no ocr_type key in any saved mapping payload`, !/\bocr_type\s*:/.test(src));
}

console.log('\nTHE SAVED-MAPPINGS TABLE STILL LINES UP (a stale <th> would shift every column)');
{
  const m = settingsHtml.match(/<table[^>]*id="tpl-mappings-table"[\s\S]*?<thead>([\s\S]*?)<\/thead>/);
  check('the mappings table header is found', !!m);
  const headers = m ? (m[1].match(/<th\b/g) || []).length : -1;
  check('header no longer carries an "OCR type" column', m ? !/OCR type/i.test(m[1]) : false);
  // Anchor on the MAPPINGS row specifically. settings/renderer.js has four `tr.innerHTML`
  // templates (audit, mappings, fixed values, anchors); a lazy regex from the top of the file
  // lands on the audit one and silently compares the wrong table — which is exactly what the
  // first version of this pin did, reporting a mismatch that did not exist. Slice forward from
  // the mappings tbody instead, so the block being counted cannot be another table.
  const from = settingsJs.indexOf("getElementById('tpl-mappings-tbody')");
  const rowMatch = from >= 0 ? settingsJs.slice(from).match(/tr\.innerHTML = `([\s\S]*?)`;/) : null;
  const cells = rowMatch ? (rowMatch[1].match(/<td\b/g) || []).length : -1;
  check(`header columns (${headers}) match row cells (${cells})`, headers > 0 && headers === cells);
}

console.log('\nTHE DEV PREVIEW WAS REPOINTED, NOT ORPHANED');
{
  const tm = fs.readFileSync(path.join(__dirname, '..', '..', 'python_backend', 'test_mapping.py'), 'utf8');
  check("test_mapping.py prefers the field's REAL declared type", /mapping\.get\('field_type'\)/.test(tm));
  check('...still tolerates a legacy ocr_type from an older caller or a raw DB row',
        /mapping\.get\('ocr_type'\)/.test(tm));
  check('...and still feeds the SAME _seed_field_patterns the pipeline uses',
        /_seed_field_patterns\(\{\}, \[\{'key': field_key, 'type': _ftype\}\]\)/.test(tm));
  check('settings sends field_type on the Test payload', /field_type:\s*tplFieldTypeFor\(/.test(settingsJs));
  check('...via a lookup that falls back to text rather than throwing',
        /function tplFieldTypeFor\(key\)[\s\S]{0,400}catch \{ return 'text'; \}/.test(settingsJs));
}

console.log('\nTHE COLUMN ITSELF STAYS — this pin is about the UI, not a destructive migration');
{
  const tpl = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'modules', 'templates.js'), 'utf8');
  check('templates.js still defaults the column so the NOT NULL constraint holds',
        /ocr_type:\s*mapping\.ocr_type \|\| 'text'/.test(tpl));
}

console.log(fails ? `\n${fails} CHECK(S) FAILED\n` : '\nall ocr_type retirement pins passed\n');
process.exit(fails ? 1 : 0);
