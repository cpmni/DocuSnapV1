'use strict';

// Unlock / Recover window. Shown by main at boot ONLY when the DB is encrypted but the
// no-prompt DPAPI cache can't open it — the two rows of the startup decision table that
// need the human's recovery code:
//   • 'restore' — the DB was restored from a backup on a NEW PC (no .db-key here yet)
//   • 'recover' — the .db-key cache is present but undecryptable (password reset / copied profile)
// Both do the same thing: the user types the printed database recovery code, main VERIFIES it
// against the DB header, caches it (DPAPI) and RELAUNCHES so the normal encrypted-open path runs.
// The renderer never opens the DB and never self-grants — main is the only decider.

const api = window.docusnap;
const $ = (id) => document.getElementById(id);

const SUBS = {
  restore: 'This database was restored from a backup. Enter your database recovery code to open it on this PC.',
  recover: 'We couldn’t unlock your database automatically on this PC. Enter your database recovery code to continue.',
};

// Mode pushed by main once the window has loaded (mirrors the license window's onLicenseState).
if (api && api.onUnlockState) {
  api.onUnlockState((state) => {
    const mode = (state && state.mode) || 'recover';
    $('sub').textContent = SUBS[mode] || SUBS.recover;
  });
}

const codeEl = $('code');
const btn = $('unlock');
const msg = $('msg');

function setMsg(text, cls) { msg.className = 'msg' + (cls ? ' ' + cls : ''); msg.textContent = text || ''; }

async function attempt() {
  const code = (codeEl.value || '').trim();
  if (!code) { setMsg('Enter your database recovery code.', 'err'); codeEl.focus(); return; }
  btn.disabled = true; codeEl.disabled = true;
  setMsg('Checking the code…');
  try {
    const res = await api.unlockRecover(code);
    if (res && res.ok) {
      // main will relaunch the app on success — just reassure while it restarts.
      setMsg('Unlocked — restarting ScanFinder…', 'ok');
      return;   // leave the controls disabled; the process is about to relaunch
    }
    // A wrong code is the common case; keep the data-loss language out of it (a typo isn't loss).
    setMsg(res && res.reason === 'invalid_format'
      ? 'That doesn’t look like a recovery code — check for missing characters.'
      : 'That code didn’t open the database. Check it and try again.', 'err');
  } catch {
    setMsg('Something went wrong checking the code. Try again.', 'err');
  }
  btn.disabled = false; codeEl.disabled = false; codeEl.focus(); codeEl.select();
}

btn.addEventListener('click', attempt);
codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });

$('quit').addEventListener('click', () => { if (api && api.unlockQuit) api.unlockQuit(); });
$('min').addEventListener('click', () => api.windowMinimise());
$('close').addEventListener('click', () => { if (api && api.unlockQuit) api.unlockQuit(); });

codeEl.focus();
