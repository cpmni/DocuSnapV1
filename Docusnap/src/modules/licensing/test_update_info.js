#!/usr/bin/env node
'use strict';

/**
 * src/modules/licensing/test_update_info.js
 * Guards the advisory update-info capture/resolve (slice 1). The load-bearing property:
 * captureUpdateInfo is TOTAL (never throws) so a malformed backend `update` block riding the
 * licence-validate response can NEVER brick the gate; resolveUpdateInfo is garbage-safe.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/modules/licensing/test_update_info.js
 */
const Database = require('better-sqlite3');
const { captureUpdateInfo, resolveUpdateInfo } = require('./handler');

let fails = 0;
function check(label, cond) { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; }

function makeDb() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
  return db;
}
const rawRow = db => { const r = db.prepare("SELECT value FROM settings WHERE key='update_info'").get(); return r ? r.value : null; };

console.log('captureUpdateInfo — persists a well-formed block');
{
  const db = makeDb();
  captureUpdateInfo(db, { latest_version: ' 2.1.0 ', update_url: ' ms-windows-store://pdp/?ProductId=X ' }, 1234);
  const row = JSON.parse(rawRow(db) || '{}');
  check("latest_version trimmed + stored", row.latest_version === '2.1.0');
  check("update_url trimmed + stored",     row.update_url === 'ms-windows-store://pdp/?ProductId=X');
  check("checked_at recorded",             row.checked_at === 1234);
}

console.log('\ncaptureUpdateInfo — TOTAL: ignores malformed, NEVER throws, NEVER null-over-good');
{
  const db = makeDb();
  // Seed a good value, then hammer with garbage — the good value must survive and nothing throws.
  captureUpdateInfo(db, { latest_version: '2.1.0', update_url: 'https://x' }, 1);
  const bad = [null, undefined, {}, [], 'str', 42,
               { latest_version: 123 }, { latest_version: '' }, { latest_version: '   ' },
               { update_url: 'https://x' }, { latest_version: null },
               Object.create(null)];
  let threw = false;
  for (const b of bad) { try { captureUpdateInfo(db, b, 2); } catch { threw = true; } }
  check("never throws on any malformed/garbage block", threw === false);
  check("good stored value NOT overwritten by garbage", JSON.parse(rawRow(db)).latest_version === '2.1.0');

  // A getter that throws (simulate a broken setSetting path) still must not escape.
  let threw2 = false;
  try { captureUpdateInfo(null /* bad db → setSetting throws */, { latest_version: '9.9.9' }, 3); } catch { threw2 = true; }
  check("never throws even when the DB write fails", threw2 === false);
}

console.log('\nresolveUpdateInfo — "is a newer version available?"');
{
  const db = makeDb();
  check("no row → updateAvailable false", resolveUpdateInfo(db, '2.0.0').updateAvailable === false);

  captureUpdateInfo(db, { latest_version: '2.1.0', update_url: 'https://store' }, 1);
  const r = resolveUpdateInfo(db, '2.0.0');
  check("latest > current → available + url", r.updateAvailable === true && r.updateUrl === 'https://store');
  check("reports current + latest",          r.currentVersion === '2.0.0' && r.latestVersion === '2.1.0');
  check("latest == current → not available", resolveUpdateInfo(db, '2.1.0').updateAvailable === false);
  check("client AHEAD (2.2.0) → not available", resolveUpdateInfo(db, '2.2.0').updateAvailable === false);
  check("url withheld when no update",       resolveUpdateInfo(db, '2.1.0').updateUrl === null);
}

console.log('\nresolveUpdateInfo — garbage-safe');
{
  const db = makeDb();
  db.prepare("INSERT INTO settings (key,value) VALUES ('update_info', ?)").run('not json{');
  let threw = false, r;
  try { r = resolveUpdateInfo(db, '2.0.0'); } catch { threw = true; }
  check("malformed JSON row → false, no throw", !threw && r.updateAvailable === false);

  const db2 = makeDb();
  captureUpdateInfo(db2, { latest_version: '2.1.0', update_url: 'https://x' }, 1);
  check("garbage current version → false, no throw", resolveUpdateInfo(db2, 'not-a-version').updateAvailable === false);
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
