'use strict';

const http = require('node:http');

function healthBody(state = {}) {
  return {
    ok: Boolean(state.discordReady),
    service: String(state.service || ''),
    bot: String(state.bot || ''),
    gameRole: String(state.gameRole || ''),
    discordReady: Boolean(state.discordReady)
  };
}

function createGameBotHealthServer({ port = 8080, getState } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/health') {
      const missing = Buffer.from(JSON.stringify({ ok: false }));
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'content-length': missing.length, 'cache-control': 'no-store' });
      res.end(missing);
      return;
    }
    const payload = healthBody(typeof getState === 'function' ? getState() : {});
    const body = Buffer.from(JSON.stringify(payload));
    const status = payload.discordReady ? 200 : 503;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

module.exports = { createGameBotHealthServer, healthBody };
