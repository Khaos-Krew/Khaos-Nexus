'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const scriptPath = path.join(__dirname, '..', 'renderer', 'dnd-owner-license-default.js');
  electron.app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', async () => {
      try {
        await window.webContents.executeJavaScript(fs.readFileSync(scriptPath, 'utf8'), true);
      } catch (error) {
        console.error('D&D source-license safety asset failed to load.', error);
      }
    });
  });
}

module.exports = { install };
