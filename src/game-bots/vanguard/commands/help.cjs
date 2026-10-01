'use strict';

const { bungieConfig } = require('../config.cjs');
const { BRAND, DISCLAIMER } = require('../panels.cjs');

function helpText(env = process.env) {
  const lines = [
    '**Nexus Vanguard help**',
    'Live commands:',
    '• `/lfg create` — post a fireteam in the lfg channel',
    '• `/lfg list` — open fireteams in this server',
    '• `/lfg close` — the host or staff closes a post',
    '• `/d2 player` — public Bungie name lookup',
    '• `/d2 reset` — weekly public milestones',
    '• `/d2 clan` — clan summary'
  ];
  if (bungieConfig(env).xurPanel) lines.push('• `/d2 xur` — Xûr\'s public stock');
  lines.push(
    '• `/vanguard roster` — staff: paged clan roster',
    '• `/vanguard setup` — staff: create missing channels',
    '• `/vanguard panels refresh` — staff: refresh a panel',
    '• `/nexushelp` — this list',
    '• `/status` — staff service status',
    '',
    'Wallet (`/bal`), verify (`/o9verify`), ranks, and the shop stay on Nexus Sentinal.',
    'Vanguard has no paid tiers, donations, ads, Nexus Coins, or Nexus Points.',
    BRAND,
    DISCLAIMER
  );
  return lines.join('\n').slice(0, 1900);
}

module.exports = { helpText };
