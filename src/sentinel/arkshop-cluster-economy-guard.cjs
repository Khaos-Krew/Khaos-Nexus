'use strict';

const crypto = require('node:crypto');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { isArkShopMysqlRetired } = require('./arkshop-database.cjs');

const ARKSHOP_FEATURES_OFF_MESSAGE = 'Starter kits, the bank and caches are turned off on our ARK servers for now. Nothing was charged. Watch #announcements for when they\'re back.';

function clean(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function mysqlEnabled(config = {}) {
  const value = config?.Mysql?.UseMysql;
  return value === true || String(value ?? '').trim().toLowerCase() === 'true';
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
    table: clean(mysql.MysqlPlayersTable || mysql.MysqlTable || mysql.TableName || 'ArkShopPlayers', 160)
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function retiredReason(mysqlRetired, pluginDisabledCount) {
  if (mysqlRetired && pluginDisabledCount) return 'mysql-retired+plugin-folder-disabled';
  if (mysqlRetired) return 'mysql-retired';
  return 'plugin-folder-disabled';
}

function evaluateClusterDatabase(records = [], { mysqlRetired = false } = {}) {
  const active = records.filter((entry) => entry?.enabled !== false && entry?.shopEnabled !== false);
  const pluginDisabled = active.filter((entry) => entry.pluginDisabled === true);
  if (mysqlRetired || pluginDisabled.length) {
    const problems = pluginDisabled.length ? pluginDisabled : active;
    return {
      ok: false,
      mode: 'arkshop-retired',
      reason: retiredReason(mysqlRetired, pluginDisabled.length),
      servers: active.length,
      problemServerIds: problems.map((entry) => clean(entry.id, 64)).filter(Boolean),
      fingerprint: ''
    };
  }

  if (!active.length) return { ok: true, mode: 'no-active-shop-servers', servers: 0, fingerprint: '' };

  const unreadable = active.filter((entry) => entry.readFailed === true);
  if (unreadable.length) {
    return {
      ok: false,
      mode: 'config-read-failed',
      servers: active.length,
      problemServerIds: unreadable.map((entry) => clean(entry.id, 64)).filter(Boolean),
      fingerprint: ''
    };
  }

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
        fingerprint: databaseFingerprint(config),
        useMysqlType: typeof config?.Mysql?.UseMysql
      });
    } catch (error) {
      const pluginDisabled = error?.code === 'ARKSHOP_PLUGIN_DISABLED' || error?.pluginDisabled === true;
      records.push({
        id: server.id,
        enabled: server.enabled,
        shopEnabled: server.shopEnabled,
        mysqlEnabled: false,
        fingerprint: '',
        readFailed: pluginDisabled !== true,
        pluginDisabled,
        error: String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 180)
      });
    }
  }
  const result = evaluateClusterDatabase(records, { mysqlRetired: isArkShopMysqlRetired() });
  return { ...result, records };
}

function formatArkShopGuardLog(result = {}) {
  if (result?.ok) {
    const types = [...new Set((result.records || []).map((record) => record.useMysqlType).filter(Boolean))].join(',') || 'unknown';
    return `[Nexus Sentinal] ArkShop cluster economy guard: ok=true mode=${result.mode} servers=${result.servers} useMysqlType=${types} dbFingerprint=${result.fingerprint ? result.fingerprint.slice(0, 12) : 'none'}`;
  }
  const affected = (result.problemServerIds || []).join(',') || 'unknown';
  if (result?.mode === 'arkshop-retired') {
    const detail = (result.records || [])
      .filter((record) => record?.pluginDisabled || record?.readFailed)
      .map((record) => `${record.id}:${record.pluginDisabled ? 'plugin-folder-disabled' : 'read-failed'}${record.error ? `:${record.error}` : ''}`)
      .join(' | ');
    return `[Nexus Sentinal] ArkShop cluster economy guard: ok=false mode=arkshop-retired servers=${result.servers} affected=${affected} reason=${result.reason || 'retired'}${detail ? ` detail=${detail}` : ''}; ArkShop is retired (MySQL retired and/or plugin folder disabled). Starter kits, the bank and caches stay off. Fail closed: ArkShop and its MySQL wallet were not re-enabled.`;
  }
  const readErrors = (result.records || []).filter((record) => record.readFailed).map((record) => `${record.id}:${record.error}`).join(' | ');
  return `[Nexus Sentinal] ArkShop cluster economy guard: ok=false mode=${result.mode} servers=${result.servers} affected=${affected}${readErrors ? ` readErrors=${readErrors}` : ''}; cluster-wide starter/bank/cache operations must remain disabled until all maps share one verified MySQL backend.`;
}

