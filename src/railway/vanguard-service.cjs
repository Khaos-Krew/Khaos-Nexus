'use strict';

const { installGuildMembersIntentExtension } = require('../sentinel/guild-members-intent-extension.cjs');
const { errorClass } = require('../game-bots/command-failure.cjs');
const { startGameBot } = require('../game-bots/start.cjs');
const { prepareVanguardEnv, installRejectionGuard, installVanguard } = require('../game-bots/vanguard/entry.cjs');

installRejectionGuard();
prepareVanguardEnv();
process.env.NEXUS_GAME_ROLE ||= 'destiny';

// Vanguard stays read-only toward Bungie. There is no game backend and no economy.
startGameBot({
  botName: 'Nexus Vanguard',
  botKey: 'vanguard',
  gameRole: 'destiny',
  serviceName: 'nexus-vanguard',
  beforeClient: () => {
    installGuildMembersIntentExtension();
  },
  bind: (client) => installVanguard(client, { env: process.env, shutdown: true })
}).catch((error) => {
  console.error(`[Nexus Vanguard] startup failed: class=${errorClass(error)}`);
  process.exit(1);
});
