'use strict';

const crypto = require('node:crypto');

const VALID_PROVIDER_TYPES = new Set(['pterodactyl']);
const VALID_POWER_SIGNALS = new Set(['start', 'restart', 'stop', 'kill']);
const MAX_HISTORY = 300;

function cleanText(value, max, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function normalizeId(value, prefix = 'hosted-provider') {
  const raw = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(raw) ? raw : `${prefix}-${crypto.randomUUID()}`;
}

function isLocalHostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value.endsWith('.localhost');
}

function normalizePanelUrl(value, allowInsecureHttp = false) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error('Enter a valid Pterodactyl panel URL, including https://.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Pterodactyl panel URLs must use HTTP or HTTPS.');
  if (url.username || url.password) throw new Error('Do not include credentials in the panel URL. Store the API key separately.');
  if (url.protocol === 'http:' && !allowInsecureHttp && !isLocalHostname(url.hostname)) {
    throw new Error('HTTPS is required for remote Pterodactyl panels. Enable insecure HTTP only for a trusted local network panel.');
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/api\/client\/?$/i, '').replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function normalizeProvider(input = {}) {
  const allowInsecureHttp = Boolean(input.allowInsecureHttp);
  const type = VALID_PROVIDER_TYPES.has(input.type) ? input.type : 'pterodactyl';
  return {
    id: normalizeId(input.id),
    name: cleanText(input.name, 100, 'Pterodactyl Panel'),
    type,
    baseUrl: normalizePanelUrl(input.baseUrl, allowInsecureHttp),
    enabled: input.enabled !== false,
    allowInsecureHttp,
    requestTimeoutSeconds: clamp(input.requestTimeoutSeconds, 3, 60, 12),
    refreshSeconds: clamp(input.refreshSeconds, 0, 300, 30),
    lastConnectedAt: input.lastConnectedAt ? String(input.lastConnectedAt) : null,
    lastError: cleanText(input.lastError, 500)
  };
}

function normalizeHostedControlConfig(input = {}) {
  const seen = new Set();
  const providers = [];
  for (const source of Array.isArray(input.providers) ? input.providers : []) {
    try {
      const provider = normalizeProvider(source);
      if (seen.has(provider.id)) continue;
      seen.add(provider.id);
      providers.push(provider);
    } catch {}
  }
  return {
    schemaVersion: 1,
    settings: {
      historyLimit: clamp(input.settings?.historyLimit, 25, MAX_HISTORY, 150),
      actionTokenMinutes: clamp(input.settings?.actionTokenMinutes, 2, 30, 10)
    },
    providers: providers.slice(0, 20)
  };
}

function normalizePowerSignal(value) {
  const signal = String(value || '').trim().toLowerCase();
  if (!VALID_POWER_SIGNALS.has(signal)) throw new Error('Unsupported hosted-server power action.');
  return signal;
}

function actionToken() {
  return `hosted-server-${crypto.randomUUID()}`;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePterodactylServer(item = {}) {
  const attributes = item?.attributes || item || {};
  const limits = attributes.limits || {};
  return {
    identifier: cleanText(attributes.identifier, 100),
    name: cleanText(attributes.name, 120, 'Unnamed Server'),
    description: cleanText(attributes.description, 500),
    node: cleanText(attributes.node, 100),
    status: cleanText(attributes.status, 60, 'unknown').toLowerCase(),
    suspended: Boolean(attributes.is_suspended),
    installing: Boolean(attributes.is_installing),
    transferring: Boolean(attributes.is_transferring),
    serverOwner: attributes.server_owner !== false,
    limits: {
      memoryMb: safeNumber(limits.memory),
      swapMb: safeNumber(limits.swap),
      diskMb: safeNumber(limits.disk),
      ioWeight: safeNumber(limits.io),
      cpuPercent: safeNumber(limits.cpu),
      threads: cleanText(limits.threads, 150)
    }
  };
}

function normalizePterodactylResources(payload = {}) {
  const attributes = payload?.attributes || payload || {};
  const resources = attributes.resources || {};
  return {
    currentState: cleanText(attributes.current_state, 30, 'unknown').toLowerCase(),
    suspended: Boolean(attributes.is_suspended),
    memoryBytes: Math.max(0, safeNumber(resources.memory_bytes)),
    cpuPercent: Math.max(0, safeNumber(resources.cpu_absolute)),
    diskBytes: Math.max(0, safeNumber(resources.disk_bytes)),
    networkRxBytes: Math.max(0, safeNumber(resources.network_rx_bytes)),
    networkTxBytes: Math.max(0, safeNumber(resources.network_tx_bytes)),
    uptimeMs: Math.max(0, safeNumber(resources.uptime))
  };
}

function normalizeHostedHistory(input = {}) {
  return {
    id: cleanText(input.id, 100, `hosted-action-${crypto.randomUUID()}`),
    providerId: cleanText(input.providerId, 100),
    providerName: cleanText(input.providerName, 100, 'Hosted Provider'),
    serverName: cleanText(input.serverName, 120, 'Hosted Server'),
    signal: VALID_POWER_SIGNALS.has(input.signal) ? input.signal : 'restart',
    actorId: cleanText(input.actorId, 100),
    actorName: cleanText(input.actorName, 100, 'Local operator'),
    actorRole: cleanText(input.actorRole, 30, 'operator'),
    time: input.time ? String(input.time) : new Date().toISOString(),
    outcome: ['success', 'failed'].includes(input.outcome) ? input.outcome : 'failed',
    message: cleanText(input.message, 500)
  };
}

function formatBytes(value) {
  let bytes = Math.max(0, Number(value) || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  while (bytes >= 1024 && index < units.length - 1) { bytes /= 1024; index += 1; }
  const precision = bytes >= 100 || index === 0 ? 0 : bytes >= 10 ? 1 : 2;
  return `${bytes.toFixed(precision)} ${units[index]}`;
}

function formatUptime(milliseconds) {
  const totalMinutes = Math.floor(Math.max(0, Number(milliseconds) || 0) / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

module.exports = {
  VALID_PROVIDER_TYPES,
  VALID_POWER_SIGNALS,
  MAX_HISTORY,
  normalizePanelUrl,
  normalizeProvider,
  normalizeHostedControlConfig,
  normalizePowerSignal,
  actionToken,
  normalizePterodactylServer,
  normalizePterodactylResources,
  normalizeHostedHistory,
  formatBytes,
  formatUptime,
  isLocalHostname
};
