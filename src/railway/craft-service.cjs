'use strict';

const { startNexusCraft } = require('../craft/boot.cjs');

process.env.NEXUS_GAME_ROLE ||= 'minecraft';

startNexusCraft().catch((error) => {
  console.error(`[Nexus Craft] startup failed: ${String(error?.message || error)}`);
  process.exit(1);
});
