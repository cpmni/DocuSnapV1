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
  isAuthenticated: () => ipcRenderer.invoke('client-authed'),
  // Connection watch: main pushes lost/restored; the renderer can force a re-check.
  onConnectionLost:     (cb) => ipcRenderer.on('client-connection-lost',     () => cb()),
  onConnectionRestored: (cb) => ipcRenderer.on('client-connection-restored', () => cb()),
  retryConnection:      () => ipcRenderer.invoke('client-retry-connection'),
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
    assign:     (documentId, toUserId, actionRequired, comment) =>
                  ipcRenderer.invoke('client-wf-assign', { documentId, toUserId, actionRequired, comment }),
    claim:      (id, version) => ipcRenderer.invoke('client-wf-claim', { id, version }),
    resolve:    (id, decision, comment, version) =>
                  ipcRenderer.invoke('client-wf-resolve', { id, decision, comment, version }),
    recall:     (id, version) => ipcRenderer.invoke('client-wf-recall', { id, version }),
    stamped:    (id) => ipcRenderer.invoke('client-wf-stamped', id),
  },
});
