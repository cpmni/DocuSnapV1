// Applies synchronously from localStorage so there's no flash on load.
// DOMContentLoaded syncs from DB and wires up the IPC listener.

// Dark-FAMILY themes (drive native scrollbars/caret + the logo swap via data-mode).
const DARK_THEMES = new Set(['dark', 'midnight', 'graphite', 'festive', 'spooky']);

function _applyThemeAttrs(theme) {
  theme = theme || 'light';
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-mode', DARK_THEMES.has(theme) ? 'dark' : 'light');
}

(function () {
  const t = localStorage.getItem('docusnap_theme') || 'warm';   // default theme: Warm Paper
  _applyThemeAttrs(t);
  _rememberThemeFamily(t);   // seed the current theme's family anchor before any flip (hoisted decl)
})();

// Remember the most-recent theme of EACH family so the quick Light⇄Dark flip round-trips
// back to the user's actual selection instead of the base light/dark theme. Recorded here
// (not just in the flip handler) so a theme picked in Settings — or arriving via the
// theme-changed broadcast — updates its family's anchor in every window. Read by the main
// window's setLightDark(); keyed per family via DARK_THEMES.
function _rememberThemeFamily(theme) {
  try {
    localStorage.setItem(DARK_THEMES.has(theme) ? 'docusnap_theme_dark' : 'docusnap_theme_light', theme);
  } catch {}
}

function applyTheme(theme) {
  theme = theme || 'warm';
  localStorage.setItem('docusnap_theme', theme);
  _rememberThemeFamily(theme);
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
