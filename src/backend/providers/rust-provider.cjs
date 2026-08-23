'use strict';

const crypto = require('node:crypto');

const RUST_ACTIONS = Object.freeze(['status', 'players', 'save', 'broadcast']);

function cleanText(value, max = 500, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function normalizeRustConnection(server = {}) {
  let host = cleanText(server.host, 255);
  const port = Number(server.port);
  const password = String(server.password || '');
  if (!host) throw new Error('Rust WebRCON host is required.');
  if (/^[a-z]+:\/\//i.test(host) || /[/?#]/.test(host)) throw new Error('Enter only the Rust host or IP address.');
  if (/^[^:]+:\d+$/.test(host)) throw new Error('Keep the Rust WebRCON host and port separate.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Rust WebRCON port must be between 1 and 65535.');
  if (!password) throw new Error('Rust WebRCON password is required.');
  const protocol = String(server.protocol || 'ws').toLowerCase() === 'wss' ? 'wss' : 'ws';
  return { ...server, host, port, password, protocol, rconName: cleanText(server.rconName, 60, 'Khaos Nexus') };
}

function rustUrl(server) {
  const host = server.host.includes(':') ? `[${server.host}]` : server.host;
  return `${server.protocol}://${host}:${server.port}/${encodeURIComponent(server.password)}`;
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')); }
  catch { return fallback; }
}

function caseValue(object, names, fallback = undefined) {
  if (!object || typeof object !== 'object') return fallback;
  const entries = new Map(Object.entries(object).map(([key, value]) => [key.toLowerCase(), value]));
  for (const name of names) if (entries.has(String(name).toLowerCase())) return entries.get(String(name).toLowerCase());
  return fallback;
}

function normalizeServerInfo(payload, fallbackName = 'Rust Server') {
  const data = parseJson(payload, {}) || {};
  return {
    online: true,
    serverName: cleanText(caseValue(data, ['Hostname', 'ServerName', 'Name']), 100, fallbackName),
    players: Number(caseValue(data, ['Players', 'PlayerCount'], 0)) || 0,
    maxPlayers: Number(caseValue(data, ['MaxPlayers', 'MaxPlayerCount'], 0)) || 0,
    queued: Number(caseValue(data, ['Queued', 'Queue'], 0)) || 0,
    joining: Number(caseValue(data, ['Joining'], 0)) || 0,
    fps: Number(caseValue(data, ['Framerate', 'FPS', 'ServerFPS'])) || null,
    map: cleanText(caseValue(data, ['Map', 'Level']), 120),
    version: cleanText(caseValue(data, ['Version', 'Protocol']), 80)
  };
}

function normalizePlayers(payload) {
  const parsed = parseJson(payload, []);
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.players) ? parsed.players : [];
  return rows.map((item) => ({
    name: cleanText(caseValue(item, ['DisplayName', 'Name', 'Username']), 80, 'Unknown'),
    steamId: cleanText(caseValue(item, ['SteamID', 'SteamId', 'UserID', 'UserId']), 32),
    ping: Number(caseValue(item, ['Ping'])) || null,
    connectedSeconds: Number(caseValue(item, ['ConnectedSeconds', 'ConnectedTime'])) || null
  }));
}

function safeRustMessage(value) {
  const text = cleanText(value, 500);
  if (!text) return '';
  if (/[\r\n;]/.test(text)) throw new Error('Rust broadcast messages cannot contain line breaks or semicolons.');
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, "'")}"`;
}

class RustWebRconClient {
  constructor(connection = {}, options = {}) {
    this.server = normalizeRustConnection(connection);
    this.WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
    this.timeoutMs = Math.max(1000, Math.min(60000, Number(options.timeoutMs || 10000)));
    this.identifier = Number(options.startIdentifier) || crypto.randomInt(1000, 2000000000);
    if (typeof this.WebSocketImpl !== 'function') throw new Error('WebSocket networking is unavailable in this runtime.');
  }

