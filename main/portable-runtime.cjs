'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  isPortableRuntime,
  portableDataRoot,
  portableLogDirectory,
  portableDiagnosticsDirectory
} = require('./portable-paths.cjs');

function ensureDirectory(directory) {
  if (!directory) return null;
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function runtimePaths() {
  if (!isPortableRuntime()) return null;
  const root = ensureDirectory(portableDataRoot());
  const logs = ensureDirectory(portableLogDirectory());
  const diagnostics = ensureDirectory(portableDiagnosticsDirectory());
  return { root, logs, diagnostics };
}

function safeJson(value) {
  try { return JSON.stringify(value); }
  catch { return JSON.stringify({ serializationError: true, value: String(value) }); }
}

function appendLog(fileName, entry) {
  const paths = runtimePaths();
  if (!paths) return null;
  const target = path.join(paths.logs, fileName);
  const line = typeof entry === 'string' ? entry : safeJson(entry);
  fs.appendFileSync(target, `${line.endsWith('\n') ? line : `${line}\n`}`, 'utf8');
  return target;
}

function writeDiagnostic(fileName, value) {
  const paths = runtimePaths();
  if (!paths) return null;
  const target = path.join(paths.diagnostics, fileName);
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  try { fs.renameSync(temporary, target); }
  catch {
    fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
  }
  return target;
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
    `Created: ${new Date().toISOString()}`,
    '',
    'This folder is created immediately by the portable executable.',
    'Startup, preload, renderer, and manager diagnostics are mirrored here so failures can be inspected without searching AppData.',
    '',
    'Existing Khaos Nexus configuration remains in the canonical Windows profile so portable testing uses the same saved servers and protected settings.',
    canonicalUserData ? `Canonical profile: ${canonicalUserData}` : 'Canonical profile: available after Electron initialization.',
    '',
    'Do not publish secrets.bin or raw configuration files. Logs and diagnostics are designed to avoid protected credential values.'
  ].join('\r\n');
  fs.writeFileSync(target, content, 'utf8');
  return target;
}

module.exports = {
  runtimePaths,
  appendLog,
  writeDiagnostic,
  writeReadme
};
