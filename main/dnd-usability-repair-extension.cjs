'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const cssPath = path.join(__dirname, '..', 'renderer', 'dnd-usability-repair.css');
  const jsPath = path.join(__dirname, '..', 'renderer', 'dnd-usability-repair.js');
  const stabilityPath = path.join(__dirname, '..', 'renderer', 'dnd-usability-stability.js');
  const refreshGuardPath = path.join(__dirname, '..', 'renderer', 'dnd-refresh-guard.js');
  electron.app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', async () => {
      try {
        const css = fs.readFileSync(cssPath, 'utf8');
        const script = fs.readFileSync(jsPath, 'utf8');
        const stability = fs.readFileSync(stabilityPath, 'utf8');
        const refreshGuard = fs.readFileSync(refreshGuardPath, 'utf8');
        await window.webContents.insertCSS(css);
        await window.webContents.executeJavaScript(script, true);
        await window.webContents.executeJavaScript(stability, true);
        await window.webContents.executeJavaScript(refreshGuard, true);
      } catch (error) {
        console.error('D&D usability repair assets failed to load.', error);
      }
    });
  });
}

module.exports = { install };
