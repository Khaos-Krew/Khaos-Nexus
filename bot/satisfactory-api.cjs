'use strict';

const crypto = require('node:crypto');
const dgram = require('node:dgram');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');

const DEFAULT_PORT = 7777;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 3000;
const HTTPS_TIMEOUT_MS = 15000;
const STATE_NAMES = Object.freeze({ 0: 'offline', 1: 'idle', 2: 'loading', 3: 'playing' });

function cleanText(value, max = 300, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function normalizeHost(value) {
  let host = cleanText(value, 255);
  if (!host) throw new Error('A Satisfactory server host is required.');
  if (/^[a-z]+:\/\//i.test(host) || /[/?#]/.test(host)) {
    throw new Error('Enter only the Satisfactory host or IP address, without a protocol, port, or path.');
  }
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.includes(':') && net.isIP(host) !== 6) {
    throw new Error('Enter the HTTPS/query port in the separate port field.');
  }
  return host;
}

function normalizePort(value) {
  const port = Number(value || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A valid Satisfactory API port is required.');
  return port;
}

function normalizeFingerprint(value) {
  const fingerprint = cleanText(value, 200).replace(/[^a-f0-9]/gi, '').toUpperCase();
  if (!fingerprint) return '';
  if (!/^[A-F0-9]{64}$/.test(fingerprint)) throw new Error('The Satisfactory TLS fingerprint must be a SHA-256 certificate fingerprint.');
  return fingerprint;
}

function formatFingerprint(value) {
  return normalizeFingerprint(value).match(/.{1,2}/g)?.join(':') || '';
}

function certificateFingerprint(certificate) {
  if (!certificate?.raw) throw new Error('The Satisfactory server did not provide a TLS certificate.');
  return crypto.createHash('sha256').update(certificate.raw).digest('hex').toUpperCase();
}

function serverNameForTls(host) {
  return net.isIP(host) ? undefined : host;
}

class SatisfactoryApiError extends Error {
  constructor(message, options = {}) {
    super(cleanText(message, 1200, 'Satisfactory API request failed.'));
    this.name = 'SatisfactoryApiError';
    this.code = cleanText(options.code, 120, 'SATISFACTORY_API_ERROR');
    this.status = Number.isFinite(Number(options.status)) ? Number(options.status) : null;
    this.retryable = Boolean(options.retryable);
    this.details = options.details && typeof options.details === 'object' ? options.details : {};
  }
}

function responseError(status, payload) {
  const errorCode = cleanText(payload?.errorCode || payload?.error_code || payload?.code, 120, status === 401 ? 'unauthorized' : 'api_error');
  const errorMessage = cleanText(payload?.errorMessage || payload?.error_message || payload?.message, 1000, `Satisfactory API returned HTTP ${status}.`);
  return new SatisfactoryApiError(errorMessage, {
    code: errorCode,
    status,
    retryable: status >= 500 || status === 429,
    details: { errorCode }
  });
}

function parseApiPayload(status, body) {
  if (status === 204 || !body.length) return null;
  let payload;
  try { payload = JSON.parse(body.toString('utf8')); }
  catch { throw new SatisfactoryApiError('Satisfactory returned malformed JSON.', { code: 'INVALID_RESPONSE', status }); }
  if (status < 200 || status >= 300 || payload?.errorCode || payload?.error_code) throw responseError(status, payload);
  return Object.prototype.hasOwnProperty.call(payload || {}, 'data') ? payload.data : payload;
}

function readServerState(payload = {}) {
  const source = payload.serverGameState || payload.ServerGameState || payload;
  return {
    sessionName: cleanText(source.activeSessionName || source.ActiveSessionName, 200),
    players: Number(source.numConnectedPlayers ?? source.NumConnectedPlayers ?? 0) || 0,
    maxPlayers: Number(source.playerLimit ?? source.PlayerLimit ?? 0) || 0,
    techTier: Number(source.techTier ?? source.TechTier ?? 0) || 0,
    activeSchematic: cleanText(source.activeSchematic || source.ActiveSchematic, 300),
    gamePhase: cleanText(source.gamePhase || source.GamePhase, 200),
    isGameRunning: Boolean(source.isGameRunning ?? source.IsGameRunning)
  };
}

function parseLightweightResponse(buffer, expectedCookie) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 29) throw new SatisfactoryApiError('Satisfactory lightweight query returned a truncated response.', { code: 'INVALID_RESPONSE' });
  if (buffer.readUInt16LE(0) !== 0xF6D5 || buffer.readUInt8(2) !== 1 || buffer.readUInt8(3) !== 1) {
    throw new SatisfactoryApiError('Satisfactory lightweight query returned an unsupported envelope.', { code: 'INVALID_RESPONSE' });
  }
  const cookie = buffer.readBigUInt64LE(4);
  if (cookie !== expectedCookie) throw new SatisfactoryApiError('Satisfactory lightweight query response did not match the request.', { code: 'INVALID_RESPONSE' });
  const stateCode = buffer.readUInt8(12);
  const serverNetCl = buffer.readUInt32LE(13);
  const flags = buffer.readBigUInt64LE(17);
  const subStateCount = buffer.readUInt8(25);
  let offset = 26 + (subStateCount * 3);
  if (offset + 2 > buffer.length) throw new SatisfactoryApiError('Satisfactory lightweight query sub-state data is malformed.', { code: 'INVALID_RESPONSE' });
  const nameLength = buffer.readUInt16LE(offset);
  offset += 2;
  if (offset + nameLength > buffer.length) throw new SatisfactoryApiError('Satisfactory lightweight query server name is malformed.', { code: 'INVALID_RESPONSE' });
  const serverName = buffer.subarray(offset, offset + nameLength).toString('utf8').replace(/\u0000/g, '').trim().slice(0, 200);
  return {
    state: STATE_NAMES[stateCode] || 'unknown',
    stateCode,
    serverName,
    serverNetCl,
    modded: Boolean(flags & 1n),
    subStateCount
  };
}

