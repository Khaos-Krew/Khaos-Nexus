'use strict';

function craftHelpText() {
  return [
    '**Nexus Craft help**',
    '',
    '**What needs setup**',
    '• Discord token `NEXUS_CRAFT_TOKEN` and guild `DISCORD_GUILD_ID` before slash commands exist. With no token the process stays up and `/health` returns 200.',
    '• Category `NEXUS_CRAFT_DISCORD_CATEGORY_ID`. Until it is set, commands reply that Nexus Craft is not configured.',
    '• Java RCON is saved by staff with `/mcrcon setup` (host, port, password, optional `server` name). The Discord store is the only source. Railway env is never read for host, port, or password, and the password is never shown again.',
    '• Realms board: `NEXUS_CRAFT_REALMS_CHANNEL_ID`, or staff `/realm channel` in the board channel. Put that channel inside the Craft category.',
    '• Optional status panel: staff `/mc panel` posts one embed and edits that same message on a timer.',
    '',
    '**Commands**',
    '• `/craft help` — this list.',
    '• `/mc status` — Java server-list ping and/or Bedrock RakNet ping. No RCON. Bedrock default port is 19132.',
    '• `/mc panel` — staff durable status embed.',
    '• `/mc players`, `/mc say`, `/mc whitelist add|remove|list`, `/mc kick` — staff Java RCON.',
    '• `/mc cmd` — staff raw RCON. Administrator or a staff role, same staff check as the other game bots.',
    '• `/mcrcon setup`, `/mcrcon status`, `/mcrcon clear` — staff connection store.',
    '• `/realm post` — a Realm owner posts a listing with an Apply button. `/realm edit` and `/realm close` change that owner\'s listing. Apply opens a short gamertag note. Approve and Deny belong to that listing\'s owner or staff.',
    '',
    '**Edition support**',
    '• Java dedicated server: status ping and full RCON.',
    '• Bedrock dedicated server: status ping only. No RCON.',
    '• Bedrock players can join a Java server through Geyser. That Java server still has full RCON control.',
    '• Minecraft Realms: listing board only. Mojang provides no RCON and no official Realms API. Approve tells the applicant the next step; the owner still adds them inside Minecraft.'
  ].join('\n').slice(0, 1900);
}

module.exports = { craftHelpText };
