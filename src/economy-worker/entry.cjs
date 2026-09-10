'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { NexusEconomyWorker } = require('../sentinel/nexus-economy-worker.cjs');
const { ClusterShopService } = require('../sentinel/cluster-shop-service.cjs');

const worker = new NexusEconomyWorker();
const shop = new ClusterShopService({ economy: worker });
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
    const url = new URL(req.url || '/', 'http://nexus.local');

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, {
        service: 'nexus-economy-worker',
        ...worker.health(),
        clusterShopItems: shop.listCatalog().length,
        pendingBuyOrders: shop.pendingBuyOrders().length
      });
    }

    if (!authorized(req)) return json(res, 401, { ok: false, error: 'unauthorized' });

    if (req.method === 'GET' && url.pathname.startsWith('/wallet/')) {
      const discordUserId = decodeURIComponent(url.pathname.slice('/wallet/'.length));
      await worker.accrueOffline(discordUserId).catch(() => null);
      return json(res, 200, { ok: true, discordUserId, balance: worker.balance(discordUserId) });
    }

    if (req.method === 'GET' && url.pathname === '/shop/catalog') {
      return json(res, 200, { ok: true, items: shop.listCatalog() });
    }

    if (req.method === 'GET' && url.pathname === '/shop/orders/pending') {
      return json(res, 200, { ok: true, orders: shop.pendingBuyOrders() });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/shop/order/')) {
      const orderId = decodeURIComponent(url.pathname.slice('/shop/order/'.length));
      const order = shop.order(orderId);
      return order ? json(res, 200, { ok: true, order }) : json(res, 404, { ok: false, error: 'order-not-found' });
    }

    if (req.method !== 'POST') return json(res, 404, { ok: false, error: 'not-found' });
    const input = await body(req);

    if (url.pathname === '/identity/link') return json(res, 200, { ok: true, result: worker.linkArkIdentity(input) });
    if (url.pathname === '/presence') return json(res, 200, await worker.recordPresence(input));
    if (url.pathname === '/wallet/credit') return json(res, 200, await worker.credit(input));
    if (url.pathname === '/wallet/spend') return json(res, 200, await worker.spend(input));
    if (url.pathname === '/wallet/accrue-offline') return json(res, 200, await worker.accrueOffline(input.discordUserId));

    if (url.pathname === '/shop/quote') return json(res, 200, { ok: true, quote: shop.quote(input) });
    if (url.pathname === '/shop/buy') {
      const result = await shop.createBuyOrder(input);
      return json(res, result.ok ? 200 : 409, result);
    }
    if (url.pathname === '/shop/sell') return json(res, 200, shop.createSellOrder(input));
    if (url.pathname === '/shop/sell/confirm-removal') return json(res, 200, await shop.confirmSellRemoval(input));
    if (url.pathname === '/shop/buy/delivery-status') return json(res, 200, shop.markBuyDelivery(input));

    return json(res, 404, { ok: false, error: 'not-found' });
  } catch (error) {
    console.error('[Nexus Economy Worker]', error);
    return json(res, 400, { ok: false, error: String(error?.message || error).slice(0, 300) });
  }
});

server.listen(port, host, () => {
  console.log(`[Nexus Economy Worker] listening on ${host}:${port}`);
  console.log(`[Nexus Economy Worker] wallet health: ${JSON.stringify(worker.health())}`);
  console.log(`[Nexus Economy Worker] cluster shop catalog items: ${shop.listCatalog().length}`);
});

function shutdown(signal) {
  console.log(`[Nexus Economy Worker] ${signal} received; shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref?.();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
