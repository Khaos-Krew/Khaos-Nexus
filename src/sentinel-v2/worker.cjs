'use strict';

const { loadSentinelConfig } = require('./config.cjs');
const { createLogger } = require('./logger.cjs');
const { createDatabase } = require('./database.cjs');
const { Scheduler } = require('./scheduler.cjs');
const { JobStore } = require('./job-store.cjs');
const { IncidentTracker } = require('./incidents.cjs');
const { ActionGate } = require('./actions.cjs');

async function startWorker() {
  const base = loadSentinelConfig();
  const config = Object.freeze({ ...base, mode: 'worker', serviceName: process.env.NEXUS_SENTINEL_WORKER_NAME || 'nexus-sentinel-worker' });
  const logger = createLogger({ service: config.serviceName, level: config.logLevel });
  const database = createDatabase({ connectionString: config.databaseUrl, logger });
  const jobStore = new JobStore({ database, logger });
  const scheduler = new Scheduler({ logger, jobStore });
  const incidents = new IncidentTracker();
  const actionGate = new ActionGate({ mutationEnabled: config.mutationEnabled, dryRun: config.dryRun });

  const databaseHealth = await database.ping();
  if (database.enabled && !databaseHealth.ok) {
    throw new Error(`Sentinel worker database unavailable: ${databaseHealth.reason || 'unknown'}`);
  }

  logger.info('sentinel.worker.started', {
    mutationsEnabled: config.mutationEnabled,
    dryRun: config.dryRun,
    databaseConfigured: database.enabled,
    persistentJobs: jobStore.enabled,
    jobsRegistered: scheduler.list().length,
  });

  const shutdown = async (signal) => {
    logger.info('sentinel.worker.shutdown', { signal });
    await database.close();
  };

  return Object.freeze({ config, logger, database, jobStore, scheduler, incidents, actionGate, shutdown });
}

if (require.main === module) {
  startWorker()
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
      console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', service: 'nexus-sentinel-worker', message: 'sentinel.worker.fatal', error: { message: String(error.message || error) } }));
      process.exitCode = 1;
    });
}

module.exports = { startWorker };
