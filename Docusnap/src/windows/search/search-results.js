'use strict';
// Results list — section headers and result items.
// Delegates selection to SearchPreview.selectDoc via click handlers.

function renderResults({ confirmed = [], uncommitted = [] }) {
  const scroll = document.getElementById('results-scroll');
  const empty  = document.getElementById('results-empty');
  scroll.querySelectorAll('.section-header, .result-item').forEach(el => el.remove());

  if (confirmed.length + uncommitted.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  if (confirmed.length > 0) {
    scroll.appendChild(_sectionHeader('CONFIRMED', confirmed.length));
    confirmed.forEach(doc => scroll.appendChild(_resultItem(doc)));
  }
  if (uncommitted.length > 0) {
    scroll.appendChild(_sectionHeader('UNCONFIRMED', uncommitted.length));
    uncommitted.forEach(doc => scroll.appendChild(_resultItem(doc)));
  }

  // Restore highlight if the previously selected doc is still in results.
  const { selectedDoc } = window.SearchState;
  if (selectedDoc) {
    const el = scroll.querySelector(`[data-id="${selectedDoc.id}"]`);
    if (el) el.classList.add('active');
  }
}

function _sectionHeader(label, count) {
  const el = document.createElement('div');
  el.className = 'section-header';
  el.innerHTML = `${label} <span class="section-count">${count}</span>`;
  return el;
}

function _resultItem(doc) {
  const el      = document.createElement('div');
  el.className  = 'result-item';
  el.dataset.id = doc.id;

  const name     = doc.stored_filename || doc.original_filename || '—';
  const supplier = doc.supplier_name || '—';
  const typeName = doc.type_name || '';
  const date     = doc.doc_date || '';

  let statusBadge = '';
  if      (doc.status === 'needs_review') statusBadge = `<span class="result-status-badge review">Needs Review</span>`;
  else if (doc.status === 'deferred')     statusBadge = `<span class="result-status-badge deferred">Deferred</span>`;

  el.innerHTML = `
    <div class="result-header">
      <span class="result-supplier" title="${escHtml(supplier)}">${escHtml(supplier)}</span>
      ${typeName ? `<span class="result-type-badge">${escHtml(typeName)}</span>` : ''}
    </div>
    <div class="result-filename" title="${escHtml(name)}">${escHtml(name)}</div>
    <div class="result-footer">
      <span class="result-date">${escHtml(date)}</span>
      ${statusBadge}
    </div>
  `;
  el.addEventListener('click', () => window.SearchPreview.selectDoc(doc));
  return el;
}

window.SearchResults = { renderResults };
