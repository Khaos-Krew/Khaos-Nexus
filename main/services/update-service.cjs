'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const GITHUB_OWNER = 'Khaos-Krew';
const GITHUB_REPO = 'Khaos-Nexus';

function cleanVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').split('+')[0];
}

function versionParts(value) {
  const cleaned = cleanVersion(value).split('-')[0];
  return cleaned.split('.').map((part) => Number.parseInt(part, 10) || 0).slice(0, 4);
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length, 3);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function normalizeReleaseNotes(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 12000);
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === 'string' ? item : item?.note).filter(Boolean).join('\n').slice(0, 12000);
  }
  return String(value).slice(0, 12000);
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

class UpdateService extends EventEmitter {
  constructor(input = {}) {
    super();
    const options = input && input.logger ? input : { logger: input };
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.fs = options.fsImpl || fs;
    this.spawnImpl = options.spawnImpl || spawn;
    this.env = options.env || process.env;
    this.processId = options.processId || process.pid;
    this.setTimeoutImpl = options.setTimeoutImpl || setTimeout;
    this.clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout;
    this.setIntervalImpl = options.setIntervalImpl || setInterval;
    this.clearIntervalImpl = options.clearIntervalImpl || clearInterval;

    if (options.appAdapter) this.app = options.appAdapter;
    else this.app = require('electron').app;
    if (options.updater) this.updater = options.updater;
    else this.updater = require('electron-updater').autoUpdater;

    this.portableExecutable = this.env.PORTABLE_EXECUTABLE_FILE || null;
    this.mode = !this.app?.isPackaged ? 'development' : this.portableExecutable ? 'portable' : 'installed';
    this.releaseAsset = null;
    this.stagedPath = null;
    this.checkPromise = null;
    this.downloadPromise = null;
    this.automaticTimer = null;
    this.installTimer = null;

    this.state = {
      status: 'idle',
      currentVersion: this.app?.getVersion?.() || '0.0.0',
      version: null,
      progress: null,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      error: null,
      releaseName: null,
      releaseNotes: null,
      releaseUrl: null,
      publishedAt: null,
      lastCheckedAt: null,
      mode: this.mode,
      canDownload: false,
      canInstall: false,
      automaticChecks: false,
      verified: false
    };

    if (this.mode === 'installed') this.bindInstalledUpdater();
  }

