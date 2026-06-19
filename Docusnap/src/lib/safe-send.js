'use strict';

/*
 * Crash-safe webContents.send.
 *
 * A captured webContents — e.g. `event.sender` frozen in a Python-stdout-stream
 * closure — can be DESTROYED while the child is still streaming after its window
 * has closed. A raw `wc.send()` then throws an uncaught
 *   TypeError: Object has been destroyed
 * in the main process, which Electron surfaces as a native crash dialog with no
 * window attribution (so it can appear while the user is in an unrelated window).
 *
 * Optional-chaining (`win?.webContents.send`) only guards a NULL reference, not a
 * destroyed-but-still-referenced object — so we must check `isDestroyed()`. And
 * because a window can be torn down between the check and the send (TOCTOU), we
 * also wrap the send in try/catch. We LOG rather than swallow so a genuinely bad
 * payload (e.g. a non-clonable value) stays visible instead of being hidden.
 *
 * Factory form so the logger is injected — keeps the helper pure/testable
 * (Electron-as-Node) with no dependency on main.js module state.
 */
function makeSafeSend(logger) {
  return function safeSend(wc, channel, ...args) {
    if (wc && !wc.isDestroyed()) {
      try {
        wc.send(channel, ...args);
      } catch (e) {
        logger?.warn?.(`[safeSend] dropped '${channel}': ${e && e.message}`);
      }
    }
  };
}

module.exports = { makeSafeSend };
