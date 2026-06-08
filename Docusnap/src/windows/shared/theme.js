// Applies synchronously from localStorage so there's no flash on load.
// DOMContentLoaded syncs from DB and wires up the IPC listener.
(function () {
  const saved = localStorage.getItem('docusnap_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();

function applyTheme(theme) {
  localStorage.setItem('docusnap_theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const dbTheme = await window.docusnap.getSetting('theme');
    if (dbTheme && dbTheme !== localStorage.getItem('docusnap_theme')) {
      applyTheme(dbTheme);
    }
  } catch {}
  window.docusnap.onThemeChanged(applyTheme);
});
