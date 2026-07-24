'use strict';

const electron = require('electron');
const { RECOVERY_PHRASE, isRecoveryPhraseValid, isLockedAccess } = require('../shared/access-recovery.cjs');

const refs = { autonomy: null, discordAuth: null, logger: null };
let installed = false;

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosAccessRecoveryPatched) return;

  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
    }
  }

  Object.defineProperty(Captured, '__khaosAccessRecoveryPatched', { value: true });
  target[exportName] = Captured;
}

function currentAccess() {
  return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.()) || {
    enabled: false,
    role: 'local-admin',
    canView: true,
    canOperate: true,
    canOwn: true
  };
}

function safePublicState() {
  const access = currentAccess();
  return {
    locked: isLockedAccess(access),
    access,
    recoveryPhrase: RECOVERY_PHRASE
  };
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosAccessRecoveryUiPatched) return;
  const original = prototype.loadFile;

  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="access-recovery.css"]')) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'access-recovery.css';
          document.head.appendChild(link);
        }
        if (!document.querySelector('script[src="access-recovery.js"]')) {
          const script = document.createElement('script');
          script.src = 'access-recovery.js';
          script.defer = true;
          document.body.appendChild(script);
        }
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };

  Object.defineProperty(prototype, '__khaosAccessRecoveryUiPatched', { value: true });
}

function registerIpc() {
  if (registerIpc.done) return;
  registerIpc.done = true;

  electron.ipcMain.handle('access-recovery:get-state', () => safePublicState());

  electron.ipcMain.handle('access-recovery:disable', (_event, payload = {}) => {
    const access = currentAccess();
    if (!isLockedAccess(access)) {
      return { restarted: false, alreadyUnlocked: true, access };
    }
    if (!isRecoveryPhraseValid(payload.phrase)) {
      const error = new Error(`Type ${RECOVERY_PHRASE} exactly to use local recovery.`);
      error.code = 'RECOVERY_PHRASE_REQUIRED';
      throw error;
    }

    const currentSettings = refs.autonomy.getSettings();
    refs.autonomy.setSettings({ ...currentSettings, accessControlEnabled: false });
    refs.logger?.warn?.('Desktop access control was disabled through confirmed local recovery.', {
      previousRole: access.role,
      reason: String(payload.reason || 'local-lockout').slice(0, 120)
    });

    setTimeout(() => {
      electron.app.relaunch();
      electron.app.exit(0);
    }, 250);

    return { restarted: true, accessControlEnabled: false };
  });
}

function waitForServices() {
  if (refs.autonomy && refs.discordAuth) {
    registerIpc();
    return;
  }
  setTimeout(waitForServices, 100);
}

function install() {
  if (installed) return;
  installed = true;
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  patchBrowserLoader();
  electron.app.whenReady().then(waitForServices);
}

module.exports = { install, refs, currentAccess, safePublicState };
