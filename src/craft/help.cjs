'use strict';

function craftHelpText() {
  return [
    '**Nexus Craft help**',
    '',
    '**What needs setup**',
    '• Discord token `NEXUS_CRAFT_TOKEN` and guild `DISCORD_GUILD_ID`. With no token the process stays up and `/health` returns 200.',
    '• Category `NEXUS_CRAFT_DISCORD_CATEGORY_ID`. Until it is set, commands reply that Nexus Craft is not configured.',
    '• Java RCON is saved by staff with `/mcrcon setup`. The Discord store is the only source. Railway env is never read for host, port, or password.',
    '• Realms board: `NEXUS_CRAFT_REALMS_CHANNEL_ID`, or staff `/realm channel` inside the Craft category.',
    '• Rank sync (`MC_RANK_SYNC_ENABLED`, default off) needs the privileged **Server Members** intent on the Nexus Craft app before that flag is turned on. Dry run defaults on.',
    '',
    '**Commands**',
    '• `/craft help` — this list.',
    '• `/mc status` — Java and/or Bedrock ping. No RCON. Bedrock default port is 19132.',
    '• `/mc panel` — staff durable status embed.',
    '• `/mc players`, `/mc say`, `/mc whitelist add|remove|list`, `/mc kick` — staff Java RCON.',
    '• `/mc cmd` — staff raw RCON. Same staff check as the other game bots.',
    '• `/mc link`, `/mc unlink`, `/mc shop`, and `/mc starter` appear only when that feature is on.',
    '• `/mcadmin` is staff-only. `/mcadmin refund` points staff to Sentinal `/shopadmin mc-refund`.',
    '• `/mcrcon setup`, `/mcrcon status`, `/mcrcon clear` — staff connection store.',
    '• `/mcrank preview` and `/mcrank sync` — staff LuckPerms role sync. Preview sends no writes.',
    '• `/realm post` posts a listing. `/realm edit` and `/realm close` change that owner\'s listing. Apply DMs the owner.',
    '',
    '**Edition support**',
    '• Java dedicated server: status ping and full RCON.',
    '• Bedrock dedicated server: status ping only. No RCON.',
    '• Bedrock players join Java through Geyser. That Java server still has full RCON. LuckPerms uses the Floodgate UUID.',
    '• Minecraft Realms: listing board only. Mojang provides no RCON and no official Realms API. The owner still adds them inside Minecraft.'
  ].join('\n').slice(0, 1900);
}

module.exports = { craftHelpText };
