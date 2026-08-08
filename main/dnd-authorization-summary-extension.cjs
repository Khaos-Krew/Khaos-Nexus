'use strict';

const path = require('node:path');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  registerRendererBundle({
    id: 'dnd-authorization-summary',
    styles: [],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-authorization-summary.js')],
    source: 'dnd-authorization-summary-extension.cjs'
  });
}

module.exports = { install };
