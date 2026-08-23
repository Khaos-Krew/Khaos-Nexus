'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_API_PATH = '/v1/api';
const DEFAULT_USERNAME = 'admin';
const BASE_ACTIONS = Object.freeze(['status', 'players', 'settings', 'metrics', 'save', 'broadcast', 'kick', 'ban', 'unban', 'snapshot', 'backups', 'shutdown']);

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/[\r\n\u0000]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanApiPath(value) {
  const apiPath = String(value || DEFAULT_API_PATH).trim() || DEFAULT_API_PATH;
  return `/${apiPath.replace(/^\/+|\/+$/g, '')}`;
}

function normalizeServerAddress(server = {}) {
  let host = String(server.host || '').trim();
  let port = Number(server.port || 0);
  let protocol = String(server.protocol || 'http').toLowerCase() === 'https' ? 'https' : 'http';
  let apiPath = cleanApiPath(server.apiPath);
  if (/^https?:\/\//i.test(host)) {
    const parsed = new URL(host);
    protocol = parsed.protocol === 'https:' ? 'https' : 'http';
    host = parsed.hostname;
    if (!port && parsed.port) port = Number(parsed.port);
    if (parsed.pathname && parsed.pathname !== '/') apiPath = cleanApiPath(parsed.pathname);
  } else {
    const ipv6 = host.match(/^\[([^\]]+)\](?::(\d+))?$/);
    const hostPort = !ipv6 && host.match(/^([^:]+):(\d+)$/);
    if (ipv6) {
      host = ipv6[1];
      if (!port && ipv6[2]) port = Number(ipv6[2]);
    } else if (hostPort) {
      host = hostPort[1];
      if (!port) port = Number(hostPort[2]);
    }
  }
  return { ...server, host, port, protocol, apiPath, username: String(server.username || DEFAULT_USERNAME).trim() || DEFAULT_USERNAME };
}

function parseUserInput(payload = {}, requireMessage = false) {
  const raw = cleanText(payload.input || payload.userid || payload.userId, 700);
  const [userRaw, ...messageParts] = raw.split('|');
  const userid = cleanText(payload.userid || payload.userId || userRaw, 160);
  const message = cleanText(payload.message || messageParts.join('|'), 500);
  if (!userid) throw new Error(`Provide the Palworld userid${requireMessage ? ' and optional message' : ''}.`);
  return { userid, ...(message ? { message } : {}) };
}

function parseShutdownInput(payload = {}, defaultMessage = 'Server shutdown requested by Nexus Sentinal.') {
  const raw = cleanText(payload.input, 600);
  const parts = raw ? raw.split('|') : [];
  let waittime = Number(payload.waittime ?? payload.seconds ?? (parts[0] && /^\d+$/.test(parts[0].trim()) ? parts.shift() : 30));
  if (!Number.isFinite(waittime)) waittime = 30;
  waittime = Math.max(0, Math.min(3600, Math.floor(waittime)));
  const message = cleanText(payload.message || parts.join('|') || defaultMessage, 500);
  return { waittime, message };
}

async function listBackupFiles(rootPath) {
  const backupPath = cleanText(rootPath, 1000);
  if (!backupPath) return [];
  const root = path.resolve(backupPath);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.slice(0, 100)) {
    const full = path.join(root, entry.name);
    try {
      const stat = await fs.stat(full);
      files.push({ name: entry.name.slice(0, 220), directory: entry.isDirectory(), size: entry.isFile() ? stat.size : null, modifiedAt: stat.mtime.toISOString() });
    } catch {}
  }
  return files.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt))).slice(0, 20);
}

