// Applies synchronously from localStorage so there's no flash on load.
// DOMContentLoaded syncs from DB and wires up the IPC listener.
(function () {
  const saved = localStorage.getItem('docusnap_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
})();

function applyTheme(theme) {
  localStorage.setItem('docusnap_theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
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
