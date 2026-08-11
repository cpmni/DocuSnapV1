'use strict';

/**
 * Login window — first-run admin setup, sign-in, forced password change,
 * and the two "forgot password" paths (admin-resets-you vs. one-time
 * admin-recovery code). Pure view-switcher: every screen posts to the
 * `docusnap.auth*` bridge and either re-renders itself with an error or
 * hands off to `authEnterApp()`, which tells main.js to swap to the main
 * window. This window has no navigation powers of its own by design.
 */

const api = window.docusnap;

const screens = {};
document.querySelectorAll('.screen').forEach((el) => { screens[el.id] = el; });

function showScreen(id) {
  Object.values(screens).forEach((el) => el.classList.remove('active'));
  screens[id].classList.add('active');
}

function setMsg(el, text, type = 'err') {
  if (!el) return;
  el.className = 'msg';
  if (text) {
    el.textContent = text;
    el.classList.add(type, 'visible');
  } else {
    el.textContent = '';
  }
}

function withBusy(button, label, fn) {
  return async (...args) => {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    try {
      await fn(...args);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  };
}

function onEnter(inputs, handler) {
  inputs.forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); handler(); }
    });
  });
}

// ── Titlebar ──────────────────────────────────────────────────────────────────
document.getElementById('btn-close').addEventListener('click', () => api.windowClose());

// ── Recovery-code display (shared by first-run setup and admin recovery) ─────
// After showing a freshly generated/rotated code, the only way out is the
// "I've saved it" acknowledgement — there is no back button, since the code
// cannot be retrieved again once this screen is left.
let _recoveryCodeContinue = null;

function showRecoveryCode(code, onContinue) {
  document.getElementById('recovery-code-text').textContent = code;
  const ack = document.getElementById('recovery-ack');
  const btn = document.getElementById('btn-recovery-continue');
  ack.checked = false;
  btn.disabled = true;
  _recoveryCodeContinue = onContinue;
  showScreen('screen-recovery-code');
}

document.getElementById('recovery-ack').addEventListener('change', (e) => {
  document.getElementById('btn-recovery-continue').disabled = !e.target.checked;
});
document.getElementById('btn-recovery-continue').addEventListener('click', () => {
  if (_recoveryCodeContinue) _recoveryCodeContinue();
});

// Copy / Print for the recovery code — the copy says "write it down or print it", so both
// must actually be possible without transcribing 16 characters by hand (Chris r2 2026-08-11).
// SECURITY NOTE: this puts the code on the clipboard at the user's explicit request — the
// same trade paper storage makes; nothing is logged or persisted here.
document.getElementById('btn-recovery-copy')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-recovery-copy');
  const code = document.getElementById('recovery-code-text').textContent.trim();
  try {
    await navigator.clipboard.writeText(code);
    btn.textContent = 'Copied ✓';
  } catch {
    btn.textContent = 'Copy failed — select it by hand';
  }
  setTimeout(() => { btn.textContent = 'Copy code'; }, 2500);
});
document.getElementById('btn-recovery-print')?.addEventListener('click', () => {
  // Print ONLY the code sheet: a print-scoped stylesheet hides the app chrome and shows a
  // dedicated block, so the printout is a clean quarter-page note rather than a screenshot.
  const code = document.getElementById('recovery-code-text').textContent.trim();
  let sheet = document.getElementById('recovery-print-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'recovery-print-sheet';
    document.body.appendChild(sheet);
    const style = document.createElement('style');
    style.textContent = `
      #recovery-print-sheet { display: none; }
      @media print {
        body > *:not(#recovery-print-sheet) { display: none !important; }
        #recovery-print-sheet { display: block; font-family: 'Segoe UI', sans-serif; color: #000; padding: 40px; }
        #recovery-print-sheet .rp-code { font-family: Consolas, monospace; font-size: 22px; letter-spacing: 2px;
          border: 1px solid #000; padding: 14px 18px; display: inline-block; margin: 16px 0; }
      }`;
    document.head.appendChild(style);
  }
  sheet.innerHTML = `
    <h2>ScanFinder — admin recovery code</h2>
    <div class="rp-code"></div>
    <p>This one-time code is the only way back in if the administrator password is lost and no
    other active Admin account exists. It works once: using it generates a new code and
    invalidates this one. Store this sheet somewhere safe and offline.</p>`;
  sheet.querySelector('.rp-code').textContent = code;
  window.print();
});

// ── First-run admin setup ─────────────────────────────────────────────────────
const setupMsg = document.getElementById('setup-msg');
const setupInputs = {
  username: document.getElementById('setup-username'),
  displayName: document.getElementById('setup-display-name'),
  password: document.getElementById('setup-password'),
  confirm: document.getElementById('setup-confirm'),
};
const btnSetupSubmit = document.getElementById('btn-setup-submit');

const submitSetup = withBusy(btnSetupSubmit, 'Creating account…', async () => {
  setMsg(setupMsg, '');
  const username = setupInputs.username.value.trim();
  const displayName = setupInputs.displayName.value.trim();
  const password = setupInputs.password.value;
  const confirmPassword = setupInputs.confirm.value;

  if (!username || !displayName) { setMsg(setupMsg, 'Username and display name are required.'); return; }
  if (password.length < 8) { setMsg(setupMsg, 'Password must be at least 8 characters.'); return; }
  if (password !== confirmPassword) { setMsg(setupMsg, 'Passwords do not match.'); return; }

  const result = await api.authFirstRunSetup({ username, displayName, password, confirmPassword });
  if (!result || !result.success) {
    setMsg(setupMsg, (result && result.error) || 'Could not create the administrator account.');
    return;
  }

  showRecoveryCode(result.recoveryCode, () => api.authEnterApp());
});

