'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 1440;

function monitorEnabled() {
  // Background update monitoring is retired. Update safety is deliberately
  // collected only from the staff button or /ark-health interaction.
  return false;
}

function monitorIntervalMinutes(env = process.env) {
  const parsed = Number(env.ARK_UPDATE_MONITOR_INTERVAL_MINUTES || DEFAULT_INTERVAL_MINUTES);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MINUTES;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(parsed)));
}

function compatibleBuildIds(env = process.env) {
  return new Set(String(env.ARK_UPDATE_API_COMPAT_BUILD_IDS || '').split(',').map((value) => value.trim()).filter(Boolean));
}

function apiCompatibilityEvidence(report = {}, env = process.env) {
  const game = report.game || {};
  const api = report.api || {};
  if (game.updateAvailable !== true) return { verified: true, source: 'no-pending-game-update' };

  const publicBuildId = String(game.publicBuildId || '').trim();
  if (publicBuildId && compatibleBuildIds(env).has(publicBuildId)) {
    return { verified: true, source: 'explicit-build-allowlist', publicBuildId };
  }

  const gamePublished = Date.parse(game.publicBuildUpdatedAt || '');
  const apiPublished = Date.parse(api.releasePublishedAt || '');
  if (Number.isFinite(gamePublished) && Number.isFinite(apiPublished) && apiPublished >= gamePublished) {
    return { verified: true, source: 'post-build-api-release', publicBuildId };
  }

  return { verified: false, source: 'unverified', publicBuildId };
}

function enforceCompatibilityVerdict(report = {}, env = process.env) {
  const evidence = apiCompatibilityEvidence(report, env);
  const api = { ...(report.api || {}), compatibleBuild: evidence.verified, compatibilitySource: evidence.source };
  if (evidence.verified || report.game?.updateAvailable !== true) return { ...report, api };

  const reason = `ASA build ${report.game?.publicBuildId || 'unknown'} is newer than available ArkApi compatibility evidence.`;
  const prior = report.verdict || {};
  const blockers = [...new Set([...(prior.blockers || []), reason])];
  return {
    ...report,
    api,
    verdict: {
      ...prior,
      level: 'hold',
      label: '🔴 HOLD',
      blockers
    }
  };
}

function normalizePendingMods(mods = []) {
  return (Array.isArray(mods) ? mods : [])
    .map((item) => ({
      modId: String(item?.modId || ''),
      fileId: String(item?.fileId || ''),
      latestFileId: String(item?.latestFileId || ''),
      name: String(item?.name || '')
    }))
    .filter((item) => item.modId)
    .sort((a, b) => a.modId.localeCompare(b.modId) || a.latestFileId.localeCompare(b.latestFileId));
}

function snapshotReport(report = {}) {
  const verdict = report.verdict || {};
  const server = report.server || {};
  const game = report.game || {};
  const api = report.api || {};
  const plugins = report.plugins || {};
  const mods = report.mods || {};
  return {
    verdict: String(verdict.level || 'unknown'),
    server: { rcon: String(server.rcon || 'unknown') },
    game: {
      runtimeVersion: String(game.runtimeVersion || ''),
      installedBuildId: String(game.installedBuildId || ''),
      publicBuildId: String(game.publicBuildId || ''),
      updateAvailable: game.updateAvailable === true ? true : game.updateAvailable === false ? false : null
    },
    api: {
      health: String(api.health || 'unknown'),
      installedVersion: String(api.installedVersion || ''),
      latestKnown: String(api.latestKnown || ''),
      updateAvailable: Boolean(api.updateAvailable),
      offsetFailure: Boolean(api.offsetFailure),
      compatibleBuild: api.compatibleBuild === true,
      compatibilitySource: String(api.compatibilitySource || '')
    },
    plugins: {
      status: String(plugins.status || 'unknown'),
      missing: (Array.isArray(plugins.missing) ? plugins.missing : []).map(String).sort()
    },
    mods: {
      status: String(mods.status || 'unknown'),
      activeCount: Number(mods.activeCount || 0),
      installedCount: Number(mods.installedCount || 0),
      pendingCount: Number(mods.pendingCount || 0),
      pending: normalizePendingMods(mods.pending)
    }
  };
}

function reportFingerprint(report = {}) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshotReport(report))).digest('hex');
}

function samePending(left = [], right = []) {
  return JSON.stringify(normalizePendingMods(left)) === JSON.stringify(normalizePendingMods(right));
}

