'use strict';

const api = window.docusnap;

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
  });
});

document.getElementById('btn-close').addEventListener('click', () => api.windowClose());

// ══════════════════════════════════════════════════════════════════════════════
// GENERAL TAB
// ══════════════════════════════════════════════════════════════════════════════

// ── Output folder ─────────────────────────────────────────────────────────────
async function loadOutputFolder() {
  const val = await api.getSetting('output_folder');
  document.getElementById('output-folder-path').value = val || '';
}
loadOutputFolder();

document.getElementById('btn-pick-output').addEventListener('click', async () => {
  const folder = await api.pickOutputFolder();
  if (folder) {
    await api.setSetting('output_folder', folder);
    document.getElementById('output-folder-path').value = folder;
  }
});

// ── Processed folder ──────────────────────────────────────────────────────────
async function loadProcessedFolder() {
  const val = await api.getSetting('processed_folder');
  document.getElementById('processed-folder-path').value = val || '';
}
loadProcessedFolder();

document.getElementById('btn-pick-processed').addEventListener('click', async () => {
  const folder = await api.pickOutputFolder();
  if (folder) {
    await api.setSetting('processed_folder', folder);
    document.getElementById('processed-folder-path').value = folder;
  }
});

document.getElementById('btn-clear-processed').addEventListener('click', async () => {
  await api.setSetting('processed_folder', '');
  document.getElementById('processed-folder-path').value = '';
});

// ── Watch folder ──────────────────────────────────────────────────────────────
async function loadWatchFolder() {
  const cfg = await api.getWatchFolderConfig();
  document.getElementById('watch-folder-path').value = cfg.folder || '';
  document.getElementById('watch-folder-toggle').checked = !!cfg.enabled;
}
loadWatchFolder();

document.getElementById('btn-pick-watch').addEventListener('click', async () => {
  const folder = await api.pickWatchFolder();
  if (folder) {
    await api.setWatchFolder(folder);
    document.getElementById('watch-folder-path').value = folder;
  }
});

document.getElementById('watch-folder-toggle').addEventListener('change', async (e) => {
  await api.setWatchFolderEnabled(e.target.checked);
});

// ── Processing mode ───────────────────────────────────────────────────────────
async function loadProcessingMode() {
  const mode = await api.getProcessingMode();
  const radio = document.querySelector(`input[name="proc-mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
}
loadProcessingMode();

document.querySelectorAll('input[name="proc-mode"]').forEach(r => {
  r.addEventListener('change', async () => {
    if (r.checked) await api.setProcessingMode(r.value);
  });
});

// ── File naming ───────────────────────────────────────────────────────────────
const filenamePatternInput   = document.getElementById('filename-pattern-input');
const filenamePatternMsg     = document.getElementById('filename-pattern-msg');
const filenamePatternPreview = document.getElementById('filename-pattern-preview');

let filenameDefaultPattern = '{docType}.{date}.{ref}';
let filenamePreviewDebounce = null;

async function loadFilenamePattern() {
  const info = await api.getFilenamePatternInfo();
  filenameDefaultPattern = info.defaultPattern;
  renderFilenameTokenList(info.tokens);

  const saved = await api.getSetting('filename_pattern');
  filenamePatternInput.value = saved || filenameDefaultPattern;
  updateFilenamePreview();
}
loadFilenamePattern();

function renderFilenameTokenList(tokens) {
  const list = document.getElementById('filename-token-list');
  list.innerHTML = '';
  for (const t of tokens) {
    const chip = document.createElement('span');
    chip.className = 'token-chip';
    chip.title = `Insert ${t.token} — example: ${t.example}`;
    chip.innerHTML = `${escHtml(t.token)}<span class="token-label">${escHtml(t.label)}</span>`;
    chip.addEventListener('click', () => insertFilenameToken(t.token));
    list.appendChild(chip);
  }
}

function insertFilenameToken(token) {
  const input = filenamePatternInput;
  const start = input.selectionStart ?? input.value.length;
  const end   = input.selectionEnd   ?? input.value.length;
  input.value = input.value.slice(0, start) + token + input.value.slice(end);
  input.focus();
  input.selectionStart = input.selectionEnd = start + token.length;
  schedulePatternPreview();
  savePatternSetting();
}

function schedulePatternPreview() {
  clearTimeout(filenamePreviewDebounce);
  filenamePreviewDebounce = setTimeout(updateFilenamePreview, 300);
}

async function updateFilenamePreview() {
  const pattern = filenamePatternInput.value.trim();
  const result  = await api.previewFilenamePattern(pattern);
  filenamePatternPreview.textContent = result.filename;
  if (result.warning) {
    filenamePatternMsg.textContent   = `⚠ ${result.warning}`;
    filenamePatternMsg.className     = 'pattern-msg warn';
    filenamePatternMsg.style.display = '';
  } else {
    filenamePatternMsg.style.display = 'none';
  }
}

async function savePatternSetting() {
  await api.setSetting('filename_pattern', filenamePatternInput.value.trim());
}

filenamePatternInput.addEventListener('input', schedulePatternPreview);
filenamePatternInput.addEventListener('change', savePatternSetting);

document.getElementById('btn-reset-filename-pattern').addEventListener('click', async () => {
  filenamePatternInput.value = filenameDefaultPattern;
  await savePatternSetting();
  updateFilenamePreview();
});

// ── Confidence threshold ──────────────────────────────────────────────────────
const thresholdSlider = document.getElementById('global-threshold');
const thresholdVal    = document.getElementById('global-threshold-val');

async function loadThreshold() {
  const val = await api.getSetting('confidence_threshold');
  const n   = val != null ? parseInt(val) : 70;
  thresholdSlider.value    = n;
  thresholdVal.textContent = n + '%';
}
loadThreshold();

thresholdSlider.addEventListener('input', () => {
  thresholdVal.textContent = thresholdSlider.value + '%';
});
thresholdSlider.addEventListener('change', async () => {
  await api.setSetting('confidence_threshold', thresholdSlider.value);
});

// ══════════════════════════════════════════════════════════════════════════════
// DOCUMENT TYPES TAB
// ══════════════════════════════════════════════════════════════════════════════

let allTypesWithFields = [];

async function loadDocTypes() {
  allTypesWithFields = await api.getAllDocTypesAll();
  renderDocTypesList();
}

function renderDocTypesList() {
  const list = document.getElementById('doctypes-list');
  list.innerHTML = '';

  for (const dt of allTypesWithFields) {
    const row = document.createElement('div');
    row.className = 'doctype-row' + (dt.enabled ? '' : ' disabled');

    const fieldOpts = dt.fields.map(f =>
      `<option value="${escHtml(f.key)}">${escHtml(f.label)}</option>`
    ).join('');
    const noneOpt = '<option value="">— none —</option>';

    row.innerHTML = `
      <label class="toggle">
        <input type="checkbox" class="dt-toggle" data-id="${dt.id}" ${dt.enabled ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <div class="doctype-name">
        ${escHtml(dt.name)}
        <span class="${dt.built_in ? 'badge-builtin' : 'badge-custom'}">${dt.built_in ? 'built-in' : 'custom'}</span>
      </div>
      <div class="doctype-fields">
        <span class="field-label-small">Ref:</span>
        <select class="field-select dt-ref" data-id="${dt.id}">
          ${noneOpt}${fieldOpts}
        </select>
        <span class="field-label-small">Date:</span>
        <select class="field-select dt-date" data-id="${dt.id}">
          ${noneOpt}${fieldOpts}
        </select>
        ${!dt.built_in
          ? `<button class="btn-icon dt-delete" data-id="${dt.id}" title="Delete type">&#215;</button>`
          : ''}
      </div>
    `;

    // Set current ref/date values
    const refSel  = row.querySelector('.dt-ref');
    const dateSel = row.querySelector('.dt-date');
    if (dt.ref_field_key)  refSel.value  = dt.ref_field_key;
    if (dt.date_field_key) dateSel.value = dt.date_field_key;

    // Toggle enable/disable
    row.querySelector('.dt-toggle').addEventListener('change', async (e) => {
      const enabled = e.target.checked ? 1 : 0;
      await api.updateDocumentType(dt.id, { enabled });
      row.classList.toggle('disabled', !e.target.checked);
    });

    // Ref field change
    refSel.addEventListener('change', async () => {
      await api.updateDocumentType(dt.id, { ref_field_key: refSel.value || null });
    });

    // Date field change
    dateSel.addEventListener('change', async () => {
      await api.updateDocumentType(dt.id, { date_field_key: dateSel.value || null });
    });

    // Delete custom type
    const delBtn = row.querySelector('.dt-delete');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Delete "${dt.name}"? This cannot be undone.`)) return;
        // No delete-document-type IPC exists yet; mark disabled as a fallback
        await api.updateDocumentType(dt.id, { enabled: 0 });
        await loadDocTypes();
      });
    }

    list.appendChild(row);
  }
}

// ── Add custom type ───────────────────────────────────────────────────────────
const addTypeForm = document.getElementById('add-type-form');

document.getElementById('btn-add-type').addEventListener('click', () => {
  addTypeForm.classList.add('visible');
  document.getElementById('new-type-name').focus();
});

document.getElementById('btn-cancel-type').addEventListener('click', () => {
  addTypeForm.classList.remove('visible');
  document.getElementById('new-type-name').value = '';
});

document.getElementById('btn-save-type').addEventListener('click', async () => {
  const name = document.getElementById('new-type-name').value.trim();
  if (!name) { alert('Please enter a type name.'); return; }
  await api.addDocumentType({ name });
  addTypeForm.classList.remove('visible');
  document.getElementById('new-type-name').value = '';
  await loadDocTypes();
  await loadFieldsTabTypes();
});

// ══════════════════════════════════════════════════════════════════════════════
// FIELDS TAB
// ══════════════════════════════════════════════════════════════════════════════

let enabledDocTypes  = [];
let selectedTypeId   = null;

async function loadFieldsTabTypes() {
  enabledDocTypes = await api.getAllDocTypes();
  renderTypeTabs();
  if (enabledDocTypes.length > 0) {
    if (!selectedTypeId || !enabledDocTypes.find(t => t.id === selectedTypeId)) {
      selectedTypeId = enabledDocTypes[0].id;
    }
    renderFieldsTable();
  } else {
    document.getElementById('fields-tbody').innerHTML = '';
  }
}

function renderTypeTabs() {
  const tabsEl = document.getElementById('type-tabs');
  tabsEl.innerHTML = '';
  for (const dt of enabledDocTypes) {
    const btn = document.createElement('button');
    btn.className = 'type-tab' + (dt.id === selectedTypeId ? ' active' : '');
    btn.textContent = dt.name;
    btn.addEventListener('click', () => {
      selectedTypeId = dt.id;
      renderTypeTabs();
      renderFieldsTable();
      const sel = document.getElementById('new-doctype');
      if (sel) sel.value = dt.id;
    });
    tabsEl.appendChild(btn);
  }
}

