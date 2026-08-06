'use strict';

const path = require('node:path');
const childProcess = require('node:child_process');
const { sanitizeBundledAiEnvironment } = require('./ai-runtime-environment.cjs');

const INSTALL_MARK = Symbol.for('khaos-nexus.ai-runtime-spawn-boundary');

function bundledAiEntry(args = [], options = {}) {
  if (options?.env?.KHAOS_NEXUS_BUNDLED_SERVICE !== '1') return false;
  const entry = String(Array.isArray(args) ? args[0] || '' : '').replaceAll('\\', '/').toLowerCase();
  return entry.includes('/ai-services/') && (entry.includes('/dnd-ai/') || entry.includes('/ai-core/'));
}

function guardSpawnOptions(command, args, options = {}) {
  if (command !== process.execPath || !bundledAiEntry(args, options)) return options;
  return {
    ...options,
    env: sanitizeBundledAiEnvironment(options.env)
  };
}

function install() {
  if (childProcess[INSTALL_MARK]) return;
  const originalSpawn = childProcess.spawn;
  function guardedSpawn(command, args, options) {
    return originalSpawn.call(childProcess, command, args, guardSpawnOptions(command, args, options));
  }
  Object.defineProperty(guardedSpawn, 'name', { value: 'spawn' });
  childProcess.spawn = guardedSpawn;
  Object.defineProperty(childProcess, INSTALL_MARK, { value: true });
}

module.exports = { install, bundledAiEntry, guardSpawnOptions };
