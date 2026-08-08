'use strict';
/*
 * test_settings_wiring.js — a Settings control that is wired in JS but has NO element in the
 * page is DEAD SILENTLY. `document.getElementById('x')` returns null, the `.checked =` throws
 * inside an already-`catch`-wrapped async block, and the toggle simply never appears — no error,
 * no console noise, nothing for a reviewer to notice. That is the same failure shape as the
 * dead Document-Actions panel found by Chris The Customer (src/windows/search/
 * test_no_global_collisions.js): a control the owner believes exists and does not.
 *
 * It matters most for the kill-switch bridges. Each one is a row in index.html plus an entry in
 * a toggle loop in renderer.js plus a `learning.getSetting` line in processing/handler.js
 * `_reconcileEnv`. Three files, and a typo in any one of them yields a switch that looks
 * present and flips nothing.
 *
 * This pin fails when:
 *   1. renderer.js addresses an element id that exists neither in index.html nor in the markup
 *      renderer.js itself mints (the doc-type editor builds its panel with innerHTML);
 *   2. a toggle-loop tuple names a setting key that no bridge or handler ever reads — a switch
 *      that writes a key nobody consumes (advisory: reported, does not fail, because some keys
 *      are read by the renderer alone);
 *   3. <div> nesting in index.html does not balance (a truncated edit silently reparents whole
 *      tabs — the settings page is one deeply nested tree and Chromium will happily render a
 *      broken one).
 *
 *   node src/windows/settings/test_settings_wiring.js
 */
const fs = require('fs');
const path = require('path');

let fails = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'renderer.js'), 'utf8');

// An addressable id may be AUTHORED in index.html or MINTED by the renderer itself, so both
// sources count as "exists". Without the second source this pin fails on the doc-type editor.
const ids = new Set([
  ...[...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]),
  ...[...js.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]),
]);

const addressed = new Set([
  ...[...js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]),
  // toggle-loop tuples: ['some-toggle', 'setting_key'] / ['some-toggle', ['key_a', 'key_b']]
  ...[...js.matchAll(/\[\s*'([a-z0-9-]+-toggle)'\s*,/g)].map(m => m[1]),
]);

const missing = [...addressed].filter(id => !ids.has(id));
check(`every element id the renderer addresses exists (${addressed.size} checked)`
      + (missing.length ? ` — MISSING: ${missing.join(', ')}` : ''),
      missing.length === 0);

const opens = (html.match(/<div\b/g) || []).length;
const closes = (html.match(/<\/div>/g) || []).length;
check(`<div> nesting balances in index.html (${opens} open / ${closes} close)`, opens === closes);

// Every setting key a toggle loop writes should be READ somewhere — the _reconcileEnv bridge,
// another main-process module, or the renderer itself. Advisory only: a key read exclusively by
// a window this scan does not open is legitimate, so an unread key prints a NOTE, not a failure.
const KEYS = [
  ...[...js.matchAll(/\[\s*'[a-z0-9-]+-toggle'\s*,\s*'([a-z0-9_]+)'\s*\]/g)].map(m => m[1]),
  ...[...js.matchAll(/\[\s*'[a-z0-9-]+-toggle'\s*,\s*\[([^\]]+)\]\s*\]/g)]
      .flatMap(m => [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map(x => x[1])),
];
const root = path.join(__dirname, '..', '..', '..');
const readers = ['src/modules/processing/handler.js', 'src/modules/settings/handler.js',
                 'database/modules/trust.js', 'database/modules/learning.js']
  .map(f => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } })
  .join('\n');
const unread = [...new Set(KEYS)].filter(k => !readers.includes(`'${k}'`));
console.log(`  NOTE ${KEYS.length} toggle-written setting keys; ${unread.length} not read by the`
            + ` scanned consumers${unread.length ? `: ${unread.join(', ')}` : ''}`);

// The kill-switch bridges specifically: id -> setting key -> env var, all three present.
// Add a row here whenever a new extraction switch is bridged; a bridge that loses any leg is a
// switch the owner can flip that changes nothing.
const BRIDGES = [
  ['inline-row-overlap-toggle', 'template_inline_row_overlap', 'TEMPLATE_INLINE_ROW_OVERLAP'],
  ['ref-role-digit-toggle',     'ref_role_digit_gate',         'REF_ROLE_DIGIT_GATE'],
  ['vat-reg-toggle',            'vat_reg_not_amount',          'VAT_REG_NOT_AMOUNT'],
  ['credit-sign-toggle',        'credit_sign_coherence',       'CREDIT_SIGN_COHERENCE'],
  ['pad-window-read-toggle',    'template_pad_window_read',    'TEMPLATE_PAD_WINDOW_READ'],
];
const handler = (() => {
  try { return fs.readFileSync(path.join(root, 'src/modules/processing/handler.js'), 'utf8'); }
  catch { return ''; }
})();
for (const [id, key, env] of BRIDGES) {
  check(`bridge ${id} -> ${key} -> ${env}`,
        ids.has(id) && js.includes(`'${id}'`) && js.includes(`'${key}'`)
        && handler.includes(`'${key}'`) && handler.includes(`env.${env} =`));
}

// SETTING-ONLY switches: a JS-side gate reads the key directly, so there is no _reconcileEnv leg
// and no env var to check — the consumer file is the third leg instead. A switch listed here whose
// consumer stops reading the key is the same dead-toggle failure, just one file over.
const SETTING_SWITCHES = [
  ['shadow-row-skip-toggle', 'trust_shadow_row_skip', 'database/modules/trust.js'],
];
for (const [id, key, consumer] of SETTING_SWITCHES) {
  let src = '';
  try { src = fs.readFileSync(path.join(root, consumer), 'utf8'); } catch {}
  check(`setting switch ${id} -> ${key} -> read by ${consumer}`,
        ids.has(id) && js.includes(`'${id}'`) && js.includes(`'${key}'`) && src.includes(`'${key}'`));
}

console.log(fails ? `\n${fails} FAILED` : '\nAll settings-wiring pins passed');
process.exit(fails ? 1 : 0);
