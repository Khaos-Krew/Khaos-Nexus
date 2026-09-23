'use strict';

const { installGuildMembersIntentExtension } = require('../sentinel/guild-members-intent-extension.cjs');
const { bindCephalonCommands } = require('../sentinel/cephalon-bot.cjs');
const { startGameBot } = require('../game-bots/start.cjs');

process.env.NEXUS_GAME_ROLE ||= 'warframe';
process.env.NEXUS_BACKEND_HOST ||= '127.0.0.1';
process.env.NEXUS_BACKEND_PORT ||= '3210';
process.env.NEXUS_BACKEND_URL ||= `http://${process.env.NEXUS_BACKEND_HOST}:${process.env.NEXUS_BACKEND_PORT}`;

startGameBot({
  botName: 'Cephalon Nexus',
  botKey: 'cephalon',
  gameRole: 'warframe',
  serviceName: 'cephalon-nexus',
  beforeClient: () => {
    installGuildMembersIntentExtension();
    require('../backend/server.cjs');
  },
  bind: (client) => bindCephalonCommands(client)
}).catch((error) => {
  console.error(`[Cephalon Nexus] startup failed: ${String(error?.message || error)}`);
  process.exit(1);
});
