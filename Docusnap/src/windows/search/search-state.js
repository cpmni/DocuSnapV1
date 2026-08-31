'use strict';
// Shared state for the search client. Consumed by all other search modules.

window.SearchState = {
  selectedDoc:  null,
  currentPages: [],
  currentPage:  0,
  entitled:     false,   // workflow add-on licensed → enhanced Search (set in renderer._init)
  myOpenRoutes: {},      // document_id -> open route addressed to me (workflow; set when entitled)
};

// PURGE DIALOG TRUTH (Q1, Chris round 14 card 1, 2026-08-22): "Permanently delete … including their
// PDF files" must also say what is NOT deleted. Under `keep_processed_originals` (mig 83 ON) a filed
// document's original scan stays in the Processed folder, so the purge removes only the app's
// copies. With the switch OFF the original was already removed at filing — say nothing (the old
// sentence stays exactly as it was). Cached per window; the sentence is a suffix for the three
// purge confirms (Empty bin / Delete permanently / bulk purge).
window.SearchState = window.SearchState || {};
window.SearchState.keepOriginals = null;
window.SearchState.purgeSuffix = async function purgeSuffix() {
  try {
    if (window.SearchState.keepOriginals === null) {
      const v = await window.docusnap.getSetting('keep_processed_originals');
      window.SearchState.keepOriginals = (v === 'true' || v === true);
    }
  } catch { window.SearchState.keepOriginals = false; }
  return window.SearchState.keepOriginals
    ? ' Your original scans in the Processed folder are not touched.' : '';
};


// Confidence level (shared by results + preview): '' = none, else ok/warn/err.
// Mirrors the detached client's thresholds so the two surfaces read identically.
function confLevel(c) { return c == null ? '' : c >= 85 ? 'ok' : c >= 60 ? 'warn' : 'err'; }

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
