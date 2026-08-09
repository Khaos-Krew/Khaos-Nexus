'use strict';

const path = require('node:path');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  registerRendererBundle({
    id: 'dnd-ai-map-stability',
    styles: [],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-ai-maps-stability.js')],
    source: 'dnd-ai-map-stability-extension.cjs'
  });
}

module.exports = { install };
