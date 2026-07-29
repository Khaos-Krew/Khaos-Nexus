'use strict';

const crypto = require('node:crypto');
const { redactText } = require('../shared/redaction.cjs');

const DEFAULT_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const STEAM64_PATTERN = /^7656\d{13}$/;

function cleanText(value, max = 500, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function normalizeRustHost(value) {
  let host = cleanText(value, 255);
  if (!host) throw new Error('Rust WebRCON host is required.');
  if (/^[a-z]+:\/\//i.test(host) || /[/?#]/.test(host)) {
    throw new Error('Enter only the Rust server host or IP. Do not include a protocol, path, or port.');
  }
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host || /\s/.test(host)) throw new Error('Rust WebRCON host is invalid.');
  return host;
}

function normalizeRustWebRconServer(server = {}) {
  const host = normalizeRustHost(server.host);
  const port = Number(server.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Rust WebRCON port must be between 1 and 65535.');
  }
  const password = String(server.password || '');
  if (!password) throw new Error('Rust WebRCON password is missing.');
  if (password.length > 512) throw new Error('Rust WebRCON password is too long.');
  const protocol = String(server.protocol || 'ws').toLowerCase() === 'wss' ? 'wss' : 'ws';
  return {
    ...server,
    host,
    port,
    password,
    protocol,
    connectionType: 'webrcon',
    rconName: cleanText(server.rconName, 60, 'Khaos Nexus')
  };
}

function hostForUrl(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function rustWebRconUrl(serverInput = {}) {
  const server = normalizeRustWebRconServer(serverInput);
  return `${server.protocol}://${hostForUrl(server.host)}:${server.port}/${encodeURIComponent(server.password)}`;
}

function redactRustError(error, password = '') {
  const message = redactText(error?.message || error || 'Rust WebRCON operation failed.', [password]);
  const result = new Error(message);
  result.name = 'RustWebRconError';
  result.code = error?.code || 'RUST_WEBCON_ERROR';
  result.retryable = Boolean(error?.retryable);
  result.status = Number.isFinite(Number(error?.status)) ? Number(error.status) : null;
  return result;
}

async function messageText(data) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  if (data && typeof data.text === 'function') return data.text();
  return String(data ?? '');
}

function normalizePacket(input) {
  if (!input || typeof input !== 'object') throw Object.assign(new Error('Rust WebRCON returned an invalid packet.'), { code: 'INVALID_RESPONSE' });
  const identifier = Number(input.Identifier ?? input.identifier);
  return {
    identifier: Number.isFinite(identifier) ? identifier : null,
    message: typeof (input.Message ?? input.message) === 'string' ? String(input.Message ?? input.message) : JSON.stringify(input.Message ?? input.message ?? ''),
    type: cleanText(input.Type ?? input.type, 40, 'Generic'),
    stacktrace: cleanText(input.Stacktrace ?? input.stacktrace, 4000),
    raw: input
  };
}

function parseJsonMessage(value, fallback = null) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim();
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

function getCaseInsensitive(object, names, fallback = undefined) {
  if (!object || typeof object !== 'object') return fallback;
  const map = new Map(Object.entries(object).map(([key, value]) => [String(key).toLowerCase(), value]));
  for (const name of names) if (map.has(String(name).toLowerCase())) return map.get(String(name).toLowerCase());
  return fallback;
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRustServerInfo(payload, fallbackName = 'Rust Server') {
  const source = parseJsonMessage(payload, {}) || {};
  return {
    status: 'online',
    serverName: cleanText(getCaseInsensitive(source, ['Hostname', 'ServerName', 'Name']), 100, fallbackName),
    players: Math.max(0, finiteNumber(getCaseInsensitive(source, ['Players', 'PlayerCount']), 0)),
    maxPlayers: Math.max(0, finiteNumber(getCaseInsensitive(source, ['MaxPlayers', 'MaxPlayerCount']), 0)),
    queued: Math.max(0, finiteNumber(getCaseInsensitive(source, ['Queued', 'Queue']), 0)),
    joining: Math.max(0, finiteNumber(getCaseInsensitive(source, ['Joining']), 0)),
    entityCount: Math.max(0, finiteNumber(getCaseInsensitive(source, ['EntityCount', 'Entities']), 0)),
    uptimeSeconds: Math.max(0, finiteNumber(getCaseInsensitive(source, ['Uptime', 'UptimeSeconds']), 0)),
    fps: finiteNumber(getCaseInsensitive(source, ['Framerate', 'FPS', 'ServerFPS'])),
    map: cleanText(getCaseInsensitive(source, ['Map', 'Level']), 120),
    version: cleanText(getCaseInsensitive(source, ['Version', 'Protocol']), 80),
    raw: source
  };
}

function normalizeRustPlayer(input = {}) {
  const identifier = cleanText(getCaseInsensitive(input, ['SteamID', 'SteamId', 'UserID', 'UserId', 'OwnerSteamID']), 32);
  const name = cleanText(getCaseInsensitive(input, ['DisplayName', 'Name', 'Username']), 80, 'Unknown Player');
  return {
    name,
    identifier,
    steamId: identifier,
    ping: finiteNumber(getCaseInsensitive(input, ['Ping'])),
    connectedSeconds: finiteNumber(getCaseInsensitive(input, ['ConnectedSeconds', 'ConnectedTime'])),
    violationLevel: finiteNumber(getCaseInsensitive(input, ['VoiationLevel', 'ViolationLevel'])),
    health: finiteNumber(getCaseInsensitive(input, ['Health'])),
    accountType: 'Steam'
  };
}

function normalizeRustPlayers(payload) {
  const parsed = parseJsonMessage(payload, []);
  const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.players) ? parsed.players : [];
  return source.map(normalizeRustPlayer).filter((player) => player.identifier);
}

