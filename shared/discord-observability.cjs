'use strict';

const ROUTE_TYPES = Object.freeze(['releases', 'errors', 'heartbeat', 'health']);
const ROUTE_LABELS = Object.freeze({
  releases: 'Release Feed',
  errors: 'Error Feed',
  heartbeat: 'Heartbeat Panel',
  health: 'Health Events'
});
const SEVERITY_RANK = Object.freeze({ info: 0, warning: 1, error: 2, critical: 3 });

const DEFAULT_ROUTE = Object.freeze({
  enabled: false,
  channelId: '',
  mentionRoleId: '',
  minimumSeverity: 'info',
  cooldownSeconds: 60,
  messageId: '',
  lastDeliveredAt: null,
  lastDeliveryError: null
});

const DEFAULT_DISCORD_OBSERVABILITY = Object.freeze({
  enabled: false,
  heartbeatIntervalMinutes: 15,
  includeServerNames: true,
  routes: Object.freeze({
    releases: Object.freeze({ ...DEFAULT_ROUTE, cooldownSeconds: 300 }),
    errors: Object.freeze({ ...DEFAULT_ROUTE, minimumSeverity: 'error', cooldownSeconds: 300 }),
    heartbeat: Object.freeze({ ...DEFAULT_ROUTE, cooldownSeconds: 60 }),
    health: Object.freeze({ ...DEFAULT_ROUTE, minimumSeverity: 'info', cooldownSeconds: 120 })
  }),
  deliveryHistory: Object.freeze([]),
  announcedVersions: Object.freeze([]),
  lastHeartbeatAt: null,
  updatedAt: null
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function snowflake(value) {
  const text = String(value || '').trim();
  return /^\d{5,25}$/.test(text) ? text : '';
}

function severity(value, fallback = 'info') {
  const normalized = String(value || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(SEVERITY_RANK, normalized) ? normalized : fallback;
}

function normalizeRoute(input = {}, defaults = DEFAULT_ROUTE) {
  return {
    enabled: Boolean(input.enabled),
    channelId: snowflake(input.channelId),
    mentionRoleId: snowflake(input.mentionRoleId),
    minimumSeverity: severity(input.minimumSeverity, defaults.minimumSeverity || 'info'),
    cooldownSeconds: boundedInteger(input.cooldownSeconds, defaults.cooldownSeconds || 60, 0, 86400),
    messageId: snowflake(input.messageId),
    lastDeliveredAt: input.lastDeliveredAt ? String(input.lastDeliveredAt) : null,
    lastDeliveryError: input.lastDeliveryError ? String(input.lastDeliveryError).slice(0, 800) : null
  };
}

function normalizeDelivery(entry = {}) {
  const type = ROUTE_TYPES.includes(entry.type) ? entry.type : 'health';
  return {
    id: String(entry.id || ''),
    type,
    status: ['sent', 'edited', 'skipped', 'failed', 'tested'].includes(entry.status) ? entry.status : 'failed',
    channelId: snowflake(entry.channelId),
    messageId: snowflake(entry.messageId),
    summary: String(entry.summary || '').slice(0, 500),
    error: entry.error ? String(entry.error).slice(0, 800) : null,
    createdAt: entry.createdAt ? String(entry.createdAt) : new Date().toISOString()
  };
}

function normalizeDiscordObservability(input = {}) {
  const routes = {};
  for (const type of ROUTE_TYPES) routes[type] = normalizeRoute(input.routes?.[type] || {}, DEFAULT_DISCORD_OBSERVABILITY.routes[type]);
  return {
    enabled: Boolean(input.enabled),
    heartbeatIntervalMinutes: boundedInteger(input.heartbeatIntervalMinutes, 15, 1, 1440),
    includeServerNames: input.includeServerNames !== false,
    routes,
    deliveryHistory: (Array.isArray(input.deliveryHistory) ? input.deliveryHistory : []).slice(-250).map(normalizeDelivery),
    announcedVersions: [...new Set((Array.isArray(input.announcedVersions) ? input.announcedVersions : []).map((value) => String(value || '').trim()).filter(Boolean))].slice(-50),
    lastHeartbeatAt: input.lastHeartbeatAt ? String(input.lastHeartbeatAt) : null,
    updatedAt: input.updatedAt ? String(input.updatedAt) : null
  };
}

function routeReady(config, type) {
  const normalized = normalizeDiscordObservability(config);
  const route = normalized.routes[type];
  return Boolean(normalized.enabled && route?.enabled && route.channelId);
}

function severityAtLeast(value, minimum) {
  return (SEVERITY_RANK[severity(value)] ?? 0) >= (SEVERITY_RANK[severity(minimum)] ?? 0);
}

function allowedMentions(route) {
  const roleId = snowflake(route?.mentionRoleId);
  return roleId ? { parse: [], roles: [roleId] } : { parse: [] };
}

function mentionPrefix(route) {
  const roleId = snowflake(route?.mentionRoleId);
  return roleId ? `<@&${roleId}>` : '';
}

function truncate(value, limit) {
  const text = String(value ?? '');
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function safeTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function colorForSeverity(level) {
  return { info: 0x57c7ff, warning: 0xf1b94f, error: 0xff3f5f, critical: 0xc92245 }[severity(level)] || 0x57c7ff;
}

function basePayload(route, embed, content = '') {
  return {
    content: [mentionPrefix(route), content].filter(Boolean).join(' ').slice(0, 2000),
    embeds: [embed],
    allowed_mentions: allowedMentions(route)
  };
}

function releasePayload(route, event = {}) {
  const version = String(event.version || event.latestVersion || 'Unknown');
  const installed = String(event.installedVersion || event.currentVersion || 'Unknown');
  const status = String(event.status || 'available');
  const fields = [
    { name: 'Release', value: truncate(version, 1024), inline: true },
    { name: 'Installed', value: truncate(installed, 1024), inline: true },
    { name: 'Status', value: truncate(status, 1024), inline: true }
  ];
  if (event.releaseUrl) fields.push({ name: 'Release page', value: `[Open trusted release](${String(event.releaseUrl)})`, inline: false });
  return basePayload(route, {
    title: status === 'installed' ? `Khaos Nexus ${version} installed` : `Khaos Nexus ${version} is live`,
    description: truncate(event.notes || event.summary || 'A stable Khaos Nexus release is available.', 4096),
    color: status === 'installed' ? 0x4bd89c : 0xff3655,
    fields,
    footer: { text: 'Khaos Nexus Release Channel' },
    timestamp: safeTimestamp(event.time)
  });
}

function errorPayload(route, event = {}) {
  const level = severity(event.severity || 'error', 'error');
  const fields = [
    { name: 'Error ID', value: `\`${truncate(event.id || 'unknown', 80)}\``, inline: true },
    { name: 'Source', value: truncate(event.source || 'desktop', 1024), inline: true },
    { name: 'Severity', value: level.toUpperCase(), inline: true }
  ];
  if (event.issueUrl) fields.push({ name: 'Report', value: `[Open redacted issue](${String(event.issueUrl)})`, inline: false });
  return basePayload(route, {
    title: truncate(event.title || 'Khaos Nexus error captured', 256),
    description: truncate(event.summary || event.message || 'A redacted application error was captured.', 4096),
    color: colorForSeverity(level),
    fields,
    footer: { text: 'Protected values are redacted' },
    timestamp: safeTimestamp(event.time)
  });
}

function heartbeatPayload(route, snapshot = {}) {
  const bot = snapshot.bot || {};
  const heartbeat = bot.heartbeat || {};
  const servers = Array.isArray(snapshot.servers) ? snapshot.servers : [];
  const onlineServers = servers.filter((server) => server.online === true).length;
  const serverSummary = snapshot.includeServerNames === false
    ? `${onlineServers}/${servers.length} online`
    : truncate(servers.length ? servers.map((server) => `${server.online === true ? '🟢' : server.online === false ? '🔴' : '⚪'} ${server.name || 'Server'}`).join('\n') : 'No servers configured', 1024);
  const fields = [
    { name: 'Desktop', value: `${snapshot.appVersion || 'Unknown'} • ${snapshot.desktopStatus || 'Online'}`, inline: true },
    { name: 'Discord Bot', value: `${bot.status || 'unknown'}${heartbeat.ping !== undefined ? ` • ${heartbeat.ping} ms` : ''}`, inline: true },
    { name: 'Guilds', value: String(heartbeat.guildCount ?? bot.ready?.guildCount ?? '—'), inline: true },
    { name: 'Memory', value: heartbeat.memoryMb !== undefined ? `${heartbeat.memoryMb} MB` : '—', inline: true },
    { name: 'Modules', value: String(snapshot.enabledModules ?? '—'), inline: true },
    { name: 'Update', value: truncate(snapshot.updateStatus || 'Idle', 1024), inline: true },
    { name: 'Game Network', value: serverSummary, inline: false },
    { name: 'Last Error', value: snapshot.lastErrorId ? `\`${truncate(snapshot.lastErrorId, 80)}\`` : 'None', inline: true },
    { name: 'Access', value: truncate(snapshot.accessRole || 'local-admin', 1024), inline: true },
    { name: 'Heartbeat Age', value: truncate(snapshot.heartbeatAge || 'Unknown', 1024), inline: true }
  ];
  return basePayload(route, {
    title: 'Khaos Nexus Heartbeat',
    description: truncate(snapshot.summary || 'Live status from the local Khaos Nexus command network.', 4096),
    color: snapshot.degraded ? 0xf1b94f : 0x4bd89c,
    fields,
    footer: { text: 'Persistent status message • edited in place' },
    timestamp: safeTimestamp(snapshot.time)
  });
}

function healthPayload(route, event = {}) {
  const level = severity(event.severity || 'warning', 'warning');
  return basePayload(route, {
    title: truncate(event.title || 'Khaos Nexus health event', 256),
    description: truncate(event.summary || event.message || 'A runtime state changed.', 4096),
    color: colorForSeverity(level),
    fields: [
      { name: 'Component', value: truncate(event.component || 'Desktop', 1024), inline: true },
      { name: 'Previous', value: truncate(event.previous || 'unknown', 1024), inline: true },
      { name: 'Current', value: truncate(event.current || 'unknown', 1024), inline: true }
    ],
    footer: { text: 'Khaos Nexus Health Events' },
    timestamp: safeTimestamp(event.time)
  });
}

function payloadFor(type, route, event) {
  if (type === 'releases') return releasePayload(route, event);
  if (type === 'errors') return errorPayload(route, event);
  if (type === 'heartbeat') return heartbeatPayload(route, event);
  return healthPayload(route, event);
}

module.exports = {
  ROUTE_TYPES,
  ROUTE_LABELS,
  SEVERITY_RANK,
  DEFAULT_ROUTE,
  DEFAULT_DISCORD_OBSERVABILITY,
  normalizeRoute,
  normalizeDiscordObservability,
  normalizeDelivery,
  routeReady,
  severityAtLeast,
  allowedMentions,
  payloadFor,
  releasePayload,
  errorPayload,
  heartbeatPayload,
  healthPayload
};
