'use strict';

const electron = require('electron');
const { getMigrationResult } = require('./user-data-migration-extension.cjs');

const refs = {
  discordAuth: null,
  configStore: null,
  logger: null
};

let installed = false;
let ipcInstalled = false;
let startupRestorePromise = null;
let state = {
  configLoaded: false,
  authRestoreStarted: false,
  authRestoreComplete: false,
  authRestoreStatus: 'pending',
  authRestoreError: null,
  migration: getMigrationResult(),
  completedAt: null
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function publicState() {
  return clone({
    ...state,
    migration: getMigrationResult()
  });
}

function broadcast() {
  const payload = publicState();
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('startup:state', payload);
    }
  }
}

function update(patch = {}) {
  state = { ...state, ...patch, migration: getMigrationResult() };
  broadcast();
  return publicState();
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosStartupStatePatched) return;

  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      if (refName === 'configStore') update({ configLoaded: true });
      setImmediate(beginStartupRestore);
    }
  }

  Object.defineProperty(Captured, '__khaosStartupStatePatched', { value: true });
  target[exportName] = Captured;
}

function registerIpc() {
  if (ipcInstalled) return;
  ipcInstalled = true;
  electron.ipcMain.handle('startup:get-state', () => publicState());
}

function beginStartupRestore() {
  registerIpc();
  if (startupRestorePromise || !refs.discordAuth || !refs.configStore) return startupRestorePromise;

  update({
    configLoaded: true,
    authRestoreStarted: true,
    authRestoreComplete: false,
    authRestoreStatus: 'restoring',
    authRestoreError: null
  });

  startupRestorePromise = Promise.resolve()
    .then(() => refs.discordAuth.restore())
    .then((authState) => {
      const status = authState?.status || 'signed-out';
      update({
        authRestoreComplete: true,
        authRestoreStatus: status,
        authRestoreError: authState?.lastError || null,
        completedAt: new Date().toISOString()
      });
      refs.logger?.info?.('Startup configuration and Discord access restoration completed.', {
        status,
        configured: Boolean(authState?.configured),
        signedIn: Boolean(authState?.user),
        migrated: Boolean(getMigrationResult()?.migrated)
      });
      return authState;
    })
    .catch((error) => {
      update({
        authRestoreComplete: true,
        authRestoreStatus: 'failed',
        authRestoreError: error.message,
        completedAt: new Date().toISOString()
      });
      refs.logger?.warn?.('Startup Discord access restoration failed.', { message: error.message });
      return refs.discordAuth?.getState?.() || null;
    });

  return startupRestorePromise;
}

function install() {
  if (installed) return;
  installed = true;
  captureClass('./services/config-store.cjs', 'ConfigStore', 'configStore');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  registerIpc();

  electron.app.whenReady().then(() => {
    const wait = () => {
      if (refs.discordAuth && refs.configStore) beginStartupRestore();
      else setTimeout(wait, 50);
    };
    wait();
  }).catch((error) => {
    update({
      authRestoreComplete: true,
      authRestoreStatus: 'failed',
      authRestoreError: error.message,
      completedAt: new Date().toISOString()
    });
  });
}

module.exports = {
  install,
  refs,
  publicState,
  beginStartupRestore
};
