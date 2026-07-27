'use strict';

const electron = require('electron');
const watchdog = require('./interface-watchdog-extension.cjs');

let installed = false;

function attach(window) {
  if (!watchdog.isMainInterfaceWindow(window) || window.__khaosRendererUnresponsiveAttached) return false;
  window.__khaosRendererUnresponsiveAttached = true;

  const report = () => {
    const href = (() => {
      try { return window.webContents.getURL?.() || ''; }
      catch { return ''; }
    })();
    watchdog.reportFailure(
      window,
      'renderer-unresponsive',
      'The desktop renderer stopped responding while loading or updating the interface.',
      { href },
      { detectedAt: new Date().toISOString() }
    );
  };

  window.on('unresponsive', report);
  window.webContents.on('unresponsive', report);
  window.on('responsive', () => {
    try { console.info('[Khaos Nexus] The desktop renderer became responsive again.'); } catch {}
  });
  window.webContents.on('responsive', () => {
    try { console.info('[Khaos Nexus] The desktop web contents became responsive again.'); } catch {}
  });
  return true;
}

function discover() {
  for (const window of electron.BrowserWindow.getAllWindows()) attach(window);
}

function install() {
  if (installed) return;
  installed = true;
  electron.app.on('browser-window-created', (_event, window) => {
    for (const delay of [0, 50, 250, 1000]) {
      const timer = setTimeout(() => attach(window), delay);
      timer.unref?.();
    }
  });
  electron.app.whenReady().then(discover).catch((error) => {
    console.error('[Khaos Nexus] Renderer-unresponsive monitoring failed to initialize.', error);
  });
}

module.exports = { install, attach };
