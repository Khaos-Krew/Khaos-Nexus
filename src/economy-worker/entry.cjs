'use strict';

const { listenEconomyServer } = require('./server.cjs');
const { resolveEconomyPort } = require('./port.cjs');
const { postgresEnabled, createPostgresEconomyRuntime } = require('./postgres-runtime.cjs');
const {
  configureEconomyHttpServer,
  beginEconomyHttpDrain,
} = require('./http-lifecycle.cjs');
const { createEconomyShutdownController } = require('./shutdown-controller.cjs');

async function start() {
  // Co-located Sentinel installs set NEXUS_ECONOMY_PORT so the worker does not
  // collide with Sentinel's Railway PORT. Dedicated worker services omit that
  // override and must listen on Railway's PORT for routing and /health checks.
  const economyPort = resolveEconomyPort(process.env);
  const postgres = postgresEnabled(process.env) ? await createPostgresEconomyRuntime({ env: process.env }) : null;
  const runtime = listenEconomyServer({
    port: economyPort,
    worker: postgres?.worker,
    shop: postgres?.shop
  });
  if (postgres) runtime.close = postgres.close;
  configureEconomyHttpServer(runtime.server);

  const shutdown = createEconomyShutdownController({
    runtime,
    server: runtime.server,
    beginHttpDrain: beginEconomyHttpDrain,
  });

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return runtime;
}

start().catch((error) => {
  console.error('[Nexus Economy Worker] startup failed:', String(error?.message || error).slice(0, 500));
  process.exitCode = 1;
});

module.exports = { start };