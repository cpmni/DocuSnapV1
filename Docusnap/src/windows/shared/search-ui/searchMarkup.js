'use strict';
// searchMarkup.js — the shared search screen's MARKUP (client search parity, 2026-09-13; Oracle S0b).
// SHARED SEARCH UI — no IO at all (see searchState.js header). ONE canonical copy of the search-bar /
// results pane / preview pane markup, mounted into the host page's #app by this script so the core Search
// window and the client's search pop-out can never drift (the client's copy is GENERATED — edit here only).
//
// MOUNT CONTRACT (Oracle 2026-09-13): the markup is inserted as DIRECT CHILDREN of #app — never inside a
// wrapper — because #app{display:flex;flex-direction:column;height:100vh} → #body{flex:1} is the height
// chain that gives the results/preview panes their scrollable height; a wrapper div breaks it (the panes
// collapse to content height). The host page keeps its own chrome (the core: #titlebar) as #app's first
// child and nothing after it, so the resulting DOM is byte-identical to the former static page. Load this
// BEFORE every script that touches the search DOM (it is the first shared script in index.html).
(function () {
  const SEARCH_MARKUP = `

  <div id="search-bar">
    <span class="lead-wrap">
      <svg class="lead-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <input class="search-input" id="inp-fulltext"  type="text" placeholder="Search anything…" title="Searches everything on the document — text, references, amounts, dates and codes. Numbers ignore commas (1137 finds 1,137)." data-help-key="fulltext">
    </span>
    <span style="font-size:11px; color:var(--muted); white-space:nowrap;">From</span>
    <input class="search-input" id="inp-date-from" data-help-key="date-from" type="date" title="From date">
    <span style="font-size:11px; color:var(--muted);">to</span>
    <input class="search-input" id="inp-date-to"   type="date" title="To date">
    <select id="inp-total-op" class="search-input" title="Total amount filter" style="width:auto;" data-help-key="total-op">
      <option value="eq">Total =</option>
      <option value="gt">Total &gt;</option>
      <option value="lt">Total &lt;</option>
    </select>
    <input class="search-input" id="inp-total" type="text" inputmode="decimal" placeholder="amount" title="Filter by total amount (uses the operator on the left)" style="width:90px;" data-help-key="total">
    <select id="inp-type" data-help-key="type-filter">
      <option value="">All types</option>
    </select>
    <label class="uncommitted-toggle" data-help-key="uncommitted">
      <input type="checkbox" id="chk-uncommitted" checked>
      Include unconfirmed
    </label>
    <button id="btn-search" data-help-key="do-search">Search</button>
    <button id="btn-recycle" data-help-key="recycle-bin" style="display:none">Recycle bin</button>
    <button id="btn-restore-all" style="display:none">Restore all</button>
    <button id="btn-empty-bin" style="display:none">Empty bin</button>
    <button id="btn-mailbox" data-help-key="mailbox" style="display:none">Mailbox</button>
  </div>
  <div id="date-range-note" style="display:none; padding:2px 12px; font-size:12px; color:var(--warn);">
    “From” date is after “To” date — no documents can match. Swap them or clear one.
  </div>

  <div id="body">
    <div id="results-pane" data-help-key="results-pane">
      <div id="mailbox-tabs" style="display:none">
        <button class="mb-tab active" data-box="inbox">Inbox</button>
        <button class="mb-tab" data-box="sent">Sent</button>
        <!-- "Assigned" (= routes YOU have CLAIMED but not resolved) is HIDDEN on the desktop:
             the desktop decision bar resolves straight from pending and never claims, so this
             box is structurally always empty here — it only fills via the detached client's
             claim flow (Chris r4 card 6 + eric A6; bob's honest-cut ruling). Un-hide when
             desktop claiming exists. -->
        <button class="mb-tab" data-box="assigned" style="display:none;">Assigned</button>
        <button class="mb-tab" data-box="completed">Completed</button>
      </div>
      <div id="results-body">
        <div id="results-scroll">
          <div id="results-empty" style="display:none">No documents found</div>
        </div>
        <!-- Vertical tool rail (mirrors the Review window): document cycle at the top,
             then the document tools. Buttons reveal by role/mode via search-results.js. -->
        <div id="search-scroll-rail">
          <div class="rail-group rail-nav-group">
            <button class="queue-nav-btn" id="btn-doc-prev" title="Previous document (↑)" aria-label="Previous document">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>
            </button>
            <button class="queue-nav-btn" id="btn-doc-next" title="Next document (↓)" aria-label="Next document">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
            </button>
          </div>
          <div class="rail-divider rail-divider-clear"></div>
          <div class="rail-group rail-tools-group">
            <button class="queue-tool-btn danger" id="rail-delete" style="display:none" title="Delete (move to recycle bin)" aria-label="Delete">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
            <button class="queue-tool-btn" id="rail-restore" style="display:none" title="Restore from recycle bin" aria-label="Restore">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/></svg>
            </button>
            <button class="queue-tool-btn" id="rail-sendback" style="display:none" title="Send back to Review (admin) — re-open a filed document in the queue" aria-label="Send back to Review">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H9"/></svg>
            </button>
            <button class="queue-tool-btn" id="rail-recycle" style="display:none" title="Show the recycle bin" aria-label="Recycle bin">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5"/><path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12"/><path d="m14 16-3 3 3 3"/><path d="M8.293 13.596 7.196 9.5 3.1 10.598"/><path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843"/><path d="m13.378 9.633 4.096 1.098 1.097-4.096"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div id="preview-pane" data-help-key="preview-pane">
      <div id="preview-empty">Select a document from the results</div>

      <div id="preview-doc" style="display:none">
        <div id="preview-img-col">
          <div id="page-nav" style="display:none">
            <div class="pn-group" data-help-key="preview-zoom">
              <span class="pn-label">Zoom</span>
              <button class="page-nav-btn" id="btn-zoom-out" title="Zoom out" aria-label="Zoom out">&#8722;</button>
              <span id="zoom-level" class="page-nav-label">100%</span>
              <button class="page-nav-btn" id="btn-zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
              <button class="page-nav-btn pn-wide" id="btn-zoom-reset" title="Reset zoom &amp; position">Reset</button>
            </div>
            <div class="pn-sep pn-pages"></div>
            <div class="pn-group pn-pages">
              <span class="pn-label">Page</span>
              <button class="page-nav-btn" id="btn-page-prev" data-help-key="preview-pages" title="Previous page" aria-label="Previous page" disabled>&#8249;</button>
              <span id="page-label" class="page-nav-label">1 / 1</span>
              <button class="page-nav-btn" id="btn-page-next" data-help-key="preview-pages" title="Next page" aria-label="Next page" disabled>&#8250;</button>
            </div>
            <div class="pn-sep" id="match-sep" style="display:none"></div>
            <div class="pn-group mn-group" id="match-nav" data-help-key="preview-find" style="display:none">
              <span class="pn-label mn-cap"><svg class="mn-ico" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>Find</span>
              <input type="text" id="inp-find-doc" class="mn-input" placeholder="in this document…" title="Find text in this document (PDF text). Enter = next match, Shift+Enter = previous, Esc = clear." autocomplete="off" spellcheck="false">
              <button class="page-nav-btn mn-btn" id="btn-match-prev" title="Previous match" aria-label="Previous match" disabled>&#8249;</button>
              <span id="match-label" class="page-nav-label mn-count">0 / 0</span>
              <button class="page-nav-btn mn-btn" id="btn-match-next" title="Next match" aria-label="Next match" disabled>&#8250;</button>
            </div>
          </div>
          <div id="preview-img-area" data-help-key="preview-zoom">
            <span id="preview-img-placeholder">Loading…</span>
            <div id="preview-img-wrap" style="display:none"><img id="preview-img" alt="Document preview" draggable="false"><div id="preview-hl-layer"></div></div>
          </div>
        </div>

        <div id="sidebar-resizer" title="Drag to resize the details column"></div>
        <div id="preview-sidebar">
          <div id="preview-outline" style="display:none"><div class="pv-outline-head">Contents</div><div id="preview-outline-list"></div><div id="preview-outline-note" class="pv-outline-note" hidden></div></div>
          <div id="preview-fields-scroll"></div>
          <div id="preview-actions" data-help-key="preview-actions"></div>
        </div>
      </div>
    </div>
  </div>
`;
  function mount(host) {
    const el = host || document.getElementById('app');
    if (!el) return false;
    el.insertAdjacentHTML('beforeend', SEARCH_MARKUP);
    return true;
  }
  window.SearchMarkup = { html: SEARCH_MARKUP, mount };
  mount();   // auto-mount into #app when the page has one (both apps do)
})();
