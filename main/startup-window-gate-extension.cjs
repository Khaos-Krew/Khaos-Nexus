'use strict';

const path = require('node:path');
const electron = require('electron');
const startupHealth = require('./startup-health-extension.cjs');

let installed = false;

function preloadName(window) {
  try {
    const preferences = window.webContents.getLastWebPreferences?.() || {};
    return path.basename(String(preferences.preload || ''));
  } catch {
    return '';
  }
}

function isStartupSplash(window) {
  return Boolean(window?.__khaosStartupSplashWindow || preloadName(window) === 'startup-health-preload.cjs');
}

function install() {
  if (installed) return;
  installed = true;

  const prototype = electron.BrowserWindow?.prototype;
  if (prototype && !prototype.__khaosStartupShowPatched) {
    const originalShow = prototype.show;
    prototype.show = function startupGatedShow(...args) {
      if (!isStartupSplash(this)) {
        startupHealth.registerMainWindow(this);
        const state = startupHealth.publicState();
        if (!state.released && !state.limitedMode) return false;
      }
      return originalShow.apply(this, args);
    };
    Object.defineProperty(prototype, '__khaosStartupShowPatched', { value: true });
  }

  electron.app.on('browser-window-created', (_event, window) => {
    if (isStartupSplash(window)) {
      window.__khaosStartupSplashWindow = true;
      return;
    }
    startupHealth.registerMainWindow(window);
  });
}

module.exports = { install, isStartupSplash, preloadName };
