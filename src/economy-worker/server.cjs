'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { NexusEconomyWorker, ONLINE_INTERVAL_MS } = require('../sentinel/nexus-economy-worker.cjs');
const { ClusterShopService } = require('../sentinel/cluster-shop-service.cjs');
const { rankById } = require('../shared/ranks.cjs');

const MAX_REQUEST_BODY_BYTES = 128 * 1024;

class EconomyRequestError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'EconomyRequestError';
    this.code = code;
  }
}

const DRAIN_MUTATION_PATHS = new Set(['/identity/link']);
const PRESENCE_WRITE_PATHS = new Set(['/presence', '/wallet/accrue-offline']);
const ADMIN_CREDIT_PATHS = new Set(['/wallet/admin-credit']);
const FINANCIAL_WRITE_PATHS = new Set([
  '/wallet/credit',
  '/wallet/spend',
  '/shop/buy',
  '/shop/sell',
  '/shop/sell/confirm-removal',
  '/shop/buy/delivery-status'
]);
const WRITE_PATHS = new Set([...PRESENCE_WRITE_PATHS, ...FINANCIAL_WRITE_PATHS]);
const POST_PATHS = new Set([...DRAIN_MUTATION_PATHS, ...WRITE_PATHS, ...ADMIN_CREDIT_PATHS, '/shop/quote']);

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
    if (bytes > MAX_REQUEST_BODY_BYTES) throw new EconomyRequestError('request-body-too-large', 'Request body too large.');
    chunks.push(buffer);
  }
  if (bytes === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new EconomyRequestError('invalid-json', 'Invalid JSON request body.');
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
  if (error instanceof EconomyRequestError && error.code === 'invalid-admin-credit') {
    return { statusCode: 400, body: { ok: false, error: 'invalid-admin-credit' } };
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

function walletSummary(worker, discordUserId) {
  const account = worker.wallet(discordUserId);
  const rankId = String(account?.rankId || 'shadow-recruit');
  const rank = rankById(rankId) || rankById('shadow-recruit');
  return {
    balance: Number(account?.balance || 0),
    rankId: rank.id,
    rankName: rank.name,
    online: account?.online === true,
    activePoints: Number(worker.onlineRates?.[rank.id] || 0),
    activeIntervalMinutes: ONLINE_INTERVAL_MS / 60000,
    passivePointsPerHour: Number(worker.offlineRates?.[rank.id] || 0),
    passiveCapHours: Number(worker.offlineCapHours || 0)
  };
}

async function walletBalances(worker, discordUserId) {
  if (typeof worker.balances === 'function') {
    const balances = await Promise.resolve(worker.balances(discordUserId));
    return {
      NEXUS_COINS: Number(balances?.NEXUS_COINS || 0),
      NEXUS_POINTS: Number(balances?.NEXUS_POINTS || 0),
      DINO_CACHE_TOKENS: Number(balances?.DINO_CACHE_TOKENS || 0)
    };
  }
  const points = typeof worker.balance === 'function'
    ? Number(await Promise.resolve(worker.balance(discordUserId)) || 0)
    : Number(worker.wallet?.(discordUserId)?.balance || 0);
  return { NEXUS_COINS: 0, NEXUS_POINTS: points, DINO_CACHE_TOKENS: 0 };
}

function runtimeReadiness({ worker, shop, token, writesEnabled, presenceWritesEnabled, adminCreditsEnabled = false }) {
  const catalog = shop.listCatalog();
  const buyableItems = catalog.filter((item) => item.buyable).length;
  const sellableItems = catalog.filter((item) => item.sellable).length;
  const wallet = publicWalletHealth(worker.health());
  const postgresBacked = Boolean(shop?.repository);
  const pending = postgresBacked ? null : shop.pendingBuyOrders();
  return {
    service: 'nexus-economy-worker',
    ...wallet,
    backend: worker?.backend || 'legacy-json',
    authenticated: Boolean(token),
    writesEnabled: Boolean(writesEnabled),
    presenceWritesEnabled: Boolean(presenceWritesEnabled),
    adminCreditsEnabled: Boolean(adminCreditsEnabled),
    migrationMode: writesEnabled ? 'active' : (presenceWritesEnabled ? 'accrual-only' : 'read-only'),
    clusterShopItems: catalog.length,
    buyableItems,
    sellableItems,
    pendingBuyOrders: Array.isArray(pending) ? pending.length : null,
    adminCreditReady: Boolean(token && adminCreditsEnabled),
    checkoutReady: Boolean(token && writesEnabled && buyableItems > 0),
    sellbackCreditReady: Boolean(token && writesEnabled && sellableItems > 0 && !postgresBacked)
  };
}

function runtimeLiveness() {
  return { ok: true, service: 'nexus-economy-worker', status: 'live' };
}

function runtimeOperationalReadiness({ worker, shop, token, writesEnabled, presenceWritesEnabled, adminCreditsEnabled = false, lifecycle = {} }) {
  try {
    const readiness = runtimeReadiness({ worker, shop, token, writesEnabled, presenceWritesEnabled, adminCreditsEnabled });
    const draining = lifecycle.draining === true;
    const ready = readiness.ok === true && !draining;
    return {
      statusCode: ready ? 200 : 503,
      body: {
        ...readiness,
        ok: ready,
        status: ready ? 'ready' : (draining ? 'draining' : 'not-ready'),
        draining,
        adminCreditReady: ready && readiness.adminCreditReady,
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
  return { statusCode: 503, body: { ok: false, error: 'economy-worker-draining', draining: true } };
}

function adminCreditGate(path, { adminCreditsEnabled = false, lifecycle = {} } = {}) {
  if (!ADMIN_CREDIT_PATHS.has(path)) return null;
  if (lifecycle.draining === true) {
    return { statusCode: 503, body: { ok: false, error: 'economy-worker-draining', draining: true } };
  }
  if (!adminCreditsEnabled) {
    return { statusCode: 503, body: { ok: false, error: 'economy-admin-credit-not-enabled', adminCreditsEnabled: false } };
  }
  return null;
}

function writeGate(path, options = {}) {
  const writesEnabled = Boolean(options.writesEnabled);
  const presenceWritesEnabled = options.presenceWritesEnabled == null ? writesEnabled : Boolean(options.presenceWritesEnabled);
  const lifecycle = options.lifecycle || {};
  if (!WRITE_PATHS.has(path)) return null;
  if (lifecycle.draining === true) {
    return { statusCode: 503, body: { ok: false, error: 'economy-worker-draining', draining: true } };
  }
  if (PRESENCE_WRITE_PATHS.has(path)) {
    if (!presenceWritesEnabled) {
      return { statusCode: 503, body: { ok: false, error: 'economy-presence-writes-not-enabled', presenceWritesEnabled: false } };
    }
    return null;
  }
  if (!writesEnabled) {
    return { statusCode: 503, body: { ok: false, error: 'economy-write-cutover-not-enabled', writesEnabled: false } };
  }
  return null;
}

function mutationRequestGate(path, options = {}) {
  const writesEnabled = Boolean(options.writesEnabled);
  const presenceWritesEnabled = options.presenceWritesEnabled == null ? writesEnabled : Boolean(options.presenceWritesEnabled);
  const adminCreditsEnabled = Boolean(options.adminCreditsEnabled);
  const lifecycle = options.lifecycle || {};
  if (lifecycle.draining === true && path !== '/shop/quote') return drainMutationGate('/identity/link', { lifecycle });
  return drainMutationGate(path, { lifecycle })
    || adminCreditGate(path, { adminCreditsEnabled, lifecycle })
    || writeGate(path, { writesEnabled, presenceWritesEnabled, lifecycle });
}

function walletReadAccrualPermitted({ writesEnabled = false, presenceWritesEnabled, lifecycle = {} }) {
  const accrualWritesEnabled = presenceWritesEnabled == null ? Boolean(writesEnabled) : Boolean(presenceWritesEnabled);
  return Boolean(accrualWritesEnabled && lifecycle.draining !== true);
}

function cleanAdminCreditReason(value) {
  return String(value || '').replace(/[\r\n\t\u0000-\u001f]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 240);
}

function adminCreditInput(input = {}) {
  const metadata = input?.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {};
  const issuerDiscordUserId = String(metadata.issuerDiscordUserId || '').trim();
  const targetDiscordUserId = String(input.discordUserId || '').trim();
  const reason = cleanAdminCreditReason(metadata.reason);
  if (!/^\d{5,25}$/.test(issuerDiscordUserId) || !/^\d{5,25}$/.test(targetDiscordUserId) || !reason) {
    throw new EconomyRequestError('invalid-admin-credit', 'Admin credit requires issuer, target, and reason.');
  }
  return {
    ...input,
    discordUserId: targetDiscordUserId,
    source: 'discord-owner-command',
    type: 'admin-credit',
    metadata: {
      ...metadata,
      command: '/wallet add',
      issuerDiscordUserId,
      targetDiscordUserId,
      reason
    }
  };
}

function createEconomyServer(options = {}) {
  const worker = options.worker || new NexusEconomyWorker();
  const shop = options.shop || new ClusterShopService({ economy: worker });
  const token = String(options.token ?? process.env.NEXUS_ECONOMY_TOKEN ?? '').trim();
  const writesEnabled = options.writesEnabled == null
    ? enabled(process.env.NEXUS_ECONOMY_WRITES_ENABLED)
    : Boolean(options.writesEnabled);
  const presenceEnv = String(process.env.NEXUS_ECONOMY_PRESENCE_WRITES_ENABLED || '').trim();
  const presenceWritesEnabled = options.presenceWritesEnabled == null
    ? (presenceEnv ? enabled(presenceEnv) : writesEnabled)
    : Boolean(options.presenceWritesEnabled);
  const adminCreditsEnabled = options.adminCreditsEnabled == null
    ? enabled(process.env.NEXUS_ECONOMY_ADMIN_CREDITS_ENABLED)
    : Boolean(options.adminCreditsEnabled);
  const lifecycle = { draining: false, signal: null };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://nexus.local');

      if (req.method === 'GET' && url.pathname === '/health/live') return json(res, 200, runtimeLiveness());
      if (req.method === 'GET' && url.pathname === '/health/ready') {
        const probe = runtimeOperationalReadiness({ worker, shop, token, writesEnabled, presenceWritesEnabled, adminCreditsEnabled, lifecycle });
        return json(res, probe.statusCode, probe.body);
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        return json(res, 200, runtimeReadiness({ worker, shop, token, writesEnabled, presenceWritesEnabled, adminCreditsEnabled }));
      }
      if (!authorized(req, token)) return json(res, 401, { ok: false, error: 'unauthorized' });

      if (req.method === 'GET' && url.pathname.startsWith('/wallet-balances/')) {
        const discordUserId = decodeURIComponent(url.pathname.slice('/wallet-balances/'.length));
        return json(res, 200, {
          ok: true,
          discordUserId,
          balances: await walletBalances(worker, discordUserId),
          readOnly: true
        });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/wallet/')) {
        const discordUserId = decodeURIComponent(url.pathname.slice('/wallet/'.length));
        const accrualPermitted = walletReadAccrualPermitted({ writesEnabled, presenceWritesEnabled, lifecycle });
        if (accrualPermitted) await Promise.resolve(worker.accrueOffline(discordUserId)).catch(() => null);
        if (typeof worker.wallet === 'function') {
          return json(res, 200, {
            ok: true,
            discordUserId,
            ...walletSummary(worker, discordUserId),
            writesEnabled,
            presenceWritesEnabled,
            accrualPermitted
          });
        }
        return json(res, 200, {
          ok: true,
          discordUserId,
          balance: await Promise.resolve(worker.balance(discordUserId)),
          writesEnabled,
          presenceWritesEnabled,
          accrualPermitted
        });
      }

      if (req.method === 'GET' && url.pathname === '/shop/catalog') {
        return json(res, 200, { ok: true, items: shop.listCatalog(), writesEnabled });
      }
      if (req.method === 'GET' && url.pathname === '/shop/orders/pending') {
        return json(res, 200, { ok: true, orders: await Promise.resolve(shop.pendingBuyOrders()) });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/shop/order/')) {
        const orderId = decodeURIComponent(url.pathname.slice('/shop/order/'.length));
        const order = await Promise.resolve(shop.order(orderId));
        return order ? json(res, 200, { ok: true, order }) : json(res, 404, { ok: false, error: 'order-not-found' });
      }

      if (req.method !== 'POST') return json(res, 404, { ok: false, error: 'not-found' });
      const mutationGate = mutationRequestGate(url.pathname, { writesEnabled, presenceWritesEnabled, adminCreditsEnabled, lifecycle });
      if (mutationGate) return json(res, mutationGate.statusCode, mutationGate.body);
      if (!POST_PATHS.has(url.pathname)) return json(res, 404, { ok: false, error: 'not-found' });

      const input = await body(req);
      const executionGate = mutationRequestGate(url.pathname, { writesEnabled, presenceWritesEnabled, adminCreditsEnabled, lifecycle });
      if (executionGate) return json(res, executionGate.statusCode, executionGate.body);

      if (url.pathname === '/identity/link') return json(res, 200, { ok: true, result: await Promise.resolve(worker.linkArkIdentity(input)) });
      if (url.pathname === '/shop/quote') return json(res, 200, { ok: true, quote: shop.quote(input), writesEnabled });
      if (url.pathname === '/presence') return json(res, 200, await worker.recordPresence(input));
      if (url.pathname === '/wallet/admin-credit') return json(res, 200, await worker.credit(adminCreditInput(input)));
      if (url.pathname === '/wallet/credit') return json(res, 200, await worker.credit(input));
      if (url.pathname === '/wallet/spend') return json(res, 200, await worker.spend(input));
      if (url.pathname === '/wallet/accrue-offline') return json(res, 200, await worker.accrueOffline(input.discordUserId));
      if (url.pathname === '/shop/buy') {
        const result = await shop.createBuyOrder(input);
        return json(res, result.ok ? 200 : 409, result);
      }
      if (url.pathname === '/shop/sell') return json(res, 200, await Promise.resolve(shop.createSellOrder(input)));
      if (url.pathname === '/shop/sell/confirm-removal') return json(res, 200, await shop.confirmSellRemoval(input));
      if (url.pathname === '/shop/buy/delivery-status') return json(res, 200, await Promise.resolve(shop.markBuyDelivery(input)));
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
    presenceWritesEnabled,
    adminCreditsEnabled,
    beginDrain(signal = 'shutdown') {
      if (lifecycle.draining) return false;
      lifecycle.draining = true;
      lifecycle.signal = String(signal || 'shutdown');
      return true;
    },
    isDraining: () => lifecycle.draining,
    readiness: () => runtimeReadiness({ worker, shop, token, writesEnabled, presenceWritesEnabled, adminCreditsEnabled }),
    operationalReadiness: () => runtimeOperationalReadiness({ worker, shop, token, writesEnabled, presenceWritesEnabled, adminCreditsEnabled, lifecycle })
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
  PRESENCE_WRITE_PATHS,
  ADMIN_CREDIT_PATHS,
  FINANCIAL_WRITE_PATHS,
  WRITE_PATHS,
  POST_PATHS,
  enabled,
  body,
  publicRequestError,
  publicWalletHealth,
  walletSummary,
  walletBalances,
  runtimeReadiness,
  runtimeLiveness,
  runtimeOperationalReadiness,
  drainMutationGate,
  adminCreditGate,
  writeGate,
  mutationRequestGate,
  walletReadAccrualPermitted,
  cleanAdminCreditReason,
  adminCreditInput,
  createEconomyServer,
  listenEconomyServer
};
