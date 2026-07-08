'use strict';

// License window (Phase 2). Display-only + retry path. It NEVER decides access:
// "Check again" asks the MAIN process to re-decide (license-enter-app); main
// opens the shell only if the effective state allows. The renderer cannot
// self-grant. No activation UI yet (that arrives in Phase 3).

const api = window.docusnap;

const $ = (id) => document.getElementById(id);
const REASONS = {
  expired:            'Your trial or licence has expired.',
  revoked:            'This licence seat has been revoked.',
  seat_reassigned:    'This seat is now active on another device.',
  stale_past_grace:   'Offline grace has elapsed — an online check is required.',
  no_cached_token:    'Activation required — enter your activation key below to continue.',
  config_error:       'Licence configuration could not be read. Contact your administrator.',
  gate_error:         'Licence check failed — please try again.',
};

function render(state) {
  const decision = (state && state.decision) || 'locked';
  const reason = (state && state.reason) || '';
  if (decision === 'locked_invalid') {
    $('state').textContent = 'This licence could not be verified. Re-activate below to continue.';
  } else if (decision === 'locked_needs_online') {
    // Most commonly this device has never been activated; guide them to activate.
    $('state').textContent = (reason === 'no_cached_token')
      ? REASONS.no_cached_token
      : 'Activation required — an online verification is needed. Activate below or “Check again”.';
  } else {
    $('state').textContent = REASONS[reason] || 'Activation is required to use this device.';
  }
  // Raw reason codes (e.g. "no_cached_token") are internal diagnostics, not
  // end-user text — keep them out of the shipped activation screen.
  $('reason').textContent = '';

  // A denial state pushed here means a prior optimistic "Opening…" (from the trial
  // or activate flow) did NOT result in entry — the main process bounced back to
  // this window. Replace any lingering "Opening…" with the actual reason so the UI
  // never appears stuck, and re-enable the trial button for a retry.
  for (const id of ['trial_msg', 'msg']) {
    const el = $(id);
    if (el && /opening/i.test(el.textContent)) {
      el.className = 'msg err';
      el.textContent = $('state').textContent;
    }
  }
  if ($('trial')) $('trial').disabled = false;
}

// Initial blocked reason pushed by main when the window loads.
if (api && api.onLicenseState) api.onLicenseState(render);

// Pull current status for display (best-effort; does not gate).
// Raw backend/cache states that all mean "this device is not licensed yet". On a
// fresh machine licenseGetStatus reports one of these; show ONE clear message
// instead of leaking a raw token error (e.g. "Status: invalid_token").
const NO_LICENSE_STATES = new Set(
  ['invalid_token', 'invalid', 'unknown', 'none', 'no_token', 'no_entitlement', 'inactive']);

async function refresh() {
  try {
    const s = await api.licenseGetStatus();
    const state = s && s.state;
    if (state) {
      if (NO_LICENSE_STATES.has(state)) {
        $('state').textContent = 'No valid license found — activate below to continue.';
      } else if (state === 'expired') {
        $('state').textContent = REASONS.expired;
      } else if (state === 'revoked') {
        $('state').textContent = REASONS.revoked;
      } else {
        $('state').textContent = `Status: ${state}` +
          (s.days_remaining != null ? ` · ${s.days_remaining} day(s) left` : '');
      }
    }
    if (s && s.seats_total != null) $('seats').textContent = `Seats: ${s.seats_used}/${s.seats_total} in use`;
    else $('seats').textContent = '';
  } catch { /* ignore — main remains the decider */ }
}

const ACTIVATE_ERRORS = {
  seat_limit_reached: 'All seats for this licence are already in use.',
  unknown_account:    'That activation key was not recognised.',
  activation_failed:  'Activation failed. Check the key and try again.',
  not_bound:          'This device does not hold a seat to release.',
  revoke_failed:      'Could not release this device. Try again.',
  offline:            'Could not reach the licence server. Try again when online.',
};

$('recheck').addEventListener('click', () => { api.licenseEnterApp(); });

// Friendly, retryable failure messages for "Start trial" — a reviewer on a flaky/firewalled
// connection or hitting a busy server must see a clear "try again", never a dead button or a
// raw error. The backend client already times out (no infinite spin) and the button re-enables.
const TRIAL_LABEL   = ($('trial') && $('trial').textContent) || 'Start / resume trial';
const TRIAL_OFFLINE = "Couldn’t start your trial — check your internet connection and try again.";
const TRIAL_BUSY    = "The licence server is busy right now — please wait a moment and try again.";
const TRIAL_GENERIC = "Couldn’t start your trial — please try again in a moment.";
function failRetry(msgEl, btn, text) {   // a RETRYABLE failure (network/server) — invite a retry
  if (msgEl) { msgEl.className = 'msg err'; msgEl.textContent = text; }
  if (btn)   { btn.textContent = 'Try again'; btn.disabled = false; }
}
function failTrial(text) { failRetry($('trial_msg'), $('trial'), text); }
const ACTIVATE_LABEL = ($('activate') && $('activate').textContent) || 'Activate';
const RELEASE_LABEL  = ($('release')  && $('release').textContent)  || 'Release this device';
const ACT_OFFLINE = "Couldn’t activate — check your internet connection and try again.";
const REL_OFFLINE = "Couldn’t reach the licence server to release this device — check your connection and try again.";