function renderFieldsTable() {
  const dt    = enabledDocTypes.find(t => t.id === selectedTypeId);
  const tbody = document.getElementById('fields-tbody');
  tbody.innerHTML = '';
  if (!dt) return;

  for (const f of dt.fields) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escHtml(f.label)}</td>
      <td><span class="field-key">${escHtml(f.key)}</span></td>
      <td>${escHtml(f.type)}</td>
      <td>
        <label class="toggle">
          <input type="checkbox" data-field-id="${f.id}" ${f.enabled !== 0 ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        ${f.built_in
          ? `<span class="badge-builtin">built-in</span>`
          : `<span class="badge-custom">custom</span>
             <button class="btn-icon" data-delete="${f.id}">&#215;</button>`}
      </td>
    `;

    tr.querySelector('input[type=checkbox]').addEventListener('change', async (e) => {
      await api.updateField(f.id, { enabled: e.target.checked ? 1 : 0 });
    });

    const delBtn = tr.querySelector('[data-delete]');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (!confirm('Delete this custom field? This cannot be undone.')) return;
        await api.deleteField(f.id);
        await loadFieldsTabTypes();
      });
    }

    tbody.appendChild(tr);
  }
}

// ── Add custom field ──────────────────────────────────────────────────────────
const addFieldForm = document.getElementById('add-field-form');
const newLabel     = document.getElementById('new-label');
const newKey       = document.getElementById('new-key');

document.getElementById('btn-add-field').addEventListener('click', () => {
  addFieldForm.classList.add('visible');
  newLabel.focus();
});

document.getElementById('btn-cancel-field').addEventListener('click', () => {
  addFieldForm.classList.remove('visible');
  newLabel.value = '';
  newKey.value   = '';
});

newLabel.addEventListener('input', () => {
  newKey.value = newLabel.value.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
});

document.getElementById('btn-save-field').addEventListener('click', async () => {
  const label = newLabel.value.trim();
  const key   = newKey.value.trim();
  const type  = document.getElementById('new-field-type').value;

  if (!label || !key) { alert('Please enter a field label.'); return; }
  if (!selectedTypeId) { alert('Please select a document type tab first.'); return; }

  await api.addField({ document_type_id: selectedTypeId, key, label, type });

  addFieldForm.classList.remove('visible');
  newLabel.value = '';
  newKey.value   = '';

  await loadFieldsTabTypes();
  await loadDocTypes();
});

// ── Helper ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatWhen(when) {
  if (!when) return null;
  // SQLite datetime('now') yields "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker.
  const d = new Date(when.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? when : d.toLocaleString();
}

// ══════════════════════════════════════════════════════════════════════════════
// USERS TAB  (admin-only — this whole panel is unreachable for non-admins,
// since open-settings-window itself is gated to hasRole('admin') in main.js;
// every action below is also re-checked server-side in auth/handler.js)
// ══════════════════════════════════════════════════════════════════════════════

const ROLE_LABELS = { admin: 'Admin', edit: 'Edit', readonly: 'Read Only' };

const AUDIT_ACTION_LABELS = {
  login_success:      'Signed in',
  login_failure:      'Failed sign-in',
  logout:             'Signed out',
  user_created:       'User created',
  user_enabled:       'User enabled',
  user_disabled:      'User disabled',
  password_reset:     'Password reset',
  password_change:    'Password changed',
  recovery_code_used: 'Recovery code used',
  role_change:        'Role changed',
};

let allUsers      = [];
let currentUserId = null;

async function loadUsers() {
  const me = await api.authGetCurrentUser();
  currentUserId = me ? me.id : null;

  const result = await api.authListUsers();
  allUsers = (result && result.users) || [];
  renderUsersList();
}

function renderUsersList() {
  const list = document.getElementById('users-list');
  list.innerHTML = '';

  for (const u of allUsers) {
    const row = document.createElement('div');
    row.className = 'user-row' + (u.is_active ? '' : ' disabled');
    const isSelf = (u.id === currentUserId);
    const lastLogin = formatWhen(u.last_login_at);

    const roleOptions = Object.entries(ROLE_LABELS)
      .map(([val, label]) => `<option value="${val}" ${u.role === val ? 'selected' : ''}>${label}</option>`)
      .join('');

    row.innerHTML = `
      <div class="user-identity">
        <div class="user-display-name">
          ${escHtml(u.display_name)}
          <span class="role-badge" data-role="${escHtml(u.role)}">${escHtml(ROLE_LABELS[u.role] || u.role)}</span>
          ${isSelf ? '<span class="you-pill">You</span>' : ''}
          ${!u.is_active ? '<span class="you-pill">Disabled</span>' : ''}
          ${u.must_change_password ? '<span class="you-pill">Must set new password</span>' : ''}
        </div>
        <div class="user-username">@${escHtml(u.username)}</div>
        <div class="user-meta">${lastLogin ? 'Last sign-in ' + escHtml(lastLogin) : 'Never signed in'}</div>
      </div>
      <div class="user-actions">
        <select class="field-select user-role-select" data-id="${u.id}"
                ${isSelf ? 'disabled title="You cannot change your own role"' : ''}>
          ${roleOptions}
        </select>
        <button class="btn user-reset" data-id="${u.id}" style="font-size:11px; padding:5px 10px;">Reset password&hellip;</button>
        <label class="toggle" title="${isSelf ? 'You cannot disable your own account' : (u.is_active ? 'Disable account' : 'Enable account')}">
          <input type="checkbox" class="user-active-toggle" data-id="${u.id}" ${u.is_active ? 'checked' : ''} ${isSelf ? 'disabled' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    `;

    // Role change — server re-validates the "at least one active Admin" rule;
    // we just relay its verdict and snap the dropdown back on rejection.
    const roleSelect = row.querySelector('.user-role-select');
    roleSelect.addEventListener('change', async () => {
      const newRole = roleSelect.value;
      const result = await api.authSetUserRole({ userId: u.id, role: newRole });
      if (!result || !result.success) {
        alert((result && result.error) || "Could not change that user's role.");
        roleSelect.value = u.role;
        return;
      }
      await loadUsers();
    });

    // Enable / disable — same "server is the real guard" relationship.
    const activeToggle = row.querySelector('.user-active-toggle');
    activeToggle.addEventListener('change', async () => {
      const wantActive = activeToggle.checked;
      const result = await api.authSetUserActive({ userId: u.id, isActive: wantActive });
      if (!result || !result.success) {
        alert((result && result.error) || "Could not change that user's status.");
        activeToggle.checked = !wantActive;
        return;
      }
      await loadUsers();
    });

    // Reset password — generates a one-time temp password, shown once here
    // (mirrors the login window's "shown once" recovery-code screen).
    row.querySelector('.user-reset').addEventListener('click', async () => {
      if (!confirm(`Reset the password for "${u.display_name}"?\n\nThey will need to sign in with a temporary password and immediately choose a new one.`)) return;
      const result = await api.authAdminResetPassword({ userId: u.id });
      if (!result || !result.success) {
        alert((result && result.error) || "Could not reset that user's password.");
        return;
      }
      showSecretDialog('Temporary password', result.tempPassword,
        `Give this to <strong>${escHtml(u.display_name)}</strong> — it is shown only once and is not stored anywhere. ` +
        `They will be asked to set their own password the next time they sign in.`);
      await loadUsers();
    });

    list.appendChild(row);
  }
}

// ── Add user ──────────────────────────────────────────────────────────────────
const addUserForm = document.getElementById('add-user-form');

document.getElementById('btn-add-user').addEventListener('click', () => {
  addUserForm.classList.add('visible');
  document.getElementById('new-user-username').focus();
});

document.getElementById('btn-cancel-user').addEventListener('click', () => {
  addUserForm.classList.remove('visible');
  document.getElementById('new-user-username').value = '';
  document.getElementById('new-user-display-name').value = '';
  document.getElementById('new-user-role').value = 'edit';
});

document.getElementById('btn-save-user').addEventListener('click', async () => {
  const username    = document.getElementById('new-user-username').value.trim();
  const displayName = document.getElementById('new-user-display-name').value.trim();
  const role        = document.getElementById('new-user-role').value;

  if (!username)    { alert('Please enter a username.'); return; }
  if (!displayName) { alert('Please enter a display name.'); return; }

  const result = await api.authCreateUser({ username, displayName, role });
  if (!result || !result.success) {
    alert((result && result.error) || 'Could not create that user.');
    return;
  }

  addUserForm.classList.remove('visible');
  document.getElementById('new-user-username').value = '';
  document.getElementById('new-user-display-name').value = '';
  document.getElementById('new-user-role').value = 'edit';

  await loadUsers();
  showSecretDialog('Temporary password', result.tempPassword,
    `Give this to <strong>${escHtml(displayName)}</strong> — it is shown only once and is not stored anywhere. ` +
    `They will be asked to set their own password the first time they sign in.`);
});

// ── Recent activity (audit log) ───────────────────────────────────────────────
async function loadAuditLog() {
  const entries = await api.authGetAuditLog(100);
  renderAuditLog(entries || []);
}

function renderAuditLog(entries) {
  const tbody = document.getElementById('audit-tbody');
  tbody.innerHTML = '';

  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted); font-size:11px;">No activity recorded yet.</td></tr>';
    return;
  }

  for (const entry of entries) {
    const tr = document.createElement('tr');
    const who    = entry.actor_display_name || entry.actor_username || '—';
    const action = AUDIT_ACTION_LABELS[entry.action] || entry.action;
    const target = entry.target_type
      ? `${entry.target_type}${entry.target_id ? ' #' + entry.target_id : ''}`
      : '';
    const details = [target, entry.details].filter(Boolean).join(' — ');
    tr.innerHTML = `
      <td class="audit-when">${escHtml(formatWhen(entry.created_at) || entry.created_at)}</td>
      <td>${escHtml(who)}</td>
      <td class="audit-action">${escHtml(action)}</td>
      <td style="color:var(--muted);">${escHtml(details)}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ── "Shown once" secret dialog (temp passwords) ──────────────────────────────
// Same overlay convention as showChangePasswordDialog in main/renderer.js
// (cssText + innerHTML — this codebase has no global .modal/.overlay CSS).
// `note` is allowed light HTML (a <strong> around the name) because it is
// built entirely from escHtml()'d pieces; `title`/`value` are escaped here.
function showSecretDialog(title, value, note) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9998;
    background: rgba(0,0,0,.55);
    display: flex; align-items: center; justify-content: center;
  `;
  overlay.innerHTML = `
    <div style="width:340px; background:var(--surface); border:1px solid var(--border2);
                border-radius:10px; padding:18px; display:flex; flex-direction:column; gap:12px;
                font-family:var(--sans); color:var(--text);">
      <div style="font-size:13px; font-weight:500;">${escHtml(title)}</div>
      <div style="font-size:11px; color:var(--muted); line-height:1.6;">${note}</div>
      <div style="font-family:var(--mono); font-size:15px; letter-spacing:.08em; text-align:center;
                  padding:14px; border-radius:8px; background:var(--bg); border:1px solid var(--accent-border);
                  color:var(--accent2); user-select:text;">${escHtml(value)}</div>
      <button id="secret-ok" style="padding:9px; border-radius:6px; border:none; background:var(--accent);
              color:#fff; font-family:inherit; font-size:12px; font-weight:500; cursor:pointer;">Done</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#secret-ok').addEventListener('click', () => overlay.remove());
}

// ── Typed-name confirmation for extreme-use destructive actions ──────────────
// Electron does not implement window.prompt(), so the "type the exact name to
// confirm" pattern is built as a custom overlay (same convention as
// showSecretDialog above). Resolves true only when the user types `requiredText`
// exactly and clicks Confirm; cancel / backdrop / Escape resolve false.
function showTypedConfirmDialog({ title, warningHtml, requiredText, confirmLabel = 'Delete' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 9998;
      background: rgba(0,0,0,.55);
      display: flex; align-items: center; justify-content: center;
    `;
    overlay.innerHTML = `
      <div style="width:380px; background:var(--surface); border:1px solid var(--border2);
                  border-radius:10px; padding:18px; display:flex; flex-direction:column; gap:12px;
                  font-family:var(--sans); color:var(--text);">
        <div style="font-size:13px; font-weight:500; color:var(--err);">${escHtml(title)}</div>
        <div style="font-size:11px; color:var(--muted); line-height:1.6;">${warningHtml}</div>
        <div style="font-size:11px; color:var(--muted);">Type <strong style="color:var(--text); font-family:var(--mono);">${escHtml(requiredText)}</strong> to confirm:</div>
        <input id="tc-input" type="text" spellcheck="false" autocomplete="off" style="
          padding:9px; border-radius:6px; border:1px solid var(--border2); background:var(--bg);
          color:var(--text); font-family:var(--mono); font-size:13px;">
        <div style="display:flex; gap:8px;">
          <button id="tc-cancel" style="flex:1; padding:9px; border-radius:6px; border:1px solid var(--border2);
                  background:transparent; color:var(--muted); font-family:inherit; font-size:12px; cursor:pointer;">Cancel</button>
          <button id="tc-confirm" disabled style="flex:1; padding:9px; border-radius:6px; border:none;
                  background:var(--err); color:#fff; font-family:inherit; font-size:12px; font-weight:500;
                  cursor:pointer; opacity:.45;">${escHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input    = overlay.querySelector('#tc-input');
    const btnOk     = overlay.querySelector('#tc-confirm');
    const close     = (result) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(result); };
    const matches  = () => input.value === requiredText;
    const sync     = () => { btnOk.disabled = !matches(); btnOk.style.opacity = matches() ? '1' : '.45'; };
    const onKey     = (e) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter' && matches()) close(true);
    };

    input.addEventListener('input', sync);
    overlay.querySelector('#tc-cancel').addEventListener('click', () => close(false));
    btnOk.addEventListener('click', () => { if (matches()) close(true); });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(false); });
    document.addEventListener('keydown', onKey);
    input.focus();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// THEME TOGGLE
