#!/usr/bin/env node
'use strict';
/**
 * test_migration218_issuer_sibling_dominant_hold.js — mig 218 seeds `issuer_sibling_dominant_hold` OFF (2026-09-25;
 * Chris 09-24 card 5; gary → Oracle SIGN-OFF-W/COND C1-C8). Pins: stamped, seeded 'false', listed in TEST_SWITCH_KEYS
 * (16 keys), no force-ON twin, JS-only (no _reconcileEnv line), a later manual ON survives; and the SHAPE of every
 * consumer (source regexes): the confirm gate runs Tier C after a Tier A/B miss and before the letterhead hold, with the
 * C8 audit metadata and the same ISSUER_NEAR_MATCH code; the teach ask (desktop IPC with docId, /v1 teach-commit pre-tx)
 * runs it (C1); the wizard passes docId at both call sites; the /v1 review-confirm 400 carries nearMatch (C4); the queue
 * stamps the display column only when armed; the renderer's group key + chip read it and the hold copy never says
 * "already use" for the siblings source (C6).
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration218_issuer_sibling_dominant_hold.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const KEY = 'issuer_sibling_dominant_hold', ENV = 'ISSUER_SIBLING_DOMINANT_HOLD';
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

console.log('\n1. mig 218 seed');
const db = new Database(':memory:');
const logs = []; { const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db); console.log = o; }
const get = (d, k) => { const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 218 stamped', applied.has(218));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 218 applied/.test(l) && /seeded OFF/.test(l)));
check(`a fresh install has ${KEY} === 'false'`, get(db, KEY) === 'false');
check(`${KEY} is listed in TEST_SWITCH_KEYS`, TEST_SWITCH_KEYS.includes(KEY));
check('TEST_SWITCH_KEYS is 18 keys (+ keyword_label_tail_bound mig 219 + suggested_teach_enabled mig 220 the Review suggested-teach picker Slice 1 DARK)', TEST_SWITCH_KEYS.length === 18 && new Set(TEST_SWITCH_KEYS).size === 18);
const idx = read('database', 'index.js');
check('single-key INSERT OR IGNORE seed of false', new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(idx));
check('NO force-ON of the key anywhere in the migrations', !new RegExp(`VALUES \\('${KEY}', 'true'\\)`).test(idx) && !new RegExp(`'${KEY}'[^\\n]*'true'`).test(idx.replace(/\/\/[^\n]*/g, '')));
const ph = read('src', 'modules', 'processing', 'handler.js');
check('JS-only: no _reconcileEnv bridge for the key (the engine never reads it)', !new RegExp(`${ENV}`).test(ph));
const setS = (d, k, v) => d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
setS(db, KEY, 'true');
{ const o = console.log; console.log = () => {}; runMigrations(db); console.log = o; }
check('a later manual ON survives the next start (the seed is INSERT OR IGNORE)', get(db, KEY) === 'true');
db.close();

