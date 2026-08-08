'use strict';

const path = require('node:path');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  registerRendererBundle({
    id: 'dnd-action-rejection-boundary',
    styles: [],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-action-rejection-boundary.js')],
    source: 'dnd-action-rejection-boundary-extension.cjs'
  });
}

module.exports = { install };
