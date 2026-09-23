'use strict';

// Slash commands that leave Nexus Sentinal. Hub commands stay unlisted here.
const ASCENDED_COMMANDS = Object.freeze([
  'ark',
  'ark-health',
  'arkcluster',
  'arkconfig',
  'arkdb',
  'arkevent',
  'arkprofile',
  'arkshopadmin',
  'arkserver',
  'arkrcon',
  'arn',
  'cacheadmin',
  'cachetoken'
]);

const CEPHALON_COMMANDS = Object.freeze([
  'market',
  'warframe'
]);

function commandOwner(name) {
  const command = String(name || '').trim().toLowerCase();
  if (ASCENDED_COMMANDS.includes(command)) return 'ascended';
  if (CEPHALON_COMMANDS.includes(command)) return 'cephalon';
  return 'sentinal';
}

function sentinalShouldRegister(name) {
  return commandOwner(name) === 'sentinal';
}

function movedCommandReply(name) {
  const owner = commandOwner(name);
  if (owner === 'ascended') return 'That ARK command now runs on **Nexus Ascended**.';
  if (owner === 'cephalon') return 'That Warframe command now runs on **Cephalon Nexus**.';
  return '';
}

module.exports = {
  ASCENDED_COMMANDS,
  CEPHALON_COMMANDS,
  commandOwner,
  sentinalShouldRegister,
  movedCommandReply
};
