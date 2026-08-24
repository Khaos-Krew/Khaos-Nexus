'use strict';

const viewer = (id, label, extra = {}) => ({ id, label, requiredRole: 'viewer', destructive: false, ...extra });
const operator = (id, label, extra = {}) => ({ id, label, requiredRole: 'operator', destructive: false, ...extra });
const owner = (id, label, extra = {}) => ({ id, label, requiredRole: 'owner', destructive: true, ...extra });
const ownerSafe = (id, label, extra = {}) => ({ id, label, requiredRole: 'owner', destructive: false, ...extra });

const schedules = () => [
  viewer('schedule-list', 'Schedules', { service: 'scheduler' }),
  owner('schedule-add', 'Add Schedule', { service: 'scheduler', button: false, input: 'daily HH:MM action [input]' }),
  owner('schedule-remove', 'Remove Schedule', { service: 'scheduler', button: false, input: '<schedule id>' })
];

const MODULES = [
  {
    id: 'ark', name: 'ARK: Survival Ascended', console: true,
    capabilities: [
      viewer('status', 'Status'), viewer('players', 'Players'), viewer('servers', 'Servers'),
      viewer('taming', 'Taming Helper', { service: 'ark-companion', button: false, input: '<creature> + level + food + taming rate + food drain' }),
      operator('save', 'Save All'), operator('broadcast', 'Broadcast', { button: false, input: '<message>' }),
      operator('kick', 'Kick Player', { destructive: true, button: false, input: '[server|]<player>' }),
      owner('ban', 'Ban Player', { button: false, input: '[server|]<player>' }),
      ownerSafe('unban', 'Unban Player', { button: false, input: '[server|]<player or id>' }),
      owner('restart', 'Restart', { button: false, input: '[server|][seconds]' }),
      viewer('mods', 'Mod List'), viewer('backups', 'Backups'),
      owner('rcon', 'Raw RCON', { button: false, input: '[server|]<command>' }),
      ...schedules()
    ]
  },
  {
    id: 'callofduty', name: 'Call of Duty', console: true,
    capabilities: [
      viewer('loadouts', 'Loadouts', { button: false, input: 'list | add <loadout> | remove <loadout>' }),
      viewer('lfg', 'LFG', { button: false, input: 'list | join <activity> | leave' }),
      viewer('news', 'Patch Notes'), viewer('api-status', 'API Status')
    ]
  },
  {
    id: 'deadbydaylight', name: 'Dead by Daylight', console: true,
    capabilities: [
      viewer('killers', 'Killers', { button: false, input: '[search]' }),
      viewer('survivors', 'Survivors', { button: false, input: '[search]' }),
      viewer('perks', 'Perks', { button: false, input: '[perk or keyword]' }),
      viewer('builds', 'Build Research', { button: false, input: '<perk, character, or playstyle>' }),
      viewer('random-build', 'Random Build', { button: false, input: 'killer | survivor' }),
      viewer('stats', 'Steam Stats', { button: false, input: '<SteamID64>|<NightLight stat name>' }),
      viewer('lfg', 'LFG', { button: false, input: 'list | join <activity> | leave' })
    ]
  },
  {
    id: 'diablo4', name: 'Diablo IV', console: true,
    capabilities: [
      viewer('classes', 'Classes'),
      viewer('builds', 'Build Library', { button: false, input: 'list | add <build notes> | remove <build notes>' }),
      viewer('planner', 'Build Planner', { button: false, input: '[class]' }),
      viewer('wishlist', 'Wishlist', { button: false, input: 'list | add <item> | remove <item>' }),
      viewer('lfg', 'LFG', { button: false, input: 'list | join <activity> | leave' }),
      viewer('news', 'News'), viewer('api-status', 'API Status')
    ]
  },
  {
    id: 'palworld', name: 'Palworld', console: true,
    capabilities: [
      viewer('status', 'Status'), viewer('players', 'Players'), viewer('settings', 'Settings'), viewer('metrics', 'Metrics'),
      operator('save', 'Save World'), operator('broadcast', 'Broadcast', { button: false, input: '<message>' }),
      operator('kick', 'Kick Player', { destructive: true, button: false, input: '<userid>[|message]' }),
      owner('ban', 'Ban Player', { button: false, input: '<userid>[|message]' }),
      ownerSafe('unban', 'Unban Player', { button: false, input: '<userid>' }),
      viewer('snapshot', 'World Snapshot'), viewer('backups', 'Backups'),
      owner('restart', 'Restart', { button: false, input: '[seconds|message]' }),
      owner('shutdown', 'Shutdown', { button: false, input: '[seconds|message]' }),
      ...schedules()
    ]
  },
  {
    id: 'minecraft', name: 'Minecraft', console: true,
    capabilities: [
      viewer('status', 'Status'), viewer('players', 'Players'), viewer('servers', 'Servers'),
      operator('save', 'Save All'), operator('broadcast', 'Broadcast', { button: false, input: '<message>' }),
      operator('kick', 'Kick Player', { destructive: true, button: false, input: '[server|]<player>' }),
      owner('ban', 'Ban Player', { button: false, input: '[server|]<player>' }),
      ownerSafe('unban', 'Pardon Player', { button: false, input: '[server|]<player>' }),
      owner('restart', 'Restart', { button: false, input: '[server|][seconds]' }),
      viewer('whitelist', 'Whitelist'), viewer('modpack', 'Modpack'), viewer('backups', 'Backups'),
      owner('rcon', 'Raw Console', { button: false, input: '[server|]<command>' }),
      ...schedules()
    ]
  },
  {
    id: 'warframe', name: 'Warframe', console: true,
    capabilities: [
      viewer('news', 'News'), viewer('events', 'Events'), viewer('alerts', 'Alerts'), viewer('fissures', 'Fissures'),
      viewer('sortie', 'Sortie'), viewer('archon-hunt', 'Archon Hunt'), viewer('arbitration', 'Arbitration'), viewer('nightwave', 'Nightwave'),
      viewer('invasions', 'Invasions'), viewer('void-trader', 'Void Trader'), viewer('steel-path', 'Steel Path'),
      viewer('kuva', 'Kuva'), viewer('cycles', 'World Cycles'),
      viewer('market', 'Market', { button: false, input: '<item name>' }),
      viewer('builds', 'Build Helper', { button: false, input: '<frame, weapon, or mod>' })
    ]
  },
  {
    id: 'division2', name: 'The Division 2', console: true,
    capabilities: [
      viewer('gear', 'Gear Search', { button: false, input: '<item, brand, set, talent>' }),
      viewer('builds', 'Build Research', { button: false, input: '<build goal>' }),
      viewer('optimize', 'Build Optimizer', { button: false, input: '<build goal>' }),
      viewer('compare', 'Compare Gear', { button: false, input: '<item A>|<item B>' }),
      viewer('farming', 'Farm Planner', { button: false, input: '<item or set>' }),
      viewer('wishlist', 'Wishlist', { button: false, input: 'list | add <item> | remove <item>' }),
      viewer('inventory', 'Inventory Vault', { button: false, input: 'list | add <item> | remove <item>' }),
      viewer('weekly', 'Weekly Checklist'), viewer('lfg', 'LFG', { button: false, input: 'list | join <activity> | leave' }),
      viewer('news', 'News')
    ]
  },
  {
    id: 'rust', name: 'Rust', console: true,
    capabilities: [
      viewer('status', 'Status'), viewer('players', 'Players'),
      operator('save', 'Save'), operator('broadcast', 'Broadcast', { button: false, input: '<message>' }),
      operator('kick', 'Kick Player', { destructive: true, button: false, input: '<player or steam id>' }),
      owner('ban', 'Ban Player', { button: false, input: '<player or steam id>' }),
      ownerSafe('unban', 'Unban Player', { button: false, input: '<steam id>' }),
      owner('restart', 'Restart', { button: false, input: '[seconds]' }),
      viewer('backups', 'Backups'), owner('rcon', 'Raw RCON', { button: false, input: '<command>' }),
      ...schedules()
    ]
  },
  {
    id: 'satisfactory', name: 'Satisfactory', console: true,
    capabilities: [
      viewer('status', 'Status'), viewer('players', 'Players'), operator('save', 'Save Game', { button: false, input: '[save name]' }),
      viewer('saves', 'Save Sessions'), viewer('server-options', 'Server Options'), viewer('advanced-settings', 'Advanced Settings'),
      owner('load-save', 'Load Save', { button: false, input: '<save name>' }),
      owner('command', 'Run Console Command', { button: false, input: '<command>' }),
      owner('restart', 'Restart', { button: false }), viewer('backups', 'Backups'),
      ...schedules()
    ]
  },
  {
    id: 'idleon', name: 'Legends of IdleOn', console: true,
    capabilities: [
      viewer('profile', 'Profile'), viewer('goals', 'Goals', { button: false, input: 'list | add <goal> | done <id>' }),
      viewer('builds', 'Builds', { button: false, input: '<class or character>' }),
      viewer('farming', 'Farming', { button: false, input: '<target>' }),
      viewer('calculators', 'Calculators', { button: false, input: '<calculator input>' }),
      viewer('progression', 'Progression'), viewer('cards', 'Cards'), viewer('obols', 'Obols'), viewer('greenstacks', 'Green Stacks')
    ]
  },
  {
    id: 'pokemongo', name: 'Pokémon GO', console: true,
    capabilities: [
      viewer('panel', 'Operations Panel'), viewer('raids', 'Active Raids'), viewer('events', 'Events'), viewer('friends', 'Trainer Directory'),
      viewer('trade-matches', 'Trade Matches'), viewer('showcase', 'Catch Showcase'), viewer('meetups', 'Meetups'),
      viewer('profile', 'Trainer Profile', { button: false }), viewer('profile-set', 'Set Trainer Profile', { button: false }),
      viewer('trades', 'My Trades', { button: false }), viewer('trade-add', 'Add Trade', { button: false }), viewer('trade-remove', 'Remove Trade', { button: false }),
      viewer('raid-create', 'Create Raid', { button: false }), viewer('raid-rsvp', 'Raid RSVP', { button: false }), viewer('raid-cancel', 'Cancel Raid', { button: false }),
      viewer('vivillon', 'Vivillon Exchange', { button: false }),
      viewer('collection', 'My Collection', { button: false }), viewer('collection-add', 'Add Collection Entry', { button: false }), viewer('collection-remove', 'Remove Collection Entry', { button: false }),
      viewer('showcase-add', 'Share Catch', { button: false }), viewer('meetup-create', 'Create Meetup', { button: false }), viewer('meetup-rsvp', 'Meetup RSVP', { button: false }),
      viewer('counter', 'Raid Counter Assistant', { button: false }), viewer('pvp', 'PvP Team Check', { button: false }),
      ownerSafe('event-add', 'Add Event Reminder', { button: false }), owner('event-remove', 'Remove Event Reminder', { button: false })
    ]
  },
  {
    id: 'dnd', name: 'Nexus D&D', console: false, surface: 'veyra',
    capabilities: [
      viewer('campaigns', 'Campaigns'), viewer('characters', 'Characters'), viewer('dice', 'Dice'), viewer('initiative', 'Initiative'),
      operator('encounters', 'Encounters'), operator('codex', 'Codex'), operator('sessions', 'Sessions'), operator('quests', 'Quests'),
      operator('npcs', 'NPCs'), operator('locations', 'Locations'), operator('factions', 'Factions'), operator('loot', 'Loot'),
      operator('homebrew', 'Homebrew'), operator('sources', 'Sources')
    ]
  }
];

function getModule(id) { return MODULES.find((module) => module.id === id) || null; }
function publicManifest(module) {
  return {
    id: module.id,
    name: module.name,
    console: module.console !== false,
    surface: module.surface || 'sentinel',
    capabilities: module.capabilities.map((cap) => ({ ...cap }))
  };
}

module.exports = { MODULES, getModule, publicManifest };
