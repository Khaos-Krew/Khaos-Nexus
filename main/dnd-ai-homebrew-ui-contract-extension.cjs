'use strict';

const path = require('node:path');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  registerRendererBundle({
    id: 'dnd-ai-homebrew-ui-contract',
    styles: [],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-ai-homebrew-contract.js')],
    source: 'dnd-ai-homebrew-ui-contract-extension.cjs'
  });
}

module.exports = { install };