  nextIdentifier() {
    this.identifier = this.identifier >= 2147483000 ? 1000 : this.identifier + 1;
    return this.identifier;
  }

  command(commandInput) {
    const command = cleanText(commandInput, 1000);
    if (!command || /[\r\n]/.test(command)) return Promise.reject(new Error('Rust WebRCON command must be a non-empty single line.'));
    const identifier = this.nextIdentifier();
    const url = rustUrl(this.server);
    const WebSocketImpl = this.WebSocketImpl;

    return new Promise((resolve, reject) => {
      let socket;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket?.close?.(1000, 'Nexus request complete'); } catch {}
        if (error) reject(error);
        else resolve(value);
      };
      const timer = setTimeout(() => finish(new Error('Rust WebRCON request timed out.')), this.timeoutMs);
      timer.unref?.();
      try { socket = new WebSocketImpl(url); }
      catch { return finish(new Error('Rust WebRCON connection could not be opened.')); }

      const add = (event, handler) => {
        if (typeof socket.addEventListener === 'function') socket.addEventListener(event, handler);
        else if (typeof socket.on === 'function') socket.on(event, handler);
        else socket[`on${event}`] = handler;
      };
      add('open', () => {
        try { socket.send(JSON.stringify({ Identifier: identifier, Message: command, Name: this.server.rconName })); }
        catch { finish(new Error('Rust WebRCON command could not be sent.')); }
      });
      add('message', async (event) => {
        try {
          const data = event?.data ?? event;
          const text = typeof data === 'string' ? data : Buffer.from(await (data?.arrayBuffer?.() || data)).toString('utf8');
          const packet = JSON.parse(text);
          if (Number(packet.Identifier ?? packet.identifier) !== identifier) return;
          if (packet.Stacktrace || packet.stacktrace) return finish(new Error(cleanText(packet.Message ?? packet.message, 500, 'Rust rejected the command.')));
          finish(null, String(packet.Message ?? packet.message ?? ''));
        } catch {
          finish(new Error('Rust WebRCON returned an invalid response.'));
        }
      });
      add('error', () => finish(new Error('Rust WebRCON connection failed.')));
      add('close', (event) => {
        if (settled) return;
        const code = Number(event?.code || 0);
        if (code === 1008) finish(new Error('Rust rejected the WebRCON password.'));
        else finish(new Error('Rust WebRCON closed before replying.'));
      });
    });
  }
}

class RustProvider {
  constructor(connection = {}, options = {}) {
    this.client = options.client || new RustWebRconClient(connection, options);
    this.serverName = cleanText(connection.name, 100, 'Rust Server');
    this.connected = true;
    this.providerKind = 'rust-webrcon';
    this.supportedActions = [...RUST_ACTIONS];
  }

  async invoke(actionId, payload = {}) {
    if (!this.supportedActions.includes(actionId)) throw new Error(`Rust WebRCON does not expose ${actionId} through Nexus yet.`);
    if (actionId === 'status') return normalizeServerInfo(await this.client.command('serverinfo'), this.serverName);
    if (actionId === 'players') {
      const players = normalizePlayers(await this.client.command('playerlist'));
      return { count: players.length, players };
    }
    if (actionId === 'save') return { accepted: true, response: await this.client.command('save') };
    if (actionId === 'broadcast') {
      const message = safeRustMessage(payload.message || payload.input);
      if (!message) return { usage: 'Use /nexus run module:rust action:broadcast input:<message>.' };
      return { accepted: true, response: await this.client.command(`say ${message}`) };
    }
    throw new Error(`Unsupported Rust action: ${actionId}`);
  }
}

module.exports = {
  RustProvider,
  RustWebRconClient,
  RUST_ACTIONS,
  normalizeRustConnection,
  normalizeServerInfo,
  normalizePlayers,
  safeRustMessage
};
