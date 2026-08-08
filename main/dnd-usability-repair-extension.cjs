'use strict';

const path = require('node:path');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  registerRendererBundle({
    id: 'dnd-usability-repair',
    styles: [path.join(__dirname, '..', 'renderer', 'dnd-usability-repair.css')],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-dom-hub.js'), path.join(__dirname, '..', 'renderer', 'dnd-usability-repair.js'), path.join(__dirname, '..', 'renderer', 'dnd-usability-stability.js'), path.join(__dirname, '..', 'renderer', 'dnd-refresh-guard.js')],
    source: 'dnd-usability-repair-extension.cjs'
  });
}

module.exports = { install };
