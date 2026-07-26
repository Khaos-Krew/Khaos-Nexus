'use strict';

const path = require('node:path');
const electron = require('electron');

const OPTIONAL_MODULE_GRACE_MS = 15 * 1000;
let installed = false;

function preloadName(window) {
  try {
    const preferences = window?.webContents?.getLastWebPreferences?.() || {};
    return path.basename(String(preferences.preload || ''));
  } catch {
    return '';
  }
}

function isMainInterfaceWindow(window) {
  return preloadName(window) === 'preload.cjs';
}

function installVerifiedReleaseSignal(window) {
  if (!isMainInterfaceWindow(window) || window.__khaosStartupReleaseFallbackInstalled) return;
  window.__khaosStartupReleaseFallbackInstalled = true;
  const webContents = window.webContents;
  const webContentsId = webContents.id;

  webContents.once('did-finish-load', () => {
    if (window.isDestroyed() || webContents.isDestroyed() || webContents.id !== webContentsId) return;
    webContents.executeJavaScript(`(() => {
      if (window.__khaosVerifiedReleaseFallbackInstalled) return;
      window.__khaosVerifiedReleaseFallbackInstalled = true;
      const OPTIONAL_MODULE_GRACE_MS = ${OPTIONAL_MODULE_GRACE_MS};

      async function verifyBaseInterface() {
        try {
          if (!window.khaos || typeof window.khaos.invoke !== 'function' || typeof window.khaos.reportBootStage !== 'function') {
            throw new Error('The protected main renderer bridge is unavailable.');
          }
          const [appState, logs] = await Promise.all([
            window.khaos.invoke('app:get-state'),
            window.khaos.invoke('logs:get', 1)
          ]);
          const version = appState?.app?.version || null;
          const serverCount = Array.isArray(appState?.config?.servers) ? appState.config.servers.length : 0;
          window.khaos.reportBootStage('base-ui-ready', {
            version,
            serverCount,
            logsReadable: Array.isArray(logs),
            verifiedAt: new Date().toISOString()
          });
          window.setTimeout(() => {
            window.khaos.reportBootStage('features-ready', {
              loaded: 1,
              fallback: true,
              baseInterfaceVerified: true,
              optionalModulesContinue: true,
              graceMs: OPTIONAL_MODULE_GRACE_MS
            });
          }, OPTIONAL_MODULE_GRACE_MS);
        } catch (error) {
          window.khaos?.reportBootStage?.('feature-failed', {
            source: 'base-interface-verification',
            message: error.message || String(error),
            critical: true
          });
          window.khaos?.reportRendererActionError?.({
            source: 'startup-release',
            channel: 'startup-release:verify-base-ui',
            operation: 'verify-base-interface',
            message: error.message || String(error),
            stack: error.stack || ''
          });
        }
      }

      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', verifyBaseInterface, { once: true });
      } else {
        verifyBaseInterface();
      }
    })();`).catch((error) => {
      console.error('[Khaos Nexus] Could not install the verified startup release fallback.', error);
    });
  });
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosStartupReleaseFallbackPatched) return;
  const original = prototype.loadFile;

  prototype.loadFile = function patchedLoadFile(...args) {
    installVerifiedReleaseSignal(this);
    return original.apply(this, args);
  };

  Object.defineProperty(prototype, '__khaosStartupReleaseFallbackPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchBrowserLoader();
  electron.app.on('browser-window-created', (_event, window) => installVerifiedReleaseSignal(window));
}

module.exports = {
  OPTIONAL_MODULE_GRACE_MS,
  preloadName,
  isMainInterfaceWindow,
  installVerifiedReleaseSignal,
  patchBrowserLoader,
  install
};
