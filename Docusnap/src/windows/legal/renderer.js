'use strict';
// First-run (and version-bump) Terms acceptance gate. The main process shows this
// window whenever the stored acceptance doesn't match the current LEGAL_VERSION, and
// only proceeds to onboarding/shell once the user accepts. Enforcement lives in main
// (see enterMainApp); this window merely records the user's choice.
const D = window.docusnap;

const docEl = document.getElementById('doc');
const cb = document.getElementById('accept-cb');
const cont = document.getElementById('continue');
const declineBtn = document.getElementById('decline');
const msg = document.getElementById('gate-msg');

let textOk = false;   // only allow acceptance once the terms actually loaded

(async () => {
  try {
    const { text } = await D.getLegalText();
    if (text && text.trim()) { docEl.textContent = text; textOk = true; }
    else {
      docEl.textContent = 'The Terms of Use could not be loaded. Please reopen them in a separate window, or decline. You cannot accept terms that have not loaded.';
      cb.disabled = true;
    }
  } catch {
    docEl.textContent = 'The Terms of Use could not be loaded. Please reopen them in a separate window, or decline.';
    cb.disabled = true;
  }
  syncContinue();
})();

// Accept is enabled ONLY when the terms loaded AND the box is ticked.
function syncContinue() { cont.disabled = !(textOk && cb.checked); }
cb.addEventListener('change', syncContinue);
cont.addEventListener('click', () => { if (textOk && cb.checked) D.legalAccept?.(); });

// Decline is a two-step confirm — a paid customer shouldn't lose access on a stray click,
// and the "relaunch to see the terms again" recovery isn't obvious, so we say it.
let declineArmed = false;
declineBtn.addEventListener('click', () => {
  if (!declineArmed) {
    declineArmed = true;
    declineBtn.textContent = 'Quit without accepting';
    msg.textContent = 'You can’t use Scan Finder without accepting. Accept above, or click again to quit (you can reopen and accept any time).';
    return;
  }
  D.legalDecline?.();
});
document.getElementById('openext').addEventListener('click', () => D.openLegal?.());
