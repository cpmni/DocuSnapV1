// Applies synchronously from localStorage so there's no flash on load.
// DOMContentLoaded syncs from DB and wires up the IPC listener.

// Dark-FAMILY themes (drive native scrollbars/caret + the logo swap via data-mode).
const DARK_THEMES = new Set(['dark', 'midnight', 'graphite']);

function _applyThemeAttrs(theme) {
  theme = theme || 'light';
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-mode', DARK_THEMES.has(theme) ? 'dark' : 'light');
}

(function () {
  _applyThemeAttrs(localStorage.getItem('docusnap_theme') || 'warm');   // default theme: Warm Paper
})();

function applyTheme(theme) {
  theme = theme || 'warm';
  localStorage.setItem('docusnap_theme', theme);
  _applyThemeAttrs(theme);
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const dbTheme = await (window.docusnap && window.docusnap.getSetting && window.docusnap.getSetting('theme'));
    if (dbTheme && dbTheme !== localStorage.getItem('docusnap_theme')) {
      applyTheme(dbTheme);
    }
  } catch {}
  // Guard: some secondary windows use a narrower preload bridge.
  if (window.docusnap && typeof window.docusnap.onThemeChanged === 'function') {
    window.docusnap.onThemeChanged(applyTheme);
  }
});
