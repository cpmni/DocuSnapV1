'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('certtool', {
  pickOutDir: () => ipcRenderer.invoke('cert-pick-outdir'),
  generate:   (opts) => ipcRenderer.invoke('cert-generate', opts),
  openFolder: (dir) => ipcRenderer.invoke('cert-open-folder', dir),
});
