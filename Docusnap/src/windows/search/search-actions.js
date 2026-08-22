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
    if (isAdmin) _btn(docSection, 'Delete permanently', async () => {
      const suffix = await window.SearchState.purgeSuffix();
      if (confirm('Permanently delete this document and its file? This cannot be undone.' + suffix)) _afterChange(window.docusnap.purgeDocument(doc.id));
    });
  } else {
    if (doc.status === 'confirmed') {
      // Send a filed doc back to the Review queue (Admin) — de-confirms it; the file stays put
      // until re-confirmed (repair-deconfirm keeps stored_path). First action so it's prominent.
      if (isAdmin) _btn(docSection, '↩ Send back to Review', () => {
        if (confirm('Send this document back to the Review queue? It stays filed until you re-confirm it.'))
          _afterChange(window.docusnap.repairDeconfirm(doc.id));
      }, true);
      // Escape hatches to the real file — deliberately kept (round-2 Chris fix restored
      // them), EDIT/ADMIN only, and now DOC-ID-RESOLVED: the search ROW surface carries
      // has_file, never a path; the main process resolves + audits + role-gates (the
      // de-pathing slice; the single-doc detail IPC's projection is a named follow-up).
      // The result is CONSUMED (Oracle C2): a refusal (file vanished since load, containment)
      // shows its reason instead of being a dead click.
      const _openVia = (fn) => async () => {
        let r = null;
        try { r = await fn(doc.id); } catch (e) { r = { success: false, error: e && e.message }; }
        if (!r || !r.success) _flashNote(docSection, r && r.error ? r.error : 'Couldn’t open the file.');
      };
      if (doc.has_file && canEdit) {
        _btn(docSection, 'Open in Explorer', _openVia(window.docusnap.showDocumentInExplorer));
        _btn(docSection, 'Open File',        _openVia(window.docusnap.openDocumentFile));
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

// After a delete/restore/purge, refresh the result list AND clear the preview — the acted-on
// document must never linger in the panel with now-stale actions (Chris r5: a PURGED docket
// still offered a live "Restore" button). Trade-off accepted: the preview also clears after
// a Restore; the user just acted on it and the fresh list is one click away.
function _afterChange(p) {
  Promise.resolve(p)
    .then(() => {
      if (window.SearchState) window.SearchState.selectedDoc = null;
      const pe = document.getElementById('preview-empty'); if (pe) pe.style.display = '';
      const pd = document.getElementById('preview-doc');  if (pd) pd.style.display = 'none';
      if (window.SearchQuery) window.SearchQuery.doSearch();
    })
    .catch((e) => console.error('document action failed:', e));
}

// Transient inline note inside an actions section (refusals from the doc-open IPCs).
function _flashNote(section, msg) {
  let n = section.querySelector('.ap-flash-note');
  if (!n) {
    n = document.createElement('span');
    n.className = 'ap-flash-note';
    n.style.cssText = 'font-size:11px;color:var(--err);';
    section.appendChild(n);
  }
  n.textContent = msg;
  setTimeout(() => { if (n.isConnected) n.remove(); }, 6000);
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
