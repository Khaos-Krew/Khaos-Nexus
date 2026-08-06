'use strict';

const fs = require('node:fs');

const SAFE_PARENT_ENV_KEYS = new Set([
  'allusersprofile',
  'appdata',
  'commonprogramfiles',
  'commonprogramfiles(x86)',
  'commonprogramw6432',
  'comspec',
  'home',
  'homedrive',
  'homepath',
  'lang',
  'lc_all',
  'localappdata',
  'number_of_processors',
  'os',
  'path',
  'pathext',
  'processor_architecture',
  'processor_identifier',
  'processor_level',
  'processor_revision',
  'programdata',
  'programfiles',
  'programfiles(x86)',
  'programw6432',
  'public',
  'systemdrive',
  'systemroot',
  'temp',
  'tmp',
  'tmpdir',
  'userdomain',
  'username',
  'userprofile',
  'windir'
]);

function cleanText(value, max = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeParentEnvironment(parentEnv = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(parentEnv || {})) {
    if (!SAFE_PARENT_ENV_KEYS.has(String(key).toLowerCase())) continue;
    if (value === undefined || value === null) continue;
    result[key] = String(value);
  }
  return result;
}

function buildServiceEnvironment({ serviceEnv = {}, serviceData = '', parentEnv = process.env } = {}) {
  return {
    ...safeParentEnvironment(parentEnv),
    ...serviceEnv,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    DATA_DIR: String(serviceData || ''),
    KHAOS_NEXUS_BUNDLED_SERVICE: '1'
  };
}

function readTail(filePath, maxBytes = 64 * 1024) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const size = fs.statSync(filePath).size;
  const length = Math.min(size, maxBytes);
  if (length <= 0) return '';
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function readLatestSidecarDiagnostic(filePath) {
  let text = '';
  try { text = readTail(filePath); } catch { return null; }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const value = JSON.parse(line);
      if (!String(value?.event || '').startsWith('nexus-ai-core.')) continue;
      if (!cleanText(value?.code, 120) || !Number.isInteger(value?.exitCode)) continue;
      return Object.freeze({
        event: cleanText(value.event, 160),
        code: cleanText(value.code, 120),
        exitCode: value.exitCode
      });
    } catch {}
  }
  return null;
}

function formatSidecarDiagnostic(label, diagnostic) {
  if (!diagnostic) return '';
  return `${cleanText(label, 80)} startup failed (${diagnostic.code}, exit ${diagnostic.exitCode}).`;
}

module.exports = {
  SAFE_PARENT_ENV_KEYS,
  safeParentEnvironment,
  buildServiceEnvironment,
  readLatestSidecarDiagnostic,
  formatSidecarDiagnostic
};
