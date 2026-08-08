'use strict';
// Search bar — collects filter params and drives live/manual search.

let _timer = null;

function getParams() {
  return {
    fullText:           document.getElementById('inp-fulltext').value.trim()  || undefined,
    dateFrom:           document.getElementById('inp-date-from').value        || undefined,
    dateTo:             document.getElementById('inp-date-to').value          || undefined,
    docType:            document.getElementById('inp-type').value             || undefined,
    total:              document.getElementById('inp-total').value.trim()     || undefined,
    totalOp:            document.getElementById('inp-total-op').value         || undefined,
    includeUncommitted: document.getElementById('chk-uncommitted').checked,
  };
}

// Show an inline hint when the From date is after the To date — otherwise the
// search just returns nothing with no explanation (QA audit #11). ISO date strings
// (yyyy-mm-dd) compare lexicographically, so a plain string compare is correct.
function _updateDateRangeNote() {
  const from = document.getElementById('inp-date-from').value;
  const to   = document.getElementById('inp-date-to').value;
  const note = document.getElementById('date-range-note');
  if (note) note.style.display = (from && to && from > to) ? '' : 'none';
}

async function doSearch() {
  _updateDateRangeNote();
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
  ['inp-fulltext', 'inp-total', 'inp-date-from', 'inp-date-to'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      clearTimeout(_timer);
      _timer = setTimeout(doSearch, 300);
    });
  });
  document.getElementById('inp-type').addEventListener('change', doSearch);
  document.getElementById('inp-total-op').addEventListener('change', doSearch);
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
    // Counted + explicit (Chris r5 card 6): purge REALLY deletes the PDF files from disk
    // (handler unlinks working + resolved copies) — unlike Delete All's soft delete, so
    // this dialog must say so, with the number, not "EVERYTHING".
    const n = document.querySelectorAll('#results-scroll .result-item').length;
    const what = n ? `all ${n} document${n === 1 ? '' : 's'}` : 'everything';
    if (!confirm(`Permanently delete ${what} in the recycle bin, including their PDF files? This cannot be undone.`)) return;
    try { await window.docusnap.purgeAllDeleted(); } catch (e) { console.error('empty bin:', e); }
    // The purged doc must not linger in the preview with a live Restore button.
    if (window.SearchState) window.SearchState.selectedDoc = null;
    const pe = document.getElementById('preview-empty'); if (pe) pe.style.display = '';
    const pd = document.getElementById('preview-doc');  if (pd) pd.style.display = 'none';
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

// Toggle the recycle-bin view (reused by the vertical rail's recycle button + the
// search-bar button, so both stay in one place).
function toggleBin() {
  _setBin(!(window.SearchState && window.SearchState.binMode));
  doSearch();
}

window.SearchQuery = { doSearch, initInputs, toggleBin };
