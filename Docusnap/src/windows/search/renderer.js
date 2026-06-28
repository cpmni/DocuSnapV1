'use strict';
// Search window coordinator — wires sub-modules, seeds doc-type dropdown, kicks off initial search.
// Sub-modules loaded before this file: search-state, search-actions, search-results,
//                                      search-preview, search-query (see index.html script tags).

document.getElementById('btn-close').addEventListener('click', () => window.docusnap.windowClose());

// ── Help: user guide + contextual help mode ───────────────────────────────────
document.getElementById('btn-help-guide')?.addEventListener('click', () => window.docusnap.openHelpWindow('search'));
window.initHelpMode?.('help-mode-toggle', {
  'fulltext':    'Searches inside the documents — the OCR’d text content, not just the filed fields. Use it to find a phrase you remember seeing.',
  'type-filter': 'Limit results to one document type (e.g. only Invoices).',
  'uncommitted': 'When ticked, results also include documents that haven’t been confirmed/filed yet — handy for finding a scan still in the queue.',
  'company':     'Filter by the company (supplier or customer) on the document.',
  'reference':   'Filter by the document’s reference or main number (e.g. an invoice number).',
  'date-from':   'Show documents dated on or after this date.',
  'date-to':     'Show documents dated on or before this date.',
  'do-search':   'Run the search. Results also update automatically as you type.',
  'mailbox':     'Show documents shared with you for approval or acknowledgement (if enabled).',
  'results-pane':'The matching documents. Click one to preview it on the right.',
  'preview-pane':'A preview of the selected document and its filed details.',
  'preview-actions':'Open the file, show it in your file explorer, or open it back in Review to change something.',
  'preview-pages':'Move between the pages of the previewed document.',
  'help-mode':   'Help mode: click any control to see what it does. Press Esc to leave.',
});

async function _loadDocTypes() {
  const types = await window.docusnap.getAllDocTypes();
  const sel   = document.getElementById('inp-type');
  for (const t of types) {
    const opt       = document.createElement('option');
    opt.value       = t.slug;
    opt.textContent = t.name;
    sel.appendChild(opt);
  }
}

async function _init() {
  await _loadDocTypes();
  // Entitlements drive the experience, and SEARCH and WORKFLOW are SEPARATE add-ons:
  //  • search   → the enhanced Search surface (confidence signatures, validation notes);
  //  • workflow → the mailbox + approval actions. The workflow UI appears ONLY when the
  //    workflow add-on is licensed, so a search-only (or unlicensed) install shows NO
  //    mailbox/workflow mention at all.
  try {
    const e = await window.docusnap.getEntitlement();
    window.SearchState.entitled = !!(e && e.entitled);                                // search
    window.SearchState.workflowEntitled = !!(e && e.workflow && e.workflow.entitled); // workflow add-on
  } catch { window.SearchState.entitled = false; window.SearchState.workflowEntitled = false; }
  try { const u = await window.docusnap.authGetCurrentUser(); window.SearchState.role = u && u.role; } catch { /* ignore */ }
  if (window.SearchState.entitled) document.body.classList.add('wf-on');              // enhanced search
  if (window.SearchState.workflowEntitled) {
    document.body.classList.add('workflow-on');                                       // mailbox + approvals
    if (window.SearchWorkflow) await window.SearchWorkflow.init();
    if (window.SearchMailbox) window.SearchMailbox.init();
  }
  window.SearchPreview.initPageNav();
  window.SearchQuery.initInputs();
  window.SearchQuery.doSearch();
}

_init();
