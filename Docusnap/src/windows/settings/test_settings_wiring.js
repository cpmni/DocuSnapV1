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
  ['shadow-attrib-toggle',      'reconcile_shadow_attribution', 'RECONCILE_SHADOW_ATTRIBUTION'],
  ['vat-rate-at-toggle',        'vat_rate_at_skip',             'VAT_RATE_AT_SKIP'],
  ['pin-discharge-toggle',      'supplier_pin_self_discharge',  'SUPPLIER_PIN_SELF_DISCHARGE'],
  ['confirmed-adopt-toggle',    'confirmed_dominant_adopt',     'CONFIRMED_DOMINANT_ADOPT'],
  ['raw-witness-flag-toggle',   'raw_crop_witness_flag',        'RAW_CROP_WITNESS_FLAG'],
  ['raw-witness-adopt-toggle',  'raw_crop_witness_adopt',       'RAW_CROP_WITNESS_ADOPT'],
  ['inline-row-overlap-toggle', 'template_inline_row_overlap', 'TEMPLATE_INLINE_ROW_OVERLAP'],
  ['ref-role-digit-toggle',     'ref_role_digit_gate',         'REF_ROLE_DIGIT_GATE'],
  ['drift-row-pitch-toggle',    'template_drift_row_pitch',    'TEMPLATE_DRIFT_ROW_PITCH'],
  ['currency-edge-grow-toggle', 'template_currency_edge_grow', 'TEMPLATE_CURRENCY_EDGE_GROW'],
  ['name-edge-grow-toggle',     'template_name_edge_grow',     'TEMPLATE_NAME_EDGE_GROW'],
  ['angle-compose-scan-toggle', 'teach_angle_compose_scan',    'TEACH_ANGLE_COMPOSE_SCAN'],
  ['fixed-issuer-repair-toggle','template_fixed_issuer_repair','TEMPLATE_FIXED_ISSUER_REPAIR'],
  ['reg-arbiter-anchor-evidence-toggle', 'template_reg_arbiter_anchor_evidence',
   'TEMPLATE_REG_ARBITER_ANCHOR_EVIDENCE'],
  ['issuer-region-presence-toggle', 'template_issuer_region_presence',
   'TEMPLATE_ISSUER_REGION_PRESENCE'],
  ['fixed-seed-agreement-toggle', 'template_fixed_seed_agreement_keep',
   'TEMPLATE_FIXED_SEED_AGREEMENT_KEEP'],
  ['stage05-ref-code-toggle',   'stage05_ref_code_gate',       'STAGE05_REF_CODE_GATE'],
  ['generic-caption-exclusive-toggle', 'keyword_generic_caption_exclusive',
   'KEYWORD_GENERIC_CAPTION_EXCLUSIVE'],
  ['type-title-owner-toggle',   'type_title_owner_precedence', 'TYPE_TITLE_OWNER_PRECEDENCE'],
  ['filing-sanity-flags-toggle','filing_value_sanity_flags',   'FILING_VALUE_SANITY_FLAGS'],
  ['letterhead-issuer-toggle',  'letterhead_issuer',           'LETTERHEAD_ISSUER'],
  ['identity-on-page-toggle',   'template_identity_on_page',   'TEMPLATE_IDENTITY_ON_PAGE'],
  // Bridged 2026-08-10. Both were built and measured on 08-09 and recorded as awaiting a flip,
  // but had NO bridge — env-only, and `npm start` injects no env, so they were unreachable in the
  // product. Pinned here so the same gap can't reopen.
  ['format-fail-yield-toggle',  'template_format_fail_yield',  'TEMPLATE_FORMAT_FAIL_YIELD'],
  ['customer-po-labels-toggle', 'customer_po_labels',          'CUSTOMER_PO_LABELS'],
  ['code-separator-guard-toggle', 'code_separator_structure_guard', 'CODE_SEPARATOR_STRUCTURE_GUARD'],
  ['vat-eu-formats-toggle',     'vat_eu_formats',                'VAT_EU_FORMATS'],
  ['list-field-scan-toggle',    'list_field_scan',               'LIST_FIELD_SCAN'],
  ['hidden-field-drop-toggle',  'template_hidden_field_drop',    'TEMPLATE_HIDDEN_FIELD_DROP'],
  ['vat-reg-toggle',            'vat_reg_not_amount',          'VAT_REG_NOT_AMOUNT'],
  ['credit-sign-toggle',        'credit_sign_coherence',       'CREDIT_SIGN_COHERENCE'],
  ['pad-window-read-toggle',    'template_pad_window_read',    'TEMPLATE_PAD_WINDOW_READ'],
  ['inline-offset-veto-toggle', 'anchor_inline_taught_offset_veto', 'ANCHOR_INLINE_TAUGHT_OFFSET_VETO'],
  // Type-election title-first (herald 2026-08-12 NIGHT): ONE toggle bridges THREE keyword.py
  // kill switches (the heading_absent_reread multi-flag pattern) — pin each env leg.
  ['type-election-title-toggle', 'type_election_title_first', 'TYPE_CAPTION_MENTION_ONLY'],
  ['type-election-title-toggle', 'type_election_title_first', 'TYPE_HEADING_ANY_SEGMENT'],
  ['type-election-title-toggle', 'type_election_title_first', 'TYPE_TIE_HEADING_PREF'],
  // Corroboration step 3, slice 1 (Oracle W/COND 2026-08-12 NIGHT).
  ['xcheck-demote-toggle', 'xcheck_corrob_note_demote', 'XCHECK_CORROB_NOTE_DEMOTE'],
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
  // Gate-unify slice (Oracle W/COND 2026-08-12 NIGHT): trust.js reads autofile_gate_unify (ONE
  // shared read for the import gate T1, the missing-required refusal T2 and the via stamps T3);
  // documents.js reads far_lowconf_valued_only (getReviewSplit twin; the Review renderer caches
  // the same key for isFlagged).
  ['autofile-gate-unify-toggle', 'autofile_gate_unify', 'database/modules/trust.js'],
  ['far-valued-only-toggle', 'far_lowconf_valued_only', 'database/modules/documents.js'],
  ['shadow-stale-drop-toggle', 'reprocess_shadow_stale_drop', 'src/modules/processing/handler.js'],
  // Graduation issuer freeze: a JS-main-process BIRTH decision — graduationTemplate.js reads the
  // key itself (the module's own _enabled precedent); no Python leg exists.
  ['graduation-freeze-issuer-toggle', 'graduation_freeze_issuer', 'database/modules/graduationTemplate.js'],
  // Corroborated auto-file (Oracle-signed 2026-08-11): the gate is a settings read inside
  // trust.js (env CORROB_AUTOFILE wins both directions for harness arms — the C5 pattern).
  ['corrob-autofile-toggle', 'corroboration_autofile', 'database/modules/trust.js'],
  // Post-reprocess consent offer (Oracle 2026-08-12): the gate is a settings read in the
  // consume-reprocess-completion handler; OFF = legacy counts-only return, nothing offered.
  ['reprocess-autocommit-toggle', 'reprocess_autocommit_offer', 'src/modules/processing/handler.js'],
  // Taught label becomes the keyword (migrations 61+62): the gate is a settings read at the two
  // teach WRITE sites; the processing handler is the higher-traffic consumer to pin.
  ['teach-label-keyword-toggle', 'teach_label_becomes_keyword', 'src/modules/processing/handler.js'],
  // Straighten-on-import: read directly where the import worker is spawned (a CLI FLAG to the
  // extractor, not an env bridge), so the consumer to pin is the processing handler itself.
  ['deskew-import-toggle', 'deskew_on_import', 'src/modules/processing/handler.js'],
];
for (const [id, key, consumer] of SETTING_SWITCHES) {
  let src = '';
  try { src = fs.readFileSync(path.join(root, consumer), 'utf8'); } catch {}
  check(`setting switch ${id} -> ${key} -> read by ${consumer}`,
        ids.has(id) && js.includes(`'${id}'`) && js.includes(`'${key}'`) && src.includes(`'${key}'`));
}

console.log(fails ? `\n${fails} FAILED` : '\nAll settings-wiring pins passed');
process.exit(fails ? 1 : 0);
