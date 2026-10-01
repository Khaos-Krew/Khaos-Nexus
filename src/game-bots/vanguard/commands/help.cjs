'use strict';

const { BRAND, DISCLAIMER } = require('../panels.cjs');

function helpText() {
  return [
    '**Nexus Vanguard help**',
    'Live commands:',
    '• `/lfg create` — post a fireteam in the lfg channel',
    '• `/lfg list` — open fireteams in this server',
    '• `/lfg close` — the host or staff closes a post',
    '• `/vanguard setup` — staff: create missing channels',
    '• `/nexushelp` — this list',
    '• `/status` — staff service status',
    '',
    'Wallet (`/bal`), verify (`/o9verify`), ranks, and the shop stay on Nexus Sentinal.',
    'Vanguard has no paid tiers, donations, ads, or Nexus Coins.',
    BRAND,
    DISCLAIMER
  ].join('\n').slice(0, 1900);
}

module.exports = { helpText };
