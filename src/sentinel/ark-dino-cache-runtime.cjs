'use strict';

const { connectMysql } = require('./arkshop-mysql.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { CONFIG, cacheForPurchase } = require('./ark-dino-cache-engine.cjs');
const { DinoCacheStore } = require('./ark-dino-cache-store.cjs');
const { DinoCacheRedemptionProcessor } = require('./ark-dino-cache-purchase.cjs');
const { installArkCacheShopExtension } = require('./ark-cache-shop-extension.cjs');

const INSTALLED = Symbol.for('khaos.nexus.dino-cache.runtime');
let timer = null;

function enabled(env = process.env) {
  return String(env.NEXUS_ARK_DINO_CACHE_ENABLED || 'false').toLowerCase() === 'true';
}

function serverMapping(env = process.env) {
  let parsed;
  try { parsed = JSON.parse(String(env.NEXUS_DINO_CACHE_SERVER_MAP_JSON || '{}')); }
  catch { throw new Error('NEXUS_DINO_CACHE_SERVER_MAP_JSON must be valid JSON.'); }
  const result = {};
  for (const [sourceId, serverId] of Object.entries(parsed || {})) {
    const source = String(sourceId).trim();
    const target = String(serverId).trim().toLowerCase();
    if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(source) || !/^[a-z0-9_-]{1,64}$/.test(target)) throw new Error('Dino Cache server mapping contains an unsafe identifier.');
    result[source] = target;
  }
  if (!Object.keys(result).length) throw new Error('NEXUS_DINO_CACHE_SERVER_MAP_JSON must map ArkShop ServersId values to Sentinel server ids.');
  return Object.freeze(result);
}

async function preflight(connection) {
  if (String(process.env.ARKSHOP_DB_MODE || '').toLowerCase() !== 'mysql') throw new Error('Dino Cache receipt processing requires ARKSHOP_DB_MODE=mysql.');
  const requiredTables = ['ArkShopLogTransactions', 'nexus_dino_cache_transactions', 'nexus_dino_cache_events'];
  const [tables] = await connection.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  const present = new Set(tables.map((row) => String(row.TABLE_NAME)));
  const missing = requiredTables.filter((name) => !present.has(name));
  if (missing.length) throw new Error(`Dino Cache MySQL migration/preflight incomplete: missing ${missing.join(', ')}.`);
  const [columns] = await connection.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ArkShopLogTransactions'");
  const names = new Set(columns.map((row) => String(row.COLUMN_NAME)));
  const required = ['Id', 'EosId', 'ItemName', 'ItemAmount', 'TotalPrice', 'ServersId'];
  const missingColumns = required.filter((name) => !names.has(name));
  if (missingColumns.length) throw new Error(`ArkShop purchase log is missing required columns: ${missingColumns.join(', ')}.`);
  return true;
}

async function readRecentPurchases(connection, limit = 250) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 250));
  const [rows] = await connection.query(`SELECT Id, EosId, ItemName, ItemAmount, TotalPrice, ServersId FROM ArkShopLogTransactions ORDER BY Id DESC LIMIT ${safeLimit}`);
  return rows.reverse();
}

function verifiedReceipt(row, mapping, registry, config = CONFIG) {
  const sourceServerId = String(row.ServersId ?? '').trim();
  const serverId = mapping[sourceServerId];
  if (!serverId) return null;
  const server = registry.get(serverId);
  if (!server || server.enabled !== true || server.shopEnabled !== true || server.connections?.rcon !== true) return null;
  const cache = cacheForPurchase(row.ItemName, server.mapName || server.id, config);
  if (!cache) return null;
  if (Number(row.ItemAmount) !== 1 || Number(row.TotalPrice) !== cache.price) return null;
  const eosId = String(row.EosId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(eosId)) return null;
  return { sourceSystem: 'arkshop-mysql', sourceServerId, sourceTransactionId: String(row.Id), sourceItemName: String(row.ItemName), playerEosId: eosId,
    playerAccountId: '', serverId: server.id, mapName: server.mapName, cacheType: cache.id, pointCost: cache.price };
}

function rconResolver(registry) {
  return (serverId) => {
    const server = registry.get(serverId);
    if (!server || server.enabled !== true || server.connections?.rcon !== true) throw new Error('Target map is disabled or RCON is not ready.');
    const connection = arkServerFromEnv(server.envPrefix);
    if (!connection.enabled) throw new Error('Target map is not enabled in Sentinel environment configuration.');
    return new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
  };
}

async function runDinoCacheCycle({ connector = connectMysql, registry = new ArkClusterRegistry() } = {}) {
  if (!enabled()) return { skipped: 'disabled' };
  const mapping = serverMapping();
  const { connection } = await connector();
  try {
    await preflight(connection);
    const store = new DinoCacheStore(connection);
    const processor = new DinoCacheRedemptionProcessor({ store, rconForServer: rconResolver(registry) });
    const stale = await store.failStaleDeliveries(Number(process.env.NEXUS_DINO_CACHE_DELIVERY_STALE_MINUTES || 10));
    let accepted = 0;
    for (const row of await readRecentPurchases(connection)) {
      const receipt = verifiedReceipt(row, mapping, registry);
      if (!receipt) continue;
      await processor.acceptVerifiedPurchase(receipt);
      accepted += 1;
    }
    let delivered = 0;
    for (const row of await store.actionable(25)) {
      const result = await processor.deliver(row);
      if (result?.state === 'DELIVERED') delivered += 1;
    }
    return { accepted, delivered, stale };
  } finally { await connection.end().catch(() => {}); }
}

function installDinoCacheRuntime() {
  installArkCacheShopExtension();
  if (globalThis[INSTALLED]) return false;
  globalThis[INSTALLED] = true;
  if (!enabled()) { console.log('[dino-cache] legacy ArkShop receipt poller disabled; Discord Cache Shop remains available'); return false; }
  const interval = Math.max(15_000, Math.min(300_000, Number(process.env.NEXUS_DINO_CACHE_POLL_MS || 30_000)));
  const run = () => runDinoCacheCycle().then((result) => console.log('[dino-cache] cycle', JSON.stringify(result))).catch((error) => console.error('[dino-cache] blocked', String(error?.message || error).slice(0, 500)));
  setTimeout(run, 5_000).unref?.();
  timer = setInterval(run, interval); timer.unref?.();
  return true;
}

module.exports = { enabled, serverMapping, preflight, readRecentPurchases, verifiedReceipt, rconResolver, runDinoCacheCycle, installDinoCacheRuntime };
