'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const selfsigned = require('selfsigned');
const QRCode = require('qrcode');
const { redactObject, redactText } = require('../../shared/redaction.cjs');
const { catalog, moduleProgress } = require('../../shared/module-registry.cjs');
const {
  MAX_REQUEST_BODY_BYTES, NONCE_TTL_MS, normalizeMobileGatewayConfig, createPairingSession,
  pairingSessionActive, createPairingRequest, pairingRequestActive, verifyClaimSecret,
  issueDeviceCredential, verifyDeviceCredential, verifyMobileRequestSignature, publicMobileGatewayState
} = require('../../shared/mobile-gateway.cjs');

const REQUEST_TIMEOUT_MS = 15000;
const RATE_WINDOW_MS = 60000;
const DEVICE_RATE_LIMIT = 90;
const PREAUTH_RATE_LIMIT = 120;
const PAIRING_RATE_LIMIT = 12;
const SERVER_CACHE_MS = 15000;
const MAX_LOGS = 200;

const clean = (value, max = 500, fallback = '') => (String(value ?? '').replace(/\u0000/g, '').trim() || fallback).slice(0, max);
const address = (request) => clean(String(request?.socket?.remoteAddress || '').replace(/^::ffff:/, ''), 120);
const safeError = (error, secrets = []) => clean(redactText(error?.message || error || 'Mobile Gateway request failed.', secrets), 500);
const gameModule = (server) => ({ palworld: 'palworld-operations', ark: 'ark-server-operations', rust: 'rust-server-operations' }[String(server?.game || '').toLowerCase()] || 'other-game-operations');
const publicBot = (state = {}) => ({
  status: clean(state.status, 40, 'stopped'), online: state.status === 'online' || Boolean(state.ready),
  username: clean(state.ready?.username || state.username, 100), guildCount: Math.max(0, Number(state.heartbeat?.guildCount ?? state.ready?.guildCount) || 0),
  latencyMs: Math.max(0, Number(state.heartbeat?.ping) || 0), memoryMb: Math.max(0, Number(state.heartbeat?.memoryMb) || 0),
  uptimeSeconds: Math.max(0, Number(state.heartbeat?.uptimeSeconds) || 0), readyAt: state.ready?.readyAt || state.heartbeat?.readyAt || null,
  lastHeartbeatAt: state.lastHeartbeatAt || null, supervised: true, attention: clean(state.lastError?.message, 300)
});
const publicUpdate = (state = {}) => ({
  status: clean(state.status, 40, 'idle'), currentVersion: clean(state.currentVersion, 40),
  availableVersion: clean(state.update?.version || state.availableVersion, 40), available: Boolean(state.update?.version || state.available),
  downloaded: state.status === 'downloaded' || Boolean(state.canInstall), progressPercent: Math.max(0, Math.min(100, Number(state.progress?.percent ?? state.progressPercent) || 0)),
  checkedAt: state.checkedAt || state.lastCheckedAt || null, error: clean(state.error, 300)
});

class MobileGatewayService extends EventEmitter {
  constructor(options = {}) {
    super();
    Object.assign(this, {
      dataDirectory: options.dataDirectory, configStore: options.configStore, logger: options.logger,
      supervisor: options.supervisor, updateService: options.updateService, autonomy: options.autonomy,
      appVersion: clean(options.appVersion, 40, 'unknown'), getStatusPanelService: options.getStatusPanelService || (() => null),
      now: options.now || (() => Date.now()), https: options.httpsModule || https, os: options.osModule || os,
      fs: options.fsModule || fs, selfsigned: options.selfsigned || selfsigned, qrcode: options.qrcode || QRCode
    });
    this.server = null; this.sockets = new Set(); this.streams = new Map(); this.rates = new Map(); this.nonces = new Map();
    this.pairingSession = null; this.pendingPairing = null; this.delivery = null; this.cache = { at: 0, servers: [] };
    this.runtime = { transportReady: false, transportStatus: 'disabled', certificateFingerprint: '', certificateExpiresAt: null, endpoints: [], activeSessions: 0, lastStartedAt: null, lastError: '', qrDataUrl: '', pairingUri: '' };
    this.tlsDirectory = path.join(this.dataDirectory, 'mobile-gateway', 'tls');
    this.certPath = path.join(this.tlsDirectory, 'certificate.pem'); this.keyPath = path.join(this.tlsDirectory, 'private-key.pem');
    this.cleanupTimer = setInterval(() => this.cleanup(), 30000); this.cleanupTimer.unref?.();
    this.reconcileTimer = setInterval(() => this.applyConfig().catch((error) => this.logger?.warn?.('Mobile Gateway reconciliation failed.', { message: safeError(error, this.secrets()) })), 5000); this.reconcileTimer.unref?.();
  }

