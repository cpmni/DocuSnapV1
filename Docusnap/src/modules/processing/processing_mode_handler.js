'use strict';

/**
 * processing_mode_handler.js
 * Handles processing-mode get/set and Fast Mode suggestions.
 * Called from main.js register() alongside processing/handler.js.
 */

function register(ctx) {
  const { ipcMain, getDb, notifyMainWindow } = ctx;

  const learning = require('../../../database/modules/learning');
  const { requireRole, requireLogin } = require('../auth/handler');

  // ── Get/set processing mode ────────────────────────────────────────────────
  // Read: shown in the main shell's mode badge for every signed-in user.
  ipcMain.handle('get-processing-mode', () => {
    requireLogin();
    return learning.getSetting(getDb(), 'processing_mode', 'smart');
  });

  // Write: reachable two ways — the Admin-only Settings radio buttons, and
  // the post-confirm "Switch to Fast Mode?" toast that Edit users can also
  // see (they're the ones doing the confirming). Neither is Read Only's to
  // touch — they can't process or confirm anything that would trigger it.
  ipcMain.handle('set-processing-mode', (_e, mode) => {
    requireRole('admin', 'edit');
    learning.setSetting(getDb(), 'processing_mode', mode);
    notifyMainWindow('processing-mode-changed', mode);
    return true;
  });

  // ── AI (Ollama) availability ───────────────────────────────────────────────
  // Lightweight reachability probe for the Settings → Processing Mode "AI"
  // option, so the user can see whether AI mode will actually run rather than
  // silently falling back to Fast (engine.warmup() does that fallback at
  // processing time). Checks Ollama's /api/tags and whether the configured
  // model is present. Done from Node (no Python spawn) with a short timeout so
  // an absent Ollama fails fast instead of hanging the Settings window.
  const AI_MODEL = 'phi3:mini';
  ipcMain.handle('get-ai-status', async () => {
    requireLogin();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: controller.signal });
      if (!res.ok) return { available: false, model: AI_MODEL, reason: `Ollama responded ${res.status}` };
      const data = await res.json();
      const names = (data.models || []).map(m => m.name || m.model || '');
      const hasModel = names.some(n => n === AI_MODEL || n.startsWith(AI_MODEL + ':') || n.startsWith(AI_MODEL));
      return hasModel
        ? { available: true, model: AI_MODEL }
        : { available: false, model: AI_MODEL, reason: `Ollama is running but the ${AI_MODEL} model isn't installed (run: ollama pull ${AI_MODEL})` };
    } catch (e) {
      const reason = e.name === 'AbortError' ? 'Ollama not reachable (timed out)' : 'Ollama not running';
      return { available: false, model: AI_MODEL, reason };
    } finally {
      clearTimeout(timer);
    }
  });

  // ── Fast Mode suggestion ───────────────────────────────────────────────────
  // After confirming a document, check if this supplier has hit the threshold
  ipcMain.handle('check-fast-mode-suggestion', (_e, supplierName) => {
    requireRole('admin', 'edit');
    if (!supplierName) return null;
    const db = getDb();

    const count = db.prepare(`
      SELECT COUNT(*) as n FROM documents
      WHERE supplier_name LIKE ?
        AND status = 'confirmed'
    `).get(`%${supplierName}%`);

    const THRESHOLD = 10;
    const currentMode = learning.getSetting(db, 'processing_mode', 'fast');

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
