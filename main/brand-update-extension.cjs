'use strict';

const electron = require('electron');

const refs = { configStore: null, updateService: null, autonomy: null, logger: null };
let installed = false;

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosBrandUpdatePatched) return;

  class BrandConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
    }

    setGeneral(payload) {
      const result = super.setGeneral(payload);
      if (Object.prototype.hasOwnProperty.call(payload || {}, 'checkUpdates')) {
        refs.updateService?.configureAutomaticChecks(Boolean(this.getConfig().general.checkUpdates));
      }
      return result;
    }
  }

  Object.defineProperty(BrandConfigStore, '__khaosBrandUpdatePatched', { value: true });
  target.ConfigStore = BrandConfigStore;
}

function patchUpdateService() {
  const target = require('./services/update-service.cjs');
  const Original = target.UpdateService;
  if (!Original || Original.__khaosBrandUpdatePatched) return;

  class BrandUpdateService extends Original {
    constructor(...args) {
      super(...args);
      refs.updateService = this;
      const enabled = Boolean(refs.configStore?.getConfig?.().general?.checkUpdates);
      this.configureAutomaticChecks(enabled);
    }

    install() {
      try {
        refs.autonomy?.createAutomaticBackup?.('pre-update');
      } catch (error) {
        refs.logger?.warn?.('Could not create the pre-update backup.', { message: error.message });
      }
      return super.install();
    }
  }

  Object.defineProperty(BrandUpdateService, '__khaosBrandUpdatePatched', { value: true });
  target.UpdateService = BrandUpdateService;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosBrandCapturePatched) return;

  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
    }
  }

  Object.defineProperty(Captured, '__khaosBrandCapturePatched', { value: true });
  target[exportName] = Captured;
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosBrandUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="brand-ui.css"]')) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'brand-ui.css';
          document.head.appendChild(link);
        }
        if (!document.querySelector('script[src="brand-ui.js"]')) {
          const script = document.createElement('script');
          script.src = 'brand-ui.js';
          script.defer = true;
          document.body.appendChild(script);
        }
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosBrandUiPatched', { value: true });
}

function registerIpc() {
  if (registerIpc.done) return;
  registerIpc.done = true;

  electron.ipcMain.handle('update:open-release', async (_event, url) => {
    const target = String(url || refs.updateService?.getState?.().releaseUrl || 'https://github.com/Khaos-Krew/Khaos-Nexus/releases');
    if (!/^https:\/\/github\.com\/Khaos-Krew\/Khaos-Nexus\/releases(?:\/|$)/i.test(target)) {
      throw new Error('The update release URL was not trusted.');
    }
    await electron.shell.openExternal(target);
    return { opened: true, url: target };
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchUpdateService();
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  patchBrowserLoader();
  electron.app.whenReady().then(() => setImmediate(registerIpc));
}

module.exports = { install, refs };