btnSetupSubmit.addEventListener('click', submitSetup);
onEnter(Object.values(setupInputs), submitSetup);

// ── Login ─────────────────────────────────────────────────────────────────────
const loginMsg = document.getElementById('login-msg');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const btnLoginSubmit = document.getElementById('btn-login-submit');

const submitLogin = withBusy(btnLoginSubmit, 'Signing in…', async () => {
  setMsg(loginMsg, '');
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  if (!username || !password) { setMsg(loginMsg, 'Enter your username and password.'); return; }

  const result = await api.authLogin({ username, password });
  if (!result || !result.success) {
    let text = (result && result.error) || 'Could not sign in.';
    if (result && result.retryAfterMs) {
      const secs = Math.ceil(result.retryAfterMs / 1000);
      text += ` Try again in ${secs}s.`;
    }
    setMsg(loginMsg, text);
    loginPassword.value = '';
    loginPassword.focus();
    return;
  }

  loginPassword.value = '';
  if (result.mustChangePassword) {
    setMsg(document.getElementById('must-change-msg'), '');
    showScreen('screen-must-change');
    document.getElementById('mc-password').focus();
  } else {
    api.authEnterApp();
  }
});

btnLoginSubmit.addEventListener('click', submitLogin);
onEnter([loginUsername, loginPassword], submitLogin);

document.getElementById('btn-forgot-password').addEventListener('click', () => {
  setMsg(loginMsg, '');
  showScreen('screen-forgot');
});

// ── Forced password change (must_change_password) ───────────────────────────
const mcMsg = document.getElementById('must-change-msg');
const mcPassword = document.getElementById('mc-password');
const mcConfirm = document.getElementById('mc-confirm');
const btnMcSubmit = document.getElementById('btn-must-change-submit');

const submitMustChange = withBusy(btnMcSubmit, 'Saving…', async () => {
  setMsg(mcMsg, '');
  const newPassword = mcPassword.value;
  const confirmPassword = mcConfirm.value;
  if (newPassword.length < 8) { setMsg(mcMsg, 'Password must be at least 8 characters.'); return; }
  if (newPassword !== confirmPassword) { setMsg(mcMsg, 'Passwords do not match.'); return; }

  const result = await api.authSetNewPasswordAfterReset({ newPassword, confirmPassword });
  if (!result || !result.success) {
    setMsg(mcMsg, (result && result.error) || 'Could not set the new password.');
    return;
  }
  mcPassword.value = '';
  mcConfirm.value = '';
  api.authEnterApp();
});

btnMcSubmit.addEventListener('click', submitMustChange);
onEnter([mcPassword, mcConfirm], submitMustChange);

// ── Forgot password (informational hub) ─────────────────────────────────────
document.getElementById('btn-forgot-back').addEventListener('click', () => {
  showScreen('screen-login');
  loginUsername.focus();
});
document.getElementById('btn-go-recover-admin').addEventListener('click', () => {
  setMsg(document.getElementById('recover-msg'), '');
  document.getElementById('recover-code').value = '';
  document.getElementById('recover-password').value = '';
  document.getElementById('recover-confirm').value = '';
  showScreen('screen-recover-admin');
  document.getElementById('recover-code').focus();
});

// ── Admin recovery via one-time code ─────────────────────────────────────────
const recoverMsg = document.getElementById('recover-msg');
const recoverCode = document.getElementById('recover-code');
const recoverPassword = document.getElementById('recover-password');
const recoverConfirm = document.getElementById('recover-confirm');
const btnRecoverSubmit = document.getElementById('btn-recover-submit');

const submitRecover = withBusy(btnRecoverSubmit, 'Resetting…', async () => {
  setMsg(recoverMsg, '');
  const recoveryCode = recoverCode.value.trim();
  const newPassword = recoverPassword.value;
  const confirmPassword = recoverConfirm.value;
  if (!recoveryCode) { setMsg(recoverMsg, 'Enter your recovery code.'); return; }
  if (newPassword.length < 8) { setMsg(recoverMsg, 'Password must be at least 8 characters.'); return; }
  if (newPassword !== confirmPassword) { setMsg(recoverMsg, 'Passwords do not match.'); return; }

  const result = await api.authRecoverAdmin({ recoveryCode, newPassword, confirmPassword });
  if (!result || !result.success) {
    setMsg(recoverMsg, (result && result.error) || 'Could not recover the account.');
    recoverPassword.value = '';
    recoverConfirm.value = '';
    return;
  }

  recoverCode.value = '';
  recoverPassword.value = '';
  recoverConfirm.value = '';
  showRecoveryCode(result.recoveryCode, () => api.authEnterApp());
});

btnRecoverSubmit.addEventListener('click', submitRecover);
onEnter([recoverCode, recoverPassword, recoverConfirm], submitRecover);

document.getElementById('btn-recover-back').addEventListener('click', () => {
  setMsg(recoverMsg, '');
  showScreen('screen-login');
  loginUsername.focus();
});

// ── Initial status check — decide first-run vs. sign-in ──────────────────────
(async function init() {
  try {
    const status = await api.authGetStatus();
    if (status && status.needsFirstRunSetup) {
      showScreen('screen-setup');
      setupInputs.username.focus();
    } else {
      showScreen('screen-login');
      loginUsername.focus();
    }
  } catch (e) {
    document.getElementById('loading-text').textContent =
      'Could not reach the application. Please restart ScanFinder.';
  }
})();
