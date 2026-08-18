'use strict';

const path = require('node:path');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  registerRendererBundle({
    id: 'nexus-sentinel-readiness',
    styles: [path.join(__dirname, '..', 'renderer', 'readiness.css')],
    scripts: [path.join(__dirname, '..', 'renderer', 'readiness.js')],
    source: 'sentinel-readiness-extension.cjs'
  });
}

module.exports = { install };