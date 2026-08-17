'use strict';

const { EventEmitter } = require('node:events');
const { app } = require('electron');

let installed = false;

class SentinelTestUpdateService extends EventEmitter {
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
      releaseName: 'Nexus Sentinel test channel',
      releaseNotes: 'Updates are intentionally disabled in split Sentinel test builds so the legacy Khaos Nexus release feed cannot replace this test product.',
      releaseUrl: null,
      publishedAt: null,
      lastCheckedAt: null,
      mode: 'sentinel-test',
      canDownload: false,
      canInstall: false,
      automaticChecks: false,
      verified: false,
      sentinelTestUpdateDisabled: true
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
    throw new Error('Nexus Sentinel test builds do not download legacy Khaos Nexus updates. Install a newer Sentinel test build manually.');
  }

  install() {
    throw new Error('Nexus Sentinel test builds do not install legacy Khaos Nexus updates. Install a newer Sentinel test build manually.');
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
  target.UpdateService = SentinelTestUpdateService;
}

module.exports = { install, SentinelTestUpdateService };
