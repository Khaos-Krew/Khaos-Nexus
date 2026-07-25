'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function sendRendererHeartbeat() {
  ipcRenderer.invoke('stability:heartbeat').catch(() => {});
}

sendRendererHeartbeat();
const rendererHeartbeatTimer = setInterval(sendRendererHeartbeat, 2000);

process.once('exit', () => clearInterval(rendererHeartbeatTimer));

function subscribe(channel, callback) {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('khaos', {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  reportBootStage: (stage, detail = {}) => ipcRenderer.send('renderer-boot:stage', {
    stage: String(stage || 'unknown').slice(0, 80),
    detail: detail && typeof detail === 'object' ? detail : {},
    time: new Date().toISOString()
  }),
  onState: (callback) => subscribe('state:update', callback),
  onLog: (callback) => subscribe('log:entry', callback),
  onUpdate: (callback) => subscribe('update:state', callback),
  onDiscordAutomation: (callback) => subscribe('discord-automation:update', callback),
  onDiscordObservability: (callback) => subscribe('discord-observability:state', callback),
  onStatusPanels: (callback) => subscribe('status-panels:update', callback),
  onServerScheduler: (callback) => subscribe('server-scheduler:update', callback),
  onPlayerConsole: (callback) => subscribe('player-console:update', callback)
});
