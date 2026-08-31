'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { currentHostedProviderStore } = require('../railway/hosted-provider-store.cjs');
const { adminPairingStore } = require('./admin-pairing.cjs');
const { commandStatus, discoverRankMappings } = require('./discord-admin-discovery.cjs');
const { buildStaffNameColorPreview } = require('./staff-name-color-preview.cjs');
const { ArkBackendControl } = require('./ark-backend-control.cjs');

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

function validAdminToken(value) {
  const token = String(value || '');
  return token.length >= 32 && token.length <= 1024 && !/\s/.test(token);
}

function publicHealth(status = null) {
  const discordReady = Boolean(status?.discordReady);
  const backendReady = Boolean(status?.backend?.ok);
  return {
    ok: true,
    service: 'nexus-sentinal-admin',
    state: discordReady ? 'ready' : 'starting',
    discordReady,
    backendReady
  };
}

async function hostedProviderStatus(controller) {
  const store = currentHostedProviderStore();
  if (!store) return null;
  const status = store.status();
  const backend = await controller.backend?.modules?.().catch((error) => ({ ok: false, modules: [], message: String(error?.message || error).slice(0, 240) })) || { ok: false, modules: [] };
  return { ...status, ok: status.ok !== false && backend.ok !== false, backendModules: backend.modules || [], backendMessage: backend.message || '' };
}

async function staffNameColorPreview(controller) {
  const guild = controller?.guild;
  if (!guild) return { ok: false, readOnly: true, mutationAuthorized: false, code: 'GUILD_UNAVAILABLE' };
  const roles = await guild.roles.fetch();
  const me = guild.members?.me || await guild.members.fetchMe();
  return buildStaffNameColorPreview({
    guildId: String(guild.id || ''),
    roles,
    botHighestRole: me?.roles?.highest || null,
    config: controller.effectiveConfig?.() || controller.config || {}
  });
}

