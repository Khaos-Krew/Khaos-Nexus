'use strict';

const path = require('node:path');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  registerRendererBundle({
    id: 'dnd-standalone-shell',
    styles: [path.join(__dirname, '..', 'renderer', 'dnd-standalone-shell.css')],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-standalone-shell.js')],
    source: 'dnd-standalone-shell-extension.cjs'
  });
}

module.exports = { install };
