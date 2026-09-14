'use strict';
// clientTeachHost.js — the detached CLIENT's CHROME adapter for the shared teach wizard (teach-over-client
// S1, 2026-09-14; the coreTeachHost.js twin). window.TeachHost carries the window-lifecycle + navigation the
// wizard needs; on the client it drives THIS pop-out window and the client preload bridge. Loaded BEFORE
// teach.js (which reads window.TeachHost at module load and self-boots).
//
//   windowMinimise / windowClose  — the pop-out uses a native OS frame (the custom .titlebar is hidden by
//                                    theme.css), so the frame handles min/close; windowClose also backs the
//                                    wizard's own "Done" / Cancel via window.close().
//   openHelpWindow                — no client help window in S1 → no-op (the guide stays on the core).
//   getTeachTarget / onTeachLoadDoc — the doc the pop-out was opened at (pulled once) + a later deep-link.
//   openReviewWindow(At)          — the client has no core Review window (caps.review=false hides the button);
//                                    defined as no-ops so a stray call can never be "not a function".
(function () {
  const api = window.scanfinder;
  window.TeachHost = {
    windowMinimise:     () => { try { if (api && api.windowMinimise) api.windowMinimise(); } catch {} },
    windowClose:        () => { try { window.close(); } catch {} },
    openHelpWindow:     () => {},
    getTeachTarget:     async () => { try { const t = await api.teachTarget(); return (t && t.docId) || null; } catch { return null; } },
    onTeachLoadDoc:     (cb) => { try { if (api && api.onTeachLoadDoc) api.onTeachLoadDoc(cb); } catch {} },
    openReviewWindow:   () => {},
    openReviewWindowAt: () => {},
  };
})();
