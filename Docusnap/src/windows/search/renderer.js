'use strict';
// Search window coordinator — wires sub-modules, seeds doc-type dropdown, kicks off initial search.
// Sub-modules loaded before this file: search-state, search-actions, search-results,
//                                      search-preview, search-query (see index.html script tags).

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
  'preview-zoom': 'Zoom with the − / + buttons or the mouse wheel; right-click and drag to pan around the page. Reset returns to 100%.',
  'help-mode':   'Help mode: click any control to see what it does. Press Esc to leave.',
});

// ── Arrow-key document cycling (same as the rail ↑/↓; mirrors the Review window) ──
// Only fires outside text-entry controls so typing in the search box is unaffected.
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'ArrowUp')        { e.preventDefault(); window.SearchResults.cycleSelection(-1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); window.SearchResults.cycleSelection(1); }
});

// ── Expandable details column — drag the grip to widen/narrow the sidebar ─────────
// The sidebar is docked RIGHT, so its width grows as the grip is dragged left. Width
// persists in localStorage (clamped) so a chosen width survives reopening.
(function initSidebarResizer() {
  const sidebar = document.getElementById('preview-sidebar');
  const grip    = document.getElementById('sidebar-resizer');
  if (!sidebar || !grip) return;
  const MIN = 220, MAX = 620;
  const saved = parseInt(localStorage.getItem('search_sidebar_width'), 10);
  if (saved >= MIN && saved <= MAX) sidebar.style.width = saved + 'px';
  let dragging = false, rightEdge = 0;
  grip.addEventListener('mousedown', (e) => {
    dragging = true; rightEdge = sidebar.getBoundingClientRect().right; e.preventDefault();
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.max(MIN, Math.min(MAX, rightEdge - e.clientX));
    sidebar.style.width = w + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = '';
    localStorage.setItem('search_sidebar_width', String(parseInt(sidebar.style.width, 10) || 280));
  });
})();

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
  // POPULATE RESULTS FIRST — they depend only on the query, not on entitlement/stamp/print (which only
  // gate the action buttons). doSearch used to run AFTER getEntitlement + authGetCurrentUser + stamp.can
  // (→ verifyAuditChain, whose cost grows with the audit log) + printAvailable, so on a busy install the
  // results list took a while to populate. Init the inputs/rail, pre-fill, and search NOW; the permission
  // checks below then run without holding up the list.
  window.SearchPreview.initPageNav();
  window.SearchQuery.initInputs();
  window.SearchResults.initRail();
  try {
    const q0 = await window.docusnap.getSearchTarget();
    if (q0) { const el = document.getElementById('inp-fulltext'); if (el) el.value = q0; }
  } catch { /* no target */ }
  window.SearchQuery.doSearch();
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
  // Stamp permission (Workflow+Stamping redesign): drives whether the "Stamp" option is shown at all.
  // A core capability (not the add-on); the main process re-checks on every place.
  try { window.SearchState.canStamp = !!(await window.docusnap.stamp.can()).canStamp; } catch { window.SearchState.canStamp = false; }
  // Printing (Print-Slice 1): read once so renderActions can show/hide the Search Print button. The main
  // process re-checks printing_enabled on every print, so this is display-only.
  try { window.SearchState.printAvailable = !!(await window.docusnap.printAvailable?.()); } catch { window.SearchState.printAvailable = false; }
  // Recycle bin is for the people who can delete (Admin/Edit).
  if (window.SearchState.role === 'admin' || window.SearchState.role === 'edit') {
    const rb = document.getElementById('btn-recycle'); if (rb) rb.style.display = '';
  }
  if (window.SearchState.entitled) document.body.classList.add('wf-on');              // enhanced search
  if (window.SearchState.workflowEntitled) {
    document.body.classList.add('workflow-on');                                       // mailbox + approvals
    if (window.SearchWorkflow) await window.SearchWorkflow.init();
    if (window.SearchMailbox) window.SearchMailbox.init();
    // Cross-user freshness (Slice 1): ANY workflow change (this desktop or a /v1 client)
    // pings every window — re-pull my open-route map + the visible mailbox, debounced
    // (SearchMailbox.render has no concurrency guard; overlapping renders interleave DOM).
    // The action-panel rerender is SKIPPED while the user is mid-input in it (a half-typed
    // rejection note must never be wiped by someone else's action).
    let _wfPing = null;
    window.docusnap.onWorkflowCountsChanged?.(() => {
      clearTimeout(_wfPing);
      _wfPing = setTimeout(async () => {
        try {
          await window.SearchWorkflow?.refresh?.();
          const panel = document.getElementById('preview-actions');
          const busy = panel && (panel.contains(document.activeElement)
            || (panel.querySelector('.wf-note') && panel.querySelector('.wf-note').value.trim()));
          if (!busy && window.SearchState.selectedDoc) window.SearchActions.renderActions(window.SearchState.selectedDoc);
          window.SearchMailbox?.refreshIfActive?.();
        } catch { /* best-effort */ }
      }, 400);
    });
  }
  // The permission checks above may have resolved after a doc was already selected (results populate
  // first now) — re-render its action panel so Stamp / Print / recycle appear once known.
  if (window.SearchState.selectedDoc) { try { window.SearchActions.renderActions(window.SearchState.selectedDoc); } catch {} }

  // Deep-link: Home's "Open Mailbox" asks the Search window to LAND on the mailbox view.
  // Consumed once on load (after doSearch, so the mailbox list wins the results pane).
  try {
    const view = await window.docusnap.getSearchViewTarget?.();
    if (view === 'mailbox') window.SearchMailbox?.open?.();
  } catch { /* no view target */ }
}

// If Search is ALREADY open when Quick-find fires, fill the full-text box + re-run live.
window.docusnap.onSearchSetQuery?.((q) => {
  const el = document.getElementById('inp-fulltext');
  if (el) { el.value = q || ''; window.SearchQuery.doSearch(); }
});

// If Search is ALREADY open when a "go to view" deep-link fires (Home Open Mailbox).
window.docusnap.onSearchGoto?.((v) => {
  if (v === 'mailbox') window.SearchMailbox?.open?.();
});

// Refresh results when the window regains focus. A confirm / auto-file ("filed themselves") in Review or
// the main window changes the confirmed set, but Search gets NO push signal for it (review-count-changed
// reaches only main + review) — so a just-confirmed doc looked missing until Search was reopened. Re-run
// the CURRENT search when the user returns to this window, but ONLY when the results list is idle: never
// while typing a query, never in the mailbox view, and never while a document is selected/previewed (so it
// can't yank a doc you are reading). Debounced.
let _refocusT = null;
function _refreshResultsOnReturn() {
  clearTimeout(_refocusT);
  _refocusT = setTimeout(() => {
    try {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;   // mid-typing
      if (document.body.classList.contains('mailbox-mode')) return;              // mailbox view owns the pane
      if (window.SearchState && window.SearchState.selectedDoc) return;          // viewing a doc — don't reset
      window.SearchQuery.doSearch();
    } catch { /* best-effort */ }
  }, 200);
}
window.addEventListener('focus', _refreshResultsOnReturn);
document.addEventListener('visibilitychange', () => { if (!document.hidden) _refreshResultsOnReturn(); });

_init();
