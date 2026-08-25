'use strict';

const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const { envSecret } = require('../shared/config.cjs');
const { mergeProviderModules, sanitizeProviderModules } = require('../shared/provider-sync.cjs');
const { AccountStore } = require('./core/account-store.cjs');
const { ProviderValidator } = require('./core/provider-validator.cjs');
const { BackendRuntime } = require('./core/runtime.cjs');
const { SharedScheduler } = require('./core/scheduler.cjs');
const { providersFromConfig } = require('./providers/http-provider.cjs');
const { nativeProvidersFromConfig } = require('./providers/native-providers.cjs');
const { serverProvidersFromConfig } = require('./providers/server-providers.cjs');
const { ArkCompanionService } = require('./services/ark-companion-service.cjs');
const { CommunityLevelService } = require('./services/community-level-service.cjs');
const { DndDomainService } = require('./services/dnd-domain-service.cjs');
const { trackedServersResponse } = require('./tracked-servers.cjs');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length, 'cache-control': 'no-store' });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function safeAccount(account) {
  if (!account) return null;
  return { id: account.id, role: account.role, displayName: account.displayName, discord: account.discord, createdAt: account.createdAt, updatedAt: account.updatedAt };
}

function providersForConfig(config = {}) {
  return { ...nativeProvidersFromConfig(config), ...serverProvidersFromConfig(config), ...providersFromConfig(config) };
}

function communityLevelStateFile(config = {}) {
  const configured = String(config.communityLeveling?.stateFile || '').trim();
  if (configured) return configured;
  return path.join(process.env.NEXUS_DATA_DIR || 'data', 'community-leveling.json');
}

