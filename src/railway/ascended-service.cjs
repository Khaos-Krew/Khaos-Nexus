'use strict';

const { startGameBot } = require('../game-bots/start.cjs');
const { errorClass } = require('../game-bots/command-failure.cjs');
const { isArkShopMysqlRetired } = require('../sentinel/arkshop-database.cjs');
const { describeRconVault } = require('../sentinel/ark-rcon-config-store.cjs');

process.env.NEXUS_GAME_ROLE ||= 'ark_asa';
process.env.NEXUS_DATA_DIR ||= '/app/data';
// Connection settings are not Railway variables. /arkrcon writes the override store.
process.env.NEXUS_RCON_RAILWAY_ENV_FORBIDDEN ||= 'true';
process.env.NEXUS_RCON_SOURCE ||= 'discord_override_store';

if (isArkShopMysqlRetired()) {
  console.log('[Nexus Ascended] ArkShop MySQL retired; MySQL polling disabled.');
}

try {
  const vault = describeRconVault();
  console.log(`[Nexus Ascended] RCON vault servers=${vault.servers} readable=${vault.readablePasswords} unreadable=${vault.unreadable} class=none`);
} catch (error) {
  console.warn(`[Nexus Ascended] RCON vault class=${errorClass(error)}`);
}

startGameBot({
  botName: 'Nexus Ascended',
  botKey: 'ascended',
  gameRole: 'ark_asa',
  serviceName: 'nexus-ascended',
  beforeClient: () => {
    require('../sentinel/guild-members-intent-extension.cjs').installGuildMembersIntentExtension();
    require('../sentinel/ascended-runtime.cjs').installAscendedArkRuntime();
  }
}).catch((error) => {
  console.error(`[Nexus Ascended] startup failed: ${String(error?.message || error)}`);
  process.exit(1);
});
