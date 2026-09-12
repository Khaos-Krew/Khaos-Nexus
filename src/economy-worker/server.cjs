'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { NexusEconomyWorker } = require('../sentinel/nexus-economy-worker.cjs');
const { ClusterShopService } = require('../sentinel/cluster-shop-service.cjs');

const WRITE_PATHS = new Set([
  '/presence',
  '/wallet/credit',
  '/wallet/spend',
  '/wallet/accrue-offline',
  '/shop/buy',
  '/shop/sell',
  '/shop/sell/confirm-removal',
  '/shop/buy/delivery-status'
]);

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store'
  });
  res.end(payload);
}

function authorized(req, token) {
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

function runtimeReadiness({ worker, shop, token, writesEnabled }) {
  const catalog = shop.listCatalog();
  const buyableItems = catalog.filter((item) => item.buyable).length;
  const sellableItems = catalog.filter((item) => item.sellable).length;
  const wallet = worker.health();
  return {
    service: 'nexus-economy-worker',
    ...wallet,
    authenticated: Boolean(token),
    writesEnabled: Boolean(writesEnabled),
    migrationMode: writesEnabled ? 'active' : 'read-only',
    clusterShopItems: catalog.length,
    buyableItems,
    sellableItems,
    pendingBuyOrders: shop.pendingBuyOrders().length,
    checkoutReady: Boolean(token && writesEnabled && buyableItems > 0),
    sellbackCreditReady: Boolean(token && writesEnabled && sellableItems > 0)
  };
}

function runtimeLiveness() {
  return {
    ok: true,
    service: 'nexus-economy-worker',
    status: 'live'
  };
}

function runtimeOperationalReadiness({ worker, shop, token, writesEnabled, lifecycle = {} }) {
  try {
    const readiness = runtimeReadiness({ worker, shop, token, writesEnabled });
    const draining = lifecycle.draining === true;
    const ready = readiness.ok === true && !draining;
    return {
      statusCode: ready ? 200 : 503,
      body: {
        ...readiness,
        ok: ready,
        status: ready ? 'ready' : (draining ? 'draining' : 'not-ready'),
        draining,
        checkoutReady: ready && readiness.checkoutReady,
        sellbackCreditReady: ready && readiness.sellbackCreditReady
      }
    };
  } catch (error) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        service: 'nexus-economy-worker',
        status: 'not-ready',
        draining: lifecycle.draining === true,
        error: String(error?.message || error).slice(0, 300)
      }
    };
  }
}

function writeGate(path, { writesEnabled, lifecycle = {} }) {
  if (!WRITE_PATHS.has(path)) return null;
  if (lifecycle.draining === true) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        error: 'economy-worker-draining',
        draining: true
      }
    };
  }
  if (!writesEnabled) {
    return {
      statusCode: 503,
      body: {
        ok: false,
        error: 'economy-write-cutover-not-enabled',
        writesEnabled: false
      }
    };
  }
  return null;
}

function walletReadAccrualPermitted({ writesEnabled, lifecycle = {} }) {
  return Boolean(writesEnabled && lifecycle.draining !== true);
}

function createEconomyServer(options = {}) {
  const worker = options.worker || new NexusEconomyWorker();
  const shop = options.shop || new ClusterShopService({ economy: worker });
  const token = String(options.token ?? process.env.NEXUS_ECONOMY_TOKEN ?? '').trim();
  const writesEnabled = options.writesEnabled == null
    ? enabled(process.env.NEXUS_ECONOMY_WRITES_ENABLED)
    : Boolean(options.writesEnabled);
  const lifecycle = { draining: false, signal: null };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://nexus.local');

      if (req.method === 'GET' && url.pathname === '/health/live') {
        return json(res, 200, runtimeLiveness());
      }

      if (req.method === 'GET' && url.pathname === '/health/ready') {
        const probe = runtimeOperationalReadiness({ worker, shop, token, writesEnabled, lifecycle });
        return json(res, probe.statusCode, probe.body);
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, runtimeReadiness({ worker, shop, token, writesEnabled }));
      }

      if (!authorized(req, token)) return json(res, 401, { ok: false, error: 'unauthorized' });

      if (req.method === 'GET' && url.pathname.startsWith('/wallet/')) {
        const discordUserId = decodeURIComponent(url.pathname.slice('/wallet/'.length));
        const accrualPermitted = walletReadAccrualPermitted({ writesEnabled, lifecycle });
        if (accrualPermitted) await worker.accrueOffline(discordUserId).catch(() => null);
        return json(res, 200, {
          ok: true,
          discordUserId,
          balance: worker.balance(discordUserId),
          writesEnabled,
          accrualPermitted
        });
      }

      if (req.method === 'GET' && url.pathname === '/shop/catalog') {
        return json(res, 200, { ok: true, items: shop.listCatalog(), writesEnabled });
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

      // Identity linking is safe to stage before financial cutover because it does
      // not credit, debit, accrue, deliver, or remove anything from ARK.
      if (url.pathname === '/identity/link') return json(res, 200, { ok: true, result: worker.linkArkIdentity(input) });
      if (url.pathname === '/shop/quote') return json(res, 200, { ok: true, quote: shop.quote(input), writesEnabled });

      const gate = writeGate(url.pathname, { writesEnabled, lifecycle });
      if (gate) return json(res, gate.statusCode, gate.body);

      if (url.pathname === '/presence') return json(res, 200, await worker.recordPresence(input));
      if (url.pathname === '/wallet/credit') return json(res, 200, await worker.credit(input));
      if (url.pathname === '/wallet/spend') return json(res, 200, await worker.spend(input));
      if (url.pathname === '/wallet/accrue-offline') return json(res, 200, await worker.accrueOffline(input.discordUserId));

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

  return {
    server,
    worker,
    shop,
    token,
    writesEnabled,
    beginDrain(signal = 'shutdown') {
      if (lifecycle.draining) return false;
      lifecycle.draining = true;
      lifecycle.signal = String(signal || 'shutdown');
      return true;
    },
    isDraining: () => lifecycle.draining,
    readiness: () => runtimeReadiness({ worker, shop, token, writesEnabled }),
    operationalReadiness: () => runtimeOperationalReadiness({ worker, shop, token, writesEnabled, lifecycle })
  };
}

function listenEconomyServer(options = {}) {
  const runtime = createEconomyServer(options);
  const host = String(options.host || process.env.NEXUS_ECONOMY_HOST || '0.0.0.0');
  const port = Number(options.port || process.env.PORT || process.env.NEXUS_ECONOMY_PORT || 3230);
  runtime.server.listen(port, host, () => {
    console.log(`[Nexus Economy Worker] listening on ${host}:${port}`);
    console.log(`[Nexus Economy Worker] readiness: ${JSON.stringify(runtime.readiness())}`);
  });
  return runtime;
}

module.exports = {
  WRITE_PATHS,
  enabled,
  runtimeReadiness,
  runtimeLiveness,
  runtimeOperationalReadiness,
  writeGate,
  walletReadAccrualPermitted,
  createEconomyServer,
  listenEconomyServer
};
