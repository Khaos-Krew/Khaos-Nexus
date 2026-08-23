'use strict';

const { loadConfig } = require('../shared/config.cjs');
const { createBackendApplication } = require('./application.cjs');

const backend = createBackendApplication(loadConfig());

backend.start().catch((error) => {
  console.error('[Nexus Backend] failed to start:', error);
  process.exitCode = 1;
});

async function shutdown() {
  try { await backend.stop(); }
  finally { process.exit(0); }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
