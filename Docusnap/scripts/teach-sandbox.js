'use strict';
// Snapshot / restore for the TEACH-TEST sandbox (owner run, 2026-08-08).
//
// WHY THIS EXISTS. The teaching is the only part of the run a human has to do. Once 10 documents
// are taught, that state is worth more than the reprocess results it produces: the FIRST reprocess
// would otherwise consume the experiment, because reprocessing writes extractions back and the
// scopes then carry results from a particular flag configuration. Snapshot straight after the
// teaches and the 200-document batch can be replayed as many times as we like — switch off, switch
// on, any combination — from one evening of manual work.
//
//   snapshot <name>   safe while the app is RUNNING (SQLite online backup, not a file copy — a
//                     plain copy of a live WAL database can be torn)
//   restore  <name>   requires the app to be CLOSED, and refuses if it is not
//   list              what has been captured
//
// Run (Electron-as-Node — better-sqlite3 is built for the Electron ABI):
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/teach-sandbox.js <cmd> [name]
const path = require('path');
const fs = require('fs');

const REPO = 'c:/GIT Projects/Docusnap';
const Database = require(path.join(REPO, 'node_modules', 'better-sqlite3'));

const ROOT = process.env.TEACH_SANDBOX ||
             path.join(process.env.USERPROFILE || process.env.HOME, 'Desktop', 'TESTING', '_sandbox');
const USERDATA = path.join(ROOT, 'userData');
const SNAPS = path.join(ROOT, 'snapshots');
const DB = path.join(USERDATA, 'docusnap.db');
// Directories worth carrying with the DB. inbox holds the app-managed working copy of every
// imported document (documents.working_path) — reprocess reads THOSE, not the original folder, so a
// DB restored without them would point at files that no longer match.
const DIRS = ['inbox'];

const [, , cmd, name] = process.argv;
const die = (m) => { console.error(m); process.exit(1); };
const nameOk = (n) => n && /^[A-Za-z0-9._-]+$/.test(n);

function appRunning() {
  // An open SQLite file cannot be renamed on Windows. Cheap, exact liveness test — far better than
  // asking the operator whether they closed it.
  if (!fs.existsSync(DB)) return false;
  const probe = DB + '.lockprobe';
  try { fs.renameSync(DB, probe); fs.renameSync(probe, DB); return false; }
  catch { try { if (fs.existsSync(probe)) fs.renameSync(probe, DB); } catch {} return true; }
}

async function snapshot() {
  if (!nameOk(name)) die('usage: teach-sandbox.js snapshot <name>   (letters, digits, . _ - only)');
  if (!fs.existsSync(DB)) die(`no sandbox DB at ${DB} — seed it first with seed-teach-sandbox.js`);
  const dest = path.join(SNAPS, name);
  if (fs.existsSync(dest)) die(`snapshot "${name}" already exists — pick another name or delete it`);
  fs.mkdirSync(dest, { recursive: true });

  // SQLite ONLINE BACKUP: consistent even with the app running and mid-write. A cp of a live
  // WAL database can capture a torn page set, which would restore as a subtly corrupt DB.
  const db = new Database(DB, { readonly: true });
  await db.backup(path.join(dest, 'docusnap.db'));
  db.close();

  const copied = [];
  for (const d of DIRS) {
    const src = path.join(USERDATA, d);
    if (!fs.existsSync(src)) continue;
    fs.cpSync(src, path.join(dest, d), { recursive: true });
    copied.push(`${d} (${fs.readdirSync(src).length} files)`);
  }
  fs.writeFileSync(path.join(dest, 'snapshot.json'), JSON.stringify({
    name, taken_at: new Date().toISOString(), source: USERDATA, dirs: copied,
  }, null, 2));
  console.log(`snapshot "${name}" written to ${dest}`);
  console.log(`  docusnap.db + ${copied.join(', ') || 'no extra dirs'}`);
  console.log(`  (taken with the app ${appRunning() ? 'RUNNING — online backup, consistent' : 'closed'})`);
}

function restore() {
  if (!nameOk(name)) die('usage: teach-sandbox.js restore <name>');
  const src = path.join(SNAPS, name);
  if (!fs.existsSync(path.join(src, 'docusnap.db'))) die(`no snapshot "${name}" in ${SNAPS}`);
  if (appRunning()) {
    die('the sandbox app is RUNNING — close it before restoring.\n' +
        'Restoring underneath a live app would leave it holding a stale database handle and\n' +
        'writing changes back over the restored state.');
  }
  // Remove the WAL sidecars: leaving them beside a replaced main DB can replay journal frames
  // belonging to the OLD database on next open.
  for (const sfx of ['', '-wal', '-shm']) {
    const p = DB + sfx;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
  fs.copyFileSync(path.join(src, 'docusnap.db'), DB);
  for (const d of DIRS) {
    const from = path.join(src, d), to = path.join(USERDATA, d);
    if (!fs.existsSync(from)) continue;
    if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true });
  }
  const meta = JSON.parse(fs.readFileSync(path.join(src, 'snapshot.json'), 'utf8'));
  console.log(`restored "${name}" (taken ${meta.taken_at}) into ${USERDATA}`);
}

function list() {
  if (!fs.existsSync(SNAPS)) die(`no snapshots dir at ${SNAPS}`);
  const rows = fs.readdirSync(SNAPS).filter(d => fs.existsSync(path.join(SNAPS, d, 'docusnap.db')));
  if (!rows.length) return console.log(`no snapshots yet in ${SNAPS}`);
  console.log(`snapshots in ${SNAPS}:`);
  for (const r of rows) {
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(SNAPS, r, 'snapshot.json'), 'utf8')); } catch {}
    const db = new Database(path.join(SNAPS, r, 'docusnap.db'), { readonly: true });
    const n = (t) => { try { return db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { return '?'; } };
    console.log(`  ${r.padEnd(20)} ${meta.taken_at || '?'}  docs=${n('documents')} ` +
                `templates=${n('templates')} mappings=${n('template_field_mappings')} ` +
                `anchors=${n('field_anchors')} hints=${n('supplier_hints')}`);
    db.close();
  }
}

(async () => {
  if (cmd === 'snapshot') await snapshot();
  else if (cmd === 'restore') restore();
  else if (cmd === 'list') list();
  else {
    console.log('usage: teach-sandbox.js <snapshot|restore|list> [name]');
    console.log(`sandbox root: ${ROOT}   (override with TEACH_SANDBOX)`);
  }
})().catch(e => die(String(e && e.stack || e)));
