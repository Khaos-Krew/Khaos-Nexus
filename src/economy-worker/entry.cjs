'use strict';

const { listenEconomyServer } = require('./server.cjs');
const { resolveEconomyPort } = require('./port.cjs');
const {
  configureEconomyHttpServer,
  beginEconomyHttpDrain,
} = require('./http-lifecycle.cjs');
const { createEconomyShutdownController } = require('./shutdown-controller.cjs');

// Co-located Sentinel installs set NEXUS_ECONOMY_PORT so the worker does not
// collide with Sentinel's Railway PORT. Dedicated worker services omit that
// override and must listen on Railway's PORT for routing and /health checks.
const economyPort = resolveEconomyPort(process.env);
const runtime = listenEconomyServer({ port: economyPort });
configureEconomyHttpServer(runtime.server);

const shutdown = createEconomyShutdownController({
  runtime,
  server: runtime.server,
  beginHttpDrain: beginEconomyHttpDrain,
});

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
