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
  connect:         () => ipcRenderer.invoke('client-connect'),
  login:           (username, password, totp) => ipcRenderer.invoke('client-login', { username, password, totp }),
  logout:          () => ipcRenderer.invoke('client-logout'),
  entitlement:     () => ipcRenderer.invoke('client-entitlement'),
  search:          (params) => ipcRenderer.invoke('client-search', params),
  getDocument:     (id) => ipcRenderer.invoke('client-get-document', id),
  getPages:        (id) => ipcRenderer.invoke('client-get-pages', id),
  isAuthenticated: () => ipcRenderer.invoke('client-authed'),
  workflow: {
    list:       (view) => ipcRenderer.invoke('client-wf-list', view),
    recipients: () => ipcRenderer.invoke('client-wf-recipients'),
    assign:     (documentId, toUserId, actionRequired, comment) =>
                  ipcRenderer.invoke('client-wf-assign', { documentId, toUserId, actionRequired, comment }),
    claim:      (id, version) => ipcRenderer.invoke('client-wf-claim', { id, version }),
    resolve:    (id, decision, comment, version) =>
                  ipcRenderer.invoke('client-wf-resolve', { id, decision, comment, version }),
    recall:     (id, version) => ipcRenderer.invoke('client-wf-recall', { id, version }),
  },
});
