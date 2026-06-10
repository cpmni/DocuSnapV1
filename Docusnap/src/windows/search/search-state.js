'use strict';
// Shared state for the search client. Consumed by all other search modules.

window.SearchState = {
  selectedDoc:  null,
  currentPages: [],
  currentPage:  0,
};

// Shared HTML-escape utility — used by results and preview modules. Escapes the
// five characters that can break HTML, including " and ' so values interpolated
// into attributes (e.g. title="${escHtml(...)}" in search-results.js) stay
// contained. & is replaced first so the entity ampersands below aren't
// re-escaped. (Slashes don't break HTML attributes, so they're left intact —
// escaping them would corrupt displayed filenames like "INV.15-12-2025.pdf".)
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
