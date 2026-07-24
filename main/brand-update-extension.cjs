'use strict';

const electron = require('electron');
const { runUpdateFlow } = require('../shared/update-flow.cjs');

const refs = { configStore: null, updateService: null, autonomy: null, logger: null, discordAuth: null };
let installed = false;
let updateApplyPromise = null;

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
        const addStyle = (href) => {
          if (document.querySelector('link[href="' + href + '"]')) return;
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = href;
          document.head.appendChild(link);
        };
        const addScript = (src) => {
          if (document.querySelector('script[src="' + src + '"]')) return;
          const script = document.createElement('script');
          script.src = src;
          script.async = false;
          document.body.appendChild(script);
        };
        addStyle('brand-ui.css');
        addStyle('ui-fixes.css');
        addScript('brand-ui.js');
        addScript('simple-updater.js');
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

  electron.ipcMain.handle('update:apply', () => {
    refs.autonomy?.assertAccess?.(refs.discordAuth?.getState?.(), 'owner', 'Update and restart Khaos Nexus');
    if (!refs.updateService) throw new Error('The Khaos Nexus update service is not ready.');
    if (updateApplyPromise) return updateApplyPromise;
    updateApplyPromise = runUpdateFlow(refs.updateService)
      .finally(() => { updateApplyPromise = null; });
    return updateApplyPromise;
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchUpdateService();
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  patchBrowserLoader();
  electron.app.whenReady().then(() => setImmediate(registerIpc));
}

module.exports = { install, refs };
