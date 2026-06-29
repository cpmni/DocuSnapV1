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
    // Only ever store a mode the backend accepts (guards against a bad caller / legacy value).
    const safe = (mode === 'fast' || mode === 'smart' || mode === 'ai') ? mode : 'smart';
    learning.setSetting(getDb(), 'processing_mode', safe);
    notifyMainWindow('processing-mode-changed', safe);
    return true;
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
