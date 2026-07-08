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
  const PAGES = [
    { file: 'index.html',           title: 'Home',                  sections: ['overview', 'home', 'quick-start'] },
    { file: 'getting-started.html', title: 'Getting Started',       sections: ['main', 'console', 'getting-started', 'login', 'first-run', 'mode'] },
    { file: 'importing.html',       title: 'Importing Documents',   sections: ['import', 'importing', 'begin-import', 'process', 'source-folder'] },
    { file: 'review.html',          title: 'Review Window',         sections: ['review', 'confidence', 'statuses', 'actions'] },
    { file: 'templates.html',       title: 'Templates & Learning',  sections: ['teach', 'templates', 'learning', 'template-wizard', 'which-tool', 'tab-learning', 'tab-templates', 'template-manager', 'anchor-wizard'] },
    { file: 'document-types.html',  title: 'Document Types & Fields', sections: ['document-types', 'catalog', 'add-catalog', 'add-type', 'tab-doctypes', 'fields', 'field-types', 'locked-fields', 'renaming'] },
    { file: 'search.html',          title: 'Search & Filing',       sections: ['search', 'filing', 'retrieval', 'output-structure', 'tab-filenaming'] },
    { file: 'search-client.html',   title: 'Search Client (other PCs)', sections: ['search-client', 'client-connect', 'client-firewall', 'client-seats', 'client-shared'] },
    { file: 'search-client-setup.html', title: 'Set up the Search Client', sections: ['client-setup', 'client-cert-setup', 'setup-turnon', 'setup-cert', 'setup-connect', 'setup-firewall', 'setup-faq'] },
    { file: 'settings.html',        title: 'Settings & Help',       sections: ['settings', 'help', 'help-mode', 'tab-general', 'tab-advanced', 'tab-licensing', 'name-checks', 'backup'] },
    { file: 'shortcuts.html',       title: 'Keyboard Shortcuts',    sections: ['shortcuts', 'sc-review', 'sc-search', 'sc-settings', 'sc-around', 'sc-mouse', 'keyboard', 'gestures'] },
    { file: 'troubleshooting.html', title: 'Troubleshooting & FAQ', sections: ['troubleshooting', 'faq'] },
  ];

  // ── Search index: every section HEADING in the guide → jump straight to it. The
  //    nav search box (built below) filters this list; clicking a hit opens that
  //    page at the section's anchor. Keep in step with the headings on each page. ──
  const SEARCH_INDEX = [
    ['Welcome to Scan Finder',                         'index.html',           'overview',         'Home'],
    ['Quick start — your first filed document',         'index.html',           'quick-start',      'Home'],
    ['Who Scan Finder is for',                          'index.html',           'who',              'Home'],
    ['Getting Started',                                 'getting-started.html', 'getting-started',  'Getting Started'],
    ['Opening the app and signing in',                  'getting-started.html', 'login',            'Getting Started'],
    ['First-time setup',                                'getting-started.html', 'first-run',        'Getting Started'],
    ['The home screen',                                 'getting-started.html', 'console',          'Getting Started'],
    ['Processing mode: Fast or Smart',                  'getting-started.html', 'mode',             'Getting Started'],
    ['Importing Documents',                             'importing.html',       'importing',        'Importing Documents'],
    ['Two folders, two different jobs',                 'importing.html',       'folders',          'Importing Documents'],
    ['How to import and process',                       'importing.html',       'import',           'Importing Documents'],
    ['What happens after importing',                    'importing.html',       'after',            'Importing Documents'],
    ['The Review Window',                               'review.html',          'review',           'Review Window'],
    ['The three areas',                                 'review.html',          'layout',           'Review Window'],
    ['Reviewing a document, step by step',              'review.html',          'loop',             'Review Window'],
    ['Editing a field',                                 'review.html',          'editing',          'Review Window'],
    ['What “confidence” means',                         'review.html',          'confidence',       'Review Window'],
    ['What the badges and statuses mean',               'review.html',          'statuses',         'Review Window'],
    ['The action buttons',                              'review.html',          'actions',          'Review Window'],
    ['When a scan reads badly',                         'review.html',          'recovery',         'Review Window'],
    ['Templates & Learning',                            'templates.html',       'templates',        'Templates & Learning'],
    ['How learning works',                              'templates.html',       'learning',         'Templates & Learning'],
    ['Which teaching tool should I use?',               'templates.html',       'which-tool',       'Templates & Learning'],
    ['Teach a document',                                'templates.html',       'teach',            'Templates & Learning'],
    ['The Template Wizard and manual mapping',          'templates.html',       'template-wizard',  'Templates & Learning'],
    ['Template Manager',                                'templates.html',       'template-manager', 'Templates & Learning'],
    ['Document Types & Fields',                         'document-types.html',  'document-types',   'Document Types & Fields'],
    ['Add a type from the catalog',                     'document-types.html',  'catalog',          'Document Types & Fields'],
    ['Your own fields',                                 'document-types.html',  'fields',           'Document Types & Fields'],
    ['The three fields every type has',                 'document-types.html',  'locked-fields',    'Document Types & Fields'],
    ['Renaming a field',                                'document-types.html',  'renaming',         'Document Types & Fields'],
    ['Search & Filing',                                 'search.html',          'filing',           'Search & Filing'],
    ['How documents are filed',                         'search.html',          'how-filed',        'Search & Filing'],
    ['Customise how documents are named and foldered',  'search.html',          'output-structure', 'Search & Filing'],
    ['Searching for a document',                        'search.html',          'search',           'Search & Filing'],
    ['The Search Client (other PCs)',                   'search-client.html',   'search-client',    'Search Client (other PCs)'],
    ['How it connects to the main PC',                  'search-client.html',   'client-connect',   'Search Client (other PCs)'],
    ['Letting clients through the firewall',            'search-client.html',   'client-firewall',  'Search Client (other PCs)'],
    ['How many people can connect',                     'search-client.html',   'client-seats',     'Search Client (other PCs)'],
    ['When several people use it at once',              'search-client.html',   'client-shared',    'Search Client (other PCs)'],
    ['Set up the Search Client — step by step',         'search-client-setup.html', 'client-setup',  'Set up the Search Client'],
    ['Turn on access & enter the address',              'search-client-setup.html', 'setup-turnon',  'Set up the Search Client'],
    ['The security certificate (made for you)',         'search-client-setup.html', 'setup-cert',    'Set up the Search Client'],
    ['Connect the other PC',                            'search-client-setup.html', 'setup-connect', 'Set up the Search Client'],
    ['Allow it through Windows Firewall',               'search-client-setup.html', 'setup-firewall','Set up the Search Client'],
    ['Connection problems — FAQ',                       'search-client-setup.html', 'setup-faq',     'Set up the Search Client'],
    ['Settings & Help',                                 'settings.html',        'settings',         'Settings & Help'],
    ['The settings you’ll actually use',                'settings.html',        'common',           'Settings & Help'],
    ['Folders: output, processed & watch',              'settings.html',        'common',           'Settings & Help'],
    ['Processing mode & name checks',                   'settings.html',        'common',           'Settings & Help'],
    ['Colour theme & appearance',                       'settings.html',        'common',           'Settings & Help'],
    ['Advanced settings',                               'settings.html',        'advanced',         'Settings & Help'],
    ['Backup & Restore',                                'settings.html',        'advanced',         'Settings & Help'],
    ['Activation & licensing',                          'settings.html',        'licensing',        'Settings & Help'],
    ['Where to find help',                              'settings.html',        'help',             'Settings & Help'],
    ['The “?” help mode',                               'settings.html',        'help-mode',        'Settings & Help'],
    ['Keyboard shortcuts & handy gestures',             'shortcuts.html',       'shortcuts',        'Keyboard Shortcuts'],
    ['Review window shortcuts',                         'shortcuts.html',       'sc-review',        'Keyboard Shortcuts'],
    ['Confirm & File shortcut (Ctrl+Enter)',            'shortcuts.html',       'sc-review',        'Keyboard Shortcuts'],
    ['Search window shortcuts',                         'shortcuts.html',       'sc-search',        'Keyboard Shortcuts'],
    ['Settings & template shortcuts',                   'shortcuts.html',       'sc-settings',      'Keyboard Shortcuts'],
    ['Handy mouse gestures',                            'shortcuts.html',       'sc-mouse',         'Keyboard Shortcuts'],
    ['Troubleshooting & FAQ',                           'troubleshooting.html', 'troubleshooting',  'Troubleshooting & FAQ'],
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