// ══════════════════════════════════════════════════════════════════════════════

async function loadThemeToggle() {
  const theme = await api.getSetting('theme') || 'dark';
  document.getElementById('theme-toggle').checked = (theme === 'light');
}
loadThemeToggle();

document.getElementById('theme-toggle').addEventListener('change', async (e) => {
  const theme = e.target.checked ? 'light' : 'dark';
  applyTheme(theme);
  await api.setSetting('theme', theme);
});

// ══════════════════════════════════════════════════════════════════════════════
// TEMPLATES TAB — Admin Template Viewer / Anchor Mapping
// Phase 1: list + sample-document viewer + read-only mapping overlay
// Phase 2: draw anchor/target boxes, edit mapping settings, save/test/delete
// ══════════════════════════════════════════════════════════════════════════════

let allTemplates     = [];
let allGroups        = [];
let selectedTemplate = null;
const collapsedGroups = new Set(); // group IDs currently collapsed in the tree
let tplPageImages    = [];
let tplCurrentPage   = 0;

// Phase 2 — mapping editor / drawing state
let tplEditingFieldKey = null;   // field_key currently loaded in the editor
let tplMapMode         = null;   // null | 'anchor' | 'target' — active drawing tool
let tplDraftAnchor     = null;   // {x_norm,y_norm,w_norm,h_norm,page_number} or null
let tplDraftTarget     = null;
let tplIsDragging      = false;
let tplDragStart       = null;
let tplDragRect        = null;
// Select / move state — left-click on an existing box selects it; dragging moves it.
let tplSelectedBox = null;   // { fieldKey, boxType:'anchor'|'target' } | null
let tplIsMoving    = false;
let tplMoveStart   = null;   // { pt:{x,y}, origNorm } when a move drag is in progress

// Zoom / pan state — applied to #tpl-img-wrap via CSS transform, independent
// of the canvas's internal pixel buffer (tplCanvas.width/height), which always
// stays at the unscaled rendered image size. Mouse-to-canvas coordinate maths
// in the drawing handlers below converts through the live bounding-rect ratio,
// so drawing stays accurate at any zoom level.
let tplZoom       = 1;
let tplPanX       = 0;
let tplPanY       = 0;
let tplIsPanning  = false;
let tplPanStart   = null;   // {x, y, panX, panY} — client coords + pan at drag start
const TPL_ZOOM_MIN  = 1;
const TPL_ZOOM_MAX  = 4;
const TPL_ZOOM_STEP = 0.25;

const tplImg     = document.getElementById('tpl-img');
const tplImgWrap = document.getElementById('tpl-img-wrap');
const tplViewer  = document.getElementById('tpl-doc-viewer');
const tplCanvas  = document.getElementById('tpl-overlay-canvas');
const tplCtx     = tplCanvas.getContext('2d');

async function loadTemplates() {
  try {
    [allTemplates, allGroups] = await Promise.all([
      api.getTemplates().catch(() => []),
      api.getTemplateGroups().catch(() => []),
    ]);
    allTemplates = allTemplates || [];
    allGroups    = allGroups    || [];
  } catch (e) {
    console.warn('loadTemplates failed:', e.message);
    allTemplates = [];
    allGroups    = [];
  }
  renderTemplateList();
}

function makeTplRow(t, isChild) {
  const mappingCount = (t.field_mappings || []).filter(m => m.enabled).length;
  const row = document.createElement('div');
  row.className = 'tpl-row' +
    (isChild ? ' tpl-child' : '') +
    (selectedTemplate && selectedTemplate.id === t.id ? ' active' : '');
  row.dataset.id = t.id;
  // Per-template (not per-group) scan-friendly indicator — mirrors the
  // detail-panel badge in renderOcrAutoStatus, so siblings in the same group
  // can be told apart at a glance without clicking into each one.
  const ocrAutoIcon = t.ocr_auto_enabled
    ? '<span class="tpl-row-ocr-icon" title="OCR auto-processing enabled">&#9889;</span>'
    : '';
  row.innerHTML = `
    <span class="tpl-row-name">${escHtml(t.name)}${ocrAutoIcon}</span>
    <span class="tpl-row-meta">${escHtml(t.document_type_slug || '—')} · confirmed ${t.confirmed_count}× · ${mappingCount} mapping${mappingCount === 1 ? '' : 's'}</span>
  `;
  row.addEventListener('click', () => selectTemplate(t.id));
  return row;
}

function renderTemplateList() {
  const list = document.getElementById('tpl-list');
  list.innerHTML = '';
  if (!allTemplates.length) {
    list.innerHTML = '<p class="section-desc">No templates learned yet — confirm a few documents to build the first one.</p>';
    return;
  }

  // Build group map from allGroups; assign templates to their group
  const groupMap = new Map();
  for (const g of allGroups) groupMap.set(g.id, { group: g, templates: [] });

  const ungrouped = [];
  for (const t of allTemplates) {
    if (t.group_id && groupMap.has(t.group_id)) {
      groupMap.get(t.group_id).templates.push(t);
    } else {
      ungrouped.push(t);
    }
  }

  // Render populated group nodes (alphabetical by group name)
  const populatedGroups = [...groupMap.values()]
    .filter(g => g.templates.length > 0)
    .sort((a, b) => a.group.name.localeCompare(b.group.name));

  for (const { group, templates } of populatedGroups) {
    const isCollapsed = collapsedGroups.has(group.id);
    const count = templates.length;

    const node = document.createElement('div');
    node.className = 'tpl-group-node' + (isCollapsed ? ' collapsed' : '');
    node.dataset.groupId = group.id;

    const hdr = document.createElement('div');
    hdr.className = 'tpl-group-hdr';
    hdr.innerHTML = `
      <span class="tpl-group-arrow">&#9660;</span>
      <span class="tpl-group-name">${escHtml(group.name)}</span>
      <span class="tpl-group-badge">${count} variant${count === 1 ? '' : 's'}</span>
    `;
    hdr.addEventListener('click', () => {
      if (collapsedGroups.has(group.id)) collapsedGroups.delete(group.id);
      else collapsedGroups.add(group.id);
      node.classList.toggle('collapsed');
    });
    node.appendChild(hdr);

    const children = document.createElement('div');
    children.className = 'tpl-group-children';
    for (const t of templates) children.appendChild(makeTplRow(t, true));
    node.appendChild(children);
    list.appendChild(node);
  }

  // Render ungrouped templates as flat top-level rows
  for (const t of ungrouped) list.appendChild(makeTplRow(t, false));
}

// ── Create template ───────────────────────────────────────────────────────────
// Mirrors the existing add-type-form pattern (toggle .visible, validate name,
// reload list). Doc-type dropdown reuses allTypesWithFields (loaded by
// loadDocTypes for the mapping-field selector) — no second source of truth —
// filtered to enabled types only, same set an admin can otherwise assign.
const newTemplateForm = document.getElementById('new-template-form');

document.getElementById('btn-new-template').addEventListener('click', async () => {
  if (!allTypesWithFields.length) {
    try { await loadDocTypes(); } catch (e) { console.warn('loadDocTypes (for new template) failed:', e.message); }
  }
  const select = document.getElementById('new-template-doctype');
  select.innerHTML = '';
  for (const dt of allTypesWithFields.filter(t => t.enabled)) {
    const opt = document.createElement('option');
    opt.value = dt.slug;
    opt.textContent = dt.name;
    select.appendChild(opt);
  }
  newTemplateForm.classList.add('visible');
  document.getElementById('new-template-name').focus();
});

