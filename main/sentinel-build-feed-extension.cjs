'use strict';

const electron = require('electron');
const { SentinelBuildFeedService } = require('./services/sentinel-build-feed-service.cjs');

const refs = {
  configStore: null,
  logger: null,
  service: null
};

let installed = false;
let initialized = false;

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosSentinelBuildFeedCaptured) return;

  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      scheduleInitialize();
    }
  }

  Object.defineProperty(Captured, '__khaosSentinelBuildFeedCaptured', { value: true });
  target[exportName] = Captured;
}

function initialize() {
  if (initialized || !refs.configStore) return false;
  initialized = true;
  refs.service = new SentinelBuildFeedService({
    configStore: refs.configStore,
    logger: refs.logger,
    dataDirectory: electron.app.getPath('userData')
  });
  refs.service.start();
  electron.app.on('before-quit', () => refs.service?.stop?.());
  refs.logger?.info?.('Nexus Sentinel build testing and release feed initialized.');
  return true;
}

function scheduleInitialize() {
  if (initialized) return;
  setImmediate(() => {
    if (initialize()) return;
    const timer = setTimeout(scheduleInitialize, 100);
    timer.unref?.();
  });
}

function install() {
  if (installed) return;
  installed = true;
  captureClass('./services/config-store.cjs', 'ConfigStore', 'configStore');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  electron.app.whenReady().then(scheduleInitialize);
}

module.exports = { install, refs };
