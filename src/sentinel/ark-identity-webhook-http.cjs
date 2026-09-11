'use strict';

const http = require('node:http');
const {
  IDENTITY_WEBHOOK_ROUTE,
  readRawRequestBody,
  singleton: identityWebhookRuntime
} = require('./ark-identity-webhook-runtime.cjs');

const HOST = String(process.env.NEXUS_ARK_IDENTITY_WEBHOOK_HOST || '0.0.0.0');
const PORT = Number(process.env.NEXUS_ARK_IDENTITY_WEBHOOK_PORT || 3231);

function json(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body || {}), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
    'pragma': 'no-cache',
    'x-content-type-options': 'nosniff',
    ...headers
  });
  res.end(payload);
}

function createArkIdentityWebhookHttpServer({ host = HOST, port = PORT, logger = console, identityRuntime = identityWebhookRuntime } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('NEXUS_ARK_IDENTITY_WEBHOOK_PORT is invalid.');

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, { ok: true, service: 'ark-identity-webhook' });
      }
      if (url.pathname !== IDENTITY_WEBHOOK_ROUTE) return json(res, 404, { ok: false, code: 'NOT_FOUND' });
      if (req.method !== 'POST') return json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' }, { allow: 'POST' });

      let rawBody;
      try {
        rawBody = await readRawRequestBody(req);
      } catch (error) {
        const tooLarge = error?.code === 'ARK_IDENTITY_WEBHOOK_TOO_LARGE';
        return json(res, tooLarge ? 413 : 400, { ok: false, code: tooLarge ? error.code : 'ARK_IDENTITY_REQUEST_INVALID' });
      }

      const result = await identityRuntime.process({ headers: req.headers, rawBody });
      return json(res, Number(result?.status) || 500, {
        ok: Boolean(result?.ok),
        code: result?.ok ? 'ARK_IDENTITY_EVENT_ACCEPTED' : String(result?.code || 'ARK_IDENTITY_EVENT_REJECTED'),
        duplicate: Boolean(result?.duplicate)
      });
    })().catch((error) => {
      logger.warn?.(`[Nexus Sentinal] ARK identity webhook request failed: ${String(error?.message || error).slice(0, 240)}`);
      if (!res.headersSent) return json(res, 500, { ok: false, code: 'INTERNAL' });
      res.end();
    });
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
    logger.log?.(`[Nexus Sentinal] ARK identity webhook listening on ${host}:${port}`);
    return { host, port };
  }

  async function stop() {
    if (!started || !server.listening) return;
    await new Promise((resolve) => server.close(resolve));
    started = false;
  }

  return { host, port, server, start, stop, isStarted: () => started && server.listening };
}

const singleton = createArkIdentityWebhookHttpServer();
singleton.start().catch((error) => console.error(`[Nexus Sentinal] ARK identity webhook startup failed: ${String(error?.message || error).slice(0, 300)}`));

module.exports = {
  HOST,
  PORT,
  IDENTITY_WEBHOOK_ROUTE,
  createArkIdentityWebhookHttpServer,
  singleton
};
