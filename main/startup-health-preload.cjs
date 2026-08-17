'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(callback) {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on('startup-health:update', listener);
  return () => ipcRenderer.removeListener('startup-health:update', listener);
}

contextBridge.exposeInMainWorld('khaosStartup', {
  getState: () => ipcRenderer.invoke('startup-health:get'),
  getMeta: () => ipcRenderer.invoke('startup-hud:meta'),
  retry: () => ipcRenderer.invoke('startup-health:retry'),
  continueLimited: () => ipcRenderer.invoke('startup-health:continue-limited'),
  openDataFolder: () => ipcRenderer.invoke('startup-health:open-data'),
  onState: subscribe
});
