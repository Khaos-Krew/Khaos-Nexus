'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

let installed = false;

function installRendererAssets() {
  const cssPath = path.join(__dirname, '..', 'renderer', 'dnd-draft-preservation.css');

  electron.app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', async () => {
      try {
        const css = fs.readFileSync(cssPath, 'utf8');
        await window.webContents.insertCSS(css);
      } catch (error) {
        console.error('[Khaos Nexus] D&D draft-preservation styles failed to load.', error);
      }
    });
  });
}

function install() {
  if (installed) return;
  installed = true;
  installRendererAssets();
}

module.exports = { install, installRendererAssets };
