'use strict';

const http = require('node:http');

const host = String(process.env.HOST || '0.0.0.0');
const port = Number(process.env.PORT || 8080);
const upstream = new URL(String(process.env.DYNAMIC_CONFIG_UPSTREAM || 'http://nexus-sentinal-0-1-test.railway.internal:3230'));

function reply(res, status, body) {
  const payload = Buffer.from(String(body || ''), 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
    'x-content-type-options': 'nosniff'
  });
  res.end(payload);
}

function allowedPath(pathname) {
  return pathname === '/health' || /^\/ark\/dynamic\/ark_(?:gen1|gen2|map2)\.ini$/i.test(pathname);
}

const server = http.createServer((req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method !== 'GET') return reply(res, 405, 'Method Not Allowed\n');
    if (!allowedPath(requestUrl.pathname)) return reply(res, 404, 'Not Found\n');

    const target = new URL(requestUrl.pathname, upstream);
    const proxy = http.request({
      hostname: target.hostname,
      port: Number(target.port || 80),
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: { host: upstream.host, connection: 'close' },
      timeout: 5000
    }, (upstreamRes) => {
      const headers = {
        'content-type': upstreamRes.headers['content-type'] || 'text/plain; charset=utf-8',
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
        'x-content-type-options': 'nosniff'
      };
      if (upstreamRes.headers['retry-after']) headers['retry-after'] = upstreamRes.headers['retry-after'];
      res.writeHead(upstreamRes.statusCode || 502, headers);
      upstreamRes.pipe(res);
    });
    proxy.on('timeout', () => proxy.destroy(new Error('upstream timeout')));
    proxy.on('error', (error) => {
      if (!res.headersSent) reply(res, 502, `DynamicConfig upstream unavailable: ${String(error.message || error).slice(0, 180)}\n`);
      else res.destroy();
    });
    proxy.end();
  } catch (error) {
    reply(res, 500, `Proxy error: ${String(error.message || error).slice(0, 180)}\n`);
  }
});

server.listen(port, host, () => {
  console.log(`[Nexus DynamicConfig Proxy] listening on ${host}:${port} -> ${upstream.origin}`);
});
