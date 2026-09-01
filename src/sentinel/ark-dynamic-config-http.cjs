'use strict';

const fs = require('node:fs');
const http = require('node:http');
const { outputPath } = require('./ark-dynamic-events.cjs');

const HOST = String(process.env.NEXUS_ARK_DYNAMIC_CONFIG_HOST || '0.0.0.0');
const PORT = Number(process.env.NEXUS_ARK_DYNAMIC_CONFIG_PORT || 3230);
const ROUTE_PREFIX = '/ark/dynamic/';
const PREFIX_MAP = Object.freeze({
  'ark_gen1.ini': 'ARK_GEN1',
  'ark_map2.ini': 'ARK_MAP2',
  'ark_gen2.ini': 'ARK_GEN2'
});

function text(res, status, body, headers = {}) {
  const payload = Buffer.from(String(body || ''), 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
    'pragma': 'no-cache',
    'x-content-type-options': 'nosniff',
    ...headers
  });
  res.end(payload);
}

function routePrefixFromPath(pathname) {
  if (!pathname.startsWith(ROUTE_PREFIX)) return '';
  const name = pathname.slice(ROUTE_PREFIX.length).toLowerCase();
  return PREFIX_MAP[name] || '';
}

function createArkDynamicConfigHttpServer({ host = HOST, port = PORT, logger = console } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('NEXUS_ARK_DYNAMIC_CONFIG_PORT is invalid.');

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/health') {
        return text(res, 200, 'ok\n');
      }
      if (req.method !== 'GET') return text(res, 405, 'Method Not Allowed\n', { allow: 'GET' });
      const prefix = routePrefixFromPath(url.pathname);
      if (!prefix) return text(res, 404, 'Not Found\n');

      const file = outputPath(prefix);
      if (!fs.existsSync(file)) {
        return text(res, 503, 'DynamicConfig is not rendered yet.\n', { 'retry-after': '5' });
      }
      const body = fs.readFileSync(file, 'utf8');
      return text(res, 200, body);
    } catch (error) {
      logger.warn?.(`[Nexus Sentinal] ARK DynamicConfig HTTP request failed: ${String(error?.message || error).slice(0, 240)}`);
      return text(res, 500, 'Internal Server Error\n');
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
    logger.log?.(`[Nexus Sentinal] ARK DynamicConfig HTTP listening on ${host}:${port}`);
    return { host, port };
  }

  async function stop() {
    if (!started || !server.listening) return;
    await new Promise((resolve) => server.close(resolve));
    started = false;
  }

  return { host, port, server, start, stop, isStarted: () => started && server.listening };
}

const singleton = createArkDynamicConfigHttpServer();
singleton.start().catch((error) => console.error(`[Nexus Sentinal] ARK DynamicConfig HTTP startup failed: ${String(error?.message || error).slice(0, 300)}`));

module.exports = { HOST, PORT, ROUTE_PREFIX, PREFIX_MAP, routePrefixFromPath, createArkDynamicConfigHttpServer, singleton };
