'use strict';

document.getElementById('btn-close').addEventListener('click', () => window.docusnap.windowClose());

// ── Output folder ─────────────────────────────────────────────────────────────
const outputPathEl = document.getElementById('output-folder-path');

async function loadOutputFolder() {
  const val = await window.docusnap.getSetting('output_folder');
  outputPathEl.value = val || '';
}
loadOutputFolder();

document.getElementById('btn-pick-output').addEventListener('click', async () => {
  const folder = await window.docusnap.pickOutputFolder();
  if (folder) {
    await window.docusnap.setSetting('output_folder', folder);
    outputPathEl.value = folder;
  }
});

// ── Load fields ───────────────────────────────────────────────────────────────
async function loadFields() {
  const fields = await window.docusnap.getAllFields();
  const tbody  = document.getElementById('fields-tbody');
  tbody.innerHTML = '';

  for (const f of fields) {
    const tr = document.createElement('tr');
    tr.dataset.id = f.id;
    tr.innerHTML = `
      <td>
        <div class="field-label">${escHtml(f.label)}</div>
      </td>
      <td><span class="field-key">${escHtml(f.key)}</span></td>
      <td>${escHtml(f.type)}</td>
      <td>
        <div class="conf-row">
          <input type="range" class="conf-slider" min="0" max="100"
                 value="${f.confidence_threshold}" data-id="${f.id}" data-field="confidence_threshold">
          <span class="conf-val">${f.confidence_threshold}%</span>
        </div>
      </td>
      <td>
        <label class="toggle">
          <input type="checkbox" ${f.enabled ? 'checked' : ''}
                 data-id="${f.id}" data-field="enabled">
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        ${f.built_in
          ? `<span class="badge-builtin">Built-in</span>`
          : `<span class="badge-custom">Custom</span>
             <button class="btn-icon" data-delete="${f.id}" title="Delete field">&#215;</button>`
        }
      </td>
    `;
    tbody.appendChild(tr);
  }

  // Confidence sliders
  tbody.querySelectorAll('input[type=range]').forEach(slider => {
    const valEl = slider.nextElementSibling;
    slider.addEventListener('input', () => {
      valEl.textContent = slider.value + '%';
    });
    slider.addEventListener('change', async () => {
      await window.docusnap.updateField(
        parseInt(slider.dataset.id),
        { confidence_threshold: parseInt(slider.value) }
      );
    });
  });

  // Enable toggles
  tbody.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await window.docusnap.updateField(
        parseInt(cb.dataset.id),
        { enabled: cb.checked ? 1 : 0 }
      );
    });
  });

  // Delete buttons
  tbody.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this custom field? This cannot be undone.')) return;
      await window.docusnap.deleteCustomField(parseInt(btn.dataset.delete));
      loadFields();
    });
  });
}

loadFields();

// ── Add custom field form ─────────────────────────────────────────────────────
const addForm    = document.getElementById('add-form');
const newLabel   = document.getElementById('new-label');
const newKey     = document.getElementById('new-key');
const newType    = document.getElementById('new-type');
const newConf    = document.getElementById('new-conf');

document.getElementById('btn-add-field').addEventListener('click', () => {
  addForm.classList.add('visible');
  newLabel.focus();
});

document.getElementById('btn-cancel-field').addEventListener('click', () => {
  addForm.classList.remove('visible');
  newLabel.value = '';
  newKey.value   = '';
});

// Auto-generate key from label
newLabel.addEventListener('input', () => {
  newKey.value = newLabel.value.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
});

document.getElementById('btn-save-field').addEventListener('click', async () => {
  const label = newLabel.value.trim();
  const key   = newKey.value.trim();
  const type  = newType.value;
  const conf  = parseInt(newConf.value) || 70;

  if (!label || !key) {
    alert('Please enter a label for the field.');
    return;
  }

  await window.docusnap.addCustomField({ key, label, type, confidence_threshold: conf });
  addForm.classList.remove('visible');
  newLabel.value = '';
  newKey.value   = '';
  loadFields();
});

// ── Global threshold slider ───────────────────────────────────────────────────
const globalSlider = document.getElementById('global-threshold');
const globalVal    = document.getElementById('global-threshold-val');
globalSlider.addEventListener('input', () => {
  globalVal.textContent = globalSlider.value + '%';
});

// ── Helper ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
