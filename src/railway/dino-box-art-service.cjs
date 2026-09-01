'use strict';

const http = require('node:http');
const { sendArt } = require('../backend/dino-box-art.cjs');

const port = Math.max(1, Math.min(65535, Number(process.env.NEXUS_DINO_BOX_ART_PORT || 3211) || 3211));
const host = '0.0.0.0';

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      const body = Buffer.from(JSON.stringify({ ok: true, service: 'nexus-dino-box-art' }));
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': body.length, 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    const match = /^\/assets\/dino-box\/([a-z0-9-]{1,48})\.webp$/.exec(url.pathname);
    if (req.method === 'GET' && match && sendArt(res, match[1])) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Not found');
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Internal error');
  }
});

server.listen(port, host, () => {
  console.log(`[Nexus Sentinal] Dino Box artwork service listening on ${host}:${port}`);
});

module.exports = { server, port, host };
