'use strict';

document.getElementById('btn-close').addEventListener('click', () => window.docusnap.windowClose());

// ── Output folder ─────────────────────────────────────────────────────────────
async function loadOutputFolder() {
  const val = await window.docusnap.getSetting('output_folder');
  document.getElementById('output-folder-path').value = val || '';
}
loadOutputFolder();

document.getElementById('btn-pick-output').addEventListener('click', async () => {
  const folder = await window.docusnap.pickOutputFolder();
  if (folder) {
    await window.docusnap.setSetting('output_folder', folder);
    document.getElementById('output-folder-path').value = folder;
  }
});

// ── State ─────────────────────────────────────────────────────────────────────
let allDocTypes      = [];
let selectedTypeId   = null;

// ── Load doc types and render tabs ────────────────────────────────────────────
async function loadAll() {
  allDocTypes  = await window.docusnap.getAllDocTypes();
  renderTabs();
  populateNewDocTypeDropdown();
  if (allDocTypes.length > 0 && !selectedTypeId) {
    selectType(allDocTypes[0].id);
  } else {
    renderFieldsTable();
  }
}
loadAll();

function renderTabs() {
  const tabsEl = document.getElementById('type-tabs');
  tabsEl.innerHTML = '';
  for (const dt of allDocTypes) {
    const btn = document.createElement('button');
    btn.className = 'type-tab' + (dt.id === selectedTypeId ? ' active' : '');
    btn.textContent = dt.name;
    btn.dataset.id  = dt.id;
    btn.addEventListener('click', () => selectType(dt.id));
    tabsEl.appendChild(btn);
  }
}

function selectType(id) {
  selectedTypeId = id;
  renderTabs();
  renderFieldsTable();
  // Pre-select this type in the add form
  const sel = document.getElementById('new-doctype');
  if (sel) sel.value = id;
}

function populateNewDocTypeDropdown() {
  const sel = document.getElementById('new-doctype');
  sel.innerHTML = '';
  for (const dt of allDocTypes) {
    const opt = document.createElement('option');
    opt.value       = dt.id;
    opt.textContent = dt.name;
    sel.appendChild(opt);
  }
  if (selectedTypeId) sel.value = selectedTypeId;
}

// ── Fields table for selected type ───────────────────────────────────────────
function renderFieldsTable() {
  const dt    = allDocTypes.find(t => t.id === selectedTypeId);
  const tbody = document.getElementById('fields-tbody');
  tbody.innerHTML = '';
  if (!dt) return;

  for (const f of dt.fields) {
    const tr = document.createElement('tr');
    tr.dataset.id = f.id;
    tr.innerHTML = `
      <td><div class="field-label">${escHtml(f.label)}</div></td>
      <td><span class="field-key">${escHtml(f.key)}</span></td>
      <td>${escHtml(f.type)}</td>
      <td>
        <label class="toggle">
          <input type="checkbox" ${f.enabled !== 0 ? 'checked' : ''}
                 data-id="${f.id}">
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        ${f.built_in
          ? `<span class="badge-builtin">Built-in</span>`
          : `<span class="badge-custom">Custom</span>
             <button class="btn-icon" data-delete="${f.id}" title="Delete">&#215;</button>`
        }
      </td>
    `;

    tr.querySelector('input[type=checkbox]').addEventListener('change', async (e) => {
      await window.docusnap.updateField(parseInt(e.target.dataset.id), { enabled: e.target.checked ? 1 : 0 });
    });

    const delBtn = tr.querySelector('[data-delete]');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (!confirm('Delete this custom field? This cannot be undone.')) return;
        await window.docusnap.deleteField(parseInt(delBtn.dataset.delete));
        await loadAll();
      });
    }

    tbody.appendChild(tr);
  }
}

// ── Add custom field form ─────────────────────────────────────────────────────
const addForm  = document.getElementById('add-form');
const newLabel = document.getElementById('new-label');
const newKey   = document.getElementById('new-key');

document.getElementById('btn-add-field').addEventListener('click', () => {
  addForm.classList.add('visible');
  // Sync doctype dropdown to current tab
  const sel = document.getElementById('new-doctype');
  if (selectedTypeId) sel.value = selectedTypeId;
  newLabel.focus();
});

document.getElementById('btn-cancel-field').addEventListener('click', () => {
  addForm.classList.remove('visible');
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
  const label          = newLabel.value.trim();
  const key            = newKey.value.trim();
  const type           = document.getElementById('new-type').value;
  const document_type_id = parseInt(document.getElementById('new-doctype').value);

  if (!label || !key) { alert('Please enter a field label.'); return; }
  if (!document_type_id) { alert('Please select a document type.'); return; }

  await window.docusnap.addField({ document_type_id, key, label, type });

  addForm.classList.remove('visible');
  newLabel.value = '';
  newKey.value   = '';

  // Stay on the type we just added to
  selectedTypeId = document_type_id;
  await loadAll();
});

// ── Global threshold slider ───────────────────────────────────────────────────
const globalSlider = document.getElementById('global-threshold');
const globalVal    = document.getElementById('global-threshold-val');
if (globalSlider) {
  globalSlider.addEventListener('input', () => {
    globalVal.textContent = globalSlider.value + '%';
  });
}

// ── Helper ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