  config() { return normalizeMobileGatewayConfig(this.configStore.getMobileGateway()); }
  secrets() { try { return this.configStore.getSecretValues?.() || []; } catch { return []; } }
  moduleEnabled() { try { const state = this.configStore.getRuntimeBootstrap()?.config?.moduleRuntime?.['mobile-gateway']; return state ? Boolean(state.effectiveEnabled) : true; } catch { return false; } }
  state() { return publicMobileGatewayState(this.config(), this.pairingSession, { ...this.runtime, pendingPairing: this.pendingPairing }); }
  publicState() { return this.state(); }
  emitState() { const state = this.state(); this.emit('state', state); return state; }
  addresses() {
    const output = [];
    for (const entries of Object.values(this.os.networkInterfaces?.() || {})) for (const item of entries || []) {
      const family = typeof item.family === 'string' ? item.family : item.family === 4 ? 'IPv4' : '';
      if (!item.internal && family === 'IPv4' && item.address && !output.includes(item.address)) output.push(item.address);
    }
    return output.slice(0, 12);
  }
  endpoints(config = this.config()) {
    const values = config.allowLanPairing || config.remoteAccessMode === 'private-network' ? this.addresses() : ['127.0.0.1'];
    if (!values.length) values.push('127.0.0.1');
    return values.map((value) => `https://${value}:${config.port}`);
  }
  async certificate() {
    this.fs.mkdirSync(this.tlsDirectory, { recursive: true });
    let key = ''; let cert = '';
    try { key = this.fs.readFileSync(this.keyPath, 'utf8'); cert = this.fs.readFileSync(this.certPath, 'utf8'); } catch {}
    let valid = false;
    try { valid = new Date(new crypto.X509Certificate(cert).validTo).getTime() - this.now() > 30 * 86400000; } catch {}
    if (!key || !cert || !valid) {
      const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...this.addresses().map((ip) => ({ type: 7, ip }))];
      const generated = await Promise.resolve(this.selfsigned.generate([{ name: 'commonName', value: 'Khaos Nexus Mobile Gateway' }], {
        algorithm: 'sha256', keySize: 2048, days: 825,
        extensions: [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }, { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames }]
      }));
      if (!generated?.private || !generated?.cert) throw new Error('TLS certificate generation failed.');
      key = generated.private; cert = generated.cert;
      this.fs.writeFileSync(this.keyPath, key, { encoding: 'utf8', mode: 0o600 }); this.fs.writeFileSync(this.certPath, cert, 'utf8');
      try { this.fs.chmodSync(this.keyPath, 0o600); } catch {}
    }
    const parsed = new crypto.X509Certificate(cert);
    return { key, cert, fingerprint: parsed.fingerprint256, expiresAt: new Date(parsed.validTo).toISOString() };
  }
  async applyConfig() {
    const config = this.config();
    if (!config.enabled || !this.moduleEnabled()) { if (this.server || this.runtime.transportStatus !== 'disabled') await this.stop('disabled'); return this.state(); }
    if (this.server && JSON.stringify(this.runtime.endpoints) === JSON.stringify(this.endpoints(config))) return this.state();
    if (this.server) await this.stop('reconfigure');
    return this.start();
  }
  async start() {
    if (this.server || !this.config().enabled || !this.moduleEnabled()) return this.state();
    this.runtime = { ...this.runtime, transportStatus: 'starting', lastError: '' }; this.emitState();
    try {
      const config = this.config(); const tls = await this.certificate();
      const bind = config.allowLanPairing || config.remoteAccessMode === 'private-network' ? '0.0.0.0' : '127.0.0.1';
      const server = this.https.createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, (request, response) => this.handle(request, response));
      server.on('connection', (socket) => { this.sockets.add(socket); socket.on('close', () => this.sockets.delete(socket)); });
      server.on('clientError', (_error, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {} });
      server.maxConnections = 50; server.requestTimeout = REQUEST_TIMEOUT_MS; server.headersTimeout = 10000; server.keepAliveTimeout = 5000; server.maxHeadersCount = 40;
      await new Promise((resolve, reject) => { const failed = (error) => reject(error); server.once('error', failed); server.listen(config.port, bind, () => { server.off('error', failed); resolve(); }); });
      this.server = server;
      this.runtime = { ...this.runtime, transportReady: true, transportStatus: 'online', certificateFingerprint: tls.fingerprint, certificateExpiresAt: tls.expiresAt, endpoints: this.endpoints(config), lastStartedAt: new Date(this.now()).toISOString(), lastError: '' };
      this.logger?.info?.('Mobile Gateway HTTPS transport started.', { bindAddress: bind, port: config.port, certificateFingerprint: tls.fingerprint });
      return this.emitState();
    } catch (error) { this.runtime = { ...this.runtime, transportReady: false, transportStatus: 'error', endpoints: [], lastError: safeError(error, this.secrets()) }; this.emitState(); throw error; }
  }
  async stop(reason = 'stopped') {
    this.cancelPairing(); for (const list of this.streams.values()) for (const response of list) try { response.end(); } catch {}
    this.streams.clear(); const server = this.server; this.server = null;
    if (server) { await Promise.race([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => setTimeout(resolve, 1500))]); for (const socket of this.sockets) try { socket.destroy(); } catch {} }
    this.sockets.clear(); this.runtime = { ...this.runtime, transportReady: false, transportStatus: reason === 'disabled' ? 'disabled' : 'stopped', activeSessions: 0, endpoints: reason === 'reconfigure' ? [] : this.runtime.endpoints };
    return this.emitState();
  }
  async regenerateCertificate() {
    await this.stop('reconfigure');
    for (const file of [this.certPath, this.keyPath]) try { this.fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.configStore.revokeAllMobileDevices?.();
    this.runtime = { ...this.runtime, certificateFingerprint: '', certificateExpiresAt: null, endpoints: [] };
    if (this.config().enabled && this.moduleEnabled()) await this.start();
    return this.emitState();
  }
  async createPairing(role = 'viewer') {
    if (!this.runtime.transportReady) throw new Error('Enable and start the HTTPS Mobile Gateway before pairing.');
    const endpoint = this.runtime.endpoints.find((value) => !value.includes('127.0.0.1'));
    if (!endpoint) throw new Error('Enable local-network pairing or private-network mode before pairing a physical Android device.');
    this.pendingPairing = null; this.delivery = null; this.pairingSession = createPairingSession({ requestedRole: role, now: this.now() });
    const query = new URLSearchParams({ version: '1', endpoint, code: this.pairingSession.code, fingerprint: this.runtime.certificateFingerprint, session: this.pairingSession.id });
    this.runtime.pairingUri = `khaosnexus://pair?${query}`;
    this.runtime.qrDataUrl = await this.qrcode.toDataURL(this.runtime.pairingUri, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
    return this.emitState();
  }
  cancelPairing() { this.pairingSession = null; this.pendingPairing = null; this.delivery = null; this.runtime.qrDataUrl = ''; this.runtime.pairingUri = ''; return this.emitState(); }
  approvePairing(id) {
    if (!this.pendingPairing || this.pendingPairing.id !== String(id || '') || !pairingRequestActive(this.pendingPairing, new Date(this.now()))) throw new Error('The Android pairing request was not found or expired.');
    const issued = issueDeviceCredential({ name: this.pendingPairing.name, role: this.pendingPairing.requestedRole, publicKeyPem: this.pendingPairing.publicKeyPem }, new Date(this.now()));
    this.configStore.upsertMobileDevice(issued.device); this.pendingPairing = { ...this.pendingPairing, status: 'approved', decidedAt: new Date(this.now()).toISOString() };
    this.delivery = { credential: issued.credential, device: issued.device, expiresAt: new Date(this.now() + 120000).toISOString() };
    return this.emitState();
  }
  rejectPairing(id, reason = '') {
    if (!this.pendingPairing || this.pendingPairing.id !== String(id || '')) throw new Error('The Android pairing request was not found.');
    this.pendingPairing = { ...this.pendingPairing, status: 'rejected', decidedAt: new Date(this.now()).toISOString(), rejectionReason: clean(reason, 200, 'Rejected by the Khaos Nexus Owner.') }; this.delivery = null;
    return this.emitState();
  }
  revokeDevice(id) { this.closeStreams(id); this.nonces.delete(String(id || '')); return this.emitState(); }
  removeDevice(id) { return this.revokeDevice(id); }
  closeStreams(id) { const list = this.streams.get(String(id || '')) || new Set(); for (const response of list) try { response.end(); } catch {} this.streams.delete(String(id || '')); this.runtime.activeSessions = [...this.streams.values()].reduce((sum, set) => sum + set.size, 0); }
  cleanup() {
    const now = this.now();
    if (this.pairingSession && !pairingSessionActive(this.pairingSession, new Date(now)) && !this.pairingSession.pendingRequestId) this.cancelPairing();
    if (this.pendingPairing?.status === 'pending' && !pairingRequestActive(this.pendingPairing, new Date(now))) { this.pendingPairing = { ...this.pendingPairing, status: 'expired' }; this.delivery = null; this.emitState(); }
    if (this.delivery && new Date(this.delivery.expiresAt).getTime() <= now) this.delivery = null;
    for (const [key, item] of this.rates) if (now - item.startedAt > RATE_WINDOW_MS * 2) this.rates.delete(key);
    for (const [id, values] of this.nonces) { for (const [nonce, expires] of values) if (expires <= now) values.delete(nonce); if (!values.size) this.nonces.delete(id); }
  }
  allow(key, limit) { const now = this.now(); const item = this.rates.get(key); if (!item || now - item.startedAt >= RATE_WINDOW_MS) { this.rates.set(key, { startedAt: now, count: 1 }); return true; } item.count += 1; return item.count <= limit; }
  useNonce(id, nonce) { const now = this.now(); const values = this.nonces.get(id) || new Map(); for (const [value, expires] of values) if (expires <= now) values.delete(value); if (values.has(nonce)) return false; values.set(nonce, now + NONCE_TTL_MS); this.nonces.set(id, values); return true; }
  async body(request) { const chunks = []; let total = 0; for await (const chunk of request) { total += chunk.length; if (total > MAX_REQUEST_BODY_BYTES) throw Object.assign(new Error('The request body is too large.'), { status: 413, code: 'BODY_TOO_LARGE' }); chunks.push(chunk); } return Buffer.concat(chunks); }
  json(body) { try { return body.length ? JSON.parse(body.toString('utf8')) : {}; } catch { throw Object.assign(new Error('The request body must contain valid JSON.'), { status: 400, code: 'INVALID_JSON' }); } }
  device(id) { return this.config().devices.find((item) => item.id === String(id || '')) || null; }
  authenticate(request, body) {
    const remote = address(request); if (!this.allow(`pre:${remote}`, PREAUTH_RATE_LIMIT)) throw Object.assign(new Error('Too many authentication attempts.'), { status: 429, code: 'RATE_LIMITED' });
    const id = clean(request.headers['x-khaos-device-id'], 100); const auth = String(request.headers.authorization || ''); const credential = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const device = this.device(id); if (!device || !verifyDeviceCredential(device, credential)) throw Object.assign(new Error('The device credential is invalid or revoked.'), { status: 401, code: 'AUTH_FAILED' });
    if (!this.allow(`dev:${id}`, DEVICE_RATE_LIMIT)) throw Object.assign(new Error('The mobile device request limit was exceeded.'), { status: 429, code: 'RATE_LIMITED' });
    const nonce = clean(request.headers['x-khaos-nonce'], 160);
    const verified = verifyMobileRequestSignature(device, { method: request.method, path: request.url, timestamp: clean(request.headers['x-khaos-timestamp'], 30), nonce, signature: clean(request.headers['x-khaos-signature'], 1000), body }, this.now());
    if (!verified.ok) throw Object.assign(new Error('The signed mobile request could not be verified.'), { status: 401, code: verified.code || 'SIGNATURE_INVALID' });
    if (!this.useNonce(id, nonce)) throw Object.assign(new Error('The mobile request nonce was already used.'), { status: 409, code: 'REPLAY_DETECTED' });
    this.configStore.touchMobileDevice?.(id, { lastSeenAt: new Date(this.now()).toISOString(), lastAddress: remote });
    return device;
  }
  publicLog(entry = {}) { return redactObject({ time: entry.time || null, source: clean(entry.source, 80, 'manager'), level: clean(entry.level, 20, 'info'), message: clean(entry.message, 1000), meta: entry.meta || {} }, this.secrets()); }
  modules() { const runtime = this.configStore.getRuntimeBootstrap().config.moduleRuntime || {}; const states = this.configStore.getConfig().general?.moduleMigration || {}; return catalog().map((item) => ({ id: item.id, name: item.name, category: item.category, stage: item.stage, availability: item.availability, effectiveEnabled: Boolean(runtime[item.id]?.effectiveEnabled), reason: runtime[item.id]?.reason || '', blockedBy: runtime[item.id]?.blockedBy || [], progress: moduleProgress(states[item.id]) })); }
  panels() { const panels = this.configStore.getStatusPanels?.().panels || []; return panels.map((item) => ({ id: item.id, name: item.name, enabled: item.enabled, serverId: item.serverId, published: Boolean(item.messageId), refreshMinutes: item.refreshMinutes, lastRefreshedAt: item.lastRefreshedAt, lastError: clean(item.lastError, 300) })); }
  async servers(force = false) {
    if (!force && this.now() - this.cache.at < SERVER_CACHE_MS) return this.cache.servers;
    const runtime = this.configStore.getRuntimeBootstrap(); const health = this.autonomy?.getState?.()?.serverHealth || {};
    const list = (runtime.config.servers || []).map((server) => { const module = runtime.config.moduleRuntime?.[gameModule(server)]; const item = health[server.id] || {}; return { id: server.id, name: server.name, game: server.game, enabled: server.enabled !== false, moduleEnabled: module ? Boolean(module.effectiveEnabled) : true, status: server.enabled === false || (module && !module.effectiveEnabled) ? 'disabled' : clean(item.status, 40, 'unknown'), checkedAt: item.checkedAt || null, failures: Number(item.failures) || 0, detail: clean(item.detail, 300) }; });
    this.cache = { at: this.now(), servers: list }; return list;
  }
  headers(response, status = 200, type = 'application/json; charset=utf-8') { response.statusCode = status; response.setHeader('Content-Type', type); response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('X-Frame-Options', 'DENY'); response.setHeader('Content-Security-Policy', "default-src 'none'"); }
  send(response, status, payload) { const value = JSON.stringify(redactObject(payload, this.secrets())); this.headers(response, status); response.setHeader('Content-Length', Buffer.byteLength(value)); response.end(value); }
  fail(response, status, code, message, requestId) { this.send(response, status, { ok: false, error: { code, message }, requestId }); }
  async route(request, response, url, body, requestId) {
    const method = String(request.method || 'GET').toUpperCase(); const pathname = url.pathname;
    if (method === 'GET' && pathname === '/v1/health') return this.send(response, 200, { ok: true, service: 'Khaos Nexus Mobile Gateway', version: this.appVersion, certificateFingerprint: this.runtime.certificateFingerprint, time: new Date(this.now()).toISOString() });
    if (method === 'POST' && pathname === '/v1/pairing/request') {
      if (!this.allow(`pair:${address(request)}`, PAIRING_RATE_LIMIT) || !pairingSessionActive(this.pairingSession, new Date(this.now()))) return this.fail(response, 410, 'PAIRING_EXPIRED', 'No active pairing session is available.', requestId);
      const created = createPairingRequest(this.pairingSession, this.json(body), { now: this.now(), address: address(request) }); this.pairingSession = created.consumedSession; this.pendingPairing = created.request; this.runtime.qrDataUrl = ''; this.runtime.pairingUri = ''; this.emitState();
      return this.send(response, 202, { ok: true, requestId: created.request.id, claimSecret: created.claimSecret, status: 'pending-owner-approval', expiresAt: created.request.expiresAt, pollAfterMs: 1500 });
    }
    if (method === 'POST' && pathname === '/v1/pairing/complete') {
      const input = this.json(body);
      if (!this.pendingPairing || this.pendingPairing.id !== String(input.requestId || '') || !verifyClaimSecret(this.pendingPairing, input.claimSecret)) return this.fail(response, 401, 'PAIRING_CLAIM_INVALID', 'The pairing completion claim is invalid.', requestId);
      if (this.pendingPairing.status === 'pending') return this.send(response, 202, { ok: true, status: 'pending-owner-approval', pollAfterMs: 1500 });
      if (this.pendingPairing.status === 'rejected') return this.fail(response, 403, 'PAIRING_REJECTED', this.pendingPairing.rejectionReason, requestId);
      if (!this.delivery || new Date(this.delivery.expiresAt).getTime() <= this.now()) return this.fail(response, 410, 'PAIRING_DELIVERY_EXPIRED', 'The approved credential delivery expired.', requestId);
      const device = this.delivery.device; return this.send(response, 200, { ok: true, status: 'approved', credential: this.delivery.credential, deviceId: device.id, role: device.role, certificateFingerprint: this.runtime.certificateFingerprint });
    }
    const device = this.authenticate(request, body);
    if (method === 'GET' && pathname === '/v1/session') return this.send(response, 200, { ok: true, device: { id: device.id, name: device.name, role: device.role, publicKeyFingerprint: device.publicKeyFingerprint }, desktopVersion: this.appVersion });
    if (method === 'GET' && pathname === '/v1/dashboard') { const servers = await this.servers(); return this.send(response, 200, { ok: true, dashboard: { desktop: { version: this.appVersion, status: 'online' }, discord: publicBot(this.supervisor?.getState?.() || {}), servers, modules: this.modules(), alerts: this.autonomy?.getState?.()?.attention || [], update: publicUpdate(this.updateService?.getState?.() || {}) } }); }
    if (method === 'GET' && pathname === '/v1/discord') return this.send(response, 200, { ok: true, discord: publicBot(this.supervisor?.getState?.() || {}) });
    if (method === 'GET' && pathname === '/v1/servers') return this.send(response, 200, { ok: true, servers: await this.servers(url.searchParams.get('refresh') === '1') });
    if (method === 'GET' && pathname.startsWith('/v1/servers/')) { const item = (await this.servers()).find((server) => server.id === decodeURIComponent(pathname.slice(12))); return item ? this.send(response, 200, { ok: true, server: item }) : this.fail(response, 404, 'SERVER_NOT_FOUND', 'The selected server was not found.', requestId); }
    if (method === 'GET' && pathname === '/v1/modules') return this.send(response, 200, { ok: true, modules: this.modules() });
    if (method === 'GET' && pathname === '/v1/logs') return this.send(response, 200, { ok: true, logs: (this.logger?.recent?.(MAX_LOGS) || []).map((entry) => this.publicLog(entry)) });
    if (method === 'GET' && pathname === '/v1/status-panels') return this.send(response, 200, { ok: true, statusPanels: this.panels() });
    if (method === 'GET' && pathname === '/v1/update') return this.send(response, 200, { ok: true, update: publicUpdate(this.updateService?.getState?.() || {}) });
    if (method === 'GET' && pathname === '/v1/events') return this.openStream(request, response, device);
    return this.fail(response, 404, 'NOT_FOUND', 'The Mobile Gateway route was not found.', requestId);
  }
  async handle(request, response) {
    const requestId = crypto.randomUUID(); response.setHeader('X-Khaos-Request-Id', requestId);
    try {
      if (!this.runtime.transportReady) return this.fail(response, 503, 'GATEWAY_NOT_READY', 'The Mobile Gateway is not ready.', requestId);
      const method = String(request.method || 'GET').toUpperCase(); if (!['GET', 'POST'].includes(method)) return this.fail(response, 405, 'METHOD_NOT_ALLOWED', 'This method is not supported.', requestId);
      const url = new URL(request.url || '/', 'https://khaos-nexus.local'); if (!url.pathname.startsWith('/v1/')) return this.fail(response, 404, 'NOT_FOUND', 'The Mobile Gateway route was not found.', requestId);
      return await this.route(request, response, url, await this.body(request), requestId);
    } catch (error) { const status = Number(error.status) || 500; this.fail(response, status, clean(error.code, 80, 'REQUEST_REJECTED'), status >= 500 ? 'The Mobile Gateway could not complete this request.' : safeError(error, this.secrets()), requestId); }
  }
  openStream(request, response, device) {
    this.headers(response, 200, 'text/event-stream; charset=utf-8'); response.setHeader('Connection', 'keep-alive'); response.flushHeaders?.();
    const list = this.streams.get(device.id) || new Set(); list.add(response); this.streams.set(device.id, list); this.runtime.activeSessions = [...this.streams.values()].reduce((sum, set) => sum + set.size, 0); this.emitState();
    const timer = setInterval(() => { const current = this.device(device.id); if (!current?.enabled || current.revokedAt) response.end(); else response.write(`event: heartbeat\ndata: ${JSON.stringify({ time: new Date(this.now()).toISOString() })}\n\n`); }, 15000); timer.unref?.();
    const close = () => { clearInterval(timer); list.delete(response); if (!list.size) this.streams.delete(device.id); }; request.on('close', close); response.on('close', close);
  }
  destroy() { clearInterval(this.cleanupTimer); clearInterval(this.reconcileTimer); return this.stop('stopped'); }
}

module.exports = { MobileGatewayService, publicBotState: publicBot, publicUpdateState: publicUpdate, deviceModuleId: gameModule, sanitizeError: safeError, REQUEST_TIMEOUT_MS, DEVICE_RATE_LIMIT, PAIRING_RATE_LIMIT, PREAUTH_RATE_LIMIT };
