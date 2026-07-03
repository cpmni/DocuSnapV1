#!/usr/bin/env node
'use strict';
// Unit test for services/previewService.js getThumbnail + the shared file
// resolution it inherits from getDocumentPages (so list thumbnails and the
// full-page preview can't disagree about which on-disk file a doc maps to).
// Run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe src/services/test_previewservice.js

const Database = require('better-sqlite3');
const path = require('path');
const { getThumbnail, getDocumentPages, resolveDocFile } = require('./previewService');

let fail = 0;
const check = (label, cond) => { console.log(`  ${cond ? 'OK ' : 'BAD'} ${label}`); if (!cond) fail++; };

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE documents (
    id INTEGER PRIMARY KEY, working_path TEXT, stored_path TEXT,
    folder_path TEXT, original_filename TEXT
  )`);
  return db;
}

// Fake child_process proc that emits the given stdout then closes.
function fakeSpawn(captured, stdoutText) {
  return (py, args) => {
    captured.args = args;
    const handlers = { stdout: {}, stderr: {}, proc: {} };
    const proc = {
      stdout: { on: (ev, cb) => { handlers.stdout[ev] = cb; } },
      stderr: { on: (ev, cb) => { handlers.stderr[ev] = cb; } },
      on: (ev, cb) => { handlers.proc[ev] = cb; },
    };
    setImmediate(() => {
      if (stdoutText != null && handlers.stdout.data) handlers.stdout.data(Buffer.from(stdoutText));
      if (handlers.proc.close) handlers.proc.close(0);
    });
    return proc;
  };
}

function deps(extra) {
  return Object.assign({
    fs: { existsSync: () => false, readFileSync: () => Buffer.from('') },
    path,
    spawn: () => { throw new Error('spawn should not be called'); },
    pythonExe: () => 'python',
    pythonArgs: (...a) => a,
    renderScript: 'pages.py',
    log: () => {},
  }, extra);
}

(async () => {
  // 1) Missing path args → null, no resolution attempted.
  {
    const db = makeDb();
    const r = await getThumbnail(db, { docId: 1, folderPath: '', filename: '' }, deps());
    check('missing path args -> null', r === null);
    db.close();
  }

  // 2) Image file → data URI directly, prefers working_path (the shared resolver).
  {
    const db = makeDb();
    const wp = path.join('C:', 'inbox', '7.png');
    db.prepare('INSERT INTO documents (id, working_path, folder_path, original_filename) VALUES (?,?,?,?)')
      .run(7, wp, 'C:\\src', 'orig.png');
    const r = await getThumbnail(db, { docId: 7, folderPath: 'C:\\src', filename: 'orig.png' },
      deps({ fs: { existsSync: (p) => p === wp, readFileSync: () => Buffer.from('PNGBYTES') } }));
    check('image file -> png data URI', typeof r === 'string' && r.startsWith('data:image/png;base64,'));
    db.close();
  }

  // 3) Unresolvable file (nothing exists, no recoverable copy) → null fallback.
  {
    const db = makeDb();
    db.prepare('INSERT INTO documents (id, folder_path, original_filename) VALUES (?,?,?)')
      .run(9, 'C:\\gone', 'x.pdf');
    const r = await getThumbnail(db, { docId: 9, folderPath: 'C:\\gone', filename: 'x.pdf' }, deps());
    check('unresolvable file -> null (caller keeps its fallback)', r === null);
    db.close();
  }

  // 4) PDF → spawns pages.py WITH --thumb and returns the single URI string.
  {
    const db = makeDb();
    const src = path.join('C:\\src', 'doc.pdf');
    db.prepare('INSERT INTO documents (id, folder_path, original_filename) VALUES (?,?,?)')
      .run(11, 'C:\\src', 'doc.pdf');
    const captured = {};
    const uri = 'data:image/png;base64,QUJD';
    const r = await getThumbnail(db, { docId: 11, folderPath: 'C:\\src', filename: 'doc.pdf' },
      deps({ fs: { existsSync: (p) => p === src }, spawn: fakeSpawn(captured, JSON.stringify(uri)) }));
    check('pdf -> single data URI string', r === uri);
    check('pages.py invoked with --thumb', captured.args.includes('--thumb'));
    db.close();
  }

  // 5) PDF render failure (unparseable stdout) → null, not a throw.
  {
    const db = makeDb();
    const src = path.join('C:\\src', 'bad.pdf');
    db.prepare('INSERT INTO documents (id, folder_path, original_filename) VALUES (?,?,?)')
      .run(13, 'C:\\src', 'bad.pdf');
    const r = await getThumbnail(db, { docId: 13, folderPath: 'C:\\src', filename: 'bad.pdf' },
      deps({ fs: { existsSync: (p) => p === src }, spawn: fakeSpawn({}, 'not json') }));
    check('pdf render failure -> null', r === null);
    db.close();
  }

  // 6) Parity: getThumbnail and getDocumentPages resolve the SAME file path.
  {
    const db = makeDb();
    const wp = path.join('C:', 'inbox', '14.pdf');
    db.prepare('INSERT INTO documents (id, working_path, folder_path, original_filename) VALUES (?,?,?,?)')
      .run(14, wp, 'C:\\src', 'orig.pdf');
    const capThumb = {}, capPages = {};
    await getThumbnail(db, { docId: 14, folderPath: 'C:\\src', filename: 'orig.pdf' },
      deps({ fs: { existsSync: (p) => p === wp }, spawn: fakeSpawn(capThumb, JSON.stringify('data:image/png;base64,QQ==')) }));
    await getDocumentPages(db, { docId: 14, folderPath: 'C:\\src', filename: 'orig.pdf' },
      deps({ fs: { existsSync: (p) => p === wp }, spawn: fakeSpawn(capPages, JSON.stringify(['data:image/png;base64,QQ=='])) }));
    const fileOf = (args) => args[args.indexOf('--file') + 1];
    check('thumb + pages resolve the same file (working_path)', fileOf(capThumb.args) === wp && fileOf(capPages.args) === wp);
    db.close();
  }

  // 7) resolveDocFile (now shared by reprocess): a stale/nested folder_path must
  //    NOT defeat resolution — recover the FILED stored_path, exactly like the
  //    preview. This is the bug where an auto-filed doc whose original was drained
  //    into `Processed\Processed` reported "File not found" on reprocess while the
  //    preview still rendered it.
  {
    const db = makeDb();
    const stored   = 'C:\\output\\SuperStore\\2012\\Invoice.pdf';
    const staleDir = 'C:\\src\\Kyle Test\\Processed\\Processed';
    db.prepare('INSERT INTO documents (id, working_path, stored_path, folder_path, original_filename) VALUES (?,?,?,?,?)')
      .run(20, null, stored, staleDir, 'Invoice.pdf');

    const r1 = resolveDocFile(db, { docId: 20, folderPath: staleDir, filename: 'Invoice.pdf' },
      { fs: { existsSync: (p) => p === stored }, path, log: () => {} });
    check('resolveDocFile recovers stored_path when folder_path is stale (bug #3)', r1 === stored);

    // Working copy present → preferred outright.
    const wp = 'C:\\inbox\\20.pdf';
    db.prepare('UPDATE documents SET working_path = ? WHERE id = ?').run(wp, 20);
    const r2 = resolveDocFile(db, { docId: 20, folderPath: staleDir, filename: 'Invoice.pdf' },
      { fs: { existsSync: (p) => p === wp || p === stored }, path, log: () => {} });
    check('resolveDocFile prefers the working copy when it exists', r2 === wp);

    // Nothing on disk → null (an honest miss, never the stale path).
    const r3 = resolveDocFile(db, { docId: 20, folderPath: staleDir, filename: 'Invoice.pdf' },
      { fs: { existsSync: () => false }, path, log: () => {} });
    check('resolveDocFile returns null when nothing is recoverable', r3 === null);
    db.close();
  }

  console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll previewService thumbnail checks passed.');
  process.exit(fail ? 1 : 0);
})();
