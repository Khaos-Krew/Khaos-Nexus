'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { adminPairingStore } = require('./admin-pairing.cjs');
const { commandStatus, discoverRankMappings } = require('./discord-admin-discovery.cjs');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(payload);
}

async function body(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) throw new Error('Admin request is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function safeModuleId(value) {
  const id = String(value || '').trim().toLowerCase();
  return /^[a-z0-9-]{0,60}$/.test(id) ? id : '';
}

async function enhancedScan(controller) {
  const scan = await controller.scan();
  scan.sections ||= {};
  const [commands, rankDiscovery] = await Promise.all([
    commandStatus(controller).catch((error) => ({ ok: false, commands: [], desired: [], error: String(error?.message || error).slice(0, 240) })),
    discoverRankMappings(controller).catch((error) => ({ ok: false, ranks: [], suggestedSettings: { rankRoles: {}, rankSkus: {} }, counts: { discoveredRoles: 0, discoveredSkus: 0, attention: 0 }, error: String(error?.message || error).slice(0, 240) }))
  ]);
  scan.sections.commands = commands;
  scan.sections.rankDiscovery = rankDiscovery;
  scan.ok = Object.values(scan.sections).every((section) => section?.ok !== false);
  return scan;
}

function createPairingLimiter() {
  const attempts = new Map();
  return (req) => {
    const now = Date.now();
    const key = String(req.socket?.remoteAddress || 'unknown');
    const recent = (attempts.get(key) || []).filter((time) => now - time < 60_000);
    recent.push(now);
    attempts.set(key, recent);
    if (attempts.size > 1000) {
      for (const [address, times] of attempts) if (!times.some((time) => now - time < 60_000)) attempts.delete(address);
    }
    return recent.length <= 10;
  };
}

function createSentinalAdminServer(options = {}) {
  const host = String(options.host || '127.0.0.1');
  const port = Number(options.port || 3220);
  const token = String(options.token || '');
  const getController = typeof options.getController === 'function' ? options.getController : () => options.controller || null;
  const logger = options.logger || console;
  const pairingAllowed = createPairingLimiter();
  if (!LOOPBACK.has(host) && !token) throw new Error('Sentinal admin API requires a token before it can listen outside loopback.');

  function authorized(req) {
    if (!token) return LOOPBACK.has(host);
    return req.headers.authorization === `Bearer ${token}`;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const controller = getController();
      if (req.method === 'GET' && url.pathname === '/health') {
        if (!controller) return json(res, 200, { ok: true, service: 'nexus-sentinal-admin', discordReady: false, state: 'starting' });
        const status = await controller.status().catch((error) => ({ ok: false, message: String(error?.message || error) }));
        return json(res, 200, { ok: true, service: 'nexus-sentinal-admin', discordReady: Boolean(status?.discordReady), sentinal: status });
      }
      if (req.method === 'POST' && url.pathname === '/v1/pair') {
        if (!token) return json(res, 503, { ok: false, code: 'PAIRING_DISABLED', message: 'Hosted Sentinal pairing requires a protected admin token.' });
        if (!pairingAllowed(req)) return json(res, 429, { ok: false, code: 'PAIRING_RATE_LIMIT', message: 'Too many pairing attempts. Generate a new code and try again shortly.' });
        const input = await body(req);
        const paired = adminPairingStore.consume(input.code);
        if (!paired) return json(res, 401, { ok: false, code: 'PAIRING_INVALID', message: 'That pairing code is invalid, expired, or already used.' });
        return json(res, 200, { ok: true, token, pairedAt: new Date().toISOString() });
      }
      if (!authorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED' });
      if (!controller) return json(res, 503, { ok: false, code: 'SENTINAL_STARTING', message: 'Nexus Sentinal is not ready yet.' });

      if (req.method === 'GET' && url.pathname === '/v1/status') return json(res, 200, await controller.status());
      if (req.method === 'GET' && url.pathname === '/v1/config') return json(res, 200, { ok: true, settings: controller.adminConfig() });
      if (req.method === 'GET' && url.pathname === '/v1/permissions') return json(res, 200, await controller.permissions());
      if (req.method === 'GET' && url.pathname === '/v1/commands') return json(res, 200, await commandStatus(controller));
      if (req.method === 'GET' && url.pathname === '/v1/channels') return json(res, 200, await controller.inspectChannels(safeModuleId(url.searchParams.get('module'))));
      if (req.method === 'GET' && url.pathname === '/v1/roles') return json(res, 200, await controller.reconcileRoles({ dryRun: true }));
      if (req.method === 'GET' && url.pathname === '/v1/rank-mappings/discover') return json(res, 200, await discoverRankMappings(controller));
      if (req.method === 'GET' && url.pathname === '/v1/scan') return json(res, 200, await enhancedScan(controller));

      if (req.method === 'POST' && url.pathname === '/v1/config') {
        const configured = controller.configure(await body(req));
        const backend = await controller.backend?.configureModules?.(configured.settings.moduleEnabled || {}).catch((error) => ({ ok: false, message: String(error?.message || error) }));
        return json(res, backend?.ok === false ? 502 : 200, { ...configured, backend: backend || null });
      }
      if (req.method === 'POST' && url.pathname === '/v1/commands/sync') {
        await controller.syncCommands();
        return json(res, 200, await commandStatus(controller));
      }
      if (req.method === 'POST' && url.pathname === '/v1/channels/reconcile') {
        const input = await body(req);
        return json(res, 200, await controller.reconcileChannels(safeModuleId(input.moduleId)));
      }
      if (req.method === 'POST' && url.pathname === '/v1/consoles/refresh') {
        const input = await body(req);
        return json(res, 200, await controller.refreshConsoles(safeModuleId(input.moduleId)));
      }
      if (req.method === 'POST' && url.pathname === '/v1/roles/reconcile') return json(res, 200, await controller.reconcileRoles({ dryRun: false }));
      if (req.method === 'POST' && url.pathname === '/v1/repair') return json(res, 200, await controller.repair());
      return json(res, 404, { ok: false, code: 'NOT_FOUND' });
    } catch (error) {
      logger.error?.('[Nexus Sentinal Admin]', error);
      return json(res, 500, { ok: false, code: 'INTERNAL', message: String(error?.message || error).slice(0, 300) });
    }
  });

  let started = false;
  async function start() {
    if (started) return { host, port };
    await new Promise((resolve, reject) => {
      const onError = (error) => { server.off('listening', onListening); reject(error); };
      const onListening = () => { server.off('error', onError); started = true; resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
    logger.log?.(`[Nexus Sentinal Admin] listening on http://${host}:${port}`);
    return { host, port };
  }

  async function stop() {
    if (!started || !server.listening) return;
    await new Promise((resolve) => server.close(resolve));
    started = false;
  }

  return { host, port, server, start, stop, isStarted: () => started && server.listening };
}

module.exports = { LOOPBACK, createPairingLimiter, createSentinalAdminServer, enhancedScan, safeModuleId };