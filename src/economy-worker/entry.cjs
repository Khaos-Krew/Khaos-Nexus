'use strict';

// Preserve the reusable readiness server from #583; production uses its write gate
// with the transactional Postgres implementation. There is no file fallback.
const runtime = require('./postgres-server.cjs');
if (require.main === module) runtime.main().catch(error => { console.error('[Nexus Economy Worker] startup failed:', error.code || error.message); process.exitCode = 1; });
module.exports = runtime;
