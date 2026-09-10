'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { NexusEconomyWorker } = require('../sentinel/nexus-economy-worker.cjs');

const worker = new NexusEconomyWorker();
const host = String(process.env.NEXUS_ECONOMY_HOST || '0.0.0.0');
const port = Number(process.env.PORT || process.env.NEXUS_ECONOMY_PORT || 3230);
const token = String(process.env.NEXUS_ECONOMY_TOKEN || '').trim();

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store'
  });
  res.end(payload);
}

function authorized(req) {
  if (!token) return false;
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(auth.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 128 * 1024) throw new Error('Request body too large.');
  }
  if (!raw) return {};
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, { service: 'nexus-economy-worker', ...worker.health() });
    }

    if (!authorized(req)) return json(res, 401, { ok: false, error: 'unauthorized' });

    if (req.method === 'GET' && req.url?.startsWith('/wallet/')) {
      const discordUserId = decodeURIComponent(req.url.slice('/wallet/'.length).split('?')[0]);
      await worker.accrueOffline(discordUserId).catch(() => null);
      return json(res, 200, { ok: true, discordUserId, balance: worker.balance(discordUserId) });
    }

    if (req.method !== 'POST') return json(res, 404, { ok: false, error: 'not-found' });
    const input = await body(req);

    if (req.url === '/identity/link') return json(res, 200, { ok: true, result: worker.linkArkIdentity(input) });
    if (req.url === '/presence') return json(res, 200, await worker.recordPresence(input));
    if (req.url === '/wallet/credit') return json(res, 200, await worker.credit(input));
    if (req.url === '/wallet/spend') return json(res, 200, await worker.spend(input));
    if (req.url === '/wallet/accrue-offline') return json(res, 200, await worker.accrueOffline(input.discordUserId));

    return json(res, 404, { ok: false, error: 'not-found' });
  } catch (error) {
    console.error('[Nexus Economy Worker]', error);
    return json(res, 400, { ok: false, error: String(error?.message || error).slice(0, 300) });
  }
});

server.listen(port, host, () => {
  console.log(`[Nexus Economy Worker] listening on ${host}:${port}`);
  console.log(`[Nexus Economy Worker] wallet health: ${JSON.stringify(worker.health())}`);
});

function shutdown(signal) {
  console.log(`[Nexus Economy Worker] ${signal} received; shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref?.();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
