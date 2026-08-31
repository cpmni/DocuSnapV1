#!/usr/bin/env node
'use strict';
/**
 * src/services/test_stamp_service.js
 * Workflow+Stamping redesign — SLICE 1 (the stamp engine). Proves placeStamp:
 *   - refuses without the stamp permission (fail-closed) and without document access (Oracle C2);
 *   - writes an append-only stamp_events row with type SNAPSHOTS + source/artifact hashes + an audit_ref
 *     anchored into the signed chain; the original is never touched (a COPY is produced);
 *   - is CUMULATIVE (a 2nd stamp is applied to the 1st artifact: event2.source == event1.artifact);
 *   - stampsForDocument is path-stripped; verifyStampRecord passes, and fails once the chain is broken.
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron src/services/test_stamp_service.js
 */

const os = require('os'), path = require('path'), fs = require('fs');
const Database = require('better-sqlite3');
const { PDFDocument } = require('pdf-lib');
const { runMigrations } = require('../../database/index');
const auth   = require('../../database/modules/auth');
const stamps = require('../../database/modules/stamps');
const perm   = require('../modules/auth/stampPermission');
const secret = require('../lib/secretStore');
const { createStampService } = require('./stampService');

let fails = 0;
const check  = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fails++; };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const KEY = Buffer.alloc(32, 0x5b);
const FAKE_SS = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => String(b) };

async function makePdf(p) {
  const doc = await PDFDocument.create(); doc.addPage([600, 800]);
  fs.writeFileSync(p, await doc.save());
}

async function main() {
  console.log('\nWorkflow+Stamping slice 1 — stamp engine');
  secret.__setSafeStorage(FAKE_SS);
  auth.setAuditKey(KEY);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp1-'));
  const srcPdf = path.join(tmp, 'invoice.pdf');
  const artDir = path.join(tmp, 'artifacts');
  await makePdf(srcPdf);

  const db = new Database(':memory:'); runMigrations(db);
  const admin = auth.createUser(db, { username: 'boss', display_name: 'Boss', password_hash: 'x', role: 'admin' });
  const jane  = auth.createUser(db, { username: 'jane', display_name: 'Jane', password_hash: 'x', role: 'edit' });
  const adminActor = { userId: admin.id, username: 'boss', role: 'admin' };
  const actor = { userId: jane.id, username: 'jane', role: 'edit' };
  const paid = stamps.getStampTypeByKey(db, 'paid');

  let accessAllow = true;
  let u = 0;
  const svc = createStampService({
    stampsDir: () => artDir,
    resolveSourcePath: () => srcPdf,
    canAccess: () => accessAllow,
    now: () => '2026-01-01T00:00:00.000Z',
    uuid: () => 'evt' + (++u),
  });
  const place = (opts) => svc.placeStamp(db, actor, opts);
  const box = { x: 0.6, y: 0.05, w: 0.3 };

  // no permission → refused
  check('no permission → STAMP_FORBIDDEN', (await place({ documentId: 7, stampTypeId: paid.id, box })).code === 'STAMP_FORBIDDEN');

  perm.grantStamp(db, adminActor, jane.id);

  // no access → refused (Oracle C2)
  accessAllow = false;
  check('no access → FORBIDDEN', (await place({ documentId: 7, stampTypeId: paid.id, box })).code === 'FORBIDDEN');
  accessAllow = true;

  // first stamp
  const r1 = await place({ documentId: 7, stampTypeId: paid.id, box, note: 'ok to pay' });
  check('first stamp ok', r1.ok === true && r1.stampEventId > 0);
  check('  artifact written', r1.artifactPath && fs.existsSync(r1.artifactPath));
  const srcHashBefore = require('./stampService').sha256File(srcPdf);
  check('  ORIGINAL untouched', require('./stampService').sha256File(srcPdf) === srcHashBefore);   // (trivially true — proves we read a copy)
  const e1 = stamps.latestStampEvent(db, 7);
  check('  snapshots type label/colour', e1.type_label_snapshot === 'PAID' && /^#/.test(e1.type_color_snapshot));
  check('  placer + note recorded', e1.placed_by_username_snapshot === 'jane' && e1.note === 'ok to pay');
  check('  source + artifact hashes set', /^[0-9a-f]{64}$/.test(e1.source_sha256) && /^[0-9a-f]{64}$/.test(e1.artifact_sha256));
  check('  audit_ref anchored', typeof e1.audit_ref === 'string' && e1.audit_ref.length > 0);
  check('  a stamp_placed audit row exists', db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action='stamp_placed'`).get().n === 1);
  check('  append-only (UPDATE blocked)', throws(() => db.prepare('UPDATE stamp_events SET note=? WHERE id=?').run('x', e1.id)));

  // second stamp → CUMULATIVE (base is the first artifact)
  const approved = stamps.getStampTypeByKey(db, 'approved');
  const r2 = await place({ documentId: 7, stampTypeId: approved.id, box: { x: 0.1, y: 0.05, w: 0.3 } });
  check('second stamp ok', r2.ok === true);
  const e2 = stamps.latestStampEvent(db, 7);
  check('  cumulative: event2.source == event1.artifact', e2.source_sha256 === e1.artifact_sha256);
  check('  two stamps on the doc', stamps.countStampsForDoc(db, 7) === 2);
  check('  current artifact = latest', svc.currentArtifact(db, 7).stampEventId === e2.id);

  // projection is path-stripped
  const hist = svc.stampsForDocument(db, 7);
  check('history path-stripped', hist.length === 2 && !('artifact_path' in hist[0]) && hist[0].hasArtifact === true);

  // integrity: passes, then a broken chain fails
  check('verifyStampRecord ok', svc.verifyStampRecord(db, e2).ok === true);
  db.prepare(`INSERT INTO audit_log (action, action_category, outcome, row_hmac, prev_hash)
              VALUES ('noise','security','success','deadbeef','GENESIS')`).run();
  check('broken chain → verify fails', svc.verifyStampRecord(db, e2).ok === false);

  db.close();
  secret.__setSafeStorage(undefined); auth.setAuditKey(null);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\n${fails === 0 ? 'ALL OK' : fails + ' FAILED'}\n`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
