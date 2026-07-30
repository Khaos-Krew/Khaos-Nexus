'use strict';

const electron = require('electron');
const {
  normalizeMobileGatewayConfig,
  normalizeDevice,
  revokeDevice
} = require('../shared/mobile-gateway.cjs');
const { MobileGatewayService } = require('./services/mobile-gateway-service.cjs');

const refs = {
  configStore: null,
  logger: null,
  autonomy: null,
  discordAuth: null,
  supervisor: null,
  updateService: null,
  applicationMonitor: null,
  service: null
};
let installed = false;
let serviceStarting = null;

function ensureConfig(store) {
  if (!store?.config) return;
  const current = store.config.mobileGateway;
  const normalized = normalizeMobileGatewayConfig(current || {});
  const changed = JSON.stringify(current || null) !== JSON.stringify(normalized);
  store.config.mobileGateway = normalized;
  if (changed) store.saveConfig();
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosMobileGatewayPatchedV2) return;

  class MobileGatewayConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureConfig(this);
      ensureService();
    }

    getMobileGateway() {
      ensureConfig(this);
      return JSON.parse(JSON.stringify(this.config.mobileGateway));
    }

    updateMobileGatewaySettings(input = {}) {
      ensureConfig(this);
      const current = this.config.mobileGateway;
      this.config.mobileGateway = normalizeMobileGatewayConfig({
        ...current,
        enabled: input.enabled ?? current.enabled,
        port: input.port ?? current.port,
        remoteAccessMode: input.remoteAccessMode ?? current.remoteAccessMode,
        allowLanPairing: input.allowLanPairing ?? current.allowLanPairing,
        requireBiometricForOwnerActions: input.requireBiometricForOwnerActions ?? current.requireBiometricForOwnerActions,
        devices: current.devices
      });
      this.saveConfig();
      return this.getMobileGateway();
    }

    upsertMobileDevice(input) {
      ensureConfig(this);
      const device = normalizeDevice(input);
      const list = this.config.mobileGateway.devices;
      const index = list.findIndex((item) => item.id === device.id);
      if (index >= 0) list[index] = device;
      else list.push(device);
      this.config.mobileGateway = normalizeMobileGatewayConfig(this.config.mobileGateway);
      this.saveConfig();
      return device;
    }

    touchMobileDevice(id, patch = {}) {
      ensureConfig(this);
      const index = this.config.mobileGateway.devices.findIndex((device) => device.id === String(id || ''));
      if (index < 0) return null;
      const current = this.config.mobileGateway.devices[index];
      this.config.mobileGateway.devices[index] = normalizeDevice({
        ...current,
        lastSeenAt: patch.lastSeenAt || current.lastSeenAt,
        lastAddress: patch.lastAddress || current.lastAddress
      });
      this.saveConfig();
      return this.config.mobileGateway.devices[index];
    }

    revokeMobileDevice(id) {
      ensureConfig(this);
      const index = this.config.mobileGateway.devices.findIndex((device) => device.id === String(id || ''));
      if (index < 0) throw new Error('The selected mobile device was not found.');
      this.config.mobileGateway.devices[index] = revokeDevice(this.config.mobileGateway.devices[index]);
      this.saveConfig();
      return this.getMobileGateway();
    }

    removeMobileDevice(id) {
      ensureConfig(this);
      const value = String(id || '');
      this.config.mobileGateway.devices = this.config.mobileGateway.devices.filter((device) => device.id !== value);
      this.saveConfig();
      return this.getMobileGateway();
    }

    revokeAllMobileDevices() {
      ensureConfig(this);
      this.config.mobileGateway.devices = this.config.mobileGateway.devices.map((device) => revokeDevice(device));
      this.saveConfig();
      return this.getMobileGateway();
    }
  }

  Object.defineProperty(MobileGatewayConfigStore, '__khaosMobileGatewayPatchedV2', { value: true });
  target.ConfigStore = MobileGatewayConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original[`__khaosMobileGatewayCapture_${refName}`]) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      ensureService();
    }
  }
  Object.defineProperty(Captured, `__khaosMobileGatewayCapture_${refName}`, { value: true });
  target[exportName] = Captured;
}

function activeRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'local-admin'; }
  catch { return 'local-admin'; }
}

function assertAccess(role, action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), role, action);
  const rank = { locked: 0, viewer: 1, operator: 2, owner: 3, 'local-admin': 4 };
  if ((rank[activeRole()] || 0) < (rank[role] || 0)) throw new Error(`${action} requires ${role} access.`);
  return true;
}

function statusPanelService() {
  try { return require('./status-panels-extension.cjs').refs?.service || null; }
  catch { return null; }
}

function readyForService() {
  return refs.configStore && refs.logger && refs.autonomy && refs.supervisor && refs.updateService;
}

function ensureService() {
  if (refs.service || !readyForService()) return refs.service;
  refs.service = new MobileGatewayService({
    dataDirectory: electron.app.getPath('userData'),
    configStore: refs.configStore,
    logger: refs.logger,
    supervisor: refs.supervisor,
    updateService: refs.updateService,
    autonomy: refs.autonomy,
    applicationMonitor: refs.applicationMonitor,
    appVersion: electron.app.getVersion(),
    getStatusPanelService: statusPanelService
  });
  refs.service.on('state', () => broadcast());
  if (!serviceStarting) {
    serviceStarting = refs.service.applyConfig().catch((error) => {
      refs.logger?.error?.('Mobile Gateway initial reconciliation failed.', { message: error.message });
    }).finally(() => { serviceStarting = null; });
  }
  return refs.service;
}