function safeRustArgument(value, label, max = 250) {
  const text = cleanText(value, max);
  if (!text) throw new Error(`${label} is required.`);
  if (/[\r\n;]/.test(text)) throw new Error(`${label} cannot contain line breaks or semicolons.`);
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, "'")}"`;
}

function steam64(value) {
  const id = cleanText(value, 32);
  if (!STEAM64_PATTERN.test(id)) throw new Error('Rust moderation requires a valid Steam64 ID.');
  return id;
}

function rawCommand(value) {
  const command = String(value || '').replace(/\u0000/g, '').trim();
  if (!command) throw new Error('A Rust console command is required.');
  if (command.length > 1000) throw new Error('Rust console commands are limited to 1,000 characters.');
  if (/[\r\n]/.test(command)) throw new Error('Rust console commands must be a single line.');
  return command;
}

class RustWebRconClient {
  constructor(server = {}, options = {}) {
    this.server = normalizeRustWebRconServer(server);
    this.WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
    this.timeoutMs = Math.max(1000, Math.min(60000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS));
    this.maxResponseBytes = Math.max(1024, Math.min(32 * 1024 * 1024, Number(options.maxResponseBytes) || MAX_RESPONSE_BYTES));
    this.identifier = Number(options.startIdentifier) || crypto.randomInt(1000, 2000000000);
    if (typeof this.WebSocketImpl !== 'function') throw new Error('WebSocket networking is unavailable in this runtime.');
  }

  nextIdentifier() {
    this.identifier = this.identifier >= 2147483000 ? 1000 : this.identifier + 1;
    return this.identifier;
  }