function createBackendApplication(config, options = {}) {
  const token = envSecret(config.backend?.serviceTokenEnv);
  const host = String(config.backend?.host || '127.0.0.1');
  const port = Number(config.backend?.port || 3210);
  const logger = options.logger || console;

  if (!LOOPBACK_HOSTS.has(host) && !token) throw new Error(`Refusing to expose Nexus Backend on ${host} without ${config.backend?.serviceTokenEnv || 'NEXUS_BACKEND_TOKEN'}.`);

  const providers = providersForConfig(config);
  const runtime = new BackendRuntime({ config, providers });
  const scheduler = new SharedScheduler({ filePath: config.scheduler?.stateFile || path.join(process.cwd(), 'data', 'schedules.json'), timeZone: config.scheduler?.timeZone || 'America/Chicago' });
  const accounts = new AccountStore({ filePath: config.accounts?.stateFile || path.join(process.cwd(), 'data', 'accounts.json') });
  const providerValidator = new ProviderValidator({ runtime });
  const arkCompanion = options.arkCompanion || new ArkCompanionService();
  const communityLevels = options.communityLevels || new CommunityLevelService({
    stateFile: communityLevelStateFile(config),
    settings: config.communityLeveling || {}
  });
  const dndDomain = options.dndDomain || new DndDomainService({ filePath: config.modules?.dnd?.stateFile || path.join(process.env.NEXUS_DATA_DIR || 'data', 'dnd-domain.json') });
  runtime.registerService('scheduler', scheduler);
  runtime.registerService('ark-companion', arkCompanion);
  runtime.registerService('dnd-core', dndDomain);
  scheduler.registerExecutor((moduleId, actionId, payload, context) => runtime.invoke(moduleId, actionId, payload, context));

  function authorized(req) {
    if (!token) return true;
    return req.headers.authorization === `Bearer ${token}`;
  }

  function configureProviders(inputModules = {}) {
    const modules = sanitizeProviderModules(inputModules, config);
    const next = mergeProviderModules(config, modules);
    config.modules = next.modules;
    const manifests = runtime.replaceProviders(config, providersForConfig(config));
    return { ok: true, modules: manifests };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, runtime.health());
      if (!authorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED' });

      if (req.method === 'GET' && url.pathname === '/v1/accounts') return json(res, 200, { ok: true, accounts: accounts.list().map(safeAccount) });
      const accountMatch = /^\/v1\/accounts\/discord\/(\d{15,24})$/.exec(url.pathname);
      if (req.method === 'GET' && accountMatch) {
        const account = safeAccount(accounts.findByDiscordId(accountMatch[1]));
        return json(res, account ? 200 : 404, account ? { ok: true, account } : { ok: false, code: 'ACCOUNT_NOT_FOUND' });
      }
      if (req.method === 'POST' && url.pathname === '/v1/accounts/pairing-codes') {
        const body = await readBody(req);
        return json(res, 201, { ok: true, pairing: accounts.createPairingCode(body.role || 'co-owner') });
      }
      if (req.method === 'POST' && url.pathname === '/v1/accounts/link') {
        const body = await readBody(req);
        return json(res, 200, { ok: true, account: safeAccount(accounts.redeemPairingCode(body.code, body.discord || {})) });
      }
      const deleteAccountMatch = /^\/v1\/accounts\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (req.method === 'DELETE' && deleteAccountMatch) {
        const removed = accounts.remove(deleteAccountMatch[1]);
        return json(res, removed ? 200 : 404, removed ? { ok: true } : { ok: false, code: 'ACCOUNT_NOT_FOUND' });
      }

      if (req.method === 'GET' && url.pathname === '/v1/tracked-servers') return json(res, 200, trackedServersResponse(runtime));

      const levelProfileMatch = /^\/v1\/community-xp\/users\/(\d{15,24})$/.exec(url.pathname);
      if (req.method === 'GET' && levelProfileMatch) return json(res, 200, { ok: true, profile: communityLevels.profile(levelProfileMatch[1]) });
      if (req.method === 'GET' && url.pathname === '/v1/community-xp/leaderboard') {
        return json(res, 200, { ok: true, leaderboard: communityLevels.leaderboard(url.searchParams.get('limit') || 10) });
      }
      if (req.method === 'GET' && url.pathname === '/v1/community-xp/settings') return json(res, 200, { ok: true, settings: communityLevels.settings() });
      if (req.method === 'GET' && url.pathname === '/v1/community-xp/audit') return json(res, 200, { ok: true, audit: communityLevels.audit(url.searchParams.get('limit') || 50) });
      if (req.method === 'POST' && url.pathname === '/v1/community-xp/award') return json(res, 200, communityLevels.award(await readBody(req)));
      if (req.method === 'POST' && url.pathname === '/v1/community-xp/remove') return json(res, 200, communityLevels.removeXp(await readBody(req)));
      if (req.method === 'POST' && url.pathname === '/v1/community-xp/set') return json(res, 200, communityLevels.setXp(await readBody(req)));
      if (req.method === 'POST' && url.pathname === '/v1/community-xp/reset') return json(res, 200, communityLevels.reset(await readBody(req)));
      if (req.method === 'POST' && url.pathname === '/v1/community-xp/settings') return json(res, 200, communityLevels.updateSettings(await readBody(req)));

      if (req.method === 'GET' && url.pathname === '/v1/ark/taming/species') {
        const species = await arkCompanion.listSpecies();
        return json(res, 200, { ok: true, species });
      }

      if (req.method === 'POST' && url.pathname === '/v1/admin/modules') {
        const body = await readBody(req);
        const enabled = body.enabled && typeof body.enabled === 'object' && !Array.isArray(body.enabled) ? body.enabled : {};
        return json(res, 200, { ok: true, enabled: runtime.setModuleEnabled(enabled), modules: runtime.manifests() });
      }
      if (req.method === 'POST' && url.pathname === '/v1/admin/providers') {
        const body = await readBody(req);
        return json(res, 200, configureProviders(body.modules || {}));
      }
      if (req.method === 'POST' && url.pathname === '/v1/providers/validate') {
        const body = await readBody(req);
        return json(res, 200, await providerValidator.validate(body.moduleId || body.module || ''));
      }
      if (req.method === 'GET' && url.pathname === '/v1/modules') return json(res, 200, { ok: true, modules: runtime.manifests() });
      if (req.method === 'GET' && url.pathname === '/v1/schedules') return json(res, 200, { ok: true, timeZone: scheduler.timeZone, schedules: scheduler.list() });
      const match = /^\/v1\/modules\/([a-z0-9-]+)\/actions\/([a-z0-9-]+)$/.exec(url.pathname);
      if (req.method === 'POST' && match) {
        const body = await readBody(req);
        const role = String(req.headers['x-nexus-role'] || 'viewer');
        const confirmed = String(req.headers['x-nexus-confirmed'] || '').toLowerCase() === 'true';
        const result = await runtime.invoke(match[1], match[2], body.payload || {}, { role, confirmed, actorId: String(req.headers['x-nexus-actor'] || '') });
        const status = result.ok ? 200 : result.code === 'ACCESS_DENIED' ? 403 : result.code === 'CONFIRMATION_REQUIRED' ? 428 : 409;
        return json(res, status, result);
      }
      return json(res, 404, { ok: false, code: 'NOT_FOUND' });
    } catch (error) {
      return json(res, 500, { ok: false, code: 'INTERNAL', message: String(error?.message || error) });
    }
  });

  let started = false;
  async function start() {
    if (started) return { host, port };
    scheduler.start();
    await new Promise((resolve, reject) => {
      const onError = (error) => { server.off('listening', onListening); scheduler.stop(); reject(error); };
      const onListening = () => { server.off('error', onError); started = true; resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
    logger.log?.(`[Nexus Backend] listening on http://${host}:${port}`);
    return { host, port };
  }

  async function stop() {
    scheduler.stop();
    if (!started || !server.listening) { started = false; return; }
    await new Promise((resolve) => server.close(() => resolve()));
    started = false;
  }

  return { host, port, runtime, scheduler, arkCompanion, dndDomain, communityLevels, accounts, providerValidator, configureProviders, server, start, stop, isStarted: () => started && server.listening };
}

module.exports = { LOOPBACK_HOSTS, communityLevelStateFile, createBackendApplication, providersForConfig };
