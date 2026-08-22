'use strict';

const viewer = (id, label, extra = {}) => ({ id, label, requiredRole: 'viewer', destructive: false, ...extra });
const operator = (id, label, extra = {}) => ({ id, label, requiredRole: 'operator', destructive: false, ...extra });
const owner = (id, label, extra = {}) => ({ id, label, requiredRole: 'owner', destructive: true, ...extra });

const MODULES = [
  { id: 'ark', name: 'ARK: Survival Ascended', console: true, capabilities: [viewer('status','Status'), viewer('players','Players'), operator('save','Save'), operator('broadcast','Broadcast'), owner('restart','Restart'), operator('schedules','Schedules')] },
  { id: 'palworld', name: 'Palworld', console: true, capabilities: [viewer('status','Status'), viewer('players','Players'), operator('save','Save'), operator('broadcast','Broadcast'), owner('restart','Restart'), operator('backups','Backups')] },
  { id: 'minecraft', name: 'Minecraft', console: true, capabilities: [viewer('status','Status'), viewer('players','Players'), operator('save','Save'), operator('broadcast','Broadcast'), owner('restart','Restart'), operator('backups','Backups'), viewer('modpack','Modpack')] },
  { id: 'warframe', name: 'Warframe', console: true, capabilities: [viewer('alerts','Alerts'), viewer('fissures','Fissures'), viewer('sortie','Sortie'), viewer('arbitration','Arbitration'), viewer('nightwave','Nightwave'), viewer('market','Market'), viewer('builds','Build Helper')] },
  { id: 'division2', name: 'The Division 2', console: true, capabilities: [viewer('builds','Builds'), viewer('optimize','Optimize'), viewer('gear','Gear'), viewer('wishlist','Wishlist'), viewer('farming','Farming'), viewer('weekly','Weekly'), viewer('lfg','LFG'), viewer('news','News')] },
  { id: 'rust', name: 'Rust', console: true, capabilities: [viewer('status','Status'), viewer('players','Players'), operator('save','Save'), operator('broadcast','Broadcast'), owner('restart','Restart'), operator('backups','Backups')] },
  { id: 'satisfactory', name: 'Satisfactory', console: true, capabilities: [viewer('status','Status'), viewer('players','Players'), operator('save','Save'), owner('restart','Restart'), operator('backups','Backups')] },
  { id: 'idleon', name: 'Legends of IdleOn', console: true, capabilities: [viewer('profile','Profile'), viewer('goals','Goals'), viewer('builds','Builds'), viewer('farming','Farming'), viewer('calculators','Calculators')] },
  { id: 'dnd', name: 'Nexus D&D', console: false, surface: 'veyra', capabilities: [viewer('campaigns','Campaigns'), viewer('characters','Characters'), viewer('dice','Dice'), viewer('initiative','Initiative'), operator('encounters','Encounters'), operator('codex','Codex')] }
];

function getModule(id) { return MODULES.find((module) => module.id === id) || null; }
function publicManifest(module) { return { id: module.id, name: module.name, console: module.console !== false, surface: module.surface || 'sentinel', capabilities: module.capabilities.map((cap) => ({ ...cap })) }; }

module.exports = { MODULES, getModule, publicManifest };