  async command(commandInput, options = {}) {
    const command = rawCommand(commandInput);
    const identifier = this.nextIdentifier();
    const timeoutMs = Math.max(500, Math.min(60000, Number(options.timeoutMs) || this.timeoutMs));
    const url = rustWebRconUrl(this.server);
    const WebSocketImpl = this.WebSocketImpl;
    const signal = options.signal;

    if (signal?.aborted) {
      throw Object.assign(new Error('Rust WebRCON operation was cancelled.'), { code: 'CANCELLED' });
    }

    return new Promise((resolve, reject) => {
      let socket;
      let settled = false;
      let timer;

      const finish = (error, packet) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onAbort);
        try { if (socket && socket.readyState < 2) socket.close(1000, 'Khaos Nexus request complete'); } catch {}
        if (error) reject(redactRustError(error, this.server.password));
        else resolve(packet);
      };

      const onAbort = () => finish(Object.assign(new Error('Rust WebRCON operation was cancelled.'), { code: 'CANCELLED' }));
      signal?.addEventListener?.('abort', onAbort, { once: true });

      timer = setTimeout(() => finish(Object.assign(new Error('Rust WebRCON request timed out.'), { code: 'TIMEOUT', retryable: true })), timeoutMs);
      timer.unref?.();

      try {
        socket = new WebSocketImpl(url);
      } catch (error) {
        finish(Object.assign(error instanceof Error ? error : new Error(String(error)), { code: 'CONNECTION_FAILED', retryable: true }));
        return;
      }

      const add = (event, handler) => {
        if (typeof socket.addEventListener === 'function') socket.addEventListener(event, handler);
        else if (typeof socket.on === 'function') socket.on(event, handler);
        else socket[`on${event}`] = handler;
      };

      add('open', () => {
        try {
          socket.send(JSON.stringify({ Identifier: identifier, Message: command, Name: this.server.rconName }));
        } catch (error) {
          finish(Object.assign(error, { code: 'CONNECTION_FAILED', retryable: true }));
        }
      });

      add('message', async (event, isBinary) => {
        try {
          const data = event?.data ?? event;
          if (isBinary === true && Buffer.isBuffer(data) && data.byteLength > this.maxResponseBytes) {
            throw Object.assign(new Error('Rust WebRCON response exceeded the safe size limit.'), { code: 'INVALID_RESPONSE' });
          }
          const text = await messageText(data);
          if (Buffer.byteLength(text, 'utf8') > this.maxResponseBytes) {
            throw Object.assign(new Error('Rust WebRCON response exceeded the safe size limit.'), { code: 'INVALID_RESPONSE' });
          }
          let decoded;
          try { decoded = JSON.parse(text); }
          catch { throw Object.assign(new Error('Rust WebRCON returned malformed JSON.'), { code: 'INVALID_RESPONSE' }); }
          const packet = normalizePacket(decoded);
          if (packet.identifier !== identifier) return;
          if (packet.stacktrace) {
            throw Object.assign(new Error(packet.message || 'Rust rejected the console command.'), { code: 'ACTION_REJECTED' });
          }
          finish(null, packet);
        } catch (error) {
          finish(error);
        }
      });

      add('error', (event) => {
        const source = event?.error || event;
        finish(Object.assign(source instanceof Error ? source : new Error('Rust WebRCON connection failed.'), { code: 'CONNECTION_FAILED', retryable: true }));
      });

      add('close', (eventOrCode, maybeReason) => {
        if (settled) return;
        const code = Number(eventOrCode?.code ?? eventOrCode);
        const reason = cleanText(eventOrCode?.reason ?? maybeReason, 300);
        const auth = code === 1008 || /password|auth|forbidden|unauthor/i.test(reason);
        finish(Object.assign(new Error(auth ? 'Rust rejected the WebRCON password or temporarily blocked this client.' : `Rust WebRCON closed before replying${code ? ` (code ${code})` : ''}.`), {
          code: auth ? 'AUTH_FAILED' : 'CONNECTION_FAILED',
          retryable: !auth
        }));
      });
    });
  }

  async execute(command, options = {}) {
    const packet = await this.command(command, options);
    return packet.message;
  }

  async action(action, payload = {}, options = {}) {
    switch (String(action || '')) {
      case 'status':
      case 'info':
        return normalizeRustServerInfo((await this.command('serverinfo', options)).message, this.server.name || 'Rust Server');
      case 'players':
        return { players: normalizeRustPlayers((await this.command('playerlist', options)).message) };
      case 'announce':
        return this.execute(`say ${safeRustArgument(payload.message, 'Announcement message', 500)}`, options);
      case 'save':
        return this.execute('save', options);
      case 'kick': {
        const id = steam64(payload.userid || payload.player);
        const reason = safeRustArgument(payload.message || 'Removed by an administrator.', 'Kick reason', 250);
        return this.execute(`kick ${id} ${reason}`, options);
      }
      case 'ban': {
        const id = steam64(payload.userid || payload.player);
        const name = safeRustArgument(payload.playerName || payload.name || id, 'Player name', 80);
        const reason = safeRustArgument(payload.message || 'Banned by an administrator.', 'Ban reason', 250);
        return this.execute(`banid ${id} ${name} ${reason}`, options);
      }
      case 'unban':
        return this.execute(`unban ${steam64(payload.userid || payload.player)}`, options);
      case 'shutdown':
      case 'stop':
        return this.execute('quit', options);
      case 'raw':
        return this.execute(rawCommand(payload.command), options);
      default:
        throw new Error(`Unsupported Rust WebRCON action: ${action}`);
    }
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  STEAM64_PATTERN,
  RustWebRconClient,
  normalizeRustHost,
  normalizeRustWebRconServer,
  rustWebRconUrl,
  normalizePacket,
  normalizeRustServerInfo,
  normalizeRustPlayer,
  normalizeRustPlayers,
  safeRustArgument,
  steam64,
  rawCommand,
  redactRustError
};