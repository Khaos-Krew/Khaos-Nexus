'use strict';

const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const { envSecret } = require('../shared/config.cjs');
const { BackendRuntime } = require('./core/runtime.cjs');
const { SharedScheduler } = require('./core/scheduler.cjs');
const { providersFromConfig } = require('./providers/http-provider.cjs');
const { nativeProvidersFromConfig } = require('./providers/native-providers.cjs');
const { serverProvidersFromConfig } = require('./providers/server-providers.cjs');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store'
  });
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

function createBackendApplication(config, options = {}) {
  const token = envSecret(config.backend?.serviceTokenEnv);
  const host = String(config.backend?.host || '127.0.0.1');
  const port = Number(config.backend?.port || 3210);
  const logger = options.logger || console;

  if (!LOOPBACK_HOSTS.has(host) && !token) {
    throw new Error(`Refusing to expose Nexus Backend on ${host} without ${config.backend?.serviceTokenEnv || 'NEXUS_BACKEND_TOKEN'}.`);
  }

  const providers = {
    ...nativeProvidersFromConfig(config),
    ...serverProvidersFromConfig(config),
    ...providersFromConfig(config)
  };
  const runtime = new BackendRuntime({ config, providers });
  const scheduler = new SharedScheduler({
    filePath: config.scheduler?.stateFile || path.join(process.cwd(), 'data', 'schedules.json'),
    timeZone: config.scheduler?.timeZone || 'America/Chicago'
  });
  runtime.registerService('scheduler', scheduler);
  scheduler.registerExecutor((moduleId, actionId, payload, context) => runtime.invoke(moduleId, actionId, payload, context));

  function authorized(req) {
    if (!token) return true;
    return req.headers.authorization === `Bearer ${token}`;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, runtime.health());
      if (!authorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED' });
      if (req.method === 'GET' && url.pathname === '/v1/modules') return json(res, 200, { ok: true, modules: runtime.manifests() });
      if (req.method === 'GET' && url.pathname === '/v1/schedules') return json(res, 200, { ok: true, timeZone: scheduler.timeZone, schedules: scheduler.list() });
      const match = /^\/v1\/modules\/([a-z0-9-]+)\/actions\/([a-z0-9-]+)$/.exec(url.pathname);
      if (req.method === 'POST' && match) {
        const body = await readBody(req);
        const role = String(req.headers['x-nexus-role'] || 'viewer');
        const confirmed = String(req.headers['x-nexus-confirmed'] || '').toLowerCase() === 'true';
        const result = await runtime.invoke(match[1], match[2], body.payload || {}, {
          role,
          confirmed,
          actorId: String(req.headers['x-nexus-actor'] || '')
        });
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
      const onError = (error) => {
        server.off('listening', onListening);
        scheduler.stop();
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        started = true;
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
    logger.log?.(`[Nexus Backend] listening on http://${host}:${port}`);
    return { host, port };
  }

  async function stop() {
    scheduler.stop();
    if (!started || !server.listening) {
      started = false;
      return;
    }
    await new Promise((resolve) => server.close(() => resolve()));
    started = false;
  }

  return {
    host,
    port,
    runtime,
    scheduler,
    server,
    start,
    stop,
    isStarted: () => started && server.listening
  };
}

module.exports = { LOOPBACK_HOSTS, createBackendApplication };
