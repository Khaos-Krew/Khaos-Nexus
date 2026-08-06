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

const SAFE_SERVICE_ENV_KEYS = new Set([
  'host',
  'port',
  'ai_provider',
  'campaign_store',
  'auth_required',
  'electron_run_as_node',
  'node_env',
  'data_dir',
  'khaos_nexus_bundled_service',
  'nexus_ai_core_service_token',
  'nexus_ai_core_startup_nonce',
  'nexus_ai_core_ready_file',
  'monitor_state_file',
  'nexus_ai_core_parent_pid'
]);

function cleanText(value, max = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function copyAllowedEnvironment(source, allowedKeys) {
  const result = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (!allowedKeys.has(String(key).toLowerCase())) continue;
    if (value === undefined || value === null) continue;
    result[key] = String(value);
  }
  return result;
}

function safeParentEnvironment(parentEnv = process.env) {
  return copyAllowedEnvironment(parentEnv, SAFE_PARENT_ENV_KEYS);
}

function sanitizeBundledAiEnvironment(candidateEnv = {}) {
  const allowed = new Set([...SAFE_PARENT_ENV_KEYS, ...SAFE_SERVICE_ENV_KEYS]);
  const env = copyAllowedEnvironment(candidateEnv, allowed);
  env.ELECTRON_RUN_AS_NODE = '1';
  env.NODE_ENV = 'production';
  env.KHAOS_NEXUS_BUNDLED_SERVICE = '1';
  delete env.NODE_OPTIONS;
  delete env.Node_Options;
  delete env.NODE_PATH;
  delete env.Node_Path;
  return env;
}

function buildServiceEnvironment({ serviceEnv = {}, serviceData = '', parentEnv = process.env } = {}) {
  return sanitizeBundledAiEnvironment({
    ...safeParentEnvironment(parentEnv),
    ...serviceEnv,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    DATA_DIR: String(serviceData || ''),
    KHAOS_NEXUS_BUNDLED_SERVICE: '1'
  });
}

function fileSize(filePath) {
  try { return filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0; }
  catch { return 0; }
}

function readRangeTail(filePath, startOffset = 0, maxBytes = 64 * 1024) {
  if (!filePath || !fs.existsSync(filePath)) return '';
  const size = fs.statSync(filePath).size;
  const boundedStart = Math.max(0, Math.min(size, Number(startOffset) || 0));
  const available = size - boundedStart;
  const length = Math.min(available, maxBytes);
  if (length <= 0) return '';
  const offset = size - length;
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, offset);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function readLatestSidecarDiagnostic(filePath, startOffset = 0) {
  let text = '';
  try { text = readRangeTail(filePath, startOffset); } catch { return null; }
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
  SAFE_SERVICE_ENV_KEYS,
  safeParentEnvironment,
  sanitizeBundledAiEnvironment,
  buildServiceEnvironment,
  fileSize,
  readLatestSidecarDiagnostic,
  formatSidecarDiagnostic
};
