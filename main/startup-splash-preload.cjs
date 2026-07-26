'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function heartbeat() {
  ipcRenderer.invoke('stability:heartbeat').catch(() => {});
}

heartbeat();
const heartbeatTimer = setInterval(heartbeat, 2000);
process.once('exit', () => clearInterval(heartbeatTimer));

contextBridge.exposeInMainWorld('khaosStartup', {
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('startup-splash:state', listener);
    ipcRenderer.invoke('startup-splash:get-state').then(callback).catch(() => {});
    return () => ipcRenderer.removeListener('startup-splash:state', listener);
  },
  retry: () => ipcRenderer.invoke('startup-splash:retry'),
  openOffline: () => ipcRenderer.invoke('startup-splash:open-offline'),
  openLogs: () => ipcRenderer.invoke('startup-splash:open-logs'),
  exit: () => ipcRenderer.invoke('startup-splash:exit')
});
