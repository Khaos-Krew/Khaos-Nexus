'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusAdmin', {
  state: () => ipcRenderer.invoke('nexus:state'),
  diagnostics: () => ipcRenderer.invoke('nexus:diagnostics'),
  exportDiagnostics: () => ipcRenderer.invoke('nexus:export-diagnostics'),
  restartBackend: () => ipcRenderer.invoke('nexus:restart-backend'),
  saveSettings: (settings) => ipcRenderer.invoke('nexus:save-settings', settings),
  setSecret: (name, value) => ipcRenderer.invoke('nexus:set-secret', name, value),
  clearSecret: (name) => ipcRenderer.invoke('nexus:clear-secret', name),
  openDataFolder: () => ipcRenderer.invoke('nexus:open-data-folder'),
  chooseThora: () => ipcRenderer.invoke('nexus:choose-thora'),
  launchThora: () => ipcRenderer.invoke('nexus:thora-launch')
});
