'use strict';

const ASCENDED_STAGE_COMMANDS = Object.freeze(['rates', 'wipe', 'welcome', 'official', 'cluster']);
const CEPHALON_STAGE_COMMANDS = Object.freeze(['worldstate', 'dojo', 'calendar', 'cosmetic', 'welcome', 'fissures', 'nightwave', 'cycles', 'clan', 'profile', 'circuit']);

const STAGE_HELP = Object.freeze({
  rates: 'Tribe rates, breed timers, and the boss checklist',
  wipe: 'Staff wipe and transfer checklist',
  welcome: 'This bot welcome card; wallet and ranks stay on Nexus Sentinal',
  official: 'Official ASA network status from the Wildcard CDN',
  cluster: 'Player count, map, and day for this cluster',
  fissures: 'Open Void Fissures by tier, with Steel Path and storm flags',
  nightwave: 'Nightwave challenges with a personal done checklist',
  cycles: 'Cetus, Vallis, Cambion, and Earth countdowns',
  clan: 'Staff: refresh the Warframe clan application panel',
  profile: 'Public Warframe profile lookup',
  circuit: 'Duviri choices, Steel Path reward, and Archimedea',
  worldstate: 'Cetus, Orb Vallis, Duviri, and a short invasion digest',
  dojo: 'Clan dojo checklist and official wiki links',
  calendar: 'Warframe event calendar pin',
  cosmetic: 'Warframe cosmetic Discord roles; ranks stay on Nexus Sentinal'
});

function stageCommandNames(bot) {
  return bot === 'ascended' ? [...ASCENDED_STAGE_COMMANDS] : bot === 'cephalon' ? [...CEPHALON_STAGE_COMMANDS] : [];
}

module.exports = {
  ASCENDED_STAGE_COMMANDS,
  CEPHALON_STAGE_COMMANDS,
  STAGE_HELP,
  stageCommandNames
};
