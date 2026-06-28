'use strict';
// Search bar — collects filter params and drives live/manual search.

let _timer = null;

function getParams() {
  return {
    company:            document.getElementById('inp-company').value.trim()   || undefined,
    reference:          document.getElementById('inp-reference').value.trim() || undefined,
    fullText:           document.getElementById('inp-fulltext').value.trim()  || undefined,
    dateFrom:           document.getElementById('inp-date-from').value        || undefined,
    dateTo:             document.getElementById('inp-date-to').value          || undefined,
    docType:            document.getElementById('inp-type').value             || undefined,
    includeUncommitted: document.getElementById('chk-uncommitted').checked,
  };
}

async function doSearch() {
  const bin = !!(window.SearchState && window.SearchState.binMode);
  try {
    if (bin) {
      const deleted = await window.docusnap.getDeletedQueue();
      window.SearchResults.renderResults({ confirmed: [], uncommitted: [], deleted: deleted || [] });
    } else {
      const results = await window.docusnap.searchDocuments(getParams());
      window.SearchResults.renderResults(results);
    }
  } catch (err) {
    console.error('search-documents error:', err);
    window.SearchResults.renderResults({ confirmed: [], uncommitted: [], deleted: [] });
  }
}

function initInputs() {
  ['inp-company', 'inp-reference', 'inp-fulltext', 'inp-date-from', 'inp-date-to'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      clearTimeout(_timer);
      _timer = setTimeout(doSearch, 300);
    });
  });
  document.getElementById('inp-type').addEventListener('change', doSearch);
  document.getElementById('chk-uncommitted').addEventListener('change', doSearch);
  document.getElementById('btn-search').addEventListener('click', () => {
    if (window.SearchState && window.SearchState.binMode) { _setBin(false); }   // Search exits the bin
    doSearch();
  });
  const recycle = document.getElementById('btn-recycle');
  if (recycle) recycle.addEventListener('click', () => {
    _setBin(!(window.SearchState && window.SearchState.binMode));
    doSearch();
  });
  const emptyBtn = document.getElementById('btn-empty-bin');
  if (emptyBtn) emptyBtn.addEventListener('click', async () => {
    if (!confirm('Permanently delete EVERYTHING in the recycle bin? This cannot be undone.')) return;
    try { await window.docusnap.purgeAllDeleted(); } catch (e) { console.error('empty bin:', e); }
    doSearch();
  });
}

// Toggle recycle-bin view: relabel the button + flag state (rendered by doSearch).
// The "Empty bin" button shows only in the bin, and only for admins (purge is admin-only).
function _setBin(on) {
  if (window.SearchState) window.SearchState.binMode = on;
  const b = document.getElementById('btn-recycle');
  if (b) { b.textContent = on ? '← Back to search' : 'Recycle bin'; b.classList.toggle('active', on); }
  const e = document.getElementById('btn-empty-bin');
  if (e) e.style.display = (on && window.SearchState && window.SearchState.role === 'admin') ? '' : 'none';
}

window.SearchQuery = { doSearch, initInputs };