async function enhancedScan(controller) {
  const scan = await controller.scan();
  scan.sections ||= {};
  const [commands, rankDiscovery, providerConfig, staffColors] = await Promise.all([
    commandStatus(controller).catch((error) => ({ ok: false, commands: [], desired: [], error: String(error?.message || error).slice(0, 240) })),
    discoverRankMappings(controller).catch((error) => ({ ok: false, ranks: [], suggestedSettings: { rankRoles: {}, rankSkus: {} }, counts: { discoveredRoles: 0, discoveredSkus: 0, attention: 0 }, error: String(error?.message || error).slice(0, 240) })),
    hostedProviderStatus(controller).catch((error) => ({ ok: false, configured: false, error: String(error?.message || error).slice(0, 240) })),
    staffNameColorPreview(controller).catch((error) => ({ ok: false, readOnly: true, mutationAuthorized: false, error: String(error?.message || error).slice(0, 240) }))
  ]);
  scan.sections.commands = commands;
  scan.sections.rankDiscovery = rankDiscovery;
  scan.sections.staffColors = staffColors;
  if (providerConfig) scan.sections.providerConfig = providerConfig;
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
  const forgeToken = String(options.forgeToken || process.env.FORGE_SENTINEL_CONTROL_TOKEN || '');
  const getController = typeof options.getController === 'function' ? options.getController : () => options.controller || null;
  const logger = options.logger || console;
  const pairingAllowed = createPairingLimiter();
  const arkBackend = options.arkBackend || new ArkBackendControl({ logger });
  if (!LOOPBACK.has(host) && !validAdminToken(token)) throw new Error('Sentinal admin API requires a token of at least 32 non-whitespace characters before it can listen outside loopback.');
  if (forgeToken && !validAdminToken(forgeToken)) throw new Error('Forge Sentinel control token must be at least 32 non-whitespace characters.');

  function authScope(req) {
    const authorization = String(req.headers.authorization || '');
    if (token && authorization === `Bearer ${token}`) return 'admin';
    if (forgeToken && authorization === `Bearer ${forgeToken}`) return 'forge';
    if (!token && LOOPBACK.has(host)) return 'admin';
    return '';
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const controller = getController();
      if (req.method === 'GET' && url.pathname === '/health') {
        if (!controller) return json(res, 200, publicHealth());
        const status = await controller.status().catch(() => null);
        return json(res, 200, publicHealth(status));
      }
      if (req.method === 'POST' && url.pathname === '/v1/pair') {
        if (!token) return json(res, 503, { ok: false, code: 'PAIRING_DISABLED', message: 'Hosted Sentinal pairing requires a protected admin token.' });
        if (!pairingAllowed(req)) return json(res, 429, { ok: false, code: 'PAIRING_RATE_LIMIT', message: 'Too many pairing attempts. Generate a new code and try again shortly.' });
        const input = await body(req);
        const paired = adminPairingStore.consume(input.code);
        if (!paired) return json(res, 401, { ok: false, code: 'PAIRING_INVALID', message: 'That pairing code is invalid, expired, or already used.' });
        return json(res, 200, { ok: true, token, pairedAt: new Date().toISOString() });
      }

      const scope = authScope(req);
      if (!scope) return json(res, 401, { ok: false, code: 'UNAUTHORIZED' });

      if (req.method === 'GET' && url.pathname === '/v1/ark/servers') {
        return json(res, 200, { ok: true, servers: arkBackend.listServers(), llmCalls: 0 });
      }
      if (req.method === 'POST' && url.pathname === '/v1/ark/execute') {
        const input = await body(req);
        const result = await arkBackend.execute(input, {
          source: scope === 'forge' ? 'forge-control-plane' : 'sentinal-admin',
          correlationId: req.headers['x-correlation-id']
        });
        return json(res, result.ok ? 200 : 502, result);
      }
      if (scope === 'forge') return json(res, 403, { ok: false, code: 'FORGE_SCOPE_RESTRICTED' });
      if (!controller) return json(res, 503, { ok: false, code: 'SENTINAL_STARTING', message: 'Nexus Sentinal is not ready yet.' });

      if (req.method === 'GET' && url.pathname === '/v1/status') return json(res, 200, await controller.status());
      if (req.method === 'GET' && url.pathname === '/v1/config') return json(res, 200, { ok: true, settings: controller.adminConfig() });
      if (req.method === 'GET' && url.pathname === '/v1/permissions') return json(res, 200, await controller.permissions());
      if (req.method === 'GET' && url.pathname === '/v1/commands') return json(res, 200, await commandStatus(controller));
      if (req.method === 'GET' && url.pathname === '/v1/channels') return json(res, 200, await controller.inspectChannels(safeModuleId(url.searchParams.get('module'))));
      if (req.method === 'GET' && url.pathname === '/v1/roles') return json(res, 200, await controller.reconcileRoles({ dryRun: true }));
      if (req.method === 'GET' && url.pathname === '/v1/staff-name-colors/preview') return json(res, 200, await staffNameColorPreview(controller));
      if (req.method === 'GET' && url.pathname === '/v1/rank-mappings/discover') return json(res, 200, await discoverRankMappings(controller));
      if (req.method === 'GET' && url.pathname === '/v1/providers/config') {
        const status = await hostedProviderStatus(controller);
        return status ? json(res, 200, status) : json(res, 503, { ok: false, code: 'HOSTED_PROVIDER_CONFIG_UNAVAILABLE' });
      }
      if (req.method === 'GET' && url.pathname === '/v1/scan') return json(res, 200, await enhancedScan(controller));

      if (req.method === 'POST' && url.pathname === '/v1/config') {
        const configured = controller.configure(await body(req));
        const backend = await controller.backend?.configureModules?.(configured.settings.moduleEnabled || {}).catch((error) => ({ ok: false, message: String(error?.message || error) }));
        return json(res, backend?.ok === false ? 502 : 200, { ...configured, backend: backend || null });
      }
      if (req.method === 'POST' && url.pathname === '/v1/providers/config') {
        const store = currentHostedProviderStore();
        if (!store) return json(res, 503, { ok: false, code: 'HOSTED_PROVIDER_CONFIG_UNAVAILABLE' });
        const saved = store.configure(await body(req));
        const backend = await controller.backend?.configureProviders?.(saved.modules || {}).catch((error) => ({ ok: false, message: String(error?.message || error).slice(0, 240), modules: [] }));
        return json(res, backend?.ok === false ? 502 : 200, { ok: backend?.ok !== false, providerConfig: saved, backend: backend || null });
      }
      if (req.method === 'POST' && url.pathname === '/v1/providers/validate') {
        const input = await body(req);
        const moduleId = safeModuleId(input.moduleId || input.module || '');
        const validation = await controller.backend?.validateProviders?.(moduleId).catch((error) => ({ ok: false, message: String(error?.message || error).slice(0, 240), results: [] }));
        const store = currentHostedProviderStore();
        if (store && moduleId && validation) store.recordValidation(moduleId, validation);
        return json(res, validation?.ok === false ? 502 : 200, validation || { ok: false, code: 'BACKEND_UNAVAILABLE', results: [] });
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

module.exports = { LOOPBACK, createPairingLimiter, createSentinalAdminServer, enhancedScan, hostedProviderStatus, publicHealth, safeModuleId, staffNameColorPreview, validAdminToken };