document.getElementById('btn-cancel-template').addEventListener('click', () => {
  newTemplateForm.classList.remove('visible');
  document.getElementById('new-template-name').value = '';
});

document.getElementById('btn-save-template').addEventListener('click', async () => {
  const name = document.getElementById('new-template-name').value.trim();
  if (!name) { alert('Please enter a template name.'); return; }
  const documentTypeSlug = document.getElementById('new-template-doctype').value || null;
  try {
    const created = await api.createTemplate({ name, document_type_slug: documentTypeSlug });
    newTemplateForm.classList.remove('visible');
    document.getElementById('new-template-name').value = '';
    await loadTemplates();
    if (created && created.id) await selectTemplate(created.id);
  } catch (e) {
    alert('Could not create template: ' + e.message);
  }
});

// ── Rename template ───────────────────────────────────────────────────────────
// Cosmetic/admin-facing metadata only — template_matcher.py identifies
// templates solely by logo_phash and keyword_fingerprint (never name/slug),
// and slug (the functional/derived identifier used for the debug-export
// filename) is left untouched by templates.rename, so editing this field
// cannot affect matching, identification, or existing joins.
const tplNameInput = document.getElementById('tpl-name-input');
const tplBtnRename = document.getElementById('tpl-btn-rename');

tplNameInput.addEventListener('input', () => {
  const trimmed = tplNameInput.value.trim();
  tplBtnRename.disabled = !selectedTemplate || !trimmed || trimmed === selectedTemplate.name;
});

tplBtnRename.addEventListener('click', async () => {
  if (!selectedTemplate) return;
  const name = tplNameInput.value.trim();
  const msg  = document.getElementById('tpl-name-msg');
  if (!name || name === selectedTemplate.name) return;
  try {
    const updated = await api.renameTemplate(selectedTemplate.id, name);
    if (!updated) return;
    selectedTemplate = updated;
    const idx = allTemplates.findIndex(t => t.id === updated.id);
    if (idx !== -1) allTemplates[idx] = updated;
    renderTemplateList();
    tplBtnRename.disabled = true;
    msg.textContent = 'Renamed.';
    msg.style.color = 'var(--ok)';
  } catch (e) {
    msg.textContent = 'Rename failed: ' + e.message;
    msg.style.color = 'var(--err)';
  }
});

// ── Delete template ───────────────────────────────────────────────────────────
// Scoped to this template's own record + its own field/mapping rows (cascade
// on template_id — see templates.remove); confirmed documents that reference
// it are merely unlinked, never touched otherwise. Does not affect other
// templates, document types, fields, learned anchors, supplier hints, logo
// fingerprints, or settings.
document.getElementById('tpl-btn-delete-template').addEventListener('click', async () => {
  if (!selectedTemplate) return;
  if (!confirm(`Delete the template "${selectedTemplate.name}"? Its field mappings and selector anchors will be removed too. Confirmed documents that used it stay exactly as they are. This cannot be undone.`)) return;
  try {
    await api.deleteTemplate(selectedTemplate.id);
    const deletedId = selectedTemplate.id;
    selectedTemplate = null;
    allTemplates = allTemplates.filter(t => t.id !== deletedId);
    document.getElementById('tpl-detail').style.display = 'none';
    document.getElementById('tpl-empty').style.display  = '';
    renderTemplateList();
  } catch (e) {
    alert('Could not delete template: ' + e.message);
  }
});

// ── Template groups ───────────────────────────────────────────────────────────

async function renderGroupSection(detail) {
  try { allGroups = await api.getTemplateGroups() || []; } catch { allGroups = []; }
  const sel = document.getElementById('tpl-group-select');
  sel.innerHTML = '<option value="">— No group —</option>';
  for (const g of allGroups) {
    const opt = document.createElement('option');
    opt.value       = g.id;
    opt.textContent = g.name;
    if (detail.group_id === g.id) opt.selected = true;
    sel.appendChild(opt);
  }
  await renderSiblings(detail);
}

async function renderSiblings(detail) {
  const siblingsDiv = document.getElementById('tpl-siblings');
  const listDiv     = document.getElementById('tpl-siblings-list');
  if (!detail.group_id) { siblingsDiv.style.display = 'none'; return; }
  let siblings = [];
  try { siblings = await api.getTemplateSiblings(detail.id) || []; } catch {}
  if (!siblings.length) { siblingsDiv.style.display = 'none'; return; }
  siblingsDiv.style.display = '';
  listDiv.innerHTML = '';
  for (const s of siblings) {
    const el = document.createElement('span');
    el.className   = 'tpl-row-meta';
    el.style.cssText = 'cursor:pointer; color:var(--accent2); padding:1px 0; display:block;';
    el.textContent = `${s.name} (${s.document_type_slug || '—'})`;
    el.title       = 'Open this template';
    el.addEventListener('click', () => selectTemplate(s.id));
    listDiv.appendChild(el);
  }
}

document.getElementById('tpl-group-select').addEventListener('change', async (e) => {
  if (!selectedTemplate) return;
  const groupId = parseInt(e.target.value) || null;
  try {
    const updated = await api.setTemplateGroup(selectedTemplate.id, groupId);
    if (!updated) return;
    selectedTemplate = updated;
    const idx = allTemplates.findIndex(t => t.id === updated.id);
    if (idx !== -1) allTemplates[idx] = updated;
    renderTemplateList();
    await renderSiblings(updated);
  } catch (err) { console.warn('setTemplateGroup failed:', err.message); }
});

const tplNewGroupRow   = document.getElementById('tpl-new-group-row');
const tplNewGroupInput = document.getElementById('tpl-new-group-input');

document.getElementById('tpl-btn-new-group').addEventListener('click', () => {
  tplNewGroupRow.style.display = 'flex';
  tplNewGroupInput.value = '';
  tplNewGroupInput.focus();
});

document.getElementById('tpl-btn-cancel-group').addEventListener('click', () => {
  tplNewGroupRow.style.display = 'none';
  tplNewGroupInput.value = '';
});

async function saveNewGroup() {
  const name = tplNewGroupInput.value.trim();
  if (!name) { tplNewGroupInput.focus(); return; }
  try {
    allGroups = await api.createTemplateGroup(name) || [];
    tplNewGroupRow.style.display = 'none';
    tplNewGroupInput.value = '';
    await renderGroupSection(selectedTemplate);
  } catch (err) {
    console.error('createTemplateGroup failed:', err);
    alert('Could not create group: ' + err.message);
  }
}

document.getElementById('tpl-btn-save-group').addEventListener('click', saveNewGroup);
tplNewGroupInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  saveNewGroup();
  if (e.key === 'Escape') { tplNewGroupRow.style.display = 'none'; tplNewGroupInput.value = ''; }
});

async function selectTemplate(id) {
  document.querySelectorAll('.tpl-row').forEach(r => r.classList.toggle('active', parseInt(r.dataset.id) === id));
  // If the selected row is inside a collapsed group node, expand it
  const activeRow = document.querySelector('.tpl-row.active');
  const parentNode = activeRow?.closest('.tpl-group-node');
  if (parentNode?.classList.contains('collapsed')) {
    collapsedGroups.delete(parseInt(parentNode.dataset.groupId));
    parentNode.classList.remove('collapsed');
  }
  document.getElementById('tpl-empty').style.display  = 'none';
  document.getElementById('tpl-detail').style.display = '';

  let detail = null;
  try {
    detail = await api.getTemplateDetail(id);
  } catch (e) {
    console.warn('getTemplateDetail failed:', e.message);
  }
  if (!detail) return;
  selectedTemplate = detail;

  const nameInput = document.getElementById('tpl-name-input');
  nameInput.value = detail.name;
  document.getElementById('tpl-btn-rename').disabled = true;
  document.getElementById('tpl-name-msg').textContent = '';
  document.getElementById('tpl-detail-meta').textContent =
    `${detail.document_type_slug || 'unknown type'} · confirmed ${detail.confirmed_count} time${detail.confirmed_count === 1 ? '' : 's'} · updated ${formatWhen(detail.updated_at) || '—'}`;
  renderDetectionMethod(detail);
  renderOcrAutoStatus(detail);

  await Promise.all([
    loadSampleCandidates(detail),
    renderGroupSection(detail),
  ]);
  renderMappingsTable(detail);
  renderSelectorAnchorsTable(detail);
  await loadSamplePages(detail);
  await populateMapFieldSelect(detail);
}

function renderDetectionMethod(detail) {
  const el = document.getElementById('tpl-detection-method');
  if (!el) return;
  el.innerHTML = '';

  const hasLogo  = !!detail.logo_phash;
  const hasKw    = Array.isArray(detail.keyword_fingerprint) && detail.keyword_fingerprint.length > 0;
  const mappingN = (detail.field_mappings || []).filter(m => m.enabled).length;

  let label, cls;
  if (hasLogo && hasKw)  { label = 'Logo & keyword fingerprint'; cls = 'ok'; }
  else if (hasLogo)      { label = 'Logo fingerprint';           cls = 'info'; }
  else if (hasKw)        { label = 'Keyword fingerprint';        cls = 'info'; }
  else                   { label = 'Not yet learned';            cls = 'warn'; }

  const pill = (text, c) => {
    const s = document.createElement('span');
    s.className   = `tpl-method-pill ${c}`;
    s.textContent = text;
    return s;
  };
  el.appendChild(pill(label, cls));
  if (mappingN > 0) el.appendChild(pill(`+ ${mappingN} admin mapping${mappingN === 1 ? '' : 's'}`, 'info'));
}

// OCR auto-processing rule indicator — shown only once a rule exists for this
// template (created via an OCR-Preview-active reprocess, see
// processing/handler.js reprocess-document / templates.setOcrAutoParams).
// The toggle lets an admin disable a rule that turns out to be harmful for
// this template, without affecting any other template's rule.
function renderOcrAutoStatus(detail) {
  const row    = document.getElementById('tpl-ocr-auto-row');
  const desc   = document.getElementById('tpl-ocr-auto-desc');
  const pill   = document.getElementById('tpl-ocr-auto-pill');
  const toggle = document.getElementById('tpl-ocr-auto-toggle');
  if (!row || !toggle) return;

  const hasRule = !!(detail.ocr_auto_params);
  row.style.display  = hasRule ? 'flex' : 'none';
  desc.style.display = hasRule ? 'block' : 'none';
  if (!hasRule) return;

  toggle.checked = !!detail.ocr_auto_enabled;
  pill.classList.toggle('ok', !!detail.ocr_auto_enabled);
  pill.classList.toggle('warn', !detail.ocr_auto_enabled);
  pill.textContent = detail.ocr_auto_enabled
    ? 'OCR auto-processing active'
    : 'OCR auto-processing disabled';

  toggle.onchange = async () => {
    toggle.disabled = true;
    try {
      const updated = await api.setTemplateOcrAuto(detail.id, toggle.checked);
      if (updated) {
        selectedTemplate = updated;
        renderOcrAutoStatus(updated);
      }
    } catch (err) {
      console.error('setTemplateOcrAuto failed:', err);
      toggle.checked = !toggle.checked; // revert on failure
    } finally {
      toggle.disabled = false;
    }
  };
}

