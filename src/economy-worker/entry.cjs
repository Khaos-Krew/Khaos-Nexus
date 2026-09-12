'use strict';

const { listenEconomyServer } = require('./server.cjs');
const { resolveEconomyPort } = require('./port.cjs');

// Co-located Sentinel installs set NEXUS_ECONOMY_PORT so the worker does not
// collide with Sentinel's Railway PORT. Dedicated worker services omit that
// override and must listen on Railway's PORT for routing and /health checks.
const economyPort = resolveEconomyPort(process.env);
const runtime = listenEconomyServer({ port: economyPort });

function shutdown(signal) {
  console.log(`[Nexus Economy Worker] ${signal} received; shutting down.`);
  runtime.server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref?.();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
