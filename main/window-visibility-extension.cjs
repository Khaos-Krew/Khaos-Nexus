'use strict';

const { app, BrowserWindow } = require('electron');

const WINDOW_REVEAL_TIMEOUT_MS = 4000;
let installed = false;
let pendingSecondInstanceReveal = false;

function usableWindow(window) {
  try {
    return Boolean(window && !window.isDestroyed() && window.webContents && !window.webContents.isDestroyed());
  } catch {
    return false;
  }
}

function revealWindow(window, reason = 'requested') {
  if (!usableWindow(window)) return false;
  try {
    if (window.isMinimized()) window.restore();
    if (!window.isVisible()) window.show();
    window.moveTop?.();
    window.focus();
    pendingSecondInstanceReveal = false;
    console.info(`[Khaos Nexus] Desktop window revealed (${reason}).`);
    return true;
  } catch (error) {
    console.error('[Khaos Nexus] Could not reveal the desktop window.', error);
    return false;
  }
}

function revealPrimaryWindow(reason) {
  const windows = BrowserWindow.getAllWindows().filter(usableWindow);
  if (!windows.length) {
    pendingSecondInstanceReveal = true;
    return false;
  }
  return revealWindow(windows[0], reason);
}

function attachWindowVisibility(window) {
  if (!usableWindow(window) || window.__khaosVisibilityAttached) return;
  window.__khaosVisibilityAttached = true;

  let revealTimer = setTimeout(() => revealWindow(window, 'startup fallback'), WINDOW_REVEAL_TIMEOUT_MS);
  revealTimer.unref?.();

  const clearRevealTimer = () => {
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = null;
  };

  const revealLoadedWindow = (reason) => {
    clearRevealTimer();
    revealWindow(window, reason);
  };

  window.once('ready-to-show', () => revealLoadedWindow('ready-to-show'));
  window.webContents.once('did-finish-load', () => revealLoadedWindow('did-finish-load'));
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    console.error('[Khaos Nexus] Main interface failed to load.', { errorCode, errorDescription, validatedUrl });
    revealLoadedWindow('load failure recovery');
  });
  window.on('show', clearRevealTimer);
  window.on('closed', clearRevealTimer);

  if (pendingSecondInstanceReveal) {
    const timer = setTimeout(() => revealWindow(window, 'second launch request'), 250);
    timer.unref?.();
  }
}

function install() {
  if (installed) return;
  installed = true;

  app.on('browser-window-created', (_event, window) => attachWindowVisibility(window));
  app.on('second-instance', () => revealPrimaryWindow('second launch request'));
  app.whenReady().then(() => {
    for (const window of BrowserWindow.getAllWindows()) attachWindowVisibility(window);
  }).catch((error) => console.error('[Khaos Nexus] Window visibility initialization failed.', error));
}

module.exports = {
  WINDOW_REVEAL_TIMEOUT_MS,
  install,
  usableWindow,
  revealWindow,
  attachWindowVisibility
};
