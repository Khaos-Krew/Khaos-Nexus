'use strict';

const path = require('node:path');
const childProcess = require('node:child_process');
const {
  sanitizeBundledAiEnvironment,
  fileSize,
  readLatestSidecarDiagnostic,
  formatSidecarDiagnostic
} = require('./ai-runtime-environment.cjs');

const INSTALL_MARK = Symbol.for('khaos-nexus.ai-runtime-spawn-boundary');

function entryText(args = []) {
  return String(Array.isArray(args) ? args[0] || '' : '').replaceAll('\\', '/').toLowerCase();
}

function runtimeHostEntry(args = [], options = {}) {
  if (options?.env?.KHAOS_NEXUS_BUNDLED_SERVICE !== '1') return false;
  return entryText(args).endsWith('/main/ai-runtime-host.cjs');
}

function bundledAiEntry(args = [], options = {}) {
  if (options?.env?.KHAOS_NEXUS_BUNDLED_SERVICE !== '1') return false;
  const entry = entryText(args);
  return runtimeHostEntry(args, options)
    || (entry.includes('/ai-services/') && (entry.includes('/dnd-ai/') || entry.includes('/ai-core/')));
}

function coreAiEntry(args = [], options = {}) {
  return !runtimeHostEntry(args, options) && bundledAiEntry(args, options) && entryText(args).includes('/ai-core/');
}

function guardSpawnOptions(command, args, options = {}) {
  if (command !== process.execPath || !bundledAiEntry(args, options)) return options;
  return {
    ...options,
    env: sanitizeBundledAiEnvironment(options.env)
  };
}

function diagnosticContext(args, options) {
  if (!coreAiEntry(args, options)) return null;
  const dataDir = String(options?.env?.DATA_DIR || '');
  if (!dataDir) return null;
  const logPath = path.join(dataDir, 'service.log');
  return { logPath, startOffset: fileSize(logPath) };
}

function attachCoreDiagnostic(child, context) {
  if (!context || !child?.once) return child;
  child.once('close', (code) => {
    if (code === 0) return;
    const diagnostic = readLatestSidecarDiagnostic(context.logPath, context.startOffset);
    if (!diagnostic || child.listenerCount('error') < 1) return;
    const error = new Error(formatSidecarDiagnostic('Nexus Sentinel', diagnostic));
    error.code = diagnostic.code;
    error.exitCode = diagnostic.exitCode;
    error.event = diagnostic.event;
    child.emit('error', error);
  });
  return child;
}

function install() {
  if (childProcess[INSTALL_MARK]) return;
  const originalSpawn = childProcess.spawn;
  function guardedSpawn(command, args, options) {
    const guardedOptions = guardSpawnOptions(command, args, options);
    const context = diagnosticContext(args, guardedOptions);
    const child = originalSpawn.call(childProcess, command, args, guardedOptions);
    return attachCoreDiagnostic(child, context);
  }
  Object.defineProperty(guardedSpawn, 'name', { value: 'spawn' });
  childProcess.spawn = guardedSpawn;
  Object.defineProperty(childProcess, INSTALL_MARK, { value: true });
}

module.exports = {
  install,
  runtimeHostEntry,
  bundledAiEntry,
  coreAiEntry,
  guardSpawnOptions,
  diagnosticContext,
  attachCoreDiagnostic
};
