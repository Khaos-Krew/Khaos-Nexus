'use strict';

const { installGuildMembersIntentExtension } = require('../sentinel/guild-members-intent-extension.cjs');
const { bindSanctuaryCommands } = require('../sentinel/sanctuary-bot.cjs');
const { startGameBot } = require('../game-bots/start.cjs');

process.env.NEXUS_GAME_ROLE ||= 'diablo';

// /nexushelp does not call the Nexus backend, so this service does not start one.
startGameBot({
  botName: 'Sanctuary Nexus',
  botKey: 'sanctuary',
  gameRole: 'diablo',
  serviceName: 'sanctuary-nexus',
  beforeClient: () => {
    installGuildMembersIntentExtension();
  },
  bind: (client) => bindSanctuaryCommands(client)
}).catch((error) => {
  console.error(`[Sanctuary Nexus] startup failed: ${String(error?.message || error)}`);
  process.exit(1);
});
