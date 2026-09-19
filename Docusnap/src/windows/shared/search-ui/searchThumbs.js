'use strict';
/*
 * searchThumbs.js — the search UI's lazy page-1 thumbnail loader.
 * SHARED SEARCH UI — IO only through window.SearchTransport (see searchState.js header).
 *
 * A transport-fed twin of src/windows/shared/thumbs.js (which captures the core preload bridge at load and
 * is kept for the Review queue + the teach picker). Same behaviour: renders only ROWS THE USER CAN SEE
 * (IntersectionObserver), caches per docId for the window session (Promise cache — dedupes concurrent
 * requests, no re-render on re-scroll), and on failure leaves the <img> hidden so the CSS placeholder
 * shows through. Its OWN global (window.SearchThumbs) so it can never race shared/thumbs.js for
 * window.Thumbs — the core Search page loads THIS one and not thumbs.js.
 *
 * Usage: window.SearchThumbs.lazy(imgEl, { id })  — the transport resolves the file server-side by id.
 * On success the <img> gains "loaded"; on failure/none it gains "failed".
 */
(function () {
  const cache = new Map();   // docId -> Promise<string|null>

  // At most TWO thumbnails in flight (2026-09-14, viewer speed): every thumbnail is a Python process on the core
  // (~0.35 s of CPU, measured) and a burst of visible rows used to fire them ALL at once — a dozen processes
  // competing with the page render the user had just clicked for. NEWEST FIRST (LIFO): a fresh scroll or a new
  // search puts the rows now on screen ahead of rows queued earlier. A job whose row is GONE by the time it is
  // dequeued (re-rendered by a new search, scrolled away and dropped) is skipped AND forgotten, so a re-scroll
  // re-requests it instead of inheriting a null (Oracle 2026-09-14 condition 2). Never dropped while visible.
  const MAX_INFLIGHT = 2;
  let inflight = 0;
  const queue = [];   // [{ doc, img, resolve }]
  function pump() {
    while (inflight < MAX_INFLIGHT && queue.length) {
      const job = queue.pop();
      if (job.img && !job.img.isConnected) { cache.delete(job.doc.id); job.resolve(null); continue; }
      const T = window.SearchTransport;
      inflight++;
      Promise.resolve()
        .then(() => T.getDocumentThumbnail(job.doc.id, job.doc.folder_path || null, job.doc.original_filename || null))
        .then(job.resolve, () => job.resolve(null))
        .then(() => { inflight--; pump(); });
    }
  }

  function fetchThumb(doc, img) {
    if (cache.has(doc.id)) return cache.get(doc.id);
    const T = window.SearchTransport;
    // Guard on the ID only — the handler resolves the file server-side and ignores any client paths.
    const can = !!(T && typeof T.getDocumentThumbnail === 'function' && doc.id);
    if (!can) { const none = Promise.resolve(null); cache.set(doc.id, none); return none; }
    // Cache FIRST, then queue: pump() runs synchronously and may skip + forget this very job (row already gone) —
    // caching after it would re-insert the forgotten, null-resolved promise and poison the next request.
    let resolve;
    const p = new Promise((r) => { resolve = r; });
    cache.set(doc.id, p);
    queue.push({ doc, img: img || null, resolve });
    pump();
    return p;
  }

  let observer = null;
  function getObserver() {
    if (observer) return observer;
    // Root the observer on the ACTUAL scroll container (#results-scroll), NOT the viewport. With the
    // viewport as root, whether a row's thumbnail was ever requested depended on the WINDOW size and on
    // the flex/overflow container's height being settled at observe time — so in a non-maximised window
    // (the detached client) rows below the first fold were measured as off-screen and NEVER requested
    // until a reflow (the owner saw the missing thumbnails appear only after going full-screen). The core
    // Search window is force-maximised, so it never hit this. Rooting on the list's own scrollport makes
    // intersection independent of window size and reliable; falls back to the viewport if absent.
    const root = (typeof document !== 'undefined' && document.getElementById('results-scroll')) || null;
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target;
        observer.unobserve(img);
        load(img);
      }
    }, { root, rootMargin: '200px' });   // start rendering just before the row scrolls into the list
    return observer;
  }

  function load(img) {
    const doc = img._thumbDoc;
    if (!doc) return;
    fetchThumb(doc, img).then((uri) => {
      if (!img.isConnected) return;          // row removed before render finished
      if (uri) { img.src = uri; img.classList.add('loaded'); }
      else     { img.classList.add('failed'); }
    });
  }

  function lazy(img, doc) {
    if (!img || !doc) return;
    img._thumbDoc = doc;
    if ('IntersectionObserver' in window) getObserver().observe(img);
    else load(img);                          // graceful fallback: render immediately
  }

  window.SearchThumbs = { lazy };
})();
