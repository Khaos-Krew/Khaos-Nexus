'use strict';

const { envBoolean } = require('./forge-self-repair-policy.cjs');

function arkDiagnosticsConfiguration(env = process.env, prefix = 'ARK_GEN1') {
  const serverEnabled = envBoolean(env[`${prefix}_ENABLED`], false);
  const requested = envBoolean(env.NEXUS_FORGE_SELF_REPAIR_ARK_CHECKS_ENABLED, false);
  return {
    prefix,
    enabled: Boolean(serverEnabled && requested),
    serverEnabled,
    requested,
    rconEnabled: envBoolean(env.NEXUS_FORGE_SELF_REPAIR_ARK_RCON_ENABLED, true),
    databaseEnabled: envBoolean(env.NEXUS_FORGE_SELF_REPAIR_ARK_DATABASE_ENABLED, true),
    sftpEnabled: envBoolean(env.NEXUS_FORGE_SELF_REPAIR_ARK_SFTP_ENABLED, false)
  };
}

function safeText(value, max = 260) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function defaultRconProbe({ env, prefix }) {
  const { ArkRconClient } = require('./ark-rcon.cjs');
  const host = String(env[`${prefix}_HOST`] || '').trim();
  const port = Number(env[`${prefix}_RCON_PORT`] || 0);
  const password = String(env[`${prefix}_RCON_PASSWORD`] || '');
  const client = new ArkRconClient({ host, port, password, timeoutMs: 8_000 });
  const response = await client.execute('ListPlayers');
  return {
    ok: true,
    state: 'reachable',
    responseBytes: Buffer.byteLength(String(response || ''))
  };
}

async function defaultDatabaseProbe() {
  const { databaseStatus } = require('./arkshop-database.cjs');
  const status = await databaseStatus();
  return {
    ok: Boolean(status.connected && status.tableExists !== false),
    state: status.connected ? (status.tableExists === false ? 'table-missing' : 'connected') : 'disconnected',
    backend: safeText(status.backend || 'unknown', 40),
    database: safeText(status.database || '', 120),
    table: safeText(status.table || '', 120),
    tableExists: status.tableExists !== false
  };
}

async function defaultSftpProbe({ prefix }) {
  const { discoverPaths } = require('./ark-config-manager.cjs');
  const paths = await discoverPaths(prefix);
  const gus = Boolean(paths.gus?.found);
  const game = Boolean(paths.game?.found);
  const arkshop = Boolean(paths.arkshop?.found);
  return {
    ok: Boolean(gus && game),
    state: gus && game ? 'reachable' : 'config-path-missing',
    gameUserSettingsFound: gus,
    gameIniFound: game,
    arkShopConfigFound: arkshop
  };
}

async function runProbe(name, enabled, probe, context) {
  if (!enabled) return { enabled: false, ok: true, state: 'disabled' };
  try {
    const result = await probe(context);
    return {
      enabled: true,
      ok: result?.ok !== false,
      state: safeText(result?.state || (result?.ok === false ? 'unhealthy' : 'healthy'), 80),
      ...result
    };
  } catch (error) {
    return {
      enabled: true,
      ok: false,
      state: 'unavailable',
      error: safeText(error?.message || error, 300),
      probe: name
    };
  }
}

async function collectArkSelfRepairDiagnostics(options = {}) {
  const env = options.env || process.env;
  const prefix = String(options.prefix || 'ARK_GEN1').trim() || 'ARK_GEN1';
  const config = options.config || arkDiagnosticsConfiguration(env, prefix);
  if (!config.enabled) {
    return {
      enabled: false,
      ok: true,
      state: config.serverEnabled ? 'self-repair-disabled' : 'server-disabled',
      config
    };
  }

  const context = { env, prefix };
  const rcon = await runProbe('rcon', config.rconEnabled, options.rconProbe || defaultRconProbe, context);
  const database = await runProbe('database', config.databaseEnabled, options.databaseProbe || defaultDatabaseProbe, context);
  const sftp = await runProbe('sftp', config.sftpEnabled, options.sftpProbe || defaultSftpProbe, context);
  const enabledChecks = [rcon, database, sftp].filter((item) => item.enabled);
  const ok = enabledChecks.every((item) => item.ok);

  return {
    enabled: true,
    ok,
    state: ok ? 'healthy' : 'degraded',
    config,
    rcon,
    database,
    sftp
  };
}

module.exports = {
  arkDiagnosticsConfiguration,
  safeText,
  defaultRconProbe,
  defaultDatabaseProbe,
  defaultSftpProbe,
  runProbe,
  collectArkSelfRepairDiagnostics
};