async function loadSampleCandidates(detail) {
  const select = document.getElementById('tpl-sample-select');
  select.innerHTML = '';

  let candidates = [];
  try {
    candidates = await api.getTemplateSampleCandidates(detail.id) || [];
  } catch (e) {
    console.warn('getTemplateSampleCandidates failed:', e.message);
  }

  // get-template-sample-candidates only returns confirmed documents already
  // linked to this template — an imported sample (status='template_sample',
  // attached via "Import Sample File…" before any document has ever matched)
  // won't be in that list. Prepend it so the dropdown still shows it as
  // selected instead of looking unset.
  const pinned = detail.sample_document;
  if (pinned && !candidates.some(c => c.id === pinned.id)) {
    candidates = [pinned, ...candidates];
  }

  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = candidates.length ? '— Select a sample —' : 'No confirmed documents linked yet';
  select.appendChild(noneOpt);

  for (const c of candidates) {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = [c.supplier_name, c.reference_number, c.doc_date].filter(Boolean).join(' · ') || c.original_filename;
    if (c.status === 'template_sample') opt.textContent += ' (imported sample)';
    if (detail.sample_document_id === c.id) opt.selected = true;
    select.appendChild(opt);
  }

  select.onchange = async () => {
    const docId = select.value ? parseInt(select.value, 10) : null;
    try {
      const updated = await api.setTemplateSample(detail.id, docId);
      if (!updated) return;
      selectedTemplate = updated;
      const idx = allTemplates.findIndex(t => t.id === updated.id);
      if (idx !== -1) allTemplates[idx] = updated;
      await loadSamplePages(updated);
    } catch (e) {
      console.warn('setTemplateSample failed:', e.message);
    }
  };
}

// New templates start with no confirmed documents — get-template-sample-
// candidates is necessarily empty, so there is nothing to pick from the
// dropdown above. This lets an admin attach an arbitrary file directly: it's
// referenced in place (no copy), registered as a minimal 'template_sample'
// document row (invisible to review/search/counts — see templates/handler.js),
// pinned as the sample, and immediately re-rendered through the same
// loadSamplePages/getDocumentPages preview path every other sample uses.
document.getElementById('tpl-btn-import-sample').addEventListener('click', async () => {
  if (!selectedTemplate) return;
  const msg = document.getElementById('tpl-sample-msg');
  msg.textContent = '';
  msg.style.color = '';

  let filePath = null;
  try {
    filePath = await api.pickTemplateSampleFile();
  } catch (e) {
    console.warn('pickTemplateSampleFile failed:', e.message);
    return;
  }
  if (!filePath) return;

  try {
    const res = await api.importTemplateSampleFile(selectedTemplate.id, filePath);
    if (!res || !res.success) {
      msg.textContent = (res && res.error) || 'Could not import that file.';
      msg.style.color = 'var(--err)';
      return;
    }
    selectedTemplate = res.template;
    const idx = allTemplates.findIndex(t => t.id === res.template.id);
    if (idx !== -1) allTemplates[idx] = res.template;
    await loadSampleCandidates(selectedTemplate);
    await loadSamplePages(selectedTemplate);
    msg.textContent = 'Sample file attached.';
  } catch (e) {
    console.warn('importTemplateSampleFile failed:', e.message);
    msg.textContent = 'Could not import that file.';
    msg.style.color = 'var(--err)';
  }
});

// Mirrors fileArgs() in search/renderer.js — confirmed documents resolve their
// preview path from stored_path/stored_filename, everything else from
// folder_path/original_filename. Sample documents pinned here are always
// confirmed (see get-template-sample-candidates), but this keeps the helper
// correct even if that constraint loosens later.
function tplFileArgs(doc) {
  if (doc.status === 'confirmed' && doc.stored_path && doc.stored_filename) {
    const lastSep = Math.max(doc.stored_path.lastIndexOf('\\'), doc.stored_path.lastIndexOf('/'));
    return { folderPath: doc.stored_path.substring(0, lastSep), filename: doc.stored_filename };
  }
  return { folderPath: doc.folder_path, filename: doc.original_filename };
}

async function loadSamplePages(detail) {
  tplPageImages  = [];
  tplCurrentPage = 0;

  const sample = detail.sample_document;
  if (sample) {
    const { folderPath, filename } = tplFileArgs(sample);
    if (folderPath && filename) {
      try {
        tplPageImages = await api.getDocumentPages(sample.id, folderPath, filename) || [];
      } catch (e) {
        console.warn('getDocumentPages (template sample) failed:', e.message);
      }
    }
  }
  renderTplPage();
}

function renderTplPage() {
  const placeholder = document.getElementById('tpl-doc-placeholder');
  const wrap        = document.getElementById('tpl-img-wrap');
  const indicator   = document.getElementById('tpl-page-indicator');

  if (!tplPageImages.length) {
    wrap.style.display        = 'none';
    placeholder.style.display = '';
    placeholder.textContent   = selectedTemplate?.sample_document
      ? 'No preview available for this sample document.'
      : 'No sample document pinned for this template yet — pick one above.';
    indicator.textContent = '—';
    return;
  }

  placeholder.style.display = 'none';
  wrap.style.display        = 'inline-block';
  resetTplView();
  tplImg.onload = () => {
    tplCanvas.width  = tplImg.offsetWidth;
    tplCanvas.height = tplImg.offsetHeight;
    redrawTplCanvas();
  };
  tplImg.src = tplPageImages[tplCurrentPage];
  indicator.textContent = `Page ${tplCurrentPage + 1} / ${tplPageImages.length}`;
}

document.getElementById('tpl-btn-page-prev').addEventListener('click', () => {
  if (tplCurrentPage > 0) { tplCurrentPage--; renderTplPage(); }
});
document.getElementById('tpl-btn-page-next').addEventListener('click', () => {
  if (tplCurrentPage < tplPageImages.length - 1) { tplCurrentPage++; renderTplPage(); }
});

// ── Zoom / pan (Phase 2 layout pass) ─────────────────────────────────────────
// CSS-transform scale+translate on #tpl-img-wrap. Kept independent of the
// canvas's internal pixel buffer — see coordinate-conversion note on the
// drawing handlers below — so existing anchor/target drawing keeps working
// unchanged at any zoom level.

function applyTplTransform() {
  tplImgWrap.style.transform = `translate(${tplPanX}px, ${tplPanY}px) scale(${tplZoom})`;
  document.getElementById('tpl-zoom-level').textContent = Math.round(tplZoom * 100) + '%';
}

function setTplZoom(zoom) {
  tplZoom = Math.max(TPL_ZOOM_MIN, Math.min(TPL_ZOOM_MAX, zoom));
  applyTplTransform();
}

function resetTplView() {
  tplZoom = 1;
  tplPanX = 0;
  tplPanY = 0;
  applyTplTransform();
}

document.getElementById('tpl-btn-zoom-in').addEventListener('click', () => setTplZoom(tplZoom + TPL_ZOOM_STEP));
document.getElementById('tpl-btn-zoom-out').addEventListener('click', () => setTplZoom(tplZoom - TPL_ZOOM_STEP));
document.getElementById('tpl-btn-zoom-reset').addEventListener('click', resetTplView);

tplViewer.addEventListener('wheel', (e) => {
  if (!tplPageImages.length) return;
  e.preventDefault();
  setTplZoom(tplZoom + (e.deltaY < 0 ? TPL_ZOOM_STEP : -TPL_ZOOM_STEP));
}, { passive: false });

// Right-click pan — works in and out of draw mode so the user can always
// reposition without toggling tools. Left-click is reserved for drawing.
// contextmenu is suppressed so the right-click drag doesn't pop a menu.
tplViewer.addEventListener('mousedown', (e) => {
  if (e.button !== 2 || !tplPageImages.length) return;
  tplIsPanning = true;
  tplPanStart  = { x: e.clientX, y: e.clientY, panX: tplPanX, panY: tplPanY };
  tplViewer.classList.add('panning');
});
tplViewer.addEventListener('contextmenu', e => { if (tplPageImages.length) e.preventDefault(); });
// Prevent the browser's native image-drag (ghost image follows cursor on left-click drag).
tplViewer.addEventListener('dragstart', e => e.preventDefault());
window.addEventListener('mousemove', (e) => {
  if (!tplIsPanning || !tplPanStart) return;
  tplPanX = tplPanStart.panX + (e.clientX - tplPanStart.x);
  tplPanY = tplPanStart.panY + (e.clientY - tplPanStart.y);
  applyTplTransform();
});
window.addEventListener('mouseup', () => {
  if (!tplIsPanning) return;
  tplIsPanning = false;
  tplPanStart  = null;
  tplViewer.classList.remove('panning');
});

// ── Canvas resize sync (Pass 2) ──────────────────────────────────────────────
// #tpl-img uses max-width/max-height so its CSS display size changes when the
// window is resized or maximised. The canvas buffer must stay in sync or the
// normalised-coordinate boxes drift off the landmarks they were placed on.
new ResizeObserver(() => {
  if (!tplPageImages.length) return;
  const w = tplImg.offsetWidth, h = tplImg.offsetHeight;
  if (!w || !h || (w === tplCanvas.width && h === tplCanvas.height)) return;
  tplCanvas.width  = w;
  tplCanvas.height = h;
  redrawTplCanvas();
}).observe(tplImg);

// Full redraw: saved (enabled) mappings underneath, then whatever the editor
// currently has in flight (draft anchor/target boxes, live drag rectangle) on
// top — so drawing a new box never has to fight the persisted overlay for
// visibility.
function redrawTplCanvas() {
  tplCtx.clearRect(0, 0, tplCanvas.width, tplCanvas.height);
  drawSavedMappings();
  const w = tplCanvas.width, h = tplCanvas.height;
  if (tplDraftAnchor && (tplDraftAnchor.page_number || 0) === tplCurrentPage) {
    const sel = tplSelectedBox?.boxType === 'anchor';
    drawNormBox(tplDraftAnchor.x_norm, tplDraftAnchor.y_norm, tplDraftAnchor.w_norm, tplDraftAnchor.h_norm, w, h, '#4f8ef7', 'anchor (draft)', sel);
  }
  if (tplDraftTarget && (tplDraftTarget.page_number || 0) === tplCurrentPage) {
    const sel = tplSelectedBox?.boxType === 'target';
    drawNormBox(tplDraftTarget.x_norm, tplDraftTarget.y_norm, tplDraftTarget.w_norm, tplDraftTarget.h_norm, w, h, '#3ecf8e', 'target (draft)', sel);
  }
  if (tplDragRect) {
    const dragColor = tplMapMode === 'target' ? '#3ecf8e' : '#4f8ef7';
    tplCtx.setLineDash([4, 3]);
    tplCtx.strokeStyle = 'rgba(0,0,0,0.4)';
    tplCtx.lineWidth   = 4;
    tplCtx.strokeRect(tplDragRect.x, tplDragRect.y, tplDragRect.w, tplDragRect.h);
    tplCtx.strokeStyle = dragColor;
    tplCtx.lineWidth   = 2;
    tplCtx.strokeRect(tplDragRect.x, tplDragRect.y, tplDragRect.w, tplDragRect.h);
    tplCtx.setLineDash([]);
    tplCtx.fillStyle   = dragColor + '18';
    tplCtx.fillRect(tplDragRect.x, tplDragRect.y, tplDragRect.w, tplDragRect.h);
  }
}