function classifyChanges(previous = null, current = {}) {
  if (!previous) return [];
  const before = previous.verdict ? previous : snapshotReport(previous);
  const after = current.verdict ? current : snapshotReport(current);
  const changes = [];
  const push = (kind, severity, message, modRelated = false) => changes.push({ kind, severity, message, modRelated });

  if (before.verdict !== after.verdict) {
    const severity = after.verdict === 'hold' ? 'critical' : after.verdict === 'safe' ? 'recovery' : 'warning';
    push('verdict', severity, `Update verdict changed: ${String(before.verdict).toUpperCase()} → ${String(after.verdict).toUpperCase()}.`);
  }
  if (before.server?.rcon !== after.server?.rcon) {
    push('rcon', after.server?.rcon === 'pass' ? 'recovery' : 'critical', `RCON health changed: ${before.server?.rcon || 'unknown'} → ${after.server?.rcon || 'unknown'}.`);
  }
  if (before.game?.updateAvailable !== after.game?.updateAvailable) {
    if (after.game?.updateAvailable === true) push('game-update', 'warning', `New ASA server build detected: ${after.game.installedBuildId || '?'} → ${after.game.publicBuildId || '?'}.`);
    else if (after.game?.updateAvailable === false) push('game-update-clear', 'recovery', `ASA server is now on the current public build (${after.game.installedBuildId || '?'}).`);
    else push('game-update-unknown', 'warning', 'ASA server build comparison became unavailable.');
  } else if (after.game?.updateAvailable === true && before.game?.publicBuildId !== after.game?.publicBuildId) {
    push('game-update-revised', 'warning', `ASA public build changed again while an update is pending: ${before.game?.publicBuildId || '?'} → ${after.game?.publicBuildId || '?'}.`);
  }
  if (before.api?.health !== after.api?.health || before.api?.offsetFailure !== after.api?.offsetFailure) {
    push('api-health', after.api?.health === 'pass' ? 'recovery' : after.api?.health === 'fail' ? 'critical' : 'warning', `ASA Server API health changed: ${before.api?.health || 'unknown'} → ${after.api?.health || 'unknown'}${after.api?.offsetFailure ? ' (missing offset detected)' : ''}.`);
  }
  if (before.api?.compatibleBuild !== after.api?.compatibleBuild || before.api?.compatibilitySource !== after.api?.compatibilitySource) {
    push('api-build-compatibility', after.api?.compatibleBuild ? 'recovery' : 'critical', after.api?.compatibleBuild
      ? `ArkApi compatibility evidence is now available for ASA build ${after.game?.publicBuildId || '?'}.`
      : `ArkApi compatibility is not yet verified for ASA build ${after.game?.publicBuildId || '?'}.`);
  }
  if (before.api?.updateAvailable !== after.api?.updateAvailable || before.api?.latestKnown !== after.api?.latestKnown) {
    if (after.api?.updateAvailable) push('api-update', 'warning', `ASA Server API update available: ${after.api.installedVersion || '?'} → ${after.api.latestKnown || '?'}.`);
    else if (before.api?.updateAvailable && !after.api?.updateAvailable) push('api-update-clear', 'recovery', `ASA Server API is current (${after.api?.installedVersion || after.api?.latestKnown || '?'}).`);
  }
  if (before.plugins?.status !== after.plugins?.status || JSON.stringify(before.plugins?.missing || []) !== JSON.stringify(after.plugins?.missing || [])) {
    if (after.plugins?.status === 'fail') push('plugins', 'critical', `Critical API plugin problem: missing ${(after.plugins.missing || []).join(', ') || 'required plugin'}.`);
    else if (after.plugins?.status === 'pass') push('plugins-recovery', 'recovery', 'Critical API plugins are present again.');
    else push('plugins-unknown', 'warning', 'Critical API plugin state became unavailable.');
  }
  if (before.mods?.status !== after.mods?.status) {
    const severity = after.mods?.status === 'pass' ? 'recovery' : 'warning';
    push('mods-status', severity, `CurseForge mod freshness changed: ${before.mods?.status || 'unknown'} → ${after.mods?.status || 'unknown'}.`, true);
  }
  if (Number(before.mods?.pendingCount || 0) !== Number(after.mods?.pendingCount || 0) || !samePending(before.mods?.pending, after.mods?.pending)) {
    if (Number(after.mods?.pendingCount || 0) > 0) push('mod-updates', 'warning', `${after.mods.pendingCount} active ARK mod update${after.mods.pendingCount === 1 ? '' : 's'} detected.`, true);
    else if (Number(before.mods?.pendingCount || 0) > 0) push('mod-updates-clear', 'recovery', 'Previously pending ARK mod updates are now clear.', true);
  }
  return changes;
}

function stateFilePath(prefix = 'ARK_GEN1', env = process.env) {
  const explicit = String(env.ARK_UPDATE_STATE_PATH || '').trim();
  if (explicit) return explicit;
  const root = String(env.NEXUS_DATA_DIR || process.cwd()).trim() || process.cwd();
  const slug = String(prefix || 'ARK').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ark';
  return path.join(root, `${slug}-update-safety-state.json`);
}

function loadMonitorState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function saveMonitorState(file, state = {}) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
  return file;
}

