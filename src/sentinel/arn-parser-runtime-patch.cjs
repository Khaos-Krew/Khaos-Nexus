'use strict';

const Module = require('node:module');
const path = require('node:path');

const PATCHED = Symbol.for('khaos.nexus.arnParserRuntimePatch');
if (!globalThis[PATCHED]) {
  globalThis[PATCHED] = true;
  const originalCompile = Module.prototype._compile;
  const targetSuffix = path.join('src', 'sentinel', 'arn-live-board-extension.cjs');
  const needle = "const description = clean(embed.description || payload.description || payload.content, 1000);";
  const replacement = "const description = clean(embed.description || payload.description || payload.content, 1000).replace(/\\*{1,3}/g, '').replace(/_{1,3}/g, '').replace(/~~/g, '');";

  Module.prototype._compile = function nexusArnParserCompile(content, filename) {
    if (String(filename || '').endsWith(targetSuffix)) {
      if (!content.includes(needle)) {
        throw new Error('ARN parser runtime patch could not locate expected description-normalization line.');
      }
      content = content.replace(needle, replacement);
    }
    return originalCompile.call(this, content, filename);
  };
}
