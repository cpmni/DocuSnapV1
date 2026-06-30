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
  const role    = (window.SearchState && window.SearchState.role) || null;
  const canEdit = role === 'admin' || role === 'edit';
  const isAdmin = role === 'admin';

  if (doc.status === 'deleted') {
    // Recycle-bin item: restore (Admin/Edit) or permanently remove (Admin).
    if (canEdit) _btn(docSection, 'Restore', () => _afterChange(window.docusnap.restoreDocument(doc.id)), true);
    if (isAdmin) _btn(docSection, 'Delete permanently', () => {
      if (confirm('Permanently delete this document and its file? This cannot be undone.')) _afterChange(window.docusnap.purgeDocument(doc.id));
    });
  } else {
    if (doc.status === 'confirmed') {
      if (doc.stored_path) {
        _btn(docSection, 'Open in Explorer', () => window.docusnap.showInExplorer(doc.stored_path));
        _btn(docSection, 'Open File',        () => window.docusnap.openFile(doc.stored_path));
      }
    } else {
      // Edit in Review: admin/edit only — enforced in main.js open-review-window-at handler.
      _btn(docSection, 'Edit in Review', () => window.docusnap.openReviewWindowAt(doc.id), true);
    }
    // Delete → recycle bin (Admin/Edit). Recoverable; the file is kept.
    if (canEdit) _btn(docSection, 'Delete', () => {
      if (confirm('Move this document to the recycle bin? You can restore it later.')) _afterChange(window.docusnap.deleteDocument(doc.id));
    });
  }
  // Only show the section when it actually has actions — otherwise a read-only user
  // (or a confirmed doc with no openable file) sees a stray empty "Document Actions"
  // heading. The section starts with just its header child; buttons add more.
  if (docSection.children.length > 1) panel.appendChild(docSection);

  // ── 3. Workflow / approval — ONLY when the workflow add-on is licensed, so an
  //       unlicensed / search-only install shows no "Workflow" section or mention. ─────
  if (window.SearchState && window.SearchState.workflowEntitled) {
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// After a delete/restore/purge, refresh the result list so the document moves in/out
// of view, and clear the now-stale preview.
function _afterChange(p) {
  Promise.resolve(p)
    .then(() => { if (window.SearchQuery) window.SearchQuery.doSearch(); })
    .catch((e) => console.error('document action failed:', e));
}

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
