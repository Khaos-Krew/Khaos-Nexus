'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const scriptPath = path.join(__dirname, '..', 'renderer', 'dnd-authorization-summary.js');
  app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', async () => {
      try {
        await window.webContents.executeJavaScript(fs.readFileSync(scriptPath, 'utf8'), true);
      } catch {
        // The primary D&D workspace remains usable if this read-only summary cannot render.
      }
    });
  });
}

module.exports = { install };