// Read-only layer: draws each OTHER enabled mapping's anchor box (blue) and
// target zone (green) at its stored normalised position — the same x/y/w/h_norm
// fractional coordinate system field_anchors already uses, so it scales
// correctly to whatever size the preview image renders at. The mapping
// currently open in the editor is skipped here — its (possibly edited) boxes
// are drawn as the draft layer in redrawTplCanvas() instead, so it isn't shown twice.
function drawSavedMappings() {
  if (!selectedTemplate) return;
  const w = tplCanvas.width, h = tplCanvas.height;

  for (const m of (selectedTemplate.field_mappings || [])) {
    if (!m.enabled) continue;
    if (m.field_key === tplEditingFieldKey) continue;
    if ((m.page_number || 0) !== tplCurrentPage) continue;
    const asel = tplSelectedBox?.fieldKey === m.field_key && tplSelectedBox?.boxType === 'anchor';
    const tsel = tplSelectedBox?.fieldKey === m.field_key && tplSelectedBox?.boxType === 'target';
    drawNormBox(m.anchor_x_norm, m.anchor_y_norm, m.anchor_w_norm, m.anchor_h_norm, w, h, '#4f8ef7', `${m.field_key} anchor`, asel);
    drawNormBox(m.target_x_norm, m.target_y_norm, m.target_w_norm, m.target_h_norm, w, h, '#3ecf8e', m.field_key, tsel);
  }
}

function drawNormBox(xN, yN, wN, hN, w, h, color, label, selected = false) {
  if ([xN, yN, wN, hN].some(v => v == null)) return;
  const x = xN * w, y = yN * h, bw = wN * w, bh = hN * h;
  const lw = selected ? 3 : 2;
  tplCtx.setLineDash(selected ? [] : [4, 3]);
  // Dark outline behind color stroke for visibility on white documents
  tplCtx.strokeStyle = 'rgba(0,0,0,0.3)';
  tplCtx.lineWidth   = lw + 2;
  tplCtx.strokeRect(x, y, bw, bh);
  tplCtx.strokeStyle = color;
  tplCtx.lineWidth   = lw;
  tplCtx.strokeRect(x, y, bw, bh);
  tplCtx.fillStyle   = color + (selected ? '40' : '26');
  tplCtx.fillRect(x, y, bw, bh);
  tplCtx.setLineDash([]);
}

// ── Hit testing ──────────────────────────────────────────────────────────────
// Returns { fieldKey, boxType:'anchor'|'target' } for the topmost box under
// the canvas-space point, or null. Draft boxes (current editing field) are
// checked first — they render on top.
function hitTestBoxes(pt) {
  const w = tplCanvas.width, h = tplCanvas.height;
  if (tplEditingFieldKey) {
    if (tplDraftAnchor && (tplDraftAnchor.page_number || 0) === tplCurrentPage && normHit(pt, tplDraftAnchor, w, h))
      return { fieldKey: tplEditingFieldKey, boxType: 'anchor' };
    if (tplDraftTarget && (tplDraftTarget.page_number || 0) === tplCurrentPage && normHit(pt, tplDraftTarget, w, h))
      return { fieldKey: tplEditingFieldKey, boxType: 'target' };
  }
  for (const m of (selectedTemplate?.field_mappings || [])) {
    if (!m.enabled || m.field_key === tplEditingFieldKey) continue;
    if ((m.page_number || 0) !== tplCurrentPage) continue;
    if (mappingBoxHit(pt, m, 'anchor', w, h)) return { fieldKey: m.field_key, boxType: 'anchor' };
    if (mappingBoxHit(pt, m, 'target', w, h)) return { fieldKey: m.field_key, boxType: 'target' };
  }
  return null;
}
function normHit(pt, n, w, h) {
  return pt.x >= n.x_norm * w && pt.x <= (n.x_norm + n.w_norm) * w &&
         pt.y >= n.y_norm * h && pt.y <= (n.y_norm + n.h_norm) * h;
}
function mappingBoxHit(pt, m, type, w, h) {
  const xN = m[`${type}_x_norm`], yN = m[`${type}_y_norm`];
  const wN = m[`${type}_w_norm`], hN = m[`${type}_h_norm`];
  if ([xN, yN, wN, hN].some(v => v == null)) return false;
  return pt.x >= xN * w && pt.x <= (xN + wN) * w &&
         pt.y >= yN * h && pt.y <= (yN + hN) * h;
}
// Get/set the normalised coords of a selected box (always via draft state after load).
function getBoxNorm(sel) {
  return sel.boxType === 'anchor' ? { ...tplDraftAnchor } : { ...tplDraftTarget };
}
function setBoxNorm(sel, norm) {
  if (sel.boxType === 'anchor') tplDraftAnchor = norm;
  else                          tplDraftTarget = norm;
}

// ── Drawing tools (Phase 2) ──────────────────────────────────────────────────
// Left-click in draw mode: drag to draw a new box.
// Left-click outside draw mode: click-to-select / drag-to-move an existing box.
// Right-click: pan (handled on tplViewer, not here).

function enterDrawMode(mode) {
  if (!selectedTemplate || !tplPageImages.length || !tplEditingFieldKey) return;
  tplMapMode = mode;
  tplCanvas.classList.add('drawing');
  document.getElementById('tpl-btn-draw-anchor').classList.toggle('primary', mode === 'anchor');
  document.getElementById('tpl-btn-draw-target').classList.toggle('primary', mode === 'target');
}

function exitDrawMode() {
  tplMapMode    = null;
  tplIsDragging = false;
  tplDragRect   = null;
  tplCanvas.style.cursor = 'default';
  tplCanvas.classList.remove('drawing');
  document.getElementById('tpl-btn-draw-anchor').classList.remove('primary');
  document.getElementById('tpl-btn-draw-target').classList.remove('primary');
}

document.getElementById('tpl-btn-draw-anchor').addEventListener('click', () => {
  if (tplMapMode === 'anchor') exitDrawMode();
  else enterDrawMode('anchor');
});
document.getElementById('tpl-btn-draw-target').addEventListener('click', () => {
  if (tplMapMode === 'target') exitDrawMode();
  else enterDrawMode('target');
});

// Mouse coordinates arrive in CSS (post-zoom) pixels via getBoundingClientRect,
// while tplCanvas.width/height stay at the unscaled rendered-image size — the
// canvas is never resized for zoom, only visually scaled along with #tpl-img-wrap.
// Multiplying by (canvas buffer size / bounding-rect size) converts back to
// canvas-pixel space, so drawn boxes land in the right place at any zoom level
// (ratio is 1 at zoom=1, leaving today's behaviour unchanged).
function tplCanvasPoint(e) {
  const r = tplCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (tplCanvas.width  / r.width),
    y: (e.clientY - r.top)  * (tplCanvas.height / r.height),
  };
}

tplCanvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !tplPageImages.length) return;
  const pt = tplCanvasPoint(e);

  if (tplMapMode) {
    // Draw mode: start a new box
    tplIsDragging = true;
    tplDragStart  = pt;
    tplDragRect   = { x: pt.x, y: pt.y, w: 0, h: 0 };
    return;
  }

  // Normal mode: hit-test existing boxes
  const hit = hitTestBoxes(pt);
  if (hit) {
    // If a different field's box was clicked, load it into the editor first
    if (hit.fieldKey !== tplEditingFieldKey) {
      const sel = document.getElementById('tpl-map-field-select');
      if (sel) sel.value = hit.fieldKey;
      loadMappingIntoEditor(hit.fieldKey);
      // loadMappingIntoEditor clears tplSelectedBox; set it after
    }
    tplSelectedBox = { fieldKey: hit.fieldKey, boxType: hit.boxType };
    tplMoveStart   = { pt, origNorm: getBoxNorm(tplSelectedBox) };
    redrawTplCanvas();
  } else {
    // Empty space: clear selection
    if (tplSelectedBox) { tplSelectedBox = null; redrawTplCanvas(); }
  }
});

tplCanvas.addEventListener('mousemove', (e) => {
  if (tplIsDragging && tplDragRect) {
    // Drawing a new box
    const { x: cx, y: cy } = tplCanvasPoint(e);
    tplDragRect = {
      x: Math.min(tplDragStart.x, cx),
      y: Math.min(tplDragStart.y, cy),
      w: Math.abs(cx - tplDragStart.x),
      h: Math.abs(cy - tplDragStart.y),
    };
    redrawTplCanvas();
    return;
  }

  if (tplMoveStart && tplSelectedBox) {
    // Moving a selected box
    tplIsMoving  = true;
    const pt = tplCanvasPoint(e);
    const dx = (pt.x - tplMoveStart.pt.x) / tplCanvas.width;
    const dy = (pt.y - tplMoveStart.pt.y) / tplCanvas.height;
    const o  = tplMoveStart.origNorm;
    setBoxNorm(tplSelectedBox, {
      ...o,
      x_norm: Math.max(0, Math.min(1 - o.w_norm, o.x_norm + dx)),
      y_norm: Math.max(0, Math.min(1 - o.h_norm, o.y_norm + dy)),
    });
    redrawTplCanvas();
    return;
  }

  // Hover cursor: show move cursor when over an existing box
  if (!tplMapMode) {
    tplCanvas.style.cursor = hitTestBoxes(tplCanvasPoint(e)) ? 'move' : 'default';
  }
});

tplCanvas.addEventListener('mouseup', () => {
  if (tplIsDragging) {
    tplIsDragging = false;
    const rect = tplDragRect;
    tplDragRect  = null;
    if (!rect || !tplMapMode || rect.w < 8 || rect.h < 8) { redrawTplCanvas(); return; }
    const norm = {
      x_norm: rect.x / tplCanvas.width,   y_norm: rect.y / tplCanvas.height,
      w_norm: rect.w / tplCanvas.width,   h_norm: rect.h / tplCanvas.height,
      page_number: tplCurrentPage,
    };
    if (tplMapMode === 'anchor') { tplDraftAnchor = norm; autoDetectAnchorText(rect); }
    else                         { tplDraftTarget = norm; }
    exitDrawMode();
    updateMappingEditorState();
    redrawTplCanvas();
    return;
  }

  if (tplMoveStart) {
    tplIsMoving  = false;
    tplMoveStart = null;
    if (tplSelectedBox) updateMappingEditorState();
    redrawTplCanvas();
  }
});