function mobilePayload() {
  const service = ensureService();
  return {
    role: activeRole(),
    gateway: service ? service.publicState() : null,
    plan: {
      version: 'phase-1',
      apkReady: true,
      currentPhase: 'HTTPS gateway and read-only Android companion',
      nextPhase: 'Safe Operator actions',
      issueNumber: 13
    }
  };
}

function broadcast() {
  if (!refs.configStore) return;
  const payload = mobilePayload();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('mobile-gateway:update', payload);
  }
}

function registerIpc() {
  if (registerIpc.done || !readyForService()) return;
  registerIpc.done = true;

  electron.ipcMain.handle('mobile-gateway:get', () => {
    assertAccess('viewer', 'View Mobile Companion settings');
    return mobilePayload();
  });

  electron.ipcMain.handle('mobile-gateway:save-settings', async (_event, input = {}) => {
    assertAccess('owner', 'Change Mobile Companion settings');
    refs.configStore.updateMobileGatewaySettings(input);
    await ensureService().applyConfig();
    refs.logger?.info?.('Mobile Companion gateway settings saved.', {
      enabled: refs.configStore.getMobileGateway().enabled,
      port: refs.configStore.getMobileGateway().port,
      remoteAccessMode: refs.configStore.getMobileGateway().remoteAccessMode,
      allowLanPairing: refs.configStore.getMobileGateway().allowLanPairing
    });
    broadcast();
    return mobilePayload();
  });

  electron.ipcMain.handle('mobile-gateway:create-pairing', async (_event, input = {}) => {
    assertAccess('owner', 'Create Android device pairing');
    await ensureService().createPairing(input.requestedRole || 'viewer');
    broadcast();
    return mobilePayload();
  });

  electron.ipcMain.handle('mobile-gateway:cancel-pairing', () => {
    assertAccess('owner', 'Cancel Android device pairing');
    ensureService().cancelPairing();
    broadcast();
    return mobilePayload();
  });

  electron.ipcMain.handle('mobile-gateway:approve-pairing', (_event, requestId) => {
    assertAccess('owner', 'Approve Android device pairing');
    ensureService().approvePairing(requestId);
    broadcast();
    return mobilePayload();
  });

  electron.ipcMain.handle('mobile-gateway:reject-pairing', (_event, input = {}) => {
    assertAccess('owner', 'Reject Android device pairing');
    ensureService().rejectPairing(input.requestId, input.reason);
    broadcast();
    return mobilePayload();
  });

  electron.ipcMain.handle('mobile-gateway:revoke-device', (_event, id) => {
    assertAccess('owner', 'Revoke Android companion devices');
    refs.configStore.revokeMobileDevice(id);
    ensureService().revokeDevice(id);
    refs.logger?.warn?.('Mobile Companion device revoked.', { deviceId: String(id || '') });
    broadcast();
    return mobilePayload();
  });

  electron.ipcMain.handle('mobile-gateway:remove-device', (_event, id) => {
    assertAccess('owner', 'Remove Android companion devices');
    refs.configStore.removeMobileDevice(id);
    ensureService().removeDevice(id);
    refs.logger?.warn?.('Mobile Companion device record removed.', { deviceId: String(id || '') });
    broadcast();
    return mobilePayload();
  });

  electron.ipcMain.handle('mobile-gateway:regenerate-certificate', async (_event, confirmation) => {
    assertAccess('owner', 'Regenerate the Mobile Gateway certificate');
    if (String(confirmation || '').trim().toUpperCase() !== 'ROTATE MOBILE CERTIFICATE') {
      throw new Error('Type ROTATE MOBILE CERTIFICATE to confirm certificate rotation. Existing phones must pair again.');
    }
    await ensureService().regenerateCertificate();
    broadcast();
    return mobilePayload();
  });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosMobileGatewayUiPatchedV2) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedMobileLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="mobile-companion.css"]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'mobile-companion.css'; document.head.appendChild(link); }
        if (!document.querySelector('script[src="mobile-companion.js"]')) { const script = document.createElement('script'); script.src = 'mobile-companion.js'; script.defer = true; document.body.appendChild(script); }
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosMobileGatewayUiPatchedV2', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/bot-supervisor.cjs', 'BotSupervisor', 'supervisor');
  captureClass('./services/update-service.cjs', 'UpdateService', 'updateService');
  captureClass('./services/application-monitor.cjs', 'ApplicationMonitor', 'applicationMonitor');
  patchBrowserLoader();
  electron.app.whenReady().then(() => {
    const wait = () => {
      if (readyForService()) {
        ensureService();
        registerIpc();
      } else setTimeout(wait, 100);
    };
    wait();
  });
  electron.app.on('before-quit', () => { refs.service?.destroy?.().catch?.(() => {}); });
}

module.exports = { install, refs, ensureConfig, ensureService, mobilePayload };
