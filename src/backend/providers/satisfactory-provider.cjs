'use strict';

const crypto = require('node:crypto');
const https = require('node:https');
const net = require('node:net');

const SATISFACTORY_ACTIONS = Object.freeze(['status', 'players', 'save']);
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function cleanText(value, max = 300, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function normalizeHost(value) {
  let host = cleanText(value, 255);
  if (!host) throw new Error('A Satisfactory server host is required.');
  if (/^[a-z]+:\/\//i.test(host) || /[/?#]/.test(host)) throw new Error('Enter only the Satisfactory host or IP address.');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.includes(':') && net.isIP(host) !== 6) throw new Error('Keep the Satisfactory host and API port separate.');
  return host;
}

function normalizePort(value) {
  const port = Number(value || 7777);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A valid Satisfactory API port is required.');
  return port;
}

function normalizeFingerprint(value) {
  const fingerprint = cleanText(value, 200).replace(/[^a-f0-9]/gi, '').toUpperCase();
  if (!fingerprint) return '';
  if (!/^[A-F0-9]{64}$/.test(fingerprint)) throw new Error('Satisfactory TLS fingerprint must be SHA-256.');
  return fingerprint;
}

function certificateFingerprint(certificate) {
  if (!certificate?.raw) throw new Error('Satisfactory server did not provide a TLS certificate.');
  return crypto.createHash('sha256').update(certificate.raw).digest('hex').toUpperCase();
}

function readServerState(payload = {}) {
  const source = payload?.serverGameState || payload?.ServerGameState || payload || {};
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

class SatisfactoryApiClient {
  constructor(connection = {}, options = {}) {
    this.host = normalizeHost(connection.host);
    this.port = normalizePort(connection.port);
    this.token = String(connection.password || connection.apiToken || '');
    if (!this.token) throw new Error('Satisfactory application token is required.');
    this.fingerprint = normalizeFingerprint(connection.tlsFingerprint || connection.certificateFingerprint);
    this.timeoutMs = Math.max(1000, Math.min(120000, Number(options.timeoutMs || connection.timeoutMs || 15000)));
    this.httpsModule = options.httpsModule || https;
    this.now = options.now || (() => Date.now());
  }

  async request(functionName, data = {}) {
    const name = cleanText(functionName, 120);
    if (!name) throw new Error('A Satisfactory API function is required.');
    const body = Buffer.from(JSON.stringify({ function: name, data: data && typeof data === 'object' ? data : {} }), 'utf8');
    const pinned = Boolean(this.fingerprint);

    return new Promise((resolve, reject) => {
      let settled = false;
      let received = 0;
      const chunks = [];
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value);
      };
      const request = this.httpsModule.request({
        host: this.host,
        port: this.port,
        path: '/api/v1',
        method: 'POST',
        servername: net.isIP(this.host) ? undefined : this.host,
        rejectUnauthorized: !pinned,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(body.length),
          authorization: `Bearer ${this.token}`
        }
      }, (response) => {
        response.on('data', (chunk) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            request.destroy(new Error('Satisfactory API response exceeded the safe size limit.'));
            return;
          }
          chunks.push(chunk);
        });
        response.once('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            const payload = text ? JSON.parse(text) : null;
            const status = Number(response.statusCode || 0);
            if (status < 200 || status >= 300 || payload?.errorCode || payload?.error_code) {
              const detail = cleanText(payload?.errorMessage || payload?.error_message || payload?.message, 500);
              throw new Error(`Satisfactory API request failed with HTTP ${status}${detail ? `: ${detail}` : ''}.`);
            }
            finish(null, payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload);
          } catch (error) {
            finish(error);
          }
        });
      });

      request.once('socket', (socket) => {
        if (!pinned) return;
        socket.once('secureConnect', () => {
          try {
            const actual = certificateFingerprint(socket.getPeerCertificate(true));
            const expectedBuffer = Buffer.from(this.fingerprint, 'hex');
            const actualBuffer = Buffer.from(actual, 'hex');
            if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
              request.destroy(new Error('Satisfactory TLS certificate changed. Review the new fingerprint before reconnecting.'));
            }
          } catch (error) {
            request.destroy(error);
          }
        });
      });

      request.setTimeout(this.timeoutMs, () => request.destroy(new Error('Satisfactory API request timed out.')));
      request.once('error', (error) => {
        const text = cleanText(error?.message || error, 800, 'Satisfactory connection failed.');
        if (!pinned && /self[- ]signed|unable to verify|certificate|issuer/i.test(text)) {
          finish(new Error('Satisfactory uses an untrusted TLS certificate. Configure its SHA-256 certificate fingerprint before connecting.'));
        } else {
          finish(new Error(text));
        }
      });
      request.end(body);
    });
  }

  queryServerState() { return this.request('QueryServerState', {}); }

  save(saveName) {
    const fallback = `KhaosNexus-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}`;
    const name = cleanText(saveName, 200, fallback).replace(/[\\/:*?"<>|]/g, '-');
    return this.request('SaveGame', { SaveName: name });
  }
}

class SatisfactoryProvider {
  constructor(connection = {}, options = {}) {
    this.client = options.client || new SatisfactoryApiClient(connection, options);
    this.connected = true;
    this.providerKind = 'satisfactory-https';
    this.supportedActions = [...SATISFACTORY_ACTIONS];
  }

  async invoke(actionId, payload = {}) {
    if (!this.supportedActions.includes(actionId)) throw new Error(`Satisfactory HTTPS API does not expose ${actionId} through Nexus yet.`);
    if (actionId === 'status') {
      const state = readServerState(await this.client.queryServerState());
      return { online: true, state: state.isGameRunning ? 'playing' : 'idle', ...state };
    }
    if (actionId === 'players') {
      const state = readServerState(await this.client.queryServerState());
      return { count: state.players, maxPlayers: state.maxPlayers, players: [], namesUnavailable: true };
    }
    if (actionId === 'save') return this.client.save(payload.saveName || payload.input);
    throw new Error(`Unsupported Satisfactory action: ${actionId}`);
  }
}

module.exports = {
  SatisfactoryProvider,
  SatisfactoryApiClient,
  SATISFACTORY_ACTIONS,
  normalizeHost,
  normalizePort,
  normalizeFingerprint,
  certificateFingerprint,
  readServerState
};
