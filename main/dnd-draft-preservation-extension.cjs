'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

let installed = false;

function installRendererAssets() {
  const cssPath = path.join(__dirname, '..', 'renderer', 'dnd-draft-preservation.css');
  const jsPath = path.join(__dirname, '..', 'renderer', 'dnd-draft-preservation.js');

  electron.app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', async () => {
      try {
        const css = fs.readFileSync(cssPath, 'utf8');
        const script = fs.readFileSync(jsPath, 'utf8');
        await window.webContents.insertCSS(css);
        await window.webContents.executeJavaScript(script, true);
      } catch (error) {
        console.error('[Khaos Nexus] D&D draft-preservation hotfix failed to load.', error);
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
