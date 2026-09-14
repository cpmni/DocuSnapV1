'use strict';
// Search window coordinator — the CORE-specific shell around the shared search UI.
// Script order (index.html): coreTransport (window.SearchTransport) → the shared search-ui modules
// (searchState/Thumbs/Actions/Results/Preview/Query/Workflow/Mailbox/Stamp/Init — src/windows/shared/
// search-ui/, ONE canonical source also driven by the detached client's search pop-out) → this file.
// Everything app-agnostic lives in the shared module; what stays here is the native chrome (close, help)
// and the Home deep-links.

document.getElementById('btn-close').addEventListener('click', () => window.docusnap.windowClose());

// ── Help: user guide + contextual help mode ───────────────────────────────────
document.getElementById('btn-help-guide')?.addEventListener('click', () => window.docusnap.openHelpWindow('search'));
window.initHelpMode?.('help-mode-toggle', {
  'fulltext':    'Searches inside the documents — the OCR’d text content, not just the filed fields. Use it to find a phrase you remember seeing.',
  'total-op':    'How to compare the amount — equal to, more than, or less than.',
  'total':       'Find documents by their total. Commas don’t matter — 1137 finds 1,137.00.',
  'type-filter': 'Limit results to one document type (e.g. only Invoices).',
  'uncommitted': 'When ticked, results also include documents that haven’t been confirmed/filed yet — handy for finding a scan still in the queue.',
  'company':     'Filter by the company (supplier or customer) on the document.',
  'reference':   'Filter by the document’s reference or main number (e.g. an invoice number).',
  'date-from':   'Show documents dated on or after this date.',
  'date-to':     'Show documents dated on or before this date.',
  'do-search':   'Run the search. Results also update automatically as you type.',
  'recycle-bin': 'View deleted documents. Restore them, or (admin) delete permanently. Delete sends a document here — it&rsquo;s recoverable.',
  'mailbox':     'Show documents shared with you for approval or acknowledgement (if enabled).',
  'results-pane':'The matching documents. Click one to preview it on the right.',
  'preview-pane':'A preview of the selected document and its filed details.',
  'preview-actions':'Open the file, show it in your file explorer, or open it back in Review to change something.',
  'preview-pages':'Move between the pages of the previewed document.',
  'preview-zoom': 'Scroll the page with the mouse wheel; right-click and drag to pan. Zoom with the − / + buttons; Reset returns to 100%.',
  'preview-find': 'When you searched for a word, these jump the preview to each place it appears (highlighted). Use ‹ / › to step through the matches.',
  'help-mode':   'Help mode: click any control to see what it does. Press Esc to leave.',
});

// If Search is ALREADY open when Quick-find fires, fill the full-text box + re-run live (leaving the bin /
// mailbox views first — the shared entry point does that).
window.docusnap.onSearchSetQuery?.((q) => { window.SearchQuery.setQuery(q); });

// If Search is ALREADY open when a "go to view" deep-link fires (Home Open Mailbox).
window.docusnap.onSearchGoto?.((v) => {
  if (v === 'mailbox') window.SearchMailbox?.open?.();
});

window.SearchUI.init({
  // Quick-find deep-link: the term Home asked Search to open with (pulled once on load).
  initialQuery: () => window.docusnap.getSearchTarget(),
  // (The workflow/mailbox/stamp init + the cross-user counts push now live in the shared searchInit.js —
  //  S4 2026-09-13 — driven through coreTransport.workflow/stamp/onWorkflowCountsChanged.)
  // Deep-link: Home's "Open Mailbox" asks the Search window to LAND on the mailbox view.
  // Consumed once on load (after doSearch, so the mailbox list wins the results pane).
  afterInit: async () => {
    try {
      const view = await window.docusnap.getSearchViewTarget?.();
      if (view === 'mailbox') window.SearchMailbox?.open?.();
    } catch { /* no view target */ }
  },
});
