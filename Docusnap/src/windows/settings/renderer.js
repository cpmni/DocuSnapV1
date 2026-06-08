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
    allTemplates = await api.getTemplates() || [];
  } catch (e) {
    console.warn('getTemplates failed:', e.message);
    allTemplates = [];
  }
  renderTemplateList();
}

function renderTemplateList() {
  const list = document.getElementById('tpl-list');
  list.innerHTML = '';
  if (!allTemplates.length) {
    list.innerHTML = '<p class="section-desc">No templates learned yet — confirm a few documents to build the first one.</p>';
    return;
  }
  for (const t of allTemplates) {
    const mappingCount = (t.field_mappings || []).filter(m => m.enabled).length;
    const row = document.createElement('div');
    row.className = 'tpl-row' + (selectedTemplate && selectedTemplate.id === t.id ? ' active' : '');
    row.dataset.id = t.id;
    row.innerHTML = `
      <span class="tpl-row-name">${escHtml(t.name)}</span>
      <span class="tpl-row-meta">${escHtml(t.document_type_slug || '—')} · confirmed ${t.confirmed_count}× · ${mappingCount} mapping${mappingCount === 1 ? '' : 's'}</span>
    `;
    row.addEventListener('click', () => selectTemplate(t.id));
    list.appendChild(row);
  }
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
    await renderSiblings(updated);
  } catch (err) { console.warn('setTemplateGroup failed:', err.message); }
});

document.getElementById('tpl-btn-new-group').addEventListener('click', async () => {
  const name = prompt('New group name:');
  if (!name || !name.trim()) return;
  try {
    allGroups = await api.createTemplateGroup(name.trim()) || [];
    await renderGroupSection(selectedTemplate);
  } catch (err) { alert('Could not create group: ' + err.message); }
});

async function selectTemplate(id) {
  document.querySelectorAll('.tpl-row').forEach(r => r.classList.toggle('active', parseInt(r.dataset.id) === id));
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

  await Promise.all([
    loadSampleCandidates(detail),
    renderGroupSection(detail),
  ]);
  renderMappingsTable(detail);
  renderSelectorAnchorsTable(detail);
  await loadSamplePages(detail);
  await populateMapFieldSelect(detail);
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

// Click-drag panning on the viewer. Gated on tplMapMode so "Draw Anchor"/
// "Draw Target" keeps exclusive control of the gesture — the overlay canvas
// already captures pointer events itself in that state (`.drawing` toggles
// pointer-events:auto), so this check is a redundant belt-and-braces guard
// against the same mousedown bubbling up from the canvas.
tplViewer.addEventListener('mousedown', (e) => {
  if (tplMapMode || !tplPageImages.length) return;
  tplIsPanning = true;
  tplPanStart  = { x: e.clientX, y: e.clientY, panX: tplPanX, panY: tplPanY };
  tplViewer.classList.add('panning');
});
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

// Full redraw: saved (enabled) mappings underneath, then whatever the editor
// currently has in flight (draft anchor/target boxes, live drag rectangle) on
// top — so drawing a new box never has to fight the persisted overlay for
// visibility.
function redrawTplCanvas() {
  tplCtx.clearRect(0, 0, tplCanvas.width, tplCanvas.height);
  drawSavedMappings();
  const w = tplCanvas.width, h = tplCanvas.height;
  if (tplDraftAnchor && (tplDraftAnchor.page_number || 0) === tplCurrentPage) {
    drawNormBox(tplDraftAnchor.x_norm, tplDraftAnchor.y_norm, tplDraftAnchor.w_norm, tplDraftAnchor.h_norm, w, h, '#4f8ef7', 'anchor (draft)');
  }
  if (tplDraftTarget && (tplDraftTarget.page_number || 0) === tplCurrentPage) {
    drawNormBox(tplDraftTarget.x_norm, tplDraftTarget.y_norm, tplDraftTarget.w_norm, tplDraftTarget.h_norm, w, h, '#3ecf8e', 'target (draft)');
  }
  if (tplDragRect) {
    tplCtx.strokeStyle = '#FFE000';
    tplCtx.lineWidth   = 2;
    tplCtx.setLineDash([4, 3]);
    tplCtx.strokeRect(tplDragRect.x, tplDragRect.y, tplDragRect.w, tplDragRect.h);
    tplCtx.fillStyle = 'rgba(255,224,0,0.08)';
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
    drawNormBox(m.anchor_x_norm, m.anchor_y_norm, m.anchor_w_norm, m.anchor_h_norm, w, h, '#4f8ef7', `${m.field_key} anchor`);
    drawNormBox(m.target_x_norm, m.target_y_norm, m.target_w_norm, m.target_h_norm, w, h, '#3ecf8e', m.field_key);
  }
}

function drawNormBox(xN, yN, wN, hN, w, h, color, label) {
  if ([xN, yN, wN, hN].some(v => v == null)) return;
  const x = xN * w, y = yN * h, bw = wN * w, bh = hN * h;
  tplCtx.strokeStyle = color;
  tplCtx.lineWidth   = 2;
  tplCtx.setLineDash([4, 3]);
  tplCtx.strokeRect(x, y, bw, bh);
  tplCtx.fillStyle = color + '26'; // ~15% alpha fill, same convention as review's drawRect
  tplCtx.fillRect(x, y, bw, bh);

  tplCtx.setLineDash([]);
}

// ── Drawing tools (Phase 2) ──────────────────────────────────────────────────
// Same drag-to-rectangle interaction as the review window's zone-OCR teaching
// tool (mousedown/mousemove/mouseup → normalised box), but the canvas only
// accepts pointer events while a draw mode is active — overlay stays
// click-through the rest of the time so it never blocks page scrolling.

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
  if (!tplMapMode) return;
  tplIsDragging = true;
  tplDragStart = tplCanvasPoint(e);
  tplDragRect  = { x: tplDragStart.x, y: tplDragStart.y, w: 0, h: 0 };
});

tplCanvas.addEventListener('mousemove', (e) => {
  if (!tplIsDragging || !tplDragRect) return;
  const { x: cx, y: cy } = tplCanvasPoint(e);
  tplDragRect = {
    x: Math.min(tplDragStart.x, cx),
    y: Math.min(tplDragStart.y, cy),
    w: Math.abs(cx - tplDragStart.x),
    h: Math.abs(cy - tplDragStart.y),
  };
  redrawTplCanvas();
});

tplCanvas.addEventListener('mouseup', () => {
  if (!tplIsDragging || !tplDragRect || !tplMapMode) return;
  tplIsDragging = false;
  const rect = tplDragRect;
  tplDragRect = null;
  if (rect.w < 8 || rect.h < 8) { redrawTplCanvas(); return; }

  const norm = {
    x_norm: rect.x / tplCanvas.width,
    y_norm: rect.y / tplCanvas.height,
    w_norm: rect.w / tplCanvas.width,
    h_norm: rect.h / tplCanvas.height,
    page_number: tplCurrentPage,
  };
  if (tplMapMode === 'anchor') {
    tplDraftAnchor = norm;
    autoDetectAnchorText(rect);
  } else {
    tplDraftTarget = norm;
  }
  exitDrawMode();
  updateMappingEditorState();
  redrawTplCanvas();
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

// ── Init ──────────────────────────────────────────────────────────────────────
loadDocTypes();
loadFieldsTabTypes();
loadUsers();
loadAuditLog();
loadTemplates();
