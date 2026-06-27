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
    { file: 'document-types.html',  title: 'Document Types & Fields', sections: ['document-types', 'at-a-glance', 'catalog', 'add-catalog', 'add-type', 'tab-doctypes', 'fields', 'field-types', 'locked-fields', 'renaming'] },
    { file: 'search.html',          title: 'Search & Filing',       sections: ['search', 'filing', 'retrieval', 'output-structure', 'tab-filenaming'] },
    { file: 'settings.html',        title: 'Settings & Help',       sections: ['settings', 'help', 'help-mode', 'tab-general', 'tab-advanced', 'tab-licensing', 'name-checks', 'backup'] },
    { file: 'troubleshooting.html', title: 'Troubleshooting & FAQ', sections: ['troubleshooting', 'faq'] },
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
  buildBreadcrumb();
  buildFooter();
  wireShots();

  // Scroll to a hash the page was opened with (deep-link redirect target).
  if (location.hash) scrollToHash(location.hash);

  // Listen for live deep-link requests (already-open window, or first open).
  window.docusnap?.onHelpSection?.((section) => goToSection(section || 'overview'));
})();
