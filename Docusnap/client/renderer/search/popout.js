'use strict';
// popout.js — the detached client's search pop-out shell around the SHARED search UI (client search parity
// S1, 2026-09-13). Everything the user sees and does in the search screen is the shared module (../shared/
// search-ui, a generated copy of the core's); this file only wires what is specific to being a client window:
// the deep-links main hands it, the connection banner, the capability hint, and theme sync (themeBoot.js).
(function () {
  const api = window.scanfinder;
  const T = window.SearchTransport;
  const $ = (id) => document.getElementById(id);

  // ── Connection banner (main broadcasts lost/restored to EVERY window) ─────────────
  const banner = $('popout-banner');
  api.onConnectionLost?.(() => banner && banner.classList.add('show'));
  api.onConnectionRestored?.(() => { if (banner) banner.classList.remove('show'); });
  $('popout-retry')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Reconnecting…';
    try { const r = await api.retryConnection(); if (r && r.ok && banner) banner.classList.remove('show'); } catch {}
    b.disabled = false; b.textContent = 'Retry now';
  });

  // ── Live deep-links while this window is already open ─────────────────────────────
  api.onSearchSetQuery?.((q) => {
    const el = $('inp-fulltext');
    if (el) { el.value = q || ''; window.SearchQuery.doSearch(); }
  });
  api.onSearchGotoDoc?.((id) => { if (id != null) window.SearchPreview.selectDoc({ id: Number(id) }); });

  // ── Boot the shared UI ───────────────────────────────────────────────────────────
  let target = null;   // { query, docId } pulled once from main
  window.SearchUI.init({
    initialQuery: async () => {
      try { target = await api.searchTarget(); } catch { target = null; }
      return target && target.query ? target.query : null;
    },
    afterInit: async () => {
      // Capability gate (which /v1 reads this server can back) + the remediable-drift hint.
      try {
        const info = await T.refreshCaps();
        const note = $('popout-note');
        if (note) note.classList.toggle('show', !!info.serverBehind);
      } catch { /* caps stay conservative */ }
      if (target && target.docId != null) window.SearchPreview.selectDoc({ id: Number(target.docId) });
    },
  });
})();
