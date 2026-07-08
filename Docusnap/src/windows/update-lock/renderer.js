'use strict';

// Forced-update lock screen. Shown only when a REACHABLE backend reported this build below the
// channel's min_supported_version (fail-open — never shown offline). Two ways out: Update (opens
// the store/download via the scheme-allowlisted main IPC) or Quit.

(async () => {
  try {
    const info = await window.docusnap.getUpdateInfo();
    const el = document.getElementById('ver');
    if (info && info.latestVersion) el.textContent = `You have ${info.currentVersion} — the latest is ${info.latestVersion}.`;
    else if (info) el.textContent = `You have version ${info.currentVersion}.`;
  } catch { /* leave the version line blank */ }
})();

document.getElementById('update')?.addEventListener('click', () => window.docusnap.openUpdateUrl());
document.getElementById('quit')?.addEventListener('click', () => window.docusnap.updateLockQuit());
