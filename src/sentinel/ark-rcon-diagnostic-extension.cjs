'use strict';

const { Client, Events } = require('discord.js');
const SftpClient = require('ssh2-sftp-client');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { GAME_USER_SETTINGS_PATH, sftpSettingsFromEnv, remotePath } = require('./ark-sftp-config.cjs');
const { findRemoteFile } = require('./ark-sftp-discovery.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.rcon.diagnostic.extension');
const BOUND = Symbol.for('khaos.nexus.ark.rcon.diagnostic.bound');
const PREFIXES = Object.freeze(['ARK_GEN1', 'ARK_MAP2']);
const INITIAL_DELAY_MS = 12_000;
const INTERVAL_MS = 5 * 60_000;

function configured(prefix, env = process.env) {
  return Boolean(String(env[`${prefix}_HOST`] || '').trim() && String(env[`${prefix}_RCON_PORT`] || '').trim());
}

function classifyRconError(error) {
  const message = String(error?.message || error || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
  const lower = message.toLowerCase();
  if (/econnrefused|connection refused/.test(lower)) return { code: 'connection-refused', message };
  if (/etimedout|tcp connection timed out/.test(lower)) return { code: 'tcp-timeout', message };
  if (/authentication failed/.test(lower)) return { code: 'auth-failed', message };
  if (/authentication response timed out/.test(lower)) return { code: 'auth-timeout', message };
  if (/closed before authentication/.test(lower)) return { code: 'closed-before-auth', message };
  if (/command response timed out/.test(lower)) return { code: 'command-timeout', message };
  if (/password is missing/.test(lower)) return { code: 'password-missing', message };
  if (/port is invalid/.test(lower)) return { code: 'port-invalid', message };
  if (/host is missing/.test(lower)) return { code: 'host-missing', message };
  return { code: 'other', message };
}

async function probePrefix(prefix, env = process.env) {
  if (!configured(prefix, env)) return { prefix, skipped: 'not-configured' };
  const server = arkServerFromEnv(prefix);
  try {
    const client = new ArkRconClient({ host: server.host, port: server.port, password: server.password, timeoutMs: 8_000 });
    const response = await client.execute('ListPlayers');
    return {
      prefix,
      serverName: server.name,
      host: server.host,
      port: server.port,
      ok: true,
      responseBytes: Buffer.byteLength(String(response || ''))
    };
  } catch (error) {
    const classified = classifyRconError(error);
    return {
      prefix,
      serverName: server.name,
      host: server.host,
      port: server.port,
      ok: false,
      errorCode: classified.code,
      error: classified.message
    };
  }
}

function signature(result = {}) {
  return [result.prefix, result.ok === true ? 'ok' : 'fail', result.errorCode || '', result.error || ''].join('|');
}

function logResult(result, reason = 'periodic') {
  if (result?.skipped) return;
  if (result.ok) {
    console.log(`[Nexus Sentinal] ARK RCON diagnostic (${reason}): prefix=${result.prefix} server=${result.serverName || result.prefix} endpoint=${result.host}:${result.port} ok=true responseBytes=${result.responseBytes || 0}`);
    return;
  }
  console.warn(`[Nexus Sentinal] ARK RCON diagnostic (${reason}): prefix=${result.prefix} server=${result.serverName || result.prefix} endpoint=${result.host}:${result.port} ok=false class=${result.errorCode || 'other'} error=${result.error || 'unknown'}`);
}

function parseServerSettings(input) {
  const wanted = new Set(['rconenabled', 'rconport', 'serveradminpassword']);
  const values = { rconenabled: [], rconport: [], serveradminpassword: [] };
  let section = '';
  for (const raw of String(input || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim().toLowerCase();
      continue;
    }
    if (section !== 'serversettings') continue;
    const equals = line.indexOf('=');
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim().toLowerCase();
    if (!wanted.has(key)) continue;
    values[key].push(line.slice(equals + 1).trim());
  }

  const normalizedEnabled = [...new Set(values.rconenabled.map((value) => value.toLowerCase()))];
  const normalizedPorts = [...new Set(values.rconport.map((value) => value.trim()).filter(Boolean))];
  return {
    rconEnabled: normalizedEnabled.length === 1 ? normalizedEnabled[0] : normalizedEnabled.length ? 'conflict' : 'missing',
    rconPorts: normalizedPorts,
    passwordPresent: values.serveradminpassword.some((value) => String(value).length > 0),
    duplicateRconEnabled: values.rconenabled.length > 1,
    duplicateRconPort: values.rconport.length > 1,
    duplicateAdminPassword: values.serveradminpassword.length > 1
  };
}

function sanitizeRemotePath(value) {
  return String(value || '').replace(/[\r\n|]/g, '_').slice(0, 260);
}

async function readRemoteText(client, file) {
  const data = await client.get(file);
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
}

async function existingFile(client, file) {
  try {
    const exists = await client.exists(file);
    return Boolean(exists) && exists !== 'd';
  } catch {
    return false;
  }
}

async function inspectRconIni(prefix = 'ARK_MAP2', env = process.env) {
  const settings = sftpSettingsFromEnv(prefix);
  if (!settings.host || !settings.username || !settings.password) {
    return { prefix, ok: false, verdict: 'sftp-credentials-incomplete', files: [] };
  }

  const client = new SftpClient(`khaos-nexus-rcon-config-${prefix.toLowerCase()}`);
  await client.connect({
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: settings.password,
    readyTimeout: settings.readyTimeout
  });

  try {
    const configuredPath = String(env[`${prefix}_GUS_PATH`] || '').trim();
    const standard = await findRemoteFile(client, {
      configuredRoot: settings.root,
      configuredPath,
      fileName: 'GameUserSettings.ini',
      preferredSuffix: GAME_USER_SETTINGS_PATH,
      maxDepth: 6,
      maxDirectories: 180,
      maxEntries: 2800
    });

    const candidates = new Set([standard.path]);
    const normalized = String(standard.path || '').replace(/\\/g, '/');
    const marker = '/Saved/Config/WindowsServer/GameUserSettings.ini';
    if (normalized.endsWith(marker)) {
      const shooterRoot = normalized.slice(0, -marker.length);
      const mapName = String(env[`${prefix}_MAP`] || (prefix === 'ARK_MAP2' ? 'Astraeos_WP' : '')).trim();
      if (mapName) candidates.add(`${shooterRoot}/Saved/Config/WindowsServer/Maps/${mapName}/GameUserSettings.ini`);
    }
    if (configuredPath) candidates.add(remotePath(settings.root, configuredPath));

    const files = [];
    for (const file of candidates) {
      if (!file || !(await existingFile(client, file))) continue;
      const parsed = parseServerSettings(await readRemoteText(client, file));
      files.push({ path: sanitizeRemotePath(file), ...parsed });
    }

    const sentinelPort = Number(env[`${prefix}_RCON_PORT`] || 0);
    const enabledValues = [...new Set(files.map((item) => item.rconEnabled).filter((value) => value !== 'missing'))];
    const iniPorts = [...new Set(files.flatMap((item) => item.rconPorts))];
    let verdict = 'config-readable';
    if (!files.length) verdict = 'gus-not-found';
    else if (enabledValues.includes('conflict') || enabledValues.length > 1) verdict = 'rcon-enabled-conflict';
    else if (enabledValues.some((value) => ['false', '0', 'no', 'off'].includes(value))) verdict = 'rcon-disabled';
    else if (iniPorts.length > 1) verdict = 'rcon-port-conflict';
    else if (iniPorts.length === 1 && sentinelPort > 0 && Number(iniPorts[0]) !== sentinelPort) verdict = 'rcon-port-mismatch';
    else if (!iniPorts.length) verdict = 'rcon-port-not-in-ini';
    else if (enabledValues.some((value) => ['true', '1', 'yes', 'on'].includes(value)) && Number(iniPorts[0]) === sentinelPort) verdict = 'ini-matches-sentinel';

    return { prefix, ok: true, sentinelPort, verdict, files };
  } finally {
    await client.end().catch(() => {});
  }
}

function logRconIniInspection(result) {
  if (!result?.ok) {
    console.warn(`[Nexus Sentinal] ARK RCON INI diagnostic: prefix=${result?.prefix || 'ARK_MAP2'} ok=false verdict=${result?.verdict || 'unknown'}`);
    return;
  }
  console.log(`[Nexus Sentinal] ARK RCON INI diagnostic: prefix=${result.prefix} sentinelPort=${result.sentinelPort || 'missing'} verdict=${result.verdict} files=${result.files.length}`);
  for (const file of result.files) {
    console.log(`[Nexus Sentinal] ARK RCON INI file: prefix=${result.prefix} path=${file.path} rconEnabled=${file.rconEnabled} rconPorts=${file.rconPorts.join(',') || 'missing'} adminPasswordPresent=${file.passwordPresent} duplicateEnabled=${file.duplicateRconEnabled} duplicatePort=${file.duplicateRconPort} duplicateAdminPassword=${file.duplicateAdminPassword}`);
  }
}

function installArkRconDiagnosticExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkRconDiagnosticLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.once(Events.ClientReady, () => {
        const previous = new Map();
        const run = async (reason) => {
          for (const prefix of PREFIXES) {
            const result = await probePrefix(prefix);
            if (result.skipped) continue;
            const next = signature(result);
            const prior = previous.get(prefix);
            if (reason === 'startup' || next !== prior) logResult(result, reason);
            previous.set(prefix, next);
          }
        };
        const initial = setTimeout(() => {
          void run('startup').catch((error) => console.warn(`[Nexus Sentinal] ARK RCON diagnostic startup failed: ${String(error?.message || error).slice(0, 300)}`));
          void inspectRconIni('ARK_MAP2').then(logRconIniInspection).catch((error) => console.warn(`[Nexus Sentinal] ARK RCON INI diagnostic failed: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 300)}`));
        }, INITIAL_DELAY_MS);
        initial.unref?.();
        const timer = setInterval(() => void run('state-change').catch((error) => console.warn(`[Nexus Sentinal] ARK RCON diagnostic cycle failed: ${String(error?.message || error).slice(0, 300)}`)), INTERVAL_MS);
        timer.unref?.();
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  PREFIXES,
  classifyRconError,
  probePrefix,
  signature,
  parseServerSettings,
  inspectRconIni,
  installArkRconDiagnosticExtension
};
