'use strict';

// Explicit, owner-run schema preparation. Never imports or prints environment credentials.
const { getRconConfigProvider, databaseMode } = require('../src/sentinel/ark-rcon-database.cjs');
async function main() {
  if (!databaseMode()) throw new Error('Set NEXUS_RCON_CONFIG_BACKEND=postgres for this migration.');
  const provider = getRconConfigProvider();
  try { await provider.initialize(); console.log('RCON database schema ready; no servers imported or enabled.'); }
  finally { await provider.pool.end(); }
}
if (require.main === module) main().catch(() => { console.error('RCON migration failed; check database access and encryption configuration.'); process.exitCode = 1; });
module.exports = { main };
