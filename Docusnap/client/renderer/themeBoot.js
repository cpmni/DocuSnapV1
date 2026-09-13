'use strict';
/*
 * client/renderer/themeBoot.js — the ONE theme applier shared by both client pages (the main window and
 * the search pop-out; client search parity S1, 2026-09-13). Applies synchronously from localStorage so
 * neither page flashes, and keeps the two pages in step: file:// pages share one localStorage, and a
 * `storage` event fires in every OTHER page when one writes the theme — so picking a theme in the main
 * window re-themes the pop-out live (and vice versa). Theme NAMES match the core's theme.css blocks
 * (:root[data-theme="…"]) so the pop-out can load the real shared theme.css.
 */
(function () {
  const THEMES = ['light', 'warm', 'slate', 'dark', 'midnight', 'graphite',
                  'spring', 'summer', 'autumn', 'winter', 'festive', 'festivelight', 'spooky'];
  const DARK_THEMES = new Set(['dark', 'midnight', 'graphite', 'festive', 'spooky']);
  const KEY = 'sf-client-theme';
  const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  function current() { const t = get(KEY, 'warm'); return THEMES.includes(t) ? t : 'warm'; }
  function applyAttrs(t) {
    const root = document.documentElement;
    root.setAttribute('data-theme', t);
    root.setAttribute('data-mode', DARK_THEMES.has(t) ? 'dark' : 'light');
  }
  // Persist + apply (the main window's applyTheme delegates here; the pop-out only reads).
  function apply(name) {
    const t = THEMES.includes(name) ? name : 'warm';
    set(KEY, t);
    set(DARK_THEMES.has(t) ? 'sf-client-dark' : 'sf-client-light', t);   // remember the last light/dark pick
    applyAttrs(t);
    return t;
  }
  applyAttrs(current());   // as early as possible
  const listeners = [];
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const t = current();
    applyAttrs(t);
    for (const fn of listeners) { try { fn(t); } catch {} }
  });
  window.ClientTheme = { THEMES, DARK_THEMES, current, apply, isDark: (t) => DARK_THEMES.has(t || current()), onChange: (fn) => listeners.push(fn) };
})();
