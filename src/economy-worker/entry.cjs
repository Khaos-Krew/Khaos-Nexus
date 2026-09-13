'use strict';

const { listenEconomyServer } = require('./server.cjs');
const { resolveEconomyPort } = require('./port.cjs');
const { postgresEnabled, createPostgresEconomyRuntime } = require('./postgres-runtime.cjs');
const { NexusEconomyWorker } = require('../sentinel/nexus-economy-worker.cjs');
const { createConfiguredClusterShop } = require('../sentinel/cluster-shop-production-service.cjs');
const {
  configureEconomyHttpServer,
  beginEconomyHttpDrain,
} = require('./http-lifecycle.cjs');
const { createEconomyShutdownController } = require('./shutdown-controller.cjs');

async function start() {
  const economyPort = resolveEconomyPort(process.env);
  const postgres = postgresEnabled(process.env) ? await createPostgresEconomyRuntime({ env: process.env }) : null;
  const worker = postgres?.worker || new NexusEconomyWorker();
  const shop = postgres?.shop || createConfiguredClusterShop({ economy: worker });
  const runtime = listenEconomyServer({ port: economyPort, worker, shop });
  if (postgres) runtime.close = postgres.close;
  configureEconomyHttpServer(runtime.server);

  const shutdown = createEconomyShutdownController({ runtime, server: runtime.server, beginHttpDrain: beginEconomyHttpDrain });
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return runtime;
}

start().catch((error) => {
  console.error('[Nexus Economy Worker] startup failed:', String(error?.message || error).slice(0, 500));
  process.exitCode = 1;
});

module.exports = { start };
