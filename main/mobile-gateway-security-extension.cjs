'use strict';

const electron = require('electron');
let installed = false;

function patchOwnerStateAccess() {
  const ipcMain = electron.ipcMain;
  if (!ipcMain || ipcMain.__khaosMobileOwnerStatePatched) return;
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = function mobileOwnerAwareHandle(channel, listener) {
    if (channel !== 'mobile-gateway:get') return originalHandle(channel, listener);
    return originalHandle(channel, (event, ...args) => {
      const refs = require('./mobile-gateway-extension.cjs').refs;
      if (refs.autonomy?.assertAccess) refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', 'View Mobile Companion pairing and device state');
      return listener(event, ...args);
    });
  };
  Object.defineProperty(ipcMain, '__khaosMobileOwnerStatePatched', { value: true });
}

function patchOneTimeCredentialDelivery() {
  const prototype = require('./services/mobile-gateway-service.cjs').MobileGatewayService?.prototype;
  if (!prototype || prototype.__khaosMobileOneTimeDeliveryPatched) return;
  const originalRoute = prototype.route;
  prototype.route = async function oneTimePairingRoute(request, response, url, body, requestId) {
    const pairingCompletion = String(request?.method || '').toUpperCase() === 'POST' && url?.pathname === '/v1/pairing/complete';
    const deliverable = pairingCompletion && this.pendingPairing?.status === 'approved' && this.delivery;
    const result = await originalRoute.call(this, request, response, url, body, requestId);
    if (deliverable && response.statusCode === 200) {
      const deliveredAt = new Date(this.now()).toISOString();
      this.pendingPairing = { ...this.pendingPairing, deliveredAt };
      this.delivery = null;
      this.pairingSession = null;
      this.runtime.qrDataUrl = '';
      this.runtime.pairingUri = '';
      this.emitState();
    }
    return result;
  };
  Object.defineProperty(prototype, '__khaosMobileOneTimeDeliveryPatched', { value: true });
}

function reconcileGatewaySoon() {
  queueMicrotask(() => {
    const extension = require('./mobile-gateway-extension.cjs');
    const service = extension.ensureService?.();
    Promise.resolve(service?.applyConfig?.()).catch((error) => {
      extension.refs?.logger?.warn?.('Mobile Gateway module reconciliation failed.', { message: String(error?.message || error) });
    });
  });
}

function patchImmediateModuleReconciliation() {
  const prototype = require('./services/config-store.cjs').ConfigStore?.prototype;
  if (!prototype || prototype.__khaosMobileModuleReconcilePatched) return;

  if (typeof prototype.setModuleState === 'function') {
    const originalSetModuleState = prototype.setModuleState;
    prototype.setModuleState = function mobileAwareSetModuleState(id, ...args) {
      const result = originalSetModuleState.call(this, id, ...args);
      if (String(id || '') === 'mobile-gateway') reconcileGatewaySoon();
      return result;
    };
  }

  if (typeof prototype.setModuleBulkMode === 'function') {
    const originalSetModuleBulkMode = prototype.setModuleBulkMode;
    prototype.setModuleBulkMode = function mobileAwareBulkMode(...args) {
      const result = originalSetModuleBulkMode.apply(this, args);
      reconcileGatewaySoon();
      return result;
    };
  }

  Object.defineProperty(prototype, '__khaosMobileModuleReconcilePatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchOwnerStateAccess();
  patchOneTimeCredentialDelivery();
  patchImmediateModuleReconciliation();
}

module.exports = {
  install,
  patchOwnerStateAccess,
  patchOneTimeCredentialDelivery,
  patchImmediateModuleReconciliation
};
