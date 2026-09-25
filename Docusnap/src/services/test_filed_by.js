'use strict';
/**
 * test_filed_by.js — PINs for the filed-by provenance line (2026-09-24, Chris 09-23 card 3; eric D2 → Oracle C12).
 *  1. deriveFiledBy: the seven provenance rows every filing door can produce → ONE enum + the HUMAN's name only.
 *  2. The detail DTO carries filed_by / filed_by_username and still leaks no filesystem field.
 *  3. The shared search UI prints the five copies from `filed_by`, "you" only for the signed-in user, and the
 *     neutral "Checked" when an older core sends no filed_by.
 *  4. The /v1 contract and the client constant moved in lockstep (1.9.0).
 * Run: ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron src/services/test_filed_by.js
 */
const fs = require('fs');
const path = require('path');
const { deriveFiledBy } = require('./previewService');
const dto = require('./dto');

let pass = 0, fail = 0;
function check(label, ok, extra) {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`); }
}

console.log('\n1. deriveFiledBy table');
const rows = [
  [{ status: 'confirmed', confirmed_via: null,               confirmed_by_username: 'chris' },                              'person',              'chris'],
  [{ status: 'confirmed', confirmed_via: 'scope_sweep',      confirmed_by_username: 'chris' },                              'approved_batch',      'chris'],
  [{ status: 'confirmed', confirmed_via: 'scope_sweep',      confirmed_by_username: 'Auto-filed (after your confirms)' },   'self_after_confirms', null],
  [{ status: 'confirmed', confirmed_via: 'auto_threshold',   confirmed_by_username: 'Auto-filed (100%)' },                  'auto_import',         null],
  [{ status: 'confirmed', confirmed_via: 'auto_graduated',   confirmed_by_username: 'Auto-filed (graduated)' },             'auto_import',         null],
  [{ status: 'confirmed', confirmed_via: 'auto_corroborated',confirmed_by_username: 'Auto-filed (corroborated)' },          'auto_import',         null],
  [{ status: 'confirmed', confirmed_via: null,               confirmed_by_username: 'Auto-filed (100%)' },                  'auto_import',         null],   // gate-unify OFF: via NULL, machine stamp
  [{ status: 'confirmed', confirmed_via: 'auto_reprocess',   confirmed_by_username: 'Auto-filed (reprocess)' },             'auto_reprocess',      null],
  [{ status: 'needs_review', confirmed_via: null,            confirmed_by_username: null },                                 null,                  null],
];
for (const [doc, fb, who] of rows) {
  const r = deriveFiledBy(doc);
  check(`${doc.status}/${doc.confirmed_via}/${doc.confirmed_by_username} → ${fb} · ${who}`, r.filed_by === fb && r.filed_by_username === who, JSON.stringify(r));
}
check('a machine stamp NEVER rides as filed_by_username', rows.every(([d]) => {
  const r = deriveFiledBy(d); return !/^Auto-filed/i.test(String(r.filed_by_username || ''));
}));

console.log('\n2. the detail DTO carries the two fields and leaks nothing');
const detail = dto.projectDocumentDetail({
  id: 1, status: 'confirmed', stored_path: 'C:/secret/x.pdf', folder_path: 'C:/secret', working_path: 'C:/secret/w.pdf',
  filed_by: 'person', filed_by_username: 'chris', confirmed_via: null, confirmed_by_username: 'chris', extractions: [],
});
check('filed_by + filed_by_username are projected', detail.filed_by === 'person' && detail.filed_by_username === 'chris', JSON.stringify(detail));
check('the raw attribution columns are NOT projected (derived enum only)', !('confirmed_via' in detail) && !('confirmed_by_username' in detail));
check('no filesystem field leaks', !('stored_path' in detail) && !('folder_path' in detail) && !('working_path' in detail));

console.log('\n3. the shared search UI copy (source pin on the ONE shared file; client copies are generated)');
const ui = fs.readFileSync(path.join(__dirname, '..', 'windows', 'shared', 'search-ui', 'searchActions.js'), 'utf8').replace(/\r\n/g, '\n');
const fn = ui.slice(ui.indexOf('function filedByLabel('), ui.indexOf('function renderActions('));
check('filedByLabel exists and the status bar uses it', fn.length > 100 && /chk\.textContent = filedByLabel\(doc\);/.test(ui));
check("person → 'Checked by you' only for the signed-in user, else the colleague's name", /case 'person':\s+return isMe \? 'Checked by you' : \(who \? `Checked by \$\{who\}` : 'Checked'\);/.test(fn));
check("approved_batch → 'Filed with your approval' (consented File-N, Oracle C12 5th state)", /case 'approved_batch':\s+return isMe \? 'Filed with your approval'/.test(fn));
check("self_after_confirms → 'Filed itself after your confirmations'", /case 'self_after_confirms':\s+return 'Filed itself after your confirmations';/.test(fn));
check("auto_import → 'Filed automatically on import'", /case 'auto_import':\s+return 'Filed automatically on import';/.test(fn));
check("auto_reprocess → 'Filed automatically after a re-read'", /case 'auto_reprocess':\s+return 'Filed automatically after a re-read';/.test(fn));
check("absent filed_by (older core) → the neutral 'Checked', never a guess", /default:\s+return 'Checked';/.test(fn));
check('the old unconditional "Checked by you" is gone', !/chk\.textContent = 'Checked by you';/.test(ui));
const init = fs.readFileSync(path.join(__dirname, '..', 'windows', 'shared', 'search-ui', 'searchInit.js'), 'utf8');
check('searchInit keeps the signed-in username on SearchState', /window\.SearchState\.username = \(u && u\.username\) \|\| null;/.test(init));

console.log('\n4. contract lockstep');
const api = require('../modules/api/handler');
const clientSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'apiClient.js'), 'utf8');
const m = clientSrc.match(/const CLIENT_CONTRACT = '([\d.]+)'/);
check('server API_CONTRACT_VERSION is 1.10.0 (1.9.0 added filed_by; 1.10.0 added nearMatch on the review-confirm 400, 2026-09-25)', api.API_CONTRACT_VERSION === '1.10.0', api.API_CONTRACT_VERSION);
check('client CLIENT_CONTRACT moved in lockstep', !!m && m[1] === api.API_CONTRACT_VERSION, m && m[1]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
