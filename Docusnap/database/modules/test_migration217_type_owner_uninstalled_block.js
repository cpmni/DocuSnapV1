#!/usr/bin/env node
'use strict';
/**
 * test_migration217_type_owner_uninstalled_block.js — mig 217 seeds `type_owner_uninstalled_block` OFF (2026-09-25;
 * Chris 09-24 "two Ironclad statements typed Invoice"; herald → gary → Oracle SIGN-OFF-W/COND C1-C10).
 * Pins: stamped, seeded 'false', listed in TEST_SWITCH_KEYS (15 keys), no force-ON twin, a later manual ON survives;
 * the env bridge sits INSIDE the fold's `if` block (a CHILD of type_uninstalled_heading_fold — Oracle C10 nesting
 * regex); the engine's blocker loop is nested under BOTH envs, excludes installed names ∪ aliases (C1), uses the SAME
 * top-band predicate as the owner loop (C2 symmetry) and never lets a blocker into `_owners`.
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe database/modules/test_migration217_type_owner_uninstalled_block.js
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const { runMigrations } = require(path.join(ROOT, 'database', 'index'));
const { TEST_SWITCH_KEYS } = require(path.join(ROOT, 'database', 'dark_switches'));
let fails = 0;
const check = (label, cond, extra) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}${!cond && extra ? ' — ' + extra : ''}`); if (!cond) fails++; };
const KEY = 'type_owner_uninstalled_block', ENV = 'TYPE_OWNER_UNINSTALLED_BLOCK';
const norm = (s) => s.replace(/\r\n/g, '\n');

console.log('\n1. mig 217 seed');
const db = new Database(':memory:');
const logs = []; { const o = console.log; console.log = (m) => logs.push(String(m)); runMigrations(db); console.log = o; }
const get = (d, k) => { const r = d.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; };
const applied = new Set(db.prepare('SELECT version FROM migrations').all().map(r => r.version));
check('migration 217 stamped', applied.has(217));
check('the seed line says seeded OFF (DARK)', logs.some(l => /migration 217 applied/.test(l) && /seeded OFF/.test(l)));
check(`a fresh install has ${KEY} === 'false'`, get(db, KEY) === 'false');
check('the parent fold is ON by default (graduated mig 205) — the child is bridged only inside its block', get(db, 'type_uninstalled_heading_fold') === 'true');
check(`${KEY} is listed in TEST_SWITCH_KEYS`, TEST_SWITCH_KEYS.includes(KEY));
check('TEST_SWITCH_KEYS is 17 keys (+ issuer_sibling_dominant_hold mig 218 + keyword_label_tail_bound mig 219; suggested_teach_enabled mig 220 graduated via 221)', TEST_SWITCH_KEYS.length === 17 && new Set(TEST_SWITCH_KEYS).size === 17);
const src = norm(fs.readFileSync(path.join(ROOT, 'database', 'index.js'), 'utf8'));
check('single-key INSERT OR IGNORE seed of false', new RegExp(`INSERT OR IGNORE INTO settings \\(key, value\\) VALUES \\('${KEY}', 'false'\\)`).test(src));
check('NO force-ON of the key anywhere in the migrations', !new RegExp(`VALUES \\('${KEY}', 'true'\\)`).test(src) && !new RegExp(`'${KEY}'[^\\n]*'true'`).test(src.replace(/\/\/[^\n]*/g, '')));
const setS = (d, k, v) => d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
setS(db, KEY, 'true');
{ const o = console.log; console.log = () => {}; runMigrations(db); console.log = o; }
check('a later manual ON survives the next start (the seed is INSERT OR IGNORE)', get(db, KEY) === 'true');
db.close();

console.log('\n2. the bridge is a CHILD of the fold (handler.js _reconcileEnv)');
const h = norm(fs.readFileSync(path.join(ROOT, 'src', 'modules', 'processing', 'handler.js'), 'utf8'));
check('the child bridge sits INSIDE the fold\'s if-block, after the fold env is set, env-wins (== null guard)',
      new RegExp(`if \\(env\\.TYPE_UNINSTALLED_HEADING_FOLD == null && learning\\.getSetting\\(db, 'type_uninstalled_heading_fold', 'false'\\) === 'true'\\) \\{\\s*\\n\\s*env\\.TYPE_UNINSTALLED_HEADING_FOLD = '1';[\\s\\S]{0,1200}?if \\(env\\.${ENV} == null && learning\\.getSetting\\(db, '${KEY}', 'false'\\) === 'true'\\) \\{\\s*\\n\\s*env\\.${ENV} = '1';\\s*\\n\\s*\\}\\s*\\n\\s*\\}`).test(h));
