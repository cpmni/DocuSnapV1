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

  // Write: retained for tolerance (a legacy caller / stored value), still admin/edit-gated.
  // The user-facing Fast/Smart selector was removed when the two modes were collapsed into
  // one, so nothing in the UI calls this anymore — but a valid stored mode is still honoured.
  ipcMain.handle('set-processing-mode', (_e, mode) => {
    requireRole('admin', 'edit');
    // Only ever store a mode the backend accepts (guards against a bad caller / legacy value).
    const safe = (mode === 'fast' || mode === 'smart') ? mode : 'smart';
    learning.setSetting(getDb(), 'processing_mode', safe);
    notifyMainWindow('processing-mode-changed', safe);
    return true;
  });

  // ── Fast Mode suggestion (RETIRED) ─────────────────────────────────────────
  // Fast and Smart became identical after the AI-mode removal, so the modes were collapsed
  // and the "Switch to Fast Mode?" toast retired. The handler stays registered (the preload
  // still exposes it) but is now a no-op that never suggests — safe for any stray caller.
  ipcMain.handle('check-fast-mode-suggestion', () => {
    requireRole('admin', 'edit');
    return null;
  });
}

module.exports = { register };
