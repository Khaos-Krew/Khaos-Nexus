'use strict';

const ASCENDED_STAGE_COMMANDS = Object.freeze(['rates', 'wipe', 'welcome']);
const CEPHALON_STAGE_COMMANDS = Object.freeze(['worldstate', 'dojo', 'calendar', 'cosmetic', 'welcome']);

const STAGE_HELP = Object.freeze({
  rates: 'Tribe rates, breed timers, and the boss checklist',
  wipe: 'Staff wipe and transfer checklist',
  welcome: 'This bot welcome card; wallet and ranks stay on Nexus Sentinal',
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
