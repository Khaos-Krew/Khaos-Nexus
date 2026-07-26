'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  isPortableRuntime,
  portableDataRoot,
  portableLogDirectory,
  portableDiagnosticsDirectory
} = require('./portable-paths.cjs');

let cachedPaths;
let pathInitializationAttempted = false;
let pathInitializationError = null;

function ensureDirectory(directory) {
  if (!directory) return null;
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function runtimePaths() {
  if (!isPortableRuntime()) return null;
  if (pathInitializationAttempted) return cachedPaths || null;
  pathInitializationAttempted = true;
  try {
    const root = ensureDirectory(portableDataRoot());
    const logs = ensureDirectory(portableLogDirectory());
    const diagnostics = ensureDirectory(portableDiagnosticsDirectory());
    cachedPaths = { root, logs, diagnostics };
    return cachedPaths;
  } catch (error) {
    pathInitializationError = error;
    cachedPaths = null;
    try {
      process.stderr.write(`[Khaos Nexus] Portable diagnostic folder could not be created: ${error.message}\n`);
    } catch {}
    return null;
  }
}

function runtimeStatus() {
  return {
    portable: isPortableRuntime(),
    paths: runtimePaths(),
    error: pathInitializationError ? {
      code: pathInitializationError.code || null,
      message: pathInitializationError.message || String(pathInitializationError)
    } : null
  };
}

function safeJson(value) {
  try { return JSON.stringify(value); }
  catch { return JSON.stringify({ serializationError: true, value: String(value) }); }
}

function appendLog(fileName, entry) {
  const paths = runtimePaths();
  if (!paths) return null;
  try {
    const target = path.join(paths.logs, fileName);
    const line = typeof entry === 'string' ? entry : safeJson(entry);
    fs.appendFileSync(target, `${line.endsWith('\n') ? line : `${line}\n`}`, 'utf8');
    return target;
  } catch (error) {
    try { process.stderr.write(`[Khaos Nexus] Portable log write failed: ${error.message}\n`); } catch {}
    return null;
  }
}

function writeDiagnostic(fileName, value) {
  const paths = runtimePaths();
  if (!paths) return null;
  const target = path.join(paths.diagnostics, fileName);
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
    try { fs.renameSync(temporary, target); }
    catch {
      fs.rmSync(target, { force: true });
      fs.renameSync(temporary, target);
    }
    return target;
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    try { process.stderr.write(`[Khaos Nexus] Portable diagnostic write failed: ${error.message}\n`); } catch {}
    return null;
  }
}

function writeReadme({ appVersion = 'unknown', canonicalUserData = null } = {}) {
  const paths = runtimePaths();
  if (!paths) return null;
  const target = path.join(paths.root, 'PORTABLE-README.txt');
  const content = [
    'Khaos Nexus Portable Diagnostic Data',
    '=====================================',
    '',
    `Application version: ${appVersion}`,
    `Updated: ${new Date().toISOString()}`,
    '',
    'This folder is created immediately by the portable executable.',
    'Startup, preload, renderer, and manager diagnostics are mirrored here so failures can be inspected without searching AppData.',
    '',
    'Existing Khaos Nexus configuration remains in the canonical Windows profile so portable testing uses the same saved servers and protected settings.',
    canonicalUserData ? `Canonical profile: ${canonicalUserData}` : 'Canonical profile: available after Electron initialization.',
    '',
    'Do not publish protected credential or raw configuration files. This sidecar contains diagnostic output only.'
  ].join('\r\n');
  try {
    fs.writeFileSync(target, content, 'utf8');
    return target;
  } catch (error) {
    try { process.stderr.write(`[Khaos Nexus] Portable README write failed: ${error.message}\n`); } catch {}
    return null;
  }
}

module.exports = {
  runtimePaths,
  runtimeStatus,
  appendLog,
  writeDiagnostic,
  writeReadme
};
