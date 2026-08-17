'use strict';

const electron = require('electron');
const {
  createMobileLoginRecord,
  verifyMobileLogin,
  publicMobileLogin
} = require('../shared/mobile-login.cjs');
const { issueDeviceCredential } = require('../shared/mobile-gateway.cjs');

let installed = false;
const LOGIN_RATE_LIMIT = 8;

function clean(value, max = 200, fallback = '') {
  return (String(value ?? '').replace(/\u0000/g, '').trim() || fallback).slice(0, max);
}

function remoteAddress(request) {
  return clean(String(request?.socket?.remoteAddress || '').replace(/^::ffff:/, ''), 120, 'unknown');
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosMobileLoginPatchedV1) return;

  class MobileLoginConfigStore extends Original {
    getMobileLoginRecord() {
      return this.secrets?.mobileLogin || null;
    }

    getMobileLoginPublic() {
      return publicMobileLogin(this.getMobileLoginRecord());
    }

    setMobileLoginCredentials(input = {}) {
      this.secrets = this.secrets || {};
      this.secrets.mobileLogin = createMobileLoginRecord(input, new Date());
      this.saveSecrets();
      return this.getMobileLoginPublic();
    }

    verifyMobileLoginCredentials(username, password) {
      return verifyMobileLogin(this.getMobileLoginRecord(), username, password);
    }
  }

  Object.defineProperty(MobileLoginConfigStore, '__khaosMobileLoginPatchedV1', { value: true });
  target.ConfigStore = MobileLoginConfigStore;
}

function patchGatewayRoute() {
  const target = require('./services/mobile-gateway-service.cjs');
  const prototype = target.MobileGatewayService?.prototype;
  if (!prototype || prototype.__khaosMobileLoginRoutePatchedV1) return;
  const original = prototype.route;

  prototype.route = async function mobileLoginRoute(request, response, url, body, requestId) {
    const method = String(request.method || 'GET').toUpperCase();
    if (method === 'POST' && url.pathname === '/v1/auth/login') {
      const remote = remoteAddress(request);
      if (!this.allow(`login:${remote}`, LOGIN_RATE_LIMIT)) {
        return this.fail(response, 429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again shortly.', requestId);
      }

      const login = this.configStore.getMobileLoginPublic?.() || { configured: false };
      if (!login.configured) {
        return this.fail(response, 503, 'LOGIN_NOT_CONFIGURED', 'Mobile account login has not been configured on the Nexus desktop.', requestId);
      }

      const input = this.json(body);
      const valid = this.configStore.verifyMobileLoginCredentials?.(input.username, input.password);
      if (!valid) {
        this.logger?.warn?.('Mobile account sign-in rejected.', { address: remote });
        return this.fail(response, 401, 'LOGIN_FAILED', 'The username or password is incorrect.', requestId);
      }

      const devices = this.config()?.devices || [];
      const activeDevices = devices.filter((device) => device.enabled !== false && !device.revokedAt);
      if (activeDevices.length >= 20) {
        return this.fail(response, 409, 'DEVICE_LIMIT', 'The trusted mobile device limit has been reached. Revoke an old device and try again.', requestId);
      }

      const issued = issueDeviceCredential({
        name: clean(input.deviceName, 80, 'Android device'),
        role: 'owner',
        publicKeyPem: clean(input.publicKeyPem, 5000)
      }, new Date(this.now()));

      this.configStore.upsertMobileDevice(issued.device);
      this.logger?.info?.('Mobile owner account sign-in approved.', {
        deviceId: issued.device.id,
        deviceName: issued.device.name,
        address: remote
      });
      this.emitState();

      return this.send(response, 200, {
        ok: true,
        credential: issued.credential,
        deviceId: issued.device.id,
        role: issued.device.role,
        certificateFingerprint: this.runtime.certificateFingerprint
      });
    }
    return original.call(this, request, response, url, body, requestId);
  };

  Object.defineProperty(prototype, '__khaosMobileLoginRoutePatchedV1', { value: true });
}

function mobileGatewayRefs() {
  try { return require('./mobile-gateway-extension.cjs').refs || {}; }
  catch { return {}; }
}

function assertOwner() {
  const refs = mobileGatewayRefs();
  try {
    if (refs.autonomy?.assertAccess) {
      refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', 'Change Mobile Companion login');
      return;
    }
  } catch (error) {
    throw error;
  }
  const role = refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'local-admin';
  if (!['owner', 'local-admin'].includes(role)) throw new Error('Changing Mobile Companion login requires Owner access.');
}

function registerIpc() {
  if (registerIpc.done) return;
  registerIpc.done = true;

  electron.ipcMain.handle('mobile-login:get', () => {
    const store = mobileGatewayRefs().configStore;
    if (!store) return { configured: false, username: '', updatedAt: null };
    return store.getMobileLoginPublic?.() || { configured: false, username: '', updatedAt: null };
  });

  electron.ipcMain.handle('mobile-login:set', (_event, input = {}) => {
    assertOwner();
    const refs = mobileGatewayRefs();
    if (!refs.configStore) throw new Error('Nexus configuration is not ready yet.');
    const result = refs.configStore.setMobileLoginCredentials(input);
    refs.logger?.info?.('Mobile Companion account login updated.', { username: result.username });
    return result;
  });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosMobileLoginUiPatchedV1) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedMobileLoginLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('script[src="mobile-login.js"]')) {
          const script = document.createElement('script');
          script.src = 'mobile-login.js';
          script.defer = true;
          document.body.appendChild(script);
        }
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosMobileLoginUiPatchedV1', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchGatewayRoute();
  patchBrowserLoader();
  electron.app.whenReady().then(registerIpc);
}

module.exports = { install, patchConfigStore, patchGatewayRoute, LOGIN_RATE_LIMIT };
