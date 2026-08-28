'use strict';
/*
 * Shared navigation + chrome for every Scan Finder User Guide page.
 *
 * One file, one PAGES manifest — so adding/renaming a page is a single edit here,
 * not eight. It builds the left nav, breadcrumb and prev/next footer into the
 * placeholders each page provides, wires the close button, handles the
 * `help-section` deep-link from the app (Help / "?" / User Guide buttons), and
 * swaps any missing screenshot for a tidy placeholder.
 *
 * Pure same-origin static navigation (real <a href> links) + this one 'self'
 * script — no inline JS (CSP blocks it), no new IPC.
 */
(function () {
  // ── The guide, in reading order. `sections` are the deep-link keys the app may
  //    pass via open-help-window(section); each maps to the page that covers it. ──
  // Rebuild in progress (2026-08-28): the SPINE + Check pages are the new plain-speak
  // guide; the rest are the previous pages, kept live until their rewrite ships so every
  // deep link still resolves (help-system rebuild plan §11). Reading order = nav order.
  const PAGES = [
    { file: 'index.html',            title: 'Home',                     sections: ['overview', 'home'] },
    { file: 'quick-start.html',      title: 'Quick start',              sections: ['quick-start'] },
    { file: 'set-up.html',           title: 'Set up',                   sections: ['set-up', 'getting-started', 'main', 'console', 'login', 'first-run'] },
    { file: 'teach.html',            title: 'Teach your documents',     sections: ['teach', 'templates', 'learning', 'which-tool', 'template-wizard', 'template-manager', 'anchor-wizard', 'tab-learning', 'tab-templates'] },
    { file: 'document-types.html',   title: 'Kinds of document',        sections: ['document-types', 'catalog', 'add-catalog', 'add-type', 'tab-doctypes', 'fields', 'field-types', 'locked-fields', 'renaming'] },
    { file: 'import.html',           title: 'Import a batch',           sections: ['import', 'importing', 'begin-import', 'process', 'source-folder'] },
    { file: 'review.html',           title: 'Check what it read',       sections: ['review', 'confidence', 'statuses', 'actions', 'loop', 'editing', 'recovery'] },
    { file: 'fix-a-detail.html',     title: 'Fixing a detail',          sections: ['fix-a-detail'] },
    { file: 'files-by-itself.html',  title: 'When it files by itself',  sections: ['files-by-itself'] },
    { file: 'search.html',           title: 'Find a document',          sections: ['search', 'filing', 'retrieval', 'output-structure', 'tab-filenaming'] },
    { file: 'search-client.html',    title: 'Search from other PCs',    sections: ['search-client', 'client-connect', 'client-firewall', 'client-seats', 'client-shared'] },
    { file: 'search-client-setup.html', title: 'Set up the Search Client', sections: ['client-setup', 'client-cert-setup', 'setup-turnon', 'setup-cert', 'setup-connect', 'setup-firewall', 'setup-faq'] },
    { file: 'settings.html',         title: 'Settings',                 sections: ['settings', 'help', 'help-mode', 'tab-general', 'tab-advanced', 'tab-licensing', 'name-checks', 'backup'] },
    { file: 'shortcuts.html',        title: 'Keyboard shortcuts',       sections: ['shortcuts', 'sc-review', 'sc-search', 'sc-settings', 'sc-around', 'sc-mouse', 'keyboard', 'gestures'] },
    { file: 'troubleshooting.html',  title: 'Troubleshooting & FAQ',    sections: ['troubleshooting', 'faq'] },
  ];

  // ── Search index: every section HEADING in the guide → jump straight to it. The
  //    nav search box (built below) filters this list; clicking a hit opens that
  //    page at the section's anchor. Keep in step with the headings on each page. ──
  const SEARCH_INDEX = [
    ['Welcome to Scan Finder',                          'index.html',           'overview',         'Home'],
    ['Where would you like to start?',                  'index.html',           'paths',            'Home'],
    ['Who it’s for',                               'index.html',           'who',              'Home'],
    ['Quick start',                                     'quick-start.html',     'quick-start',      'Quick start'],
    ['Set up',                                          'set-up.html',          'set-up',           'Set up'],
    ['Sign in',                                         'set-up.html',          'login',            'Set up'],
    ['The setup questions',                             'set-up.html',          'first-run',        'Set up'],
    ['The tour and a practice run',                     'set-up.html',          'tour',             'Set up'],
    ['The home screen',                                 'set-up.html',          'console',          'Set up'],
    ['Teach your documents',                            'teach.html',           'teach',            'Teach your documents'],
    ['Pick one good example',                           'teach.html',           'which-copy',       'Teach your documents'],
    ['The six teaching steps',                          'teach.html',           'which-tool',       'Teach your documents'],
    ['The printed label next to a detail',              'teach.html',           'labels',           'Teach your documents'],
    ['Crooked scans, several pages, and lists',         'teach.html',           'extras',           'Teach your documents'],
    ['Kinds of document and their details',             'document-types.html',  'document-types',   'Kinds of document'],
    ['Add a type from the catalog',                     'document-types.html',  'catalog',          'Kinds of document'],
    ['Your own details (fields)',                       'document-types.html',  'fields',           'Kinds of document'],
    ['The three details every type has',                'document-types.html',  'locked-fields',    'Kinds of document'],
    ['Import a batch',                                  'import.html',          'import',           'Import a batch'],
    ['The two folders',                                 'import.html',          'folders',          'Import a batch'],
    ['Bring your scans in and process them',            'import.html',          'process',          'Import a batch'],
    ['Separator sheets, split, watch folder, duplicates', 'import.html',        'more',             'Import a batch'],
    ['Check what it wasn’t sure about',            'review.html',          'review',           'Check what it read'],
    ['The five areas of the Review window',             'review.html',          'layout',           'Check what it read'],
    ['Checking a document, step by step',               'review.html',          'loop',             'Check what it read'],
    ['File All Ready, Delete, Reprocess',               'review.html',          'actions',          'Check what it read'],
    ['Straighten a crooked scan',                       'review.html',          'recovery',         'Check what it read'],
    ['When a scan reads badly',                         'review.html',          'recovery',         'Check what it read'],
    ['Fixing a detail',                                 'fix-a-detail.html',    'fix-a-detail',     'Fixing a detail'],
    ['Type over a detail',                              'fix-a-detail.html',    'type',             'Fixing a detail'],
    ['Point at the right value (draw a box)',           'fix-a-detail.html',    'box',              'Fixing a detail'],
    ['Dates and amounts',                               'fix-a-detail.html',    'dates',            'Fixing a detail'],
    ['Use and Keep',                                    'fix-a-detail.html',    'usekeep',          'Fixing a detail'],
    ['A detail that holds several values (list pills)', 'fix-a-detail.html',    'lists',            'Fixing a detail'],
    ['When it files without asking',                    'files-by-itself.html', 'files-by-itself',  'When it files by itself'],
    ['How a sender earns trust',                        'files-by-itself.html', 'ladder',           'When it files by itself'],
    ['“N more from this sender — file them?”', 'files-by-itself.html', 'bar',         'When it files by itself'],
    ['It filed by itself — where did it go',        'files-by-itself.html', 'see',              'When it files by itself'],
    ['Put it back (filed under the wrong company)',     'files-by-itself.html', 'putback',          'When it files by itself'],
    ['Find a document',                                 'search.html',          'search',           'Find a document'],
    ['How documents are filed',                         'search.html',          'filing',           'Find a document'],
    ['Customise how documents are named and foldered',  'search.html',          'output-structure', 'Find a document'],
    ['Recycle bin — restore a deleted document',   'search.html',          'search',           'Find a document'],
    ['Search from other PCs',                           'search-client.html',   'search-client',    'Search from other PCs'],
    ['How it connects to the main PC',                  'search-client.html',   'client-connect',   'Search from other PCs'],
    ['How many people can connect',                     'search-client.html',   'client-seats',     'Search from other PCs'],
    ['Set up the Search Client — step by step',    'search-client-setup.html', 'client-setup', 'Set up the Search Client'],
    ['Turn on access & enter the address',              'search-client-setup.html', 'setup-turnon', 'Set up the Search Client'],
    ['The security certificate (made for you)',         'search-client-setup.html', 'setup-cert',   'Set up the Search Client'],
    ['Connection problems — FAQ',                  'search-client-setup.html', 'setup-faq',    'Set up the Search Client'],
    ['Settings',                                        'settings.html',        'settings',         'Settings'],
    ['Backup & Restore',                                'settings.html',        'advanced',         'Settings'],
    ['Activation & licensing',                          'settings.html',        'licensing',        'Settings'],
    ['The “?” help mode',                     'settings.html',        'help-mode',        'Settings'],
    ['Keyboard shortcuts & handy gestures',             'shortcuts.html',       'shortcuts',        'Keyboard shortcuts'],
    ['Review window shortcuts',                         'shortcuts.html',       'sc-review',        'Keyboard shortcuts'],
    ['Confirm & File shortcut (Ctrl+Enter)',            'shortcuts.html',       'sc-review',        'Keyboard shortcuts'],
    ['Troubleshooting & FAQ',                           'troubleshooting.html', 'troubleshooting',  'Troubleshooting & FAQ'],
    ['It filed under the wrong company',                'troubleshooting.html', 'faq',              'Troubleshooting & FAQ'],
    ['Common questions',                                'troubleshooting.html', 'faq',              'Troubleshooting & FAQ'],
  ];

  function currentFile() {
    const path = location.pathname.split('/').pop();
    return path && path.length ? path : 'index.html';
  }
  function pageForSection(section) {
    const s = String(section || '').toLowerCase();
    return PAGES.find(p => p.sections.includes(s)) || null;
  }
  function indexOfCurrent() {
    const f = currentFile();
    const i = PAGES.findIndex(p => p.file === f);
    return i < 0 ? 0 : i;
  }

  // ── Build the left navigation ───────────────────────────────────────────────
  function buildNav() {
    const host = document.getElementById('nav-links');
    if (!host) return;
    const cur = currentFile();
    PAGES.forEach((p, i) => {
      const a = document.createElement('a');
      a.className = 'nav-item' + (p.file === cur ? ' active' : '');
      a.href = p.file;
      a.innerHTML = `<span class="nav-num">${i === 0 ? '' : i}</span>${p.title}`;
      host.appendChild(a);
    });
  }

  // ── Search box: jump to any section by its heading ──────────────────────────
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  // Bold the matched run in the (already-escaped) label.
  function highlight(label, q) {
    const esc = escapeHtml(label);
    if (!q) return esc;
    const i = label.toLowerCase().indexOf(q);
    if (i < 0) return esc;
    return escapeHtml(label.slice(0, i)) + '<b>' + escapeHtml(label.slice(i, i + q.length)) + '</b>' + escapeHtml(label.slice(i + q.length));
  }
  function buildSearch() {
    const nav = document.getElementById('nav');
    const links = document.getElementById('nav-links');
    if (!nav || !links) return;
    const wrap = document.createElement('div');
    wrap.id = 'help-search';
    wrap.innerHTML =
      '<input id="help-search-input" type="search" placeholder="Search the guide…" autocomplete="off" spellcheck="false" aria-label="Search the guide">' +
      '<div id="help-search-results" hidden></div>';
    nav.insertBefore(wrap, links);
    const input = wrap.querySelector('#help-search-input');
    const out   = wrap.querySelector('#help-search-results');

    function render() {
      const q = input.value.trim().toLowerCase();
      if (!q) { out.hidden = true; out.innerHTML = ''; links.style.display = ''; return; }
      const hits = SEARCH_INDEX
        .filter(([label, , , page]) => label.toLowerCase().includes(q) || page.toLowerCase().includes(q))
        .slice(0, 14);
      out.innerHTML = hits.length
        ? hits.map(([label, file, hash, page]) =>
            `<a class="hs-item" href="${file}#${hash}"><span class="hs-label">${highlight(label, q)}</span><span class="hs-page">${escapeHtml(page)}</span></a>`).join('')
        : `<div class="hs-empty">No matches for &ldquo;${escapeHtml(input.value.trim())}&rdquo;</div>`;
      out.hidden = false;
      links.style.display = 'none';   // hide the page list while searching
    }
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { input.value = ''; render(); input.blur(); }
      else if (e.key === 'Enter') { const first = out.querySelector('a.hs-item'); if (first) { e.preventDefault(); first.click(); } }
    });
    // "/" anywhere (outside a text field) focuses search — a familiar docs shortcut.
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== input
          && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
        e.preventDefault(); input.focus();
      }
    });
  }

  // ── Breadcrumb: "User Guide ▸ <this page>" ──────────────────────────────────
  function buildBreadcrumb() {
    const host = document.getElementById('breadcrumb');
    if (!host) return;
    const cur = PAGES[indexOfCurrent()];
    if (cur.file === 'index.html') {
      host.innerHTML = `<span>User Guide</span>`;
    } else {
      host.innerHTML = `<a href="index.html">User Guide</a><span class="sep">&#9656;</span><span>${cur.title}</span>`;
    }
  }

  // ── Footer: previous / next page + a "back to guide home" link ───────────────
  function buildFooter() {
    const host = document.getElementById('page-foot');
    if (!host) return;
    const i = indexOfCurrent();
    const prev = PAGES[i - 1];
    const next = PAGES[i + 1];
    let html = '';
    if (prev) html += `<a class="pf-prev" href="${prev.file}"><div class="pf-dir">&#8592; Previous</div><div class="pf-title">${prev.title}</div></a>`;
    if (i !== 0) html += `<a class="pf-home" href="index.html">&#8962; Guide home</a>`;
    if (next) html += `<a class="pf-next" href="${next.file}"><div class="pf-dir">Next &#8594;</div><div class="pf-title">${next.title}</div></a>`;
    host.innerHTML = html;
  }

  // ── Deep-link: the app asks the guide to show a particular topic ─────────────
  // Same page → smooth-scroll to that section's anchor (if present). Different
  // page → replace (not push, so it never becomes a "back" trap) and carry the
  // section as a hash so the destination scrolls to it on load.
  function goToSection(section) {
    const target = pageForSection(section);
    if (!target) return;
    if (target.file === currentFile()) {
      scrollToHash('#' + String(section).toLowerCase());
    } else {
      location.replace(target.file + '#' + String(section).toLowerCase());
    }
  }
  function scrollToHash(hash) {
    if (!hash || hash === '#') return;
    let el = null;
    try { el = document.querySelector(hash); } catch { el = null; }
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Screenshots: show a placeholder for any image that isn't there yet ───────
  // CSP forbids inline onerror, so bind here; `error` doesn't bubble and may have
  // already fired during parse, so also retro-sweep already-failed images.
  function placeholder(img) {
    if (!img || !img.parentNode) return;
    const box = document.createElement('div');
    box.className = 'shot-placeholder';
    box.innerHTML = `<span class="ph-icon">&#128247;</span>`
      + `<span class="ph-label">Screenshot coming soon</span>`
      + `<code>${img.getAttribute('src') || ''}</code>`;
    img.replaceWith(box);
  }
  function wireShots() {
    document.querySelectorAll('img.shot').forEach(img => {
      img.addEventListener('error', () => placeholder(img));
      if (img.complete && img.naturalWidth === 0) placeholder(img);
    });
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  document.getElementById('btn-close')?.addEventListener('click', () => window.docusnap?.windowClose?.());

  buildNav();
  buildSearch();
  buildBreadcrumb();
  buildFooter();
  wireShots();

  // Scroll to a hash the page was opened with (deep-link redirect target).
  if (location.hash) scrollToHash(location.hash);

  // Listen for live deep-link requests (already-open window, or first open).
  window.docusnap?.onHelpSection?.((section) => goToSection(section || 'overview'));
})();