check('... and nowhere else (exactly one bridge line for the key)', (h.match(new RegExp(`env\\.${ENV} = '1'`, 'g')) || []).length === 1);
check('the bridge lives inside _reconcileEnv, which _pipelineSpawnEnv composes for every Python spawn',
      h.indexOf('function _reconcileEnv(db)') < h.indexOf(`env.${ENV} = '1'`) && h.indexOf(`env.${ENV} = '1'`) < h.indexOf('function _pipelineSpawnEnv(db)')
      && /\.\.\._reconcileEnv\(db\),\s*\n\s*\};\s*\n\}/.test(h.slice(h.indexOf('function _pipelineSpawnEnv(db)'))));

console.log('\n3. the engine (keyword.py) — the blocker loop shape');
const py = norm(fs.readFileSync(path.join(ROOT, 'python_backend', 'extraction', 'keyword.py'), 'utf8'));
const blk = py.slice(py.indexOf("if os.environ.get('TYPE_TITLE_OWNER_PRECEDENCE', '0') != '0':"), py.indexOf('best_score = scores[best_type]'));
check('the owner-precedence block was found', blk.length > 500);
check('ONE top-band predicate `_top_band_owner` is defined and used by BOTH the owner loop and the blocker loop (C2 symmetry)',
      /def _top_band_owner\(_phrases_lc\):/.test(blk)
      && /if _top_band_owner\(\[_p\.strip\(\)\.lower\(\) for _p in _phrases if _p\]\):\s*\n\s*_owners\.add\(_nm\)/.test(blk)
      && /if _top_band_owner\(\[_t\.lower\(\)\]\):\s*\n\s*_blockers\.add\(_tname\)/.test(blk));
check('the predicate body is the original loop verbatim (top band: <= _HEADING_TOP_BAND_LINES or the frac; seg0 only; caption_ok=False)',
      /def _top_band_owner\(_phrases_lc\):\s*\n\s*for _i, _line in enumerate\(lines\):\s*\n\s*if not \(_i <= _HEADING_TOP_BAND_LINES\s*\n\s*or \(total and _i \/ total <= _HEADING_TOP_BAND_FRAC\)\):\s*\n\s*continue\s*\n\s*_seg0 = _COL_BREAK_RE\.split\(_line\.strip\(\)\.lower\(\)\)\[0\]\.strip\(\)\s*\n\s*if not _seg0:\s*\n\s*continue\s*\n\s*if any\(_p and _segment_is_heading\(_seg0, _p, caption_ok=False\) for _p in _phrases_lc\):\s*\n\s*return True\s*\n\s*return False/.test(blk));
check('the blocker loop is nested under BOTH envs and needs a type list (inert otherwise)',
      new RegExp(`if \\(os\\.environ\\.get\\('${ENV}', '0'\\) != '0'\\s*\\n\\s*and os\\.environ\\.get\\('TYPE_UNINSTALLED_HEADING_FOLD', '0'\\) != '0'[^\\n]*\\n\\s*and known_types is not None\\):`).test(blk));
check('C1: installed names ∪ their ALIASES are excluded from blockers (never name_alias_lc)',
      /_installed_claims = \{str\(n or ''\)\.strip\(\)\.lower\(\) for n in known_types\}/.test(blk)
      && /for _a in \(\(aliases_by_name or \{\}\)\.get\(\(_n or ''\)\.strip\(\)\) or \[\]\):[\s\S]{0,200}_installed_claims\.add\(_al\)/.test(blk)
      && /if not _t or _t\.lower\(\) in _installed_claims or scores\.get\(_tname, 0\) <= 0:/.test(blk)
      && !/name_alias_lc/.test(blk.slice(blk.indexOf('_blockers = set()'))));
check('a blocker NEVER enters _owners; promotion needs exactly one owner AND no blocker',
      !/_owners\.add\(_tname\)/.test(blk) && /if len\(_owners\) == 1 and not _blockers:/.test(blk));
check('the promotion body itself is unchanged (score > 0, headings[owner] = True)',
      /if len\(_owners\) == 1 and not _blockers:\s*\n\s*_owner = next\(iter\(_owners\)\)\s*\n\s*if scores\.get\(_owner, 0\) > 0 and _owner != best_type:\s*\n\s*best_type = _owner\s*\n\s*headings\[_owner\] = True/.test(blk));
check('C7: the stale "DEFAULT OFF" / "DARK, mig 122" comments are corrected', /PROVEN_ON since mig 60/.test(py) && /GRADUATED to customer default in the mig-205 batch/.test(py));

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
