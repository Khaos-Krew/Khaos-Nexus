'use strict';

const path = require('node:path');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  registerRendererBundle({
    id: 'dnd-owner-license-default',
    styles: [],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-owner-license-default.js')],
    source: 'dnd-owner-license-default-extension.cjs'
  });
}

module.exports = { install };
