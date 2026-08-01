'use strict';

const electron = require('electron');
const { ReleaseHistoryService } = require('./services/release-history-service.cjs');
const { refs } = require('./brand-update-extension.cjs');

let installed = false;
let service = null;

function getService() {
  if (service) return service;
  service = new ReleaseHistoryService({
    app: electron.app,
    logger: refs.logger,
    getAutonomy: () => refs.autonomy,
    getDiscordAuth: () => refs.discordAuth
  });
  service.on('state', (state) => {
    for (const window of electron.BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('update-history:state', state);
      }
    }
  });
  return service;
}

function publicIdentity() {
  const state = getService().getState();
  return {
    currentVersion: state.currentVersion,
    currentLabel: state.currentLabel,
    channel: state.channel
  };
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosUpdateHistoryPatched) return;
  const original = prototype.loadFile;

  prototype.loadFile = function patchedUpdateHistoryLoadFile(...args) {
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
        addStyle('update-history.css');
        addScript('release-label-display.js');
        addScript('update-history.js');
      })();`).catch((error) => {
        console.error('[Khaos Nexus] Update history renderer bootstrap failed.', error);
      });
    });
    return original.apply(window, args);
  };
  Object.defineProperty(prototype, '__khaosUpdateHistoryPatched', { value: true });
}

function registerIpc() {
  if (registerIpc.done) return;
  registerIpc.done = true;

  electron.ipcMain.handle('update-history:identity', () => publicIdentity());

  electron.ipcMain.handle('update-history:get', () => {
    const instance = getService();
    instance.assertOwner('Review Khaos Nexus update history');
    return instance.getState();
  });

  electron.ipcMain.handle('update-history:refresh', (_event, payload = {}) => {
    return getService().refresh(Boolean(payload.force));
  });

  electron.ipcMain.handle('update-history:rollback', (_event, payload = {}) => {
    return getService().rollback(payload);
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchBrowserLoader();
  electron.app.whenReady().then(() => setImmediate(registerIpc));
}

module.exports = { install, getService, publicIdentity, patchBrowserLoader };
