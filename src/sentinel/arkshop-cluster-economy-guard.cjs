'use strict';

const crypto = require('node:crypto');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { readConfig } = require('./ark-config-manager.cjs');

function clean(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function mysqlEnabled(config = {}) {
  return config?.Mysql?.UseMysql === true;
}

function databaseFingerprint(config = {}) {
  if (!mysqlEnabled(config)) return '';
  const mysql = config.Mysql || {};
  // Never expose the connection values themselves. We only compare a stable digest.
  const canonical = JSON.stringify({
    host: clean(mysql.MysqlHost, 240).toLowerCase(),
    port: Number(mysql.MysqlPort || 3306),
    database: clean(mysql.MysqlDB, 160),
    user: clean(mysql.MysqlUser, 160),
    table: clean(mysql.MysqlTable || mysql.TableName || 'ArkShopPlayers', 160)
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function evaluateClusterDatabase(records = []) {
  const active = records.filter((entry) => entry?.enabled !== false && entry?.shopEnabled !== false);
  if (!active.length) return { ok: true, mode: 'no-active-shop-servers', servers: 0, fingerprint: '' };

  const local = active.filter((entry) => entry.mysqlEnabled !== true);
  if (local.length) {
    return {
      ok: false,
      mode: 'non-shared-database',
      servers: active.length,
      problemServerIds: local.map((entry) => clean(entry.id, 64)).filter(Boolean),
      fingerprint: ''
    };
  }

  const fingerprints = [...new Set(active.map((entry) => clean(entry.fingerprint, 64)).filter(Boolean))];
  if (fingerprints.length !== 1) {
    return {
      ok: false,
      mode: 'database-mismatch',
      servers: active.length,
      problemServerIds: active.map((entry) => clean(entry.id, 64)).filter(Boolean),
      fingerprint: ''
    };
  }

  return {
    ok: true,
    mode: active.length > 1 ? 'shared-cluster-mysql' : 'shared-mysql-ready',
    servers: active.length,
    fingerprint: fingerprints[0]
  };
}

async function auditArkShopClusterDatabase({ registry = new ArkClusterRegistry(), reader = readConfig } = {}) {
  const servers = registry.list({ includeDisabled: false }).filter((server) => server.shopEnabled !== false);
  const records = [];
  for (const server of servers) {
    try {
      const result = await reader(server.envPrefix, 'arkshop');
      const config = JSON.parse(result.text);
      records.push({
        id: server.id,
        enabled: server.enabled,
        shopEnabled: server.shopEnabled,
        mysqlEnabled: mysqlEnabled(config),
        fingerprint: databaseFingerprint(config)
      });
    } catch (error) {
      records.push({
        id: server.id,
        enabled: server.enabled,
        shopEnabled: server.shopEnabled,
        mysqlEnabled: false,
        fingerprint: '',
        readFailed: true,
        error: String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 180)
      });
    }
  }
  const result = evaluateClusterDatabase(records);
  return { ...result, records };
}

function installArkShopClusterEconomyGuard({ delayMs = 45_000 } = {}) {
  const timer = setTimeout(() => {
    void auditArkShopClusterDatabase()
      .then((result) => {
        if (result.ok) {
          console.log(`[Nexus Sentinal] ArkShop cluster economy guard: ok=true mode=${result.mode} servers=${result.servers} dbFingerprint=${result.fingerprint ? result.fingerprint.slice(0, 12) : 'none'}`);
        } else {
          console.error(`[Nexus Sentinal] ArkShop cluster economy guard: ok=false mode=${result.mode} servers=${result.servers} affected=${(result.problemServerIds || []).join(',') || 'unknown'}; cluster-wide starter/bank/cache operations must remain disabled until all maps share one MySQL backend.`);
        }
      })
      .catch((error) => console.error(`[Nexus Sentinal] ArkShop cluster economy guard audit failed closed: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 240)}`));
  }, Math.max(5_000, Number(delayMs) || 45_000));
  timer.unref?.();
  return { installed: true };
}

module.exports = {
  mysqlEnabled,
  databaseFingerprint,
  evaluateClusterDatabase,
  auditArkShopClusterDatabase,
  installArkShopClusterEconomyGuard
};