  bindInstalledUpdater() {
    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = false;
    this.updater.allowDowngrade = false;

    this.updater.on('checking-for-update', () => this.set({ status: 'checking', error: null, progress: null }));
    this.updater.on('update-available', (info = {}) => this.setAvailableFromInfo(info));
    this.updater.on('update-not-available', (info = {}) => this.set({
      status: 'current',
      version: info.version || this.state.currentVersion,
      lastCheckedAt: new Date().toISOString(),
      canDownload: false,
      canInstall: false,
      error: null
    }));
    this.updater.on('download-progress', (progress = {}) => this.set({
      status: 'downloading',
      progress: Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0))),
      transferred: Number(progress.transferred) || 0,
      total: Number(progress.total) || null,
      bytesPerSecond: Number(progress.bytesPerSecond) || null,
      error: null
    }));
    this.updater.on('update-downloaded', (info = {}) => this.set({
      status: 'downloaded',
      version: info.version || this.state.version,
      progress: 100,
      canDownload: false,
      canInstall: true,
      verified: true,
      error: null
    }));
    this.updater.on('error', (error) => this.handleError(error, 'Update operation failed'));
  }

  setAvailableFromInfo(info = {}) {
    this.set({
      status: 'available',
      version: cleanVersion(info.version),
      releaseName: info.releaseName || `Khaos Nexus v${cleanVersion(info.version)}`,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      publishedAt: info.releaseDate || null,
      releaseUrl: info.releaseUrl || this.state.releaseUrl,
      lastCheckedAt: new Date().toISOString(),
      canDownload: true,
      canInstall: false,
      verified: false,
      progress: null,
      error: null
    });
  }

  handleError(error, prefix = 'Update check failed') {
    const message = error?.message || String(error);
    this.logger.error(`${prefix}: ${message}`);
    this.set({ status: 'error', error: message, canDownload: false, canInstall: false });
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.getState());
  }

  getState() {
    return { ...this.state };
  }

  async check() {
    if (this.checkPromise) return this.checkPromise;
    this.checkPromise = this.performCheck().finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }

  async performCheck() {
    if (this.mode === 'development') {
      this.set({ status: 'development', error: null, lastCheckedAt: new Date().toISOString() });
      return this.getState();
    }

    this.set({ status: 'checking', error: null, progress: null, canDownload: false, canInstall: false });
    try {
      if (this.mode === 'portable') return await this.checkPortableRelease();
      const result = await this.updater.checkForUpdates();
      const info = result?.updateInfo;
      if (info && compareVersions(info.version, this.state.currentVersion) > 0 && this.state.status === 'checking') {
        this.setAvailableFromInfo(info);
      } else if (this.state.status === 'checking') {
        this.set({ status: 'current', version: this.state.currentVersion, lastCheckedAt: new Date().toISOString(), error: null });
      }
      return this.getState();
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async checkPortableRelease() {
    if (typeof this.fetchImpl !== 'function') throw new Error('Network access is unavailable for the portable update check.');
    const response = await this.fetchImpl(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `Khaos-Nexus/${this.state.currentVersion}`
      }
    });
    if (response.status === 404) throw new Error('No published Khaos Nexus release is available yet.');
    if (!response.ok) throw new Error(`GitHub release check failed with status ${response.status}.`);

    const release = await response.json();
    const latestVersion = cleanVersion(release.tag_name || release.name);
    if (!latestVersion) throw new Error('The latest GitHub release does not contain a usable version number.');
    if (compareVersions(latestVersion, this.state.currentVersion) <= 0) {
      this.releaseAsset = null;
      this.set({
        status: 'current',
        version: this.state.currentVersion,
        releaseName: release.name || `Khaos Nexus v${latestVersion}`,
        releaseNotes: normalizeReleaseNotes(release.body),
        releaseUrl: release.html_url || null,
        publishedAt: release.published_at || null,
        lastCheckedAt: new Date().toISOString(),
        canDownload: false,
        canInstall: false,
        error: null
      });
      return this.getState();
    }

    const expectedName = `Khaos-Nexus-Portable-${latestVersion}-x64.exe`.toLowerCase();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find((item) => String(item.name || '').toLowerCase() === expectedName)
      || assets.find((item) => /khaos-nexus-portable-.*-x64\.exe$/i.test(String(item.name || '')));
    if (!asset?.browser_download_url) throw new Error(`Release v${latestVersion} is live, but its portable Windows executable is missing.`);

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
      error: null
    });
    return this.getState();
  }

  async download() {
    if (this.downloadPromise) return this.downloadPromise;
    this.downloadPromise = this.performDownload().finally(() => { this.downloadPromise = null; });
    return this.downloadPromise;
  }

  async performDownload() {
    if (this.state.status !== 'available') throw new Error('Check for an available update before downloading.');
    if (this.mode === 'portable') return this.downloadPortableRelease();
    if (this.mode !== 'installed') throw new Error('Update downloads are unavailable in development mode.');
    await this.updater.downloadUpdate();
    return this.getState();
  }

  async downloadPortableRelease() {
    if (!this.releaseAsset) throw new Error('The portable release asset is not available. Check again.');
    const updateDirectory = path.join(this.app.getPath('userData'), 'updates');
    this.fs.mkdirSync(updateDirectory, { recursive: true });
    const finalPath = path.join(updateDirectory, this.releaseAsset.name);
    const partialPath = `${finalPath}.partial`;
    this.fs.rmSync(partialPath, { force: true });

    this.set({ status: 'downloading', progress: 0, transferred: 0, total: this.releaseAsset.size, error: null });
    try {
      const response = await this.fetchImpl(this.releaseAsset.url, {
        redirect: 'follow',
        headers: { 'User-Agent': `Khaos-Nexus/${this.state.currentVersion}` }
      });
      if (!response.ok) throw new Error(`Portable update download failed with status ${response.status}.`);

      const hash = crypto.createHash('sha256');
      const handle = await this.fs.promises.open(partialPath, 'w');
      let transferred = 0;
      try {
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = Buffer.from(value);
            await handle.write(chunk);
            hash.update(chunk);
            transferred += chunk.length;
            this.updatePortableProgress(transferred);
          }
        } else {
          const chunk = Buffer.from(await response.arrayBuffer());
          await handle.write(chunk);
          hash.update(chunk);
          transferred = chunk.length;
          this.updatePortableProgress(transferred);
        }
      } finally {
        await handle.close();
      }

      const actual = hash.digest('hex');
      const expected = this.releaseAsset.digest.toLowerCase().replace(/^sha256:/, '').trim();
      if (!/^[a-f0-9]{64}$/.test(expected)) {
        throw new Error('The GitHub release did not provide a usable SHA-256 digest for the portable update.');
      }
      if (actual !== expected) {
        throw new Error('The downloaded portable update failed SHA-256 verification.');
      }
      this.fs.rmSync(finalPath, { force: true });
      this.fs.renameSync(partialPath, finalPath);
      this.stagedPath = finalPath;
      this.set({
        status: 'downloaded',
        progress: 100,
        transferred,
        total: this.releaseAsset.size || transferred,
        canDownload: false,
        canInstall: true,
        verified: true,
        error: null
      });
      this.logger.info('Portable application update downloaded and verified.', { version: this.state.version });
      return this.getState();
    } catch (error) {
      this.fs.rmSync(partialPath, { force: true });
      this.handleError(error, 'Portable update download failed');
      throw error;
    }
  }

  updatePortableProgress(transferred) {
    const total = this.releaseAsset?.size || null;
    const progress = total ? Math.max(0, Math.min(100, Math.round((transferred / total) * 100))) : null;
    this.set({ status: 'downloading', progress, transferred, total, error: null });
  }

  install() {
    if (this.state.status !== 'downloaded' || !this.state.canInstall) throw new Error('Download the update before installing it.');
    this.set({ status: 'installing', canInstall: false, error: null });
    if (this.mode === 'portable') return this.installPortableRelease();
    if (this.mode !== 'installed') throw new Error('Update installation is unavailable in development mode.');

    this.installTimer = this.setTimeoutImpl(() => this.updater.quitAndInstall(false, true), 350);
    return this.getState();
  }

  installPortableRelease() {
    if (!this.stagedPath || !this.fs.existsSync(this.stagedPath)) throw new Error('The staged portable update file is missing. Download it again.');
    const target = this.portableExecutable;
    if (!target) throw new Error('The original portable executable path is unavailable.');
    const scriptPath = path.join(path.dirname(this.stagedPath), `apply-khaos-nexus-update-${Date.now()}.ps1`);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$source = ${psQuote(this.stagedPath)}`,
      `$target = ${psQuote(target)}`,
      `$pidToWait = ${Number(this.processId)}`,
      'try { Wait-Process -Id $pidToWait -Timeout 120 -ErrorAction SilentlyContinue } catch {}',
      'Start-Sleep -Seconds 2',
      'Copy-Item -LiteralPath $source -Destination $target -Force',
      'Start-Process -FilePath $target',
      'Remove-Item -LiteralPath $source -Force -ErrorAction SilentlyContinue',
      'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue'
    ].join('\r\n');
    this.fs.writeFileSync(scriptPath, script, 'utf8');
    const child = this.spawnImpl('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    });
    child?.unref?.();
    this.logger.info('Portable update replacement helper started.', { version: this.state.version });
    this.installTimer = this.setTimeoutImpl(() => this.app.quit(), 600);
    return this.getState();
  }

  configureAutomaticChecks(enabled, intervalMs = UPDATE_INTERVAL_MS) {
    if (this.automaticTimer) this.clearIntervalImpl(this.automaticTimer);
    this.automaticTimer = null;
    const active = Boolean(enabled && this.mode !== 'development');
    this.set({ automaticChecks: active });
    if (!active) return this.getState();
    this.automaticTimer = this.setIntervalImpl(() => {
      this.check().catch((error) => this.logger.warn('Scheduled update check failed.', { message: error.message }));
    }, Math.max(15 * 60 * 1000, Number(intervalMs) || UPDATE_INTERVAL_MS));
    this.automaticTimer?.unref?.();
    return this.getState();
  }

  async checkIfDue(maxAgeMs = UPDATE_INTERVAL_MS) {
    const last = this.state.lastCheckedAt ? new Date(this.state.lastCheckedAt).getTime() : 0;
    if (last && Date.now() - last < maxAgeMs) return this.getState();
    return this.check();
  }

  destroy() {
    if (this.automaticTimer) this.clearIntervalImpl(this.automaticTimer);
    if (this.installTimer) this.clearTimeoutImpl(this.installTimer);
    this.automaticTimer = null;
    this.installTimer = null;
  }
}

module.exports = {
  UpdateService,
  UPDATE_INTERVAL_MS,
  cleanVersion,
  compareVersions,
  normalizeReleaseNotes
};