// Keyboard nudge — arrow keys move the selected box by a small (or large with Shift) step.
// Ignored when focus is inside any text input, textarea, or select element.
window.addEventListener('keydown', (e) => {
  if (!tplSelectedBox) return;
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  if (!ARROWS.includes(e.key)) return;
  e.preventDefault();

  const step = e.shiftKey ? 0.01 : 0.002;
  const norm = getBoxNorm(tplSelectedBox);
  if (!norm || norm.x_norm == null) return;

  let dx = 0, dy = 0;
  if (e.key === 'ArrowLeft')  dx = -step;
  if (e.key === 'ArrowRight') dx =  step;
  if (e.key === 'ArrowUp')    dy = -step;
  if (e.key === 'ArrowDown')  dy =  step;

  setBoxNorm(tplSelectedBox, {
    ...norm,
    x_norm: Math.max(0, Math.min(1 - norm.w_norm, norm.x_norm + dx)),
    y_norm: Math.max(0, Math.min(1 - norm.h_norm, norm.y_norm + dy)),
  });
  redrawTplCanvas();
  updateMappingEditorState();
});

// Best-effort prefill — OCRs the box the admin just drew for the anchor and
// drops the recognised text into the label field, exactly the crop→base64→
// ocrRegion round trip the review window's zone-OCR tool uses (just without
// writing the result back into a document field).
async function autoDetectAnchorText(rect) {
  try {
    const scaleX = tplImg.naturalWidth  / tplImg.offsetWidth;
    const scaleY = tplImg.naturalHeight / tplImg.offsetHeight;
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width  = Math.max(1, Math.round(rect.w * scaleX));
    cropCanvas.height = Math.max(1, Math.round(rect.h * scaleY));
    cropCanvas.getContext('2d').drawImage(
      tplImg,
      Math.round(rect.x * scaleX), Math.round(rect.y * scaleY),
      cropCanvas.width, cropCanvas.height,
      0, 0, cropCanvas.width, cropCanvas.height
    );
    const text = (await api.ocrRegion(cropCanvas.toDataURL('image/png').split(',')[1]) || '').trim();
    if (text) document.getElementById('tpl-map-anchor-text').value = text;
  } catch (e) {
    console.warn('anchor auto-OCR failed:', e.message);
  }
}

// ── Mapping editor (Phase 2) ─────────────────────────────────────────────────

async function populateMapFieldSelect(detail) {
  if (!allTypesWithFields.length) {
    try { await loadDocTypes(); } catch (e) { console.warn('loadDocTypes (for mapping fields) failed:', e.message); }
  }
  const select = document.getElementById('tpl-map-field-select');
  select.innerHTML = '';

  const dt     = allTypesWithFields.find(t => t.slug === detail.document_type_slug);
  const fields = (dt ? dt.fields : []) || [];
  for (const f of fields) {
    const opt = document.createElement('option');
    opt.value = f.key;
    opt.textContent = `${f.label} (${f.key})`;
    select.appendChild(opt);
  }
  select.onchange = () => loadMappingIntoEditor(select.value || null);

  if (fields.length) { select.value = fields[0].key; loadMappingIntoEditor(fields[0].key); }
  else loadMappingIntoEditor(null);
}

function loadMappingIntoEditor(fieldKey) {
  exitDrawMode();
  tplSelectedBox     = null;
  tplIsMoving        = false;
  tplMoveStart       = null;
  tplEditingFieldKey = fieldKey;

  const existing = fieldKey
    ? (selectedTemplate?.field_mappings || []).find(m => m.field_key === fieldKey)
    : null;

  if (existing) {
    tplDraftAnchor = {
      x_norm: existing.anchor_x_norm, y_norm: existing.anchor_y_norm,
      w_norm: existing.anchor_w_norm, h_norm: existing.anchor_h_norm,
      page_number: existing.page_number || 0,
    };
    tplDraftTarget = {
      x_norm: existing.target_x_norm, y_norm: existing.target_y_norm,
      w_norm: existing.target_w_norm, h_norm: existing.target_h_norm,
      page_number: existing.page_number || 0,
    };
    document.getElementById('tpl-map-anchor-text').value = existing.anchor_text || '';
    document.getElementById('tpl-map-ocr-type').value    = existing.ocr_type || 'text';
    const pct = Math.round((existing.search_expansion ?? 0.04) * 100);
    document.getElementById('tpl-map-expansion').value     = pct;
    document.getElementById('tpl-map-expansion-val').textContent = pct + '%';
    document.getElementById('tpl-map-enabled').checked   = existing.enabled !== 0;
    document.getElementById('tpl-btn-delete-mapping').style.display = '';

    if ((existing.page_number || 0) !== tplCurrentPage) {
      tplCurrentPage = existing.page_number || 0;
      renderTplPage();
    }
  } else {
    tplDraftAnchor = null;
    tplDraftTarget = null;
    document.getElementById('tpl-map-anchor-text').value = '';
    document.getElementById('tpl-map-ocr-type').value    = 'text';
    document.getElementById('tpl-map-expansion').value     = 4;
    document.getElementById('tpl-map-expansion-val').textContent = '4%';
    document.getElementById('tpl-map-enabled').checked   = true;
    document.getElementById('tpl-btn-delete-mapping').style.display = 'none';
  }

  document.getElementById('tpl-mapping-msg').textContent = '';
  updateMappingEditorState();
  redrawTplCanvas();
}

function updateMappingEditorState() {
  const anchorOk = !!tplDraftAnchor;
  const targetOk = !!tplDraftTarget;

  const aEl = document.getElementById('tpl-anchor-status');
  const tEl = document.getElementById('tpl-target-status');
  aEl.textContent = anchorOk ? 'Anchor: drawn ✓' : 'Anchor: not drawn';
  aEl.className   = 'mapping-status' + (anchorOk ? ' ok' : '');
  tEl.textContent = targetOk ? 'Target: drawn ✓' : 'Target: not drawn';
  tEl.className   = 'mapping-status' + (targetOk ? ' ok' : '');

  const ready = anchorOk && targetOk && !!tplEditingFieldKey;
  document.getElementById('tpl-btn-save-mapping').disabled = !ready;
  document.getElementById('tpl-btn-test-mapping').disabled = !ready;
}

document.getElementById('tpl-map-expansion').addEventListener('input', (e) => {
  document.getElementById('tpl-map-expansion-val').textContent = e.target.value + '%';
});

document.getElementById('tpl-btn-cancel-mapping').addEventListener('click', () => {
  if (tplEditingFieldKey) loadMappingIntoEditor(tplEditingFieldKey);
});

document.getElementById('tpl-btn-save-mapping').addEventListener('click', async () => {
  if (!selectedTemplate || !tplEditingFieldKey || !tplDraftAnchor || !tplDraftTarget) return;
  const msg = document.getElementById('tpl-mapping-msg');

  const mapping = {
    field_key:        tplEditingFieldKey,
    page_number:      tplDraftAnchor.page_number || 0,
    anchor_text:      document.getElementById('tpl-map-anchor-text').value.trim() || null,
    anchor_x_norm: tplDraftAnchor.x_norm, anchor_y_norm: tplDraftAnchor.y_norm,
    anchor_w_norm: tplDraftAnchor.w_norm, anchor_h_norm: tplDraftAnchor.h_norm,
    target_x_norm: tplDraftTarget.x_norm, target_y_norm: tplDraftTarget.y_norm,
    target_w_norm: tplDraftTarget.w_norm, target_h_norm: tplDraftTarget.h_norm,
    ocr_type:         document.getElementById('tpl-map-ocr-type').value,
    search_expansion: parseInt(document.getElementById('tpl-map-expansion').value, 10) / 100,
    enabled:          document.getElementById('tpl-map-enabled').checked,
  };

  try {
    const res = await api.saveTemplateMapping(selectedTemplate.id, mapping);
    if (!res || !res.success) {
      msg.textContent = res?.error || 'Save failed.';
      msg.style.color = 'var(--err)';
      return;
    }
    msg.textContent = 'Mapping saved.';
    msg.style.color = 'var(--ok)';
    await refreshSelectedTemplate();
    loadMappingIntoEditor(tplEditingFieldKey);
  } catch (e) {
    msg.textContent = 'Save failed: ' + e.message;
    msg.style.color = 'var(--err)';
  }
});

document.getElementById('tpl-btn-delete-mapping').addEventListener('click', async () => {
  if (!selectedTemplate || !tplEditingFieldKey) return;
  if (!confirm(`Delete the mapping for "${tplEditingFieldKey}"? This cannot be undone.`)) return;

  const msg = document.getElementById('tpl-mapping-msg');
  try {
    await api.deleteTemplateMapping(selectedTemplate.id, tplEditingFieldKey);
    msg.textContent = 'Mapping deleted.';
    msg.style.color = 'var(--muted)';
    await refreshSelectedTemplate();
    loadMappingIntoEditor(tplEditingFieldKey);
  } catch (e) {
    msg.textContent = 'Delete failed: ' + e.message;
    msg.style.color = 'var(--err)';
  }
});

