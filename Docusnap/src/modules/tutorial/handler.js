'use strict';

// ── Tutorial ("practice run") backend ────────────────────────────────────────
// A fully SANDBOXED beginner walkthrough of Import → Review → Confirm. The whole
// simulation runs in the renderer against pre-baked fixtures; it NEVER touches the
// real docusnap.db, the learning corpus, the review queue, or the user's output
// folder. This module exposes exactly ONE filesystem side-effect — copying a
// bundled sample PDF into a throwaway TEMP folder so the "before → after filing"
// reveal is real — plus teardown. There is NO db access here, by design (see the
// eric/bob advisory: isolation is structural — no wired path to any write handler).

const path = require('path');
const fs   = require('fs');
const { shell } = require('electron');

// Everything the practice run writes lives under ONE temp dir, wiped on teardown.
function practiceRoot(ctx) {
  return path.join(ctx.app.getPath('temp'), 'scanfinder-practice');
}

// Windows-safe a single path segment (mirrors the real filing sanitiser's intent,
// kept local so the tutorial has zero coupling to the filing module).
function safeSeg(s) {
  return String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim() || 'Untitled';
}

function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

function register(ctx) {
  const { ipcMain, resourcePath, logger } = ctx;

  // Copy a bundled sample PDF into the temp practice tree under a tidy, real-looking
  // filed name/path, so the reveal ("scan001.pdf → Invoice.15-06-2026.INV-1042.pdf")
  // is a genuine file on disk the user can open — but only ever in TEMP.
  // body: { sampleFile, company, year, month, filedName }
  ipcMain.handle('tutorial-file-sample', async (_e, body) => {
    try {
      const b = body || {};
      const src = resourcePath('assets', 'tutorial-samples', safeSeg(b.sampleFile || 'sample1.pdf'));
      if (!fs.existsSync(src)) return { success: false, error: 'sample not found' };

      const folder = path.join(practiceRoot(ctx),
        safeSeg(b.company), safeSeg(b.year), safeSeg(b.month));
      fs.mkdirSync(folder, { recursive: true });

      const filed = path.join(folder, safeSeg(b.filedName || 'Document') + '.pdf');
      fs.copyFileSync(src, filed);
      return { success: true, path: filed, folder, root: practiceRoot(ctx) };
    } catch (err) {
      logger?.warn?.('tutorial-file-sample failed: ' + err.message);
      return { success: false, error: err.message };
    }
  });

  // Open the practice folder. The generic 'open-folder' IPC only allows app-managed
  // roots (output folder etc.), which correctly rejects this TEMP path — so the tutorial
  // opens its OWN, known-safe folder directly (only ever the practice tree under TEMP).
  ipcMain.on('tutorial-open-folder', () => {
    const root = practiceRoot(ctx);
    try { if (fs.existsSync(root)) shell.openPath(root); } catch (e) { logger?.warn?.('tutorial-open-folder: ' + e.message); }
  });

  // Teardown — wipe the whole practice tree (called on window close / app quit).
  ipcMain.handle('tutorial-cleanup', async () => {
    rmDir(practiceRoot(ctx));
    return { success: true };
  });
}

module.exports = { register, practiceRoot, _safeSeg: safeSeg };
