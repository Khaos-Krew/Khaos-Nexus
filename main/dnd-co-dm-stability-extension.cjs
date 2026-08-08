'use strict';

const path = require('node:path');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  registerRendererBundle({
    id: 'dnd-co-dm-stability',
    styles: [],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-co-dm-stability.js')],
    source: 'dnd-co-dm-stability-extension.cjs'
  });
}

module.exports = { install };
