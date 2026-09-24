#!/usr/bin/env node
'use strict';
/**
 * test_migration216_quiet_redetect.js — mig 216 seeds `quiet_redetect_on_type_change` OFF (2026-09-24 evening 2;
 * owner: "categorise everything quickly, then confirms allow auto-file"; gary + eric → Oracle SIGN-OFF-W/COND C1-C7).
 * Pins: stamped, seeded 'false', listed in TEST_SWITCH_KEYS (14 keys), no force-ON twin, a later manual ON survives;
 * JS-ONLY (no _reconcileEnv line — the Python child never reads it); the handler predicate honours env '1'/'0' over
 * the setting; the trigger + the flip split are gated on it; the lane gets the four redetect deps.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration216_quiet_redetect.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const KEY = 'quiet_redetect_on_type_change', ENV = 'QUIET_REDETECT_ON_TYPE_CHANGE';

console.log('\n1. mig 216 seed');
const db = new Database(':memory:');
const logs = []; { const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db); console.log = o; }
const get = (d, k) => { const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 216 stamped', applied.has(216));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 216 applied/.test(l) && /seeded OFF/.test(l)));
check(`a fresh install has ${KEY} === 'false'`, get(db, KEY) === 'false');
check(`${KEY} is listed in TEST_SWITCH_KEYS`, TEST_SWITCH_KEYS.includes(KEY));
check('TEST_SWITCH_KEYS is 14 keys (13 after the 215 batch + this one)', TEST_SWITCH_KEYS.length === 14 && new Set(TEST_SWITCH_KEYS).size === 14);
const src = fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8');
check('single-key INSERT OR IGNORE seed of false', new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(src));
check('NO force-ON of the key anywhere in the migrations', !new RegExp(`VALUES \\('${KEY}', 'true'\\)`).test(src) && !new RegExp(`'${KEY}'[^\\n]*'true'`).test(src.replace(/\/\/[^\n]*/g, '')));
check('JS-only: no _reconcileEnv line for the key', !new RegExp(`_reconcileEnv[^\\n]*${KEY}`).test(src) && !new RegExp(`${ENV}[^\\n]*_reconcileEnv`).test(src));
const setS = (d, k, v) => d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
setS(db, KEY, 'true');
{ const o = console.log; console.log = () => {}; runMigrations(db); console.log = o; }
check('a later manual ON survives the next start (the seed is INSERT OR IGNORE)', get(db, KEY) === 'true');
setS(db, KEY, 'false');

console.log('\n2. the handler predicate: env wins both ways, else the setting');
const h = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8');
check('_redetectEnabled reads env QUIET_REDETECT_ON_TYPE_CHANGE (1 → true, 0 → false) then the setting',
      /function _redetectEnabled\(db\) \{\s*\n\s*const env = process\.env\.QUIET_REDETECT_ON_TYPE_CHANGE;\s*\n\s*if \(env === '1'\) return true;\s*\n\s*if \(env === '0'\) return false;\s*\n\s*try \{ return require\('\.\.\/\.\.\/\.\.\/database\/modules\/learning'\)\.getSetting\(db, 'quiet_redetect_on_type_change', 'false'\) === 'true'; \}/.test(h));
check('scheduleQuietRedetect is exported and gated on _redetectEnabled', /scheduleQuietRedetect,\s*\/\/ QUIET REDETECT trigger/.test(h) && /if \(!_quietLaneImpl \|\| !_redetectEnabled\(db\)\) return false;/.test(h));
check('the lane receives the four redetect deps', /redetectEnabled: \(db\) => _redetectEnabled\(db\),/.test(h) && /quickUsable: \(db, docId, opts = \{\}\) =>/.test(h) && /genericTypeId: \(db\) =>/.test(h) && /isIdentityKey: \(key\) =>/.test(h));
check('quickUsable is the batch\'s own predicate (ocrCache.ocrCacheUsable over the stored text + recipe stamp)', /ocrCache\.ocrCacheUsable\(\{ ocr_text: r\.ocr_text, ocr_recipe: r\.ocr_recipe, enhance_active: false \}, current\)/.test(h));
check('the born-digital relaxation is opt-in (allowBornDigital), waives ONLY bd_used and re-asks the same predicate (gate finding 2026-09-24)',
      /if \(!v\.usable && v\.reason === 'born-digital-doc' && opts\.allowBornDigital\)/.test(h)
      && /ocr_recipe: JSON\.stringify\(\{ \.\.\.rec, bd_used: false \}\), enhance_active: false \}, current\)/.test(h)
      && /return v2\.usable \? \{ usable: true, reason: 'ok-born-digital' \} : v2;/.test(h));
