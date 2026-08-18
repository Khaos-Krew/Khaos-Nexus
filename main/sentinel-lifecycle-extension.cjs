'use strict';

const electron = require('electron');

let installed = false;

function revealPrimaryWindow() {
  const windows = electron.BrowserWindow.getAllWindows().filter((window) => window && !window.isDestroyed());
  const primary = windows.find((window) => /renderer[\\/]index\.html/i.test(String(window.webContents?.getURL?.() || '').replace(/%20/g, ' '))) || windows[0];
  if (!primary) return false;
  try {
    if (primary.isMinimized?.()) primary.restore();
    primary.show();
    primary.focus();
    primary.moveTop?.();
    return true;
  } catch {
    return false;
  }
}

function install() {
  if (installed) return;
  installed = true;
  electron.app.on('second-instance', () => {
    if (!revealPrimaryWindow()) {
      const retry = setInterval(() => {
        if (revealPrimaryWindow()) clearInterval(retry);
      }, 150);
      retry.unref?.();
      setTimeout(() => clearInterval(retry), 5000).unref?.();
    }
  });
}

module.exports = { install, revealPrimaryWindow };