console.log('\n2. the confirm gate (reviewService.js) — ordering + shape');
const rs = read('src', 'services', 'reviewService.js');
const gate = rs.slice(rs.indexOf('ISSUER NEAR-MATCH confirm gate'), rs.indexOf('TYPE-SPLIT ask'));
const iAB = gate.indexOf('const nm = learning.findNearMatchIdentity(db, issuerVal'), iC = gate.indexOf('learning.findDominantSiblingIdentity(db, document_id, issuerVal)'), iLh = gate.indexOf('LETTERHEAD-SUGGESTION hold');
check('Tier C runs AFTER the Tier A/B check and BEFORE the letterhead hold, inside the same guarded block', iAB > -1 && iC > iAB && iLh > iC);
check('Tier C is gated on an A/B MISS + the switch predicate + the function existing', /if \(!\(nm && nm\.near\) && learning\.siblingDominantEnabled && learning\.siblingDominantEnabled\(db\)\s*\n\s*&& typeof learning\.findDominantSiblingIdentity === 'function'\) \{/.test(gate));
check('a hit audits confirm_held_sibling_dominant with the C8 tally (typed, existing, siblings, confirmedSiblings, kind, distance, pairTests)',
      /action: 'confirm_held_sibling_dominant'[\s\S]{0,300}metadata: \{ typed: issuerVal, existing: sd\.existing, siblings: sd\.siblings, confirmedSiblings: sd\.confirmedSiblings,\s*\n\s*kind: sd\.kind, distance: sd\.distance, pairTests: sd\.pairTests \}/.test(gate));
check('... and refuses with the SAME code + a nearMatch payload marked source siblings (the ack/bulk semantics are the existing ones)',
      /return fail\('ISSUER_NEAR_MATCH',\s*\n\s*`"\$\{issuerVal\}" is very close to "\$\{sd\.existing\}", which \$\{_n\} other document/.test(gate)
      && /source: 'siblings', kind: sd\.kind \|\| null,\s*\n\s*siblings: sd\.siblings, confirmedSiblings: sd\.confirmedSiblings \} \}\);/.test(gate));
check('the /v1 self-sufficient text names the way past the hold', /Correct the issuer here, or keep it from the main Scan Finder app\./.test(gate));
check('the gate never writes: no UPDATE/INSERT inside the Tier C block', !/UPDATE |INSERT /.test(gate.slice(iC - 400, iLh)));

console.log('\n3. the teach ask (Oracle C1) — desktop IPC + /v1 teach-commit + the wizard');
const rh = read('src', 'modules', 'review', 'handler.js');
const ipc = rh.slice(rh.indexOf("ipcMain.handle('check-identity-near-match'"), rh.indexOf("ipcMain.handle('check-identity-near-match'") + 1600);
check('the desktop ask runs Tier C after an A/B miss when the caller names the doc and the switch is armed, returning the sibling verdict',
      /if \(!\(nm && nm\.near\) && value\.docId && learning\.siblingDominantEnabled && learning\.siblingDominantEnabled\(db\)\) \{[\s\S]{0,300}findDominantSiblingIdentity\(db, value\.docId, value\.value\);\s*\n\s*if \(sd && sd\.near\) return sd;/.test(ipc));
check('... a bare-string caller (the ⊕ teach, older callers) is byte-identical (Tier A/B only)', /return learning\.findNearMatchIdentity\(getDb\(\), value\);\s*\n\s*\} catch/.test(ipc));
const tc = rh.slice(rh.indexOf('let nm = learning.findNearMatchIdentity(db, supplierName);'), rh.indexOf('let nm = learning.findNearMatchIdentity(db, supplierName);') + 700);
check('the /v1 teach-commit pre-tx check runs Tier C with the document id BEFORE the template is born (same ack flag)',
      /if \(!\(nm && nm\.near\) && supplierName && documentId && learning\.siblingDominantEnabled && learning\.siblingDominantEnabled\(db\)\) \{[\s\S]{0,200}findDominantSiblingIdentity\(db, documentId, supplierName\); if \(sd && sd\.near\) nm = sd;/.test(tc)
      && /if \(nm && nm\.near && !p\.acknowledgeIssuerNearMatch\) return \{ ok: false, code: 'ISSUER_NEAR_MATCH'/.test(tc));
const teach = read('src', 'windows', 'shared', 'teach-ui', 'teach.js');
check('the wizard passes docId at BOTH ask sites (the field check and the Save ask)',
      (teach.match(/checkIdentityNearMatch\(\{ value: [a-z]+, templateId: \(state\.doc && state\.doc\.template_id\) \|\| null, docId: \(state\.doc && state\.doc\.id\) \|\| null \}\)/g) || []).length === 2);
check('the client copy of the wizard carries both docId ask sites (sync-client-teach ran; byte-sync itself is the sync pin\'s job)',
      (read('client', 'renderer', 'shared', 'teach-ui', 'teach.js').match(/docId: \(state\.doc && state\.doc\.id\) \|\| null/g) || []).length === 2);

console.log('\n4. the /v1 review confirm (Oracle C4) + the queue + the renderer (C6/C7)');
const api = read('src', 'modules', 'api', 'handler.js');
check('the review-confirm refusal carries nearMatch ADDITIVELY on ISSUER_NEAR_MATCH only',
      /\.\.\.\(r\.code === 'ISSUER_NEAR_MATCH' && r\.nearMatch \? \{ nearMatch: r\.nearMatch \} : \{\}\) \}\);/.test(api));
const docs = read('database', 'modules', 'documents.js');
check('getReviewQueue stamps the display column via ONE post-pass that returns at once when the switch is off',
      /_stampSiblingDominant\(db, _rows\);\s*\n\s*return _rows;/.test(docs)
      && /function _stampSiblingDominant\(db, rows\) \{[\s\S]{0,300}if \(!learning\.siblingDominantEnabled \|\| !learning\.siblingDominantEnabled\(db\)\) return;/.test(docs));
check('... bounded (fold cap) and pre-filtered (a fold can only be dominated by a strictly larger one, confirmed siblings counted)',
      /if \(folds\.length > 400\) return;/.test(docs) && /if \(theirs < 2 \|\| theirs <= mine\) continue;/.test(docs));
const rend = read('src', 'windows', 'review', 'renderer.js');
check('reviewGroupKey prefers issuer_sibling_dominant; the chip names the count and both spellings',
      /function reviewGroupKey\(doc\) \{[\s\S]{0,400}const dom = String\(doc\?\.issuer_sibling_dominant \|\| ''\)\.trim\(\);\s*\n\s*if \(dom\) return dom;/.test(rend)
      && /other document\$\{n === 1 \? '' : 's'\} with this same layout read “\$\{escHtml\(dom\)\}” — this one read “\$\{escHtml\(ownName\)\}”/.test(rend));
const hold = rend.slice(rend.indexOf('function showIssuerNearMatchHold'), rend.indexOf('function showIssuerNearMatchHold') + 4000);
const sib = hold.slice(hold.indexOf("nm.source === 'siblings'"), hold.indexOf("nm.source === 'letterhead'"));
check('the siblings lead exists, names the count + both spellings, asks "same sender?", and says a second folder would start',
      sib.length > 100 && /other document\$\{_sibN === 1 \? '' : 's'\} with this same layout read/.test(sib) && /same sender\? /.test(sib) && /would start a second folder/.test(sib));
check('... and NEVER says "already use" (false for an unconfirmed sibling)', !/already use/.test(sib));
check('... the Use / Keep pair is the existing one (equal weight)', /inm-use-btn/.test(hold) && /inm-keep-btn/.test(hold));

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