const ql = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'quietLane.js'), 'utf8');
check('the lane asks quickUsable with allowBornDigital ONLY from the redetect population', (ql.match(/allowBornDigital: true/g) || []).length === 1 && /quickUsable\(db, r\.id, \{ allowBornDigital: true \}\)/.test(ql));
check('the lane\'s runShard dep forwards reextract (and only from the quick job)', /runShard: \(\{ db, staged, label, extraEnv, track, onFileDone, reextract = false \}\) =>/.test(h) && /reextract: !!reextract,\s*\/\/ QUIET REDETECT/.test(h));
check('the Generic→X flip-note split is gated on _redetectEnabled', /_redetectEnabled\(db\) \? require\('\.\.\/\.\.\/\.\.\/database\/modules\/document_types'\)\.getGenericType\(db\) : null/.test(h));

console.log('\n3. the trigger sites (settings + /v1) call the scheduler after a successful write, never before');
const s = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'settings', 'handler.js'), 'utf8');
check('helper _afterDetectionChange lazy-requires processing/handler inside try/catch', /const _afterDetectionChange = \(db, \{[^}]*\} = \{\}\) => \{\s*\n\s*try \{/.test(s) && /require\('\.\.\/processing\/handler'\)\.scheduleQuietRedetect\(db, \{ typeSlug: slug, overrideKey, reason \}\)/.test(s));
check('create-doc-type-with-fields → after r.success', /if \(r\.success\) notifyAllWindows\('doc-types-changed'\);[^\n]*\n\s*if \(r\.success\) _afterDetectionChange\(getDb\(\), \{ typeId: r\.id, reason: 'type-created' \}\);/.test(s));
check('add-doctype-presets → per added slug', /for \(const it of \(results \|\| \[\]\)\) if \(it && it\.status === 'added' && it\.slug\) _afterDetectionChange\(getDb\(\), \{ typeSlug: it\.slug, reason: 'type-added' \}\);/.test(s));
check('add-document-type → after the broadcast', /notifyAllWindows\('doc-types-changed'\);\s*\n\s*_afterDetectionChange\(db, \{ typeId: out\.lastInsertRowid, reason: 'type-added' \}\);/.test(s));
check('update-document-type → aliases edited OR enabled 0→1 (Oracle C7)', /if \('title_aliases' in ch \|\| _reEnabled\) _afterDetectionChange\(db, \{ typeId: id, reason: _reEnabled \? 'type-enabled' : 'alias-edited' \}\);/.test(s));
check('label override add / bulk add / delete → typeSlug + overrideKey', (s.match(/reason: 'override'/g) || []).length === 2 && /reason: 'override-removed'/.test(s));
const api = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'api', 'handler.js'), 'utf8');
check('/v1 POST doc-types → scheduleQuietRedetect after success', /if \(!r\.success\) return sendJson\(res, 400, \{ error: r\.error \}\);\s*\n\s*\/\/ QUIET REDETECT[^\n]*\n\s*try \{ const dt = r\.type \|\| \{\}; require\('\.\.\/processing\/handler'\)\.scheduleQuietRedetect\(getDb\(\), \{ typeSlug: dt\.slug \|\| null, reason: 'type-created' \}\); \} catch \{\}/.test(api));

db.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
