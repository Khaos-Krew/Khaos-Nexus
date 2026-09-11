'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { NexusEconomyWorker } = require('../sentinel/nexus-economy-worker.cjs');
const { ClusterShopService, loadCatalog } = require('../sentinel/cluster-shop-service.cjs');
const { PostgresEconomyPersistence } = require('./postgres-persistence.cjs');
const { enabled, runtimeReadiness } = require('./server.cjs');
const { resolveEconomyAuthorityPolicy } = require('../sentinel/economy-authority-policy.cjs');

function authorized(req, token) {
  if (!token) return false;
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(auth.slice(7)), expected = Buffer.from(token);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length, 'cache-control': 'no-store' });
  res.end(payload);
}
async function body(req) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 128 * 1024) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  return length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function createEconomyService({ persistence, env = process.env, now } = {}) {
  if (!persistence) throw new Error('Postgres economy persistence is required.');
  const token = String(env.NEXUS_ECONOMY_TOKEN || '').trim();
  if (token.length < 32) throw new Error('NEXUS_ECONOMY_TOKEN must contain at least 32 characters.');
  const recoveryToken = String(env.NEXUS_ECONOMY_RECOVERY_TOKEN || '').trim();
  if (recoveryToken && (recoveryToken.length < 32 || recoveryToken === token)) throw new Error('Recovery credentials must be separate and at least 32 characters.');
  const worker = new NexusEconomyWorker({ store: persistence.walletStore, now });
  const catalog = loadCatalog(env.NEXUS_CLUSTER_SHOP_CATALOG_JSON || JSON.stringify(require('../../config/ark/cluster-shop-catalog.json')));
  const shop = new ClusterShopService({ economy: worker, store: persistence.shopStore, catalog });
  const policy = resolveEconomyAuthorityPolicy(env);
  const writesEnabled = enabled(env.NEXUS_ECONOMY_WRITES_ENABLED);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://nexus.local');
    try {
      if (req.method === 'GET' && url.pathname === '/health/live') return json(res, 200, { ok: true, service: 'nexus-economy-worker' });
      if (req.method === 'GET' && ['/health', '/health/ready'].includes(url.pathname)) {
        const health = await persistence.transaction(() => runtimeReadiness({ worker, shop, token, writesEnabled }));
        return json(res, health.ok ? 200 : 503, { ...health, service: 'nexus-economy-worker', storage: persistence.kind, clusterShopItems: catalog.size, checkoutReady: Boolean(health.ok && writesEnabled && env.NEXUS_CLUSTER_SHOP_CHECKOUT_ENABLED === 'true' && catalog.size), sellbackCreditReady: false, checkoutEnabled: env.NEXUS_CLUSTER_SHOP_CHECKOUT_ENABLED === 'true', authority: policy.authority });
      }
      const recovery = url.pathname.startsWith('/admin/');
      if (!authorized(req, recovery ? recoveryToken : token)) return json(res, 401, { ok: false, error: 'unauthorized' });
      const input = req.method === 'POST' ? await body(req) : {};
      if (req.method === 'POST' && policy.authority !== 'nexus') return json(res, 403, { ok: false, error: 'nexus-authority-required' });
      if (req.method === 'POST' && !writesEnabled && !['/identity/link', '/shop/quote'].includes(url.pathname)) return json(res, 503, { ok: false, error: 'economy-write-cutover-not-enabled', writesEnabled: false });
      const result = await persistence.transaction(async () => {
        if (req.method === 'GET') {
          if (url.pathname.startsWith('/wallet/')) {
            const id = decodeURIComponent(url.pathname.slice('/wallet/'.length));
            if (writesEnabled) await worker.accrueOffline(id);
            return [200, { ok: true, discordUserId: id, balance: worker.balance(id) }];
          }
          if (url.pathname === '/shop/catalog') return [200, { ok: true, items: shop.listCatalog() }];
          if (url.pathname === '/shop/orders/pending') return [200, { ok: true, orders: shop.pendingBuyOrders({ excludeOrderIds: (url.searchParams.get('exclude') || '').split(',') }) }];
          if (url.pathname.startsWith('/shop/order/')) {
            const order = shop.order(decodeURIComponent(url.pathname.slice('/shop/order/'.length)));
            return order ? [200, { ok: true, order }] : [404, { ok: false, error: 'order-not-found' }];
          }
          if (url.pathname === '/admin/orders') return [200, { ok: true, orders: Object.values(shop.store.read().orders).filter(order => ['DELIVERY_IN_PROGRESS','SENT_UNCONFIRMED','DELIVERY_FAILED','REFUND_PENDING'].includes(order.status)) }];
        }
        if (req.method !== 'POST') return [404, { ok: false, error: 'not-found' }];
        if (url.pathname === '/identity/snapshot') return [200, worker.syncIdentitySnapshot(input)];
        if (url.pathname === '/identity/link') return [200, { ok: true, result: worker.linkArkIdentity(input) }];
        if (url.pathname === '/presence') return [200, await worker.recordPresence(input)];
        if (url.pathname === '/presence/snapshot') return [200, await worker.recordPresenceSnapshot(input)];
        if (url.pathname === '/wallet/credit') return [200, await worker.credit(input)];
        if (url.pathname === '/wallet/spend') return [200, await worker.spend(input)];
        if (url.pathname === '/wallet/accrue-offline') return [200, await worker.accrueOffline(input.discordUserId)];
        if (url.pathname === '/shop/quote') return [200, { ok: true, quote: shop.quote(input) }];
        if (url.pathname === '/shop/buy') {
          if (env.NEXUS_CLUSTER_SHOP_CHECKOUT_ENABLED !== 'true') return [503, { ok: false, error: 'checkout-not-enabled' }];
          const value = await shop.createBuyOrder(input);
          return [value.ok ? 200 : 409, value];
        }
        if (url.pathname.startsWith('/shop/sell')) return [503, { ok: false, error: 'sellback-removal-adapter-required' }];
        if (url.pathname === '/shop/buy/delivery-status') return [200, shop.markBuyDelivery(input)];
        if (url.pathname === '/admin/order/resolve') return [200, await shop.resolveBuyOrder(input)];
        return [404, { ok: false, error: 'not-found' }];
      });
      return json(res, ...result);
    } catch (error) {
      const databaseFailure = url.pathname.startsWith('/health') || /^(08|53|57|58)/.test(String(error.code || '')) || ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','55P03'].includes(error.code);
      console.error('[Nexus Economy Worker]', error.code || error.name);
      if (!res.headersSent) json(res, databaseFailure ? 503 : 400, { ok: false, error: databaseFailure ? 'economy-storage-unavailable' : String(error.message).slice(0, 300) });
    }
  });
  server.requestTimeout = 15_000;
  return { server, worker, shop, async initialize() { await persistence.initialize(); if (writesEnabled) await persistence.transaction(() => shop.recoverPendingPayments()); } };
}

async function main() {
  const connectionString = process.env.NEXUS_ECONOMY_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('NEXUS_ECONOMY_DATABASE_URL or DATABASE_URL is required; no file-storage fallback is permitted.');
  const persistence = new PostgresEconomyPersistence({ connectionString });
  const app = createEconomyService({ persistence });
  try { await app.initialize(); } catch (error) { await persistence.close(); throw error; }
  const host = process.env.NEXUS_ECONOMY_HOST || '0.0.0.0';
  app.server.listen(Number(process.env.PORT || process.env.NEXUS_ECONOMY_PORT || 3230), host, () => console.log(`[Nexus Economy Worker] listening port=${app.server.address().port} storage=postgres`));
  const shutdown = () => {
    app.server.close(() => persistence.close().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}
module.exports = { createEconomyService, authorized, main };
