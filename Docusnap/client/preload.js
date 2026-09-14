'use strict';

/**
 * client/preload.js
 * -----------------
 * The ONLY bridge between the renderer and the main process. Mirrors the core
 * app's security posture: contextIsolation + a deliberately narrow, named API.
 * No token, no Node, no filesystem is exposed — only these read-only/auth calls,
 * each proxied to main over IPC.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scanfinder', {
  config:          () => ipcRenderer.invoke('client-config'),
  getServer:       () => ipcRenderer.invoke('client-get-server'),
  setServer:       (cfg) => ipcRenderer.invoke('client-set-server', cfg),
  pickCert:        () => ipcRenderer.invoke('client-pick-cert'),
  importProfile:   () => ipcRenderer.invoke('client-import-profile'),
  fetchCa:         (opts) => ipcRenderer.invoke('client-fetch-ca', opts),
  connect:         () => ipcRenderer.invoke('client-connect'),
  login:           (username, password, totp) => ipcRenderer.invoke('client-login', { username, password, totp }),
  logout:          () => ipcRenderer.invoke('client-logout'),
  changePassword:  (currentPassword, newPassword) => ipcRenderer.invoke('client-change-password', { currentPassword, newPassword }),
  entitlement:     () => ipcRenderer.invoke('client-entitlement'),
  search:          (params) => ipcRenderer.invoke('client-search', params),
  getDocument:     (id) => ipcRenderer.invoke('client-get-document', id),
  getPages:        (id) => ipcRenderer.invoke('client-get-pages', id),
  getThumbnail:    (id) => ipcRenderer.invoke('client-get-thumbnail', id),
  // The four preview reads (contract 1.3.0 — the search pop-out's lazy page / count / find / xlsx grid).
  getPage:         (id, index, scale) => ipcRenderer.invoke('client-get-page', id, index, scale),
  getPageCount:    (id) => ipcRenderer.invoke('client-page-count', id),
  find:            (id, query) => ipcRenderer.invoke('client-find', id, query),
  getSpreadsheet:  (id) => ipcRenderer.invoke('client-spreadsheet', id),
  isAuthenticated: () => ipcRenderer.invoke('client-authed'),
  // Connection watch: main pushes lost/restored (to EVERY window); the renderer can force a re-check.
  onConnectionLost:     (cb) => ipcRenderer.on('client-connection-lost',     () => cb()),
  onConnectionRestored: (cb) => ipcRenderer.on('client-connection-restored', () => cb()),
  retryConnection:      () => ipcRenderer.invoke('client-retry-connection'),
  // Search pop-out (client search parity S1, 2026-09-13). openSearch({ query, docId }) opens/focuses the
  // pop-out (main window); the pop-out pulls its deep-link once (searchTarget), learns who is signed in
  // (currentUser — role/name only, never a token) and what the server can do (serverInfo), receives live
  // deep-links while open, and reports a 401 so the main window signs out.
  openSearch:           (opts) => ipcRenderer.invoke('client-open-search', opts || {}),
  searchTarget:         () => ipcRenderer.invoke('client-search-target'),
  currentUser:          () => ipcRenderer.invoke('client-current-user'),
  serverInfo:           () => ipcRenderer.invoke('client-server-info'),
  onSearchSetQuery:     (cb) => ipcRenderer.on('client-search-set-query', (_e, q) => cb(q)),
  onSearchGotoDoc:      (cb) => ipcRenderer.on('client-search-goto-doc', (_e, id) => cb(id)),
  popoutSessionExpired: () => ipcRenderer.send('client-popout-session-expired'),
  onSessionExpired:     (cb) => ipcRenderer.on('client-session-expired', () => cb()),
  about:           () => ipcRenderer.invoke('client-about'),
  openLicenses:    () => ipcRenderer.invoke('client-open-licenses'),
  recycle: {
    list:     () => ipcRenderer.invoke('client-recycle-list'),
    delete:   (id) => ipcRenderer.invoke('client-recycle-delete', id),
    restore:  (id) => ipcRenderer.invoke('client-recycle-restore', id),
    purge:    (id) => ipcRenderer.invoke('client-recycle-purge', id),
    purgeAll: () => ipcRenderer.invoke('client-recycle-purge-all'),
  },
  workflow: {
    list:       (view) => ipcRenderer.invoke('client-wf-list', view),
    recipients: () => ipcRenderer.invoke('client-wf-recipients'),
    assign:     (documentId, toUserId, actionRequired, comment, resubmitOf) =>
                  ipcRenderer.invoke('client-wf-assign', { documentId, toUserId, actionRequired, comment, resubmitOf }),
    claim:      (id, version) => ipcRenderer.invoke('client-wf-claim', { id, version }),
    resolve:    (id, decision, comment, version) =>
                  ipcRenderer.invoke('client-wf-resolve', { id, decision, comment, version }),
    recall:     (id, version) => ipcRenderer.invoke('client-wf-recall', { id, version }),
    stamped:    (id) => ipcRenderer.invoke('client-wf-stamped', id),
    // Stamping (Workflow+Stamping redesign 2026-08-28) — all return the raw { status, json }.
    stampTypes: () => ipcRenderer.invoke('client-wf-stamp-types'),
    canStamp:   () => ipcRenderer.invoke('client-wf-can-stamp'),
    stampList:  (id) => ipcRenderer.invoke('client-wf-stamp-list', id),
    stampPlace: (id, body) => ipcRenderer.invoke('client-wf-stamp-place', { id, body }),
    stampedDoc: (id) => ipcRenderer.invoke('client-wf-stamped-doc', id),
    // Contract 1.4.0 (2026-09-14): the pop-out's open-routes / decision-history reads, admin cancel, "+ New stamp".
    docRoutes:       (id) => ipcRenderer.invoke('client-wf-doc-routes', id),
    docHistory:      (id) => ipcRenderer.invoke('client-wf-doc-history', id),
    adminCancel:     (id, version, reason) => ipcRenderer.invoke('client-wf-admin-cancel', { id, version, reason }),
    stampTypeCreate: (body) => ipcRenderer.invoke('client-wf-stamp-type-create', body),
  },
  review: {
    queue:    () => ipcRenderer.invoke('client-review-queue'),
    deferred: () => ipcRenderer.invoke('client-review-deferred'),
    counts:   () => ipcRenderer.invoke('client-review-counts'),
    docTypes: () => ipcRenderer.invoke('client-doc-types'),
    confirm:  (id, payload) => ipcRenderer.invoke('client-review-confirm', id, payload),
    defer:    (id) => ipcRenderer.invoke('client-review-defer', id),
    undefer:  (id) => ipcRenderer.invoke('client-review-undefer', id),
    viewing:  (id) => ipcRenderer.invoke('client-review-viewing', id),
    release:  (id) => ipcRenderer.invoke('client-review-release', id),
    ocrRegion:(id, imageBase64) => ipcRenderer.invoke('client-review-ocr-region', id, imageBase64),
  },
  // Quick File (non-OCR upload). Paths stay in main — the renderer only sees tokens + names.
  quickFile: {
    docTypes: () => ipcRenderer.invoke('client-intake-doctypes'),
    pick:     () => ipcRenderer.invoke('client-intake-pick'),
    submit:   (token, meta) => ipcRenderer.invoke('client-intake-submit', token, meta),
  },
});

// ── Keyboard-focus repair (Windows) — mirrors the core app's preload ───────────
// Electron on Windows can leave the render widget WITHOUT keyboard focus while the OS
// window still has focus, so a click into a text field shows no caret until you click
// out of the app and back in. The window-level grabFocus (client/main.js) can't catch a
// loss that happens without an OS focus change (a dialog closing, a view swap). When a
// pointer press enters a text control while the document lacks focus, ask main to
// re-focus the webContents, then re-assert the caret. No-op when focus is already fine.
window.addEventListener('pointerdown', (e) => {
  try {
    if (document.hasFocus()) return;
    const t = e.target;
    const el = t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
    if (!el) return;
    ipcRenderer.send('ensure-window-focus');
    requestAnimationFrame(() => { try { el.focus(); } catch {} });
  } catch { /* never break a click */ }
}, true);
