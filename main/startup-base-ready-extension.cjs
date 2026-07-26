'use strict';

const electron = require('electron');

const OPTIONAL_MODULE_GRACE_MS = 15000;
let installed = false;
let baseReadyObserved = false;
let featuresReadyObserved = false;
let fallbackTimer = null;

function clearFallbackTimer() {
  if (fallbackTimer) clearTimeout(fallbackTimer);
  fallbackTimer = null;
}

function emitFallbackReady(event) {
  if (featuresReadyObserved || !baseReadyObserved || electron.app.isQuitting) return;
  featuresReadyObserved = true;
  electron.ipcMain.emit('renderer-boot:stage', event || {}, {
    stage: 'features-ready',
    detail: {
      loaded: 0,
      baseInterfaceReady: true,
      optionalModulesContinuing: true,
      fallback: 'base-interface-grace-expired'
    },
    time: new Date().toISOString()
  });
  console.warn('[Khaos Nexus] Optional module completion was not reported in time; releasing the verified base interface.');
}

function observeStage(event, payload = {}) {
  const stage = String(payload?.stage || '');
  if (stage === 'features-ready') {
    featuresReadyObserved = true;
    clearFallbackTimer();
    return;
  }
  if (stage !== 'monitor-ready' || baseReadyObserved) return;
  baseReadyObserved = true;
  fallbackTimer = setTimeout(() => emitFallbackReady(event), OPTIONAL_MODULE_GRACE_MS);
  fallbackTimer.unref?.();
}

function install() {
  if (installed) return;
  installed = true;
  electron.ipcMain.on('renderer-boot:stage', observeStage);
  electron.app.on('before-quit', clearFallbackTimer);
}

module.exports = {
  OPTIONAL_MODULE_GRACE_MS,
  install,
  observeStage,
  emitFallbackReady
};
