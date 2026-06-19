'use strict';
// Action/status panel — renders a sectioned operational panel for the selected document.
//
// Sections:
//   1. Status bar   — status chip + confidence; always present when a doc is selected.
//   2. Document Actions — real navigational/file actions based on doc status.
//   3. Workflow     — placeholder for future approval/workflow features, or registered
//                     provider actions once those features are implemented.
//
// Extension: call registerActionProvider(fn) to add workflow/approval actions.
//   fn(doc) must return [{label, onClick, primary?}].
//   Permission note: callers MUST check role before registering a provider that exposes
//   a write or approval action. IPC handlers behind those actions must independently
//   enforce requireLogin() + hasRole() + audit logging.

const _providers = [];

function registerActionProvider(fn) {
  _providers.push(fn);
}

function renderActions(doc) {
  const panel = document.getElementById('preview-actions');
  panel.innerHTML = '';

  // ── 1. Status bar ───────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.className = 'ap-status-bar';
  bar.appendChild(_statusChip(doc.status));
  if (doc.overall_confidence != null) {
    const conf = document.createElement('span');
    conf.className   = 'ap-confidence';
    conf.textContent = `${doc.overall_confidence}% confidence`;
    bar.appendChild(conf);
  }
  panel.appendChild(bar);

  // ── 2. Document actions ─────────────────────────────────────────────────────
  const docSection = _section('Document Actions');
  if (doc.status === 'confirmed') {
    if (doc.stored_path) {
      _btn(docSection, 'Open in Explorer', () => window.docusnap.showInExplorer(doc.stored_path));
      _btn(docSection, 'Open File',        () => window.docusnap.openFile(doc.stored_path));
    }
  } else {
    // Edit in Review: admin/edit only — enforced in main.js open-review-window-at handler.
    _btn(docSection, 'Edit in Review', () => window.docusnap.openReviewWindowAt(doc.id), true);
  }
  panel.appendChild(docSection);

  // ── 3. Workflow / approval ──────────────────────────────────────────────────
  const wfSection = _section('Workflow');
  let hasWorkflowActions = false;
  for (const provider of _providers) {
    try {
      const acts = provider(doc) || [];
      for (const act of acts) {
        if (act.node) wfSection.appendChild(act.node);            // rich panel (decision bar / assign form)
        else _btn(wfSection, act.label, act.onClick, !!act.primary);
        hasWorkflowActions = true;
      }
    } catch (err) {
      console.error('SearchActions provider error:', err);
    }
  }
  if (!hasWorkflowActions) {
    const note = document.createElement('span');
    note.className   = 'ap-future-note';
    note.textContent = 'Approval and workflow features will appear here.';
    wfSection.appendChild(note);
  }
  panel.appendChild(wfSection);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _section(title) {
  const sec = document.createElement('div');
  sec.className = 'ap-section';
  const hdr = document.createElement('div');
  hdr.className   = 'ap-section-header';
  hdr.textContent = title;
  sec.appendChild(hdr);
  return sec;
}

function _statusChip(status) {
  const LABELS  = { confirmed: 'Confirmed', needs_review: 'Needs Review', deferred: 'Deferred' };
  const CLASSES = { confirmed: 'confirmed', needs_review: 'review',       deferred: 'deferred' };
  const chip = document.createElement('span');
  chip.className   = `ap-chip ${CLASSES[status] || 'other'}`;
  chip.textContent = LABELS[status] || (status ? String(status) : 'Unknown');
  return chip;
}

function _btn(container, label, onClick, primary = false) {
  const btn = document.createElement('button');
  btn.className   = primary ? 'action-btn primary' : 'action-btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  container.appendChild(btn);
}

window.SearchActions = { registerActionProvider, renderActions };
