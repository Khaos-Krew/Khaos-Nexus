'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('khaos', {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state:update', listener);
    return () => ipcRenderer.removeListener('state:update', listener);
  },
  onLog: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on('log:entry', listener);
    return () => ipcRenderer.removeListener('log:entry', listener);
  },
  onUpdate: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
  onDiscordAutomation: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('discord-automation:update', listener);
    return () => ipcRenderer.removeListener('discord-automation:update', listener);
  },
  onDiscordObservability: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('discord-observability:state', listener);
    return () => ipcRenderer.removeListener('discord-observability:state', listener);
  },
  onStatusPanels: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('status-panels:update', listener);
    return () => ipcRenderer.removeListener('status-panels:update', listener);
  }
});