class PalworldRestClient {
  constructor(server = {}, options = {}) {
    const normalized = normalizeServerAddress(server);
    if (!normalized.host) throw new Error('Palworld REST host is missing.');
    if (!Number.isInteger(normalized.port) || normalized.port < 1 || normalized.port > 65535) throw new Error('Palworld REST port must be between 1 and 65535.');
    if (!server.password) throw new Error('Palworld AdminPassword is missing.');
    this.server = { ...normalized, password: String(server.password) };
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || 10000));
    if (typeof this.fetchImpl !== 'function') throw new Error('HTTP networking is unavailable.');
    const hostForUrl = normalized.host.includes(':') && !normalized.host.startsWith('[') ? `[${normalized.host}]` : normalized.host;
    this.baseUrl = `${normalized.protocol}://${hostForUrl}:${normalized.port}${normalized.apiPath}`;
  }

  endpoint(pathname) { return `${this.baseUrl}/${String(pathname || '').replace(/^\/+/, '')}`; }

  async request(method, pathname, body) {
    const endpoint = this.endpoint(pathname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    const auth = Buffer.from(`${this.server.username}:${this.server.password}`, 'utf8').toString('base64');
    try {
      const response = await this.fetchImpl(endpoint, {
        method, redirect: 'follow', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: `Basic ${auth}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      const text = await response.text();
      let payload = null;
      if (text) {
        try { payload = JSON.parse(text); }
        catch { payload = text; }
      }
      if (!response.ok) {
        if (response.status === 401) throw new Error('Palworld REST authentication failed. Verify the API username and AdminPassword.');
        if (response.status === 404) throw new Error('Palworld REST endpoint was not found. Verify RESTAPIEnabled, RESTAPIPort, API path, and whether game-data was enabled for snapshots.');
        throw new Error(`Palworld REST request failed with HTTP ${response.status}.`);
      }
      return payload ?? { ok: true };
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`Palworld REST request timed out after ${this.timeoutMs}ms.`);
      throw error;
    } finally { clearTimeout(timer); }
  }

  info() { return this.request('GET', 'info'); }
  players() { return this.request('GET', 'players'); }
  settings() { return this.request('GET', 'settings'); }
  metrics() { return this.request('GET', 'metrics'); }
  snapshot() { return this.request('GET', 'game-data'); }
  announce(message) { return this.request('POST', 'announce', { message: String(message || '').trim() }); }
  save() { return this.request('POST', 'save'); }
  kick(userid, message) { return this.request('POST', 'kick', { userid, ...(message ? { message } : {}) }); }
  ban(userid, message) { return this.request('POST', 'ban', { userid, ...(message ? { message } : {}) }); }
  unban(userid) { return this.request('POST', 'unban', { userid }); }
  shutdown(waittime, message) { return this.request('POST', 'shutdown', { waittime, ...(message ? { message } : {}) }); }
  stop() { return this.request('POST', 'stop'); }
}

class PalworldProvider {
  constructor(connection = {}, options = {}) {
    this.client = options.client || new PalworldRestClient(connection, options);
    this.connected = true;
    this.providerKind = 'palworld-rest';
    this.restartViaShutdown = connection.restartViaShutdown === true;
    this.backupPath = String(connection.backupPath || '').trim();
    this.supportedActions = [...BASE_ACTIONS, ...(this.restartViaShutdown ? ['restart'] : [])];
  }

  async invoke(actionId, payload = {}) {
    if (!this.supportedActions.includes(actionId)) {
      if (actionId === 'restart') throw new Error('Palworld restart needs connection.restartViaShutdown=true and an external service manager that automatically restarts the server after shutdown.');
      throw new Error(`Palworld REST does not support ${actionId} through this Nexus capability.`);
    }
    if (actionId === 'status') return { info: await this.client.info(), metrics: await this.client.metrics() };
    if (actionId === 'players') return this.client.players();
    if (actionId === 'settings') return this.client.settings();
    if (actionId === 'metrics') return this.client.metrics();
    if (actionId === 'snapshot') {
      const snapshot = await this.client.snapshot();
      const actors = Array.isArray(snapshot?.ActorData) ? snapshot.ActorData : [];
      const counts = actors.reduce((result, actor) => {
        const key = cleanText(actor?.UnitType || actor?.Type || 'Unknown', 40) || 'Unknown';
        result[key] = (result[key] || 0) + 1;
        return result;
      }, {});
      return { time: snapshot?.Time || '', fps: snapshot?.FPS ?? null, averageFps: snapshot?.AverageFPS ?? null, actorCount: actors.length, counts, actors: actors.slice(0, 50) };
    }
    if (actionId === 'save') return this.client.save();
    if (actionId === 'broadcast') {
      const message = cleanText(payload.message || payload.input, 500);
      if (!message) return { usage: 'Use /nexus run module:palworld action:broadcast input:<message>.' };
      return this.client.announce(message);
    }
    if (actionId === 'kick') { const input = parseUserInput(payload, true); return this.client.kick(input.userid, input.message); }
    if (actionId === 'ban') { const input = parseUserInput(payload, true); return this.client.ban(input.userid, input.message); }
    if (actionId === 'unban') { const input = parseUserInput(payload); return this.client.unban(input.userid); }
    if (actionId === 'shutdown') {
      const input = parseShutdownInput(payload);
      return this.client.shutdown(input.waittime, input.message);
    }
    if (actionId === 'restart') {
      const input = parseShutdownInput(payload, 'Palworld restart requested by Nexus Sentinal.');
      const result = await this.client.shutdown(input.waittime, input.message);
      return { accepted: true, restartExpected: true, note: 'Nexus issued the official Palworld shutdown request. The configured external supervisor must start the server again.', result };
    }
    if (actionId === 'backups') {
      const settings = await this.client.settings().catch(() => ({}));
      let files = [];
      let localError = '';
      if (this.backupPath) {
        try { files = await listBackupFiles(this.backupPath); }
        catch (error) { localError = cleanText(error?.message || error, 300); }
      }
      return {
        enabled: settings?.bIsUseBackupSaveData ?? settings?.bIsUseBackupSaveData === true,
        localBackupPathConfigured: Boolean(this.backupPath), files,
        note: this.backupPath ? (localError ? `Backup path could not be read: ${localError}` : 'Showing the most recent entries visible to Nexus Backend.') : 'Palworld manages automatic backup generations when bIsUseBackupSaveData is enabled. Configure connection.backupPath only when Nexus Backend can access the server filesystem.'
      };
    }
    throw new Error(`Unsupported Palworld action: ${actionId}`);
  }
}

module.exports = {
  PalworldProvider, PalworldRestClient, BASE_ACTIONS, normalizeServerAddress, cleanApiPath,
  cleanText, parseUserInput, parseShutdownInput, listBackupFiles
};
