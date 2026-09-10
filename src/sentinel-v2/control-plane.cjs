'use strict';

const { loadSentinelConfig } = require('./config.cjs');
const { createLogger } = require('./logger.cjs');
const { createHealthState } = require('./health.cjs');
const { createHttpServer } = require('./http-server.cjs');
const { createDatabase } = require('./database.cjs');
const { ActionGate } = require('./actions.cjs');
const { AuditStore } = require('./audit-store.cjs');
const { DeadLetterStore } = require('./provider-resilience.cjs');
const { ArkHealthReadiness } = require('./ark-health-readiness.cjs');
const { ArkRconReadiness } = require('./ark-rcon-readiness.cjs');
const { CutoverReadiness } = require('./cutover-readiness.cjs');

async function startControlPlane() {
  const config = loadSentinelConfig();
  const logger = createLogger({ service: config.serviceName, level: config.logLevel });
  const health = createHealthState({ service: config.serviceName, version: 'v2' });
  const database = createDatabase({ connectionString: config.databaseUrl, logger });
  const actionGate = new ActionGate({ mutationEnabled: config.mutationEnabled, dryRun: config.dryRun });
  const auditStore = new AuditStore({ database, logger });
  const deadLetters = new DeadLetterStore({ database, logger });
  const arkHealthReadiness = new ArkHealthReadiness({ auditStore });
  const arkRconReadiness = new ArkRconReadiness({ auditStore });
  const cutoverReadiness = new CutoverReadiness({ database, deadLetters, arkHealthReadiness, arkRconReadiness, config });
  const httpServer = createHttpServer({
    health,
    logger,
    port: config.port,
    adminToken: config.adminToken,
    deadLetters,
    arkRconReadiness,
    cutoverReadiness,
  });

  logger.info('sentinel.control_plane.starting', {
    mode: config.mode,
    mutationsEnabled: config.mutationEnabled,
    dryRun: config.dryRun,
    databaseConfigured: database.enabled,
    deadLetterInspection: deadLetters.enabled && Boolean(config.adminToken),
    arkHealthReadinessInspection: auditStore.enabled && Boolean(config.adminToken),
    arkRconReadinessInspection: auditStore.enabled && Boolean(config.adminToken),
    cutoverReadinessInspection: Boolean(config.adminToken),
  });

  const databaseHealth = await database.ping();
  if (database.enabled && !databaseHealth.ok) {
    health.markNotReady('database-unavailable', { database: databaseHealth });
  } else {
    health.markReady({ database: databaseHealth, mode: config.mode, mutationsEnabled: config.mutationEnabled, dryRun: config.dryRun });
  }

  await httpServer.listen();

  const shutdown = async (signal) => {
    logger.info('sentinel.control_plane.shutdown', { signal });
    health.markNotReady('shutting-down');
    await Promise.allSettled([httpServer.close(), database.close()]);
  };

  return Object.freeze({ config, logger, health, database, actionGate, auditStore, deadLetters, arkHealthReadiness, arkRconReadiness, cutoverReadiness, httpServer, shutdown });
}

if (require.main === module) {
  startControlPlane()
    .then((runtime) => {
      let stopping = false;
      const stop = async (signal) => {
        if (stopping) return;
        stopping = true;
        await runtime.shutdown(signal);
        process.exit(0);
      };
      process.once('SIGTERM', () => void stop('SIGTERM'));
      process.once('SIGINT', () => void stop('SIGINT'));
    })
    .catch((error) => {
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', service: 'nexus-sentinel', message: 'sentinel.control_plane.fatal', error: { message: String(error.message || error) } }));
      process.exitCode = 1;
    });
}

module.exports = { startControlPlane };
