'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { NexusEconomyWorker } = require('../sentinel/nexus-economy-worker.cjs');
const { ClusterShopService } = require('../sentinel/cluster-shop-service.cjs');

const MAX_REQUEST_BODY_BYTES = 128 * 1024;

class EconomyRequestError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'EconomyRequestError';
    this.code = code;
  }
}

const DRAIN_MUTATION_PATHS = new Set([
  '/identity/link'
]);

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
  const declaredLength = String(req.headers?.['content-length'] || '').trim();
  if (/^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_REQUEST_BODY_BYTES) {
    throw new EconomyRequestError('request-body-too-large', 'Request body too large.');
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BODY_BYTES) {
      throw new EconomyRequestError('request-body-too-large', 'Request body too large.');
    }
    chunks.push(buffer);
  }

  if (bytes === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new EconomyRequestError('invalid-json', 'Invalid JSON request body.');
    }
    throw error;
  }
}

function publicRequestError(error) {
  if (error instanceof EconomyRequestError && error.code === 'request-body-too-large') {
    return { statusCode: 413, body: { ok: false, error: 'request-body-too-large' } };
  }
  if (error instanceof EconomyRequestError && error.code === 'invalid-json') {
    return { statusCode: 400, body: { ok: false, error: 'invalid-json' } };
  }
  return { statusCode: 500, body: { ok: false, error: 'internal-error' } };
}

function publicWalletHealth(wallet = {}) {
  const summary = { ok: wallet?.ok === true };
  for (const key of ['accounts', 'linkedArkIds', 'ledgerEntries']) {
    if (Number.isSafeInteger(wallet?.[key]) && wallet[key] >= 0) summary[key] = wallet[key];
  }
  if (!summary.ok) summary.error = 'diagnostic-unavailable';
  return summary;
}

function runtimeReadiness({ worker, shop, token, writesEnabled }) {
  const catalog = shop.listCatalog();
  const buyableItems = catalog.filter((item) => item.buyable).length;
  const sellableItems = catalog.filter((item) => item.sellable).length;
  const wallet = publicWalletHealth(worker.health());
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

function runtimeLegacyHealth({ worker, shop, token, writesEnabled }) {
  try {
    return {
      statusCode: 200,
      body: runtimeReadiness({ worker, shop, token, writesEnabled })
    };
  } catch {
    return {
      statusCode: 503,
      body: {
        ok: false,
        service: 'nexus-economy-worker',
        status: 'not-ready',
        error: 'diagnostic-unavailable'
      }
    };
  }
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
  } catch {
    return {
      statusCode: 503,
      body: {
        ok: false,
        service: 'nexus-economy-worker',
        status: 'not-ready',
        draining: lifecycle.draining === true,
        error: 'diagnostic-unavailable'
      }
    };
  }
}

function drainMutationGate(path, { lifecycle = {} }) {
  if (!DRAIN_MUTATION_PATHS.has(path) || lifecycle.draining !== true) return null;
  return {
    statusCode: 503,
    body: {
      ok: false,
      error: 'economy-worker-draining',
      draining: true
    }
  };
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

function mutationRequestGate(path, { writesEnabled, lifecycle = {} }) {
  return drainMutationGate(path, { lifecycle }) || writeGate(path, { writesEnabled, lifecycle });
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
        const probe = runtimeLegacyHealth({ worker, shop, token, writesEnabled });
        return json(res, probe.statusCode, probe.body);
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

      // Reject blocked mutations before reading their request bodies. During drain or
      // read-only migration this prevents slow/oversized bodies from consuming the
      // shutdown window for requests that cannot be accepted anyway.
      const mutationGate = mutationRequestGate(url.pathname, { writesEnabled, lifecycle });
      if (mutationGate) return json(res, mutationGate.statusCode, mutationGate.body);

      const input = await body(req);

      // Re-evaluate mutation eligibility after body parsing. A request may have passed
      // the pre-body gate just before graceful drain began and then spent time streaming
      // its body; it must not be allowed to mutate state after the lifecycle changed.
      const executionGate = mutationRequestGate(url.pathname, { writesEnabled, lifecycle });
      if (executionGate) return json(res, executionGate.statusCode, executionGate.body);

      // Identity linking is safe to stage before financial cutover because it does
      // not credit, debit, accrue, deliver, or remove anything from ARK. It is still
      // a state mutation, so mutationRequestGate rejects it once graceful drain begins.
      if (url.pathname === '/identity/link') return json(res, 200, { ok: true, result: worker.linkArkIdentity(input) });
      if (url.pathname === '/shop/quote') return json(res, 200, { ok: true, quote: shop.quote(input), writesEnabled });

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
      const response = publicRequestError(error);
      return json(res, response.statusCode, response.body);
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
  MAX_REQUEST_BODY_BYTES,
  EconomyRequestError,
  DRAIN_MUTATION_PATHS,
  WRITE_PATHS,
  enabled,
  body,
  publicRequestError,
  publicWalletHealth,
  runtimeReadiness,
  runtimeLegacyHealth,
  runtimeLiveness,
  runtimeOperationalReadiness,
  drainMutationGate,
  writeGate,
  mutationRequestGate,
  walletReadAccrualPermitted,
  createEconomyServer,
  listenEconomyServer
};
