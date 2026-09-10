'use strict';

const { loadSentinelConfig } = require('./config.cjs');
const { createLogger } = require('./logger.cjs');
const { createDatabase } = require('./database.cjs');
const { Scheduler } = require('./scheduler.cjs');
const { JobStore } = require('./job-store.cjs');
const { IncidentStore } = require('./incident-store.cjs');
const { DurableIncidentTracker } = require('./incidents.cjs');
const { ActionGate, ActionController } = require('./actions.cjs');
const { AuditStore } = require('./audit-store.cjs');
const { ActionStore } = require('./action-store.cjs');
const { ArkServerRegistry } = require('./ark-server-registry.cjs');
const { ArkHealthAdapter, registerArkHealthJob } = require('./ark-health-adapter.cjs');
const { ArkHealthObserver } = require('./ark-health-observer.cjs');
const { ArkEquivalenceEvidence } = require('./ark-equivalence-evidence.cjs');
const { ArkEquivalenceWindow } = require('./ark-equivalence-window.cjs');
const { ArkShadowComparison } = require('./ark-shadow-comparison.cjs');
const { ArkLegacyPublicInfoReader, ArkShadowRuntime } = require('./ark-shadow-runtime.cjs');
const { DeadLetterStore, ProviderCircuitBreaker, ProviderResilience } = require('./provider-resilience.cjs');

async function startWorker() {
  const base = loadSentinelConfig();
  const config = Object.freeze({ ...base, mode: 'worker', serviceName: process.env.NEXUS_SENTINEL_WORKER_NAME || 'nexus-sentinel-worker' });
  const logger = createLogger({ service: config.serviceName, level: config.logLevel });
  const database = createDatabase({ connectionString: config.databaseUrl, logger });
  const jobStore = new JobStore({ database, logger });
  const incidentStore = new IncidentStore({ database, logger });
  const auditStore = new AuditStore({ database, logger });
  const actionStore = new ActionStore({ database, auditStore, logger });
  const deadLetterStore = new DeadLetterStore({ database, logger });
  const scheduler = new Scheduler({ logger, jobStore });
  const incidents = new DurableIncidentTracker({ store: incidentStore, logger });
  const actionGate = new ActionGate({
    mutationEnabled: config.mutationEnabled,
    dryRun: config.dryRun,
    allow: config.actionAllowlist,
  });
  const actions = new ActionController({ gate: actionGate, store: actionStore, logger });
  const arkRegistry = new ArkServerRegistry();
  const arkHealth = new ArkHealthAdapter({ logger });
  const arkHealthObserver = new ArkHealthObserver({ incidents, auditStore, logger });
  const arkEquivalenceEvidence = new ArkEquivalenceEvidence({ auditStore, logger });
  const arkEquivalenceWindow = new ArkEquivalenceWindow();
  const arkShadowComparison = new ArkShadowComparison({ evidence: arkEquivalenceEvidence, window: arkEquivalenceWindow, logger });
  const arkProviderResilience = new ProviderResilience({
    breaker: new ProviderCircuitBreaker({ failureThreshold: 3, cooldownMs: 60000, logger }),
    deadLetters: deadLetterStore,
    logger,
  });
  const arkLegacyReader = new ArkLegacyPublicInfoReader({ resilience: arkProviderResilience, logger });
  const arkShadowRuntime = new ArkShadowRuntime({
    scheduler,
    registry: arkRegistry,
    v2Adapter: arkHealth,
    legacyReader: arkLegacyReader,
    comparison: arkShadowComparison,
    logger,
  });

  const databaseHealth = await database.ping();
  if (database.enabled && !databaseHealth.ok) {
    throw new Error(`Sentinel worker database unavailable: ${databaseHealth.reason || 'unknown'}`);
  }

  const restoredIncidents = await incidents.hydrate();

  registerArkHealthJob(scheduler, {
    adapter: arkHealth,
    servers: () => arkRegistry.list({ includeDisabled: false }),
    intervalMs: 300000,
    jitterMs: 30000,
    onResult: async (summary) => arkHealthObserver.observe(summary),
  });

  let arkShadowAcceptance = null;
  if (config.arkShadowEnabled) {
    const since = new Date(Date.now() - (config.arkShadowHistoryHours * 60 * 60 * 1000)).toISOString();
    arkShadowAcceptance = await arkShadowRuntime.start({
      since,
      intervalMs: config.arkShadowIntervalMs,
      jitterMs: config.arkShadowJitterMs,
    });
  }

  scheduler.start();

  logger.info('sentinel.worker.started', {
    mutationsEnabled: config.mutationEnabled,
    dryRun: config.dryRun,
    actionAllowlistSize: config.actionAllowlist.length,
    databaseConfigured: database.enabled,
    persistentJobs: jobStore.enabled,
    persistentIncidents: incidentStore.enabled,
    persistentActions: actionStore.enabled,
    persistentAudit: auditStore.enabled,
    persistentDeadLetters: deadLetterStore.enabled,
    actionControllerReady: true,
    arkRegistryReadOnly: true,
    arkHealthJobRegistered: true,
    arkShadowEnabled: config.arkShadowEnabled,
    arkShadowHistoryRestored: arkShadowAcceptance?.samples || 0,
    arkShadowRetirementEligible: arkShadowAcceptance?.eligible === true,
    arkProviderCircuitBreakerReady: true,
    openIncidentsRestored: restoredIncidents.length,
    jobsRegistered: scheduler.list().length,
    schedulerStarted: true,
  });

  const shutdown = async (signal) => {
    logger.info('sentinel.worker.shutdown', { signal });
    scheduler.stop();
    await database.close();
  };

  return Object.freeze({
    config,
    logger,
    database,
    jobStore,
    incidentStore,
    auditStore,
    actionStore,
    deadLetterStore,
    scheduler,
    incidents,
    actionGate,
    actions,
    arkRegistry,
    arkHealth,
    arkHealthObserver,
    arkEquivalenceEvidence,
    arkEquivalenceWindow,
    arkShadowComparison,
    arkProviderResilience,
    arkLegacyReader,
    arkShadowRuntime,
    arkShadowAcceptance,
    shutdown,
  });
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
