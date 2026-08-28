'use strict';

const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');
const { findDirectoryNamed, joinRemote } = require('./ark-sftp-discovery.cjs');

const LOG_CANDIDATES = [
  'Binaries/Win64/logs/ArkApi.log',
  'Win64/logs/ArkApi.log'
];

function redactLogLine(value) {
  return String(value || '')
    .replace(/(mysqlpass|password|passwd|token|secret|credential)\s*[:=]\s*[^\s,;]+/ig, '$1=[redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/ig, '$1[redacted]@')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[redacted-token]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function relevantLogLines(text, limit = 20) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => /(arkshop|mysql|database|db error|failed to open|failed to create table)/i.test(line));
  return lines.slice(-Math.max(1, Math.min(40, Number(limit) || 20))).map(redactLogLine).filter(Boolean);
}

async function inspectArkApiLog(prefix = 'ARK_GEN1') {
  const settings = sftpSettingsFromEnv(prefix);
  if (!settings.host || !settings.username || !settings.password) throw new Error('ARK SFTP variables are incomplete.');
  const client = new SftpClient('khaos-nexus-ark-api-log');
  await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout });
  try {
    const shooterGame = await findDirectoryNamed(client, { starts: [settings.root || '.', '.'], directoryName: 'ShooterGame', maxDepth: 4, maxDirectories: 100, maxEntries: 1500 });
    if (!shooterGame) return { found: false, reason: 'ShooterGame directory not found' };
    let logPath = '';
    for (const suffix of LOG_CANDIDATES) {
      const candidate = joinRemote(shooterGame.path, suffix);
      try {
        const exists = await client.exists(candidate);
        if (exists && exists !== 'd') { logPath = candidate; break; }
      } catch {}
    }
    if (!logPath) return { found: false, reason: 'ArkApi.log not found in known ASA API log locations', shooterGameRoot: shooterGame.path };
    const stat = await client.stat(logPath).catch(() => null);
    const bytes = Number(stat?.size) || 0;
    if (bytes > 8 * 1024 * 1024) return { found: true, path: logPath, bytes, skipped: 'log-too-large' };
    const data = await client.get(logPath);
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
    const lines = relevantLogLines(text, 20);
    return { found: true, path: logPath, bytes: Buffer.byteLength(text), lines };
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = { LOG_CANDIDATES, redactLogLine, relevantLogLines, inspectArkApiLog };
