'use strict';

const { EventEmitter } = require('node:events');
const { app } = require('electron');

let installed = false;

class DndStandaloneUpdateService extends EventEmitter {
  constructor(input = {}) {
    super();
    const options = input && input.logger ? input : { logger: input };
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.state = {
      status: 'disabled',
      currentVersion: app.getVersion(),
      version: null,
      progress: null,
      transferred: null,
      total: null,
      bytesPerSecond: null,
      error: null,
      releaseName: 'Nexus D&D standalone test channel',
      releaseNotes: 'Automatic updates are intentionally disabled until Nexus D&D has an independent release feed.',
      releaseUrl: null,
      publishedAt: null,
      lastCheckedAt: null,
      mode: 'standalone',
      canDownload: false,
      canInstall: false,
      automaticChecks: false,
      verified: false,
      standaloneUpdateDisabled: true
    };
  }

  getState() {
    return { ...this.state };
  }

  async check() {
    this.state.lastCheckedAt = new Date().toISOString();
    this.emit('state', this.getState());
    return this.getState();
  }

  async checkIfDue() {
    return this.check();
  }

  async download() {
    throw new Error('Nexus D&D test builds do not download Khaos Nexus updates. Install a newer standalone D&D build manually.');
  }

  install() {
    throw new Error('Nexus D&D test builds do not install Khaos Nexus updates. Install a newer standalone D&D build manually.');
  }

  configureAutomaticChecks() {
    this.state.automaticChecks = false;
    return this.getState();
  }

  destroy() {}
}

function install() {
  if (installed) return;
  installed = true;
  const target = require('./services/update-service.cjs');
  target.UpdateService = DndStandaloneUpdateService;
}

module.exports = { install, DndStandaloneUpdateService };
