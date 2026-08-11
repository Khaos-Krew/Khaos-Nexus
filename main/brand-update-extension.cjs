'use strict';

const electron = require('electron');
const { runUpdateFlow } = require('../shared/update-flow.cjs');
const { hardwareRenderingRequested } = require('./software-rendering-extension.cjs');

const refs = { configStore: null, updateService: null, autonomy: null, logger: null, discordAuth: null };
let installed = false;
let updateApplyPromise = null;

function normalizeUpdateChannel(value) {
  return String(value || '').toLowerCase() === 'test' ? 'test' : 'stable';
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosBrandUpdatePatched) return;

  class BrandConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      const normalized = normalizeUpdateChannel(this.config?.general?.updateChannel);
      if (this.config.general.updateChannel !== normalized) {
        this.config.general.updateChannel = normalized;
        this.saveConfig();
      }
    }

    setGeneral(payload) {
      const input = { ...(payload || {}) };
      if (Object.prototype.hasOwnProperty.call(input, 'updateChannel')) {
        const raw = String(input.updateChannel || '').toLowerCase();
        if (!['stable', 'test'].includes(raw)) throw new Error('Update channel must be stable or test.');
        input.updateChannel = raw;
      }
      const result = super.setGeneral(input);
      if (Object.prototype.hasOwnProperty.call(input, 'checkUpdates')) {
        refs.updateService?.configureAutomaticChecks(Boolean(this.getConfig().general.checkUpdates));
      }
      if (Object.prototype.hasOwnProperty.call(input, 'updateChannel')) {
        refs.updateService?.setUpdateChannel?.(input.updateChannel);
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
  const { cleanVersion, compareVersions, normalizeReleaseNotes } = target;

  class BrandUpdateService extends Original {
    constructor(...args) {
      super(...args);
      refs.updateService = this;
      this.updateChannel = 'stable';
      this.setUpdateChannel(refs.configStore?.getConfig?.().general?.updateChannel || 'stable', { reset: false });
      const enabled = Boolean(refs.configStore?.getConfig?.().general?.checkUpdates);
      this.configureAutomaticChecks(enabled);
      this.set({
        backupStatus: 'idle',
        backupPath: null,
        backupCreatedAt: null
      });
    }

    setUpdateChannel(value, options = {}) {
      const channel = normalizeUpdateChannel(value);
      const changed = channel !== this.updateChannel;
      this.updateChannel = channel;
      if (this.mode === 'installed') {
        this.updater.channel = channel === 'test' ? 'beta' : 'latest';
        this.updater.allowPrerelease = channel === 'test';
        this.updater.allowDowngrade = channel === 'test';
      }
      if (changed || options.reset !== false) {
        this.releaseAsset = null;
        this.stagedPath = null;
        this.set({
          updateChannel: channel,
          status: this.mode === 'development' ? 'development' : 'idle',
          version: null,
          progress: null,
          error: null,
          canDownload: false,
          canInstall: false,
          verified: false
        });
      } else {
        this.set({ updateChannel: channel });
      }
      refs.logger?.info?.('Khaos Nexus update channel configured.', { channel });
      return this.getState();
    }

    async checkPortableRelease() {
      if (this.updateChannel !== 'test') return super.checkPortableRelease();
      if (typeof this.fetchImpl !== 'function') throw new Error('Network access is unavailable for the portable test-channel update check.');

      const response = await this.fetchImpl('https://api.github.com/repos/Khaos-Krew/Khaos-Nexus/releases?per_page=30', {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': `Khaos-Nexus/${this.state.currentVersion}`
        }
      });
      if (!response.ok) throw new Error(`GitHub test-channel release check failed with status ${response.status}.`);
      const releases = await response.json();
      const release = (Array.isArray(releases) ? releases : []).find((item) => {
        if (!item || item.draft || !item.prerelease) return false;
        const version = cleanVersion(item.tag_name || item.name);
        return version && compareVersions(version, this.state.currentVersion) > 0;
      });

      if (!release) {
        this.releaseAsset = null;
        this.set({
          status: 'current',
          version: this.state.currentVersion,
          releaseName: 'No newer test build published',
          releaseNotes: '',
          releaseUrl: null,
          publishedAt: null,
          lastCheckedAt: new Date().toISOString(),
          canDownload: false,
          canInstall: false,
          error: null,
          updateChannel: 'test'
        });
        return this.getState();
      }

      const latestVersion = cleanVersion(release.tag_name || release.name);
      const expectedName = `Khaos-Nexus-Portable-${latestVersion}-x64.exe`.toLowerCase();
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const asset = assets.find((item) => String(item.name || '').toLowerCase() === expectedName)
        || assets.find((item) => /khaos-nexus-portable-.*-x64\.exe$/i.test(String(item.name || '')));
      if (!asset?.browser_download_url) throw new Error(`Test release v${latestVersion} is live, but its portable Windows executable is missing.`);

      this.releaseAsset = {
        name: asset.name,
        url: asset.browser_download_url,
        size: Number(asset.size) || null,
        digest: String(asset.digest || ''),
        version: latestVersion
      };
      this.set({
        status: 'available',
        version: latestVersion,
        releaseName: release.name || `Khaos Nexus v${latestVersion}`,
        releaseNotes: normalizeReleaseNotes(release.body),
        releaseUrl: release.html_url || null,
        publishedAt: release.published_at || null,
        lastCheckedAt: new Date().toISOString(),
        canDownload: true,
        canInstall: false,
        verified: false,
        progress: null,
        error: null,
        updateChannel: 'test'
      });
      return this.getState();
    }

    install() {
      const current = this.getState();
      if (current.status !== 'downloaded' || !current.canInstall) {
        throw new Error('Download the update before installing it.');
      }

      this.set({
        status: 'backing-up',
        canDownload: false,
        canInstall: false,
        backupStatus: 'creating',
        backupPath: null,
        backupCreatedAt: null,
        error: null
      });

      let backup;
      try {
        if (!refs.autonomy?.createAutomaticBackup || !refs.autonomy?.verifyBackup) {
          throw new Error('The verified backup service is not ready.');
        }
        backup = refs.autonomy.createAutomaticBackup('pre-update');
        if (!backup?.valid || !backup.filePath) throw new Error('The backup service did not return a verified backup file.');
        refs.autonomy.verifyBackup(backup.filePath);
        this.set({
          status: 'downloaded',
          canDownload: false,
          canInstall: true,
          backupStatus: 'verified',
          backupPath: backup.filePath,
          backupCreatedAt: backup.createdAt || new Date().toISOString(),
          error: null
        });
        refs.logger?.info?.('Mandatory pre-update backup created and verified.', {
          version: current.version,
          filePath: backup.filePath
        });
      } catch (error) {
        const message = `Pre-update backup failed: ${error.message || String(error)}`;
        this.set({
          status: 'downloaded',
          canDownload: false,
          canInstall: true,
          backupStatus: 'failed',
          backupPath: null,
          backupCreatedAt: null,
          error: message
        });
        refs.logger?.error?.('Update installation stopped because the mandatory backup failed.', { message });
        throw new Error(`${message}. Installation was cancelled and the current version remains active.`);
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
  const richBrandEnabled = hardwareRenderingRequested();

  prototype.loadFile = function patchedLoadFile(...args) {
    const window = this;
    const webContentsId = window.webContents.id;
    window.webContents.once('did-finish-load', () => {
      if (window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.id !== webContentsId) return;
      window.webContents.executeJavaScript(`(() => {
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
        const richBrandEnabled = ${richBrandEnabled ? 'true' : 'false'};
        addStyle('ui-fixes.css');
        if (richBrandEnabled) {
          addStyle('brand-ui.css');
          addScript('brand-ui.js');
        } else {
          document.body.classList.add('nexus-compatibility-visuals');
          window.khaos?.reportBootStage?.('rich-brand-skipped', { mode: 'software' });
          console.info('[Khaos Nexus] Rich brand renderer skipped in software compatibility mode.');
        }
        addScript('simple-updater.js');
        addScript('state-hub.js');
        addScript('nexus-core-surface.js');
        addScript('ui-refresh.js');
      })();`).catch((error) => {
        console.error('[Khaos Nexus] Brand/update/primary-navigation renderer bootstrap failed.', error);
      });
    });
    return original.apply(window, args);
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
    refs.autonomy?.assertAccess?.(refs.discordAuth?.getState?.(), 'owner', 'Update Khaos Nexus');
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

module.exports = { install, refs, patchBrowserLoader, normalizeUpdateChannel };