/** backfill-sample-angles.js — repair STALE template sample angles (Oracle SIGN-OFF-W/COND
 *  2026-08-11, conditions C1-C3 applied; the ruling and census live in the 08-11 handover).
 *
 *  WHY. Templates taught before the straighten round-trip carry sample_deskew_angle=0 while
 *  their sample frame is actually tilted; compose-scan trusts the 0 and misplaces every
 *  composed box by the sample's own undeclared tilt (the Castellan 'Ltc' class — with the true
 *  angle hand-set, customer_name went 5/19 -> 16/19 exact). No existing code path can fix a
 *  non-NULL angle: both the lazy heal and the teach-commit writer skip non-NULL rows by design.
 *
 *  DO-NO-HARM PREDICATE (Oracle C2 — exported as decide() and pinned in
 *  tests/test_backfill_sample_angles.js):
 *    stored NULL                        -> write detected
 *    stored 0.0 and |detected| >= 0.3   -> overwrite (the stale pre-round-trip zero)
 *    stored 0.0 and |detected| <  0.3   -> keep (compose fires from 0.2; a wrongly-added small
 *                                          angle would mis-place currently-correct templates)
 *    non-zero stored                    -> NEVER rewritten; census-flag |delta| >= 0.3 for owner
 *    sample file missing/unreadable     -> skip + report, never guess
 *
 *  Detection = ocr/detect_angle.py (verified same-regime as the app's 200-DPI pipeline:
 *  detect_skew_angle is DPI-invariant — measured 0.00 delta across all 8 live samples, C1).
 *
 *  USAGE (app MUST be closed for --apply; the script refuses a held DB):
 *    ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/backfill-sample-angles.js           # census only
 *    ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/backfill-sample-angles.js --apply   # backup + write
 */
const path = require('path'), fs = require('fs');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const LIVE_DB = process.env.BACKFILL_DB || path.join(process.env.APPDATA, 'ScanFinder', 'docusnap.db');
const DETECT = path.join(REPO, 'python_backend', 'ocr', 'detect_angle.py');

// Oracle C2. Pure — pinned in tests/test_backfill_sample_angles.js.
function decide(stored, detected) {
  if (detected == null || !isFinite(detected)) return { action: 'skip', why: 'no detection' };
  if (stored == null) return { action: 'write', angle: detected };
  if (stored === 0) {
    return Math.abs(detected) >= 0.3
      ? { action: 'overwrite', angle: detected }
      : { action: 'keep', why: '|detected| < 0.3' };
  }
  return Math.abs(stored - detected) >= 0.3
    ? { action: 'census-flag', why: `stored ${stored} vs detected ${detected}` }
    : { action: 'keep', why: 'non-zero stored, agrees' };
}
module.exports = { decide };

if (require.main === module) {
  const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));
  const apply = process.argv.includes('--apply');

  const db = new Database(LIVE_DB, { readonly: !apply });
  if (apply) {
    // Refuse a DB the app currently holds (standing rule: never write the live DB under the app).
    try { db.prepare('BEGIN IMMEDIATE').run(); db.prepare('ROLLBACK').run(); }
    catch (e) { console.error(`REFUSED: the app appears to hold the DB (${e.message}). Close ScanFinder first.`); process.exit(2); }
  }

  const rows = db.prepare(`
    SELECT t.id, t.name, t.sample_deskew_angle stored, d.working_path, d.stored_path
    FROM templates t LEFT JOIN documents d ON d.id = t.sample_document_id
    ORDER BY t.id`).all();

  const plan = [];
  for (const t of rows) {
    const file = (t.working_path && fs.existsSync(t.working_path)) ? t.working_path
               : (t.stored_path && fs.existsSync(t.stored_path)) ? t.stored_path : null;
    if (!file) { plan.push({ ...t, action: 'skip', why: 'sample file missing' }); continue; }
    const r = spawnSync('py', ['-3.12', '-P', DETECT, '--file', file], { encoding: 'utf8', windowsHide: true });
    let detected = null;
    try { const j = JSON.parse((r.stdout || '').trim()); if (typeof j.angle === 'number' && isFinite(j.angle)) detected = j.angle; } catch {}
    plan.push({ ...t, detected, ...decide(t.stored, detected) });
  }

  for (const p of plan) {
    console.log(`tpl ${String(p.id).padStart(3)} stored=${String(p.stored).padStart(5)} detected=${p.detected == null ? '  n/a' : p.detected.toFixed(2).padStart(5)}  ${p.action.toUpperCase()}${p.angle != null ? ' ' + p.angle.toFixed(2) : ''}${p.why ? ' (' + p.why + ')' : ''}  ${p.name}`);
  }
  const writes = plan.filter(p => p.action === 'write' || p.action === 'overwrite');
  const flags = plan.filter(p => p.action === 'census-flag');
  if (flags.length) console.log(`\nOWNER REVIEW NEEDED — non-zero stored angles disagreeing with detection (NOT written): ${flags.map(f => f.id).join(', ')}`);

  if (!apply) {
    console.log(`\ncensus only — ${writes.length} write(s) planned. Re-run with --apply (app closed) to write.`);
  } else if (!writes.length) {
    console.log('\nnothing to write.');
  } else {
    const backup = LIVE_DB.replace(/docusnap\.db$/, `docusnap_pre_angle_backfill_${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}.db`);
    fs.copyFileSync(LIVE_DB, backup);
    try { fs.copyFileSync(LIVE_DB + '-wal', backup + '-wal'); } catch {}
    console.log(`\nbackup: ${backup}`);
    const upd = db.prepare('UPDATE templates SET sample_deskew_angle = ? WHERE id = ? AND (sample_deskew_angle IS NULL OR sample_deskew_angle = 0.0)');
    const tx = db.transaction(() => { for (const p of writes) upd.run(p.angle, p.id); });
    tx();
    for (const p of writes) {
      const now = db.prepare('SELECT sample_deskew_angle a FROM templates WHERE id = ?').get(p.id);
      console.log(`  tpl ${p.id}: sample_deskew_angle -> ${now.a}`);
    }
    console.log(`applied ${writes.length} write(s).`);
  }
  db.close();
}