async function arkShopMemberFeatureStatus(options) {
  if (isArkShopMysqlRetired()) {
    return {
      ok: false,
      mode: 'arkshop-retired',
      reason: 'mysql-retired',
      servers: 0,
      problemServerIds: [],
      fingerprint: '',
      records: []
    };
  }
  try {
    return await auditArkShopClusterDatabase(options);
  } catch (error) {
    return {
      ok: false,
      mode: 'audit-failed',
      reason: 'audit-failed',
      servers: 0,
      problemServerIds: [],
      fingerprint: '',
      records: [],
      error: String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 180)
    };
  }
}

function arkShopFeaturesUnavailableMessageFrom(status) {
  return status?.ok === true ? '' : ARKSHOP_FEATURES_OFF_MESSAGE;
}

async function arkShopFeaturesUnavailableMessage(options) {
  return arkShopFeaturesUnavailableMessageFrom(await arkShopMemberFeatureStatus(options));
}

async function arkShopFeaturesAreOpen(options) {
  try {
    const status = await arkShopMemberFeatureStatus(options);
    return status?.ok === true;
  } catch {
    return false;
  }
}

function memberFeatureUnavailableMessage(error) {
  const code = String(error?.code || '');
  if (code === 'ARKSHOP_RETIRED' || code === 'CLUSTER_ECONOMY_NOT_READY' || code === 'ARKSHOP_MYSQL_RETIRED' || code === 'ARKSHOP_PLUGIN_DISABLED') {
    return ARKSHOP_FEATURES_OFF_MESSAGE;
  }
  if (String(error?.message || '') === ARKSHOP_FEATURES_OFF_MESSAGE) return ARKSHOP_FEATURES_OFF_MESSAGE;
  if (String(error?.message || '') === 'ArkShop MySQL is retired.') return ARKSHOP_FEATURES_OFF_MESSAGE;
  return '';
}

function memberActionFallback(error, label) {
  const plain = memberFeatureUnavailableMessage(error);
  if (plain) return plain;
  const detail = String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500);
  console.error(`[Nexus Sentinal] ${label}: ${detail}`);
  return `⚠️ **${label}:** That action could not be completed. Nothing was charged.`;
}

function installArkShopClusterEconomyGuard({ delayMs = 45_000 } = {}) {
  const timer = setTimeout(() => {
    void auditArkShopClusterDatabase()
      .then((result) => {
        const line = formatArkShopGuardLog(result);
        if (result.ok) console.log(line);
        else console.error(line);
      })
      .catch((error) => console.error(`[Nexus Sentinal] ArkShop cluster economy guard audit failed closed: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 240)}`));
  }, Math.max(5_000, Number(delayMs) || 45_000));
  timer.unref?.();
  return { installed: true };
}

module.exports = {
  ARKSHOP_FEATURES_OFF_MESSAGE,
  mysqlEnabled,
  databaseFingerprint,
  evaluateClusterDatabase,
  auditArkShopClusterDatabase,
  formatArkShopGuardLog,
  arkShopMemberFeatureStatus,
  arkShopFeaturesUnavailableMessageFrom,
  arkShopFeaturesUnavailableMessage,
  arkShopFeaturesAreOpen,
  memberFeatureUnavailableMessage,
  memberActionFallback,
  installArkShopClusterEconomyGuard
};
