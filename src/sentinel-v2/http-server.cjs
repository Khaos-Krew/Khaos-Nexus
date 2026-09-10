'use strict';

const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');

function createHttpServer({ health, logger, port = 3210, host = '0.0.0.0', adminToken = '', deadLetters, arkRconReadiness, cutoverReadiness } = {}) {
  if (!health) throw new Error('health state is required');

  const server = http.createServer((req, res) => {
    void handleRequest(req, res, { health, logger, adminToken, deadLetters, arkRconReadiness, cutoverReadiness });
  });

  server.on('clientError', (error, socket) => {
    logger?.warn?.('sentinel.http.client_error', { error });
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return Object.freeze({
    server,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          logger?.info?.('sentinel.http.listening', { host, port });
          resolve(server.address());
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    },
    close() {
      if (!server.listening) return Promise.resolve();
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  });
}

async function handleRequest(req, res, { health, logger, adminToken, deadLetters, arkRconReadiness, cutoverReadiness } = {}) {
  try {
    const url = new URL(String(req.url || '/'), 'http://sentinel.local');
    const path = url.pathname;
    if (req.method === 'GET' && path === '/health/live') {
      return json(res, 200, health.live());
    }
    if (req.method === 'GET' && path === '/health/ready') {
      const body = health.ready();
      return json(res, body.ok ? 200 : 503, body);
    }
    if (req.method === 'GET' && path === '/health') {
      const body = health.ready();
      return json(res, body.ok ? 200 : 503, body);
    }

    if (path.startsWith('/admin/')) {
      if (!authorized(req, adminToken)) return json(res, 401, { ok: false, error: 'unauthorized' });

      if (req.method === 'GET' && path === '/admin/readiness/cutover') {
        if (!cutoverReadiness?.snapshot) return json(res, 503, { ok: false, error: 'cutover-readiness-unavailable' });
        const snapshot = await cutoverReadiness.snapshot({
          since: url.searchParams.get('since') || undefined,
          deadLetterLimit: url.searchParams.get('deadLetterLimit') || 100,
        });
        return json(res, 200, { ok: true, readiness: snapshot });
      }

      if (req.method === 'GET' && path === '/admin/readiness/ark-rcon') {
        if (!arkRconReadiness?.snapshot) return json(res, 503, { ok: false, error: 'ark-rcon-readiness-unavailable' });
        const snapshot = await arkRconReadiness.snapshot({
          since: url.searchParams.get('since') || undefined,
          limit: url.searchParams.get('limit') || 500,
        });
        return json(res, 200, { ok: true, readiness: snapshot });
      }

      if (!deadLetters) return json(res, 503, { ok: false, error: 'dead-letter-store-unavailable' });

      if (req.method === 'GET' && path === '/admin/dead-letters') {
        const items = await deadLetters.list({
          provider: url.searchParams.get('provider') || undefined,
          status: url.searchParams.has('status') ? (url.searchParams.get('status') || null) : 'quarantined',
          limit: url.searchParams.get('limit') || 100,
        });
        return json(res, 200, { ok: true, count: items.length, items });
      }

      const match = path.match(/^\/admin\/dead-letters\/(\d+)(?:\/(acknowledge))?$/);
      if (match && req.method === 'GET' && !match[2]) {
        const item = await deadLetters.get(match[1]);
        return item
          ? json(res, 200, { ok: true, item })
          : json(res, 404, { ok: false, error: 'not-found' });
      }
      if (match && req.method === 'POST' && match[2] === 'acknowledge') {
        const body = await readJsonBody(req, 8192);
        const actor = String(body.actor || '').trim();
        const reason = String(body.reason || '').trim();
        if (!actor || !reason) return json(res, 400, { ok: false, error: 'actor-and-reason-required' });
        try {
          const item = await deadLetters.acknowledge(match[1], { actor, reason });
          return json(res, 200, { ok: true, item });
        } catch (error) {
          if (error?.code === 'SENTINEL_DEAD_LETTER_NOT_FOUND') return json(res, 404, { ok: false, error: 'not-found' });
          if (error?.code === 'SENTINEL_DEAD_LETTER_NOT_QUARANTINED') return json(res, 409, { ok: false, error: 'not-quarantined' });
          throw error;
        }
      }
    }

    return json(res, 404, { ok: false, error: 'not-found' });
  } catch (error) {
    logger?.error?.('sentinel.http.request_failed', { error });
    if (!res.headersSent) return json(res, error?.code === 'SENTINEL_HTTP_BODY_TOO_LARGE' ? 413 : 500, { ok: false, error: 'internal-error' });
    res.end();
  }
}

function authorized(req, adminToken) {
  const expected = String(adminToken || '');
  if (!expected) return false;
  const header = String(req.headers.authorization || '');
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readJsonBody(req, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        reject(Object.assign(new Error('request body too large'), { code: 'SENTINEL_HTTP_BODY_TOO_LARGE' }));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(Object.assign(new Error('invalid json body'), { code: 'SENTINEL_HTTP_INVALID_JSON', cause: error }));
      }
    });
    req.on('error', reject);
  });
}

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(payload);
}

module.exports = { createHttpServer, handleRequest, authorized, readJsonBody };