function buildState(report = {}) {
  return {
    schema: 1,
    checkedAt: String(report.checkedAt || new Date().toISOString()),
    fingerprint: reportFingerprint(report),
    snapshot: snapshotReport(report)
  };
}

function shouldAlert(previousState, report, changes = classifyChanges(previousState?.snapshot || null, snapshotReport(report))) {
  if (!previousState?.fingerprint) return false;
  if (previousState.fingerprint === reportFingerprint(report)) return false;
  return changes.length > 0;
}

function severityGlyph(severity) {
  if (severity === 'critical') return '🔴';
  if (severity === 'warning') return '🟡';
  if (severity === 'recovery') return '✅';
  return 'ℹ️';
}

function formatMonitorAlert(report = {}, changes = [], serverName = 'ARK') {
  const verdict = String(report.verdict?.level || 'unknown').toUpperCase();
  const glyph = report.verdict?.level === 'hold' ? '🔴' : report.verdict?.level === 'safe' ? '✅' : '🟡';
  const lines = [`## ${glyph} ARK UPDATE HEALTH — ${serverName}`, `**Current verdict:** ${verdict}`, ''];
  for (const change of changes.slice(0, 10)) lines.push(`${severityGlyph(change.severity)} ${change.message}`);
  lines.push('', 'Use `/ark-health` for the full pre-update report.');
  lines.push('_Sentinel is advisory only and will never press the host update button automatically._');
  return lines.join('\n').slice(0, 1900);
}

function formatModAlert(report = {}, changes = [], serverName = 'ARK') {
  const pending = Array.isArray(report.mods?.pending) ? report.mods.pending : [];
  const lines = [`## 🧩 ARK MOD UPDATE WATCH — ${serverName}`];
  for (const change of changes.filter((item) => item.modRelated).slice(0, 6)) lines.push(`${severityGlyph(change.severity)} ${change.message}`);
  if (pending.length) {
    lines.push('', '**Pending:**');
    for (const mod of pending.slice(0, 8)) lines.push(`• ${mod.name || `Mod ${mod.modId}`}: ${mod.fileId || '?'} → ${mod.latestFileId || '?'}`);
  }
  lines.push('', 'Use `/ark-health` for the full update-safety verdict.');
  return lines.join('\n').slice(0, 1900);
}

function formatPreUpdateGate(report = {}) {
  const apiCompatRequired = report.game?.updateAvailable === true;
  const checks = [
    ['RCON responding', report.server?.rcon === 'pass'],
    ['ASA Server API healthy', report.api?.health === 'pass'],
    ['ArkApi evidence covers pending ASA build', !apiCompatRequired || report.api?.compatibleBuild === true],
    ['Critical API plugins present', report.plugins?.status === 'pass'],
    ['Mod freshness verified', report.mods?.status === 'pass'],
    ['No pending active mod updates', Number(report.mods?.pendingCount || 0) === 0]
  ];
  const healthReady = checks.every(([, ok]) => ok);
  const lines = ['**Pre-update gate:**', ...checks.map(([label, ok]) => `${ok ? '✅' : '❌'} ${label}`)];
  lines.push('⚠️ Before pressing Update, take/verify a world save plus ArkApi, plugin config, and ArkShop database/config backups.');
  lines.push(healthReady ? '✅ Compatibility health gates are clear.' : '🔴 Compatibility health gates are not clear.');
  return lines.join('\n');
}

function normalizeChannelName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function sendableChannel(channel) {
  return Boolean(channel && channel.isTextBased?.() && typeof channel.send === 'function');
}

async function resolveAlertChannel(guild, { modRelated = false, env = process.env } = {}) {
  const configuredId = String(modRelated ? env.ARK_MOD_UPDATE_CHANNEL_ID || '' : env.ARK_UPDATE_ALERT_CHANNEL_ID || '').trim();
  if (configuredId) {
    try {
      const direct = await guild.channels.fetch(configuredId);
      if (sendableChannel(direct)) return direct;
    } catch {}
  }
  const channels = await guild.channels.fetch();
  const values = typeof channels?.values === 'function' ? [...channels.values()] : [];
  const preferred = modRelated ? ['mod-updates', 'ark-mod-updates', 'ark-server-status'] : ['ark-update-health', 'ark-ops', 'ark-admin', 'ark-server-status'];
  for (const wanted of preferred) {
    const match = values.find((channel) => sendableChannel(channel) && normalizeChannelName(channel.name) === wanted);
    if (match) return match;
  }
  return null;
}

module.exports = {
  DEFAULT_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  monitorEnabled,
  monitorIntervalMinutes,
  compatibleBuildIds,
  apiCompatibilityEvidence,
  enforceCompatibilityVerdict,
  snapshotReport,
  reportFingerprint,
  classifyChanges,
  stateFilePath,
  loadMonitorState,
  saveMonitorState,
  buildState,
  shouldAlert,
  formatMonitorAlert,
  formatModAlert,
  formatPreUpdateGate,
  resolveAlertChannel
};
