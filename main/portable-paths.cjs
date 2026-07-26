'use strict';

const path = require('node:path');

const PORTABLE_DATA_DIRECTORY_NAME = 'Khaos-Nexus-Portable-Data';

function executableDirectory(env = process.env, execPath = process.execPath) {
  const explicitDirectory = String(env.PORTABLE_EXECUTABLE_DIR || '').trim();
  if (explicitDirectory) return path.resolve(explicitDirectory);

  const explicitFile = String(env.PORTABLE_EXECUTABLE_FILE || '').trim();
  if (explicitFile) return path.dirname(path.resolve(explicitFile));

  return null;
}

function isPortableRuntime(env = process.env) {
  return Boolean(String(env.PORTABLE_EXECUTABLE_DIR || '').trim() || String(env.PORTABLE_EXECUTABLE_FILE || '').trim());
}

function portableDataRoot(env = process.env, execPath = process.execPath) {
  const directory = executableDirectory(env, execPath);
  return directory ? path.join(directory, PORTABLE_DATA_DIRECTORY_NAME) : null;
}

function portableLogDirectory(env = process.env, execPath = process.execPath) {
  const root = portableDataRoot(env, execPath);
  return root ? path.join(root, 'logs') : null;
}

function portableDiagnosticsDirectory(env = process.env, execPath = process.execPath) {
  const root = portableDataRoot(env, execPath);
  return root ? path.join(root, 'diagnostics') : null;
}

module.exports = {
  PORTABLE_DATA_DIRECTORY_NAME,
  executableDirectory,
  isPortableRuntime,
  portableDataRoot,
  portableLogDirectory,
  portableDiagnosticsDirectory
};
