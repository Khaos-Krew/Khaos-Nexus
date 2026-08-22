'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusAdmin', {
  state: () => ipcRenderer.invoke('nexus:state'),
  diagnostics: () => ipcRenderer.invoke('nexus:diagnostics'),
  launchThora: () => ipcRenderer.invoke('nexus:thora-launch')
});