// Basic email shape check (mirrors the main/backend validation). Empty is allowed
// here — email is optional — but a non-empty value must look like an address.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Start / Resume Trial: CAPTURE the customer identity (customer/company name +
// user name + email) FIRST, validate it, then persist the trial record (the
// backend resume-or-creates the 14-day window and stores the identity; main
// caches the signed trial token). We continue into the app ONLY if a valid trial
// is in force — never call the app-launch path (licenseEnterApp) until capture +
// the trial step have actually succeeded, so incomplete capture cannot silently
// proceed. Trials are no longer anonymous.
$('trial').addEventListener('click', async () => {
  const msg = $('trial_msg');
  const customerName = $('trial_customer').value.trim();
  const contactName  = $('trial_user').value.trim();
  const email        = $('trial_email').value.trim();

  msg.className = 'msg';
  if (!customerName) {
    msg.className = 'msg err'; msg.textContent = 'Enter a customer or company name to start the trial.';
    return;
  }
  if (email && !EMAIL_RE.test(email)) {
    msg.className = 'msg err'; msg.textContent = 'Enter a valid email address, or leave it blank.';
    return;
  }

  msg.textContent = 'Starting your trial…';
  $('trial').textContent = TRIAL_LABEL;     // reset any prior "Try again" while we attempt
  $('trial').disabled = true;
  try {
    // persists trial window + identity, caches token
    const res = await api.licenseStartTrial({ customerName, contactName, email });
    if (res && res.ok && res.state === 'active') {
      const left = (res.days_remaining != null) ? ` — ${res.days_remaining} day(s) remaining` : '';
      msg.className = 'msg ok';
      msg.textContent = (res.resumed ? 'Resuming your trial' : 'Trial started') + left + '. Opening…';
      api.licenseEnterApp();              // enter ONLY after capture/validation succeeds
      return;                             // leave the button disabled while the shell opens
    }
    if (res && res.state === 'expired') {
      msg.className = 'msg err';
      msg.textContent = 'Your trial has ended. Enter a licence key to continue.';
      $('trial').disabled = false;
    } else if (res && res.code === 'missing_fields') {
      msg.className = 'msg err';
      msg.textContent = 'Enter a customer or company name to start the trial.';
      $('trial').disabled = false;
    } else if (res && res.code === 'invalid_email') {
      msg.className = 'msg err';
      msg.textContent = 'Enter a valid email address, or leave it blank.';
      $('trial').disabled = false;
    } else if (res && res.offline) {
      failTrial(TRIAL_OFFLINE);           // couldn't reach the server to record the trial
    } else if (res && /rate|too.?many|busy|throttl|429|503/i.test(String((res && res.code) || ''))) {
      failTrial(TRIAL_BUSY);              // server rate-limiting / temporarily unavailable
    } else {
      failTrial(TRIAL_GENERIC);           // any other backend hiccup — still retryable
    }
  } catch {
    // Network error / timeout — never surface the raw error; offer a clear retry.
    failTrial(TRIAL_OFFLINE);
  }
});

// Activation: renderer only REQUESTS; main decides via the backend + verifier.
$('activate').addEventListener('click', async () => {
  const accountKey = $('key').value.trim();
  const deviceLabel = $('label').value.trim();
  const msg = $('msg');
  msg.className = 'msg'; msg.textContent = '';
  if (!accountKey) { msg.className = 'msg err'; msg.textContent = 'Enter an activation key.'; return; }
  msg.className = 'msg'; msg.textContent = 'Activating…';
  $('activate').textContent = ACTIVATE_LABEL;   // reset any prior "Try again"
  $('activate').disabled = true;
  try {
    const res = await api.licenseActivate({ accountKey, deviceLabel });
    if (res && res.ok) {
      msg.className = 'msg ok'; msg.textContent = 'Activated. Opening…';
      api.licenseEnterApp(); // main re-decides on the freshly cached seat token
      return;                // leave the button disabled while the shell opens
    }
    if (res && (res.offline || res.code === 'offline')) {
      failRetry(msg, $('activate'), ACT_OFFLINE);          // network — invite a retry
    } else {
      // A definite answer from the server (wrong key / no seats) — keep the specific guidance,
      // re-enable, but don't relabel "Try again" (retrying the same key won't help).
      msg.className = 'msg err';
      msg.textContent = ACTIVATE_ERRORS[res && res.code] || 'Activation failed.';
      $('activate').disabled = false;
    }
  } catch {
    failRetry(msg, $('activate'), ACT_OFFLINE);            // network error / timeout — no stack trace
  }
});

// Release this device's seat (revoke -> reactivate building block). Frees the
// seat server-side so it can be reactivated on another device; main clears the
// local seat token. Decision stays server-authoritative.
$('release').addEventListener('click', async () => {
  const accountKey = $('key').value.trim();
  const msg = $('msg');
  msg.className = 'msg'; msg.textContent = '';
  if (!accountKey) { msg.className = 'msg err'; msg.textContent = 'Enter your activation key to release this device.'; return; }
  msg.className = 'msg'; msg.textContent = 'Releasing this device…';
  $('release').textContent = RELEASE_LABEL;     // reset any prior "Try again"
  $('release').disabled = true;
  try {
    const res = await api.licenseRevoke({ accountKey });
    if (res && res.ok) {
      msg.className = 'msg ok'; msg.textContent = 'This device was released.';
      $('release').disabled = false; refresh();
    } else if (res && (res.offline || res.code === 'offline')) {
      failRetry(msg, $('release'), REL_OFFLINE);            // network — invite a retry
    } else {
      msg.className = 'msg err';
      msg.textContent = ACTIVATE_ERRORS[res && res.code] || 'Could not release this device.';
      $('release').disabled = false;
    }
  } catch {
    failRetry(msg, $('release'), REL_OFFLINE);              // network error / timeout — no stack trace
  }
});

$('min').addEventListener('click', () => api.windowMinimise());
$('close').addEventListener('click', () => api.windowClose());

refresh();
