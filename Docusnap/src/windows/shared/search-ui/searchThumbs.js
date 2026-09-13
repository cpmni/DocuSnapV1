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

  function fetchThumb(doc) {
    if (cache.has(doc.id)) return cache.get(doc.id);
    const T = window.SearchTransport;
    // Guard on the ID only — the handler resolves the file server-side and ignores any client paths.
    const p = (T && typeof T.getDocumentThumbnail === 'function' && doc.id)
      ? T.getDocumentThumbnail(doc.id, doc.folder_path || null, doc.original_filename || null).catch(() => null)
      : Promise.resolve(null);
    cache.set(doc.id, p);
    return p;
  }

  let observer = null;
  function getObserver() {
    if (observer) return observer;
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target;
        observer.unobserve(img);
        load(img);
      }
    }, { rootMargin: '200px' });   // start rendering just before the row scrolls in
    return observer;
  }

  function load(img) {
    const doc = img._thumbDoc;
    if (!doc) return;
    fetchThumb(doc).then((uri) => {
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
