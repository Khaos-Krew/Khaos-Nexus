'use strict';

const { EventEmitter } = require('node:events');
const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

class UpdateService extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.state = { status: 'idle', version: null, progress: null, error: null };
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking', error: null }));
    autoUpdater.on('update-available', (info) => this.set({ status: 'available', version: info.version }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'current', version: app.getVersion() }));
    autoUpdater.on('download-progress', (progress) => this.set({ status: 'downloading', progress: Math.round(progress.percent) }));
    autoUpdater.on('update-downloaded', (info) => this.set({ status: 'downloaded', version: info.version, progress: 100 }));
    autoUpdater.on('error', (error) => {
      this.logger.error(`Update check failed: ${error.message}`);
      this.set({ status: 'error', error: error.message });
    });
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', { ...this.state });
  }

  getState() { return { ...this.state }; }

  async check() {
    if (!app.isPackaged) {
      this.set({ status: 'development', error: null });
      return this.getState();
    }
    await autoUpdater.checkForUpdates();
    return this.getState();
  }

  async download() {
    await autoUpdater.downloadUpdate();
    return this.getState();
  }

  install() {
    autoUpdater.quitAndInstall(false, true);
  }
}

module.exports = { UpdateService };
