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

function install() {
  if (installed) return;
  installed = true;
  patchOwnerStateAccess();
  patchOneTimeCredentialDelivery();
}

module.exports = { install, patchOwnerStateAccess, patchOneTimeCredentialDelivery };
