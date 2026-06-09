'use strict';
// Shared state for the search client. Consumed by all other search modules.

window.SearchState = {
  selectedDoc:  null,
  currentPages: [],
  currentPage:  0,
};

// Shared HTML-escape utility — used by results and preview modules.
function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