class SatisfactoryApiClient {
  constructor(server = {}, options = {}) {
    this.host = normalizeHost(server.host);
    this.port = normalizePort(server.port);
    this.token = cleanText(server.password || server.apiToken, 12000);
    this.fingerprint = normalizeFingerprint(server.tlsFingerprint || server.certificateFingerprint);
    this.timeoutMs = Math.max(1000, Math.min(120000, Number(options.timeoutMs || server.timeoutMs || HTTPS_TIMEOUT_MS)));
    this.queryTimeoutMs = Math.max(500, Math.min(15000, Number(options.queryTimeoutMs || QUERY_TIMEOUT_MS)));
    this.httpsModule = options.httpsModule || https;
    this.tlsModule = options.tlsModule || tls;
    this.dgramModule = options.dgramModule || dgram;
    this.now = options.now || (() => Date.now());
  }

  endpoint() {
    const host = net.isIP(this.host) === 6 ? `[${this.host}]` : this.host;
    return `https://${host}:${this.port}/api/v1`;
  }

  async probeCertificate(options = {}) {
    const timeoutMs = Math.max(500, Math.min(15000, Number(options.timeoutMs || this.queryTimeoutMs)));
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = this.tlsModule.connect({
        host: this.host,
        port: this.port,
        servername: serverNameForTls(this.host),
        rejectUnauthorized: false
      });
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => finish(new SatisfactoryApiError('Timed out while reading the Satisfactory TLS certificate.', { code: 'TIMEOUT', retryable: true })), timeoutMs);
      socket.once('secureConnect', () => {
        try {
          const fingerprint = certificateFingerprint(socket.getPeerCertificate(true));
          finish(null, { fingerprint, formattedFingerprint: formatFingerprint(fingerprint), authorized: Boolean(socket.authorized), authorizationError: cleanText(socket.authorizationError, 300) });
        } catch (error) { finish(error); }
      });
      socket.once('error', (error) => finish(new SatisfactoryApiError(error.message, { code: 'CONNECTION_FAILED', retryable: true })));
    });
  }

  async queryLightweight(options = {}) {
    const family = net.isIP(this.host) === 6 ? 'udp6' : 'udp4';
    const socket = this.dgramModule.createSocket(family);
    const cookie = BigInt(this.now()) * 10000n + BigInt(crypto.randomInt(0, 10000));
    const request = Buffer.alloc(13);
    request.writeUInt16LE(0xF6D5, 0);
    request.writeUInt8(0, 2);
    request.writeUInt8(1, 3);
    request.writeBigUInt64LE(cookie, 4);
    request.writeUInt8(1, 12);
    const timeoutMs = Math.max(500, Math.min(15000, Number(options.timeoutMs || this.queryTimeoutMs)));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch {}
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => finish(new SatisfactoryApiError('Satisfactory lightweight query timed out.', { code: 'TIMEOUT', retryable: true })), timeoutMs);
      socket.once('error', (error) => finish(new SatisfactoryApiError(error.message, { code: 'CONNECTION_FAILED', retryable: true })));
      socket.on('message', (message) => {
        try { finish(null, parseLightweightResponse(message, cookie)); }
        catch (error) { finish(error); }
      });
      socket.send(request, this.port, this.host, (error) => {
        if (error) finish(new SatisfactoryApiError(error.message, { code: 'CONNECTION_FAILED', retryable: true }));
      });
    });
  }

  async request(functionName, data = {}, options = {}) {
    const name = cleanText(functionName, 120);
    if (!name) throw new SatisfactoryApiError('A Satisfactory API function name is required.', { code: 'INVALID_REQUEST' });
    const body = Buffer.from(JSON.stringify({ function: name, data: data && typeof data === 'object' ? data : {} }), 'utf8');
    const token = options.auth === false ? '' : this.token;
    if (options.auth !== false && !token) throw new SatisfactoryApiError('Save a Satisfactory application token before using authenticated operations.', { code: 'AUTH_FAILED' });
    const pinned = Boolean(this.fingerprint);
    return new Promise((resolve, reject) => {
      let settled = false;
      let received = 0;
      const chunks = [];
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve(value);
      };
      const request = this.httpsModule.request({
        host: this.host,
        port: this.port,
        path: '/api/v1',
        method: 'POST',
        servername: serverNameForTls(this.host),
        rejectUnauthorized: !pinned,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(body.length),
          ...(token ? { authorization: `Bearer ${token}` } : {})
        }
      }, (response) => {
        response.on('data', (chunk) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            request.destroy(new SatisfactoryApiError('Satisfactory API response exceeded the safe size limit.', { code: 'INVALID_RESPONSE' }));
            return;
          }
          chunks.push(chunk);
        });
        response.once('end', () => {
          try { finish(null, parseApiPayload(Number(response.statusCode || 0), Buffer.concat(chunks))); }
          catch (error) { finish(error); }
        });
      });
      request.once('socket', (socket) => {
        socket.once('secureConnect', () => {
          if (!pinned) return;
          try {
            const actual = certificateFingerprint(socket.getPeerCertificate(true));
            if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(this.fingerprint, 'hex'))) {
              request.destroy(new SatisfactoryApiError('The Satisfactory TLS certificate changed. Review and trust the new fingerprint before reconnecting.', {
                code: 'SECURITY_POLICY',
                details: { expectedFingerprint: formatFingerprint(this.fingerprint), observedFingerprint: formatFingerprint(actual) }
              }));
            }
          } catch (error) { request.destroy(error); }
        });
      });
      request.setTimeout(this.timeoutMs, () => request.destroy(new SatisfactoryApiError('Satisfactory API request timed out.', { code: 'TIMEOUT', retryable: true })));
      request.once('error', (error) => {
        if (error instanceof SatisfactoryApiError) return finish(error);
        const text = cleanText(error?.message || error, 1000);
        const certificateFailure = /self[- ]signed|unable to verify|certificate|issuer/i.test(text);
        finish(new SatisfactoryApiError(certificateFailure
          ? 'The Satisfactory server uses an untrusted certificate. Use Trust Current Certificate in Khaos Nexus before connecting.'
          : text, {
          code: certificateFailure ? 'SECURITY_POLICY' : 'CONNECTION_FAILED',
          retryable: !certificateFailure
        }));
      });
      options.signal?.addEventListener?.('abort', () => request.destroy(new SatisfactoryApiError('Satisfactory API operation was cancelled.', { code: 'CANCELLED' })), { once: true });
      request.end(body);
    });
  }

  health(options = {}) { return this.request('HealthCheck', { ClientCustomData: 'Khaos Nexus' }, { ...options, auth: false }); }
  queryServerState(options = {}) { return this.request('QueryServerState', {}, options); }
  getServerOptions(options = {}) { return this.request('GetServerOptions', {}, options); }
  enumerateSessions(options = {}) { return this.request('EnumerateSessions', {}, options); }
  runCommand(command, options = {}) {
    const value = cleanText(command, 1000);
    if (!value) throw new SatisfactoryApiError('A Satisfactory console command is required.', { code: 'INVALID_REQUEST' });
    return this.request('RunCommand', { Command: value }, options);
  }
  save(saveName, options = {}) {
    const fallback = `KhaosNexus-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}`;
    const value = cleanText(saveName, 200, fallback).replace(/[\\/:*?"<>|]/g, '-');
    return this.request('SaveGame', { SaveName: value }, options);
  }
  shutdown(options = {}) { return this.request('Shutdown', {}, options); }

  async status(options = {}) {
    let lightweight;
    try { lightweight = await this.queryLightweight(options); }
    catch (error) { lightweight = { state: 'unknown', error: cleanText(error.message, 500) }; }
    if (lightweight.state === 'loading') return { ...lightweight, online: true, apiAvailable: false, players: 0, maxPlayers: 0 };
    const [health, statePayload] = await Promise.all([this.health(options), this.queryServerState(options)]);
    const state = readServerState(statePayload);
    return {
      ...lightweight,
      state: lightweight.state === 'unknown' ? (state.isGameRunning ? 'playing' : 'idle') : lightweight.state,
      online: true,
      apiAvailable: true,
      health: cleanText(health?.health || health?.Health, 80),
      ...state
    };
  }

  async action(action, payload = {}, options = {}) {
    switch (action) {
      case 'status': return this.status(options);
      case 'health': return this.health(options);
      case 'info': return this.queryServerState(options).then(readServerState);
      case 'players': {
        const state = readServerState(await this.queryServerState(options));
        return { players: [], count: state.players, maxPlayers: state.maxPlayers, namesUnavailable: true };
      }
      case 'settings': return this.getServerOptions(options);
      case 'backup': return this.enumerateSessions(options);
      case 'save': return this.save(payload.saveName, options);
      case 'raw': return this.runCommand(payload.command, options);
      case 'shutdown': {
        if (payload.saveFirst !== false) await this.save(payload.saveName, options);
        return this.shutdown(options);
      }
      case 'stop': return this.shutdown(options);
      default: throw new SatisfactoryApiError(`Unsupported Satisfactory API action: ${action}`, { code: 'CAPABILITY_UNSUPPORTED' });
    }
  }
}

module.exports = {
  DEFAULT_PORT,
  STATE_NAMES,
  SatisfactoryApiError,
  SatisfactoryApiClient,
  normalizeHost,
  normalizePort,
  normalizeFingerprint,
  formatFingerprint,
  certificateFingerprint,
  parseApiPayload,
  parseLightweightResponse,
  readServerState
};