'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusAdmin', {
  state: () => ipcRenderer.invoke('nexus:state'),
  startupHealth: () => ipcRenderer.invoke('nexus:startup-health'),
  diagnostics: () => ipcRenderer.invoke('nexus:diagnostics'),
  exportDiagnostics: () => ipcRenderer.invoke('nexus:export-diagnostics'),
  restartBackend: () => ipcRenderer.invoke('nexus:restart-backend'),
  saveSettings: (settings) => ipcRenderer.invoke('nexus:save-settings', settings),
  setSecret: (name, value) => ipcRenderer.invoke('nexus:set-secret', name, value),
  clearSecret: (name) => ipcRenderer.invoke('nexus:clear-secret', name),
  createAccountLinkCode: (role) => ipcRenderer.invoke('nexus:create-account-link-code', role),
  linkDiscordOAuth: (role) => ipcRenderer.invoke('nexus:link-discord-oauth', role),
  removeAccount: (accountId) => ipcRenderer.invoke('nexus:remove-account', accountId),
  validateProviders: (moduleId) => ipcRenderer.invoke('nexus:validate-providers', moduleId || ''),

  sentinalPair: (url, code) => ipcRenderer.invoke('nexus:sentinal-pair', url, code),
  sentinalStatus: () => ipcRenderer.invoke('nexus:sentinal-status'),
  sentinalPermissions: () => ipcRenderer.invoke('nexus:sentinal-permissions'),
  sentinalCommands: () => ipcRenderer.invoke('nexus:sentinal-commands'),
  sentinalChannels: (moduleId) => ipcRenderer.invoke('nexus:sentinal-channels', moduleId || ''),
  sentinalRoles: () => ipcRenderer.invoke('nexus:sentinal-roles'),
  sentinalScan: () => ipcRenderer.invoke('nexus:sentinal-scan'),
  sentinalSyncCommands: () => ipcRenderer.invoke('nexus:sentinal-sync-commands'),
  sentinalReconcileChannels: (moduleId) => ipcRenderer.invoke('nexus:sentinal-reconcile-channels', moduleId || ''),
  sentinalRefreshConsoles: (moduleId) => ipcRenderer.invoke('nexus:sentinal-refresh-consoles', moduleId || ''),
  sentinalReconcileRoles: () => ipcRenderer.invoke('nexus:sentinal-reconcile-roles'),
  sentinalProviderConfig: () => ipcRenderer.invoke('nexus:sentinal-provider-config'),
  sentinalSyncProviders: () => ipcRenderer.invoke('nexus:sentinal-sync-providers'),
  sentinalValidateProvider: (moduleId) => ipcRenderer.invoke('nexus:sentinal-validate-provider', moduleId || ''),
  sentinalRepair: () => ipcRenderer.invoke('nexus:sentinal-repair'),

  ownerTest: () => ipcRenderer.invoke('nexus:owner-test'),
  setOwnerTestFeedback: (version, itemId, status, note) => ipcRenderer.invoke('nexus:owner-test-feedback', version, itemId, status, note || ''),

  updateStatus: () => ipcRenderer.invoke('nexus:update-status'),
  checkForUpdate: () => ipcRenderer.invoke('nexus:update-check'),
  prepareUpdate: () => ipcRenderer.invoke('nexus:update-prepare'),
  restartToApplyUpdate: () => ipcRenderer.invoke('nexus:update-restart'),
  openDataFolder: () => ipcRenderer.invoke('nexus:open-data-folder'),
  chooseThora: () => ipcRenderer.invoke('nexus:choose-thora'),
  launchThora: () => ipcRenderer.invoke('nexus:thora-launch')
});