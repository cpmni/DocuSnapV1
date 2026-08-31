'use strict';

// P3 — identity-scoped cover-window teardown for the login/license/onboarding → main swap.
//
// When the app swaps from a "cover" window (login / license / onboarding) to the
// main shell, the cover windows must be destroyed. The original openMainShell
// destroyed them BY NAME at fire time (`destroyWindow('onboarding')`) and armed an
// uncancelled 12-second backstop timer whose handle was never stored. Because the
// lookup happened at FIRE time, a timer armed while one wizard was on screen could
// destroy a DIFFERENT wizard that had since been created in the same
// `windows['onboarding']` slot — the "the first-run wizard closes itself after ~12
// seconds" bug (HANDOVER_2026-07-21_LATE §3).
//
// The fix captures the ACTUAL BrowserWindow instances at ARM time and closes only
// those exact instances. `_allowClose = true` tells the primary-window close
// interceptor in main.js to let the close THROUGH (a real destroy), rather than the
// hide-to-tray it applies to a user-initiated close.
function closeCoverWindows(covers) {
  for (const w of (covers || [])) {
    if (w && !w.isDestroyed()) {
      w._allowClose = true;
      w.close();
    }
  }
}

// Wire `teardown` to the correct moment of a shell swap. Kept pure w.r.t. the window
// system — the `main` window and the timer fns are injected — so the arm/cancel logic
// is unit-testable with a fake window + spy timers (no BrowserWindow, no real timers).
//
//  - REUSE (`mainExisted`): createWindow returned an already-painted main and revealed
//    it (restore/show/focus), so run `teardown` NOW. There is no blank-swap to hide, and
//    'ready-to-show' will never re-fire (it only fires on a fresh load) — which is exactly
//    why the old 12s timer became the sole, DELAYED teardown that fired mid-interaction.
//    ⚠ INVARIANT: reuse ⇒ main is already painted. True for every current caller of
//    openMainShell; a future caller that re-enters right after a FRESH open (main exists
//    but has not yet painted) would violate it — capture `mainExisted` before createWindow.
//  - FRESH: `teardown` on 'ready-to-show' (seamless swap once the shell paints), with a
//    backstop timer that still tears the covers down if 'ready-to-show' never fires (a
//    wedged renderer). The timer handle is stored and cleared on 'ready-to-show' (and on
//    'closed', so a main destroyed BEFORE it paints leaves the covers up rather than
//    tearing down into a zero-window state). The 'closed' hook is dropped once
//    'ready-to-show' wins, so no closure is retained for main's lifetime.
function scheduleCoverTeardown({
  main,
  mainExisted,
  teardown,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  delayMs = 12000,
}) {
  if (!main || main.isDestroyed()) { teardown(); return; }
  if (mainExisted) { teardown(); return; }   // reuse ⇒ already painted → swap now
  main.once('ready-to-show', teardown);
  const t = setTimeoutFn(teardown, delayMs);
  const onClosed = () => clearTimeoutFn(t);
  main.once('closed', onClosed);
  main.once('ready-to-show', () => {
    clearTimeoutFn(t);
    if (typeof main.removeListener === 'function') main.removeListener('closed', onClosed);
  });
}

module.exports = { closeCoverWindows, scheduleCoverTeardown };
