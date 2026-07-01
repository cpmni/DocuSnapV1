'use strict';
// First-run (and version-bump) Terms acceptance gate. The main process shows this
// window whenever the stored acceptance doesn't match the current LEGAL_VERSION, and
// only proceeds to onboarding/shell once the user accepts. Enforcement lives in main
// (see enterMainApp); this window merely records the user's choice.
const D = window.docusnap;

const docEl = document.getElementById('doc');
const cb = document.getElementById('accept-cb');
const cont = document.getElementById('continue');

(async () => {
  try {
    const { text } = await D.getLegalText();
    docEl.textContent = text && text.trim() ? text : 'The Terms of Use could not be loaded. You can still open them in a separate window, or decline.';
  } catch {
    docEl.textContent = 'The Terms of Use could not be loaded. You can still open them in a separate window, or decline.';
  }
})();

cb.addEventListener('change', () => { cont.disabled = !cb.checked; });
cont.addEventListener('click', () => { if (cb.checked) D.legalAccept?.(); });
document.getElementById('decline').addEventListener('click', () => D.legalDecline?.());
document.getElementById('openext').addEventListener('click', () => D.openLegal?.());
