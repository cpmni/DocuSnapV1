/*
 * shared/thumbs.js — ONE lazy page-1 thumbnail loader shared by every document
 * list (Review queue, Search results) and the add-template / teach picker, so the
 * three can't drift in how they fetch or cache thumbnails.
 *
 * - Renders only ROWS THE USER CAN SEE (IntersectionObserver), so long lists don't
 *   spawn a render per row up front.
 * - Caches per docId for the window session (in-memory Promise cache — dedupes
 *   concurrent requests and avoids re-rendering on re-scroll). No disk, no cleanup.
 * - Safe fallback: when no thumbnail can be produced the <img> stays hidden and the
 *   caller's fallback (emoji / blank slot) shows through, via CSS state classes.
 *
 * Usage: window.Thumbs.lazy(imgEl, doc)  — doc = { id, folder_path, original_filename }
 * The <img> should start with class "ds-thumb" (hidden until loaded). On success it
 * gains "loaded"; on failure/none it gains "failed".
 */
(function () {
  const api   = (window.docusnap || {});
  const cache = new Map();   // docId -> Promise<string|null>

  function fetchThumb(doc) {
    if (cache.has(doc.id)) return cache.get(doc.id);
    const p = (typeof api.getDocumentThumbnail === 'function' && doc.folder_path && doc.original_filename)
      ? api.getDocumentThumbnail(doc.id, doc.folder_path, doc.original_filename).catch(() => null)
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

  window.Thumbs = { lazy };
})();
