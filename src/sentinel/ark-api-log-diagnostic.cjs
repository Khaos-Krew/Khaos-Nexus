'use strict';

const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');
const { findDirectoryNamed, joinRemote } = require('./ark-sftp-discovery.cjs');

const LOG_CANDIDATES = [
  'Binaries/Win64/logs/ArkApi.log',
  'Win64/logs/ArkApi.log'
];
const SAVED_LOGS_SUFFIX = 'Saved/Logs';
const MAX_LOG_BYTES = 8 * 1024 * 1024;
const MAX_SAVED_LOG_FILES = 6;

function redactLogLine(value) {
  return String(value || '')
    .replace(/(mysqlpass|password|passwd|token|secret|credential)\s*[:=]\s*[^\s,;]+/ig, '$1=[redacted]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/ig, '$1[redacted]@')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[redacted-token]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function relevantLogLines(text, limit = 20) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => /(arkshop|mysql|mariadb|sqlstate|database|db error|failed to (?:open|create|connect)|plugin.*arkshop)/i.test(line));
  return lines.slice(-Math.max(1, Math.min(40, Number(limit) || 20))).map(redactLogLine).filter(Boolean);
}

function apiLifecycleLines(text, limit = 30) {
  const lifecycle = /(ark:sa api|api was successfully loaded|loaded all plugins|load(?:ing|ed) plugin|failed to get the offset|requested by:\s*plugin)/i;
  const lines = String(text || '').split(/\r?\n/).filter((line) => lifecycle.test(line));
  return lines.slice(-Math.max(1, Math.min(60, Number(limit) || 30))).map(redactLogLine).filter(Boolean);
}

function startupIssueLines(text, limit = 30) {
  const genericIssue = /(fatal(?: error)?|critical|exception|\bassert(?:ion)?\b|ensure condition failed|failed to|\bfailure\b|\bshutdown\b|terminat(?:e|ed|ing)|\bcrash(?:ed|ing)?\b)/i;
  const pluginOrDatabaseIssue = /(?:arkshop|mysql|mariadb|database|sqlstate).*(?:fail(?:ed|ure)?|error|unable|denied|refused|timeout)/i;
  const rconIssue = /(?:\brcon\b.*(?:fail(?:ed|ure)?|error|unable|denied|refused|timeout|timed out|bind|closed|wedge)|(?:fail(?:ed|ure)?|error|unable|denied|refused|timeout|timed out|bind|closed|wedge).*\brcon\b)/i;
  const apiOffsetIssue = /(failed to get the offset|requested by:\s*plugin)/i;
  const lines = String(text || '').split(/\r?\n/).filter((line) => genericIssue.test(line) || pluginOrDatabaseIssue.test(line) || rconIssue.test(line) || apiOffsetIssue.test(line));
  return lines.slice(-Math.max(1, Math.min(60, Number(limit) || 30))).map(redactLogLine).filter(Boolean);
}

function safeFileName(value) {
  return String(value || '').replace(/[\r\n\u0000-\u001f\u007f]/g, '_').slice(0, 180);
}

function isFile(entry) {
  return entry && entry.type !== 'd' && !String(entry.permissions || '').startsWith('d');
}

function logLike(entry) {
  const name = String(entry?.name || '').toLowerCase();
  return isFile(entry) && (name.endsWith('.log') || name.endsWith('.txt') || name.includes('crash'));
}

async function readBoundedLog(client, remotePath, sizeHint = 0) {
  const stat = sizeHint ? { size: sizeHint } : await client.stat(remotePath).catch(() => null);
  const bytes = Number(stat?.size) || 0;
  if (bytes > MAX_LOG_BYTES) return { path: remotePath, bytes, skipped: 'log-too-large', lines: [], issues: [], lifecycle: [] };
  const data = await client.get(remotePath);
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  return {
    path: remotePath,
    bytes: Buffer.byteLength(text),
    lines: relevantLogLines(text, 30),
    issues: startupIssueLines(text, 40),
    lifecycle: apiLifecycleLines(text, 40)
  };
}

async function inspectSavedLogs(client, shooterGameRoot) {
  const directory = joinRemote(shooterGameRoot, SAVED_LOGS_SUFFIX);
  let entries;
  try { entries = await client.list(directory); }
  catch { return { directory, accessible: false, filesSeen: [], filesScanned: [], lines: [], issues: [], lifecycle: [] }; }

  const candidates = entries.filter(logLike).sort((a, b) => Number(b.modifyTime || 0) - Number(a.modifyTime || 0));
  const filesSeen = candidates.slice(0, 20).map((entry) => safeFileName(entry.name));
  const filesScanned = [];
  const lines = [];
  const issues = [];
  const lifecycle = [];
  for (const entry of candidates.slice(0, MAX_SAVED_LOG_FILES)) {
    const remotePath = joinRemote(directory, entry.name);
    const result = await readBoundedLog(client, remotePath, Number(entry.size) || 0).catch(() => null);
    if (!result) continue;
    filesScanned.push({ name: safeFileName(entry.name), bytes: result.bytes, skipped: result.skipped || '' });
    for (const line of result.lines || []) lines.push(`[${safeFileName(entry.name)}] ${line}`);
    for (const line of result.issues || []) issues.push(`[${safeFileName(entry.name)}] ${line}`);
    for (const line of result.lifecycle || []) lifecycle.push(`[${safeFileName(entry.name)}] ${line}`);
  }
  return {
    directory,
    accessible: true,
    filesSeen,
    filesScanned,
    lines: lines.slice(-30),
    issues: issues.slice(-50),
    lifecycle: lifecycle.slice(-50)
  };
}

async function inspectArkApiLog(prefix = 'ARK_GEN1') {
  const settings = sftpSettingsFromEnv(prefix);
  if (!settings.host || !settings.username || !settings.password) throw new Error('ARK SFTP variables are incomplete.');
  const client = new SftpClient('khaos-nexus-ark-api-log');
  await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout });
  try {
    const shooterGame = await findDirectoryNamed(client, { starts: [settings.root || '.', '.'], directoryName: 'ShooterGame', maxDepth: 4, maxDirectories: 100, maxEntries: 1500 });
    if (!shooterGame) return { found: false, reason: 'ShooterGame directory not found' };

    for (const suffix of LOG_CANDIDATES) {
      const candidate = joinRemote(shooterGame.path, suffix);
      try {
        const exists = await client.exists(candidate);
        if (!exists || exists === 'd') continue;
        const result = await readBoundedLog(client, candidate);
        return { found: true, source: 'ark-api', shooterGameRoot: shooterGame.path, ...result };
      } catch {}
    }

    const saved = await inspectSavedLogs(client, shooterGame.path);
    if (saved.accessible) {
      return {
        found: true,
        source: 'saved-logs-fallback',
        path: saved.directory,
        shooterGameRoot: shooterGame.path,
        bytes: saved.filesScanned.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0),
        filesSeen: saved.filesSeen,
        filesScanned: saved.filesScanned,
        lines: saved.lines,
        issues: saved.issues,
        lifecycle: saved.lifecycle,
        note: 'ArkApi.log was not exposed; inspected bounded recent ShooterGame/Saved/Logs files instead.'
      };
    }

    return {
      found: false,
      reason: 'ArkApi.log and ShooterGame/Saved/Logs are not exposed in the SFTP view',
      shooterGameRoot: shooterGame.path
    };
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = {
  LOG_CANDIDATES,
  SAVED_LOGS_SUFFIX,
  MAX_LOG_BYTES,
  MAX_SAVED_LOG_FILES,
  redactLogLine,
  relevantLogLines,
  apiLifecycleLines,
  startupIssueLines,
  safeFileName,
  inspectSavedLogs,
  inspectArkApiLog
};