// "Test extraction" — crops exactly the drawn target zone from the pinned
// sample and runs it through the same ocr-region primitive the review
// window's teaching tool uses, then persists the result so it survives a
// reload. This proves out the target geometry against real pixels without
// needing template_mapper.py / engine.py wiring (Phase 3) to exist yet.
document.getElementById('tpl-btn-test-mapping').addEventListener('click', async () => {
  if (!selectedTemplate || !tplEditingFieldKey || !tplDraftTarget || !tplPageImages.length) return;
  const msg = document.getElementById('tpl-mapping-msg');
  msg.textContent = 'Testing…';
  msg.style.color = 'var(--muted)';

  try {
    if ((tplDraftTarget.page_number || 0) !== tplCurrentPage) {
      tplCurrentPage = tplDraftTarget.page_number || 0;
      renderTplPage();
      await new Promise(resolve => { tplImg.onload = () => { tplCanvas.width = tplImg.offsetWidth; tplCanvas.height = tplImg.offsetHeight; redrawTplCanvas(); resolve(); }; });
    }

    const scaleX = tplImg.naturalWidth  / tplImg.offsetWidth;
    const scaleY = tplImg.naturalHeight / tplImg.offsetHeight;
    const rect = {
      x: tplDraftTarget.x_norm * tplImg.offsetWidth,
      y: tplDraftTarget.y_norm * tplImg.offsetHeight,
      w: tplDraftTarget.w_norm * tplImg.offsetWidth,
      h: tplDraftTarget.h_norm * tplImg.offsetHeight,
    };
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width  = Math.max(1, Math.round(rect.w * scaleX));
    cropCanvas.height = Math.max(1, Math.round(rect.h * scaleY));
    cropCanvas.getContext('2d').drawImage(
      tplImg,
      Math.round(rect.x * scaleX), Math.round(rect.y * scaleY),
      cropCanvas.width, cropCanvas.height,
      0, 0, cropCanvas.width, cropCanvas.height
    );
    const text = (await api.ocrRegion(cropCanvas.toDataURL('image/png').split(',')[1]) || '').trim();
    const status = text ? 'ok' : 'not_found';

    await api.recordTemplateMappingTest(selectedTemplate.id, tplEditingFieldKey, {
      value: text || null, confidence: text ? 90 : 0, status,
    });

    msg.textContent = text ? `Test result: "${text}"` : 'Test result: nothing recognised in the target zone.';
    msg.style.color = text ? 'var(--ok)' : 'var(--warn)';
    await refreshSelectedTemplate();
    renderMappingsTable(selectedTemplate);
  } catch (e) {
    msg.textContent = 'Test failed: ' + e.message;
    msg.style.color = 'var(--err)';
  }
});

// Re-fetches the template detail after a mutation and keeps the list/cache in sync.
async function refreshSelectedTemplate() {
  if (!selectedTemplate) return;
  const refreshed = await api.getTemplateDetail(selectedTemplate.id);
  if (!refreshed) return;
  selectedTemplate = refreshed;
  const idx = allTemplates.findIndex(t => t.id === refreshed.id);
  if (idx !== -1) allTemplates[idx] = refreshed;
  renderTemplateList();
  renderMappingsTable(refreshed);
}

function renderMappingsTable(detail) {
  const tbody = document.getElementById('tpl-mappings-tbody');
  const empty = document.getElementById('tpl-mappings-empty');
  const mappings = detail.field_mappings || [];
  tbody.innerHTML = '';
  empty.style.display = mappings.length ? 'none' : '';

  for (const m of mappings) {
    let lastTest = '—';
    if (m.last_test_status) {
      const cls = m.last_test_status === 'ok' ? 'ok' : m.last_test_status === 'low_confidence' ? 'warn' : 'err';
      const conf = m.last_test_confidence != null ? ` · ${Math.round(m.last_test_confidence)}%` : '';
      lastTest = `<span class="mapping-status ${cls}">${escHtml(m.last_test_value || m.last_test_status)}${conf}</span>`;
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="field-key">${escHtml(m.field_key)}</span></td>
      <td>${escHtml(m.anchor_text || '—')}</td>
      <td>${escHtml(m.ocr_type)}</td>
      <td>${Math.round((m.search_expansion || 0) * 100)}%</td>
      <td>${lastTest}</td>
      <td>${m.enabled ? 'Yes' : 'No'}</td>
    `;
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => {
      const select = document.getElementById('tpl-map-field-select');
      select.value = m.field_key;
      loadMappingIntoEditor(m.field_key);
    });
    tbody.appendChild(tr);
  }
}

function renderSelectorAnchorsTable(detail) {
  const tbody  = document.getElementById('tpl-fields-tbody');
  const fields = detail.fields || [];
  tbody.innerHTML = '';

  if (!fields.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="section-desc">No selector anchors recorded for this template.</td></tr>';
    return;
  }
  for (const f of fields) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="field-key">${escHtml(f.field_key)}</span></td>
      <td>${escHtml(f.anchor_label || '—')}</td>
      <td>${escHtml(f.direction)}</td>
      <td>${f.is_variable ? 'Yes' : 'No (fixed)'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LEARNING RECOVERY TAB
// ══════════════════════════════════════════════════════════════════════════════
// Read-only inspection + small targeted cleanup for the automatic-learning
// corpora (field anchors, supplier hints, corrections, logo fingerprints),
// scoped to a supplier name and optional document type. Managed templates are
// shown for context only — clearing here never touches the templates table.

let lrCurrentScope = null;

async function populateLearningDocTypes() {
  if (!allTypesWithFields.length) {
    try { await loadDocTypes(); } catch (e) { console.warn('loadDocTypes (learning recovery) failed:', e.message); }
  }
  const select = document.getElementById('lr-doctype');
  for (const dt of allTypesWithFields) {
    const opt = document.createElement('option');
    opt.value = dt.slug;
    opt.textContent = dt.name;
    select.appendChild(opt);
  }
}

function renderLearningSummary(summary) {
  document.getElementById('lr-summary').textContent =
    `Field anchors: ${summary.anchors}    ·    Supplier hints: ${summary.hints}    ·    ` +
    `Corrections: ${summary.corrections}    ·    Logo fingerprints: ${summary.logos}`;
}

function renderLearningTemplates(rows) {
  const el = document.getElementById('lr-templates');
  if (!rows.length) { el.textContent = 'No managed templates match this name.'; return; }
  el.innerHTML = rows.map(t =>
    `<div>${escHtml(t.name)} <span class="field-key">(${escHtml(t.document_type_slug || '—')}, confirmed ${t.confirmed_count}×)</span></div>`
  ).join('');
}

function renderLearningDetail(detail) {
  const lines = [];

  if (detail.anchors.length) {
    lines.push('<div class="section-title" style="margin-top:0;">Field Anchors</div>');
    for (const a of detail.anchors) {
      lines.push(`<div>${escHtml(a.field_key)} — "${escHtml(a.anchor_label)}" (${escHtml(a.direction)}), ` +
        `type: ${escHtml(a.document_type || '—')}, used ${a.usage_count}×, conf ${(a.confidence ?? 0).toFixed(2)}, last ${escHtml(a.last_seen)}</div>`);
    }
  }
  if (detail.hints.length) {
    lines.push('<div class="section-title" style="margin-top:10px;">Supplier Hints</div>');
    for (const h of detail.hints) {
      lines.push(`<div>${escHtml(h.field_key)} = "${escHtml(h.hint_value)}", type: ${escHtml(h.document_type || '—')}, used ${h.usage_count}×, last ${escHtml(h.last_seen)}</div>`);
    }
  }
  if (detail.corrections.length) {
    lines.push('<div class="section-title" style="margin-top:10px;">Corrections</div>');
    for (const c of detail.corrections) {
      lines.push(`<div>${escHtml(c.field_key)}: "${escHtml(c.original_value || '')}" → "${escHtml(c.corrected_value)}", type: ${escHtml(c.document_type || '—')}, ${escHtml(c.corrected_at)}</div>`);
    }
  }
  if (detail.logos.length) {
    lines.push('<div class="section-title" style="margin-top:10px;">Logo Fingerprints</div>');
    for (const l of detail.logos) {
      lines.push(`<div>${escHtml(l.phash)}, matched ${l.match_count}×, last ${escHtml(l.last_seen)}</div>`);
    }
  }

  document.getElementById('lr-detail').innerHTML = lines.length ? lines.join('') : '<div>No detail rows.</div>';
}

async function runLearningSearch() {
  const supplier_name = document.getElementById('lr-supplier').value.trim();
  const document_type = document.getElementById('lr-doctype').value || null;
  const resultsEl = document.getElementById('lr-results');
  const emptyEl   = document.getElementById('lr-empty');
  document.getElementById('lr-msg').textContent = '';

  if (!supplier_name) {
    resultsEl.style.display = 'none';
    emptyEl.style.display = 'none';
    lrCurrentScope = null;
    return;
  }

  let data;
  try {
    data = await api.getLearningRecovery({ supplier_name, document_type });
  } catch (e) {
    console.warn('getLearningRecovery failed:', e.message);
    return;
  }

  lrCurrentScope = { supplier_name, document_type };

  const s = data?.summary;
  const hasData = s && (s.anchors || s.hints || s.corrections || s.logos || data.templates.length);

  if (!hasData) {
    resultsEl.style.display = 'none';
    emptyEl.style.display = '';
    return;
  }

  emptyEl.style.display = 'none';
  resultsEl.style.display = '';
  renderLearningSummary(s);
  renderLearningTemplates(data.templates);
  renderLearningDetail(data.detail);
}

document.getElementById('lr-btn-search').addEventListener('click', runLearningSearch);
document.getElementById('lr-supplier').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runLearningSearch();
});

document.getElementById('lr-btn-clear-anchors').addEventListener('click', async () => {
  if (!lrCurrentScope) return;
  const { supplier_name, document_type } = lrCurrentScope;
  const scopeLabel = document_type ? `${supplier_name} / ${document_type}` : supplier_name;
  if (!confirm(`Clear all field anchors learned for "${scopeLabel}"? This cannot be undone.`)) return;
  const result = await api.clearLearningAnchors(lrCurrentScope);
  document.getElementById('lr-msg').textContent = `Cleared ${result.changes} field anchor(s).`;
  await runLearningSearch();
});

document.getElementById('lr-btn-clear-hints').addEventListener('click', async () => {
  if (!lrCurrentScope) return;
  const { supplier_name, document_type } = lrCurrentScope;
  const scopeLabel = document_type ? `${supplier_name} / ${document_type}` : supplier_name;
  if (!confirm(`Clear all supplier hints learned for "${scopeLabel}"? This cannot be undone.`)) return;
  const result = await api.clearLearningHints(lrCurrentScope);
  document.getElementById('lr-msg').textContent = `Cleared ${result.changes} supplier hint(s).`;
  await runLearningSearch();
});

document.getElementById('lr-btn-clear-corrections').addEventListener('click', async () => {
  if (!lrCurrentScope) return;
  const { supplier_name, document_type } = lrCurrentScope;
  const scopeLabel = document_type ? `${supplier_name} / ${document_type}` : supplier_name;
  const confirmed = await showTypedConfirmDialog({
    title: 'Clear corrections — extreme-use recovery',
    warningHtml:
      `This permanently removes all confirmed correction history for ` +
      `<strong style="color:var(--text);">${escHtml(scopeLabel)}</strong>. ` +
      `Corrections are the audit trail behind format-anomaly learning and cannot be recovered. ` +
      `Use only when learning has become polluted and narrower cleanup has failed.`,
    requiredText: supplier_name,
    confirmLabel: 'Clear corrections',
  });
  if (!confirmed) return;
  const result = await api.clearLearningCorrections(lrCurrentScope);
  document.getElementById('lr-msg').textContent = `Cleared ${result.changes} correction(s).`;
  await runLearningSearch();
});

populateLearningDocTypes();

// ── Init ──────────────────────────────────────────────────────────────────────
loadDocTypes();
loadFieldsTabTypes();
loadUsers();
loadAuditLog();
loadTemplates();
