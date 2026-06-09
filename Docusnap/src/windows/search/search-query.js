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
  try {
    const results = await window.docusnap.searchDocuments(getParams());
    window.SearchResults.renderResults(results);
  } catch (err) {
    console.error('search-documents error:', err);
    window.SearchResults.renderResults({ confirmed: [], uncommitted: [] });
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
  document.getElementById('btn-search').addEventListener('click', doSearch);
}

window.SearchQuery = { doSearch, initInputs };
