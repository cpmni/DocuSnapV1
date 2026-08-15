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

// The bin's REAL contents, asked at the moment of the action. The rendered list can be arbitrarily
// stale — the bin is filled from the Review window, which does not repaint this one — so every
// bin-wide action and every count it quotes must come from here, never from the DOM.
async function _binRows() {
  try { return (await window.docusnap.getDeletedQueue()) || []; }
  catch (e) { console.error('recycle bin refresh:', e); return []; }
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
  // A BIN LEFT OPEN GOES STALE, because it is filled from the REVIEW window, which never repaints
  // this one. Chris deleted 179 documents with the bin open and it still read "The recycle bin is
  // empty." Re-read it whenever this window comes back to the front — kept as belt-and-braces (a
  // CDP-driven session never toggles OS focus, which is why the focus-only fix failed him twice).
  window.addEventListener('focus', () => {
    if (window.SearchState && window.SearchState.binMode) doSearch();
  });
  // THE PUSH LEG (eric design + Oracle sign-off 2026-08-16): main broadcasts 'bin-changed' once per
  // bin-mutating op anywhere in the app (Review deletes, Empty bin, repair/recovery set-asides,
  // /v1 client mutations — purge previously broadcast NOTHING). No data rides the event; re-pull
  // through the same role-gated query. Trailing debounce on its OWN timer (never `_timer`, which
  // belongs to the input debounce) absorbs bursts: this window's own multi-select actions fire one
  // IPC per id, so N events coalesce into one repaint.
  if (window.docusnap && typeof window.docusnap.onBinChanged === 'function') {
    let binTimer = null;
    window.docusnap.onBinChanged(() => {
      if (!(window.SearchState && window.SearchState.binMode)) return;
      clearTimeout(binTimer);
      binTimer = setTimeout(async () => {
        await doSearch();   // re-render first, THEN judge the selection against the fresh rows
        // A doc purged/restored elsewhere must not linger selected with a live Restore button.
        const rowsGone = window.SearchState && window.SearchState.selectedDoc
          && !document.querySelector(`#results-scroll [data-id="${window.SearchState.selectedDoc.id}"]`);
        if (rowsGone) {
          window.SearchState.selectedDoc = null;
          const pe = document.getElementById('preview-empty'); if (pe) pe.style.display = '';
          const pd = document.getElementById('preview-doc');  if (pd) pd.style.display = 'none';
        }
      }, 300);
    });
  }
  // Restore all (Chris r2 2026-08-11, finding 8): the undo counterpart beside Empty bin.
  // Available to edit-role too — single Restore already is; only PURGE is admin-only.
  const restoreAllBtn = document.getElementById('btn-restore-all');
  if (restoreAllBtn) restoreAllBtn.addEventListener('click', async () => {
    // COUNT THE BIN, NOT THE SCREEN (Chris rounds 3 + 4, "the trap, unchanged": he opened the bin,
    // deleted 179 documents from Review, and the still-open bin read "The recycle bin is empty."
    // Restore all then gave "no dialog, no message, no action" — he counted native dialogs and got
    // ZERO, so nothing was swallowed). The cause was here: `n` came from the RENDERED rows, and a
    // view rendered before those deletes has none, so `if (!n) return` was a silent no-op on a bin
    // holding 179 documents. Ask the database at action time; an action must never be gated on a
    // cached render.
    const rows = await _binRows();
    const n = rows.length;
    if (!n) { await doSearch(); alert('The recycle bin is empty — there is nothing to restore.'); return; }
    if (!confirm(`Restore all ${n} document${n === 1 ? '' : 's'} from the recycle bin? They go back to where they were deleted from (the review queue, or their filed folder).`)) return;
    try { await window.docusnap.restoreAllDeleted(); } catch (e) { console.error('restore all:', e); }
    if (window.SearchState) window.SearchState.selectedDoc = null;
    const pe = document.getElementById('preview-empty'); if (pe) pe.style.display = '';
    const pd = document.getElementById('preview-doc');  if (pd) pd.style.display = 'none';
    doSearch();
  });
  const emptyBtn = document.getElementById('btn-empty-bin');
  if (emptyBtn) emptyBtn.addEventListener('click', async () => {
    // Counted + explicit (Chris r5 card 6): purge REALLY deletes the PDF files from disk
    // (handler unlinks the app's working copy AND the filed copy — which it did NOT do until
    // 2026-08-13; see _purgeOne) — unlike Delete All's soft delete, so this dialog must say so,
    // with the number, not "EVERYTHING". Counted from the BIN, not the rendered rows: a stale view
    // used to make this dialog say "everything" over a bin whose real contents it could not see.
    const rows = await _binRows();
    const n = rows.length;
    if (!n) { await doSearch(); alert('The recycle bin is already empty.'); return; }
    const what = `all ${n} document${n === 1 ? '' : 's'}`;
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
// "Restore all" shows for admin/edit — the roles single Restore already serves.
function _setBin(on) {
  if (window.SearchState) window.SearchState.binMode = on;
  const b = document.getElementById('btn-recycle');
  if (b) { b.textContent = on ? '← Back to search' : 'Recycle bin'; b.classList.toggle('active', on); }
  const e = document.getElementById('btn-empty-bin');
  if (e) e.style.display = (on && window.SearchState && window.SearchState.role === 'admin') ? '' : 'none';
  const r = document.getElementById('btn-restore-all');
  if (r) r.style.display = (on && window.SearchState && ['admin', 'edit'].includes(window.SearchState.role)) ? '' : 'none';
}

// Toggle the recycle-bin view (reused by the vertical rail's recycle button + the
// search-bar button, so both stay in one place).
function toggleBin() {
  _setBin(!(window.SearchState && window.SearchState.binMode));
  doSearch();
}

window.SearchQuery = { doSearch, initInputs, toggleBin };
