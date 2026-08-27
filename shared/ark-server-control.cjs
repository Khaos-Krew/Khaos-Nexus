'use strict';

const path = require('node:path');

const ARK_FILE_KEYS = Object.freeze({
  gameUserSettings: { label: 'GameUserSettings.ini', format: 'ini', restartRequired: true },
  gameIni: { label: 'Game.ini', format: 'ini', restartRequired: true },
  arkShop: { label: 'ArkShop config', format: 'json', restartRequired: false }
});

function clean(value, max = 500) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function normalizeRemotePath(value) {
  const input = clean(value, 1000).replace(/\\/g, '/');
  if (!input) return '';
  if (!input.startsWith('/')) throw new Error('ARK control file paths must be absolute panel paths.');
  const normalized = path.posix.normalize(input);
  if (!normalized.startsWith('/') || normalized.includes('/../') || normalized.endsWith('/..')) {
    throw new Error('ARK control file path traversal is not allowed.');
  }
  return normalized;
}

function normalizeArkControl(input = {}) {
  const paths = input.paths || {};
  return {
    enabled: input.enabled !== false,
    providerId: clean(input.providerId, 120),
    panelServerIdentifier: clean(input.panelServerIdentifier, 120),
    paths: {
      gameUserSettings: normalizeRemotePath(paths.gameUserSettings || ''),
      gameIni: normalizeRemotePath(paths.gameIni || ''),
      arkShop: normalizeRemotePath(paths.arkShop || '')
    },
    arkShopReloadCommand: clean(input.arkShopReloadCommand || 'ArkShop.Reload', 120) || 'ArkShop.Reload'
  };
}

function normalizeArkShopMysql(input = {}) {
  return {
    enabled: input.enabled !== false,
    host: clean(input.host, 255),
    port: Math.min(65535, Math.max(1, Number(input.port) || 3306)),
    database: clean(input.database, 128),
    user: clean(input.user, 128),
    ssl: Boolean(input.ssl),
    connectTimeoutMs: Math.min(30000, Math.max(1000, Number(input.connectTimeoutMs) || 8000))
  };
}

function filePolicy(fileKey) {
  const policy = ARK_FILE_KEYS[fileKey];
  if (!policy) throw new Error('This ARK file is not on Sentinel’s edit allowlist.');
  return policy;
}

function resolveAllowedPath(server, fileKey) {
  const policy = filePolicy(fileKey);
  const control = normalizeArkControl(server?.arkControl || {});
  if (!control.enabled) throw new Error('ARK file control is disabled for this server.');
  const remotePath = control.paths[fileKey];
  if (!remotePath) throw new Error(`${policy.label} path is not configured for this server.`);
  return { policy, control, remotePath };
}

function validateContent(fileKey, content) {
  const policy = filePolicy(fileKey);
  const text = String(content ?? '');
  if (text.includes('\u0000')) throw new Error(`${policy.label} contains a NUL byte and will not be written.`);
  if (Buffer.byteLength(text, 'utf8') > 4 * 1024 * 1024) throw new Error(`${policy.label} exceeds Sentinel’s 4 MiB guarded-write limit.`);
  if (policy.format === 'json') {
    try { JSON.parse(text); }
    catch (error) { throw new Error(`${policy.label} is not valid JSON: ${error.message}`); }
  }
  return text;
}

function setIniValue(content, sectionInput, keyInput, valueInput) {
  const section = clean(sectionInput, 200);
  const key = clean(keyInput, 200);
  const value = String(valueInput ?? '').replace(/[\r\n]/g, '');
  if (!section || !key) throw new Error('INI section and key are required.');
  if (/^[;#]/.test(key) || key.includes('=') || section.includes(']')) throw new Error('Invalid INI section or key.');

  const newline = String(content).includes('\r\n') ? '\r\n' : '\n';
  const lines = String(content).split(/\r?\n/);
  const sectionHeader = `[${section}]`;
  let sectionStart = -1;
  let sectionEnd = lines.length;
  let keyIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (/^\[[^\]]+\]$/.test(trimmed)) {
      if (sectionStart >= 0) { sectionEnd = i; break; }
      if (trimmed.toLowerCase() === sectionHeader.toLowerCase()) sectionStart = i;
      continue;
    }
    if (sectionStart >= 0) {
      const match = lines[i].match(/^\s*([^;#][^=]*?)\s*=/);
      if (match && match[1].trim().toLowerCase() === key.toLowerCase()) keyIndex = i;
    }
  }

  const replacement = `${key}=${value}`;
  if (keyIndex >= 0) lines[keyIndex] = replacement;
  else if (sectionStart >= 0) lines.splice(sectionEnd, 0, replacement);
  else {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push(sectionHeader, replacement);
  }
  return lines.join(newline);
}

function setJsonValue(content, jsonPath, value) {
  const segments = Array.isArray(jsonPath) ? jsonPath : String(jsonPath || '').split('.').filter(Boolean);
  if (!segments.length || segments.length > 12) throw new Error('A JSON path with 1–12 segments is required.');
  if (segments.some((segment) => !/^[A-Za-z0-9_-]{1,100}$/.test(String(segment)))) throw new Error('ArkShop JSON path contains an invalid segment.');
  const root = JSON.parse(String(content));
  let current = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (!current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) current[segment] = {};
    current = current[segment];
  }
  current[segments[segments.length - 1]] = value;
  return `${JSON.stringify(root, null, 2)}\n`;
}

module.exports = {
  ARK_FILE_KEYS,
  normalizeRemotePath,
  normalizeArkControl,
  normalizeArkShopMysql,
  filePolicy,
  resolveAllowedPath,
  validateContent,
  setIniValue,
  setJsonValue
};