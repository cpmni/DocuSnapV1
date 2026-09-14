'use strict';
/*
 * windowBounds.js — keep a REMEMBERED window position on a screen that still exists (pure; no Electron here).
 *
 * The search pop-out restores its last bounds from search-window-state.json. A position saved on a monitor that is
 * no longer connected (a laptop undocked, a second screen switched off), or one dragged mostly off the desktop,
 * makes Electron create the window OFF-SCREEN: it exists, its renderer runs, and the user sees nothing — exactly
 * "the search window doesn't open" (owner 2026-09-13/14; the stale-session explanation was unconfirmed). So a saved
 * position is honoured ONLY when a usable part of the window (MIN_VISIBLE px each way) lies inside some display's
 * work area; otherwise the position is dropped and Electron centres the window on the current screen. The SIZE is
 * kept (clamped to the largest work area so it can never exceed a screen).
 *
 *   sanitizeBounds({ x, y, width, height }, displays) → { x?, y?, width, height }
 *     displays = screen.getAllDisplays() (only .workArea {x,y,width,height} is read)
 */
const MIN_VISIBLE = 120;   // px of the window that must be on a screen for the saved position to count

function _num(v, fallback) { return Number.isFinite(v) ? v : fallback; }

function sanitizeBounds(saved, displays, defaults = { width: 1280, height: 820 }) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const areas = (Array.isArray(displays) ? displays : []).map(d => d && d.workArea).filter(a => a && a.width > 0 && a.height > 0);
  let width = Math.max(1, _num(s.width, defaults.width) | 0);
  let height = Math.max(1, _num(s.height, defaults.height) | 0);
  if (areas.length) {
    const maxW = Math.max(...areas.map(a => a.width)), maxH = Math.max(...areas.map(a => a.height));
    width = Math.min(width, maxW); height = Math.min(height, maxH);
  }
  const out = { width, height };
  const x = s.x, y = s.y;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !areas.length) return out;   // no position / no screens known → let Electron centre it
  const visible = areas.some(a => {
    const ix = Math.min(x + width, a.x + a.width) - Math.max(x, a.x);      // overlap width
    const iy = Math.min(y + height, a.y + a.height) - Math.max(y, a.y);    // overlap height
    return ix >= MIN_VISIBLE && iy >= MIN_VISIBLE;
  });
  if (visible) { out.x = x | 0; out.y = y | 0; }
  return out;
}

module.exports = { sanitizeBounds, MIN_VISIBLE };
