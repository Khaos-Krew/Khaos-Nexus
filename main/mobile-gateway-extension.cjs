'use strict';

const electron = require('electron');
const {
  normalizeMobileGatewayConfig,
  createPairingSession,
  publicPairingSession,
  publicMobileGatewayState,
  revokeDevice
} = require('../shared/mobile-gateway.cjs');

const refs = { configStore: null, logger: null, autonomy: null, discordAuth: null };
let installed = false;
let pairingSession = null;

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
  if (!Original || Original.__khaosMobileGatewayPatched) return;

  class MobileGatewayConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureConfig(this);
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
        enabled: false,
        port: input.port ?? current.port,
        remoteAccessMode: input.remoteAccessMode ?? current.remoteAccessMode,
        allowLanPairing: input.allowLanPairing ?? current.allowLanPairing,
        requireBiometricForOwnerActions: input.requireBiometricForOwnerActions ?? current.requireBiometricForOwnerActions,
        devices: current.devices
      });
      this.saveConfig();
      return this.getMobileGateway();
    }

    revokeMobileDevice(id) {
      ensureConfig(this);
      const value = String(id || '');
      const index = this.config.mobileGateway.devices.findIndex((device) => device.id === value);
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
  }

  Object.defineProperty(MobileGatewayConfigStore, '__khaosMobileGatewayPatched', { value: true });
  target.ConfigStore = MobileGatewayConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosMobileGatewayCapturePatched) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
    }
  }
  Object.defineProperty(Captured, '__khaosMobileGatewayCapturePatched', { value: true });
  target[exportName] = Captured;
}

function activeRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'local-admin'; }
  catch { return 'local-admin'; }
}

function assertAccess(role, action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), role, action);
  const rank = { locked: 0, viewer: 1, operator: 2, owner: 3, 'local-admin': 3 };
  if ((rank[activeRole()] || 0) < (rank[role] || 0)) throw new Error(`${action} requires ${role} access.`);
  return true;
}

function expirePairingSession() {
  if (pairingSession && new Date(pairingSession.expiresAt).getTime() <= Date.now()) pairingSession = null;
}

function mobilePayload() {
  expirePairingSession();
  return {
    role: activeRole(),
    gateway: publicMobileGatewayState(refs.configStore.getMobileGateway(), pairingSession),
    plan: {
      version: 'foundation',
      apkReady: false,
      currentPhase: 'Desktop security and pairing contract',
      nextPhase: 'HTTPS gateway and read-only Android Compose client',
      issueNumber: 13
    }
  };
}

function broadcast(payload) {
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('mobile-gateway:update', payload);
  }
}

function registerIpc() {
  if (registerIpc.done || !refs.configStore) return;
  registerIpc.done = true;

  electron.ipcMain.handle('mobile-gateway:get', () => {
    assertAccess('viewer', 'View Mobile Companion settings');
    return mobilePayload();
  });

  electron.ipcMain.handle('mobile-gateway:save-settings', (_event, input = {}) => {
    assertAccess('owner', 'Change Mobile Companion settings');
    refs.configStore.updateMobileGatewaySettings(input);
    refs.logger?.info?.('Mobile Companion foundation settings saved.', {
      port: refs.configStore.getMobileGateway().port,
      remoteAccessMode: refs.configStore.getMobileGateway().remoteAccessMode,
      transportReady: false
    });
    const payload = mobilePayload();
    broadcast(payload);
    return payload;
  });

  electron.ipcMain.handle('mobile-gateway:preview-pairing', (_event, input = {}) => {
    assertAccess('owner', 'Preview Android device pairing');
    pairingSession = createPairingSession({ requestedRole: input.requestedRole });
    refs.logger?.info?.('Mobile Companion pairing preview created.', {
      pairingSessionId: pairingSession.id,
      requestedRole: pairingSession.requestedRole,
      expiresAt: pairingSession.expiresAt,
      transportReady: false
    });
    const payload = mobilePayload();
    broadcast(payload);
    return payload;
  });

  electron.ipcMain.handle('mobile-gateway:cancel-pairing', () => {
    assertAccess('owner', 'Cancel Android device pairing');
    pairingSession = null;
    const payload = mobilePayload();
    broadcast(payload);
    return payload;
  });

  electron.ipcMain.handle('mobile-gateway:revoke-device', (_event, id) => {
    assertAccess('owner', 'Revoke Android companion devices');
    refs.configStore.revokeMobileDevice(id);
    refs.logger?.warn?.('Mobile Companion device revoked.', { deviceId: String(id || '') });
    const payload = mobilePayload();
    broadcast(payload);
    return payload;
  });

  electron.ipcMain.handle('mobile-gateway:remove-device', (_event, id) => {
    assertAccess('owner', 'Remove Android companion devices');
    refs.configStore.removeMobileDevice(id);
    refs.logger?.warn?.('Mobile Companion device record removed.', { deviceId: String(id || '') });
    const payload = mobilePayload();
    broadcast(payload);
    return payload;
  });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosMobileGatewayUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="mobile-companion.css"]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'mobile-companion.css'; document.head.appendChild(link); }
        if (!document.querySelector('script[src="mobile-companion.js"]')) { const script = document.createElement('script'); script.src = 'mobile-companion.js'; script.defer = true; document.body.appendChild(script); }
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosMobileGatewayUiPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  patchBrowserLoader();
  electron.app.whenReady().then(() => {
    const wait = () => {
      if (refs.configStore) registerIpc();
      else setTimeout(wait, 100);
    };
    wait();
  });
}

module.exports = { install, refs, ensureConfig, publicPairingSession };
