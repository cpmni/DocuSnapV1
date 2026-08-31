'use strict';
/*
 * test_near_match_prefix.js — Chris round 17 card 3 (2026-08-23; gary → Oracle SIGN-OFF-W/COND).
 *
 * THE INCIDENT: a one-line drawn teach over the stacked "DOCUMENT / SOLUTIONS" wordmark read "DOCUMENT";
 * the wizard said "Looks right →", asked nothing at Save, filed under `DOCUMENT\…` and learned a DOCUMENT
 * hint — while DOCUMENT SOLUTIONS was already taught, filed and graduated on that very layout. The
 * near-match finder is edit-distance only; a missing whole word is many edits.
 *
 * Pins: the TOKEN SUB-RUN arm (`name_proximity.tokenSubrunIdentity`): 'DOCUMENT' / 'SOLUTIONS' → near
 * (kind subrun); a generic-only sub-run ('Services', 'Ltd') never; TRADE-OFF 'Acme' vs 'Acme Holdings' →
 * not near (a 4-char single token — two real companies can share a short first word); exact → not
 * near; the generic set EQUALS the engine's `_NAME_GENERIC_TOKENS` (read from the .py — the Q3 precedent).
 * `learning.findNearMatchIdentity`: Tier B sub-run hit on the doc's OWN template → source
 * 'prefix-template'; Tier A (confirms) beats Tier B; an EDIT hit outranks a SUB-RUN hit in the same tier;
 * the reviewService gate passes the doc's template id; the wizard + Review copy branch on kind 'subrun'.
 *
 * Run: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron database/modules/test_near_match_prefix.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { runMigrations } = require('../index');
const documents = require('./documents');
const learning = require('./learning');
const np = require('./name_proximity');

let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? `  [${extra}]` : ''}`); if (!cond) fails++; };

console.log('tokenSubrunIdentity:');
check("'DOCUMENT' ⊂ 'DOCUMENT SOLUTIONS' → near (subrun)", np.tokenSubrunIdentity('DOCUMENT', 'DOCUMENT SOLUTIONS').near === true);
check("'SOLUTIONS' ⊂ 'DOCUMENT SOLUTIONS' → near", np.tokenSubrunIdentity('SOLUTIONS', 'DOCUMENT SOLUTIONS').near === true);
check("'Refrigeration Ltd' ⊂ 'Nordwind Refrigeration Ltd' → near (a generic token beside a distinctive one is fine)", np.tokenSubrunIdentity('Refrigeration Ltd', 'Nordwind Refrigeration Ltd').near === true);
check("'Services' vs 'Castellan Security Services' → NOT near (generic-only)", np.tokenSubrunIdentity('Services', 'Castellan Security Services').reason === 'generic-only');
check("'Ltd' vs 'Acme Ltd' → NOT near (generic-only)", np.tokenSubrunIdentity('Ltd', 'Acme Ltd').near === false);
check("TRADE-OFF: 'Acme' vs 'Acme Holdings' → NOT near (single 4-char token)", np.tokenSubrunIdentity('Acme', 'Acme Holdings').reason === 'single-token-too-short');
check("exact name → NOT near (not a proper sub-run)", np.tokenSubrunIdentity('DOCUMENT SOLUTIONS', 'DOCUMENT SOLUTIONS').near === false);
check("a non-contiguous pick ('DOCUMENT LTD' vs 'DOCUMENT SOLUTIONS LTD') → NOT near", np.tokenSubrunIdentity('DOCUMENT LTD', 'DOCUMENT SOLUTIONS LTD').near === false);
const py = fs.readFileSync(path.join(__dirname, '..', '..', 'python_backend', 'extraction', 'engine.py'), 'utf8');
const m = py.match(/_NAME_GENERIC_TOKENS = frozenset\(\{([\s\S]*?)\}\)/);
const pyTokens = new Set((m ? m[1] : '').match(/"([a-z]+)"/g).map(s => s.replace(/"/g, '')));
check('the JS generic set EQUALS the engine\'s _NAME_GENERIC_TOKENS (read from the .py)',
      pyTokens.size > 0 && pyTokens.size === np.NAME_GENERIC_TOKENS.size && [...pyTokens].every(t => np.NAME_GENERIC_TOKENS.has(t)),
      `py=${[...pyTokens].join(',')} js=${[...np.NAME_GENERIC_TOKENS].join(',')}`);

console.log('\nfindNearMatchIdentity:');
const db = new Database(':memory:');
runMigrations(db);
db.prepare("INSERT INTO document_types (id, name, slug, built_in) VALUES (4, 'Service Worksheet', 'service_worksheet', 0)").run();
db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (3, 'DOCUMENT SOLUTIONS', 'ds', 'service_worksheet')").run();
db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable) VALUES (3, 'supplier_name', 'DOCUMENT SOLUTIONS', 0)").run();
db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (9, 'Other', 'other', 'service_worksheet')").run();
let r = learning.findNearMatchIdentity(db, 'DOCUMENT', { templateId: 3 });
check("Tier B sub-run hit on the doc's OWN template → near, source 'prefix-template', kind subrun", r.near === true && r.existing === 'DOCUMENT SOLUTIONS' && r.source === 'prefix-template' && r.kind === 'subrun', JSON.stringify(r));
r = learning.findNearMatchIdentity(db, 'DOCUMENT', { templateId: 9 });
check("…the same hit seen from ANOTHER template → source 'template'", r.near === true && r.source === 'template' && r.kind === 'subrun');
r = learning.findNearMatchIdentity(db, 'DOCUMENT');
check('…no templateId → source template (backward compatible)', r.near === true && r.source === 'template');
check("'Gay' → no near match (not a sub-run, not an edit)", learning.findNearMatchIdentity(db, 'Gay').near === false);
// Tier A: confirmed human docs of a near (EDIT) name beat a Tier B sub-run
for (let i = 0; i < 3; i++) documents.insert(db, { original_filename: 'x.pdf', folder_path: '/in', status: 'confirmed', supplier_name: 'DOCUMEN SOLUTIONS', document_type_id: 4 });
r = learning.findNearMatchIdentity(db, 'DOCUMENT SOLUTION');
check('Tier A EDIT hit (3 confirms of a 1-edit name) beats a Tier B hit', r.near === true && r.source === 'confirms' && r.kind === 'edit');
// within Tier B: an EDIT hit outranks a SUB-RUN hit
db.prepare("INSERT INTO templates (id, name, slug, document_type_slug) VALUES (10, 'Documents', 'docs', 'service_worksheet')").run();
db.prepare("INSERT INTO template_fields (template_id, field_key, fixed_value, is_variable) VALUES (10, 'supplier_name', 'DOCUMENTS SOLUTIONS', 0)").run();
r = learning.findNearMatchIdentity(db, 'DOCUMENTS SOLUTION');
check('within a tier an EDIT hit outranks a SUB-RUN hit', r.near === true && r.kind === 'edit');

console.log('\nconsumers (source contract):');
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8').split(CR + LF).join(LF);
const svc = read('src', 'services', 'reviewService.js'), teach = read('src', 'windows', 'teach', 'renderer.js'), rev = read('src', 'windows', 'review', 'renderer.js'), rh = read('src', 'modules', 'review', 'handler.js');
check('reviewService passes the doc\'s template id to the finder', /findNearMatchIdentity\(db, issuerVal, \{ templateId: docRow\.template_id \|\| null \}\)/.test(svc));
check('the IPC accepts { value, templateId } and a bare string', /if \(value && typeof value === 'object'\) return learning\.findNearMatchIdentity\(getDb\(\), value\.value, \{ templateId: value\.templateId \|\| null \}\);/.test(rh));
check('the wizard asks with its document\'s template id and offers the FULL name first on a sub-run', /checkIdentityNearMatch\(\{ value: v, templateId: \(state\.doc && state\.doc\.template_id\) \|\| null \}\)/.test(teach)
      && /nm\.kind === 'subrun'/.test(teach) && /is part of <span class="mono">\$\{esc\(nm\.existing\)\}<\/span>/.test(teach));
check('the Review hold has a sub-run sentence (no "null characters")', /nm\.kind === 'subrun'/.test(rev) && /is part of <strong>\$\{known\}<\/strong>/.test(rev));
check('the ⊕ teach read-back branches on kind subrun', /nm\.kind === 'subrun'\s*\n\s*\? `&#9888; \$\{read\} That is part of `/.test(rev));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
