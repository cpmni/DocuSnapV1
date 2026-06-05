'use strict';

/**
 * ollama_handler.js
 * Handles Ollama status checking, model pulling, and Fast Mode suggestions.
 * Called from main.js register() alongside processing/handler.js.
 */

const os = require('os');

function register(ctx) {
  const { ipcMain, getDb, pythonExe, pythonArgs,
          notifyMainWindow, spawn, path, fs } = ctx;

  const learning = require('../../../database/modules/learning');

  // ── Check Ollama/AI status ─────────────────────────────────────────────────
  ipcMain.handle('get-ai-status', async () => {
    const py     = pythonExe();
    const script = ctx.resourcePath('python_backend', 'ollama_manager.py');
    return new Promise((resolve) => {
      const proc = spawn(py, pythonArgs(script, '--action', 'status'),
        { windowsHide: true });
      let out = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.on('close', () => {
        try { resolve(JSON.parse(out.trim())); }
        catch { resolve({ ai_ready: false, ollama_running: false }); }
      });
    });
  });

  // ── Get/set processing mode ────────────────────────────────────────────────
  ipcMain.handle('get-processing-mode', () => {
    return learning.getSetting(getDb(), 'processing_mode', 'smart');
  });

  ipcMain.handle('set-processing-mode', (_e, mode) => {
    learning.setSetting(getDb(), 'processing_mode', mode);
    notifyMainWindow('processing-mode-changed', mode);
    return true;
  });

  // ── Pull model on demand ───────────────────────────────────────────────────
  ipcMain.handle('pull-ai-model', async (event) => {
    const py     = pythonExe();
    const script = ctx.resourcePath('python_backend', 'ollama_manager.py');
    return new Promise((resolve) => {
      const proc = spawn(py,
        pythonArgs(script, '--action', 'pull-model', '--model', 'phi3:mini'),
        { windowsHide: true });
      let out = '';
      proc.stdout.on('data', (data) => {
        out += data.toString();
        const lines = out.split('\n');
        out = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            event.sender.send('pull-progress', msg);
          } catch {}
        }
      });
      proc.on('close', () => resolve({ success: true }));
    });
  });

  // ── Fast Mode suggestion ───────────────────────────────────────────────────
  // After confirming a document, check if this supplier has hit the threshold
  ipcMain.handle('check-fast-mode-suggestion', (_e, supplierName) => {
    if (!supplierName) return null;
    const db = getDb();

    const count = db.prepare(`
      SELECT COUNT(*) as n FROM documents
      WHERE supplier_name LIKE ?
        AND status = 'confirmed'
    `).get(`%${supplierName}%`);

    const THRESHOLD = 10;
    const currentMode = learning.getSetting(db, 'processing_mode', 'smart');

    if (count.n >= THRESHOLD && currentMode !== 'fast') {
      // Check we haven't already suggested this
      const suggested = learning.getSetting(
        db, `fast_mode_suggested_${supplierName}`, null
      );
      if (!suggested) {
        learning.setSetting(db, `fast_mode_suggested_${supplierName}`, 'true');
        return {
          suggest:      true,
          supplier:     supplierName,
          docCount:     count.n,
          currentMode,
        };
      }
    }
    return null;
  });
}

module.exports = { register };
