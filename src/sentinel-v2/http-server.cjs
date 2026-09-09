'use strict';

const http = require('node:http');

function createHttpServer({ health, logger, port = 3210, host = '0.0.0.0' } = {}) {
  if (!health) throw new Error('health state is required');

  const server = http.createServer((req, res) => {
    const path = String(req.url || '').split('?')[0];
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
    return json(res, 404, { ok: false, error: 'not-found' });
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

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(payload);
}

module.exports = { createHttpServer };
