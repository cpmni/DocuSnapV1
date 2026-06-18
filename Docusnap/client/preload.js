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
  connect:         () => ipcRenderer.invoke('client-connect'),
  login:           (username, password, totp) => ipcRenderer.invoke('client-login', { username, password, totp }),
  logout:          () => ipcRenderer.invoke('client-logout'),
  search:          (params) => ipcRenderer.invoke('client-search', params),
  getDocument:     (id) => ipcRenderer.invoke('client-get-document', id),
  getPages:        (id) => ipcRenderer.invoke('client-get-pages', id),
  isAuthenticated: () => ipcRenderer.invoke('client-authed'),
});
