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
  no_cached_token:    'No verified licence yet — an online check is required.',
  config_error:       'Licence configuration could not be read.',
  gate_error:         'Licence check failed — please try again.',
};

function render(state) {
  const decision = (state && state.decision) || 'locked';
  const reason = (state && state.reason) || '';
  if (decision === 'locked_invalid') {
    $('state').textContent = 'This licence could not be verified.';
  } else if (decision === 'locked_needs_online') {
    $('state').textContent = 'An online verification is required to continue.';
  } else {
    $('state').textContent = REASONS[reason] || 'Access cannot continue on this device.';
  }
  $('reason').textContent = reason ? `(${reason})` : '';
}

// Initial blocked reason pushed by main when the window loads.
if (api && api.onLicenseState) api.onLicenseState(render);

// Pull current status for display (best-effort; does not gate).
async function refresh() {
  try {
    const s = await api.licenseGetStatus();
    if (s && s.state) $('state').textContent = `Status: ${s.state}` +
      (s.days_remaining != null ? ` · ${s.days_remaining} day(s) left` : '');
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
$('trial').addEventListener('click', async () => {
  $('trial').disabled = true;
  try { await api.licenseStartTrial(); } catch {}
  api.licenseEnterApp();
  $('trial').disabled = false;
});

// Activation: renderer only REQUESTS; main decides via the backend + verifier.
$('activate').addEventListener('click', async () => {
  const accountKey = $('key').value.trim();
  const deviceLabel = $('label').value.trim();
  const msg = $('msg');
  msg.className = 'msg'; msg.textContent = '';
  if (!accountKey) { msg.className = 'msg err'; msg.textContent = 'Enter an activation key.'; return; }
  $('activate').disabled = true;
  try {
    const res = await api.licenseActivate({ accountKey, deviceLabel });
    if (res && res.ok) {
      msg.className = 'msg ok'; msg.textContent = 'Activated. Opening…';
      api.licenseEnterApp(); // main re-decides on the freshly cached seat token
    } else {
      msg.className = 'msg err';
      msg.textContent = ACTIVATE_ERRORS[res && res.code] || 'Activation failed.';
    }
  } catch {
    msg.className = 'msg err'; msg.textContent = ACTIVATE_ERRORS.offline;
  }
  $('activate').disabled = false;
});

// Release this device's seat (revoke -> reactivate building block). Frees the
// seat server-side so it can be reactivated on another device; main clears the
// local seat token. Decision stays server-authoritative.
$('release').addEventListener('click', async () => {
  const accountKey = $('key').value.trim();
  const msg = $('msg');
  msg.className = 'msg'; msg.textContent = '';
  if (!accountKey) { msg.className = 'msg err'; msg.textContent = 'Enter your activation key to release this device.'; return; }
  $('release').disabled = true;
  try {
    const res = await api.licenseRevoke({ accountKey });
    if (res && res.ok) { msg.className = 'msg ok'; msg.textContent = 'This device was released.'; refresh(); }
    else { msg.className = 'msg err'; msg.textContent = ACTIVATE_ERRORS[res && res.code] || 'Could not release this device.'; }
  } catch {
    msg.className = 'msg err'; msg.textContent = ACTIVATE_ERRORS.offline;
  }
  $('release').disabled = false;
});

$('min').addEventListener('click', () => api.windowMinimise());
$('close').addEventListener('click', () => api.windowClose());

refresh();
