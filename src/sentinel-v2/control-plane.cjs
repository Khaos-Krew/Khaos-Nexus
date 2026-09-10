'use strict';

const { loadSentinelConfig } = require('./config.cjs');
const { createLogger } = require('./logger.cjs');
const { createHealthState } = require('./health.cjs');
const { createHttpServer } = require('./http-server.cjs');
const { createDatabase } = require('./database.cjs');
const { ActionGate } = require('./actions.cjs');
const { DeadLetterStore } = require('./provider-resilience.cjs');

async function startControlPlane() {
  const config = loadSentinelConfig();
  const logger = createLogger({ service: config.serviceName, level: config.logLevel });
  const health = createHealthState({ service: config.serviceName, version: 'v2' });
  const database = createDatabase({ connectionString: config.databaseUrl, logger });
  const actionGate = new ActionGate({ mutationEnabled: config.mutationEnabled, dryRun: config.dryRun });
  const deadLetters = new DeadLetterStore({ database, logger });
  const httpServer = createHttpServer({
    health,
    logger,
    port: config.port,
    adminToken: config.adminToken,
    deadLetters,
  });

  logger.info('sentinel.control_plane.starting', {
    mode: config.mode,
    mutationsEnabled: config.mutationEnabled,
    dryRun: config.dryRun,
    databaseConfigured: database.enabled,
    deadLetterInspection: deadLetters.enabled && Boolean(config.adminToken),
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

  return Object.freeze({ config, logger, health, database, actionGate, deadLetters, httpServer, shutdown });
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
