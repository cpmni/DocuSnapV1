'use strict';
// Action panel — extensible seam for future workflow and approval features.
//
// Built-in actions are rendered by status. External features (workflow,
// approval) register additional providers via registerActionProvider(fn).
// fn(doc) returns [{label, onClick, primary?}].
//
// Permission note: callers MUST check role before registering a provider that
// exposes a write or approval action. The IPC handlers behind those actions
// must also enforce requireLogin() + hasRole() independently.

const _providers = [];

function registerActionProvider(fn) {
  _providers.push(fn);
}

function renderActions(doc) {
  const panel = document.getElementById('preview-actions');
  panel.innerHTML = '';

  if (doc.status === 'confirmed') {
    if (doc.stored_path) {
      _btn(panel, 'Open in Explorer', () => window.docusnap.showInExplorer(doc.stored_path));
      _btn(panel, 'Open File',        () => window.docusnap.openFile(doc.stored_path));
    }
  } else {
    // Edit in Review is admin/edit territory; the open-review-window IPC handler
    // enforces this independently — the button is visible to any logged-in user
    // here but the window will not open for Read Only.
    _btn(panel, 'Edit in Review', () => window.docusnap.openReviewWindow(), true);
  }

  // Extension seam — workflow/approval providers slot in here.
  for (const provider of _providers) {
    try {
      const acts = provider(doc) || [];
      for (const act of acts) _btn(panel, act.label, act.onClick, !!act.primary);
    } catch (err) {
      console.error('SearchActions provider error:', err);
    }
  }
}

function _btn(container, label, onClick, primary = false) {
  const btn = document.createElement('button');
  btn.className   = primary ? 'action-btn primary' : 'action-btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  container.appendChild(btn);
}

window.SearchActions = { registerActionProvider, renderActions };
