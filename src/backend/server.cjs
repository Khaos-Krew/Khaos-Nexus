'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { loadConfig, envSecret } = require('../shared/config.cjs');
const { BackendRuntime } = require('./core/runtime.cjs');
const { providersFromConfig } = require('./providers/http-provider.cjs');

const config = loadConfig();
const token = envSecret(config.backend?.serviceTokenEnv);
const host = config.backend?.host || '127.0.0.1';
const port = Number(config.backend?.port || 3210);
const loopback = new Set(['127.0.0.1', 'localhost', '::1']);
if (!loopback.has(host) && !token) {
  throw new Error(`Refusing to expose Nexus Backend on ${host} without ${config.backend?.serviceTokenEnv || 'NEXUS_BACKEND_TOKEN'}.`);
}

const runtime = new BackendRuntime({ config, providers: providersFromConfig(config) });

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length, 'cache-control': 'no-store' });
  res.end(payload);
}

function authorized(req) {
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, runtime.health());
    if (!authorized(req)) return json(res, 401, { ok: false, code: 'UNAUTHORIZED' });
    if (req.method === 'GET' && url.pathname === '/v1/modules') return json(res, 200, { ok: true, modules: runtime.manifests() });
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

server.listen(port, host, () => console.log(`[Nexus Backend] listening on http://${host}:${port}`));
